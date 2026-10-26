import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const version: string = readJson('package.json').version;
const CLI = join(ROOT, 'packages', 'cli', 'dist', 'bin.js');
const LAUNCHER = join(ROOT, 'plugins', 'vitrin', 'bin', 'vitrin');

describe('release version (root package.json is the single source)', () => {
  it('is mirrored by the plugin, the marketplace entry and every workspace package', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readJson('plugins/vitrin/.claude-plugin/plugin.json').version).toBe(version);
    const market = readJson('.claude-plugin/marketplace.json');
    const entry = market.plugins.find((p: { name: string }) => p.name === 'vitrin');
    expect(entry.source).toBe('./plugins/vitrin');
    expect(entry.version).toBe(version);
    for (const dir of readdirSync(join(ROOT, 'packages'))) {
      const file = join('packages', dir, 'package.json');
      if (existsSync(join(ROOT, file))) expect(`${file}@${readJson(file).version}`).toBe(`${file}@${version}`);
    }
  });

  it('has CHANGELOG notes for the version (the GitHub Release body)', async () => {
    // @ts-expect-error plain .mjs script without type declarations
    const { releaseNotes } = (await import('../scripts/release-notes.mjs')) as { releaseNotes: (c: string, v: string) => string };
    const notes = releaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).not.toMatch(/^## /m);
    const sample = '# Changelog\n\n## 1.1.0 — 2026-01-02\n\n- b\n\n## 1.0.0 — 2026-01-01\n\n- a\n';
    expect(releaseNotes(sample, '1.1.0')).toBe('- b');
    expect(releaseNotes(sample, '1.0.0')).toBe('- a');
    expect(releaseNotes(sample, '1.0')).toBe('');
  });

  it.skipIf(!existsSync(CLI))('vitrin --version prints it', () => {
    expect(execFileSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }).trim()).toBe(version);
  });
});

describe('Claude Code plugin', () => {
  it('ships the /vitrin skill and an executable POSIX launcher', () => {
    const skill = readFileSync(join(ROOT, 'plugins', 'vitrin', 'skills', 'vitrin', 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\nname: vitrin\n/);
    expect(skill).not.toMatch(/git clone/);
    accessSync(LAUNCHER, constants.X_OK);
    execFileSync('sh', ['-n', LAUNCHER]);
    const launcher = readFileSync(LAUNCHER, 'utf8');
    expect(launcher.startsWith('#!/bin/sh\n')).toBe(true);
    // The release workflow uploads exactly this asset name.
    expect(launcher).toContain('releases/download/v$version/ardasnturk-vitrin-$version.tgz');
    expect(launcher).toContain('node_modules/@ardasnturk/vitrin/dist/bin.js');
  });
});

describe.skipIf(!existsSync(CLI))('packed @ardasnturk/vitrin tarball', () => {
  const out = mkdtempSync(join(tmpdir(), 'vitrin-pack-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('contains the bundled CLI and every runtime file the code reads from disk', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'pack.mjs'), '--out', out], { stdio: 'pipe' });
    const tgz = join(out, `ardasnturk-vitrin-${version}.tgz`);
    expect(existsSync(tgz)).toBe(true);
    const files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((f) => f.replace(/^package\//, ''));
    const expected = [
      'package.json',
      'README.md',
      'LICENSE',
      'dist/bin.js',
      'fastlane/Fastfile',
      'fastlane/Gemfile',
      'scripts/ocr.swift',
      'src/types.ts',
      ...readdirSync(join(ROOT, 'data')).filter((f) => f.endsWith('.json')).map((f) => `data/${f}`),
      ...readdirSync(join(ROOT, 'packages', 'video', 'src', 'remotion')).map((f) => `src/remotion/${f}`),
    ];
    expect(files.sort()).toEqual([...new Set(expected)].sort());

    const pkg = JSON.parse(readFileSync(join(out, 'package', 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({ name: '@ardasnturk/vitrin', version, bin: { vitrin: 'dist/bin.js' }, engines: { node: '>=22' } });
    const deps = Object.keys(pkg.dependencies);
    expect(deps.filter((d) => d.startsWith('@vitrin/'))).toEqual([]);
    for (const d of ['sharp', 'playwright', 'remotion', '@remotion/bundler', '@remotion/renderer', 'react', 'zod', 'yaml', 'commander', 'lucide-static', '@fontsource-variable/inter']) {
      expect(deps).toContain(d);
    }
    // Same ranges as the workspace packages declare today.
    expect(pkg.dependencies.sharp).toBe(readJson('packages/render/package.json').dependencies.sharp);
    expect(pkg.dependencies.remotion).toBe(readJson('packages/video/package.json').dependencies.remotion);

    const bin = readFileSync(join(out, 'package', 'dist', 'bin.js'), 'utf8');
    expect(bin.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(bin).not.toMatch(/from ['"]@vitrin\//);
  }, 120_000);
});
