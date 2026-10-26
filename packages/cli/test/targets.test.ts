import { enabledTargets, selectedPlatforms } from '@vitrin/core';
import type { AppProfile, Platform, VitrinConfig } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { configWith, profileWith } from './helpers.js';

const ids = (config: VitrinConfig, profile?: AppProfile) => enabledTargets(config, profile).map((t) => t.id);
const ios = (extra: Partial<AppProfile['app']> = {}) => profileWith({ platforms: ['ios'], supportsIPhone: true, ...extra });

describe('enabledTargets', () => {
  it('keeps the iOS-only default without a profile', () => {
    const list = ids(configWith());
    expect(list).toEqual(expect.arrayContaining(['iphone-6.3', 'iphone-6.9', 'ipad-13', 'duo-outer', 'duo-inner', 'preview-iphone', 'header', 'search']));
    expect(list.some((id) => /^(play-|mac-|watch-|appletv|vision-)/.test(id))).toBe(false);
  });

  it('gates iPad and Duo by their flags', () => {
    expect(ids(configWith(), ios())).not.toContain('ipad-13');
    expect(ids(configWith(), ios())).not.toContain('duo-outer');
    expect(ids(configWith(), ios({ supportsIPad: true, supportsDuo: true }))).toEqual(expect.arrayContaining(['ipad-13', 'duo-outer', 'duo-inner']));
  });

  it('enables exactly the detected platforms', () => {
    const cases: Array<[Platform[], string[], string[]]> = [
      [['macos'], ['mac-16x10'], ['iphone-6.3', 'header', 'play-phone']],
      [['ios', 'watchos'], ['iphone-6.3', 'watch-ultra'], ['watch-series', 'mac-16x10']],
      [['tvos'], ['appletv-4k'], ['iphone-6.3', 'preview-tv']],
      [['ios', 'visionos'], ['iphone-6.3', 'vision-pro'], ['appletv-4k']],
      [['android'], ['play-phone', 'play-feature-graphic', 'play-icon'], ['iphone-6.3', 'play-tablet-7', 'header']],
    ];
    for (const [platforms, on, off] of cases) {
      const list = ids(configWith(), profileWith({ platforms, supportsIPhone: platforms.includes('ios') }));
      for (const id of on) expect(list, `${platforms} → ${id}`).toContain(id);
      for (const id of off) expect(list, `${platforms} ✗ ${id}`).not.toContain(id);
    }
  });

  it('enables Google Play tablets only with tablet layouts', () => {
    const p = profileWith({ platforms: ['android'], supportsIPhone: false, supportsAndroidTablet: true });
    expect(ids(configWith(), p)).toEqual(expect.arrayContaining(['play-tablet-7', 'play-tablet-10']));
  });

  it('skips iPhone targets for apps that do not run on iPhone', () => {
    const list = ids(configWith(), profileWith({ platforms: ['ios'], supportsIPhone: false, supportsIPad: true }));
    expect(list).toContain('ipad-13');
    expect(list).not.toContain('iphone-6.3');
  });

  it('config enable forces a target on, disable always wins', () => {
    const config = configWith({ targets: { enable: ['mac-16x10', 'preview-mac'], disable: ['iphone-6.9'] } });
    const list = ids(config, ios());
    expect(list).toEqual(expect.arrayContaining(['mac-16x10', 'preview-mac']));
    expect(list).not.toContain('iphone-6.9');
  });

  it('previews follow video.enabled', () => {
    expect(ids(configWith({ video: { enabled: false, loops: true } }), ios())).not.toContain('preview-iphone');
  });
});

describe('selection', () => {
  const multi = profileWith({ platforms: ['ios', 'watchos', 'android'], supportsIPhone: true, supportsIPad: true });

  it('limits targets to the selected platforms', () => {
    const list = ids(configWith({ selection: { platforms: ['watchos'] } }), multi);
    expect(list).toEqual(['watch-ultra']);
  });

  it('limits asset kinds', () => {
    const shots = enabledTargets(configWith({ selection: { assets: ['screenshots'] } }), multi);
    expect(new Set(shots.map((t) => t.kind))).toEqual(new Set(['screenshot']));
    const previews = ids(configWith({ selection: { platforms: ['ios'], assets: ['previews'] } }), multi);
    // Explicitly chosen previews include the opt-in iPad preview for an iPad app.
    expect(previews.sort()).toEqual(['preview-ipad', 'preview-iphone']);
    const creatives = ids(configWith({ selection: { platforms: ['android'], assets: ['creatives'] } }), multi);
    expect(creatives.sort()).toEqual(['play-feature-graphic', 'play-icon']);
    const events = ids(configWith({ selection: { platforms: ['ios'], assets: ['events'] } }), multi);
    expect(events.sort()).toEqual(['event-card', 'event-detail']);
  });

  it('beats targets.enable', () => {
    const list = ids(configWith({ selection: { platforms: ['ios'] }, targets: { enable: ['play-phone'], disable: [] } }), multi);
    expect(list).not.toContain('play-phone');
  });

  it('includes selected platforms that were not detected, and reports them', () => {
    const config = configWith({ selection: { platforms: ['ios', 'tvos'] } });
    const p = ios();
    expect(selectedPlatforms(config, p)).toEqual({ platforms: ['ios', 'tvos'], undetected: ['tvos'] });
    expect(ids(config, p)).toEqual(expect.arrayContaining(['iphone-6.3', 'appletv-4k']));
    // An undetected iOS still gets its required iPhone set.
    expect(ids(configWith({ selection: { platforms: ['ios'] } }), profileWith({ platforms: ['android'], supportsIPhone: false }))).toContain('iphone-6.3');
  });

  it('limits formats to selection.targets unless allFormats is asked for', () => {
    const config = configWith({ selection: { targets: ['iphone-6.9', 'watch-ultra'] } });
    expect(ids(config, multi).sort()).toEqual(['iphone-6.9', 'watch-ultra']);
    expect(enabledTargets(config, multi, { allFormats: true }).map((t) => t.id)).toEqual(expect.arrayContaining(['iphone-6.3', 'ipad-13', 'play-phone']));
  });

  it('unset selection keeps the detected platforms', () => {
    expect(selectedPlatforms(configWith(), multi)).toEqual({ platforms: ['ios', 'watchos', 'android'], undetected: [] });
  });
});
