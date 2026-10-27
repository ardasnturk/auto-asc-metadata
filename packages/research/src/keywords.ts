import { loadForbiddenTerms, tokenize } from '@vitrin/core';
import type { CompetitorApp, KeywordCandidate } from '@vitrin/schemas';
import type { ItunesSoftware } from './itunes.js';

const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'for', 'with', 'your', 'you', 'app', 'apps', 'of', 'to', 'in', 'on', 'a', 'an', 'by', 'my', 'pro', 'plus', 'lite', 'free', 'best', 'new', 'from', 'is', 'it', 'its', '&', '-'],
  tr: ['ve', 'ile', 'için', 'bir', 'bu', 'da', 'de', 'en', 'çok', 'uygulama', 'uygulaması', 'pro', 'plus', 'ücretsiz', 'yeni', 'mi', 'mı'],
  de: ['und', 'der', 'die', 'das', 'für', 'mit', 'dein', 'app', 'von', 'zu', 'ein', 'eine'],
  fr: ['et', 'le', 'la', 'les', 'pour', 'avec', 'de', 'des', 'du', 'un', 'une', 'votre', 'app'],
  es: ['y', 'el', 'la', 'los', 'las', 'para', 'con', 'de', 'del', 'un', 'una', 'tu', 'app'],
};

export function stopwordsFor(locale: string): Set<string> {
  const base = locale.split('-')[0]!;
  const noise = loadForbiddenTerms().keywordNoise;
  return new Set([...(STOPWORDS[base] ?? []), ...STOPWORDS.en!, ...noise.map((n) => n.toLowerCase())]);
}

/** Term frequency of words in competitor names (unigrams and bigrams), excluding stopwords. */
export function nameTermFrequency(apps: CompetitorApp[], locale: string): Array<{ term: string; count: number }> {
  const stop = stopwordsFor(locale);
  const counts = new Map<string, number>();
  for (const app of apps) {
    const words = tokenize(app.name, locale).filter((w) => w.length > 1 && !/^\d+$/.test(w));
    const seen = new Set<string>();
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (!stop.has(w)) seen.add(w);
      const next = words[i + 1];
      if (next && !stop.has(w) && !stop.has(next)) seen.add(`${w} ${next}`);
    }
    for (const t of seen) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Competition 0–1: half from how many of the top 10 target the term in their name (`titleShare`), half from how
 * entrenched they are (median rating count on a log scale; 1M ratings ≈ 1.0). The result count is kept for
 * reference only: iTunes Search returns the full `limit` for almost every real term, so it does not separate them.
 */
export function competitionScore(resultCount: number, top10Ratings: number[], titleShare: number): { resultCount: number; top10MedianRatings: number; titleShare: number; score: number } {
  const med = median(top10Ratings);
  const strength = Math.min(Math.log10(med + 1) / 6, 1);
  return { resultCount, top10MedianRatings: med, titleShare: round(titleShare), score: round(0.5 * titleShare + 0.5 * strength) };
}

/** Share of the first 10 results whose name contains the term. */
export function titleShare(term: string, results: Pick<ItunesSoftware, 'trackName'>[], locale: string): number {
  const t = term.toLocaleLowerCase(locale);
  const top = results.slice(0, 10);
  return top.length ? top.filter((r) => r.trackName.toLocaleLowerCase(locale).includes(t)).length / top.length : 0;
}

/**
 * Popularity estimate when no Apple Ads / AppTweak data is available: how many of the top results use the
 * term in their name, weighted by their rating volume. Always flagged with source "estimate".
 */
export function estimatePopularity(term: string, results: ItunesSoftware[], locale: string): number {
  const t = term.toLocaleLowerCase(locale);
  const top = results.slice(0, 25);
  if (!top.length) return 0;
  const inName = top.filter((r) => r.trackName.toLocaleLowerCase(locale).includes(t));
  const nameShare = inName.length / top.length;
  const volume = Math.min(Math.log10(top.reduce((a, r) => a + (r.userRatingCount ?? 0), 0) + 1) / 7, 1);
  return round(0.6 * volume + 0.4 * nameShare);
}

export function totalScore(c: Pick<KeywordCandidate, 'relevance' | 'popularity' | 'competition'>): number | null {
  if (c.relevance === null || c.relevance === undefined) return null;
  return round(c.relevance * (0.35 + 0.65 * c.popularity.score) * (1 - 0.7 * c.competition.score));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
