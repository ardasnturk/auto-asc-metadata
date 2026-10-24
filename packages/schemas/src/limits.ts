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
