import { appPaths, existsSync, loadConfig, loadEnv, readJsonIfExists, StateStore, vitrinVersion, which, type AppPaths } from '@vitrin/core';
import { AppProfile, ApprovalManifest, Archetype, BadgeType, BeatScene, EmphasisStyle, Framing, StylePreset, ValidationReport, VideoStyle, VideoTransition, type VitrinConfig } from '@vitrin/schemas';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { detectUploaderTools, missingUploadKeys, type UploaderTools } from '../commands/doctor.js';
import { platformsReport, type PlatformsReport } from '../commands/select.js';

/**
 * One snapshot of the project for the Studio: what exists in metadata/, which stages ran, what the config selects,
 * and where the rendered files are. Cheap enough to rebuild after every change (no hashing, no network).
 */

export interface RenderedFile {
  /** Posix path relative to the app root, served by the Studio at /files/<path>. */
  path: string;
  name: string;
  bytes: number;
}

export interface Overview {
  version: string;
  root: string;
  /** False until `vitrin init` wrote vitrin.config.yaml. */
  initialized: boolean;
  configError?: string;
  app?: { name: string; bundleId?: string; icon?: string; kind: string; platforms: string[]; version?: string };
  config?: {
    locales: string[];
    primaryLocale: string;
    language: string | null;
    uploader: string | null;
    capture: VitrinConfig['capture']['mode'];
    screens: VitrinConfig['capture']['screens'];
    selection: VitrinConfig['selection'];
    video: VitrinConfig['video'];
    seeds: VitrinConfig['research']['seeds'];
  };
  platforms?: PlatformsReport;
  stages: Record<string, { completedAt: string; status: string; note?: string } | undefined>;
  files: Record<string, boolean>;
  listing: string[];
  playListing: string[];
  briefs: Array<{ name: string; path: string; modifiedAt: string }>;
  validation?: { ok: boolean; counts: ValidationReport['counts']; generatedAt?: string };
  approval?: Pick<ApprovalManifest, 'status' | 'approvedAt' | 'via' | 'overallHash' | 'upload' | 'finalized'> & { rejections: number };
  raw: Record<string, Record<string, RenderedFile[]>>;
  screenshots: Record<string, RenderedFile[]>;
  previews: Record<string, RenderedFile[]>;
  creatives: Record<string, RenderedFile[]>;
  videoStyles: Record<string, RenderedFile[]>;
  cpp: Record<string, Record<string, RenderedFile[]>>;
  samples?: { styles: string[]; contactSheet?: string; storePreview?: string };
  mockups?: { index?: string; screens: RenderedFile[] };
  tools: UploaderTools & { claude: string | null; ffmpeg: string | null };
  missingKeys: string[];
  /** The schema enums the editors offer as choices. */
  enums: { presets: string[]; emphasis: string[]; archetypes: string[]; framings: string[]; scenes: string[]; videoStyles: string[]; transitions: string[]; badgeTypes: string[] };
}

const ENUMS: Overview['enums'] = {
  presets: [...StylePreset.options],
  emphasis: [...EmphasisStyle.options],
  archetypes: [...Archetype.options],
  framings: [...Framing.options],
  scenes: [...BeatScene.options],
  videoStyles: [...VideoStyle.options],
  transitions: [...VideoTransition.options],
  badgeTypes: [...BadgeType.options],
};

const toPosix = (p: string) => p.split(sep).join('/');

async function filesIn(root: string, dir: string, re: RegExp): Promise<RenderedFile[]> {
  if (!existsSync(dir)) return [];
  const out: RenderedFile[] = [];
  for (const name of (await readdir(dir)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    if (!re.test(name)) continue;
    const abs = join(dir, name);
    const st = await stat(abs).catch(() => undefined);
    if (st?.isFile()) out.push({ path: toPosix(relative(root, abs)), name, bytes: st.size });
  }
  return out;
}

async function subdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

async function perLocale(root: string, dir: string, re: RegExp): Promise<Record<string, RenderedFile[]>> {
  const out: Record<string, RenderedFile[]> = {};
  for (const locale of await subdirs(dir)) out[locale] = await filesIn(root, join(dir, locale), re);
  return out;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|m4v)$/i;
const MEDIA = /\.(png|jpe?g|webp|mp4|mov|m4v)$/i;

export async function buildOverview(root: string): Promise<Overview> {
  const paths: AppPaths = appPaths(root);
  const version = vitrinVersion();
  const base: Overview = {
    version,
    root,
    initialized: existsSync(paths.config),
    stages: {},
    files: {},
    listing: [],
    playListing: [],
    briefs: [],
    raw: {},
    screenshots: {},
    previews: {},
    creatives: {},
    videoStyles: {},
    cpp: {},
    tools: { ...(await detectUploaderTools(root)), claude: await which('claude'), ffmpeg: await which('ffmpeg') },
    missingKeys: [],
    enums: ENUMS,
  };
  let config: VitrinConfig | undefined;
  if (base.initialized) {
    try {
      config = loadConfig(paths.config);
    } catch (err) {
      base.configError = (err as Error).message;
    }
  }
  const profile = existsSync(paths.profile) ? await readJsonIfExists(paths.profile, AppProfile).catch(() => undefined) : undefined;
  if (profile) {
    const icon = profile.brand.appIcon ? toPosix(relative(root, resolve(root, profile.brand.appIcon))) : undefined;
    base.app = { name: profile.app.displayName, bundleId: profile.app.bundleId, icon: icon && !icon.startsWith('..') ? icon : undefined, kind: profile.project.kind, platforms: profile.app.platforms, version: profile.app.version };
  }
  if (config) {
    base.config = {
      locales: config.app.locales,
      primaryLocale: config.app.primaryLocale,
      language: config.ui?.language ?? null,
      uploader: config.upload.uploader ?? null,
      capture: config.capture.mode,
      screens: config.capture.screens,
      selection: config.selection ?? {},
      video: config.video,
      seeds: config.research.seeds,
    };
    if (profile) base.platforms = platformsReport(config, profile);
    const env = loadEnv(paths.env);
    base.missingKeys = missingUploadKeys(env, profile ? profile.app.platforms : ['ios']).map((k) => k.name);
    if (!base.app && config.app.bundleId) base.app = { name: config.app.bundleId, bundleId: config.app.bundleId, kind: 'unknown', platforms: [] };
  }
  const state = await StateStore.load(paths.state).catch(() => undefined);
  if (state) {
    for (const [name, rec] of Object.entries(state.snapshot().stages)) if (rec) base.stages[name] = { completedAt: rec.completedAt, status: rec.status, note: rec.note };
  }
  const flags: Record<string, string> = {
    profile: paths.profile,
    appMetadata: paths.appMetadata,
    artDirection: paths.artDirection,
    shots: paths.shots,
    videoPlan: paths.videoPlan,
    experiments: paths.experiments,
    cpp: paths.cpp,
    competitors: paths.competitors,
    liveListing: paths.liveListing,
    iconSheet: paths.iconSheet,
    validation: paths.validation,
    report: paths.report,
    approval: paths.approval,
    uploadPlan: paths.uploadPlan,
    renderManifest: paths.renderManifest,
    reviewFeedback: paths.reviewFeedback,
    gemfile: join(root, 'Gemfile'),
    fastfile: join(paths.fastlane, 'Fastfile'),
    env: paths.env,
    screensKit: join(paths.screens, 'kit'),
  };
  for (const [k, p] of Object.entries(flags)) base.files[k] = existsSync(p);
  base.listing = (await filesIn(root, paths.metadataDir, /^(?!app\.json$).+\.json$/)).map((f) => f.name.replace(/\.json$/, ''));
  base.playListing = (await filesIn(root, join(paths.metadataDir, 'play'), /^(?!app\.json$).+\.json$/)).map((f) => f.name.replace(/\.json$/, ''));
  for (const f of await filesIn(root, paths.briefs, /\.md$/)) {
    const st = await stat(join(root, f.path));
    base.briefs.push({ name: f.name.replace(/\.md$/, ''), path: f.path, modifiedAt: st.mtime.toISOString() });
  }
  base.briefs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const validation = await readJsonIfExists(paths.validation, ValidationReport).catch(() => undefined);
  if (validation) base.validation = { ok: validation.ok, counts: validation.counts, generatedAt: (validation as { generatedAt?: string }).generatedAt };
  const approval = await readJsonIfExists(paths.approval, ApprovalManifest).catch(() => undefined);
  if (approval) base.approval = { status: approval.status, approvedAt: approval.approvedAt, via: approval.via, overallHash: approval.overallHash, upload: approval.upload, finalized: approval.finalized, rejections: approval.rejections.length };
  for (const locale of await subdirs(paths.raw)) {
    base.raw[locale] = {};
    for (const family of await subdirs(join(paths.raw, locale))) base.raw[locale]![family] = await filesIn(root, join(paths.raw, locale, family), MEDIA);
  }
  base.screenshots = await perLocale(root, paths.screenshots, IMAGE);
  base.previews = await perLocale(root, paths.appPreviews, VIDEO);
  base.creatives = await perLocale(root, paths.creative, MEDIA);
  base.videoStyles = await perLocale(root, join(paths.vitrin, 'video-styles'), VIDEO);
  for (const page of await subdirs(paths.cppScreenshots)) base.cpp[page] = await perLocale(root, join(paths.cppScreenshots, page), IMAGE);
  const samplesDir = join(paths.vitrin, 'design-samples');
  if (existsSync(samplesDir)) {
    const styles = await subdirs(samplesDir);
    const rel = (f: string) => (existsSync(join(samplesDir, f)) ? toPosix(relative(root, join(samplesDir, f))) : undefined);
    base.samples = { styles, contactSheet: rel('contact-sheet.png'), storePreview: rel('store-preview.html') };
  }
  const mockupScreens = join(paths.mockups, 'screens');
  if (existsSync(paths.mockups)) {
    const index = join(mockupScreens, 'index.html');
    base.mockups = { index: existsSync(index) ? toPosix(relative(root, index)) : undefined, screens: await filesIn(root, mockupScreens, IMAGE) };
  }
  return base;
}
