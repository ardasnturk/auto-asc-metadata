/**
 * Device frames drawn in HTML/CSS (no Apple or Google product imagery). Every frame is built from the device's
 * outer width and the raw capture's aspect, so the capture always fills the screen edge to edge. Geometry is
 * exposed separately (`deviceGeometry`) for the layout math and the tests.
 */

export type DeviceFamily = 'iphone' | 'ipad' | 'duo' | 'mac' | 'tv' | 'vision' | 'watch' | 'android-phone' | 'android-tablet';
export type DeviceFinish = 'graphite' | 'titanium' | 'silver' | 'black';

/** Families whose frame stays fully inside the canvas (a cropped TV or watch reads as a mistake). */
export const CONTAINED_FAMILIES: ReadonlySet<DeviceFamily> = new Set(['mac', 'tv', 'vision', 'watch']);

/** Screen aspect (height / width) of fixed-aspect displays; captures are cover-cropped from the top. */
const FIXED_SCREEN_ASPECT: Partial<Record<DeviceFamily, number>> = { mac: 10 / 16, tv: 9 / 16 };

export interface FrameGeometry {
  /** Outer size of the device in CSS px (buttons and straps excluded). */
  width: number;
  height: number;
  /** Screen rectangle relative to the device's top-left corner. */
  screen: { x: number; y: number; w: number; h: number; r: number };
  /** Outer corner radius. */
  radius: number;
}

export interface FrameVariant {
  /** iPhone Duo display. */
  duo?: 'outer' | 'inner';
  /** Mac: MacBook (default) or a bare macOS window. */
  mac?: 'laptop' | 'window';
  /** Apple TV: TV with bezel (default) or the full-bleed picture. */
  tv?: 'bezel' | 'bare';
}

/** Border (bezel + frame band) per family as a share of the outer width. */
function border(family: DeviceFamily, v: FrameVariant): number {
  switch (family) {
    case 'iphone':
      return 0.041;
    case 'android-phone':
      return 0.03;
    case 'ipad':
      return 0.042;
    case 'android-tablet':
      return 0.036;
    case 'duo':
      return v.duo === 'inner' ? 0.024 : 0.034;
    case 'watch':
      return 0.085;
    case 'tv':
      return v.tv === 'bare' ? 0 : 0.011;
    case 'vision':
      return 0;
    case 'mac':
      return 0;
  }
}

/** Display corner radius as a share of the screen width. */
function screenRadius(family: DeviceFamily, v: FrameVariant): number {
  switch (family) {
    case 'iphone':
      return 0.128;
    case 'android-phone':
      return 0.085;
    case 'ipad':
      return 0.03;
    case 'android-tablet':
      return 0.032;
    case 'duo':
      return v.duo === 'inner' ? 0.045 : 0.085;
    case 'watch':
      return 0.2;
    case 'tv':
      return 0.003;
    case 'vision':
      return 0.032;
    case 'mac':
      return 0.004;
  }
}

/**
 * Outer geometry of a device whose outer width is `width`. `aspect` is the capture's height / width; fixed-aspect
 * displays (Mac, TV) ignore it. Mac laptops add the lid bezel and the base below the screen.
 */
export function deviceGeometry(family: DeviceFamily, width: number, aspect: number, v: FrameVariant = {}): FrameGeometry {
  if (family === 'mac') {
    if (v.mac === 'window') {
      const bar = width * 0.034;
      const sh = width * (FIXED_SCREEN_ASPECT.mac ?? 0.625);
      return { width, height: sh + bar, screen: { x: 0, y: bar, w: width, h: sh, r: 0 }, radius: width * 0.011 };
    }
    // Laptop: lid is 86 % of the base width; bezel 1.4 % sides, 2.6 % top, 4.4 % chin; base slab 3.2 %.
    const lid = width * 0.86;
    const side = lid * 0.022;
    const top = lid * 0.03;
    const sw = lid - side * 2;
    const sh = sw * 0.625;
    const chin = lid * 0.024;
    const base = width * 0.034;
    return { width, height: top + sh + chin + base, screen: { x: (width - lid) / 2 + side, y: top, w: sw, h: sh, r: lid * 0.006 }, radius: lid * 0.028 };
  }
  const b = width * border(family, v);
  const sw = width - b * 2;
  const sh = sw * (FIXED_SCREEN_ASPECT[family] ?? aspect);
  const sr = sw * screenRadius(family, v);
  return { width, height: sh + b * 2, screen: { x: b, y: b, w: sw, h: sh, r: sr }, radius: sr + b * (family === 'watch' ? 1.25 : 1) };
}

/** Outer width that gives a device of `height`. */
export function widthForHeight(family: DeviceFamily, height: number, aspect: number, v: FrameVariant = {}): number {
  const probe = deviceGeometry(family, 1000, aspect, v);
  return (height / probe.height) * 1000;
}

export interface DeviceOptions {
  family: DeviceFamily;
  /** Outer width in CSS px. */
  width: number;
  /** Raw capture aspect (height / width). */
  aspect: number;
  src: string;
  finish?: DeviceFinish;
  variant?: FrameVariant;
  /** CSS filter for the drop shadow (tinted by the style); empty for none. */
  shadow?: string;
  /** Rim light color behind the device (Midnight, Neon). */
  rim?: string;
  tilt?: number;
  /** Frameless: the capture alone with display corners (fullbleed, mosaics). */
  frameless?: boolean;
  dim?: boolean;
  style?: string;
  className?: string;
}

const FINISH: Record<DeviceFinish, { band: string; edge: string; button: string }> = {
  graphite: { band: 'linear-gradient(90deg,#2A2C31 0%,#5A5D64 4%,#33353A 9%,#26282C 50%,#33353A 91%,#5A5D64 96%,#2A2C31 100%)', edge: 'rgba(255,255,255,.16)', button: 'linear-gradient(90deg,#1E1F23,#4A4C52 55%,#2A2C31)' },
  titanium: { band: 'linear-gradient(90deg,#6E6A64 0%,#BDB7AE 4%,#8C877F 10%,#77736C 50%,#8C877F 90%,#BDB7AE 96%,#6E6A64 100%)', edge: 'rgba(255,255,255,.35)', button: 'linear-gradient(90deg,#6B675F,#C2BCB2 55%,#7C776F)' },
  silver: { band: 'linear-gradient(90deg,#A9ACB1 0%,#E9EBEE 4%,#C3C6CB 10%,#B5B8BD 50%,#C3C6CB 90%,#E9EBEE 96%,#A9ACB1 100%)', edge: 'rgba(255,255,255,.6)', button: 'linear-gradient(90deg,#A4A7AC,#F0F1F3 55%,#B3B6BB)' },
  black: { band: 'linear-gradient(90deg,#111214 0%,#3A3C41 4%,#1A1B1E 9%,#141517 50%,#1A1B1E 91%,#3A3C41 96%,#111214 100%)', edge: 'rgba(255,255,255,.12)', button: 'linear-gradient(90deg,#0E0F11,#3A3C41 55%,#17181B)' },
};

const r = (n: number) => Math.round(n * 10) / 10;

function screenImg(o: DeviceOptions, g: FrameGeometry, extra = ''): string {
  const fixed = o.family === 'mac' || o.family === 'tv';
  const filter = o.dim ? 'filter:saturate(.35) brightness(.85);' : '';
  return `<!--screen--><div class="screen" style="position:absolute;left:${r(g.screen.x)}px;top:${r(g.screen.y)}px;width:${r(g.screen.w)}px;height:${r(g.screen.h)}px;border-radius:${r(g.screen.r)}px;overflow:hidden;background:#000;">
    <!--media--><img src="${o.src}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:${fixed ? 'top' : 'top center'};${filter}"><!--/media-->
    <div style="position:absolute;inset:0;border-radius:inherit;background:linear-gradient(118deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,.03) 22%,rgba(255,255,255,0) 38%);pointer-events:none"></div>${extra}
  </div><!--/screen-->`;
}

/** A side button: `side` left/right, `top`/`h` in px of the device height. */
function button(side: 'left' | 'right' | 'top', at: number, len: number, thick: number, fill: string): string {
  if (side === 'top') return `<div style="position:absolute;top:${r(-thick)}px;left:${r(at)}px;width:${r(len)}px;height:${r(thick + 1)}px;border-radius:${r(thick)}px ${r(thick)}px 0 0;background:${fill}"></div>`;
  const rad = side === 'left' ? `${r(thick)}px 0 0 ${r(thick)}px` : `0 ${r(thick)}px ${r(thick)}px 0`;
  return `<div style="position:absolute;${side}:${r(-thick)}px;top:${r(at)}px;width:${r(thick + 1)}px;height:${r(len)}px;border-radius:${rad};background:${fill}"></div>`;
}

function rimLight(o: DeviceOptions, g: FrameGeometry): string {
  if (!o.rim) return '';
  return `<div aria-hidden="true" style="position:absolute;inset:${r(-g.width * 0.006)}px;border-radius:${r(g.radius * 1.05)}px;background:${o.rim};opacity:.55;filter:blur(${r(g.width * 0.045)}px)"></div>
  <div aria-hidden="true" style="position:absolute;inset:${r(-g.width * 0.04)}px;border-radius:${r(g.radius * 1.4)}px;background:${o.rim};opacity:.28;filter:blur(${r(g.width * 0.16)}px)"></div>`;
}

function wrap(o: DeviceOptions, g: FrameGeometry, inner: string, extraHeight = 0): string {
  const transform = o.tilt ? `transform:rotate(${o.tilt}deg);` : '';
  const shadow = o.shadow ? `filter:${o.shadow};` : '';
  return `<div class="device ${o.className ?? ''}" data-family="${o.family}" style="position:absolute;width:${r(g.width)}px;height:${r(g.height + extraHeight)}px;${transform}${o.style ?? ''}">
  ${rimLight(o, g)}<div style="position:absolute;inset:0;${shadow}">${inner}</div>
</div>`;
}

function iphone(o: DeviceOptions, g: FrameGeometry): string {
  const f = FINISH[o.finish ?? 'graphite'];
  const W = g.width;
  const H = g.height;
  const band = W * 0.011;
  const sw = g.screen.w;
  const islandW = sw * 0.29;
  const islandH = sw * 0.085;
  const island = `<div style="position:absolute;left:50%;top:${r(sw * 0.026)}px;transform:translateX(-50%);width:${r(islandW)}px;height:${r(islandH)}px;border-radius:999px;background:#000;">
      <div style="position:absolute;right:${r(islandH * 0.28)}px;top:50%;transform:translateY(-50%);width:${r(islandH * 0.42)}px;height:${r(islandH * 0.42)}px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#2B3550 0%,#0B0E18 55%,#000 100%);box-shadow:inset 0 0 0 ${r(islandH * 0.05)}px #111522"></div></div>`;
  const t = Math.max(1.2, W * 0.007);
  const buttons = [
    button('left', H * 0.15, H * 0.038, t, f.button),
    button('left', H * 0.215, H * 0.064, t, f.button),
    button('left', H * 0.295, H * 0.064, t, f.button),
    button('right', H * 0.25, H * 0.1, t, f.button),
    button('right', H * 0.56, H * 0.055, t * 0.7, f.button),
  ].join('');
  return wrap(
    o,
    g,
    `${buttons}<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px;background:${f.band};box-shadow:inset 0 0 0 ${r(Math.max(0.6, W * 0.0025))}px ${f.edge}"></div>
  <div style="position:absolute;inset:${r(band)}px;border-radius:${r(g.radius - band)}px;background:#050506;box-shadow:inset 0 0 ${r(W * 0.006)}px rgba(255,255,255,.08)"></div>
  ${screenImg(o, g, island)}`,
  );
}

function androidPhone(o: DeviceOptions, g: FrameGeometry): string {
  const f = FINISH[o.finish === 'titanium' ? 'silver' : (o.finish ?? 'black')];
  const W = g.width;
  const H = g.height;
  const band = W * 0.009;
  const hole = g.screen.w * 0.036;
  const camera = `<div style="position:absolute;left:50%;top:${r(g.screen.w * 0.03)}px;transform:translateX(-50%);width:${r(hole)}px;height:${r(hole)}px;border-radius:50%;background:radial-gradient(circle at 38% 38%,#27304A 0%,#05070C 60%);box-shadow:0 0 0 ${r(hole * 0.12)}px #000"></div>`;
  const t = Math.max(1.2, W * 0.007);
  const buttons = [button('right', H * 0.2, H * 0.07, t, f.button), button('right', H * 0.31, H * 0.12, t, f.button)].join('');
  // Flat aluminium edge, a uniform thin bezel and a centred punch-hole camera (Material hardware cues).
  return wrap(
    o,
    g,
    `${buttons}<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px;background:${f.band};box-shadow:inset 0 0 0 ${r(Math.max(0.6, W * 0.002))}px ${f.edge}"></div>
  <div style="position:absolute;inset:${r(band)}px;border-radius:${r(g.radius - band)}px;background:#060607"></div>
  ${screenImg(o, g, camera)}`,
  );
}

function tablet(o: DeviceOptions, g: FrameGeometry, android: boolean): string {
  const f = FINISH[o.finish ?? (android ? 'black' : 'graphite')];
  const W = g.width;
  const H = g.height;
  const band = W * 0.006;
  const cam = W * 0.008;
  // iPad Pro puts the front camera on the landscape edge (right bezel in portrait); Android tablets centre it on top.
  const camera = android
    ? `<div style="position:absolute;left:50%;top:${r(g.screen.y / 2 - cam / 2)}px;transform:translateX(-50%);width:${r(cam)}px;height:${r(cam)}px;border-radius:50%;background:#1A1E2A"></div>`
    : `<div style="position:absolute;right:${r(g.screen.x / 2 - cam / 2)}px;top:${r(H / 2 - cam / 2)}px;width:${r(cam)}px;height:${r(cam)}px;border-radius:50%;background:#1A1E2A;box-shadow:0 0 0 ${r(cam * 0.25)}px #0B0C10"></div>`;
  const t = Math.max(1.2, W * 0.004);
  const buttons = android ? button('right', H * 0.12, H * 0.05, t, f.button) + button('right', H * 0.19, H * 0.09, t, f.button) : button('top', W * 0.78, W * 0.07, t, f.button) + button('right', H * 0.06, H * 0.045, t, f.button) + button('right', H * 0.115, H * 0.045, t, f.button);
  return wrap(
    o,
    g,
    `${buttons}<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px;background:${f.band};box-shadow:inset 0 0 0 ${r(Math.max(0.6, W * 0.0015))}px ${f.edge}"></div>
  <div style="position:absolute;inset:${r(band)}px;border-radius:${r(g.radius - band)}px;background:#060607"></div>
  ${camera}${screenImg(o, g)}`,
  );
}

function duo(o: DeviceOptions, g: FrameGeometry): string {
  const f = FINISH[o.finish ?? 'graphite'];
  const W = g.width;
  const H = g.height;
  const band = W * 0.008;
  const inner = o.variant?.duo === 'inner';
  const m = Math.min(g.screen.w, g.screen.h);
  // The outer display's front camera sits in the screen's top-right corner; the app lays its UI around it.
  const camera = inner ? '' : `<div style="position:absolute;top:${r(m * 0.034)}px;right:${r(m * 0.034)}px;width:${r(m * 0.05)}px;height:${r(m * 0.05)}px;border-radius:50%;background:radial-gradient(circle at 38% 38%,#27304A,#04060B 62%)"></div>`;
  // Open (inner display): the book-style fold leaves a faint crease down the middle of the screen.
  const crease = inner ? `<div aria-hidden="true" style="position:absolute;top:0;bottom:0;left:50%;width:${r(Math.max(2, g.screen.w * 0.012))}px;transform:translateX(-50%);background:linear-gradient(90deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.10) 35%,rgba(255,255,255,.10) 50%,rgba(0,0,0,.10) 65%,rgba(0,0,0,0) 100%);pointer-events:none"></div>` : '';
  const t = Math.max(1.2, W * 0.006);
  const buttons = button('right', H * 0.2, H * 0.08, t, f.button) + button('right', H * 0.32, H * 0.1, t, f.button);
  return wrap(
    o,
    g,
    `${buttons}<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px;background:${f.band};box-shadow:inset 0 0 0 ${r(Math.max(0.6, W * 0.002))}px ${f.edge}"></div>
  <div style="position:absolute;inset:${r(band)}px;border-radius:${r(g.radius - band)}px;background:#050506"></div>
  ${screenImg(o, g, camera + crease)}`,
  );
}

function watch(o: DeviceOptions, g: FrameGeometry): string {
  const W = g.width;
  const H = g.height;
  const finish = o.finish === 'silver' || o.finish === 'titanium' ? 'titanium' : 'black';
  const caseFill = finish === 'titanium' ? 'linear-gradient(145deg,#D9D4CB 0%,#9C978E 35%,#7D786F 65%,#BDB7AD 100%)' : 'linear-gradient(145deg,#4A4C52 0%,#1D1E21 40%,#101113 70%,#3A3C41 100%)';
  const strapW = W * 0.74;
  const strapH = H * 0.32;
  const strap = (top: boolean) =>
    `<div style="position:absolute;left:${r((W - strapW) / 2)}px;${top ? `bottom:${r(H - H * 0.06)}px` : `top:${r(H - H * 0.06)}px`};width:${r(strapW)}px;height:${r(strapH)}px;border-radius:${top ? `${r(W * 0.06)}px ${r(W * 0.06)}px 0 0` : `0 0 ${r(W * 0.06)}px ${r(W * 0.06)}px`};background:linear-gradient(90deg,#1B1C20,#33353B 50%,#1B1C20);-webkit-mask-image:linear-gradient(${top ? 'to top' : 'to bottom'},#000 55%,transparent 100%)"></div>`;
  const crown = `<div style="position:absolute;right:${r(-W * 0.055)}px;top:${r(H * 0.26)}px;width:${r(W * 0.07)}px;height:${r(H * 0.15)}px;border-radius:${r(W * 0.02)}px;background:repeating-linear-gradient(180deg,#8E8E93 0 ${r(Math.max(1, H * 0.008))}px,#5A5A5E ${r(Math.max(1, H * 0.008))}px ${r(Math.max(2, H * 0.016))}px);box-shadow:inset 0 0 0 1px rgba(0,0,0,.3)"></div>
    <div style="position:absolute;right:${r(-W * 0.026)}px;top:${r(H * 0.52)}px;width:${r(W * 0.04)}px;height:${r(H * 0.17)}px;border-radius:${r(W * 0.02)}px;background:linear-gradient(90deg,#3A3C41,#77797F)"></div>
    <div style="position:absolute;left:${r(-W * 0.03)}px;top:${r(H * 0.3)}px;width:${r(W * 0.04)}px;height:${r(H * 0.12)}px;border-radius:${r(W * 0.02)}px;background:linear-gradient(90deg,#E35A1F,#F08A4B)"></div>`;
  return wrap(
    o,
    g,
    `${strap(true)}${strap(false)}${crown}<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px / ${r(g.radius * 1.05)}px;background:${caseFill};box-shadow:inset 0 0 0 ${r(W * 0.004)}px rgba(255,255,255,.25)"></div>
  <div style="position:absolute;inset:${r(W * 0.028)}px;border-radius:${r(g.radius - W * 0.028)}px;background:#020203"></div>
  ${screenImg(o, g)}`,
  );
}

function tv(o: DeviceOptions, g: FrameGeometry): string {
  if (o.variant?.tv === 'bare') return wrap(o, g, screenImg(o, g));
  const W = g.width;
  const H = g.height;
  const stand = `<div style="position:absolute;left:${r(W * 0.43)}px;top:${r(H)}px;width:${r(W * 0.14)}px;height:${r(H * 0.05)}px;background:linear-gradient(180deg,#2C2D31,#121316)"></div>
    <div style="position:absolute;left:${r(W * 0.36)}px;top:${r(H * 1.045)}px;width:${r(W * 0.28)}px;height:${r(H * 0.016)}px;border-radius:${r(W * 0.004)}px;background:linear-gradient(180deg,#3A3B40,#141518)"></div>`;
  return wrap(
    o,
    g,
    `${stand}<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px;background:linear-gradient(180deg,#1C1D20,#0B0B0D);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)"></div>${screenImg(o, g)}`,
    H * 0.065,
  );
}

function mac(o: DeviceOptions, g: FrameGeometry): string {
  const W = g.width;
  if (o.variant?.mac === 'window') {
    const bar = g.screen.y;
    const dot = (c: string, i: number) => `<span style="position:absolute;left:${r(bar * 0.6 + i * bar * 0.55)}px;top:${r(bar / 2 - bar * 0.17)}px;width:${r(bar * 0.34)}px;height:${r(bar * 0.34)}px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.25)"></span>`;
    return wrap(
      o,
      g,
      `<div style="position:absolute;inset:0;border-radius:${r(g.radius)}px;overflow:hidden;background:#1C1C1E;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)">
      <div style="position:absolute;left:0;top:0;right:0;height:${r(bar)}px;background:linear-gradient(180deg,#3D3D40,#323235);box-shadow:inset 0 -1px 0 rgba(0,0,0,.35)">${dot('#FF5F57', 0)}${dot('#FEBC2E', 1)}${dot('#28C840', 2)}</div>
    </div>${screenImg(o, g)}`,
    );
  }
  const lid = W * 0.86;
  const lidLeft = (W - lid) / 2;
  const lidH = g.screen.y + g.screen.h + lid * 0.024;
  const baseH = g.height - lidH;
  const alu = o.finish === 'black' || o.finish === 'graphite' ? ['#2E3033', '#4A4D52', '#1F2124'] : ['#BFC2C7', '#E6E8EB', '#9EA1A6'];
  return wrap(
    o,
    g,
    `<div style="position:absolute;left:${r(lidLeft)}px;top:0;width:${r(lid)}px;height:${r(lidH)}px;border-radius:${r(g.radius)}px ${r(g.radius)}px ${r(lid * 0.006)}px ${r(lid * 0.006)}px;background:${alu[0]};box-shadow:inset 0 0 0 ${r(Math.max(0.8, lid * 0.0018))}px ${alu[1]}"></div>
  <div style="position:absolute;left:${r(lidLeft + lid * 0.004)}px;top:${r(lid * 0.004)}px;width:${r(lid * 0.992)}px;height:${r(lidH - lid * 0.008)}px;border-radius:${r(g.radius * 0.9)}px ${r(g.radius * 0.9)}px ${r(lid * 0.004)}px ${r(lid * 0.004)}px;background:#050506"></div>
  <div style="position:absolute;left:0;top:${r(lidH)}px;width:${r(W)}px;height:${r(baseH)}px;border-radius:${r(baseH * 0.2)}px ${r(baseH * 0.2)}px ${r(baseH * 0.9)}px ${r(baseH * 0.9)}px / ${r(baseH * 0.2)}px ${r(baseH * 0.2)}px ${r(baseH * 0.7)}px ${r(baseH * 0.7)}px;background:linear-gradient(180deg,${alu[1]} 0%,${alu[0]} 35%,${alu[2]} 100%)"></div>
  <div style="position:absolute;left:${r(W * 0.43)}px;top:${r(lidH)}px;width:${r(W * 0.14)}px;height:${r(baseH * 0.4)}px;border-radius:0 0 ${r(baseH * 0.4)}px ${r(baseH * 0.4)}px;background:${alu[2]};opacity:.55"></div>
  ${screenImg(o, g)}`,
  );
}

function vision(o: DeviceOptions, g: FrameGeometry): string {
  const W = g.width;
  const H = g.height;
  // A visionOS window: glass rim, soft environment shadow and the window grabber under it.
  const grab = `<div style="position:absolute;left:${r(W * 0.44)}px;top:${r(H + W * 0.016)}px;width:${r(W * 0.12)}px;height:${r(W * 0.009)}px;border-radius:999px;background:rgba(255,255,255,.78);box-shadow:0 2px 6px rgba(0,0,0,.25)"></div>
    <div style="position:absolute;left:${r(W * 0.405)}px;top:${r(H + W * 0.013)}px;width:${r(W * 0.016)}px;height:${r(W * 0.016)}px;border-radius:50%;background:rgba(255,255,255,.55)"></div>`;
  return wrap(
    o,
    g,
    `${grab}<div style="position:absolute;inset:${r(-W * 0.004)}px;border-radius:${r(g.radius + W * 0.004)}px;background:linear-gradient(150deg,rgba(255,255,255,.75),rgba(255,255,255,.15) 40%,rgba(255,255,255,.35));"></div>${screenImg(o, g)}`,
    W * 0.03,
  );
}

function frameless(o: DeviceOptions, g: FrameGeometry): string {
  return wrap(o, g, screenImg(o, g));
}

/** HTML for one device frame, chosen by family. */
export function DeviceFrame(o: DeviceOptions): string {
  const g = deviceGeometry(o.family, o.width, o.aspect, o.variant);
  if (o.frameless) {
    const sr = o.width * screenRadius(o.family, o.variant ?? {});
    const h = o.width * (FIXED_SCREEN_ASPECT[o.family] ?? o.aspect);
    return frameless(o, { width: o.width, height: h, screen: { x: 0, y: 0, w: o.width, h, r: sr }, radius: sr });
  }
  switch (o.family) {
    case 'iphone':
      return iphone(o, g);
    case 'android-phone':
      return androidPhone(o, g);
    case 'ipad':
      return tablet(o, g, false);
    case 'android-tablet':
      return tablet(o, g, true);
    case 'duo':
      return duo(o, g);
    case 'watch':
      return watch(o, g);
    case 'tv':
      return tv(o, g);
    case 'mac':
      return mac(o, g);
    case 'vision':
      return vision(o, g);
  }
}

/**
 * Frame markup for Remotion: the shell without the screen content, rendered at a reference width. The video
 * package scales it and drops the recording into `screen`.
 */
export function frameShell(family: DeviceFamily, aspect: number, opts: { finish?: DeviceFinish; variant?: FrameVariant; refWidth?: number } = {}): FrameShell {
  const width = opts.refWidth ?? 1000;
  const g = deviceGeometry(family, width, aspect, opts.variant);
  const html = DeviceFrame({ family, width, aspect, src: '', finish: opts.finish, variant: opts.variant });
  const start = html.indexOf('<!--screen-->');
  const end = html.indexOf('<!--/screen-->') + '<!--/screen-->'.length;
  const screen = html.slice(start, end);
  // `under` is the body and bezel; the media goes between; `over` keeps glare, island and camera above it.
  const under = html.slice(0, start) + html.slice(end);
  const over = screen.replace(/<!--media-->[\s\S]*?<!--\/media-->/, '').replace('background:#000;', 'background:transparent;');
  return { under, over, width: g.width, height: g.height, screen: g.screen };
}

export interface FrameShell {
  under: string;
  over: string;
  width: number;
  height: number;
  screen: FrameGeometry['screen'];
}
