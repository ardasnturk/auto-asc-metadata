import { exec, existsSync } from '@vitrin/core';
import { MAX_HEADLINE_LINES, MAX_PREVIEWS, MAX_SCREENSHOTS, MIN_HEADLINE_PX_69, QUALITY_BAR, WCAG_AA_LARGE, WCAG_AA_NORMAL, type ImageQuality, type RenderManifest, type RenderTarget } from '@vitrin/schemas';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { IssueList } from './issues.js';

/** File name pattern for rendered screenshots: `NN_<slug>_<target>.png`. */
export const SCREENSHOT_RE = /^(\d{2})_([a-z0-9-]+)_([a-z0-9.-]+)\.(png|jpe?g)$/;
/** Preview file pattern: `NN_<DELIVER_DEVICE>.mp4`. */
export const PREVIEW_RE = /^(\d{2})_([A-Z0-9_]+)\.(mp4|mov|m4v)$/;

/** Store name for messages. */
export function storeName(t: Pick<RenderTarget, 'store'>): string {
  return t.store === 'google-play' ? 'Google Play' : 'the App Store';
}

/** Device family of an App Preview file from its deliver device name (`NN_<DEVICE>.mp4`). */
export function previewFamily(device: string): 'iphone' | 'ipad' | 'mac' | 'tv' | 'vision' {
  if (device.startsWith('IPAD')) return 'ipad';
  if (device === 'DESKTOP') return 'mac';
  if (device.startsWith('APPLE_TV')) return 'tv';
  if (device === 'APPLE_VISION_PRO') return 'vision';
  return 'iphone';
}

/** Screenshots per set: 10 on the App Store, 8 on Google Play. */
export function maxScreenshots(t: Pick<RenderTarget, 'store'>): number {
  return t.store === 'google-play' ? 8 : MAX_SCREENSHOTS;
}

/** Targets whose images may keep an alpha channel (Google Play hi-res icon). */
export function alphaAllowed(t: Pick<RenderTarget, 'id'>): boolean {
  return t.id === 'play-icon';
}

export function sizeAccepted(t: RenderTarget, w: number, h: number): boolean {
  if (t.sizeRange) {
    const [minW, minH] = t.sizeRange.min;
    const [maxW, maxH] = t.sizeRange.max;
    const ratio = t.width / t.height;
    return w >= minW && h >= minH && w <= maxW && h <= maxH && Math.abs(w / h - ratio) < 0.01;
  }
  const sizes = t.acceptedSizes.length ? t.acceptedSizes : [[t.width, t.height]];
  return sizes.some(([sw, sh]) => (w === sw && h === sh) || (w === sh && h === sw));
}

export async function validateScreenshots(opts: {
  screenshotsDir: string;
  locales: string[];
  targets: RenderTarget[];
  manifest?: RenderManifest;
}): Promise<IssueList> {
  const issues = new IssueList();
  const counts = new Map<string, Map<string, number>>(); // target → locale → n
  for (const extra of await strayLocaleDirs(opts.screenshotsDir, opts.locales)) {
    issues.error('image.stray-locale', `metadata/store/screenshots/${extra} is a locale not in the config; deliver will upload it too. Remove the folder or add the locale.`);
  }
  for (const locale of opts.locales) {
    const dir = join(opts.screenshotsDir, locale);
    if (!existsSync(dir)) {
      issues.error('image.missing-locale', `No screenshot folder for ${locale} (${dir}).`, { locale });
      continue;
    }
    const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
    for (const f of files) {
      const m = SCREENSHOT_RE.exec(f);
      const file = join(dir, f);
      if (!m) {
        issues.error('image.unknown-file', `Unexpected file: ${locale}/${f} (expected NN_slug_target.png). deliver uploads every image in the folder; remove the file.`, { locale, file });
        continue;
      }
      const target = opts.targets.find((t) => t.id === m[3]);
      if (!target) {
        issues.error('image.unknown-target', `${locale}/${f}: unknown target “${m[3]}”.`, { locale, file });
        continue;
      }
      const meta = await sharp(file).metadata();
      if (!sizeAccepted(target, meta.width ?? 0, meta.height ?? 0)) {
        issues.error('image.size', `${locale}/${f}: ${meta.width}×${meta.height} px; ${target.label} expects ${target.width}×${target.height}.`, { locale, file });
      }
      // Google Play's hi-res icon may carry alpha; every other store image must be opaque.
      if ((meta.hasAlpha || meta.channels === 4) && !alphaAllowed(target)) {
        issues.error('image.alpha', `${locale}/${f}: has an alpha channel; ${storeName(target)} does not accept transparency.`, { locale, file, fix: 'Apply flatten + removeAlpha with sharp (vitrin design does this).' });
      }
      if (!['png', 'jpeg'].includes(meta.format ?? '')) issues.error('image.format', `${locale}/${f}: format is ${meta.format}; must be PNG or JPEG.`, { locale, file });
      const byLocale = counts.get(target.id) ?? new Map<string, number>();
      byLocale.set(locale, (byLocale.get(locale) ?? 0) + 1);
      counts.set(target.id, byLocale);
    }
  }

  for (const t of opts.targets.filter((x) => x.kind === 'screenshot')) {
    const byLocale = counts.get(t.id);
    for (const locale of opts.locales) {
      const n = byLocale?.get(locale) ?? 0;
      if (n === 0) {
        const sev = t.requirement === 'always' || t.requirement === 'if-ipad' ? 'error' : 'warning';
        issues[sev === 'error' ? 'error' : 'warn']('image.missing-target', `${locale}: no screenshots for ${t.label}.`, { locale });
      } else if (n > maxScreenshots(t)) {
        issues.error('image.too-many', `${locale}: ${n} screenshots for ${t.label}; ${storeName(t)} allows at most ${maxScreenshots(t)}.`, { locale });
      }
    }
    const values = [...(byLocale?.values() ?? [])];
    if (values.length && new Set(values).size > 1) {
      issues.warn('image.count-mismatch', `${t.label}: screenshot count differs between locales (${[...(byLocale?.entries() ?? [])].map(([l, n]) => `${l}=${n}`).join(', ')}).`);
    }
  }

  // Render-time quality measurements
  for (const img of opts.manifest?.images ?? []) {
    const where = `${img.locale}/${basename(img.file)}`;
    for (const o of img.overflow) issues.error('image.overflow', `${where}: text overflows/is clipped (${o}).`, { locale: img.locale, file: img.file, fix: 'Shorten the headline or remove the subheadline.' });
    if (img.target === 'iphone-6.9' && img.headlinePx !== undefined && img.headlinePx < MIN_HEADLINE_PX_69) {
      issues.error('image.headline-small', `${where}: headline is ${Math.round(img.headlinePx)} px; must be at least ${MIN_HEADLINE_PX_69} px on a 6.9" screenshot.`, { locale: img.locale, file: img.file });
    }
    if (img.minContrast !== undefined && img.minContrast < WCAG_AA_LARGE) {
      issues.error('image.contrast', `${where}: text contrast is ${img.minContrast.toFixed(2)}:1; WCAG AA requires at least 3:1 for large text.`, { locale: img.locale, file: img.file });
    }
    for (const v of img.safeAreaViolations) issues.warn('image.safe-area', `${where}: element outside the safe area (${v}).`, { locale: img.locale, file: img.file });
    if (img.headlineLines !== undefined && img.headlineLines > MAX_HEADLINE_LINES && SCREENSHOT_RE.test(basename(img.file))) {
      issues.warn('image.headline-lines', `${where}: headline is ${img.headlineLines} lines; at most ${MAX_HEADLINE_LINES} lines is recommended.`, { locale: img.locale, file: img.file, fix: 'Shorten the headline.' });
    }
    if (img.thumbnailLegible === false && !img.quality) issues.warn('image.thumbnail', `${where}: headline is illegible at 25% size; use a shorter, larger headline.`, { locale: img.locale, file: img.file });
    if (img.quality) issues.push(...qualityIssues(img.quality, where, { locale: img.locale, file: img.file, firstThree: Number(img.shot) <= 3 }).items);
  }
  return issues;
}

/**
 * Quality-bar issues for one rendered image. Errors are what the quality bar auto-rejects outright (device
 * under 65 % of the canvas, a word wider than the canvas allows, headline contrast under 3:1); the rest are
 * warnings to fix before shipping.
 */
export function qualityIssues(q: ImageQuality, where: string, ctx: { locale?: string; file?: string; firstThree?: boolean } = {}): IssueList {
  const issues = new IssueList();
  const meta = { locale: ctx.locale, file: ctx.file };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  if (q.deviceRule === 'phone' && q.deviceHeightRatio !== undefined) {
    if (q.deviceHeightRatio < QUALITY_BAR.deviceHeightReject) {
      issues.error('image.device-small', `${where}: the device covers ${pct(q.deviceHeightRatio)} of the canvas height; at least ${pct(QUALITY_BAR.deviceHeightMin)} (it reads small and the slide empty).`, { ...meta, fix: 'Shorten the headline or drop the subheadline so the device can grow; anchor it to an edge.' });
    } else if (q.deviceHeightRatio < QUALITY_BAR.deviceHeightMin) {
      issues.warn('image.device-small', `${where}: the device covers ${pct(q.deviceHeightRatio)} of the canvas height; ${pct(QUALITY_BAR.deviceHeightMin)}–${pct(QUALITY_BAR.deviceHeightMax)} is recommended.`, meta);
    } else if (q.deviceHeightRatio > 0.9) {
      issues.warn('image.device-large', `${where}: the device covers ${pct(q.deviceHeightRatio)} of the canvas height; above ${pct(QUALITY_BAR.deviceHeightMax)} the headline loses room.`, meta);
    }
  }
  if (q.largestEmptyBand > QUALITY_BAR.maxEmptyBand) {
    issues.warn('image.empty-band', `${where}: an empty band covers ${pct(q.largestEmptyBand)} of the canvas height; at most ${pct(QUALITY_BAR.maxEmptyBand)}.`, { ...meta, fix: 'Anchor the device to the top or bottom edge, or use a framing that fills the canvas.' });
  }
  if (q.widestWordRatio > QUALITY_BAR.maxWordWidth) {
    issues.error('image.word-width', `${where}: a headline word spans ${pct(q.widestWordRatio)} of the canvas width; at most ${pct(QUALITY_BAR.maxWordWidth)}.`, { ...meta, fix: 'Use a shorter word or break it onto its own line.' });
  }
  if (q.headlineContrast < WCAG_AA_LARGE) {
    issues.error('image.headline-contrast', `${where}: headline contrast is ${q.headlineContrast.toFixed(2)}:1 against the worst pixel under its letters; WCAG AA needs 4.5:1.`, { ...meta, fix: 'Darken/lighten the emphasis color, add a scrim, or move the headline off the busy area.' });
  } else if (q.headlineContrast < QUALITY_BAR.minHeadlineContrast) {
    issues.warn('image.headline-contrast', `${where}: headline contrast is ${q.headlineContrast.toFixed(2)}:1 against the worst pixel under its letters; WCAG AA asks for 4.5:1.`, meta);
  }
  if (q.supportContrast !== undefined && q.supportContrast < WCAG_AA_NORMAL) {
    issues.warn('image.text-contrast', `${where}: kicker/subheadline contrast is ${q.supportContrast.toFixed(2)}:1; small text needs 4.5:1.`, meta);
  }
  if (q.layers > QUALITY_BAR.maxLayers) {
    issues.warn('image.layers', `${where}: ${q.layers} visual layers; keep background → device → headline + one accent.`, { ...meta, fix: 'Remove floating badges or callouts until one accent is left.' });
  }
  if (!q.thumbnail.legible) {
    const msg = `${where}: at search-result size (${q.thumbnail.width} px wide) the headline is ${q.thumbnail.headlinePx.toFixed(1)} px with ${q.thumbnail.contrast.toFixed(1)}:1 contrast — not legible.`;
    // The first three screenshots are the ones search results show.
    if (ctx.firstThree) issues.warn('image.thumbnail', msg, { ...meta, fix: 'Use fewer, bigger words with a heavier weight and stronger contrast.' });
    else issues.info('image.thumbnail', msg, meta);
  }
  return issues;
}

/** Locale folders deliver would upload although the locale is not configured. */
export async function strayLocaleDirs(dir: string, locales: string[]): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !locales.includes(e.name) && e.name !== 'review_information' && !e.name.startsWith('.')).map((e) => e.name);
}

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  profile?: string;
  level?: number;
  bitrate?: number;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  audioBitrate?: number;
  sizeBytes: number;
}

export async function ffprobe(file: string): Promise<ProbeResult> {
  const res = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  if (res.code !== 0) throw new Error(`ffprobe failed: ${file}: ${res.stderr}`);
  const json = JSON.parse(res.stdout) as {
    streams: Array<Record<string, string | number | undefined>>;
    format: { duration?: string; size?: string; bit_rate?: string };
  };
  const v = json.streams.find((s) => s.codec_type === 'video') ?? {};
  const a = json.streams.find((s) => s.codec_type === 'audio');
  const [num, den] = String(v.avg_frame_rate ?? v.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    durationSec: Number(json.format.duration ?? v.duration ?? 0),
    width: Number(v.width ?? 0),
    height: Number(v.height ?? 0),
    fps: den ? num! / den : 0,
    videoCodec: String(v.codec_name ?? ''),
    profile: v.profile ? String(v.profile) : undefined,
    level: v.level !== undefined ? Number(v.level) : undefined,
    bitrate: v.bit_rate ? Number(v.bit_rate) : json.format.bit_rate ? Number(json.format.bit_rate) : undefined,
    audioCodec: a ? String(a.codec_name) : undefined,
    audioChannels: a ? Number(a.channels) : undefined,
    audioSampleRate: a ? Number(a.sample_rate) : undefined,
    audioBitrate: a?.bit_rate ? Number(a.bit_rate) : undefined,
    sizeBytes: Number(json.format.size ?? (await stat(file)).size),
  };
}

/** App Preview / creative video rules. Returns issues for one file. */
export function checkVideo(p: ProbeResult, target: RenderTarget, where: string): IssueList {
  const issues = new IssueList();
  const v = target.video!;
  if (p.durationSec < v.minSec - 0.05 || p.durationSec > v.maxSec + 0.05) {
    issues.error('video.duration', `${where}: ${p.durationSec.toFixed(1)} s; must be ${v.minSec}–${v.maxSec} s.`);
  }
  if (!v.fps.some((f) => Math.abs(p.fps - f) < 0.05)) issues.error('video.fps', `${where}: ${p.fps.toFixed(2)} fps; allowed: ${v.fps.join('/')}.`);
  if (!sizeAccepted(target, p.width, p.height)) issues.error('video.size', `${where}: ${p.width}×${p.height}; expected ${target.width}×${target.height}.`);
  if (p.videoCodec !== 'h264' && p.videoCodec !== 'prores') issues.error('video.codec', `${where}: codec is ${p.videoCodec}; must be H.264 or ProRes 422 HQ.`);
  if (v.h264Level && p.videoCodec === 'h264') {
    if (p.profile && !/^(High|Main|Constrained Baseline|Baseline)$/i.test(p.profile)) issues.error('video.profile', `${where}: H.264 profile is ${p.profile}; must be High or lower.`);
    if (p.level !== undefined && p.level > 40) issues.error('video.level', `${where}: H.264 level is ${p.level / 10}; maximum 4.0.`);
    if (p.bitrate && (p.bitrate < 6_000_000 || p.bitrate > 14_000_000)) issues.warn('video.bitrate', `${where}: bitrate is ${(p.bitrate / 1e6).toFixed(1)} Mbps; target 10–12 Mbps.`);
  }
  if (target.kind === 'preview') {
    if (!p.audioCodec) issues.error('video.audio-missing', `${where}: no audio track; add a silent stereo AAC track.`);
    else {
      if (p.audioCodec !== 'aac' && !p.audioCodec.startsWith('pcm')) issues.error('video.audio-codec', `${where}: audio is ${p.audioCodec}; must be AAC.`);
      if (p.audioChannels !== 2) issues.error('video.audio-channels', `${where}: ${p.audioChannels} channel(s); must be stereo.`);
      if (p.audioSampleRate && ![44100, 48000].includes(p.audioSampleRate)) issues.error('video.audio-rate', `${where}: ${p.audioSampleRate} Hz; must be 44.1 or 48 kHz.`);
    }
  }
  if (p.sizeBytes > v.maxBytes) issues.error('video.too-large', `${where}: ${(p.sizeBytes / 1e6).toFixed(0)} MB; maximum ${v.maxBytes / 1e6} MB.`);
  return issues;
}

export async function validateVideos(opts: { previewsDir: string; creativeDir: string; locales: string[]; targets: RenderTarget[]; expectPreview: boolean }): Promise<IssueList> {
  const issues = new IssueList();
  const previewTargets = opts.targets.filter((t) => t.kind === 'preview');
  for (const extra of await strayLocaleDirs(opts.previewsDir, opts.locales)) issues.error('video.stray-locale', `metadata/store/app-previews/${extra} is a locale not in the config.`);
  for (const locale of opts.locales) {
    const dir = join(opts.previewsDir, locale);
    const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.(mp4|mov|m4v)$/i.test(f)).sort() : [];
    if (!files.length && opts.expectPreview) issues.warn('video.none', `${locale}: no App Preview.`, { locale });
    const perDevice = new Map<string, number>();
    for (const f of files) {
      const m = PREVIEW_RE.exec(f);
      if (!m) {
        issues.error('video.name', `${locale}/${f}: file name must be NN_<DEVICE>.mp4 (e.g. 01_IPHONE_67.mp4).`, { locale });
        continue;
      }
      perDevice.set(m[2]!, (perDevice.get(m[2]!) ?? 0) + 1);
      const target = previewTargets.find((t) => t.family === previewFamily(m[2]!));
      if (!target) {
        issues.error('video.disabled-target', `${locale}/${f}: no preview target is enabled for this device (targets.enable); deliver will upload it anyway.`, { locale });
        continue;
      }
      const probe = await ffprobe(join(dir, f));
      issues.push(...checkVideo(probe, target, `${locale}/${f}`).items.map((i) => ({ ...i, locale })));
    }
    for (const [dev, n] of perDevice) if (n > MAX_PREVIEWS) issues.error('video.too-many', `${locale}: ${n} previews for ${dev}; maximum ${MAX_PREVIEWS}.`, { locale });
  }
  if (existsSync(opts.creativeDir)) {
    for (const f of (await readdir(opts.creativeDir, { recursive: true })).map(String).filter((x) => x.endsWith('.mp4'))) {
      const name = basename(f);
      const target = opts.targets.find((t) => name.startsWith(t.id + '_') || name.startsWith(t.id + '.'));
      if (!target?.video) continue;
      const probe = await ffprobe(join(opts.creativeDir, f));
      issues.push(...checkVideo(probe, target, `creative/${f}`).items);
    }
  }
  return issues;
}
