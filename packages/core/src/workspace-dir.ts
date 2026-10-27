import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appPaths, WORKSPACE_DIR, WORKSPACE_MARKER } from './workspace.js';

/** The workspace folder exists but belongs to the user (no marker, not written by an older Vitrin). */
export class WorkspaceTaken extends Error {}

const MARKER_TEXT = 'This folder is the Vitrin workspace: every file Vitrin generates for the store listing lives here.\n';

/** Where an entry of an older `.vitrin/` folder lives in the `metadata/` workspace. */
function migratedPath(name: string): string {
  if (name === 'metadata') return 'listing';
  if (name === 'keywords') return join('research', 'keywords');
  if (name === 'competitors.json') return join('research', 'competitors.json');
  if (name === 'cache') return '.cache';
  return name;
}

/** Research downloads that moved from `.vitrin/cache/` to `metadata/research/cache/`. */
const isResearchCache = (name: string) => name === 'http' || name === 'competitor-shots' || name.startsWith('vitrin-ocr');

/** Entries only Vitrin writes: a metadata/ folder holding one of them is Vitrin's even without the marker. */
const VITRIN_ENTRIES = ['state.json', 'app_profile.json', 'listing', 'screens', 'shots.json', 'art-direction.json', 'research', 'store', 'uploaded.json'];

async function isVitrinFolder(dir: string): Promise<boolean> {
  if (VITRIN_ENTRIES.some((e) => existsSync(join(dir, e)))) return true;
  const manifest = join(dir, 'manifest.json');
  if (!existsSync(manifest)) return false;
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { generator?: string }).generator === 'vitrin';
  } catch {
    return false;
  }
}

async function move(from: string, to: string): Promise<void> {
  if (existsSync(to)) {
    // Both exist (an older export next to the new layout): merge directories, keep the newer file otherwise.
    const entries = await readdir(from, { withFileTypes: true }).catch(() => undefined);
    if (!entries) return void (await rm(from, { force: true }));
    for (const e of entries) await move(join(from, e.name), join(to, e.name));
    await rm(from, { recursive: true, force: true });
    return;
  }
  await mkdir(join(to, '..'), { recursive: true });
  await rename(from, to);
}

/**
 * Makes sure `<root>/metadata/` is Vitrin's workspace: creates it with its marker, moves an older `.vitrin/`
 * folder into it (same files, new layout) and adopts an export an older Vitrin wrote there. A `metadata/`
 * folder the user owns is never touched: it throws WorkspaceTaken instead. Returns what it did.
 */
export async function ensureWorkspace(root: string): Promise<{ created: boolean; migrated: string[] }> {
  const p = appPaths(root);
  const legacy = join(root, '.vitrin');
  const migrated: string[] = [];
  if (existsSync(p.marker) && !existsSync(legacy)) return { created: false, migrated };
  const present = existsSync(p.vitrin) ? await readdir(p.vitrin) : [];
  if (present.length && !existsSync(p.marker) && !(await isVitrinFolder(p.vitrin))) {
    throw new WorkspaceTaken(`${WORKSPACE_DIR}/ already exists and does not belong to Vitrin. Rename or move that folder; Vitrin keeps everything it generates in ${WORKSPACE_DIR}/.`);
  }
  const created = !existsSync(p.vitrin);
  await mkdir(p.vitrin, { recursive: true });
  if (existsSync(legacy)) {
    for (const name of await readdir(legacy)) {
      if (name === 'cache') {
        for (const c of await readdir(join(legacy, 'cache'))) await move(join(legacy, 'cache', c), isResearchCache(c) ? join(p.researchCache, c) : join(p.cache, c));
      } else {
        await move(join(legacy, name), join(p.vitrin, migratedPath(name)));
      }
      migrated.push(`.vitrin/${name} → ${WORKSPACE_DIR}/${migratedPath(name)}`);
    }
    await rm(legacy, { recursive: true, force: true });
    // Recorded stage outputs point at the old folder.
    if (existsSync(p.state)) await writeFile(p.state, (await readFile(p.state, 'utf8')).replaceAll('.vitrin/metadata/', `${WORKSPACE_DIR}/listing/`).replaceAll('.vitrin/', `${WORKSPACE_DIR}/`));
  }
  if (!existsSync(p.marker)) await writeFile(p.marker, MARKER_TEXT);
  return { created, migrated };
}

export { WORKSPACE_MARKER };
