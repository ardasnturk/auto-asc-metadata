import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { z } from 'zod';

export class SchemaError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`${file} does not match the schema:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(file, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new SchemaError(file, [`Invalid JSON: ${(err as Error).message}`]);
  }
  return parseWith(file, data, schema);
}

export async function readJsonIfExists<T>(file: string, schema: z.ZodType<T>): Promise<T | undefined> {
  return existsSync(file) ? readJson(file, schema) : undefined;
}

export function parseWith<T>(file: string, data: unknown, schema: z.ZodType<T>): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw new SchemaError(
      file,
      res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return res.data;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(dirname(file));
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function writeText(file: string, text: string): Promise<void> {
  await ensureDir(dirname(file));
  await writeFile(file, text, 'utf8');
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Stable hash of a JSON-serialisable value (object keys sorted). */
export function hashValue(value: unknown): string {
  return sha256(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** Hash of files and directories (content + relative path). Missing paths hash as "missing". */
export async function hashPaths(paths: string[], base: string, exclude: RegExp = /$^/): Promise<string> {
  const h = createHash('sha256');
  for (const p of [...paths].sort()) {
    if (!existsSync(p)) {
      h.update(`missing:${relative(base, p)}`);
      continue;
    }
    for (const f of await listFiles(p)) {
      if (exclude.test(relative(base, f))) continue;
      h.update(relative(base, f));
      h.update(await readFile(f));
    }
  }
  return h.digest('hex');
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'DerivedData', 'build', '.build', 'Pods', '.vitrin', 'fastlane']);

export async function listFiles(root: string, opts: { skip?: Set<string>; maxDepth?: number } = {}): Promise<string[]> {
  const skip = opts.skip ?? SKIP_DIRS;
  const maxDepth = opts.maxDepth ?? 12;
  const st = await stat(root);
  if (st.isFile()) return [root];
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name) || e.name.startsWith('.')) continue;
        // Bundles we want to inspect as directories
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(root, 0);
  return out;
}

export { existsSync };
