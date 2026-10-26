import { z } from 'zod';

export const TargetKindEnum = z.enum(['screenshot', 'preview', 'creative', 'event']);

/** Device family a target is rendered for (drives device frames and raw-capture lookup). */
export const TargetFamilyEnum = z.enum(['iphone', 'ipad', 'duo', 'mac', 'tv', 'vision', 'watch', 'android-phone', 'android-tablet', 'any']);
export type TargetFamily = z.infer<typeof TargetFamilyEnum>;

export const StoreEnum = z.enum(['app-store', 'google-play']);
export type Store = z.infer<typeof StoreEnum>;

/** Platforms Vitrin can detect in a project and produce store assets for. */
export const PlatformEnum = z.enum(['ios', 'macos', 'watchos', 'tvos', 'visionos', 'android']);
export type Platform = z.infer<typeof PlatformEnum>;

export const RenderTarget = z.object({
  id: z.string(),
  kind: TargetKindEnum,
  label: z.string(),
  family: TargetFamilyEnum,
  /** Store the asset is uploaded to. */
  store: StoreEnum.default('app-store'),
  /** Platform the asset belongs to; only targets whose platform the app ships on are enabled. */
  platform: PlatformEnum.default('ios'),
  width: z.number().int(),
  height: z.number().int(),
  /** Logical CSS size × deviceScaleFactor must equal width × height exactly. */
  logical: z.object({ width: z.number().int(), height: z.number().int(), scale: z.number().int() }),
  /** Other pixel sizes App Store Connect accepts for the same class (validation only). */
  acceptedSizes: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
  /** Range-based assets (search results, events) accept anything between min and max with the same ratio. */
  sizeRange: z.object({ min: z.tuple([z.number(), z.number()]), max: z.tuple([z.number(), z.number()]) }).optional(),
  requirement: z.enum(['always', 'if-ipad', 'from-2027-04', 'optional']),
  defaultEnabled: z.boolean(),
  formats: z.array(z.enum(['png', 'jpeg', 'mp4', 'mov'])),
  /** Simulator device type used for raw capture (simctl device type name). */
  simulator: z.string().optional(),
  /** App Asset Library display class. Values other than IPHONE_DUO are unverified: doctor compares with refData. */
  assetLibraryDisplayClass: z.string().optional(),
  video: z
    .object({
      minSec: z.number(),
      maxSec: z.number(),
      fps: z.array(z.number()),
      maxBytes: z.number(),
      h264Level: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});
export type RenderTarget = z.infer<typeof RenderTarget>;

export const TargetsFile = z.object({
  updatedAt: z.string(),
  source: z.array(z.string()),
  targets: z.array(RenderTarget),
});
export type TargetsFile = z.infer<typeof TargetsFile>;
