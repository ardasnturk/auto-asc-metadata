import type { AppProfile, AssetKind, Platform, RenderTarget, VitrinConfig } from '@vitrin/schemas';
import { log } from './logger.js';
import { loadTargets } from './workspace.js';

/** Without an app profile Vitrin assumes an iOS app, as before multi-platform support. */
const DEFAULT_PLATFORMS: Platform[] = ['ios'];

/** `selection.assets` value that turns each target kind on. */
export const ASSET_OF_KIND: Record<RenderTarget['kind'], AssetKind> = {
  screenshot: 'screenshots',
  preview: 'previews',
  creative: 'creatives',
  event: 'events',
};

type ProfileApp = Partial<AppProfile['app']> | undefined;

/**
 * Platforms to produce for: `selection.platforms` when the user chose some (even ones the analyzer did not detect),
 * otherwise every detected platform. `undetected` lists selected platforms the project shows no sign of.
 */
export function selectedPlatforms(config: Pick<VitrinConfig, 'selection'>, profile?: Pick<AppProfile, 'app'>): { platforms: Platform[]; undetected: Platform[] } {
  const app = profile?.app as ProfileApp;
  const detected = app?.platforms?.length ? app.platforms : DEFAULT_PLATFORMS;
  const chosen = config.selection?.platforms;
  if (!chosen?.length) return { platforms: [...detected], undetected: [] };
  return { platforms: [...chosen], undetected: profile ? chosen.filter((p) => !detected.includes(p)) : [] };
}

const warned = new Set<string>();

/**
 * Targets to produce for this app, from data/targets.json:
 *
 * 1. `targets.disable` always wins;
 * 2. `selection` (the user's choice for this run) limits platforms and asset kinds — it beats `targets.enable`;
 * 3. `targets.enable` forces a target on (even on a platform the analyzer missed);
 * 4. otherwise the target must be `defaultEnabled` (or be a preview/event the user explicitly selected) and its
 *    platform must be selected or detected;
 * 5. device flags: iPhone targets need `supportsIPhone`, iPad `supportsIPad`, iPhone Duo `supportsDuo`,
 *    Google Play tablets `supportsAndroidTablet`;
 * 6. without `selection.assets`, App Previews follow `video.enabled`.
 */
export function enabledTargets(config: VitrinConfig, profile?: Pick<AppProfile, 'app'>, opts: { quiet?: boolean } = {}): RenderTarget[] {
  const app = profile?.app as ProfileApp;
  const { platforms, undetected } = selectedPlatforms(config, profile);
  for (const p of opts.quiet ? [] : undetected) {
    if (warned.has(p)) continue;
    warned.add(p);
    log.warn(`Selected platform “${p}” was not detected in the project: its assets are included, but capture needs a build for it (capture.prebuilt.${p}) or manual raw captures.`);
  }
  const assets = config.selection?.assets;
  return loadTargets().filter((t) => {
    if (config.targets.disable.includes(t.id)) return false;
    if (config.selection?.platforms?.length && !platforms.includes(t.platform)) return false;
    if (assets && !assets.includes(ASSET_OF_KIND[t.kind])) return false;
    if (config.targets.enable.includes(t.id)) return true;
    if (!platforms.includes(t.platform)) return false;
    // Previews and events are opt-in by default; choosing them explicitly is the opt-in.
    const chosen = Boolean(assets && (t.kind === 'preview' || t.kind === 'event'));
    if (!t.defaultEnabled && !chosen) return false;
    if (app) {
      // A selected-but-undetected iOS still gets its required iPhone set; iPad, Duo and tablets need their flags.
      if (t.family === 'iphone' && app.supportsIPhone === false && !undetected.includes(t.platform)) return false;
      if (t.family === 'ipad' && !app.supportsIPad) return false;
      if (t.family === 'duo' && !app.supportsDuo) return false;
      if (t.family === 'android-tablet' && !app.supportsAndroidTablet) return false;
    }
    if (t.kind === 'preview' && !assets) return config.video.enabled;
    return true;
  });
}

/** Platforms that have at least one enabled target (what capture has to build for). */
export function enabledPlatforms(targets: RenderTarget[]): Platform[] {
  return [...new Set(targets.map((t) => t.platform))];
}

/** deliver infers the App Preview device from the file name; 886×1920 covers every modern iPhone class. */
export const DELIVER_PREVIEW_DEVICE: Record<string, string> = {
  'preview-iphone': 'IPHONE_67',
  'preview-ipad': 'IPAD_PRO_3GEN_129',
  'preview-mac': 'DESKTOP',
};
