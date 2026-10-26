import { createHash } from 'node:crypto';
import { basename } from 'node:path';

/** components.schemas.UploadOperation (ASC API 4.5.1). */
export interface UploadOperation {
  method: string;
  url: string;
  offset: number;
  length: number;
  requestHeaders?: Array<{ name: string; value: string }>;
}

export interface PollOptions {
  /** Interval between GETs (default 5 s). */
  intervalMs?: number;
  /** Give up waiting after this long; the caller decides whether that is an error. */
  timeoutMs?: number;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends each part of a reserved asset to the URL App Store Connect returned (`uploadOperations`), with exactly the
 * headers it named. The URLs are pre-signed: no Authorization header is sent.
 */
export async function performUploadOperations(ops: UploadOperation[], bytes: Buffer<ArrayBuffer>, file: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!ops.length) throw new Error(`No uploadOperations returned for ${basename(file)}.`);
  for (const op of ops) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const r = await fetchImpl(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!r.ok) throw new Error(`Could not upload part (${r.status}) of ${basename(file)} @${op.offset}`);
  }
}

/** MD5 hex digest: `sourceFileChecksum` of appScreenshots/appPreviews commits. */
export function md5(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}
