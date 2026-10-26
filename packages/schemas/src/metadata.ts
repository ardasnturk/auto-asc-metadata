import { z } from 'zod';
import { AscLocale, FeatureId } from './common.js';

/** A sentence or phrase in the copy that makes a product claim, linked to app_profile features. */
export const Claim = z.object({
  text: z.string().min(1),
  featureIds: z.array(FeatureId).min(1),
});
export type Claim = z.infer<typeof Claim>;

/** `metadata/listing/<locale>.json` — written by Claude, validated by the CLI. */
export const LocaleMetadata = z.object({
  locale: AscLocale,
  name: z.string(),
  subtitle: z.string().default(''),
  promotionalText: z.string().default(''),
  description: z.string(),
  /** Comma separated, no spaces after commas. Byte-limited (100 UTF-8 bytes). */
  keywords: z.string(),
  whatsNew: z.string().default(''),
  supportUrl: z.string().optional(),
  marketingUrl: z.string().optional(),
  privacyUrl: z.string().optional(),
  claims: z.array(Claim).default([]),
  /** Optional free-form notes from Claude (not uploaded). */
  notes: z.string().optional(),
});
export type LocaleMetadata = z.infer<typeof LocaleMetadata>;

/** `metadata/listing/app.json` — non-localized, app level. */
export const AppMetadata = z.object({
  copyright: z.string(),
  primaryCategory: z.string(),
  secondaryCategory: z.string().optional(),
  primarySubcategories: z.array(z.string()).max(2).default([]),
  secondarySubcategories: z.array(z.string()).max(2).default([]),
  reviewNotes: z.string().default(''),
  ageRatingDraft: z
    .object({
      answers: z.record(z.string(), z.string()),
      rationale: z.string(),
      needsUserConfirmation: z.literal(true).default(true),
    })
    .optional(),
  accessibilityDraft: z
    .array(z.object({ criterion: z.string(), supported: z.enum(['yes', 'partial', 'no', 'unknown']), evidence: z.string().optional() }))
    .optional(),
});
export type AppMetadata = z.infer<typeof AppMetadata>;

export const CustomProductPage = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().max(30),
  segment: z.string(),
  rationale: z.string(),
  deepLink: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  promotionalText: z.record(AscLocale, z.string()).default({}),
  /** Shot ids from shots.json used on this page (rendered with the page's own copy overrides). */
  shots: z.array(z.string()).default([]),
  featureIds: z.array(FeatureId).default([]),
});
export type CustomProductPage = z.infer<typeof CustomProductPage>;

export const CppSuggestions = z.object({ pages: z.array(CustomProductPage).max(70) });
export type CppSuggestions = z.infer<typeof CppSuggestions>;

/** Google Play language code as used by `supply` folder names (BCP-47-like: `tr-TR`, `en-US`, `es-419`, `iw-IL`). */
export const PlayLocale = z.string().regex(/^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/, 'Invalid Google Play language code');
export type PlayLocale = z.infer<typeof PlayLocale>;

/**
 * `metadata/listing/play/<asc-locale>.json` — Google Play store listing for one language, written by Claude.
 * Play has no keyword field: the title, short description and full description are all indexed.
 */
export const PlayListing = z.object({
  /** ASC locale this listing belongs to (the file name); the Play language comes from data/play-locales.json. */
  locale: AscLocale,
  /** Overrides the mapped Play language (e.g. `es-419` instead of `es-ES`). */
  playLocale: PlayLocale.optional(),
  /** ≤ 30 characters; no emoji, ALL CAPS, ranking, price or promotional claims. */
  title: z.string(),
  /** ≤ 80 characters. */
  shortDescription: z.string(),
  /** ≤ 4000 characters. */
  fullDescription: z.string(),
  /** "What's new" for `PlayAppMetadata.versionCode`, ≤ 500 characters. Empty = not uploaded. */
  changelog: z.string().default(''),
  /** Promo video: a public YouTube URL (supply `video.txt`). */
  video: z.string().optional(),
  claims: z.array(Claim).default([]),
  /** Optional free-form notes from Claude (not uploaded). */
  notes: z.string().optional(),
});
export type PlayListing = z.infer<typeof PlayListing>;

/** `metadata/listing/play/app.json` — app-level Google Play settings for the metadata upload. */
export const PlayAppMetadata = z.object({
  /** Version code whose release notes receive `changelog`. supply needs a release with this code on `track`. */
  versionCode: z.number().int().positive().optional(),
  /**
   * Track whose existing release supply reads (and whose release notes it updates). Vitrin never creates,
   * promotes or rolls out a release: binaries, rollout and status stay untouched.
   */
  track: z.string().default('production'),
});
export type PlayAppMetadata = z.infer<typeof PlayAppMetadata>;
