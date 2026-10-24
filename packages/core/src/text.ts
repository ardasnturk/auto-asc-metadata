const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Visible character count (grapheme clusters), which is how App Store Connect counts characters. */
export function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of segmenter.segment(text)) n++;
  return n;
}

/** UTF-8 byte length — the keyword field is limited in bytes, not characters. */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Split a keyword field into terms the way App Store Connect does (comma separated). */
export function splitKeywords(field: string): string[] {
  return field
    .split(/[,،、，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Lowercase, accent-preserving tokenization for duplicate detection across name/subtitle/keywords. */
export function tokenize(text: string, locale?: string): string[] {
  const lower = text.toLocaleLowerCase(locale);
  const wordSeg = new Intl.Segmenter(locale, { granularity: 'word' });
  const out: string[] = [];
  for (const s of wordSeg.segment(lower)) {
    if (s.isWordLike) out.push(s.segment);
  }
  return out;
}

export function wordCount(text: string, locale?: string): number {
  return tokenize(text, locale).length;
}

/** Base language of an ASC locale: `pt-BR` → `pt`, `zh-Hans` → `zh`. */
export function baseLanguage(locale: string): string {
  return locale.split('-')[0]!.toLowerCase();
}
