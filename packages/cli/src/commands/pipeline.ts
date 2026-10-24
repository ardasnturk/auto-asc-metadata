import { analyzeProject } from '@vitrin/analyzer';
import { enabledTargets, exec, existsSync, hashPaths, hashValue, log, readJson, readJsonIfExists, run, storefrontForLocale, writeJson } from '@vitrin/core';
import { selectedOption, renderDesign } from '@vitrin/render';
import { runResearch } from '@vitrin/research';
import { AppMetadata, AppProfile, ArtDirection, CppSuggestions, LocaleMetadata, ShotList, VideoPlan, type Issue, type ValidationReport } from '@vitrin/schemas';
import { validateAll } from '@vitrin/validate';
import { renderVideos } from '@vitrin/video';
import { exportFastlaneMetadata } from '@vitrin/upload';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import pc from 'picocolors';
import { designBrief, metadataBrief, profileBrief, videoBrief } from '../briefs.js';
import { EXIT, loadProfile, NeedsInput, stage, type Ctx } from '../context.js';
import { bootAndPrepare, buildForSimulator, ensureSimulator, isBlankCapture, languageArgs, launch, record, screenshot, setSystemLocale, shutdown, sleep } from '../simulator.js';
import { rm } from 'node:fs/promises';

export function printIssues(issues: Issue[], max = 40): void {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  for (const i of sorted.slice(0, max)) {
    const tag = i.severity === 'error' ? pc.red('ERROR') : i.severity === 'warning' ? pc.yellow('WARN ') : pc.dim('info ');
    log.info(`${tag} ${pc.dim(i.code)} ${i.locale ? `[${i.locale}] ` : ''}${i.message}${i.fix ? pc.dim(` → ${i.fix}`) : ''}`);
  }
  if (sorted.length > max) log.info(pc.dim(`… and ${sorted.length - max} more (.vitrin/validation.json)`));
}

// ---------------------------------------------------------------- analyze
export async function analyzeCommand(ctx: Ctx): Promise<number> {
  // Project sources only: Vitrin's own files (config, .env, Gemfile, .gitignore) must not invalidate analysis and capture.
  const inputs = await hashPaths([ctx.config.app.project ? dirname(join(ctx.root, ctx.config.app.project)) : ctx.root], ctx.root, /(^|\/)(vitrin\.config\.yaml|\.env.*|Gemfile(\.lock)?|\.gitignore|README\.md|CHANGELOG\.md)$/);
  await stage(ctx, 'analyze', { inputs, app: ctx.config.app }, async () => {
    log.step('Analyzing the Xcode project…');
    const fresh = await analyzeProject({ root: ctx.root, projectHint: ctx.config.app.project, scheme: ctx.config.app.scheme, bundleIdOverride: ctx.config.app.bundleId || ctx.env.APP_BUNDLE_ID });
    const previous = await readJsonIfExists(ctx.paths.profile, AppProfile).catch(() => undefined);
    const merged = mergeProfile(fresh, previous);
    // Stored relative so app_profile.json can be committed without leaking local paths; resolved on load.
    await writeJson(ctx.paths.profile, { ...merged, project: { ...merged.project, root: '.' } });
    log.ok(`${merged.app.displayName}: ${merged.features.length} features, ${merged.app.locales.length} locales, iPad ${merged.app.supportsIPad ? 'yes' : 'no'}`);
    return [ctx.paths.profile];
  });
  const profile = await loadProfile(ctx);
  const seedsEmpty = seedCount(ctx) === 0;
  if (!profile.positioning || seedsEmpty || !ctx.config.capture.screens.length) {
    const brief = await profileBrief(ctx, profile);
    throw new NeedsInput('Analysis done. Claude input needed: positioning, additional features, research.seeds and capture.screens.', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  return EXIT.OK;
}

/** Keeps everything Claude added (features with source "claude", positioning, category) across re-analysis. */
export function mergeProfile(fresh: AppProfile, previous?: AppProfile): AppProfile {
  if (!previous) return fresh;
  const ids = new Set(fresh.features.map((f) => f.id));
  const claude = previous.features.filter((f) => f.source === 'claude' && !ids.has(f.id));
  return {
    ...fresh,
    features: [...fresh.features, ...claude],
    positioning: previous.positioning ?? fresh.positioning,
    categorySuggestion: previous.categorySuggestion ?? fresh.categorySuggestion,
    todo: fresh.todo.filter((t) => !(previous.positioning && t.startsWith('positioning'))),
  };
}

function seedCount(ctx: Ctx): number {
  const s = ctx.config.research.seeds;
  return Array.isArray(s) ? s.length : Object.values(s).reduce((a, v) => a + v.length, 0);
}

// ---------------------------------------------------------------- research
export async function researchCommand(ctx: Ctx, opts: { skipImages?: boolean } = {}): Promise<number> {
  const profile = await loadProfile(ctx);
  if (seedCount(ctx) === 0) {
    const brief = await profileBrief(ctx, profile);
    throw new NeedsInput('Claude input needed: research.seeds is empty.', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  await stage(ctx, 'research', { research: ctx.config.research, storefronts: ctx.config.storefronts, locales: ctx.config.app.locales, bundle: profile.app.bundleId, cat: profile.categorySuggestion?.primary, day: new Date().toISOString().slice(0, 10) }, async () => {
    const res = await runResearch({ paths: ctx.paths, config: ctx.config, profile, env: ctx.env, skipImages: opts.skipImages });
    log.ok(`${res.competitors.apps.length} competitors, keyword candidates for ${res.keywordFiles.length} locales`);
    if (res.competitors.self) log.ok(`App is on the App Store: ${res.competitors.self.averageUserRating?.toFixed(1) ?? '–'}★ (${res.competitors.self.userRatingCount ?? 0} ratings)`);
    return [ctx.paths.competitors, ...res.keywordFiles];
  });
  return EXIT.OK;
}

// ---------------------------------------------------------------- write
export async function loadLocaleMetadata(ctx: Ctx): Promise<LocaleMetadata[]> {
  const out: LocaleMetadata[] = [];
  for (const l of ctx.config.app.locales) if (existsSync(ctx.paths.metadataFile(l))) out.push(await readJson(ctx.paths.metadataFile(l), LocaleMetadata));
  return out;
}

export async function writeCommand(ctx: Ctx): Promise<number> {
  const profile = await loadProfile(ctx);
  const missing = ctx.config.app.locales.filter((l) => !existsSync(ctx.paths.metadataFile(l)));
  if (missing.length || !existsSync(ctx.paths.appMetadata)) {
    const brief = await metadataBrief(ctx, profile);
    throw new NeedsInput(`Claude input needed: metadata must be written by Claude (missing: ${[...missing.map((m) => `${m}.json`), ...(existsSync(ctx.paths.appMetadata) ? [] : ['app.json'])].join(', ')}).`, [`Brief: ${relative(ctx.root, brief)}`]);
  }
  const report = await validateAll(ctx.paths, ctx.config, { text: true, claims: true, images: false, videos: false });
  const issues = report.issues.filter((i) => !i.code.startsWith('shot.') && !i.code.startsWith('badge.') && !i.code.startsWith('video.'));
  printIssues(issues);
  if (issues.some((i) => i.severity === 'error')) {
    log.error('Metadata validation failed; fix the errors and run `vitrin write` again.');
    return EXIT.FAIL;
  }
  const metadata = await loadLocaleMetadata(ctx);
  const app = await readJson(ctx.paths.appMetadata, AppMetadata);
  const written = await exportFastlaneMetadata(ctx.paths, ctx.config, app, metadata);
  await ctx.state.mark('write', hashValue({ metadata, app, urls: ctx.config.urls }), written.map((w) => relative(ctx.root, w)));
  log.ok(`Wrote fastlane/metadata (${written.length} files)`);
  for (const m of metadata) {
    const kw = Buffer.byteLength(m.keywords, 'utf8');
    log.dim(`  ${m.locale}: name “${m.name}”, subtitle “${m.subtitle}”, keywords ${kw}/100 bytes`);
  }
  if (existsSync(ctx.paths.cpp)) {
    const cpp = await readJson(ctx.paths.cpp, CppSuggestions);
    log.ok(`${cpp.pages.length} Custom Product Page suggestions ready (upload with: vitrin upload --cpp)`);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------- capture
export function familiesToCapture(ctx: Ctx, profile: AppProfile): Array<{ family: 'iphone' | 'ipad' | 'duo'; simulator: string }> {
  const targets = enabledTargets(ctx.config, profile);
  const out: Array<{ family: 'iphone' | 'ipad' | 'duo'; simulator: string }> = [];
  const pick = (family: 'iphone' | 'ipad' | 'duo', fallback: string) => ctx.config.capture.simulators[family] ?? targets.find((t) => t.family === family && t.simulator)?.simulator ?? fallback;
  out.push({ family: 'iphone', simulator: pick('iphone', 'iPhone 17 Pro') });
  if (targets.some((t) => t.family === 'ipad' && t.kind === 'screenshot')) out.push({ family: 'ipad', simulator: pick('ipad', 'iPad Pro 13-inch (M5)') });
  // iPhone Duo's fold position cannot be automated and a folded device captures black, so Duo is opt-in
  // (`--family duo` or capture.simulators.duo); otherwise Duo targets are rendered from the iPhone capture.
  if (targets.some((t) => t.family === 'duo') && ctx.config.capture.simulators.duo) out.push({ family: 'duo', simulator: pick('duo', 'iPhone Duo') });
  return out;
}

export async function captureCommand(ctx: Ctx, opts: { families?: string[]; locales?: string[] } = {}): Promise<number> {
  const profile = await loadProfile(ctx);
  const cap = ctx.config.capture;
  if (!cap.screens.length) {
    const brief = await profileBrief(ctx, profile);
    throw new NeedsInput('Claude input needed: capture.screens is empty.', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  const locales = opts.locales ?? ctx.config.app.locales;
  const all = familiesToCapture(ctx, profile);
  if (opts.families?.includes('duo') && !all.some((f) => f.family === 'duo')) all.push({ family: 'duo', simulator: ctx.config.capture.simulators.duo ?? 'iPhone Duo' });
  const families = all.filter((f) => !opts.families || opts.families.includes(f.family));
  if (cap.mode === 'manual') {
    const missing: string[] = [];
    for (const l of locales) for (const f of families) for (const s of cap.screens) if (!existsSync(ctx.paths.rawShot(l, f.family, s.id))) missing.push(relative(ctx.root, ctx.paths.rawShot(l, f.family, s.id)));
    if (missing.length) throw new NeedsInput('Manual capture mode: raw captures are missing.', missing.slice(0, 20));
    log.ok('Manual raw captures complete.');
    return EXIT.OK;
  }
  if (cap.mode === 'xcuitest') {
    throw new NeedsInput('xcuitest mode: capture with `fastlane snapshot`, place the output at .vitrin/raw/<locale>/<family>/<id>.png, then use capture.mode: manual.');
  }
  if (!profile.signals['vitrin.demo-mode']) {
    log.warn('No trace of -VitrinDemo in the app: captures may show real user data. See skill/references/troubleshooting.md “Demo mode”.');
  }
  const bundleId = profile.app.bundleId!;
  const inputs = { cap, locales, families, build: ctx.state.get('analyze')?.inputHash };
  await stage(ctx, 'capture', inputs, async () => {
    const derived = join(ctx.paths.cache, 'DerivedData');
    const appPath = await buildForSimulator({
      root: ctx.root,
      project: profile.project.workspace ? undefined : profile.project.xcodeproj,
      workspace: profile.project.workspace,
      scheme: ctx.config.app.scheme ?? profile.project.scheme ?? profile.app.displayName,
      configuration: cap.configuration,
      derivedData: derived,
    });
    log.ok(`Built: ${relative(ctx.root, appPath)}`);
    const outputs: string[] = [];
    for (const f of families) {
      const sim = await ensureSimulator(f.simulator);
      log.step(`${f.family}: ${sim.name} (${sim.runtime})`);
      await bootAndPrepare(sim.udid, cap.appearance);
      try {
        await run('xcrun', ['simctl', 'install', sim.udid, appPath]);
        if (f.family === 'duo') log.warn('iPhone Duo: the fold position cannot be automated; pick the desired screen (outer/inner) in the simulator by hand.');
        for (const locale of locales) {
          const lang = languageArgs(locale, storefrontForLocale(locale));
          await setSystemLocale(sim.udid, locale, storefrontForLocale(locale), cap.appearance);
          for (const s of cap.screens) {
            await launch(sim.udid, bundleId, ['-VitrinDemo', ...s.launchArgs, ...lang]);
            if (s.url) await exec('xcrun', ['simctl', 'openurl', sim.udid, s.url]);
            await sleep(s.waitMs);
            const out = ctx.paths.rawShot(locale, f.family, s.id);
            await screenshot(sim.udid, out);
            if (await isBlankCapture(out)) {
              await rm(out);
              log.warn(`  ${locale}/${f.family}/${s.id}: screen is blank/black${f.family === 'duo' ? ' (the Duo may be folded; unfold the simulator)' : ''} — deleted, rendering falls back to the iPhone capture.`);
              continue;
            }
            outputs.push(out);
            log.dim(`  ${locale}/${f.family}/${s.id}.png`);
          }
          if (f.family !== 'duo') {
            for (const r of cap.recordings) {
              const out = ctx.paths.rawVideo(locale, f.family, r.id);
              const rec = record(sim.udid, out, r.durationSec);
              await sleep(600);
              await launch(sim.udid, bundleId, ['-VitrinDemo', ...r.launchArgs, ...lang]);
              await rec;
              outputs.push(out);
              log.dim(`  ${locale}/${f.family}/${r.id}.mp4 (${r.durationSec} s)`);
            }
          }
        }
      } finally {
        await shutdown(sim.udid);
      }
    }
    return outputs;
  });
  return EXIT.OK;
}

// ---------------------------------------------------------------- design
export async function designCommand(ctx: Ctx, opts: { only?: string[] } = {}): Promise<number> {
  const profile = await loadProfile(ctx);
  if (!existsSync(ctx.paths.artDirection) || !existsSync(ctx.paths.shots)) {
    const brief = await designBrief(ctx, profile);
    throw new NeedsInput('Claude input needed: art direction and shot list (art-direction.json, shots.json).', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  const ad = await readJson(ctx.paths.artDirection, ArtDirection);
  const shots = await readJson(ctx.paths.shots, ShotList);
  selectedOption(ad);
  const targets = enabledTargets(ctx.config, profile).filter((t) => t.kind === 'screenshot' || t.kind === 'creative' || (t.kind === 'event' && shots.creatives.events.length > 0));
  const rawHash = await hashPaths([ctx.paths.raw], ctx.root);
  await stage(ctx, 'design', { ad, shots, targets: targets.map((t) => t.id), rawHash, locales: ctx.config.app.locales, only: opts.only }, async () => {
    log.step(`Render: ${shots.shots.length} shots × ${targets.filter((t) => t.kind === 'screenshot').length} sizes × ${ctx.config.app.locales.length} locales`);
    const appIcon = profile.brand.appIcon ? join(profile.project.root, profile.brand.appIcon) : undefined;
    const res = await renderDesign({ paths: ctx.paths, locales: ctx.config.app.locales, primaryLocale: ctx.config.app.primaryLocale, targets, artDirection: ad, shots, onlyShots: opts.only, appIcon });
    for (const w of res.warnings) log.warn(w);
    log.ok(`Rendered ${res.manifest.images.length} images → fastlane/screenshots, .vitrin/creative`);
    return res.manifest.images.map((i) => i.file);
  });
  const report = await validateAll(ctx.paths, ctx.config, { text: false, claims: true, images: true, videos: false });
  printIssues(report.issues);
  return report.ok ? EXIT.OK : EXIT.FAIL;
}

// ---------------------------------------------------------------- video
export async function videoCommand(ctx: Ctx, opts: { styles?: string[]; locales?: string[] } = {}): Promise<number> {
  if (!ctx.config.video.enabled) {
    log.dim('video.enabled: false — skipped.');
    return EXIT.OK;
  }
  const profile = await loadProfile(ctx);
  if (!existsSync(ctx.paths.videoPlan)) {
    const brief = await videoBrief(ctx);
    throw new NeedsInput('Claude input needed: video plan (video-plan.json).', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  if (!existsSync(ctx.paths.artDirection)) throw new NeedsInput('Run `vitrin design` first (art-direction.json is required).');
  const plan = await readJson(ctx.paths.videoPlan, VideoPlan);
  const ad = selectedOption(await readJson(ctx.paths.artDirection, ArtDirection));
  const rawHash = await hashPaths([ctx.paths.raw], ctx.root);
  if (opts.styles?.length) {
    // Comparison renders: not a pipeline stage, nothing here is uploaded.
    const all = ['classic', 'showcase', 'kinetic', 'energetic'] as const;
    const styles = opts.styles.includes('all') ? [...all] : opts.styles.filter((x): x is (typeof all)[number] => (all as readonly string[]).includes(x));
    if (!styles.length) throw new NeedsInput(`Unknown style: ${opts.styles.join(', ')} (classic, showcase, kinetic, energetic, all).`);
    const enabledPreviewTargets = enabledTargets(ctx.config, profile).filter((t) => t.kind === 'preview').map((t) => t.id);
    const res = await renderVideos({ paths: ctx.paths, profile, locales: ctx.config.app.locales, onlyLocales: opts.locales ?? [ctx.config.app.primaryLocale], primaryLocale: ctx.config.app.primaryLocale, ad, plan, previews: true, loops: false, enabledPreviewTargets, styleVariants: styles });
    for (const w of [...new Set(res.warnings)]) log.warn(w);
    for (const v of res.videos) log.ok(relative(ctx.root, v.file));
    log.info('Write the chosen style to video-plan.json → previews[].style and run `vitrin video`.');
    return EXIT.OK;
  }
  await stage(ctx, 'video', { plan, ad, rawHash, locales: ctx.config.app.locales, loops: ctx.config.video.loops }, async () => {
    const enabledPreviewTargets = enabledTargets(ctx.config, profile).filter((t) => t.kind === 'preview').map((t) => t.id);
    const res = await renderVideos({ paths: ctx.paths, profile, locales: ctx.config.app.locales, primaryLocale: ctx.config.app.primaryLocale, ad, plan, previews: true, loops: ctx.config.video.loops, enabledPreviewTargets });
    for (const w of [...new Set(res.warnings)]) log.warn(w);
    const manifestFile = ctx.paths.renderManifest;
    if (existsSync(manifestFile)) {
      const m = JSON.parse(await readFile(manifestFile, 'utf8'));
      m.videos = res.videos;
      await writeJson(manifestFile, m);
    }
    log.ok(`Rendered ${res.videos.length} videos`);
    return res.videos.map((v) => v.file);
  });
  const report = await validateAll(ctx.paths, ctx.config, { text: false, claims: false, images: false, videos: true });
  printIssues(report.issues);
  return report.ok ? EXIT.OK : EXIT.FAIL;
}

// ---------------------------------------------------------------- validate
export async function validateCommand(ctx: Ctx): Promise<{ code: number; report: ValidationReport }> {
  const report = await validateAll(ctx.paths, ctx.config);
  await writeJson(ctx.paths.validation, report);
  printIssues(report.issues);
  log.info(`\n${report.ok ? pc.green('PASSED') : pc.red('FAILED')} — ${report.counts.error} errors, ${report.counts.warning} warnings, ${report.counts.info} info → ${relative(ctx.root, ctx.paths.validation)}`);
  await ctx.state.mark('validate', hashValue(report.issues), [relative(ctx.root, ctx.paths.validation)], report.ok ? 'ok' : 'blocked');
  return { code: report.ok ? EXIT.OK : EXIT.FAIL, report };
}

