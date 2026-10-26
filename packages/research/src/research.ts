import { cachedFetch, ensureDir, existsSync, log, readJsonIfExists, storefrontForLocale, storefrontInfo, writeJson, type AppPaths } from '@vitrin/core';
import { Competitors as CompetitorsSchema, KeywordPlan, type AppProfile, type CompetitorApp, type Competitors, type KeywordCandidate, type VitrinConfig } from '@vitrin/schemas';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GENRE_IDS, ItunesClient, toCompetitor, type ItunesSoftware } from './itunes.js';
import { competitionScore, estimatePopularity, nameTermFrequency, stopwordsFor, totalScore } from './keywords.js';
import { ocrBinary, ocrImages, visionLanguage } from './ocr.js';
import { extractPalette } from './palette.js';
import { appleAdsAvailable, appTweakProvider, type PopularityProvider } from './popularity.js';

export interface ResearchOptions {
  paths: AppPaths;
  config: VitrinConfig;
  profile: AppProfile;
  env: NodeJS.ProcessEnv;
  /** Skip OCR/palette (faster, used in tests). */
  skipImages?: boolean;
}

export interface ResearchResult {
  competitors: Competitors;
  keywordFiles: string[];
}

export function seedsFor(config: VitrinConfig, locale: string): string[] {
  const s = config.research.seeds;
  if (Array.isArray(s)) return s;
  return s[locale] ?? s[locale.split('-')[0]!] ?? [];
}

/** Locale → storefront to research it in (prefers a configured storefront where the locale is spoken). */
export function storefrontPlan(config: VitrinConfig): Array<{ locale: string; storefront: string }> {
  return config.app.locales.map((locale) => {
    const natural = storefrontForLocale(locale);
    if (config.storefronts.includes(natural)) return { locale, storefront: natural };
    // Otherwise a configured storefront where the locale is the default or an additional language.
    const spoken = config.storefronts.find((code) => {
      const sf = storefrontInfo(code);
      return sf && (sf.default === locale || sf.additional.includes(locale));
    });
    return { locale, storefront: spoken ?? natural };
  });
}

export async function runResearch(opts: ResearchOptions): Promise<ResearchResult> {
  const { paths, config, profile, env } = opts;
  const cacheDir = join(paths.researchCache, 'http');
  const itunes = new ItunesClient({ cacheDir, ttlHours: config.research.cacheHours, minIntervalMs: 3100 });
  const plan = storefrontPlan(config);
  const storefronts = [...new Set([...config.storefronts, ...plan.map((p) => p.storefront)])];
  const bundleId = profile.app.bundleId;

  const provider: PopularityProvider | undefined = env.APPTWEAK_API_KEY ? appTweakProvider(env.APPTWEAK_API_KEY, cacheDir) : undefined;
  if (!provider && appleAdsAvailable(env)) {
    log.warn('Apple Ads credentials are set, but the Apple Ads API does not return popularity for arbitrary terms; popularity will be marked as “estimated”.');
  }

  const apps = new Map<string, CompetitorApp>(); // key: storefront:trackId
  const searchCache = new Map<string, ItunesSoftware[]>(); // storefront:term
  let self: CompetitorApp | undefined;
  const topCharts: Competitors['topCharts'] = [];
  const nameTerms: Competitors['analysis']['nameTerms'] = [];

  for (const { locale, storefront } of plan) {
    const seeds = seedsFor(config, locale);
    if (!seeds.length) throw new Error(`research.seeds is empty (${locale}). Claude should add seed terms to vitrin.config.yaml.`);
    log.step(`Research: ${storefront.toUpperCase()} / ${locale} — ${seeds.length} seed terms`);
    for (const seed of seeds) {
      const res = await itunes.search(seed, storefront, config.research.limit);
      searchCache.set(`${storefront}:${seed.toLowerCase()}`, res.results);
      res.results.forEach((r, idx) => {
        if (bundleId && r.bundleId === bundleId) return;
        const key = `${storefront}:${r.trackId}`;
        const app = apps.get(key) ?? toCompetitor(r, storefront);
        app.rankBySeed[seed] = idx + 1;
        apps.set(key, app);
      });
    }
    if (bundleId && !self) {
      const found = await itunes.lookup({ bundleId }, storefront).catch(() => []);
      if (found[0]) {
        self = toCompetitor(found[0], storefront);
        // Own reviews: the only allowed source for testimonial screenshots.
        self.reviews = await itunes.reviews(self.trackId, storefront, 2).catch(() => []);
      }
    }
    const genreId = profile.categorySuggestion ? GENRE_IDS[profile.categorySuggestion.primary] : undefined;
    for (const chart of ['topfreeapplications', 'topgrossingapplications'] as const) {
      const ids = await itunes.topChart(storefront, chart, genreId).catch(() => []);
      if (ids.length) topCharts.push({ storefront, genreId, chart, trackIds: ids });
    }
  }

  // Keep the strongest competitors per storefront: ranked by best seed rank, then rating volume.
  const kept: CompetitorApp[] = [];
  for (const storefront of storefronts) {
    const list = [...apps.values()]
      .filter((a) => a.storefront === storefront)
      .sort((a, b) => score(b) - score(a))
      .slice(0, config.research.competitors);
    kept.push(...list);
  }

  // Reviews (top 5 per storefront) and screenshot analysis (top 8 per storefront).
  const ocrBin = opts.skipImages || !config.research.ocr ? null : await ocrBinary(paths.researchCache);
  const shotDir = join(paths.researchCache, 'competitor-shots');
  await ensureDir(shotDir);
  for (const storefront of storefronts) {
    const list = kept.filter((a) => a.storefront === storefront);
    const locale = plan.find((p) => p.storefront === storefront)?.locale ?? 'en-US';
    for (const app of list.slice(0, 5)) {
      app.reviews = (await itunes.reviews(app.trackId, storefront, Math.ceil(config.research.reviewsPerApp / 50))).slice(0, config.research.reviewsPerApp);
    }
    if (opts.skipImages) continue;
    for (const app of list.slice(0, 8)) {
      const files: string[] = [];
      for (const [idx, url] of app.screenshotUrls.slice(0, 3).entries()) {
        try {
          const buf = await cachedFetch(url, { cacheDir, minIntervalMs: 200 });
          const file = join(shotDir, `${app.trackId}-${idx}.jpg`);
          if (!existsSync(file)) await writeFile(file, buf);
          files.push(file);
          if (idx === 0) app.palette = await extractPalette(buf, 5);
        } catch (err) {
          log.dim(`  could not download image (${app.name}): ${(err as Error).message}`);
        }
      }
      if (ocrBin && files.length) {
        const text = await ocrImages(ocrBin, files, [visionLanguage(locale), 'en-US']);
        app.screenshotText = files.map((f, index) => ({ index, lines: text.get(f) ?? [] }));
      }
    }
  }

  for (const { locale, storefront } of plan) {
    for (const t of nameTermFrequency(kept.filter((a) => a.storefront === storefront), locale).slice(0, 60)) {
      nameTerms.push({ ...t, storefront });
    }
  }

  const competitors: Competitors = {
    generatedAt: new Date().toISOString(),
    storefronts,
    seeds: [...new Set(plan.flatMap((p) => seedsFor(config, p.locale)))],
    self,
    apps: kept,
    topCharts,
    analysis: {
      nameTerms,
      screenshotHeadlineTerms: headlineTerms(kept),
      paletteUsage: paletteUsage(kept),
      gaps: [],
    },
  };
  // Preserve Claude-written analysis on re-runs.
  const previous = await readJsonIfExists(paths.competitors, CompetitorsSchema).catch(() => undefined);
  if (previous) {
    competitors.analysis.gaps = previous.analysis.gaps;
    competitors.analysis.reviewClusters = previous.analysis.reviewClusters;
  }
  await writeJson(paths.competitors, competitors);

  // Keyword candidates per locale.
  const keywordFiles: string[] = [];
  for (const { locale, storefront } of plan) {
    const stop = stopwordsFor(locale);
    const brandWords = new Set(
      kept
        .filter((a) => a.storefront === storefront)
        .flatMap((a) => [a.sellerName ?? '', a.name.split(/[:\-–—|]/)[0] ?? ''])
        .map((s) => s.trim().toLocaleLowerCase(locale))
        .filter((s) => s.length > 2),
    );
    const terms = new Set<string>(seedsFor(config, locale).map((s) => s.toLocaleLowerCase(locale)));
    for (const t of nameTerms.filter((n) => n.storefront === storefront)) {
      if (terms.size >= config.research.candidates) break;
      if (!stop.has(t.term) && !brandWords.has(t.term) && t.count >= 2) terms.add(t.term);
    }
    const previousPlan = await readJsonIfExists(paths.keywordFile(locale), KeywordPlan).catch(() => undefined);
    const candidates: KeywordCandidate[] = [];
    const terms_ = [...terms].slice(0, config.research.candidates);
    const pop = provider ? await provider.fetch(terms_, storefront, locale) : new Map<string, number>();
    log.step(`Keyword scoring: ${locale} (${terms_.length} terms)`);
    for (const term of terms_) {
      const key = `${storefront}:${term}`;
      let results = searchCache.get(key);
      if (!results) {
        results = (await itunes.search(term, storefront, config.research.limit)).results;
        searchCache.set(key, results);
      }
      const top10 = results.slice(0, 10).map((r) => r.userRatingCount ?? 0);
      const prev = previousPlan?.candidates.find((c) => c.term === term);
      const c: KeywordCandidate = {
        term,
        relevance: prev?.relevance ?? null,
        competition: competitionScore(results.length, top10, config.research.limit),
        popularity: pop.has(term)
          ? { score: pop.get(term)!, source: provider!.source }
          : { score: estimatePopularity(term, results, locale), source: 'estimate' },
        total: null,
      };
      c.total = totalScore(c);
      candidates.push(c);
    }
    const planOut: KeywordPlan = {
      locale,
      storefront,
      generatedAt: new Date().toISOString(),
      candidates,
      selected: previousPlan?.selected,
    };
    await writeJson(paths.keywordFile(locale), planOut);
    keywordFiles.push(paths.keywordFile(locale));
  }

  return { competitors, keywordFiles };
}

function score(a: CompetitorApp): number {
  const ranks = Object.values(a.rankBySeed);
  const best = ranks.length ? Math.min(...ranks) : 100;
  return ranks.length * 10 + (50 - Math.min(best, 50)) + Math.log10((a.userRatingCount ?? 0) + 1) * 5;
}

function headlineTerms(apps: CompetitorApp[]): Array<{ term: string; count: number }> {
  const counts = new Map<string, number>();
  for (const a of apps) {
    for (const s of a.screenshotText) {
      for (const line of s.lines) {
        for (const w of line.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
          if (w.length > 3) counts.set(w, (counts.get(w) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts.entries()].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count).slice(0, 40);
}

/** Palette usage quantised to 32 levels per channel so near-identical colors group together. */
function paletteUsage(apps: CompetitorApp[]): Array<{ hex: string; count: number }> {
  const counts = new Map<string, number>();
  for (const a of apps) {
    for (const hex of a.palette.slice(0, 3)) {
      const q =
        '#' +
        [1, 3, 5]
          .map((i) => {
            const v = Math.round(parseInt(hex.slice(i, i + 2), 16) / 32) * 32;
            return Math.min(255, v).toString(16).padStart(2, '0');
          })
          .join('')
          .toUpperCase();
      counts.set(q, (counts.get(q) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count).slice(0, 12);
}
