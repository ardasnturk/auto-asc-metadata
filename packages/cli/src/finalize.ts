import { ensureDir, existsSync, log, writeJson } from '@vitrin/core';
import { copyFile, lstat, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { buildInventory, hashFile, readApproval, requireApproval, syncFastlaneMetadata, type InventoryItem } from './approval.js';
import { writeBrief } from './briefs.js';
import { EXIT, NeedsInput, type Ctx } from './context.js';

/**
 * `vitrin finalize --keep | --discard` — what happens to the generated files after a successful upload whose
 * read-back the user checked. `--keep` copies exactly the uploaded set into `<project>/metadata/`; both modes then
 * delete the generated media and the research artifacts, keeping the small source JSON.
 */

export interface FinalizeOptions {
  /** true = keep in metadata/, false = discard, undefined = use config.retention.keep or ask. */
  keep?: boolean;
  /** The user looked at the read-back result and confirmed the store shows what they approved. */
  checked?: boolean;
}

export interface Removed {
  path: string;
  bytes: number;
  group: 'media' | 'renders' | 'research';
}

const toPosix = (p: string) => p.split(sep).join('/');

/** Resolves a project-relative path and refuses anything outside the project (or the project root itself). */
export function insideProject(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`Refusing to touch a path outside the project: ${rel}`);
  return abs;
}

/** Size on disk without following symlinks. */
export async function diskSize(p: string): Promise<number> {
  let st;
  try {
    st = await lstat(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.size;
  let n = 0;
  for (const e of await readdir(p)) n += await diskSize(join(p, e));
  return n;
}

export function fmtSize(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
}

/** Generated paths deleted after upload (both modes). Source JSON, competitors.json and keywords stay. */
export async function generatedPaths(ctx: Ctx): Promise<Array<{ rel: string; group: Removed['group'] }>> {
  const out: Array<{ rel: string; group: Removed['group'] }> = [];
  const rel = (abs: string) => toPosix(relative(ctx.root, abs));
  const p = ctx.paths;
  for (const abs of [p.screenshots, p.appPreviews, p.creative, p.raw, join(p.vitrin, 'video-styles'), join(p.vitrin, 'samples'), join(p.vitrin, 'variants'), p.report, p.reviewSnapshot, p.renderManifest, p.uploadPlan]) {
    out.push({ rel: rel(abs), group: abs === p.report || abs === p.reviewSnapshot || abs === p.renderManifest || abs === p.uploadPlan ? 'renders' : 'media' });
  }
  // Google Play images exported for supply (the text files stay, like fastlane/metadata).
  if (existsSync(p.androidMetadata)) {
    for (const locale of await readdir(p.androidMetadata)) {
      const images = join(p.androidMetadata, locale, 'images');
      if (existsSync(images)) out.push({ rel: rel(images), group: 'media' });
    }
  }
  // .vitrin/cache: HTTP cache, competitor screenshots and the OCR binary are research; html/thumbs/remotion are renders.
  if (existsSync(p.cache)) {
    for (const e of await readdir(p.cache)) {
      const research = e === 'http' || e === 'competitor-shots' || e.startsWith('vitrin-ocr') || e === 'refdata.json';
      out.push({ rel: rel(join(p.cache, e)), group: research ? 'research' : 'renders' });
    }
  }
  return out;
}

async function removeAll(ctx: Ctx, list: Array<{ rel: string; group: Removed['group'] }>): Promise<Removed[]> {
  const removed: Removed[] = [];
  for (const { rel, group } of list) {
    const abs = insideProject(ctx.root, rel);
    if (!existsSync(abs) && !(await lstat(abs).catch(() => undefined))) continue;
    const bytes = await diskSize(abs);
    await rm(abs, { recursive: true, force: true });
    removed.push({ path: rel, bytes, group });
  }
  return removed;
}

const MEDIA_DIR: Record<string, string> = { screenshot: 'screenshots', preview: 'previews', creative: 'creatives', event: 'creatives', other: 'other' };

export interface KeptFile {
  path: string;
  source: string;
  sha256: string;
  bytes: number;
}

/** `metadata/<store>/<platform>/<locale>/…` destination for one item file. */
function keepPath(item: InventoryItem, source: string): string {
  const base = `metadata/${item.store}/${item.platform}/${item.locale ?? 'all'}`;
  if (item.kind === 'metadata') {
    const field = item.fields?.find((f) => f.file === source);
    return field ? `${base}/${field.key}${field.key.endsWith('.txt') ? '' : '.txt'}` : `${base}/source/${source.split('/').pop()}`;
  }
  return `${base}/${MEDIA_DIR[item.kind] ?? 'other'}/${source.split('/').pop()}`;
}

/** Copies exactly the approved, uploaded set into metadata/ and writes metadata/manifest.json with hashes. */
async function keepUploaded(ctx: Ctx): Promise<{ kept: KeptFile[]; bytes: number }> {
  // A first-release upload removes release_notes.txt after the gate; re-export restores the approved text files.
  await syncFastlaneMetadata(ctx);
  const approval = await requireApproval(ctx);
  const inv = await buildInventory(ctx);
  const approvedHash = new Map([...approval.files, ...approval.metadataJson].map((f) => [f.path, f.sha256]));
  const outRoot = insideProject(ctx.root, 'metadata');
  const manifestFile = join(outRoot, 'manifest.json');
  if (existsSync(outRoot) && (await readdir(outRoot)).length) {
    // Never overwrite a user folder named metadata/: only one Vitrin wrote before (its manifest says so).
    const prev = existsSync(manifestFile) ? (JSON.parse(await readFile(manifestFile, 'utf8')) as { generator?: string; files?: KeptFile[] }) : undefined;
    if (prev?.generator !== 'vitrin') throw new NeedsInput('metadata/ already exists and was not written by Vitrin; move it away or choose --discard.');
    for (const f of prev.files ?? []) await rm(insideProject(ctx.root, f.path), { force: true });
  }
  const kept: KeptFile[] = [];
  for (const item of inv.items) {
    if (item.kind === 'cpp' || (item.kind === 'event' && !item.abs)) {
      const dest = `metadata/${item.store}/${item.platform}/all/${item.kind === 'cpp' ? 'cpp' : 'events'}/${item.id.split('/').pop()}.json`;
      const data = JSON.stringify(item.data, null, 2) + '\n';
      await ensureDir(dirname(insideProject(ctx.root, dest)));
      await writeFile(insideProject(ctx.root, dest), data);
      kept.push({ path: dest, source: item.files[0]!, sha256: await hashFile(insideProject(ctx.root, dest)), bytes: Buffer.byteLength(data) });
      continue;
    }
    for (const source of item.files) {
      const expected = approvedHash.get(source);
      if (!expected) continue;
      if (item.kind === 'metadata' && source.startsWith('.vitrin/')) continue; // source JSON stays where it is
      const dest = keepPath(item, source);
      const abs = insideProject(ctx.root, dest);
      await ensureDir(dirname(abs));
      await copyFile(insideProject(ctx.root, source), abs);
      const sha = await hashFile(abs);
      if (sha !== expected) throw new Error(`Copy of ${source} does not match the approved hash.`);
      kept.push({ path: dest, source, sha256: sha, bytes: (await lstat(abs)).size });
    }
  }
  await writeJson(manifestFile, {
    generator: 'vitrin',
    finalizedAt: new Date().toISOString(),
    overallHash: approval.overallHash,
    uploadedAt: approval.upload?.uploadedAt,
    files: kept,
  });
  return { kept, bytes: kept.reduce((n, f) => n + f.bytes, 0) };
}

/** Stores the user's retention answer in vitrin.config.yaml (comments and formatting preserved). */
export async function storeRetention(ctx: Ctx, keep: boolean): Promise<void> {
  const doc = parseDocument(await readFile(ctx.paths.config, 'utf8'));
  doc.setIn(['retention', 'keep'], keep);
  await writeFile(ctx.paths.config, doc.toString(), 'utf8');
  ctx.config.retention = { ...ctx.config.retention, keep };
}

export async function finalizeCommand(ctx: Ctx, opts: FinalizeOptions): Promise<number> {
  const approval = await readApproval(ctx);
  if (approval?.finalized) {
    log.ok(`Already finalized (${approval.finalized.mode}, ${approval.finalized.at}).`);
    return EXIT.OK;
  }
  if (!approval?.upload) throw new NeedsInput('No successful upload is recorded; `vitrin finalize` runs only after `vitrin upload` has uploaded the approved content.');
  if (approval.upload.overallHash !== approval.overallHash) throw new NeedsInput('The recorded upload is for different content than the current approval; upload again first.');
  if (approval.upload.readBack !== 'ok') throw new NeedsInput('The read-back after the upload found differences; resolve them (and upload again) before finalizing.', approval.upload.differences);

  const keep = opts.keep ?? ctx.config.retention.keep;
  if (!opts.checked || keep === undefined) {
    const brief = await writeBrief(
      ctx,
      'finalize',
      `# Brief: finish the run after the upload

The upload of the approved content (hash \`${approval.overallHash.slice(0, 12)}\`) finished on ${approval.upload.uploadedAt} and the read-back matched.
${opts.checked ? '' : `
1. Show the user the read-back result and ask them to check the listing in App Store Connect / Google Play. Continue only when they confirm it looks right.`}
${keep === undefined ? `
2. Ask the user: **"Keep the generated content in metadata/ or delete it after upload?"**
   - keep → the exact uploaded files are copied to \`metadata/<store>/<platform>/<locale>/\` (with \`metadata/manifest.json\` hashes); git-ignored unless \`retention.commit: true\`.
   - delete → generated screenshots, videos, creatives, renders and raw captures are removed; the source JSON (metadata, art direction, shot list, video plan) stays so everything can be regenerated.
   Either way the research cache (HTTP cache, competitor screenshots, OCR files) is removed; competitors.json and keywords stay.` : `
2. Retention is configured: ${keep ? 'keep in metadata/' : 'delete'} (vitrin.config.yaml → retention.keep).`}

Then run \`vitrin finalize --checked ${keep === undefined ? '--keep` or `vitrin finalize --checked --discard' : keep ? '--keep' : '--discard'}\`. The flag stores the answer in \`vitrin.config.yaml\` → \`retention.keep\`.
`,
    );
    throw new NeedsInput(`Finalize needs the user's input: ${opts.checked ? '' : 'confirm the read-back; '}${keep === undefined ? 'keep or delete the generated content' : ''}. Brief: ${relative(ctx.root, brief)}`);
  }
  if (opts.keep !== undefined && opts.keep !== ctx.config.retention.keep) await storeRetention(ctx, opts.keep);

  let keptBytes = 0;
  if (keep) {
    const res = await keepUploaded(ctx);
    keptBytes = res.bytes;
    log.ok(`Kept ${res.kept.length} uploaded files (${fmtSize(res.bytes)}) in metadata/ (manifest: metadata/manifest.json${ctx.config.retention.commit ? ', committed' : ', git-ignored'}).`);
  }
  const removed = await removeAll(ctx, await generatedPaths(ctx));
  await rmdir(ctx.paths.cache).catch(() => undefined); // only when empty
  for (const group of ['media', 'renders', 'research'] as const) {
    const list = removed.filter((r) => r.group === group);
    if (!list.length) continue;
    log.info(`Deleted ${group} (${fmtSize(list.reduce((n, r) => n + r.bytes, 0))}):`);
    for (const r of list) log.dim(`  ${r.path}  ${fmtSize(r.bytes)}`);
  }
  log.info('Kept: .vitrin/app_profile.json, .vitrin/metadata/, keywords/, competitors.json, art-direction.json, shots.json, video-plan.json, cpp-suggestions.json, fastlane/metadata text.');
  await writeJson(ctx.paths.approval, { ...approval, finalized: { at: new Date().toISOString(), mode: keep ? 'keep' : 'discard' } });
  log.result({ mode: keep ? 'keep' : 'discard', keptBytes, removed });
  return EXIT.OK;
}
