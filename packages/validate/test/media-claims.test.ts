import { loadTargets } from '@vitrin/core';
import { ShotList, VitrinConfig, type AppProfile } from '@vitrin/schemas';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkVideo, sizeAccepted, validateClaims, validateScreenshots } from '../src/index.js';

const targets = loadTargets();
const t = (id: string) => targets.find((x) => x.id === id)!;

describe('size mapping', () => {
  it('accepts every documented size and rejects others', () => {
    expect(sizeAccepted(t('iphone-6.3'), 1206, 2622)).toBe(true);
    expect(sizeAccepted(t('iphone-6.3'), 1179, 2556)).toBe(true);
    expect(sizeAccepted(t('iphone-6.3'), 2622, 1206)).toBe(true); // landscape
    expect(sizeAccepted(t('iphone-6.3'), 1320, 2868)).toBe(false);
    expect(sizeAccepted(t('iphone-6.9'), 1290, 2796)).toBe(true);
    expect(sizeAccepted(t('ipad-13'), 2048, 2732)).toBe(true);
    expect(sizeAccepted(t('duo-inner'), 2007, 2853)).toBe(true);
    expect(sizeAccepted(t('search'), 1920, 1280)).toBe(true);
    expect(sizeAccepted(t('search'), 3000, 2000)).toBe(true);
    expect(sizeAccepted(t('search'), 1920, 1080)).toBe(false); // wrong ratio
    expect(sizeAccepted(t('search'), 4000, 2667)).toBe(false); // too large
  });
});

describe('screenshot files', () => {
  it('detects wrong size, alpha and missing required classes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-shots-'));
    mkdirSync(join(dir, 'tr'));
    mkdirSync(join(dir, 'de-DE'));
    await sharp({ create: { width: 1206, height: 2622, channels: 3, background: '#fff' } }).png().toFile(join(dir, 'tr', '01_hero_iphone-6.3.png'));
    await sharp({ create: { width: 1206, height: 2622, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toFile(join(dir, 'tr', '02_alpha_iphone-6.3.png'));
    await sharp({ create: { width: 1200, height: 2600, channels: 3, background: '#fff' } }).png().toFile(join(dir, 'tr', '01_hero_iphone-6.9.png'));
    const issues = await validateScreenshots({ screenshotsDir: dir, locales: ['tr'], targets: [t('iphone-6.3'), t('iphone-6.9'), t('ipad-13')] });
    const c = issues.items.map((i) => i.code);
    expect(c).toContain('image.alpha');
    expect(c).toContain('image.size');
    expect(c).toContain('image.stray-locale');
    expect(issues.errors.find((i) => i.code === 'image.missing-target')?.message).toContain('iPad');
  });
});

describe('video rules', () => {
  const base = { durationSec: 22, width: 886, height: 1920, fps: 30, videoCodec: 'h264', profile: 'High', level: 40, bitrate: 11_000_000, audioCodec: 'aac', audioChannels: 2, audioSampleRate: 48000, sizeBytes: 30_000_000 };
  it('accepts a compliant App Preview', () => {
    expect(checkVideo(base, t('preview-iphone'), 'x').errors).toEqual([]);
  });
  it('rejects 60 fps, short clips, missing audio and high levels', () => {
    const c = (p: Partial<typeof base>) => checkVideo({ ...base, ...p }, t('preview-iphone'), 'x').items.map((i) => i.code);
    expect(c({ fps: 60 })).toContain('video.fps');
    expect(c({ durationSec: 12 })).toContain('video.duration');
    expect(c({ audioCodec: undefined })).toContain('video.audio-missing');
    expect(c({ audioChannels: 1 })).toContain('video.audio-channels');
    expect(c({ level: 51 })).toContain('video.level');
    expect(c({ width: 1080 })).toContain('video.size');
  });
  it('allows 60 fps and 5 s for creative loops', () => {
    expect(checkVideo({ ...base, width: 3840, height: 1646, fps: 60, durationSec: 6, audioCodec: undefined }, t('header'), 'x').errors).toEqual([]);
  });
});

describe('claim ↔ evidence', () => {
  const profile = {
    app: { supportsIPad: false },
    project: { root: process.cwd(), targets: [{ kind: 'app', devices: ['iphone'] }] },
    features: [{ id: 'streaks', title: 'Seriler', evidence: [{ path: 'package.json' }] }, { id: 'ghost', title: 'Yok', evidence: [{ path: 'does/not/exist.swift' }] }],
  } as unknown as AppProfile;
  const config = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: {} });

  it('flags unknown features, unsupported platform badges, unverifiable proof and missing evidence files', () => {
    const shots = ShotList.parse({
      shots: [
        {
          id: '01', slug: 'hero', archetype: 'hero', screens: ['home'], featureIds: ['streaks', 'apple-watch'],
          copy: { tr: { headline: 'Serini koru' } },
          badges: [
            { type: 'platform', platform: 'ipad', label: { tr: 'iPad' } },
            { type: 'proof', proof: { kind: 'rating', value: 4.9, count: 1000, trackId: 1 }, label: { tr: '4,9' } },
            { type: 'feature', label: { tr: 'Seri' } },
          ],
        },
      ],
    });
    const c = validateClaims({ config, profile, shots, enabledTargets: ['iphone-6.3'] }).items.map((i) => i.code);
    expect(c).toContain('claim.unknown-feature');
    expect(c).toContain('badge.platform-unsupported');
    expect(c).toContain('badge.proof-unverified');
    expect(c).toContain('badge.no-feature');
    expect(c).toContain('evidence.missing-file');
  });

  it('limits headlines to seven words', () => {
    const shots = ShotList.parse({ shots: [{ id: '01', slug: 'a', archetype: 'hero', screens: ['home'], featureIds: ['streaks'], copy: { tr: { headline: 'bir iki üç dört beş altı yedi sekiz' } } }] });
    const c = validateClaims({ config, profile, shots, enabledTargets: [] }).items.map((i) => i.code);
    expect(c).toContain('shot.headline-words');
  });
});

describe('screenshot best practices', () => {
  const profile = {
    app: { supportsIPad: false },
    project: { root: process.cwd(), targets: [{ kind: 'app', devices: ['iphone'] }] },
    features: [{ id: 'streaks', title: 'Seriler', evidence: [{ path: 'package.json' }] }],
  } as unknown as AppProfile;
  const config = VitrinConfig.parse({ app: { locales: ['tr'] }, urls: {} });
  const codes = (shots: unknown, competitors?: unknown) =>
    validateClaims({ config, profile, shots: ShotList.parse(shots), competitors: competitors as never, enabledTargets: [] }).items.map((i) => i.code);
  const shot = (id: string, extra: Record<string, unknown>) => ({ id, slug: `s${id}`, archetype: 'hero', screens: ['home'], featureIds: ['streaks'], copy: { tr: { headline: `Başlık ${id}` } }, ...extra });

  it('warns above five words, rejects CTAs and other platforms', () => {
    const c = codes({ shots: [shot('01', { copy: { tr: { headline: 'bir iki üç dört beş altı', subheadline: 'Hemen indir, Android’de de' } } })] });
    expect(c).toContain('shot.headline-long');
    expect(c).toContain('shot.cta');
    expect(c).toContain('shot.other-platform');
  });

  it('keeps prices, URLs, symbols, Apple recognitions and placeholders off screenshots', () => {
    const c = codes({ shots: [shot('01', { copy: { tr: { headline: '%50 indirim', kicker: 'Günün Uygulaması', subheadline: 'ritim.app © 2026 TODO' } } })] });
    for (const code of ['shot.price', 'shot.url', 'shot.copyright', 'shot.apple-award', 'shot.placeholder']) expect(c).toContain(code);
    const clean = codes({ shots: [shot('01', { copy: { tr: { headline: 'Reklamsız alışkanlık takibi' } } })] });
    expect(clean.filter((x) => ['shot.price', 'shot.url', 'shot.copyright'].includes(x))).toEqual([]);
  });

  it('requires real UI in the first three and checks the 60/40 ratio', () => {
    const statement = (id: string) => shot(id, { archetype: 'statement', screens: [] });
    const c = codes({ shots: [statement('01'), statement('02'), statement('03'), shot('04', {})] });
    expect(c).toContain('shot.first-three-ui');
    expect(c).toContain('shot.real-ui-ratio');
  });

  it('accepts only verbatim own reviews as testimonials', () => {
    const competitors = { self: { trackId: 1, reviews: [{ rating: 5, title: 'Harika', content: 'Serimi ilk kez 40 gün korudum, çok sade.' }] } };
    const ok = codes({ shots: [shot('01', {}), shot('02', { archetype: 'testimonial', screens: [], quotes: { tr: [{ text: 'Serimi ilk kez 40 gün korudum', rating: 5 }] } })] }, competitors);
    expect(ok).not.toContain('quote.unverified');
    const fake = codes({ shots: [shot('01', {}), shot('02', { archetype: 'testimonial', screens: [], quotes: { tr: [{ text: 'Hayatımı değiştirdi', rating: 5 }] } })] }, competitors);
    expect(fake).toContain('quote.unverified');
  });

  it('checks archetype requirements, laurel misuse and duplicate headlines', () => {
    const c = codes({
      shots: [
        shot('01', { archetype: 'callout' }),
        shot('02', { archetype: 'split' }),
        shot('03', { badges: [{ type: 'feature', style: 'laurel', featureId: 'streaks', label: { tr: 'x' } }], copy: { tr: { headline: 'Başlık 01' } } }),
      ],
    });
    expect(c).toContain('shot.callouts');
    expect(c).toContain('shot.screens');
    expect(c).toContain('badge.laurel-without-proof');
    expect(c).toContain('shot.duplicate-headline');
  });
});
