import { z } from 'zod';
import { AscLocale, Evidence, FeatureId, HexColor, Timestamp } from './common.js';
import { PlatformEnum } from './targets.js';

/** How the app is built: native Xcode (Swift/SwiftUI, the primary case) or a cross-platform framework. */
export const ProjectKind = z.enum(['native', 'flutter', 'react-native', 'expo']);
export type ProjectKind = z.infer<typeof ProjectKind>;

export const TargetKind = z.enum(['app', 'widget', 'watch', 'extension', 'app-clip', 'unit-tests', 'ui-tests', 'other']);

export const ProjectTarget = z.object({
  name: z.string(),
  kind: TargetKind,
  productType: z.string().optional(),
  bundleId: z.string().optional(),
  deploymentTarget: z.string().optional(),
  /** Values of TARGETED_DEVICE_FAMILY mapped to names. */
  devices: z.array(z.enum(['iphone', 'ipad', 'mac', 'vision', 'tv', 'watch'])).default([]),
  infoPlist: z.string().optional(),
  entitlements: z.string().optional(),
});
export type ProjectTarget = z.infer<typeof ProjectTarget>;

export const FeatureKind = z.enum(['core', 'capability', 'integration', 'monetization', 'platform', 'localization']);

export const Feature = z.object({
  id: FeatureId,
  title: z.string().min(1),
  description: z.string().default(''),
  kind: FeatureKind.default('core'),
  /** Every feature must point to at least one file in the project (App Review 2.3). */
  evidence: z.array(Evidence).min(1, 'Every feature needs at least one piece of evidence'),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  /** `analyzer` = deterministic detection, `claude` = added during the skill run. */
  source: z.enum(['analyzer', 'claude']).default('analyzer'),
});
export type Feature = z.infer<typeof Feature>;

export const LocaleMapping = z.object({
  xcode: z.string(),
  asc: AscLocale.nullable(),
});

export const AppProfile = z.object({
  schemaVersion: z.literal(1).default(1),
  generatedAt: Timestamp,
  project: z.object({
    root: z.string(),
    kind: ProjectKind.default('native'),
    /** Directory of the iOS host project relative to root (`ios` for Flutter/React Native, `.` for native). */
    iosDir: z.string().optional(),
    /** Android Gradle project directory relative to root (`android` for Flutter/React Native, or a native Android app). */
    androidDir: z.string().optional(),
    androidApplicationId: z.string().optional(),
    xcodeproj: z.string().optional(),
    workspace: z.string().optional(),
    scheme: z.string().optional(),
    targets: z.array(ProjectTarget),
  }),
  app: z.object({
    displayName: z.string(),
    bundleId: z.string().optional(),
    version: z.string().optional(),
    build: z.string().optional(),
    deploymentTarget: z.string().optional(),
    supportsIPhone: z.boolean().default(true),
    supportsIPad: z.boolean().default(false),
    /** iPhone Duo (foldable) layouts detected in the project. */
    supportsDuo: z.boolean().default(false),
    /** Every platform the project ships on, detected from targets, SDKs and framework folders. */
    platforms: z.array(PlatformEnum).default(['ios']),
    developmentRegion: z.string().optional(),
    knownRegions: z.array(z.string()).default([]),
    locales: z.array(LocaleMapping).default([]),
  }),
  features: z.array(Feature),
  entitlements: z.array(z.string()).default([]),
  permissions: z.array(z.object({ key: z.string(), description: z.string() })).default([]),
  iap: z
    .array(
      z.object({
        productId: z.string(),
        type: z.string(),
        displayName: z.string().optional(),
        file: z.string(),
      }),
    )
    .default([]),
  appIntents: z.array(z.object({ name: z.string(), file: z.string() })).default([]),
  brand: z.object({
    accentColor: HexColor.optional(),
    colors: z.array(z.object({ name: z.string(), hex: HexColor })).default([]),
    appIcon: z.string().optional(),
  }),
  revenueModel: z.enum(['free', 'freemium', 'subscription', 'paid', 'unknown']).default('unknown'),
  categorySuggestion: z.object({ primary: z.string(), secondary: z.string().optional(), reason: z.string() }).optional(),
  /** Filled in by Claude during the skill run. */
  positioning: z
    .object({
      audience: z.string(),
      jobToBeDone: z.string(),
      tone: z.string(),
    })
    .optional(),
  docs: z.object({
    readme: z.string().optional(),
    changelog: z.string().optional(),
    lastTag: z.string().optional(),
    commitsSinceTag: z.array(z.object({ hash: z.string(), subject: z.string() })).default([]),
  }),
  /**
   * Raw code signals keyed by topic (e.g. `accessibility.voiceover`, `age.user-generated-content`, `network.urlsession`).
   * Used to draft the accessibility declaration and age-rating answers; never uploaded as-is.
   */
  signals: z.record(z.string(), z.array(Evidence)).default({}),
  /** Things the analyzer could not decide; the skill asks Claude to resolve them. */
  todo: z.array(z.string()).default([]),
});
export type AppProfile = z.infer<typeof AppProfile>;
