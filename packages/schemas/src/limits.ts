/**
 * App Store Connect text limits (Oct 2026). Source: Platform version information and App information pages.
 * `unit: 'bytes'` fields are measured as UTF-8 bytes, everything else as grapheme clusters.
 */
export const TEXT_LIMITS = {
  name: { min: 2, max: 30, unit: 'chars', required: true },
  subtitle: { min: 0, max: 30, unit: 'chars', required: false },
  promotionalText: { min: 0, max: 170, unit: 'chars', required: false },
  description: { min: 10, max: 4000, unit: 'chars', required: true },
  keywords: { min: 1, max: 100, unit: 'bytes', required: true },
  whatsNew: { min: 0, max: 4000, unit: 'chars', required: false },
  reviewNotes: { min: 0, max: 4000, unit: 'bytes', required: false },
} as const;

export type TextField = keyof typeof TEXT_LIMITS;

/** Headline in screenshots: hard limit 7 words, best practice 5 (AppScreenshotStudio 2026). */
export const MAX_HEADLINE_WORDS = 7;
export const IDEAL_HEADLINE_WORDS = 5;
/** Best practice: a caption is at most two lines. */
export const MAX_HEADLINE_LINES = 2;
/** Best practice: at least 60 % of screenshots show real UI. */
export const MIN_REAL_UI_RATIO = 0.6;
/** Minimum rendered headline height on the 6.9" target, in physical px. */
export const MIN_HEADLINE_PX_69 = 96;
export const MAX_SCREENSHOTS = 10;
export const MAX_PREVIEWS = 3;
export const WCAG_AA_LARGE = 3;
export const WCAG_AA_NORMAL = 4.5;

/**
 * Google Play store listing text limits (Oct 2026), counted in characters (grapheme clusters).
 * Title 30 (Play metadata policy, since 2021), short description 80, full description 4000,
 * release notes ("What's new") 500 per language and version code.
 */
export const PLAY_TEXT_LIMITS = {
  title: { min: 1, max: 30, unit: 'chars', required: true },
  shortDescription: { min: 1, max: 80, unit: 'chars', required: true },
  fullDescription: { min: 1, max: 4000, unit: 'chars', required: true },
  changelog: { min: 0, max: 500, unit: 'chars', required: false },
} as const;

export type PlayTextField = keyof typeof PLAY_TEXT_LIMITS;

/**
 * Google Play graphic asset rules checked before `supply` runs (issue code prefix `play.`).
 * Screenshots: JPEG or 24-bit PNG without alpha, each side 320–3840 px, long side at most twice the short side,
 * 2–8 per type (phone screenshots are needed to publish). Feature graphic: exactly 1024×500, JPEG or 24-bit PNG.
 * Icon: 512×512 32-bit PNG (alpha allowed), at most 1024 KB. The upload API accepts at most 15 MB per image.
 */
export const PLAY_IMAGE_RULES = {
  minSide: 320,
  maxSide: 3840,
  maxAspect: 2,
  minScreenshots: 2,
  maxScreenshots: 8,
  maxScreenshotBytes: 8 * 1024 * 1024,
  featureGraphic: { width: 1024, height: 500 },
  icon: { width: 512, height: 512, maxBytes: 1024 * 1024 },
  maxUploadBytes: 15 * 1024 * 1024,
} as const;

/** In-App Event text limits (characters). */
export const EVENT_LIMITS = { name: 30, shortDescription: 50, longDescription: 120 } as const;
