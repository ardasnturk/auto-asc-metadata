/**
 * Style presets: a curated port of the named styles in ParthJadhav/app-store-screenshots (MIT, © 2026 Parth Jadhav),
 * condensed to the tokens Vitrin's HTML templates need. The prose specs Claude reads live in
 * plugins/vitrin/skills/vitrin/references/styles/.
 */
import type { ArtDirectionOption, Framing, Palette, StylePreset, Typography } from '@vitrin/schemas';
import { contrastRatio, ensureContrast, hueOf, inkOn, luminance, mix, shiftHue, withAlpha } from './color.js';

/** How the one emphasised phrase of a headline is drawn. */
export type EmphasisKind =
  /** Accent color only. */
  | 'color'
  /** Gradient fill clipped to the glyphs. */
  | 'gradient'
  /** Solid signal block behind the phrase (Swiss); falls back to color on dark surfaces. */
  | 'block'
  /** Phrase in a rotated pill with an ink border and hard offset shadow. */
  | 'pill'
  /** Italic cut in the accent color, optionally larger. */
  | 'italic'
  /** Handwritten script word with a squiggle underline. */
  | 'script'
  /** Japanese kenten dots under each letter. */
  | 'kenten'
  /** Marker headline: highlighter band and squiggle under the phrase. */
  | 'underline'
  /** Solid highlight box behind the whole phrase, upright (a label stuck on the line). */
  | 'box'
  /** Hollow letters: the phrase stroked in the emphasis color. Big, heavy type only. */
  | 'outline';

/** Emphasis kinds drawn on a plate (`plate`/`plateText`) rather than in the emphasis color. */
export const PLATED_EMPHASIS: ReadonlySet<EmphasisKind> = new Set(['block', 'pill', 'box']);

export type BackgroundRecipe = 'classic' | 'aurora' | 'swiss' | 'beam' | 'clay' | 'washi' | 'bento' | 'magazine' | 'candy' | 'neon' | 'paper' | 'doodle' | 'studio' | 'poster' | 'block' | 'gilded';

/** One slide palette. A preset has one or more; inverted slides and cycling rhythms pick another. */
export interface Surface {
  /** Background stops (1–4). */
  bg: string[];
  /** Headline ink. */
  text: string;
  /** Optional vertical gradient for the whole headline (Midnight's lit-from-above type). */
  textGradient?: string[];
  /** Kicker / subheadline ink. */
  muted: string;
  /** Emphasis fill: one color or gradient stops. Every stop clears 4.5:1 on `bg`. */
  emphasis: string[];
  /** Fill and ink for block/pill emphasis. */
  plate?: string;
  plateText?: string;
  /** Decorative accent (shapes, rims, streaks). Not used for text. */
  accent: string;
  /** Secondary decorative colors (blooms, stickers, clay tones). */
  extras: string[];
  chipBg: string;
  chipText: string;
  /** Device drop-shadow tint. */
  shadow: string;
  /** Hairlines, grids. */
  rule: string;
  dark: boolean;
  /** Overrides the preset emphasis kind on this surface (Swiss uses a block on paper, color on ink). */
  emphasisKind?: EmphasisKind;
}

export interface StyleTokens {
  id: StylePreset;
  name: string;
  surfaces: Surface[];
  /** single = always surface 0; alternate = 0/1/0/1…; cycle = every surface in turn. */
  rhythm: 'single' | 'alternate' | 'cycle';
  /** Surface used for `inverted: true` shots. */
  invert: number;
  fonts: { headline: string; body: string; label: string; script?: string };
  type: {
    weight: number;
    case: 'none' | 'upper' | 'lower';
    tracking: number;
    leading: number;
    /** Headline size as a fraction of canvas width on portrait phone canvases. */
    size: number;
    align: 'center' | 'start';
    /** Max headline lines the fitter allows before shrinking. */
    maxLines: number;
    /** Horizontal skew of the headline block in degrees (Neon). */
    skew: number;
    /** Rotation of the headline block in degrees (Paper). */
    rotate: number;
    /** Scale of the emphasised phrase relative to the headline. */
    emphasisScale: number;
    /** CSS font-variation-settings for the headline (Fraunces optical size etc.). */
    variation?: string;
    labelCase: 'upper' | 'none';
    labelTracking: number;
    subWeight: number;
  };
  emphasis: EmphasisKind;
  /** `tag` sets the kicker in a small accent chip (a category label) instead of the preset's plain label. */
  kicker?: 'plain' | 'tag';
  background: BackgroundRecipe;
  density: 'minimal' | 'editorial' | 'maximal';
  device: {
    /** Absolute tilt for tilted framings (0 = always upright). Sign alternates across the set. */
    tilt: number;
    finish: 'graphite' | 'titanium' | 'silver' | 'black';
    shadow: 'soft' | 'hard' | 'crisp' | 'glow';
    /** Rim light color (Midnight, Neon). */
    rim?: string;
    /** Framing rhythm used by `auto`, by shot index. */
    rhythm: Framing[];
    /** Share of the device height that bleeds off the canvas edge. */
    bleed: number;
  };
  badge: 'pill' | 'glass' | 'darkglass' | 'mono' | 'tile' | 'sticker' | 'paper' | 'chip';
  /** Grain overlay opacity (0 = none). */
  grain: number;
  /**
   * How the app's brand tints the preset: `full` rotates background and decoration hues toward the brand,
   * `accent` only recolors the emphasis (the preset's materials stay), `signal` swaps the single accent only when
   * the brand clears the preset's contrast pairs, `swap` replaces the signal color everywhere it appears (backgrounds
   * included) when the brand is as bright, `fixed` keeps the preset's own colors.
   */
  tint: 'full' | 'accent' | 'signal' | 'mono' | 'swap' | 'fixed';
}

const s = (o: Partial<Surface> & Pick<Surface, 'bg' | 'text' | 'muted' | 'emphasis' | 'accent'>): Surface => ({
  extras: [],
  chipBg: '#FFFFFF',
  chipText: '#111111',
  shadow: 'rgba(0,0,0,.30)',
  rule: 'rgba(0,0,0,.12)',
  dark: luminance(o.bg[0]!) < 0.2,
  ...o,
});

const baseType: StyleTokens['type'] = { weight: 800, case: 'none', tracking: -0.03, leading: 1.0, size: 0.125, align: 'center', maxLines: 2, skew: 0, rotate: 0, emphasisScale: 1, labelCase: 'none', labelTracking: 0.01, subWeight: 500 };

export const PRESETS: Record<StylePreset, StyleTokens> = {
  'vitrin-classic': {
    id: 'vitrin-classic',
    name: 'Vitrin Classic',
    surfaces: [
      s({ bg: ['#120F2E', '#3A2C9C', '#E2557A'], text: '#FFFFFF', muted: '#D9D4FF', emphasis: ['#FF8A6B'], accent: '#FF8A6B', extras: ['#7B6CFF', '#E2557A'], chipBg: '#FFFFFF', chipText: '#2A1F7A', shadow: 'rgba(8,4,40,.55)', rule: 'rgba(255,255,255,.10)' }),
      s({ bg: ['#F7F4FF', '#ECE6FF', '#FFE3DA'], text: '#1B1640', muted: '#4D4775', emphasis: ['#C8402A'], accent: '#7B6CFF', extras: ['#C9BEFF', '#FFC2B2'], chipBg: '#1B1640', chipText: '#FFFFFF', shadow: 'rgba(60,40,140,.28)', rule: 'rgba(27,22,64,.10)' }),
    ],
    rhythm: 'single',
    invert: 1,
    fonts: { headline: 'Plus Jakarta Sans', body: 'Inter', label: 'Inter' },
    type: { ...baseType, size: 0.128, tracking: -0.035, leading: 1.0 },
    emphasis: 'color',
    background: 'classic',
    density: 'editorial',
    device: { tilt: 8, finish: 'graphite', shadow: 'soft', rhythm: ['bleed-bottom', 'offset', 'bleed-bottom', 'tilted', 'two-devices', 'bleed-top'], bleed: 0.07 },
    badge: 'pill',
    grain: 0.035,
    tint: 'full',
  },
  'liquid-glass-aurora': {
    id: 'liquid-glass-aurora',
    name: 'Liquid Glass Aurora',
    surfaces: [
      s({ bg: ['#EFE9FD', '#E6EEFC', '#F7ECF3', '#FDEBDF'], text: '#16131F', muted: '#4A4660', emphasis: ['#1D46B8', '#4A2FC0', '#9A2250'], accent: '#4A2FC0', extras: ['#CDBBFF', '#AFD5FF', '#FFCDB2', '#FFC4D6'], chipBg: 'rgba(255,255,255,.55)', chipText: '#16131F', shadow: 'rgba(86,70,170,.30)', rule: 'rgba(70,55,140,.12)' }),
    ],
    rhythm: 'single',
    invert: 0,
    fonts: { headline: 'Inter Tight', body: 'Inter Tight', label: 'Inter Tight' },
    type: { ...baseType, weight: 700, size: 0.122, tracking: -0.032, leading: 0.98 },
    emphasis: 'gradient',
    background: 'aurora',
    density: 'editorial',
    device: { tilt: 0, finish: 'titanium', shadow: 'soft', rhythm: ['bleed-bottom', 'offset', 'offset', 'bleed-bottom', 'two-devices'], bleed: 0.05 },
    badge: 'glass',
    grain: 0.035,
    tint: 'full',
  },
  'swiss-grid-bold': {
    id: 'swiss-grid-bold',
    name: 'Swiss Grid Bold',
    surfaces: [
      s({ bg: ['#F2F1EC'], text: '#0E0E0C', muted: '#5E5D57', emphasis: ['#0E0E0C'], plate: '#FF4F00', plateText: '#0E0E0C', accent: '#FF4F00', chipBg: '#0E0E0C', chipText: '#F2F1EC', shadow: 'rgba(14,14,12,.28)', rule: 'rgba(14,14,12,.13)', emphasisKind: 'block' }),
      s({ bg: ['#0E0E0C'], text: '#F2F1EC', muted: '#A3A29B', emphasis: ['#FF4F00'], accent: '#FF4F00', chipBg: '#F2F1EC', chipText: '#0E0E0C', shadow: 'rgba(0,0,0,.6)', rule: 'rgba(242,241,236,.14)', emphasisKind: 'color' }),
    ],
    rhythm: 'alternate',
    invert: 1,
    fonts: { headline: 'Inter Tight', body: 'Inter Tight', label: 'JetBrains Mono' },
    type: { ...baseType, weight: 800, size: 0.13, tracking: -0.045, leading: 0.9, align: 'start', labelCase: 'upper', labelTracking: 0.02 },
    emphasis: 'block',
    background: 'swiss',
    density: 'minimal',
    device: { tilt: 0, finish: 'black', shadow: 'crisp', rhythm: ['bleed-bottom', 'bleed-top', 'offset', 'bleed-bottom', 'two-devices'], bleed: 0.1 },
    badge: 'mono',
    grain: 0,
    tint: 'signal',
  },
  'midnight-glow-pro': {
    id: 'midnight-glow-pro',
    name: 'Midnight Glow Pro',
    surfaces: [
      s({ bg: ['#0B0D13', '#08090D', '#07080B', '#050608'], text: '#F4F5F8', textGradient: ['#FFFFFF', '#FFFFFF', '#B9BDC9'], muted: '#B4B9C6', emphasis: ['#E2E0FF', '#C2BFFF', '#B3AFFF'], accent: '#8F8CFF', extras: ['#A77BFF', '#5B57E8', '#E2E0FF'], chipBg: 'rgba(17,19,26,.84)', chipText: '#F4F5F8', shadow: 'rgba(0,0,0,.8)', rule: 'rgba(255,255,255,.08)' }),
    ],
    rhythm: 'single',
    invert: 0,
    fonts: { headline: 'Inter Tight', body: 'Inter', label: 'JetBrains Mono' },
    type: { ...baseType, weight: 600, size: 0.116, tracking: -0.035, leading: 1.02, labelCase: 'upper', labelTracking: 0.15, subWeight: 400 },
    emphasis: 'gradient',
    background: 'beam',
    density: 'editorial',
    device: { tilt: 0, finish: 'titanium', shadow: 'glow', rim: '#C8C4FF', rhythm: ['bleed-bottom', 'offset', 'bleed-bottom', 'two-devices', 'offset'], bleed: 0.04 },
    badge: 'darkglass',
    grain: 0.05,
    tint: 'full',
  },
  'soft-clay-wellness': {
    id: 'soft-clay-wellness',
    name: 'Soft Clay Wellness',
    surfaces: [
      s({ bg: ['#F6EFE4', '#EFE7DA', '#E6DACA'], text: '#3A2E27', muted: '#6E5A4C', emphasis: ['#9A4B31'], accent: '#C7765A', extras: ['#A9B79C', '#E9DECC', '#6A4A5B', '#5B6A4C'], chipBg: '#F6F0E6', chipText: '#3A2E27', shadow: 'rgba(110,70,45,.30)', rule: 'rgba(58,46,39,.12)' }),
      s({ bg: ['#C8D2BB', '#B7C3A9', '#A3B195'], text: '#2A3323', muted: '#3E4A35', emphasis: ['#6E2F1D'], accent: '#C7765A', extras: ['#7F8F72', '#E9DECC', '#94492F', '#3E4A35'], chipBg: '#F6F0E6', chipText: '#2A3323', shadow: 'rgba(60,72,48,.32)', rule: 'rgba(42,51,35,.14)' }),
      s({ bg: ['#2E2230', '#3A2B3A', '#5E4254', '#8A5A5A'], text: '#F3EBDD', muted: '#D9C8BA', emphasis: ['#E6A585'], accent: '#C7765A', extras: ['#6A4A5B', '#5E4254', '#C7765A', '#3E4A35'], chipBg: '#3A2B3A', chipText: '#F3EBDD', shadow: 'rgba(25,12,22,.55)', rule: 'rgba(243,235,221,.12)' }),
    ],
    rhythm: 'single',
    invert: 2,
    fonts: { headline: 'Fraunces', body: 'DM Sans', label: 'DM Sans' },
    type: { ...baseType, weight: 420, size: 0.128, tracking: -0.025, leading: 1.0, variation: '"SOFT" 100, "WONK" 0, "opsz" 144', labelCase: 'upper', labelTracking: 0.2, subWeight: 400 },
    emphasis: 'italic',
    background: 'clay',
    density: 'editorial',
    device: { tilt: 3, finish: 'silver', shadow: 'soft', rhythm: ['bleed-bottom', 'bleed-top', 'offset', 'bleed-bottom', 'two-devices'], bleed: 0.06 },
    badge: 'paper',
    grain: 0.05,
    tint: 'accent',
  },
  'quiet-japandi': {
    id: 'quiet-japandi',
    name: 'Quiet Japandi',
    surfaces: [
      s({ bg: ['#FCFAF6', '#F3F0EA', '#E2DBCF'], text: '#1E1D1B', muted: '#4E4B46', emphasis: ['#7A5A34'], accent: '#C8321E', extras: ['#C9A97E', '#E9D6B4', '#A69E8F', '#8C8A85'], chipBg: '#F3F0EA', chipText: '#1E1D1B', shadow: 'rgba(84,62,36,.20)', rule: 'rgba(140,138,133,.5)' }),
      s({ bg: ['#2A2825', '#1E1D1B', '#171614'], text: '#F3F0EA', muted: '#C9C3B8', emphasis: ['#C9A97E'], accent: '#C8321E', extras: ['#C9A97E', '#E9D6B4', '#A69E8F', '#8C8A85'], chipBg: '#2A2825', chipText: '#F3F0EA', shadow: 'rgba(0,0,0,.5)', rule: 'rgba(243,240,234,.2)' }),
    ],
    rhythm: 'single',
    invert: 1,
    fonts: { headline: 'Shippori Mincho', body: 'DM Sans', label: 'DM Sans' },
    type: { ...baseType, weight: 500, size: 0.118, tracking: -0.012, leading: 1.08, align: 'start', labelCase: 'upper', labelTracking: 0.32, subWeight: 400 },
    emphasis: 'kenten',
    background: 'washi',
    density: 'minimal',
    device: { tilt: 0, finish: 'silver', shadow: 'soft', rhythm: ['offset', 'offset', 'bleed-bottom', 'offset', 'two-devices'], bleed: 0 },
    badge: 'paper',
    grain: 0.03,
    tint: 'accent',
  },
  'bento-keynote-grid': {
    id: 'bento-keynote-grid',
    name: 'Bento Keynote Grid',
    surfaces: [
      s({ bg: ['#F5F5F7'], text: '#1D1D1F', muted: '#5E5E63', emphasis: ['#C43A0E', '#D0224A', '#B5179E'], accent: '#B4441C', extras: ['#FFFFFF', '#F6EBE1', '#E6F0E6', '#E5EDF7', '#1D1D1F'], chipBg: '#FFFFFF', chipText: '#1D1D1F', shadow: 'rgba(40,24,12,.16)', rule: 'rgba(29,29,31,.12)' }),
    ],
    rhythm: 'single',
    invert: 0,
    fonts: { headline: 'Inter Tight', body: 'Inter', label: 'Inter' },
    type: { ...baseType, weight: 700, size: 0.108, tracking: -0.035, leading: 0.98, align: 'start', subWeight: 600 },
    emphasis: 'gradient',
    background: 'bento',
    density: 'minimal',
    device: { tilt: 0, finish: 'black', shadow: 'soft', rhythm: ['bleed-bottom', 'bleed-bottom', 'two-devices', 'bleed-bottom'], bleed: 0.12 },
    badge: 'tile',
    grain: 0,
    tint: 'accent',
  },
  'magazine-cover-editorial': {
    id: 'magazine-cover-editorial',
    name: 'Magazine Cover Editorial',
    surfaces: [
      s({ bg: ['#F1EBE1'], text: '#1A1714', muted: '#4A423A', emphasis: ['#7A2320'], accent: '#7A2320', extras: ['#5E1917', '#F6EFE3', '#E7DECF'], chipBg: '#1A1714', chipText: '#F6EFE3', shadow: 'rgba(52,14,10,.38)', rule: '#1A1714' }),
      s({ bg: ['#E7DECF'], text: '#1A1714', muted: '#4A423A', emphasis: ['#7A2320'], accent: '#7A2320', extras: ['#5E1917', '#F6EFE3', '#F1EBE1'], chipBg: '#1A1714', chipText: '#F6EFE3', shadow: 'rgba(52,14,10,.38)', rule: '#1A1714' }),
    ],
    rhythm: 'single',
    invert: 1,
    fonts: { headline: 'Fraunces', body: 'Fraunces', label: 'Fraunces' },
    type: { ...baseType, weight: 400, size: 0.138, tracking: -0.025, leading: 0.94, align: 'start', emphasisScale: 1.2, variation: '"opsz" 144, "SOFT" 0, "WONK" 1', labelCase: 'upper', labelTracking: 0.24, subWeight: 400 },
    emphasis: 'italic',
    background: 'magazine',
    density: 'editorial',
    device: { tilt: 0, finish: 'silver', shadow: 'soft', rhythm: ['offset', 'bleed-bottom', 'offset', 'two-devices', 'bleed-bottom'], bleed: 0.03 },
    badge: 'mono',
    grain: 0.05,
    tint: 'mono',
  },
  'candy-pop-social': {
    id: 'candy-pop-social',
    name: 'Candy Pop Social',
    surfaces: [
      s({ bg: ['#FF5FA8'], text: '#16121F', muted: '#16121F', emphasis: ['#FFFFFF'], plate: '#2B44F0', plateText: '#FFFFFF', accent: '#FFE23D', extras: ['#D63D86', '#FFFFFF', '#C6F135', '#2B44F0'], chipBg: '#FFFFFF', chipText: '#16121F', shadow: '#D63D86', rule: '#16121F' }),
      s({ bg: ['#2B44F0'], text: '#FFFFFF', muted: '#FFFFFF', emphasis: ['#16121F'], plate: '#C6F135', plateText: '#16121F', accent: '#C6F135', extras: ['#1A2BB0', '#FFFFFF', '#FF5FA8', '#FFE23D'], chipBg: '#FFFFFF', chipText: '#16121F', shadow: '#1A2BB0', rule: '#16121F' }),
      s({ bg: ['#C6F135'], text: '#16121F', muted: '#16121F', emphasis: ['#16121F'], plate: '#FF5FA8', plateText: '#16121F', accent: '#FF5FA8', extras: ['#9CC41A', '#FFFFFF', '#2B44F0', '#FFE23D'], chipBg: '#FFFFFF', chipText: '#16121F', shadow: '#9CC41A', rule: '#16121F' }),
      s({ bg: ['#FF7A1F'], text: '#16121F', muted: '#16121F', emphasis: ['#C6F135'], plate: '#16121F', plateText: '#C6F135', accent: '#FFE23D', extras: ['#D95E0B', '#FFFFFF', '#2B44F0', '#FF5FA8'], chipBg: '#FFFFFF', chipText: '#16121F', shadow: '#D95E0B', rule: '#16121F' }),
    ],
    rhythm: 'cycle',
    invert: 1,
    fonts: { headline: 'Bricolage Grotesque', body: 'Rubik', label: 'Rubik' },
    type: { ...baseType, weight: 800, case: 'lower', size: 0.158, tracking: -0.035, leading: 0.92, align: 'start', maxLines: 3, variation: '"opsz" 96', subWeight: 700 },
    emphasis: 'pill',
    background: 'candy',
    density: 'maximal',
    device: { tilt: 7, finish: 'black', shadow: 'hard', rhythm: ['tilted', 'tilted', 'two-devices', 'tilted', 'bleed-bottom'], bleed: 0.06 },
    badge: 'sticker',
    grain: 0.05,
    tint: 'accent',
  },
  'neon-athletic-night': {
    id: 'neon-athletic-night',
    name: 'Neon Athletic Night',
    surfaces: [
      s({ bg: ['#17191D', '#0E0F12', '#0A0B0D'], text: '#F4F5F0', muted: '#A3A8AF', emphasis: ['#D4FF3A'], accent: '#D4FF3A', extras: ['#9FCC12', '#FF5A1F', '#FF3DA0', '#3AE7FF'], chipBg: '#131519', chipText: '#F4F5F0', shadow: 'rgba(0,0,0,.75)', rule: 'rgba(244,245,240,.14)' }),
      s({ bg: ['#D4FF3A'], text: '#0A0B0D', muted: '#2B3110', emphasis: ['#0A0B0D'], accent: '#0A0B0D', extras: ['#9FCC12', '#FF5A1F', '#0A0B0D', '#0A0B0D'], chipBg: '#0A0B0D', chipText: '#D4FF3A', shadow: 'rgba(40,50,0,.45)', rule: 'rgba(10,11,13,.18)' }),
    ],
    rhythm: 'single',
    invert: 1,
    fonts: { headline: 'Anton', body: 'Barlow Condensed', label: 'Barlow Condensed' },
    type: { ...baseType, weight: 400, case: 'upper', size: 0.19, tracking: -0.005, leading: 0.9, align: 'start', maxLines: 3, skew: -9, labelCase: 'upper', labelTracking: 0.13, subWeight: 700 },
    emphasis: 'color',
    background: 'neon',
    density: 'editorial',
    device: { tilt: 8, finish: 'black', shadow: 'glow', rim: '#D4FF3A', rhythm: ['tilted', 'tilted', 'two-devices', 'tilted', 'offset'], bleed: 0.08 },
    badge: 'chip',
    grain: 0.08,
    tint: 'signal',
  },
  'paper-sticker-skeuomorphic': {
    id: 'paper-sticker-skeuomorphic',
    name: 'Paper Sticker Skeuomorphic',
    surfaces: [
      s({ bg: ['#F4C6BB'], text: '#1F4C8A', muted: '#1F2A44', emphasis: ['#1F4C8A'], accent: '#E45A4A', extras: ['#FCE36A', '#7AD66B', '#F25C8E', '#6CCDE6', '#B493DC'], chipBg: '#F8F0E2', chipText: '#1F2A44', shadow: 'rgba(80,40,30,.30)', rule: 'rgba(31,42,68,.15)' }),
      s({ bg: ['#C9E6C2'], text: '#1F4C8A', muted: '#1F2A44', emphasis: ['#1F4C8A'], accent: '#E45A4A', extras: ['#FCE36A', '#F25C8E', '#6CCDE6', '#B493DC', '#7AD66B'], chipBg: '#F8F0E2', chipText: '#1F2A44', shadow: 'rgba(40,70,40,.28)', rule: 'rgba(31,42,68,.15)' }),
      s({ bg: ['#C9C5BC'], text: '#1F3F78', muted: '#1F2A44', emphasis: ['#1F3F78'], accent: '#E45A4A', extras: ['#FCE36A', '#7AD66B', '#F25C8E', '#6CCDE6', '#B493DC'], chipBg: '#F8F0E2', chipText: '#1F2A44', shadow: 'rgba(50,45,35,.30)', rule: 'rgba(31,42,68,.15)' }),
      s({ bg: ['#EFB1A4'], text: '#1F3F78', muted: '#1F2A44', emphasis: ['#1F3F78'], accent: '#E45A4A', extras: ['#FCE36A', '#7AD66B', '#6CCDE6', '#B493DC', '#F25C8E'], chipBg: '#F8F0E2', chipText: '#1F2A44', shadow: 'rgba(90,40,30,.30)', rule: 'rgba(31,42,68,.15)' }),
    ],
    rhythm: 'cycle',
    invert: 2,
    fonts: { headline: 'Caveat', body: 'DM Sans', label: 'DM Sans' },
    type: { ...baseType, weight: 700, size: 0.168, tracking: -0.005, leading: 0.92, align: 'start', maxLines: 3, rotate: -2, subWeight: 600 },
    emphasis: 'underline',
    background: 'paper',
    density: 'maximal',
    device: { tilt: 3, finish: 'graphite', shadow: 'soft', rhythm: ['bleed-bottom', 'tilted', 'offset', 'two-devices', 'tilted'], bleed: 0.08 },
    badge: 'paper',
    grain: 0.08,
    tint: 'accent',
  },
  'hand-drawn-editorial': {
    id: 'hand-drawn-editorial',
    name: 'Hand-Drawn Editorial',
    surfaces: [
      s({ bg: ['#1B2336'], text: '#FFFFFF', muted: '#B8C0D3', emphasis: ['#F26A50'], accent: '#F26A50', extras: ['#8B7BFF', '#F5EFDF'], chipBg: '#F5EFDF', chipText: '#1B2336', shadow: 'rgba(8,12,30,.55)', rule: 'rgba(255,255,255,.12)' }),
      s({ bg: ['#5B4BD6'], text: '#FFFFFF', muted: '#E4E0FF', emphasis: ['#FFD9CF'], accent: '#FFD9CF', extras: ['#8B7BFF', '#F5EFDF'], chipBg: '#F5EFDF', chipText: '#1B2336', shadow: 'rgba(40,24,110,.40)', rule: 'rgba(255,255,255,.14)' }),
      s({ bg: ['#F5EFDF'], text: '#1B2336', muted: '#5A6275', emphasis: ['#C8432A'], accent: '#F26A50', extras: ['#8B7BFF', '#1B2336'], chipBg: '#1B2336', chipText: '#F5EFDF', shadow: 'rgba(40,35,25,.18)', rule: 'rgba(27,35,54,.12)' }),
      s({ bg: ['#C8432A'], text: '#FFFFFF', muted: '#FFE8DE', emphasis: ['#FFE8D6'], accent: '#F5EFDF', extras: ['#8B7BFF', '#1B2336'], chipBg: '#F5EFDF', chipText: '#1B2336', shadow: 'rgba(120,28,14,.35)', rule: 'rgba(255,255,255,.14)' }),
    ],
    rhythm: 'cycle',
    invert: 0,
    fonts: { headline: 'Inter', body: 'Inter', label: 'Inter', script: 'Caveat' },
    type: { ...baseType, weight: 600, size: 0.118, tracking: -0.02, leading: 1.04, emphasisScale: 1.5 },
    emphasis: 'script',
    background: 'doodle',
    density: 'editorial',
    device: { tilt: 12, finish: 'black', shadow: 'soft', rhythm: ['tilted', 'tilted', 'tilted', 'two-devices', 'tilted'], bleed: 0.14 },
    badge: 'paper',
    grain: 0.03,
    tint: 'accent',
  },
  'clean-studio-light': {
    id: 'clean-studio-light',
    name: 'Clean Studio Light',
    surfaces: [
      s({ bg: ['#F7F8FA', '#ECEEF3'], text: '#101218', muted: '#525868', emphasis: ['#2D5BFF'], plate: '#2D5BFF', plateText: '#FFFFFF', accent: '#2D5BFF', extras: ['#FFFFFF', '#DCE3FF', '#E6E9F0'], chipBg: '#101218', chipText: '#FFFFFF', shadow: 'rgba(16,18,24,.24)', rule: 'rgba(16,18,24,.10)' }),
      s({ bg: ['#2D5BFF', '#2148E0'], text: '#FFFFFF', muted: '#E1E7FF', emphasis: ['#FFFFFF'], plate: '#FFFFFF', plateText: '#1D3FC4', accent: '#FFFFFF', extras: ['#5C80FF', '#1D3FC4', '#FFFFFF'], chipBg: '#FFFFFF', chipText: '#1D3FC4', shadow: 'rgba(10,20,90,.42)', rule: 'rgba(255,255,255,.16)', emphasisKind: 'box' }),
    ],
    rhythm: 'single',
    invert: 1,
    fonts: { headline: 'Plus Jakarta Sans', body: 'Inter', label: 'Inter' },
    type: { ...baseType, weight: 800, size: 0.122, tracking: -0.035, leading: 1.0, align: 'start', subWeight: 500 },
    emphasis: 'color',
    kicker: 'tag',
    background: 'studio',
    density: 'minimal',
    // No bleed-top: on the light sweep the device's shadow would fall on a caption set under it.
    device: { tilt: 0, finish: 'black', shadow: 'soft', rhythm: ['bleed-bottom', 'offset', 'bleed-bottom', 'two-devices', 'offset'], bleed: 0.08 },
    badge: 'pill',
    grain: 0,
    tint: 'full',
  },
  'bold-poster-type': {
    id: 'bold-poster-type',
    name: 'Bold Poster Type',
    surfaces: [
      s({ bg: ['#121212'], text: '#F4EFE6', muted: '#BDB6AA', emphasis: ['#121212'], plate: '#C6F432', plateText: '#121212', accent: '#C6F432', extras: ['#F4EFE6', '#2A2A2A', '#C6F432'], chipBg: '#F4EFE6', chipText: '#121212', shadow: 'rgba(0,0,0,.6)', rule: 'rgba(244,239,230,.22)' }),
      s({ bg: ['#F4EFE6'], text: '#121212', muted: '#4B4741', emphasis: ['#F4EFE6'], plate: '#121212', plateText: '#F4EFE6', accent: '#121212', extras: ['#121212', '#E4DCCD', '#C6F432'], chipBg: '#121212', chipText: '#F4EFE6', shadow: 'rgba(18,18,18,.28)', rule: 'rgba(18,18,18,.22)' }),
      s({ bg: ['#C6F432'], text: '#121212', muted: '#2C360B', emphasis: ['#C6F432'], plate: '#121212', plateText: '#C6F432', accent: '#121212', extras: ['#121212', '#A9D41C', '#F4EFE6'], chipBg: '#121212', chipText: '#C6F432', shadow: 'rgba(40,52,0,.4)', rule: 'rgba(18,18,18,.22)' }),
    ],
    rhythm: 'cycle',
    invert: 2,
    fonts: { headline: 'Anton', body: 'Inter Tight', label: 'Barlow Condensed' },
    type: { ...baseType, weight: 400, case: 'upper', size: 0.168, tracking: 0.005, leading: 0.98, align: 'start', maxLines: 3, labelCase: 'upper', labelTracking: 0.12, subWeight: 600 },
    emphasis: 'box',
    background: 'poster',
    density: 'editorial',
    device: { tilt: 0, finish: 'black', shadow: 'crisp', rhythm: ['bleed-bottom', 'offset', 'bleed-top', 'bleed-bottom', 'two-devices'], bleed: 0.1 },
    badge: 'mono',
    grain: 0.04,
    tint: 'swap',
  },
  'color-block-sequence': {
    id: 'color-block-sequence',
    name: 'Color Block Sequence',
    surfaces: [
      s({ bg: ['#3D5AFE'], text: '#FFFFFF', muted: '#E3E8FF', emphasis: ['#2F47D9'], plate: '#FFFFFF', plateText: '#2F47D9', accent: '#FFFFFF', extras: ['#5B74FF', '#2F47D9', '#FFFFFF'], chipBg: '#FFFFFF', chipText: '#2F47D9', shadow: 'rgba(16,24,110,.38)', rule: 'rgba(255,255,255,.18)' }),
      s({ bg: ['#FF6A3D'], text: '#1A1410', muted: '#33200F', emphasis: ['#FF6A3D'], plate: '#1A1410', plateText: '#FF6A3D', accent: '#1A1410', extras: ['#FF8A66', '#E0522A', '#1A1410'], chipBg: '#1A1410', chipText: '#FFFFFF', shadow: 'rgba(120,40,10,.35)', rule: 'rgba(26,20,16,.16)' }),
      s({ bg: ['#0B7A5E'], text: '#FFFFFF', muted: '#D4F2E8', emphasis: ['#0B7A5E'], plate: '#FFFFFF', plateText: '#0B7A5E', accent: '#FFFFFF', extras: ['#1F9677', '#08624B', '#FFFFFF'], chipBg: '#FFFFFF', chipText: '#0B7A5E', shadow: 'rgba(0,50,36,.4)', rule: 'rgba(255,255,255,.18)' }),
      s({ bg: ['#FFC23D'], text: '#1A1410', muted: '#3D2E0A', emphasis: ['#FFC23D'], plate: '#1A1410', plateText: '#FFC23D', accent: '#1A1410', extras: ['#FFD36E', '#E6A817', '#1A1410'], chipBg: '#1A1410', chipText: '#FFC23D', shadow: 'rgba(120,80,0,.35)', rule: 'rgba(26,20,16,.16)' }),
      s({ bg: ['#7B3FE4'], text: '#FFFFFF', muted: '#EEE5FF', emphasis: ['#6A2FD3'], plate: '#FFFFFF', plateText: '#6A2FD3', accent: '#FFFFFF', extras: ['#9462F0', '#6A2FD3', '#FFFFFF'], chipBg: '#FFFFFF', chipText: '#6A2FD3', shadow: 'rgba(50,10,120,.4)', rule: 'rgba(255,255,255,.18)' }),
    ],
    rhythm: 'cycle',
    invert: 1,
    fonts: { headline: 'Rubik', body: 'DM Sans', label: 'DM Sans' },
    type: { ...baseType, weight: 800, size: 0.13, tracking: -0.025, leading: 1.02, subWeight: 500 },
    emphasis: 'box',
    background: 'block',
    density: 'editorial',
    device: { tilt: 0, finish: 'black', shadow: 'soft', rhythm: ['bleed-bottom', 'offset', 'bleed-bottom', 'two-devices', 'bleed-top'], bleed: 0.07 },
    badge: 'pill',
    grain: 0.02,
    tint: 'accent',
  },
  'noir-gold-luxe': {
    id: 'noir-gold-luxe',
    name: 'Noir Gold Luxe',
    surfaces: [
      s({ bg: ['#0E0B08', '#16110C', '#1F1811'], text: '#F6EEDD', muted: '#C8BBA2', emphasis: ['#F8E2A8', '#EAC77E', '#D9AE5E'], accent: '#D8AE5E', extras: ['#8C6A2E', '#3A2C1A', '#F6DC9A'], chipBg: 'rgba(20,16,11,.86)', chipText: '#F6EEDD', shadow: 'rgba(0,0,0,.8)', rule: 'rgba(216,174,94,.28)' }),
      s({ bg: ['#F4ECDD', '#EADFCB'], text: '#1A140D', muted: '#54493A', emphasis: ['#8A5F1C', '#7A5216'], accent: '#B8893A', extras: ['#D8AE5E', '#E3D3B4', '#1A140D'], chipBg: '#1A140D', chipText: '#F4ECDD', shadow: 'rgba(60,40,10,.30)', rule: 'rgba(26,20,13,.18)' }),
    ],
    rhythm: 'single',
    invert: 1,
    fonts: { headline: 'Playfair Display', body: 'Inter', label: 'Inter' },
    type: { ...baseType, weight: 600, size: 0.122, tracking: -0.015, leading: 1.04, labelCase: 'upper', labelTracking: 0.28, subWeight: 400 },
    emphasis: 'gradient',
    background: 'gilded',
    density: 'editorial',
    device: { tilt: 0, finish: 'titanium', shadow: 'glow', rim: '#E9C77B', rhythm: ['bleed-bottom', 'offset', 'bleed-bottom', 'two-devices', 'offset'], bleed: 0.05 },
    badge: 'darkglass',
    grain: 0.04,
    tint: 'fixed',
  },
};

/** Fully resolved direction: every legacy field present (video and older consumers read these) plus the tokens. */
export type ResolvedDirection = Omit<ArtDirectionOption, 'palette' | 'typography' | 'background' | 'device'> & {
  palette: Palette;
  typography: Typography;
  background: NonNullable<ArtDirectionOption['background']>;
  device: NonNullable<ArtDirectionOption['device']>;
  tokens: StyleTokens;
  /** An old art-direction.json without a preset: its background style is drawn with the original recipes. */
  legacy: boolean;
};

/** Brand input for tinting (art-direction `brand`, or the profile's brand colors). */
export interface BrandTint {
  primary: string;
  secondary?: string;
  strength?: number;
}

/**
 * Applies the brand to a preset: the emphasis and decorative accent take the brand hue (adjusted until text uses
 * clear WCAG AA on that surface), and chromatic background stops rotate toward the brand hue by `strength`.
 */
export function tintTokens(t: StyleTokens, brand: BrandTint): StyleTokens {
  if (t.tint === 'fixed') return t;
  if (t.tint === 'swap') {
    // The signal carries ink type and sits next to ink, so only an equally bright brand color may take its place.
    const signal = t.surfaces[0]!.plate ?? t.surfaces[0]!.accent;
    if (contrastRatio(t.surfaces[0]!.bg[0]!, brand.primary) < 7) return t;
    const sw = (c: string) => (c.toUpperCase() === signal.toUpperCase() ? brand.primary : c);
    return { ...t, surfaces: t.surfaces.map((sf) => ({ ...sf, bg: sf.bg.map(sw), plate: sf.plate && sw(sf.plate), plateText: sf.plateText && sw(sf.plateText), accent: sw(sf.accent), emphasis: sf.emphasis.map(sw), chipText: sw(sf.chipText), extras: sf.extras.map(sw) })) };
  }
  const hue = hueOf(brand.primary);
  const strength = t.tint === 'full' ? (brand.strength ?? 0.35) : 0;
  const second = brand.secondary ?? shiftHue(brand.primary, hue + 40, 1);
  if (t.tint === 'signal') {
    // One-accent presets: the brand replaces the signal only if it clears the same pairs (ink on it, it on ink).
    const sf0 = t.surfaces[0]!;
    const ink = sf0.dark ? sf0.bg[0]! : sf0.text;
    const ok = contrastRatio(ink, brand.primary) >= 4.5 && (t.id !== 'neon-athletic-night' || luminance(brand.primary) > 0.35);
    if (!ok) return t;
    return {
      ...t,
      surfaces: t.surfaces.map((sf) => ({ ...sf, plate: sf.plate ? brand.primary : sf.plate, accent: sf.accent === sf0.accent ? brand.primary : sf.accent, emphasis: (sf.emphasisKind ?? t.emphasis) === 'block' ? sf.emphasis : sf.dark ? [ensureContrast(brand.primary, sf.bg, 4.5)] : sf.emphasis })),
    };
  }
  const surfaces = t.surfaces.map((sf): Surface => {
    const bg = sf.bg.map((c) => shiftHue(c, hue, strength));
    // Light surfaces can put the caption over any stop (bottom captions); dark ones keep it on the deep stops.
    const under = sf.dark ? bg.slice(0, 2) : bg;
    // The brand color that reads best on this surface (primary unless it is weak and the secondary is stronger).
    const best = contrastRatio(brand.primary, under[0]!) >= 3.2 || contrastRatio(second, under[0]!) <= contrastRatio(brand.primary, under[0]!) ? brand.primary : second;
    const kind = sf.emphasisKind ?? t.emphasis;
    let emphasis = sf.emphasis;
    let plate = sf.plate;
    let plateText = sf.plateText;
    if (PLATED_EMPHASIS.has(kind)) {
      // Cycling palettes keep their plates (each slide pairs a plate with its background), and so do neutral
      // plates (a white box on a brand-colored slide).
      if (t.rhythm !== 'cycle' && !isNeutral(plate ?? sf.accent)) {
        const ink = plateText ?? inkOn(brand.primary);
        if (contrastRatio(ink, brand.primary) >= 4.5) plate = brand.primary;
        else if (contrastRatio(inkOn(brand.primary), brand.primary) >= 4.5) {
          plate = brand.primary;
          plateText = inkOn(brand.primary);
        }
      }
    } else if (kind === 'gradient') {
      emphasis = [brand.primary, mix(brand.primary, second, 0.5), second].map((c) => ensureContrast(c, under, sf.dark ? 5.5 : 4.6));
    } else if (kind === 'kenten') {
      emphasis = [ensureContrast(mix(sf.emphasis[0]!, brand.primary, 0.5), under, 4.5)];
    } else {
      emphasis = [ensureContrast(best, under, sf.dark ? 5.5 : 4.6)];
    }
    const accent = t.tint === 'full' ? brand.primary : t.tint === 'mono' ? emphasis[0]! : sf.accent;
    const extras = t.tint === 'full' ? sf.extras.map((c) => shiftHue(c, hue, Math.min(1, strength + 0.3))) : sf.extras;
    return { ...sf, bg, emphasis, plate, plateText, accent, extras, text: ensureContrast(sf.text, under, 4.5), muted: ensureContrast(sf.muted, under, 4.5) };
  });
  return { ...t, surfaces };
}

/** Contrast guard applied to every surface: text, muted and emphasis must clear AA against the background stops. */
export function sanitizeTokens(t: StyleTokens): StyleTokens {
  return {
    ...t,
    surfaces: t.surfaces.map((sf) => {
      const under = sf.dark ? sf.bg.slice(0, Math.min(2, sf.bg.length)) : sf.bg;
      const kind = sf.emphasisKind ?? t.emphasis;
      const emphasis = PLATED_EMPHASIS.has(kind) ? sf.emphasis : sf.emphasis.map((c) => ensureContrast(c, under, 4.5));
      // A plate must stand off its background, and its ink must read on it.
      let plate = sf.plate;
      let plateText = sf.plateText;
      if (PLATED_EMPHASIS.has(kind)) {
        if (!plate || contrastRatio(plate, sf.bg[0]!) < 1.6) plate = contrastRatio(sf.accent, sf.bg[0]!) >= 1.6 ? sf.accent : sf.text;
        if (!plateText || contrastRatio(plateText, plate) < 4.5) plateText = inkOn(plate);
      }
      return { ...sf, text: ensureContrast(sf.text, under, 4.5), muted: ensureContrast(sf.muted, under, 4.5), emphasis, plate, plateText };
    }),
  };
}

export function presetTokens(id: StylePreset): StyleTokens {
  const t = PRESETS[id];
  if (!t) throw new Error(`Unknown style preset “${id}”. Available: ${Object.keys(PRESETS).join(', ')}`);
  return t;
}

/**
 * Turns an art-direction option into a full direction. Explicit fields win over the preset; the brand tints
 * presets only (an explicit palette is taken as is). Old art-direction.json files (no preset) resolve onto
 * `vitrin-classic` with their own palette, typography, background and device.
 */
export function resolveDirection(opt: ArtDirectionOption, profileBrand?: BrandTint): ResolvedDirection {
  let tokens = presetTokens(opt.preset ?? 'vitrin-classic');
  const brand = opt.brand ?? (opt.preset ? profileBrand : undefined);
  if (brand && !opt.palette) tokens = tintTokens(tokens, brand);
  if (opt.palette) {
    const p = opt.palette;
    const [first, ...rest] = tokens.surfaces;
    const kind = opt.emphasis ?? first!.emphasisKind ?? tokens.emphasis;
    const plated = PLATED_EMPHASIS.has(kind);
    const own: Surface = {
      ...first!,
      bg: p.background,
      text: p.text,
      textGradient: undefined,
      muted: p.textMuted,
      emphasis: plated ? first!.emphasis : [p.accent],
      plate: plated ? p.accent : first!.plate,
      plateText: plated ? inkOn(p.accent) : first!.plateText,
      accent: p.accent,
      extras: [p.primary, p.background[1] ?? p.primary, p.background[2] ?? p.accent, ...first!.extras.slice(3)],
      chipBg: p.badgeBackground,
      chipText: p.badgeText,
      dark: luminance(p.background[0]!) < 0.2,
    };
    tokens = { ...tokens, surfaces: [own, ...rest] };
  }
  if (opt.typography) {
    tokens = { ...tokens, fonts: { ...tokens.fonts, headline: opt.typography.headline, body: opt.typography.body }, type: { ...tokens.type, weight: opt.typography.headlineWeight, case: opt.typography.headlineCase === 'upper' ? 'upper' : tokens.type.case, tracking: opt.typography.letterSpacing, variation: opt.typography.headline === tokens.fonts.headline ? tokens.type.variation : undefined } };
  }
  if (opt.device) {
    tokens = { ...tokens, device: { ...tokens.device, tilt: opt.device.tilt ? Math.abs(opt.device.tilt) : tokens.device.tilt } };
  }
  if (opt.cycle) tokens = { ...tokens, surfaces: opt.cycle.map((c, i) => blockSurface(c, tokens.surfaces[0]!, opt.cycle!, i)), rhythm: 'cycle', invert: 1 };
  if (opt.emphasis) {
    const kind = opt.emphasis;
    tokens = { ...tokens, emphasis: kind, surfaces: tokens.surfaces.map((sf) => ({ ...sf, emphasisKind: undefined, textGradient: kind === 'gradient' ? sf.textGradient : undefined })) };
  }
  if (opt.kicker) tokens = { ...tokens, kicker: opt.kicker };
  tokens = sanitizeTokens(tokens);
  const sf = tokens.surfaces[0]!;
  const palette: Palette = opt.palette ?? {
    background: sf.bg.slice(0, 4),
    surface: sf.chipBg.startsWith('#') ? sf.chipBg : mix(sf.bg[0]!, sf.text, 0.08),
    primary: sf.accent,
    accent: sf.emphasis[0]!,
    text: sf.text,
    textMuted: sf.muted,
    badgeBackground: sf.chipBg.startsWith('#') ? sf.chipBg : sf.dark ? '#FFFFFF' : '#16131F',
    badgeText: sf.chipBg.startsWith('#') ? sf.chipText : sf.dark ? '#16131F' : '#FFFFFF',
  };
  const typography: Typography = opt.typography ?? { headline: tokens.fonts.headline, body: tokens.fonts.body, headlineWeight: tokens.type.weight, headlineCase: tokens.type.case === 'upper' ? 'upper' : 'none', letterSpacing: tokens.type.tracking };
  return {
    ...opt,
    preset: tokens.id,
    palette,
    typography,
    background: opt.background ?? { style: 'mesh', angle: 160, intensity: 0.5 },
    device: opt.device ?? { frame: 'realistic', shadow: true, tilt: 0 },
    tokens,
    legacy: !opt.preset,
  };
}

/** True for greys, white and black (no hue worth tinting). */
function isNeutral(hex: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r!, g!, b!) - Math.min(r!, g!, b!) < 24;
}

/**
 * One slide of a color-blocked set: a solid background with black or white type, an inverse box for the
 * emphasis (type color plate, background color ink) and a highlight from the other colors for color emphasis.
 */
function blockSurface(c: string, base: Surface, all: string[], i: number): Surface {
  const ink = inkOn(c);
  const others = [...all.slice(i + 1), ...all.slice(0, i), '#FFE23D', '#FFFFFF', '#16121F'];
  const highlight = others.find((o) => contrastRatio(o, c) >= 4.5 && o.toUpperCase() !== ink.toUpperCase()) ?? ensureContrast(mix(c, ink, 0.6), [c], 4.5);
  const dark = luminance(c) < 0.2 || ink === '#FFFFFF';
  return {
    ...base,
    bg: [c],
    text: ink,
    textGradient: undefined,
    muted: ensureContrast(mix(ink, c, 0.18), [c], 4.5),
    emphasis: [highlight],
    plate: ink,
    plateText: contrastRatio(c, ink) >= 4.5 ? c : inkOn(ink),
    emphasisKind: undefined,
    accent: ink,
    extras: [mix(c, '#FFFFFF', 0.2), mix(c, '#000000', 0.18), ink],
    chipBg: ink,
    chipText: contrastRatio(c, ink) >= 4.5 ? c : inkOn(ink),
    shadow: withAlpha(mix(c, '#000000', 0.6), 0.4),
    rule: withAlpha(ink, 0.16),
    dark,
  };
}

/** Surface for a shot: explicit inversion, else the preset rhythm by position in the set. */
export function surfaceFor(t: StyleTokens, index: number, inverted?: boolean): { surface: Surface; index: number } {
  let i = 0;
  if (inverted === true) i = t.invert;
  else if (inverted === false) i = 0;
  else if (t.rhythm === 'alternate') i = index % 2 ? 1 : 0;
  else if (t.rhythm === 'cycle') i = index % t.surfaces.length;
  const surface = t.surfaces[i] ?? t.surfaces[0]!;
  return { surface, index: i };
}
