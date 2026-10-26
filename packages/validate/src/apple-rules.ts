import { baseLanguage, type ForbiddenTerms } from '@vitrin/core';
import { containsTerm } from './issues.js';

/**
 * Rules from Apple's App Review Guidelines and App Store asset best practices that apply to every text Vitrin
 * writes — metadata fields and the words drawn on screenshots, creatives and previews alike.
 */

/**
 * Template markers that must be gone before review (2.1(a)): `Lorem ipsum`, and uppercase TODO/TBD/FIXME/XXX.
 * Lowercase "todo" is a real word (to-do apps), so only the uppercase markers count.
 */
const MARKER_RE = /(?<![\p{L}\p{N}])(TODO|TBD|FIXME|XXX)(?![\p{L}\p{N}])/u;

export function findPlaceholder(text: string): string | undefined {
  if (/lorem ipsum/i.test(text)) return 'Lorem ipsum';
  return MARKER_RE.exec(text)?.[1];
}

/** Apple-designated recognitions may not appear in metadata or on assets. */
export function findAppleAward(text: string, terms: ForbiddenTerms, locale?: string): string | undefined {
  return terms.appleAwards.find((t) => containsTerm(text, t.replace(/[’']/g, "'"), locale) || containsTerm(text, t.replace(/'/g, '’'), locale));
}

/** "For Kids" / "For Children" wording is reserved for apps in the Kids Category (2.3.8, 5.1.4). */
export function findKidsTerm(text: string, terms: ForbiddenTerms, locale: string): string | undefined {
  const list = [...new Set([...(terms.kidsReserved[baseLanguage(locale)] ?? []), ...(terms.kidsReserved.en ?? [])])];
  return list.find((t) => containsTerm(text, t, locale));
}

/** A website address drawn on an asset (Apple: no website URLs in screenshots or creatives). */
export const URL_ON_ASSET_RE = /\bhttps?:\/\/\S+|\bwww\.[\p{L}\p{N}-]+\.[a-z]{2,}|\b[\p{L}\p{N}-]+\.(com|net|org|io|app|dev|co)\b/iu;

/**
 * True when "What's New" is nothing but a generic phrase (2.3.12: significant changes must be listed; generic text
 * is acceptable for bug-fix releases only).
 */
export function isGenericWhatsNew(text: string, terms: ForbiddenTerms, locale: string): boolean {
  const plain = text
    .toLocaleLowerCase(locale)
    .replace(/[•\-–—*.,!:;()\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return false;
  const phrases = [...(terms.genericWhatsNew[baseLanguage(locale)] ?? []), ...(terms.genericWhatsNew.en ?? [])].sort((a, b) => b.length - a.length);
  let rest = plain;
  for (const p of phrases) rest = rest.split(p).join(' ');
  rest = rest.replace(/\b(and|ve|und|et|y|e|with|ile|for|this|version|update|bu|sürüm|güncelleme|in|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return rest.length === 0;
}
