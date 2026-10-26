import type { Badge, Palette } from '@vitrin/schemas';
import { lucideIcon } from './assets.js';
import { mix, withAlpha } from './color.js';

/** The parts of a direction the legacy components read. */
export interface PaletteDirection {
  palette: Palette;
  background?: { style: string; angle: number; intensity: number };
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Background layer. `panorama` = { index, total } shifts a shared canvas so consecutive shots connect. */
export function Background(ad: PaletteDirection & { background: { style: string; angle: number; intensity: number } }, w: number, h: number, panorama?: { index: number; total: number }): string {
  const c0 = ad.palette.background[0]!;
  const c1 = ad.palette.background[1] ?? c0;
  const c2 = ad.palette.background[2] ?? c1;
  const k = ad.background.intensity;
  const style = ad.background.style;
  let css = '';
  let deco = '';
  switch (style) {
    case 'solid':
      css = `background:${c0};`;
      break;
    case 'linear':
      css = `background:linear-gradient(${ad.background.angle}deg, ${c0} 0%, ${c1} 60%, ${c2} 100%);`;
      break;
    case 'radial':
      css = `background:radial-gradient(120% 80% at 20% 10%, ${c1} 0%, ${c0} 65%);`;
      break;
    case 'mesh':
      css = `background:${c0};`;
      deco = `<div class="mesh" style="position:absolute;inset:-10%;filter:blur(${Math.round(w * 0.08)}px);opacity:${0.55 + 0.45 * k};
        background:
          radial-gradient(40% 35% at 15% 20%, ${c1} 0%, transparent 70%),
          radial-gradient(45% 40% at 90% 35%, ${c2} 0%, transparent 70%),
          radial-gradient(50% 40% at 40% 95%, ${mix(c1, c2, 0.5)} 0%, transparent 70%);"></div>`;
      break;
    case 'grid': {
      const step = Math.round(w / 12);
      const line = withAlpha(ad.palette.text, 0.05 + 0.08 * k);
      css = `background:linear-gradient(${ad.background.angle}deg, ${c0}, ${c1});`;
      deco = `<div style="position:absolute;inset:0;background-image:linear-gradient(${line} 1px, transparent 1px),linear-gradient(90deg, ${line} 1px, transparent 1px);background-size:${step}px ${step}px;-webkit-mask-image:linear-gradient(to bottom, black 0%, transparent 85%);"></div>`;
      break;
    }
    case 'dots': {
      const step = Math.round(w / 18);
      const dot = withAlpha(ad.palette.text, 0.08 + 0.12 * k);
      css = `background:linear-gradient(${ad.background.angle}deg, ${c0}, ${c1});`;
      deco = `<div style="position:absolute;inset:0;background-image:radial-gradient(${dot} 1.2px, transparent 1.6px);background-size:${step}px ${step}px;"></div>`;
      break;
    }
    case 'panoramic': {
      const idx = panorama?.index ?? 0;
      const total = Math.max(panorama?.total ?? 1, 1);
      const W = w * total;
      // A continuous band of soft shapes laid out over the full strip; each shot shows its slice.
      const blobs: string[] = [];
      for (let i = 0; i < total * 2 + 1; i++) {
        const x = (i / (total * 2)) * W;
        const y = h * (0.25 + 0.5 * ((i * 37) % 10) / 10);
        const r = w * (0.45 + 0.25 * ((i * 53) % 7) / 7);
        const col = i % 2 ? c1 : c2;
        blobs.push(`<div style="position:absolute;left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${col};opacity:${0.35 + 0.4 * k};"></div>`);
      }
      const ribbonY = h * 0.62;
      css = `background:${c0};`;
      deco = `<div style="position:absolute;top:0;left:${-idx * w}px;width:${W}px;height:${h}px;filter:blur(${Math.round(w * 0.06)}px);">${blobs.join('')}</div>
        <svg style="position:absolute;top:0;left:${-idx * w}px" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}"><path d="M0 ${ribbonY} C ${W * 0.25} ${ribbonY - h * 0.18}, ${W * 0.5} ${ribbonY + h * 0.18}, ${W * 0.75} ${ribbonY - h * 0.08} S ${W} ${ribbonY}, ${W} ${ribbonY}" stroke="${withAlpha(ad.palette.accent, 0.55)}" stroke-width="${w * 0.018}" fill="none" stroke-linecap="round"/></svg>`;
      break;
    }
  }
  return `<div class="bg" style="position:absolute;inset:0;overflow:hidden;${css}">${deco}</div>`;
}

export interface BadgeRenderOptions {
  badge: Badge;
  locale: string;
  ad: PaletteDirection;
  fontSize: number;
  floating?: boolean;
  style?: string;
}

export function BadgeView(o: BadgeRenderOptions): string {
  const { badge, ad, fontSize } = o;
  if (badge.style === 'laurel') return LaurelBadge(o);
  const label = badge.label[o.locale] ?? '';
  const sticker = badge.style === 'sticker';
  const isNew = badge.type === 'new' || sticker;
  const bg = isNew ? ad.palette.accent : ad.palette.badgeBackground;
  const fg = isNew ? pickTextOn(ad.palette.accent, ad) : ad.palette.badgeText;
  const iconName = badge.icon ?? defaultIcon(badge);
  let inner = `${lucideIcon(iconName, Math.round(fontSize * 1.15), fg)}<span>${esc(label)}</span>`;
  const proof = badge.proof;
  if (badge.type === 'proof' && proof?.kind === 'rating') inner = `${Stars(proof.value, fontSize * 1.05, fg)}<span>${esc(label)}</span>`;
  const shadow = o.floating || sticker ? `box-shadow:0 ${fontSize * 0.5}px ${fontSize * 1.4}px rgba(0,0,0,.22);` : '';
  // Sticker: heavier, slightly rotated — the "150M+ downloads" / "90% compatibility" look.
  const extra = sticker ? `transform:rotate(-6deg);font-weight:800;font-size:${fontSize * 1.15}px;padding:${fontSize * 0.6}px ${fontSize}px;border-radius:${fontSize * 0.6}px;` : '';
  return `<div class="badge fit-one" data-type="${badge.type}" style="display:inline-flex;align-items:center;gap:${fontSize * 0.45}px;padding:${fontSize * 0.5}px ${fontSize * 0.85}px;border-radius:999px;background:${bg};color:${fg};font-size:${fontSize}px;font-weight:650;line-height:1.1;white-space:nowrap;${shadow}${extra}${o.style ?? ''}">${inner}</div>`;
}

export function Stars(value: number, size: number, color: string): string {
  const stars = Array.from({ length: 5 }, (_, i) => lucideIcon('star', Math.round(size), color).replace('fill="none"', `fill="${i + 0.5 <= value ? color : 'none'}"`)).join('');
  return `<span style="display:inline-flex;gap:${size * 0.12}px">${stars}</span>`;
}

/** One laurel branch as inline SVG (mirrored for the right side). */
function laurelBranch(height: number, color: string, mirror: boolean): string {
  const leaves = Array.from({ length: 6 }, (_, i) => {
    const t = i / 5;
    const y = 88 - t * 72;
    const x = 30 - Math.sin(t * Math.PI * 0.9) * 14;
    const angle = -35 - t * 25;
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="4.2" transform="rotate(${angle.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${color}"/>
      <ellipse cx="${(x + 9).toFixed(1)}" cy="${(y - 4).toFixed(1)}" rx="8" ry="3.8" transform="rotate(${(angle + 70).toFixed(0)} ${(x + 9).toFixed(1)} ${(y - 4).toFixed(1)})" fill="${color}"/>`;
  }).join('');
  const stem = `<path d="M34 96 C 18 70, 18 40, 30 10" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  return `<svg width="${(height * 0.45).toFixed(0)}" height="${height}" viewBox="0 0 45 100" aria-hidden="true" style="flex:none;${mirror ? 'transform:scaleX(-1);' : ''}">${stem}${leaves}</svg>`;
}

/**
 * Proof/award between two laurel branches: big value on top, small label under it.
 * Only for verifiable proof (validate checks the rating against iTunes Lookup).
 */
export function LaurelBadge(o: BadgeRenderOptions): string {
  const { badge, ad, fontSize } = o;
  const color = ad.palette.text;
  const proof = badge.proof;
  const big = proof?.kind === 'rating' ? proof.value.toLocaleString(o.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : esc(badge.label[o.locale] ?? '');
  const small = proof?.kind === 'rating' ? `${Stars(proof.value, fontSize * 0.8, color)}<div>${esc(badge.label[o.locale] ?? '')}</div>` : proof?.kind === 'award' ? esc(`${proof.name} ${proof.year}`) : '';
  return `<div class="badge laurel fit-one" data-type="${badge.type}" style="display:inline-flex;align-items:center;gap:${fontSize * 0.3}px;color:${color};white-space:nowrap;${o.style ?? ''}">
  ${laurelBranch(fontSize * 4.2, color, false)}
  <div style="display:flex;flex-direction:column;align-items:center;gap:${fontSize * 0.2}px;text-align:center">
    <div style="font-family:var(--headline);font-weight:800;font-size:${fontSize * 1.9}px;line-height:1">${big}</div>
    <div style="font-size:${fontSize * 0.8}px;font-weight:600;line-height:1.2;opacity:.9;display:flex;flex-direction:column;align-items:center;gap:${fontSize * 0.15}px">${small}</div>
  </div>
  ${laurelBranch(fontSize * 4.2, color, true)}
</div>`;
}

/** Card with a verbatim App Store review (stars, quote, optional author). */
export function QuoteCard(o: { text: string; rating: number; author?: string; ad: PaletteDirection; fontSize: number; width: number; style?: string }): string {
  const { ad, fontSize } = o;
  return `<div class="quote" style="width:${o.width}px;box-sizing:border-box;padding:${fontSize * 1.1}px ${fontSize * 1.2}px;border-radius:${fontSize * 1.1}px;background:${ad.palette.badgeBackground};color:${ad.palette.badgeText};box-shadow:0 ${fontSize * 0.6}px ${fontSize * 2}px rgba(0,0,0,.22);${o.style ?? ''}">
  ${Stars(o.rating, fontSize * 0.95, ad.palette.accent)}
  <div style="margin-top:${fontSize * 0.5}px;font-size:${fontSize}px;font-weight:600;line-height:1.3">“${esc(o.text)}”</div>
  ${o.author ? `<div style="margin-top:${fontSize * 0.4}px;font-size:${fontSize * 0.75}px;opacity:.7">— ${esc(o.author)}</div>` : ''}
</div>`;
}

/** Magnified crop of a real screen region, drawn as a floating card. */
export function CalloutCard(o: { src: string; rect: { x: number; y: number; w: number; h: number }; rawAspect: number; width: number; radius: number; style?: string; className?: string }): string {
  // The crop box keeps the region's own aspect; the full image is scaled so the region fills the box.
  const regionAspect = (o.rect.h * o.rawAspect) / o.rect.w;
  const boxH = Math.round(o.width * regionAspect);
  const imgW = o.width / o.rect.w;
  const imgH = imgW * o.rawAspect;
  return `<div class="callout ${o.className ?? ''}" style="position:absolute;width:${Math.round(o.width)}px;height:${boxH}px;overflow:hidden;border-radius:${o.radius}px;box-shadow:0 ${o.width * 0.05}px ${o.width * 0.14}px rgba(0,0,0,.35), 0 0 0 ${Math.max(1, o.width * 0.006)}px rgba(255,255,255,.6);${o.style ?? ''}">
  <img src="${o.src}" style="position:absolute;left:${(-o.rect.x * imgW).toFixed(1)}px;top:${(-o.rect.y * imgH).toFixed(1)}px;width:${imgW.toFixed(1)}px;height:${imgH.toFixed(1)}px;max-width:none">
</div>`;
}

function defaultIcon(b: Badge): string {
  if (b.type === 'new') return 'sparkles';
  if (b.type === 'proof') return b.proof?.kind === 'award' ? 'award' : 'star';
  if (b.type === 'platform') {
    return { ipad: 'tablet', 'apple-watch': 'watch', 'iphone-duo': 'smartphone', mac: 'laptop', vision: 'glasses', widgets: 'layout-grid' }[b.platform ?? 'ipad'] ?? 'smartphone';
  }
  return 'check';
}

/** Black or white text, whichever reads better on `bg` (falls back to palette text). */
export function pickTextOn(bg: string, ad: PaletteDirection): string {
  const dark = '#0B0B0F';
  const light = '#FFFFFF';
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  return lum(bg) > 0.55 ? (lum(ad.palette.text) < 0.3 ? ad.palette.text : dark) : light;
}

/** Escapes, then turns *word* into accent-coloured spans. */
export function accentMarkup(text: string, accent: string): string {
  return esc(text).replace(/\*([^*]+)\*/g, `<span class="accent" style="color:${accent}">$1</span>`);
}
