import { baseLanguage, byteLength, DATA_DIR, graphemeLength, loadForbiddenTerms, splitKeywords, storefrontForLocale, tokenize } from '@vitrin/core';
import {
  PLAY_TEXT_LIMITS,
  TEXT_LIMITS,
  type AppMetadata,
  type AppProfile,
  type Competitors,
  type LocaleMetadata,
  type PlayAppMetadata,
  type PlayListing,
  type PlayTextField,
  type TextField,
  type ValidationReport,
  type VitrinConfig,
} from '@vitrin/schemas';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findAppleAward, findKidsTerm, findPlaceholder, isGenericWhatsNew } from './apple-rules.js';
import { containsTerm, IssueList } from './issues.js';

export interface TextValidationInput {
  config: VitrinConfig;
  profile?: AppProfile;
  competitors?: Competitors;
  appMetadata?: AppMetadata;
  locales: Map<string, LocaleMetadata>;
}

type Measurements = ValidationReport['measurements'];

const HTML_RE = /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i;
const STOP_FOR_DUPES = new Set(['and', 'the', 'for', 'with', 've', 'ile', 'için', 'de', 'da', 'und', 'et', 'y', 'e', '&', 'a', 'an', 'of', 'to', 'your', 'you', 'this', 'that', 'from', 'are', 'bir', 'bu', 'olarak', 'veya', 'daha', 'für', 'mit', 'pour', 'avec', 'para', 'con']);

/** Terms from the forbidden list that apply to a locale (the base language plus the `*` and `en` lists). */
function termsFor(map: Record<string, string[]>, locale: string): string[] {
  const base = baseLanguage(locale);
  return [...new Set([...(map['*'] ?? []), ...(map[base] ?? [])])];
}

/**
 * Brand names of competitors (app name before the first separator, and seller names).
 * Generic category phrases are not brands: a candidate is dropped when every word in it also appears in the
 * names of at least three competitors or in the research seed terms (e.g. an app literally called "Habit Tracker").
 */
export function competitorBrands(competitors?: Competitors, ownNames: string[] = [], seeds: string[] = []): string[] {
  if (!competitors) return [];
  const own = new Set(ownNames.map((n) => n.toLowerCase()));
  const wordFreq = new Map<string, number>();
  for (const a of competitors.apps) {
    for (const w of new Set(tokenize(a.name))) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
  }
  // Singular/plural fold so "goals" counts as the seed word "goal".
  const stem = (w: string) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')).replace(/(lar|ler)$/, '');
  const selfSeller = competitors.self?.sellerName;
  const seedWords = new Set(seeds.flatMap((s) => tokenize(s)).map(stem));
  const stemFreq = new Map<string, number>();
  for (const [w, n] of wordFreq) stemFreq.set(stem(w), (stemFreq.get(stem(w)) ?? 0) + n);
  const generic = (phrase: string) => {
    const words = tokenize(phrase);
    return words.length > 0 && words.every((w) => (stemFreq.get(stem(w)) ?? 0) >= 3 || seedWords.has(stem(w)) || STOP_FOR_DUPES.has(w));
  };
  const names = new Set<string>();
  for (const a of competitors.apps) {
    if (selfSeller && a.sellerName === selfSeller) continue; // the developer's own apps
    const brand = a.name.split(/\s[:\-–—|]\s|[:|–—]/)[0]?.trim();
    if (brand && brand.length >= 3 && !own.has(brand.toLowerCase()) && !generic(brand)) names.add(brand);
    const seller = a.sellerName?.replace(/,?\s+(Inc\.?|LLC|Ltd\.?|GmbH|A\.Ş\.|Corp\.?)$/i, '').trim();
    if (seller && seller.length >= 3 && !own.has(seller.toLowerCase()) && !generic(seller)) names.add(seller);
  }
  return [...names];
}

export function validateText(input: TextValidationInput): { issues: IssueList; measurements: Measurements } {
  const { config, profile, competitors, appMetadata, locales } = input;
  const issues = new IssueList();
  const measurements: Measurements = {};
  const forbidden = loadForbiddenTerms();
  const featureCommits = (profile?.docs?.commitsSinceTag ?? []).map((c) => c.subject).filter((x) => /^(feat|add|new|introduce|support|implement)\b/i.test(x));
  const developer = config.copyrightHolder ?? '';
  const seeds = Array.isArray(config.research.seeds) ? config.research.seeds : Object.values(config.research.seeds).flat();
  const brands = competitorBrands(competitors, [profile?.app.displayName ?? '', developer], seeds);
  const featureIds = new Set(profile?.features.map((f) => f.id) ?? []);

  for (const locale of config.app.locales) {
    if (!locales.has(locale)) {
      issues.error('metadata.missing-locale', `No metadata file for ${locale} (metadata/listing/${locale}.json).`, { locale });
    }
  }

  for (const [locale, m] of locales) {
    const at = (field: string) => ({ locale, field, file: `metadata/listing/${locale}.json` });
    const lm: Measurements[string] = {};
    measurements[locale] = lm;

    // ---- limits ----
    const values: Record<TextField, string> = {
      name: m.name,
      subtitle: m.subtitle,
      promotionalText: m.promotionalText,
      description: m.description,
      keywords: m.keywords,
      whatsNew: m.whatsNew,
      reviewNotes: appMetadata?.reviewNotes ?? '',
    };
    for (const [field, limit] of Object.entries(TEXT_LIMITS) as Array<[TextField, (typeof TEXT_LIMITS)[TextField]]>) {
      if (field === 'reviewNotes') continue;
      const v = values[field];
      const chars = graphemeLength(v);
      const bytes = byteLength(v);
      const n = limit.unit === 'bytes' ? bytes : chars;
      lm[field] = { chars, bytes, limit: limit.max, unit: limit.unit };
      if (limit.required && !v.trim()) issues.error('text.required', `${field} cannot be empty.`, at(field));
      else if (n > limit.max) {
        issues.error('text.too-long', `${field} is ${n}/${limit.max} ${limit.unit === 'bytes' ? 'bytes' : 'characters'}.`, {
          ...at(field),
          fix: `Shorten by ${n - limit.max} ${limit.unit === 'bytes' ? 'bytes' : 'characters'}.`,
        });
      } else if (v.trim() && n < limit.min) issues.error('text.too-short', `${field} must be at least ${limit.min} characters.`, at(field));
      if (v !== v.trim()) issues.warn('text.whitespace', `${field} has leading/trailing whitespace.`, at(field));
      if (HTML_RE.test(v)) issues.error('text.html', `${field} contains HTML; the App Store accepts plain text only.`, at(field));
    }

    // ---- name / subtitle ----
    const nameWords = tokenize(m.name, locale).filter((w) => !STOP_FOR_DUPES.has(w));
    const subWords = tokenize(m.subtitle, locale).filter((w) => !STOP_FOR_DUPES.has(w));
    const repeated = subWords.filter((w) => nameWords.includes(w));
    if (repeated.length) {
      issues.error('aso.subtitle-repeats-name', `Subtitle repeats words from the name: ${[...new Set(repeated)].join(', ')}.`, {
        ...at('subtitle'),
        fix: 'Use secondary keywords in the subtitle that differ from the name.',
      });
    }

    // ---- keywords ----
    const kwField = m.keywords;
    if (/,\s|\s,/.test(kwField)) {
      issues.error('keywords.spaces', 'Spaces around commas; every space costs a byte.', { ...at('keywords'), fix: 'Write commas without spaces: keyword1,keyword2' });
    }
    const terms = splitKeywords(kwField);
    const seen = new Set<string>();
    const isCjk = /^(ja|ko|zh)/.test(locale);
    for (const term of terms) {
      const lower = term.toLocaleLowerCase(locale);
      if (seen.has(lower)) issues.error('keywords.duplicate', `“${term}” appears more than once in the keyword field.`, at('keywords'));
      seen.add(lower);
      if (graphemeLength(term) <= 2 && !isCjk) {
        issues.error('keywords.too-short', `“${term}” must be longer than 2 characters.`, at('keywords'));
      }
      for (const w of tokenize(term, locale)) {
        if (nameWords.includes(w) || subWords.includes(w)) {
          issues.error('keywords.repeats-name', `“${w}” is already in the name/subtitle; repeating it in the keyword field wastes bytes.`, { ...at('keywords'), fix: `Remove “${w}”.` });
        }
      }
      if (developer && containsTerm(term, developer, locale)) {
        issues.error('keywords.developer-name', `The developer name (“${developer}”) should not be in the keyword field.`, at('keywords'));
      }
      for (const tm of forbidden.appleTrademarks) {
        if (containsTerm(term, tm, locale)) issues.error('keywords.apple-trademark', `The Apple trademark “${tm}” cannot be used in the keyword field.`, at('keywords'));
      }
    }
    for (const t of terms) {
      const lower = t.toLocaleLowerCase(locale);
      const plurals = pluralForms(lower, locale);
      for (const p of plurals) {
        if (seen.has(p)) issues.warn('keywords.plural', `Both “${t}” and “${p}” are present; the App Store matches singular/plural forms, so remove one.`, at('keywords'));
      }
    }
    for (const noise of forbidden.keywordNoise) {
      if (seen.has(noise.toLowerCase())) issues.warn('keywords.noise', `“${noise}” is low-value; spend these bytes on another keyword.`, at('keywords'));
    }
    if (byteLength(kwField) < 80) {
      issues.info('keywords.underused', `Keyword field is ${byteLength(kwField)}/100 bytes; use the remaining bytes.`, at('keywords'));
    }

    // ---- forbidden terms ----
    const priceTerms = termsFor(forbidden.price, locale);
    const superTerms = termsFor(forbidden.superlatives, locale);
    const strictFields: Array<[string, string]> = [
      ['name', m.name],
      ['subtitle', m.subtitle],
      ['keywords', m.keywords],
      ['promotionalText', m.promotionalText],
    ];
    for (const [field, text] of strictFields) {
      for (const t of priceTerms) {
        if (!containsTerm(text, t, locale)) continue;
        // Promotional text is meant for campaigns; flag it, but do not block.
        if (field === 'promotionalText') issues.warn('text.price', `${field} contains a price term (“${t}”); the price is already shown on the App Store.`, at(field));
        else issues.error('text.price', `${field} contains a price term (“${t}”).`, at(field));
      }
      for (const t of superTerms) if (containsTerm(text, t, locale)) issues.error('text.superlative', `${field} contains an unproven superlative (“${t}”).`, at(field));
    }
    for (const t of superTerms) {
      if (containsTerm(m.description, t, locale)) issues.warn('text.superlative', `The description contains “${t}”; remove it unless it is documented.`, at('description'));
    }
    for (const t of priceTerms.filter((x) => x.length > 1)) {
      if (containsTerm(m.description, t, locale)) issues.warn('text.price', `The description contains a price term (“${t}”); remove it unless it is subscription information.`, at('description'));
    }
    for (const brand of brands) {
      for (const [field, text] of [...strictFields, ['description', m.description] as [string, string], ['whatsNew', m.whatsNew] as [string, string]]) {
        if (containsTerm(text, brand, locale)) {
          issues.error('text.competitor-brand', `${field} contains a competitor brand name (“${brand}”).`, { ...at(field), fix: 'Other app or company names cannot be used.' });
        }
      }
    }

    // ---- App Review: placeholders, Apple recognitions, Kids Category wording, What's New ----
    const kidsApp = isKidsCategory(appMetadata);
    for (const [field, text] of [...strictFields, ['description', m.description] as [string, string], ['whatsNew', m.whatsNew] as [string, string]]) {
      const ph = findPlaceholder(text);
      if (ph) issues.error('text.placeholder', `${field} contains template text (“${ph}”); App Review rejects placeholder content (2.1).`, at(field));
      const award = findAppleAward(text, forbidden, locale);
      if (award) issues.error('text.apple-award', `${field} mentions an Apple-designated recognition (“${award}”); these may not be used in metadata.`, at(field));
      const kids = findKidsTerm(text, forbidden, locale);
      if (kids && !kidsApp) issues.error('text.kids-reserved', `${field} contains “${kids}”, which is reserved for apps in the Kids Category (App Review 2.3.8, 5.1.4).`, { ...at(field), fix: 'Describe the audience without it, or set the Kids age band in app.json ageRatingDraft.answers.kidsAgeBand if the app is in the Kids Category.' });
    }
    if (isGenericWhatsNew(m.whatsNew, forbidden, locale) && featureCommits.length) {
      issues.warn('whatsnew.generic', `What's New is generic, but this release adds features (${featureCommits.slice(0, 3).map((c) => `“${c}”`).join(', ')}); App Review 2.3.12 requires significant changes to be listed.`, at('whatsNew'));
    }

    // ---- description quality ----
    const firstLines = m.description.split('\n').filter((l) => l.trim()).slice(0, 3).join(' ');
    if (graphemeLength(firstLines) < 40) issues.warn('description.hook', 'The first 3 lines of the description are visible before “more”; write a strong hook.', at('description'));
    const counts = new Map<string, number>();
    for (const w of tokenize(m.description, locale)) if (w.length > 3 && !STOP_FOR_DUPES.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    for (const [w, c] of counts) {
      if (c > 6) issues.warn('description.stuffing', `“${w}” appears ${c} times in the description; it may look like keyword stuffing.`, at('description'));
    }

    // ---- URLs ----
    const urlChecks: Array<[string, string | undefined, boolean]> = [
      ['supportUrl', m.supportUrl ?? config.urls.support, true],
      ['privacyUrl', m.privacyUrl ?? config.urls.privacy, true],
      ['marketingUrl', m.marketingUrl ?? config.urls.marketing, false],
    ];
    for (const [field, url, required] of urlChecks) {
      if (!url) {
        if (required) issues.error('url.missing', `${field} is required (metadata or vitrin.config.yaml urls).`, at(field));
        continue;
      }
      if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) issues.error('url.invalid', `${field} is not a valid URL: ${url}`, at(field));
      else if (!url.startsWith('https://')) issues.warn('url.http', `${field} should use https.`, at(field));
      if (/\/\/(www\.)?example\.(com|org|net)\b/i.test(url)) issues.warn('url.placeholder', `${field} is a placeholder (${url}); set the real address before uploading.`, at(field));
    }

    // ---- claims ----
    for (const claim of m.claims) {
      for (const id of claim.featureIds) {
        if (!featureIds.has(id)) {
          issues.error('claim.unknown-feature', `Claim “${claim.text}” references an unknown feature: ${id}.`, { ...at('claims'), fix: 'Link it to an evidenced feature in app_profile.json features, or remove the claim (App Review 2.3).' });
        }
      }
      const all = [m.name, m.subtitle, m.promotionalText, m.description, m.whatsNew].join('\n');
      if (!all.toLocaleLowerCase(locale).includes(claim.text.toLocaleLowerCase(locale))) {
        issues.warn('claim.not-in-copy', `Claim text does not appear verbatim in the copy: “${claim.text}”.`, at('claims'));
      }
    }
    if (!m.claims.length) issues.warn('claim.none', 'The claims list is empty; link the feature claims in the description to app_profile features.', at('claims'));
  }

  // ---- cross-locale: additional storefront languages should carry different keywords ----
  const byStorefront = new Map<string, string[]>();
  for (const locale of locales.keys()) {
    const sf = storefrontForLocale(locale);
    byStorefront.set(sf, [...(byStorefront.get(sf) ?? []), locale]);
  }
  const allLocales = [...locales.keys()];
  for (let i = 0; i < allLocales.length; i++) {
    for (let j = i + 1; j < allLocales.length; j++) {
      const a = locales.get(allLocales[i]!)!;
      const b = locales.get(allLocales[j]!)!;
      if (baseLanguage(a.locale) !== baseLanguage(b.locale)) continue;
      const ta = new Set(splitKeywords(a.keywords).map((x) => x.toLowerCase()));
      const shared = splitKeywords(b.keywords).filter((x) => ta.has(x.toLowerCase()));
      if (shared.length > 3) {
        issues.warn('keywords.cross-locale-duplicate', `${a.locale} and ${b.locale} share ${shared.length} keywords; give additional languages that may count toward the same storefront different keywords.`, { locale: b.locale, field: 'keywords' });
      }
    }
  }

  // ---- app level ----
  if (appMetadata) {
    if (!/^\d{4}\s+\S/.test(appMetadata.copyright)) {
      issues.error('copyright.format', `Copyright must be in the form “2026 Company Name”: “${appMetadata.copyright}”.`, { field: 'copyright', file: 'metadata/listing/app.json' });
    }
    if (appMetadata.reviewNotes.trim().length < 40) {
      issues.warn('review.notes-short', 'Review notes are empty or very short; describe new features specifically, how to reach them and any demo account or demo mode (App Review 2.1, 2.3.1).', { field: 'reviewNotes', file: 'metadata/listing/app.json' });
    } else if (findPlaceholder(appMetadata.reviewNotes)) {
      issues.error('text.placeholder', 'Review notes contain template text; App Review rejects placeholder content (2.1).', { field: 'reviewNotes', file: 'metadata/listing/app.json' });
    }
    if (appMetadata.copyright.includes('©')) issues.warn('copyright.symbol', 'Do not include the © symbol; the App Store adds it.', { field: 'copyright' });
    const notesBytes = byteLength(appMetadata.reviewNotes);
    if (notesBytes > TEXT_LIMITS.reviewNotes.max) issues.error('text.too-long', `Review notes are ${notesBytes}/4000 bytes.`, { field: 'reviewNotes' });
    if (appMetadata.secondaryCategory && appMetadata.secondaryCategory === appMetadata.primaryCategory) {
      issues.error('category.same', 'Primary and secondary category cannot be the same.', { field: 'secondaryCategory' });
    }
  } else {
    issues.error('metadata.app-missing', 'metadata/listing/app.json is missing (copyright, categories, review notes).');
  }

  return { issues, measurements };
}

/** Very small plural heuristic used only to warn about singular/plural pairs. */
export function pluralForms(term: string, locale: string): string[] {
  const base = baseLanguage(locale);
  if (base === 'en') return [`${term}s`, `${term}es`, term.endsWith('y') ? `${term.slice(0, -1)}ies` : ''].filter(Boolean);
  if (base === 'tr') return [`${term}lar`, `${term}ler`];
  if (base === 'de') return [`${term}e`, `${term}n`, `${term}en`];
  if (['fr', 'es', 'pt', 'it'].includes(base)) return [`${term}s`, `${term}es`];
  return [];
}

// ---------------------------------------------------------------------------------------------
// Google Play store listing (issue code prefix `play.`)
// ---------------------------------------------------------------------------------------------

/** data/play-locales.json: ASC locale → Play language (null = not offered on Play) and every Play language code. */
export interface PlayLocaleTable {
  map: Record<string, string | null>;
  play: string[];
}

let playLocalesCache: PlayLocaleTable | undefined;
export function loadPlayLocaleTable(): PlayLocaleTable {
  playLocalesCache ??= JSON.parse(readFileSync(join(DATA_DIR, 'play-locales.json'), 'utf8')) as PlayLocaleTable;
  return playLocalesCache;
}

export interface PlayTextValidationInput {
  config: VitrinConfig;
  profile?: AppProfile;
  competitors?: Competitors;
  /** Keyed by ASC locale (the file name under metadata/listing/play/). */
  listings: Map<string, PlayListing>;
  app?: PlayAppMetadata;
  /** Defaults to data/play-locales.json. */
  locales?: PlayLocaleTable;
}

/**
 * Ranking, performance, price and promotional wording the Play metadata policy keeps out of the title
 * (and that Vitrin also keeps out of the short description). Merged with the price and superlative lists
 * of data/forbidden-terms.json for the listing language.
 */
export const PLAY_PROMO_TERMS: Record<string, string[]> = {
  en: ['top', 'best', 'new', 'hot', 'popular', 'free', 'sale', 'discount', 'bonus', 'cashback', 'app of the year', 'best of play', 'editor’s choice', "editor's choice", 'million downloads', 'downloads', 'trending', 'no ads', 'download now', 'install now', 'play now', 'try now'],
  tr: ['en iyi', 'yeni', 'popüler', 'ücretsiz', 'bedava', 'indirim', 'kampanya', 'şimdi indir', 'hemen indir'],
  de: ['neu', 'beliebt', 'kostenlos', 'gratis', 'jetzt herunterladen'],
  fr: ['nouveau', 'populaire', 'gratuit', 'télécharger maintenant'],
  es: ['nuevo', 'popular', 'gratis', 'descarga ahora'],
};

/** Mentions of the other store in a Play listing (users on Android cannot act on them). */
const APPLE_ONLY_TERMS = ['App Store', 'iPhone', 'iPad', 'iOS', 'Apple Watch', 'macOS', 'visionOS', 'TestFlight'];

const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]/u;
/** Text emoticons such as :) ;-) :D <3 ^_^ */
const EMOTICON_RE = /(^|\s)([:;=8][-'^]?[)(DPpOo3\]\[|/\\]|<3|\^_?\^|xD|XD)(?=\s|$|[.,!?])/u;
/** The same punctuation or symbol three times, or `!!`/`??` style repeats. */
const REPEATED_SPECIAL_RE = /([^\p{L}\p{N}\s])\1+|[!?]{2,}/u;
const URL_IN_TEXT_RE = /\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i;
/** Formatting Play renders in the full description; anything else shows up as raw markup. */
const PLAY_ALLOWED_TAGS = new Set(['b', 'i', 'u', 'br', 'em', 'strong']);
const YOUTUBE_RE = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{6,}([?&][^\s]*)?$/;

/** The Play language a listing is uploaded to, or null when Play has no listing language for the ASC locale. */
export function playLocaleOf(listing: Pick<PlayListing, 'locale' | 'playLocale'>, table: PlayLocaleTable = loadPlayLocaleTable()): string | null {
  if (listing.playLocale) return listing.playLocale;
  const mapped = table.map[listing.locale];
  return mapped === undefined ? null : mapped;
}

/** True when every cased letter is upper case and there are at least four of them (`HABIT TRACKER`). */
export function isAllCaps(text: string): boolean {
  const letters = [...text].filter((c) => c.toLowerCase() !== c.toUpperCase());
  return letters.length >= 4 && letters.every((c) => c === c.toUpperCase());
}

/** Words of four or more letters written in capitals, except those that appear the same way in the brand name. */
export function allCapsWords(text: string, brand = ''): string[] {
  const brandWords = new Set(brand.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return (text.match(/[\p{L}]{4,}/gu) ?? []).filter((w) => isAllCaps(w) && !brandWords.has(w));
}

/** Play policy forbids emoji, emoticons and repeated special characters in the title. */
export function emojiOrEmoticon(text: string): string | undefined {
  return EMOJI_RE.exec(text)?.[0] ?? EMOTICON_RE.exec(text)?.[2];
}

export function validatePlayText(input: PlayTextValidationInput): { issues: IssueList; measurements: Measurements } {
  const { config, profile, competitors, listings, app } = input;
  const table = input.locales ?? loadPlayLocaleTable();
  const issues = new IssueList();
  const measurements: Measurements = {};
  const forbidden = loadForbiddenTerms();
  const brand = profile?.app.displayName ?? '';
  const seeds = Array.isArray(config.research.seeds) ? config.research.seeds : Object.values(config.research.seeds).flat();
  const brands = competitorBrands(competitors, [brand, config.copyrightHolder ?? ''], seeds);
  const featureIds = new Set(profile?.features.map((f) => f.id) ?? []);
  const playCodes = new Set(table.play);

  for (const locale of config.app.locales) {
    if (listings.has(locale)) continue;
    const mapped = table.map[locale];
    if (mapped === null || mapped === undefined) continue;
    const sev = locale === config.app.primaryLocale ? 'error' : 'warn';
    issues[sev]('play.missing-locale', `No Google Play listing for ${locale} (metadata/listing/play/${locale}.json, Play language ${mapped}).`, { locale });
  }

  const seenPlay = new Map<string, string>();
  let anyChangelog = false;
  for (const [locale, l] of listings) {
    const at = (field: string) => ({ locale, field, file: `metadata/listing/play/${locale}.json` });
    const lm: Measurements[string] = {};
    measurements[`play:${locale}`] = lm;

    // ---- language mapping ----
    const pl = playLocaleOf(l, table);
    if (!pl) {
      issues.error('play.locale.unmapped', `${locale} has no Google Play language; set playLocale or remove the listing.`, { ...at('playLocale'), fix: `Pick one of the Play languages, e.g. ${table.play.slice(0, 4).join(', ')}.` });
    } else {
      if (!playCodes.has(pl)) issues.error('play.locale.unknown', `“${pl}” is not a Google Play listing language.`, at('playLocale'));
      const other = seenPlay.get(pl);
      if (other) issues.error('play.locale.duplicate', `${other} and ${locale} both map to the Play language ${pl}; supply would overwrite one with the other.`, at('playLocale'));
      seenPlay.set(pl, locale);
    }

    // ---- limits ----
    const values: Record<PlayTextField, string> = { title: l.title, shortDescription: l.shortDescription, fullDescription: l.fullDescription, changelog: l.changelog };
    for (const [field, limit] of Object.entries(PLAY_TEXT_LIMITS) as Array<[PlayTextField, (typeof PLAY_TEXT_LIMITS)[PlayTextField]]>) {
      const v = values[field];
      const chars = graphemeLength(v);
      lm[field] = { chars, bytes: byteLength(v), limit: limit.max, unit: 'chars' };
      if (limit.required && !v.trim()) issues.error('play.text.required', `${field} cannot be empty.`, at(field));
      else if (chars > limit.max) issues.error('play.text.too-long', `${field} is ${chars}/${limit.max} characters.`, { ...at(field), fix: `Shorten by ${chars - limit.max} characters.` });
      if (v !== v.trim()) issues.warn('play.text.whitespace', `${field} has leading/trailing whitespace.`, at(field));
    }
    if (l.changelog.trim()) anyChangelog = true;

    // ---- title: Play metadata policy ----
    const emoji = emojiOrEmoticon(l.title);
    if (emoji) issues.error('play.title.emoji', `The title contains “${emoji}”; Play does not allow emoji or emoticons in the title.`, at('title'));
    const rep = REPEATED_SPECIAL_RE.exec(l.title);
    if (rep) issues.error('play.title.special-chars', `The title repeats special characters (“${rep[0]}”).`, at('title'));
    if (isAllCaps(l.title) && l.title.trim() !== brand.trim()) {
      issues.error('play.title.all-caps', 'The title is written in ALL CAPS; Play allows that only when it is the brand name.', { ...at('title'), fix: 'Use sentence or title case.' });
    } else {
      for (const w of allCapsWords(l.title, brand)) issues.warn('play.title.all-caps', `“${w}” is in capitals; avoid ALL CAPS unless it is part of the brand.`, at('title'));
    }
    if (URL_IN_TEXT_RE.test(l.title)) issues.error('play.title.url', 'The title contains a URL.', at('title'));
    const titleWords = tokenize(l.title, locale).filter((w) => !STOP_FOR_DUPES.has(w));
    const dupes = titleWords.filter((w, i) => titleWords.indexOf(w) !== i);
    if (dupes.length) issues.error('play.title.repeated-word', `The title repeats “${[...new Set(dupes)].join(', ')}”; repetition reads as keyword stuffing.`, at('title'));

    // ---- ranking / price / promo claims ----
    const base = baseLanguage(pl ?? locale);
    const promo = [...new Set([...termsFor(forbidden.price, base), ...termsFor(forbidden.superlatives, base), ...(PLAY_PROMO_TERMS[base] ?? []), ...(base === 'en' ? [] : PLAY_PROMO_TERMS.en!.filter((t) => t.includes(' ')))])];
    for (const t of promo) {
      if (containsTerm(l.title, t, locale)) issues.error('play.title.promo', `The title contains “${t}”; Play forbids ranking, performance, price and promotional claims in the title.`, at('title'));
      if (containsTerm(l.shortDescription, t, locale)) issues.warn('play.short.promo', `The short description contains “${t}”; keep ranking, price and promotional claims out of it.`, at('shortDescription'));
    }
    for (const t of termsFor(forbidden.superlatives, base)) {
      if (containsTerm(l.fullDescription, t, locale)) issues.warn('play.description.superlative', `The full description contains “${t}”; unverifiable ranking claims violate the Play metadata policy.`, at('fullDescription'));
    }

    // ---- short description ----
    const shortEmoji = emojiOrEmoticon(l.shortDescription);
    if (shortEmoji) issues.warn('play.short.emoji', `The short description contains “${shortEmoji}”; emoji are discouraged in listing text.`, at('shortDescription'));
    if (isAllCaps(l.shortDescription)) issues.error('play.short.all-caps', 'The short description is written in ALL CAPS.', at('shortDescription'));
    if (URL_IN_TEXT_RE.test(l.shortDescription)) issues.warn('play.short.url', 'The short description contains a URL.', at('shortDescription'));

    // ---- full description: indexing and stuffing ----
    const counts = new Map<string, number>();
    const words = tokenize(l.fullDescription, locale).filter((w) => w.length > 3 && !STOP_FOR_DUPES.has(w));
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    for (const [w, c] of counts) {
      // Play's policy calls out excessive keyword repetition; > 5 uses that are also > 3 % of the words is a strong signal.
      if (c > 5 && c / Math.max(words.length, 1) > 0.03) issues.warn('play.description.stuffing', `“${w}” appears ${c} times in the full description; it may be treated as keyword stuffing.`, at('fullDescription'));
    }
    for (const line of l.fullDescription.split('\n')) {
      const parts = line.split(/[,;|·•]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 6 && parts.every((p) => tokenize(p, locale).length <= 2)) {
        issues.warn('play.description.keyword-list', `A line is a bare keyword list (“${line.trim().slice(0, 40)}…”); Play treats keyword lists as spam.`, at('fullDescription'));
        break;
      }
    }
    const firstLine = l.fullDescription.split('\n').find((x) => x.trim()) ?? '';
    if (graphemeLength(firstLine) < 40) issues.info('play.description.hook', 'Only the first lines of the full description show before “About this app” is opened; lead with what the app does.', at('fullDescription'));
    for (const m of l.fullDescription.matchAll(/<\/?([a-z][a-z0-9]*)(\s[^>]*)?>/gi)) {
      if (!PLAY_ALLOWED_TAGS.has(m[1]!.toLowerCase())) {
        issues.warn('play.description.html', `The full description contains <${m[1]}>; only basic formatting (b, i, u, br) is rendered.`, at('fullDescription'));
        break;
      }
    }
    for (const t of APPLE_ONLY_TERMS) {
      for (const [field, text] of [['title', l.title], ['shortDescription', l.shortDescription], ['fullDescription', l.fullDescription], ['changelog', l.changelog]] as const) {
        if (containsTerm(text, t, locale)) issues.warn('play.text.other-store', `${field} mentions “${t}”; the Play listing is for Android users.`, at(field));
      }
    }
    for (const b of brands) {
      for (const [field, text] of [['title', l.title], ['shortDescription', l.shortDescription], ['fullDescription', l.fullDescription]] as const) {
        if (containsTerm(text, b, locale)) issues.error('play.text.competitor-brand', `${field} contains a competitor brand name (“${b}”).`, at(field));
      }
    }

    // ---- promo video ----
    if (l.video?.trim()) {
      if (!YOUTUBE_RE.test(l.video.trim())) {
        issues.error('play.url.video', `video must be a public YouTube video URL (https://www.youtube.com/watch?v=…): ${l.video}`, { ...at('video'), fix: 'Use a single public, non-age-restricted YouTube video; playlists and channel URLs are rejected.' });
      } else if (/[?&]list=/.test(l.video)) {
        issues.warn('play.url.video-playlist', 'The video URL points into a playlist; use the plain video URL.', at('video'));
      }
    }

    // ---- claims ----
    for (const claim of l.claims) {
      for (const id of claim.featureIds) {
        if (!featureIds.has(id)) issues.error('play.claim.unknown-feature', `Claim “${claim.text}” references an unknown feature: ${id}.`, at('claims'));
      }
      const all = [l.title, l.shortDescription, l.fullDescription, l.changelog].join('\n').toLocaleLowerCase(locale);
      if (!all.includes(claim.text.toLocaleLowerCase(locale))) issues.warn('play.claim.not-in-copy', `Claim text does not appear verbatim in the listing: “${claim.text}”.`, at('claims'));
    }
  }

  if (anyChangelog && !app?.versionCode) {
    issues.warn('play.changelog.no-version-code', 'A changelog is set but metadata/listing/play/app.json has no versionCode; the release notes are not uploaded.', { file: 'metadata/listing/play/app.json', field: 'versionCode' });
  }
  return { issues, measurements };
}

/** Apps in the Kids Category declare a kids age band; only they may use "for kids" wording. */
function isKidsCategory(app?: AppMetadata): boolean {
  const answers = (app?.ageRatingDraft?.answers ?? {}) as Record<string, unknown>;
  return Boolean(answers.kidsAgeBand ?? answers.madeForKids);
}
