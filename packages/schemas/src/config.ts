import { z } from 'zod';
import { AscLocale } from './common.js';
import { PlatformEnum } from './targets.js';

/** Kinds of content a run can produce and upload; the user picks a subset per run. */
export const AssetKindEnum = z.enum(['metadata', 'screenshots', 'previews', 'creatives', 'events']);
export type AssetKind = z.infer<typeof AssetKindEnum>;

/** Ways App Store content is uploaded (Google Play always uses fastlane supply). */
export const UploaderEnum = z.enum(['deliver', 'asset-library', 'asc']);
export type Uploader = z.infer<typeof UploaderEnum>;

export const CaptureScreen = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Extra launch arguments, e.g. ["-VitrinScreen", "home"]. -VitrinDemo is always added. */
  launchArgs: z.array(z.string()).default([]),
  /** Optional deep link opened with `simctl openurl` after launch. */
  url: z.string().optional(),
  /** capture.mode html: the source files (views) the HTML recreation of this screen is based on. */
  source: z.array(z.string()).optional(),
  waitMs: z.number().int().nonnegative().default(2500),
});

export const CaptureRecording = CaptureScreen.extend({
  durationSec: z.number().min(3).max(60).default(12),
});

export const CaptureAndroid = z.object({
  /**
   * AVD per family, e.g. { "android-phone": "Pixel_9_API_36" }. Without one, Vitrin uses or creates
   * `Vitrin_<device>` from the target's device profile and the newest installed system image.
   */
  avds: z.record(z.string(), z.string()).default({}),
  /** Falls back to the analyzer's applicationId (build.gradle, app.json expo.android.package). */
  applicationId: z.string().optional(),
  /** Gradle task for native Android apps (default: assembleDebug; React Native/Expo see `reactNative.metro`). */
  gradleTask: z.string().optional(),
  /** Launcher activity (`.MainActivity` or a full class name). Resolved from the device when empty. */
  activity: z.string().optional(),
  /** Run the emulator without a window (`-no-window`). */
  headless: z.boolean().default(true),
  bootTimeoutSec: z.number().int().positive().default(300),
});

export const CaptureReactNative = z.object({
  /**
   * false (default): build Release variants that embed the JS bundle, so no Metro server is needed and no dev overlays show.
   * true: build Debug variants (`assembleDebug`, Debug configuration) and load JS from a Metro server you start yourself.
   */
  metro: z.boolean().default(false),
  /** Run `pod install` in ios/ before xcodebuild. */
  podInstall: z.boolean().default(true),
  /** Expo: run `npx expo prebuild` when ios/ or android/ is missing. */
  prebuild: z.boolean().default(true),
});

export const VitrinConfig = z.object({
  app: z.object({
    /** Falls back to APP_BUNDLE_ID, then to the Xcode project. */
    bundleId: z.string().optional(),
    project: z.string().optional(),
    scheme: z.string().optional(),
    primaryLocale: AscLocale.default('en-US'),
    locales: z.array(AscLocale).min(1).default(['en-US']),
    /** ASC Apple ID (numeric). Read from the API when empty. */
    appleId: z.string().optional(),
  }),
  /**
   * The language Vitrin talks to the user in: the skill's questions and summaries and the review gallery.
   * BCP 47 tag (en, tr, de, pt-BR …). Unset = English until the user is asked. Store copy follows app.locales instead.
   */
  ui: z.object({ language: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).optional() }).default({}),
  storefronts: z.array(z.string().length(2)).default(['us']),
  urls: z.object({
    support: z.string().url().optional(),
    marketing: z.string().url().optional(),
    privacy: z.string().url().optional(),
  }),
  copyrightHolder: z.string().optional(),
  review: z
    .object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
    })
    .default({}),
  research: z
    .object({
      /** Seed search terms: one list for all locales, or `{ "tr": [...], "en-US": [...] }`. Written by Claude. */
      seeds: z.union([z.array(z.string()), z.record(AscLocale, z.array(z.string()))]).default([]),
      /** Max competitors kept per storefront. */
      competitors: z.number().int().min(3).max(40).default(15),
      /** Max keyword candidates scored per locale (each costs one search request). */
      candidates: z.number().int().min(5).max(100).default(40),
      limit: z.number().int().min(1).max(200).default(50),
      cacheHours: z.number().default(24),
      reviewsPerApp: z.number().int().default(50),
      ocr: z.boolean().default(true),
    })
    .default({ seeds: [], competitors: 15, candidates: 40, limit: 50, cacheHours: 24, reviewsPerApp: 50, ocr: true }),
  targets: z
    .object({
      /** Target ids from data/targets.json to force on or off. */
      enable: z.array(z.string()).default([]),
      disable: z.array(z.string()).default([]),
    })
    .default({ enable: [], disable: [] }),
  /**
   * What the user asked for in this run (the skill asks with a multiple-choice list). Unset = everything detected.
   * Stages skip what is not selected, and upload leaves unselected platforms and asset kinds untouched in the store.
   */
  selection: z
    .object({
      platforms: z.array(PlatformEnum).optional(),
      assets: z.array(AssetKindEnum).optional(),
      /**
       * Formats (target ids from data/targets.json, e.g. iphone-6.9, ipad-13) the user asked for. Unset = every
       * format of the selected platforms. Unselected formats are not rendered, and their store sets stay untouched.
       */
      targets: z.array(z.string()).optional(),
    })
    .default({}),
  /** What happens to generated files after a successful, user-checked upload. Unset = ask the user. */
  retention: z
    .object({
      /** true → copy the uploaded set into `metadata/` in the project; false → delete it. */
      keep: z.boolean().optional(),
      /** Commit the kept `metadata/` folder (otherwise it is git-ignored). */
      commit: z.boolean().default(false),
    })
    .default({ commit: false }),
  capture: z
    .object({
      /**
       * html: Claude recreates each screen in HTML/CSS from the source code (.vitrin/screens/), rendered at the
       * device's screen size — no build, no simulator. launch-args: build the app and capture it in simulators /
       * emulators. xcuitest: fastlane snapshot. manual: you place the raw files yourself.
       */
      mode: z.enum(['html', 'launch-args', 'xcuitest', 'manual']).default('launch-args'),
      configuration: z.string().default('Debug'),
      appearance: z.enum(['light', 'dark']).default('light'),
      screens: z.array(CaptureScreen).default([]),
      recordings: z.array(CaptureRecording).default([]),
      /**
       * Override the simulator device type per family, e.g. { iphone: "iPhone 17 Pro", watch: "Apple Watch Series 11 (46mm)" }.
       * Families: iphone, ipad, duo, watch, tv, vision. Android families use `android.avds`.
       */
      simulators: z.record(z.string(), z.string()).default({}),
      /** Pre-built artifacts per platform (`ios`, `macos`, `watchos`, `tvos`, `visionos`: .app; `android`: .apk); skips the build. */
      prebuilt: z.record(z.string(), z.string()).default({}),
      android: CaptureAndroid.default({ avds: {}, headless: true, bootTimeoutSec: 300 }),
      reactNative: CaptureReactNative.default({ metro: false, podInstall: true, prebuild: true }),
    })
    .default({
      mode: 'launch-args',
      configuration: 'Debug',
      appearance: 'light',
      screens: [],
      recordings: [],
      simulators: {},
      prebuilt: {},
      android: { avds: {}, headless: true, bootTimeoutSec: 300 },
      reactNative: { metro: false, podInstall: true, prebuild: true },
    }),
  video: z
    .object({ enabled: z.boolean().default(true), loops: z.boolean().default(true) })
    .default({ enabled: true, loops: true }),
  upload: z
    .object({
      /**
       * deliver: fastlane deliver for text and complete sets; partial sets per display type through the
       * ASC API. asset-library: media through the App Asset Library. asc: the `asc` CLI (rorkai/App-Store-Connect-CLI,
       * `brew install asc`, no Ruby) for text and per-display-type media.
       * Unset until the user chooses (`vitrin uploader` shows what is installed); behaves like deliver until then.
       */
      uploader: UploaderEnum.optional(),
      platform: z.enum(['ios', 'osx', 'appletvos', 'xros']).default('ios'),
      appVersion: z.string().optional(),
      /** `vitrin doctor` also runs `asc validate --app <id>` (submission readiness) when the asc CLI is installed. */
      ascValidate: z.boolean().optional(),
    })
    .default({ platform: 'ios' }),
});
export type VitrinConfig = z.infer<typeof VitrinConfig>;

/**
 * The uploader in effect. Unset (the user has not chosen yet) behaves like `deliver`; `vitrin upload` asks for a
 * choice before it uploads anything (`vitrin uploader`, `vitrin select --uploader`).
 */
export function uploaderOf(config: Pick<VitrinConfig, 'upload'>): Uploader {
  return config.upload.uploader ?? 'deliver';
}
