import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compareVersions, missingUploadKeys } from '../src/commands/doctor.js';
import { mergeProfile } from '../src/commands/pipeline.js';
import type { AppProfile } from '@vitrin/schemas';

const BIN = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'bin.js');
const run = promisify(execFile);

async function vitrin(cwd: string, ...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const r = await run('node', [BIN, ...args], { cwd, env: { ...process.env, ASC_KEY_ID: '', ASC_ISSUER_ID: '', ASC_KEY_PATH: '', ASC_KEY_CONTENT_BASE64: '' } });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

describe('doctor helpers', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('2.241.1', '2.241.1')).toBe(0);
    expect(compareVersions('2.241.0', '2.241.1')).toBe(-1);
    expect(compareVersions('2.300.0', '2.241.1')).toBe(1);
  });

  it('treats ASC_KEY_CONTENT_BASE64 as an alternative to ASC_KEY_PATH', () => {
    expect(missingUploadKeys({}).map((k) => k.name)).toEqual(['ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_PATH']);
    expect(missingUploadKeys({ ASC_KEY_ID: 'a', ASC_ISSUER_ID: 'b', ASC_KEY_CONTENT_BASE64: 'c' })).toEqual([]);
  });
});

describe('analyze merge', () => {
  it('keeps Claude’s additions across re-analysis', () => {
    const fresh = { features: [{ id: 'charts', source: 'analyzer' }], todo: ['positioning (…) Claude', 'x'] } as unknown as AppProfile;
    const prev = { features: [{ id: 'charts', source: 'analyzer' }, { id: 'streaks', source: 'claude' }], positioning: { audience: 'a', jobToBeDone: 'b', tone: 'c' } } as unknown as AppProfile;
    const merged = mergeProfile(fresh, prev);
    expect(merged.features.map((f) => f.id)).toEqual(['charts', 'streaks']);
    expect(merged.positioning?.audience).toBe('a');
    expect(merged.todo).toEqual(['x']);
  });
});

describe('cli', () => {
  it('doctor stops with exit 2 and a list of missing keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-cli-'));
    writeFileSync(join(dir, 'vitrin.config.yaml'), 'app:\n  bundleId: com.example.app\nurls: {}\n');
    const res = await vitrin(dir, 'doctor', '--offline');
    expect(res.code).toBe(2);
    expect(res.out).toContain('Missing keys required for upload');
    expect(res.out).toContain('ASC_KEY_ID');
    expect(res.out).toContain('Users and Access');
    expect(res.out).toContain('Add them to .env, then reply "continue".');
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toContain('ASC_ISSUER_ID=');
  }, 120_000);

  it('write without metadata asks Claude for input (exit 2) and writes a brief', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-cli-'));
    writeFileSync(join(dir, 'vitrin.config.yaml'), 'app:\n  bundleId: com.example.app\n  locales: [tr]\nurls: {}\n');
    const profile = { generatedAt: 'x', project: { root: dir, targets: [] }, app: { displayName: 'X' }, features: [], brand: {}, docs: {} };
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, '.vitrin'));
    writeFileSync(join(dir, '.vitrin', 'app_profile.json'), JSON.stringify(profile));
    const res = await vitrin(dir, 'write');
    expect(res.code).toBe(2);
    expect(readFileSync(join(dir, '.vitrin', 'briefs', 'write.md'), 'utf8')).toContain('100 bytes');
  }, 60_000);
});
