import { ensureDir, existsSync, loadTargets, writeJson, writeText } from '@vitrin/core';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Browser } from 'playwright';
import sharp from 'sharp';
import { esc } from './components.js';
import { DeviceFrame, deviceGeometry, type DeviceFamily, type DeviceFinish, type FrameVariant } from './frames.js';
import { launchChromium } from './renderer.js';

/**
 * Ready-made device mockups: every device Vitrin renders for, drawn by the same HTML/CSS frames the screenshot
 * layouts use (frames.ts), so a mockup and a finished screenshot always show the same hardware. `vitrin mockups`
 * renders the empty templates (transparent PNG + the screen rectangle in mockups.json, usable by any tool) and
 * places the app's rendered screens (metadata/raw) into them.
 */

/** The screenshot format whose logical size is the device screen of each family (the HTML screen viewport). */
export const SCREEN_TARGET: Record<DeviceFamily, string> = {
  iphone: 'iphone-6.9',
  ipad: 'ipad-13',
  duo: 'duo-inner',
  mac: 'mac-16x10',
  watch: 'watch-ultra',
  tv: 'appletv-4k',
  vision: 'vision-pro',
  'android-phone': 'play-phone',
  'android-tablet': 'play-tablet-10',
};

export interface MockupSpec {
  id: string;
  label: string;
  family: DeviceFamily;
  /** Format whose screen size the mockup's screen has. */
  screenTarget: string;
  /** Raw screen family placed into it (metadata/raw/<locale>/<family>/). */
  rawFamily: DeviceFamily;
  variant?: FrameVariant;
  finish?: DeviceFinish;
  /** Two devices in one image: the open inner display with the closed outer one in front. */
  pair?: 'duo';
}

export const MOCKUPS: MockupSpec[] = [
  { id: 'iphone', label: 'iPhone 6.9" — titanium', family: 'iphone', screenTarget: 'iphone-6.9', rawFamily: 'iphone', finish: 'titanium' },
  { id: 'iphone-graphite', label: 'iPhone 6.9" — graphite', family: 'iphone', screenTarget: 'iphone-6.9', rawFamily: 'iphone', finish: 'graphite' },
  { id: 'ipad', label: 'iPad 13"', family: 'ipad', screenTarget: 'ipad-13', rawFamily: 'ipad', finish: 'silver' },
  { id: 'duo-closed', label: 'iPhone Duo — closed (outer display)', family: 'duo', screenTarget: 'duo-outer', rawFamily: 'iphone', variant: { duo: 'outer' } },
  { id: 'duo-open', label: 'iPhone Duo — open (inner display)', family: 'duo', screenTarget: 'duo-inner', rawFamily: 'duo', variant: { duo: 'inner' } },
  { id: 'duo-pair', label: 'iPhone Duo — open and closed', family: 'duo', screenTarget: 'duo-inner', rawFamily: 'duo', variant: { duo: 'inner' }, pair: 'duo' },
  { id: 'watch', label: 'Apple Watch Ultra', family: 'watch', screenTarget: 'watch-ultra', rawFamily: 'watch', finish: 'titanium' },
  { id: 'watch-black', label: 'Apple Watch — black', family: 'watch', screenTarget: 'watch-series', rawFamily: 'watch', finish: 'black' },
  { id: 'mac', label: 'MacBook', family: 'mac', screenTarget: 'mac-16x10', rawFamily: 'mac', variant: { mac: 'laptop' }, finish: 'silver' },
  { id: 'mac-window', label: 'Mac — app window', family: 'mac', screenTarget: 'mac-16x10', rawFamily: 'mac', variant: { mac: 'window' } },
  { id: 'tv', label: 'Apple TV', family: 'tv', screenTarget: 'appletv-4k', rawFamily: 'tv', variant: { tv: 'bezel' } },
  { id: 'vision', label: 'Apple Vision Pro window', family: 'vision', screenTarget: 'vision-pro', rawFamily: 'vision' },
  { id: 'android-phone', label: 'Android phone', family: 'android-phone', screenTarget: 'play-phone', rawFamily: 'android-phone', finish: 'black' },
  { id: 'android-phone-silver', label: 'Android phone — silver', family: 'android-phone', screenTarget: 'play-phone', rawFamily: 'android-phone', finish: 'silver' },
  { id: 'android-tablet', label: 'Android tablet', family: 'android-tablet', screenTarget: 'play-tablet-10', rawFamily: 'android-tablet', finish: 'black' },
];

export function mockupSpec(id: string): MockupSpec {
  const m = MOCKUPS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown mockup: ${id}. Available: ${MOCKUPS.map((x) => x.id).join(', ')}`);
  return m;
}

function screenSize(spec: MockupSpec): { width: number; height: number; scale: number } {
  const t = loadTargets().find((x) => x.id === spec.screenTarget);
  if (!t) throw new Error(`No format ${spec.screenTarget}`);
  return t.logical;
}

/** Outer device width (CSS px) whose screen is `screenWidth` wide. */
function deviceWidthFor(spec: MockupSpec, screenWidth: number, aspect: number): number {
  const probe = deviceGeometry(spec.family, 1000, aspect, spec.variant);
  return (screenWidth / probe.screen.w) * 1000;
}

export interface MockupLayout {
  html: string;
  /** Screen rectangle(s) in CSS px of the page, before the tight crop. */
  screens: Array<{ x: number; y: number; w: number; h: number; r: number }>;
  width: number;
  height: number;
}

/**
 * The page for one mockup with `src` (and `secondSrc`, the closed display of a Duo pair) on its screen.
 * `aspect` is the screen image's height / width; a template uses the format's own aspect.
 */
export function mockupPage(spec: MockupSpec, src: string, aspect: number, opts: { secondSrc?: string; secondAspect?: number; background?: string } = {}): MockupLayout {
  const logical = screenSize(spec);
  const width = deviceWidthFor(spec, logical.width, aspect);
  const g = deviceGeometry(spec.family, width, aspect, spec.variant);
  const pad = Math.round(width * 0.12);
  const parts: string[] = [];
  const screens: MockupLayout['screens'] = [];
  parts.push(DeviceFrame({ family: spec.family, width, aspect, src, finish: spec.finish, variant: spec.variant, style: `left:${pad}px;top:${pad}px;` }));
  screens.push({ x: pad + g.screen.x, y: pad + g.screen.y, w: g.screen.w, h: g.screen.h, r: g.screen.r });
  let W = width + pad * 2;
  let H = g.height + pad * 2;
  if (spec.pair === 'duo') {
    // The closed phone stands in front of the open one, lower right, at the outer display's real size.
    const outer = mockupSpec('duo-closed');
    const oAspect = opts.secondAspect ?? screenSize(outer).height / screenSize(outer).width;
    const ow = deviceWidthFor(outer, screenSize(outer).width, oAspect) * 0.62;
    const og = deviceGeometry('duo', ow, oAspect, outer.variant);
    const ox = pad + width - ow * 0.45;
    const oy = pad + g.height - og.height * 0.82;
    parts.push(DeviceFrame({ family: 'duo', width: ow, aspect: oAspect, src: opts.secondSrc ?? src, finish: spec.finish, variant: outer.variant, shadow: 'drop-shadow(0 24px 40px rgba(0,0,0,.35))', style: `left:${ox}px;top:${oy}px;` }));
    screens.push({ x: ox + og.screen.x, y: oy + og.screen.y, w: og.screen.w, h: og.screen.h, r: og.screen.r });
    W = Math.max(W, ox + ow + pad);
    H = Math.max(H, oy + og.height + pad);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${Math.ceil(W)}px;height:${Math.ceil(H)}px;background:${opts.background ?? 'transparent'};overflow:hidden}</style></head><body>${parts.join('\n')}</body></html>`;
  return { html, screens, width: Math.ceil(W), height: Math.ceil(H) };
}

/** Placeholder screen for the empty templates: one flat tone, so the screen area is obvious and the PNG small. */
function placeholderScreen(w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#DDE2EE"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Renders a mockup page and crops it tightly to the device pixels (transparent PNG). */
async function shoot(browser: Browser, layout: MockupLayout, scale: number, out: string): Promise<{ crop: { x: number; y: number; width: number; height: number } }> {
  const page = await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: scale });
  try {
    await page.setContent(layout.html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((res) => (img.onload = img.onerror = res)))));
    });
    // Union of every painted element of the devices (buttons, straps and stands stick out of the frame box).
    const box = await page.evaluate(() => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el of document.querySelectorAll('.device, .device *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).filter.includes('blur')) continue; // rim-light glow, not hardware
        x0 = Math.min(x0, r.left);
        y0 = Math.min(y0, r.top);
        x1 = Math.max(x1, r.right);
        y1 = Math.max(y1, r.bottom);
      }
      return { x: Math.max(0, Math.floor(x0)), y: Math.max(0, Math.floor(y0)), width: Math.ceil(x1 - Math.max(0, Math.floor(x0))), height: Math.ceil(y1 - Math.max(0, Math.floor(y0))) };
    });
    await ensureDir(join(out, '..'));
    await page.screenshot({ path: out, type: 'png', omitBackground: true, clip: box });
    return { crop: box };
  } finally {
    await page.close();
  }
}

export interface MockupTemplate {
  id: string;
  label: string;
  file: string;
  width: number;
  height: number;
  /** Where a screen image goes, in pixels of `file` (first = main display; Duo pair: second = closed display). */
  screens: Array<{ x: number; y: number; width: number; height: number; radius: number }>;
}

/** Empty templates (transparent PNG + screen rectangles) for every mockup, a mockups.json and an index.html. */
export async function renderMockupTemplates(outDir: string, opts: { ids?: string[]; maxSide?: number } = {}): Promise<MockupTemplate[]> {
  const specs = opts.ids?.length ? opts.ids.map(mockupSpec) : MOCKUPS;
  const out: MockupTemplate[] = [];
  const browser = await launchChromium();
  try {
    for (const spec of specs) {
      const logical = screenSize(spec);
      const aspect = logical.height / logical.width;
      const outerLogical = spec.pair ? screenSize(mockupSpec('duo-closed')) : undefined;
      const layout = mockupPage(spec, placeholderScreen(logical.width, logical.height), aspect, outerLogical ? { secondSrc: placeholderScreen(outerLogical.width, outerLogical.height) } : {});
      const scale = Math.min(logical.scale, (opts.maxSide ?? 2400) / Math.max(layout.width, layout.height));
      const file = join(outDir, `${spec.id}.png`);
      const { crop } = await shoot(browser, layout, scale, file);
      const meta = await sharp(file).metadata();
      const k = (meta.width ?? crop.width) / crop.width;
      out.push({
        id: spec.id,
        label: spec.label,
        file,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        screens: layout.screens.map((s) => ({ x: Math.round((s.x - crop.x) * k), y: Math.round((s.y - crop.y) * k), width: Math.round(s.w * k), height: Math.round(s.h * k), radius: Math.round(s.r * k) })),
      });
    }
  } finally {
    await browser.close();
  }
  await writeJson(join(outDir, 'mockups.json'), { generator: 'vitrin', mockups: out.map((m) => ({ ...m, file: relative(outDir, m.file).split(sep).join('/') })) });
  await writeText(join(outDir, 'index.html'), galleryHtml(outDir, out.map((m) => ({ title: m.label, sub: m.id, file: m.file }))));
  return out;
}

export interface ComposedMockup {
  mockup: string;
  locale: string;
  screen: string;
  file: string;
}

/**
 * The app's rendered screens placed into every mockup of their device family:
 * `<outDir>/<locale>/<mockup>/<screen>.png` (transparent, full resolution) and an index.html to browse them.
 */
export async function composeScreenMockups(rawDir: string, outDir: string, opts: { locales?: string[]; mockups?: string[]; screens?: string[] } = {}): Promise<ComposedMockup[]> {
  if (!existsSync(rawDir)) return [];
  const specs = opts.mockups?.length ? opts.mockups.map(mockupSpec) : MOCKUPS.filter((m) => !m.id.endsWith('-graphite') && !m.id.endsWith('-black') && !m.id.endsWith('-silver'));
  const out: ComposedMockup[] = [];
  const locales = (await readdir(rawDir)).filter((l) => !opts.locales || opts.locales.includes(l)).sort();
  const browser = await launchChromium();
  try {
    for (const locale of locales) {
      for (const spec of specs) {
        const dir = join(rawDir, locale, spec.rawFamily);
        if (!existsSync(dir)) continue;
        for (const f of (await readdir(dir)).filter((x) => x.endsWith('.png')).sort()) {
          const id = f.slice(0, -4);
          if (opts.screens && !opts.screens.includes(id)) continue;
          const file = join(dir, f);
          const m = await sharp(file).metadata();
          const aspect = (m.height ?? 1) / (m.width ?? 1);
          // Duo pair: the closed display shows the iPhone render of the same screen when there is one.
          const closed = spec.pair ? join(rawDir, locale, 'iphone', f) : undefined;
          const closedAspect = closed && existsSync(closed) ? await sharp(closed).metadata().then((x) => (x.height ?? 1) / (x.width ?? 1)) : undefined;
          const layout = mockupPage(spec, await dataUrl(file), aspect, closed && closedAspect ? { secondSrc: await dataUrl(closed), secondAspect: closedAspect } : {});
          const target = join(outDir, locale, spec.id, `${id}.png`);
          await shoot(browser, layout, screenSize(spec).scale, target);
          out.push({ mockup: spec.id, locale, screen: id, file: target });
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (out.length) await writeText(join(outDir, 'index.html'), galleryHtml(outDir, out.map((c) => ({ title: `${c.screen} · ${mockupSpec(c.mockup).label}`, sub: c.locale, file: c.file }))));
  return out;
}

/** Inline PNG: the mockup page is set as content (about:blank), which may not load file:// URLs. */
async function dataUrl(file: string): Promise<string> {
  return `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
}

function galleryHtml(dir: string, items: Array<{ title: string; sub: string; file: string }>): string {
  const rel = (f: string) => relative(dir, f).split(sep).map(encodeURIComponent).join('/');
  const cards = items.map((i) => `<figure><div class="img"><img src="${rel(i.file)}" alt=""></div><figcaption><b>${esc(i.title)}</b><span>${esc(i.sub)}</span></figcaption></figure>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mockups</title><style>
  body{margin:0;padding:32px 24px;background:#F2F2F7;color:#1D1D1F;font:15px/1.4 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif}
  h1{margin:0 0 20px;font-size:28px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px}
  figure{margin:0;background:#fff;border-radius:18px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .img{height:300px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#F4F4F6 0 25%,#FFF 0 50%) 0 0/20px 20px;border-radius:12px}
  .img img{max-width:100%;max-height:100%}figcaption{margin-top:10px;display:flex;flex-direction:column}figcaption span{color:#6E6E73;font-size:13px}
  </style></head><body><h1>Mockups</h1><div class="grid">${cards}</div></body></html>`;
}
