import { z } from 'zod';
import { AscLocale, HexColor, Timestamp } from './common.js';

export const CompetitorApp = z.object({
  trackId: z.number(),
  name: z.string(),
  sellerName: z.string().optional(),
  bundleId: z.string().optional(),
  storefront: z.string(),
  averageUserRating: z.number().optional(),
  userRatingCount: z.number().optional(),
  price: z.number().optional(),
  formattedPrice: z.string().optional(),
  primaryGenre: z.string().optional(),
  genres: z.array(z.string()).default([]),
  description: z.string().optional(),
  releaseNotes: z.string().optional(),
  version: z.string().optional(),
  currentVersionReleaseDate: z.string().optional(),
  screenshotUrls: z.array(z.string()).default([]),
  ipadScreenshotUrls: z.array(z.string()).default([]),
  iconUrl: z.string().optional(),
  /** seed term → 1-based rank in iTunes Search results. */
  rankBySeed: z.record(z.string(), z.number()).default({}),
  /** OCR text from the first three screenshots (analysis only, never copied). */
  screenshotText: z.array(z.object({ index: z.number(), lines: z.array(z.string()) })).default([]),
  palette: z.array(HexColor).default([]),
  reviews: z
    .array(z.object({ rating: z.number(), title: z.string(), content: z.string(), version: z.string().optional() }))
    .default([]),
});
export type CompetitorApp = z.infer<typeof CompetitorApp>;

export const Competitors = z.object({
  generatedAt: Timestamp,
  storefronts: z.array(z.string()),
  seeds: z.array(z.string()),
  /** The app itself if it is already live (used for verified proof badges). */
  self: CompetitorApp.optional(),
  apps: z.array(CompetitorApp),
  topCharts: z
    .array(z.object({ storefront: z.string(), genreId: z.number().optional(), chart: z.string(), trackIds: z.array(z.number()) }))
    .default([]),
  analysis: z.object({
    nameTerms: z.array(z.object({ term: z.string(), count: z.number(), storefront: z.string() })),
    screenshotHeadlineTerms: z.array(z.object({ term: z.string(), count: z.number() })).default([]),
    paletteUsage: z.array(z.object({ hex: HexColor, count: z.number() })).default([]),
    /** Written by Claude: unclaimed positioning, review complaint/praise clusters. */
    gaps: z.array(z.string()).default([]),
    reviewClusters: z
      .object({
        complaints: z.array(z.object({ label: z.string(), count: z.number() })),
        praises: z.array(z.object({ label: z.string(), count: z.number() })),
      })
      .optional(),
  }),
});
export type Competitors = z.infer<typeof Competitors>;

export const PopularitySource = z.enum(['apple-ads', 'apptweak', 'estimate']);

export const KeywordCandidate = z.object({
  term: z.string().min(1),
  /** 0–1, judged by Claude against the app profile. Null until Claude scores it. */
  relevance: z.number().min(0).max(1).nullable().default(null),
  competition: z.object({
    resultCount: z.number(),
    top10MedianRatings: z.number(),
    score: z.number().min(0).max(1),
  }),
  popularity: z.object({ score: z.number().min(0).max(1), source: PopularitySource }),
  /** relevance × popularity × (1 − competition); null while relevance is missing. */
  total: z.number().nullable().default(null),
});
export type KeywordCandidate = z.infer<typeof KeywordCandidate>;

export const KeywordPlan = z.object({
  locale: AscLocale,
  storefront: z.string(),
  generatedAt: Timestamp,
  candidates: z.array(KeywordCandidate),
  /** Chosen by Claude during `write`. */
  selected: z
    .object({
      name: z.array(z.string()).default([]),
      subtitle: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
    })
    .optional(),
});
export type KeywordPlan = z.infer<typeof KeywordPlan>;
