import { PreviewPlan } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { resolveDirection } from '@vitrin/render';
import { buildPreviewProps, compositionSize, cutFrames, fitDurations, flowTiming, isLandscape, kineticCardBeats, lookFrom, previewDurationFrames, previewDurationSec, previewTargetId, renderScale, resolveTransitions, type Look, type MediaRef, type Scene } from '../src/index.js';

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

  it('kinetic puts at most two captions on typography cards, the rest stay on the UI beat', () => {
    const p = buildPreviewProps({ plan: plan({ style: 'kinetic' }), locale: 'tr', look, hookMedia: media, beats: [{ media }, { media }, { media }] });
    expect(p.scenes.map((s) => s.kind)).toEqual(['hook', 'text', 'device', 'zoom', 'text', 'badges', 'outro']);
    expect((p.scenes[2] as { caption: string }).caption).toBe('');
    expect((p.scenes[3] as { caption: string }).caption).toBe('Serini *kırma*');
    // Explicit text beats use up the same budget.
    const withText = plan({ style: 'kinetic' }, [
      { scene: 'text', to: 1, caption: { tr: 'Merhaba' }, featureIds: ['a'] },
      { source: 'home', to: 2, caption: { tr: 'İşaretle' }, featureIds: ['a'] },
      { source: 'home', to: 2, caption: { tr: 'Gör' }, featureIds: ['a'] },
    ]);
    expect([...kineticCardBeats(withText, 'tr')]).toEqual([1]);
    expect(kineticCardBeats(plan(), 'tr').size).toBe(0);
  });

  it('ends on the outcome screen instead of an icon card, or on the last beat without an outro', () => {
    const last: MediaRef = { ...media, path: 'tr/iphone/stats.png' };
    const p = buildPreviewProps({ plan: plan(), locale: 'tr', look, hookMedia: media, beats: [{ media }, { media }, { media: last }] });
    const outro = p.scenes.at(-1) as Extract<Scene, { kind: 'outro' }>;
    expect(outro).toMatchObject({ kind: 'outro', title: 'Ritim', media: last });
    expect('icon' in p).toBe(false);
    const own = buildPreviewProps({ plan: plan(), locale: 'tr', look, hookMedia: media, beats: [{ media }, { media }, { media: last }], outroMedia: media });
    expect((own.scenes.at(-1) as Extract<Scene, { kind: 'outro' }>).media).toBe(media);
    const none = buildPreviewProps({ plan: plan({ outro: undefined }), locale: 'tr', look, hookMedia: media, beats: [{ media }, { media }, { media }] });
    expect(none.scenes.at(-1)!.kind).toBe('badges');
  });

  it('builds a flow beat from its steps, and needs a source for every step', () => {
    const flow = { scene: 'flow', to: 4, caption: { tr: 'Dokun, *bitti*' }, featureIds: ['a'], steps: [{ source: 'home', tap: { x: 0.5, y: 0.4 } }, { source: 'home-done', change: 'fade' }, { source: 'stats', change: 'scroll' }] };
    const done: MediaRef = { ...media, path: 'tr/iphone/home-done.png' };
    const p = buildPreviewProps({ plan: plan({}, [flow]), locale: 'tr', look, hookMedia: media, beats: [{ steps: [media, done, media] }] });
    const scene = p.scenes[1] as Extract<Scene, { kind: 'flow' }>;
    expect(scene.kind).toBe('flow');
    expect(scene.steps.map((s) => s.change)).toEqual(['push', 'fade', 'scroll']);
    expect(scene.steps[0]!.tap).toEqual({ x: 0.5, y: 0.4 });
    expect(scene.steps[1]!.media).toBe(done);
    expect(() => buildPreviewProps({ plan: plan({}, [flow]), locale: 'tr', look, hookMedia: media, beats: [{ steps: [media] }] })).toThrow(/home-done/);
  });

  it('always lands in Apple’s 15–30 s window', () => {
    const many = Array.from({ length: 8 }, () => ({ source: 'home', to: 9, caption: { tr: 'x' }, featureIds: ['a'] }));
    const long = buildPreviewProps({ plan: plan({}, many), locale: 'tr', look, hookMedia: media, beats: many.map(() => ({ media })) });
    expect(previewDurationSec(long)).toBeLessThanOrEqual(30);
    const short = buildPreviewProps({ plan: plan({}, [{ source: 'home', to: 1, caption: { tr: 'x' }, featureIds: ['a'] }]), locale: 'tr', look, hookMedia: media, beats: [{ media }] });
    expect(previewDurationSec(short)).toBeGreaterThanOrEqual(15);
  });

  it('taps land just before the next screen arrives; changes fit their slot', () => {
    const t = flowTiming([{ tap: { x: 0.5, y: 0.5 }, change: 'push' }, { tap: { x: 0.2, y: 0.2 }, change: 'fade' }, { change: 'cut' }], 120, 30);
    expect(t.arrive[0]).toBe(0);
    expect(t.arrive[1]!).toBeLessThan(t.arrive[2]!);
    expect(t.taps[0]!).toBeLessThan(t.arrive[1]!);
    expect(t.arrive[1]! - t.taps[0]!).toBeLessThan(5);
    expect(t.change).toEqual([0, Math.round(0.25 * 30), 0]);
    // A tight flow shortens the change instead of overrunning the next screen.
    const fast = flowTiming([{ change: 'push' }, { change: 'push' }, { change: 'push' }, { change: 'scroll' }], 45, 30);
    for (let i = 1; i < 3; i++) expect(fast.arrive[i]! + fast.change[i]!).toBeLessThanOrEqual(fast.arrive[i + 1]!);
  });

  it('puts cut points in the middle of overlapping transitions', () => {
    const scenes = [{ kind: 'text', frames: 60, text: 'a' }, { kind: 'text', frames: 60, text: 'b' }, { kind: 'text', frames: 60, text: 'c' }] as never;
    expect(cutFrames({ scenes, transitions: ['fade', 'leak'], transitionFrames: 10 })).toEqual([55, 110]);
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
