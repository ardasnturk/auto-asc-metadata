import { ensureDir, existsSync, log, writeJson, writeText, type AppPaths } from '@vitrin/core';
import type { ArtDirection, ArtDirectionOption, Badge, CreativeSpec, RenderManifest, RenderTarget, ShotList } from '@vitrin/schemas';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { contrastRatio, luminance } from './color.js';
import { buildPage, MEASURE_SCRIPT, type PageInput, type ScreenImage } from './layout.js';

export const SHOT_FILE_RE = /^(\d{2})_([a-z0-9-]+)_([a-z0-9.-]+)\.(png|jpe?g)$/;

export function familyOfTarget(t: RenderTarget): 'iphone' | 'ipad' | 'duo' {
  if (t.family === 'ipad') return 'ipad';
  if (t.family === 'duo') return 'duo';
  return 'iphone';
}

export interface RenderOptions {
  paths: AppPaths;
  locales: string[];
  primaryLocale: string;
  targets: RenderTarget[];
  artDirection: ArtDirection;
  shots: ShotList;
  /** Only render these shot ids (default: all). */
  onlyShots?: string[];
  /** Absolute path of the app icon (statement slides). */
  appIcon?: string;
}

export interface RenderResult {
  manifest: RenderManifest;
  warnings: string[];
}

export function selectedOption(ad: ArtDirection): ArtDirectionOption {
  const opt = ad.options.find((o) => o.id === ad.selected);
  if (!opt) throw new Error(`art-direction.json: selected “${ad.selected}” seçeneklerde yok.`);
  return opt;
}

/** Minimum WCAG contrast of the caption text against every background color stop. */
export function paletteContrast(ad: ArtDirectionOption): number {
  const bgs = ad.palette.background;
  const text = Math.min(...bgs.map((b) => contrastRatio(ad.palette.text, b)));
  const muted = Math.min(...bgs.map((b) => contrastRatio(ad.palette.textMuted, b)));
  const badge = contrastRatio(ad.palette.badgeText, ad.palette.badgeBackground);
  return Math.min(text, muted, badge);
}

export class RawLibrary {
  private aspectCache = new Map<string, number>();
  readonly warnings: string[] = [];

  constructor(
    private readonly paths: AppPaths,
    private readonly primaryLocale: string,
  ) {}

  /** Resolve a raw capture with fallbacks: same family → iPhone capture → primary locale. */
  async get(locale: string, family: 'iphone' | 'ipad' | 'duo', id: string): Promise<ScreenImage> {
    const candidates: Array<[string, 'iphone' | 'ipad' | 'duo', string]> = [
      [locale, family, ''],
      [locale, 'iphone', family !== 'iphone' ? `${family} yakalaması yok, iPhone görüntüsü kullanıldı` : ''],
      [this.primaryLocale, family, `${locale} yakalaması yok, ${this.primaryLocale} kullanıldı (dil uyuşmazlığı!)`],
      [this.primaryLocale, 'iphone', `${locale}/${family} yakalaması yok, ${this.primaryLocale}/iphone kullanıldı (dil uyuşmazlığı!)`],
    ];
    for (const [loc, fam, warning] of candidates) {
      const file = this.paths.rawShot(loc, fam, id);
      if (existsSync(file)) {
        if (warning) this.warn(`${id}: ${warning}`);
        let aspect = this.aspectCache.get(file);
        if (!aspect) {
          const m = await sharp(file).metadata();
          aspect = (m.height ?? 1) / (m.width ?? 1);
          this.aspectCache.set(file, aspect);
        }
        return { src: pathToFileURL(file).href, aspect, family: fam };
      }
    }
    throw new Error(`Ham ekran görüntüsü yok: ${id} (${locale}/${family}). Önce \`vitrin capture\` çalıştır.`);
  }

  private warn(msg: string): void {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }
}

async function renderOne(page: Page, html: string, htmlFile: string, out: string, target: RenderTarget, background: string) {
  await writeText(htmlFile, html);
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
  });
  const measured = (await page.evaluate(MEASURE_SCRIPT)) as { overflow: string[]; headlineCssPx: number; headlineLines: number; safeAreaViolations: string[] };
  const png = await page.screenshot({ type: 'png', fullPage: false });
  await ensureDir(join(out, '..'));
  // App Store rejects alpha: flatten onto the background colour and drop the channel.
  await sharp(png).flatten({ background }).removeAlpha().png({ compressionLevel: 9 }).toFile(out);
  const meta = await sharp(out).metadata();
  if (meta.width !== target.width || meta.height !== target.height) {
    throw new Error(`Render boyutu hatalı: ${out} ${meta.width}×${meta.height}, beklenen ${target.width}×${target.height}`);
  }
  if (meta.hasAlpha) throw new Error(`Alfa kanalı kaldırılamadı: ${out}`);
  const minContrast = await measureTextContrast(page, target.logical.scale);
  return { ...measured, minContrast };
}

const TEXT_CONTRAST_SCRIPT = `(() => [...document.querySelectorAll('.headline, .subheadline, .stat')].map((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, color: getComputedStyle(el).color };
}).filter((r) => r.w > 0 && r.h > 0))()`;

function cssColorToHex(c: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

/**
 * Real contrast of caption text against what is actually behind it: hide the text, screenshot, sample the
 * pixels under each text box and compare the text colour with the background luminance at the unfavourable
 * 95th percentile (5th for dark text). Returns the worst ratio.
 */
async function measureTextContrast(page: Page, scale: number): Promise<number> {
  const boxes = (await page.evaluate(TEXT_CONTRAST_SCRIPT)) as Array<{ x: number; y: number; w: number; h: number; color: string }>;
  if (!boxes.length) return 21;
  await page.evaluate(`document.querySelectorAll('.caption').forEach((e) => (e.style.visibility = 'hidden'))`);
  const bg = await page.screenshot({ type: 'png' });
  await page.evaluate(`document.querySelectorAll('.caption').forEach((e) => (e.style.visibility = ''))`);
  const img = sharp(bg).removeAlpha();
  const meta = await sharp(bg).metadata();
  let worst = 21;
  for (const b of boxes) {
    const left = Math.max(0, Math.floor(b.x * scale));
    const top = Math.max(0, Math.floor(b.y * scale));
    const width = Math.min((meta.width ?? 0) - left, Math.ceil(b.w * scale));
    const height = Math.min((meta.height ?? 0) - top, Math.ceil(b.h * scale));
    if (width <= 0 || height <= 0) continue;
    const { data, info } = await img.clone().extract({ left, top, width, height }).resize({ width: Math.min(width, 200), fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    const lums: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) {
      const hex = '#' + [data[i]!, data[i + 1]!, data[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
      lums.push(luminance(hex));
    }
    lums.sort((a, b2) => a - b2);
    const text = luminance(cssColorToHex(b.color));
    const median = lums[Math.floor(lums.length / 2)]!;
    const edge = text > median ? lums[Math.floor(lums.length * 0.95)]! : lums[Math.floor(lums.length * 0.05)]!;
    const [hi, lo] = text > edge ? [text, edge] : [edge, text];
    worst = Math.min(worst, (hi + 0.05) / (lo + 0.05));
  }
  return worst;
}

export async function renderDesign(opts: RenderOptions): Promise<RenderResult> {
  const { paths, artDirection, shots } = opts;
  const ad = selectedOption(artDirection);
  const raw = new RawLibrary(paths, opts.primaryLocale);
  // Badge text sits on a solid badge colour, so its contrast is exact from the palette.
  const badgeContrast = contrastRatio(ad.palette.badgeText, ad.palette.badgeBackground);
  const images: RenderManifest['images'] = [];
  const htmlDir = join(paths.cache, 'html');
  const shotTargets = opts.targets.filter((t) => t.kind === 'screenshot');
  const creativeTargets = opts.targets.filter((t) => t.kind === 'creative' || t.kind === 'event');
  const list = shots.shots.filter((s) => !opts.onlyShots || opts.onlyShots.includes(s.id)).sort((a, b) => a.id.localeCompare(b.id));
  const panoramaIndex = new Map(list.map((s, i) => [s.id, i]));

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    for (const target of shotTargets) {
      const context = await browser.newContext({ viewport: { width: target.logical.width, height: target.logical.height }, deviceScaleFactor: target.logical.scale });
      const page = await context.newPage();
      for (const locale of opts.locales) {
        const outDir = join(paths.screenshots, locale);
        await ensureDir(outDir);
        if (!opts.onlyShots) await removeStale(outDir, target.id);
        for (const shot of list) {
          if (shot.targets && !shot.targets.includes(target.id)) continue;
          const copy = shot.copy[locale];
          if (!copy) throw new Error(`shots.json: ${shot.id} için ${locale} metni yok.`);
          const screens = await Promise.all(shot.screens.map((id) => raw.get(locale, familyOfTarget(target), id)));
          const input: PageInput = {
            target,
            locale,
            ad,
            archetype: shot.archetype,
            headline: copy.headline,
            subheadline: copy.subheadline,
            badges: shot.badges,
            stat: shot.stat?.value,
            kicker: copy.kicker,
            captionPosition: shot.captionPosition,
            callouts: shot.callouts,
            quotes: shot.quotes[locale] ?? [],
            icon: opts.appIcon && existsSync(opts.appIcon) ? pathToFileURL(opts.appIcon).href : undefined,
            screens,
            panorama: { index: panoramaIndex.get(shot.id) ?? 0, total: list.length },
          };
          const name = `${shot.id}_${shot.slug}_${target.id}.png`;
          const out = join(outDir, name);
          const m = await renderOne(page, buildPage(input), join(htmlDir, locale, target.id, `${shot.id}.html`), out, target, ad.palette.background[0]!);
          const headlinePx = m.headlineCssPx * target.logical.scale;
          const idx = list.indexOf(shot);
          images.push({
            file: out,
            target: target.id,
            locale,
            shot: shot.id,
            width: target.width,
            height: target.height,
            overflow: m.overflow,
            headlinePx,
            headlineLines: m.headlineLines,
            minContrast: Math.min(m.minContrast, badgeContrast),
            safeAreaViolations: m.safeAreaViolations,
            // First three shots are what search results show: check legibility at 25 %.
            thumbnailLegible: idx < 3 ? (headlinePx * 0.25) / (target.width / 1206) >= 22 : undefined,
          });
          log.dim(`  ${locale} ${target.id} ${name}${m.overflow.length ? '  ⚠ taşma' : ''}`);
        }
      }
      await context.close();
    }

    // Creatives (product page header 21:9, search 3:2, in-app events)
    for (const target of creativeTargets) {
      const specs: Array<{ key: string; spec: CreativeSpec }> = [];
      if (target.id === 'header' && shots.creatives.header) specs.push({ key: 'header', spec: shots.creatives.header });
      if (target.id === 'search' && shots.creatives.search) specs.push({ key: 'search', spec: shots.creatives.search });
      for (const e of shots.creatives.events) {
        if (target.id === 'event-card') specs.push({ key: `event-${e.id}-card`, spec: e.card });
        if (target.id === 'event-detail') specs.push({ key: `event-${e.id}-detail`, spec: e.detail });
      }
      if (!specs.length) continue;
      const context = await browser.newContext({ viewport: { width: target.logical.width, height: target.logical.height }, deviceScaleFactor: target.logical.scale });
      const page = await context.newPage();
      for (const locale of opts.locales) {
        for (const { key, spec } of specs) {
          const copy = spec.copy[locale];
          if (!copy) throw new Error(`shots.json creatives.${key}: ${locale} metni yok.`);
          const screens = await Promise.all(spec.screens.map((id) => raw.get(locale, 'iphone', id)));
          const input: PageInput = { target, locale, ad, archetype: 'hero', headline: copy.headline, subheadline: copy.subheadline, kicker: copy.kicker, badges: spec.badges as Badge[], screens };
          const out = join(paths.creative, locale, `${target.id}_${key}.png`);
          const m = await renderOne(page, buildPage(input), join(htmlDir, locale, target.id, `${key}.html`), out, target, ad.palette.background[0]!);
          images.push({ file: out, target: target.id, locale, shot: key, width: target.width, height: target.height, overflow: m.overflow, headlinePx: m.headlineCssPx * target.logical.scale, minContrast: Math.min(m.minContrast, badgeContrast), safeAreaViolations: m.safeAreaViolations });
          log.dim(`  ${locale} ${target.id} ${key}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser?.close();
  }

  // Keep videos from the last `vitrin video` run, and images of shots not re-rendered with --only.
  const previous = existsSync(paths.renderManifest) ? (JSON.parse(await readFile(paths.renderManifest, 'utf8')) as RenderManifest) : undefined;
  const rendered = new Set(images.map((i) => i.file));
  const kept = opts.onlyShots ? (previous?.images ?? []).filter((i) => !rendered.has(i.file) && existsSync(i.file)) : [];
  const manifest: RenderManifest = { generatedAt: new Date().toISOString(), artDirection: ad.id, images: [...kept, ...images], videos: previous?.videos ?? [] };
  await writeJson(paths.renderManifest, manifest);
  await writeThumbnails(paths, images.filter((i) => SHOT_FILE_RE.test(i.file.split('/').pop() ?? '')));
  return { manifest, warnings: raw.warnings };
}

async function removeStale(dir: string, targetId: string): Promise<void> {
  for (const f of await readdir(dir)) {
    const m = SHOT_FILE_RE.exec(f);
    if (m && m[3] === targetId) await rm(join(dir, f));
  }
}

/** 25 % thumbnails used by the review report (search-result legibility). */
async function writeThumbnails(paths: AppPaths, images: RenderManifest['images']): Promise<void> {
  for (const img of images) {
    const out = join(paths.cache, 'thumbs', img.locale, img.file.split('/').pop()!.replace(/\.png$/, '.jpg'));
    await ensureDir(join(out, '..'));
    await sharp(img.file).resize(Math.round(img.width * 0.25)).jpeg({ quality: 82 }).toFile(out);
  }
}
