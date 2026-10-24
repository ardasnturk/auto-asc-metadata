// Bundled OFL fonts. Script fallbacks are split by unicode-range, so only used subsets are fetched.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/manrope/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/dm-sans/wght.css';
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource-variable/playfair-display/wght.css';
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

export function fontStack(family: string): string {
  return [`'${family} Variable'`, ...FALLBACKS.map((f) => `'${f}'`), 'sans-serif'].join(', ');
}
