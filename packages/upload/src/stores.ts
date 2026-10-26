import { enabledTargets, exec, existsSync, loadTargets, log, readJsonIfExists, type AppPaths } from '@vitrin/core';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RenderManifest, type AppProfile, type Platform, type PreviewType, type RenderTarget, type ScreenshotDisplayType, type VitrinConfig } from '@vitrin/schemas';
import type { AscClient } from './asc-client.js';
import { AssetLibraryClient, type PlacementSpec } from './asset-library.js';
import { classicTypeFor, displayTypesFor, perTypeRoute } from './display-types.js';
import { ClassicMediaClient } from './screenshot-sets.js';
import type { PollOptions } from './upload-operations.js';
import { runLane, runSupplyLane, type CommandRunner } from './fastlane.js';
import { isActive, type PlanItem, type PlayPlanInput, type UploadPlan } from './plan.js';
import { buildDeliverFolders, collectRenderedAssets, deliverAcceptsPreview, deliverPlatformFor, platformsFromConfig, type DeliverFolders, type RenderedAsset } from './platforms.js';
import { checkPlayImages, exportPlayMetadata, loadPlayInputs, playExportDir, playImageSets, readPlayImageInfo, strayPlayLocaleDirs, type PlayInputs } from './play.js';
import { PlayClient, playKeyFromEnv, type PlayKeySource } from './play-client.js';
import { deliverAssetsFor, perDisplayTypeAssetsFor, type PlatformScope, type PlayScope } from './scope.js';

export interface PlayContext {
  packageName?: string;
  inputs: PlayInputs;
  key?: PlayKeySource;
  client?: PlayClient;
  plan: PlayPlanInput;
}

export interface StoreContext {
  /** Platforms the app ships on: profile.app.platforms, or the legacy config.upload.platform. */
  platforms: Platform[];
  assets: RenderedAsset[];
  /** Targets enabled for this app on its platforms (decides whether a run carries a complete set). */
  enabledTargets: RenderTarget[];
  /** Present when Android is one of the platforms. */
  play?: PlayContext;
}

/**
 * Collects everything the multi-store upload needs: platforms, rendered files routed by target, and (for Android)
 * the Play listings, image checks and — when a valid key is present and `online` — the remote Play state.
 */
export async function prepareStores(opts: {
  paths: AppPaths;
  config: VitrinConfig;
  profile?: AppProfile;
  env: NodeJS.ProcessEnv;
  online: boolean;
  targets?: RenderTarget[];
  fetchImpl?: typeof fetch;
}): Promise<StoreContext> {
  const { paths, config, profile, env } = opts;
  const platforms = profile?.app.platforms?.length ? profile.app.platforms : platformsFromConfig(config.upload.platform);
  const manifest = await readJsonIfExists(paths.renderManifest, RenderManifest).catch(() => undefined);
  const { assets, unknown } = await collectRenderedAssets(paths, opts.targets ?? loadTargets(), manifest);
  for (const f of unknown) log.dim(`  ${f}: target not in data/targets.json, not uploaded`);
  const enabled = (opts.targets ?? enabledTargets(config, profile)).filter((t) => platforms.includes(t.platform));
  const ctx: StoreContext = { platforms, assets, enabledTargets: enabled };
  if (!platforms.includes('android')) return ctx;

  const inputs = await loadPlayInputs(paths, config.app.locales);
  const packageName = env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || profile?.project.androidApplicationId;
  const sets = playImageSets(assets, inputs.listings);
  const imageIssues = checkPlayImages(sets, await readPlayImageInfo(sets));
  const stray = await strayPlayLocaleDirs(paths, inputs);
  const key = playKeyFromEnv(env, paths.root);
  const play: PlayContext = { packageName, inputs, key, plan: { packageName, inputs, sets, imageIssues, stray } };
  if (key?.account) play.client = new PlayClient(key.account, opts.fetchImpl);
  if (play.client && packageName && opts.online) {
    try {
      play.plan.remote = await play.client.readState(packageName, inputs.app.track);
    } catch (err) {
      log.warn(`Google Play state could not be read: ${(err as Error).message}`);
    }
  }
  ctx.play = play;
  return ctx;
}

function scopeOf(plan: UploadPlan, platform: string): PlatformScope | undefined {
  return plan.scope?.apple.find((s) => s.platform === platform);
}

/**
 * One deliver run per Apple platform this run touches, each with its own metadata, screenshot and preview folders.
 * Only complete sets (`replace-all`) go into the folders, because deliver's overwrite deletes every set of each
 * locale it uploads to; partial sets are replaced one display type at a time by `uploadPerDisplayType` (classic
 * appScreenshotSets/appPreviewSets API, App Asset Library for iPhone Duo). Text is skipped when
 * metadata is not selected, and a platform with nothing to do gets no run.
 */
export async function runDeliverForPlatforms(
  paths: AppPaths,
  plan: UploadPlan,
  assets: RenderedAsset[],
  opts: { bundleId: string; languages: string[]; skipScreenshots?: boolean; lane?: string },
  runner: CommandRunner = exec,
): Promise<DeliverFolders[]> {
  const done: DeliverFolders[] = [];
  // The asc uploader replaces deliver entirely (runAscForPlatforms).
  if (plan.uploader === 'asc') return done;
  for (const p of plan.platforms) {
    if (!p.version && plan.remoteKnown) continue;
    const ps = scopeOf(plan, p.platform);
    if (plan.scope && !isActive(ps)) continue;
    const files = ps ? deliverAssetsFor(ps, assets) : assets;
    const media = opts.skipScreenshots || plan.uploader === 'asset-library' ? [] : files;
    const skipMetadata = ps ? !ps.metadata : false;
    if (skipMetadata && !media.length) continue;
    const folders = await buildDeliverFolders(paths, p.platform, media, { locales: opts.languages, dropReleaseNotes: p.firstRelease });
    log.step(`fastlane deliver ${p.platform} (${skipMetadata ? 'no text, ' : ''}${folders.screenshots} screenshots, ${folders.previews} previews)…`);
    await runLane(
      paths,
      opts.lane ?? 'vitrin_upload',
      {
        bundleId: opts.bundleId,
        languages: opts.languages,
        appVersion: p.version?.versionString,
        platform: p.platform,
        skipScreenshots: folders.screenshots === 0,
        skipMetadata,
        metadataPath: folders.metadataPath,
        screenshotsPath: folders.screenshotsPath,
        previewsPath: folders.previewsPath,
      },
      runner,
    );
    done.push(folders);
  }
  return done;
}

/**
 * Files of a platform that are replaced one display type at a time: partial sets, and complete preview sets deliver
 * has no type for (Mac, Apple TV, Vision Pro — the classic API has DESKTOP, APPLE_TV and APPLE_VISION_PRO).
 */
export function perDisplayTypeFilesFor(plan: UploadPlan, platform: string, assets: RenderedAsset[]): RenderedAsset[] {
  const ps = scopeOf(plan, platform);
  if (!ps || !isActive(ps)) return [];
  const partial = perDisplayTypeAssetsFor(ps, assets);
  const previewsWithoutType = assets.filter(
    (a) => a.kind === 'preview' && ps.previews === 'replace-all' && ps.previewTargets.includes(a.target.id) && deliverPlatformFor(a.target.platform) === ps.platform && !deliverAcceptsPreview(ps.platform, a.file),
  );
  return [...partial, ...previewsWithoutType];
}

/** The subset of `perDisplayTypeFilesFor` that needs the App Asset Library (no classic type, or uploader asset-library). */
export function assetLibraryFilesFor(plan: UploadPlan, platform: string, assets: RenderedAsset[]): RenderedAsset[] {
  return perDisplayTypeFilesFor(plan, platform, assets).filter((a) => perTypeRoute(a.target, plan.uploader) === 'asset-library');
}

export interface PerDisplayTypeOptions {
  /** `skip`: the classic sets are uploaded elsewhere (the asc CLI); only Asset Library sets are handled here. */
  classic?: 'api' | 'skip';
  uploadFetch?: typeof fetch;
  poll?: PollOptions;
}

/**
 * Replaces exactly the display types in this run and nothing else, one localization at a time:
 * - through the classic appScreenshotSets/appPreviewSets API when it has a type for the target (finds or creates
 *   that one set, deletes only its items, uploads, commits with the MD5 checksum and sets the order);
 * - through the App Asset Library otherwise (iPhone Duo), or for everything with `uploader: asset-library`
 *   (deletes only placements of that placementType and refData placementGroup, uploads, places, orders).
 * Other device sets of the locale stay untouched. Returns the number of files uploaded.
 */
export async function uploadPerDisplayType(client: AscClient, plan: UploadPlan, assets: RenderedAsset[], locales: string[], opts: PerDisplayTypeOptions = {}): Promise<number> {
  if (!plan.appId) return 0;
  const lib = new AssetLibraryClient(client, { uploadFetch: opts.uploadFetch, poll: opts.poll });
  const classic = new ClassicMediaClient(client, { uploadFetch: opts.uploadFetch, poll: opts.poll });
  let uploaded = 0;
  let libraryId: string | undefined;
  for (const p of plan.platforms) {
    const files = perDisplayTypeFilesFor(plan, p.platform, assets).filter((a) => locales.includes(a.locale));
    if (!files.length || !p.version) continue;
    const groups = new Map<string, { locale: string; kind: 'screenshot' | 'preview'; route: 'classic' | 'asset-library'; type: string; spec?: PlacementSpec; files: RenderedAsset[] }>();
    for (const a of [...files].sort((x, y) => x.order.localeCompare(y.order) || x.target.id.localeCompare(y.target.id))) {
      if (a.kind !== 'screenshot' && a.kind !== 'preview') continue;
      const route = perTypeRoute(a.target, plan.uploader);
      if (route === 'none') throw new Error(`${a.target.id}: no classic display type and no App Asset Library placement in data/asc-display-types.json; refusing a partial replacement that could touch other sets.`);
      if (route === 'classic' && opts.classic === 'skip') continue;
      const spec = displayTypesFor(a.target.id)?.assetLibrary;
      const type = route === 'classic' ? classicTypeFor(a.target)! : `${spec!.placementType}/${spec!.platform}/${spec!.displayClass}`;
      const key = `${a.locale}|${route}|${type}`;
      const g = groups.get(key) ?? { locale: a.locale, kind: a.kind, route, type, spec, files: [] };
      g.files.push(a);
      groups.set(key, g);
    }
    if (!groups.size) continue;
    const locs = await client.versionLocalizations(p.version.id);
    for (const g of groups.values()) {
      const loc = locs.find((l) => l.attributes.locale === g.locale);
      if (!loc) {
        log.warn(`${p.platform} ${g.locale}: no version localization (upload the text first); ${g.type} skipped.`);
        continue;
      }
      const paths = g.files.map((f) => f.file);
      if (g.route === 'classic') {
        const res =
          g.kind === 'screenshot'
            ? await classic.replaceScreenshotSet(loc.id, g.type as ScreenshotDisplayType, paths)
            : await classic.replacePreviewSet(loc.id, g.type as PreviewType, paths);
        log.dim(`  ${p.platform} ${g.locale} ${g.type}: ${res.createdSet ? 'created the set' : `replaced ${res.deleted} items`}, uploaded ${res.uploaded.length}`);
        uploaded += res.uploaded.length;
      } else {
        libraryId ??= await lib.libraryId(plan.appId);
        const res = await lib.replaceSet(libraryId, { type: 'appStoreVersionLocalizations', id: loc.id }, g.spec!, g.files.map((f) => ({ file: f.file, kind: f.kind === 'preview' ? ('video' as const) : ('image' as const) })));
        log.dim(`  ${p.platform} ${g.locale} ${g.type} (group ${res.group}): replaced ${res.removed} placements, placed ${res.placements.length}`);
        uploaded += res.placements.length;
      }
    }
  }
  return uploaded;
}

/**
 * Product page header and search result creatives of the version (App Asset Library, CREATIVE_ASSETS): for each
 * locale and placement type, the existing placements of that type are replaced. Files: `<creativeDir>/<locale>/
 * {header,search}_*.{png,mp4}`.
 */
export async function uploadVersionCreatives(client: AscClient, plan: UploadPlan, creativeDir: string, locales: string[], opts: { uploadFetch?: typeof fetch; poll?: PollOptions } = {}): Promise<number> {
  if (!plan.appId || !plan.version) return 0;
  const lib = new AssetLibraryClient(client, opts);
  const libraryId = await lib.libraryId(plan.appId);
  const locs = await client.versionLocalizations(plan.version.id);
  let n = 0;
  for (const locale of locales) {
    const loc = locs.find((l) => l.attributes.locale === locale);
    const dir = join(creativeDir, locale);
    if (!loc || !existsSync(dir)) continue;
    const byTarget = new Map<'header' | 'search', Array<{ file: string; kind: 'image' | 'video' }>>();
    for (const f of (await readdir(dir)).filter((x) => /^(header|search)_.*\.(png|jpe?g|mp4|mov)$/.test(x)).sort()) {
      const target = f.startsWith('header') ? 'header' : 'search';
      const list = byTarget.get(target) ?? [];
      list.push({ file: join(dir, f), kind: /\.(mp4|mov)$/.test(f) ? 'video' : 'image' });
      byTarget.set(target, list);
    }
    for (const [target, files] of byTarget) {
      const spec = displayTypesFor(target)?.assetLibrary;
      if (!spec) throw new Error(`${target}: no App Asset Library placement in data/asc-display-types.json.`);
      const res = await lib.replaceSet(libraryId, { type: 'appStoreVersionLocalizations', id: loc.id }, spec, files);
      log.ok(`${locale} ${target} → ${spec.placementType} (${res.placements.length} placed, ${res.removed} replaced)`);
      n += res.placements.length;
    }
  }
  return n;
}

/**
 * Exports the supply tree and runs the Play lane (metadata, changelog and images; never a release). With a scope,
 * unselected kinds get no files and their supply steps are skipped, so Google Play keeps them as they are.
 */
export async function runPlayUpload(
  paths: AppPaths,
  play: PlayContext,
  assets: RenderedAsset[],
  opts: { validateOnly: boolean; skipScreenshots?: boolean; scope?: PlayScope },
  runner: CommandRunner = exec,
): Promise<{ written: string[] }> {
  if (opts.scope && !opts.scope.selected) return { written: [] };
  if (!play.packageName) throw new Error('No Android application id (profile.project.androidApplicationId or GOOGLE_PLAY_PACKAGE_NAME).');
  if (!play.key) throw new Error('No Google Play key: set GOOGLE_PLAY_JSON_KEY_PATH or GOOGLE_PLAY_JSON_KEY_BASE64 in .env.');
  if (play.key.problems.length) throw new Error(`Google Play key (${play.key.from}): ${play.key.problems.join('; ')}`);
  const screenshots = !opts.skipScreenshots && (opts.scope?.screenshots ?? true);
  const creatives = !opts.skipScreenshots && (opts.scope?.creatives ?? true);
  const metadata = opts.scope?.metadata ?? true;
  const exported = await exportPlayMetadata(paths, play.inputs, assets, undefined, { screenshots, creatives });
  for (const s of exported.skipped) log.warn(`${s}: no Google Play language; not uploaded to Google Play.`);
  log.step(`fastlane supply ${play.packageName}${opts.validateOnly ? ' (validate only)' : ''}…`);
  await runSupplyLane(
    paths,
    {
      packageName: play.packageName,
      metadataPath: playExportDir(paths),
      track: play.inputs.app.track,
      versionCode: play.inputs.app.versionCode,
      validateOnly: opts.validateOnly,
      jsonKeyPath: play.key.path,
      skipMetadata: !metadata,
      skipChangelogs: !metadata,
      skipScreenshots: !screenshots,
      skipImages: !creatives,
    },
    runner,
  );
  return { written: exported.written };
}

/** Plan items of one store (for the approval summary). */
export function itemsOfStore(plan: UploadPlan, store: 'app-store' | 'google-play'): PlanItem[] {
  return plan.items.filter((i) => (i.store ?? 'app-store') === store);
}
