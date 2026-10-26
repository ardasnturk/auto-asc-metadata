import { PreviewPlan } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { resolveDirection } from '@vitrin/render';
import { buildPreviewProps, compositionSize, fitDurations, isLandscape, lookFrom, previewDurationFrames, previewDurationSec, previewTargetId, renderScale, resolveTransitions, type Look, type MediaRef } from '../src/index.js';

const look = { background: ['#000000'], accent: '#FF8A6B', text: '#FFFFFF', textMuted: '#DDDDDD', surface: '#111111', badgeBackground: '#FFFFFF', badgeText: '#111111', headlineFont: 'Inter', bodyFont: 'Inter', headlineWeight: 800, dir: 'ltr', deviceFamily: 'iphone', aspect: 2 } satisfies Look;
const media: MediaRef = { path: 'tr/iphone/home.png', kind: 'image', from: 0, aspect: 2 };

function plan(extra: Record<string, unknown> = {}, beats?: unknown[]) {
  return PreviewPlan.parse({
    id: '01',
    device: 'iphone',
    hook: { tr: 'Günde *tek dokunuş*' },
    hookSource: 'home',
    beats: beats ?? [
      { source: 'home', to: 4, caption: { tr: 'İşaretle' }, featureIds: ['a'] },
      { scene: 'zoom', source: 'detail', to: 4, zoom: { x: 0, y: 0.4, w: 1, h: 0.3 }, caption: { tr: 'Serini *kırma*' }, featureIds: ['a'] },
      { scene: 'badges', source: 'stats', to: 4, badges: [{ icon: 'bell', label: { tr: 'Hatırlatıcı' }, featureId: 'a' }], caption: { tr: 'Hepsi bir arada' }, featureIds: ['a'] },
    ],
    outro: { title: { tr: 'Ritim' } },
    ...extra,
  });
}

describe('preview timing', () => {
  it('keeps durations that already fit 15–30 s', () => {
    expect(fitDurations(3, 3, [6, 6, 4])).toEqual([6, 6, 4]);
  });

  it('subtracts overlapping transitions but not light-leak cuts', () => {
    const scenes = [{ kind: 'text', frames: 60, text: 'a' }, { kind: 'text', frames: 60, text: 'b' }, { kind: 'text', frames: 60, text: 'c' }] as never;
    expect(previewDurationFrames({ scenes, transitions: ['fade', 'leak'], transitionFrames: 15 })).toBe(165);
  });
});

describe('scene list', () => {
  it('builds hook → beats → outro with style transitions', () => {
    const p = buildPreviewProps({ plan: plan(), locale: 'tr', look, hookMedia: media, beats: [{ media }, { media }, { media }] });
    expect(p.scenes.map((s) => s.kind)).toEqual(['hook', 'device', 'zoom', 'badges', 'outro']);
    expect(p.style).toBe('showcase');
    expect(p.transitions).toEqual(['push', 'leak', 'iris', 'leak']);
    expect(p.lightLeaks).toBe(true);
    const badges = p.scenes[3] as Extract<(typeof p.scenes)[number], { kind: 'badges' }>;
    expect(badges.chips[0]!.iconSvg).toContain('<svg');
  });

  it('kinetic puts each caption on its own typography card', () => {
    const p = buildPreviewProps({ plan: plan({ style: 'kinetic' }), locale: 'tr', look, hookMedia: media, beats: [{ media }, { media }, { media }] });
    expect(p.scenes.map((s) => s.kind)).toEqual(['hook', 'text', 'device', 'text', 'zoom', 'text', 'badges', 'outro']);
    expect((p.scenes[2] as { caption: string }).caption).toBe('');
  });

  it('always lands in Apple’s 15–30 s window', () => {
    const many = Array.from({ length: 8 }, () => ({ source: 'home', to: 9, caption: { tr: 'x' }, featureIds: ['a'] }));
    const long = buildPreviewProps({ plan: plan({}, many), locale: 'tr', look, hookMedia: media, beats: many.map(() => ({ media })) });
    expect(previewDurationSec(long)).toBeLessThanOrEqual(30);
    const short = buildPreviewProps({ plan: plan({}, [{ source: 'home', to: 1, caption: { tr: 'x' }, featureIds: ['a'] }]), locale: 'tr', look, hookMedia: media, beats: [{ media }] });
    expect(previewDurationSec(short)).toBeGreaterThanOrEqual(15);
  });

  it('honours an explicit transition and disabled light leaks', () => {
    expect(resolveTransitions({ style: 'showcase', transition: 'auto', lightLeaks: false }, 4)).toEqual(['push', 'fade', 'iris', 'fade']);
    expect(resolveTransitions({ style: 'classic', transition: 'wipe', lightLeaks: true }, 3)).toEqual(['wipe', 'leak', 'wipe']);
  });
});

describe('device frames and landscape previews', () => {
  const ad = resolveDirection({ id: 'x', name: 'x', rationale: '', differentiation: '', preset: 'midnight-glow-pro' });

  it('uses the same HTML frames as the screenshots', () => {
    const look = lookFrom(ad, 'en-US', 'iphone', 2622 / 1206);
    expect(look.frame?.under).toContain('data-family="iphone"');
    expect(look.frame?.under).not.toContain('<img');
    expect(look.frame?.over).toContain('border-radius:999px');
    expect(look.preset).toBe('midnight-glow-pro');
    expect(lookFrom(ad, 'en-US', 'mac', 0.625).frame?.under).toContain('#FF5F57');
    expect(lookFrom(ad, 'en-US', 'tv', 0.5625).frame?.under).toContain('data-family="tv"');
  });

  it('renders Mac and Apple TV previews landscape at 1920×1080', () => {
    expect(compositionSize('iphone')).toEqual({ width: 443, height: 960 });
    expect(compositionSize('ipad')).toEqual({ width: 600, height: 800 });
    expect(compositionSize('mac')).toEqual({ width: 960, height: 540 });
    expect(compositionSize('tv')).toEqual({ width: 960, height: 540 });
    expect(isLandscape('tv')).toBe(true);
    // Vision Pro: authored 960×540 like Mac/TV, rendered at 4× → 3840×2160.
    expect(isLandscape('vision')).toBe(true);
    expect(compositionSize('vision')).toEqual({ width: 960, height: 540 });
    expect(renderScale('vision') * 960).toBe(3840);
    expect(renderScale('iphone')).toBe(2);
    expect(previewTargetId('vision')).toBe('preview-vision');
    expect(previewTargetId('mac')).toBe('preview-mac');
    expect(PreviewPlan.parse({ ...plan().valueOf(), device: 'tv' }).device).toBe('tv');
  });
});
