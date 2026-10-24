import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir, sha256 } from './fsx.js';
import { writeFile } from 'node:fs/promises';

export interface CachedFetchOptions {
  cacheDir: string;
  /** Cache lifetime in hours (default 24). */
  ttlHours?: number;
  /** Minimum delay between network requests to the same host, ms. */
  minIntervalMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

const lastRequestAt = new Map<string, number>();

async function throttle(host: string, minIntervalMs: number): Promise<void> {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
}

/**
 * GET with an on-disk cache, per-host throttling and retry with backoff on 403/429/5xx.
 * The iTunes Search API allows roughly 20 requests per minute, hence the 3 s default spacing.
 */
export async function cachedFetch(url: string, opts: CachedFetchOptions): Promise<Buffer> {
  const ttl = (opts.ttlHours ?? 24) * 3600_000;
  await ensureDir(opts.cacheDir);
  const file = join(opts.cacheDir, sha256(url).slice(0, 32));
  if (existsSync(file)) {
    const st = await stat(file);
    if (Date.now() - st.mtimeMs < ttl) return readFile(file);
  }
  const host = new URL(url).host;
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, opts.minIntervalMs ?? 3000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'vitrin-cli/0.1 (+aso research)', ...opts.headers } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(file, buf);
        return buf;
      }
      if (res.status === 404) throw Object.assign(new Error(`404 ${url}`), { fatal: true });
      if (![403, 429, 500, 502, 503, 504].includes(res.status)) {
        throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      }
      lastErr = new Error(`HTTP ${res.status} ${url}`);
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function cachedJson<T = unknown>(url: string, opts: CachedFetchOptions): Promise<T> {
  return JSON.parse((await cachedFetch(url, opts)).toString('utf8')) as T;
}
