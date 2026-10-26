import { existsSync, log, readJson, readJsonIfExists, writeJson } from '@vitrin/core';
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
  prepareStores,
  readBack,
  runDeliverForPlatforms,
  runLane,
  runPlayUpload,
  uploadPerDisplayType,
  type UploadPlan,
} from '@vitrin/upload';
import { validateAll, validatePlayText } from '@vitrin/validate';
import { readdir, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
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

  const validation = await validateAll(ctx.paths, ctx.config);
  if (!validation.ok) {
    printIssues(validation.issues.filter((i) => i.severity === 'error'));
    if (!opts.dryRun) {
      log.error('Not uploading while there are validation errors.');
      return EXIT.FAIL;
    }
    log.warn('There are validation errors; showing the plan anyway.');
  }

  // Every store/platform the app ships on: rendered files routed by target, and the Google Play listing for Android.
  const stores = await prepareStores({ paths: ctx.paths, config: ctx.config, profile, env: ctx.env, online: true });
  const hasApple = stores.platforms.some((p) => p !== 'android');
  if (stores.play) {
    const playText = validatePlayText({ config: ctx.config, profile, listings: new Map(stores.play.inputs.listings.map((l) => [l.locale, l])), app: stores.play.inputs.app });
    if (playText.issues.errors.length) {
      printIssues(playText.issues.errors);
      if (!opts.dryRun) {
        log.error('Not uploading while the Google Play listing has validation errors.');
        return EXIT.FAIL;
      }
    }
  }

  // Early warning vs. late gate: a dry run works without keys (remote state unknown); a real upload does not.
  const missing = missingUploadKeys(ctx.env, stores.platforms);
  let client: AscClient | undefined;
  if (!missing.length && hasApple) {
    try {
      client = new AscClient(credentialsFromEnv(process.env));
    } catch (err) {
      if (!opts.dryRun) throw err;
      log.warn((err as Error).message);
    }
  } else if (missing.length && !opts.dryRun) {
    const doctor = await runDoctor(ctx, { offline: true });
    return doctor.exitCode;
  } else if (missing.length) {
    log.warn(`Upload keys missing (${missing.map((m) => m.name).join(', ')}); showing the plan without the remote state.`);
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
    platforms: stores.platforms,
    assets: stores.assets,
    enabledTargets: stores.enabledTargets,
    play: stores.play?.plan,
  });
  await writeJson(ctx.paths.uploadPlan, plan);
  log.info('\n' + formatPlan(plan) + '\n');
  if (opts.dryRun) {
    // Google Play: supply validate_only uploads into a throw-away edit that Google validates and never commits.
    if (stores.play?.client && stores.play.packageName && existsSync(join(ctx.root, 'Gemfile'))) {
      try {
        await runPlayUpload(ctx.paths, stores.play, stores.assets, { validateOnly: true, skipScreenshots: opts.skipScreenshots, scope: plan.scope?.play });
        log.ok('Google Play accepted the listing (validate_only, nothing was published).');
      } catch (err) {
        log.warn(`Google Play validate_only: ${(err as Error).message}`);
      }
    }
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

  const languages = ctx.config.app.locales;
  if (plan.firstRelease) {
    for (const l of languages) await rm(join(ctx.paths.fastlaneMetadata, l, 'release_notes.txt'), { force: true });
    log.dim('First release: App Store Connect has no “What’s New” field yet, so release_notes.txt is not uploaded.');
  }
  // One deliver run per selected Apple platform (iOS incl. Apple Watch, macOS, tvOS, visionOS) with complete sets
  // only; partial sets are replaced per display class through the App Asset Library (see plan.scope).
  if (hasApple) {
    await runDeliverForPlatforms(ctx.paths, plan, stores.assets, { bundleId, languages, skipScreenshots: opts.skipScreenshots });
    if (!opts.skipScreenshots && client) {
      const n = await uploadPerDisplayType(client, plan, stores.assets, languages);
      if (n) log.ok(`App Asset Library: ${n} files placed (only the selected display types were replaced).`);
    }
  }
  // Google Play: listing text, release notes and images only (never a binary, track change or rollout).
  if (stores.play) await runPlayUpload(ctx.paths, stores.play, stores.assets, { validateOnly: false, skipScreenshots: opts.skipScreenshots, scope: plan.scope?.play });

  // Unselected asset kinds (config.selection.assets) stay untouched in the store.
  const kindOn = (k: 'creatives' | 'events') => plan.scope?.assets.includes(k) ?? true;
  if (opts.creatives && kindOn('creatives')) await uploadCreatives(ctx, client!, plan);
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
  if (opts.events && shots && kindOn('events')) {
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

  log.step('Reading back from the stores…');
  const play = stores.play?.client && stores.play.packageName ? { client: stores.play.client, packageName: stores.play.packageName, inputs: stores.play.inputs } : undefined;
  const diffs = await readBack({ paths: ctx.paths, config: ctx.config, bundleId, metadata, client, platforms: stores.platforms, play });
  if (diffs.length) {
    for (const d of diffs) log.warn(d);
    return EXIT.FAIL;
  }
  log.ok('Text in the stores matches the local files.');
  await ctx.state.mark('upload', plan.generatedAt, [relative(ctx.root, ctx.paths.uploadPlan)]);
  log.info('Reminder: final approval of the privacy labels and age rating questionnaire is yours; check the App Store tags (US) after the upload.');
  return EXIT.OK;
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
