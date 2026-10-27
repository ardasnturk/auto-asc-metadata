import { existsSync, type AppPaths } from '@vitrin/core';
import { uploaderOf, type CppSuggestions, type LocaleMetadata, type Platform, type RenderTarget, type ShotList, type Store, type VitrinConfig } from '@vitrin/schemas';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isEditableVersion, type AscClient } from './asc-client.js';
import { ASC_PLATFORM, applePlatformsOf, deliverAcceptsPreview, platformsFromConfig, routeAssets, type DeliverPlatform, type RenderedAsset } from './platforms.js';
import { resolveScope, type StoreScope } from './scope.js';
import { classicTypeFor, displayTypesFor, perTypeRoute } from './display-types.js';
import { buildPlayPlan, type PlayImageIssue, type PlayImageSet, type PlayInputs } from './play.js';
import type { PlayRemoteState } from './play-client.js';

export type ChangeKind = 'create' | 'update' | 'unchanged' | 'unknown' | 'skip';

export interface PlanItem {
  area: 'metadata' | 'screenshots' | 'previews' | 'creatives' | 'cpp' | 'events' | 'app';
  /** Missing = app-store (kept optional so older plan files still read). */
  store?: Store;
  /** deliver platform for App Store items that belong to one version (ios, osx, appletvos, xros). */
  platform?: string;
  locale?: string;
  field?: string;
  change: ChangeKind;
  local?: string;
  remote?: string;
  /** asc-api: Vitrin's own ASC API calls (classic screenshot/preview sets, CPP, events); asc-cli: the asc uploader. */
  via: 'deliver' | 'asset-library' | 'asc-api' | 'asc-cli' | 'supply';
  note?: string;
}

/** One App Store version (one deliver run). */
export interface PlatformPlan {
  platform: DeliverPlatform;
  ascPlatform: string;
  version?: { id: string; versionString: string; state: string };
  /** True when this platform was never released (App Store Connect rejects release notes then). */
  firstRelease?: boolean;
}

export interface UploadPlan {
  generatedAt: string;
  bundleId: string;
  appId?: string;
  /** The iOS version (or the first Apple platform's) — kept for single-platform callers. */
  version?: { id: string; versionString: string; state: string };
  uploader: 'deliver' | 'asset-library' | 'asc';
  remoteKnown: boolean;
  /** True when the app was never released (App Store Connect rejects release notes then). */
  firstRelease?: boolean;
  /** Every Apple platform that gets a deliver run, iOS first. */
  platforms: PlatformPlan[];
  /** Google Play part, when the app ships on Android. */
  play?: { packageName?: string; track: string; versionCode?: number; remoteKnown: boolean; warnings: string[] };
  /** What this run replaces and what it leaves untouched, per platform (config.selection). */
  scope?: StoreScope;
  items: PlanItem[];
  blockers: string[];
}

const VERSION_FIELDS: Array<[keyof LocaleMetadata, string]> = [
  ['description', 'description'],
  ['keywords', 'keywords'],
  ['promotionalText', 'promotionalText'],
  ['whatsNew', 'whatsNew'],
  ['supportUrl', 'supportUrl'],
  ['marketingUrl', 'marketingUrl'],
];
const INFO_FIELDS: Array<[keyof LocaleMetadata, string]> = [
  ['name', 'name'],
  ['subtitle', 'subtitle'],
  ['privacyUrl', 'privacyPolicyUrl'],
];

const CLEARABLE_FIELDS = new Set<keyof LocaleMetadata>(['subtitle', 'promotionalText', 'marketingUrl']);

function norm(v: unknown): string {
  return String(v ?? '').trim().replace(/\r\n/g, '\n');
}

function short(v: string): string {
  const one = v.replace(/\s+/g, ' ');
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

const PLATFORM_LABEL: Record<DeliverPlatform, string> = { ios: 'iOS', osx: 'macOS', appletvos: 'tvOS', xros: 'visionOS' };

/** True when the run uploads anything to this App Store version. */
export function isActive(s: StoreScope['apple'][number] | undefined): boolean {
  return Boolean(s && s.selectedPlatforms.length && (s.metadata || s.screenshots !== 'skip' || s.previews !== 'skip'));
}

type Loc = { id: string; attributes: Record<string, string | null> };

export interface PlayPlanInput {
  packageName?: string;
  inputs: PlayInputs;
  sets: PlayImageSet[];
  imageIssues: PlayImageIssue[];
  stray?: string[];
  /** PlayClient.readState result; undefined = remote unknown. */
  remote?: PlayRemoteState;
}

export async function buildPlan(opts: {
  paths: AppPaths;
  config: VitrinConfig;
  bundleId: string;
  metadata: LocaleMetadata[];
  shots?: ShotList;
  cpp?: CppSuggestions;
  client?: AscClient;
  include: { creatives: boolean; cpp: boolean; events: boolean };
  /** Platforms the app ships on (profile.app.platforms). Defaults to config.upload.platform. */
  platforms?: Platform[];
  /** Rendered files (collectRenderedAssets). Without them the screenshot folders are counted per target. */
  assets?: RenderedAsset[];
  /** Targets enabled for the app; a deliver overwrite is used only when a run carries all of them. */
  enabledTargets?: RenderTarget[];
  play?: PlayPlanInput;
}): Promise<UploadPlan> {
  const { config, metadata, client } = opts;
  const uploader = uploaderOf(config);
  const platforms = opts.platforms ?? platformsFromConfig(config.upload.platform);
  const apple = applePlatformsOf(platforms);
  const scope = opts.assets
    ? resolveScope({ shipping: platforms, selection: config.selection, assets: opts.assets, enabledTargets: opts.enabledTargets ?? [], locales: config.app.locales, uploader })
    : undefined;
  const scopeOf = (p: DeliverPlatform) => scope?.apple.find((s) => s.platform === p);
  const plan: UploadPlan = { generatedAt: new Date().toISOString(), bundleId: opts.bundleId, uploader, remoteKnown: false, platforms: apple.map((p) => ({ platform: p, ascPlatform: ASC_PLATFORM[p] })), items: [], blockers: [], scope };

  const versionLocs = new Map<DeliverPlatform, Loc[]>();
  let infoLocs: Loc[] = [];
  if (client && apple.length) {
    const app = await client.findApp(opts.bundleId);
    if (!app) {
      plan.blockers.push(`No app record for ${opts.bundleId} in ASC. App records cannot be created with an API key; create it once in App Store Connect.`);
    } else {
      plan.appId = app.id;
      for (const pp of plan.platforms) {
        // A platform this run does not touch needs no editable version (and must not block the run).
        if (scope && !isActive(scopeOf(pp.platform))) continue;
        const versions = await client.appStoreVersions(app.id, pp.ascPlatform);
        const editable = versions.find((v) => isEditableVersion(v));
        // App Store Connect has no release notes for a platform that was never released.
        pp.firstRelease = versions.every((v) => isEditableVersion(v) || ['REJECTED', 'DEVELOPER_REMOVED_FROM_SALE'].includes(String(v.attributes.appVersionState ?? v.attributes.appStoreState)));
        if (!editable) {
          const hint =
            pp.platform === 'ios'
              ? 'Try `vitrin doctor --create-version <x.y.z>`; for apps that are only on TestFlight, the first version must be created manually in ASC.'
              : `Add the ${PLATFORM_LABEL[pp.platform]} platform to the app record and create its first version in App Store Connect.`;
          plan.blockers.push(`No editable App Store version for ${PLATFORM_LABEL[pp.platform]} (${pp.ascPlatform}). ${hint}`);
        } else {
          pp.version = { id: editable.id, versionString: editable.attributes.versionString, state: editable.attributes.appVersionState ?? editable.attributes.appStoreState ?? '' };
          versionLocs.set(pp.platform, await client.versionLocalizations(editable.id));
        }
      }
      const infos = await client.appInfos(app.id);
      const info = infos.find((i) => !['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE'].includes(String(i.attributes.state ?? i.attributes.appStoreState))) ?? infos[0];
      if (info) infoLocs = await client.appInfoLocalizations(info.id);
      plan.remoteKnown = true;
    }
  }
  const main = plan.platforms.find((p) => p.platform === 'ios') ?? plan.platforms[0];
  plan.version = main?.version;
  plan.firstRelease = main?.firstRelease;

  // ---- App Store text: app info once (shared by every platform), version text per platform ----
  const textPlatforms = plan.platforms.filter((pp) => !scope || scopeOf(pp.platform)?.metadata);
  const textVia: PlanItem['via'] = uploader === 'asc' ? 'asc-cli' : 'deliver';
  if (textPlatforms.length && uploader === 'asc') {
    plan.items.push({ area: 'app', change: 'skip', via: 'asc-cli', note: 'asc metadata push does not upload categories, copyright or review information; they stay as they are in App Store Connect' });
  }
  if (textPlatforms.length) {
    for (const m of metadata) {
      const compare = (fields: Array<[keyof LocaleMetadata, string]>, remote: { attributes: Record<string, string | null> } | undefined, pp?: PlatformPlan) => {
        for (const [local, remoteKey] of fields) {
          let value = norm(m[local]);
          if (!value && local === 'supportUrl') value = norm(config.urls.support);
          if (!value && local === 'marketingUrl') value = norm(config.urls.marketing);
          if (!value && local === 'privacyUrl') value = norm(config.urls.privacy);
          if (local === 'whatsNew' && pp?.firstRelease) continue;
          const rv = norm(remote?.attributes[remoteKey]);
          if (!value && !(CLEARABLE_FIELDS.has(local) && rv)) continue;
          const platform = pp?.platform;
          if (!plan.remoteKnown) {
            plan.items.push({ area: 'metadata', platform, locale: m.locale, field: local, change: 'unknown', local: short(value), via: textVia });
            continue;
          }
          plan.items.push({
            area: 'metadata',
            platform,
            locale: m.locale,
            field: local,
            change: !remote ? 'create' : rv === value ? 'unchanged' : 'update',
            local: value ? short(value) : '(empty — will be cleared)',
            remote: rv ? short(rv) : undefined,
            via: textVia,
          });
        }
      };
      compare(INFO_FIELDS, infoLocs.find((l) => l.attributes.locale === m.locale));
      for (const pp of textPlatforms) {
        if (plan.remoteKnown && !pp.version) continue;
        compare(VERSION_FIELDS, versionLocs.get(pp.platform)?.find((l) => l.attributes.locale === m.locale), pp);
      }
    }
  }

  // ---- Screenshots / previews per platform — deliver replaces sets (overwrite_screenshots: true) ----
  if (opts.assets && scope) {
    const routed = routeAssets(opts.assets.filter((a) => config.app.locales.includes(a.locale)));
    for (const p of apple) {
      const ps = scopeOf(p)!;
      const groups = new Map<string, { locale: string; target: RenderedAsset['target']; n: number; kind: string; file: string }>();
      for (const a of routed.apple[p]) {
        const inRun = a.kind === 'screenshot' ? ps.screenshots !== 'skip' && ps.screenshotTargets.includes(a.target.id) : ps.previews !== 'skip' && ps.previewTargets.includes(a.target.id);
        if (!inRun) continue;
        const key = `${a.kind}|${a.locale}|${a.target.id}`;
        const g = groups.get(key) ?? { locale: a.locale, target: a.target, n: 0, kind: a.kind, file: a.file };
        g.n++;
        groups.set(key, g);
      }
      for (const g of groups.values()) {
        const isShot = g.kind === 'screenshot';
        const mode = isShot ? ps.screenshots : ps.previews;
        // deliver has no preview type for Mac/TV/Vision, so those are always replaced one set at a time.
        const viaDeliver = uploader === 'deliver' && mode === 'replace-all' && (isShot || deliverAcceptsPreview(p, g.file));
        const route = viaDeliver ? 'deliver' : perTypeRoute(g.target, uploader);
        const classicType = classicTypeFor(g.target);
        const al = displayTypesFor(g.target.id)?.assetLibrary;
        if (route === 'none') {
          plan.blockers.push(`${PLATFORM_LABEL[p]} ${g.locale} ${g.target.id}: replacing only this set needs a classic display type or an App Asset Library placement, and data/asc-display-types.json has neither; upload the full set or place it in App Store Connect by hand.`);
        }
        const what = isShot ? 'screenshot' : 'preview';
        const note =
          route === 'deliver'
            ? isShot
              ? `replaces EVERY screenshot set of ${g.locale} on ${PLATFORM_LABEL[p]} (deliver overwrite)`
              : `replaces every App Preview set of ${g.locale} on ${PLATFORM_LABEL[p]} (deliver overwrite); processing can take up to 24 hours`
            : route === 'classic'
              ? `replaces only the ${classicType} ${what} set of ${g.locale}; other display types stay untouched (${uploader === 'asc' ? `asc ${isShot ? 'screenshots' : 'video-previews'} upload --replace` : `${isShot ? 'appScreenshotSets' : 'appPreviewSets'} API`})${isShot ? '' : '; processing can take up to 24 hours'}`
              : route === 'asset-library'
                ? `replaces only the ${al!.placementType} placements of ${al!.platform}/${al!.displayClass} in ${g.locale}; other display types stay untouched (App Asset Library, placementGroup from refData)`
                : `cannot be replaced on its own`;
        const via: PlanItem['via'] = route === 'deliver' ? 'deliver' : route === 'classic' ? (uploader === 'asc' ? 'asc-cli' : 'asc-api') : 'asset-library';
        plan.items.push({ area: isShot ? 'screenshots' : 'previews', platform: p, locale: g.locale, field: g.target.id, change: 'update', local: `${g.n} ${isShot ? 'images' : 'videos'}`, via, note });
      }
      for (const u of ps.untouched) plan.items.push({ area: 'app', platform: p, change: 'skip', via: 'deliver', note: u });
    }
  } else {
    for (const locale of config.app.locales) {
      const dir = join(opts.paths.screenshots, locale);
      const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/.test(f)) : [];
      const byTarget = new Map<string, number>();
      for (const f of files) {
        const t = /_([a-z0-9.-]+)\.(png|jpe?g)$/.exec(f)?.[1] ?? '?';
        byTarget.set(t, (byTarget.get(t) ?? 0) + 1);
      }
      for (const [t, n] of byTarget) {
        plan.items.push({ area: 'screenshots', locale, field: t, change: 'update', local: `${n} images`, via: uploader === 'asc' ? 'asc-cli' : uploader, note: 'replaces the existing set' });
      }
      const pdir = join(opts.paths.appPreviews, locale);
      const previews = existsSync(pdir) ? (await readdir(pdir)).filter((f) => /\.(mp4|mov)$/.test(f)) : [];
      if (previews.length) plan.items.push({ area: 'previews', locale, change: 'update', local: previews.join(', '), via: uploader === 'asc' ? 'asc-cli' : uploader, note: 'processing can take up to 24 hours' });
    }
  }

  const kindSelected = (k: 'creatives' | 'events') => !scope || scope.assets.includes(k);
  if (opts.include.creatives && !kindSelected('creatives')) {
    plan.items.push({ area: 'creatives', change: 'skip', via: 'asset-library', note: 'creatives not selected: header and search creatives stay untouched' });
  } else if (opts.include.creatives) {
    for (const locale of config.app.locales) {
      const dir = join(opts.paths.creative, locale);
      const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /^(header|search)_/.test(f)) : [];
      for (const f of files) plan.items.push({ area: 'creatives', locale, field: f, change: 'create', via: 'asset-library', note: 'App Asset Library; reviewed independently of the version' });
    }
  } else if (opts.shots?.creatives.header || opts.shots?.creatives.search) {
    plan.items.push({ area: 'creatives', change: 'skip', via: 'asset-library', note: '--creatives not passed' });
  }
  if (opts.include.cpp && opts.cpp) {
    for (const p of opts.cpp.pages) plan.items.push({ area: 'cpp', field: p.name, change: 'create', via: 'asc-api', note: `${p.keywords.length} keywords, ${p.shots.length ? `its own ${p.shots.length}-shot set (metadata/store/cpp/${p.id})` : 'no own screenshots (default set)'}; requires Apple review` });
  }
  if (opts.include.events && !kindSelected('events')) {
    plan.items.push({ area: 'events', change: 'skip', via: 'asc-api', note: 'events not selected: In-App Events stay untouched' });
  } else if (opts.include.events) {
    for (const e of opts.shots?.creatives.events ?? []) plan.items.push({ area: 'events', field: e.id, change: 'create', via: 'asc-api', note: `created as a draft with its card and detail images${e.schedule ? `, ${e.schedule.eventStart} → ${e.schedule.eventEnd}` : ', no schedule yet'}` });
  }

  // ---- Google Play ----
  if (opts.play && scope?.play && !scope.play.selected) {
    plan.items.push({ area: 'app', store: 'google-play', change: 'skip', via: 'supply', note: scope.play.untouched[0] });
  } else if (opts.play) {
    const pr = buildPlayPlan({ ...opts.play, scope: scope?.play });
    plan.play = { packageName: opts.play.packageName, track: opts.play.inputs.app.track, versionCode: opts.play.inputs.app.versionCode, remoteKnown: Boolean(opts.play.remote), warnings: pr.warnings };
    for (const it of pr.items) plan.items.push({ ...it, store: 'google-play', via: 'supply' });
    plan.blockers.push(...pr.blockers.map((b) => `Google Play: ${b}`));
  }
  return plan;
}

function sectionOf(it: PlanItem, multi: boolean): string {
  if (it.area === 'app' && it.change === 'skip') return `untouched · ${it.store === 'google-play' ? 'Google Play' : (PLATFORM_LABEL[it.platform as DeliverPlatform] ?? it.platform ?? 'App Store')}`;
  if (it.store === 'google-play') return `Google Play · ${it.area}`;
  // With a single Apple platform the suffix only splits shared app info from version text; leave it out.
  return it.platform && multi ? `${it.area} · ${PLATFORM_LABEL[it.platform as DeliverPlatform] ?? it.platform}` : it.area;
}

export function formatPlan(plan: UploadPlan): string {
  const lines: string[] = [];
  lines.push(`App: ${plan.bundleId}${plan.appId ? ` (ASC id ${plan.appId})` : ''}`);
  for (const p of plan.platforms) {
    if (p.version) lines.push(`Version (${PLATFORM_LABEL[p.platform]}): ${p.version.versionString} — ${p.version.state}${p.firstRelease ? ' (first release)' : ''}`);
  }
  if (plan.platforms.length) lines.push(`Uploader: ${plan.uploader}${plan.remoteKnown ? '' : '  (not connected to ASC: remote state unknown)'}`);
  if (plan.play) lines.push(`Google Play: ${plan.play.packageName ?? '(no package name)'} — track ${plan.play.track}${plan.play.versionCode ? `, version code ${plan.play.versionCode}` : ''}${plan.play.remoteKnown ? '' : '  (not connected to Google Play: remote state unknown)'}`);
  const symbol: Record<ChangeKind, string> = { create: '+', update: '~', unchanged: '=', unknown: '?', skip: '-' };
  let section = '';
  for (const it of plan.items) {
    const s = sectionOf(it, plan.platforms.length > 1);
    if (s !== section) {
      section = s;
      lines.push('', `[${s}]`);
    }
    const head = `  ${symbol[it.change]} ${it.locale ?? ''}${it.field ? ` ${it.field}` : ''}`.padEnd(34);
    const body = it.change === 'update' && it.remote ? `“${it.remote}” → “${it.local}”` : (it.local ?? '');
    lines.push(`${head} ${body}${it.note ? `  (${it.note})` : ''}`);
  }
  const counts = plan.items.reduce<Record<string, number>>((a, i) => ((a[i.change] = (a[i.change] ?? 0) + 1), a), {});
  lines.push('', `Summary: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  for (const w of plan.play?.warnings ?? []) lines.push(`WARNING: Google Play: ${w}`);
  for (const b of plan.blockers) lines.push(`BLOCKED: ${b}`);
  return lines.join('\n');
}
