import { localeInfo } from '@vitrin/core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Bundled OFL families (via @fontsource / @fontsource-variable). Key = name used in art-direction.json.
 * `css` lists the stylesheet files to load (default: wght.css + wght-italic.css when present, else index.css).
 */
export const FONT_FAMILIES: Record<string, { pkg: string; family: string; serif?: boolean; css?: string[] }> = {
  Inter: { pkg: '@fontsource-variable/inter', family: 'Inter Variable' },
  'Inter Tight': { pkg: '@fontsource-variable/inter-tight', family: 'Inter Tight Variable' },
  Manrope: { pkg: '@fontsource-variable/manrope', family: 'Manrope Variable' },
  'Space Grotesk': { pkg: '@fontsource-variable/space-grotesk', family: 'Space Grotesk Variable' },
  'Plus Jakarta Sans': { pkg: '@fontsource-variable/plus-jakarta-sans', family: 'Plus Jakarta Sans Variable' },
  'DM Sans': { pkg: '@fontsource-variable/dm-sans', family: 'DM Sans Variable' },
  'Bricolage Grotesque': { pkg: '@fontsource-variable/bricolage-grotesque', family: 'Bricolage Grotesque Variable', css: ['index.css'] },
  Rubik: { pkg: '@fontsource-variable/rubik', family: 'Rubik Variable' },
  Anton: { pkg: '@fontsource/anton', family: 'Anton', css: ['400.css'] },
  'Barlow Condensed': { pkg: '@fontsource/barlow-condensed', family: 'Barlow Condensed', css: ['600.css', '700.css', '700-italic.css', '800.css', '800-italic.css'] },
  'JetBrains Mono': { pkg: '@fontsource-variable/jetbrains-mono', family: 'JetBrains Mono Variable' },
  Caveat: { pkg: '@fontsource-variable/caveat', family: 'Caveat Variable' },
  // Fraunces ships every axis (opsz, SOFT, WONK) in full.css: the editorial and clay presets need them.
  Fraunces: { pkg: '@fontsource-variable/fraunces', family: 'Fraunces Variable', serif: true, css: ['full.css', 'full-italic.css'] },
  'Playfair Display': { pkg: '@fontsource-variable/playfair-display', family: 'Playfair Display Variable', serif: true },
  'Shippori Mincho': { pkg: '@fontsource/shippori-mincho', family: 'Shippori Mincho', serif: true, css: ['500.css', '600.css', '700.css'] },
  'Noto Sans': { pkg: '@fontsource-variable/noto-sans', family: 'Noto Sans Variable' },
};

/** Noto fallbacks per script (asc-locales.json `script`). */
export const SCRIPT_FALLBACK: Record<string, { pkg: string; family: string }> = {
  jp: { pkg: '@fontsource-variable/noto-sans-jp', family: 'Noto Sans JP Variable' },
  sc: { pkg: '@fontsource-variable/noto-sans-sc', family: 'Noto Sans SC Variable' },
  tc: { pkg: '@fontsource-variable/noto-sans-tc', family: 'Noto Sans TC Variable' },
  kr: { pkg: '@fontsource-variable/noto-sans-kr', family: 'Noto Sans KR Variable' },
  arabic: { pkg: '@fontsource-variable/noto-sans-arabic', family: 'Noto Sans Arabic Variable' },
  hebrew: { pkg: '@fontsource-variable/noto-sans-hebrew', family: 'Noto Sans Hebrew Variable' },
  devanagari: { pkg: '@fontsource-variable/noto-sans-devanagari', family: 'Noto Sans Devanagari Variable' },
  thai: { pkg: '@fontsource-variable/noto-sans-thai', family: 'Noto Sans Thai Variable' },
  bengali: { pkg: '@fontsource-variable/noto-sans-bengali', family: 'Noto Sans Bengali Variable' },
  tamil: { pkg: '@fontsource-variable/noto-sans-tamil', family: 'Noto Sans Tamil Variable' },
  telugu: { pkg: '@fontsource-variable/noto-sans-telugu', family: 'Noto Sans Telugu Variable' },
  kannada: { pkg: '@fontsource-variable/noto-sans-kannada', family: 'Noto Sans Kannada Variable' },
  malayalam: { pkg: '@fontsource-variable/noto-sans-malayalam', family: 'Noto Sans Malayalam Variable' },
  gujarati: { pkg: '@fontsource-variable/noto-sans-gujarati', family: 'Noto Sans Gujarati Variable' },
  gurmukhi: { pkg: '@fontsource-variable/noto-sans-gurmukhi', family: 'Noto Sans Gurmukhi Variable' },
  oriya: { pkg: '@fontsource-variable/noto-sans-oriya', family: 'Noto Sans Oriya Variable' },
};

/** file:// URLs of the stylesheets a font package needs. */
export function fontCssUrls(pkg: string, css?: string[]): string[] {
  const dir = dirname(require.resolve(`${pkg}/package.json`));
  const files = css ?? (existsSync(join(dir, 'wght.css')) ? ['wght.css', ...(existsSync(join(dir, 'wght-italic.css')) ? ['wght-italic.css'] : [])] : ['index.css']);
  return files.map((f) => pathToFileURL(join(dir, f)).href);
}

export interface FontSetup {
  links: string;
  headlineStack: string;
  bodyStack: string;
  /** Stack for any extra family (labels, scripts, mono) requested through `extra`. */
  stacks: Record<string, string>;
  dir: 'ltr' | 'rtl';
  serifHeadline: boolean;
}

export function fontSetup(headline: string, body: string, locale: string, extra: string[] = []): FontSetup {
  const unknown = (kind: string, f: string) => new Error(`Unknown ${kind} font “${f}”. Available: ${Object.keys(FONT_FAMILIES).join(', ')}`);
  const h = FONT_FAMILIES[headline];
  const b = FONT_FAMILIES[body];
  if (!h) throw unknown('headline', headline);
  if (!b) throw unknown('body', body);
  const extras = extra.map((e) => {
    const f = FONT_FAMILIES[e];
    if (!f) throw unknown('label', e);
    return [e, f] as const;
  });
  const info = localeInfo(locale);
  const script = info?.script ?? 'latin';
  const fallback = SCRIPT_FALLBACK[script];
  const noto = FONT_FAMILIES['Noto Sans']!;
  const all = [h, b, ...extras.map(([, f]) => f), noto];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const f of all) {
    if (seen.has(f.pkg)) continue;
    seen.add(f.pkg);
    urls.push(...fontCssUrls(f.pkg, f.css));
  }
  if (fallback) urls.push(...fontCssUrls(fallback.pkg));
  const links = urls.map((u) => `<link rel="stylesheet" href="${u}">`).join('\n');
  // Latin display faces first so Latin glyphs keep the art direction; script fallback covers the rest.
  const stack = (f: string) => [`'${f}'`, fallback ? `'${fallback.family}'` : '', `'${noto.family}'`, 'sans-serif'].filter(Boolean).join(', ');
  return {
    links,
    headlineStack: stack(h.family),
    bodyStack: stack(b.family),
    stacks: Object.fromEntries(extras.map(([name, f]) => [name, stack(f.family)])),
    dir: info?.dir ?? 'ltr',
    serifHeadline: Boolean(h.serif),
  };
}

const iconCache = new Map<string, string>();

/** Inline SVG for a Lucide icon (ISC licence). Unknown names fall back to a neutral sparkle. */
export function lucideIcon(name: string | undefined, size: number, color: string): string {
  const key = name ?? 'sparkles';
  let svg = iconCache.get(key);
  if (!svg) {
    const dir = join(dirname(require.resolve('lucide-static/package.json')), 'icons');
    const file = join(dir, `${key}.svg`);
    svg = readFileSync(existsSync(file) ? file : join(dir, 'sparkles.svg'), 'utf8');
    iconCache.set(key, svg);
  }
  return svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}"`)
    .replace(/stroke="currentColor"/, `stroke="${color}"`)
    .replace(/class="[^"]*"/, 'class="icon" aria-hidden="true"');
}

export function lucideIconExists(name: string): boolean {
  const dir = join(dirname(require.resolve('lucide-static/package.json')), 'icons');
  return existsSync(join(dir, `${name}.svg`));
}
