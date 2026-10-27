import { analyzeProject } from '@vitrin/analyzer';
import { enabledTargets, exec, existsSync, getTarget, hashPaths, hashValue, log, readJson, readJsonIfExists, run, storefrontForLocale, which, writeJson } from '@vitrin/core';
import { renderDesign, renderDesignSamples, selectedOption } from '@vitrin/render';
import { runResearch, totalScore } from '@vitrin/research';
import { AppMetadata, AppProfile, ArtDirection, CppSuggestions, KeywordPlan, LocaleMetadata, ShotList, StylePreset, VideoPlan, type CustomProductPage, type Issue, type Platform, type TargetFamily, type ValidationReport } from '@vitrin/schemas';
import { validateAll } from '@vitrin/validate';
import { renderVideos } from '@vitrin/video';
import { exportFastlaneMetadata } from '@vitrin/upload';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import pc from 'picocolors';
import { designBrief, metadataBrief, profileBrief, screensBrief, videoBrief } from '../briefs.js';
import { installScreenKit, renderHtmlScreens, type ScreenFamily } from '../html-screens.js';
import { exportProjectMetadata } from '../finalize.js';
import { refreshLiveListing } from '../live-listing.js';
import { loadUiText } from '../i18n.js';
import { EXIT, loadProfile, NeedsInput, stage, type Ctx } from '../context.js';
import { AndroidDevice, androidLocaleTag, androidTools, ensureAvd, launchArgsToExtras, serialFor, startEmulator } from '../android.js';
import { appIdentity, buildApp } from '../build.js';
import { bootAndPrepare, ensureSimulator, isBlankCapture, languageArgs, launch, MacApp, macLaunchArgs, record, screenshot, setSystemLocale, shutdown, sleep, type SimPlatform } from '../simulator.js';
import { rm } from 'node:fs/promises';
import { sampleLocale, sampleTarget } from './select.js';

export function printIssues(issues: Issue[], max = 40): void {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  for (const i of sorted.slice(0, max)) {
    const tag = i.severity === 'error' ? pc.red('ERROR') : i.severity === 'warning' ? pc.yellow('WARN ') : pc.dim('info ');
    log.info(`${tag} ${pc.dim(i.code)} ${i.locale ? `[${i.locale}] ` : ''}${i.message}${i.fix ? pc.dim(` → ${i.fix}`) : ''}`);
  }
  if (sorted.length > max) log.info(pc.dim(`… and ${sorted.length - max} more (metadata/validation.json)`));
}

// ---------------------------------------------------------------- analyze
export async function analyzeCommand(ctx: Ctx): Promise<number> {
  // Project sources only: Vitrin's own files (config, .env, Gemfile, .gitignore) must not invalidate analysis and capture.
  const inputs = await hashPaths([ctx.config.app.project ? dirname(join(ctx.root, ctx.config.app.project)) : ctx.root], ctx.root, /(^|\/)(vitrin\.config\.yaml|\.env.*|Gemfile(\.lock)?|\.gitignore|README\.md|CHANGELOG\.md)$/);
  await stage(ctx, 'analyze', { inputs, app: ctx.config.app }, async () => {
    log.step('Analyzing the project…');
    const fresh = await analyzeProject({ root: ctx.root, projectHint: ctx.config.app.project, scheme: ctx.config.app.scheme, bundleIdOverride: ctx.config.app.bundleId || ctx.env.APP_BUNDLE_ID });
    const previous = await readJsonIfExists(ctx.paths.profile, AppProfile).catch(() => undefined);
    const merged = mergeProfile(fresh, previous);
    // Stored relative so app_profile.json can be committed without leaking local paths; resolved on load.
    await writeJson(ctx.paths.profile, { ...merged, project: { ...merged.project, root: '.' } });
    const yn = (b: boolean) => (b ? 'yes' : 'no');
    log.ok(
      `${merged.app.displayName} (${merged.project.kind}): ${merged.app.platforms.join(', ')} · iPad ${yn(merged.app.supportsIPad)} · iPhone Duo ${yn(merged.app.supportsDuo)}${merged.app.platforms.includes('android') ? ` · Android tablet ${yn(merged.app.supportsAndroidTablet)}` : ''} · ${merged.features.length} features, ${merged.app.locales.length} locales`,
    );
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
    const live = await refreshLiveListing(ctx, profile, res.competitors);
    if (live) log.ok(`Live listing (${live.source === 'asc' ? 'App Store Connect' : 'App Store lookup'}): ${Object.keys(live.locales).join(', ')} → metadata/research/live-listing.json`);
    return [ctx.paths.competitors, ...res.keywordFiles, ...(live ? [ctx.paths.liveListing] : [])];
  });
  return EXIT.OK;
}

// ---------------------------------------------------------------- write
export async function loadLocaleMetadata(ctx: Ctx): Promise<LocaleMetadata[]> {
  const out: LocaleMetadata[] = [];
  for (const l of ctx.config.app.locales) if (existsSync(ctx.paths.metadataFile(l))) out.push(await readJson(ctx.paths.metadataFile(l), LocaleMetadata));
  return out;
}

/** Claude scores relevance after research ran: bring every candidate's total up to date before the fields are checked against the plan. */
export async function refreshKeywordTotals(ctx: Ctx): Promise<void> {
  for (const locale of ctx.config.app.locales) {
    const file = ctx.paths.keywordFile(locale);
    const plan = await readJsonIfExists(file, KeywordPlan).catch(() => undefined);
    if (!plan) continue;
    let changed = false;
    for (const c of plan.candidates) {
      const total = totalScore(c);
      if (total !== c.total) {
        c.total = total;
        changed = true;
      }
    }
    if (changed) await writeJson(file, plan);
  }
}

export async function writeCommand(ctx: Ctx): Promise<number> {
  const profile = await loadProfile(ctx);
  const missing = ctx.config.app.locales.filter((l) => !existsSync(ctx.paths.metadataFile(l)));
  if (missing.length || !existsSync(ctx.paths.appMetadata)) {
    const brief = await metadataBrief(ctx, profile);
    throw new NeedsInput(`Claude input needed: metadata must be written by Claude (missing: ${[...missing.map((m) => `${m}.json`), ...(existsSync(ctx.paths.appMetadata) ? [] : ['app.json'])].join(', ')}).`, [`Brief: ${relative(ctx.root, brief)}`]);
  }
  await refreshKeywordTotals(ctx);
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
  log.ok(`Wrote metadata/store/metadata (${written.length} files)`);
  // The finished text, readable in the project: metadata/app-store/<platform>/<locale>/*.txt (+ google-play).
  const project = await exportProjectMetadata(ctx);
  if (project.skipped) log.warn(`${project.skipped}; the metadata text stays in metadata/store/metadata.`);
  else log.ok(`Store text, readable: metadata/app-store/ and metadata/google-play/ (${project.files.length} files)`);
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
/** Raw-capture family → platform it is built and run on. Raw files live at metadata/raw/<locale>/<family>/<id>.png. */
export const FAMILY_PLATFORM: Record<CaptureFamilyName, Platform> = {
  iphone: 'ios',
  ipad: 'ios',
  duo: 'ios',
  mac: 'macos',
  watch: 'watchos',
  tv: 'tvos',
  vision: 'visionos',
  'android-phone': 'android',
  'android-tablet': 'android',
};
export type CaptureFamilyName = Exclude<TargetFamily, 'any'>;

/** Used when neither the config nor data/targets.json names a device. */
const FALLBACK_DEVICE: Record<CaptureFamilyName, string> = {
  iphone: 'iPhone 17 Pro',
  ipad: 'iPad Pro 13-inch (M5)',
  duo: 'iPhone Duo',
  mac: 'Mac',
  watch: 'Apple Watch Ultra 3 (49mm)',
  tv: 'Apple TV 4K (3rd generation)',
  vision: 'Apple Vision Pro',
  'android-phone': 'pixel_9',
  'android-tablet': 'pixel_tablet',
};

export interface CaptureFamily {
  family: CaptureFamilyName;
  platform: Platform;
  /** simctl device type (Apple), AVD name or avdmanager device profile (Android), "Mac" for macOS. */
  device: string;
  /** True when `device` is a configured AVD name rather than a device profile. */
  avd?: boolean;
}

/** Families with no App Preview class: their recordings are never used. */
const NO_RECORDING = new Set<CaptureFamilyName>(['duo', 'watch']);

/**
 * What capture produces, from `selection.assets`: screenshots → raw screens, previews → raw recordings.
 * Creatives and events are rendered from the raw screens, so they need the screens too. Unset = both.
 */
export function captureKinds(config: Ctx['config']): { screens: boolean; recordings: boolean } {
  const assets = config.selection?.assets;
  if (!assets) return { screens: true, recordings: true };
  return { screens: assets.some((a) => a === 'screenshots' || a === 'creatives' || a === 'events'), recordings: assets.includes('previews') };
}

export function familiesToCapture(ctx: Ctx, profile: AppProfile): CaptureFamily[] {
  const cap = ctx.config.capture;
  const kinds = captureKinds(ctx.config);
  const targets = enabledTargets(ctx.config, profile).filter((t) => t.kind === 'screenshot' || t.kind === 'preview');
  // Previews-only runs record only the families that have an App Preview class.
  const has = (family: CaptureFamilyName) =>
    targets.some((t) => t.family === family && ((kinds.screens && t.kind === 'screenshot') || (kinds.recordings && t.kind === 'preview')));
  const pick = (family: CaptureFamilyName): CaptureFamily => {
    const platform = FAMILY_PLATFORM[family];
    const avd = platform === 'android' ? cap.android.avds[family] : undefined;
    const device = avd ?? cap.simulators[family] ?? targets.find((t) => t.family === family && t.simulator)?.simulator ?? FALLBACK_DEVICE[family];
    return { family, platform, device, ...(avd ? { avd: true } : {}) };
  };
  const out: CaptureFamily[] = [];
  // Duo targets fall back to the iPhone capture, so iPhone is captured whenever either is enabled.
  if (has('iphone') || has('duo')) out.push(pick('iphone'));
  if (has('ipad')) out.push(pick('ipad'));
  // iPhone Duo's fold position cannot be automated and a folded device captures black, so Duo is opt-in
  // (`--family duo` or capture.simulators.duo); otherwise Duo targets are rendered from the iPhone capture.
  if (has('duo') && cap.simulators.duo) out.push(pick('duo'));
  for (const f of ['mac', 'watch', 'tv', 'vision', 'android-phone', 'android-tablet'] as const) if (has(f)) out.push(pick(f));
  return out;
}

/** Tools each platform needs on this machine; checked before any build starts. */
export function requiredTools(platforms: Platform[]): string[] {
  const tools = new Set<string>();
  for (const p of platforms) {
    if (p === 'android') tools.add('adb').add('emulator');
    else tools.add('xcrun');
    if (p === 'macos') tools.add('screencapture');
  }
  return [...tools];
}

export async function captureCommand(ctx: Ctx, opts: { families?: string[]; locales?: string[] } = {}): Promise<number> {
  const profile = await loadProfile(ctx);
  const cap = ctx.config.capture;
  const kinds = captureKinds(ctx.config);
  if ((kinds.screens || cap.mode === 'html') && !cap.screens.length) {
    const brief = await profileBrief(ctx, profile);
    throw new NeedsInput('Claude input needed: capture.screens is empty.', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  if (cap.mode !== 'html' && !kinds.screens && kinds.recordings && !cap.recordings.length) {
    throw new NeedsInput('Only previews are selected, but capture.recordings is empty.');
  }
  const locales = opts.locales ?? ctx.config.app.locales;
  const all = familiesToCapture(ctx, profile);
  if (opts.families?.includes('duo') && !all.some((f) => f.family === 'duo')) all.push({ family: 'duo', platform: 'ios', device: cap.simulators.duo ?? FALLBACK_DEVICE.duo });
  const families = all.filter((f) => !opts.families || opts.families.includes(f.family));
  if (cap.mode === 'manual') {
    const missing: string[] = [];
    for (const l of locales) for (const f of families) for (const s of kinds.screens ? cap.screens : []) if (!existsSync(ctx.paths.rawShot(l, f.family, s.id))) missing.push(relative(ctx.root, ctx.paths.rawShot(l, f.family, s.id)));
    if (missing.length) throw new NeedsInput('Manual capture mode: raw captures are missing.', missing.slice(0, 20));
    log.ok('Manual raw captures complete.');
    return EXIT.OK;
  }
  if (cap.mode === 'html') return captureHtml(ctx, profile, families, locales, kinds);
  if (cap.mode === 'xcuitest') {
    throw new NeedsInput('xcuitest mode: capture with `fastlane snapshot`, place the output at metadata/raw/<locale>/<family>/<id>.png, then use capture.mode: manual.');
  }
  if (!profile.signals['vitrin.demo-mode']) {
    log.warn('No trace of -VitrinDemo in the app: captures may show real user data. See the /vitrin skill’s references/troubleshooting.md “Demo mode”.');
  }
  const platforms = [...new Set(families.map((f) => f.platform))];
  const missingTools: string[] = [];
  for (const t of requiredTools(platforms)) {
    const local = t === 'adb' || t === 'emulator' ? androidTools()[t] : t;
    if (!(local.includes('/') ? existsSync(local) : await which(local))) missingTools.push(t);
  }
  if (missingTools.length) {
    throw new Error(`Capture for ${platforms.join(', ')} needs ${missingTools.join(', ')} (${missingTools.some((t) => t === 'adb' || t === 'emulator') ? 'Android SDK: set ANDROID_HOME; ' : ''}${missingTools.includes('xcrun') ? 'Xcode on macOS; ' : ''}or use capture.mode: manual).`);
  }
  if (!families.length) {
    log.warn('Nothing to capture for the selected platforms and assets.');
    return EXIT.OK;
  }
  const inputs = { cap, kinds, locales, families, build: ctx.state.get('analyze')?.inputHash };
  await stage(ctx, 'capture', inputs, async () => {
    const outputs: string[] = [];
    for (const platform of platforms) {
      const artifact = await buildFor(ctx, profile, platform);
      log.ok(`Built (${platform}): ${relative(ctx.root, artifact)}`);
      const identity = appIdentity(profile, platform, { bundleId: ctx.config.app.bundleId || ctx.env.APP_BUNDLE_ID, scheme: ctx.config.app.scheme, androidApplicationId: cap.android.applicationId });
      if (!identity.appId && platform !== 'macos') throw new NeedsInput(`No app id for ${platform}: set ${platform === 'android' ? 'capture.android.applicationId' : 'app.bundleId'} in vitrin.config.yaml.`);
      for (const f of families.filter((x) => x.platform === platform)) {
        if (platform === 'android') outputs.push(...(await captureAndroid(ctx, f, artifact, identity.appId!, locales)));
        else if (platform === 'macos') outputs.push(...(await captureMac(ctx, profile, f, artifact, locales)));
        else outputs.push(...(await captureSimulator(ctx, f, platform as SimPlatform, artifact, identity.appId!, locales)));
      }
    }
    return outputs;
  });
  return EXIT.OK;
}

/** Builds (or takes `capture.prebuilt`) the app for one platform. */
async function buildFor(ctx: Ctx, profile: AppProfile, platform: Platform): Promise<string> {
  const prebuilt = ctx.config.capture.prebuilt[platform];
  if (prebuilt) {
    const p = join(ctx.root, prebuilt);
    if (!existsSync(p)) throw new Error(`capture.prebuilt.${platform} not found: ${prebuilt}`);
    return p;
  }
  const cap = ctx.config.capture;
  const identity = appIdentity(profile, platform, { scheme: ctx.config.app.scheme });
  const p = profile.project;
  const native = p.kind === 'native';
  return buildApp({
    root: ctx.root,
    kind: p.kind,
    platform,
    iosDir: p.iosDir,
    macosDir: p.macosDir,
    androidDir: p.androidDir,
    xcodeproj: p.xcodeproj,
    workspace: p.workspace,
    // Framework workspaces are named after the app; a native project's scheme follows the platform target.
    scheme: native ? (platform === 'ios' ? (ctx.config.app.scheme ?? p.scheme ?? profile.app.displayName) : identity.scheme) : (ctx.config.app.scheme ?? p.scheme),
    configuration: cap.configuration,
    derivedData: join(ctx.paths.cache, 'DerivedData'),
    macCatalyst: identity.macCatalyst,
    metro: cap.reactNative.metro,
    podInstall: cap.reactNative.podInstall,
    prebuild: cap.reactNative.prebuild,
    gradleTask: cap.android.gradleTask,
  });
}

/** iPhone, iPad, Duo, Apple Watch, Apple TV and Vision Pro: dedicated simulators, simctl screenshots and recordings. */
/** capture.mode html: renders Claude's HTML screens (metadata/screens) per locale and family; no build. */
async function captureHtml(ctx: Ctx, profile: AppProfile, families: CaptureFamily[], locales: string[], kinds: ReturnType<typeof captureKinds>): Promise<number> {
  const cap = ctx.config.capture;
  if (!families.length) {
    log.warn('Nothing to capture for the selected platforms and assets.');
    return EXIT.OK;
  }
  if (!kinds.screens) log.info('HTML screens have no recordings: App Previews are built from the screens (scenes zoom and pan over them).');
  const jobs = locales.flatMap((locale) => families.flatMap((f) => cap.screens.map((s) => ({ locale, family: f.family as ScreenFamily, id: s.id }))));
  const inputs = { mode: 'html', screens: cap.screens, locales, families: families.map((f) => f.family), files: await hashPaths([ctx.paths.screens], ctx.root) };
  let missing: { files: string[]; strings: string[] } = { files: [], strings: [] };
  await stage(ctx, 'capture', inputs, async () => {
    log.step(`HTML screens: ${cap.screens.length} screens × ${families.length} devices × ${locales.length} locales (no build)`);
    const res = await renderHtmlScreens(ctx, jobs, sampleLocale(ctx.config));
    missing = { files: res.missingFiles, strings: res.missingStrings };
    if (res.missingFiles.length) {
      await installScreenKit(ctx.paths.screens);
      const brief = await screensBrief(ctx, profile);
      throw new NeedsInput('Claude input needed: HTML recreations of the app screens.', [...res.missingFiles.slice(0, 12), `Brief: ${relative(ctx.root, brief)}`]);
    }
    return res.outputs;
  });
  if (missing.strings.length) {
    log.warn(`Text missing in metadata/screens/strings (rendered empty): ${missing.strings.slice(0, 12).join('; ')}${missing.strings.length > 12 ? ' …' : ''}`);
    return EXIT.FAIL;
  }
  log.ok('HTML screens rendered → metadata/raw');
  return EXIT.OK;
}

async function captureSimulator(ctx: Ctx, f: CaptureFamily, platform: SimPlatform, appPath: string, bundleId: string, locales: string[]): Promise<string[]> {
  const cap = ctx.config.capture;
  const kinds = captureKinds(ctx.config);
  const outputs: string[] = [];
  const sim = await ensureSimulator(f.device, platform);
  log.step(`${f.family}: ${sim.name} (${sim.runtime})`);
  await bootAndPrepare(sim.udid, cap.appearance, platform);
  try {
    await run('xcrun', ['simctl', 'install', sim.udid, appPath]);
    if (f.family === 'duo') log.warn('iPhone Duo: the fold position cannot be automated; pick the desired screen (outer/inner) in the simulator by hand.');
    for (const locale of locales) {
      const lang = languageArgs(locale, storefrontForLocale(locale));
      await setSystemLocale(sim.udid, locale, storefrontForLocale(locale), cap.appearance, platform);
      for (const s of kinds.screens ? cap.screens : []) {
        await launch(sim.udid, bundleId, ['-VitrinDemo', ...s.launchArgs, ...lang]);
        if (s.url) await exec('xcrun', ['simctl', 'openurl', sim.udid, s.url]);
        await sleep(s.waitMs);
        const out = ctx.paths.rawShot(locale, f.family, s.id);
        await screenshot(sim.udid, out);
        if (await isBlankCapture(out)) {
          await rm(out);
          log.warn(`  ${locale}/${f.family}/${s.id}: screen is blank/black${f.family === 'duo' ? ' (the Duo may be folded; unfold the simulator)' : ''} — deleted${f.family === 'duo' ? ', rendering falls back to the iPhone capture' : ''}.`);
          continue;
        }
        outputs.push(out);
        log.dim(`  ${locale}/${f.family}/${s.id}.png`);
      }
      if (kinds.recordings && !NO_RECORDING.has(f.family)) {
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
  return outputs;
}

/** Mac app (native or Mac Catalyst): launched with the demo arguments, its window captured at the 16:10 target size. */
async function captureMac(ctx: Ctx, profile: AppProfile, f: CaptureFamily, appPath: string, locales: string[]): Promise<string[]> {
  const cap = ctx.config.capture;
  const kinds = captureKinds(ctx.config);
  const target = enabledTargets(ctx.config, profile).find((t) => t.family === 'mac' && t.kind === 'screenshot') ?? getTarget('mac-16x10');
  const app = new MacApp(appPath, join(ctx.paths.cache, 'mac'), { width: target.logical.width, height: target.logical.height });
  const outputs: string[] = [];
  log.step(`mac: ${relative(ctx.root, appPath)} (window → ${target.width}×${target.height})`);
  try {
    for (const locale of locales) {
      const storefront = storefrontForLocale(locale);
      for (const s of kinds.screens ? cap.screens : []) {
        const win = await app.launch(macLaunchArgs(['-VitrinDemo', ...s.launchArgs], locale, storefront, cap.appearance), s.waitMs);
        if (s.url) await exec('open', [s.url]);
        const out = ctx.paths.rawShot(locale, f.family, s.id);
        await app.capture(win, out, target);
        if (await isBlankCapture(out)) {
          await rm(out);
          log.warn(`  ${locale}/mac/${s.id}: window is blank — deleted.`);
          continue;
        }
        outputs.push(out);
        log.dim(`  ${locale}/mac/${s.id}.png`);
      }
      for (const r of kinds.recordings ? cap.recordings : []) {
        const win = await app.launch(macLaunchArgs(['-VitrinDemo', ...r.launchArgs], locale, storefront, cap.appearance), 1500);
        const out = ctx.paths.rawVideo(locale, f.family, r.id);
        await app.record(win, out, r.durationSec);
        outputs.push(out);
        log.dim(`  ${locale}/mac/${r.id}.mp4 (${r.durationSec} s)`);
      }
    }
  } finally {
    await app.quit();
  }
  return outputs;
}

/** Android phone/tablet: dedicated AVD, System UI demo mode, per-app language, intent extras, screencap/screenrecord. */
async function captureAndroid(ctx: Ctx, f: CaptureFamily, apk: string, appId: string, locales: string[]): Promise<string[]> {
  const cap = ctx.config.capture;
  const kinds = captureKinds(ctx.config);
  const tools = androidTools();
  const avd = await ensureAvd(tools, f.avd ? { configured: f.device, deviceProfile: FALLBACK_DEVICE[f.family] } : { deviceProfile: f.device });
  // Fixed ports per family keep serials predictable and away from the user's emulators (5554+).
  const port = f.family === 'android-tablet' ? 5682 : 5680;
  log.step(`${f.family}: ${avd} (${serialFor(port)})`);
  startEmulator(tools, avd, port, cap.android.headless);
  const device = new AndroidDevice(tools, serialFor(port));
  const outputs: string[] = [];
  try {
    await device.waitForBoot(cap.android.bootTimeoutSec);
    await device.install(apk);
    await device.prepare(cap.appearance, f.family === 'android-tablet');
    const component = await device.resolveActivity(appId, cap.android.activity);
    for (const locale of locales) {
      await device.setAppLocale(appId, androidLocaleTag(locale, storefrontForLocale(locale)));
      for (const s of kinds.screens ? cap.screens : []) {
        await device.launch(component, launchArgsToExtras(['-VitrinDemo', ...s.launchArgs]), s.url);
        await sleep(s.waitMs);
        const out = ctx.paths.rawShot(locale, f.family, s.id);
        await device.screencap(out);
        if (await isBlankCapture(out)) {
          await rm(out);
          log.warn(`  ${locale}/${f.family}/${s.id}: screen is blank — deleted.`);
          continue;
        }
        outputs.push(out);
        log.dim(`  ${locale}/${f.family}/${s.id}.png`);
      }
      if (kinds.recordings && !NO_RECORDING.has(f.family)) {
        for (const r of cap.recordings) {
          const out = ctx.paths.rawVideo(locale, f.family, r.id);
          await device.record(out, r.durationSec, () => device.launch(component, launchArgsToExtras(['-VitrinDemo', ...r.launchArgs])));
          outputs.push(out);
          log.dim(`  ${locale}/${f.family}/${r.id}.mp4 (${r.durationSec} s)`);
        }
      }
    }
  } finally {
    await device.shutdown();
  }
  return outputs;
}

// ---------------------------------------------------------------- design
export interface DesignOptions {
  only?: string[];
  /** Comparison render: the first three shots in N presets, a contact sheet and a store preview (nothing is uploaded). */
  samples?: boolean;
  /** Number of sample designs (default 4). */
  count?: number;
  /** Preset ids to sample instead of the suggested ones. */
  styles?: string[];
  /** Locale of the samples (default: sampleLocale — English when the app has it). */
  locale?: string;
}

export async function designCommand(ctx: Ctx, opts: DesignOptions = {}): Promise<number> {
  const profile = await loadProfile(ctx);
  const assets = ctx.config.selection?.assets;
  if (opts.samples) return designSamples(ctx, profile, opts);
  if (assets && !assets.includes('screenshots') && !assets.includes('creatives') && !assets.includes('events')) {
    log.dim('selection.assets has no screenshots, creatives or events — design skipped.');
    return EXIT.OK;
  }
  if (!existsSync(ctx.paths.artDirection) || !existsSync(ctx.paths.shots)) {
    const brief = await designBrief(ctx, profile);
    throw new NeedsInput('Claude input needed: art direction and shot list (art-direction.json, shots.json).', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  const ad = await readJson(ctx.paths.artDirection, ArtDirection);
  const shots = await readJson(ctx.paths.shots, ShotList);
  selectedOption(ad);
  // enabledTargets applies selection.platforms and selection.assets; events also need an event in shots.json.
  const targets = enabledTargets(ctx.config, profile).filter((t) => t.kind === 'screenshot' || t.kind === 'creative' || (t.kind === 'event' && shots.creatives.events.length > 0));
  if (!targets.length) {
    log.dim('No screenshot or creative targets are enabled for this selection — design skipped.');
    return EXIT.OK;
  }
  const rawHash = await hashPaths([ctx.paths.raw], ctx.root);
  const cpp = existsSync(ctx.paths.cpp) ? await readJson(ctx.paths.cpp, CppSuggestions) : undefined;
  const cppPages = (cpp?.pages ?? []).filter((page) => page.shots.length);
  await stage(ctx, 'design', { ad, shots, targets: targets.map((t) => t.id), rawHash, locales: ctx.config.app.locales, only: opts.only, cppPages }, async () => {
    log.step(`Render: ${shots.shots.length} shots × ${targets.filter((t) => t.kind === 'screenshot').length} sizes × ${ctx.config.app.locales.length} locales`);
    const appIcon = profile.brand.appIcon ? join(profile.project.root, profile.brand.appIcon) : undefined;
    const common = { locales: ctx.config.app.locales, primaryLocale: ctx.config.app.primaryLocale, artDirection: ad, appIcon, appName: profile.app.displayName };
    const res = await renderDesign({ ...common, paths: ctx.paths, targets, shots, onlyShots: opts.only });
    for (const w of res.warnings) log.warn(w);
    log.ok(`Rendered ${res.manifest.images.length} images → metadata/store/screenshots, metadata/creative`);
    const files = res.manifest.images.map((i) => i.file);
    // Custom Product Pages get their own set (their shots, in their order, with their copy) for --cpp to place.
    const cppTargets = targets.filter((t) => t.kind === 'screenshot' && t.store === 'app-store');
    if (!opts.only && cppTargets.length) {
      await rm(ctx.paths.cppScreenshots, { recursive: true, force: true });
      for (const page of cppPages) {
        const pageShots = cppShotList(shots, page);
        const pagePaths = { ...ctx.paths, screenshots: join(ctx.paths.cppScreenshots, page.id), renderManifest: join(ctx.paths.cache, 'cpp', `${page.id}.json`) };
        const out = await renderDesign({ ...common, paths: pagePaths, targets: cppTargets, shots: pageShots });
        log.ok(`Custom Product Page “${page.name}”: ${pageShots.shots.length} shots → metadata/store/cpp/${page.id}`);
        files.push(...out.manifest.images.map((i) => i.file));
      }
    }
    return files;
  });
  const report = await validateAll(ctx.paths, ctx.config, { text: false, claims: true, images: true, videos: false });
  printIssues(report.issues);
  return report.ok ? EXIT.OK : EXIT.FAIL;
}

/**
 * A Custom Product Page's shot list: its shots in its order (renumbered 01, 02 … so the files sort that way), with
 * the page's copy overrides. A bridge only survives when the next shot of the page is the one it was made for.
 */
export function cppShotList(shots: ShotList, page: CustomProductPage): ShotList {
  const byId = new Map(shots.shots.map((s) => [s.id, s]));
  const picked = page.shots.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const ids = shots.shots.map((s) => s.id).sort();
  return {
    ...shots,
    shots: picked.map((s, i) => {
      const nextInSet = ids[ids.indexOf(s.id) + 1];
      return {
        ...s,
        id: String(i + 1).padStart(2, '0'),
        copy: { ...s.copy, ...page.copy[s.id] },
        bridge: s.bridge && picked[i + 1]?.id === nextInSet,
      };
    }),
  };
}

/** `vitrin design --samples`: N clearly different designs of the first shots for the user to pick from. */
async function designSamples(ctx: Ctx, profile: AppProfile, opts: DesignOptions): Promise<number> {
  if (!existsSync(ctx.paths.shots)) {
    const brief = await designBrief(ctx, profile);
    throw new NeedsInput('Claude input needed: the first three shots in shots.json (what the search result shows) before sampling designs.', [`Brief: ${relative(ctx.root, brief)}`]);
  }
  const shots = await readJson(ctx.paths.shots, ShotList);
  const ad = existsSync(ctx.paths.artDirection) ? await readJson(ctx.paths.artDirection, ArtDirection) : undefined;
  // Presets, or the ids of bespoke options Claude wrote into art-direction.json for this app.
  const known = [...(StylePreset.options as readonly string[]), ...(ad?.options.map((o) => o.id) ?? [])];
  const unknown = (opts.styles ?? []).filter((s) => !known.includes(s));
  if (unknown.length) throw new NeedsInput(`Unknown design: ${unknown.join(', ')} — use a style preset (${StylePreset.options.join(', ')}) or an option id from art-direction.json.`);
  // One locale (English when the app has it) and the main iPhone format: the user picks a design before Vitrin
  // spends time on every language and size.
  const target = sampleTarget(ctx.config, profile);
  // The store preview can switch to the other stores and devices the user ships on (same shots, same designs).
  const enabled = enabledTargets(ctx.config, profile, { quiet: true }).filter((t) => t.kind === 'screenshot');
  const extraTargets = ['play-phone', 'ipad-13'].map((id) => enabled.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => Boolean(t) && t!.id !== target.id);
  const locale = opts.locale ?? sampleLocale(ctx.config);
  const missingCopy = shots.shots.slice(0, 2).filter((s) => !s.copy[locale]);
  if (missingCopy.length) log.warn(`shots ${missingCopy.map((s) => s.id).join(', ')} have no ${locale} copy; the samples use another locale's text.`);
  const appIcon = profile.brand.appIcon ? join(profile.project.root, profile.brand.appIcon) : undefined;
  const ui = (await loadUiText(ctx)).text;
  const meta = existsSync(ctx.paths.metadataFile(locale)) ? await readJson(ctx.paths.metadataFile(locale), LocaleMetadata).catch(() => undefined) : undefined;
  const res = await renderDesignSamples({
    subtitle: meta?.subtitle,
    labels: { title: ui.samplesTitle, intro: ui.samplesIntro, option: ui.samplesOption, searchResult: ui.searchResult, productPage: ui.productPage, get: ui.get, store: ui.previewStore, theme: ui.previewTheme, appearance: ui.previewAppearance, allThemes: ui.previewAllThemes, light: ui.previewLight, dark: ui.previewDark, install: ui.install, choose: ui.previewChoose },
    extraTargets,
    paths: ctx.paths,
    primaryLocale: locale,
    target,
    shots,
    artDirection: ad,
    styles: opts.styles,
    count: opts.count,
    category: profile.categorySuggestion?.primary,
    appIcon,
    appName: profile.app.displayName,
  });
  const out = { storePreview: res.storePreview, contactSheet: res.contactSheet, target: target.id, locale, samples: res.samples.map((s) => ({ letter: s.letter, preset: s.style, name: s.name, bespoke: s.bespoke, files: s.files, byTarget: s.byTarget })), stores: [target.id, ...extraTargets.map((t) => t.id)], warnings: res.warnings };
  if (ctx.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return EXIT.OK;
  }
  for (const w of res.warnings) log.warn(w);
  for (const s of res.samples) log.ok(`${s.letter}  ${s.name} (${s.style}) — ${s.files.map((f) => relative(ctx.root, f)).join(', ')}`);
  log.ok(`Contact sheet: ${relative(ctx.root, res.contactSheet)}`);
  log.ok(`Store preview with store, design and appearance menus (${[target, ...extraTargets].map((t) => t.id).join(', ')}): ${relative(ctx.root, res.storePreview.html)} · ${relative(ctx.root, res.storePreview.png)}`);
  log.info(`Samples: ${locale}, ${target.id}. Open the store preview for the user (store-preview.html; show store-preview.png in the chat) and ask which design (A/B/C/D) to use; write it into art-direction.json (options[] + selected). Only after they approved a design: ask how to upload (vitrin uploader), then which store languages and formats to produce (vitrin select --locales … --targets …) before \`vitrin design\`.`);
  return EXIT.OK;
}

// ---------------------------------------------------------------- video
export async function videoCommand(ctx: Ctx, opts: { styles?: string[]; locales?: string[] } = {}): Promise<number> {
  const assets = ctx.config.selection?.assets;
  if (assets && !assets.includes('previews') && !assets.includes('creatives')) {
    log.dim('selection.assets has no previews or creatives — video skipped.');
    return EXIT.OK;
  }
  if (!ctx.config.video.enabled && !assets?.includes('previews')) {
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
  await stage(ctx, 'video', { plan, ad, rawHash, locales: ctx.config.app.locales, loops: ctx.config.video.loops, assets }, async () => {
    const enabledPreviewTargets = enabledTargets(ctx.config, profile).filter((t) => t.kind === 'preview').map((t) => t.id);
    // selection.assets: previews → App Previews, creatives → header/search loops.
    const previews = !assets || assets.includes('previews');
    const loops = ctx.config.video.loops && (!assets || assets.includes('creatives'));
    const res = await renderVideos({ paths: ctx.paths, profile, locales: ctx.config.app.locales, primaryLocale: ctx.config.app.primaryLocale, ad, plan, previews, loops, enabledPreviewTargets });
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

