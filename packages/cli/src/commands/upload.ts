import { existsSync, getTarget, log, readJson, readJsonIfExists, writeJson } from '@vitrin/core';
import { AppMetadata, CppSuggestions, ShotList } from '@vitrin/schemas';
import {
  AscClient,
  AssetLibraryClient,
  buildPlan,
  createCustomProductPage,
  createInAppEvent,
  credentialsFromEnv,
  exportFastlaneMetadata,
  formatPlan,
  readBack,
  runLane,
  type UploadPlan,
} from '@vitrin/upload';
import { validateAll } from '@vitrin/validate';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { bundleIdOf, EXIT, loadProfile, NeedsInput, type Ctx } from '../context.js';
import { missingUploadKeys, runDoctor } from './doctor.js';
import { loadLocaleMetadata, printIssues } from './pipeline.js';

export interface UploadOptions {
  dryRun?: boolean;
  yes?: boolean;
  uploader?: 'deliver' | 'asset-library';
  creatives?: boolean;
  cpp?: boolean;
  events?: boolean;
  skipScreenshots?: boolean;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} (evet/hayır) `)).trim().toLowerCase();
  rl.close();
  return ['evet', 'e', 'yes', 'y'].includes(answer);
}

export async function uploadCommand(ctx: Ctx, opts: UploadOptions): Promise<number> {
  if (opts.uploader) ctx.config.upload.uploader = opts.uploader;
  const profile = await loadProfile(ctx);
  const bundleId = bundleIdOf(ctx, profile);
  const metadata = await loadLocaleMetadata(ctx);
  if (!existsSync(ctx.paths.appMetadata) || metadata.length !== ctx.config.app.locales.length) throw new NeedsInput('Metadata eksik; önce `vitrin write`.');
  const app = await readJson(ctx.paths.appMetadata, AppMetadata);

  const validation = await validateAll(ctx.paths, ctx.config);
  if (!validation.ok) {
    printIssues(validation.issues.filter((i) => i.severity === 'error'));
    if (!opts.dryRun) {
      log.error('Doğrulama hataları varken yükleme yapılmaz.');
      return EXIT.FAIL;
    }
    log.warn('Doğrulama hataları var; plan yine de gösteriliyor.');
  }

  // Early warning vs. late gate: a dry run works without keys (remote state unknown); a real upload does not.
  const missing = missingUploadKeys(ctx.env);
  let client: AscClient | undefined;
  if (!missing.length) {
    try {
      client = new AscClient(credentialsFromEnv(process.env));
    } catch (err) {
      if (!opts.dryRun) throw err;
      log.warn((err as Error).message);
    }
  } else if (!opts.dryRun) {
    const doctor = await runDoctor(ctx, { offline: true });
    return doctor.exitCode;
  } else {
    log.warn(`ASC anahtarları eksik (${missing.map((m) => m.name).join(', ')}); plan uzak durumu bilmeden gösteriliyor.`);
  }

  await exportFastlaneMetadata(ctx.paths, ctx.config, app, metadata);
  const shots = await readJsonIfExists(ctx.paths.shots, ShotList).catch(() => undefined);
  const cpp = await readJsonIfExists(ctx.paths.cpp, CppSuggestions).catch(() => undefined);
  const plan = await buildPlan({
    paths: ctx.paths,
    config: ctx.config,
    bundleId,
    metadata,
    shots,
    cpp,
    client,
    include: { creatives: Boolean(opts.creatives), cpp: Boolean(opts.cpp), events: Boolean(opts.events) },
  });
  await writeJson(ctx.paths.uploadPlan, plan);
  log.info('\n' + formatPlan(plan) + '\n');
  if (opts.dryRun) {
    log.ok(`Plan: .vitrin/upload-plan.json (--dry-run, hiçbir şey yüklenmedi)`);
    return plan.blockers.length ? EXIT.NEEDS_INPUT : EXIT.OK;
  }

  // Late gate: full doctor must pass.
  const doctor = await runDoctor(ctx);
  if (doctor.exitCode !== EXIT.OK) {
    log.error('doctor geçmedi; yükleme başlamadı.');
    return doctor.exitCode;
  }
  if (plan.blockers.length) throw new NeedsInput('Yükleme engellendi.', plan.blockers);
  const configured = ctx.config.upload.appVersion;
  if (configured && plan.version && configured !== plan.version.versionString) {
    throw new NeedsInput(`vitrin.config.yaml upload.appVersion (${configured}) ASC’deki düzenlenebilir sürümle (${plan.version.versionString}) aynı değil. Vitrin sürüm adını değiştirmez; config’i düzelt ya da sürümü ASC’de aç.`);
  }
  if (!opts.yes && !(await confirm(pc.bold('Bu plan App Store Connect’e yüklensin mi?')))) {
    throw new NeedsInput('Yükleme için açık onay gerekli: kullanıcı onaylarsa `vitrin upload --yes`.');
  }

  const languages = ctx.config.app.locales;
  if (plan.firstRelease) {
    for (const l of languages) await rm(join(ctx.paths.fastlaneMetadata, l, 'release_notes.txt'), { force: true });
    log.dim('İlk sürüm: “Yenilikler” alanı App Store Connect’te yok, release_notes.txt yüklenmiyor.');
  }
  if (ctx.config.upload.uploader === 'deliver') {
    log.step('fastlane deliver (metin, ekran görüntüleri, App Preview)…');
    await runLane(ctx.paths, 'vitrin_upload', { bundleId, languages, appVersion: plan.version?.versionString, platform: ctx.config.upload.platform, skipScreenshots: opts.skipScreenshots });
  } else {
    log.step('fastlane deliver (yalnız metin) + App Asset Library (görsel/video)…');
    await runLane(ctx.paths, 'vitrin_upload', { bundleId, languages, appVersion: plan.version?.versionString, platform: ctx.config.upload.platform, skipScreenshots: true });
    if (!opts.skipScreenshots) await uploadMediaViaAssetLibrary(ctx, client!, plan);
  }

  if (opts.creatives) await uploadCreatives(ctx, client!, plan);
  if (opts.cpp && cpp) {
    const existing = new Set((await client!.getAll<{ name?: string }>(`/v1/apps/${plan.appId}/appCustomProductPages?limit=200`)).map((p) => p.attributes.name));
    for (const page of cpp.pages) {
      if (existing.has(page.name)) {
        log.dim(`CPP “${page.name}” zaten var; atlandı.`);
        continue;
      }
      const res = await createCustomProductPage(client!, plan.appId!, page, languages);
      log.ok(`CPP “${page.name}” oluşturuldu (${res.pageId}); görseller --creatives akışıyla yerleştirilir, Apple onayı gerekir.`);
    }
  }
  if (opts.events && shots) {
    const existing = new Set((await client!.getAll<{ referenceName?: string }>(`/v1/apps/${plan.appId}/appEvents?limit=200`)).map((e) => e.attributes.referenceName));
    for (const e of shots.creatives.events) {
      if (existing.has(e.id)) {
        log.dim(`In-App Event “${e.id}” zaten var; atlandı.`);
        continue;
      }
      const res = await createInAppEvent(client!, plan.appId!, e, ctx.config.app.primaryLocale, languages);
      log.ok(`In-App Event “${e.id}” taslak olarak oluşturuldu (${res.eventId}).`);
    }
  }

  log.step('ASC’den geri okuma…');
  const diffs = await readBack({ paths: ctx.paths, config: ctx.config, bundleId, metadata, client: client! });
  if (diffs.length) {
    for (const d of diffs) log.warn(d);
    return EXIT.FAIL;
  }
  log.ok('ASC’deki metinler yerel dosyalarla aynı.');
  await ctx.state.mark('upload', plan.generatedAt, [ctx.paths.uploadPlan]);
  log.info('Hatırlatma: gizlilik etiketleri ve yaş anketinin son onayı sende; ABD’de App Store etiketlerini (tags) yükleme sonrası kontrol et.');
  return EXIT.OK;
}

async function uploadMediaViaAssetLibrary(ctx: Ctx, client: AscClient, plan: UploadPlan): Promise<void> {
  const lib = new AssetLibraryClient(client);
  const libraryId = await lib.libraryId(plan.appId!);
  const locs = await client.versionLocalizations(plan.version!.id);
  for (const locale of ctx.config.app.locales) {
    const loc = locs.find((l) => l.attributes.locale === locale);
    if (!loc) {
      log.warn(`${locale}: sürüm yerelleştirmesi yok (önce metin yüklemesi).`);
      continue;
    }
    const owner = { type: 'appStoreVersionLocalizations', id: loc.id };
    // Same semantics as deliver's overwrite_screenshots: the set for each display class is replaced, not appended.
    const groups = new Map<string, { kind: 'image' | 'video'; placement: string; displayClass?: string; files: string[] }>();
    const shotDir = join(ctx.paths.screenshots, locale);
    for (const f of existsSync(shotDir) ? (await readdir(shotDir)).sort() : []) {
      const t = /_([a-z0-9.-]+)\.(png|jpe?g)$/.exec(f)?.[1];
      if (!t) continue;
      const target = getTarget(t);
      const key = `SCREENSHOT:${target.assetLibraryDisplayClass}`;
      const g = groups.get(key) ?? { kind: 'image' as const, placement: 'SCREENSHOT', displayClass: target.assetLibraryDisplayClass, files: [] };
      g.files.push(join(shotDir, f));
      groups.set(key, g);
    }
    const previewDir = join(ctx.paths.appPreviews, locale);
    for (const f of existsSync(previewDir) ? (await readdir(previewDir)).filter((x) => /^\d{2}_[A-Z0-9_]+\.(mp4|mov)$/.test(x)).sort() : []) {
      const target = getTarget(f.includes('IPAD') ? 'preview-ipad' : 'preview-iphone');
      const key = `APP_PREVIEW:${target.assetLibraryDisplayClass}`;
      const g = groups.get(key) ?? { kind: 'video' as const, placement: 'APP_PREVIEW', displayClass: target.assetLibraryDisplayClass, files: [] };
      g.files.push(join(previewDir, f));
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const removed = await lib.clearPlacements(owner, g.placement, g.displayClass);
      if (removed) log.dim(`  ${locale} ${g.placement}/${g.displayClass}: ${removed} eski yerleşim kaldırıldı`);
      const placements: string[] = [];
      for (const file of g.files) {
        const assetId = await lib.upload(libraryId, file, g.kind);
        placements.push(await lib.place(assetId, g.kind, owner, g.placement, g.displayClass));
        log.dim(`  ${locale} ${file.split('/').pop()}`);
      }
      if (placements.length > 1) await lib.order(placements);
    }
  }
}

async function uploadCreatives(ctx: Ctx, client: AscClient, plan: UploadPlan): Promise<void> {
  const lib = new AssetLibraryClient(client);
  const libraryId = await lib.libraryId(plan.appId!);
  const locs = await client.versionLocalizations(plan.version!.id);
  for (const locale of ctx.config.app.locales) {
    const loc = locs.find((l) => l.attributes.locale === locale);
    const dir = join(ctx.paths.creative, locale);
    if (!loc || !existsSync(dir)) continue;
    const cleared = new Set<string>();
    for (const f of (await readdir(dir)).filter((x) => /^(header|search)_.*\.(png|mp4)$/.test(x))) {
      const kind = f.endsWith('.mp4') ? 'video' : 'image';
      const assetId = await lib.upload(libraryId, join(dir, f), kind);
      const placement = f.startsWith('header') ? 'PRODUCT_PAGE_HEADER' : 'SEARCH_RESULT';
      if (!cleared.has(placement)) {
        await lib.clearPlacements({ type: 'appStoreVersionLocalizations', id: loc.id }, placement);
        cleared.add(placement);
      }
      await lib.place(assetId, kind, { type: 'appStoreVersionLocalizations', id: loc.id }, placement);
      log.ok(`${locale} ${f} → ${placement}`);
    }
  }
}

export async function submitCommand(ctx: Ctx, opts: { confirm?: string }): Promise<number> {
  const profile = await loadProfile(ctx);
  const bundleId = bundleIdOf(ctx, profile);
  if (opts.confirm !== bundleId) {
    throw new NeedsInput(`İncelemeye gönderme geri alınması zor bir işlem. Kullanıcı açıkça onaylarsa: \`vitrin submit --confirm ${bundleId}\``);
  }
  const doctor = await runDoctor(ctx);
  if (doctor.exitCode !== EXIT.OK) return doctor.exitCode;
  await runLane(ctx.paths, 'vitrin_submit', { bundleId, languages: ctx.config.app.locales, appVersion: ctx.config.upload.appVersion, platform: ctx.config.upload.platform });
  await ctx.state.mark('submit', new Date().toISOString());
  log.ok('İncelemeye gönderildi.');
  return EXIT.OK;
}
