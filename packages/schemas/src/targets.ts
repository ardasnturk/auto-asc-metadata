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
  /**
   * Deprecated and ignored: the App Store Connect display types and App Asset Library classes now live in
   * data/asc-display-types.json (AscDisplayTypesFile), derived from the ASC API 4.5.1 OpenAPI spec.
   */
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

// ---- data/asc-display-types.json — enums copied from the App Store Connect API 4.5.1 OpenAPI spec ----

/** components.schemas.ScreenshotDisplayType (classic appScreenshotSets). There is no APP_IPHONE_69 or Duo type. */
export const ScreenshotDisplayTypeEnum = z.enum([
  'APP_IPHONE_67', 'APP_IPHONE_61', 'APP_IPHONE_65', 'APP_IPHONE_58', 'APP_IPHONE_55', 'APP_IPHONE_47', 'APP_IPHONE_40', 'APP_IPHONE_35',
  'APP_IPAD_PRO_3GEN_129', 'APP_IPAD_PRO_3GEN_11', 'APP_IPAD_PRO_129', 'APP_IPAD_105', 'APP_IPAD_97',
  'APP_DESKTOP', 'APP_WATCH_ULTRA', 'APP_WATCH_SERIES_10', 'APP_WATCH_SERIES_7', 'APP_WATCH_SERIES_4', 'APP_WATCH_SERIES_3',
  'APP_APPLE_TV', 'APP_APPLE_VISION_PRO',
  'IMESSAGE_APP_IPHONE_67', 'IMESSAGE_APP_IPHONE_61', 'IMESSAGE_APP_IPHONE_65', 'IMESSAGE_APP_IPHONE_58', 'IMESSAGE_APP_IPHONE_55', 'IMESSAGE_APP_IPHONE_47', 'IMESSAGE_APP_IPHONE_40',
  'IMESSAGE_APP_IPAD_PRO_3GEN_129', 'IMESSAGE_APP_IPAD_PRO_3GEN_11', 'IMESSAGE_APP_IPAD_PRO_129', 'IMESSAGE_APP_IPAD_105', 'IMESSAGE_APP_IPAD_97',
]);
export type ScreenshotDisplayType = z.infer<typeof ScreenshotDisplayTypeEnum>;

/** components.schemas.PreviewType (classic appPreviewSets). */
export const PreviewTypeEnum = z.enum([
  'IPHONE_67', 'IPHONE_61', 'IPHONE_65', 'IPHONE_58', 'IPHONE_55', 'IPHONE_47', 'IPHONE_40', 'IPHONE_35',
  'IPAD_PRO_3GEN_129', 'IPAD_PRO_3GEN_11', 'IPAD_PRO_129', 'IPAD_105', 'IPAD_97', 'DESKTOP', 'APPLE_TV', 'APPLE_VISION_PRO',
]);
export type PreviewType = z.infer<typeof PreviewTypeEnum>;

/** components.schemas.AppAssetLibraryPlacementType. */
export const AssetLibraryPlacementTypeEnum = z.enum([
  'APP_SCREENSHOT', 'IMESSAGE_APP_SCREENSHOT', 'APP_PREVIEW', 'PRODUCT_PAGE_HEADER_ASSET', 'APP_STORE_SEARCH_RESULTS_ASSET',
  'SEARCH_RESULTS_ADS_ASSET', 'TODAY_TAB_ADS_ASSET', 'EVENT_CARD_ASSET', 'EVENT_DETAILS_PAGE_ASSET', 'RETENTION_MESSAGE_ASSET',
]);
export type AssetLibraryPlacementType = z.infer<typeof AssetLibraryPlacementTypeEnum>;

/** components.schemas.AppAssetLibraryDisplayClass. */
export const AssetLibraryDisplayClassEnum = z.enum([
  'DEFAULT', 'WATCH_ULTRA', 'WATCH_SERIES_10', 'WATCH_SERIES_7', 'WATCH_SERIES_4', 'WATCH_SERIES_3', 'IPHONE_DUO',
  'IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY', 'IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY', 'IPHONE_FACE_ID_LARGE_DISPLAY', 'IPHONE_FACE_ID_MEDIUM_DISPLAY',
  'IPHONE_HOME_BUTTON_LARGE_DISPLAY', 'IPHONE_HOME_BUTTON_MEDIUM_DISPLAY', 'IPHONE_HOME_BUTTON_40_DISPLAY', 'IPHONE_HOME_BUTTON_35_DISPLAY',
  'IPAD_13_DISPLAY', 'IPAD_11_DISPLAY', 'IPAD_129_DISPLAY', 'IPAD_105_DISPLAY', 'IPAD_97_DISPLAY',
]);
export type AssetLibraryDisplayClass = z.infer<typeof AssetLibraryDisplayClassEnum>;

/** components.schemas.AppAssetLibraryPlacementPlatform. */
export const AssetLibraryPlatformEnum = z.enum(['IPHONE_APP_STORE', 'IPAD_APP_STORE', 'WATCH_APP_STORE', 'IMESSAGE_APP_STORE', 'VISION_PRO_APP_STORE', 'MAC_APP_STORE', 'TV_APP_STORE', 'ANY']);
export type AssetLibraryPlatform = z.infer<typeof AssetLibraryPlatformEnum>;

/** components.schemas.AppAssetLibraryAssetCategory (required on image/video create). */
export const AssetLibraryCategoryEnum = z.enum(['CREATIVE_ASSETS', 'APP_SCREENSHOTS_AND_PREVIEWS']);
export type AssetLibraryCategory = z.infer<typeof AssetLibraryCategoryEnum>;

export const AscTargetDisplayTypes = z.object({
  /** Classic appScreenshotSets type; null/absent = not supported by the classic API. */
  screenshotDisplayType: ScreenshotDisplayTypeEnum.nullable().optional(),
  /** Classic appPreviewSets type; null/absent = not supported by the classic API. */
  previewType: PreviewTypeEnum.nullable().optional(),
  assetLibrary: z
    .object({
      placementType: AssetLibraryPlacementTypeEnum,
      displayClass: AssetLibraryDisplayClassEnum,
      platform: AssetLibraryPlatformEnum,
      category: AssetLibraryCategoryEnum,
    })
    .optional(),
});
export type AscTargetDisplayTypes = z.infer<typeof AscTargetDisplayTypes>;

export const AscDisplayTypesFile = z.object({
  updatedAt: z.string(),
  source: z.array(z.string()),
  notes: z.array(z.string()).default([]),
  /** Keyed by RenderTarget.id. */
  targets: z.record(z.string(), AscTargetDisplayTypes),
});
export type AscDisplayTypesFile = z.infer<typeof AscDisplayTypesFile>;
