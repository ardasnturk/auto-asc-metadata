import sharp from 'sharp';

type RGB = [number, number, number];

/** Deterministic k-means (k-means++ seeding with a fixed PRNG) over downsampled pixels. */
export function kmeans(pixels: RGB[], k: number, iterations = 12): Array<{ color: RGB; weight: number }> {
  if (pixels.length === 0) return [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const dist = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers: RGB[] = [pixels[Math.floor(rand() * pixels.length)]!];
  while (centers.length < Math.min(k, pixels.length)) {
    const d = pixels.map((p) => Math.min(...centers.map((c) => dist(p, c))));
    const sum = d.reduce((a, b) => a + b, 0);
    if (sum === 0) break;
    let r = rand() * sum;
    let idx = 0;
    while (idx < d.length - 1 && (r -= d[idx]!) > 0) idx++;
    centers.push(pixels[idx]!);
  }
  const assign = new Array<number>(pixels.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dd = dist(pixels[i]!, centers[c]!);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    pixels.forEach((p, i) => {
      const s = sums[assign[i]!]!;
      s[0]! += p[0];
      s[1]! += p[1];
      s[2]! += p[2];
      s[3]! += 1;
    });
    sums.forEach((s, c) => {
      if (s[3]) centers[c] = [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]];
    });
  }
  const counts = centers.map(() => 0);
  assign.forEach((a) => counts[a]!++);
  return centers
    .map((color, i) => ({ color: color.map(Math.round) as RGB, weight: counts[i]! / pixels.length }))
    .sort((a, b) => b.weight - a.weight);
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Dominant colors of an image (as #RRGGBB), most common first. */
export async function extractPalette(image: Buffer, k = 5): Promise<string[]> {
  const { data, info } = await sharp(image).resize(64, 64, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels: RGB[] = [];
  for (let i = 0; i < data.length; i += info.channels) pixels.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  return kmeans(pixels, k).map((c) => rgbToHex(c.color));
}
