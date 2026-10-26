import { ArtDirectionOption, StylePreset, type RenderTarget } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildPage,
  contrastRatio,
  deviceGeometry,
  deviceHeightRatio,
  DeviceFrame,
  ensureContrast,
  frameShell,
  largestEmptyBand,
  magentaCoverage,
  parseHeadline,
  planFramings,
  planPortrait,
  PRESETS,
  resolveDirection,
  sampleOption,
  scaledDevices,
  suggestStyles,
  surfaceFor,
  tintTokens,
  visibleSpan,
  widthForHeight,
  type DeviceFamily,
} from '../src/index.js';

const T = (id: string, family: RenderTarget['family'], w: number, h: number, scale: number, kind: RenderTarget['kind'] = 'screenshot'): RenderTarget => ({
  id,
  kind,
  label: id,
  family,
  store: family.startsWith('android') ? 'google-play' : 'app-store',
  platform: family.startsWith('android') ? 'android' : 'ios',
  width: w * scale,
  height: h * scale,
  logical: { width: w, height: h, scale },
  acceptedSizes: [],
  requirement: 'optional',
  defaultEnabled: true,
  formats: ['png'],
});

const PORTRAIT: Array<[RenderTarget, DeviceFamily, number]> = [
  [T('iphone-6.9', 'iphone', 440, 956, 3), 'iphone', 2622 / 1206],
  [T('ipad-13', 'ipad', 1032, 1376, 2), 'ipad', 2752 / 2064],
  [T('play-phone', 'android-phone', 360, 640, 3), 'android-phone', 2400 / 1080],
  [T('play-tablet-10', 'android-tablet', 800, 1280, 2), 'android-tablet', 2560 / 1600],
  [T('duo-outer', 'duo', 699, 1017, 2), 'duo', 2034 / 1398],
];

describe('style presets', () => {
  it('ships at least ten presets plus the classic look, all resolvable', () => {
    expect(StylePreset.options.length).toBeGreaterThanOrEqual(11);
    for (const id of StylePreset.options) {
      const r = resolveDirection({ id: 'x', name: 'x', rationale: '', differentiation: '', preset: id });
      expect(r.tokens.id).toBe(id);
      expect(r.palette.background.length).toBeGreaterThan(0);
      expect(PRESETS[id].surfaces.length).toBeGreaterThan(0);
    }
  });

  it('keeps every headline and emphasis color at WCAG AA on its surface', () => {
    for (const id of StylePreset.options) {
      const r = resolveDirection({ id: 'x', name: 'x', rationale: '', differentiation: '', preset: id });
      for (const sf of r.tokens.surfaces) {
        const under = sf.bg.slice(0, 2);
        for (const b of under) expect(contrastRatio(sf.text, b), `${id} text`).toBeGreaterThanOrEqual(4.5);
        const kind = sf.emphasisKind ?? r.tokens.emphasis;
        if (kind === 'block' || kind === 'pill') expect(contrastRatio(sf.plateText ?? sf.text, sf.plate!), `${id} plate`).toBeGreaterThanOrEqual(4.5);
        else for (const e of sf.emphasis) for (const b of under) expect(contrastRatio(e, b), `${id} emphasis ${e} on ${b}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('tints presets with the brand and keeps the result legible', () => {
    const brand = { primary: '#5B4BE8', secondary: '#FF6B5E' };
    const aurora = resolveDirection({ id: 'x', name: 'x', rationale: '', differentiation: '', preset: 'liquid-glass-aurora' }, brand);
    const plain = PRESETS['liquid-glass-aurora'];
    expect(aurora.tokens.surfaces[0]!.emphasis).not.toEqual(plain.surfaces[0]!.emphasis);
    for (const e of aurora.tokens.surfaces[0]!.emphasis) expect(contrastRatio(e, aurora.tokens.surfaces[0]!.bg[0]!)).toBeGreaterThanOrEqual(4.5);
    // Swiss keeps its signal orange when the brand cannot carry ink type at 4.5:1.
    const swiss = tintTokens(PRESETS['swiss-grid-bold'], { primary: '#1A1A80' });
    expect(swiss.surfaces[0]!.plate).toBe('#FF4F00');
    // Cycling palettes keep their per-slide plates.
    const candy = tintTokens(PRESETS['candy-pop-social'], brand);
    expect(candy.surfaces.map((s) => s.plate)).toEqual(PRESETS['candy-pop-social'].surfaces.map((s) => s.plate));
  });

  it('keeps old art-direction.json files valid and drawn with their own palette', () => {
    const legacy = ArtDirectionOption.parse({
      id: 'night',
      name: 'Night',
      rationale: '',
      differentiation: '',
      palette: { background: ['#120F2E', '#3A2C9C'], surface: '#1E1A47', primary: '#7B6CFF', accent: '#FF8A6B', text: '#FFFFFF', textMuted: '#D9D4FF', badgeBackground: '#FFFFFF', badgeText: '#2A1F7A' },
      typography: { headline: 'Plus Jakarta Sans', body: 'Inter' },
      background: { style: 'mesh' },
      device: { frame: 'minimal' },
    });
    const r = resolveDirection(legacy, { primary: '#00FF00' });
    expect(r.legacy).toBe(true);
    expect(r.tokens.surfaces[0]!.bg).toEqual(['#120F2E', '#3A2C9C']);
    expect(r.tokens.surfaces[0]!.emphasis).toEqual(['#FF8A6B']);
    expect(() => ArtDirectionOption.parse({ id: 'a', name: 'a', rationale: '', differentiation: '' })).toThrow(/preset|palette/);
  });

  it('follows the preset rhythm and inverts on request', () => {
    const swiss = PRESETS['swiss-grid-bold'];
    expect(surfaceFor(swiss, 0).index).toBe(0);
    expect(surfaceFor(swiss, 1).index).toBe(1);
    expect(surfaceFor(PRESETS['liquid-glass-aurora'], 3).index).toBe(0);
    expect(surfaceFor(PRESETS['candy-pop-social'], 2).index).toBe(2);
    expect(surfaceFor(PRESETS['soft-clay-wellness'], 0, true).index).toBe(2);
  });

  it('darkens a pale brand color until it reaches AA', () => {
    const c = ensureContrast('#B49BE6', ['#F7ECF3'], 4.5);
    expect(contrastRatio(c, '#F7ECF3')).toBeGreaterThanOrEqual(4.5);
  });

  it('suggests clearly different presets for the samples', () => {
    const s = suggestStyles(4, 'HEALTH_AND_FITNESS');
    expect(s).toHaveLength(4);
    expect(new Set(s).size).toBe(4);
    expect(s[0]).toBe('neon-athletic-night');
    const dark = s.filter((x) => PRESETS[x].surfaces[0]!.dark).length;
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(4);
    expect(sampleOption('swiss-grid-bold').preset).toBe('swiss-grid-bold');
  });
});

describe('device frames', () => {
  const families: DeviceFamily[] = ['iphone', 'ipad', 'duo', 'mac', 'tv', 'vision', 'watch', 'android-phone', 'android-tablet'];

  it('draws a frame for every family with the capture filling the screen', () => {
    for (const family of families) {
      const html = DeviceFrame({ family, width: 400, aspect: 2, src: 'file:///x.png' });
      expect(html).toContain(`data-family="${family}"`);
      expect(html).toContain('object-fit:cover');
      const g = deviceGeometry(family, 400, 2);
      expect(g.screen.x + g.screen.w).toBeLessThanOrEqual(g.width + 0.01);
      expect(g.screen.y + g.screen.h).toBeLessThanOrEqual(g.height + 0.01);
    }
  });

  it('has family-specific hardware cues', () => {
    expect(DeviceFrame({ family: 'iphone', width: 400, aspect: 2.17, src: 'x' })).toContain('border-radius:999px'); // Dynamic Island
    expect(DeviceFrame({ family: 'android-phone', width: 400, aspect: 2.2, src: 'x' })).toContain('border-radius:50%'); // punch-hole
    expect(DeviceFrame({ family: 'mac', width: 800, aspect: 0.625, src: 'x', variant: { mac: 'window' } })).toContain('#FF5F57'); // traffic lights
    expect(DeviceFrame({ family: 'watch', width: 200, aspect: 1.22, src: 'x' })).toContain('repeating-linear-gradient'); // crown
  });

  it('keeps fixed screen shapes for Mac and TV and the capture aspect elsewhere', () => {
    expect(deviceGeometry('tv', 1600, 2).screen.h / deviceGeometry('tv', 1600, 2).screen.w).toBeCloseTo(9 / 16, 3);
    const mac = deviceGeometry('mac', 1000, 2);
    expect(mac.screen.h / mac.screen.w).toBeCloseTo(0.625, 3);
    const phone = deviceGeometry('iphone', 300, 2.17);
    expect(phone.screen.h / phone.screen.w).toBeCloseTo(2.17, 3);
    expect(widthForHeight('iphone', phone.height, 2.17)).toBeCloseTo(300, 1);
  });

  it('splits the shell for Remotion around the media layer', () => {
    const shell = frameShell('iphone', 2.17);
    expect(shell.under).not.toContain('<img');
    expect(shell.over).toContain('border-radius:999px');
    expect(shell.screen.w).toBeGreaterThan(900);
  });
});

describe('layout math', () => {
  const tokens = PRESETS['vitrin-classic'];

  it('never repeats a framing on adjacent auto shots', () => {
    const shots = ['hero', 'feature', 'feature', 'callout', 'feature', 'split', 'statement'].map((archetype) => ({ archetype, framing: 'auto' }) as const);
    for (const id of StylePreset.options) {
      const f = planFramings(shots as never, PRESETS[id]);
      f.forEach((x, i) => {
        if (i > 0 && x !== 'no-device') expect(x, `${id} ${i}`).not.toBe(f[i - 1]);
      });
      expect(f[0]).toBe('bleed-bottom');
      expect(f.at(-1)).toBe('no-device');
    }
  });

  it('keeps upright presets upright and contained families contained', () => {
    expect(planFramings([{ archetype: 'tilted', framing: 'auto' }] as never, PRESETS['liquid-glass-aurora'])[0]).not.toBe('tilted');
    expect(planFramings([{ archetype: 'tilted', framing: 'auto' }] as never, PRESETS['neon-athletic-night'])[0]).toBe('tilted');
    expect(planFramings([{ archetype: 'hero', framing: 'auto' }] as never, tokens, 'tv')[0]).toBe('contained');
    expect(planFramings([{ archetype: 'tilted', framing: 'tilted' }] as never, PRESETS['neon-athletic-night'], 'duo')[0]).not.toBe('tilted');
  });

  it('anchors the device to an edge at 68–82 % of the canvas height', () => {
    for (const [target, family, aspect] of PORTRAIT) {
      const { width: W, height: H } = target.logical;
      for (const framing of ['bleed-bottom', 'bleed-top', 'offset', 'tilted', 'two-devices'] as const) {
        const t = framing === 'tilted' ? PRESETS['neon-athletic-night'] : tokens;
        const plan = planPortrait({ W, H, t, family, framing, archetype: framing === 'two-devices' ? 'split' : 'hero', screens: [{ aspect }, { aspect }], index: 1 });
        const devices = scaledDevices(plan);
        const ratio = deviceHeightRatio(devices, H);
        expect(ratio, `${target.id} ${framing}`).toBeGreaterThanOrEqual(0.66);
        expect(ratio, `${target.id} ${framing}`).toBeLessThanOrEqual(0.82);
        // Anchored: the device group touches the canvas edge opposite the caption (no floating with two bands).
        const spans = devices.map((d) => visibleSpan(d, H));
        const edge = plan.captionSide === 'top' ? Math.max(...spans.map((s) => s[1])) : Math.min(...spans.map((s) => s[0]));
        expect(Math.abs(edge - (plan.captionSide === 'top' ? H : 0)), `${target.id} ${framing} edge`).toBeLessThan(1);
        // Caption + device leave no empty band larger than 22 %.
        const band = largestEmptyBand([[plan.caption.y, plan.caption.y + plan.caption.h], ...spans], H);
        expect(band, `${target.id} ${framing} band`).toBeLessThanOrEqual(0.22);
      }
    }
  });

  it('contains watches and stands Japandi phones on the shelf', () => {
    const watch = planPortrait({ W: 211, H: 257, t: tokens, family: 'watch', framing: 'contained', archetype: 'hero', screens: [{ aspect: 1.22 }], index: 0 });
    const d = watch.devices[0]!;
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.y + d.h).toBeLessThanOrEqual(257);
    expect(watch.rule).toBe('contained');
    const jp = planPortrait({ W: 440, H: 956, t: PRESETS['quiet-japandi'], family: 'iphone', framing: 'bleed-bottom', archetype: 'hero', screens: [{ aspect: 2.17 }], index: 0 });
    expect(jp.devices[0]!.y + jp.devices[0]!.h).toBeCloseTo(956 * 0.95, 0);
  });

  it('measures empty bands including the canvas edges', () => {
    expect(largestEmptyBand([[0, 100], [300, 1000]], 1000)).toBeCloseTo(0.2);
    expect(largestEmptyBand([[100, 900]], 1000)).toBeCloseTo(0.1);
    expect(largestEmptyBand([], 1000)).toBe(1);
  });

  it('parses emphasis and explicit line breaks', () => {
    expect(parseHeadline('Keep your *streak*\nalive').lines).toEqual([
      [
        { text: 'Keep your ', em: false },
        { text: 'streak', em: true },
      ],
      [{ text: 'alive', em: false }],
    ]);
  });

  it('builds pages for every target family, store graphic and preset', () => {
    const screen = { src: 'file:///x.png', aspect: 2.17, family: 'iphone' as const };
    const wide = { src: 'file:///x.png', aspect: 0.625, family: 'mac' as const };
    const targets: Array<[RenderTarget, typeof screen | typeof wide]> = [
      ...PORTRAIT.map(([t]) => [t, screen] as [RenderTarget, typeof screen]),
      [T('mac-16x10', 'mac', 1440, 900, 2), wide],
      [T('appletv-4k', 'tv', 1920, 1080, 2), { ...wide, family: 'tv' as never, aspect: 0.5625 }],
      [T('vision-pro', 'vision', 1920, 1080, 2), { ...wide, family: 'vision' as never, aspect: 0.5625 }],
      [T('watch-ultra', 'watch', 211, 257, 2), { ...screen, family: 'watch' as never, aspect: 1.22 }],
      [T('header', 'any', 1920, 823, 2, 'creative'), screen],
    ];
    for (const id of StylePreset.options) {
      const ad = { id: 'x', name: 'x', rationale: '', differentiation: '', preset: id };
      for (const [target, s] of targets) {
        const html = buildPage({ target, locale: 'en-US', ad, archetype: 'hero', headline: 'Keep your *streak*', subheadline: 'One tap a day', kicker: 'Habits', badges: [], screens: [s], appName: 'Ritim' });
        expect(html).toContain(`data-preset="${id}"`);
        expect(html).toContain('class="w"');
      }
    }
    const fg = buildPage({ target: T('play-feature-graphic', 'any', 1024, 500, 1, 'creative'), locale: 'en-US', ad: { id: 'x', name: 'x', rationale: '', differentiation: '', preset: 'midnight-glow-pro' }, archetype: 'hero', headline: 'Keep your *streak*', subheadline: '', badges: [], screens: [], appName: 'Ritim' });
    expect(fg).toContain('data-layout="feature-graphic"');
    expect(fg).not.toContain('class="device');
    const icon = buildPage({ target: T('play-icon', 'any', 512, 512, 1, 'creative'), locale: 'en-US', ad: { id: 'x', name: 'x', rationale: '', differentiation: '', preset: 'midnight-glow-pro' }, archetype: 'hero', headline: 'x', subheadline: '', badges: [], screens: [], appName: 'Ritim' });
    expect(icon).toContain('data-layout="icon"');
  });

  it('renders the new archetypes and marks the cross-canvas bridge', () => {
    const t = PORTRAIT[0]![0];
    const ad = { id: 'x', name: 'x', rationale: '', differentiation: '', preset: 'liquid-glass-aurora' as const };
    const screen = { src: 'file:///x.png', aspect: 2.17, family: 'iphone' as const };
    const wall = buildPage({ target: t, locale: 'en', ad, archetype: 'feature-wall', headline: 'And *more*', subheadline: '', badges: [], screens: [], wall: ['Widgets', 'Dark mode', 'Sync'] });
    expect((wall.match(/class="wall-line"/g) ?? []).length).toBe(3);
    const mosaic = buildPage({ target: t, locale: 'en', ad, archetype: 'mosaic', headline: 'All of it', subheadline: '', badges: [], screens: [screen, screen, screen] });
    expect((mosaic.match(/mosaic-card/g) ?? []).length).toBe(3);
    const out = buildPage({ target: t, locale: 'en', ad, archetype: 'hero', headline: 'x', subheadline: '', badges: [], screens: [screen], bridgeOut: true });
    const plain = buildPage({ target: t, locale: 'en', ad, archetype: 'hero', headline: 'x', subheadline: '', badges: [], screens: [screen] });
    expect(out.length).toBeGreaterThan(plain.length);
  });
});

describe('quality gate helpers', () => {
  it('derives glyph coverage from the magenta mask', () => {
    expect(magentaCoverage('#FFFFFF', '#FF00FF')).toBe(255);
    expect(magentaCoverage('#202020', '#202020')).toBe(0);
    expect(magentaCoverage('#000000', '#800080')).toBeGreaterThan(120);
  });
});
