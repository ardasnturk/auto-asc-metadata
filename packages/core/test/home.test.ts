import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DATA_DIR, findVitrinHome, TEMPLATES_DIR, VITRIN_HOME, vitrinVersion } from '../src/index.js';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'vitrin-home-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fakeRoot(dir: string, version = '9.9.9'): string {
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'targets.json'), '{"targets":[]}');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  return dir;
}

describe('Vitrin home resolver', () => {
  it('finds the monorepo root from packages/core/dist', () => {
    const root = fakeRoot(join(tmp, 'mono'));
    mkdirSync(join(root, 'packages', 'core', 'dist'), { recursive: true });
    expect(findVitrinHome(join(root, 'packages', 'core', 'dist'))).toBe(root);
  });

  it('finds the installed package root from <pkg>/dist (bundled bin.js)', () => {
    const pkg = fakeRoot(join(tmp, 'prefix', 'node_modules', '@ardasnturk', 'vitrin'));
    mkdirSync(join(pkg, 'dist'), { recursive: true });
    expect(findVitrinHome(join(pkg, 'dist'))).toBe(pkg);
  });

  it('needs both data/targets.json and package.json, and returns undefined when nothing matches', () => {
    const lone = join(tmp, 'lone', 'a', 'b');
    mkdirSync(join(tmp, 'lone', 'data'), { recursive: true });
    writeFileSync(join(tmp, 'lone', 'data', 'targets.json'), '{}');
    mkdirSync(lone, { recursive: true });
    // tmpdir() itself is never a Vitrin root, so the walk ends at the filesystem root.
    expect(findVitrinHome(lone)).toBeUndefined();
  });

  it('resolves this checkout and its data, templates and version', () => {
    expect(VITRIN_HOME).toBe(REPO);
    expect(DATA_DIR).toBe(join(REPO, 'data'));
    expect(TEMPLATES_DIR).toBe(join(REPO, 'fastlane'));
    expect(vitrinVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(vitrinVersion(fakeRoot(join(tmp, 'v'), '1.2.3'))).toBe('1.2.3');
    expect(vitrinVersion(join(tmp, 'missing'))).toBe('0.0.0');
  });
});
