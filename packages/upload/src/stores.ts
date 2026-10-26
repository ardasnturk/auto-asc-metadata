import { enabledTargets, exec, loadTargets, log, readJsonIfExists, type AppPaths } from '@vitrin/core';
import { RenderManifest, type AppProfile, type Platform, type RenderTarget, type VitrinConfig } from '@vitrin/schemas';
import type { AscClient } from './asc-client.js';
import { AssetLibraryClient } from './asset-library.js';
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
 * locale it uploads to; partial sets are replaced per display type by `uploadPerDisplayType`. Text is skipped when
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

/** Files of a platform that go through the App Asset Library: partial sets, and previews deliver has no type for. */
export function assetLibraryFilesFor(plan: UploadPlan, platform: string, assets: RenderedAsset[]): RenderedAsset[] {
  const ps = scopeOf(plan, platform);
  if (!ps || !isActive(ps)) return [];
  const partial = perDisplayTypeAssetsFor(ps, assets);
  const previewsWithoutType = assets.filter(
    (a) => a.kind === 'preview' && ps.previews === 'replace-all' && ps.previewTargets.includes(a.target.id) && deliverPlatformFor(a.target.platform) === ps.platform && !deliverAcceptsPreview(ps.platform, a.file),
  );
  return [...partial, ...previewsWithoutType];
}

/**
 * Replaces exactly the display classes in this run through the App Asset Library and nothing else: for each
 * locale, placement type and display class it deletes only placements that report that class (strict), uploads,
 * places and orders. Other device sets of the locale stay untouched.
 */
export async function uploadPerDisplayType(client: AscClient, plan: UploadPlan, assets: RenderedAsset[], locales: string[]): Promise<number> {
  if (!plan.appId) return 0;
  const lib = new AssetLibraryClient(client);
  let uploaded = 0;
  let libraryId: string | undefined;
  for (const p of plan.platforms) {
    const files = assetLibraryFilesFor(plan, p.platform, assets).filter((a) => locales.includes(a.locale));
    if (!files.length || !p.version) continue;
    libraryId ??= await lib.libraryId(plan.appId);
    const locs = await client.versionLocalizations(p.version.id);
    const groups = new Map<string, { locale: string; kind: 'image' | 'video'; placement: string; displayClass: string; files: string[] }>();
    for (const a of [...files].sort((x, y) => x.order.localeCompare(y.order))) {
      const displayClass = a.target.assetLibraryDisplayClass;
      if (!displayClass) throw new Error(`${a.target.id}: no App Asset Library display class; refusing a partial replacement that could touch other sets.`);
      const placement = a.kind === 'preview' ? 'APP_PREVIEW' : 'SCREENSHOT';
      const key = `${a.locale}|${placement}|${displayClass}`;
      const g = groups.get(key) ?? { locale: a.locale, kind: a.kind === 'preview' ? ('video' as const) : ('image' as const), placement, displayClass, files: [] };
      g.files.push(a.file);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const loc = locs.find((l) => l.attributes.locale === g.locale);
      if (!loc) {
        log.warn(`${p.platform} ${g.locale}: no version localization (upload the text first); ${g.displayClass} skipped.`);
        continue;
      }
      const owner = { type: 'appStoreVersionLocalizations', id: loc.id };
      const removed = await lib.clearPlacements(owner, g.placement, g.displayClass, { strict: true });
      if (removed) log.dim(`  ${p.platform} ${g.locale} ${g.placement}/${g.displayClass}: replaced ${removed} placements`);
      const placements: string[] = [];
      for (const file of g.files) {
        const assetId = await lib.upload(libraryId, file, g.kind);
        placements.push(await lib.place(assetId, g.kind, owner, g.placement, g.displayClass));
        uploaded++;
      }
      if (placements.length > 1) await lib.order(placements);
    }
  }
  return uploaded;
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
