import { log, type AppPaths } from '@vitrin/core';
import type { KeywordPlan, RankSnapshot, VitrinConfig } from '@vitrin/schemas';
import { join } from 'node:path';
import { ItunesClient } from './itunes.js';
import { seedsFor, storefrontPlan } from './research.js';

/**
 * Terms worth tracking for one locale: the ones chosen for the name, subtitle and keyword field, then the best-scored
 * candidates and those the app already ranks for. Without a plan, the research seeds.
 */
export function trackedTerms(plan: KeywordPlan | undefined, seeds: string[], max = 20): string[] {
  if (!plan) return seeds.slice(0, max);
  const chosen = plan.selected ? [...plan.selected.name, ...plan.selected.subtitle, ...plan.selected.keywords] : [];
  const scored = plan.candidates
    .filter((c) => c.total !== null || c.ownRank !== null)
    .sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || (a.ownRank ?? 999) - (b.ownRank ?? 999))
    .map((c) => c.term);
  return [...new Set([...chosen, ...scored].map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, max);
}

/** The app's own rank for its tracked terms in every researched locale/storefront (iTunes Search, 1-hour cache). */
export async function checkRanks(opts: { paths: AppPaths; config: VitrinConfig; bundleId: string; plans: Map<string, KeywordPlan> }): Promise<RankSnapshot> {
  const { config, bundleId } = opts;
  const itunes = new ItunesClient({ cacheDir: join(opts.paths.cache, 'rankings'), ttlHours: 1, minIntervalMs: 3100 });
  const entries: RankSnapshot['entries'] = [];
  for (const { locale, storefront } of storefrontPlan(config)) {
    const terms = trackedTerms(opts.plans.get(locale), seedsFor(config, locale));
    log.step(`Ranks: ${storefront.toUpperCase()} / ${locale} — ${terms.length} terms`);
    for (const term of terms) {
      const res = await itunes.search(term, storefront, config.research.limit);
      const idx = res.results.findIndex((r) => r.bundleId === bundleId);
      entries.push({ locale, storefront, term, rank: idx >= 0 ? idx + 1 : null, limit: config.research.limit });
    }
  }
  return { date: new Date().toISOString().slice(0, 10), bundleId, entries };
}

export interface RankChange {
  locale: string;
  term: string;
  before: number | null;
  after: number | null;
  /** Positive = moved up (better). Null when either side is unranked. */
  delta: number | null;
}

/** Row per term of `current`, compared with the same locale/term in `previous`. */
export function compareRanks(previous: RankSnapshot | undefined, current: RankSnapshot): RankChange[] {
  return current.entries.map((e) => {
    const p = previous?.entries.find((x) => x.locale === e.locale && x.term === e.term);
    const before = p ? p.rank : null;
    return { locale: e.locale, term: e.term, before, after: e.rank, delta: before !== null && e.rank !== null ? before - e.rank : null };
  });
}
