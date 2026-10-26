import { z } from 'zod';
import { AscLocale, FeatureId, HexColor, Localized } from './common.js';

export const Archetype = z.enum([
  'hero',
  'feature',
  'split',
  'collage',
  'before-after',
  'stat',
  'social-proof',
  'panoramic',
  /** Frameless real UI filling the canvas under the caption. */
  'fullbleed',
  /** Device plus magnified crops of real UI regions popping out of the screen. */
  'callout',
  /** Large device rotated and bleeding off the canvas edge. */
  'tilted',
  /** Text-first brand/proof slide (icon, big claim, laurels). Not real UI — counts against the 60/40 rule. */
  'statement',
  /** Real App Store review quotes of this app. Not real UI. */
  'testimonial',
  /** Closer: the app's real features as a wall of big one-line type. Not real UI. */
  'feature-wall',
  /** Closer: several real screens as a frameless mosaic ("look at everything it does"). */
  'mosaic',
]);

/** Archetypes that show no app UI (best practice: at least 60 % of shots show real UI). */
export const NON_UI_ARCHETYPES: ReadonlyArray<z.infer<typeof Archetype>> = ['statement', 'testimonial', 'feature-wall'];
export type Archetype = z.infer<typeof Archetype>;

export const BackgroundStyle = z.enum(['solid', 'linear', 'radial', 'mesh', 'grid', 'dots', 'panoramic']);

/**
 * Named style presets (a curated port of ParthJadhav/app-store-screenshots, MIT): each one is a full token set —
 * palette, type pairing, background recipe, decoration recipe and device treatment.
 * See plugins/vitrin/skills/vitrin/references/styles/. `vitrin-classic` is Vitrin's original mesh look and the default.
 */
export const StylePreset = z.enum([
  'vitrin-classic',
  'liquid-glass-aurora',
  'swiss-grid-bold',
  'midnight-glow-pro',
  'soft-clay-wellness',
  'quiet-japandi',
  'bento-keynote-grid',
  'magazine-cover-editorial',
  'candy-pop-social',
  'neon-athletic-night',
  'paper-sticker-skeuomorphic',
  'hand-drawn-editorial',
]);
export type StylePreset = z.infer<typeof StylePreset>;

/** How the device sits on the canvas. `auto` picks a framing per archetype and varies it across the set. */
export const Framing = z.enum(['auto', 'bleed-bottom', 'bleed-top', 'offset', 'tilted', 'two-devices', 'no-device', 'contained']);
export type Framing = z.infer<typeof Framing>;

export const Palette = z.object({
  background: z.array(HexColor).min(1).max(4),
  surface: HexColor,
  primary: HexColor,
  accent: HexColor,
  text: HexColor,
  textMuted: HexColor,
  badgeBackground: HexColor,
  badgeText: HexColor,
});
export type Palette = z.infer<typeof Palette>;

export const Typography = z.object({
  /** Must be one of the bundled OFL families (see packages/render/fonts). */
  headline: z.string(),
  body: z.string(),
  headlineWeight: z.number().int().min(100).max(900).default(800),
  headlineCase: z.enum(['none', 'upper']).default('none'),
  letterSpacing: z.number().default(-0.02),
});
export type Typography = z.infer<typeof Typography>;

export const ArtDirectionOption = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    rationale: z.string(),
    /** Why this direction stands apart from competitor screenshots. */
    differentiation: z.string(),
    /** Style preset that supplies every token not given explicitly below. Without it, `palette` is required. */
    preset: StylePreset.optional(),
    /**
     * The app's brand colors (app_profile.brand). They tint the preset: the emphasis/accent takes the brand hue
     * (darkened or lightened until it clears WCAG AA on the background) and `strength` shifts the background hues.
     */
    brand: z
      .object({
        primary: HexColor,
        secondary: HexColor.optional(),
        /** 0 = only the accent takes the brand, 1 = background hues rotate fully to the brand hue. */
        strength: z.number().min(0).max(1).default(0.35),
      })
      .optional(),
    /** Explicit palette; overrides the preset palette (required when no preset is set). */
    palette: Palette.optional(),
    typography: Typography.optional(),
    background: z
      .object({
        style: BackgroundStyle,
        angle: z.number().default(160),
        /** Strength of the decorative pattern 0–1. */
        intensity: z.number().min(0).max(1).default(0.5),
      })
      .optional(),
    device: z
      .object({
        frame: z.enum(['none', 'minimal', 'realistic']).default('minimal'),
        shadow: z.boolean().default(true),
        tilt: z.number().min(-12).max(12).default(0),
      })
      .optional(),
  })
  .superRefine((o, ctx) => {
    if (!o.preset && !o.palette) ctx.addIssue({ code: 'custom', path: ['palette'], message: 'Either `preset` or `palette` is required.' });
  });
export type ArtDirectionOption = z.infer<typeof ArtDirectionOption>;

export const ArtDirection = z.object({
  /** Preset-based and bespoke (own palette/typography) directions; the design samples can show any of them. */
  options: z.array(ArtDirectionOption).min(1).max(6),
  selected: z.string(),
  selectionReason: z.string(),
});
export type ArtDirection = z.infer<typeof ArtDirection>;

export const BadgeType = z.enum(['feature', 'new', 'proof', 'platform']);
export const PlatformBadge = z.enum(['ipad', 'apple-watch', 'iphone-duo', 'mac', 'vision', 'widgets']);

export const ProofEvidence = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rating'),
    /** Must equal the live App Store value from the iTunes Lookup API (competitors.json → self). */
    value: z.number().min(0).max(5),
    count: z.number().int().nonnegative(),
    trackId: z.number(),
  }),
  z.object({ kind: z.literal('award'), name: z.string(), url: z.string().url(), year: z.number().int() }),
]);

export const Badge = z.object({
  type: BadgeType,
  /** pill = default chip, sticker = rotated accent burst, laurel = proof/award between laurel branches. */
  style: z.enum(['pill', 'sticker', 'laurel']).default('pill'),
  /** Lucide icon name (MIT). SF Symbols are not allowed in marketing art. */
  icon: z.string().optional(),
  label: Localized,
  featureId: FeatureId.optional(),
  platform: PlatformBadge.optional(),
  proof: ProofEvidence.optional(),
});
export type Badge = z.infer<typeof Badge>;

export const ShotCopy = z.object({
  /** Small line above the headline ("Track" + headline "Blood Sugar"). */
  kicker: z.string().default(''),
  /** Wrap words in *asterisks* to colour them with the accent. */
  headline: z.string().min(1),
  subheadline: z.string().default(''),
});

const CalloutRect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.05).max(1), h: z.number().min(0.03).max(1) });

/** A magnified crop of a real screen region (fractions of the raw capture). */
export const Callout = z.object({
  screen: z.number().int().min(0).max(2).default(0),
  /** Region on the iPhone capture (also used for Duo when it falls back to the iPhone capture). */
  rect: CalloutRect,
  /** Region per device family when its UI is laid out differently (iPad). Families without a rect get no callout. */
  rects: z.object({ ipad: CalloutRect.optional(), duo: CalloutRect.optional() }).default({}),
  /** Magnification relative to how the region appears inside the device. */
  scale: z.number().min(1).max(3).default(1.6),
  side: z.enum(['left', 'right', 'center']).default('right'),
  /** Vertical position of the callout centre on the device, 0 = top, 1 = bottom. */
  at: z.number().min(0).max(1).default(0.5),
});
export type Callout = z.infer<typeof Callout>;

/** Verbatim App Store review of this app (validated against competitors.json → self.reviews). */
export const Quote = z.object({
  text: z.string().min(3).max(160),
  rating: z.number().int().min(1).max(5),
  author: z.string().optional(),
});
export type Quote = z.infer<typeof Quote>;

export const Shot = z.object({
  /** Two-digit order, e.g. "01". Files are written as NN_<slug>.png. */
  id: z.string().regex(/^\d{2}$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  archetype: Archetype,
  /** Raw capture ids (capture.screens[].id). Most archetypes use one, split/collage/before-after use 2–3, statement/testimonial may use none. */
  screens: z.array(z.string()).max(3).default([]),
  captionPosition: z.enum(['top', 'bottom']).default('top'),
  callouts: z.array(Callout).max(3).default([]),
  /** testimonial: per-locale review quotes in the review's own language (never translated). */
  quotes: z.record(AscLocale, z.array(Quote).max(3)).default({}),
  copy: z.record(AscLocale, ShotCopy),
  badges: z.array(Badge).max(3).default([]),
  /** Features the headline and subheadline claim. */
  featureIds: z.array(FeatureId).min(1),
  /** For `stat` archetype: the number shown large (must be backed by a feature or proof). */
  stat: z.object({ value: z.string(), featureId: FeatureId }).optional(),
  /** Restrict to some target ids (default: all enabled screenshot targets). */
  targets: z.array(z.string()).optional(),
  /** Device framing; `auto` varies it across the set (never the same framing twice in a row). */
  framing: Framing.default('auto'),
  /** Contrast slide: the preset's alternate palette. Use 1–2 per set for rhythm; omit to follow the preset rhythm. */
  inverted: z.boolean().optional(),
  /**
   * Cross-canvas moment: a decorative element (bloom, band, ribbon, sticker) crosses into the next screenshot.
   * On a `panoramic` shot the device itself crosses: a large tilted phone sits on the right edge and the next
   * screenshot shows its other half next to its own device, so the two read as one continuous image in the
   * store. Text never crosses. One per 5+ shot set, at most two.
   */
  bridge: z.boolean().default(false),
  /**
   * Bespoke layout: an HTML file in metadata/designs/ that Claude wrote for this shot (it replaces the archetype
   * layout; `archetype` still says what the shot is for). `<name>.<family>.html` next to it wins for that device
   * family. Placeholders and the `<vitrin-device>` tag: references/custom-designs.md.
   */
  template: z.string().regex(/^[\w.-]+\.html$/).optional(),
  /** feature-wall: one short line per real feature (each backed by `featureIds`), localized. */
  wall: z.array(Localized).max(8).default([]),
});
export type Shot = z.infer<typeof Shot>;

export const CreativeSpec = z.object({
  copy: z.record(AscLocale, ShotCopy),
  screens: z.array(z.string()).min(1).max(3),
  featureIds: z.array(FeatureId).min(1),
  badges: z.array(Badge).max(2).default([]),
});
export type CreativeSpec = z.infer<typeof CreativeSpec>;

export const InAppEventSpec = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  badge: z.enum(['CHALLENGE', 'COMPETITION', 'LIVE_EVENT', 'MAJOR_UPDATE', 'NEW_SEASON', 'PREMIERE', 'SPECIAL_EVENT']),
  name: Localized,
  shortDescription: Localized,
  longDescription: Localized,
  card: CreativeSpec,
  detail: CreativeSpec,
});

/** `metadata/shots.json` — written by Claude in the design step. */
export const ShotList = z.object({
  shots: z.array(Shot).min(1).max(10),
  creatives: z
    .object({
      header: CreativeSpec.optional(),
      search: CreativeSpec.optional(),
      events: z.array(InAppEventSpec).default([]),
    })
    .default({ events: [] }),
});
export type ShotList = z.infer<typeof ShotList>;

/** Scene type of one App Preview beat. */
export const BeatScene = z.enum([
  /** Device with the recording/screenshot; caption animates in. */
  'device',
  /** Camera flies into a region of the real UI (`zoom` rect, fractions of the capture). */
  'zoom',
  /** Two devices side by side (`secondSource`). */
  'split',
  /** Full-screen kinetic typography card (no UI — keep these short, ≤ 1.5 s). */
  'text',
  /** Big animated counter (`stat`) next to the device. */
  'stat',
  /** Feature chips pop around the device (`badges`). */
  'badges',
]);
export type BeatScene = z.infer<typeof BeatScene>;

export const VideoBeat = z.object({
  scene: BeatScene.default('device'),
  /** Recording id from capture.recordings, or a raw screenshot id. Not needed for `text`. */
  source: z.string().default(''),
  from: z.number().nonnegative().default(0),
  to: z.number().positive(),
  /** Wrap words in *asterisks* for the accent colour / highlight. */
  caption: Localized,
  featureIds: z.array(FeatureId).min(1),
  secondSource: z.string().optional(),
  zoom: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.1).max(1), h: z.number().min(0.05).max(1) }).optional(),
  stat: z.object({ value: z.number(), suffix: Localized.default({}), label: Localized.default({}), featureId: FeatureId }).optional(),
  badges: z.array(z.object({ icon: z.string().default('check'), label: Localized, featureId: FeatureId })).max(4).default([]),
});
export type VideoBeat = z.infer<typeof VideoBeat>;

/**
 * Motion style of a whole preview:
 * classic = calm fades; showcase = 3D device entrances, camera push-ins, light leaks;
 * kinetic = word-by-word typography cards between UI beats, punchy cuts;
 * energetic = tilted devices, bouncing chips, fast alternating slides and wipes.
 */
export const VideoStyle = z.enum(['classic', 'showcase', 'kinetic', 'energetic']);
export type VideoStyle = z.infer<typeof VideoStyle>;

export const VideoTransition = z.enum(['auto', 'fade', 'slide', 'wipe', 'flip', 'push', 'iris', 'none']);
export type VideoTransition = z.infer<typeof VideoTransition>;

export const PreviewPlan = z.object({
  id: z.string().regex(/^\d{2}$/),
  /** mac and tv previews are landscape 1920×1080 (preview-mac / preview-tv); vision is 3840×2160 (preview-vision). */
  device: z.enum(['iphone', 'ipad', 'mac', 'tv', 'vision']),
  style: VideoStyle.default('showcase'),
  transition: VideoTransition.default('auto'),
  /** Light-leak overlays on cuts (showcase default on). */
  lightLeaks: z.boolean().optional(),
  hook: Localized,
  hookSource: z.string(),
  /** Seconds into the hook recording (skips the app launch at the start of a capture). */
  hookFrom: z.number().nonnegative().default(1.5),
  beats: z.array(VideoBeat).min(1).max(8),
  outro: z.object({ title: Localized, subtitle: Localized.default({}) }),
});
export type PreviewPlan = z.infer<typeof PreviewPlan>;

export const LoopPlan = z.object({
  durationSec: z.number().min(5).max(30),
  fps: z.union([z.literal(30), z.literal(60)]).default(30),
  copy: Localized,
  sources: z.array(z.string()).min(1).max(4),
  featureIds: z.array(FeatureId).min(1),
});
export type LoopPlan = z.infer<typeof LoopPlan>;

/** `metadata/video-plan.json` — written by Claude. */
export const VideoPlan = z.object({
  previews: z.array(PreviewPlan).max(3),
  loops: z.object({ header: LoopPlan.optional(), search: LoopPlan.optional() }).default({}),
});
export type VideoPlan = z.infer<typeof VideoPlan>;

/** Composition rules from the quality bar (calibrated on the 1320×2868 canvas, applied as ratios). */
export const QUALITY_BAR = {
  /** Visible phone/tablet height as a share of canvas height on device slides. */
  deviceHeightMin: 0.68,
  deviceHeightMax: 0.82,
  /** Below this the device reads small and the slide empty (auto-reject). */
  deviceHeightReject: 0.65,
  /** Largest horizontal band with no content, as a share of canvas height. */
  maxEmptyBand: 0.22,
  /** Widest single headline word as a share of canvas width. */
  maxWordWidth: 0.88,
  /** WCAG AA against the worst pixel under the headline glyphs. */
  minHeadlineContrast: 4.5,
  /** background → device → headline + one accent. */
  maxLayers: 3,
  /** App Store search-result thumbnail width the thumbnail test downscales to. */
  thumbnailWidth: 220,
  /** Smallest headline font size (px) that still reads in that thumbnail. */
  thumbnailMinHeadlinePx: 11,
  /** Smallest glyph/background contrast that survives the downscale. */
  thumbnailMinContrast: 3,
} as const;

/** Render-time measurements of one image (render manifest → validate). */
export const ImageQuality = z.object({
  preset: z.string(),
  framing: z.string(),
  /** phone = phone/tablet rule (68–82 %), contained = watch/TV/Mac/Vision (fully inside), none = no device. */
  deviceRule: z.enum(['phone', 'contained', 'none']),
  /** Visible device height / canvas height (union of all devices). */
  deviceHeightRatio: z.number().optional(),
  /** Largest empty horizontal band / canvas height. */
  largestEmptyBand: z.number(),
  /** Widest headline word / canvas width. */
  widestWordRatio: z.number(),
  /** Contrast of the headline color(s) against the worst background pixel under the glyphs. */
  headlineContrast: z.number(),
  /** Same for kicker and subheadline. */
  supportContrast: z.number().optional(),
  layers: z.number().int(),
  thumbnail: z.object({
    width: z.number(),
    headlinePx: z.number(),
    /** Glyph vs background luminance contrast after downscaling. */
    contrast: z.number(),
    legible: z.boolean(),
  }),
});
export type ImageQuality = z.infer<typeof ImageQuality>;
