import { fontSetup } from './assets.js';
import { headlineHtml, plainWords } from './caption.js';
import { BadgeView, esc } from './components.js';
import { DeviceFrame, type DeviceFamily, type DeviceFinish, type FrameVariant } from './frames.js';
import type { PageInput } from './layout.js';
import { resolveDirection, surfaceFor, type ResolvedDirection } from './styles.js';

/**
 * Bespoke screenshot layouts (`shots[].template`): Claude writes the canvas for one shot as HTML/CSS in
 * metadata/designs/, designed for this app instead of picked from the archetypes. Vitrin fills it in per locale
 * and format and renders it like every other shot (same size checks, quality gate and review).
 *
 * In the template:
 * - `{{headline}}`, `{{subheadline}}`, `{{kicker}}` — the shot's localized copy as measured words (`*accent*`
 *   works); put them in `<h1 class="headline fit" data-min="…">`, `<p class="subheadline fit">`, `<p class="kicker">`
 *   inside a `<div class="caption">` so overflow, contrast and thumbnail checks see them.
 * - `{{badges}}`, `{{appName}}`, `{{icon}}` (image URL), `{{width}}`, `{{height}}`, `{{index}}`, `{{total}}`, `{{locale}}`,
 *   `{{bullets}}` (the shot's benefit lines as `<li>` items) and `{{photo}}` (URL of the shot's photo).
 * - `<vitrin-device screen="home" x="120" y="640" width="900" tilt="-4" finish="titanium" variant="inner" frameless>`
 *   — a device mockup with that rendered screen (`screen` = a screen id of the shot, or its 0-based position).
 *   `x`/`y`/`width` are CSS px of the canvas; `family` overrides the format's device family.
 * - CSS variables of the selected art direction: `--bg`, `--bg2`, `--text`, `--muted`, `--accent`, `--emphasis`,
 *   `--chip-bg`, `--chip-text`, `--plate`, `--plate-text`, `--headline` and `--body` (font stacks of the bundled
 *   families), `--w`, `--h`.
 */

export interface CustomPageInput extends PageInput {
  /** Screen ids of the shot, in the order of `screens` (to resolve `screen="home"`). */
  screenIds?: string[];
}

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

const num = (v: string | undefined, fallback: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Replaces every `<vitrin-device …>` (self-closing or with `</vitrin-device>`) with the device frame markup. */
export function expandDevices(html: string, p: CustomPageInput, family: DeviceFamily, finish: DeviceFinish, shadow: string): { html: string; missing: string[] } {
  const missing: string[] = [];
  const W = p.target.logical.width;
  const out = html.replace(/<vitrin-device\b([^>]*?)\/?>(?:\s*<\/vitrin-device>)?/gi, (_m, raw: string) => {
    const a = attrs(raw);
    const key = a.screen ?? '0';
    const idx = /^\d+$/.test(key) ? Number(key) : (p.screenIds ?? []).indexOf(key);
    const screen = p.screens[idx];
    if (!screen) {
      missing.push(key);
      return '';
    }
    const variant: FrameVariant = {};
    if (a.variant === 'inner' || a.variant === 'outer') variant.duo = a.variant;
    if (a.variant === 'window' || a.variant === 'laptop') variant.mac = a.variant;
    if (a.variant === 'bare' || a.variant === 'bezel') variant.tv = a.variant;
    const width = num(a.width, W * 0.78);
    const style = `left:${num(a.x, (W - width) / 2)}px;top:${num(a.y, p.target.logical.height * 0.3)}px;${a.z ? `z-index:${num(a.z, 1)};` : ''}`;
    return DeviceFrame({
      family: (a.family as DeviceFamily) || family,
      width,
      aspect: screen.aspect,
      src: screen.src,
      finish: (a.finish as DeviceFinish) || finish,
      variant,
      tilt: num(a.tilt, 0) || undefined,
      frameless: 'frameless' in a,
      shadow: 'noshadow' in a ? '' : shadow,
      style,
    });
  });
  return { html: out, missing };
}

/** The full page for a bespoke shot template. Throws when the template names a screen the shot does not have. */
export function buildCustomPage(template: string, p: CustomPageInput, family: DeviceFamily): string {
  const ad: ResolvedDirection = 'tokens' in p.ad && (p.ad as ResolvedDirection).tokens ? (p.ad as ResolvedDirection) : resolveDirection(p.ad);
  const t = ad.tokens;
  const { width: W, height: H } = p.target.logical;
  const { surface: sf } = surfaceFor(t, p.index ?? 0, p.inverted);
  const fonts = fontSetup(t.fonts.headline, t.fonts.body, p.locale, [t.fonts.label]);
  const badgeSize = Math.round(Math.min(W, H) * 0.034);
  const pal = { palette: { ...ad.palette, background: sf.bg, text: sf.text, textMuted: sf.muted } };
  const vars: Record<string, string> = {
    headline: headlineHtml(p.headline, t, sf),
    subheadline: plainWords(p.subheadline, sf.muted),
    kicker: plainWords(p.kicker ?? '', sf.muted),
    badges: p.badges.map((b) => BadgeView({ badge: b, locale: p.locale, ad: pal, fontSize: badgeSize })).join(''),
    appName: esc(p.appName ?? ''),
    icon: p.icon ?? '',
    bullets: (p.bullets ?? []).map((l) => `<li>${plainWords(l, sf.text)}</li>`).join(''),
    photo: p.photo ?? '',
    width: String(W),
    height: String(H),
    index: String((p.index ?? 0) + 1),
    total: String(p.total ?? 1),
    locale: esc(p.locale),
  };
  const filled = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
  const shadow = `drop-shadow(0 ${Math.round(W * 0.04)}px ${Math.round(W * 0.06)}px ${sf.shadow})`;
  const { html: body, missing } = expandDevices(filled, p, family, t.device.finish, shadow);
  if (missing.length) throw new Error(`Template uses screen(s) ${missing.join(', ')} that the shot does not list in "screens".`);
  const safe = Math.round(Math.min(W, H) * 0.035);
  const head = `<meta charset="utf-8">${fonts.links}<style>
  :root { --w:${W}px; --h:${H}px; --bg:${sf.bg[0]}; --bg2:${sf.bg[1] ?? sf.bg[0]}; --text:${sf.text}; --muted:${sf.muted}; --accent:${sf.accent}; --emphasis:${sf.emphasis[0] ?? sf.accent}; --chip-bg:${sf.chipBg}; --chip-text:${sf.chipText}; --plate:${sf.plate ?? sf.accent}; --plate-text:${sf.plateText ?? sf.text}; --headline:${fonts.headlineStack}; --body:${fonts.bodyStack}; }
  html, body { margin:0; padding:0; width:${W}px; height:${H}px; overflow:hidden; -webkit-font-smoothing:antialiased; }
  body { position:relative; background:var(--bg); color:var(--text); font-family:var(--body); }
  .headline { font-family:var(--headline); }
  .vq-hide .w { -webkit-text-fill-color:transparent !important; color:transparent !important; background-image:none !important; -webkit-text-stroke-color:transparent !important; }
  .vq-mask .w { -webkit-text-fill-color:#FF00FF !important; color:#FF00FF !important; background-image:none !important; -webkit-text-stroke-color:#FF00FF !important; }
</style>`;
  const guide = `<div class="safe-guide" data-inset="${safe}" style="position:absolute;inset:${safe}px;pointer-events:none"></div>`;
  if (/<html[\s>]/i.test(body)) {
    const withHead = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + head) : body.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
    return withHead.replace(/<\/body>/i, `${guide}</body>`);
  }
  return `<!doctype html>
<html lang="${esc(p.locale)}" dir="${fonts.dir}">
<head>${head}</head>
<body data-layout="custom" data-preset="${t.id}">
${body}
${guide}
</body>
</html>`;
}
