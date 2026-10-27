/**
 * Page composition. The rules come from the screenshot quality bar (ParthJadhav/app-store-screenshots, MIT):
 * designed backgrounds, a dominant headline with one emphasis, the device anchored to an edge (68–82 % of the
 * canvas height on phone and tablet slides), no empty band over 22 %, framing that varies across the set, proof
 * on the hero only, density inside the device and sparsity outside it.
 *
 * Geometry is computed here in TypeScript (pure, testable); the in-page script then fits the text and scales the
 * device stage into the space the fitted caption leaves, and measures the result.
 */
import type { ArtDirectionOption, Badge, Callout, Framing, Quote, RenderTarget, Shot } from '@vitrin/schemas';
import { fontSetup, lucideIcon } from './assets.js';
import { CaptionBlock, plainWords } from './caption.js';
import { contrastRatio, ensureContrast, inkOn, mix, withAlpha } from './color.js';
import { Background, BadgeView, CalloutCard, esc, QuoteCard, type PaletteDirection } from './components.js';
import { backgroundLayer, canvasDecor, ChipView, grainLayer, stageBack, stageFront, topStructure, type Box, type DecorContext } from './decor.js';
import { CONTAINED_FAMILIES, DeviceFrame, deviceGeometry, widthForHeight, type DeviceFamily, type DeviceFinish, type FrameVariant } from './frames.js';
import { PLATED_EMPHASIS, resolveDirection, surfaceFor, type BrandTint, type ResolvedDirection, type StyleTokens, type Surface } from './styles.js';

export interface ScreenImage {
  /** file:// URL */
  src: string;
  /** height / width of the raw capture */
  aspect: number;
  /** Device family the capture came from. */
  family: DeviceFamily;
  /** Locale of the capture (another one when the raw library fell back to the primary locale). */
  locale?: string;
}

export interface PageInput {
  target: RenderTarget;
  locale: string;
  /** A raw art-direction option (resolved here) or an already resolved direction. */
  ad: ArtDirectionOption | ResolvedDirection;
  archetype: Shot['archetype'];
  headline: string;
  subheadline: string;
  badges: Badge[];
  stat?: string;
  screens: ScreenImage[];
  panorama?: { index: number; total: number };
  kicker?: string;
  captionPosition?: 'top' | 'bottom';
  callouts?: Callout[];
  quotes?: Quote[];
  /** file:// URL of the app icon (statement slides, tags, feature graphic). */
  icon?: string;
  /** Position in the set (rhythm, alternation, index labels). */
  index?: number;
  total?: number;
  /** Resolved framing for this shot (see planFramings); `auto` resolves per archetype. */
  framing?: Framing;
  inverted?: boolean;
  /** Cross-canvas moment with the next / previous shot. */
  bridgeOut?: boolean;
  bridgeIn?: boolean;
  /**
   * The previous shot is a bridged `panoramic` one: its device continues into this canvas. The screen it shows;
   * this page draws the part of that device that crossed the edge (same geometry, shifted by one canvas width).
   */
  spanIn?: ScreenImage;
  appName?: string;
  /** feature-wall lines. */
  wall?: string[];
  /** Short benefit lines under the caption, and how they are drawn. */
  bullets?: string[];
  bulletStyle?: 'check' | 'chips';
  /** App icon and name above the headline. */
  brandMark?: boolean;
  /** file:// URL of a developer photo drawn full-bleed behind everything (with a scrim under the caption). */
  photo?: string;
  /** Profile brand, used to tint presets when the direction has no `brand`. */
  brand?: BrandTint;
}

/** Device family a target is drawn with; a capture from another family keeps its own frame when it would not fit. */
export function frameFamily(target: RenderTarget, screen?: ScreenImage): DeviceFamily {
  const f = target.family;
  const fromTarget: DeviceFamily | undefined = f === 'any' ? undefined : (f as DeviceFamily);
  if (!fromTarget) return screen?.family ?? 'iphone';
  if (!screen) return fromTarget;
  // Mac/TV/Vision/Watch screens have fixed shapes; a phone capture there keeps its phone frame.
  if ((CONTAINED_FAMILIES.has(fromTarget) || fromTarget === 'ipad' || fromTarget === 'android-tablet') && screen.family !== fromTarget && Math.abs(screen.aspect - 1.5) > 0.4 && screen.aspect > 1.6) return screen.family;
  return fromTarget;
}

export function frameVariant(target: RenderTarget, index = 0): FrameVariant {
  return { duo: /inner/.test(target.id) ? 'inner' : 'outer', mac: index % 2 === 1 ? 'window' : 'laptop', tv: 'bezel' };
}

const isTabletFamily = (f: DeviceFamily) => f === 'ipad' || f === 'android-tablet' || f === 'duo';

/**
 * Framing for every shot of a set. Explicit framings are kept; `auto` follows the archetype, then the preset's
 * rhythm, and never repeats the previous shot's framing (adjacent layouts must differ).
 */
export function planFramings(shots: Array<Pick<Shot, 'archetype' | 'framing'>>, tokens: StyleTokens, family: DeviceFamily = 'iphone'): Framing[] {
  const out: Framing[] = [];
  const upright = tokens.device.tilt === 0 || family === 'duo';
  shots.forEach((s, i) => {
    let f: Framing = s.framing ?? 'auto';
    if (CONTAINED_FAMILIES.has(family)) f = s.archetype === 'statement' || s.archetype === 'testimonial' || s.archetype === 'feature-wall' ? 'no-device' : 'contained';
    else if (f === 'auto') {
      const a = s.archetype;
      if (a === 'statement' || a === 'testimonial' || a === 'feature-wall' || a === 'mosaic') f = 'no-device';
      else if (a === 'split' || a === 'before-after' || a === 'collage') f = 'two-devices';
      else if (a === 'tilted') f = 'tilted';
      else if (a === 'panoramic' || a === 'stat') f = 'offset';
      else if (a === 'hero' || a === 'callout' || a === 'fullbleed' || a === 'social-proof') f = i === 0 ? 'bleed-bottom' : (tokens.device.rhythm[i % tokens.device.rhythm.length] ?? 'bleed-bottom');
      else f = tokens.device.rhythm[i % tokens.device.rhythm.length] ?? 'bleed-bottom';
      if (a === 'callout' || a === 'fullbleed') f = f === 'bleed-top' ? 'bleed-top' : 'bleed-bottom';
      if (f === 'two-devices' && a !== 'split' && a !== 'before-after' && a !== 'collage') f = 'offset';
      const prev = out[i - 1];
      if (prev && prev === f && f !== 'no-device') {
        const alts: Framing[] = ['offset', 'bleed-top', 'tilted', 'bleed-bottom'];
        f = alts.find((x) => x !== prev && !(upright && x === 'tilted') && !(a === 'callout' && x === 'tilted')) ?? f;
      }
    }
    if (upright && f === 'tilted') f = out[i - 1] === 'offset' ? 'bleed-bottom' : 'offset';
    out.push(f);
  });
  return out;
}

/** Headline size (CSS px) for a canvas: the preset's width fraction, capped by height on squat canvases. */
export function headlineSizeFor(t: StyleTokens, W: number, H: number, landscape: boolean): number {
  const basis = landscape ? Math.min(W * 0.5, H * 1.05) : Math.min(W, H / 1.9);
  return Math.round(t.type.size * basis);
}

export interface DevicePlacement {
  screen: number;
  family: DeviceFamily;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  dim?: boolean;
  frameless?: boolean;
  z: number;
}

export interface PortraitPlan {
  W: number;
  H: number;
  framing: Framing;
  captionSide: 'top' | 'bottom';
  caption: Box;
  align: 'center' | 'start';
  devices: DevicePlacement[];
  /** Nominal visible device height; the page scales the stage so the real one lands in 68–82 %. */
  visible: number;
  /** Gap between the device's anchored edge and the canvas edge (Japandi's shelf), 0 when it bleeds. */
  edgeGap?: number;
  rule: 'phone' | 'contained' | 'span' | 'none';
  gap: number;
}

/** Visible vertical extent of a (possibly rotated) device box inside the canvas. */
export function visibleSpan(d: Pick<DevicePlacement, 'x' | 'y' | 'w' | 'h' | 'rot'>, H: number): [number, number] {
  const a = (Math.abs(d.rot) * Math.PI) / 180;
  const bh = d.h * Math.cos(a) + d.w * Math.sin(a);
  const cy = d.y + d.h / 2;
  return [Math.max(0, cy - bh / 2), Math.min(H, cy + bh / 2)];
}

/** Share of canvas height covered by the union of the devices. */
export function deviceHeightRatio(devices: DevicePlacement[], H: number): number {
  if (!devices.length) return 0;
  const spans = devices.map((d) => visibleSpan(d, H));
  return (Math.max(...spans.map((s) => s[1])) - Math.min(...spans.map((s) => s[0]))) / H;
}

/** Largest gap between content intervals (fraction of H), including the canvas edges. */
export function largestEmptyBand(intervals: Array<[number, number]>, H: number): number {
  const sorted = intervals.map(([a, b]) => [Math.max(0, a), Math.min(H, b)] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let cursor = 0;
  let worst = 0;
  for (const [a, b] of sorted) {
    if (a > cursor) worst = Math.max(worst, a - cursor);
    cursor = Math.max(cursor, b);
  }
  worst = Math.max(worst, H - cursor);
  return worst / H;
}

const DEVICE_MIN = 0.68;
/** Presets whose offset framing crops the device at the side edge. */
const HARD_CROP = new Set(['swiss', 'neon', 'candy', 'paper', 'poster']);
const DEVICE_TARGET = 0.73;

/** Top margin per preset (index rows, mastheads and tags sit above the caption). */
function topMargin(t: StyleTokens, H: number): number {
  switch (t.background) {
    case 'swiss':
      return H * 0.075;
    case 'magazine':
      return H * 0.095;
    case 'candy':
      return H * 0.088;
    case 'doodle':
    case 'poster':
    case 'gilded':
      return H * 0.075;
    default:
      return H * 0.055;
  }
}

/**
 * The scale the page applies to the device stage (same rule as the in-page script): fill the room the caption
 * leaves (`avail`, default the nominal visible height), but keep the visible device at 68–80 % of the canvas and
 * the widest device under 95 % of the width.
 */
export function stageScale(plan: Pick<PortraitPlan, 'visible' | 'devices' | 'W' | 'H' | 'edgeGap'>, avail?: number): number {
  const e = plan.edgeGap ?? 0;
  // The stage scales around the canvas edge, so the extent it scales includes the gap to that edge.
  const vis = Math.max(1, plan.visible + e);
  const widest = Math.max(1, ...plan.devices.map((d) => d.w));
  const maxK = Math.min((plan.H * 0.8 + e) / vis, (plan.W * 0.95) / widest);
  const minK = (plan.H * DEVICE_MIN + e) / vis;
  avail ??= vis;
  return Math.max(minK, Math.min(maxK, avail / vis));
}

/** Device placements after the stage scale, anchored at the stage origin (bottom centre, or top centre). */
export function scaledDevices(plan: PortraitPlan, k = stageScale(plan)): DevicePlacement[] {
  const oy = plan.captionSide === 'top' ? plan.H : 0;
  const ox = plan.W / 2;
  return plan.devices.map((d) => {
    const cx = ox + (d.x + d.w / 2 - ox) * k;
    const cy = oy + (d.y + d.h / 2 - oy) * k;
    return { ...d, w: d.w * k, h: d.h * k, x: cx - (d.w * k) / 2, y: cy - (d.h * k) / 2 };
  });
}

/** Pure geometry for portrait canvases. */
/**
 * The device of a bridged `panoramic` shot: large and tilted, its centre near the right edge, so its right part
 * continues in the next screenshot. Both pages call this with the same canvas, so the halves meet exactly.
 */
export function spanDevice(W: number, H: number, family: DeviceFamily, aspect: number, variant?: FrameVariant): DevicePlacement {
  let h = H * 0.86;
  let w = widthForHeight(family, h, aspect, variant);
  if (w > W * 0.8) {
    w = W * 0.8;
    h = deviceGeometry(family, w, aspect, variant).height;
  }
  return { screen: 0, family, x: W * 0.9 - w / 2, y: H - h * 0.9, w, h, rot: 9, z: 2 };
}

export function planPortrait(o: { W: number; H: number; t: StyleTokens; family: DeviceFamily; framing: Framing; archetype: Shot['archetype']; screens: Array<Pick<ScreenImage, 'aspect'>>; index: number; variant?: FrameVariant; span?: { out?: boolean; inAspect?: number } }): PortraitPlan {
  const { W, H, t, family, framing } = o;
  const gap = H * 0.022;
  const mT = topMargin(t, H);
  const mB = H * 0.05;
  const captionSide: 'top' | 'bottom' = framing === 'bleed-top' ? 'bottom' : 'top';
  const tablet = isTabletFamily(family);
  const pad = W * (t.type.align === 'start' ? 0.075 : 0.07);
  // A device cut by the side edge leaves room for a start-aligned caption; a centred one keeps the preset's.
  const alignStart = t.type.align === 'start' || (framing === 'offset' && (o.archetype === 'panoramic' || HARD_CROP.has(t.background)));
  const capW = t.background === 'washi' ? W * 0.68 : W - pad * 2;
  const devices: DevicePlacement[] = [];
  const aspect = o.screens[0]?.aspect ?? 2.17;
  const bleed = Math.max(0.03, t.device.bleed);
  const maxW = W * (tablet ? 0.84 : 0.86);

  if (framing === 'no-device' || !o.screens.length) {
    const capH = H - mT - mB;
    return { W, H, framing: 'no-device', captionSide: 'top', caption: { x: pad, y: mT, w: capW, h: capH }, align: t.type.align === 'start' ? 'start' : 'center', devices, visible: 0, rule: 'none', gap };
  }
  // Japandi stands the device on an oak shelf instead of bleeding it off the edge.
  const standing = t.background === 'washi' && captionSide === 'top';
  const shelf = H * 0.95;
  const capMax = H * (1 - DEVICE_MIN) - mT - gap - (standing ? H - shelf : 0);
  const caption: Box = captionSide === 'top' ? { x: pad, y: mT, w: capW, h: capMax } : { x: pad, y: H - mB - capMax, w: capW, h: capMax };

  if (framing === 'contained' || CONTAINED_FAMILIES.has(family)) {
    const avail = H - mT - H * 0.2 - gap - mB;
    const g0 = deviceGeometry(family, 1000, aspect, o.variant);
    let w = (avail / g0.height) * 1000;
    w = Math.min(w, W * 0.74);
    const h = (g0.height / 1000) * w;
    const y = H - mB - h;
    devices.push({ screen: 0, family, x: (W - w) / 2, y, w, h, rot: 0, z: 2 });
    return { W, H, framing: 'contained', captionSide: 'top', caption: { x: pad, y: mT, w: capW, h: Math.max(H * 0.14, y - gap - mT) }, align: 'center', devices, visible: h, rule: 'contained', gap };
  }

  // Panoramic pair: the device crosses into the next screenshot (out), or this page shows its other half (in).
  if (o.span?.out && !tablet) {
    const d = spanDevice(W, H, family, aspect, o.variant);
    devices.push(d);
    const cap: Box = { x: pad, y: mT, w: capW, h: Math.max(H * 0.14, d.y - gap - mT - H * 0.02) };
    return { W, H, framing: 'offset', captionSide: 'top', caption: cap, align: 'start', devices, visible: H - d.y, rule: 'span', gap };
  }
  if (o.span?.inAspect && !tablet) {
    const other = spanDevice(W, H, family, o.span.inAspect, o.variant);
    devices.push({ ...other, x: other.x - W, screen: o.screens.length, z: 1 });
  }

  const vis = standing ? H * DEVICE_TARGET - (H - shelf) : H * DEVICE_TARGET;
  const sized = (visH: number, maxWidth: number, a = aspect) => {
    let h = standing ? visH : visH / (1 - bleed);
    let w = widthForHeight(family, h, a, o.variant);
    if (w > maxWidth) {
      w = maxWidth;
      h = deviceGeometry(family, w, a, o.variant).height;
    }
    return { w, h };
  };
  // A width-capped device is shorter than the target: it keeps its bleed so it stays anchored to the edge.
  const place = (w: number, h: number, visible: number) => {
    if (standing) return shelf - h;
    const v = Math.min(visible, h * (1 - bleed));
    return captionSide === 'top' ? H - v : v - h;
  };
  const shown = (h: number, visible: number) => (standing ? h : Math.min(visible, h * (1 - bleed)));
  const flip = o.index % 2 === 1;
  const sign = flip ? 1 : -1;
  let visible = vis;

  switch (framing) {
    case 'tilted': {
      const rot = sign * t.device.tilt;
      const a = (Math.abs(rot) * Math.PI) / 180;
      // Solve the rotated bounding box height for the visible target.
      const probe = deviceGeometry(family, 1000, aspect, o.variant);
      const k = probe.height / 1000;
      const bboxPerW = k * Math.cos(a) + Math.sin(a);
      let w = vis / (1 - bleed) / bboxPerW;
      w = Math.min(w, maxW * 0.98);
      const h = k * w;
      const bh = h * Math.cos(a) + w * Math.sin(a);
      visible = Math.min(vis, bh * (1 - bleed));
      const cy = captionSide === 'top' ? H - visible + bh / 2 : visible - bh / 2;
      const cx = W / 2 + (flip ? -1 : 1) * W * 0.05;
      devices.push({ screen: 0, family, x: cx - w / 2, y: cy - h / 2, w, h, rot, z: 2 });
      break;
    }
    case 'two-devices': {
      const three = o.screens.length >= 3 && o.archetype === 'collage';
      const tilt = t.device.tilt && family !== 'duo' ? Math.min(6, t.device.tilt) : 0;
      if (three) {
        const front = sized(vis * 0.96, W * 0.56);
        const side = { w: front.w * 0.78, h: front.h * 0.78 };
        const yF = place(front.w, front.h, vis * 0.96);
        const yS = captionSide === 'top' ? yF + H * 0.05 : yF - H * 0.05 + front.h - side.h;
        devices.push({ screen: 1, family, x: W * 0.5 - front.w * 0.5 - side.w * 0.72, y: yS, w: side.w, h: side.h, rot: -tilt, z: 1 });
        devices.push({ screen: 2, family, x: W * 0.5 + front.w * 0.5 - side.w * 0.28, y: yS, w: side.w, h: side.h, rot: tilt, z: 1 });
        devices.push({ screen: 0, family, x: (W - front.w) / 2, y: yF, w: front.w, h: front.h, rot: 0, z: 3 });
        visible = vis * 0.96;
      } else {
        // Back phone up-left, front phone down-right, overlapping by about a fifth; neither cut by the side edges.
        const back = sized(vis, W * (tablet ? 0.5 : t.background === 'bento' ? 0.62 : 0.55));
        const front = { w: back.w, h: back.h };
        const yB = place(back.w, back.h, vis);
        const yF = captionSide === 'top' ? yB + H * 0.06 : yB - H * 0.06;
        const leftX = W * 0.03;
        const rightX = W * 0.97 - front.w;
        devices.push({ screen: 0, family, x: leftX, y: yB, w: back.w, h: back.h, rot: -tilt * 0.7, z: 1, dim: o.archetype === 'before-after' });
        devices.push({ screen: 1, family, x: rightX, y: yF, w: front.w, h: front.h, rot: tilt * 0.5, z: 2 });
        visible = shown(back.h, vis);
      }
      break;
    }
    case 'offset': {
      const big = o.archetype === 'panoramic';
      // Next to the other half of a panoramic device, this page's own device stands on the right.
      const beside = devices.length > 0;
      const { w, h } = sized(beside ? vis * 0.92 : vis, beside ? W * 0.6 : big ? W * 0.98 : maxW * 0.96);
      // Bold presets hard-crop the device at the side edge. Calm presets keep it centred: a device merely
      // pushed towards one edge reads as a layout mistake, not as a choice.
      const side = big ? 0.3 : HARD_CROP.has(t.background) ? 0.08 : 0;
      const x = beside ? W * 0.97 - w : side ? (flip ? -w * side : W - w * (1 - side)) : (W - w) / 2;
      devices.push({ screen: 0, family, x, y: place(w, h, beside ? vis * 0.92 : vis), w, h, rot: 0, z: 2 });
      visible = shown(h, vis);
      break;
    }
    default: {
      // bleed-bottom / bleed-top: centred, anchored to the edge.
      const { w, h } = sized(vis, maxW);
      devices.push({ screen: 0, family, x: (W - w) / 2, y: place(w, h, vis), w, h, rot: 0, z: 2, frameless: o.archetype === 'fullbleed' });
      visible = shown(h, vis);
    }
  }
  return { W, H, framing, captionSide, caption, align: alignStart ? 'start' : 'center', devices, visible, edgeGap: standing ? H - shelf : 0, rule: 'phone', gap };
}

/** Resolves a direction once; accepts raw options for backwards compatibility. */
function resolved(ad: PageInput['ad'], brand?: BrandTint): ResolvedDirection {
  return 'tokens' in ad && (ad as ResolvedDirection).tokens ? (ad as ResolvedDirection) : resolveDirection(ad as ArtDirectionOption, brand);
}

function deviceShadow(t: StyleTokens, sf: Surface, w: number, enabled: boolean): string {
  if (!enabled) return '';
  const p = (n: number) => `${(w * n).toFixed(1)}px`;
  switch (t.device.shadow) {
    case 'hard':
      return `drop-shadow(${p(0.07)} ${p(0.08)} 0 ${sf.shadow}) drop-shadow(0 ${p(0.08)} ${p(0.12)} rgba(20,10,40,.25))`;
    case 'crisp':
      return `drop-shadow(0 ${p(0.007)} ${p(0.005)} ${sf.dark ? 'rgba(0,0,0,.6)' : 'rgba(14,14,12,.28)'}) drop-shadow(0 ${p(0.05)} ${p(0.08)} ${sf.dark ? 'rgba(0,0,0,.4)' : 'rgba(14,14,12,.14)'})`;
    case 'glow':
      return `drop-shadow(0 ${p(0.16)} ${p(0.2)} rgba(0,0,0,.75)) drop-shadow(0 ${p(0.025)} ${p(0.05)} rgba(0,0,0,.6))`;
    default:
      return `drop-shadow(0 ${p(0.11)} ${p(0.15)} ${sf.shadow}) drop-shadow(0 ${p(0.018)} ${p(0.035)} rgba(0,0,0,.16))`;
  }
}

function finishFor(t: StyleTokens, sf: Surface): DeviceFinish {
  if (t.device.finish === 'black' && sf.dark && t.background !== 'neon') return 'graphite';
  return t.device.finish;
}

/** A direction-like palette for the legacy components (laurels, quotes) on a given surface. */
function paletteFor(sf: Surface, ad: ResolvedDirection): PaletteDirection {
  return { palette: { ...ad.palette, background: sf.bg, text: sf.text, textMuted: sf.muted, accent: sf.emphasis[0] ?? sf.accent, badgeBackground: sf.chipBg.startsWith('#') ? sf.chipBg : ad.palette.badgeBackground, badgeText: sf.chipBg.startsWith('#') ? sf.chipText : ad.palette.badgeText } };
}

/** Builds the full HTML document for one image. All sizes are logical CSS px. */
export function buildPage(input: PageInput): string {
  const p = { callouts: [] as Callout[], quotes: [] as Quote[], index: 0, total: 1, ...input };
  const ad = resolved(p.ad, p.brand);
  const t = ad.tokens;
  const { width: W, height: H } = p.target.logical;
  const { surface: sf, index: surfaceIndex } = surfaceFor(t, p.index, p.inverted);
  const fonts = fontSetup(t.fonts.headline, t.fonts.body, p.locale, [t.fonts.label, ...(t.fonts.script ? [t.fonts.script] : [])]);
  const landscape = W > H * 1.05;
  const special = p.target.id === 'play-feature-graphic' ? 'feature-graphic' : p.target.id === 'play-icon' ? 'icon' : '';
  let body: string;
  let layout: string;
  if (special === 'feature-graphic') {
    body = featureGraphic(p, ad, sf, surfaceIndex, W, H);
    layout = 'feature-graphic';
  } else if (special === 'icon') {
    body = iconPage(p, sf, W, H);
    layout = 'icon';
  } else if (landscape) {
    body = landscapeLayout(p, ad, sf, surfaceIndex, W, H);
    layout = 'landscape';
  } else {
    body = portraitLayout(p, ad, sf, surfaceIndex, W, H);
    layout = 'portrait';
  }
  const safe = Math.round(Math.min(W, H) * 0.035);
  return `<!doctype html>
<html lang="${esc(p.locale)}" dir="${fonts.dir}">
<head>
<meta charset="utf-8">
${fonts.links}
<style>
  :root { --headline: ${fonts.headlineStack}; --body: ${fonts.bodyStack}; --label: ${fonts.stacks[t.fonts.label] ?? fonts.bodyStack}; --script: ${t.fonts.script ? fonts.stacks[t.fonts.script] : fonts.headlineStack}; }
  html, body { margin:0; padding:0; width:${W}px; height:${H}px; overflow:hidden; -webkit-font-smoothing:antialiased; background:${sf.bg[0]}; }
  body { position:relative; font-family:var(--body); }
  .icon { flex:none; }
  .safe-guide { position:absolute; inset:${safe}px; pointer-events:none; }
  .vq-hide .w { -webkit-text-fill-color:transparent !important; color:transparent !important; background-image:none !important; -webkit-text-stroke-color:transparent !important; }
  .vq-mask .w { -webkit-text-fill-color:#FF00FF !important; color:#FF00FF !important; background-image:none !important; -webkit-text-stroke-color:#FF00FF !important; }
</style>
</head>
<body data-layout="${layout}" data-preset="${t.id}" data-gap="${Math.round(H * 0.022)}">
${body}
<div class="safe-guide" data-inset="${safe}"></div>
</body>
</html>`;
}

function decorContext(p: PageInput & { index: number; total: number }, t: StyleTokens, sf: Surface, surfaceIndex: number, W: number, H: number, extra: Pick<DecorContext, 'caption' | 'captionSide' | 'device' | 'framing' | 'landscape'>): DecorContext {
  return {
    W,
    H,
    t,
    sf,
    surfaceIndex,
    index: p.index,
    total: p.total,
    appName: p.appName ?? '',
    icon: p.icon,
    // A tag kicker sits in the caption; index rows and mastheads leave it out.
    kicker: t.kicker === 'tag' ? '' : (p.kicker ?? ''),
    locale: p.locale,
    archetype: p.archetype,
    bridgeOut: Boolean(p.bridgeOut),
    bridgeIn: Boolean(p.bridgeIn),
    badges: p.badges,
    stat: p.stat,
    ...extra,
  };
}

function background(ad: ResolvedDirection, ctx: DecorContext, p: PageInput): string {
  if (p.photo) return photoLayer(p.photo, ctx);
  // Old art directions keep their own background recipes (solid, linear, mesh, grid, dots, panoramic).
  if (ad.legacy && ctx.surfaceIndex === 0) return Background({ palette: { ...ad.palette }, background: ad.background }, ctx.W, ctx.H, ad.background.style === 'panoramic' ? p.panorama : undefined);
  return backgroundLayer(ctx);
}

/**
 * A developer photo, cover-fitted, under a scrim in the surface's own tone: strong where the caption sits and
 * fading out towards the device, plus a light overall veil so the type never meets a busy highlight.
 */
function photoLayer(src: string, ctx: DecorContext): string {
  const { sf, W, H } = ctx;
  const tone = sf.dark ? '0,0,0' : '255,255,255';
  const cap = ctx.caption;
  // Landscape canvases keep the caption in a left column; portrait ones above or below the device.
  const span = ctx.landscape ? W : H;
  const near = ctx.landscape ? cap.x + cap.w : ctx.captionSide === 'top' ? cap.y + cap.h : H - cap.y;
  const reach = Math.min(1, (near + span * 0.12) / span);
  const dir = ctx.landscape ? '90deg' : ctx.captionSide === 'top' ? '180deg' : '0deg';
  const scrim = `linear-gradient(${dir},rgba(${tone},.84) 0%,rgba(${tone},.7) ${((near / span) * 75).toFixed(1)}%,rgba(${tone},0) ${(reach * 100).toFixed(1)}%)`;
  return `<div class="bg" data-content style="position:absolute;inset:0;overflow:hidden;background:${sf.bg[0]}"><img src="${src}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;background:rgba(${tone},.14)"></div><div style="position:absolute;inset:0;background:${scrim}"></div></div>`;
}

/** App icon and name side by side (or stacked), the lockup a hero or closer opens with. */
function brandLockup(p: PageInput, t: StyleTokens, sf: Surface, W: number, H: number, align: 'center' | 'start'): string {
  const name = p.appName ?? '';
  if (!name && !p.icon) return '';
  const size = Math.round(Math.min(W, H / 1.9) * 0.12);
  const icon = p.icon ? `<img src="${p.icon}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.225)}px;box-shadow:0 ${(size * 0.08).toFixed(1)}px ${(size * 0.22).toFixed(1)}px ${sf.shadow}">` : '';
  const label = name ? `<span style="font-family:var(--headline);font-weight:${Math.min(800, t.type.weight)};font-size:${Math.round(size * 0.44)}px;letter-spacing:-0.02em;line-height:1;color:${sf.text}">${plainWords(name, sf.text)}</span>` : '';
  return `<div class="brand-mark" data-content style="display:flex;align-items:center;justify-content:${align === 'center' ? 'center' : 'flex-start'};gap:${Math.round(size * 0.3)}px">${icon}${label}</div>`;
}

/** Benefit lines: a ticked list (one per line) or a wrapped row of chips. */
function bulletList(lines: string[], style: 'check' | 'chips', sf: Surface, size: number, align: 'center' | 'start'): string {
  if (!lines.length) return '';
  if (style === 'chips') {
    const fill = sf.dark ? withAlpha('#FFFFFF', 0.14) : withAlpha(sf.text, 0.07);
    // inline-block, not inline-flex: a flex container drops the spaces between the measured word spans.
    const items = lines.map((l) => `<span style="display:inline-block;padding:.5em .95em;border-radius:999px;background:${fill};box-shadow:inset 0 0 0 ${Math.max(1, size * 0.06).toFixed(1)}px ${withAlpha(sf.text, 0.16)};font-family:var(--body);font-weight:600;font-size:${size}px;line-height:1.1;color:${sf.text};white-space:nowrap">${plainWords(l, sf.text)}</span>`);
    return `<div class="bullets" data-content style="display:flex;flex-wrap:wrap;gap:${(size * 0.5).toFixed(1)}px;justify-content:${align === 'center' ? 'center' : 'flex-start'};margin-top:${(size * 0.25).toFixed(1)}px">${items.join('')}</div>`;
  }
  const tick = sf.accent;
  const tickInk = inkOn(tick);
  const rows = lines.map((l) => `<div style="display:flex;align-items:center;gap:${(size * 0.55).toFixed(1)}px"><span style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:${(size * 1.3).toFixed(1)}px;height:${(size * 1.3).toFixed(1)}px;border-radius:50%;background:${tick}">${lucideIcon('check', Math.round(size * 0.85), tickInk)}</span><span style="font-family:var(--body);font-weight:600;font-size:${size}px;line-height:1.2;color:${sf.text};text-align:start">${plainWords(l, sf.text)}</span></div>`);
  return `<div class="bullets" data-content style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:${(size * 0.5).toFixed(1)}px;margin-top:${(size * 0.25).toFixed(1)}px">${rows.join('')}</div>`;
}

/** The ticked list as one card overlapping the device's side edge, low on the visible part of the device. */
function bulletCard(lines: string[], sf: Surface, d: DevicePlacement, W: number, H: number, size: number, side: 'top' | 'bottom'): string {
  const own = sf.chipBg.startsWith('#');
  const card = own ? sf.chipBg : sf.dark ? '#16131F' : '#FFFFFF';
  const ink = own ? sf.chipText : inkOn(card);
  const tick = contrastRatio(sf.accent, card) >= 3 ? sf.accent : ink;
  const tickInk = inkOn(tick);
  const top = Math.max(d.y, 0);
  const bottom = Math.min(d.y + d.h, H);
  const y = top + (bottom - top) * (side === 'top' ? 0.56 : 0.14);
  // A device left of centre gets the card on its right, and the other way round.
  const onRight = d.x + d.w / 2 <= W / 2;
  const x = onRight ? `right:${Math.max(W * 0.04, W - d.x - d.w - d.w * 0.1).toFixed(1)}px;` : `left:${Math.max(W * 0.04, d.x - d.w * 0.1).toFixed(1)}px;`;
  const rows = lines.map((l) => `<div style="display:flex;align-items:center;gap:${(size * 0.55).toFixed(1)}px"><span style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:${(size * 1.3).toFixed(1)}px;height:${(size * 1.3).toFixed(1)}px;border-radius:50%;background:${tick}">${lucideIcon('check', Math.round(size * 0.85), tickInk)}</span><span style="font-family:var(--body);font-weight:600;font-size:${size}px;line-height:1.2;color:${ink};white-space:nowrap">${plainWords(l, ink)}</span></div>`);
  return `<div class="bullets bullet-card" data-layer="accent" data-content style="position:absolute;${x}top:${y.toFixed(1)}px;z-index:7;display:flex;flex-direction:column;gap:${(size * 0.6).toFixed(1)}px;padding:${(size * 0.95).toFixed(1)}px ${(size * 1.15).toFixed(1)}px;border-radius:${(size * 0.9).toFixed(1)}px;background:${card};box-shadow:0 ${(size * 0.7).toFixed(1)}px ${(size * 2.2).toFixed(1)}px rgba(0,0,0,.28),0 ${(size * 0.15).toFixed(1)}px ${(size * 0.4).toFixed(1)}px rgba(0,0,0,.12)">${rows.join('')}</div>`;
}

function union(ds: DevicePlacement[]): Box | undefined {
  if (!ds.length) return undefined;
  const x = Math.min(...ds.map((d) => d.x));
  const y = Math.min(...ds.map((d) => d.y));
  return { x, y, w: Math.max(...ds.map((d) => d.x + d.w)) - x, h: Math.max(...ds.map((d) => d.y + d.h)) - y };
}

function deviceHtml(p: PageInput, ad: ResolvedDirection, sf: Surface, d: DevicePlacement, variant: FrameVariant, extraClass = '', position?: string): string {
  const s = p.screens[d.screen] ?? p.screens[0];
  if (!s) return '';
  const t = ad.tokens;
  const frameless = d.frameless || ad.device.frame === 'none';
  return DeviceFrame({
    family: d.family,
    width: Math.round(d.w),
    aspect: s.aspect,
    src: s.src,
    finish: finishFor(t, sf),
    variant,
    shadow: deviceShadow(t, sf, d.w, ad.device.shadow),
    rim: t.device.rim && sf.dark ? t.device.rim : undefined,
    tilt: d.rot,
    frameless,
    dim: d.dim,
    className: extraClass,
    style: position ?? `left:${d.x.toFixed(1)}px;top:${d.y.toFixed(1)}px;z-index:${d.z};`,
  });
}

/**
 * Bento: the devices rise out of a rounded stage tile that crops them at its edge. The page grows the tile into
 * the room the fitted caption leaves; devices keep their width and stay pinned to the tile's open edge.
 */
function bentoStage(p: PageInput & { index: number }, ad: ResolvedDirection, sf: Surface, plan: PortraitPlan, variant: FrameVariant, W: number, H: number, extra: string[]): string {
  const m = W * 0.042;
  const pad = W * 0.06;
  const top = plan.captionSide === 'top';
  const night = p.index % 2 === 1;
  const fill = night ? '#1D1D1F' : sf.extras[1] ?? '#F6EBE1';
  const minY = Math.min(...plan.devices.map((d) => d.y));
  const maxB = Math.max(...plan.devices.map((d) => d.y + d.h));
  const nominalTop = top ? H - plan.visible - pad : m;
  const nominalH = top ? H - m - nominalTop : plan.visible + pad - m;
  const devices = [...plan.devices]
    .sort((x, y) => x.z - y.z)
    .map((d) => {
      const local = top ? `top:${(pad + d.y - minY).toFixed(1)}px` : `bottom:${(pad + maxB - d.y - d.h).toFixed(1)}px`;
      return deviceHtml(p, ad, { ...sf, shadow: night ? 'rgba(0,0,0,.45)' : 'rgba(40,24,12,.16)' }, d, variant, '', `left:${(d.x - m).toFixed(1)}px;${local};z-index:${d.z};`);
    });
  return `<div class="tile-stage" data-grow="${top ? 'bottom' : 'top'}" data-margin="${m.toFixed(1)}" style="position:absolute;left:${m.toFixed(1)}px;width:${(W - m * 2).toFixed(1)}px;top:${nominalTop.toFixed(1)}px;height:${nominalH.toFixed(1)}px;border-radius:${(W * 0.045).toFixed(1)}px;overflow:hidden;background:${fill};box-shadow:0 1px 2px rgba(29,29,31,.04),0 8px 20px -12px rgba(29,29,31,.10);z-index:5">${devices.join('\n')}${extra.join('')}</div>`;
}

function badgesRow(p: PageInput, t: StyleTokens, sf: Surface, fontSize: number, align: 'center' | 'start', filter: (b: Badge) => boolean = () => true): string {
  const list = p.badges.filter(filter);
  if (!list.length) return '';
  return `<div class="badges" style="display:flex;flex-wrap:wrap;gap:${(fontSize * 0.55).toFixed(1)}px;justify-content:${align === 'center' ? 'center' : 'flex-start'};margin-top:${(fontSize * 0.35).toFixed(1)}px">${list.map((badge, i) => ChipView({ badge, locale: p.locale, t, sf, fontSize, rotate: t.badge === 'sticker' || t.badge === 'paper' ? (i % 2 ? 3 : -3) : 0 })).join('')}</div>`;
}

function portraitLayout(p: PageInput & { index: number; total: number; callouts: Callout[]; quotes: Quote[] }, ad: ResolvedDirection, sf: Surface, surfaceIndex: number, W: number, H: number): string {
  const t = ad.tokens;
  const a = p.archetype;
  const family = frameFamily(p.target, p.screens[0]);
  const variant = frameVariant(p.target, p.index);
  const planned = p.framing && p.framing !== 'auto' ? p.framing : planFramings([{ archetype: a, framing: 'auto' }], t, family)[0]!;
  // captionPosition: bottom keeps working: the device then bleeds off the top edge.
  const framing = p.captionPosition === 'bottom' && planned === 'bleed-bottom' ? 'bleed-top' : planned;
  const usesScreens = !['statement', 'testimonial', 'feature-wall'].includes(a);
  // Panoramic pair: a bridged panoramic shot's device crosses the edge; the next page draws its other half.
  const spanOut = Boolean(p.bridgeOut && a === 'panoramic' && usesScreens && p.screens.length && (p.index ?? 0) < (p.total ?? 1) - 1);
  const spanIn = usesScreens && a !== 'mosaic' && p.spanIn ? p.spanIn : undefined;
  if (spanIn) p = { ...p, screens: [...p.screens, spanIn] };
  const deviceFraming = spanIn && framing !== 'no-device' ? 'offset' : framing;
  const plan = planPortrait({ W, H, t, family, framing: usesScreens ? (a === 'mosaic' ? 'no-device' : deviceFraming) : 'no-device', archetype: a, screens: usesScreens ? (spanIn ? p.screens.slice(0, -1) : p.screens) : [], index: p.index, variant, span: { out: spanOut, inAspect: spanIn?.aspect } });
  const hs = headlineSizeFor(t, W, H, false);
  const statement = a === 'statement';
  const headlineSize = Math.round(hs * (statement ? 1.18 : 1));
  const subSize = Math.round(Math.max(W * 0.04, Math.min(W, H / 1.9) * 0.044));
  const badgeSize = Math.round(Math.min(W, H / 1.9) * 0.034);
  const align = plan.align;

  // ---- caption extras
  let above = '';
  if (a === 'stat' && p.stat) {
    above = `<div class="stat fit" data-min="${Math.round(hs * 1.1)}" style="font-family:var(--headline);font-weight:${Math.max(700, t.type.weight)};font-size:${Math.round(hs * 1.75)}px;line-height:.92;letter-spacing:-0.045em;color:${sf.emphasis[0]};white-space:nowrap;overflow:hidden;max-width:100%;${t.type.skew ? `transform:skewX(${t.type.skew}deg);` : ''}"><span class="w" data-colors="${sf.emphasis[0]}">${esc(p.stat)}</span></div>`;
  }
  if (a === 'social-proof') {
    const proof = p.badges.find((b) => b.type === 'proof');
    if (proof) above = BadgeView({ badge: { ...proof, style: proof.style === 'pill' ? 'laurel' : proof.style }, locale: p.locale, ad: paletteFor(sf, ad), fontSize: Math.round(badgeSize * 1.25) });
  }
  if (statement && p.icon && !p.photo) {
    const size = Math.round(Math.min(W, H / 1.9) * 0.26);
    above = `<img data-content src="${p.icon}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.225)}px;box-shadow:0 ${size * 0.1}px ${size * 0.3}px ${sf.shadow}">`;
  }
  if (p.brandMark && !(statement && p.icon && !p.photo)) above = brandLockup(p, t, sf, W, H, align) + above;
  // Maximalist presets wear their badges as stickers on the device, which also keeps their huge type roomy.
  const floatBadges = plan.devices.length > 0 && (a === 'feature' || a === 'tilted' || framing === 'offset' || framing === 'tilted' || t.density === 'maximal');
  const proofElsewhere = (b: Badge) => !((a === 'social-proof' || a === 'testimonial') && b.type === 'proof');
  let below = floatBadges ? '' : badgesRow(p, t, sf, statement ? Math.round(badgeSize * 1.25) : badgeSize, align, proofElsewhere);
  if (t.badge === 'tile' && !floatBadges && (p.badges.length || p.stat)) below = bentoTiles(p, t, sf, W, H, badgeSize);
  // A ticked list next to a device floats as one card over its side edge (the caption keeps its room and the
  // device its height); chips, and lists on slides without a device, sit under the caption.
  const bulletSize = Math.round(subSize * (statement ? 1.05 : 0.92));
  const floatBullets = Boolean(p.bullets?.length && plan.devices.length && (p.bulletStyle ?? 'check') === 'check');
  if (p.bullets?.length && !floatBullets) below = bulletList(p.bullets, p.bulletStyle ?? 'check', sf, bulletSize, align) + below;

  // ---- no-device bodies
  const items: string[] = [];
  let captionBox = plan.caption;
  let justify: string | undefined;
  if (plan.framing === 'no-device') {
    if (statement && p.photo) {
      // A lifestyle slide: the photo carries the top, the line sits low on the scrim.
      justify = 'flex-end';
      captionBox = { x: plan.caption.x, y: H * 0.46, w: plan.caption.w, h: H * 0.48 };
    } else if (statement) {
      justify = 'space-evenly';
      captionBox = { x: plan.caption.x, y: H * 0.07, w: plan.caption.w, h: H * 0.86 };
    } else if (a === 'mosaic') {
      captionBox = { x: plan.caption.x, y: plan.caption.y, w: plan.caption.w, h: H * 0.22 };
      items.push(mosaic(p, ad, sf, W, H, captionBox.y + captionBox.h + H * 0.02));
    } else if (a === 'feature-wall') {
      captionBox = { x: plan.caption.x, y: plan.caption.y, w: plan.caption.w, h: H * 0.24 };
      items.push(featureWall(p, t, sf, W, H, captionBox.y + captionBox.h + H * 0.01, hs));
    } else if (a === 'testimonial') {
      captionBox = { x: plan.caption.x, y: plan.caption.y, w: plan.caption.w, h: H * 0.24 };
      items.push(testimonials(p, ad, sf, W, H, captionBox.y + captionBox.h, badgeSize));
    }
  }

  const ctx = decorContext(p, t, sf, surfaceIndex, W, H, { caption: captionBox, captionSide: statement && p.photo ? 'bottom' : plan.captionSide, device: union(plan.devices), framing: plan.framing, landscape: false });

  // ---- stage: devices + decorations that scale with them
  const stage: string[] = [];
  if (plan.devices.length) {
    // A photo is the scene: the preset's own props stay out of it.
    if (!p.photo) stage.push(stageBack(ctx));
    for (const d of [...plan.devices].sort((x, y) => x.z - y.z)) stage.push(deviceHtml(p, ad, sf, d, variant));
    const main = plan.devices.find((d) => d.z === Math.max(...plan.devices.map((x) => x.z)))!;
    if (a === 'callout') stage.push(...callouts(p, main, W));
    if (a === 'before-after') {
      const arrow = Math.round(W * 0.09);
      const ay = main.y + (plan.captionSide === 'top' ? H * 0.16 : main.h - H * 0.2);
      stage.push(`<div data-layer="accent" style="position:absolute;left:${(W / 2 - arrow / 2).toFixed(1)}px;top:${ay.toFixed(1)}px;width:${arrow}px;height:${arrow}px;border-radius:50%;background:${sf.accent};display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:5">${lucideIcon('arrow-right', Math.round(arrow * 0.55), sf.dark ? '#0B0B0F' : '#FFFFFF')}</div>`);
    }
    if (floatBadges) stage.push(...floatingBadges(p, t, sf, main, W, H, badgeSize, plan.captionSide));
    if (floatBullets) stage.push(bulletCard(p.bullets!, sf, main, W, H, bulletSize, plan.captionSide));
    if (!p.photo) stage.push(stageFront(ctx));
  }
  // Both halves of a panoramic pair must keep their exact geometry, so their stage is never re-scaled.
  const fixed = Boolean(p.bridgeOut && a === 'panoramic') || Boolean(spanIn);
  const origin = plan.captionSide === 'top' ? `${W / 2}px ${H}px` : `${W / 2}px 0px`;
  const edge = plan.edgeGap ?? 0;
  const span = Math.max(1, plan.visible + edge);
  const maxK = (H * 0.8 + edge) / span;
  const widest = Math.max(1, ...plan.devices.map((d) => d.w));
  const stageHtml = plan.devices.length && t.background === 'bento' && plan.rule === 'phone' && a !== 'callout'
    ? bentoStage(p, ad, sf, plan, variant, W, H, [])
    : plan.devices.length
    ? `<div class="stage" ${fixed || plan.rule !== 'phone' ? '' : 'data-fit="1"'} data-anchor="${plan.captionSide === 'top' ? 'bottom' : 'top'}" data-vis="${span.toFixed(1)}" data-maxk="${Math.min(maxK, (W * 0.95) / widest).toFixed(3)}" data-mink="${((H * DEVICE_MIN + edge) / span).toFixed(3)}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:${origin};z-index:5">${stage.join('\n')}</div>`
    : '';

  // The watch canvas is tiny: a two-line headline only (no kicker, subheadline or badges).
  const watch = family === 'watch';
  const caption = CaptionBlock({
    t,
    sf,
    headline: p.headline,
    kicker: watch ? '' : p.kicker,
    subheadline: watch ? '' : p.subheadline,
    appName: p.appName ?? '',
    headlineSize,
    minHeadlineSize: Math.round(headlineSize * 0.55),
    subSize,
    canvasWidth: W,
    align: plan.framing === 'no-device' && !['feature-wall', 'testimonial', 'mosaic'].includes(a) ? (t.type.align === 'start' ? 'start' : 'center') : align,
    box: captionBox,
    bottom: plan.captionSide === 'bottom' || Boolean(statement && p.photo),
    above,
    below: watch ? '' : below,
    justify,
  });

  return [background(ad, ctx, p), p.photo ? '' : canvasDecor(ctx), ...items, stageHtml, grainLayer(t.grain, t.background === 'paper' ? 'multiply' : 'overlay'), topStructure(ctx), caption].join('\n');
}

function callouts(p: PageInput & { callouts: Callout[] }, d: DevicePlacement, W: number): string[] {
  const out: string[] = [];
  const s0 = p.screens[0]!;
  const g = deviceGeometry(d.family, d.w, s0.aspect);
  for (const c of p.callouts) {
    const src = p.screens[c.screen] ?? s0;
    // Rects are fractions of one capture; another family's UI has a different layout.
    const rect = src.family === 'iphone' || src.family === 'android-phone' ? c.rect : src.family === 'ipad' || src.family === 'duo' ? c.rects[src.family] : undefined;
    if (!rect) continue;
    const cw = Math.min(W * 0.94, rect.w * g.screen.w * c.scale);
    const ch = cw * ((rect.h * src.aspect) / rect.w);
    const cx = c.side === 'right' ? Math.min(W * 0.96 - cw, d.x + d.w * 0.42) : c.side === 'left' ? Math.max(W * 0.04, d.x + d.w * 0.58 - cw) : (W - cw) / 2;
    const cy = d.y + g.screen.y + g.screen.h * c.at - ch / 2;
    out.push(CalloutCard({ src: src.src, rect, rawAspect: src.aspect, width: cw, radius: Math.round(cw * 0.06), style: `left:${Math.round(cx)}px;top:${Math.round(cy)}px;z-index:6;`, className: '' }).replace('class="callout ', 'data-layer="accent" class="callout '));
  }
  return out;
}

function floatingBadges(p: PageInput, t: StyleTokens, sf: Surface, d: DevicePlacement, W: number, H: number, size: number, side: 'top' | 'bottom'): string[] {
  const visibleTop = Math.max(d.y, 0);
  const visibleBottom = Math.min(d.y + d.h, H);
  return p.badges.slice(0, 2).map((badge, i) => {
    const leftSide = (i + (d.x + d.w / 2 > W / 2 ? 0 : 1)) % 2 === 0;
    const x = leftSide ? `left:${Math.max(W * 0.04, d.x - d.w * 0.1).toFixed(1)}px;` : `right:${Math.max(W * 0.04, W - d.x - d.w - d.w * 0.1).toFixed(1)}px;`;
    const y = visibleTop + (visibleBottom - visibleTop) * (side === 'top' ? 0.22 + 0.24 * i : 0.4 + 0.24 * i);
    return `<div style="position:absolute;${x}top:${y.toFixed(1)}px;z-index:7">${ChipView({ badge, locale: p.locale, t, sf, fontSize: Math.round(size * 1.12), floating: true, rotate: t.badge === 'sticker' || t.badge === 'paper' ? (i % 2 ? 4 : -4) : t.background === 'neon' ? -4 : 0 })}</div>`;
  });
}

function bentoTiles(p: PageInput, t: StyleTokens, sf: Surface, W: number, H: number, size: number): string {
  const tiles: string[] = [];
  if (p.stat) tiles.push(`<div data-content style="flex:1;min-width:0;border-radius:${(W * 0.045).toFixed(1)}px;background:${sf.accent};color:#FFFFFF;padding:${(W * 0.036).toFixed(1)}px;display:flex;flex-direction:column;justify-content:space-between;height:${(H * 0.1).toFixed(1)}px;box-sizing:border-box"><span style="font-size:${size}px;font-weight:600;color:#FFF0E8">${esc(p.kicker ?? '')}</span><span style="font-family:var(--headline);font-weight:700;letter-spacing:-0.045em;font-size:${(size * 2.6).toFixed(1)}px;line-height:.85">${esc(p.stat)}</span></div>`);
  for (const b of p.badges.slice(0, p.stat ? 1 : 2)) {
    tiles.push(`<div style="flex:1;min-width:0">${ChipView({ badge: b, locale: p.locale, t, sf, fontSize: size, style: 'width:100%;box-sizing:border-box;height:100%;' })}</div>`);
  }
  return `<div class="badges" style="display:flex;gap:${(W * 0.03).toFixed(1)}px;width:100%;margin-top:${(H * 0.006).toFixed(1)}px">${tiles.join('')}</div>`;
}

function mosaic(p: PageInput, ad: ResolvedDirection, sf: Surface, W: number, H: number, top: number): string {
  const shots = p.screens.slice(0, 3);
  if (!shots.length) return '';
  const cw = W * 0.4;
  const cards = shots.map((s, i) => {
    const x = W * 0.5 - cw * 1.5 - W * 0.03 + i * (cw + W * 0.03);
    const y = top + (i % 2 ? H * 0.0 : H * 0.07);
    return DeviceFrame({ family: s.family, width: cw, aspect: s.aspect, src: s.src, frameless: true, shadow: deviceShadow(ad.tokens, sf, cw, true), className: 'mosaic-card', style: `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;` });
  });
  return `<div class="stage" style="position:absolute;inset:0;transform:rotate(-7deg);transform-origin:50% 70%;z-index:5">${cards.join('')}</div>`;
}

function featureWall(p: PageInput, t: StyleTokens, sf: Surface, W: number, H: number, top: number, hs: number, box?: { left: number; right: number; bottom: number }): string {
  const lines = (p.wall?.length ? p.wall : p.badges.map((b) => b.label[p.locale] ?? '')).filter(Boolean).slice(0, 7);
  if (t.background === 'bento') return bentoWall(lines, sf, W, H, top, hs);
  const size = Math.round(hs * (lines.length > 5 ? 0.62 : 0.74));
  const rows = lines
    .map((l, i) => {
      const em = i % 2 === 1;
      const kind = sf.emphasisKind ?? t.emphasis;
      const plated = em && PLATED_EMPHASIS.has(kind) && sf.plate;
      // Wall lines run down the whole canvas: on light surfaces the emphasis must clear every stop and bloom.
      const color = plated ? (sf.plateText ?? sf.text) : em ? (sf.dark ? sf.emphasis[0]! : ensureContrast(sf.emphasis[0]!, [...sf.bg, ...sf.extras.filter((c) => c.startsWith('#')).slice(0, 4)], 4.6)) : sf.text;
      const style = plated
        ? `background:${sf.plate};padding:.08em .3em .12em;border-radius:${kind === 'pill' ? '999px' : '0'};${kind === 'pill' ? 'border:.03em solid #16121F;box-shadow:.05em .06em 0 #16121F;transform:rotate(-2deg);' : ''}`
        : em && (t.emphasis === 'italic' || t.emphasis === 'script')
          ? t.emphasis === 'script'
            ? `font-family:var(--script);font-size:${Math.round(size * 1.4)}px;`
            : 'font-style:italic;'
          : '';
      return `<div data-content class="wall-line" style="font-family:var(--headline);font-weight:${t.type.weight};font-size:${size}px;line-height:1.05;letter-spacing:${t.type.tracking}em;color:${color};white-space:nowrap;${style}${t.type.case === 'upper' ? 'text-transform:uppercase;' : ''}">${plainWords(l, color)}</div>`;
    })
    .join('');
  const b = box ?? { left: W * 0.075, right: W * 0.075, bottom: H * 0.06 };
  return `<div class="wall" style="position:absolute;left:${b.left.toFixed(1)}px;right:${b.right.toFixed(1)}px;top:${top.toFixed(1)}px;bottom:${b.bottom.toFixed(1)}px;display:flex;flex-direction:column;justify-content:space-evenly;align-items:${t.type.align === 'start' || box ? 'flex-start' : 'center'};z-index:15">${rows}</div>`;
}

/** Bento closer: the feature list as a grid of tiles, one brand tile, numbered like keynote slides. */
function bentoWall(lines: string[], sf: Surface, W: number, H: number, top: number, hs: number): string {
  const m = W * 0.042;
  const gap = W * 0.03;
  const rows = Math.ceil(lines.length / 2);
  const tileH = (H - top - m - gap * (rows - 1)) / Math.max(1, rows);
  const tiles = lines.map((l, i) => {
    const wide = lines.length % 2 === 1 && i === lines.length - 1;
    const brand = i === 1;
    const bg = brand ? sf.accent : i % 3 === 2 ? sf.extras[1] ?? '#F6EBE1' : '#FFFFFF';
    const fg = brand ? '#FFFFFF' : sf.text;
    return `<div data-content class="wall-line" style="grid-column:${wide ? 'span 2' : 'auto'};border-radius:${(W * 0.045).toFixed(1)}px;background:${bg};padding:${(W * 0.045).toFixed(1)}px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 2px rgba(29,29,31,.04),0 8px 20px -12px rgba(29,29,31,.10);overflow:hidden"><span style="font-family:var(--body);font-weight:600;font-size:${(hs * 0.3).toFixed(1)}px;color:${brand ? '#FFF0E8' : sf.muted}">${String(i + 1).padStart(2, '0')}</span><span style="font-family:var(--headline);font-weight:700;letter-spacing:-0.03em;line-height:1;font-size:${(hs * 0.62).toFixed(1)}px;color:${fg}">${plainWords(l, fg)}</span></div>`;
  });
  return `<div class="wall" style="position:absolute;left:${m.toFixed(1)}px;right:${m.toFixed(1)}px;top:${top.toFixed(1)}px;bottom:${m.toFixed(1)}px;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:${tileH.toFixed(1)}px;gap:${gap.toFixed(1)}px;z-index:15">${tiles.join('')}</div>`;
}

function testimonials(p: PageInput & { quotes: Quote[] }, ad: ResolvedDirection, sf: Surface, W: number, H: number, top: number, badgeSize: number): string {
  const fontSize = Math.round(Math.min(W, H / 1.9) * 0.045);
  const pal = paletteFor(sf, ad);
  const cards = p.quotes
    .slice(0, 3)
    .map((q, i) => `<div data-content>${QuoteCard({ text: q.text, rating: q.rating, author: q.author, ad: pal, fontSize, width: W * 0.84, style: `position:relative;transform:rotate(${i % 2 ? 1.5 : -1.5}deg) translateX(${i % 2 ? W * 0.025 : -W * 0.02}px);` })}</div>`)
    .join('');
  const proof = p.badges.find((b) => b.type === 'proof');
  const laurel = proof ? `<div data-content>${BadgeView({ badge: { ...proof, style: 'laurel' }, locale: p.locale, ad: pal, fontSize: Math.round(badgeSize * 1.3) })}</div>` : '';
  return `<div style="position:absolute;left:${(W * 0.08).toFixed(1)}px;right:${(W * 0.08).toFixed(1)}px;top:${top.toFixed(1)}px;bottom:${(H * 0.05).toFixed(1)}px;display:flex;flex-direction:column;justify-content:space-evenly;align-items:center;z-index:15">${cards}${laurel}</div>`;
}

// ---------------------------------------------------------------- landscape

function landscapeLayout(p: PageInput & { index: number; total: number }, ad: ResolvedDirection, sf: Surface, surfaceIndex: number, W: number, H: number): string {
  const t = ad.tokens;
  const screens = p.screens;
  const family = frameFamily(p.target, screens[0]);
  const contained = CONTAINED_FAMILIES.has(family);
  const variant = frameVariant(p.target, p.index);
  const hero = contained && p.index % 2 === 1;
  const pad = W * 0.06;
  const devices: DevicePlacement[] = [];
  let captionBox: Box;
  let align: 'center' | 'start' = 'start';
  const hs = headlineSizeFor(t, W, H, true);
  const items: string[] = [];
  if (!screens.length) {
    // No device: a statement centres; a feature wall or reviews take the right half beside the caption.
    if (p.archetype === 'feature-wall') {
      captionBox = { x: pad, y: H * 0.12, w: W * 0.38, h: H * 0.76 };
      items.push(featureWall(p, t, sf, W, H, H * 0.1, hs, { left: W * 0.52, right: pad, bottom: H * 0.1 }));
    } else if (p.archetype === 'testimonial') {
      captionBox = { x: pad, y: H * 0.12, w: W * 0.38, h: H * 0.76 };
      items.push(testimonials({ ...p, quotes: input(p).quotes }, ad, sf, W * 0.5, H, H * 0.08, Math.round(H * 0.03)).replace('position:absolute;left:', `position:absolute;transform:translateX(${(W * 0.48).toFixed(1)}px);left:`));
    } else {
      align = 'center';
      captionBox = { x: pad, y: H * 0.12, w: W - pad * 2, h: H * 0.76 };
    }
  } else if (contained && hero) {
    align = 'center';
    captionBox = { x: pad, y: H * 0.07, w: W - pad * 2, h: H * 0.24 };
    const g0 = deviceGeometry(family, 1000, screens[0]!.aspect, variant);
    const availH = H - captionBox.y - captionBox.h - H * 0.06 - H * (family === 'tv' ? 0.06 : 0.02);
    let w = (availH / g0.height) * 1000;
    w = Math.min(w, W * 0.74);
    const h = (g0.height / 1000) * w;
    devices.push({ screen: 0, family, x: (W - w) / 2, y: H - H * (family === 'tv' ? 0.1 : 0.05) - h, w, h, rot: 0, z: 2 });
  } else if (contained) {
    captionBox = { x: pad, y: H * 0.1, w: W * 0.33, h: H * 0.62 };
    const g0 = deviceGeometry(family, 1000, screens[0]!.aspect, variant);
    const area = { left: pad + W * 0.355, right: W - pad * 0.5 };
    let w = area.right - area.left;
    let h = (g0.height / 1000) * w;
    const maxH = H * (family === 'tv' ? 0.7 : 0.84);
    if (h > maxH) {
      h = maxH;
      w = (h / g0.height) * 1000;
    }
    // A diagonal: caption from the top-left, device down to the bottom-right, so no band stays empty.
    devices.push({ screen: 0, family, x: area.right - w, y: Math.max((H - h) / 2, H * (family === 'tv' ? 0.86 : 0.93) - h), w, h, rot: 0, z: 2 });
  } else {
    // Creatives: caption column left, 1–3 phones on the right bleeding off the bottom.
    captionBox = { x: pad, y: H * 0.12, w: W * 0.4, h: H * 0.76 };
    const n = Math.min(screens.length, 3);
    const area = { left: pad + W * 0.44, right: W - pad * 0.4 };
    for (let i = 0; i < n; i++) {
      const s = screens[i]!;
      const f = frameFamily(p.target, s);
      const h = H * (n > 1 ? 0.92 : 1.02);
      const w = widthForHeight(f, h, s.aspect);
      const span = area.right - area.left;
      const left = n === 1 ? area.left + (span - w) / 2 : area.left + (span - w) * (i / (n - 1));
      devices.push({ screen: i, family: f, x: left, y: H * (0.1 + (i % 2) * 0.07), w, h, rot: n > 1 && t.device.tilt ? (i - (n - 1) / 2) * 4 : 0, z: i === Math.floor(n / 2) ? 3 : 1 });
    }
  }
  const ctx = decorContext(p, t, sf, surfaceIndex, W, H, { caption: captionBox, captionSide: 'top', device: union(devices), framing: contained ? 'contained' : 'offset', landscape: true });
  const env = family === 'vision' ? visionEnvironment(sf, W, H) : '';
  const stage = devices.length ? `<div class="stage" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;z-index:5">${stageBack(ctx)}${[...devices].sort((x, y) => x.z - y.z).map((d) => deviceHtml(p, ad, sf, d, variant)).join('\n')}${stageFront(ctx)}</div>` : '';
  const badgeSize = Math.round(H * 0.032);
  const caption = CaptionBlock({
    t,
    sf,
    headline: p.headline,
    kicker: p.kicker,
    subheadline: p.subheadline,
    appName: p.appName ?? '',
    headlineSize: hero ? Math.round(hs * 0.9) : hs,
    minHeadlineSize: Math.round(hs * 0.6),
    subSize: Math.round(Math.max(H * 0.034, hs * 0.36)),
    canvasWidth: Math.min(W, H),
    align,
    box: captionBox,
    bottom: false,
    below: badgesRow(p, t, sf, badgeSize, align),
    justify: hero || (contained && screens.length > 0) ? 'flex-start' : 'center',
  });
  return [background(ad, ctx, p), env, canvasDecor(ctx), ...items, stage, grainLayer(t.grain), topStructure(ctx), caption].join('\n');
}

function input(p: PageInput): { quotes: Quote[] } {
  return { quotes: p.quotes ?? [] };
}

/** Soft visionOS-style environment behind the floating window: horizon glow, distant ridges, a floor plane. */
function visionEnvironment(sf: Surface, W: number, H: number): string {
  const ridge = (y: number, c: string, o: number) => `<svg aria-hidden="true" style="position:absolute;left:0;top:0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="M0 ${y} C ${W * 0.15} ${y - H * 0.08}, ${W * 0.3} ${y + H * 0.02}, ${W * 0.45} ${y - H * 0.05} S ${W * 0.8} ${y - H * 0.1}, ${W} ${y - H * 0.03} L ${W} ${H} L 0 ${H} Z" fill="${c}" opacity="${o}"/></svg>`;
  return `<div aria-hidden="true" style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 50% at 50% 58%,${withAlpha(mix(sf.accent, '#FFFFFF', 0.6), 0.35)},transparent 70%)"></div>${ridge(H * 0.72, mix(sf.bg[0]!, sf.accent, 0.25), 0.55)}${ridge(H * 0.8, mix(sf.bg[0]!, '#000000', 0.2), 0.6)}`;
}

// ---------------------------------------------------------------- Google Play feature graphic and icon

function featureGraphic(p: PageInput & { index: number; total: number }, ad: ResolvedDirection, sf: Surface, surfaceIndex: number, W: number, H: number): string {
  const t = ad.tokens;
  const captionBox = { x: W * 0.06, y: H * 0.14, w: W * 0.54, h: H * 0.72 };
  const ctx = decorContext(p, t, sf, surfaceIndex, W, H, { caption: captionBox, captionSide: 'top', device: undefined, framing: 'no-device', landscape: true });
  const iconSize = H * 0.66;
  const icon = p.icon
    ? `<img src="${p.icon}" style="width:100%;height:100%;border-radius:22.5%;display:block">`
    : `<div style="width:100%;height:100%;border-radius:22.5%;background:linear-gradient(150deg,${sf.accent},${mix(sf.accent, '#000000', 0.3)});display:flex;align-items:center;justify-content:center;font-family:var(--headline);font-weight:800;font-size:${(iconSize * 0.5).toFixed(0)}px;color:#FFFFFF">${esc([...(p.appName ?? '•')][0] ?? '•')}</div>`;
  // No device frame (Google Play shows the banner small and over video); the icon is the hero object.
  const art = `<div data-content style="position:absolute;left:${(W * 0.94 - iconSize).toFixed(1)}px;top:${((H - iconSize) / 2).toFixed(1)}px;width:${iconSize.toFixed(1)}px;height:${iconSize.toFixed(1)}px;transform:rotate(-8deg);filter:drop-shadow(0 ${(H * 0.06).toFixed(1)}px ${(H * 0.1).toFixed(1)}px ${sf.shadow});z-index:5">${icon}</div>
    <div aria-hidden="true" style="position:absolute;left:${(W * 0.6).toFixed(1)}px;top:${(-H * 0.2).toFixed(1)}px;width:${(W * 0.5).toFixed(1)}px;height:${(H * 1.4).toFixed(1)}px;border-radius:50%;background:${withAlpha(sf.accent, sf.dark ? 0.28 : 0.22)};filter:blur(${(H * 0.12).toFixed(1)}px)"></div>`;
  const hs = Math.round(H * 0.15);
  const caption = CaptionBlock({
    t,
    sf,
    headline: p.headline,
    kicker: p.appName ?? p.kicker,
    subheadline: p.subheadline,
    appName: p.appName ?? '',
    headlineSize: hs,
    minHeadlineSize: Math.round(hs * 0.6),
    subSize: Math.round(H * 0.052),
    canvasWidth: W,
    align: 'start',
    box: captionBox,
    bottom: false,
    justify: 'center',
  });
  return [backgroundLayer(ctx), canvasDecor(ctx), art, grainLayer(t.grain), caption].join('\n');
}

function iconPage(p: PageInput, sf: Surface, W: number, H: number): string {
  // Google Play applies its own mask: the icon is drawn full-bleed and square.
  const inner = p.icon
    ? `<img src="${p.icon}" style="position:absolute;inset:0;width:100%;height:100%">`
    : `<div style="position:absolute;inset:0;background:linear-gradient(150deg,${sf.accent},${mix(sf.accent, '#000000', 0.35)});display:flex;align-items:center;justify-content:center;font-family:var(--headline);font-weight:800;font-size:${(W * 0.5).toFixed(0)}px;color:#FFFFFF">${esc([...(p.appName ?? '•')][0] ?? '•')}</div>`;
  return `<div class="bg" style="position:absolute;inset:0;background:${sf.bg[0]}"></div>${inner}<div class="caption" style="display:none"><h1 class="headline"></h1></div>`;
  void H;
}

/**
 * Runs inside the page: shrinks `.fit` text until it fits (box, line count, every headline word ≤ 88 % of the
 * canvas width), scales the device stage into the room the caption leaves (visible height 68–82 %), then
 * reports overflow, sizes, safe-area violations and the quality-bar measurements.
 */
export const MEASURE_SCRIPT = `(() => {
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const caption = document.querySelector('.caption');
  const headline = document.querySelector('.headline');
  const fits = [...document.querySelectorAll('.fit')];
  const maxWord = W * 0.88;
  const visibleKids = () => caption ? [...caption.children].filter((c) => c.getBoundingClientRect().height > 0) : [];
  const contentBottom = () => Math.max(...visibleKids().map((c) => c.getBoundingClientRect().bottom));
  const contentTop = () => Math.min(...visibleKids().map((c) => c.getBoundingClientRect().top));
  // Fit is judged on layout boxes (offsetTop/offsetHeight), so rotated stickers and skewed type do not count as overflow.
  const captionOver = () => {
    if (!caption) return false;
    const kids = visibleKids();
    if (!kids.length) return false;
    const top = Math.min(...kids.map((k) => k.offsetTop));
    const bottom = Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight));
    return bottom > caption.clientHeight + 1 || top < -1;
  };
  const wordsOf = (el) => [...el.querySelectorAll('.w')];
  const tooWide = (el) => {
    const room = caption ? caption.clientWidth : W;
    if (el.offsetWidth > room + 1) return true;
    const limit = Math.min(maxWord, room + 1);
    const ws = wordsOf(el);
    if (!ws.length) return el.scrollWidth > el.clientWidth + 1;
    return ws.some((w) => w.getBoundingClientRect().width > limit);
  };
  // Layout height is unaffected by transforms (rotated or skewed headlines), so lines = height / line box.
  const lines = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * parseFloat(el.dataset.leading || '1.1');
    return Math.max(1, Math.round(el.offsetHeight / lh - 0.15));
  };
  const tooManyLines = (el) => el.classList.contains('headline') && lines(el) > parseFloat(el.dataset.maxLines || '9');
  for (let guard = 0; guard < 400; guard++) {
    const over = captionOver();
    const bad = fits.filter((el) => tooWide(el) || tooManyLines(el));
    if (!over && !bad.length) break;
    let shrunk = false;
    // Shrink the subheadline first (down to its minimum), then the headline / stat.
    const order = bad.length ? bad : [...fits].reverse();
    for (const el of order) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      const min = parseFloat(el.dataset.min || '0');
      if (size - 1 >= min) { el.style.fontSize = (size - 1) + 'px'; shrunk = true; break; }
    }
    if (!shrunk) break;
  }
  const overflow = [];
  for (const el of fits) if (tooWide(el)) overflow.push(el.className.split(' ')[0] + ': ' + el.textContent.trim().slice(0, 40));
  if (captionOver()) overflow.push('caption: the caption block does not fit its allotted area');
  for (const el of document.querySelectorAll('.fit-one')) if (el.scrollWidth > el.clientWidth + 1) overflow.push('badge: ' + el.textContent.trim().slice(0, 30));
  // Scale the device stage into the space the fitted caption leaves (anchored to its edge).
  const gap = parseFloat(document.body.dataset.gap || '0');
  const stage = document.querySelector('.stage[data-fit]');
  const tile = document.querySelector('.tile-stage[data-grow]');
  if (tile && caption && visibleKids().length) {
    const m = parseFloat(tile.dataset.margin);
    if (tile.dataset.grow === 'bottom') {
      const top = Math.min(H * 0.32, contentBottom() + gap);
      tile.style.top = top + 'px';
      tile.style.height = (H - m - top) + 'px';
    } else {
      const bottom = Math.max(H * 0.68, contentTop() - gap);
      tile.style.top = m + 'px';
      tile.style.height = (bottom - m) + 'px';
    }
  }
  if (stage && caption && visibleKids().length) {
    const vis = parseFloat(stage.dataset.vis);
    const avail = stage.dataset.anchor === 'bottom' ? H - contentBottom() - gap : contentTop() - gap;
    const k = Math.max(parseFloat(stage.dataset.mink), Math.min(parseFloat(stage.dataset.maxk), avail / vis));
    stage.style.transform = 'scale(' + k.toFixed(4) + ')';
  }
  // --- measurements
  const clipRect = (el) => {
    let r = el.getBoundingClientRect();
    let box = { top: Math.max(0, r.top), bottom: Math.min(H, r.bottom), left: Math.max(0, r.left), right: Math.min(W, r.right) };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        const ar = a.getBoundingClientRect();
        box = { top: Math.max(box.top, ar.top), bottom: Math.min(box.bottom, ar.bottom), left: Math.max(box.left, ar.left), right: Math.min(box.right, ar.right) };
      }
    }
    return box;
  };
  const devices = [...document.querySelectorAll('.device, .mosaic-card')].map(clipRect).filter((b) => b.bottom > b.top && b.right > b.left);
  const deviceRatio = devices.length ? (Math.max(...devices.map((b) => b.bottom)) - Math.min(...devices.map((b) => b.top))) / H : 0;
  const intervals = [];
  for (const c of visibleKids()) { const r = c.getBoundingClientRect(); intervals.push([r.top, r.bottom]); }
  for (const b of devices) intervals.push([b.top, b.bottom]);
  for (const el of document.querySelectorAll('[data-content], .chip, .callout, .quote, .wall-line')) { const b = clipRect(el); if (b.bottom > b.top) intervals.push([b.top, b.bottom]); }
  intervals.sort((a, b) => a[0] - b[0]);
  let cursor = 0, band = 0;
  for (const [a, b] of intervals) { if (a > cursor) band = Math.max(band, a - cursor); cursor = Math.max(cursor, b); }
  band = Math.max(band, H - cursor) / H;
  const hw = headline ? wordsOf(headline) : [];
  const widest = hw.length ? Math.max(...hw.map((w) => w.getBoundingClientRect().width)) / W : 0;
  const accents = document.querySelectorAll('[data-layer="accent"]').length;
  const hasText = Boolean(headline && headline.textContent.trim());
  const layers = 1 + (devices.length ? 1 : 0) + (hasText ? 1 : 0) + (accents > 2 ? 1 : 0);
  const words = [];
  for (const [sel, role] of [['.headline .w', 'headline'], ['.stat .w', 'headline'], ['.wall-line .w', 'headline'], ['.kicker .w', 'support'], ['.subheadline .w', 'support'], ['.bullets .w', 'support'], ['.brand-mark .w', 'support']]) {
    for (const w of document.querySelectorAll(sel)) {
      const r = w.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      // An inline box is centred on its content area; faces with tall metrics (Anton) set tighter than that
      // would otherwise sample the lines above and below (a boxed word next to a plain one).
      const lh = parseFloat(getComputedStyle(w).lineHeight);
      const h = lh > 0 && r.height > lh ? lh : r.height;
      words.push({ x: r.left, y: r.top + (r.height - h) / 2, w: r.width, h, colors: (w.dataset.colors || '').split(',').filter(Boolean), role });
    }
  }
  const guide = document.querySelector('.safe-guide');
  const inset = guide ? parseFloat(guide.dataset.inset) : 0;
  const safe = [];
  for (const el of document.querySelectorAll('.headline, .subheadline, .badge, .stat, .kicker')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.left < inset - 0.5 || r.top < inset - 0.5 || r.right > W - inset + 0.5 || r.bottom > H - inset + 0.5) safe.push(el.className.split(' ')[0]);
  }
  const hs = headline ? getComputedStyle(headline) : null;
  return {
    overflow,
    headlineCssPx: headline && hs ? parseFloat(hs.fontSize) : 0,
    headlineLines: headline && headline.textContent.trim() ? lines(headline) : 0,
    safeAreaViolations: safe,
    deviceRatio, band, widest, layers, words,
  };
})()`;
