import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { composeScreenMockups, launchChromium, MOCKUPS, mockupPage, mockupSpec, renderMockupTemplates } from '../src/index.js';

let browserOk = false;
beforeAll(async () => {
  try {
    await (await launchChromium()).close();
    browserOk = true;
  } catch {
    browserOk = false;
  }
}, 60_000);

describe('device mockups', () => {
  it('cover every device family, with the iPhone Duo open, closed and as a pair', () => {
    const families = new Set(MOCKUPS.map((m) => m.family));
    for (const f of ['iphone', 'ipad', 'duo', 'watch', 'mac', 'tv', 'vision', 'android-phone', 'android-tablet']) expect(families.has(f as never), f).toBe(true);
    expect(mockupSpec('duo-open').variant).toEqual({ duo: 'inner' });
    expect(mockupSpec('duo-closed').variant).toEqual({ duo: 'outer' });
    const pair = mockupPage(mockupSpec('duo-pair'), 'a.png', 2853 / 2007);
    expect(pair.screens).toHaveLength(2);
    expect(pair.html).toContain('a.png');
    // The open display carries the fold crease, the closed one does not.
    expect(mockupPage(mockupSpec('duo-open'), 'a.png', 1.42).html).toContain('translateX(-50%);background:linear-gradient(90deg,rgba(0,0,0,0)');
    expect(mockupPage(mockupSpec('duo-closed'), 'a.png', 1.45).html).not.toContain('translateX(-50%);background:linear-gradient(90deg,rgba(0,0,0,0)');
    expect(() => mockupSpec('nope')).toThrow(/Unknown mockup/);
  });

  it('renders transparent templates with their screen rectangles and places rendered screens into them', async (t) => {
    if (!browserOk) return t.skip();
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-mockups-'));
    const list = await renderMockupTemplates(join(dir, 'templates'), { ids: ['iphone', 'duo-pair'], maxSide: 600 });
    expect(list.map((m) => m.id)).toEqual(['iphone', 'duo-pair']);
    const meta = await sharp(list[0]!.file).metadata();
    expect(meta.hasAlpha).toBe(true);
    const s = list[0]!.screens[0]!;
    expect(s.x).toBeGreaterThan(0);
    expect(s.x + s.width).toBeLessThan(meta.width!);
    expect(JSON.parse(readFileSync(join(dir, 'templates', 'mockups.json'), 'utf8')).mockups[1].screens).toHaveLength(2);

    const raw = join(dir, 'raw', 'en-US', 'iphone');
    mkdirSync(raw, { recursive: true });
    await sharp({ create: { width: 1320, height: 2868, channels: 3, background: '#3366FF' } }).png().toFile(join(raw, 'home.png'));
    const composed = await composeScreenMockups(join(dir, 'raw'), join(dir, 'screens'), { mockups: ['iphone'] });
    expect(composed).toHaveLength(1);
    const { data, info } = await sharp(composed[0]!.file).raw().toBuffer({ resolveWithObject: true });
    // The middle of the screen shows the rendered screen.
    const i = (Math.round(info.height / 2) * info.width + Math.round(info.width / 2)) * info.channels;
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([0x33, 0x66, 0xff]);
    expect(existsSync(join(dir, 'screens', 'index.html'))).toBe(true);
  }, 120_000);
});
