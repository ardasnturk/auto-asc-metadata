import { getTarget } from '@vitrin/core';
import type { ArtDirectionOption } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { buildPage, contrastRatio, fontSetup, lucideIconExists, paletteContrast } from '../src/index.js';

const ad: ArtDirectionOption = {
  id: 'a',
  name: 'A',
  rationale: '',
  differentiation: '',
  palette: { background: ['#120F2E', '#3A2C9C'], surface: '#1E1A47', primary: '#7B6CFF', accent: '#FF8A6B', text: '#FFFFFF', textMuted: '#D9D4FF', badgeBackground: '#FFFFFF', badgeText: '#2A1F7A' },
  typography: { headline: 'Plus Jakarta Sans', body: 'Inter', headlineWeight: 800, headlineCase: 'none', letterSpacing: -0.02 },
  background: { style: 'mesh', angle: 160, intensity: 0.5 },
  device: { frame: 'minimal', shadow: true, tilt: 0 },
};

describe('colour', () => {
  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1);
    expect(paletteContrast(ad)).toBeGreaterThan(3);
    expect(paletteContrast({ ...ad, palette: { ...ad.palette, text: '#3A2C9C' } })).toBeLessThan(3);
  });
});

describe('page builder', () => {
  const screen = { src: 'file:///x.png', aspect: 2622 / 1206, family: 'iphone' as const };

  it('builds a page at the logical size with escaped copy', () => {
    const html = buildPage({ target: getTarget('iphone-6.9'), locale: 'tr', ad, archetype: 'hero', headline: 'Serini <koru>', subheadline: 'alt', badges: [], screens: [screen] });
    expect(html).toContain('width:440px; height:956px');
    expect(html).toContain('>Serini</span>');
    expect(html).toContain('&lt;koru&gt;');
    expect(html).not.toContain('<koru>');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('Plus Jakarta Sans Variable');
  });

  it('switches to RTL and script fallbacks per locale', () => {
    const ar = fontSetup('Inter', 'Inter', 'ar-SA');
    expect(ar.dir).toBe('rtl');
    expect(ar.headlineStack).toContain('Noto Sans Arabic Variable');
    expect(fontSetup('Inter', 'Inter', 'ja').headlineStack).toContain('Noto Sans JP Variable');
    expect(() => fontSetup('Comic Sans', 'Inter', 'tr')).toThrow(/Unknown headline font/);
  });

  it('uses a landscape layout for the 21:9 header', () => {
    const html = buildPage({ target: getTarget('header'), locale: 'en-US', ad, archetype: 'hero', headline: 'Find your rhythm', subheadline: '', badges: [], screens: [screen, screen] });
    expect(html).toContain('data-layout="landscape"');
  });

  it('renders every archetype without throwing', () => {
    for (const archetype of ['hero', 'feature', 'split', 'collage', 'before-after', 'stat', 'social-proof', 'panoramic'] as const) {
      const html = buildPage({ target: getTarget('ipad-13'), locale: 'tr', ad, archetype, headline: 'Başlık', subheadline: '', stat: '42', badges: [{ type: 'feature', featureId: 'x', label: { tr: 'Rozet' } }], screens: [screen, screen, screen] });
      expect(html.length).toBeGreaterThan(1000);
    }
  });

  it('ships Lucide icons', () => {
    expect(lucideIconExists('flame')).toBe(true);
    expect(lucideIconExists('calendar-days')).toBe(true);
  });
});

describe('new archetypes', () => {
  const screen = { src: 'file:///x.png', aspect: 2622 / 1206, family: 'iphone' as const };
  it('renders kicker, accent markup, callouts, quotes and bottom captions', () => {
    const t = getTarget('iphone-6.3');
    const hero = buildPage({ target: t, locale: 'tr', ad, archetype: 'hero', kicker: 'Takip', headline: 'Serini *kırma*', subheadline: '', badges: [], screens: [screen] });
    expect(hero).toContain('class="kicker"');
    expect(hero).toMatch(/<span class="em em-color" style="color:#FF8A6B"><span class="w"[^>]*>kırma<\/span>/);
    const callout = buildPage({ target: t, locale: 'tr', ad, archetype: 'callout', headline: 'x', subheadline: '', badges: [], screens: [screen], callouts: [{ screen: 0, rect: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, rects: {}, scale: 1.4, side: 'center', at: 0.5 }] });
    expect(callout).toContain('class="callout');
    const ipad = buildPage({ target: getTarget('ipad-13'), locale: 'tr', ad, archetype: 'callout', headline: 'x', subheadline: '', badges: [], screens: [{ ...screen, family: 'ipad' }], callouts: [{ screen: 0, rect: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, rects: {}, scale: 1.4, side: 'center', at: 0.5 }] });
    expect(ipad).not.toContain('class="callout');
    const quotes = buildPage({ target: t, locale: 'tr', ad, archetype: 'testimonial', headline: 'x', subheadline: '', badges: [], screens: [], quotes: [{ text: 'Çok sade', rating: 5 }] });
    expect(quotes).toContain('“Çok sade”');
    const bottom = buildPage({ target: t, locale: 'tr', ad, archetype: 'fullbleed', captionPosition: 'bottom', headline: 'x', subheadline: '', badges: [], screens: [screen] });
    expect(bottom).toContain('data-bottom="1"');
    expect(bottom).toContain('data-family="iphone"');
  });
});
