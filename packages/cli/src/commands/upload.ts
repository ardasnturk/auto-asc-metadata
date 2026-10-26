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
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import { checkApproval, recordUpload, requireApproval } from '../approval.js';
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
  const answer = (await rl.question(`${question} (yes/no) `)).trim().toLowerCase();
  rl.close();
  return ['yes', 'y'].includes(answer);
}

export async function uploadCommand(ctx: Ctx, opts: UploadOptions): Promise<number> {
  if (opts.uploader) ctx.config.upload.uploader = opts.uploader;
  const profile = await loadProfile(ctx);
  const bundleId = bundleIdOf(ctx, profile);
  const metadata = await loadLocaleMetadata(ctx);
  if (!existsSync(ctx.paths.appMetadata) || metadata.length !== ctx.config.app.locales.length) throw new NeedsInput('Metadata is missing; run `vitrin write` first.');
  const app = await readJson(ctx.paths.appMetadata, AppMetadata);
  await exportFastlaneMetadata(ctx.paths, ctx.config, app, metadata);
  // Approval gate: a real upload sends only the exact files the user reviewed and approved (.vitrin/approval.json).
  // Checked after the export so the text files compared are the ones deliver would read. --yes never skips this.
  if (!opts.dryRun) await requireApproval(ctx);
  else {
    const approval = await checkApproval(ctx);
    if (!approval.ok) log.warn(`Not approved for upload yet: ${approval.reason} (a real upload needs \`vitrin review\` + the user's approval).`);
  }

  const validation = await validateAll(ctx.paths, ctx.config);
  if (!validation.ok) {
    printIssues(validation.issues.filter((i) => i.severity === 'error'));
    if (!opts.dryRun) {
      log.error('Not uploading while there are validation errors.');
      return EXIT.FAIL;
    }
    log.warn('There are validation errors; showing the plan anyway.');
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
    log.warn(`ASC keys missing (${missing.map((m) => m.name).join(', ')}); showing the plan without the remote state.`);
  }

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
    log.ok(`Plan: .vitrin/upload-plan.json (--dry-run, nothing was uploaded)`);
    return plan.blockers.length ? EXIT.NEEDS_INPUT : EXIT.OK;
  }

  // Late gate: full doctor must pass.
  const doctor = await runDoctor(ctx);
  if (doctor.exitCode !== EXIT.OK) {
    log.error('doctor did not pass; the upload did not start.');
    return doctor.exitCode;
  }
  if (plan.blockers.length) throw new NeedsInput('Upload blocked.', plan.blockers);
  const configured = ctx.config.upload.appVersion;
  if (configured && plan.version && configured !== plan.version.versionString) {
    throw new NeedsInput(`vitrin.config.yaml upload.appVersion (${configured}) does not match the editable version in ASC (${plan.version.versionString}). Vitrin does not rename versions; fix the config or create the version in ASC.`);
  }
  if (!opts.yes && !(await confirm(pc.bold('Upload this plan to App Store Connect?')))) {
    throw new NeedsInput('Upload needs explicit approval: if the user approves, run `vitrin upload --yes`.');
  }

  // Files may have changed while the plan was built or the prompt was open: check once more right before sending.
  const approved = await requireApproval(ctx);

  const languages = ctx.config.app.locales;
  if (plan.firstRelease) {
    for (const l of languages) await rm(join(ctx.paths.fastlaneMetadata, l, 'release_notes.txt'), { force: true });
    log.dim('First release: App Store Connect has no “What’s New” field yet, so release_notes.txt is not uploaded.');
  }
  if (ctx.config.upload.uploader === 'deliver') {
    log.step('fastlane deliver (text, screenshots, App Previews)…');
    await runLane(ctx.paths, 'vitrin_upload', { bundleId, languages, appVersion: plan.version?.versionString, platform: ctx.config.upload.platform, skipScreenshots: opts.skipScreenshots });
  } else {
    log.step('fastlane deliver (text only) + App Asset Library (images/videos)…');
    await runLane(ctx.paths, 'vitrin_upload', { bundleId, languages, appVersion: plan.version?.versionString, platform: ctx.config.upload.platform, skipScreenshots: true });
    if (!opts.skipScreenshots) await uploadMediaViaAssetLibrary(ctx, client!, plan);
  }

  if (opts.creatives) await uploadCreatives(ctx, client!, plan);
  if (opts.cpp && cpp) {
    const existing = new Set((await client!.getAll<{ name?: string }>(`/v1/apps/${plan.appId}/appCustomProductPages?limit=200`)).map((p) => p.attributes.name));
    for (const page of cpp.pages) {
      if (existing.has(page.name)) {
        log.dim(`CPP “${page.name}” already exists; skipped.`);
        continue;
      }
      const res = await createCustomProductPage(client!, plan.appId!, page, languages);
      log.ok(`Created CPP “${page.name}” (${res.pageId}); images are placed by the --creatives flow, Apple approval required.`);
    }
  }
  if (opts.events && shots) {
    const existing = new Set((await client!.getAll<{ referenceName?: string }>(`/v1/apps/${plan.appId}/appEvents?limit=200`)).map((e) => e.attributes.referenceName));
    for (const e of shots.creatives.events) {
      if (existing.has(e.id)) {
        log.dim(`In-App Event “${e.id}” already exists; skipped.`);
        continue;
      }
      const res = await createInAppEvent(client!, plan.appId!, e, ctx.config.app.primaryLocale, languages);
      log.ok(`Created In-App Event “${e.id}” as a draft (${res.eventId}).`);
    }
  }

  log.step('Reading back from ASC…');
  const diffs = await readBack({ paths: ctx.paths, config: ctx.config, bundleId, metadata, client: client! });
  await recordUpload(ctx, approved, diffs);
  if (diffs.length) {
    for (const d of diffs) log.warn(d);
    return EXIT.FAIL;
  }
  log.ok('Text in ASC matches the local files.');
  log.info('Next: show the user the read-back above; once they confirm the listing, run `vitrin finalize --checked` (keeps the uploaded set in metadata/ or deletes the generated files, per retention.keep).');
  await ctx.state.mark('upload', plan.generatedAt, [relative(ctx.root, ctx.paths.uploadPlan)]);
  log.info('Reminder: final approval of the privacy labels and age rating questionnaire is yours; check the App Store tags (US) after the upload.');
  return EXIT.OK;
}

async function uploadMediaViaAssetLibrary(ctx: Ctx, client: AscClient, plan: UploadPlan): Promise<void> {
  const lib = new AssetLibraryClient(client);
  const libraryId = await lib.libraryId(plan.appId!);
  const locs = await client.versionLocalizations(plan.version!.id);
  for (const locale of ctx.config.app.locales) {
    const loc = locs.find((l) => l.attributes.locale === locale);
    if (!loc) {
      log.warn(`${locale}: no version localization (upload the text first).`);
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
      if (removed) log.dim(`  ${locale} ${g.placement}/${g.displayClass}: removed ${removed} old placements`);
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
    throw new NeedsInput(`Submitting for review is hard to undo. If the user explicitly approves: \`vitrin submit --confirm ${bundleId}\``);
  }
  const doctor = await runDoctor(ctx);
  if (doctor.exitCode !== EXIT.OK) return doctor.exitCode;
  await runLane(ctx.paths, 'vitrin_submit', { bundleId, languages: ctx.config.app.locales, appVersion: ctx.config.upload.appVersion, platform: ctx.config.upload.platform });
  await ctx.state.mark('submit', new Date().toISOString());
  log.ok('Submitted for review.');
  return EXIT.OK;
}
