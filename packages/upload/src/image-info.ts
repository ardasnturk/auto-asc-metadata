import { open, stat } from 'node:fs/promises';

/** What the store checks need from an image header (no decoding, no native dependency). */
export interface ImageInfo {
  format: 'png' | 'jpeg' | 'unknown';
  width: number;
  height: number;
  /** PNG colour type 4/6, or a tRNS chunk (palette/greyscale transparency). JPEG never has alpha. */
  hasAlpha: boolean;
  /** Bits per channel (PNG bit depth, JPEG sample precision). */
  bitDepth: number;
  bytes: number;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Parses PNG IHDR (+ tRNS before IDAT) or the first JPEG SOF marker. */
export function parseImageHeader(buf: Buffer, bytes = buf.length): ImageInfo {
  if (buf.length >= 33 && buf.subarray(0, 8).equals(PNG_SIG) && buf.toString('ascii', 12, 16) === 'IHDR') {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    const bitDepth = buf[24]!;
    const colorType = buf[25]!;
    let hasAlpha = colorType === 4 || colorType === 6;
    // Walk chunks until IDAT: a tRNS chunk adds transparency to palette, greyscale and truecolour images.
    let off = 8;
    while (!hasAlpha && off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'tRNS') hasAlpha = true;
      if (type === 'IDAT' || type === 'IEND') break;
      off += 12 + len;
    }
    return { format: 'png', width, height, hasAlpha, bitDepth, bytes };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1]!;
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', bitDepth: buf[off + 4]!, height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7), hasAlpha: false, bytes };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
  }
  return { format: 'unknown', width: 0, height: 0, hasAlpha: false, bitDepth: 0, bytes };
}

/** Reads the first 256 KB of a file (enough for IHDR/tRNS and JPEG SOF in practice). */
export async function readImageInfo(file: string): Promise<ImageInfo> {
  const fh = await open(file, 'r');
  try {
    const size = (await stat(file)).size;
    const buf = Buffer.alloc(Math.min(size, 256 * 1024));
    await fh.read(buf, 0, buf.length, 0);
    return parseImageHeader(buf, size);
  } finally {
    await fh.close();
  }
}
