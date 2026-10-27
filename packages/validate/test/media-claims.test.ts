import { loadTargets } from '@vitrin/core';
import { CppSuggestions, experimentDays, ExperimentPlan, ShotList, VideoPlan, VitrinConfig, type AppProfile } from '@vitrin/schemas';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkVideo, h264ProfileName, sizeAccepted, validateClaims, validateScreenshots } from '../src/index.js';

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

describe('borrowed captures and Google Play counts', () => {
  it('rejects iOS UI on Google Play, a wrong language in the first shots and a single Play screenshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-play-'));
    mkdirSync(join(dir, 'tr'));
    const png = (name: string, w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } }).png().toFile(join(dir, 'tr', name));
    await png('01_hero_play-phone.png', 1080, 1920);
    await png('01_hero_iphone-6.3.png', 1206, 2622);
    await png('05_more_iphone-6.3.png', 1206, 2622);
    const image = (file: string, target: string, shot: string, capture: { families: string[]; locales: string[] }) => ({ file: join(dir, 'tr', file), target, locale: 'tr', shot, width: 1, height: 1, overflow: [], safeAreaViolations: [], capture });
    const manifest = {
      generatedAt: '',
      artDirection: 'x',
      videos: [],
      images: [
        image('01_hero_play-phone.png', 'play-phone', '01', { families: ['iphone'], locales: ['tr'] }),
        image('01_hero_iphone-6.3.png', 'iphone-6.3', '01', { families: ['iphone'], locales: ['en-US'] }),
        image('05_more_iphone-6.3.png', 'iphone-6.3', '05', { families: ['iphone'], locales: ['en-US'] }),
      ],
    };
    const issues = await validateScreenshots({ screenshotsDir: dir, locales: ['tr'], targets: [t('iphone-6.3'), t('play-phone')], manifest });
    const of = (code: string) => issues.items.filter((i) => i.code === code);
    expect(of('image.ios-ui-on-play')).toHaveLength(1);
    expect(of('image.language-mismatch').map((i) => i.severity)).toEqual(['error', 'warning']);
    expect(of('image.too-few')).toHaveLength(1);
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
  it('reads numeric H.264 profile ids as names', () => {
    expect(h264ProfileName('100')).toBe('High');
    expect(h264ProfileName('77')).toBe('Main');
    expect(h264ProfileName('High')).toBe('High');
    expect(checkVideo({ ...base, profile: h264ProfileName('110') }, t('preview-iphone'), 'x').items.map((i) => i.code)).toContain('video.profile');
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

  it('checks In-App Event copy limits, the deep link and Apple’s schedule rules', () => {
    const creative = { copy: { tr: { headline: 'Seri' } }, screens: ['home'], featureIds: ['streaks'] };
    const event = (over: Record<string, unknown>) => ({ id: 'kis', badge: 'CHALLENGE', name: { tr: 'Kış serisi' }, shortDescription: { tr: 'Her gün tek dokunuş.' }, longDescription: { tr: 'Kış boyunca serini koru.' }, card: creative, detail: creative, ...over });
    const codes = (e: Record<string, unknown>) => validateClaims({ config, profile, shots: ShotList.parse({ shots: [{ id: '01', slug: 'a', archetype: 'hero', screens: ['home'], featureIds: ['streaks'], copy: { tr: { headline: 'Serini koru' } } }], creatives: { events: [event(e)] } }), enabledTargets: [] }).items.map((i) => i.code);
    const base = codes({});
    expect(base).toContain('event.deep-link');
    expect(base).toContain('event.no-schedule');
    expect(codes({ name: { tr: 'Kış boyunca her gün serini koruma yarışması' } })).toContain('event.too-long');
    expect(codes({ shortDescription: {} })).toContain('event.missing-copy');
    const day = 24 * 3600 * 1000;
    const at = (d: number) => new Date(Date.now() + d * day).toISOString();
    expect(codes({ deepLink: 'ritim://kis', schedule: { territories: ['TUR'], publishStart: at(5), eventStart: at(10), eventEnd: at(20) } }).filter((c) => c.startsWith('event.'))).toEqual([]);
    expect(codes({ schedule: { territories: ['TUR'], eventStart: at(10), eventEnd: at(50) } })).toContain('event.schedule');
    expect(codes({ schedule: { territories: ['TUR'], publishStart: at(1), eventStart: at(20), eventEnd: at(21) } })).toContain('event.schedule');
    expect(codes({ schedule: { territories: ['TUR'], eventStart: 'yarın', eventEnd: at(2) } })).toContain('event.schedule');
  });

  it('asks Custom Product Pages for their own shots and checks them against shots.json', () => {
    const shots = ShotList.parse({ shots: [{ id: '01', slug: 'a', archetype: 'hero', screens: ['home'], featureIds: ['streaks'], copy: { tr: { headline: 'Serini koru' } } }] });
    const cpp = CppSuggestions.parse({
      pages: [
        { id: 'empty', name: 'Empty', segment: '', rationale: '' },
        { id: 'water', name: 'Water', segment: '', rationale: '', shots: ['01', '07'], copy: { '05': { tr: { headline: 'Su' } } } },
      ],
    });
    const c = validateClaims({ config, profile, shots, cpp, enabledTargets: [] }).items.map((i) => i.code);
    expect(c).toContain('cpp.no-shots');
    expect(c).toContain('cpp.unknown-shot');
    expect(c).toContain('cpp.copy-unused');
  });

  it('checks Product Page Optimization tests: hypothesis, one change per treatment, shots and duration', () => {
    const shots = ShotList.parse({ shots: ['01', '02', '03'].map((id) => ({ id, slug: `s${id}`, archetype: 'hero', screens: ['home'], featureIds: ['streaks'], copy: { tr: { headline: 'Serini koru' } } })) });
    const hypothesis = 'Kahraman sonuç vaat ederse dönüşüm artar, çünkü insanlar sonucu arıyor.';
    const run = (experiments: unknown[]) => validateClaims({ config, profile, shots, experiments: ExperimentPlan.parse({ experiments }), enabledTargets: [] }).items.map((i) => i.code);
    const test = (treatments: unknown[], over: Record<string, unknown> = {}) => ({ id: 'hero', name: 'Hero', hypothesis, treatments, ...over });
    const copy = { '01': { tr: { headline: 'Hiçbir günü kaçırma' } } };
    expect(run([test([{ id: 'a', name: 'A', change: 'copy', copy }])]).filter((c) => c.startsWith('experiment.') && c !== 'experiment.duration-unknown')).toEqual([]);
    expect(run([test([{ id: 'a', name: 'A', change: 'nothing' }])])).toContain('experiment.no-change');
    expect(run([test([{ id: 'a', name: 'A', change: 'same order', shots: ['01', '02', '03'] }])])).toContain('experiment.no-change');
    expect(run([test([{ id: 'a', name: 'A', change: 'two things', shots: ['02', '01', '03'], copy }])])).toContain('experiment.many-changes');
    expect(run([test([{ id: 'a', name: 'A', change: 'order', shots: ['09'] }])])).toContain('experiment.unknown-shot');
    expect(run([test([{ id: 'a', name: 'A', change: 'copy', copy }], { hypothesis: 'Daha iyi' })])).toContain('experiment.hypothesis');
    expect(run([test([{ id: 'a', name: 'A', change: 'copy', copy }], { element: 'icon' })])).toContain('experiment.element');
    expect(run([test([{ id: 'a', name: 'A', change: 'copy', copy }]), test([{ id: 'b', name: 'B', change: 'copy', copy }], { id: 'two' })])).toContain('experiment.one-at-a-time');
    expect(run([test([{ id: 'a', name: 'A', change: 'copy', copy }], { result: { endedAt: '2026-10-01', winner: 'b' } })])).toContain('experiment.result');
    expect(run([test([{ id: 'a', name: 'A', change: 'copy', copy }], { dailyPageViews: 50, baselineConversion: 0.3 })])).toContain('experiment.too-slow');
  });

  it('estimates test duration from page views, conversion and the smallest arm', () => {
    const base = { minimumDetectableEffect: 0.1, trafficProportion: 50, treatments: [{}] as never };
    expect(experimentDays({ ...base })).toBeUndefined();
    // 16 · 0.3 · 0.7 / 0.03² ≈ 3734 visitors per arm; 2000 views × 50 % = 1000 a day per arm.
    expect(experimentDays({ ...base, dailyPageViews: 2000, baselineConversion: 0.3 })).toBe(4);
    // Two treatments share the test half: 500 a day each.
    expect(experimentDays({ ...base, treatments: [{}, {}] as never, dailyPageViews: 2000, baselineConversion: 0.3 })).toBe(8);
  });

  it('checks shots that reach Google Play and a missing Play icon', () => {
    const shot = (over: Record<string, unknown>) => ({ id: '01', slug: 'a', archetype: 'hero', screens: ['home'], featureIds: ['streaks'], copy: { tr: { headline: 'Serini koru' } }, ...over });
    const run = (shots: unknown[], targets: string[]) => validateClaims({ config, profile, shots: ShotList.parse({ shots }), enabledTargets: targets }).items.map((i) => i.code);
    const best = shot({ copy: { tr: { headline: 'En iyi alışkanlık uygulaması' } } });
    expect(run([best], ['iphone-6.9', 'play-phone'])).toContain('shot.play-superlative');
    // App Store only: the shot does not reach Play, or Play is not enabled.
    expect(run([{ ...best, targets: ['iphone-6.9'] }], ['iphone-6.9', 'play-phone'])).not.toContain('shot.play-superlative');
    expect(run([best], ['iphone-6.9'])).not.toContain('shot.play-superlative');
    expect(run([shot({ copy: { tr: { headline: 'Apple Watch ile seri' } } })], ['play-phone'])).toContain('shot.play-apple-term');
    expect(run([shot({ archetype: 'testimonial' })], ['play-phone'])).toContain('shot.play-testimonial');
    expect(run([shot({})], ['play-icon'])).toContain('icon.missing');
  });

  it('checks flow beats and the optional closing line of a video plan', () => {
    const preview = (beats: unknown[], outro?: unknown) => VideoPlan.parse({ previews: [{ id: '01', device: 'iphone', hook: { tr: 'Serini *koru*' }, hookSource: 'home', beats, outro }] });
    const codes = (plan: VideoPlan) => validateClaims({ config, profile, videoPlan: plan, enabledTargets: [] }).items.map((i) => i.code);
    const flow = { scene: 'flow', to: 3, caption: {}, featureIds: ['streaks'], steps: [{ source: 'home', tap: { x: 0.5, y: 0.5 } }, { source: 'home-done', change: 'fade' }] };
    // A flow needs no beat-level source or caption, and the closing line is optional.
    expect(codes(preview([flow])).filter((c) => c.startsWith('video.'))).toEqual([]);
    expect(codes(preview([{ ...flow, steps: flow.steps.slice(0, 1) }]))).toContain('video.beat-flow');
    expect(codes(preview([{ ...flow, to: 1, steps: [...flow.steps, { source: 'stats' }] }]))).toContain('video.flow-fast');
    expect(codes(preview([flow], { title: { en: 'x' } }))).toContain('video.missing-copy');
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

  it('checks bullet lines like copy and needs the photo in metadata/photos', () => {
    const c = codes({ shots: [shot('01', { bullets: [{ tr: 'Hemen indir' }, { tr: 'Her alışkanlık için ayrı hatırlatıcı ve seri' }, { en: 'x' }] })] });
    expect(c).toContain('shot.cta');
    expect(c).toContain('shot.bullet-long');
    expect(c).toContain('shot.bullet-missing');
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-photos-'));
    const photo = (file: string) => validateClaims({ config, profile, shots: ShotList.parse({ shots: [shot('01', { photo: file })] }), enabledTargets: [], photosDir: dir }).items.map((i) => i.code);
    expect(photo('hero.jpg')).toContain('shot.photo-missing');
    expect(photo('hero.jpg')).toContain('shot.photo-rights');
    expect(() => ShotList.parse({ shots: [shot('01', { photo: '../secret.jpg' })] })).toThrow();
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
