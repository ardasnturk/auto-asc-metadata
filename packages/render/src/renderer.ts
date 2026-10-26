import { ensureDir, existsSync, log, writeJson, writeText, type AppPaths } from '@vitrin/core';
import { QUALITY_BAR, type ArtDirection, type ArtDirectionOption, type Badge, type CreativeSpec, type ImageQuality, type RenderManifest, type RenderTarget, type Shot, type ShotList, type StylePreset } from '@vitrin/schemas';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { contrastRatio } from './color.js';
import { CONTAINED_FAMILIES, type DeviceFamily } from './frames.js';
import { buildPage, frameFamily, MEASURE_SCRIPT, planFramings, type PageInput, type ScreenImage } from './layout.js';
import { measureGlyphContrast, type WordBox } from './quality.js';
import { PRESETS, resolveDirection, surfaceFor, type BrandTint, type ResolvedDirection } from './styles.js';

export const SHOT_FILE_RE = /^(\d{2})_([a-z0-9-]+)_([a-z0-9.-]+)\.(png|jpe?g)$/;

/**
 * Launches Playwright's Chromium. `VITRIN_CHROMIUM` points at an existing Chromium build when the pinned
 * Playwright browser is not installed (CI images that ship their own browser).
 */
export async function launchChromium(): Promise<Browser> {
  const exe = process.env.VITRIN_CHROMIUM;
  if (exe) return chromium.launch({ executablePath: exe });
  return chromium.launch();
}

/** Family of the raw captures a target is rendered from. */
export function familyOfTarget(t: RenderTarget): DeviceFamily {
  return t.family === 'any' ? 'iphone' : (t.family as DeviceFamily);
}

/** Capture fallbacks per family: the closest family first, the iPhone capture last. */
const FALLBACK: Record<DeviceFamily, DeviceFamily[]> = {
  iphone: [],
  ipad: ['iphone'],
  duo: ['iphone'],
  'android-phone': ['iphone'],
  'android-tablet': ['android-phone', 'ipad', 'iphone'],
  mac: ['ipad', 'iphone'],
  tv: ['mac', 'ipad', 'iphone'],
  vision: ['mac', 'ipad', 'iphone'],
  watch: ['iphone'],
};

export interface RenderOptions {
  paths: AppPaths;
  locales: string[];
  primaryLocale: string;
  targets: RenderTarget[];
  artDirection: ArtDirection;
  shots: ShotList;
  /** Only render these shot ids (default: all). */
  onlyShots?: string[];
  /** Absolute path of the app icon (statement slides, tags, feature graphic). */
  appIcon?: string;
  /** App name for wordmarks, index rows and mastheads (default: app_profile.json displayName). */
  appName?: string;
  /** Brand colors that tint presets (default: app_profile.json brand). */
  brand?: BrandTint;
}

export interface RenderResult {
  manifest: RenderManifest;
  warnings: string[];
}

/** The selected option, resolved onto its preset (tokens plus every legacy field). */
export function selectedOption(ad: ArtDirection, brand?: BrandTint): ResolvedDirection {
  const opt = ad.options.find((o) => o.id === ad.selected);
  if (!opt) throw new Error(`art-direction.json: selected “${ad.selected}” is not among the options.`);
  return resolveDirection(opt, brand);
}

/** Minimum WCAG contrast of the caption text against every background color stop. */
export function paletteContrast(ad: ArtDirectionOption | ResolvedDirection): number {
  const r = 'tokens' in ad ? (ad as ResolvedDirection) : resolveDirection(ad as ArtDirectionOption);
  const bgs = r.palette.background;
  const text = Math.min(...bgs.map((b) => contrastRatio(r.palette.text, b)));
  const muted = Math.min(...bgs.map((b) => contrastRatio(r.palette.textMuted, b)));
  const badge = contrastRatio(r.palette.badgeText, r.palette.badgeBackground);
  return Math.min(text, muted, badge);
}

export class RawLibrary {
  private aspectCache = new Map<string, number>();
  readonly warnings: string[] = [];

  constructor(
    private readonly paths: AppPaths,
    private readonly primaryLocale: string,
  ) {}

  /** Resolve a raw capture with fallbacks: same family → closest family → iPhone capture → primary locale. */
  async get(locale: string, family: DeviceFamily, id: string): Promise<ScreenImage> {
    const fams = [family, ...FALLBACK[family]];
    const candidates: Array<[string, DeviceFamily, string]> = [];
    for (const f of fams) candidates.push([locale, f, f !== family ? `no ${family} capture, used the ${f} capture` : '']);
    for (const f of fams) candidates.push([this.primaryLocale, f, `no ${locale}/${family} capture, used ${this.primaryLocale}/${f} (language mismatch!)`]);
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
    throw new Error(`Raw screenshot missing: ${id} (${locale}/${family}). Run \`vitrin capture\` first.`);
  }

  private warn(msg: string): void {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }
}

interface Measured {
  overflow: string[];
  headlineCssPx: number;
  headlineLines: number;
  safeAreaViolations: string[];
  deviceRatio: number;
  band: number;
  widest: number;
  layers: number;
  words: WordBox[];
}

export interface RenderedImage {
  overflow: string[];
  headlineCssPx: number;
  headlineLines: number;
  safeAreaViolations: string[];
  minContrast: number;
  quality: ImageQuality;
}

/** Renders one HTML page to an exact-size, alpha-free PNG and measures it. */
export async function renderOne(page: Page, html: string, htmlFile: string, out: string, target: RenderTarget, meta: { preset: string; framing: string; family: DeviceFamily; hasDevice: boolean }): Promise<RenderedImage> {
  await writeText(htmlFile, html);
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
  });
  const m = (await page.evaluate(MEASURE_SCRIPT)) as Measured;
  const png = await page.screenshot({ type: 'png', fullPage: false });
  await ensureDir(join(out, '..'));
  // App Store rejects alpha: flatten onto the page background and drop the channel.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const flat = await sharp(png).flatten({ background: cssColorToHex(bg) }).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
  await sharp(flat).toFile(out);
  const info = await sharp(out).metadata();
  if (info.width !== target.width || info.height !== target.height) {
    throw new Error(`Wrong render size: ${out} ${info.width}×${info.height}, expected ${target.width}×${target.height}`);
  }
  if (info.hasAlpha) throw new Error(`Could not remove the alpha channel: ${out}`);
  const glyph = await measureGlyphContrast(page, m.words, target.logical.scale, target.width, m.headlineCssPx, flat);
  const rule: ImageQuality['deviceRule'] = !meta.hasDevice || m.deviceRatio === 0 ? 'none' : CONTAINED_FAMILIES.has(meta.family) || target.width > target.height * 1.05 ? 'contained' : 'phone';
  const quality: ImageQuality = {
    preset: meta.preset,
    framing: meta.framing,
    deviceRule: rule,
    deviceHeightRatio: rule === 'none' ? undefined : round(m.deviceRatio),
    largestEmptyBand: round(m.band),
    widestWordRatio: round(m.widest),
    headlineContrast: round(glyph.headline),
    supportContrast: glyph.support !== undefined ? round(glyph.support) : undefined,
    layers: m.layers,
    thumbnail: { width: glyph.thumbnail.width, headlinePx: round(glyph.thumbnail.headlinePx), contrast: round(glyph.thumbnail.contrast), legible: glyph.thumbnail.legible },
  };
  return { overflow: m.overflow, headlineCssPx: m.headlineCssPx, headlineLines: m.headlineLines, safeAreaViolations: m.safeAreaViolations, minContrast: Math.min(glyph.headline, glyph.support ?? 21), quality };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function cssColorToHex(c: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
}

/** App name and brand from app_profile.json when the caller did not pass them. */
async function profileDefaults(paths: AppPaths): Promise<{ appName?: string; brand?: BrandTint }> {
  if (!existsSync(paths.profile)) return {};
  try {
    const p = JSON.parse(await readFile(paths.profile, 'utf8')) as { app?: { displayName?: string }; brand?: { accentColor?: string; colors?: Array<{ hex: string }> } };
    const primary = p.brand?.accentColor ?? p.brand?.colors?.[0]?.hex;
    const secondary = p.brand?.colors?.map((c) => c.hex).find((h) => h.toUpperCase() !== primary?.toUpperCase());
    return { appName: p.app?.displayName, brand: primary && /^#[0-9a-f]{6}$/i.test(primary) ? { primary, secondary: secondary && /^#[0-9a-f]{6}$/i.test(secondary) ? secondary : undefined } : undefined };
  } catch {
    return {};
  }
}

/** Set-level warnings: proof outside the hero, adjacent shots with the same explicit framing. */
export function setWarnings(shots: Shot[], framings: string[]): string[] {
  const w: string[] = [];
  shots.forEach((s, i) => {
    if (i > 0 && s.archetype !== 'social-proof' && s.archetype !== 'testimonial' && s.badges.some((b) => b.type === 'proof')) w.push(`${s.id}: proof badges belong on the first screenshot only (they dilute everywhere else).`);
    if (i > 0 && framings[i] === framings[i - 1] && framings[i] !== 'no-device' && framings[i] !== 'contained') w.push(`${shots[i - 1]!.id} and ${s.id} use the same framing (${framings[i]}); vary it so adjacent screenshots differ.`);
  });
  const bridges = shots.filter((s) => s.bridge).length;
  if (bridges > 2) w.push(`${bridges} cross-canvas bridges; use at most two per set.`);
  return w;
}

export async function renderDesign(opts: RenderOptions): Promise<RenderResult> {
  const { paths, artDirection, shots } = opts;
  const defaults = await profileDefaults(paths);
  const brand = opts.brand ?? defaults.brand;
  const appName = opts.appName ?? defaults.appName ?? '';
  const ad = selectedOption(artDirection, brand);
  const raw = new RawLibrary(paths, opts.primaryLocale);
  const images: RenderManifest['images'] = [];
  const warnings: string[] = [];
  const htmlDir = join(paths.cache, 'html');
  const shotTargets = opts.targets.filter((t) => t.kind === 'screenshot');
  const creativeTargets = opts.targets.filter((t) => t.kind === 'creative' || t.kind === 'event');
  const ordered = [...shots.shots].sort((a, b) => a.id.localeCompare(b.id));
  const list = ordered.filter((s) => !opts.onlyShots || opts.onlyShots.includes(s.id));
  const icon = opts.appIcon && existsSync(opts.appIcon) ? pathToFileURL(opts.appIcon).href : undefined;
  const badgeContrast = contrastRatio(ad.palette.badgeText, ad.palette.badgeBackground);

  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    for (const target of shotTargets) {
      const family = familyOfTarget(target);
      const framings = planFramings(ordered, ad.tokens, family);
      for (const w of setWarnings(ordered, framings)) if (!warnings.includes(w)) warnings.push(w);
      const context = await browser.newContext({ viewport: { width: target.logical.width, height: target.logical.height }, deviceScaleFactor: target.logical.scale });
      const page = await context.newPage();
      for (const locale of opts.locales) {
        const outDir = join(paths.screenshots, locale);
        await ensureDir(outDir);
        if (!opts.onlyShots) await removeStale(outDir, target.id);
        for (const shot of list) {
          if (shot.targets && !shot.targets.includes(target.id)) continue;
          const copy = shot.copy[locale];
          if (!copy) throw new Error(`shots.json: ${shot.id} has no ${locale} copy.`);
          const idx = ordered.indexOf(shot);
          const screens = await Promise.all(shot.screens.map((id) => raw.get(locale, family, id)));
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
            icon,
            screens,
            panorama: { index: idx, total: ordered.length },
            index: idx,
            total: ordered.length,
            framing: shot.captionPosition === 'bottom' && framings[idx] === 'bleed-bottom' ? 'bleed-top' : framings[idx],
            inverted: shot.inverted,
            bridgeOut: shot.bridge,
            bridgeIn: idx > 0 && Boolean(ordered[idx - 1]!.bridge),
            appName,
            wall: (shot.wall ?? []).map((l) => l[locale] ?? '').filter(Boolean),
          };
          const name = `${shot.id}_${shot.slug}_${target.id}.png`;
          const out = join(outDir, name);
          const m = await renderOne(page, buildPage(input), join(htmlDir, locale, target.id, `${shot.id}.html`), out, target, { preset: ad.tokens.id, framing: input.framing ?? 'auto', family: frameFamily(target, screens[0]), hasDevice: screens.length > 0 });
          const headlinePx = m.headlineCssPx * target.logical.scale;
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
            // First three shots are what search results show.
            thumbnailLegible: idx < 3 ? m.quality.thumbnail.legible : undefined,
            quality: m.quality,
          });
          log.dim(`  ${locale} ${target.id} ${name}${m.overflow.length ? '  ⚠ overflow' : ''}`);
        }
      }
      await context.close();
    }

    // Creatives (product page header 21:9, search 3:2, in-app events, Google Play feature graphic and icon)
    for (const target of creativeTargets) {
      const specs: Array<{ key: string; spec: CreativeSpec }> = [];
      const first = ordered[0];
      const fallback: CreativeSpec | undefined = shots.creatives.header ?? shots.creatives.search ?? (first ? { copy: first.copy, screens: first.screens.length ? first.screens : ['home'], featureIds: first.featureIds, badges: [] } : undefined);
      if (target.id === 'header' && shots.creatives.header) specs.push({ key: 'header', spec: shots.creatives.header });
      if (target.id === 'search' && shots.creatives.search) specs.push({ key: 'search', spec: shots.creatives.search });
      if (target.id === 'play-feature-graphic' && fallback) specs.push({ key: 'feature-graphic', spec: fallback });
      if (target.id === 'play-icon' && fallback) specs.push({ key: 'icon', spec: fallback });
      for (const e of shots.creatives.events) {
        if (target.id === 'event-card') specs.push({ key: `event-${e.id}-card`, spec: e.card });
        if (target.id === 'event-detail') specs.push({ key: `event-${e.id}-detail`, spec: e.detail });
      }
      if (!specs.length) continue;
      const context = await browser.newContext({ viewport: { width: target.logical.width, height: target.logical.height }, deviceScaleFactor: target.logical.scale });
      const page = await context.newPage();
      for (const locale of target.id === 'play-icon' ? [opts.primaryLocale] : opts.locales) {
        for (const { key, spec } of specs) {
          const copy = spec.copy[locale] ?? spec.copy[opts.primaryLocale];
          if (!copy) throw new Error(`shots.json creatives.${key}: no ${locale} copy.`);
          const needsScreens = target.id !== 'play-feature-graphic' && target.id !== 'play-icon';
          const screens = needsScreens ? await Promise.all(spec.screens.map((id) => raw.get(locale, 'iphone', id))) : [];
          const input: PageInput = { target, locale, ad, archetype: 'hero', headline: copy.headline, subheadline: copy.subheadline, kicker: copy.kicker, badges: spec.badges as Badge[], screens, icon, appName, index: 0, total: 1 };
          const out = join(paths.creative, locale, `${target.id}_${key}.png`);
          const m = await renderOne(page, buildPage(input), join(htmlDir, locale, target.id, `${key}.html`), out, target, { preset: ad.tokens.id, framing: 'creative', family: frameFamily(target, screens[0]), hasDevice: screens.length > 0 });
          images.push({ file: out, target: target.id, locale, shot: key, width: target.width, height: target.height, overflow: m.overflow, headlinePx: m.headlineCssPx * target.logical.scale, minContrast: target.id === 'play-icon' ? undefined : Math.min(m.minContrast, badgeContrast), safeAreaViolations: m.safeAreaViolations, quality: target.id === 'play-icon' ? undefined : m.quality });
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
  return { manifest, warnings: [...warnings, ...raw.warnings] };
}

async function removeStale(dir: string, targetId: string): Promise<void> {
  for (const f of await readdir(dir)) {
    const m = SHOT_FILE_RE.exec(f);
    if (m && m[3] === targetId) await rm(join(dir, f));
  }
}

/** Search-result thumbnails (220 px wide) used by the review report and the thumbnail test. */
async function writeThumbnails(paths: AppPaths, images: RenderManifest['images']): Promise<void> {
  for (const img of images) {
    const out = join(paths.cache, 'thumbs', img.locale, img.file.split('/').pop()!.replace(/\.png$/, '.jpg'));
    await ensureDir(join(out, '..'));
    await sharp(img.file).resize(QUALITY_BAR.thumbnailWidth).jpeg({ quality: 82 }).toFile(out);
  }
}

// ---------------------------------------------------------------- design samples

/** Preset suggestions by App Store category (first pick, then alternates), from the reference style index. */
const CATEGORY_STYLES: Record<string, StylePreset[]> = {
  PRODUCTIVITY: ['hand-drawn-editorial', 'liquid-glass-aurora', 'quiet-japandi', 'bento-keynote-grid'],
  FINANCE: ['swiss-grid-bold', 'bento-keynote-grid', 'midnight-glow-pro'],
  BUSINESS: ['swiss-grid-bold', 'bento-keynote-grid', 'midnight-glow-pro'],
  DEVELOPER_TOOLS: ['midnight-glow-pro', 'swiss-grid-bold', 'liquid-glass-aurora'],
  UTILITIES: ['bento-keynote-grid', 'liquid-glass-aurora', 'midnight-glow-pro'],
  HEALTH_AND_FITNESS: ['neon-athletic-night', 'soft-clay-wellness', 'liquid-glass-aurora', 'swiss-grid-bold'],
  SPORTS: ['neon-athletic-night', 'swiss-grid-bold'],
  LIFESTYLE: ['magazine-cover-editorial', 'soft-clay-wellness', 'quiet-japandi'],
  FOOD_AND_DRINK: ['magazine-cover-editorial', 'quiet-japandi'],
  BOOKS: ['magazine-cover-editorial', 'quiet-japandi'],
  SOCIAL_NETWORKING: ['candy-pop-social', 'paper-sticker-skeuomorphic'],
  EDUCATION: ['paper-sticker-skeuomorphic', 'candy-pop-social', 'bento-keynote-grid'],
  MEDICAL: ['soft-clay-wellness', 'liquid-glass-aurora'],
  ENTERTAINMENT: ['candy-pop-social', 'neon-athletic-night'],
  MUSIC: ['candy-pop-social', 'neon-athletic-night', 'midnight-glow-pro'],
  TRAVEL: ['magazine-cover-editorial', 'liquid-glass-aurora'],
};

/** Clearly different presets: category picks first, then the most contrasting looks (light/dark, sans/serif). */
export function suggestStyles(count: number, category?: string): StylePreset[] {
  const diverse: StylePreset[] = ['liquid-glass-aurora', 'midnight-glow-pro', 'swiss-grid-bold', 'candy-pop-social', 'soft-clay-wellness', 'neon-athletic-night', 'magazine-cover-editorial', 'bento-keynote-grid', 'hand-drawn-editorial', 'quiet-japandi', 'paper-sticker-skeuomorphic', 'vitrin-classic'];
  const picks = [...(category ? (CATEGORY_STYLES[category] ?? []) : []), ...diverse];
  const out: StylePreset[] = [];
  const darkness = (s: StylePreset) => PRESETS[s].surfaces[0]!.dark;
  for (const s of picks) {
    if (out.includes(s)) continue;
    // Keep the light/dark mix balanced so the options do not all read alike.
    const darkCount = out.filter(darkness).length;
    if (out.length >= 2 && darkness(s) && darkCount >= Math.ceil(count / 2)) continue;
    if (out.length >= 2 && !darkness(s) && out.length - darkCount >= Math.ceil(count / 2)) continue;
    out.push(s);
    if (out.length === count) break;
  }
  for (const s of diverse) if (out.length < count && !out.includes(s)) out.push(s);
  return out.slice(0, count);
}

export interface SampleOptions {
  paths: AppPaths;
  primaryLocale: string;
  /** The main iPhone target (iphone-6.9 when enabled). */
  target: RenderTarget;
  shots: ShotList;
  /** Base direction to tint/override from (optional; presets only when absent). */
  artDirection?: ArtDirection;
  styles?: StylePreset[];
  count?: number;
  category?: string;
  appIcon?: string;
  appName?: string;
  brand?: BrandTint;
  /** Output root (default .vitrin/design-samples). */
  outDir?: string;
}

export interface SampleResult {
  samples: Array<{ letter: string; style: StylePreset; name: string; files: string[] }>;
  contactSheet: string;
  warnings: string[];
}

/** The option the samples render with for one preset: the base option's id/name/brand, the preset's tokens. */
export function sampleOption(style: StylePreset, base?: ArtDirectionOption, brand?: BrandTint): ArtDirectionOption {
  return {
    id: style,
    name: PRESETS[style].name,
    rationale: base?.rationale ?? '',
    differentiation: base?.differentiation ?? '',
    preset: style,
    brand: base?.brand ?? (brand ? { primary: brand.primary, secondary: brand.secondary, strength: brand.strength ?? 0.35 } : undefined),
  };
}

/**
 * Comparison render (not a pipeline stage, nothing is uploaded): the hero and the second shot of the primary
 * locale for the main iPhone target, in N clearly different presets, plus one HTML-rendered contact sheet
 * labelled A, B, C… with the style names.
 */
export async function renderDesignSamples(opts: SampleOptions): Promise<SampleResult> {
  const defaults = await profileDefaults(opts.paths);
  const brand = opts.brand ?? defaults.brand;
  const appName = opts.appName ?? defaults.appName ?? '';
  const count = Math.max(1, Math.min(8, opts.count ?? 4));
  const styles = (opts.styles?.length ? opts.styles : suggestStyles(count, opts.category)).slice(0, opts.styles?.length ? opts.styles.length : count);
  const outRoot = opts.outDir ?? join(opts.paths.vitrin, 'design-samples');
  const ordered = [...opts.shots.shots].sort((a, b) => a.id.localeCompare(b.id));
  const picked = ordered.slice(0, 2);
  if (!picked.length) throw new Error('shots.json has no shots to sample.');
  const base = opts.artDirection?.options.find((o) => o.id === opts.artDirection?.selected);
  const raw = new RawLibrary(opts.paths, opts.primaryLocale);
  const icon = opts.appIcon && existsSync(opts.appIcon) ? pathToFileURL(opts.appIcon).href : undefined;
  const target = opts.target;
  const family = familyOfTarget(target);
  const locale = opts.primaryLocale;
  const result: SampleResult = { samples: [], contactSheet: join(outRoot, 'contact-sheet.png'), warnings: [] };
  await rm(outRoot, { recursive: true, force: true });
  let browser: Browser | undefined;
  try {
    browser = await launchChromium();
    const context = await browser.newContext({ viewport: { width: target.logical.width, height: target.logical.height }, deviceScaleFactor: target.logical.scale });
    const page = await context.newPage();
    for (const [n, style] of styles.entries()) {
      const ad = resolveDirection(sampleOption(style, base, brand), brand);
      const framings = planFramings(ordered, ad.tokens, family);
      const files: string[] = [];
      for (const shot of picked) {
        const copy = shot.copy[locale] ?? Object.values(shot.copy)[0];
        if (!copy) continue;
        const idx = ordered.indexOf(shot);
        const screens = await Promise.all(shot.screens.map((id) => raw.get(locale, family, id)));
        const input: PageInput = { target, locale, ad, archetype: shot.archetype, headline: copy.headline, subheadline: copy.subheadline, kicker: copy.kicker, badges: shot.badges, stat: shot.stat?.value, callouts: shot.callouts, quotes: shot.quotes[locale] ?? [], icon, screens, index: idx, total: ordered.length, framing: framings[idx], inverted: shot.inverted, appName };
        const out = join(outRoot, style, `${shot.id}_${shot.slug}.png`);
        await renderOne(page, buildPage(input), join(outRoot, style, `${shot.id}.html`), out, target, { preset: style, framing: framings[idx] ?? 'auto', family, hasDevice: screens.length > 0 });
        files.push(out);
      }
      result.samples.push({ letter: String.fromCharCode(65 + n), style, name: PRESETS[style].name, files });
    }
    await context.close();
    await renderContactSheet(browser, result, outRoot);
  } finally {
    await browser?.close();
  }
  await writeJson(join(outRoot, 'samples.json'), { generatedAt: new Date().toISOString(), target: target.id, locale, samples: result.samples.map((s) => ({ letter: s.letter, style: s.style, name: s.name, files: s.files })), contactSheet: result.contactSheet });
  result.warnings.push(...raw.warnings);
  return result;
}

/** Side-by-side sheet of the samples, rendered from HTML. */
async function renderContactSheet(browser: Browser, r: SampleResult, outRoot: string): Promise<void> {
  const thumbH = 760;
  const cols = r.samples.map((s) => {
    const imgs = s.files.map((f) => `<img src="${pathToFileURL(f).href}" style="height:${thumbH}px;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.18)">`).join('');
    return `<div class="col"><div class="label"><span class="letter">${s.letter}</span><span class="name">${s.name}</span><span class="id">${s.style}</span></div><div class="imgs">${imgs}</div></div>`;
  });
  const perRow = Math.min(4, r.samples.length);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#F2F1EE;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#16151A}
    .wrap{display:grid;grid-template-columns:repeat(${perRow},auto);gap:56px 64px;padding:64px;width:max-content}
    .label{display:flex;align-items:baseline;gap:16px;margin-bottom:22px}
    .letter{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:16px;background:#16151A;color:#fff;font-size:38px;font-weight:800}
    .name{font-size:34px;font-weight:700}.id{font-size:22px;color:#6A6872;font-family:Menlo,monospace}
    .imgs{display:flex;gap:20px}
  </style></head><body><div class="wrap">${cols.join('')}</div></body></html>`;
  const file = join(outRoot, 'contact-sheet.html');
  await writeText(file, html);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((res) => (img.onload = img.onerror = res)))));
  });
  const box = await page.evaluate(() => {
    const el = document.querySelector('.wrap')!.getBoundingClientRect();
    return { width: Math.ceil(el.width), height: Math.ceil(el.height) };
  });
  await page.setViewportSize(box);
  const png = await page.screenshot({ type: 'png', fullPage: true });
  await sharp(png).flatten({ background: '#F2F1EE' }).removeAlpha().png().toFile(r.contactSheet);
  await page.close();
}

export { surfaceFor };
