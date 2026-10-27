import { existsSync, log, readJson, readJsonIfExists, selectedPlatforms, writeJson } from '@vitrin/core';
import { AppMetadata, CppSuggestions, ExperimentPlan, ShotList, uploaderOf, type Experiment } from '@vitrin/schemas';
import {
  AscClient,
  buildPlan,
  createCustomProductPage,
  createExperiment,
  createInAppEvent,
  credentialsFromEnv,
  exportFastlaneMetadata,
  formatPlan,
  installFastlaneTemplates,
  placeCustomProductPageMedia,
  placeEventMedia,
  prepareStores,
  readBack,
  runDeliverForPlatforms,
  runLane,
  runAscForPlatforms,
  runPlayUpload,
  uploadPerDisplayType,
  uploadVersionCreatives,
} from '@vitrin/upload';
import { validateAll, validatePlayText } from '@vitrin/validate';
import { rm } from 'node:fs/promises';
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
  uploader?: 'deliver' | 'asset-library' | 'asc';
  creatives?: boolean;
  cpp?: boolean;
  events?: boolean;
  /** Create a Product Page Optimization test: its id, or true for the first one without a result. */
  experiment?: string | boolean;
  skipScreenshots?: boolean;
}

/** The test `--experiment` means: the named one, or the first one without a result. */
async function pickExperiment(ctx: Ctx, which: string | boolean): Promise<Experiment> {
  if (!existsSync(ctx.paths.experiments)) throw new NeedsInput('No metadata/experiments.json yet; plan a test first (references/experiments.md).');
  const plan = await readJson(ctx.paths.experiments, ExperimentPlan);
  const e = typeof which === 'string' ? plan.experiments.find((x) => x.id === which) : plan.experiments.find((x) => !x.result);
  if (!e) throw new NeedsInput(typeof which === 'string' ? `No test “${which}” in metadata/experiments.json.` : 'Every test in metadata/experiments.json already has a result; plan the next one.');
  if (e.result) throw new NeedsInput(`Test “${e.id}” already ended (${e.result.winner}); plan the next one.`);
  return e;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} (yes/no) `)).trim().toLowerCase();
  rl.close();
  return ['yes', 'y'].includes(answer);
}

export async function uploadCommand(ctx: Ctx, opts: UploadOptions): Promise<number> {
  if (opts.uploader && !['deliver', 'asset-library', 'asc'].includes(opts.uploader)) throw new NeedsInput(`Unknown uploader “${opts.uploader}”: use deliver, asset-library or asc.`);
  if (opts.uploader) ctx.config.upload.uploader = opts.uploader;
  const profile = await loadProfile(ctx);
  const shipping = selectedPlatforms(ctx.config, profile).platforms;
  const bundleId = bundleIdOf(ctx, profile);
  const metadata = await loadLocaleMetadata(ctx);
  if (!existsSync(ctx.paths.appMetadata) || metadata.length !== ctx.config.app.locales.length) throw new NeedsInput('Metadata is missing; run `vitrin write` first.');
  const app = await readJson(ctx.paths.appMetadata, AppMetadata);
  await exportFastlaneMetadata(ctx.paths, ctx.config, app, metadata);
  // Approval gate: a real upload sends only the exact files the user reviewed and approved (metadata/approval.json).
  // Checked after the export so the text files compared are the ones deliver would read. --yes never skips this.
  if (!opts.dryRun) await requireApproval(ctx);
  else {
    const approval = await checkApproval(ctx);
    if (!approval.ok) log.warn(`Not approved for upload yet: ${approval.reason} (a real upload needs \`vitrin review\` + the user's approval).`);
  }
  // The user picks fastlane or the asc CLI (`vitrin uploader` shows what is installed); never assume one for them.
  if (!ctx.config.upload.uploader && !opts.dryRun && shipping.some((p) => p !== 'android')) {
    throw new NeedsInput('No uploader chosen for App Store Connect yet.', ['`vitrin uploader` shows whether fastlane and the asc CLI are installed; ask the user, then `vitrin select --uploader asc|deliver`.']);
  }
  if (uploaderOf(ctx.config) !== 'asc' || shipping.includes('android')) {
    for (const f of await installFastlaneTemplates(ctx.paths)) log.ok(`Wrote ${relative(ctx.root, f)}`);
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

  const shots = await readJsonIfExists(ctx.paths.shots, ShotList).catch(() => undefined);
  const cpp = await readJsonIfExists(ctx.paths.cpp, CppSuggestions).catch(() => undefined);
  const experiment = opts.experiment ? await pickExperiment(ctx, opts.experiment) : undefined;
  const plan = await buildPlan({
    paths: ctx.paths,
    config: ctx.config,
    bundleId,
    metadata,
    shots,
    cpp,
    experiment,
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
    // asc uploader: asc's own dry run of the text (and, with a key, of each --replace) changes nothing.
    if (plan.uploader === 'asc' && plan.appId && !plan.blockers.length) {
      try {
        await runAscForPlatforms(ctx.paths, plan, stores.assets, client, { languages: ctx.config.app.locales, env: ctx.env, dryRun: true, skipScreenshots: opts.skipScreenshots });
      } catch (err) {
        log.warn(`asc dry run: ${(err as Error).message}`);
      }
    }
    log.ok(`Plan: metadata/upload-plan.json (--dry-run, nothing was uploaded)`);
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
  // One deliver run per selected Apple platform (iOS incl. Apple Watch, macOS, tvOS, visionOS) with complete sets
  // only; partial sets are replaced one display type at a time (classic sets API, App Asset Library for iPhone Duo).
  // With uploader asc, the asc CLI does text and every classic display type instead of deliver.
  if (hasApple) {
    if (plan.uploader === 'asc') await runAscForPlatforms(ctx.paths, plan, stores.assets, client, { languages, env: ctx.env, skipScreenshots: opts.skipScreenshots });
    else await runDeliverForPlatforms(ctx.paths, plan, stores.assets, { bundleId, languages, skipScreenshots: opts.skipScreenshots });
    if (!opts.skipScreenshots && client) {
      const n = await uploadPerDisplayType(client, plan, stores.assets, languages, { classic: plan.uploader === 'asc' ? 'skip' : 'api' });
      if (n) log.ok(`${n} files uploaded; only the selected display types were replaced.`);
    }
  }
  // Google Play: listing text, release notes and images only (never a binary, track change or rollout).
  if (stores.play) await runPlayUpload(ctx.paths, stores.play, stores.assets, { validateOnly: false, skipScreenshots: opts.skipScreenshots, scope: plan.scope?.play });

  // Unselected asset kinds (config.selection.assets) stay untouched in the store.
  const kindOn = (k: 'creatives' | 'events') => plan.scope?.assets.includes(k) ?? true;
  if (opts.creatives && kindOn('creatives')) await uploadVersionCreatives(client!, plan, ctx.paths.creative, ctx.config.app.locales);
  if (opts.cpp && cpp) {
    const existing = new Set((await client!.getAll<{ name?: string }>(`/v1/apps/${plan.appId}/appCustomProductPages?limit=200`)).map((p) => p.attributes.name));
    for (const page of cpp.pages) {
      if (existing.has(page.name)) {
        log.dim(`CPP “${page.name}” already exists; skipped.`);
        continue;
      }
      const res = await createCustomProductPage(client!, plan.appId!, page, languages);
      const placed = await placeCustomProductPageMedia(client!, plan.appId!, join(ctx.paths.cppScreenshots, page.id), res.localizations);
      if (placed) log.ok(`Created CPP “${page.name}” (${res.pageId}) with its own screenshot set (${placed} images); Apple reviews the page.`);
      else log.warn(`Created CPP “${page.name}” (${res.pageId}) without screenshots: it shows the default set until \`shots\` is set and \`vitrin design\` renders the page's own set. Apple reviews the page.`);
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
      const placed = await placeEventMedia(client!, plan.appId!, ctx.paths.creative, e.id, res.localizations);
      log.ok(`Created In-App Event “${e.id}” as a draft (${res.eventId}) with ${placed} card/detail images${e.schedule ? '' : '; set its schedule in App Store Connect'}${e.deepLink ? '' : '; it needs a deep link before review'}.`);
    }
  }

  if (experiment && (plan.scope?.assets.includes('screenshots') ?? true)) {
    const existing = await client!.getAll<{ name?: string }>(`/v1/apps/${plan.appId}/appStoreVersionExperimentsV2?limit=200`).catch(() => []);
    if (existing.some((x) => x.attributes.name === experiment.name)) log.dim(`Test “${experiment.name}” already exists; skipped.`);
    else {
      const res = await createExperiment(client!, plan.appId!, experiment, { locales: languages, dir: join(ctx.paths.experimentScreenshots, experiment.id) });
      log.ok(`Created test “${experiment.name}” (${res.experimentId}): ${Object.keys(res.treatments).length} treatment(s), ${res.placed} screenshots. It is a draft — App Review checks the treatments, then start it in App Store Connect → Product Page Optimization.`);
    }
  }

  log.step('Reading back from the stores…');
  const play = stores.play?.client && stores.play.packageName ? { client: stores.play.client, packageName: stores.play.packageName, inputs: stores.play.inputs } : undefined;
  const diffs = await readBack({ paths: ctx.paths, config: ctx.config, bundleId, metadata, client, platforms: stores.platforms, play });
  await recordUpload(ctx, approved, diffs);
  if (diffs.length) {
    for (const d of diffs) log.warn(d);
    return EXIT.FAIL;
  }
  log.ok('Text in the stores matches the local files.');
  log.info('Next: show the user the read-back above; once they confirm the listing, ask whether to delete the research data and run `vitrin finalize --checked --delete-research` or `--keep-research`.');
  await ctx.state.mark('upload', plan.generatedAt, [relative(ctx.root, ctx.paths.uploadPlan)]);
  log.info('Reminder: final approval of the privacy labels and age rating questionnaire is yours; check the App Store tags (US) after the upload.');
  return EXIT.OK;
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
