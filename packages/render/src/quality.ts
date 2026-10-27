/**
 * Quality-bar measurements on the rendered page: contrast against the worst background pixel under the
 * headline glyphs, and the thumbnail test (downscaled to App Store search-result size).
 */
import { QUALITY_BAR } from '@vitrin/schemas';
import type { Page } from 'playwright';
import sharp from 'sharp';
import { hexToRgb, luminance, luminanceRgb, ratioFromLuminance } from './color.js';

export interface WordBox {
  x: number;
  y: number;
  w: number;
  h: number;
  colors: string[];
  role: 'headline' | 'support';
}

export interface GlyphContrast {
  headline: number;
  support?: number;
  /** Per-word worst contrast, for debugging. */
  words: number[];
  thumbnail: { width: number; headlinePx: number; contrast: number; legible: boolean };
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

async function shot(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<Raw> {
  const png = await page.screenshot({ type: 'png', clip });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Low percentile of a list (robust "worst" that ignores a stray grain pixel or two). */
function percentile(values: number[], p: number): number {
  if (!values.length) return 21;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/**
 * Renders the caption region twice — text fill hidden (the real background, plates and highlighter bands stay)
 * and text filled with pure magenta — so the difference is an exact glyph mask. Each word's colors are compared
 * with the background pixels inside its own glyph interiors. `finalPng` is the shipped image for the thumbnail test.
 */
export async function measureGlyphContrast(page: Page, words: WordBox[], scale: number, targetWidth: number, headlineCssPx: number, finalPng: Buffer): Promise<GlyphContrast> {
  const thumbW = QUALITY_BAR.thumbnailWidth;
  const headlinePx = headlineCssPx * scale * (thumbW / targetWidth);
  const empty: GlyphContrast = { headline: 21, words: [], thumbnail: { width: thumbW, headlinePx, contrast: 21, legible: headlinePx >= QUALITY_BAR.thumbnailMinHeadlinePx || headlineCssPx === 0 } };
  if (!words.length) return empty;
  const vw = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.clientHeight] as [number, number]);
  const x0 = Math.max(0, Math.floor(Math.min(...words.map((w) => w.x)) - 2));
  const y0 = Math.max(0, Math.floor(Math.min(...words.map((w) => w.y)) - 2));
  const x1 = Math.min(vw[0], Math.ceil(Math.max(...words.map((w) => w.x + w.w)) + 2));
  const y1 = Math.min(vw[1], Math.ceil(Math.max(...words.map((w) => w.y + w.h)) + 2));
  if (x1 <= x0 || y1 <= y0) return empty;
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  await page.evaluate(() => document.body.classList.add('vq-hide'));
  const bg = await shot(page, clip);
  await page.evaluate(() => {
    document.body.classList.remove('vq-hide');
    document.body.classList.add('vq-mask');
  });
  const mask = await shot(page, clip);
  await page.evaluate(() => document.body.classList.remove('vq-mask'));

  const alpha = new Uint8Array(bg.width * bg.height);
  for (let i = 0, p = 0; p < alpha.length; p++, i += bg.channels) {
    const br = bg.data[i]!;
    const bgc = bg.data[i + 1]!;
    const bb = bg.data[i + 2]!;
    // Magenta over this pixel: red and blue rise, green falls. Coverage = observed shift / full shift.
    const full = 255 - br + (255 - bb) + 2 * bgc;
    const seen = mask.data[i]! - br + (mask.data[i + 2]! - bb) - 2 * (mask.data[i + 1]! - bgc);
    alpha[p] = full > 30 ? Math.max(0, Math.min(255, Math.round((seen / full) * 255))) : 0;
  }

  const perWord: number[] = [];
  const byRole: Record<'headline' | 'support', number[]> = { headline: [], support: [] };
  const lumCache = new Map<string, number>();
  const lumOf = (c: string) => {
    let v = lumCache.get(c);
    if (v === undefined) {
      v = /^#[0-9a-f]{6}$/i.test(c) ? luminance(c) : luminance('#000000');
      lumCache.set(c, v);
    }
    return v;
  };
  for (const w of words) {
    const colors = w.colors.length ? w.colors : ['#000000'];
    const L0 = Math.max(0, Math.floor((w.x - x0) * scale));
    const T0 = Math.max(0, Math.floor((w.y - y0) * scale));
    const R0 = Math.min(bg.width, Math.ceil((w.x + w.w - x0) * scale));
    const B0 = Math.min(bg.height, Math.ceil((w.y + w.h - y0) * scale));
    const ratios: number[] = [];
    for (let y = T0; y < B0; y++) {
      for (let x = L0; x < R0; x++) {
        const p = y * bg.width + x;
        if (alpha[p]! < 230) continue;
        const i = p * bg.channels;
        const lb = luminanceRgb(bg.data[i]!, bg.data[i + 1]!, bg.data[i + 2]!);
        let worst = 21;
        for (const c of colors) worst = Math.min(worst, ratioFromLuminance(lumOf(c), lb));
        ratios.push(worst);
      }
    }
    if (ratios.length < 12) continue;
    const r = percentile(ratios, 0.005);
    perWord.push(r);
    byRole[w.role].push(r);
  }

  // Thumbnail test: downscale the shipped image and the glyph mask to search-result size.
  const f = thumbW / targetWidth;
  const tw = Math.max(2, Math.round(bg.width * f));
  const th = Math.max(2, Math.round(bg.height * f));
  const L = Math.round(x0 * scale);
  const T = Math.round(y0 * scale);
  const meta = await sharp(finalPng).metadata();
  const region = { left: Math.min(L, (meta.width ?? 1) - 1), top: Math.min(T, (meta.height ?? 1) - 1), width: Math.min(bg.width, (meta.width ?? 0) - L), height: Math.min(bg.height, (meta.height ?? 0) - T) };
  let thumbContrast = 21;
  if (region.width > 2 && region.height > 2) {
    const img = await sharp(finalPng).removeAlpha().extract(region).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    // Only headline words go into the thumbnail mask.
    const headAlpha = Buffer.alloc(bg.width * bg.height);
    for (const w of words.filter((x) => x.role === 'headline')) {
      const L0 = Math.max(0, Math.floor((w.x - x0) * scale));
      const T0 = Math.max(0, Math.floor((w.y - y0) * scale));
      const R0 = Math.min(bg.width, Math.ceil((w.x + w.w - x0) * scale));
      const B0 = Math.min(bg.height, Math.ceil((w.y + w.h - y0) * scale));
      for (let y = T0; y < B0; y++) for (let x = L0; x < R0; x++) headAlpha[y * bg.width + x] = alpha[y * bg.width + x]!;
    }
    const m = await sharp(headAlpha, { raw: { width: bg.width, height: bg.height, channels: 1 } })
      .extract({ left: 0, top: 0, width: region.width, height: region.height })
      .resize(tw, th, { fit: 'fill', kernel: 'cubic' })
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
    // Ink against the ground around it, word by word: a boxed or highlighted word has its own ground, and one
    // median over the whole headline would mix the plate with the page.
    const sample = (bx: { x0: number; y0: number; x1: number; y1: number }) => {
      const ink: number[] = [];
      const ground: number[] = [];
      for (let y = Math.max(0, bx.y0); y < Math.min(th, bx.y1); y++) {
        for (let x = Math.max(0, bx.x0); x < Math.min(tw, bx.x1); x++) {
          const p = y * tw + x;
          const i = p * img.info.channels;
          const l = luminanceRgb(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!);
          const a = m.data[p * m.info.channels]!;
          if (a >= 170) ink.push(l);
          else if (a <= 8) ground.push(l);
        }
      }
      return ink.length >= 3 && ground.length >= 3 ? ratioFromLuminance(med(ink), med(ground)) : undefined;
    };
    const k = tw / bg.width;
    const perWordThumb = words
      .filter((w) => w.role === 'headline')
      .map((w) => sample({ x0: Math.floor((w.x - x0) * scale * k) - 1, y0: Math.floor((w.y - y0) * scale * k) - 1, x1: Math.ceil((w.x + w.w - x0) * scale * k) + 1, y1: Math.ceil((w.y + w.h - y0) * scale * k) + 1 }))
      .filter((r): r is number => r !== undefined);
    const whole = sample({ x0: 0, y0: 0, x1: tw, y1: th });
    if (perWordThumb.length) thumbContrast = Math.min(...perWordThumb);
    else if (whole !== undefined) thumbContrast = whole;
  }
  const headline = byRole.headline.length ? Math.min(...byRole.headline) : 21;
  return {
    headline,
    support: byRole.support.length ? Math.min(...byRole.support) : undefined,
    words: perWord,
    thumbnail: { width: thumbW, headlinePx, contrast: thumbContrast, legible: headlinePx >= QUALITY_BAR.thumbnailMinHeadlinePx && thumbContrast >= QUALITY_BAR.thumbnailMinContrast },
  };
}

/** Exposed for tests: the coverage of magenta over a background pixel (0–255). */
export function magentaCoverage(bgHex: string, observedHex: string): number {
  const [br, bgc, bb] = hexToRgb(bgHex);
  const [mr, mg, mb] = hexToRgb(observedHex);
  const full = 255 - br + (255 - bb) + 2 * bgc;
  const seen = mr - br + (mb - bb) - 2 * (mg - bgc);
  return full > 30 ? Math.max(0, Math.min(255, Math.round((seen / full) * 255))) : 0;
}
