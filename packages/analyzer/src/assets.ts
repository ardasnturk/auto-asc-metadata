import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

interface ColorComponents {
  red?: string | number;
  green?: string | number;
  blue?: string | number;
}

/** Converts an asset-catalog color component ("0.5", "128", "0x80") to 0–255. */
export function componentTo255(v: string | number | undefined): number {
  if (v === undefined) return 0;
  if (typeof v === 'number') return v <= 1 ? Math.round(v * 255) : Math.round(v);
  const s = v.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
  const f = parseFloat(s);
  if (s.includes('.') || f <= 1) return Math.round(f * 255);
  return Math.round(f);
}

export function toHex(c: ColorComponents): string {
  return (
    '#' +
    [c.red, c.green, c.blue]
      .map((x) => Math.max(0, Math.min(255, componentTo255(x))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export interface CatalogScan {
  colors: Array<{ name: string; hex: string; file: string }>;
  accentColor?: string;
  appIcon?: string;
}

/** Reads every *.colorset (light appearance) and the largest AppIcon image from asset catalogs. */
export async function scanAssetCatalogs(catalogs: string[]): Promise<CatalogScan> {
  const out: CatalogScan = { colors: [] };
  for (const cat of catalogs) {
    await walk(cat);
  }
  async function walk(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.endsWith('.colorset')) {
        const contents = join(full, 'Contents.json');
        if (!existsSync(contents)) continue;
        const json = JSON.parse(await readFile(contents, 'utf8')) as {
          colors?: Array<{ appearances?: unknown[]; color?: { components?: ColorComponents } }>;
        };
        const any = json.colors?.find((c) => !c.appearances) ?? json.colors?.[0];
        if (!any?.color?.components) continue;
        const name = basename(e.name, '.colorset');
        const hex = toHex(any.color.components);
        out.colors.push({ name, hex, file: contents });
        if (name === 'AccentColor') out.accentColor = hex;
      } else if (e.name.endsWith('.appiconset')) {
        const contents = join(full, 'Contents.json');
        if (!existsSync(contents)) continue;
        const json = JSON.parse(await readFile(contents, 'utf8')) as {
          images?: Array<{ filename?: string; size?: string; scale?: string; appearances?: unknown[] }>;
        };
        const imgs = (json.images ?? []).filter((i) => i.filename && !i.appearances);
        const best = imgs.sort((a, b) => sizeOf(b) - sizeOf(a))[0];
        if (best?.filename && !out.appIcon) out.appIcon = join(full, best.filename);
      } else {
        await walk(full);
      }
    }
  }
  return out;
}

function sizeOf(i: { size?: string; scale?: string }): number {
  const s = parseFloat(i.size ?? '0');
  const scale = parseFloat((i.scale ?? '1x').replace('x', ''));
  return s * scale;
}
