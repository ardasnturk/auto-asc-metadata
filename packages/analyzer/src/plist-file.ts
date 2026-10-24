import { exec } from '@vitrin/core';
import { readFile } from 'node:fs/promises';
import * as plist from 'plist';

/** Reads an XML or binary property list into a plain object. */
export async function readPlistFile(file: string): Promise<Record<string, unknown>> {
  const buf = await readFile(file);
  if (buf.subarray(0, 6).toString() === 'bplist') {
    const res = await exec('plutil', ['-convert', 'json', '-o', '-', file]);
    if (res.code !== 0) throw new Error(`Could not read plist: ${file}`);
    return JSON.parse(res.stdout) as Record<string, unknown>;
  }
  const parsed = plist.parse(buf.toString('utf8'));
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
}
