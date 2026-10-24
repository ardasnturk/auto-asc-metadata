import type { ArtDirectionOption, Badge, Callout, Quote, RenderTarget, Shot } from '@vitrin/schemas';
import { fontSetup, lucideIcon } from './assets.js';
import { Background, BadgeView, CalloutCard, Caption, DeviceFrame, esc, QuoteCard } from './components.js';

export interface ScreenImage {
  /** file:// URL */
  src: string;
  /** height / width of the raw capture */
  aspect: number;
  family: 'iphone' | 'ipad' | 'duo';
}

export interface PageInput {
  target: RenderTarget;
  locale: string;
  ad: ArtDirectionOption;
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
  /** file:// URL of the app icon (statement slides). */
  icon?: string;
}

/** Builds the full HTML document for one image. All sizes are logical CSS px. */
export function buildPage(input: PageInput): string {
  const p: Required<Pick<PageInput, 'callouts' | 'quotes'>> & PageInput = { callouts: [], quotes: [], ...input };
  const { width: w, height: h } = p.target.logical;
  const fonts = fontSetup(p.ad.typography.headline, p.ad.typography.body, p.locale);
  const landscape = w > h * 1.05;
  const body = landscape ? landscapeLayout(p, w, h) : portraitLayout(p, w, h);
  const safe = Math.round(Math.min(w, h) * 0.035);
  return `<!doctype html>
<html lang="${esc(p.locale)}" dir="${fonts.dir}">
<head>
<meta charset="utf-8">
${fonts.links}
<style>
  :root { --headline: ${fonts.headlineStack}; --body: ${fonts.bodyStack}; }
  html, body { margin:0; padding:0; width:${w}px; height:${h}px; overflow:hidden; -webkit-font-smoothing:antialiased; }
  body { position:relative; font-family:var(--body); }
  .icon { flex:none; }
  .safe-guide { position:absolute; inset:${safe}px; pointer-events:none; }
</style>
</head>
<body data-layout="${landscape ? 'landscape' : 'portrait'}" data-gap="${Math.round(h * 0.03)}">
${Background(p.ad, w, h, p.ad.background.style === 'panoramic' ? p.panorama : undefined)}
${body}
<div class="safe-guide" data-inset="${safe}"></div>
</body>
</html>`;
}

type Full = PageInput & { callouts: Callout[]; quotes: Quote[] };

function familyFor(p: PageInput): 'iphone' | 'ipad' | 'duo' {
  return p.screens[0]?.family ?? 'iphone';
}

function badgesRow(p: PageInput, fontSize: number, center: boolean, filter: (b: Badge) => boolean = () => true): string {
  const list = p.badges.filter(filter);
  if (!list.length) return '';
  return `<div class="badges" style="display:flex;flex-wrap:wrap;gap:${fontSize * 0.5}px;justify-content:${center ? 'center' : 'flex-start'};margin-top:${fontSize * 0.4}px">${list
    .map((badge) => BadgeView({ badge, locale: p.locale, ad: p.ad, fontSize }))
    .join('')}</div>`;
}

function portraitLayout(p: Full, w: number, h: number): string {
  const isTablet = familyFor(p) === 'ipad' || w / h > 0.6;
  const pad = Math.round(w * 0.075);
  const a = p.archetype;
  const statement = a === 'statement';
  const headlineSize = Math.round(w * (statement ? (isTablet ? 0.1 : 0.13) : isTablet ? 0.074 : 0.09));
  const minHeadline = Math.round(w * (isTablet ? 0.05 : 0.076));
  const subSize = Math.round(Math.min(headlineSize, w * (isTablet ? 0.074 : 0.09)) * 0.44);
  const badgeSize = Math.round(w * (isTablet ? 0.024 : 0.036));
  const margin = Math.round(h * 0.065);
  const bottom = p.captionPosition === 'bottom' && !statement;
  const captionH = Math.round(h * (statement ? 0.62 : a === 'stat' ? 0.36 : a === 'social-proof' ? 0.31 : a === 'testimonial' ? 0.2 : p.kicker ? 0.28 : 0.25));
  const captionTop = statement ? Math.round((h - captionH) / 2) : bottom ? h - margin - captionH : margin;
  const ad = p.ad;

  let above = '';
  if (a === 'stat' && p.stat) {
    above = `<div class="stat fit" data-min="${Math.round(w * 0.12)}" style="font-family:var(--headline);font-weight:850;font-size:${Math.round(w * 0.22)}px;line-height:.95;letter-spacing:-0.04em;color:${ad.palette.accent};white-space:nowrap;overflow:hidden;max-width:100%">${esc(p.stat)}</div>`;
  }
  if (a === 'social-proof') {
    const proof = p.badges.find((b) => b.type === 'proof');
    if (proof) above = BadgeView({ badge: proof, locale: p.locale, ad, fontSize: Math.round(badgeSize * 1.25) });
  }
  if (statement && p.icon) {
    const size = Math.round(w * (isTablet ? 0.16 : 0.24));
    above = `<img src="${p.icon}" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.225)}px;box-shadow:0 ${size * 0.08}px ${size * 0.25}px rgba(0,0,0,.3);margin-bottom:${size * 0.12}px">`;
  }
  const floating = a === 'feature' || a === 'tilted';
  // social-proof shows its proof above the headline, testimonial below the quotes: not again in the badge row.
  const proofInAbove = (b: Badge) => !((a === 'social-proof' || a === 'testimonial') && b.type === 'proof');
  const below = floating ? '' : badgesRow(p, statement ? Math.round(badgeSize * 1.2) : badgeSize, true, proofInAbove);
  const caption = Caption({
    headline: p.headline,
    subheadline: p.subheadline,
    kicker: p.kicker,
    ad,
    headlineSize,
    minHeadlineSize: minHeadline,
    subSize,
    width: w - pad * 2,
    height: captionH,
    align: 'center',
    bottom,
    style: `left:${pad}px;top:${captionTop}px;${statement ? 'justify-content:center;' : ''}`,
    above,
    below,
  });
  if (statement) return caption;

  // Devices hang below a top caption (bleeding off the bottom) or above a bottom caption (bleeding off the top).
  const gap = Math.round(h * 0.02);
  const anchor = bottom ? captionTop - gap : captionTop + captionH + gap;
  const fam = familyFor(p);
  const items: string[] = [];
  const s0 = p.screens[0];
  const room = (bleed: number) => (bottom ? anchor : h - anchor) + h * bleed;
  const fit = (maxW: number, bleed: number) => (s0 ? Math.min(maxW, room(bleed) / s0.aspect) : maxW);
  const bezelOf = (width: number, frame: string) => (frame === 'none' ? 0 : Math.round(width * (fam === 'ipad' ? 0.022 : 0.032)));
  /** y offset from the anchor → absolute top, mirrored for bottom captions. */
  const place = (offset: number, height: number) => (bottom ? anchor - offset - height : anchor + offset);

  const dev = (i: number, width: number, left: number, offset: number, extra: Partial<Parameters<typeof DeviceFrame>[0]> = {}) => {
    const s = p.screens[i] ?? s0;
    if (!s) return { top: 0, height: 0, bezel: 0 };
    const frame = extra.frame ?? ad.device.frame;
    const bezel = bezelOf(width, frame);
    const height = Math.round((width - bezel * 2) * s.aspect) + bezel * 2;
    const top = place(offset, height);
    items.push(DeviceFrame({ family: fam, frame, shadow: ad.device.shadow, tilt: ad.device.tilt, width: Math.round(width), aspect: s.aspect, src: s.src, style: `left:${Math.round(left)}px;top:${Math.round(top)}px;`, className: 'shift', ...extra }));
    return { top, height, bezel };
  };
  const floatBadges = (left: number, dw: number, top: number, height: number) => {
    p.badges.slice(0, 2).forEach((badge, i) => {
      const side = i % 2 === 0 ? `left:${Math.round(Math.max(pad * 0.4, left - dw * 0.08))}px;` : `right:${Math.round(Math.max(pad * 0.4, w - left - dw - dw * 0.08))}px;`;
      const y = top + height * (0.32 + 0.22 * i);
      items.push(`<div class="shift" style="position:absolute;${side}top:${Math.round(y)}px;">${BadgeView({ badge, locale: p.locale, ad, fontSize: Math.round(badgeSize * 1.1), floating: true })}</div>`);
    });
  };

  switch (a) {
    case 'split': {
      const dw = Math.min(w * 0.46, fit(w * 0.46, 0.2));
      dev(0, dw, w / 2 - dw * 0.94, 0, { tilt: -4 + ad.device.tilt });
      dev(1, dw, w / 2 - dw * 0.06, h * 0.05, { tilt: 4 + ad.device.tilt });
      break;
    }
    case 'collage': {
      const side = w * 0.38;
      const main = Math.min(w * 0.56, fit(w * 0.56, 0.16));
      dev(1, side, w / 2 - side / 2 - w * 0.25, h * 0.06, { tilt: -6 });
      dev(2, side, w / 2 - side / 2 + w * 0.25, h * 0.06, { tilt: 6 });
      dev(0, main, w / 2 - main / 2, 0);
      break;
    }
    case 'before-after': {
      const dw = Math.min(w * 0.42, fit(w * 0.42, 0.18));
      dev(0, dw, w / 2 - dw - w * 0.04, h * 0.03, { dim: true, tilt: 0 });
      dev(1, dw, w / 2 + w * 0.04, 0, { tilt: 0 });
      const arrow = Math.round(w * 0.07);
      items.push(`<div class="shift" style="position:absolute;left:${w / 2 - arrow / 2}px;top:${Math.round(place(h * 0.22, arrow))}px;width:${arrow}px;height:${arrow}px;border-radius:50%;background:${ad.palette.accent};display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.25)">${lucideIcon('arrow-right', Math.round(arrow * 0.55), '#FFFFFF')}</div>`);
      break;
    }
    case 'panoramic': {
      const dw = fit(w * 0.84, 0.16);
      dev(0, dw, w - dw * 0.82 - pad * 0.2, 0);
      break;
    }
    case 'stat': {
      const dw = fit(w * 0.66, 0.18);
      dev(0, dw, (w - dw) / 2, 0);
      break;
    }
    case 'hero': {
      const dw = fit(w * (isTablet ? 0.8 : 0.86), 0.16);
      dev(0, dw, (w - dw) / 2, 0);
      break;
    }
    case 'fullbleed': {
      // Frameless UI, edge to edge. The top of the UI (title, status bar) always stays visible:
      // with a top caption it bleeds off the bottom, with a bottom caption it is clipped above the caption.
      if (!s0) break;
      const fw = w - pad * 0.8;
      const radius = Math.round(fw * 0.07);
      const top = bottom ? Math.round(h * 0.035) : anchor;
      const height = bottom ? anchor - top : h - anchor + radius;
      items.push(`<div class="${bottom ? 'grow' : 'shift'}" style="position:absolute;left:${Math.round((w - fw) / 2)}px;top:${top}px;width:${Math.round(fw)}px;height:${Math.round(height)}px;overflow:hidden;border-radius:${radius}px;box-shadow:0 ${fw * 0.04}px ${fw * 0.12}px rgba(0,0,0,.3)"><img src="${s0.src}" style="display:block;width:100%;height:auto"></div>`);
      break;
    }
    case 'tilted': {
      const dw = Math.min(w * 0.9, fit(w * 0.9, 0.3));
      const d = dev(0, dw, w * 0.16, h * 0.01, { tilt: -12 });
      floatBadges(w * 0.16, dw, d.top, d.height);
      break;
    }
    case 'callout': {
      const dw = fit(w * (isTablet ? 0.62 : 0.74), 0.14);
      const sides = new Set(p.callouts.map((c) => c.side));
      const left = sides.has('right') && !sides.has('left') ? pad * 0.6 : sides.has('left') && !sides.has('right') ? w - dw - pad * 0.6 : (w - dw) / 2;
      const d = dev(0, dw, left, 0);
      const screenW = dw - d.bezel * 2;
      const screenH = d.height - d.bezel * 2;
      for (const c of p.callouts) {
        const src = p.screens[c.screen] ?? s0!;
        // Rects are fractions of one capture; another family's UI has a different layout.
        const rect = src.family === 'iphone' ? c.rect : c.rects[src.family];
        if (!rect) continue;
        const cw = Math.min(w - pad * 0.5, rect.w * screenW * c.scale);
        const ch = cw * ((rect.h * src.aspect) / rect.w);
        const cx = c.side === 'right' ? Math.min(w - pad * 0.4 - cw, left + dw * 0.42) : c.side === 'left' ? Math.max(pad * 0.4, left + dw * 0.58 - cw) : (w - cw) / 2;
        const cy = d.top + d.bezel + screenH * c.at - ch / 2;
        items.push(CalloutCard({ src: src.src, rect, rawAspect: src.aspect, width: cw, radius: Math.round(cw * 0.06), style: `left:${Math.round(cx)}px;top:${Math.round(cy)}px;`, className: 'shift' }));
      }
      break;
    }
    case 'testimonial': {
      // Cards flow in a column (real heights, no estimates); the proof laurel closes the column.
      const fontSize = Math.round(w * (isTablet ? 0.026 : 0.04));
      const cards = p.quotes
        .slice(0, 3)
        .map((q, i) => QuoteCard({ text: q.text, rating: q.rating, author: q.author, ad, fontSize, width: w - pad * 2, style: `position:relative;transform:rotate(${i % 2 ? 1.5 : -1.5}deg) translateX(${i % 2 ? w * 0.025 : -w * 0.02}px);` }))
        .join('');
      const proof = p.badges.find((b) => b.type === 'proof');
      const laurel = proof ? `<div style="margin-top:${h * 0.01}px">${BadgeView({ badge: { ...proof, style: 'laurel' }, locale: p.locale, ad, fontSize: Math.round(badgeSize * 1.2) })}</div>` : '';
      // Fill the free area between caption and canvas edge, centred vertically.
      const pos = bottom ? `top:${margin}px;bottom:${Math.round(h - anchor)}px;` : `top:${Math.round(anchor)}px;bottom:${margin}px;`;
      items.push(`<div style="position:absolute;left:${pad}px;right:${pad}px;${pos}display:flex;flex-direction:column;justify-content:center;align-items:center;gap:${Math.round(h * 0.022)}px">${cards}${laurel}</div>`);
      break;
    }
    default: {
      const dw = fit(w * (isTablet ? 0.74 : 0.8), 0.12);
      const left = (w - dw) / 2;
      const d = dev(0, dw, left, 0);
      if (floating) floatBadges(left, dw, d.top, d.height);
    }
  }
  return `${items.join('\n')}\n${caption}`;
}

function landscapeLayout(p: PageInput, w: number, h: number): string {
  const pad = Math.round(w * 0.06);
  const colW = Math.round(w * 0.42);
  const headlineSize = Math.round(h * 0.11);
  const subSize = Math.round(headlineSize * 0.42);
  const badgeSize = Math.round(h * 0.035);
  const captionH = Math.round(h * 0.7);
  const caption = Caption({
    headline: p.headline,
    subheadline: p.subheadline,
    kicker: p.kicker,
    ad: p.ad,
    headlineSize,
    minHeadlineSize: Math.round(h * 0.07),
    subSize,
    width: colW,
    height: captionH,
    align: 'start',
    style: `left:${pad}px;top:${(h - captionH) / 2}px;justify-content:center;`,
    below: badgesRow(p, badgeSize, false),
  });
  const fam = familyFor(p);
  const area = { left: pad + colW + w * 0.04, right: w - pad * 0.6 };
  const devices: string[] = [];
  const n = Math.min(p.screens.length, 3);
  const dh = h * (n > 1 ? 0.92 : 1.0);
  for (let i = 0; i < n; i++) {
    const s = p.screens[i]!;
    const dw = dh / s.aspect;
    const span = area.right - area.left;
    const left = n === 1 ? area.left + (span - dw) / 2 : area.left + (span - dw) * (i / (n - 1));
    const top = h * (0.12 + (i % 2) * 0.08);
    devices.push(
      DeviceFrame({ family: fam, frame: p.ad.device.frame, shadow: p.ad.device.shadow, tilt: n > 1 ? (i - (n - 1) / 2) * 4 : p.ad.device.tilt, width: Math.round(dw), aspect: s.aspect, src: s.src, style: `left:${Math.round(left)}px;top:${Math.round(top)}px;z-index:${i === Math.floor(n / 2) ? 3 : 1};` }),
    );
  }
  return `${devices.join('\n')}\n${caption}`;
}

/**
 * Runs inside the page: shrinks `.fit` text until it fits, then reports overflow,
 * the final headline size and safe-area violations.
 */
export const MEASURE_SCRIPT = `(() => {
  const caption = document.querySelector('.caption');
  const fits = [...document.querySelectorAll('.fit')];
  // Horizontal overflow = a single word wider than the box. Vertical overflow is judged on the caption block,
  // because glyph ascenders/descenders make scrollHeight unreliable on individual lines.
  const wide = (el) => el.scrollWidth > el.clientWidth + 1;
  const contentBottom = () => Math.max(...[...caption.children].map((c) => c.getBoundingClientRect().bottom));
  const captionOver = () => caption && contentBottom() > caption.getBoundingClientRect().bottom + 1;
  for (let guard = 0; guard < 300 && (captionOver() || fits.some(wide)); guard++) {
    let shrunk = false;
    // Shrink the subheadline first (down to its minimum), then the headline.
    for (const el of [...fits].reverse()) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      const min = parseFloat(el.dataset.min || '0');
      if ((wide(el) || captionOver()) && size - 1 >= min) { el.style.fontSize = (size - 1) + 'px'; shrunk = true; break; }
    }
    if (!shrunk) break;
  }
  const overflow = [];
  for (const el of fits) if (wide(el)) overflow.push(el.className.split(' ')[0] + ': ' + el.textContent.trim().slice(0, 40));
  if (captionOver()) overflow.push('caption: the caption block does not fit its allotted area');
  for (const el of document.querySelectorAll('.fit-one')) if (el.scrollWidth > el.clientWidth + 1) overflow.push('badge: ' + el.textContent.trim().slice(0, 30));
  // Portrait layouts: pull the devices up so the gap under a short caption stays constant.
  if (document.body.dataset.layout === 'portrait' && caption) {
    const gap = parseFloat(document.body.dataset.gap || '0');
    const fromBottom = caption.dataset.bottom === '1';
    const contentTop = Math.min(...[...caption.children].map((c) => c.getBoundingClientRect().top));
    const slack = fromBottom ? contentTop - caption.getBoundingClientRect().top - gap * 0.4 : caption.getBoundingClientRect().bottom - contentBottom() - gap * 0.4;
    if (slack > 0) for (const el of document.querySelectorAll('.shift')) el.style.top = (parseFloat(el.style.top) + (fromBottom ? slack : -slack)) + 'px';
    // Top-pinned blocks (fullbleed above a bottom caption) grow into the freed space instead of moving.
    if (slack > 0 && fromBottom) for (const el of document.querySelectorAll('.grow')) el.style.height = (parseFloat(el.style.height) + slack) + 'px';
  }
  const headline = document.querySelector('.headline');
  const guide = document.querySelector('.safe-guide');
  const inset = guide ? parseFloat(guide.dataset.inset) : 0;
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const safe = [];
  for (const el of document.querySelectorAll('.headline, .subheadline, .badge, .stat')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.left < inset - 0.5 || r.top < inset - 0.5 || r.right > W - inset + 0.5 || r.bottom > H - inset + 0.5) safe.push(el.className.split(' ')[0]);
  }
  const hs = headline ? getComputedStyle(headline) : null;
  const headlineLines = headline ? Math.round(headline.getBoundingClientRect().height / (parseFloat(hs.fontSize) * parseFloat(hs.lineHeight === 'normal' ? '1.2' : String(parseFloat(hs.lineHeight) / parseFloat(hs.fontSize))))) : 0;
  return { overflow, headlineCssPx: headline ? parseFloat(hs.fontSize) : 0, headlineLines, safeAreaViolations: safe };
})()`;
