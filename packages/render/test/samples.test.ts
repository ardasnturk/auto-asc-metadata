import { appPaths } from '@vitrin/core';
import { ShotList, type RenderTarget } from '@vitrin/schemas';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { launchChromium, renderDesignSamples } from '../src/index.js';

// A small iPhone-shaped target keeps the browser test fast; the renderer only cares about family and size.
const target: RenderTarget = { id: 'iphone-test', kind: 'screenshot', label: 'iPhone (test)', family: 'iphone', store: 'app-store', platform: 'ios', width: 440, height: 956, logical: { width: 220, height: 478, scale: 2 }, acceptedSizes: [], requirement: 'optional', defaultEnabled: true, formats: ['png'] };

let browserOk = false;
beforeAll(async () => {
  // Use a preinstalled Chromium when the pinned Playwright browser is missing (CI images).
  if (!process.env.VITRIN_CHROMIUM && existsSync('/opt/pw-browsers/chromium')) {
    try {
      await (await launchChromium()).close();
    } catch {
      process.env.VITRIN_CHROMIUM = '/opt/pw-browsers/chromium';
    }
  }
  try {
    await (await launchChromium()).close();
    browserOk = true;
  } catch {
    browserOk = false;
  }
}, 60_000);

async function project(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'vitrin-samples-'));
  const raw = join(root, 'metadata', 'raw', 'en-US', 'iphone');
  mkdirSync(raw, { recursive: true });
  // A light "app screen": white with a header bar and a few cards.
  const card = (top: number, color: string) => ({ input: { create: { width: 1100, height: 260, channels: 3 as const, background: color } }, left: 53, top });
  for (const id of ['home', 'stats']) {
    await sharp({ create: { width: 1206, height: 2622, channels: 3, background: '#F4F3F8' } })
      .composite([card(300, '#5B4BE8'), card(640, '#FFFFFF'), card(940, '#FFFFFF'), card(1240, '#FFFFFF')])
      .png()
      .toFile(join(raw, `${id}.png`));
  }
  return root;
}

const shots = ShotList.parse({
  shots: [
    { id: '01', slug: 'hero', archetype: 'hero', screens: ['home'], featureIds: ['a'], copy: { 'en-US': { kicker: 'Habits', headline: 'Keep your *streak*', subheadline: 'One tap a day' } } },
    { id: '02', slug: 'stats', archetype: 'feature', screens: ['stats'], featureIds: ['a'], copy: { 'en-US': { headline: 'See your *progress*' } } },
  ],
});

describe('design samples', () => {
  it('renders the first two shots per preset and an HTML contact sheet', async (ctx) => {
    if (!browserOk) ctx.skip();
    const root = await project();
    const res = await renderDesignSamples({ paths: appPaths(root), primaryLocale: 'en-US', target, shots, styles: ['midnight-glow-pro', 'swiss-grid-bold'], brand: { primary: '#5B4BE8' }, appName: 'Ritim' });
    expect(res.samples.map((s) => [s.letter, s.style])).toEqual([
      ['A', 'midnight-glow-pro'],
      ['B', 'swiss-grid-bold'],
    ]);
    for (const s of res.samples) {
      expect(s.files).toHaveLength(2);
      for (const f of s.files) {
        const m = await sharp(f).metadata();
        expect([m.width, m.height, m.hasAlpha]).toEqual([440, 956, false]);
      }
    }
    expect(existsSync(res.contactSheet)).toBe(true);
    const sheet = await sharp(res.contactSheet).metadata();
    expect(sheet.width!).toBeGreaterThan(sheet.height!);
    const manifest = JSON.parse(readFileSync(join(root, 'metadata', 'design-samples', 'samples.json'), 'utf8'));
    expect(manifest.samples[1].style).toBe('swiss-grid-bold');
  }, 120_000);

  it('measures the quality bar on the real render', async (ctx) => {
    if (!browserOk) ctx.skip();
    const root = await project();
    const { renderOne, buildPage, resolveDirection } = await import('../src/index.js');
    const browser = await launchChromium();
    try {
      const page = await (await browser.newContext({ viewport: { width: 220, height: 478 }, deviceScaleFactor: 2 })).newPage();
      const ad = resolveDirection({ id: 'x', name: 'x', rationale: '', differentiation: '', preset: 'liquid-glass-aurora' });
      const screen = { src: `file://${join(root, 'metadata', 'raw', 'en-US', 'iphone', 'home.png')}`, aspect: 2622 / 1206, family: 'iphone' as const };
      const html = buildPage({ target, locale: 'en-US', ad, archetype: 'hero', headline: 'Keep your *streak*', subheadline: 'One tap a day', kicker: 'Habits', badges: [], screens: [screen], appName: 'Ritim' });
      const m = await renderOne(page, html, join(root, 'h.html'), join(root, 'out.png'), target, { preset: 'liquid-glass-aurora', framing: 'bleed-bottom', family: 'iphone', hasDevice: true });
      expect(m.overflow).toEqual([]);
      expect(m.quality.deviceRule).toBe('phone');
      expect(m.quality.deviceHeightRatio!).toBeGreaterThanOrEqual(0.68);
      expect(m.quality.deviceHeightRatio!).toBeLessThanOrEqual(0.82);
      expect(m.quality.largestEmptyBand).toBeLessThanOrEqual(0.22);
      expect(m.quality.widestWordRatio).toBeLessThanOrEqual(0.88);
      expect(m.quality.headlineContrast).toBeGreaterThanOrEqual(4.5);
      expect(m.quality.layers).toBeLessThanOrEqual(3);
      expect(m.quality.thumbnail.contrast).toBeGreaterThan(3);
      // A headline that sits on its own color must fail the glyph contrast measurement.
      const bad = html.replace(/#16131F/g, '#E9E4F8');
      const b = await renderOne(page, bad, join(root, 'b.html'), join(root, 'bad.png'), target, { preset: 'x', framing: 'bleed-bottom', family: 'iphone', hasDevice: true });
      expect(b.quality.headlineContrast).toBeLessThan(3);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
