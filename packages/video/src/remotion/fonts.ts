// Bundled OFL fonts (the same families as the screenshot presets). Script fallbacks are split by unicode-range,
// so only used subsets are fetched.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter-tight/wght.css';
import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/bricolage-grotesque/index.css';
import '@fontsource-variable/rubik/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/caveat/wght.css';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/playfair-display/wght.css';
import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/shippori-mincho/500.css';
import '@fontsource-variable/noto-sans/wght.css';
import '@fontsource-variable/noto-sans-jp/wght.css';
import '@fontsource-variable/noto-sans-sc/wght.css';
import '@fontsource-variable/noto-sans-tc/wght.css';
import '@fontsource-variable/noto-sans-kr/wght.css';
import '@fontsource-variable/noto-sans-arabic/wght.css';
import '@fontsource-variable/noto-sans-hebrew/wght.css';
import '@fontsource-variable/noto-sans-devanagari/wght.css';
import '@fontsource-variable/noto-sans-thai/wght.css';

const FALLBACKS = [
  'Noto Sans JP Variable',
  'Noto Sans SC Variable',
  'Noto Sans TC Variable',
  'Noto Sans KR Variable',
  'Noto Sans Arabic Variable',
  'Noto Sans Hebrew Variable',
  'Noto Sans Devanagari Variable',
  'Noto Sans Thai Variable',
  'Noto Sans Variable',
];

/** Families shipped as static cuts (their CSS family name has no " Variable" suffix). */
const STATIC = new Set(['Anton', 'Barlow Condensed', 'Shippori Mincho']);

export function fontStack(family: string): string {
  const name = STATIC.has(family) ? family : `${family} Variable`;
  return [`'${name}'`, ...FALLBACKS.map((f) => `'${f}'`), 'sans-serif'].join(', ');
}
