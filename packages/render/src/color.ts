/** WCAG 2.x relative luminance and contrast helpers. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return luminanceRgb(r, g, b);
}

/** Relative luminance from 0–255 channel values (sRGB). */
export function luminanceRgb(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratioFromLuminance(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastRatio(a: string, b: string): number {
  return ratioFromLuminance(luminance(a), luminance(b));
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Linear mix of two colors (t = 0 → a, t = 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(...(ca.map((v, i) => v + (cb[i]! - v) * t) as [number, number, number]));
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Hex → HSL (h 0–360, s and l 0–1). */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  if (s === 0) return rgbToHex(l * 255, l * 255, l * 255);
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rgbToHex(f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255);
}

export function hueOf(hex: string): number {
  return hexToHsl(hex)[0];
}

/** Shortest-path hue rotation from `hex`'s hue toward `targetHue` (t = 0 keeps it, 1 takes the target). */
export function shiftHue(hex: string, targetHue: number, t: number): string {
  if (t <= 0) return hex.toUpperCase();
  const [h, s, l] = hexToHsl(hex);
  // Greys have no hue to rotate; leave them alone so neutrals stay neutral.
  if (s < 0.06) return hex.toUpperCase();
  const delta = ((targetHue - h + 540) % 360) - 180;
  return hslToHex(h + delta * t, s, l);
}

/**
 * Darkens (on light backgrounds) or lightens (on dark ones) `fg` in HSL lightness until it reaches `min`:1
 * against every color in `bgs`. Keeps the hue, so a brand color stays recognisably the brand.
 */
export function ensureContrast(fg: string, bgs: string[], min = 4.5): string {
  const worst = (c: string) => Math.min(...bgs.map((b) => contrastRatio(c, b)));
  if (worst(fg) >= min) return fg.toUpperCase();
  const [h, s, l] = hexToHsl(fg);
  const darker = Math.max(...bgs.map(luminance)) > 0.18;
  let best = fg.toUpperCase();
  for (let i = 1; i <= 60; i++) {
    const nl = darker ? l * (1 - i / 60) : l + (1 - l) * (i / 60);
    best = hslToHex(h, s, nl);
    if (worst(best) >= min) return best;
  }
  return best;
}

/** Black or white, whichever reads better on `bg`. */
export function inkOn(bg: string, dark = '#0B0B0F', light = '#FFFFFF'): string {
  return contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
}
