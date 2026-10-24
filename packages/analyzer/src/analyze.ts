import { exec, existsSync, listFiles, xcodeToAsc } from '@vitrin/core';
import type { AppProfile, Evidence, Feature, ProjectTarget } from '@vitrin/schemas';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { scanAssetCatalogs } from './assets.js';
import { expandSetting, readPbxproj, settingsOf, type PbxTarget } from './pbxproj.js';
import { readPlistFile } from './plist-file.js';
import { scanSource } from './signals.js';

export interface ProjectLocation {
  xcodeproj?: string;
  workspace?: string;
}

/** Finds the .xcodeproj / .xcworkspace closest to the root (depth ≤ 3). */
export async function locateProject(root: string, hint?: string): Promise<ProjectLocation> {
  if (hint) {
    const abs = join(root, hint);
    return hint.endsWith('.xcworkspace') ? { workspace: abs } : { xcodeproj: abs };
  }
  const found: ProjectLocation = {};
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || ['node_modules', 'Pods', 'DerivedData', 'build'].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.name.endsWith('.xcodeproj')) {
        found.xcodeproj ??= full;
      } else if (e.name.endsWith('.xcworkspace')) {
        found.workspace ??= full;
      } else {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(root, 0);
  return found;
}

const PRODUCT_KIND: Record<string, ProjectTarget['kind']> = {
  'com.apple.product-type.application': 'app',
  'com.apple.product-type.application.watchapp2': 'watch',
  'com.apple.product-type.application.watchapp2-container': 'watch',
  'com.apple.product-type.watchkit2-extension': 'watch',
  'com.apple.product-type.app-extension': 'extension',
  'com.apple.product-type.extensionkit-extension': 'extension',
  'com.apple.product-type.application.on-demand-install-capable': 'app-clip',
  'com.apple.product-type.bundle.unit-test': 'unit-tests',
  'com.apple.product-type.bundle.ui-testing': 'ui-tests',
};

function deviceFamilies(settings: Record<string, string>): ProjectTarget['devices'] {
  const fam = settings.TARGETED_DEVICE_FAMILY ?? '';
  const map: Record<string, ProjectTarget['devices'][number]> = { '1': 'iphone', '2': 'ipad', '3': 'tv', '4': 'watch', '6': 'mac', '7': 'vision' };
  const out = fam
    .split(/[,\s]+/)
    .map((x) => map[x.trim()])
    .filter((x): x is ProjectTarget['devices'][number] => Boolean(x));
  if (settings.SUPPORTS_MACCATALYST === 'YES' && !out.includes('mac')) out.push('mac');
  return out;
}

export interface AnalyzeOptions {
  root: string;
  projectHint?: string;
  scheme?: string;
  bundleIdOverride?: string;
}

export async function analyzeProject(opts: AnalyzeOptions): Promise<AppProfile> {
  const { root } = opts;
  const rel = (p: string) => relative(root, p);
  const loc = await locateProject(root, opts.projectHint);
  let xcodeproj = loc.xcodeproj;
  if (!xcodeproj && loc.workspace) {
    // Use the first project referenced by the workspace next to it.
    const siblings = await readdir(dirname(loc.workspace));
    const p = siblings.find((s) => s.endsWith('.xcodeproj'));
    if (p) xcodeproj = join(dirname(loc.workspace), p);
  }
  if (!xcodeproj || !existsSync(join(xcodeproj, 'project.pbxproj'))) {
    throw new Error(`Xcode projesi bulunamadı (${root}). vitrin.config.yaml içinde app.project ile yolu belirt.`);
  }
  const projDir = dirname(xcodeproj);
  const pbx = readPbxproj(await readFile(join(xcodeproj, 'project.pbxproj'), 'utf8'));
  const srcRoot = projDir;

  const extra = { SRCROOT: srcRoot, PROJECT_DIR: srcRoot, PROJECT_NAME: basename(xcodeproj, '.xcodeproj') };
  const targets: ProjectTarget[] = [];
  const pbxByName = new Map<string, PbxTarget>();
  for (const t of pbx.targets) {
    pbxByName.set(t.name, t);
    const s = settingsOf(t);
    const kind = PRODUCT_KIND[t.productType] ?? 'other';
    const isWidget = kind === 'extension' && /widget/i.test(t.name + (s.PRODUCT_BUNDLE_IDENTIFIER ?? ''));
    targets.push({
      name: t.name,
      kind: isWidget ? 'widget' : kind,
      productType: t.productType,
      bundleId: s.PRODUCT_BUNDLE_IDENTIFIER ? expandSetting(s.PRODUCT_BUNDLE_IDENTIFIER, s, { ...extra, PRODUCT_NAME: t.productName ?? t.name, TARGET_NAME: t.name }) : undefined,
      deploymentTarget: s.IPHONEOS_DEPLOYMENT_TARGET,
      devices: deviceFamilies(s),
      infoPlist: s.INFOPLIST_FILE ? expandSetting(s.INFOPLIST_FILE, s, extra) : undefined,
      entitlements: s.CODE_SIGN_ENTITLEMENTS ? expandSetting(s.CODE_SIGN_ENTITLEMENTS, s, extra) : undefined,
    });
  }

  const appTargets = targets.filter((t) => t.kind === 'app');
  const main =
    appTargets.find((t) => t.name === opts.scheme) ??
    appTargets.find((t) => t.bundleId && opts.bundleIdOverride && t.bundleId === opts.bundleIdOverride) ??
    appTargets[0];
  if (!main) throw new Error('Projede uygulama hedefi (com.apple.product-type.application) bulunamadı.');
  const mainPbx = pbxByName.get(main.name)!;
  const ms = settingsOf(mainPbx);

  // ---------- Info.plist & permissions ----------
  const todo: string[] = [];
  const features: Feature[] = [];
  const signals: Record<string, Evidence[]> = {};
  const addSignal = (key: string, ev: Evidence) => {
    (signals[key] ??= []).push(ev);
  };
  const addFeature = (f: Omit<Feature, 'source' | 'confidence'> & { confidence?: Feature['confidence'] }) => {
    const existing = features.find((x) => x.id === f.id);
    if (existing) {
      for (const ev of f.evidence) if (existing.evidence.length < 5) existing.evidence.push(ev);
      return;
    }
    features.push({ confidence: 'high', source: 'analyzer', ...f });
  };

  let info: Record<string, unknown> = {};
  const infoPath = main.infoPlist ? resolveIn(srcRoot, main.infoPlist) : undefined;
  if (infoPath && existsSync(infoPath)) info = await readPlistFile(infoPath);
  // GENERATE_INFOPLIST_FILE: keys live in build settings as INFOPLIST_KEY_*
  for (const [k, v] of Object.entries(ms)) {
    if (k.startsWith('INFOPLIST_KEY_')) info[k.slice('INFOPLIST_KEY_'.length)] ??= v;
  }
  const infoEvidencePath = infoPath ? rel(infoPath) : rel(join(xcodeproj, 'project.pbxproj'));
  const displayName = String(
    info.CFBundleDisplayName ?? expandSetting(String(info.CFBundleName ?? ms.PRODUCT_NAME ?? main.name), ms, { ...extra, PRODUCT_NAME: mainPbx.productName ?? main.name, TARGET_NAME: main.name }),
  );
  const permissions = Object.entries(info)
    .filter(([k]) => /^NS[A-Za-z]+UsageDescription$/.test(k))
    .map(([key, description]) => ({ key, description: String(description) }));
  if (info.UIBackgroundModes) addSignal('background.modes', { path: infoEvidencePath, note: String(info.UIBackgroundModes) });

  // ---------- Entitlements ----------
  const entitlements: string[] = [];
  for (const t of targets) {
    if (!t.entitlements) continue;
    const p = resolveIn(srcRoot, t.entitlements);
    if (!existsSync(p)) continue;
    const ent = await readPlistFile(p);
    for (const [k, v] of Object.entries(ent)) {
      if (!entitlements.includes(k)) entitlements.push(k);
      const ev = { path: rel(p), note: k };
      if (k === 'com.apple.developer.healthkit') addFeature({ id: 'apple-health', title: 'Apple Health entegrasyonu', kind: 'integration', description: 'HealthKit izni ile sağlık verisi okur/yazar.', evidence: [ev] });
      if (k === 'com.apple.developer.icloud-services' && Array.isArray(v) && v.length) addFeature({ id: 'icloud-sync', title: 'iCloud senkronizasyonu', kind: 'capability', description: 'Veriler iCloud ile cihazlar arasında eşitlenir.', evidence: [ev] });
      if (k === 'com.apple.developer.applesignin') addFeature({ id: 'sign-in-with-apple', title: 'Apple ile Giriş', kind: 'capability', description: 'Apple ile Giriş desteği.', evidence: [ev] });
      if (k === 'aps-environment') addSignal('push.remote', ev);
      if (k === 'com.apple.developer.family-controls') addSignal('age.family-controls', ev);
    }
  }

  // ---------- Platform features from targets ----------
  const supportsIPad = main.devices.includes('ipad');
  if (supportsIPad) addFeature({ id: 'ipad', title: 'iPad desteği', kind: 'platform', description: 'iPad için uyarlanmış arayüz.', evidence: [{ path: rel(join(xcodeproj, 'project.pbxproj')), note: `TARGETED_DEVICE_FAMILY=${ms.TARGETED_DEVICE_FAMILY}` }] });
  for (const t of targets) {
    const ev = { path: rel(join(xcodeproj, 'project.pbxproj')), note: `${t.name} (${t.productType})` };
    if (t.kind === 'widget') addFeature({ id: 'widgets', title: 'Ana ekran widget’ları', kind: 'platform', description: 'Ana ekran ve kilit ekranı widget’ları.', evidence: [ev] });
    if (t.kind === 'watch') addFeature({ id: 'apple-watch', title: 'Apple Watch uygulaması', kind: 'platform', description: 'Apple Watch için ayrı uygulama.', evidence: [ev] });
    if (t.kind === 'app-clip') addFeature({ id: 'app-clip', title: 'App Clip', kind: 'platform', description: 'İndirmeden hızlı deneme.', evidence: [ev] });
  }

  // ---------- Source scan ----------
  const allFiles = await listFiles(srcRoot);
  const swiftFiles = allFiles.filter((f) => f.endsWith('.swift'));
  const appIntents: AppProfile['appIntents'] = [];
  const categoryVotes = new Map<string, number>();
  for (const f of swiftFiles) {
    const text = await readFile(f, 'utf8');
    for (const hit of scanSource(rel(f), text)) {
      if (hit.rule.feature) addFeature({ ...hit.rule.feature, evidence: [hit.evidence] });
      if (hit.rule.signal) addSignal(hit.rule.signal, hit.evidence);
      if (hit.rule.category) categoryVotes.set(hit.rule.category, (categoryVotes.get(hit.rule.category) ?? 0) + 1);
    }
    for (const m of text.matchAll(/(?:struct|class)\s+(\w+)\s*:\s*[^{]*\bAppIntent\b/g)) appIntents.push({ name: m[1]!, file: rel(f) });
    if (/AppShortcutsProvider/.test(text)) addSignal('intents.app-shortcuts', { path: rel(f) });
  }
  if (appIntents.length) {
    addFeature({
      id: 'siri-shortcuts',
      title: 'Siri ve Kestirmeler',
      kind: 'integration',
      description: `App Intents: ${appIntents.map((a) => a.name).slice(0, 5).join(', ')}`,
      evidence: appIntents.slice(0, 3).map((a) => ({ path: a.file, note: a.name })),
    });
  }

  // ---------- StoreKit configuration ----------
  const iap: AppProfile['iap'] = [];
  for (const f of allFiles.filter((x) => x.endsWith('.storekit'))) {
    try {
      const sk = JSON.parse(await readFile(f, 'utf8')) as StoreKitFile;
      for (const p of sk.products ?? []) iap.push({ productId: p.productID, type: p.type ?? 'NonConsumable', displayName: p.localizations?.[0]?.displayName, file: rel(f) });
      for (const p of sk.nonRenewingSubscriptions ?? []) iap.push({ productId: p.productID, type: 'NonRenewingSubscription', displayName: p.localizations?.[0]?.displayName, file: rel(f) });
      for (const g of sk.subscriptionGroups ?? []) {
        for (const p of g.subscriptions ?? []) iap.push({ productId: p.productID, type: 'AutoRenewableSubscription', displayName: p.localizations?.[0]?.displayName, file: rel(f) });
      }
    } catch {
      todo.push(`${rel(f)} okunamadı (StoreKit yapılandırması).`);
    }
  }
  const hasSubs = iap.some((p) => /Subscription/i.test(p.type));
  const revenueModel: AppProfile['revenueModel'] = hasSubs ? 'subscription' : iap.length ? 'freemium' : signals['monetization.ads'] ? 'free' : 'unknown';
  if (iap.length) {
    addFeature({
      id: hasSubs ? 'premium-subscription' : 'in-app-purchases',
      title: hasSubs ? 'Premium abonelik' : 'Uygulama içi satın alma',
      kind: 'monetization',
      description: iap.map((p) => p.displayName ?? p.productId).join(', '),
      evidence: [{ path: iap[0]!.file }],
    });
  }

  // ---------- Localizations ----------
  const regions = new Set(pbx.knownRegions.filter((r) => r !== 'Base'));
  const xcstrings = allFiles.filter((f) => f.endsWith('.xcstrings'));
  for (const f of xcstrings) {
    try {
      const json = JSON.parse(await readFile(f, 'utf8')) as { sourceLanguage?: string; strings?: Record<string, { localizations?: Record<string, unknown> }> };
      if (json.sourceLanguage) regions.add(json.sourceLanguage);
      for (const s of Object.values(json.strings ?? {})) for (const l of Object.keys(s.localizations ?? {})) regions.add(l);
    } catch {
      todo.push(`${rel(f)} okunamadı (String Catalog).`);
    }
  }
  for (const f of allFiles) {
    const m = /\/([A-Za-z-]+)\.lproj\//.exec(f);
    if (m && m[1] !== 'Base') regions.add(m[1]!);
  }
  const locales = [...regions].sort().map((r) => ({ xcode: r, asc: xcodeToAsc(r) }));
  for (const l of locales) if (!l.asc) todo.push(`Xcode bölgesi "${l.xcode}" için ASC dili yok; metadata bu dilde yazılamaz.`);
  if (locales.length > 1) {
    addFeature({
      id: 'localization',
      title: `${locales.length} dil desteği`,
      kind: 'core',
      description: locales.map((l) => l.xcode).join(', '),
      evidence: [{ path: xcstrings[0] ? rel(xcstrings[0]) : rel(join(xcodeproj, 'project.pbxproj')), note: 'knownRegions / String Catalog' }],
    });
  }

  // ---------- Assets ----------
  const catalogs = allFiles
    .map((f) => /^(.*?\.xcassets)\//.exec(f)?.[1])
    .filter((x): x is string => Boolean(x));
  const catalogScan = await scanAssetCatalogs([...new Set(catalogs)]);

  // ---------- Docs & git ----------
  const readme = await readExcerpt(root, ['README.md', 'Readme.md', 'readme.md']);
  const changelog = await readExcerpt(root, ['CHANGELOG.md', 'Changelog.md', 'CHANGES.md']);
  const { lastTag, commits } = await gitHistory(root);

  // ---------- Category ----------
  const voted = [...categoryVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  const categorySuggestion = voted
    ? { primary: voted[0], reason: `Kod sinyali: ${voted[0]} çerçeveleri (${voted[1]} dosya).` }
    : { primary: 'PRODUCTIVITY', reason: 'Belirgin çerçeve sinyali yok; Claude uygulama işlevine göre doğrulamalı.' };
  if (!voted) todo.push('Kategori önerisi zayıf; Claude app_profile.categorySuggestion alanını işleve göre düzeltmeli.');

  if (!features.some((f) => f.kind === 'core')) {
    todo.push('Çekirdek özellik bulunamadı. Claude kaynak kodu okuyup ana ekranlar için kanıtlı özellikler eklemeli (source: "claude").');
  }
  todo.push('positioning (hedef kitle, kullanıcının işi, ton) Claude tarafından doldurulmalı.');
  if (!signals['vitrin.demo-mode']) {
    todo.push('Uygulamada -VitrinDemo seed veri modu yok. capture için kullanıcıya hangi dosyaya ekleneceği gösterilmeli (skill/references/troubleshooting.md).');
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {
      root,
      xcodeproj: rel(xcodeproj),
      workspace: loc.workspace ? rel(loc.workspace) : undefined,
      scheme: opts.scheme ?? main.name,
      targets,
    },
    app: {
      displayName,
      bundleId: opts.bundleIdOverride ?? main.bundleId,
      version: ms.MARKETING_VERSION ?? (info.CFBundleShortVersionString as string | undefined),
      build: ms.CURRENT_PROJECT_VERSION ?? (info.CFBundleVersion as string | undefined),
      deploymentTarget: main.deploymentTarget,
      supportsIPhone: main.devices.includes('iphone') || main.devices.length === 0,
      supportsIPad,
      developmentRegion: pbx.developmentRegion,
      knownRegions: pbx.knownRegions,
      locales,
    },
    features,
    entitlements,
    permissions,
    iap,
    appIntents,
    brand: {
      accentColor: catalogScan.accentColor,
      colors: catalogScan.colors.map(({ name, hex }) => ({ name, hex })),
      appIcon: catalogScan.appIcon ? rel(catalogScan.appIcon) : undefined,
    },
    revenueModel,
    categorySuggestion,
    docs: { readme, changelog, lastTag, commitsSinceTag: commits },
    signals,
    todo,
  };
}

interface StoreKitProduct {
  productID: string;
  type?: string;
  localizations?: Array<{ displayName?: string }>;
}
interface StoreKitFile {
  products?: StoreKitProduct[];
  nonRenewingSubscriptions?: StoreKitProduct[];
  subscriptionGroups?: Array<{ subscriptions?: StoreKitProduct[] }>;
}

function resolveIn(base: string, p: string): string {
  return p.startsWith('/') ? p : join(base, p);
}

async function readExcerpt(root: string, names: string[]): Promise<string | undefined> {
  for (const n of names) {
    const p = join(root, n);
    if (existsSync(p)) return (await readFile(p, 'utf8')).slice(0, 6000);
  }
  return undefined;
}

export async function gitHistory(root: string): Promise<{ lastTag?: string; commits: Array<{ hash: string; subject: string }> }> {
  const tag = await exec('git', ['describe', '--tags', '--abbrev=0'], { cwd: root });
  const lastTag = tag.code === 0 ? tag.stdout.trim() : undefined;
  const range = lastTag ? [`${lastTag}..HEAD`] : ['-n', '40'];
  const log = await exec('git', ['log', '--no-merges', '--pretty=format:%h\t%s', ...range], { cwd: root });
  const commits =
    log.code === 0
      ? log.stdout
          .split('\n')
          .filter(Boolean)
          .slice(0, 80)
          .map((l) => {
            const [hash, ...rest] = l.split('\t');
            return { hash: hash!, subject: rest.join('\t') };
          })
      : [];
  return { lastTag, commits };
}


