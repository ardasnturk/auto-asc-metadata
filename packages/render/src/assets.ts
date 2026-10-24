import { localeInfo } from '@vitrin/core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** Bundled OFL families (via @fontsource-variable). Key = name used in art-direction.json. */
export const FONT_FAMILIES: Record<string, { pkg: string; family: string; serif?: boolean }> = {
  Inter: { pkg: '@fontsource-variable/inter', family: 'Inter Variable' },
  Manrope: { pkg: '@fontsource-variable/manrope', family: 'Manrope Variable' },
  'Space Grotesk': { pkg: '@fontsource-variable/space-grotesk', family: 'Space Grotesk Variable' },
  'Plus Jakarta Sans': { pkg: '@fontsource-variable/plus-jakarta-sans', family: 'Plus Jakarta Sans Variable' },
  'DM Sans': { pkg: '@fontsource-variable/dm-sans', family: 'DM Sans Variable' },
  Fraunces: { pkg: '@fontsource-variable/fraunces', family: 'Fraunces Variable', serif: true },
  'Playfair Display': { pkg: '@fontsource-variable/playfair-display', family: 'Playfair Display Variable', serif: true },
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

function pkgCssUrl(pkg: string): string {
  const dir = dirname(require.resolve(`${pkg}/package.json`));
  const css = existsSync(join(dir, 'wght.css')) ? 'wght.css' : 'index.css';
  return pathToFileURL(join(dir, css)).href;
}

export interface FontSetup {
  links: string;
  headlineStack: string;
  bodyStack: string;
  dir: 'ltr' | 'rtl';
  serifHeadline: boolean;
}

export function fontSetup(headline: string, body: string, locale: string): FontSetup {
  const h = FONT_FAMILIES[headline];
  const b = FONT_FAMILIES[body];
  if (!h) throw new Error(`Unknown headline font “${headline}”. Available: ${Object.keys(FONT_FAMILIES).join(', ')}`);
  if (!b) throw new Error(`Unknown body font “${body}”. Available: ${Object.keys(FONT_FAMILIES).join(', ')}`);
  const info = localeInfo(locale);
  const script = info?.script ?? 'latin';
  const fallback = SCRIPT_FALLBACK[script];
  const noto = FONT_FAMILIES['Noto Sans']!;
  const pkgs = [...new Set([h.pkg, b.pkg, noto.pkg, ...(fallback ? [fallback.pkg] : [])])];
  const links = pkgs.map((p) => `<link rel="stylesheet" href="${pkgCssUrl(p)}">`).join('\n');
  // Latin display faces first so Latin glyphs keep the art direction; script fallback covers the rest.
  const stack = (f: string) => [`'${f}'`, fallback ? `'${fallback.family}'` : '', `'${noto.family}'`, 'sans-serif'].filter(Boolean).join(', ');
  return { links, headlineStack: stack(h.family), bodyStack: stack(b.family), dir: info?.dir ?? 'ltr', serifHeadline: Boolean(h.serif) };
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
