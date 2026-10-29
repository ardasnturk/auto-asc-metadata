import { ensureDir, existsSync, log, writeJson } from '@vitrin/core';
import { copyFile, lstat, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildInventory, readApproval, syncFastlaneMetadata, hashFile, type InventoryItem } from './approval.js';
import { closeBrief, writeBrief } from './briefs.js';
import { EXIT, NeedsInput, type Ctx } from './context.js';

/**
 * `vitrin finalize --checked --delete-research | --keep-research` — after a successful upload whose read-back
 * the user checked. Everything Vitrin generated stays in `<project>/metadata/`; the only question is whether the
 * research data (competitors, review clusters, keyword research and the downloads behind them) is deleted.
 * Nothing is deleted unless the user said so.
 */

export interface FinalizeOptions {
  /** true = delete metadata/research/, false = keep it, undefined = ask the user. */
  deleteResearch?: boolean;
  /** The user looked at the read-back result and confirmed the store shows what they approved. */
  checked?: boolean;
}

export interface Removed {
  path: string;
  bytes: number;
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

/** The research data `--delete-research` removes: every entry of metadata/research/ (project-relative). */
export async function researchPaths(ctx: Ctx): Promise<Array<{ rel: string; bytes: number }>> {
  const dir = ctx.paths.research;
  if (!existsSync(dir)) return [];
  const out: Array<{ rel: string; bytes: number }> = [];
  for (const e of (await readdir(dir)).sort()) out.push({ rel: toPosix(relative(ctx.root, join(dir, e))), bytes: await diskSize(join(dir, e)) });
  return out;
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

interface ProjectManifest {
  generator?: string;
  files?: KeptFile[];
}

async function readProjectManifest(file: string): Promise<ProjectManifest | undefined> {
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as ProjectManifest) : undefined;
}

/**
 * After a successful `vitrin write`: the validated store text, readable in the project as
 * `metadata/<store>/<platform>/<locale>/<field>.txt` next to the rest of the workspace.
 */
export async function exportProjectMetadata(ctx: Ctx): Promise<{ files: string[]; skipped?: string }> {
  const outRoot = insideProject(ctx.root, 'metadata');
  const manifestFile = join(outRoot, 'manifest.json');
  const prev = await readProjectManifest(manifestFile);
  await syncFastlaneMetadata(ctx);
  const inv = await buildInventory(ctx);
  const text: KeptFile[] = [];
  for (const item of inv.items.filter((i) => i.kind === 'metadata')) {
    for (const f of item.fields ?? []) {
      if (!f.file.startsWith('metadata/store/')) continue;
      const dest = keepPath(item, f.file);
      const abs = insideProject(ctx.root, dest);
      await ensureDir(dirname(abs));
      await copyFile(insideProject(ctx.root, f.file), abs);
      text.push({ path: dest, source: f.file, sha256: await hashFile(abs), bytes: (await lstat(abs)).size });
    }
  }
  // Text from an earlier write that is no longer produced goes; media kept by `finalize --keep` stays.
  const written = new Set(text.map((f) => f.path));
  const old = prev?.files ?? [];
  for (const f of old) if (f.source.startsWith('metadata/store/metadata/') && !written.has(f.path)) await rm(insideProject(ctx.root, f.path), { force: true });
  const kept = old.filter((f) => !f.source.startsWith('metadata/store/metadata/'));
  await writeJson(manifestFile, { generator: 'vitrin', updatedAt: new Date().toISOString(), files: [...kept, ...text] });
  return { files: text.map((f) => f.path) };
}

/** `metadata/uploaded.json`: exactly what was uploaded (paths and hashes from the approval). */
async function writeUploadRecord(ctx: Ctx): Promise<number> {
  const approval = (await readApproval(ctx))!;
  const files = [...approval.files, ...approval.metadataJson].map((f) => ({ path: f.path, sha256: f.sha256 }));
  await writeJson(join(ctx.paths.vitrin, 'uploaded.json'), { generator: 'vitrin', overallHash: approval.overallHash, uploadedAt: approval.upload?.uploadedAt, finalizedAt: new Date().toISOString(), files });
  return files.length;
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

  const research = await researchPaths(ctx);
  const researchBytes = research.reduce((n, r) => n + r.bytes, 0);
  if (!opts.checked || opts.deleteResearch === undefined) {
    const list = research.length ? research.map((r) => `   - \`${r.rel}\` (${fmtSize(r.bytes)})`).join('\n') : '   - (no research data in metadata/research/)';
    const brief = await writeBrief(
      ctx,
      'finalize',
      `# Brief: finish the run after the upload

The upload of the approved content (hash \`${approval.overallHash.slice(0, 12)}\`) finished on ${approval.upload.uploadedAt} and the read-back matched.
${opts.checked ? '' : `
1. Show the user the read-back result and ask them to check the listing in App Store Connect / Google Play. Continue only when they confirm it looks right.`}

2. Everything Vitrin generated stays in \`metadata/\` (store text, screenshots, previews, creatives, mockups, design samples). **Ask** the user whether to delete all research data now (${fmtSize(researchBytes)}):
${list}
   That is the competitor list and review clusters, the keyword research and the downloads behind them (HTTP cache, competitor screenshots, OCR). The next run can download it again with \`vitrin research\`. Never delete without their explicit answer.

Then run \`vitrin finalize --checked --delete-research\` (yes) or \`vitrin finalize --checked --keep-research\` (no).
`,
    );
    throw new NeedsInput(`Finalize needs the user's input: ${opts.checked ? '' : 'confirm the read-back; '}${opts.deleteResearch === undefined ? 'delete the research data or keep it' : ''}. Brief: ${relative(ctx.root, brief)}`);
  }

  const recorded = await writeUploadRecord(ctx);
  log.ok(`Recorded the ${recorded} uploaded files in metadata/uploaded.json; everything generated stays in metadata/.`);
  const removed: Removed[] = [];
  if (opts.deleteResearch) {
    for (const r of research) {
      await rm(insideProject(ctx.root, r.rel), { recursive: true, force: true });
      removed.push({ path: r.rel, bytes: r.bytes });
    }
    await rm(ctx.paths.research, { recursive: true, force: true });
    log.info(`Deleted the research data (${fmtSize(researchBytes)}):`);
    for (const r of removed) log.dim(`  ${r.path}  ${fmtSize(r.bytes)}`);
  } else {
    log.info(`Kept the research data in metadata/research/ (${fmtSize(researchBytes)}).`);
  }
  await writeJson(ctx.paths.approval, { ...approval, finalized: { at: new Date().toISOString(), mode: opts.deleteResearch ? 'delete-research' : 'keep-research' } });
  await closeBrief(ctx, 'finalize');
  log.result({ mode: opts.deleteResearch ? 'delete-research' : 'keep-research', removed, researchBytes });
  return EXIT.OK;
}
