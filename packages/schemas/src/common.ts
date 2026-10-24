import { z } from 'zod';

/** ASC locale code as used by fastlane deliver (e.g. `tr`, `en-US`, `zh-Hans`). */
export const AscLocale = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'Invalid ASC locale code');
export type AscLocale = z.infer<typeof AscLocale>;

export const HexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, 'Color must be in #RRGGBB format');

/** kebab-case identifier used to link claims to features. */
export const FeatureId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Feature id must be kebab-case');

/** A string that differs per locale: `{ "tr": "…", "en-US": "…" }`. */
export const Localized = z.record(AscLocale, z.string());
export type Localized = z.infer<typeof Localized>;

export const Evidence = z.object({
  /** Path relative to the app project root. */
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  note: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Timestamp = z.string();
