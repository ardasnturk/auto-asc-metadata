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
      issues.error('metadata.missing-locale', `${locale} için metadata dosyası yok (.vitrin/metadata/${locale}.json).`, { locale });
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
      if (limit.required && !v.trim()) issues.error('text.required', `${field} boş olamaz.`, at(field));
      else if (n > limit.max) {
        issues.error('text.too-long', `${field} ${n}/${limit.max} ${limit.unit === 'bytes' ? 'bayt' : 'karakter'}.`, {
          ...at(field),
          fix: `${n - limit.max} ${limit.unit === 'bytes' ? 'bayt' : 'karakter'} kısalt.`,
        });
      } else if (v.trim() && n < limit.min) issues.error('text.too-short', `${field} en az ${limit.min} karakter olmalı.`, at(field));
      if (v !== v.trim()) issues.warn('text.whitespace', `${field} başında/sonunda boşluk var.`, at(field));
      if (HTML_RE.test(v)) issues.error('text.html', `${field} HTML içeriyor; App Store yalnız düz metin kabul eder.`, at(field));
    }

    // ---- name / subtitle ----
    const nameWords = tokenize(m.name, locale).filter((w) => !STOP_FOR_DUPES.has(w));
    const subWords = tokenize(m.subtitle, locale).filter((w) => !STOP_FOR_DUPES.has(w));
    const repeated = subWords.filter((w) => nameWords.includes(w));
    if (repeated.length) {
      issues.error('aso.subtitle-repeats-name', `Alt başlık addaki kelimeleri tekrar ediyor: ${[...new Set(repeated)].join(', ')}.`, {
        ...at('subtitle'),
        fix: 'Alt başlıkta addan farklı, ikincil anahtar kelime kullan.',
      });
    }

    // ---- keywords ----
    const kwField = m.keywords;
    if (/,\s|\s,/.test(kwField)) {
      issues.error('keywords.spaces', 'Virgüllerin etrafında boşluk var; her boşluk bir bayt harcar.', { ...at('keywords'), fix: 'Virgülleri boşluksuz yaz: kelime1,kelime2' });
    }
    const terms = splitKeywords(kwField);
    const seen = new Set<string>();
    const isCjk = /^(ja|ko|zh)/.test(locale);
    for (const term of terms) {
      const lower = term.toLocaleLowerCase(locale);
      if (seen.has(lower)) issues.error('keywords.duplicate', `“${term}” kelime alanında birden fazla geçiyor.`, at('keywords'));
      seen.add(lower);
      if (graphemeLength(term) <= 2 && !isCjk) {
        issues.error('keywords.too-short', `“${term}” 2 karakterden uzun olmalı.`, at('keywords'));
      }
      for (const w of tokenize(term, locale)) {
        if (nameWords.includes(w) || subWords.includes(w)) {
          issues.error('keywords.repeats-name', `“${w}” zaten ad/alt başlıkta; kelime alanında tekrar etmek bayt israfı.`, { ...at('keywords'), fix: `“${w}” kelimesini çıkar.` });
        }
      }
      if (developer && containsTerm(term, developer, locale)) {
        issues.error('keywords.developer-name', `Geliştirici adı (“${developer}”) kelime alanında olmamalı.`, at('keywords'));
      }
      for (const tm of forbidden.appleTrademarks) {
        if (containsTerm(term, tm, locale)) issues.error('keywords.apple-trademark', `Apple markası “${tm}” kelime alanında kullanılamaz.`, at('keywords'));
      }
    }
    for (const t of terms) {
      const lower = t.toLocaleLowerCase(locale);
      const plurals = pluralForms(lower, locale);
      for (const p of plurals) {
        if (seen.has(p)) issues.warn('keywords.plural', `“${t}” ve “${p}” birlikte var; App Store tekil/çoğulu eşleştirir, birini çıkar.`, at('keywords'));
      }
    }
    for (const noise of forbidden.keywordNoise) {
      if (seen.has(noise.toLowerCase())) issues.warn('keywords.noise', `“${noise}” düşük değerli; bu baytı başka kelimeye ver.`, at('keywords'));
    }
    if (byteLength(kwField) < 80) {
      issues.info('keywords.underused', `Kelime alanı ${byteLength(kwField)}/100 bayt; kalan baytları kullan.`, at('keywords'));
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
        if (field === 'promotionalText') issues.warn('text.price', `${field} fiyat ifadesi içeriyor (“${t}”); fiyat App Store’da zaten görünür.`, at(field));
        else issues.error('text.price', `${field} fiyat ifadesi içeriyor (“${t}”).`, at(field));
      }
      for (const t of superTerms) if (containsTerm(text, t, locale)) issues.error('text.superlative', `${field} kanıtsız üstünlük iddiası içeriyor (“${t}”).`, at(field));
    }
    for (const t of superTerms) {
      if (containsTerm(m.description, t, locale)) issues.warn('text.superlative', `Açıklamada “${t}” var; belgeli değilse kaldır.`, at('description'));
    }
    for (const t of priceTerms.filter((x) => x.length > 1)) {
      if (containsTerm(m.description, t, locale)) issues.warn('text.price', `Açıklamada fiyat ifadesi (“${t}”); abonelik bilgisi değilse kaldır.`, at('description'));
    }
    for (const brand of brands) {
      for (const [field, text] of [...strictFields, ['description', m.description] as [string, string], ['whatsNew', m.whatsNew] as [string, string]]) {
        if (containsTerm(text, brand, locale)) {
          issues.error('text.competitor-brand', `${field} rakip marka adı içeriyor (“${brand}”).`, { ...at(field), fix: 'Başka uygulama veya şirket adı kullanılamaz.' });
        }
      }
    }

    // ---- description quality ----
    const firstLines = m.description.split('\n').filter((l) => l.trim()).slice(0, 3).join(' ');
    if (graphemeLength(firstLines) < 40) issues.warn('description.hook', 'Açıklamanın ilk 3 satırı “devamını oku” öncesi görünür; güçlü bir kanca yaz.', at('description'));
    const counts = new Map<string, number>();
    for (const w of tokenize(m.description, locale)) if (w.length > 3 && !STOP_FOR_DUPES.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    for (const [w, c] of counts) {
      if (c > 6) issues.warn('description.stuffing', `“${w}” açıklamada ${c} kez geçiyor; kelime doldurma gibi görünebilir.`, at('description'));
    }

    // ---- URLs ----
    const urlChecks: Array<[string, string | undefined, boolean]> = [
      ['supportUrl', m.supportUrl ?? config.urls.support, true],
      ['privacyUrl', m.privacyUrl ?? config.urls.privacy, true],
      ['marketingUrl', m.marketingUrl ?? config.urls.marketing, false],
    ];
    for (const [field, url, required] of urlChecks) {
      if (!url) {
        if (required) issues.error('url.missing', `${field} zorunlu (metadata ya da vitrin.config.yaml urls).`, at(field));
        continue;
      }
      if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) issues.error('url.invalid', `${field} geçerli bir URL değil: ${url}`, at(field));
      else if (!url.startsWith('https://')) issues.warn('url.http', `${field} https kullanmalı.`, at(field));
      if (/\/\/(www\.)?example\.(com|org|net)\b/i.test(url)) issues.warn('url.placeholder', `${field} yer tutucu (${url}); yüklemeden önce gerçek adresi yaz.`, at(field));
    }

    // ---- claims ----
    for (const claim of m.claims) {
      for (const id of claim.featureIds) {
        if (!featureIds.has(id)) {
          issues.error('claim.unknown-feature', `İddia “${claim.text}” bilinmeyen özelliğe bağlı: ${id}.`, { ...at('claims'), fix: 'app_profile.json features içinde kanıtlı bir özelliğe bağla ya da iddiayı kaldır (App Review 2.3).' });
        }
      }
      const all = [m.name, m.subtitle, m.promotionalText, m.description, m.whatsNew].join('\n');
      if (!all.toLocaleLowerCase(locale).includes(claim.text.toLocaleLowerCase(locale))) {
        issues.warn('claim.not-in-copy', `İddia metni metinde birebir geçmiyor: “${claim.text}”.`, at('claims'));
      }
    }
    if (!m.claims.length) issues.warn('claim.none', 'claims listesi boş; açıklamadaki özellik iddialarını app_profile özelliklerine bağla.', at('claims'));
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
        issues.warn('keywords.cross-locale-duplicate', `${a.locale} ve ${b.locale} ${shared.length} ortak kelime taşıyor; aynı storefront’ta sayılabilecek ek dillere farklı kelimeler yaz.`, { locale: b.locale, field: 'keywords' });
      }
    }
  }

  // ---- app level ----
  if (appMetadata) {
    if (!/^\d{4}\s+\S/.test(appMetadata.copyright)) {
      issues.error('copyright.format', `Telif “2026 Şirket Adı” biçiminde olmalı: “${appMetadata.copyright}”.`, { field: 'copyright', file: '.vitrin/metadata/app.json' });
    }
    if (appMetadata.copyright.includes('©')) issues.warn('copyright.symbol', '© işaretini yazma; App Store ekler.', { field: 'copyright' });
    const notesBytes = byteLength(appMetadata.reviewNotes);
    if (notesBytes > TEXT_LIMITS.reviewNotes.max) issues.error('text.too-long', `İnceleme notları ${notesBytes}/4000 bayt.`, { field: 'reviewNotes' });
    if (appMetadata.secondaryCategory && appMetadata.secondaryCategory === appMetadata.primaryCategory) {
      issues.error('category.same', 'Birincil ve ikincil kategori aynı olamaz.', { field: 'secondaryCategory' });
    }
  } else {
    issues.error('metadata.app-missing', '.vitrin/metadata/app.json yok (telif, kategori, inceleme notları).');
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
