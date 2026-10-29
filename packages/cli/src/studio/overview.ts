import { appPaths, existsSync, loadConfig, loadEnv, readJsonIfExists, StateStore, vitrinVersion, which, type AppPaths } from '@vitrin/core';
import { AppProfile, ApprovalManifest, Archetype, BadgeType, BeatScene, EmphasisStyle, Framing, StylePreset, ValidationReport, VideoStyle, VideoTransition, type VitrinConfig } from '@vitrin/schemas';
import { strayLocaleDirs } from '@vitrin/validate';
import { readdir, readFile, stat } from 'node:fs/promises';
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

/** The stages the Studio walks through, in order. mockups and rank are optional side steps; upload is the user's own click. */
export const PIPELINE = ['analyze', 'research', 'write', 'capture', 'mockups', 'design', 'video', 'validate', 'review', 'upload', 'rank'] as const;
export type PipelineStage = (typeof PIPELINE)[number];
const OPTIONAL = new Set<PipelineStage>(['mockups', 'rank']);

/**
 * Where a stage stands. Computed here, from state, briefs, approval and validation, so every Studio page tells the
 * same story: needs-claude = an open brief waits for Claude, needs-user = waits for the user's decision, blocked =
 * something must be fixed first (see `reason`), outdated = an input stage ran after it, skipped = not selected.
 */
export type StageStatus = 'done' | 'needs-claude' | 'needs-user' | 'blocked' | 'outdated' | 'not-run' | 'skipped';

export interface StageView {
  id: PipelineStage;
  status: StageStatus;
  optional?: boolean;
  completedAt?: string;
  note?: string;
  /** Open brief Claude can take (metadata/briefs/<brief>.md). */
  brief?: string;
  /** Why the stage has its status: a blocker code, or the stage that ran after it (outdated). */
  reason?: string;
}

export type BlockerCode = 'config-error' | 'stray-locales' | 'primary-locale' | 'ffmpeg-missing' | 'claude-missing' | 'uploader-unset' | 'uploader-missing' | 'keys-missing' | 'design-choice';

/**
 * Something that stops a stage or waits for the user's decision, with the one-click fixes the Studio offers for it.
 * A `decision` (design-choice) is not an error: the stage waits for the user instead of Claude.
 */
export interface Blocker {
  code: BlockerCode;
  severity: 'error' | 'warning' | 'decision';
  /** Where it stops the run; the Studio shows it there. */
  stage: PipelineStage;
  params: Record<string, string | number | string[]>;
  /** Studio jobs that fix it (the user picks one), most likely first. */
  fixes: Array<{ id: string; command: string; args: Record<string, unknown> }>;
}

/** The one thing to do now: the first stage that is not done; undefined once this release is finished. */
export interface NextStep {
  stage: PipelineStage;
  action: 'claude' | 'run' | 'fix' | 'decide' | 'approve' | 'upload' | 'finalize';
  /** For fix and decide: the blocker or decision to resolve. */
  blocker?: BlockerCode;
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
  /** Open briefs only: one is closed once the stage it feeds completed after it was written. */
  briefs: Array<{ name: string; path: string; modifiedAt: string; stage?: PipelineStage }>;
  validation?: { ok: boolean; counts: ValidationReport['counts']; generatedAt?: string; issues: Array<Pick<ValidationReport['issues'][number], 'severity' | 'code' | 'message' | 'file' | 'locale' | 'field'>> };
  /**
   * `valid` is false when the approval cannot be uploaded as it is: validation found errors, or content stages ran
   * after it (a cheap check by time; the upload itself compares every file hash).
   */
  approval?: Pick<ApprovalManifest, 'status' | 'approvedAt' | 'via' | 'overallHash' | 'upload' | 'finalized'> & { rejections: number; valid: boolean; problem?: 'validation-errors' | 'content-changed' | 'rejected' };
  flow: StageView[];
  blockers: Blocker[];
  next?: NextStep;
  raw: Record<string, Record<string, RenderedFile[]>>;
  screenshots: Record<string, RenderedFile[]>;
  previews: Record<string, RenderedFile[]>;
  creatives: Record<string, RenderedFile[]>;
  videoStyles: Record<string, RenderedFile[]>;
  cpp: Record<string, Record<string, RenderedFile[]>>;
  /** Design samples: `options` (letter, style id, name) as the last sampling run labelled them. */
  samples?: { styles: string[]; contactSheet?: string; storePreview?: string; generatedAt?: string; options: Array<{ letter: string; style: string; name: string }> };
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
    flow: [],
    blockers: [],
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
  const validation = await readJsonIfExists(paths.validation, ValidationReport).catch(() => undefined);
  if (validation)
    base.validation = {
      ok: validation.ok,
      counts: validation.counts,
      generatedAt: (validation as { generatedAt?: string }).generatedAt,
      issues: validation.issues.slice(0, 200).map((i) => ({ severity: i.severity, code: i.code, message: i.message, file: i.file, locale: i.locale, field: i.field })),
    };
  const approval = await readJsonIfExists(paths.approval, ApprovalManifest).catch(() => undefined);
  if (approval) {
    const problem = approvalProblem(approval, base.stages, base.validation);
    base.approval = { status: approval.status, approvedAt: approval.approvedAt, via: approval.via, overallHash: approval.overallHash, upload: approval.upload, finalized: approval.finalized, rejections: approval.rejections.length, valid: !problem, problem };
  }
  const mtime = async (p: string) => (await stat(p).catch(() => undefined))?.mtime.toISOString();
  // The files each brief asks Claude for: once all of them are newer than the brief, Claude's part is done.
  const outputs: Record<string, string[]> = {
    write: [...(config?.app.locales ?? []).map((l) => paths.metadataFile(l)), paths.appMetadata],
    video: [paths.videoPlan],
  };
  for (const f of await filesIn(root, paths.briefs, /\.md$/)) {
    const name = f.name.replace(/\.md$/, '');
    const st = await stat(join(root, f.path));
    const brief = { name, path: f.path, modifiedAt: st.mtime.toISOString(), stage: BRIEF_STAGE[name] };
    const written = outputs[name] ? await Promise.all(outputs[name].map(mtime)) : undefined;
    if (briefOpen(brief, base.stages, approval, written)) base.briefs.push(brief);
  }
  base.briefs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
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
    const index = (await readFile(join(samplesDir, 'samples.json'), 'utf8')
      .then((t) => JSON.parse(t) as unknown)
      .catch(() => undefined)) as { generatedAt?: string; samples?: Array<{ letter?: string; style?: string; name?: string }> } | undefined;
    const options = (index?.samples ?? []).filter((x) => x.letter && x.style).map((x) => ({ letter: x.letter!, style: x.style!, name: x.name ?? x.style! }));
    base.samples = { styles, contactSheet: rel('contact-sheet.png'), storePreview: rel('store-preview.html'), generatedAt: index?.generatedAt, options };
  }
  const mockupScreens = join(paths.mockups, 'screens');
  if (existsSync(paths.mockups)) {
    const index = join(mockupScreens, 'index.html');
    base.mockups = { index: existsSync(index) ? toPosix(relative(root, index)) : undefined, screens: await filesIn(root, mockupScreens, IMAGE) };
  }
  if (base.configError) base.blockers.push({ code: 'config-error', severity: 'error', stage: 'analyze', params: { message: base.configError }, fixes: [] });
  if (config) {
    base.blockers.push(...(await localeBlockers(paths, config, base.listing)), ...toolBlockers(base, config));
    const choice = designChoice(base, await mtime(paths.artDirection));
    if (choice) base.blockers.push(choice);
    base.flow = stageFlow(base, config, existsSync(paths.rankings));
    base.next = nextStep(base.flow, base.blockers, Boolean(base.approval?.finalized));
  }
  return base;
}

/** The stage each brief feeds. */
const BRIEF_STAGE: Record<string, PipelineStage> = { analyze: 'analyze', write: 'write', screens: 'capture', design: 'design', video: 'video', review: 'review' };
/** The stage whose completion answers a brief (the CLI closes briefs itself; this covers ones written before it did). */
const ANSWERED_BY: Record<string, string> = { analyze: 'research', write: 'write', screens: 'capture', design: 'design', video: 'video' };

type Stages = Overview['stages'];

/**
 * `written`: modification times of the files the brief asks for (undefined = missing). When every one of them is newer
 * than the brief, Claude has answered it even if nobody ran the stage yet.
 */
export function briefOpen(brief: { name: string; modifiedAt: string }, stages: Stages, approval?: Pick<ApprovalManifest, 'status' | 'approvedAt' | 'finalized'>, written?: Array<string | undefined>): boolean {
  const after = (at?: string) => Boolean(at && at >= brief.modifiedAt);
  if (brief.name === 'review') return !(approval?.status === 'approved' && after(approval.approvedAt));
  if (brief.name === 'finalize') return !after(approval?.finalized?.at);
  if (written?.length && written.every(after)) return false;
  const by = ANSWERED_BY[brief.name];
  const rec = by ? stages[by] : undefined;
  return !(rec && rec.status !== 'blocked' && after(rec.completedAt));
}

/** Content stages: a run of one after the approval changed what would be uploaded. */
const CONTENT_STAGES = ['write', 'design', 'video'];

export function approvalProblem(approval: Pick<ApprovalManifest, 'status' | 'approvedAt'>, stages: Stages, validation?: { ok: boolean }): 'validation-errors' | 'content-changed' | 'rejected' | undefined {
  if (approval.status !== 'approved') return 'rejected';
  if (validation && !validation.ok) return 'validation-errors';
  if (CONTENT_STAGES.some((s) => (stages[s]?.completedAt ?? '') > approval.approvedAt)) return 'content-changed';
  return undefined;
}

/** Inputs of a stage: when one of them completed after it, its output no longer matches. */
const UPSTREAM: Partial<Record<PipelineStage, string[]>> = {
  design: ['capture'],
  video: ['capture', 'design'],
  validate: ['write', 'design', 'video'],
};

/**
 * The design brief's second step: samples were rendered and the user picks one. The choice is written into
 * art-direction.json afterwards, so an art direction older than the samples (or none) means the choice is still open.
 */
export function designChoice(o: Pick<Overview, 'samples' | 'stages'>, artDirectionAt?: string): Blocker | undefined {
  const at = o.samples?.generatedAt;
  if (!at || !o.samples?.options.length) return undefined;
  if ((o.stages.design?.completedAt ?? '') > at) return undefined;
  if (artDirectionAt && artDirectionAt > at) return undefined;
  return { code: 'design-choice', severity: 'decision', stage: 'design', params: { n: o.samples.options.length, options: o.samples.options.map((x) => `${x.letter} · ${x.name}`) }, fixes: [] };
}

export function stageFlow(o: Pick<Overview, 'stages' | 'briefs' | 'blockers' | 'approval' | 'validation' | 'mockups'>, config: VitrinConfig, ranked = false): StageView[] {
  const assets = config.selection?.assets;
  const skipped: Partial<Record<PipelineStage, boolean>> = {
    design: Boolean(assets && !assets.some((a) => a === 'screenshots' || a === 'creatives' || a === 'events')),
    video: Boolean((assets && !assets.includes('previews') && !assets.includes('creatives')) || (!config.video.enabled && !assets?.includes('previews'))),
  };
  return PIPELINE.map((id): StageView => {
    const rec = o.stages[id];
    const view: StageView = { id, status: 'not-run', ...(OPTIONAL.has(id) ? { optional: true } : {}), ...(rec ? { completedAt: rec.completedAt, note: rec.note } : {}) };
    const brief = o.briefs.find((b) => b.stage === id);
    const blocker = o.blockers.find((b) => b.stage === id && b.severity === 'error');
    const decision = o.blockers.find((b) => b.stage === id && b.severity === 'decision');
    const newer = (UPSTREAM[id] ?? []).find((up) => rec && (o.stages[up]?.completedAt ?? '') > rec.completedAt);
    if (skipped[id]) return { ...view, status: 'skipped' };
    if (decision) return { ...view, status: 'needs-user', reason: decision.code, ...(brief ? { brief: brief.name } : {}) };
    // Claude can write the plan while a tool is missing, but the stage cannot finish until the blocker is fixed: say both.
    if (brief) return { ...view, status: 'needs-claude', brief: brief.name, ...(blocker ? { reason: blocker.code } : {}) };
    if (id === 'mockups') return { ...view, status: o.mockups?.screens.length ? 'done' : 'not-run' };
    if (id === 'rank') return { ...view, status: ranked ? 'done' : 'not-run' };
    if (id === 'review') {
      const a = o.approval;
      if (!a) return { ...view, status: o.validation?.ok ? 'needs-user' : 'not-run' };
      const base = { ...view, completedAt: a.approvedAt };
      if (a.problem === 'validation-errors') return { ...base, status: 'blocked', reason: 'validation-errors' };
      if (a.problem === 'content-changed') return { ...base, status: 'needs-user', reason: 'content-changed' };
      if (a.problem === 'rejected') return { ...base, status: 'needs-claude', reason: 'rejected' };
      return { ...base, status: 'done' };
    }
    if (id === 'upload') {
      const a = o.approval;
      const up = a?.upload && a.upload.overallHash === a.overallHash ? a.upload : undefined;
      if (up?.readBack === 'ok') return { ...view, status: 'done', completedAt: up.uploadedAt };
      if (blocker) return { ...view, status: 'blocked', reason: blocker.code };
      if (up) return { ...view, status: 'needs-user', reason: 'readback-differences', completedAt: up.uploadedAt };
      return { ...view, status: a?.valid ? 'needs-user' : 'not-run' };
    }
    if (blocker) return { ...view, status: 'blocked', reason: blocker.code };
    if (!rec) return view;
    if (rec.status === 'blocked') return { ...view, status: 'blocked', reason: id === 'validate' ? 'validation-errors' : undefined };
    if (newer) return { ...view, status: 'outdated', reason: newer };
    return { ...view, status: 'done' };
  });
}

export function nextStep(flow: StageView[], blockers: Blocker[], finalized = false): NextStep | undefined {
  for (const s of flow) {
    if (s.optional || s.status === 'done' || s.status === 'skipped') continue;
    const blocker = blockers.find((b) => b.stage === s.id && b.severity === 'error');
    if (blocker) return { stage: s.id, action: 'fix', blocker: blocker.code };
    const decision = blockers.find((b) => b.stage === s.id && b.severity === 'decision');
    if (decision) return { stage: s.id, action: 'decide', blocker: decision.code };
    if (s.status === 'needs-claude') return { stage: s.id, action: 'claude' };
    if (s.id === 'upload') return { stage: 'upload', action: 'upload' };
    if (s.status === 'needs-user') return { stage: s.id, action: 'approve' };
    if (s.status === 'blocked' && s.id === 'review') return { stage: 'validate', action: 'run' };
    return { stage: s.id, action: 'run' };
  }
  // Uploaded and read back: what is left is checking the store and finishing the run.
  return flow.some((s) => s.id === 'upload' && s.status === 'done') && !finalized ? { stage: 'upload', action: 'finalize' } : undefined;
}

/**
 * Store folders of locales that are not in app.locales (validate fails on them: deliver would upload them too), and
 * a primary locale outside the store locales (copy and captures fall back to it).
 */
async function localeBlockers(paths: AppPaths, config: VitrinConfig, listing: string[]): Promise<Blocker[]> {
  const out: Blocker[] = [];
  const locales = config.app.locales;
  const metadata = (await strayLocaleDirs(paths.fastlaneMetadata, locales)).filter((d) => d !== 'default' && d !== 'android');
  const screenshots = await strayLocaleDirs(paths.screenshots, locales);
  const previews = await strayLocaleDirs(paths.appPreviews, locales);
  const stray = [...new Set([...metadata, ...screenshots, ...previews])].sort();
  if (stray.length) {
    // Dropping them = re-running the stage that wrote them: it removes folders of locales no longer selected.
    const drop = metadata.length ? 'write' : screenshots.length ? 'design' : 'video';
    out.push({
      code: 'stray-locales',
      severity: 'error',
      stage: 'validate',
      params: { locales: stray, selected: locales },
      fixes: [
        { id: 'add-locales', command: 'select', args: { locales: [...locales, ...stray.filter((l) => listing.includes(l))] } },
        { id: 'drop-locales', command: drop, args: {} },
      ].filter((f) => f.id !== 'add-locales' || (f.args.locales as string[]).length > locales.length),
    });
  }
  if (!locales.includes(config.app.primaryLocale)) {
    out.push({
      code: 'primary-locale',
      severity: 'warning',
      stage: 'write',
      params: { primary: config.app.primaryLocale, selected: locales },
      fixes: [
        { id: 'set-primary', command: 'select', args: { primaryLocale: locales[0] } },
        ...(listing.includes(config.app.primaryLocale) ? [{ id: 'add-primary', command: 'select', args: { locales: [...locales, config.app.primaryLocale] } }] : []),
      ],
    });
  }
  return out;
}

function toolBlockers(o: Pick<Overview, 'tools' | 'missingKeys'>, config: VitrinConfig): Blocker[] {
  const out: Blocker[] = [];
  const assets = config.selection?.assets;
  const video = (!assets || assets.includes('previews') || assets.includes('creatives')) && (config.video.enabled || Boolean(assets?.includes('previews')));
  if (video && !o.tools.ffmpeg) out.push({ code: 'ffmpeg-missing', severity: 'error', stage: 'video', params: { install: 'brew install ffmpeg' }, fixes: [] });
  if (!o.tools.claude) out.push({ code: 'claude-missing', severity: 'warning', stage: 'analyze', params: { install: 'npm install -g @anthropic-ai/claude-code' }, fixes: [] });
  const uploader = config.upload.uploader;
  if (!uploader) {
    const asc = { id: 'use-asc', command: 'select', args: { uploader: 'asc' } };
    const deliver = { id: 'use-deliver', command: 'select', args: { uploader: 'deliver' } };
    out.push({ code: 'uploader-unset', severity: 'error', stage: 'upload', params: {}, fixes: o.tools.asc || !o.tools.fastlane ? [asc, deliver] : [deliver, asc] });
  } else if (uploader === 'asc' && !o.tools.asc) {
    out.push({ code: 'uploader-missing', severity: 'error', stage: 'upload', params: { tool: 'asc', install: 'brew install asc' }, fixes: [] });
  } else if (uploader !== 'asc' && !o.tools.fastlane) {
    out.push({ code: 'uploader-missing', severity: 'error', stage: 'upload', params: { tool: 'fastlane', install: 'bundle install' }, fixes: [] });
  }
  if (o.missingKeys.length) out.push({ code: 'keys-missing', severity: 'error', stage: 'upload', params: { keys: o.missingKeys }, fixes: [] });
  return out;
}
