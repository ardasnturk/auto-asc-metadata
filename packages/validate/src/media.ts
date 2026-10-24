import { exec, existsSync } from '@vitrin/core';
import { MAX_HEADLINE_LINES, MAX_PREVIEWS, MAX_SCREENSHOTS, MIN_HEADLINE_PX_69, WCAG_AA_LARGE, type RenderManifest, type RenderTarget } from '@vitrin/schemas';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { IssueList } from './issues.js';

/** File name pattern for rendered screenshots: `NN_<slug>_<target>.png`. */
export const SCREENSHOT_RE = /^(\d{2})_([a-z0-9-]+)_([a-z0-9.-]+)\.(png|jpe?g)$/;
/** Preview file pattern: `NN_<DELIVER_DEVICE>.mp4`. */
export const PREVIEW_RE = /^(\d{2})_([A-Z0-9_]+)\.(mp4|mov|m4v)$/;

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
    issues.error('image.stray-locale', `fastlane/screenshots/${extra} config’te olmayan bir dil; deliver bunu da yükler. Klasörü kaldır ya da dili ekle.`);
  }
  for (const locale of opts.locales) {
    const dir = join(opts.screenshotsDir, locale);
    if (!existsSync(dir)) {
      issues.error('image.missing-locale', `${locale} için ekran görüntüsü klasörü yok (${dir}).`, { locale });
      continue;
    }
    const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
    for (const f of files) {
      const m = SCREENSHOT_RE.exec(f);
      const file = join(dir, f);
      if (!m) {
        issues.error('image.unknown-file', `Beklenmeyen dosya: ${locale}/${f} (NN_slug_hedef.png bekleniyor). deliver klasördeki her görseli yükler; dosyayı kaldır.`, { locale, file });
        continue;
      }
      const target = opts.targets.find((t) => t.id === m[3]);
      if (!target) {
        issues.error('image.unknown-target', `${locale}/${f}: bilinmeyen hedef “${m[3]}”.`, { locale, file });
        continue;
      }
      const meta = await sharp(file).metadata();
      if (!sizeAccepted(target, meta.width ?? 0, meta.height ?? 0)) {
        issues.error('image.size', `${locale}/${f}: ${meta.width}×${meta.height} px, ${target.label} için ${target.width}×${target.height} bekleniyor.`, { locale, file });
      }
      if (meta.hasAlpha || meta.channels === 4) {
        issues.error('image.alpha', `${locale}/${f}: alfa kanalı var; App Store saydamlık kabul etmez.`, { locale, file, fix: 'sharp ile flatten + removeAlpha uygula (vitrin design bunu yapar).' });
      }
      if (!['png', 'jpeg'].includes(meta.format ?? '')) issues.error('image.format', `${locale}/${f}: biçim ${meta.format}; PNG veya JPEG olmalı.`, { locale, file });
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
        issues[sev === 'error' ? 'error' : 'warn']('image.missing-target', `${locale}: ${t.label} için görsel yok.`, { locale });
      } else if (n > MAX_SCREENSHOTS) {
        issues.error('image.too-many', `${locale}: ${t.label} için ${n} görsel; en çok ${MAX_SCREENSHOTS}.`, { locale });
      }
    }
    const values = [...(byLocale?.values() ?? [])];
    if (values.length && new Set(values).size > 1) {
      issues.warn('image.count-mismatch', `${t.label}: dillere göre görsel sayısı farklı (${[...(byLocale?.entries() ?? [])].map(([l, n]) => `${l}=${n}`).join(', ')}).`);
    }
  }

  // Render-time quality measurements
  for (const img of opts.manifest?.images ?? []) {
    const where = `${img.locale}/${basename(img.file)}`;
    for (const o of img.overflow) issues.error('image.overflow', `${where}: metin taşıyor/kesiliyor (${o}).`, { locale: img.locale, file: img.file, fix: 'Başlığı kısalt ya da alt başlığı kaldır.' });
    if (img.target === 'iphone-6.9' && img.headlinePx !== undefined && img.headlinePx < MIN_HEADLINE_PX_69) {
      issues.error('image.headline-small', `${where}: başlık ${Math.round(img.headlinePx)} px; 6,9" görselde en az ${MIN_HEADLINE_PX_69} px olmalı.`, { locale: img.locale, file: img.file });
    }
    if (img.minContrast !== undefined && img.minContrast < WCAG_AA_LARGE) {
      issues.error('image.contrast', `${where}: metin kontrastı ${img.minContrast.toFixed(2)}:1; WCAG AA büyük metin için en az 3:1.`, { locale: img.locale, file: img.file });
    }
    for (const v of img.safeAreaViolations) issues.warn('image.safe-area', `${where}: güvenli alan dışında öğe (${v}).`, { locale: img.locale, file: img.file });
    if (img.headlineLines !== undefined && img.headlineLines > MAX_HEADLINE_LINES && SCREENSHOT_RE.test(basename(img.file))) {
      issues.warn('image.headline-lines', `${where}: başlık ${img.headlineLines} satır; en fazla ${MAX_HEADLINE_LINES} satır önerilir.`, { locale: img.locale, file: img.file, fix: 'Başlığı kısalt.' });
    }
    if (img.thumbnailLegible === false) issues.warn('image.thumbnail', `${where}: %25 boyutta başlık okunaksız; daha kısa ve büyük başlık kullan.`, { locale: img.locale, file: img.file });
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
  if (res.code !== 0) throw new Error(`ffprobe başarısız: ${file}: ${res.stderr}`);
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
    issues.error('video.duration', `${where}: ${p.durationSec.toFixed(1)} sn; ${v.minSec}–${v.maxSec} sn olmalı.`);
  }
  if (!v.fps.some((f) => Math.abs(p.fps - f) < 0.05)) issues.error('video.fps', `${where}: ${p.fps.toFixed(2)} fps; izin verilen: ${v.fps.join('/')}.`);
  if (!sizeAccepted(target, p.width, p.height)) issues.error('video.size', `${where}: ${p.width}×${p.height}; ${target.width}×${target.height} bekleniyor.`);
  if (p.videoCodec !== 'h264' && p.videoCodec !== 'prores') issues.error('video.codec', `${where}: codec ${p.videoCodec}; H.264 ya da ProRes 422 HQ olmalı.`);
  if (v.h264Level && p.videoCodec === 'h264') {
    if (p.profile && !/^(High|Main|Constrained Baseline|Baseline)$/i.test(p.profile)) issues.error('video.profile', `${where}: H.264 profili ${p.profile}; en çok High olmalı.`);
    if (p.level !== undefined && p.level > 40) issues.error('video.level', `${where}: H.264 seviye ${p.level / 10}; en çok 4.0.`);
    if (p.bitrate && (p.bitrate < 6_000_000 || p.bitrate > 14_000_000)) issues.warn('video.bitrate', `${where}: bit hızı ${(p.bitrate / 1e6).toFixed(1)} Mbps; hedef 10–12 Mbps.`);
  }
  if (target.kind === 'preview') {
    if (!p.audioCodec) issues.error('video.audio-missing', `${where}: ses kanalı yok; sessiz stereo AAC eklenmeli.`);
    else {
      if (p.audioCodec !== 'aac' && !p.audioCodec.startsWith('pcm')) issues.error('video.audio-codec', `${where}: ses ${p.audioCodec}; AAC olmalı.`);
      if (p.audioChannels !== 2) issues.error('video.audio-channels', `${where}: ${p.audioChannels} kanal; stereo olmalı.`);
      if (p.audioSampleRate && ![44100, 48000].includes(p.audioSampleRate)) issues.error('video.audio-rate', `${where}: ${p.audioSampleRate} Hz; 44,1 veya 48 kHz olmalı.`);
    }
  }
  if (p.sizeBytes > v.maxBytes) issues.error('video.too-large', `${where}: ${(p.sizeBytes / 1e6).toFixed(0)} MB; en çok ${v.maxBytes / 1e6} MB.`);
  return issues;
}

export async function validateVideos(opts: { previewsDir: string; creativeDir: string; locales: string[]; targets: RenderTarget[]; expectPreview: boolean }): Promise<IssueList> {
  const issues = new IssueList();
  const previewTargets = opts.targets.filter((t) => t.kind === 'preview');
  for (const extra of await strayLocaleDirs(opts.previewsDir, opts.locales)) issues.error('video.stray-locale', `fastlane/app-previews/${extra} config’te olmayan bir dil.`);
  for (const locale of opts.locales) {
    const dir = join(opts.previewsDir, locale);
    const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.(mp4|mov|m4v)$/i.test(f)).sort() : [];
    if (!files.length && opts.expectPreview) issues.warn('video.none', `${locale}: App Preview yok.`, { locale });
    const perDevice = new Map<string, number>();
    for (const f of files) {
      const m = PREVIEW_RE.exec(f);
      if (!m) {
        issues.error('video.name', `${locale}/${f}: dosya adı NN_<CİHAZ>.mp4 olmalı (ör. 01_IPHONE_67.mp4).`, { locale });
        continue;
      }
      perDevice.set(m[2]!, (perDevice.get(m[2]!) ?? 0) + 1);
      const target = previewTargets.find((t) => (m[2]!.startsWith('IPAD') ? t.family === 'ipad' : t.family === 'iphone'));
      if (!target) {
        issues.error('video.disabled-target', `${locale}/${f}: bu cihaz için önizleme hedefi etkin değil (targets.enable); deliver yine de yükler.`, { locale });
        continue;
      }
      const probe = await ffprobe(join(dir, f));
      issues.push(...checkVideo(probe, target, `${locale}/${f}`).items.map((i) => ({ ...i, locale })));
    }
    for (const [dev, n] of perDevice) if (n > MAX_PREVIEWS) issues.error('video.too-many', `${locale}: ${dev} için ${n} önizleme; en çok ${MAX_PREVIEWS}.`, { locale });
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
