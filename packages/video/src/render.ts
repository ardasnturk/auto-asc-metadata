import { DELIVER_PREVIEW_DEVICE, ensureDir, existsSync, getTarget, localeInfo, log, run, type AppPaths } from '@vitrin/core';
import type { AppProfile, LoopPlan, PreviewPlan, RenderManifest, VideoPlan } from '@vitrin/schemas';
import { frameShell, lucideIcon, type ResolvedDirection } from '@vitrin/render';
import { readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FPS_PREVIEW, MAX_TEXT_CARDS, previewDurationSec, STYLE_DEFAULTS, type AppPreviewProps, type Look, type LoopProps, type MediaRef, type PreviewFamily, renderScale, type Scene, type TransitionKind } from './types.js';

/** packages/video: the Remotion project (entry and remotion.config.ts) the renderer bundles and Studio runs. */
export const VIDEO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(VIDEO_DIR, 'src', 'remotion', 'index.ts');

export interface VideoRenderOptions {
  paths: AppPaths;
  profile: AppProfile;
  locales: string[];
  primaryLocale: string;
  /** Resolved art direction (render's selectedOption). */
  ad: ResolvedDirection;
  plan: VideoPlan;
  previews: boolean;
  loops: boolean;
  onlyLocales?: string[];
  /** preview-iphone / preview-ipad / preview-mac / preview-tv ids that are enabled for this app. */
  enabledPreviewTargets: string[];
  /**
   * Comparison mode: render the first preview once per style into metadata/video-styles/<locale>/
   * (never uploaded) instead of the normal outputs.
   */
  styleVariants?: PreviewPlan['style'][];
}

export interface VideoRenderResult {
  videos: RenderManifest['videos'];
  warnings: string[];
}

/** Find a source in the raw library: recording (.mp4) first, then screenshot (.png); same locale first. */
export async function resolveMedia(paths: AppPaths, locale: string, primary: string, family: PreviewFamily, id: string, from: number, warnings: string[]): Promise<{ ref: MediaRef; aspect: number }> {
  for (const loc of [locale, primary]) {
    for (const fam of [...new Set<string>([family, 'iphone'])]) {
      const video = paths.rawVideo(loc, fam, id);
      const image = paths.rawShot(loc, fam, id);
      if (existsSync(video)) {
        if (loc !== locale) warnings.push(`${id}: no ${locale} recording, used ${loc}`);
        const aspect = await videoAspect(video);
        return { ref: { path: relative(paths.raw, video), kind: 'video', from, aspect }, aspect };
      }
      if (existsSync(image)) {
        if (loc !== locale) warnings.push(`${id}: no ${locale} screenshot, used ${loc}`);
        const m = await sharp(image).metadata();
        const aspect = (m.height ?? 1) / (m.width ?? 1);
        return { ref: { path: relative(paths.raw, image), kind: 'image', from: 0, aspect }, aspect };
      }
    }
  }
  throw new Error(`Video source missing: ${id} (${locale}/${family}). Define it in capture.recordings or capture.screens.`);
}

async function videoAspect(file: string): Promise<number> {
  const res = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = res.stdout.trim().split(',').map(Number);
  return h! / w!;
}

export function lookFrom(ad: ResolvedDirection, locale: string, family: PreviewFamily, aspect: number): Look {
  const sf = ad.tokens.surfaces[0]!;
  // Same CSS frames as the screenshots; Mac previews use the window chrome so the footage stays large.
  const shell = frameShell(family, aspect, { finish: ad.tokens.device.finish === 'black' ? 'graphite' : ad.tokens.device.finish, variant: { mac: 'window', tv: 'bezel' } });
  return {
    background: ad.palette.background,
    accent: ad.palette.accent,
    text: ad.palette.text,
    textMuted: ad.palette.textMuted,
    surface: ad.palette.surface,
    badgeBackground: ad.palette.badgeBackground,
    badgeText: ad.palette.badgeText,
    headlineFont: ad.typography.headline,
    bodyFont: ad.typography.body,
    headlineWeight: ad.typography.headlineWeight,
    dir: localeInfo(locale)?.dir ?? 'ltr',
    deviceFamily: family,
    aspect,
    frame: shell,
    preset: ad.tokens.id,
  };
}

/** deliver device names for preview files; core's map wins where it has an entry. */
const PREVIEW_DEVICE_FALLBACK: Record<string, string> = { 'preview-mac': 'DESKTOP', 'preview-tv': 'APPLE_TV', 'preview-vision': 'APPLE_VISION_PRO' };

export function previewTargetId(family: PreviewFamily): string {
  return `preview-${family}`;
}

/** Stretch or shrink beat durations so the preview lands in 15–30 s (target ≈ 22 s when out of range). */
export function fitDurations(hookSec: number, outroSec: number, beats: number[]): number[] {
  const total = hookSec + outroSec + beats.reduce((a, b) => a + b, 0);
  if (total >= 15 && total <= 30) return beats;
  const target = 22 - hookSec - outroSec;
  const sum = beats.reduce((a, b) => a + b, 0) || 1;
  return beats.map((b) => Math.round(((b / sum) * target) * 10) / 10);
}

// Short, punchy timing: a hook, ≈ 2 s beats, a short closing line (App Store previews autoplay muted in search).
const HOOK_SEC = 2.2;
const OUTRO_SEC = 2.4;
const TEXT_CARD_SEC = 1;

/** Cut transitions for a plan: an explicit kind everywhere, or the style's cycle. */
export function resolveTransitions(p: Pick<PreviewPlan, 'style' | 'transition' | 'lightLeaks'>, cuts: number): TransitionKind[] {
  const defaults = STYLE_DEFAULTS[p.style];
  const leaks = p.lightLeaks ?? defaults.lightLeaks;
  const out: TransitionKind[] = [];
  for (let i = 0; i < cuts; i++) {
    let kind: TransitionKind = p.transition === 'auto' ? defaults.transitions[i % defaults.transitions.length]! : p.transition;
    if (kind === 'leak' && !leaks) kind = 'fade';
    if (leaks && p.transition !== 'auto' && i % 2 === 1) kind = 'leak';
    out.push(kind);
  }
  return out;
}

export interface ResolvedBeat {
  media?: MediaRef;
  media2?: MediaRef;
  /** `flow` beats: one source per step. */
  steps?: MediaRef[];
}

/**
 * Which beats get a kinetic typography card in front of them: together with the plan's own `text` beats at most
 * MAX_TEXT_CARDS, spread over the video (the first captioned beat, then the middle one). The others keep their
 * caption on the UI beat.
 */
export function kineticCardBeats(plan: Pick<PreviewPlan, 'style' | 'beats'>, locale: string): Set<number> {
  if (!STYLE_DEFAULTS[plan.style].textCards) return new Set();
  const room = MAX_TEXT_CARDS - plan.beats.filter((b) => b.scene === 'text').length;
  const captioned = plan.beats.flatMap((b, i) => (b.scene !== 'text' && b.caption[locale] ? [i] : []));
  const picks = [captioned[0], captioned[Math.ceil(captioned.length / 2)]].slice(0, Math.max(room, 0));
  return new Set(picks.filter((i): i is number => i !== undefined));
}

/**
 * Turns a plan into the scene list the AppPreview composition renders, for one locale.
 * Kinetic style puts a few captions on their own typography card before the UI beat (see kineticCardBeats).
 * The closing line runs over the outcome screen (`outroMedia`, else the last UI beat). Beat lengths are scaled
 * only when the preview falls outside 15–30 s, and only as far as needed (to 16 s or 28 s).
 */
export function buildPreviewProps(opts: {
  plan: PreviewPlan;
  locale: string;
  look: Look;
  hookMedia: MediaRef;
  beats: ResolvedBeat[];
  outroMedia?: MediaRef;
}): AppPreviewProps {
  const { plan, locale } = opts;
  const style = plan.style;
  const carded = kineticCardBeats(plan, locale);
  const sec = (s: number) => Math.round(s * FPS_PREVIEW);
  const scenes: Scene[] = [{ kind: 'hook', frames: sec(HOOK_SEC), text: plan.hook[locale] ?? '', media: opts.hookMedia }];
  const beatScenes: Scene[] = [];
  let lastMedia = opts.hookMedia;
  plan.beats.forEach((b, i) => {
    const caption = b.caption[locale] ?? '';
    const len = Math.max(1, b.to - b.from);
    if (b.scene === 'text') {
      beatScenes.push({ kind: 'text', frames: sec(Math.min(len, 1.5)), text: caption });
      return;
    }
    if (carded.has(i)) beatScenes.push({ kind: 'text', frames: sec(TEXT_CARD_SEC), text: caption });
    const shown = carded.has(i) ? '' : caption;
    const frames = sec(len);
    if (b.scene === 'flow') {
      const steps = b.steps.map((s, k) => {
        const media = opts.beats[i]?.steps?.[k];
        if (!media) throw new Error(`Video ${plan.id} beat ${i + 1}: source missing (${s.source}).`);
        return { media, tap: s.tap, change: s.change };
      });
      if (steps.length < 2) throw new Error(`Video ${plan.id} beat ${i + 1}: a flow needs at least 2 steps.`);
      beatScenes.push({ kind: 'flow', frames, caption: shown, steps });
      lastMedia = steps[steps.length - 1]!.media;
      return;
    }
    const media = opts.beats[i]?.media;
    if (!media) throw new Error(`Video ${plan.id} beat ${i + 1}: source missing (${b.source}).`);
    lastMedia = media;
    switch (b.scene) {
      case 'zoom':
        beatScenes.push({ kind: 'zoom', frames, caption: shown, media, rect: b.zoom ?? { x: 0.05, y: 0.3, w: 0.9, h: 0.3 } });
        break;
      case 'split':
        beatScenes.push({ kind: 'split', frames, caption: shown, media, media2: opts.beats[i]?.media2 ?? media });
        break;
      case 'stat':
        beatScenes.push({ kind: 'stat', frames, caption: shown, media, value: b.stat?.value ?? 0, suffix: b.stat?.suffix[locale] ?? '', label: b.stat?.label[locale] ?? '', locale });
        break;
      case 'badges':
        beatScenes.push({ kind: 'badges', frames, caption: shown, media, chips: b.badges.map((c) => ({ label: c.label[locale] ?? '', iconSvg: lucideIcon(c.icon, 24, 'currentColor') })) });
        break;
      default:
        beatScenes.push({ kind: 'device', frames, caption: shown, media });
    }
  });
  scenes.push(...beatScenes);
  if (plan.outro) scenes.push({ kind: 'outro', frames: sec(OUTRO_SEC), title: plan.outro.title[locale] ?? '', subtitle: plan.outro.subtitle[locale] ?? '', media: opts.outroMedia ?? lastMedia });

  const transitions = resolveTransitions(plan, scenes.length - 1);
  const transitionFrames = STYLE_DEFAULTS[style].transitionFrames;
  const props: AppPreviewProps = { look: opts.look, style, transitions, transitionFrames, lightLeaks: transitions.includes('leak'), scenes };

  // Fit into Apple's 15–30 s by scaling the UI beats (text cards, hook and closing keep their rhythm), no further than needed.
  const total = previewDurationSec(props);
  if (total < 15 || total > 30) {
    const fixed = scenes.filter((s) => s.kind === 'hook' || s.kind === 'outro' || s.kind === 'text').reduce((a, s) => a + s.frames, 0);
    const flexible = scenes.filter((s) => !['hook', 'outro', 'text'].includes(s.kind));
    const flexFrames = flexible.reduce((a, s) => a + s.frames, 0) || 1;
    const overlaps = total * FPS_PREVIEW - scenes.reduce((a, s) => a + s.frames, 0);
    const targetFlex = (total < 15 ? 16 : 28) * FPS_PREVIEW - fixed - overlaps;
    for (const s of flexible) s.frames = Math.max(sec(1.5), Math.round((s.frames / flexFrames) * targetFlex));
  }
  settlePosterFrame(props);
  return props;
}

/** App Store Connect's default poster frame (references/apple-notes.md). */
export const POSTER_SEC = 5;

/** Frame index where each scene starts on the timeline (overlapping transitions pull the next scene earlier). */
export function sceneStarts(p: Pick<AppPreviewProps, 'scenes' | 'transitions' | 'transitionFrames'>): number[] {
  const starts = [0];
  p.scenes.slice(0, -1).forEach((s, i) => {
    const cut = p.transitions[i];
    starts.push(starts[i]! + s.frames - (cut && cut !== 'none' && cut !== 'leak' ? p.transitionFrames : 0));
  });
  return starts;
}

/**
 * The poster frame should show a settled UI scene — not a cut, a device still flying in, or a text card. With short
 * beats it easily lands on one of those, so the scene before it is held a little longer until the frame falls into
 * that scene's settled tail (or the current scene is held past the next cut). Nothing changes when that would push
 * the preview over 30 s.
 */
export function settlePosterFrame(props: AppPreviewProps, posterSec = POSTER_SEC): void {
  const p = Math.round(posterSec * FPS_PREVIEW);
  const settle = Math.round(0.9 * FPS_PREVIEW);
  const margin = 6;
  const overlap = (i: number) => {
    const cut = props.transitions[i];
    return cut && cut !== 'none' && cut !== 'leak' ? props.transitionFrames : 0;
  };
  const before = props.scenes.map((s) => s.frames);
  for (let attempt = 0; attempt < 3; attempt++) {
    const starts = sceneStarts(props);
    const i = starts.findLastIndex((s) => s <= p);
    const scene = props.scenes[i];
    if (!scene) return;
    const end = starts[i + 1] ?? starts[i]! + scene.frames;
    const into = p - starts[i]!;
    if (scene.kind !== 'text' && into >= settle && end - p >= overlap(i) + margin) break;
    if (scene.kind === 'text' || into < settle) {
      const prev = props.scenes[i - 1];
      if (!prev || prev.kind === 'text') break;
      prev.frames += p + overlap(i - 1) + margin - starts[i]!;
    } else {
      scene.frames += overlap(i) + margin - (end - p);
    }
  }
  if (previewDurationSec(props) > 30) props.scenes.forEach((s, k) => (s.frames = before[k]!));
}

/** Every source one preview plan uses, resolved for one locale (`family` = the preview's device). */
async function resolvePlanMedia(paths: AppPaths, locale: string, primary: string, p: PreviewPlan, warnings: string[]): Promise<{ hook: { ref: MediaRef; aspect: number }; beats: ResolvedBeat[]; outro?: MediaRef }> {
  const family = p.device;
  const hook = await resolveMedia(paths, locale, primary, family, p.hookSource, p.hookFrom, warnings);
  const beats: ResolvedBeat[] = [];
  for (const b of p.beats) {
    if (b.scene === 'text') {
      beats.push({});
      continue;
    }
    if (b.scene === 'flow') {
      const steps: MediaRef[] = [];
      for (const s of b.steps) steps.push((await resolveMedia(paths, locale, primary, family, s.source, s.from, warnings)).ref);
      beats.push({ steps });
      continue;
    }
    beats.push({
      media: (await resolveMedia(paths, locale, primary, family, b.source, b.from, warnings)).ref,
      media2: b.secondSource ? (await resolveMedia(paths, locale, primary, family, b.secondSource, 0, warnings)).ref : undefined,
    });
  }
  const outro = p.outro?.source ? (await resolveMedia(paths, locale, primary, family, p.outro.source, 0, warnings)).ref : undefined;
  return { hook, beats, outro };
}

/** One preview of the plan for one locale with the props `vitrin video` would render — what Remotion Studio shows. */
export async function previewPropsFor(opts: { paths: AppPaths; plan: VideoPlan; ad: ResolvedDirection; locale: string; primaryLocale: string; id?: string }): Promise<{ props: AppPreviewProps; warnings: string[] }> {
  const p = (opts.id ? opts.plan.previews.find((x) => x.id === opts.id) : undefined) ?? opts.plan.previews[0];
  if (!p) throw new Error('video-plan.json has no previews.');
  const warnings: string[] = [];
  const { hook, beats, outro } = await resolvePlanMedia(opts.paths, opts.locale, opts.primaryLocale, p, warnings);
  const props = buildPreviewProps({ plan: p, locale: opts.locale, look: lookFrom(opts.ad, opts.locale, p.device, hook.aspect), hookMedia: hook.ref, beats, outroMedia: outro });
  return { props, warnings };
}

/** @remotion/cli's entry script when it is installed (a development checkout); Remotion Studio needs it. */
export function remotionCliPath(): string | undefined {
  try {
    return join(dirname(createRequire(join(VIDEO_DIR, 'package.json')).resolve('@remotion/cli/package.json')), 'remotion-cli.js');
  } catch {
    return undefined;
  }
}

export async function renderVideos(opts: VideoRenderOptions): Promise<VideoRenderResult> {
  const { paths, plan, ad } = opts;
  const warnings: string[] = [];
  const videos: RenderManifest['videos'] = [];
  const locales = opts.onlyLocales ?? opts.locales;

  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  log.step('Bundling the Remotion project…');
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir: paths.raw,
    symlinkPublicDir: true,
    // Our sources use NodeNext-style `.js` specifiers that point at .ts/.tsx files.
    webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } } }),
  });

  const render = async (id: string, inputProps: Record<string, unknown>, out: string, h264Level: boolean, scale = 2) => {
    const composition = await selectComposition({ serveUrl, id, inputProps });
    // Render outside fastlane/ so a crashed render never leaves a file deliver would upload.
    const tmp = join(paths.cache, 'remotion', `${Date.now()}-${out.split('/').pop()}`);
    await ensureDir(dirname(tmp));
    await ensureDir(dirname(out));
    let last = 0;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: tmp,
      inputProps,
      scale,
      videoBitrate: scale > 2 ? '40M' : '11M',
      audioCodec: 'aac',
      audioBitrate: '256k',
      enforceAudioTrack: true,
      pixelFormat: 'yuv420p',
      // Light leaks and other @remotion/effects need WebGL in headless Chrome.
      chromiumOptions: { gl: 'angle' },
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct > last) {
          last = pct;
          log.dim(`    ${pct}%`);
        }
      },
    });
    await normalize(tmp, out, h264Level);
    await rm(tmp, { force: true });
  };

  if (opts.styleVariants?.length) {
    const base = plan.previews[0];
    if (!base) throw new Error('video-plan.json has no previews.');
    for (const locale of locales) {
      const { hook, beats, outro } = await resolvePlanMedia(paths, locale, opts.primaryLocale, base, warnings);
      for (const style of opts.styleVariants) {
        const p = { ...base, style, transition: 'auto' as const, lightLeaks: undefined };
        const props = buildPreviewProps({ plan: p, locale, look: lookFrom(ad, locale, base.device, hook.aspect), hookMedia: hook.ref, beats, outroMedia: outro });
        const out = join(paths.vitrin, 'video-styles', locale, `${base.id}_${style}.mp4`);
        log.step(`Style variant ${style} (${locale}) — ${props.scenes.length} scenes, ${previewDurationSec(props).toFixed(1)} s`);
        await render('AppPreview', props, out, base.device !== 'vision', renderScale(base.device));
        videos.push({ file: out, target: 'preview-variant', locale, id: `${base.id}-${style}`, durationSec: previewDurationSec(props) });
      }
    }
    return { videos, warnings };
  }

  if (opts.previews) {
    for (const locale of locales) {
      const dir = join(paths.appPreviews, locale);
      await ensureDir(dir);
      for (const f of await readdir(dir)) if (/^\d{2}_[A-Z0-9_]+\.(mp4|mov)$/.test(f)) await rm(join(dir, f));
      for (const p of plan.previews) {
        const family = p.device;
        if (!opts.enabledPreviewTargets.includes(previewTargetId(family))) {
          warnings.push(`Preview ${p.id} (${family}) skipped: target not enabled (targets.enable: [preview-${family}]).`);
          continue;
        }
        const target = getTarget(previewTargetId(family));
        const { hook, beats, outro } = await resolvePlanMedia(paths, locale, opts.primaryLocale, p, warnings);
        const props = buildPreviewProps({ plan: p, locale, look: lookFrom(ad, locale, family, hook.aspect), hookMedia: hook.ref, beats, outroMedia: outro });
        const total = previewDurationSec(props);
        if (total < 15 || total > 30) throw new Error(`App Preview ${p.id} is ${total.toFixed(1)} s long; it must be 15–30 s (reduce the number of beats).`);
        const out = join(dir, `${p.id}_${DELIVER_PREVIEW_DEVICE[target.id] ?? PREVIEW_DEVICE_FALLBACK[target.id] ?? 'IPHONE_67'}.mp4`);
        log.step(`App Preview ${p.id} (${locale}, ${family}, ${p.style}) — ${props.scenes.length} scenes, ${total.toFixed(1)} s @ ${FPS_PREVIEW} fps`);
        // H.264 High@4.0 tops out below 4K, so Vision Pro previews keep High profile without the 4.0 level.
        await render('AppPreview', props, out, family !== 'vision', renderScale(family));
        videos.push({ file: out, target: target.id, locale, id: p.id, durationSec: total });
      }
    }
  }

  if (opts.loops) {
    const loops: Array<[string, LoopPlan | undefined, string, 'header' | 'search']> = [
      ['header', plan.loops.header, 'HeaderLoop', 'header'],
      ['search', plan.loops.search, 'SearchLoop', 'search'],
    ];
    for (const locale of locales) {
      for (const [targetId, loop, comp, layout] of loops) {
        if (!loop) continue;
        if (loop.fps !== 30) warnings.push(`${targetId}: loops are rendered at 30 fps (60 fps was requested).`);
        const media = await Promise.all(loop.sources.map((s) => resolveMedia(paths, locale, opts.primaryLocale, 'iphone', s, 0, warnings)));
        const props: LoopProps = {
          look: lookFrom(ad, locale, 'iphone', media[0]!.aspect),
          copy: loop.copy[locale] ?? '',
          media: media.map((m) => m.ref),
          durationSec: loop.durationSec,
          layout,
        };
        const out = join(paths.creative, locale, `${targetId}_loop.mp4`);
        log.step(`Creative loop ${targetId} (${locale}) — ${loop.durationSec} s`);
        await render(comp, props, out, false);
        videos.push({ file: out, target: targetId, locale, id: `${targetId}-loop`, durationSec: loop.durationSec });
      }
    }
  }

  return { videos, warnings };
}

/**
 * Re-encode to exactly what App Store Connect wants: H.264 High@4.0 (previews), yuv420p, CFR 30 fps,
 * 10–12 Mbps, stereo AAC 256 kbps 48 kHz. A silent stereo track is added if the source has none.
 */
export async function normalize(input: string, output: string, previewLevel: boolean): Promise<void> {
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', input]);
  const hasAudio = probe.stdout.trim().length > 0;
  const args = ['-y', '-i', input];
  if (!hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push('-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0');
  args.push('-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr');
  if (previewLevel) args.push('-profile:v', 'high', '-level:v', '4.0', '-b:v', '11M', '-maxrate', '12M', '-bufsize', '22M');
  else args.push('-profile:v', 'high', '-b:v', '20M', '-maxrate', '24M', '-bufsize', '40M');
  args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', output);
  await run('ffmpeg', args);
}


