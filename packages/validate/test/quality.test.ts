import type { ImageQuality, RenderManifest, RenderTarget } from '@vitrin/schemas';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { alphaAllowed, maxScreenshots, previewFamily, qualityIssues, storeName, validateScreenshots } from '../src/index.js';

const good: ImageQuality = {
  preset: 'liquid-glass-aurora',
  framing: 'bleed-bottom',
  deviceRule: 'phone',
  deviceHeightRatio: 0.72,
  largestEmptyBand: 0.06,
  widestWordRatio: 0.4,
  headlineContrast: 6.1,
  supportContrast: 7,
  layers: 3,
  thumbnail: { width: 220, headlinePx: 26, contrast: 9, legible: true },
};

const codes = (q: Partial<ImageQuality>, firstThree = true) => qualityIssues({ ...good, ...q }, 'x', { firstThree }).items.map((i) => `${i.severity}:${i.code}`);

describe('quality gate', () => {
  it('passes a slide that meets the quality bar', () => {
    expect(codes({})).toEqual([]);
  });

  it('rejects a small device and warns below the recommended range', () => {
    expect(codes({ deviceHeightRatio: 0.6 })).toEqual(['error:image.device-small']);
    expect(codes({ deviceHeightRatio: 0.66 })).toEqual(['warning:image.device-small']);
    // Watches, TVs and Macs are contained, not held to the phone ratio.
    expect(codes({ deviceRule: 'contained', deviceHeightRatio: 0.5 })).toEqual([]);
    expect(codes({ deviceRule: 'none', deviceHeightRatio: undefined })).toEqual([]);
  });

  it('flags empty bands, wide words, layers and contrast', () => {
    expect(codes({ largestEmptyBand: 0.3 })).toEqual(['warning:image.empty-band']);
    expect(codes({ widestWordRatio: 0.92 })).toEqual(['error:image.word-width']);
    expect(codes({ layers: 4 })).toEqual(['warning:image.layers']);
    expect(codes({ headlineContrast: 4.2 })).toEqual(['warning:image.headline-contrast']);
    expect(codes({ headlineContrast: 2.4 })).toEqual(['error:image.headline-contrast']);
    expect(codes({ supportContrast: 3.9 })).toEqual(['warning:image.text-contrast']);
  });

  it('runs the thumbnail test harder on the first three screenshots', () => {
    const thumb = { width: 220, headlinePx: 8, contrast: 2, legible: false };
    expect(codes({ thumbnail: thumb }, true)).toEqual(['warning:image.thumbnail']);
    expect(codes({ thumbnail: thumb }, false)).toEqual(['info:image.thumbnail']);
  });

  it('reads the measurements from the render manifest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vq-'));
    mkdirSync(join(dir, 'en-US'));
    const file = join(dir, 'en-US', '01_hero_iphone-6.9.png');
    await sharp({ create: { width: 1320, height: 2868, channels: 3, background: '#112233' } }).png().toFile(file);
    const target: RenderTarget = { id: 'iphone-6.9', kind: 'screenshot', label: 'iPhone 6.9"', family: 'iphone', store: 'app-store', platform: 'ios', width: 1320, height: 2868, logical: { width: 440, height: 956, scale: 3 }, acceptedSizes: [], requirement: 'optional', defaultEnabled: true, formats: ['png'] };
    const manifest: RenderManifest = {
      generatedAt: '',
      artDirection: 'x',
      images: [{ file, target: 'iphone-6.9', locale: 'en-US', shot: '01', width: 1320, height: 2868, overflow: [], safeAreaViolations: [], quality: { ...good, deviceHeightRatio: 0.55 } }],
      videos: [],
    };
    const issues = await validateScreenshots({ screenshotsDir: dir, locales: ['en-US'], targets: [target], manifest });
    expect(issues.items.map((i) => i.code)).toContain('image.device-small');
  });
});

describe('store rules', () => {
  it('lets the Google Play icon keep alpha and names the right store', () => {
    expect(alphaAllowed({ id: 'play-icon' })).toBe(true);
    expect(alphaAllowed({ id: 'play-phone' })).toBe(false);
    expect(storeName({ store: 'google-play' })).toBe('Google Play');
    expect(storeName({ store: 'app-store' })).toBe('the App Store');
    expect(maxScreenshots({ store: 'google-play' })).toBe(8);
    expect(maxScreenshots({ store: 'app-store' })).toBe(10);
  });

  it('maps preview file device names to families', () => {
    expect(previewFamily('IPHONE_67')).toBe('iphone');
    expect(previewFamily('IPAD_PRO_3GEN_129')).toBe('ipad');
    expect(previewFamily('DESKTOP')).toBe('mac');
    expect(previewFamily('APPLE_TV')).toBe('tv');
  });
});
