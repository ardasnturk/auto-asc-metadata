import { exec, existsSync, listFiles, xcodeToAsc } from '@vitrin/core';
import type { AppProfile, Evidence, Feature, Platform, ProjectTarget } from '@vitrin/schemas';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { scanAssetCatalogs } from './assets.js';
import { detectFramework, readAndroidProject } from './framework.js';
import { expandSetting, readPbxproj, settingsOf, type PbxProject, type PbxTarget } from './pbxproj.js';
import { detectDuo, deviceFamilies, sortPlatforms, targetPlatforms } from './platforms.js';
import { readPlistFile } from './plist-file.js';
import { CROSS_PLATFORM_RULES, scanSource } from './signals.js';

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

/** Platform → device name, so `targets[].devices` also covers SDKROOT-only targets (macOS, tvOS, watchOS, visionOS). */
const PLATFORM_DEVICE: Partial<Record<Platform, ProjectTarget['devices'][number]>> = { macos: 'mac', tvos: 'tv', watchos: 'watch', visionos: 'vision' };

/** Product types whose platforms count as "the app ships here" (not extensions, tests or the watch container stub). */
const SHIPPING = new Set(['com.apple.product-type.application', 'com.apple.product-type.application.watchapp2']);

export interface AnalyzeOptions {
  root: string;
  projectHint?: string;
  scheme?: string;
  bundleIdOverride?: string;
}

/** Literal build setting / plist value, or undefined when it is empty or still references a variable. */
function literal(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() && !v.includes('$') ? v.trim() : undefined;
}

const SKIP_DIRS = ['node_modules', '.git', 'DerivedData', 'build', '.build', 'Pods', '.vitrin', 'fastlane', '.dart_tool', '.gradle', '.expo'];

export async function analyzeProject(opts: AnalyzeOptions): Promise<AppProfile> {
  const { root } = opts;
  const rel = (p: string) => relative(root, p) || '.';
  const fw = await detectFramework(root);

  // ---------- Xcode host project ----------
  // Native: anywhere under root (depth ≤ 3). Frameworks: inside their iOS folder only, so Pods/ or
  // node_modules projects are never mistaken for the app.
  const iosBase = fw.kind === 'native' ? root : fw.iosDir ? join(root, fw.iosDir) : undefined;
  const loc: ProjectLocation = opts.projectHint ? await locateProject(root, opts.projectHint) : iosBase && existsSync(iosBase) ? await locateProject(iosBase) : {};
  let xcodeproj = loc.xcodeproj;
  if (!xcodeproj && loc.workspace) {
    // Use the first project referenced by the workspace next to it.
    const siblings = await readdir(dirname(loc.workspace));
    const p = siblings.find((s) => s.endsWith('.xcodeproj'));
    if (p) xcodeproj = join(dirname(loc.workspace), p);
  }
  if (xcodeproj && !existsSync(join(xcodeproj, 'project.pbxproj'))) xcodeproj = undefined;
  const expoWithoutIos = fw.kind === 'expo' && fw.platforms.some((p) => p.platform === 'ios');
  if (!xcodeproj && !fw.androidDir && !expoWithoutIos) {
    throw new Error(`No Xcode project or Android app found (${root}). Set its path with app.project in vitrin.config.yaml.`);
  }

  // ---------- Collectors ----------
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
  const platformEvidence = new Map<Platform, Evidence>();
  const addPlatform = (p: Platform, ev: Evidence) => {
    if (!platformEvidence.has(p)) platformEvidence.set(p, ev);
  };

  const targets: ProjectTarget[] = [];
  let main: ProjectTarget | undefined;
  let ms: Record<string, string> = {};
  let info: Record<string, unknown> = {};
  let pbx: PbxProject | undefined;
  let xcodeDisplayName: string | undefined;
  let srcRoot: string | undefined;
  let pbxPath = '';
  const entitlements: string[] = [];
  let permissions: AppProfile['permissions'] = [];

  if (xcodeproj) {
    const projDir = dirname(xcodeproj);
    pbxPath = rel(join(xcodeproj, 'project.pbxproj'));
    pbx = readPbxproj(await readFile(join(xcodeproj, 'project.pbxproj'), 'utf8'));
    srcRoot = projDir;

    const extra = { SRCROOT: srcRoot, PROJECT_DIR: srcRoot, PROJECT_NAME: basename(xcodeproj, '.xcodeproj') };
    const pbxByName = new Map<string, PbxTarget>();
    for (const t of pbx.targets) {
      pbxByName.set(t.name, t);
      const s = settingsOf(t);
      let kind = PRODUCT_KIND[t.productType] ?? 'other';
      const isWidget = kind === 'extension' && /widget/i.test(t.name + (s.PRODUCT_BUNDLE_IDENTIFIER ?? ''));
      const { platforms, macCatalyst } = targetPlatforms(s, t.productType);
      // A single-target watchOS app (Xcode 14+) is an `application` built with SDKROOT=watchos.
      if (kind === 'app' && platforms.length === 1 && platforms[0] === 'watchos') kind = 'watch';
      const devices = deviceFamilies(s);
      for (const p of platforms) {
        const d = PLATFORM_DEVICE[p];
        if (d && !devices.includes(d)) devices.push(d);
      }
      const target: ProjectTarget = {
        name: t.name,
        kind: isWidget ? 'widget' : kind,
        productType: t.productType,
        bundleId: s.PRODUCT_BUNDLE_IDENTIFIER ? expandSetting(s.PRODUCT_BUNDLE_IDENTIFIER, s, { ...extra, PRODUCT_NAME: t.productName ?? t.name, TARGET_NAME: t.name }) : undefined,
        deploymentTarget: s.IPHONEOS_DEPLOYMENT_TARGET ?? s.MACOSX_DEPLOYMENT_TARGET ?? s.WATCHOS_DEPLOYMENT_TARGET ?? s.TVOS_DEPLOYMENT_TARGET ?? s.XROS_DEPLOYMENT_TARGET,
        devices,
        platforms,
        macCatalyst,
        infoPlist: s.INFOPLIST_FILE ? expandSetting(s.INFOPLIST_FILE, s, extra) : undefined,
        entitlements: s.CODE_SIGN_ENTITLEMENTS ? expandSetting(s.CODE_SIGN_ENTITLEMENTS, s, extra) : undefined,
      };
      targets.push(target);
      if (SHIPPING.has(t.productType)) {
        for (const p of platforms) {
          const why = p === 'macos' && macCatalyst ? 'SUPPORTS_MACCATALYST=YES' : `SDKROOT=${s.SDKROOT ?? '(default)'}${s.SUPPORTED_PLATFORMS ? `, SUPPORTED_PLATFORMS=${s.SUPPORTED_PLATFORMS}` : ''}${s.TARGETED_DEVICE_FAMILY ? `, TARGETED_DEVICE_FAMILY=${s.TARGETED_DEVICE_FAMILY}` : ''}`;
          addPlatform(p, { path: pbxPath, note: `${t.name}: ${why}` });
        }
      }
    }

    const appTargets = targets.filter((t) => t.kind === 'app');
    const candidates = appTargets.length ? appTargets : targets.filter((t) => t.kind === 'watch' && t.platforms.includes('watchos'));
    main =
      candidates.find((t) => t.name === opts.scheme) ??
      candidates.find((t) => t.bundleId && opts.bundleIdOverride && t.bundleId === opts.bundleIdOverride) ??
      candidates.find((t) => t.platforms.includes('ios')) ??
      candidates[0];
    if (!main) throw new Error('No app target (com.apple.product-type.application) found in the project.');
    const mainPbx = pbxByName.get(main.name)!;
    ms = settingsOf(mainPbx);

    // ---------- Info.plist & permissions ----------
    const infoPath = main.infoPlist ? resolveIn(srcRoot, main.infoPlist) : undefined;
    if (infoPath && existsSync(infoPath)) info = await readPlistFile(infoPath);
    // GENERATE_INFOPLIST_FILE: keys live in build settings as INFOPLIST_KEY_*
    for (const [k, v] of Object.entries(ms)) {
      if (k.startsWith('INFOPLIST_KEY_')) info[k.slice('INFOPLIST_KEY_'.length)] ??= v;
    }
    const infoEvidencePath = infoPath ? rel(infoPath) : pbxPath;
    const expanded = String(
      info.CFBundleDisplayName ?? expandSetting(String(info.CFBundleName ?? ms.PRODUCT_NAME ?? main.name), ms, { ...extra, PRODUCT_NAME: mainPbx.productName ?? main.name, TARGET_NAME: main.name }),
    );
    // Flutter and React Native Info.plists may still reference build variables here.
    xcodeDisplayName = expanded.trim() && !expanded.includes('$') ? expanded.trim() : undefined;
    permissions = Object.entries(info)
      .filter(([k]) => /^NS[A-Za-z]+UsageDescription$/.test(k))
      .map(([key, description]) => ({ key, description: String(description) }));
    if (info.UIBackgroundModes) addSignal('background.modes', { path: infoEvidencePath, note: String(info.UIBackgroundModes) });

    // ---------- Entitlements ----------
    for (const t of targets) {
      if (!t.entitlements) continue;
      const p = resolveIn(srcRoot, t.entitlements);
      if (!existsSync(p)) continue;
      const ent = await readPlistFile(p);
      for (const [k, v] of Object.entries(ent)) {
        if (!entitlements.includes(k)) entitlements.push(k);
        const ev = { path: rel(p), note: k };
        if (k === 'com.apple.developer.healthkit') addFeature({ id: 'apple-health', title: 'Apple Health integration', kind: 'integration', description: 'Reads and writes health data with HealthKit permission.', evidence: [ev] });
        if (k === 'com.apple.developer.icloud-services' && Array.isArray(v) && v.length) addFeature({ id: 'icloud-sync', title: 'iCloud sync', kind: 'capability', description: 'Data syncs across devices via iCloud.', evidence: [ev] });
        if (k === 'com.apple.developer.applesignin') addFeature({ id: 'sign-in-with-apple', title: 'Sign in with Apple', kind: 'capability', description: 'Supports Sign in with Apple.', evidence: [ev] });
        if (k === 'aps-environment') addSignal('push.remote', ev);
        if (k === 'com.apple.developer.family-controls') addSignal('age.family-controls', ev);
      }
    }

    // ---------- Platform features from targets ----------
    if (main.devices.includes('ipad')) addFeature({ id: 'ipad', title: 'iPad support', kind: 'platform', description: 'Interface adapted for iPad.', evidence: [{ path: pbxPath, note: `TARGETED_DEVICE_FAMILY=${ms.TARGETED_DEVICE_FAMILY}` }] });
    for (const t of targets) {
      const ev = { path: pbxPath, note: `${t.name} (${t.productType})` };
      if (t.kind === 'widget') addFeature({ id: 'widgets', title: 'Home Screen widgets', kind: 'platform', description: 'Home Screen and Lock Screen widgets.', evidence: [ev] });
      if (t.kind === 'watch') addFeature({ id: 'apple-watch', title: 'Apple Watch app', kind: 'platform', description: 'A dedicated Apple Watch app.', evidence: [ev] });
      if (t.kind === 'app-clip') addFeature({ id: 'app-clip', title: 'App Clip', kind: 'platform', description: 'Try it quickly without downloading the full app.', evidence: [ev] });
    }
  }

  // ---------- Framework-declared platforms (Flutter macos/, Expo platforms, Android) ----------
  const android = fw.androidDir && existsSync(join(root, fw.androidDir)) ? await readAndroidProject(root, fw.androidDir) : undefined;
  if (android) addPlatform('android', { path: android.manifest, note: `Gradle module :${android.module}` });
  for (const p of fw.platforms) {
    // With an Xcode project, iOS is decided by its targets (an iPad-only or Mac-only host must not gain iPhone).
    if (p.platform === 'ios' && xcodeproj) continue;
    addPlatform(p.platform, p.evidence);
  }
  const platforms = sortPlatforms(platformEvidence.keys());

  const featureFor: Partial<Record<Platform, { id: string; title: string; description: string }>> = {
    macos: { id: 'mac-app', title: 'Mac app', description: main?.macCatalyst ? 'Runs on the Mac (Mac Catalyst).' : 'A native Mac app.' },
    tvos: { id: 'apple-tv', title: 'Apple TV app', description: 'An app for Apple TV.' },
    visionos: { id: 'vision-pro', title: 'Apple Vision Pro app', description: 'A native visionOS app.' },
    android: { id: 'android-app', title: 'Android app', description: 'Also available on Android (Google Play).' },
  };
  for (const p of platforms) {
    const f = featureFor[p];
    if (f) addFeature({ ...f, kind: 'platform', evidence: [platformEvidence.get(p)!] });
  }

  // ---------- Device support ----------
  const shipsIos = platforms.includes('ios');
  const supportsIPhone = main ? main.platforms.includes('ios') && (main.devices.includes('iphone') || !main.devices.includes('ipad')) : shipsIos;
  const supportsIPad = main ? main.devices.includes('ipad') : shipsIos && Boolean(fw.supportsTablet?.value);
  if (!main && supportsIPad) addFeature({ id: 'ipad', title: 'iPad support', kind: 'platform', description: 'Interface adapted for iPad.', evidence: [{ path: fw.supportsTablet!.path, note: 'ios.supportsTablet' }] });
  const duo = pbx && main ? detectDuo({ supportsIPhone, attributes: pbx.attributes, deploymentTarget: main.deploymentTarget, pbxprojPath: pbxPath }) : { supported: false, reason: 'No Xcode project yet.' };
  if (duo.supported) addFeature({ id: 'iphone-duo', title: 'iPhone Duo', kind: 'platform', description: 'Built with the iOS 27.1 SDK, which lays the app out for both iPhone Duo displays.', evidence: [duo.evidence!], confidence: 'medium' });
  else if (supportsIPhone) todo.push(`iPhone Duo targets are off: ${duo.reason} If the app is built with Xcode 27.1+, add duo-outer and duo-inner to targets.enable in vitrin.config.yaml.`);
  const supportsAndroidTablet = Boolean(android?.tablet);

  // ---------- Source scan ----------
  const allFiles = srcRoot ? await listFiles(srcRoot) : [];
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
  // Dart / JS / Kotlin sources of cross-platform and Android apps.
  for (const f of await crossPlatformSources(root, fw.kind, android ? join(root, android.dir, android.module) : undefined)) {
    const text = await readFile(f, 'utf8');
    for (const hit of scanSource(rel(f), text, CROSS_PLATFORM_RULES)) {
      if (hit.rule.feature) addFeature({ ...hit.rule.feature, evidence: [hit.evidence] });
      if (hit.rule.signal) addSignal(hit.rule.signal, hit.evidence);
      if (hit.rule.category) categoryVotes.set(hit.rule.category, (categoryVotes.get(hit.rule.category) ?? 0) + 1);
    }
  }
  if (appIntents.length) {
    addFeature({
      id: 'siri-shortcuts',
      title: 'Siri and Shortcuts',
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
      todo.push(`Could not read ${rel(f)} (StoreKit configuration).`);
    }
  }
  const hasSubs = iap.some((p) => /Subscription/i.test(p.type));
  const revenueModel: AppProfile['revenueModel'] = hasSubs ? 'subscription' : iap.length ? 'freemium' : signals['monetization.ads'] ? 'free' : 'unknown';
  if (iap.length) {
    addFeature({
      id: hasSubs ? 'premium-subscription' : 'in-app-purchases',
      title: hasSubs ? 'Premium subscription' : 'In-app purchases',
      kind: 'monetization',
      description: iap.map((p) => p.displayName ?? p.productId).join(', '),
      evidence: [{ path: iap[0]!.file }],
    });
  }

  // ---------- Localizations ----------
  const regions = new Set((pbx?.knownRegions ?? []).filter((r) => r !== 'Base'));
  const localeEvidence: string[] = [];
  const xcstrings = allFiles.filter((f) => f.endsWith('.xcstrings'));
  for (const f of xcstrings) {
    try {
      const json = JSON.parse(await readFile(f, 'utf8')) as { sourceLanguage?: string; strings?: Record<string, { localizations?: Record<string, unknown> }> };
      if (json.sourceLanguage) regions.add(json.sourceLanguage);
      for (const s of Object.values(json.strings ?? {})) for (const l of Object.keys(s.localizations ?? {})) regions.add(l);
      localeEvidence.push(rel(f));
    } catch {
      todo.push(`Could not read ${rel(f)} (String Catalog).`);
    }
  }
  for (const f of allFiles) {
    const m = /\/([A-Za-z-]+)\.lproj\//.exec(f);
    if (m && m[1] !== 'Base') regions.add(m[1]!);
  }
  // Flutter documents CFBundleLocalizations as the way to declare iOS languages.
  if (Array.isArray(info.CFBundleLocalizations)) for (const l of info.CFBundleLocalizations) if (typeof l === 'string') regions.add(l);
  for (const l of [...fw.locales, ...(android?.locales ?? [])]) {
    regions.add(l.code);
    localeEvidence.push(l.path);
  }
  if (!regions.size && android) todo.push('Android resources have no language qualifiers (values-xx); set app.locales in vitrin.config.yaml.');
  const locales = [...regions].sort().map((r) => ({ xcode: r, asc: xcodeToAsc(r) }));
  for (const l of locales) if (!l.asc) todo.push(`Region "${l.xcode}" has no ASC locale; metadata cannot be written in this language.`);
  if (locales.length > 1) {
    addFeature({
      id: 'localization',
      title: `${locales.length} languages`,
      kind: 'core',
      description: locales.map((l) => l.xcode).join(', '),
      evidence: [{ path: localeEvidence[0] ?? (pbxPath || 'package.json'), note: 'knownRegions / String Catalog / framework translations' }],
    });
  }

  // ---------- Assets ----------
  const catalogs = allFiles
    .map((f) => /^(.*?\.xcassets)\//.exec(f)?.[1])
    .filter((x): x is string => Boolean(x));
  const catalogScan = await scanAssetCatalogs([...new Set(catalogs)]);
  const androidIcon = android ? ['xxxhdpi', 'xxhdpi', 'xhdpi'].map((d) => join(root, android.dir, android.module, 'src', 'main', 'res', `mipmap-${d}`, 'ic_launcher.png')).find((p) => existsSync(p)) : undefined;

  // ---------- Docs & git ----------
  const readme = await readExcerpt(root, ['README.md', 'Readme.md', 'readme.md']);
  const changelog = await readExcerpt(root, ['CHANGELOG.md', 'Changelog.md', 'CHANGES.md']);
  const { lastTag, commits } = await gitHistory(root);

  // ---------- Category ----------
  const voted = [...categoryVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  const categorySuggestion = voted
    ? { primary: voted[0], reason: `Code signal: ${voted[0]} frameworks (${voted[1]} files).` }
    : { primary: 'PRODUCTIVITY', reason: 'No clear framework signal; Claude should verify based on what the app does.' };
  if (!voted) todo.push('Weak category suggestion; Claude should correct app_profile.categorySuggestion based on what the app does.');

  if (!features.some((f) => f.kind === 'core')) {
    todo.push('No core features found. Claude should read the source code and add evidence-backed features for the main screens (source: "claude").');
  }
  todo.push('positioning (audience, user job, tone) must be filled in by Claude.');
  if (!signals['vitrin.demo-mode']) {
    todo.push('The app has no -VitrinDemo seed-data mode. For capture, show the user which file to add it to (the /vitrin skill’s references/troubleshooting.md).');
  }
  if (fw.needsPrebuild) {
    todo.push('Expo app without native folders: capture runs `npx expo prebuild` first (capture.reactNative.prebuild), which creates ios/ and android/.');
  }
  if (platforms.includes('android') && !(android?.applicationId ?? fw.androidApplicationId)) {
    todo.push('Android applicationId not found (build.gradle applicationId / app.json expo.android.package).');
  }

  // ---------- Identity: Xcode first, then framework files ----------
  const frameworkName = fw.displayName?.value;
  const displayName =
    (fw.kind === 'expo' ? (frameworkName ?? xcodeDisplayName) : (xcodeDisplayName ?? android?.label?.value ?? frameworkName)) ?? android?.label?.value ?? basename(root);
  const version = literal(ms.MARKETING_VERSION) ?? literal(info.CFBundleShortVersionString) ?? fw.version?.value ?? android?.versionName?.value;
  const build = literal(ms.CURRENT_PROJECT_VERSION) ?? literal(info.CFBundleVersion) ?? fw.build?.value ?? android?.versionCode?.value;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: {
      root,
      kind: fw.kind,
      iosDir: srcRoot ? rel(srcRoot) : fw.iosDir,
      androidDir: android?.dir ?? fw.androidDir,
      androidApplicationId: android?.applicationId?.value ?? fw.androidApplicationId?.value,
      macosDir: fw.macosDir,
      needsPrebuild: fw.needsPrebuild,
      xcodeproj: xcodeproj ? rel(xcodeproj) : undefined,
      workspace: loc.workspace ? rel(loc.workspace) : undefined,
      scheme: opts.scheme ?? main?.name,
      targets,
    },
    app: {
      displayName,
      bundleId: opts.bundleIdOverride ?? main?.bundleId ?? fw.bundleId?.value,
      version,
      build,
      deploymentTarget: main?.deploymentTarget,
      supportsIPhone,
      supportsIPad,
      supportsDuo: duo.supported,
      platforms,
      platformEvidence: Object.fromEntries(platforms.map((p) => [p, [platformEvidence.get(p)!]])),
      supportsAndroidTablet,
      developmentRegion: pbx?.developmentRegion,
      knownRegions: pbx?.knownRegions ?? [],
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
      appIcon: catalogScan.appIcon ? rel(catalogScan.appIcon) : androidIcon ? rel(androidIcon) : undefined,
    },
    revenueModel,
    categorySuggestion,
    docs: { readme, changelog, lastTag, commitsSinceTag: commits },
    signals,
    todo,
  };
}

/** Dart (lib/), JS/TS (outside native folders) and Kotlin/Java (Android module) sources to scan. */
async function crossPlatformSources(root: string, kind: AppProfile['project']['kind'], androidModule?: string): Promise<string[]> {
  const out: string[] = [];
  if (kind === 'flutter' && existsSync(join(root, 'lib'))) out.push(...(await listFiles(join(root, 'lib'))).filter((f) => f.endsWith('.dart')));
  if (kind === 'react-native' || kind === 'expo') {
    const skip = new Set([...SKIP_DIRS, 'ios', 'android', 'macos', 'windows', 'dist', 'web-build', 'coverage', '__tests__']);
    out.push(...(await listFiles(root, { skip, maxDepth: 8 })).filter((f) => /\.(m?[jt]sx?)$/.test(f) && !/\.(test|spec|config)\.[jt]sx?$/.test(f)));
  }
  if (androidModule && existsSync(join(androidModule, 'src'))) {
    out.push(...(await listFiles(join(androidModule, 'src'), { skip: new Set([...SKIP_DIRS, 'test', 'androidTest']) })).filter((f) => /\.(kt|java)$/.test(f)));
  }
  return out;
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


