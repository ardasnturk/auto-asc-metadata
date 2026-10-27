import { ensureDir, existsSync, type AppPaths } from '@vitrin/core';
import type { Platform, RenderManifest, RenderTarget } from '@vitrin/schemas';
import { copyFile, readdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** fastlane deliver `platform:` values (deliver 2.241.1 accepts ios, appletvos/tvos, xros and osx). */
export type DeliverPlatform = 'ios' | 'osx' | 'appletvos' | 'xros';
export const DELIVER_PLATFORMS: DeliverPlatform[] = ['ios', 'osx', 'appletvos', 'xros'];

/** ASC API `filter[platform]` of the App Store version each deliver run edits. */
export const ASC_PLATFORM: Record<DeliverPlatform, string> = { ios: 'IOS', osx: 'MAC_OS', appletvos: 'TV_OS', xros: 'VISION_OS' };

/**
 * App Store platform → deliver platform. watchOS has no App Store version of its own: Apple Watch screenshots
 * belong to the iOS version and deliver picks their display type (APP_WATCH_*) from the pixel size.
 */
export function deliverPlatformFor(platform: Platform): DeliverPlatform | null {
  switch (platform) {
    case 'ios':
    case 'watchos':
      return 'ios';
    case 'macos':
      return 'osx';
    case 'tvos':
      return 'appletvos';
    case 'visionos':
      return 'xros';
    default:
      return null;
  }
}

/** The deliver runs an app needs, in a stable order (iOS first). */
export function applePlatformsOf(platforms: Platform[]): DeliverPlatform[] {
  const set = new Set(platforms.map(deliverPlatformFor).filter((p): p is DeliverPlatform => p !== null));
  return DELIVER_PLATFORMS.filter((p) => set.has(p));
}

/** Maps the legacy single `upload.platform` config value to profile platforms. */
export function platformsFromConfig(value: DeliverPlatform): Platform[] {
  return [{ ios: 'ios', osx: 'macos', appletvos: 'tvos', xros: 'visionos' }[value] as Platform];
}

/** Render target kind of one file (not the run selection's `AssetKind` from @vitrin/schemas). */
export type RenderedKind = 'screenshot' | 'preview' | 'creative' | 'event';

/** One rendered file, resolved to its target (and therefore its store and platform). */
export interface RenderedAsset {
  file: string;
  locale: string;
  target: RenderTarget;
  kind: RenderedKind;
  /** Sort key inside a set (shot id `01`, `02`, …). */
  order: string;
}

const SHOT_FILE_RE = /^(\d{2})_([a-z0-9-]+)_([a-z0-9.-]+)\.(png|jpe?g)$/;
const PREVIEW_FILE_RE = /^(\d{2})_([A-Z0-9_]+)\.(mp4|mov|m4v)$/;

/**
 * Every rendered file with its target. The render manifest is the source of truth; without one, the
 * screenshot, preview and creative folders are scanned (file names carry the target id).
 * Files whose target id is not in `targets` are returned in `unknown`.
 */
export async function collectRenderedAssets(paths: AppPaths, targets: RenderTarget[], manifest?: RenderManifest): Promise<{ assets: RenderedAsset[]; unknown: string[] }> {
  const byId = new Map(targets.map((t) => [t.id, t]));
  const assets: RenderedAsset[] = [];
  const unknown: string[] = [];
  const add = (file: string, locale: string, targetId: string, order: string) => {
    const target = byId.get(targetId);
    if (!target) {
      unknown.push(file);
      return;
    }
    if (!existsSync(file)) return;
    assets.push({ file, locale, target, kind: target.kind, order });
  };

  if (manifest) {
    for (const i of manifest.images) add(i.file, i.locale, i.target, i.shot);
    for (const v of manifest.videos) add(v.file, v.locale, v.target, v.id);
  } else {
    for (const locale of await subdirs(paths.screenshots)) {
      for (const f of (await readdir(join(paths.screenshots, locale))).sort()) {
        const m = SHOT_FILE_RE.exec(f);
        if (m) add(join(paths.screenshots, locale, f), locale, m[3]!, m[1]!);
      }
    }
    for (const locale of await subdirs(paths.appPreviews)) {
      for (const f of (await readdir(join(paths.appPreviews, locale))).sort()) {
        const m = PREVIEW_FILE_RE.exec(f);
        if (m) add(join(paths.appPreviews, locale, f), locale, m[2]!.includes('IPAD') ? 'preview-ipad' : 'preview-iphone', m[1]!);
      }
    }
    for (const locale of await subdirs(paths.creative)) {
      for (const f of (await readdir(join(paths.creative, locale))).sort()) {
        // `<targetId>_<key>.png`; target ids may contain `-` but never `_`.
        const m = /^([a-z0-9.-]+)_(.+)\.(png|jpe?g|mp4)$/.exec(f);
        if (m && byId.has(m[1]!)) add(join(paths.creative, locale, f), locale, m[1]!, m[2]!);
      }
    }
  }
  assets.sort((a, b) => a.locale.localeCompare(b.locale) || a.target.id.localeCompare(b.target.id) || a.order.localeCompare(b.order));
  return { assets, unknown };
}

async function subdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) out.push(e.name);
  return out.sort();
}

export interface RoutedAssets {
  /** App Store screenshots and App Previews per deliver run. */
  apple: Record<DeliverPlatform, RenderedAsset[]>;
  /** App Store creatives (product page header, search, In-App Events): App Asset Library, not deliver. */
  appleCreatives: RenderedAsset[];
  play: RenderedAsset[];
}

export function routeAssets(assets: RenderedAsset[]): RoutedAssets {
  const out: RoutedAssets = { apple: { ios: [], osx: [], appletvos: [], xros: [] }, appleCreatives: [], play: [] };
  for (const a of assets) {
    if (a.target.store === 'google-play') {
      out.play.push(a);
      continue;
    }
    if (a.kind === 'creative' || a.kind === 'event') {
      out.appleCreatives.push(a);
      continue;
    }
    const p = deliverPlatformFor(a.target.platform);
    if (p) out.apple[p].push(a);
  }
  return out;
}

/**
 * App Preview types deliver 2.241.1 can upload: it matches a token in the file name (`IPHONE_67`,
 * `IPAD_PRO_3GEN_129`, …) and checks the resolution. `DESKTOP` exists but has no accepted resolution, and there is
 * no Apple TV or Vision Pro preview type, so those previews go through the App Asset Library instead.
 */
export function deliverAcceptsPreview(platform: DeliverPlatform, file: string): boolean {
  return platform === 'ios' && /(IPHONE_\d{2}|IPAD_(97|105|PRO_129|PRO_3GEN_11|PRO_3GEN_129))/.test(basename(file).toUpperCase());
}

export interface DeliverFolders {
  platform: DeliverPlatform;
  root: string;
  screenshotsPath: string;
  previewsPath: string;
  metadataPath: string;
  screenshots: number;
  previews: number;
  /** Previews deliver cannot upload for this platform (App Asset Library path). */
  assetLibraryPreviews: RenderedAsset[];
}

/** `metadata/deliver/<platform>/` — rebuilt for every run. */
export function deliverRoot(paths: AppPaths, platform: DeliverPlatform): string {
  return join(paths.vitrin, 'deliver', platform);
}

/**
 * Builds the folders one deliver run reads. deliver uploads every image of a locale folder to the version of
 * its `platform` and aborts on a size it does not know, so each platform gets only its own files:
 * iPhone/iPad/Duo/Watch for `ios`, Mac for `osx`, Apple TV for `appletvos`, Vision Pro for `xros`.
 * Metadata is copied without `android/` (supply's folder; deliver rejects unknown language folders), and without
 * release notes when the platform's version is a first release.
 */
export async function buildDeliverFolders(
  paths: AppPaths,
  platform: DeliverPlatform,
  assets: RenderedAsset[],
  opts: { locales: string[]; dropReleaseNotes?: boolean },
): Promise<DeliverFolders> {
  const root = deliverRoot(paths, platform);
  await rm(root, { recursive: true, force: true });
  const screenshotsPath = join(root, 'screenshots');
  const previewsPath = join(root, 'app-previews');
  const metadataPath = join(root, 'metadata');
  await ensureDir(screenshotsPath);
  await ensureDir(previewsPath);
  const locales = new Set(opts.locales);
  const result: DeliverFolders = { platform, root, screenshotsPath, previewsPath, metadataPath, screenshots: 0, previews: 0, assetLibraryPreviews: [] };
  for (const a of assets) {
    if (!locales.has(a.locale)) continue;
    if (deliverPlatformFor(a.target.platform) !== platform || a.target.store !== 'app-store') continue;
    if (a.kind === 'screenshot') {
      let name = basename(a.file);
      // 3840×2160 is both Apple TV and Vision Pro; deliver picks Vision Pro only when the path contains "vision".
      if (a.target.family === 'vision' && !name.toLowerCase().includes('vision')) name = name.replace(/(\.\w+)$/, '_vision$1');
      await ensureDir(join(screenshotsPath, a.locale));
      await copyFile(a.file, join(screenshotsPath, a.locale, name));
      result.screenshots++;
    } else if (a.kind === 'preview') {
      if (!deliverAcceptsPreview(platform, a.file)) {
        result.assetLibraryPreviews.push(a);
        continue;
      }
      await ensureDir(join(previewsPath, a.locale));
      await copyFile(a.file, join(previewsPath, a.locale, basename(a.file)));
      result.previews++;
    }
  }
  if (existsSync(paths.fastlaneMetadata)) await copyMetadata(paths.fastlaneMetadata, metadataPath, opts.dropReleaseNotes ?? false);
  else await ensureDir(metadataPath);
  return result;
}

async function copyMetadata(src: string, dest: string, dropReleaseNotes: boolean, depth = 0): Promise<void> {
  await ensureDir(dest);
  for (const e of await readdir(src, { withFileTypes: true })) {
    if (depth === 0 && e.name === 'android') continue;
    const from = join(src, e.name);
    if (e.isDirectory()) await copyMetadata(from, join(dest, e.name), dropReleaseNotes, depth + 1);
    else if (e.isFile() && !(dropReleaseNotes && e.name === 'release_notes.txt')) await copyFile(from, join(dest, e.name));
  }
}
