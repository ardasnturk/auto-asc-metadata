import type { AssetKind, Platform, RenderTarget, VitrinConfig } from '@vitrin/schemas';
import { applePlatformsOf, deliverPlatformFor, type DeliverPlatform, type RenderedAsset } from './platforms.js';

/**
 * How a set of images or videos reaches the store in this run.
 * - `replace-all`: deliver with overwrite. deliver 2.241.1 then deletes EVERY screenshot set (every display type)
 *   of each locale it uploads to — and, for previews, every preview type of the locale. Only used when the run
 *   carries a complete set for that platform and locale.
 * - `per-display-type`: one set per localization and display type is replaced — classic appScreenshotSets/
 *   appPreviewSets API (or `asc … upload --replace`), the App Asset Library for iPhone Duo; other sets stay.
 * - `skip`: not part of the run; the store content stays untouched.
 */
export type ReplaceMode = 'replace-all' | 'per-display-type' | 'skip';

export interface PlatformScope {
  platform: DeliverPlatform;
  /** Shipping platforms that live in this App Store version (ios + watchos for `ios`). */
  covers: Platform[];
  /** Covered platforms the user selected for this run. */
  selectedPlatforms: Platform[];
  metadata: boolean;
  screenshots: ReplaceMode;
  previews: ReplaceMode;
  /** Target ids uploaded in this run. */
  screenshotTargets: string[];
  previewTargets: string[];
  /** What stays untouched, in words, for the plan. */
  untouched: string[];
}

export interface PlayScope {
  selected: boolean;
  metadata: boolean;
  /** Phone/tablet screenshots. supply replaces only the image types that have local files. */
  screenshots: boolean;
  /** Feature graphic and icon. */
  creatives: boolean;
  untouched: string[];
}

export interface StoreScope {
  /** Asset kinds selected for this run (config.selection.assets, default all). */
  assets: AssetKind[];
  apple: PlatformScope[];
  play?: PlayScope;
}

export const ALL_ASSET_KINDS: AssetKind[] = ['metadata', 'screenshots', 'previews', 'creatives', 'events'];

/**
 * Resolves what this run uploads and what it must leave alone, from the shipping platforms, the user's
 * `config.selection`, the rendered files and the targets that are enabled for the app.
 *
 * deliver's overwrite (replace-all) is used only when, for every locale in the run, the run contains every
 * enabled target of that App Store version (e.g. iPhone, iPad and Apple Watch for iOS) and every covered platform
 * is selected. Anything less is a partial run: the selected display types are replaced one set at a time (classic
 * API, App Asset Library for iPhone Duo), and everything else stays as it is in App Store Connect. The asc and
 * asset-library uploaders always replace one display type at a time.
 */
export function resolveScope(opts: {
  shipping: Platform[];
  selection?: VitrinConfig['selection'];
  assets: RenderedAsset[];
  /** Targets enabled for the app (core enabledTargets); used to decide whether a set is complete. */
  enabledTargets: RenderTarget[];
  locales: string[];
  uploader: 'deliver' | 'asset-library' | 'asc';
}): StoreScope {
  const kinds = opts.selection?.assets?.length ? opts.selection.assets : ALL_ASSET_KINDS;
  const selected = opts.shipping.filter((p) => !opts.selection?.platforms?.length || opts.selection.platforms.includes(p));
  const locales = new Set(opts.locales);
  const formats = opts.selection?.targets?.length ? new Set(opts.selection.targets) : undefined;
  const scope: StoreScope = { assets: kinds, apple: [] };

  for (const p of applePlatformsOf(opts.shipping)) {
    const covers = opts.shipping.filter((s) => deliverPlatformFor(s) === p);
    const selCovers = covers.filter((s) => selected.includes(s));
    const ps: PlatformScope = { platform: p, covers, selectedPlatforms: selCovers, metadata: false, screenshots: 'skip', previews: 'skip', screenshotTargets: [], previewTargets: [], untouched: [] };
    scope.apple.push(ps);
    if (!selCovers.length) {
      ps.untouched.push(`${covers.join(', ')} not selected: text, screenshots and previews stay untouched`);
      continue;
    }
    const notSelected = covers.filter((s) => !selCovers.includes(s));
    if (notSelected.length) ps.untouched.push(`${notSelected.join(', ')} not selected: its screenshots and previews stay untouched`);
    ps.metadata = kinds.includes('metadata');
    if (!ps.metadata) ps.untouched.push('text metadata not selected: stays untouched');

    for (const [kind, assetKind, field] of [
      ['screenshot', 'screenshots', 'screenshots'],
      ['preview', 'previews', 'previews'],
    ] as const) {
      if (!kinds.includes(assetKind)) {
        ps.untouched.push(`${assetKind} not selected: stay untouched`);
        continue;
      }
      const files = opts.assets.filter((a) => a.kind === kind && a.target.store === 'app-store' && deliverPlatformFor(a.target.platform) === p && selCovers.includes(a.target.platform) && locales.has(a.locale) && (!formats || formats.has(a.target.id)));
      if (!files.length) continue;
      const ids = [...new Set(files.map((a) => a.target.id))].sort();
      const expected = opts.enabledTargets.filter((t) => t.kind === kind && t.store === 'app-store' && covers.includes(t.platform)).map((t) => t.id);
      const fileLocales = [...new Set(files.map((a) => a.locale))];
      // An unselected platform in the same version (e.g. watchOS next to iOS) with sets of this kind would be wiped by an overwrite.
      const unselectedSets = opts.enabledTargets.some((t) => t.kind === kind && t.store === 'app-store' && notSelected.includes(t.platform));
      const complete = !unselectedSets && fileLocales.every((l) => expected.every((id) => files.some((a) => a.locale === l && a.target.id === id)));
      ps[field] = complete && opts.uploader === 'deliver' ? 'replace-all' : 'per-display-type';
      if (field === 'screenshots') ps.screenshotTargets = ids;
      else ps.previewTargets = ids;
      if (ps[field] === 'per-display-type') {
        const others = expected.filter((id) => !ids.includes(id));
        ps.untouched.push(`${assetKind}: only ${ids.join(', ')} replaced${others.length ? `; ${others.join(', ')} and every other display type stay untouched` : '; other display types stay untouched'}`);
      }
    }
  }

  if (opts.shipping.includes('android')) {
    const on = selected.includes('android');
    const play: PlayScope = { selected: on, metadata: on && kinds.includes('metadata'), screenshots: on && kinds.includes('screenshots'), creatives: on && kinds.includes('creatives'), untouched: [] };
    if (!on) play.untouched.push('android not selected: the Google Play listing stays untouched');
    else {
      if (!play.metadata) play.untouched.push('text and release notes not selected: stay untouched');
      if (!play.screenshots) play.untouched.push('screenshots not selected: stay untouched');
      if (!play.creatives) play.untouched.push('feature graphic and icon not selected: stay untouched');
      play.untouched.push('supply replaces only the image types that have files in this run; other types stay');
    }
    scope.play = play;
  }
  return scope;
}

/** The files of `assets` this platform's deliver run may carry (complete sets only). */
export function deliverAssetsFor(scope: PlatformScope, assets: RenderedAsset[]): RenderedAsset[] {
  return assets.filter(
    (a) =>
      a.target.store === 'app-store' &&
      deliverPlatformFor(a.target.platform) === scope.platform &&
      ((a.kind === 'screenshot' && scope.screenshots === 'replace-all' && scope.screenshotTargets.includes(a.target.id)) ||
        (a.kind === 'preview' && scope.previews === 'replace-all' && scope.previewTargets.includes(a.target.id))),
  );
}

/** The files that must be replaced one display type at a time (classic API or App Asset Library). */
export function perDisplayTypeAssetsFor(scope: PlatformScope, assets: RenderedAsset[]): RenderedAsset[] {
  return assets.filter(
    (a) =>
      a.target.store === 'app-store' &&
      deliverPlatformFor(a.target.platform) === scope.platform &&
      ((a.kind === 'screenshot' && scope.screenshots === 'per-display-type' && scope.screenshotTargets.includes(a.target.id)) ||
        (a.kind === 'preview' && scope.previews === 'per-display-type' && scope.previewTargets.includes(a.target.id))),
  );
}
