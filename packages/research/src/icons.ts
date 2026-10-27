import { cachedFetch, log } from '@vitrin/core';
import type { CompetitorApp } from '@vitrin/schemas';
import sharp, { type OverlayOptions } from 'sharp';

const TILE = 180;
const GAP = 36;

/** iOS-like rounded mask for an icon tile. */
function mask(size: number): Buffer {
  const r = Math.round(size * 0.225);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
}

async function tile(input: Buffer): Promise<Buffer> {
  return sharp(input).resize(TILE, TILE, { fit: 'cover' }).composite([{ input: mask(TILE), blend: 'dest-in' }]).png().toBuffer();
}

/**
 * The app's icon among its competitors' icons at search-result size, on a light and a dark row — the context the
 * icon has to win in. The app's own icon is in the middle of each row, outlined. Returns false without icons.
 */
export async function iconSheet(opts: { out: string; own?: Buffer; apps: CompetitorApp[]; cacheDir: string }): Promise<boolean> {
  const others: Buffer[] = [];
  for (const app of opts.apps) {
    if (!app.iconUrl || others.length >= 6) continue;
    try {
      others.push(await tile(await cachedFetch(app.iconUrl, { cacheDir: opts.cacheDir, minIntervalMs: 200 })));
    } catch (err) {
      log.dim(`  could not download icon (${app.name}): ${(err as Error).message}`);
    }
  }
  if (!others.length && !opts.own) return false;
  const row = [...others.slice(0, 3), ...(opts.own ? [await tile(opts.own)] : []), ...others.slice(3)];
  const ownAt = opts.own ? Math.min(3, others.length) : -1;
  const width = row.length * (TILE + GAP) + GAP;
  const height = 2 * (TILE + GAP) + GAP;
  const ring = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE + 16}" height="${TILE + 16}"><rect x="3" y="3" width="${TILE + 10}" height="${TILE + 10}" rx="${TILE * 0.26}" fill="none" stroke="#FF3B30" stroke-width="5"/></svg>`);
  const layers: OverlayOptions[] = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height / 2}" fill="#F2F2F7"/><rect y="${height / 2}" width="${width}" height="${height / 2}" fill="#000"/></svg>`), left: 0, top: 0 }];
  for (const top of [GAP, TILE + 2 * GAP]) {
    row.forEach((input, i) => {
      const left = GAP + i * (TILE + GAP);
      layers.push({ input, left, top });
      if (i === ownAt) layers.push({ input: ring, left: left - 8, top: top - 8 });
    });
  }
  await sharp({ create: { width, height, channels: 3, background: '#F2F2F7' } }).composite(layers).png().toFile(opts.out);
  return true;
}
