import { existsSync, loadTargets, log, readJsonIfExists, sha256, writeJson, writeText } from '@vitrin/core';
import {
  AppMetadata,
  AppProfile,
  ApprovalManifest,
  CppSuggestions,
  ExperimentPlan,
  RenderManifest,
  ReviewFeedback,
  ReviewSnapshot,
  ShotList,
  type AssetKind,
  type HashedFile,
  type RenderTarget,
  type ReviewItem,
  type ReviewItemKind,
  type ReviewRejection,
  type Store,
} from '@vitrin/schemas';
import { exportFastlaneMetadata, exportPlayMetadata, prepareStores } from '@vitrin/upload';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { writeBrief } from './briefs.js';
import { EXIT, NeedsInput, type Ctx } from './context.js';
import { loadLocaleMetadata } from './commands/pipeline.js';

/**
 * The review-and-approve gate. Everything `vitrin upload` could send is inventoried here, hashed, shown in the
 * report, and signed off in `metadata/approval.json`. A real upload refuses unless every hash still matches.
 */

/** A review item plus what the gallery needs to show it. */
export interface InventoryItem extends ReviewItem {
  /** Absolute path of the media file (media items only). */
  abs?: string;
  bytes?: number;
  /** Position in the upload order within its locale × target group (1-based). */
  order?: number;
  targetInfo?: RenderTarget;
  durationSec?: number;
  /** Text fields for metadata items: field key → text (as exported, i.e. what is uploaded). */
  fields?: Array<{ key: string; file: string; value: string }>;
  /** Source object for CPP / event items. */
  data?: unknown;
}

export interface Inventory {
  items: InventoryItem[];
  /** Upload files (relative to the app root, sorted). */
  files: HashedFile[];
  /** Source JSON the upload reads text from. */
  metadataJson: HashedFile[];
  overallHash: string;
}

const MEDIA_RE = /\.(png|jpe?g|webp|mp4|mov|m4v)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v)$/i;
/** Non-locale directories inside the deliver metadata folder. */
const APP_LEVEL_DIRS = new Set(['review_information', 'trade_representative_contact_information']);
/** supply's image folders → kind / family. */
const PLAY_IMAGE_DIRS: Record<string, { kind: ReviewItemKind; family?: string }> = {
  phoneScreenshots: { kind: 'screenshot', family: 'android-phone' },
  sevenInchScreenshots: { kind: 'screenshot', family: 'android-tablet' },
  tenInchScreenshots: { kind: 'screenshot', family: 'android-tablet' },
  tvScreenshots: { kind: 'screenshot', family: 'tv' },
  wearScreenshots: { kind: 'screenshot', family: 'watch' },
};
const ASC_PLATFORM: Record<string, string> = { ios: 'ios', osx: 'macos', appletvos: 'tvos', xros: 'visionos' };

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const toPosix = (p: string) => p.split(sep).join('/');

/** Every file below `dir` (recursive, dotfiles skipped), absolute, naturally sorted. */
async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out.sort(natural);
}

export async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

async function hashed(root: string, files: string[]): Promise<HashedFile[]> {
  const out: HashedFile[] = [];
  for (const f of files) {
    const st = await stat(f);
    out.push({ path: toPosix(relative(root, f)), sha256: await hashFile(f), bytes: st.size });
  }
  return out.sort((a, b) => natural(a.path, b.path));
}

/** One hash over every path and content hash; any added, removed or changed file changes it. */
export function overallHash(files: HashedFile[], metadataJson: HashedFile[]): string {
  const lines = [...files.map((f) => `f\t${f.path}\t${f.sha256}`), ...metadataJson.map((f) => `m\t${f.path}\t${f.sha256}`)].sort();
  return sha256(lines.join('\n'));
}

/** Absolute paths of every file an upload could send. */
export async function uploadFiles(ctx: Ctx): Promise<string[]> {
  const p = ctx.paths;
  const creative = (await walk(p.creative)).filter((f) => MEDIA_RE.test(f) && !basename(f).includes('.remotion.'));
  const image = (f: string) => /\.(png|jpe?g)$/i.test(f);
  const cpp = (await walk(p.cppScreenshots)).filter(image);
  const tests = (await walk(p.experimentScreenshots)).filter(image);
  return [...(await walk(p.fastlaneMetadata)), ...(await walk(p.screenshots)), ...(await walk(p.appPreviews)), ...creative, ...cpp, ...tests];
}

/** Absolute paths of the JSON the upload reads text from (metadata, CPP pages, In-App Event copy). */
export async function metadataJsonFiles(ctx: Ctx): Promise<string[]> {
  const p = ctx.paths;
  const json = (await walk(p.metadataDir)).filter((f) => f.endsWith('.json'));
  for (const f of [p.cpp, p.shots, p.experiments]) if (existsSync(f)) json.push(f);
  return json;
}

/**
 * Writes metadata/store/metadata from `metadata/listing` exactly as `vitrin upload` does, so the reviewed and
 * approved text files are the ones that will be uploaded. Skipped silently while metadata is incomplete.
 */
export async function syncFastlaneMetadata(ctx: Ctx): Promise<boolean> {
  try {
    if (!existsSync(ctx.paths.appMetadata)) return false;
    const app = await readJsonIfExists(ctx.paths.appMetadata, AppMetadata);
    const metadata = await loadLocaleMetadata(ctx);
    if (!app || metadata.length !== ctx.config.app.locales.length) return false;
    await exportFastlaneMetadata(ctx.paths, ctx.config, app, metadata);
    await syncPlayMetadata(ctx);
    return true;
  } catch (err) {
    log.warn(`metadata/store/metadata was not refreshed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Writes the Google Play supply tree from the same listings and renders `vitrin upload` uses, so the Play text and
 * images the user approves are hashed before upload. The export is deterministic: re-running it at upload time
 * produces the same files, and a changed render or listing shows up as a change against the approval.
 */
async function syncPlayMetadata(ctx: Ctx): Promise<void> {
  const profile = await readJsonIfExists(ctx.paths.profile, AppProfile).catch(() => undefined);
  if (!profile?.app.platforms.includes('android')) return;
  const stores = await prepareStores({ paths: ctx.paths, config: ctx.config, profile, env: ctx.env, online: false });
  if (!stores.play?.inputs.listings.length) return;
  const kinds = ctx.config.selection.assets;
  const scope = { screenshots: !kinds || kinds.includes('screenshots'), creatives: !kinds || kinds.includes('creatives') };
  await exportPlayMetadata(ctx.paths, stores.play.inputs, stores.assets, undefined, scope);
}

function targetFromName(file: string, targets: RenderTarget[]): RenderTarget | undefined {
  const name = basename(file);
  // NN_slug_<target>.png (screenshots) or <target>_<key>.png (creatives); try the longest match.
  const candidates = targets.filter((t) => name.endsWith(`_${t.id}${name.slice(name.lastIndexOf('.'))}`) || name.startsWith(`${t.id}_`));
  return candidates.sort((a, b) => b.id.length - a.id.length)[0];
}

/** Builds the full inventory: items for the gallery plus the hashes for approval. */
export async function buildInventory(ctx: Ctx): Promise<Inventory> {
  const p = ctx.paths;
  const root = ctx.root;
  const rel = (f: string) => toPosix(relative(root, f));
  const targets = loadTargets();
  const byId = new Map(targets.map((t) => [t.id, t]));
  const manifest = await readJsonIfExists(p.renderManifest, RenderManifest).catch(() => undefined);
  const manifestImages = new Map((manifest?.images ?? []).map((i) => [resolve(root, i.file), i]));
  const manifestVideos = new Map((manifest?.videos ?? []).map((v) => [resolve(root, v.file), v]));
  const ascPlatform = ASC_PLATFORM[ctx.config.upload.platform] ?? 'ios';

  const allUpload = await uploadFiles(ctx);
  const jsonFiles = await metadataJsonFiles(ctx);
  const files = await hashed(root, allUpload);
  const metadataJson = await hashed(root, jsonFiles);
  const sizeOf = new Map(files.map((f) => [f.path, f.bytes]));
  const items: InventoryItem[] = [];

  const mediaItem = (abs: string, kind: ReviewItemKind, store: Store, locale: string | undefined, target: RenderTarget | undefined, fallbackPlatform: string): InventoryItem => {
    const r = rel(abs);
    const video = manifestVideos.get(abs);
    return {
      id: r,
      kind,
      store: target?.store ?? store,
      platform: target?.platform ?? fallbackPlatform,
      locale,
      target: target?.id,
      targetInfo: target,
      label: `${locale ? `${locale} · ` : ''}${target?.label ?? kind} · ${basename(abs)}`,
      files: [r],
      abs,
      bytes: sizeOf.get(r),
      durationSec: video?.durationSec,
    };
  };

  const under = (dir: string, f: string) => toPosix(relative(dir, f)).split('/');
  // App Store screenshots: metadata/store/screenshots/<locale>/… (deliver uploads every image, in file-name order).
  for (const f of await walk(p.screenshots)) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue;
    const locale = under(p.screenshots, f)[0];
    const m = manifestImages.get(f);
    const target = (m && byId.get(m.target)) || targetFromName(f, targets);
    items.push(mediaItem(f, 'screenshot', 'app-store', locale, target, ascPlatform));
  }
  // App Previews: metadata/store/app-previews/<locale>/NN_<DEVICE>.mp4
  for (const f of await walk(p.appPreviews)) {
    if (!VIDEO_RE.test(f)) continue;
    const locale = under(p.appPreviews, f)[0];
    const m = manifestVideos.get(f);
    const target = (m && byId.get(m.target)) || byId.get(basename(f).includes('IPAD') ? 'preview-ipad' : 'preview-iphone');
    items.push(mediaItem(f, 'preview', 'app-store', locale, target, ascPlatform));
  }
  // Creatives and event cards: metadata/creative/<locale>/<target>_<key>.(png|mp4)
  for (const f of await walk(p.creative)) {
    if (!MEDIA_RE.test(f) || basename(f).includes('.remotion.')) continue;
    const locale = under(p.creative, f)[0];
    const m = manifestImages.get(f) ?? manifestVideos.get(f);
    const target = (m && byId.get(m.target)) || targetFromName(f, targets);
    items.push(mediaItem(f, target?.kind === 'event' ? 'event' : 'creative', 'app-store', locale, target, ascPlatform));
  }

  // App Store text: metadata/store/metadata/<locale>/*.txt per locale, the rest is app level.
  const ascMeta = (await walk(p.fastlaneMetadata)).filter((f) => !f.startsWith(p.androidMetadata + sep));
  const ascGroups = new Map<string, string[]>();
  for (const f of ascMeta) {
    const parts = under(p.fastlaneMetadata, f);
    const key = parts.length > 1 && !APP_LEVEL_DIRS.has(parts[0]!) ? parts[0]! : '';
    ascGroups.set(key, [...(ascGroups.get(key) ?? []), f]);
  }
  for (const [locale, list] of [...ascGroups].sort(([a], [b]) => natural(a, b))) {
    const source = locale ? p.metadataFile(locale) : p.appMetadata;
    items.push(await textItem(root, locale ? `metadata/app-store/${locale}` : 'metadata/app-store/app', 'app-store', ascPlatform, locale || undefined, list, join(p.fastlaneMetadata, locale), source));
  }

  // Google Play (supply layout): metadata/store/metadata/android/<locale>/{*.txt,changelogs/*.txt,images/**}
  const playFiles = await walk(p.androidMetadata);
  const playText = new Map<string, string[]>();
  for (const f of playFiles) {
    const parts = under(p.androidMetadata, f);
    const locale = parts.length > 1 ? parts[0]! : undefined;
    if (MEDIA_RE.test(f)) {
      const m = manifestImages.get(f) ?? manifestVideos.get(f);
      const dirName = parts.length > 3 && parts[1] === 'images' ? parts[2]! : '';
      const folder = PLAY_IMAGE_DIRS[dirName];
      const target = (m && byId.get(m.target)) || targetFromName(f, targets) || targets.find((t) => t.store === 'google-play' && folder?.family && t.family === folder.family);
      const kind: ReviewItemKind = folder?.kind ?? (target?.kind === 'screenshot' ? 'screenshot' : 'creative');
      items.push(mediaItem(f, kind, 'google-play', locale, target, 'android'));
    } else {
      const key = locale ?? '';
      playText.set(key, [...(playText.get(key) ?? []), f]);
    }
  }
  for (const [locale, list] of [...playText].sort(([a], [b]) => natural(a, b))) {
    items.push(await textItem(root, locale ? `metadata/google-play/${locale}` : 'metadata/google-play/app', 'google-play', 'android', locale || undefined, list, join(p.androidMetadata, locale), undefined));
  }

  // Custom Product Pages and In-App Events (text from JSON, uploaded with --cpp / --events); each page's own
  // screenshot set is metadata/store/cpp/<page id>/<locale>/NN_slug_<target>.png.
  const cpp = await readJsonIfExists(p.cpp, CppSuggestions).catch(() => undefined);
  const cppImages = new Map<string, string[]>();
  for (const f of await walk(p.cppScreenshots)) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue;
    const [pageId, locale] = under(p.cppScreenshots, f);
    const item = mediaItem(f, 'cpp', 'app-store', locale, targetFromName(f, targets), ascPlatform);
    item.label = `Custom Product Page ${pageId} · ${item.label}`;
    items.push(item);
    cppImages.set(pageId!, [...(cppImages.get(pageId!) ?? []), item.id]);
  }
  for (const page of cpp?.pages ?? []) {
    items.push({ id: `cpp/${page.id}`, kind: 'cpp', store: 'app-store', platform: ascPlatform, label: `Custom Product Page · ${page.name}`, files: [rel(p.cpp), ...(cppImages.get(page.id) ?? [])], data: page });
  }
  // Product Page Optimization tests: each treatment's own set, experiments/<test>/<treatment>/<locale>/…
  const tests = await readJsonIfExists(p.experiments, ExperimentPlan).catch(() => undefined);
  const testImages = new Map<string, string[]>();
  for (const f of await walk(p.experimentScreenshots)) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue;
    const [testId, treatmentId, locale] = under(p.experimentScreenshots, f);
    const item = mediaItem(f, 'experiment', 'app-store', locale, targetFromName(f, targets), ascPlatform);
    item.label = `Test ${testId} · ${treatmentId} · ${item.label}`;
    items.push(item);
    testImages.set(testId!, [...(testImages.get(testId!) ?? []), item.id]);
  }
  for (const e of (tests?.experiments ?? []).filter((x) => !x.result)) {
    items.push({ id: `experiment/${e.id}`, kind: 'experiment', store: 'app-store', platform: ascPlatform, label: `Product Page Optimization · ${e.name}`, files: [rel(p.experiments), ...(testImages.get(e.id) ?? [])], data: e });
  }
  const shots = await readJsonIfExists(p.shots, ShotList).catch(() => undefined);
  for (const e of shots?.creatives.events ?? []) {
    const cards = items.filter((i) => i.kind === 'event' && i.abs && basename(i.abs).includes(`event-${e.id}-`)).map((i) => i.id);
    items.push({ id: `event/${e.id}`, kind: 'event', store: 'app-store', platform: ascPlatform, label: `In-App Event · ${e.id}`, files: [rel(p.shots), ...cards], data: e });
  }

  // Only what the user selected for this run (config.selection) is reviewed, approved and hashed.
  const selected = items.filter((i) => isSelected(ctx, i));
  items.length = 0;
  items.push(...selected);
  const referenced = new Set(items.flatMap((i) => i.files));
  const selFiles = files.filter((f) => referenced.has(f.path));
  // Source JSON is hashed even before its export exists, unless the selection excludes what it feeds.
  const sel = ctx.config.selection?.assets;
  const feeds = (path: string): AssetKind[] => (path === rel(p.shots) ? ['screenshots', 'creatives', 'events'] : path === rel(p.experiments) ? ['screenshots'] : ['metadata']);
  const selJson = metadataJson.filter((f) => referenced.has(f.path) || !sel || feeds(f.path).some((k) => sel.includes(k)));

  // Upload order within each locale × target group.
  const groups = new Map<string, InventoryItem[]>();
  for (const i of items) {
    if (!i.abs) continue;
    const k = `${i.store}|${i.locale}|${i.target ?? i.kind}|${i.kind}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  for (const g of groups.values()) g.sort((a, b) => natural(a.id, b.id)).forEach((i, n) => (i.order = n + 1));

  return { items, files: selFiles, metadataJson: selJson, overallHash: overallHash(selFiles, selJson) };
}

/** Review item kind → `config.selection.assets` kind. CPP pages are listing text, so they follow metadata. */
const ASSET_OF: Record<ReviewItemKind, AssetKind> = { screenshot: 'screenshots', preview: 'previews', creative: 'creatives', event: 'events', metadata: 'metadata', cpp: 'metadata', experiment: 'screenshots', other: 'screenshots' };

/** Whether an item is part of this run's selection (unset selection = everything). */
export function isSelected(ctx: Pick<Ctx, 'config'>, item: Pick<ReviewItem, 'kind' | 'platform'> & { target?: string }): boolean {
  const sel = ctx.config.selection ?? {};
  if (sel.assets && !sel.assets.includes(ASSET_OF[item.kind])) return false;
  if (sel.targets?.length && item.target && !sel.targets.includes(item.target)) return false;
  if (sel.platforms && item.platform !== 'any' && !(sel.platforms as string[]).includes(item.platform)) return false;
  return true;
}

async function textItem(root: string, id: string, store: Store, platform: string, locale: string | undefined, list: string[], base: string, source: string | undefined): Promise<InventoryItem> {
  const fields: NonNullable<InventoryItem['fields']> = [];
  for (const f of list) {
    const key = toPosix(relative(base, f)).replace(/\.txt$/, '');
    const value = /\.(txt|md|json)$/i.test(f) ? (await readFile(f, 'utf8')).replace(/\n$/, '') : `(binary file, ${(await stat(f)).size} bytes)`;
    fields.push({ key, file: toPosix(relative(root, f)), value });
  }
  const files = list.map((f) => toPosix(relative(root, f)));
  if (source && existsSync(source)) files.push(toPosix(relative(root, source)));
  const storeName = store === 'google-play' ? 'Google Play' : 'App Store';
  return { id, kind: 'metadata', store, platform, locale, label: `${storeName} metadata · ${locale ?? 'app level'}`, files, fields };
}

/** Strips gallery-only fields. */
export function reviewItems(inv: Inventory): ReviewItem[] {
  return inv.items.map(({ id, kind, store, platform, locale, target, label, files }) => ({ id, kind, store, platform, locale, target, label, files }));
}

export interface ApprovalCheck {
  ok: boolean;
  reason?: string;
  added: string[];
  removed: string[];
  changed: string[];
  approval?: ApprovalManifest;
}

/** Compares two hash lists by path. */
export function diffHashes(before: HashedFile[], after: HashedFile[]): Pick<ApprovalCheck, 'added' | 'removed' | 'changed'> {
  const a = new Map(before.map((f) => [f.path, f.sha256]));
  const b = new Map(after.map((f) => [f.path, f.sha256]));
  return {
    added: [...b.keys()].filter((k) => !a.has(k)),
    removed: [...a.keys()].filter((k) => !b.has(k)),
    changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)),
  };
}

export async function readApproval(ctx: Ctx): Promise<ApprovalManifest | undefined> {
  return readJsonIfExists(ctx.paths.approval, ApprovalManifest);
}

/** The upload gate: approval.json must exist, be an approval, and match every current file hash. */
export async function checkApproval(ctx: Ctx, inv?: Inventory): Promise<ApprovalCheck> {
  const empty = { added: [], removed: [], changed: [] };
  let approval: ApprovalManifest | undefined;
  try {
    approval = await readApproval(ctx);
  } catch (err) {
    return { ok: false, reason: `metadata/approval.json is invalid: ${(err as Error).message}`, ...empty };
  }
  if (!approval) return { ok: false, reason: 'Nothing has been approved yet (metadata/approval.json is missing).', ...empty };
  if (approval.status !== 'approved') return { ok: false, reason: `The last review requested changes (${approval.rejections.length} rejected items).`, approval, ...empty };
  const current = inv ?? (await buildInventory(ctx));
  const files = diffHashes(approval.files, current.files);
  const json = diffHashes(approval.metadataJson, current.metadataJson);
  const diff = { added: [...files.added, ...json.added], removed: [...files.removed, ...json.removed], changed: [...files.changed, ...json.changed] };
  const ok = current.overallHash === approval.overallHash && !diff.added.length && !diff.removed.length && !diff.changed.length;
  return { ok, reason: ok ? undefined : 'Files changed after approval.', approval, ...diff };
}

/** Throws NeedsInput unless the current files are exactly the approved ones. */
export async function requireApproval(ctx: Ctx, inv?: Inventory): Promise<ApprovalManifest> {
  const res = await checkApproval(ctx, inv);
  if (res.ok) return res.approval!;
  const details = [
    ...res.changed.map((f) => `changed: ${f}`),
    ...res.added.map((f) => `added:   ${f}`),
    ...res.removed.map((f) => `removed: ${f}`),
  ];
  const limited = details.length > 40 ? [...details.slice(0, 40), `… and ${details.length - 40} more`] : details;
  throw new NeedsInput(
    `Upload refused: ${res.reason} Every image, video and text must be reviewed and approved first — run \`vitrin review\` (or \`vitrin review --serve\`), show it to the user, then record their approval (buttons, or \`vitrin approve\`).`,
    limited,
  );
}

/** Records that exactly the approved content was uploaded, with the read-back result (needed by `vitrin finalize`). */
export async function recordUpload(ctx: Ctx, approval: ApprovalManifest, differences: string[]): Promise<void> {
  const upload = { uploadedAt: new Date().toISOString(), overallHash: approval.overallHash, readBack: differences.length ? ('differences' as const) : ('ok' as const), differences };
  await writeJson(ctx.paths.approval, { ...approval, upload });
}

export async function writeSnapshot(ctx: Ctx, inv: Inventory): Promise<void> {
  await writeJson(ctx.paths.reviewSnapshot, { generatedAt: new Date().toISOString(), overallHash: inv.overallHash, files: inv.files, metadataJson: inv.metadataJson, items: reviewItems(inv) } satisfies ReviewSnapshot);
}

/**
 * Approval binds to what the user saw: the last generated report (review-snapshot.json) must show exactly the
 * current files. Throws NeedsInput otherwise.
 */
export async function requireReviewedContent(ctx: Ctx, inv: Inventory, expectHash?: string): Promise<void> {
  // Accepts the full hash or the 12-character prefix `vitrin review` prints.
  if (expectHash !== undefined && (expectHash.length < 12 || !inv.overallHash.startsWith(expectHash.toLowerCase()))) {
    throw new NeedsInput(`The content changed: expected hash ${expectHash.slice(0, 12)}…, current ${inv.overallHash.slice(0, 12)}…. Regenerate the report with \`vitrin review\` and show it to the user again.`);
  }
  const snap = await readJsonIfExists(ctx.paths.reviewSnapshot, ReviewSnapshot).catch(() => undefined);
  if (!snap) throw new NeedsInput('No review report has been generated for this content; run `vitrin review` and show `metadata/report.html` to the user first.');
  if (snap.overallHash !== inv.overallHash) {
    const f = diffHashes(snap.files, inv.files);
    const j = diffHashes(snap.metadataJson, inv.metadataJson);
    throw new NeedsInput('Files changed since the report was generated; run `vitrin review` again and show the new report to the user.', [
      ...[...f.changed, ...j.changed].map((x) => `changed: ${x}`),
      ...[...f.added, ...j.added].map((x) => `added:   ${x}`),
      ...[...f.removed, ...j.removed].map((x) => `removed: ${x}`),
    ]);
  }
}

export async function recordApproval(ctx: Ctx, inv: Inventory, via: ApprovalManifest['via']): Promise<ApprovalManifest> {
  const approval: ApprovalManifest = {
    version: 1,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    via,
    overallHash: inv.overallHash,
    files: inv.files,
    metadataJson: inv.metadataJson,
    items: reviewItems(inv),
    rejections: [],
  };
  await writeJson(ctx.paths.approval, approval);
  // Earlier feedback is resolved by this approval.
  await rm(ctx.paths.reviewFeedback, { force: true });
  await rm(join(ctx.paths.briefs, 'review.md'), { force: true });
  return approval;
}

/** Resolves a user-supplied item reference: exact id, a file path, or a unique file name. */
export function findItem(inv: Inventory, ref: string): InventoryItem | undefined {
  const norm = toPosix(ref.trim()).replace(/^\.\//, '');
  const exact = inv.items.find((i) => i.id === norm);
  if (exact) return exact;
  const media = inv.items.filter((i) => i.abs && (i.id === norm || basename(i.abs) === norm));
  if (media.length) return media.length === 1 ? media[0] : undefined; // a bare file name may be ambiguous across locales
  const byFile = inv.items.filter((i) => i.files.includes(norm));
  return byFile.length === 1 ? byFile[0] : undefined;
}

/** Writes review-feedback.json, the review brief and a changes-requested approval.json. */
export async function recordRejections(ctx: Ctx, inv: Inventory, rejections: Array<{ item: string; comment: string }>, via: ApprovalManifest['via']): Promise<ReviewFeedback> {
  const at = new Date().toISOString();
  const resolved: ReviewFeedback['rejections'] = [];
  const unknown: string[] = [];
  for (const r of rejections) {
    const item = findItem(inv, r.item);
    if (!item) {
      unknown.push(r.item);
      continue;
    }
    resolved.push({ item: item.id, comment: r.comment.trim() || '(no comment)', at, label: item.label, kind: item.kind, locale: item.locale, files: item.files });
  }
  if (unknown.length) throw new NeedsInput(`Unknown or ambiguous review item(s): ${unknown.join(', ')}. Use the item id shown under each item in the report.`);
  if (!resolved.length) throw new NeedsInput('No rejections given.');
  const feedback: ReviewFeedback = { generatedAt: at, overallHash: inv.overallHash, rejections: resolved };
  await writeJson(ctx.paths.reviewFeedback, feedback);
  const approval: ApprovalManifest = {
    version: 1,
    status: 'changes-requested',
    approvedAt: at,
    via,
    overallHash: inv.overallHash,
    files: inv.files,
    metadataJson: inv.metadataJson,
    items: reviewItems(inv),
    rejections: resolved.map(({ item, comment, at: when }): ReviewRejection => ({ item, comment, at: when })),
  };
  await writeJson(ctx.paths.approval, approval);
  await reviewBrief(ctx, feedback);
  return feedback;
}

async function reviewBrief(ctx: Ctx, feedback: ReviewFeedback): Promise<string> {
  const rows = feedback.rejections
    .map((r) => `### ${r.label}\n\n- Item: \`${r.item}\` (${r.kind}${r.locale ? `, ${r.locale}` : ''})\n- Files: ${r.files.map((f) => `\`${f}\``).join(', ')}\n- User comment: ${r.comment.replace(/\n/g, ' ')}\n`)
    .join('\n');
  return writeBrief(
    ctx,
    'review',
    `# Brief: the user rejected ${feedback.rejections.length} review item(s)

Nothing may be uploaded until the user approves. Fix each item below at its source, then regenerate it:

- Metadata text → \`metadata/listing/<locale>.json\` (or the Google Play listing JSON) → \`vitrin write\`.
- Screenshots / creatives / event cards → \`metadata/shots.json\` or \`art-direction.json\` → \`vitrin design\` (\`--only <shot ids>\`).
- App Previews / loops → \`metadata/video-plan.json\` → \`vitrin video\`.
- Custom Product Pages → \`metadata/cpp-suggestions.json\`; In-App Events → \`shots.json\` → \`creatives.events\`.

Then run \`vitrin validate\` and \`vitrin review\` again and show the user the new report. Machine-readable copy: \`metadata/review-feedback.json\`.

${rows}`,
  );
}

const KIND_LABEL: Record<ReviewItemKind, string> = { screenshot: 'screenshots', preview: 'App Previews', creative: 'creatives', event: 'event items', metadata: 'metadata sets', cpp: 'Custom Product Pages', experiment: 'test items', other: 'other' };

/** Counts per store → platform → locale → kind; the textual summary `vitrin approve` prints. */
export function summarize(inv: Inventory): { lines: string[]; counts: Record<string, Record<string, number>> } {
  const counts: Record<string, Record<string, number>> = {};
  for (const i of inv.items) {
    const key = `${i.store === 'google-play' ? 'Google Play' : 'App Store'} · ${i.platform} · ${i.locale ?? 'all locales'}`;
    const c = (counts[key] ??= {});
    c[i.kind] = (c[i.kind] ?? 0) + 1;
  }
  const bytes = inv.files.reduce((n, f) => n + f.bytes, 0);
  const lines = Object.keys(counts)
    .sort(natural)
    .map((k) => `${k}: ${Object.entries(counts[k]!).map(([kind, n]) => `${n} ${KIND_LABEL[kind as ReviewItemKind]}`).join(', ')}`);
  lines.push(`${inv.files.length} upload files (${(bytes / 1_048_576).toFixed(1)} MB) + ${inv.metadataJson.length} source JSON files`);
  lines.push(`Overall hash: ${inv.overallHash}`);
  return { lines, counts };
}

export interface ApproveOptions {
  reject?: string[];
  comment?: string;
  /** Overall hash the user saw (printed by `vitrin review`); refuses when the content differs. */
  expectHash?: string;
}

/**
 * `vitrin approve` — records the user's approval given in the chat after they looked at the report.
 * With `--reject <item> --comment <text>` it records rejections instead and exits 2 for Claude to fix them.
 */
export async function approveCommand(ctx: Ctx, opts: ApproveOptions): Promise<number> {
  await syncFastlaneMetadata(ctx);
  const inv = await buildInventory(ctx);
  if (opts.reject?.length) {
    if (!opts.comment?.trim()) throw new NeedsInput('--reject needs --comment "<what the user wants changed>".');
    const feedback = await recordRejections(ctx, inv, opts.reject.map((item) => ({ item, comment: opts.comment! })), 'cli');
    for (const r of feedback.rejections) log.warn(`Rejected: ${r.label} — ${r.comment}`);
    log.info(`Feedback: ${relative(ctx.root, ctx.paths.reviewFeedback)}, brief: metadata/briefs/review.md. Fix the items, then run \`vitrin review\` again.`);
    log.result({ rejected: feedback.rejections.map((r) => r.item), feedback: ctx.paths.reviewFeedback });
    return EXIT.NEEDS_INPUT;
  }
  if (!inv.items.length) throw new NeedsInput('Nothing to approve: no metadata, screenshots or videos were found.');
  await requireReviewedContent(ctx, inv, opts.expectHash);
  const { lines, counts } = summarize(inv);
  log.step('Approving exactly this content for upload:');
  for (const l of lines) log.info(`  ${l}`);
  const approval = await recordApproval(ctx, inv, 'cli');
  log.ok(`Approved → ${relative(ctx.root, ctx.paths.approval)}. Any change to these files requires a new review.`);
  log.result({ approvedAt: approval.approvedAt, overallHash: approval.overallHash, counts, files: approval.files.length });
  return EXIT.OK;
}

/** `vitrin all` stage after review: continues only when the user approved exactly the current content. */
export async function approvalStage(ctx: Ctx): Promise<number> {
  const inv = await buildInventory(ctx);
  const res = await checkApproval(ctx, inv);
  if (res.ok) {
    log.ok('Approved content matches the files on disk.');
    return EXIT.OK;
  }
  for (const l of summarize(inv).lines) log.info(`  ${l}`);
  for (const f of [...res.changed, ...res.added, ...res.removed].slice(0, 20)) log.info(`  changed since approval: ${f}`);
  log.warn(`${res.reason} Show metadata/report.html (or \`vitrin review --serve\`) to the user and record their decision (\`vitrin approve\`).`);
  return EXIT.NEEDS_INPUT;
}
