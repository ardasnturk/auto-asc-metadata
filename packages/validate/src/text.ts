import { baseLanguage, byteLength, graphemeLength, loadForbiddenTerms, splitKeywords, storefrontForLocale, tokenize } from '@vitrin/core';
import { TEXT_LIMITS, type AppMetadata, type AppProfile, type Competitors, type LocaleMetadata, type TextField, type ValidationReport, type VitrinConfig } from '@vitrin/schemas';
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
  const developer = config.copyrightHolder ?? '';
  const seeds = Array.isArray(config.research.seeds) ? config.research.seeds : Object.values(config.research.seeds).flat();
  const brands = competitorBrands(competitors, [profile?.app.displayName ?? '', developer], seeds);
  const featureIds = new Set(profile?.features.map((f) => f.id) ?? []);

  for (const locale of config.app.locales) {
    if (!locales.has(locale)) {
      issues.error('metadata.missing-locale', `No metadata file for ${locale} (.vitrin/metadata/${locale}.json).`, { locale });
    }
  }

  for (const [locale, m] of locales) {
    const at = (field: string) => ({ locale, field, file: `.vitrin/metadata/${locale}.json` });
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
      issues.error('copyright.format', `Copyright must be in the form “2026 Company Name”: “${appMetadata.copyright}”.`, { field: 'copyright', file: '.vitrin/metadata/app.json' });
    }
    if (appMetadata.copyright.includes('©')) issues.warn('copyright.symbol', 'Do not include the © symbol; the App Store adds it.', { field: 'copyright' });
    const notesBytes = byteLength(appMetadata.reviewNotes);
    if (notesBytes > TEXT_LIMITS.reviewNotes.max) issues.error('text.too-long', `Review notes are ${notesBytes}/4000 bytes.`, { field: 'reviewNotes' });
    if (appMetadata.secondaryCategory && appMetadata.secondaryCategory === appMetadata.primaryCategory) {
      issues.error('category.same', 'Primary and secondary category cannot be the same.', { field: 'secondaryCategory' });
    }
  } else {
    issues.error('metadata.app-missing', '.vitrin/metadata/app.json is missing (copyright, categories, review notes).');
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
