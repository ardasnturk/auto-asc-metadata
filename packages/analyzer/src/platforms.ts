import { PlatformEnum, type Evidence, type Platform, type ProjectTarget } from '@vitrin/schemas';

type Device = ProjectTarget['devices'][number];

const FAMILY: Record<string, Device> = { '1': 'iphone', '2': 'ipad', '3': 'tv', '4': 'watch', '6': 'mac', '7': 'vision' };

/** TARGETED_DEVICE_FAMILY → device names (6 is the Mac Catalyst "Optimize for Mac" idiom). */
export function deviceFamilies(settings: Record<string, string>): Device[] {
  const out = (settings.TARGETED_DEVICE_FAMILY ?? '')
    .split(/[,\s]+/)
    .map((x) => FAMILY[x.trim()])
    .filter((x): x is Device => Boolean(x));
  if (settings.SUPPORTS_MACCATALYST === 'YES' && !out.includes('mac')) out.push('mac');
  return [...new Set(out)];
}

/**
 * Platforms a single Xcode target builds for.
 *
 * - SDKROOT (`iphoneos`, `macosx`, `watchos`, `appletvos`, `xros`, or `auto` for multiplatform targets)
 *   and SUPPORTED_PLATFORMS decide the platform.
 * - Mac Catalyst (`SUPPORTS_MACCATALYST = YES`) counts as macOS. "Designed for iPad/iPhone" on a Mac
 *   (`SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD`) or on Vision Pro (`SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD`) does not:
 *   the store shows the iPad screenshots there, so no separate assets are needed.
 * - TARGETED_DEVICE_FAMILY 3/4/7 (tv/watch/vision) also count, for projects that leave SDKROOT implicit.
 */
export function targetPlatforms(settings: Record<string, string>, productType = ''): { platforms: Platform[]; macCatalyst: boolean } {
  const sdk = (settings.SDKROOT ?? '').toLowerCase();
  const supported = (settings.SUPPORTED_PLATFORMS ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const devices = deviceFamilies(settings);
  const has = (p: string) => sdk === p || sdk.startsWith(`${p}`) || supported.includes(p);
  const out = new Set<Platform>();
  const catalyst = settings.SUPPORTS_MACCATALYST === 'YES';

  if (productType === 'com.apple.product-type.application.watchapp2' || productType === 'com.apple.product-type.watchkit2-extension' || has('watchos') || devices.includes('watch')) {
    out.add('watchos');
  }
  if (has('appletvos') || devices.includes('tv')) out.add('tvos');
  if (has('xros') || devices.includes('vision')) out.add('visionos');
  if (has('macosx') || catalyst) out.add('macos');
  const iosFamily = devices.includes('iphone') || devices.includes('ipad');
  // A target with no explicit SDK and no other platform is an iOS target (Xcode's default).
  if (has('iphoneos') || iosFamily || (out.size === 0 && (sdk === '' || sdk === 'auto'))) out.add('ios');
  // A watch app's container (`watchapp2-container`) is an iOS stub: it ships no screens of its own.
  if (productType === 'com.apple.product-type.application.watchapp2-container') out.clear();
  return { platforms: sortPlatforms([...out]), macCatalyst: catalyst && !has('macosx') };
}

export function sortPlatforms(list: Iterable<Platform>): Platform[] {
  const set = new Set(list);
  return PlatformEnum.options.filter((p) => set.has(p));
}

/** Xcode version encoded in LastUpgradeCheck / LastSwiftUpdateCheck: "2710" → 27.1, "1430" → 14.3. */
export function xcodeVersionOf(check: string | undefined): number | undefined {
  if (!check || !/^\d{3,4}$/.test(check)) return undefined;
  const n = Number(check);
  return Math.floor(n / 100) + Math.floor((n % 100) / 10) / 10;
}

const DUO_SDK = 27.1;

/**
 * iPhone Duo heuristic.
 *
 * Every iPhone app runs on iPhone Duo, but App Store Connect only asks for (and from April 2027 requires) Duo
 * screenshots for apps built with the iOS 27.1 SDK; those builds also get the "Optimized for iPhone Duo" badge.
 * The project files cannot prove which SDK a build uses, so the closest durable evidence is used:
 *
 * 1. `LastUpgradeCheck` / `LastSwiftUpdateCheck` ≥ 2710: the project was opened and upgraded in Xcode 27.1 or later,
 *    which builds with the iOS 27.1 SDK; or
 * 2. `IPHONEOS_DEPLOYMENT_TARGET` ≥ 27.1, which needs that SDK.
 *
 * Both require the app to run on iPhone. Older projects get no Duo targets (the store shows scaled 6.9" screenshots);
 * `targets.enable: [duo-outer, duo-inner]` in vitrin.config.yaml overrides the heuristic either way.
 */
export function detectDuo(input: {
  supportsIPhone: boolean;
  attributes: Record<string, string>;
  deploymentTarget?: string;
  pbxprojPath: string;
}): { supported: boolean; evidence?: Evidence; reason: string } {
  if (!input.supportsIPhone) return { supported: false, reason: 'The app does not run on iPhone.' };
  for (const key of ['LastUpgradeCheck', 'LastSwiftUpdateCheck']) {
    const v = xcodeVersionOf(input.attributes[key]);
    if (v !== undefined && v >= DUO_SDK - 1e-9) {
      return { supported: true, evidence: { path: input.pbxprojPath, note: `${key}=${input.attributes[key]} (Xcode ${v.toFixed(1)}, iOS 27.1 SDK)` }, reason: `Project upgraded in Xcode ${v.toFixed(1)}.` };
    }
  }
  const dt = Number.parseFloat(input.deploymentTarget ?? '');
  if (Number.isFinite(dt) && dt >= DUO_SDK - 1e-9) {
    return { supported: true, evidence: { path: input.pbxprojPath, note: `IPHONEOS_DEPLOYMENT_TARGET=${input.deploymentTarget}` }, reason: 'Deployment target requires the iOS 27.1 SDK.' };
  }
  return { supported: false, reason: 'No sign of Xcode 27.1 / the iOS 27.1 SDK in the project.' };
}
