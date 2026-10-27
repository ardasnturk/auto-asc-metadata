/**
 * Headline, kicker and subheadline markup. Every word is wrapped in `.w` with the colors its glyphs are filled
 * with (`data-colors`), so the quality gate can measure the worst background pixel under each word.
 */
import { contrastRatio, inkOn } from './color.js';
import { esc } from './components.js';
import { squiggle } from './decor.js';
import type { EmphasisKind, StyleTokens, Surface } from './styles.js';

export interface HeadlineParts {
  /** Lines (explicit `\n` breaks), each a list of segments. */
  lines: Array<Array<{ text: string; em: boolean }>>;
}

/** Parses `*emphasis*` markup and explicit `\n` line breaks. */
export function parseHeadline(text: string): HeadlineParts {
  return {
    lines: text.split(/\n|\\n/).map((line) =>
      line
        .split(/(\*[^*]+\*)/)
        .filter((p) => p.length > 0)
        .map((p) => (p.length > 2 && p.startsWith('*') && p.endsWith('*') ? { text: p.slice(1, -1), em: true } : { text: p.replace(/\*/g, ''), em: false })),
    ),
  };
}

const words = (s: string) => s.split(/(\s+)/).filter((x) => x.length > 0);

function wordSpan(w: string, colors: string[], extraStyle = ''): string {
  return `<span class="w" data-colors="${colors.join(',')}"${extraStyle ? ` style="${extraStyle}"` : ''}>${esc(w)}</span>`;
}

function grad(stops: string[], angle = 100): string {
  return `background-image:linear-gradient(${angle}deg,${stops.map((c, i) => `${c} ${Math.round((i / Math.max(1, stops.length - 1)) * 100)}%`).join(',')});-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;padding-right:.04em;margin-right:-.04em;`;
}

/** Inner HTML of the `<h1>` for one surface and emphasis kind. */
export function headlineHtml(text: string, t: StyleTokens, sf: Surface): string {
  const kind: EmphasisKind = sf.emphasisKind ?? t.emphasis;
  const base = sf.textGradient ?? [sf.text];
  const baseStyle = sf.textGradient ? grad(sf.textGradient, 180) : '';
  const parts = parseHeadline(text);
  return parts.lines
    .map((line) =>
      line
        .map((seg) => {
          if (!seg.em) return words(seg.text).map((w) => (/^\s+$/.test(w) ? ' ' : wordSpan(w, base, baseStyle))).join('');
          return emphasis(seg.text, kind, t, sf);
        })
        .join(''),
    )
    .join('<br>');
}

function emphasis(text: string, kind: EmphasisKind, t: StyleTokens, sf: Surface): string {
  const ws = words(text);
  const join = (render: (w: string) => string) => ws.map((w) => (/^\s+$/.test(w) ? ' ' : render(w))).join('');
  const e = sf.emphasis;
  const scale = t.type.emphasisScale;
  switch (kind) {
    case 'gradient': {
      // A gradient needs two stops; a one-color emphasis (an override on a flat preset) runs into the text color.
      const stops = e.length > 1 ? e : [e[0]!, e[0]!];
      return `<span class="em em-gradient">${join((w) => wordSpan(w, stops, grad(stops)))}</span>`;
    }
    case 'box': {
      // A label stuck on the line: an inline block sized from the leading, not from the font's content area
      // (condensed faces like Anton have tall ascenders, and an inline background would cover the lines around it).
      const ink = sf.plateText ?? inkOn(sf.plate ?? e[0]!);
      const lead = t.type.leading;
      return `<span class="em em-box" style="display:inline-block;line-height:${(lead * 0.86).toFixed(3)};padding:${(lead * 0.05).toFixed(3)}em .14em ${(lead * 0.05).toFixed(3)}em;margin:0 .02em;border-radius:.08em;background:${sf.plate ?? e[0]};white-space:nowrap">${join((w) => wordSpan(w, [ink], `color:${ink}`))}</span>`;
    }
    case 'outline':
      return `<span class="em em-outline">${join((w) => wordSpan(w, [e[0]!], `color:transparent;-webkit-text-fill-color:transparent;-webkit-text-stroke:max(2px,.035em) ${e[0]};paint-order:stroke fill`))}</span>`;
    case 'block':
      // The block covers the phrase's x-height-to-descender band only, so it never runs into the line above.
      return `<span class="em em-block" style="background-image:linear-gradient(${sf.plate},${sf.plate});background-repeat:no-repeat;background-size:100% 86%;background-position:0 78%;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:0 .1em .02em;margin:0 -.02em">${join((w) => wordSpan(w, [sf.plateText ?? sf.text], `color:${sf.plateText ?? sf.text}`))}</span>`;
    case 'pill': {
      const ink = '#16121F';
      return `<span class="em em-pill" style="display:inline-block;background:${sf.plate};border:.032em solid ${ink};border-radius:999px;padding:.16em .24em .12em;margin:.1em .02em .02em;box-shadow:.055em .065em 0 ${ink};transform:rotate(-2.5deg);line-height:1">${join((w) => wordSpan(w, [sf.plateText ?? ink], `color:${sf.plateText ?? ink}`))}</span>`;
    }
    case 'italic':
      return `<span class="em em-italic" style="font-style:italic;font-size:${scale}em;color:${e[0]};${t.type.variation ? `font-variation-settings:${t.type.variation.replace('"WONK" 0', '"WONK" 1')};` : ''}letter-spacing:-0.015em">${join((w) => wordSpan(w, [e[0]!]))}</span>`;
    case 'script':
      return `<span class="em em-script" style="position:relative;display:inline-block;white-space:nowrap;font-family:var(--script);font-weight:700;font-size:${scale}em;letter-spacing:0;line-height:.9;color:${e[0]};transform:rotate(-3deg) translateY(.05em);padding:0 .04em">${join((w) => wordSpan(w, [e[0]!]))}<span aria-hidden="true" style="position:absolute;left:4%;right:-2%;bottom:.2em;height:.12em;line-height:0">${squiggle(100, 14, e[0]!, 4.2, 7).replace(/width="[^"]+" height="[^"]+"/, 'width="100%" height="100%" preserveAspectRatio="none"')}</span></span>`;
    case 'kenten':
      return `<span class="em em-kenten">${join(
        (w) =>
          `<span class="w" data-colors="${sf.text}" style="white-space:nowrap">${[...w].map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? `<span class="k" style="position:relative;display:inline-block"><span aria-hidden="true" style="position:absolute;left:50%;top:1.22em;width:.12em;height:.12em;margin-left:-.06em;border-radius:50%;background:${e[0]}"></span>${esc(ch)}</span>` : esc(ch))).join('')}</span>`,
      )}</span>`;
    case 'underline':
      return `<span class="em em-underline" style="position:relative;display:inline-block;background:linear-gradient(transparent 52%,rgba(252,227,106,.78) 52%,rgba(252,227,106,.78) 90%,transparent 90%);padding:0 .06em">${join((w) => wordSpan(w, [e[0] ?? sf.text], `color:${e[0] ?? sf.text}`))}<span aria-hidden="true" style="position:absolute;left:0;right:-4%;bottom:-.14em;height:.2em;line-height:0">${squiggle(100, 14, sf.accent, 4.5, 4).replace(/width="[^"]+" height="[^"]+"/, 'width="100%" height="100%" preserveAspectRatio="none"')}</span></span>`;
    default:
      return `<span class="em em-color" style="color:${e[0]}">${join((w) => wordSpan(w, [e[0]!], `color:${e[0]}`))}</span>`;
  }
}

/** Words of a plain text block (kicker, subheadline) wrapped for measurement. */
export function plainWords(text: string, color: string): string {
  return words(text)
    .map((w) => (/^\s+$/.test(w) ? ' ' : wordSpan(w, [color])))
    .join('');
}

export interface CaptionBlockOptions {
  t: StyleTokens;
  sf: Surface;
  headline: string;
  kicker?: string;
  subheadline?: string;
  appName: string;
  headlineSize: number;
  minHeadlineSize: number;
  subSize: number;
  /** Logical canvas width (word-width rule and kicker sizes). */
  canvasWidth: number;
  align: 'center' | 'start';
  /** Box in canvas px. */
  box: { x: number; y: number; w: number; h: number };
  bottom: boolean;
  /** HTML above the kicker (stat numerals, icons) and below the subheadline (badges, tiles). */
  above?: string;
  below?: string;
  justify?: string;
}

/** The kicker as a category chip: accent fill, ink that reads on it, the preset's label face. */
export function kickerTag(text: string, t: StyleTokens, sf: Surface, size: number): string {
  const fill = contrastRatio(sf.accent, sf.bg[0]!) >= 1.6 ? sf.accent : sf.text;
  const ink = inkOn(fill);
  const labelCase = t.type.labelCase === 'upper' ? 'text-transform:uppercase;letter-spacing:.06em;' : 'letter-spacing:.01em;';
  return `<div class="kicker kicker-tag" style="display:inline-block;align-self:${t.type.align === 'center' ? 'center' : 'flex-start'};font-family:var(--label);font-weight:700;font-size:${(size * 0.82).toFixed(1)}px;line-height:1.1;${labelCase}padding:.5em .95em .52em;border-radius:999px;background:${fill};color:${ink}">${plainWords(text, ink)}</div>`;
}

/** The caption block: kicker → headline → subheadline, laid out as a flex column the fitter can shrink. */
export function CaptionBlock(o: CaptionBlockOptions): string {
  const { t, sf } = o;
  const ty = t.type;
  const transform = ty.case === 'upper' ? 'text-transform:uppercase;' : ty.case === 'lower' ? 'text-transform:lowercase;' : '';
  const blockTransform = [ty.skew ? `skewX(${ty.skew}deg)` : '', ty.rotate ? `rotate(${ty.rotate}deg)` : ''].filter(Boolean).join(' ');
  const kickerSize = Math.max(o.headlineSize * 0.3, o.canvasWidth * 0.032);
  const labelCase = ty.labelCase === 'upper' ? 'text-transform:uppercase;' : '';
  let kicker = '';
  if (o.kicker && t.kicker === 'tag') {
    kicker = kickerTag(o.kicker, t, sf, kickerSize);
  } else if (o.kicker) {
    if (t.background === 'neon') {
      kicker = `<div class="kicker" style="font-family:var(--label);font-weight:700;font-style:italic;font-size:${kickerSize}px;letter-spacing:${ty.labelTracking}em;text-transform:uppercase;line-height:1.1;color:${sf.muted}"><span class="w" data-colors="${sf.emphasis[0]}" style="color:${sf.emphasis[0]}">${esc(o.appName)}</span> / ${plainWords(o.kicker, sf.muted)}</div>`;
    } else if (t.background === 'paper') {
      kicker = `<div class="kicker" style="display:inline-block;font-family:var(--body);font-weight:700;font-size:${kickerSize}px;line-height:1.1;color:#1F2A44;background:#FAE680;padding:.45em .8em .5em;transform:rotate(-3deg);box-shadow:0 .12em .3em rgba(40,30,20,.2);margin-bottom:.2em">${plainWords(o.kicker, '#1F2A44')}</div>`;
    } else if (t.background === 'swiss' || t.background === 'magazine' || t.background === 'washi') {
      // These presets carry the kicker in their index row / masthead / vertical label.
      kicker = '';
    } else {
      const accentFirst = t.background === 'beam';
      kicker = `<div class="kicker" style="font-family:var(--label);font-size:${kickerSize}px;font-weight:${t.background === 'bento' ? 600 : 600};letter-spacing:${ty.labelTracking}em;${labelCase}line-height:1.15;color:${sf.muted}">${accentFirst ? `<span aria-hidden="true" style="color:${sf.emphasis[2] ?? sf.emphasis[0]}">● </span>` : ''}${plainWords(o.kicker, sf.muted)}</div>`;
    }
  }
  const variation = ty.variation ? `font-variation-settings:${ty.variation};` : '';
  const kentenRoom = (sf.emphasisKind ?? t.emphasis) === 'kenten' ? 'padding-bottom:.22em;' : '';
  const h1 = `<h1 class="headline fit" data-min="${o.minHeadlineSize}" data-max-lines="${ty.maxLines}" data-leading="${ty.leading}" style="margin:0;${kentenRoom}font-family:var(--headline);font-size:${o.headlineSize}px;font-weight:${ty.weight};letter-spacing:${ty.tracking}em;line-height:${ty.leading};color:${sf.text};text-wrap:balance;max-width:100%;overflow-wrap:normal;${variation}${transform}${blockTransform ? `transform:${blockTransform};transform-origin:0 100%;` : ''}">${headlineHtml(o.headline, t, sf)}</h1>`;
  const sub = o.subheadline
    ? `<p class="subheadline fit" data-min="${Math.round(o.subSize * 0.82)}" style="margin:0;font-family:var(--body);font-size:${o.subSize}px;font-weight:${ty.subWeight};line-height:1.28;letter-spacing:-0.01em;color:${sf.muted};text-wrap:balance;max-width:${o.align === 'center' ? '100%' : '92%'};${t.background === 'magazine' ? 'font-style:italic;' : ''}">${plainWords(o.subheadline, sf.muted)}</p>`
    : '';
  const b = o.box;
  return `<div class="caption" data-bottom="${o.bottom ? 1 : 0}" style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;display:flex;flex-direction:column;justify-content:${o.justify ?? (o.bottom ? 'flex-end' : 'flex-start')};align-items:${o.align === 'center' ? 'center' : 'flex-start'};text-align:${o.align === 'center' ? 'center' : 'start'};gap:${Math.round(o.subSize * 0.62)}px;z-index:20">
  ${o.above ?? ''}
  ${kicker}
  ${h1}
  ${sub}
  ${o.below ?? ''}
</div>`;
}
