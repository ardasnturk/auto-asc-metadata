/**
 * Background and decoration recipes per style preset (HTML/CSS only). Layers, bottom to top:
 * background → canvas decorations → stage (back decorations, devices, front accents) → grain → top
 * structure (index rows, mastheads, tags) → caption. Everything that fills space on purpose carries
 * `data-content` so the empty-band measurement counts it; floating accents over the device carry
 * `data-layer="accent"`.
 */
import type { Badge, Framing, Shot } from '@vitrin/schemas';
import { lucideIcon } from './assets.js';
import { inkOn, mix, withAlpha } from './color.js';
import { esc, Stars } from './components.js';
import type { StyleTokens, Surface } from './styles.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DecorContext {
  W: number;
  H: number;
  t: StyleTokens;
  sf: Surface;
  /** Position of the surface in the preset (0 = default). */
  surfaceIndex: number;
  index: number;
  total: number;
  appName: string;
  icon?: string;
  kicker: string;
  locale: string;
  archetype: Shot['archetype'];
  framing: Framing;
  landscape: boolean;
  /** Nominal caption block (before fitting). */
  caption: Box;
  captionSide: 'top' | 'bottom';
  /** Nominal union box of the devices (stage coordinates = canvas coordinates before the fit scale). */
  device?: Box;
  /** A decorative element continues into the next / comes from the previous screenshot. */
  bridgeOut: boolean;
  bridgeIn: boolean;
  badges: Badge[];
  stat?: string;
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
const GRAIN_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(GRAIN_SVG)}")`;

export function grainLayer(opacity: number, blend = 'overlay', tile = 240): string {
  if (opacity <= 0) return '';
  return `<div class="grain" aria-hidden="true" style="position:absolute;inset:0;background-image:${GRAIN_URL};background-size:${px(tile)};opacity:${opacity};mix-blend-mode:${blend};pointer-events:none"></div>`;
}

/** Deterministic PRNG so every export of a slide is identical. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blob(x: number, y: number, d: number, color: string, opacity: number, blur: number, extra = ''): string {
  return `<div style="position:absolute;left:${px(x - d / 2)};top:${px(y - d / 2)};width:${px(d)};height:${px(d)};border-radius:50%;background:${color};opacity:${opacity};filter:blur(${px(blur)});${extra}"></div>`;
}

/** Four-point curved sparkle. */
function sparkle(x: number, y: number, size: number, color: string, rot = 0, attrs = ''): string {
  return `<svg ${attrs} aria-hidden="true" width="${px(size)}" height="${px(size)}" viewBox="0 0 100 100" style="position:absolute;left:${px(x - size / 2)};top:${px(y - size / 2)};transform:rotate(${rot}deg)"><path d="M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0Z" fill="${color}"/></svg>`;
}

function star5(x: number, y: number, size: number, color: string, rot: number, stroke?: string): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? 21 : 48;
    return `${(50 + Math.cos(a) * rr).toFixed(1)},${(52 + Math.sin(a) * rr).toFixed(1)}`;
  }).join(' ');
  return `<svg aria-hidden="true" width="${px(size)}" height="${px(size)}" viewBox="0 0 100 100" style="position:absolute;left:${px(x - size / 2)};top:${px(y - size / 2)};transform:rotate(${rot}deg)"><polygon points="${pts}" fill="${color}" ${stroke ? `stroke="${stroke}" stroke-width="6" stroke-linejoin="round"` : ''}/></svg>`;
}

/** Hand-drawn squiggle (jittered control points) as an SVG path inside a box. */
export function squiggle(w: number, h: number, color: string, stroke: number, seed = 3): string {
  const rnd = mulberry32(seed);
  const waves = 3;
  let d = `M2 ${h / 2}`;
  for (let i = 0; i < waves; i++) {
    const x0 = 2 + ((w - 4) / waves) * i;
    const x1 = 2 + ((w - 4) / waves) * (i + 1);
    const j = () => (rnd() - 0.5) * h * 0.25;
    d += ` C ${(x0 + (x1 - x0) * 0.3).toFixed(1)} ${(h * 0.05 + j()).toFixed(1)}, ${(x0 + (x1 - x0) * 0.7).toFixed(1)} ${(h * 0.95 + j()).toFixed(1)}, ${x1.toFixed(1)} ${(h / 2 + j()).toFixed(1)}`;
  }
  return `<svg aria-hidden="true" width="${px(w)}" height="${px(h)}" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" style="overflow:visible"><path d="${d}" fill="none" stroke="${color}" stroke-width="${stroke.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function curvedArrow(x: number, y: number, w: number, h: number, color: string, stroke: number, flip: boolean): string {
  const path = flip ? `M ${w * 0.95} 4 C ${w * 0.9} ${h * 0.6}, ${w * 0.45} ${h * 0.3}, ${w * 0.12} ${h * 0.9}` : `M ${w * 0.05} 4 C ${w * 0.1} ${h * 0.6}, ${w * 0.55} ${h * 0.3}, ${w * 0.88} ${h * 0.9}`;
  const hx = flip ? w * 0.12 : w * 0.88;
  const hy = h * 0.9;
  const head = flip ? `M ${hx + w * 0.02} ${hy - h * 0.2} L ${hx} ${hy} L ${hx + w * 0.16} ${hy - h * 0.04}` : `M ${hx - w * 0.02} ${hy - h * 0.2} L ${hx} ${hy} L ${hx - w * 0.16} ${hy - h * 0.04}`;
  return `<svg aria-hidden="true" width="${px(w)}" height="${px(h)}" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" style="position:absolute;left:${px(x)};top:${px(y)};overflow:visible"><path d="${path}" fill="none" stroke="${color}" stroke-width="${stroke.toFixed(1)}" stroke-linecap="round"/><path d="${head}" fill="none" stroke="${color}" stroke-width="${stroke.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Clay object recipe (three-stop radial, inner light/shadow, specular, warm cast shadow). */
function clay(x: number, y: number, w: number, h: number, tones: [string, string, string], radius = '50% 48% 46% 52% / 56% 54% 46% 44%', extra = ''): string {
  const k = Math.min(w, h);
  return `<div data-content style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};border-radius:${radius};background:radial-gradient(120% 110% at 30% 24%,${tones[0]} 0%,${tones[1]} 46%,${tones[2]} 100%);box-shadow:inset ${px(-k * 0.07)} ${px(-k * 0.1)} ${px(k * 0.17)} rgba(70,35,20,.30),inset ${px(k * 0.06)} ${px(k * 0.07)} ${px(k * 0.12)} rgba(255,248,236,.5),0 ${px(k * 0.16)} ${px(k * 0.22)} ${px(-k * 0.06)} rgba(95,60,40,.38);${extra}">
    <div style="position:absolute;left:18%;top:12%;width:34%;height:22%;border-radius:50%;background:radial-gradient(closest-side,rgba(255,252,245,.75),transparent);filter:blur(${px(k * 0.02)});transform:rotate(-24deg)"></div></div>`;
}

function clayTones(c: string): [string, string, string] {
  return [mix(c, '#FFFFFF', 0.38), c, mix(c, '#2A1408', 0.32)];
}

// ---------------------------------------------------------------- background layer

export function backgroundLayer(ctx: DecorContext): string {
  const { W, H, sf, t } = ctx;
  const c0 = sf.bg[0]!;
  const c1 = sf.bg[1] ?? c0;
  const c2 = sf.bg[2] ?? c1;
  const c3 = sf.bg[3] ?? c2;
  const blur = Math.max(W, H) * 0.1;
  let css = `background:${c0};`;
  let inner = '';
  const cap = ctx.caption;
  switch (t.background) {
    case 'classic': {
      css = `background:linear-gradient(180deg,${c0} 0%,${mix(c0, c1, 0.25)} 48%,${mix(c0, c1, 0.7)} 100%);`;
      const ex = sf.extras;
      const deviceY = ctx.captionSide === 'top' ? H * 0.68 : H * 0.3;
      // Without a device the type runs down the canvas: keep the blooms low-key under it.
      const k = ctx.device ? 1 : 0.45;
      inner = blob(W * 0.82, deviceY, W * 1.0, ex[0] ?? c1, (sf.dark ? 0.55 : 0.6) * k, blur) + blob(W * 0.08, ctx.captionSide === 'top' ? H * 0.96 : H * 0.05, W * 0.9, c2, (sf.dark ? 0.5 : 0.55) * k, blur) + blob(W * 1.02, ctx.captionSide === 'top' ? H * 0.25 : H * 0.75, W * 0.6, c1, 0.35, blur);
      break;
    }
    case 'aurora': {
      css = `background:linear-gradient(${172 + (ctx.index % 3) * 5}deg,${c0} 0%,${c1} 38%,${c2} 68%,${c3} 100%);`;
      const [lav = '#CDBBFF', sky = '#AFD5FF', peach = '#FFCDB2', rose = '#FFC4D6'] = sf.extras;
      const flip = ctx.index % 2 === 1;
      inner =
        blob(W * (flip ? 0.9 : 0.08), H * 0.06, W * 0.85, lav, 0.9, blur * 1.1) +
        blob(W * (flip ? 0.1 : 0.88), H * 0.42, W * 0.9, sky, 0.85, blur * 1.1) +
        blob(W * (flip ? 0.85 : 0.05), H * 0.8, W * 0.85, peach, 0.85, blur * 1.1) +
        blob(W * (flip ? 0.12 : 0.92), H * 0.95, W * 0.7, rose, 0.8, blur * 1.1) +
        // White halo behind the headline keeps the gradient word above 4.5:1 whatever the blooms do.
        `<div style="position:absolute;left:${px(cap.x + cap.w / 2 - W * 0.42)};top:${px(cap.y + cap.h * 0.45 - W * 0.27)};width:${px(W * 0.84)};height:${px(W * 0.54)};border-radius:50%;background:#FFFFFF;opacity:.6;filter:blur(${px(W * 0.09)})"></div>`;
      break;
    }
    case 'swiss': {
      const m = W * 0.0545;
      const pitch = W * 0.0758;
      const lw = Math.max(0.7, W * 0.0015);
      const xs = [...Array.from({ length: 12 }, (_, i) => m + pitch * i), W - m];
      inner = xs.map((x) => `<div style="position:absolute;left:${px(x)};top:0;width:${px(lw)};height:100%;background:${sf.rule}"></div>`).join('');
      break;
    }
    case 'beam': {
      css = `background:linear-gradient(180deg,${c0} 0%,${c1} 38%,${c2} 70%,${c3} 100%);`;
      const target = ctx.device ? { x: ctx.device.x + ctx.device.w / 2, y: ctx.device.y + ctx.device.h * 0.2 } : { x: W / 2, y: H * 0.6 };
      const ox = ctx.index % 2 ? W * 0.72 : W * 0.5;
      const oy = -H * 0.07;
      const ang = (Math.atan2(target.x - ox, -(target.y - oy)) * 180) / Math.PI;
      const dir = (ang + 360) % 360;
      // Without a device the type fills the canvas, so the beam stays dim everywhere.
      const capEnd = !ctx.device ? H * 0.95 : ctx.captionSide === 'top' ? cap.y + cap.h : H;
      const dimTo = ctx.device ? Math.min(H * 0.6, capEnd + H * 0.02) : H * 0.98;
      const beamMask = `linear-gradient(180deg,rgba(0,0,0,.26) 0px,rgba(0,0,0,.32) ${px(dimTo)},#000 ${px(dimTo + H * 0.06)},#000 ${px(H * 0.62)},transparent ${px(H * 0.95)})`;
      const [beam2 = '#A77BFF'] = sf.extras;
      const a = sf.accent;
      const dot = Math.max(0.6, W * 0.0011);
      const step = W * 0.033;
      const holeTop = ctx.captionSide === 'top' ? cap.y - H * 0.015 : cap.y - H * 0.015;
      const holeBottom = cap.y + cap.h + H * 0.015;
      inner = `<div style="position:absolute;inset:0;background-image:radial-gradient(circle at ${px(dot)} ${px(dot)},rgba(255,255,255,.13) ${px(dot)},transparent ${px(dot * 1.5)});background-size:${px(step)} ${px(step)};-webkit-mask-image:radial-gradient(ellipse 62% 42% at ${((ox / W) * 100).toFixed(0)}% 32%,#000 10%,rgba(0,0,0,.35) 55%,transparent 80%),linear-gradient(180deg,#000 0,#000 ${px(holeTop)},transparent ${px(holeTop + H * 0.012)},transparent ${px(holeBottom - H * 0.012)},#000 ${px(holeBottom)});-webkit-mask-composite:source-in;mask-composite:intersect"></div>
        <div style="position:absolute;left:0;right:0;top:0;height:${px(Math.max(1, H * 0.0008))};background:linear-gradient(90deg,transparent 8%,${withAlpha(a, 0.35)} ${((ox / W) * 100 - 20).toFixed(0)}%,${withAlpha('#E6E4FF', 0.95)} ${((ox / W) * 100).toFixed(0)}%,${withAlpha(a, 0.35)} ${((ox / W) * 100 + 20).toFixed(0)}%,transparent 92%)"></div>
        <div style="position:absolute;left:${px(ox - W * 0.6)};top:${px(-H * 0.1)};width:${px(W * 1.2)};height:${px(H * 0.18)};filter:blur(${px(W * 0.025)});background:radial-gradient(ellipse 34% 50% at 50% 50%,${withAlpha(a, 0.32)},${withAlpha(a, 0.06)} 55%,transparent 75%)"></div>
        <div style="position:absolute;inset:${px(-W * 0.2)};mix-blend-mode:screen;filter:blur(${px(W * 0.035)});background:conic-gradient(from ${(dir - 20).toFixed(1)}deg at ${px(ox + W * 0.2)} ${px(oy + W * 0.2)},transparent 0deg,${withAlpha(a, 0.1)} 9deg,${withAlpha(beam2, 0.22)} 20deg,${withAlpha(a, 0.1)} 31deg,transparent 40deg);-webkit-mask-image:${beamMask.replace(/(\d+(?:\.\d+)?)px/g, (_, n) => px(Number(n) + W * 0.2))}"></div>
        <div style="position:absolute;inset:${px(-W * 0.2)};mix-blend-mode:screen;filter:blur(${px(W * 0.012)});background:conic-gradient(from ${(dir - 6.5).toFixed(1)}deg at ${px(ox + W * 0.2)} ${px(oy + W * 0.2)},transparent 0deg,${withAlpha(a, 0.2)} 4deg,${withAlpha('#C4BCFF', 0.32)} 6.5deg,${withAlpha(a, 0.2)} 9deg,transparent 13deg);-webkit-mask-image:${beamMask.replace(/(\d+(?:\.\d+)?)px/g, (_, n) => px(Number(n) + W * 0.2))}"></div>
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse 120% 80% at 50% 38%,transparent 55%,rgba(0,0,0,.55) 100%)"></div>`;
      break;
    }
    case 'clay':
      css = sf.bg.length >= 4 ? `background:linear-gradient(180deg,${c0} 0%,${c1} 38%,${c2} 68%,${c3} 100%);` : `background:radial-gradient(120% 70% at 50% 30%,${c0} 0%,${c1} 48%,${c2} 100%);`;
      if (sf.dark) inner = `<div style="position:absolute;left:${px(W * 0.5 - W * 0.65)};top:${px(H * 0.62)};width:${px(W * 1.3)};height:${px(H * 0.4)};background:radial-gradient(closest-side,rgba(230,160,120,.42),transparent)"></div>`;
      break;
    case 'washi': {
      css = `background:${c1};`;
      inner = `<div style="position:absolute;inset:0;background:radial-gradient(110% 70% at 14% 6%,${withAlpha(c0, 0.95)} 0%,${withAlpha(c0, 0.5)} 30%,${withAlpha(c1, 0)} 62%),linear-gradient(180deg,${withAlpha(c2, 0)} 55%,${withAlpha(c2, 0.55)} 100%)"></div>${washiFibres(W, H, sf.dark)}`;
      break;
    }
    case 'bento':
    case 'candy':
      css = `background:${c0};`;
      break;
    case 'magazine':
      css = `background:${c0};`;
      inner = `<div style="position:absolute;inset:0;background:radial-gradient(${px(W * 0.9)} ${px(H * 0.32)} at 20% 10%,rgba(255,250,240,.55),transparent 60%),radial-gradient(${px(W * 0.76)} ${px(H * 0.42)} at 90% 95%,rgba(196,178,150,.18),transparent 65%)"></div>`;
      break;
    case 'neon': {
      if (sf.dark) {
        css = `background:linear-gradient(172deg,${c0} 0%,${c1} 42%,${c2} 100%);`;
        const fx = [85, 20, 60, 50, 30][ctx.index % 5]!;
        inner = `<div style="position:absolute;inset:0;background:radial-gradient(ellipse 70% 38% at ${fx}% -4%,rgba(226,232,240,.13),rgba(226,232,240,.04) 45%,transparent 72%),radial-gradient(ellipse 60% 30% at 70% 62%,${withAlpha(sf.accent, 0.07)},transparent 70%),repeating-linear-gradient(118deg,rgba(255,255,255,.022) 0 ${px(Math.max(0.7, W * 0.0015))},transparent ${px(Math.max(0.7, W * 0.0015))} ${px(W * 0.012)})"></div>
          <div style="position:absolute;inset:0;background:radial-gradient(ellipse 95% 70% at 50% 45%,transparent 55%,rgba(0,0,0,.55) 100%)"></div>`;
      } else css = `background:${c0};`;
      break;
    }
    case 'paper': {
      css = `background:${c0};`;
      const line = Math.max(0.6, W * 0.0012);
      inner = `<div style="position:absolute;inset:0;background-image:repeating-linear-gradient(180deg,rgba(255,255,255,.06) 0 ${px(line)},transparent ${px(line)} ${px(W * 0.006)}),repeating-linear-gradient(90deg,rgba(0,0,0,.025) 0 ${px(line)},transparent ${px(line)} ${px(W * 0.0045)})"></div>
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(33,28,22,.08) 100%)"></div>`;
      break;
    }
    case 'doodle':
      css = `background:${c0};`;
      if (sf.dark) inner = `<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 60%,transparent 60%,rgba(0,0,0,.12) 100%)"></div>`;
      break;
    case 'studio':
      // A product-shot sweep: a soft top light falling off into the floor tone.
      css = `background:linear-gradient(${sf.dark ? 165 : 180}deg,${c0} 0%,${c1} 100%);`;
      inner = `<div style="position:absolute;left:${px(-W * 0.25)};top:${px(-H * 0.2)};width:${px(W * 1.5)};height:${px(H * 0.62)};border-radius:50%;background:radial-gradient(closest-side,${withAlpha('#FFFFFF', sf.dark ? 0.16 : 0.85)},transparent)"></div>`;
      break;
    case 'poster': {
      // A printed poster: flat stock, a trim line inset from the edge and a halftone patch in the device's corner.
      css = `background:${c0};`;
      const m = W * 0.034;
      const lw = Math.max(1, W * 0.0026);
      const right = ctx.index % 2 === 0;
      const low = ctx.captionSide === 'top';
      const patch = W * 0.5;
      inner = `<div style="position:absolute;inset:${px(m)};border:${px(lw)} solid ${sf.rule};border-radius:${px(W * 0.018)}"></div>
        <div style="position:absolute;${right ? 'right' : 'left'}:${px(-patch * 0.2)};${low ? 'bottom' : 'top'}:${px(-patch * 0.2)};width:${px(patch)};height:${px(patch)};background-image:radial-gradient(${withAlpha(sf.text, sf.dark ? 0.2 : 0.16)} ${px(W * 0.0055)},transparent ${px(W * 0.006)});background-size:${px(W * 0.022)} ${px(W * 0.022)};-webkit-mask-image:radial-gradient(circle at ${right ? '70%' : '30%'} ${low ? '70%' : '30%'},#000 0%,transparent 68%)"></div>`;
      break;
    }
    case 'block':
      css = `background:${c0};`;
      break;
    case 'gilded': {
      // Black lacquer with a warm glow where the device stands, fine guilloche rings around it and a double gilt
      // rule inset like a certificate's border.
      // The glow sits on the device (sized by the short side, so wide canvases do not flood the caption with it).
      const dv = ctx.device;
      const glowX = dv ? dv.x + dv.w / 2 : W / 2;
      const glowY = dv ? (ctx.captionSide === 'top' ? Math.max(dv.y, 0) + Math.min(dv.h, H) * 0.45 : Math.min(dv.y + dv.h, H) - Math.min(dv.h, H) * 0.45) : H * 0.62;
      const gr = Math.min(W, H) * 0.56;
      const lw = Math.max(1, W * 0.0022);
      css = sf.dark ? `background:radial-gradient(120% 80% at ${((glowX / W) * 100).toFixed(0)}% ${((glowY / H) * 100).toFixed(0)}%,${c2} 0%,${c1} 45%,${c0} 100%);` : `background:linear-gradient(180deg,${c0} 0%,${c1} 100%);`;
      inner = `<div style="position:absolute;left:${px(glowX - gr)};top:${px(glowY - gr)};width:${px(gr * 2)};height:${px(gr * 2)};border-radius:50%;background:radial-gradient(closest-side,${withAlpha(sf.accent, sf.dark ? 0.26 : 0.18)},transparent)"></div>
        <div style="position:absolute;left:${px(glowX - gr * 0.9)};top:${px(glowY - gr * 0.9)};width:${px(gr * 1.8)};height:${px(gr * 1.8)};border-radius:50%;background:repeating-radial-gradient(circle,${withAlpha(sf.accent, sf.dark ? 0.12 : 0.14)} 0 ${px(lw)},transparent ${px(lw)} ${px(W * 0.024)});-webkit-mask-image:radial-gradient(closest-side,#000 35%,transparent 100%)"></div>
        <div style="position:absolute;inset:${px(W * 0.03)};border:${px(lw)} solid ${withAlpha(sf.accent, 0.55)}"></div>
        <div style="position:absolute;inset:${px(W * 0.042)};border:${px(lw * 0.6)} solid ${withAlpha(sf.accent, 0.28)}"></div>`;
      break;
    }
  }
  return `<div class="bg" style="position:absolute;inset:0;overflow:hidden;${css}">${inner}</div>`;
}

/** Kozo fibres for washi paper, generated once per canvas size (seeded, so exports are identical). */
function washiFibres(W: number, H: number, dark: boolean): string {
  const rnd = mulberry32(17);
  const paths: string[] = [];
  for (let i = 0; i < 240; i++) {
    const isDark = i % 3 !== 0;
    let x = rnd() * W * 1.06 - W * 0.03;
    let y = rnd() * H * 1.03 - H * 0.015;
    let a = rnd() * Math.PI;
    const L = W * (0.03 + rnd() * 0.11);
    const pts = [[x, y]];
    for (let k = 0; k < 3; k++) {
      a += (rnd() - 0.5) * 1.1;
      x += (Math.cos(a) * L) / 3;
      y += (Math.sin(a) * L) / 3;
      pts.push([x, y]);
    }
    const [p0, p1, p2, p3] = pts as [number[], number[], number[], number[]];
    const color = isDark ? (dark ? '#000000' : '#8C7B62') : '#FFFFFF';
    const op = isDark ? 0.05 + rnd() * 0.06 : 0.14 + rnd() * 0.12;
    paths.push(`<path d="M${p0[0]!.toFixed(1)} ${p0[1]!.toFixed(1)} C${p1[0]!.toFixed(1)} ${p1[1]!.toFixed(1)} ${p2[0]!.toFixed(1)} ${p2[1]!.toFixed(1)} ${p3[0]!.toFixed(1)} ${p3[1]!.toFixed(1)}" stroke="${color}" stroke-opacity="${op.toFixed(2)}" stroke-width="${(W * (isDark ? 0.0007 : 0.001) * (1 + rnd())).toFixed(2)}" fill="none" stroke-linecap="round"/>`);
  }
  return `<svg aria-hidden="true" style="position:absolute;inset:0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paths.join('')}</svg>`;
}

// ---------------------------------------------------------------- canvas decorations (behind the stage)

/** Decorations tied to the canvas, behind the devices: ribbons, bridges, sun discs for no-device slides. */
export function canvasDecor(ctx: DecorContext): string {
  const { W, H, sf, t } = ctx;
  const out: string[] = [];
  const noDevice = !ctx.device;
  switch (t.background) {
    case 'classic': {
      const y = ctx.captionSide === 'top' ? H * 0.58 : H * 0.42;
      out.push(`<svg aria-hidden="true" style="position:absolute;left:0;top:0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="M${-W * 0.1} ${y} C ${W * 0.25} ${y - H * 0.12}, ${W * 0.55} ${y + H * 0.14}, ${W * 1.1} ${y - H * 0.05}" stroke="${withAlpha(sf.accent, sf.dark ? 0.45 : 0.4)}" stroke-width="${(W * 0.014).toFixed(1)}" fill="none" stroke-linecap="round"/></svg>`);
      if (noDevice) out.push(sparkle(W * 0.14, H * 0.16, W * 0.07, withAlpha(sf.text, 0.8), 0), sparkle(W * 0.86, H * 0.84, W * 0.09, sf.accent, 10));
      break;
    }
    case 'aurora':
      if (noDevice) {
        out.push(`<div data-content style="position:absolute;left:${px(W * 0.62)};top:${px(H * 0.12)};width:${px(W * 0.38)};height:${px(W * 0.38)};border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFFFFF,${sf.extras[0] ?? '#CDBBFF'} 45%,${sf.extras[1] ?? '#AFD5FF'});filter:blur(${px(W * 0.01)});opacity:.9"></div>`);
        out.push(`<div data-content style="position:absolute;left:${px(-W * 0.08)};top:${px(H * 0.74)};width:${px(W * 0.46)};height:${px(W * 0.46)};border-radius:50%;background:radial-gradient(circle at 40% 35%,#FFFFFF,${sf.extras[2] ?? '#FFCDB2'} 45%,${sf.extras[3] ?? '#FFC4D6'});filter:blur(${px(W * 0.01)});opacity:.9"></div>`);
      }
      break;
    case 'clay':
      if (noDevice) {
        out.push(hills(ctx, H * 0.9));
        out.push(clay(W * 0.8, H * 0.8, W * 0.26, W * 0.26, clayTones(sf.accent), '50%'));
        out.push(clay(-W * 0.04, H * 0.86, W * 0.2, W * 0.12, clayTones(sf.extras[1] ?? '#E9DECC')));
      }
      break;
    case 'neon':
      if (noDevice) out.push(slashBand(ctx, H * 1.07, 0.9));
      break;
    case 'candy':
    case 'paper':
      // Landscape store graphics keep their type clear: no sticker scatter behind the caption.
      if (noDevice && !ctx.landscape) out.push(...scatter(ctx, 8));
      break;
    case 'doodle':
      if (noDevice) out.push(doodles(ctx, true));
      break;
    case 'magazine':
      if (noDevice && ctx.archetype === 'statement') out.push(`<div data-content style="position:absolute;left:0;right:0;bottom:0;height:${px(H * 0.12)};background:linear-gradient(180deg,${sf.accent},${mix(sf.accent, '#000000', 0.25)})"></div>`);
      break;
    case 'poster':
      // A statement slide's number fills the lower corner in outline, like a poster's issue number.
      if (noDevice && !ctx.landscape && ctx.archetype === 'statement') out.push(`<div data-content aria-hidden="true" style="position:absolute;right:${px(W * 0.06)};bottom:${px(H * 0.035)};font-family:var(--headline);font-size:${px(W * 0.5)};line-height:.8;color:transparent;-webkit-text-stroke:${px(Math.max(1.5, W * 0.004))} ${withAlpha(sf.text, 0.3)}">${String(ctx.index + 1).padStart(2, '0')}</div>`);
      break;
    case 'studio':
      // Without a device: two soft tinted spheres, top corner and bottom, so the type is not alone on the sweep.
      if (noDevice && !ctx.landscape) {
        const tint = sf.extras[1] ?? '#DCE3FF';
        out.push(`<div data-content style="position:absolute;left:${px(W * 0.68)};top:${px(-W * 0.12)};width:${px(W * 0.44)};height:${px(W * 0.44)};border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFFFFF,${tint} 70%);opacity:${sf.dark ? 0.25 : 0.9}"></div>`);
        out.push(`<div data-content style="position:absolute;left:${px(-W * 0.14)};top:${px(H * 0.84)};width:${px(W * 0.6)};height:${px(W * 0.6)};border-radius:50%;background:radial-gradient(circle at 40% 30%,#FFFFFF,${tint} 70%);opacity:${sf.dark ? 0.25 : 0.9}"></div>`);
      }
      break;
    case 'block':
      if (noDevice && !ctx.landscape) {
        out.push(`<div data-content style="position:absolute;left:${px(W * 0.62)};top:${px(H * 0.8)};width:${px(W * 0.7)};height:${px(W * 0.7)};border-radius:50%;background:${withAlpha(sf.text, 0.1)}"></div>`);
        out.push(`<div data-content style="position:absolute;left:${px(-W * 0.12)};top:${px(H * 0.88)};width:${px(W * 0.36)};height:${px(W * 0.36)};border-radius:50%;border:${px(Math.max(1.5, W * 0.006))} solid ${withAlpha(sf.text, 0.22)}"></div>`);
      }
      break;
    case 'gilded':
      if (noDevice && !ctx.landscape) {
        // A gilt sunburst rising from the bottom edge.
        out.push(`<div data-content style="position:absolute;left:${px(W * 0.5 - W * 0.55)};top:${px(H * 0.86)};width:${px(W * 1.1)};height:${px(W * 1.1)};border-radius:50%;background:repeating-conic-gradient(from 0deg,${withAlpha(sf.accent, 0.22)} 0deg 2deg,transparent 2deg 9deg);-webkit-mask-image:radial-gradient(closest-side,#000 20%,transparent 100%)"></div>`);
      }
      break;
  }
  if (ctx.bridgeOut) out.push(bridge(ctx, 'out'));
  if (ctx.bridgeIn) out.push(bridge(ctx, 'in'));
  return out.join('\n');
}

/** A non-text element centred on the seam with the neighbouring screenshot, so the pair reads as one strip. */
function bridge(ctx: DecorContext, side: 'out' | 'in'): string {
  const { W, H, sf, t } = ctx;
  const cx = side === 'out' ? W : 0;
  // Mid-height sits behind the device whichever edge the neighbour anchors it to, so a bridge never meets type.
  const y = H * 0.55;
  switch (t.background) {
    case 'swiss':
      return `<div style="position:absolute;left:${px(cx - W * 0.5)};top:${px(y)};width:${px(W)};height:${px(Math.max(1.5, W * 0.0025))};background:${sf.text}"></div>`;
    case 'neon':
      return slashBand(ctx, y, 0.35, cx);
    case 'magazine':
      return `<div style="position:absolute;left:${px(cx - W * 0.3)};top:${px(y - H * 0.08)};width:${px(W * 0.6)};height:${px(H * 0.16)};background:${sf.accent}"></div>`;
    case 'candy':
    case 'paper':
    case 'doodle':
      return `<div style="position:absolute;left:${px(cx - W * 0.32)};top:${px(y)};">${squiggle(W * 0.64, H * 0.05, t.background === 'candy' ? sf.text : sf.accent, W * 0.012, 11)}</div>`;
    case 'beam':
      return `<div style="position:absolute;left:${px(cx - W * 0.4)};top:${px(y)};width:${px(W * 0.8)};height:${px(Math.max(1, W * 0.0025))};background:linear-gradient(90deg,transparent,${withAlpha(sf.accent, 0.6)} 40%,${withAlpha('#E6E4FF', 0.9)} 50%,${withAlpha(sf.accent, 0.6)} 60%,transparent)"></div>`;
    case 'poster': {
      // Hazard tape in ink and signal: it reads on every surface of the cycle.
      const ink = t.surfaces[0]!.bg[0]!;
      const signal = t.surfaces[0]!.plate ?? sf.accent;
      return `<div style="position:absolute;left:${px(cx - W * 0.45)};top:${px(y)};width:${px(W * 0.9)};height:${px(H * 0.03)};background:repeating-linear-gradient(-45deg,${ink} 0 ${px(W * 0.03)},${signal} ${px(W * 0.03)} ${px(W * 0.06)})"></div>`;
    }
    case 'block':
      return `<div style="position:absolute;left:${px(cx - W * 0.32)};top:${px(y - W * 0.32)};width:${px(W * 0.64)};height:${px(W * 0.64)};border-radius:50%;background:rgba(255,255,255,.2)"></div>`;
    case 'gilded':
      return `<div style="position:absolute;left:${px(cx - W * 0.45)};top:${px(y)};width:${px(W * 0.9)};height:${px(W * 0.012)};border-top:${px(Math.max(1, W * 0.0022))} solid ${withAlpha(sf.accent, 0.7)};border-bottom:${px(Math.max(1, W * 0.0014))} solid ${withAlpha(sf.accent, 0.45)}"></div>`;
    case 'clay':
      return `<div style="position:absolute;left:${px(cx - W * 0.45)};top:${px(y - H * 0.1)};width:${px(W * 0.9)};height:${px(H * 0.2)};border-radius:50%;filter:blur(${px(W * 0.01)});background:radial-gradient(70% 60% at 36% 8%,${mix(sf.extras[0] ?? '#A9B79C', '#FFFFFF', 0.3)},${sf.extras[0] ?? '#A9B79C'} 42%,${mix(sf.extras[0] ?? '#A9B79C', '#000000', 0.25)})"></div>`;
    default:
      return blob(cx, y, W * 0.9, sf.accent, sf.dark ? 0.4 : 0.45, W * 0.1);
  }
}

// ---------------------------------------------------------------- stage decorations (scale with the devices)

/** Behind the devices, in stage coordinates. */
export function stageBack(ctx: DecorContext): string {
  const { W, H, sf, t } = ctx;
  const d = ctx.device;
  if (!d) return '';
  const out: string[] = [];
  switch (t.background) {
    case 'classic':
      out.push(sparkle(d.x - W * 0.04, d.y + d.h * 0.12, W * 0.06, withAlpha(sf.text, 0.85), 0), sparkle(d.x + d.w + W * 0.03, d.y + d.h * 0.3, W * 0.045, sf.accent, 15));
      break;
    case 'beam':
      out.push(`<div style="position:absolute;left:${px(d.x + d.w * 0.1)};top:${px(d.y - W * 0.12)};width:${px(d.w * 0.8)};height:${px(W * 0.35)};filter:blur(${px(W * 0.05)});background:radial-gradient(ellipse at 50% 60%,${withAlpha(sf.accent, 0.55)},transparent 70%)"></div>`);
      if (ctx.index % 2 === 0 && !ctx.landscape) out.push(comet(ctx, d.x - W * 0.42, d.y + d.h * 0.18, W * 0.4));
      break;
    case 'clay': {
      const right = ctx.index % 2 === 0;
      if (ctx.framing === 'bleed-bottom' && ctx.archetype !== 'fullbleed') {
        // Arch window behind the phone: a bone rim with a pressed-in sage recess.
        const aw = d.w + W * 0.14;
        const ax = d.x + d.w / 2 - aw / 2;
        const ay = d.y - H * 0.045;
        out.push(`<div data-content style="position:absolute;left:${px(ax)};top:${px(ay)};width:${px(aw)};height:${px(H * 1.2)};border-radius:${px(aw / 2)} ${px(aw / 2)} 0 0;background:linear-gradient(180deg,${mix(sf.bg[0]!, '#FFFFFF', 0.4)},${mix(sf.bg[1] ?? sf.bg[0]!, '#C9B79C', 0.25)});box-shadow:0 ${px(W * 0.04)} ${px(W * 0.07)} ${px(-W * 0.015)} rgba(110,75,50,.30),inset ${px(W * 0.008)} ${px(W * 0.01)} ${px(W * 0.018)} rgba(255,255,255,.7),inset ${px(-W * 0.01)} ${px(-W * 0.008)} ${px(W * 0.022)} rgba(150,115,85,.25)">
          <div style="position:absolute;left:${px(W * 0.03)};right:${px(W * 0.03)};top:${px(W * 0.03)};bottom:0;border-radius:${px(aw / 2 - W * 0.03)} ${px(aw / 2 - W * 0.03)} 0 0;background:radial-gradient(90% 60% at 50% 18%,${mix(sf.extras[0] ?? '#A9B79C', '#FFFFFF', 0.25)},${sf.extras[0] ?? '#A9B79C'} 52%,${mix(sf.extras[0] ?? '#A9B79C', '#000000', 0.15)});box-shadow:inset 0 ${px(W * 0.035)} ${px(W * 0.05)} rgba(60,72,48,.42)"></div></div>`);
      }
      out.push(clay(right ? d.x + d.w - W * 0.12 : d.x - W * 0.16, d.y - W * 0.05, W * 0.28, W * 0.28, clayTones(sf.accent), '50%'));
      break;
    }
    case 'washi': {
      // The phone stands on an oak shelf with a warm contact shadow; one river stone keeps it company.
      const shelfY = d.y + d.h;
      const sh = Math.max(4, H * 0.011);
      out.push(`<div data-content style="position:absolute;left:${px(-W * 0.3)};top:${px(shelfY - sh * 0.2)};width:${px(W * 1.6)};height:${px(sh)};background:linear-gradient(180deg,#E9D6B4 0,#E2CBA3 24%,#B8956A 26%,#CBAB80 40%,#C5A376 70%,#A7845A 100%);box-shadow:0 1px 0 rgba(90,64,36,.35),0 ${px(sh * 0.45)} ${px(sh * 0.7)} ${px(-sh * 0.2)} rgba(84,62,36,.26),0 ${px(sh * 1.6)} ${px(sh * 2.5)} ${px(-sh * 0.75)} rgba(84,62,36,.16)"></div>
        <div style="position:absolute;left:${px(d.x + W * 0.035)};top:${px(shelfY - sh * 0.9)};width:${px(d.w - W * 0.06)};height:${px(sh * 1.1)};border-radius:50%;background:radial-gradient(closest-side,rgba(52,40,28,.42),rgba(52,40,28,0))"></div>`);
      const stoneLeft = d.x + d.w / 2 > W / 2;
      const sw = W * 0.17;
      const sx = stoneLeft ? Math.max(W * 0.04, d.x - sw - W * 0.04) : Math.min(W - sw - W * 0.04, d.x + d.w + W * 0.04);
      if ((stoneLeft && d.x > sw + W * 0.06) || (!stoneLeft && W - d.x - d.w > sw + W * 0.06)) {
        out.push(`<div style="position:absolute;left:${px(sx + sw * 0.08)};top:${px(shelfY - sh * 0.8)};width:${px(sw * 0.9)};height:${px(sh * 1.2)};border-radius:50%;background:radial-gradient(closest-side,rgba(52,40,28,.4),transparent)"></div>
          <div data-content style="position:absolute;left:${px(sx)};top:${px(shelfY - sw * 0.52)};width:${px(sw)};height:${px(sw * 0.54)};border-radius:52% 48% 44% 50% / 60% 62% 40% 38%;background:radial-gradient(120% 100% at 32% 24%,#D9D3C8 0%,#A69E8F 50%,#6F685D 100%);box-shadow:inset ${px(-sw * 0.06)} ${px(-sw * 0.08)} ${px(sw * 0.14)} rgba(40,30,20,.35),inset ${px(sw * 0.05)} ${px(sw * 0.05)} ${px(sw * 0.1)} rgba(255,255,255,.35)"></div>`);
      }
      break;
    }
    case 'magazine': {
      // The cover-image plate: a spot-colour block behind the lower part of the phone, bleeding off one side.
      const right = d.x + d.w / 2 >= W / 2;
      const inset = W * 0.12;
      // With the caption at the bottom the plate hangs from the top edge instead, so type never sits on it.
      const below = ctx.captionSide === 'bottom';
      const top = below ? -H * 0.2 : d.y + d.h * 0.36;
      const plateH = below ? d.y + d.h * 0.64 + H * 0.2 : H * 1.2;
      out.push(`<div data-content style="position:absolute;${right ? `left:${px(inset)};right:${px(-W * 0.5)}` : `left:${px(-W * 0.5)};right:${px(inset)}`};top:${px(top)};height:${px(plateH)};background:linear-gradient(180deg,${sf.accent} 0%,${sf.accent} 45%,${mix(sf.accent, '#000000', 0.25)} 100%)"><div style="position:absolute;inset:0;background:radial-gradient(60% 30% at 20% 0%,rgba(255,220,200,.10),transparent)"></div></div>`);
      if (!below) out.push(seal(ctx, right ? inset + W * 0.03 : W - inset - W * 0.24, top + H * 0.03, W * 0.2, sf.extras[1] ?? '#F6EFE3'));
      break;
    }
    case 'neon':
      out.push(slashBand(ctx, d.y + d.h * 0.42, 1));
      out.push(streaks(ctx, d));
      break;
    case 'candy':
      out.push(...scatter(ctx, 7, d));
      break;
    case 'paper':
      out.push(...scatter(ctx, 7, d));
      break;
    case 'doodle':
      out.push(doodles(ctx, false, d));
      break;
    case 'aurora':
      out.push(blob(d.x + d.w * 0.5, d.y + d.h * 0.3, d.w * 0.9, sf.extras[1] ?? '#AFD5FF', 0.55, W * 0.1));
      break;
    case 'studio':
      // A soft tinted halo behind the phone, the way product shots separate the device from the sweep.
      // Near-white light, so an accent word next to it keeps the contrast it has on the sweep.
      out.push(blob(d.x + d.w * 0.5, d.y + d.h * 0.5, d.w * 1.15, sf.dark ? (sf.extras[1] ?? '#DCE3FF') : mix(sf.extras[1] ?? '#DCE3FF', '#FFFFFF', 0.55), sf.dark ? 0.3 : 0.85, W * 0.07));
      break;
    case 'block': {
      // One big circle behind the device, a shade off the background, and a thin ring offset from it.
      // The circle rises only a little past the device's edge, so the caption never sits on its lighter tone.
      const r = Math.min(W * 0.5, H * 0.3, d.w * 0.8);
      const cx = d.x + d.w * (ctx.index % 2 ? 0.2 : 0.8);
      const cy = ctx.captionSide === 'top' ? Math.max(0, d.y) + r * 0.95 : Math.min(H, d.y + d.h) - r * 0.95;
      out.push(`<div style="position:absolute;left:${px(cx - r)};top:${px(cy - r)};width:${px(r * 2)};height:${px(r * 2)};border-radius:50%;background:${withAlpha(sf.text, 0.12)}"></div>`);
      // The ring stays within the devices' own span, so in a landscape creative it never reaches the caption column.
      const ringX = d.x + d.w * (ctx.index % 2 ? 0.82 : 0.18);
      out.push(`<div style="position:absolute;left:${px(ringX - r * 0.45)};top:${px(cy + r * 0.25)};width:${px(r * 0.9)};height:${px(r * 0.9)};border-radius:50%;border:${px(Math.max(1.5, W * 0.006))} solid ${withAlpha(sf.text, 0.22)}"></div>`);
      break;
    }
    case 'gilded':
      out.push(blob(d.x + d.w * 0.5, d.y + d.h * (ctx.captionSide === 'top' ? 0.42 : 0.58), d.w * 1.05, sf.accent, sf.dark ? 0.22 : 0.16, W * 0.09));
      break;
  }
  return out.join('\n');
}

/** Over the devices, in stage coordinates (accent layer). */
export function stageFront(ctx: DecorContext): string {
  const { W, H, sf, t } = ctx;
  const d = ctx.device;
  if (!d) return '';
  const out: string[] = [];
  if (t.background === 'clay' && ctx.captionSide === 'top') out.push(hills(ctx, d.y + d.h * 0.9));
  if (t.background === 'paper') {
    // Washi tape across the device's top corner.
    const right = ctx.index % 2 === 0;
    out.push(`<div data-layer="accent" style="position:absolute;left:${px(right ? d.x + d.w - W * 0.13 : d.x - W * 0.06)};top:${px(d.y + H * 0.012)};width:${px(W * 0.2)};height:${px(W * 0.06)};transform:rotate(${right ? 38 : -38}deg);background:${withAlpha(sf.extras[3] ?? '#A8E3C8', 0.78)};background-image:radial-gradient(rgba(255,255,255,.7) ${px(W * 0.005)},transparent ${px(W * 0.006)});background-size:${px(W * 0.02)} ${px(W * 0.02)};box-shadow:0 ${px(W * 0.003)} ${px(W * 0.008)} rgba(0,0,0,.12)"></div>`);
  }
  if (t.background === 'candy' && ctx.framing !== 'bleed-top') out.push(sparkle(d.x + d.w * 0.92, d.y + d.h * 0.06, W * 0.09, '#FFFFFF', 12, 'data-layer="accent"'));
  void H;
  return out.join('\n');
}

function hills(ctx: DecorContext, top: number): string {
  const { W, sf } = ctx;
  const a = sf.extras[0] ?? '#A9B79C';
  const b = sf.accent;
  const hill = (x: number, y: number, w: number, h: number, c: string) =>
    `<div data-content style="position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};border-radius:50%;background:radial-gradient(70% 60% at 36% 8%,${mix(c, '#FFFFFF', 0.3)},${c} 42%,${mix(c, '#000000', 0.25)});box-shadow:inset 0 ${px(W * 0.018)} ${px(W * 0.027)} rgba(255,255,255,.35),inset ${px(-W * 0.045)} ${px(-W * 0.045)} ${px(W * 0.09)} rgba(60,30,20,.25),0 ${px(-W * 0.018)} ${px(W * 0.038)} rgba(60,30,20,.18)"></div>`;
  return hill(-W * 0.35, top, W * 1.25, W * 0.6, a) + hill(W * 0.42, top + W * 0.05, W * 1.05, W * 0.55, b);
}

function comet(ctx: DecorContext, x: number, y: number, len: number): string {
  const { W, sf } = ctx;
  const h = Math.max(1, W * 0.0025);
  return `<div aria-hidden="true" style="position:absolute;left:${px(x)};top:${px(y)};width:${px(len)};height:${px(h)};background:linear-gradient(90deg,transparent,${withAlpha(sf.accent, 0.15)} 35%,${withAlpha('#D2D0FF', 0.75)} 88%,#F2F1FF)"><div style="position:absolute;right:${px(-W * 0.006)};top:${px(-W * 0.005)};width:${px(W * 0.012)};height:${px(W * 0.012)};border-radius:50%;background:#F2F1FF;box-shadow:0 0 ${px(W * 0.008)} ${px(W * 0.002)} rgba(200,196,255,.95),0 0 ${px(W * 0.033)} ${px(W * 0.009)} ${withAlpha(sf.accent, 0.55)}"></div></div>`;
}

function slashBand(ctx: DecorContext, y: number, opacity: number, cx = ctx.W / 2): string {
  const { W, sf } = ctx;
  const th = W * 0.16;
  const deep = sf.extras[0] ?? sf.accent;
  return `<div data-content style="position:absolute;left:${px(cx - W)};top:${px(y - th / 2)};width:${px(W * 2)};height:${px(th)};transform:rotate(-24deg);opacity:${opacity}">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,${sf.accent},${deep})"></div>
    <div style="position:absolute;inset:0;transform:translateX(${px(-W * 0.03)});background:${sf.accent};opacity:.35;filter:blur(${px(W * 0.012)})"></div>
    <div style="position:absolute;left:0;right:0;top:${px(th + W * 0.06)};height:${px(W * 0.014)};background:${sf.accent};opacity:.5"></div></div>`;
}

function streaks(ctx: DecorContext, d: Box): string {
  const { W, sf } = ctx;
  const left = ctx.index % 2 === 0;
  const x = left ? d.x - W * 0.5 : d.x + d.w + W * 0.02;
  const fringe = (dx: number, dy: number, c: string) => `<div style="position:absolute;left:${px(dx)};top:${px(dy)};width:${px(W * 0.42)};height:${px(W * 0.008)};border-radius:99px;background:${c};opacity:.17;filter:blur(${px(W * 0.002)})"></div>`;
  return `<div aria-hidden="true" style="position:absolute;left:${px(x)};top:${px(d.y + d.h * 0.22)};width:${px(W * 0.5)};height:${px(W * 0.2)};transform:rotate(-9deg)">
    ${fringe(-W * 0.008, -W * 0.003, sf.extras[2] ?? '#FF3DA0')}${fringe(W * 0.008, W * 0.003, sf.extras[3] ?? '#3AE7FF')}
    <div style="position:absolute;left:0;top:0;width:${px(W * 0.42)};height:${px(W * 0.008)};border-radius:99px;background:${sf.accent}"></div>
    <div style="position:absolute;left:${px(W * 0.08)};top:${px(W * 0.05)};width:${px(W * 0.3)};height:${px(W * 0.006)};border-radius:99px;background:${withAlpha(sf.text, 0.55)}"></div>
    <div style="position:absolute;left:${px(W * 0.02)};top:${px(W * 0.1)};width:${px(W * 0.36)};height:${px(W * 0.007)};border-radius:99px;background:${sf.accent};opacity:.6;filter:blur(${px(W * 0.004)})"></div></div>`;
}

/** Letterpress roundel with the app name on a circular path. */
function seal(ctx: DecorContext, x: number, y: number, size: number, color: string): string {
  const name = esc(ctx.appName.toUpperCase());
  const ring = `${name} · Nº ${ctx.index + 1} · ${name} ·`;
  return `<svg data-content aria-hidden="true" width="${px(size)}" height="${px(size)}" viewBox="0 0 250 250" style="position:absolute;left:${px(x)};top:${px(y)};transform:rotate(-9deg)">
    <defs><path id="ring${ctx.index}" d="M125,125 m-92,0 a92,92 0 1,1 184,0 a92,92 0 1,1 -184,0"/></defs>
    <g fill="none" stroke="${color}"><circle cx="125" cy="125" r="120" stroke-width="3.5"/><circle cx="125" cy="125" r="112" stroke-width="1.2"/><circle cx="125" cy="125" r="70" stroke-width="1.2"/></g>
    <text fill="${color}" font-family="var(--label)" font-size="19" font-weight="600" letter-spacing="3"><textPath href="#ring${ctx.index}" textLength="570">${ring}</textPath></text>
    <text x="125" y="120" text-anchor="middle" fill="${color}" font-family="var(--headline)" font-style="italic" font-size="34">Nº</text>
    <text x="125" y="160" text-anchor="middle" fill="${color}" font-family="var(--headline)" font-style="italic" font-size="44">${ctx.index + 1}</text></svg>`;
}

/** Maximalist sticker scatter (Candy Pop, Paper Sticker): sparkles, stars, hearts, dots and an arrow. */
function scatter(ctx: DecorContext, n: number, d?: Box): string[] {
  const { W, H, sf, t } = ctx;
  const rnd = mulberry32(31 + ctx.index * 7);
  const ink = t.background === 'candy' ? '#16121F' : '#1F2A44';
  const colors = sf.extras.filter((c) => c !== sf.bg[0]);
  const out: string[] = [];
  const zones: Array<[number, number]> = d
    ? [
        [d.x - W * 0.06, d.y + d.h * 0.05],
        [d.x + d.w + W * 0.04, d.y + d.h * 0.12],
        [d.x - W * 0.08, d.y + d.h * 0.42],
        [d.x + d.w + W * 0.06, d.y + d.h * 0.5],
        [W * 0.94, d.y + d.h * 0.3],
        [W * 0.05, d.y + d.h * 0.7],
        [d.x + d.w + W * 0.03, d.y + d.h * 0.78],
      ]
    : [
        // No device: stickers stay on the side margins and the bottom edge, away from the type.
        [W * 0.05, H * 0.4],
        [W * 0.95, H * 0.52],
        [W * 0.04, H * 0.7],
        [W * 0.96, H * 0.84],
        [W * 0.5, H * 0.985],
        [W * 0.93, H * 0.3],
        [W * 0.08, H * 0.94],
      ];
  // In landscape the caption column sits left of the devices: stickers stay on the device side.
  zones.filter(([x]) => !ctx.landscape || !d || x > d.x).slice(0, n).forEach(([x, y], i) => {
    const c = colors[i % Math.max(1, colors.length)] ?? sf.accent;
    const size = W * (0.06 + rnd() * 0.05);
    const rot = (rnd() - 0.5) * 30;
    if (t.background === 'candy') {
      const sh = `filter:drop-shadow(${px(W * 0.008)} ${px(W * 0.01)} 0 ${ink});`;
      if (i % 3 === 0) out.push(sparkle(x, y, size, i % 2 ? '#FFFFFF' : ink, rot));
      else if (i % 3 === 1) out.push(`<div data-content style="position:absolute;left:${px(x - size / 2)};top:${px(y - size / 2)};${sh}">${heart(size, c)}</div>`);
      else out.push(`<div data-content style="position:absolute;left:${px(x - size * 0.6)};top:${px(y - size * 0.6)};width:${px(size * 1.2)};height:${px(size * 1.2)};border-radius:50%;background:${c};border:${px(W * 0.005)} solid ${ink};box-shadow:${px(W * 0.008)} ${px(W * 0.01)} 0 ${ink}"></div>`);
    } else {
      if (i % 3 === 0) out.push(star5(x, y, size, c, rot, mix(c, '#000000', 0.3)));
      else if (i % 3 === 1) out.push(dots(x, y, W * 0.012, c));
      else out.push(star5(x, y, size * 0.7, '#FCE36A', rot, '#C9A928'));
    }
  });
  // A squiggle arrow in the side gap next to the device, pointing at the screen (only where there is room).
  if (d) {
    const leftGap = d.x;
    const rightGap = W - d.x - d.w;
    const aw = W * 0.2;
    if (Math.max(leftGap, rightGap) >= aw * 0.9) {
      const onLeft = leftGap >= rightGap;
      out.push(curvedArrow(onLeft ? Math.max(W * 0.01, d.x - aw - W * 0.01) : d.x + d.w + W * 0.01, Math.max(d.y, 0) + H * 0.06, aw, H * 0.07, ink, W * 0.008, !onLeft));
    }
  }
  return out;
}

function heart(size: number, color: string): string {
  return `<svg aria-hidden="true" width="${px(size)}" height="${px(size)}" viewBox="0 0 100 100"><path d="M50 88 C20 66 6 50 6 32 C6 18 17 8 30 8 C40 8 47 14 50 22 C53 14 60 8 70 8 C83 8 94 18 94 32 C94 50 80 66 50 88Z" fill="${color}" stroke="#FFFFFF" stroke-width="9" stroke-linejoin="round"/><ellipse cx="32" cy="30" rx="10" ry="6" fill="rgba(255,255,255,.45)" transform="rotate(-30 32 30)"/></svg>`;
}

function dots(x: number, y: number, r: number, color: string): string {
  const pts: Array<[number, number]> = [
    [0, 0],
    [2.6, 0.8],
    [1.2, 2.4],
    [3.8, 3],
    [-0.4, 3.6],
  ];
  return pts.map(([dx, dy]) => `<div data-content style="position:absolute;left:${px(x + dx * r * 1.4 - r)};top:${px(y + dy * r * 1.4 - r)};width:${px(r * 2)};height:${px(r * 2)};border-radius:50%;background:${color}"></div>`).join('');
}

function doodles(ctx: DecorContext, noDevice: boolean, d?: Box): string {
  const { W, H, sf } = ctx;
  const c = sf.accent;
  const sw = W * 0.008;
  const out: string[] = [];
  const asterisk = (x: number, y: number, s: number) =>
    `<svg aria-hidden="true" width="${px(s)}" height="${px(s)}" viewBox="0 0 100 100" style="position:absolute;left:${px(x)};top:${px(y)}"><g stroke="${c}" stroke-width="9" stroke-linecap="round"><path d="M50 8 L50 92"/><path d="M14 30 L86 70"/><path d="M14 70 L86 30"/></g></svg>`;
  if (noDevice) {
    out.push(asterisk(W * 0.84, H * 0.2, W * 0.1), `<div style="position:absolute;left:${px(W * 0.25)};top:${px(H * 0.955)}">${squiggle(W * 0.5, H * 0.03, c, sw, 5)}</div>`);
  } else if (d) {
    const right = d.x + d.w / 2 < W / 2;
    out.push(asterisk(right ? W * 0.84 : W * 0.04, d.y + d.h * 0.08, W * 0.1));
    out.push(`<div style="position:absolute;left:${px(right ? W * 0.7 : W * 0.02)};top:${px(d.y + d.h * 0.45)}">${squiggle(W * 0.26, H * 0.03, c, sw, 9)}</div>`);
    out.push(star5(right ? W * 0.9 : W * 0.1, d.y + d.h * 0.3, W * 0.06, 'none', 8, c));
  }
  return out.join('');
}

// ---------------------------------------------------------------- top structure (above the stage)

/** Preset structure that sits above everything but the caption: index rows, mastheads, wordmarks, tags, seals. */
export function topStructure(ctx: DecorContext): string {
  const { W, H, sf, t } = ctx;
  const out: string[] = [];
  const label = (txt: string, size: number, color: string, extra = '') =>
    `<span style="font-family:var(--label);font-size:${px(size)};font-weight:${t.background === 'magazine' ? 600 : 500};letter-spacing:${t.type.labelTracking}em;text-transform:uppercase;color:${color};white-space:nowrap;${extra}">${esc(txt)}</span>`;
  const n = `${String(ctx.index + 1).padStart(2, '0')} / ${String(ctx.total).padStart(2, '0')}`;
  switch (t.background) {
    case 'swiss': {
      const m = W * 0.0545;
      const y = H * 0.03;
      const size = W * 0.024;
      out.push(`<div data-content class="index-row" style="position:absolute;left:${px(m)};right:${px(m)};top:${px(y)};display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:${px(H * 0.008)};border-bottom:${px(Math.max(1.5, W * 0.0023))} solid ${sf.text}">${label(ctx.appName, size, sf.text)}${label(ctx.kicker || '', size, sf.muted, `position:absolute;left:${px(W * 0.3)}`)}${label(n, size, sf.text)}</div>`);
      break;
    }
    case 'magazine': {
      const m = W * 0.06;
      const size = W * 0.022;
      const rule = (h: number) => `<div style="height:${px(h)};background:${sf.text}"></div>`;
      out.push(`<div data-content class="masthead" style="position:absolute;left:${px(m)};right:${px(m)};top:${px(H * 0.028)}">${rule(Math.max(2, W * 0.0038))}<div style="height:${px(W * 0.005)}"></div>${rule(Math.max(1, W * 0.0012))}
        <div style="display:flex;justify-content:space-between;padding:${px(W * 0.012)} 0">${label(`${ctx.appName} · Nº ${String(ctx.index + 1).padStart(2, '0')}`, size, sf.text)}${label(ctx.kicker || 'Edition', size, sf.accent)}${label(`${ctx.index + 1} / ${ctx.total}`, size, sf.text)}</div>${rule(Math.max(1, W * 0.0012))}</div>`);
      break;
    }
    case 'doodle':
      out.push(`<div data-content style="position:absolute;left:${px(W * 0.07)};top:${px(H * 0.03)};font-family:var(--body);font-weight:500;font-size:${px(Math.min(W, H / 1.9) * 0.04)};letter-spacing:-0.01em;color:${sf.text};text-transform:lowercase">${esc(ctx.appName)}</div>`);
      break;
    case 'candy': {
      const s = Math.min(W, H / 1.9) * 0.04;
      const icon = ctx.icon ? `<img src="${ctx.icon}" style="width:${px(s * 1.5)};height:${px(s * 1.5)};border-radius:${px(s * 0.36)}">` : '';
      out.push(`<div data-content style="position:absolute;left:${px(W * 0.064)};top:${px(H * 0.03)};display:inline-flex;align-items:center;gap:${px(s * 0.4)};padding:${px(s * 0.25)} ${px(s * 0.6)} ${px(s * 0.25)} ${px(s * 0.25)};border-radius:999px;background:#FFFFFF;border:${px(W * 0.004)} solid #16121F;box-shadow:${px(W * 0.006)} ${px(W * 0.007)} 0 #16121F;transform:rotate(-2deg);font-family:var(--body);font-weight:800;font-size:${px(s)};color:#16121F;text-transform:lowercase">${icon}${esc(ctx.appName)}</div>`);
      break;
    }
    case 'poster': {
      // Inside the trim: the app name and the slide number, set in the condensed label face. A device bleeding off
      // the top edge would cut the row, so that slide goes without.
      if (ctx.device && ctx.captionSide === 'bottom') break;
      const m = W * 0.065;
      const size = W * 0.028;
      out.push(`<div data-content class="index-row" style="position:absolute;left:${px(m)};right:${px(m)};top:${px(H * 0.032)};display:flex;justify-content:space-between;align-items:center">${label(ctx.appName, size, sf.text, 'font-weight:700')}<span style="flex:1;height:${px(Math.max(1, W * 0.0026))};background:${sf.rule};margin:0 ${px(W * 0.03)}"></span>${label(`Nº ${String(ctx.index + 1).padStart(2, '0')}`, size, sf.text, 'font-weight:700')}</div>`);
      break;
    }
    case 'gilded': {
      const size = W * 0.024;
      out.push(`<div data-content style="position:absolute;left:0;right:0;top:${px(H * 0.036)};display:flex;justify-content:center;align-items:center;gap:${px(W * 0.025)}"><span style="width:${px(W * 0.07)};height:${px(Math.max(1, W * 0.0022))};background:${withAlpha(sf.accent, 0.7)}"></span>${label(ctx.appName, size, sf.dark ? sf.accent : sf.muted, 'letter-spacing:.34em')}<span style="width:${px(W * 0.07)};height:${px(Math.max(1, W * 0.0022))};background:${withAlpha(sf.accent, 0.7)}"></span></div>`);
      break;
    }
    case 'washi': {
      // One hanko seal (the app's initial) and the kicker set vertically beside the headline.
      const s = W * 0.085;
      const initial = esc([...ctx.appName.trim()][0]?.toUpperCase() ?? '•');
      out.push(`<div data-content style="position:absolute;right:${px(W * 0.07)};top:${px(ctx.caption.y + H * 0.004)};width:${px(s)};height:${px(s)};border-radius:${px(s * 0.16)};background:${sf.accent};transform:rotate(4deg);display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 ${px(s * 0.06)} rgba(255,255,255,.18)"><span style="font-family:var(--headline);font-weight:600;font-size:${px(s * 0.62)};color:#FFF7F0;line-height:1">${initial}</span></div>`);
      if (ctx.kicker) out.push(`<div data-content style="position:absolute;right:${px(W * 0.088)};top:${px(ctx.caption.y + s + H * 0.02)};writing-mode:vertical-rl;font-family:var(--label);font-size:${px(W * 0.024)};letter-spacing:.3em;text-transform:uppercase;color:${sf.muted};border-left:1px solid ${sf.rule};padding-left:${px(W * 0.012)}">${esc(ctx.kicker)}</div>`);
      break;
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- chips (badges)

export interface ChipOptions {
  badge: Badge;
  locale: string;
  t: StyleTokens;
  sf: Surface;
  fontSize: number;
  floating?: boolean;
  rotate?: number;
  style?: string;
}

/** A badge drawn in the preset's material. */
export function ChipView(o: ChipOptions): string {
  const { badge, sf, fontSize: f } = o;
  const label = esc(badge.label[o.locale] ?? '');
  const kind = o.t.badge;
  const iconName = badge.icon ?? defaultIcon(badge);
  const proof = badge.proof;
  const layer = o.floating ? ' data-layer="accent"' : '';
  const rot = o.rotate ? `transform:rotate(${o.rotate}deg);` : '';
  const base = `display:inline-flex;align-items:center;gap:${px(f * 0.45)};white-space:nowrap;font-family:var(--body);font-size:${px(f)};line-height:1.1;${rot}${o.style ?? ''}`;
  const isNew = badge.type === 'new' || badge.style === 'sticker';
  const content = (fg: string) => (badge.type === 'proof' && proof?.kind === 'rating' ? `${Stars(proof.value, f * 1.05, fg)}<span>${label}</span>` : `${lucideIcon(iconName, Math.round(f * 1.15), fg)}<span>${label}</span>`);
  switch (kind) {
    case 'glass':
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};padding:${px(f * 0.75)} ${px(f * 1.1)};border-radius:999px;font-weight:600;color:${sf.chipText};background:linear-gradient(165deg,rgba(255,255,255,.66),rgba(255,255,255,.32) 55%,rgba(255,255,255,.44));backdrop-filter:blur(${px(f * 1.4)}) saturate(185%);-webkit-backdrop-filter:blur(${px(f * 1.4)}) saturate(185%);box-shadow:inset 0 ${px(f * 0.08)} 0 rgba(255,255,255,.95),inset 0 ${px(-f * 0.08)} 0 rgba(70,55,140,.16),0 ${px(f * 1.6)} ${px(f * 3.2)} ${px(-f * 0.7)} ${sf.shadow},0 ${px(f * 0.4)} ${px(f)} rgba(60,48,120,.12)">${content(sf.emphasis[1] ?? sf.chipText)}</div>`;
    case 'darkglass':
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};padding:${px(f * 0.7)} ${px(f * 1)};border-radius:${px(f * 0.9)};font-weight:500;color:${sf.chipText};background:linear-gradient(180deg,rgba(24,26,36,.9),rgba(15,17,24,.84));backdrop-filter:blur(${px(f)}) saturate(140%);box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 0 0 1px rgba(0,0,0,.55),0 ${px(f * 1.6)} ${px(f * 3.2)} ${px(-f * 0.8)} rgba(0,0,0,.85),0 0 ${px(f * 2.4)} ${px(-f * 0.4)} ${withAlpha(sf.accent, 0.3)},inset 0 0 0 1px ${withAlpha(sf.accent, 0.35)}">${content(sf.emphasis[0] ?? sf.accent)}</div>`;
    case 'mono':
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};font-family:var(--label);text-transform:uppercase;letter-spacing:.04em;font-size:${px(f * 0.92)};font-weight:500;padding:${px(f * 0.55)} ${px(f * 0.8)};border:${px(Math.max(1, f * 0.08))} solid ${sf.text};color:${sf.text};background:${sf.bg[0]}">${content(sf.text)}</div>`;
    case 'tile':
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};flex-direction:column;align-items:flex-start;gap:${px(f * 0.6)};padding:${px(f * 0.95)};border-radius:${px(f * 1.2)};background:#FFFFFF;color:${sf.text};font-family:var(--headline);font-weight:700;letter-spacing:-0.02em;font-size:${px(f * 1.12)};box-shadow:0 1px 2px rgba(29,29,31,.04),0 ${px(f * 0.4)} ${px(f)} ${px(-f * 0.6)} rgba(29,29,31,.10)"><span style="display:inline-flex;align-items:center;justify-content:center;width:${px(f * 2.2)};height:${px(f * 2.2)};border-radius:${px(f * 0.64)};background:#F5F5F7">${lucideIcon(iconName, Math.round(f * 1.25), sf.accent)}</span><span>${label}</span></div>`;
    case 'sticker': {
      const ink = '#16121F';
      const bg = isNew ? '#FFE23D' : '#FFFFFF';
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};padding:${px(f * 0.55)} ${px(f * 0.95)};border-radius:999px;font-weight:800;color:${ink};background:${bg};border:${px(f * 0.16)} solid ${ink};box-shadow:${px(f * 0.22)} ${px(f * 0.26)} 0 ${ink};transform:rotate(${o.rotate ?? -3}deg)">${content(ink)}</div>`;
    }
    case 'paper':
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};padding:${px(f * 0.6)} ${px(f * 0.95)};border-radius:${px(f * 0.35)};font-weight:600;color:${sf.chipText};background:${sf.chipBg};box-shadow:0 ${px(f * 0.15)} ${px(f * 0.3)} rgba(40,30,20,.18),0 ${px(f * 0.6)} ${px(f * 1.4)} rgba(40,30,20,.14);transform:rotate(${o.rotate ?? -2}deg)">${content(sf.dark ? sf.chipText : sf.text)}</div>`;
    case 'chip':
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};padding:${px(f * 0.6)} ${px(f * 1)} ${px(f * 0.6)} ${px(f * 0.75)};border-radius:${px(f * 0.6)};font-family:var(--label);text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:${sf.chipText};background:${withAlpha(sf.chipBg.startsWith('#') ? sf.chipBg : '#131519', 0.94)};box-shadow:inset ${px(f * 0.3)} 0 0 ${sf.accent},inset 0 0 0 1px ${sf.rule},0 ${px(f)} ${px(f * 2.4)} rgba(0,0,0,.5)">${content(sf.accent)}</div>`;
    default: {
      const bg = isNew ? sf.accent : sf.chipBg;
      const fg = isNew ? inkOn(sf.accent) : sf.chipText;
      const sticker = badge.style === 'sticker' ? `transform:rotate(-6deg);font-weight:800;` : '';
      return `<div class="badge chip fit-one"${layer} data-type="${badge.type}" style="${base};padding:${px(f * 0.55)} ${px(f * 0.9)};border-radius:999px;font-weight:650;background:${bg};color:${fg};${o.floating || sticker ? `box-shadow:0 ${px(f * 0.5)} ${px(f * 1.4)} rgba(0,0,0,.22);` : ''}${sticker}">${content(fg)}</div>`;
    }
  }
}

export function defaultIcon(b: Badge): string {
  if (b.type === 'new') return 'sparkles';
  if (b.type === 'proof') return b.proof?.kind === 'award' ? 'award' : 'star';
  if (b.type === 'platform') {
    return { ipad: 'tablet', 'apple-watch': 'watch', 'iphone-duo': 'smartphone', mac: 'laptop', vision: 'glasses', widgets: 'layout-grid' }[b.platform ?? 'ipad'] ?? 'smartphone';
  }
  return 'check';
}
