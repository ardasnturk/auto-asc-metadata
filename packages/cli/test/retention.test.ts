import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyGitignoreBlock, ensureVitrinGitignore, ensureWorkspace, GITIGNORE_BEGIN, vitrinGitignoreLines, WorkspaceTaken } from '@vitrin/core';
import { describe, expect, it } from 'vitest';
import { buildInventory, recordApproval, recordUpload } from '../src/approval.js';
import { createContext, NeedsInput } from '../src/context.js';
import { exportProjectMetadata, finalizeCommand, insideProject } from '../src/finalize.js';
import { makeFixture } from './fixture.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

describe('managed .gitignore block', () => {
  it('is inserted once, replaced in place and keeps the user lines', () => {
    const lines = vitrinGitignoreLines();
    const once = applyGitignoreBlock('node_modules/\n', lines);
    expect(once.startsWith('node_modules/\n\n# >>> vitrin')).toBe(true);
    expect(applyGitignoreBlock(once, lines)).toBe(once);
    const edited = once.replace('/fastlane/report.xml', '/fastlane/old.xml') + 'dist/\n';
    const fixed = applyGitignoreBlock(edited, lines);
    expect(fixed).toContain('/fastlane/report.xml');
    expect(fixed).not.toContain('old.xml');
    expect(fixed.endsWith('dist/\n')).toBe(true);
    expect(fixed.split(GITIGNORE_BEGIN).length).toBe(2);
    expect(vitrinGitignoreLines({ retention: { commit: true } })).toContain('!/metadata/store/');
    expect(vitrinGitignoreLines({ retention: { commit: false } })).not.toContain('!/metadata/store/');
  });

  it('ignores generated files but keeps the committed sources, and reports tracked ignored files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-gi-'));
    git(root, 'init', '-q');
    const files = [
      '.env', 'secrets/AuthKey.p8', 'AuthKey_X.p8',
      'metadata/state.json', 'metadata/.cache/http/a', 'metadata/raw/tr/iphone/home.png', 'metadata/creative/tr/header_header.png', 'metadata/video-styles/tr/01_classic.mp4', 'metadata/report.html', 'metadata/approval.json',
      'metadata/app_profile.json', 'metadata/listing/tr.json', 'metadata/research/keywords/tr.json', 'metadata/art-direction.json', 'metadata/shots.json', 'metadata/video-plan.json', 'metadata/cpp-suggestions.json',
      'metadata/store/screenshots/tr/01_a_iphone-6.3.png', 'metadata/store/app-previews/tr/01_IPHONE_67.mp4', 'metadata/store/metadata/android/en-US/images/phoneScreenshots/1.png', 'metadata/store/metadata/android/en-US/title.txt',
      'metadata/store/metadata/tr/name.txt', 'metadata/screens/home.html', 'fastlane/Fastfile', 'fastlane/report.xml', 'fastlane/README.md', 'metadata/app-store/ios/tr/name.txt', 'Sources/App.swift',
    ];
    for (const f of files) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), 'x');
    }
    // A generated file that was committed before the block existed.
    git(root, 'add', '-f', 'metadata/.cache/http/a', 'metadata/raw/tr/iphone/home.png');
    const res = await ensureVitrinGitignore(root, { retention: { commit: false } });
    expect(res.changed).toBe(true);
    expect((await ensureVitrinGitignore(root, { retention: { commit: false } })).changed).toBe(false);
    expect(res.trackedIgnored).toEqual([{ path: 'metadata/.cache/', files: 1 }, { path: 'metadata/raw/', files: 1 }]);

    const ignored = (f: string) => {
      try {
        git(root, 'check-ignore', '-q', '--no-index', f);
        return true;
      } catch {
        return false;
      }
    };
    const shouldIgnore = files.slice(0, 10).concat(['metadata/store/screenshots/tr/01_a_iphone-6.3.png', 'metadata/store/app-previews/tr/01_IPHONE_67.mp4', 'metadata/store/metadata/android/en-US/images/phoneScreenshots/1.png', 'metadata/store/metadata/android/en-US/title.txt', 'metadata/store/metadata/tr/name.txt', 'fastlane/report.xml', 'fastlane/README.md', 'metadata/app-store/ios/tr/name.txt']);
    const shouldKeep = ['metadata/app_profile.json', 'metadata/listing/tr.json', 'metadata/research/keywords/tr.json', 'metadata/art-direction.json', 'metadata/shots.json', 'metadata/video-plan.json', 'metadata/cpp-suggestions.json', 'metadata/screens/home.html', 'fastlane/Fastfile', 'Sources/App.swift'];
    for (const f of shouldIgnore) expect(ignored(f), f).toBe(true);
    for (const f of shouldKeep) expect(ignored(f), f).toBe(false);
    // retention.commit: true makes metadata/ committable
    await ensureVitrinGitignore(root, { retention: { commit: true } });
    expect(ignored('metadata/app-store/ios/tr/name.txt')).toBe(false);
    // The index is never changed by Vitrin.
    expect(git(root, 'ls-files').trim().split('\n').sort()).toEqual(['metadata/.cache/http/a', 'metadata/raw/tr/iphone/home.png']);
  });

  it('is maintained by every command through the CLI context', async () => {
    const fx = await makeFixture({ android: false });
    await createContext({ cwd: fx.root });
    expect(readFileSync(join(fx.root, '.gitignore'), 'utf8')).toContain('!/metadata/shots.json');
  });
});

describe('selection', () => {
  it('limits the gallery and approval to the selected platforms and asset kinds', async () => {
    const fx = await makeFixture();
    const ctx = await createContext({ cwd: fx.root });
    const all = await buildInventory(ctx);
    ctx.config.selection = { platforms: ['android'] };
    const play = await buildInventory(ctx);
    expect(play.items.length).toBeGreaterThan(0);
    expect(play.items.every((i) => i.store === 'google-play')).toBe(true);
    expect(play.files.every((f) => f.path.startsWith('metadata/store/metadata/android/'))).toBe(true);
    expect(play.overallHash).not.toBe(all.overallHash);
    ctx.config.selection = { assets: ['metadata'] };
    const text = await buildInventory(ctx);
    expect(new Set(text.items.map((i) => i.kind))).toEqual(new Set(['metadata', 'cpp']));
    expect(text.files.some((f) => f.path.endsWith('.png'))).toBe(false);
    expect(text.metadataJson.map((f) => f.path)).not.toContain('metadata/shots.json');
  });
});

async function uploaded(opts: { readBack?: string[] } = {}) {
  const fx = await makeFixture();
  const ctx = await createContext({ cwd: fx.root });
  const { syncFastlaneMetadata } = await import('../src/approval.js');
  await syncFastlaneMetadata(ctx);
  // Research and render artifacts that finalize removes.
  for (const f of ['metadata/research/cache/http/abc', 'metadata/research/cache/competitor-shots/1-0.jpg', 'metadata/research/cache/vitrin-ocr-1234', 'metadata/.cache/html/tr/x.html', 'metadata/raw/tr/iphone/home.png', 'metadata/video-styles/tr/01_classic.mp4']) {
    mkdirSync(join(fx.root, f, '..'), { recursive: true });
    writeFileSync(join(fx.root, f), 'generated');
  }
  mkdirSync(join(fx.root, 'metadata', 'research', 'keywords'), { recursive: true });
  writeFileSync(join(fx.root, 'metadata', 'research', 'competitors.json'), '{}');
  writeFileSync(join(fx.root, 'metadata', 'research', 'keywords', 'tr.json'), '{}');
  mkdirSync(join(fx.root, 'Sources'), { recursive: true });
  writeFileSync(join(fx.root, 'Sources', 'App.swift'), '// user code');
  const approval = await recordApproval(ctx, await buildInventory(ctx), 'cli');
  await recordUpload(ctx, approval, opts.readBack ?? []);
  return { fx, ctx, approval };
}

describe('metadata in the project', () => {
  it('copies the written store text into readable files under metadata/', async () => {
    const fx = await makeFixture({ android: true });
    const ctx = await createContext({ cwd: fx.root });
    const res = await exportProjectMetadata(ctx);
    expect(res.skipped).toBeUndefined();
    expect(readFileSync(join(fx.root, 'metadata/app-store/ios/en-US/name.txt'), 'utf8')).toBe(readFileSync(join(fx.root, 'metadata/store/metadata/en-US/name.txt'), 'utf8'));
    expect(res.files).toContain('metadata/google-play/android/en-US/title.txt');
    const manifest = JSON.parse(readFileSync(join(fx.root, 'metadata/manifest.json'), 'utf8'));
    expect(manifest.generator).toBe('vitrin');
    // Running again replaces its own files.
    expect((await exportProjectMetadata(ctx)).files.length).toBe(res.files.length);

  });
});

describe('vitrin finalize', () => {
  it('refuses without a recorded, clean upload', async () => {
    const fx = await makeFixture({ android: false });
    const ctx = await createContext({ cwd: fx.root });
    await expect(finalizeCommand(ctx, { deleteResearch: true, checked: true })).rejects.toThrow(/No successful upload/);
    const bad = await uploaded({ readBack: ['tr name differs'] });
    await expect(finalizeCommand(bad.ctx, { deleteResearch: true, checked: true })).rejects.toMatchObject({ details: ['tr name differs'] });
  });

  it('asks (exit 2 + brief) until the read-back is checked and the user answered the research question', async () => {
    const { ctx } = await uploaded();
    await expect(finalizeCommand(ctx, {})).rejects.toBeInstanceOf(NeedsInput);
    const brief = readFileSync(join(ctx.paths.briefs, 'finalize.md'), 'utf8');
    expect(brief).toContain('delete all research data');
    expect(brief).toContain('metadata/research/competitors.json');
    expect(brief).toContain('check the listing');
    await expect(finalizeCommand(ctx, { checked: true })).rejects.toThrow(/delete the research data or keep it/);
    expect(existsSync(ctx.paths.research)).toBe(true); // nothing deleted yet
  });

  it('--delete-research removes only metadata/research/; every generated file stays in metadata/', async () => {
    const { fx, ctx, approval } = await uploaded();
    expect(await finalizeCommand(ctx, { deleteResearch: true, checked: true })).toBe(0);
    expect(existsSync(ctx.paths.research)).toBe(false);
    for (const kept of ['metadata/store/screenshots', 'metadata/store/app-previews', 'metadata/creative', 'metadata/raw', 'metadata/listing/tr.json', 'metadata/shots.json', 'metadata/store/metadata/tr/name.txt', 'Sources/App.swift', '.env']) expect(existsSync(join(fx.root, kept)), kept).toBe(true);
    const record = JSON.parse(readFileSync(join(fx.root, 'metadata', 'uploaded.json'), 'utf8'));
    expect(record).toMatchObject({ generator: 'vitrin', overallHash: approval.overallHash });
    expect(record.files.length).toBe(approval.files.length + approval.metadataJson.length);
    expect(JSON.parse(readFileSync(ctx.paths.approval, 'utf8')).finalized.mode).toBe('delete-research');
  });

  it('--keep-research deletes nothing', async () => {
    const { fx, ctx } = await uploaded();
    expect(await finalizeCommand(ctx, { deleteResearch: false, checked: true })).toBe(0);
    for (const kept of ['metadata/research/competitors.json', 'metadata/research/keywords/tr.json', 'metadata/research/cache/http/abc', 'metadata/store/screenshots']) expect(existsSync(join(fx.root, kept)), kept).toBe(true);
    expect(JSON.parse(readFileSync(ctx.paths.approval, 'utf8')).finalized.mode).toBe('keep-research');
  });

  it('never resolves paths outside the project', () => {
    expect(() => insideProject('/tmp/app', '../etc')).toThrow(/outside the project/);
    expect(() => insideProject('/tmp/app', '.')).toThrow(/outside the project/);
    expect(insideProject('/tmp/app', 'metadata/store/screenshots')).toBe('/tmp/app/metadata/store/screenshots');
  });
});

describe('metadata/ workspace', () => {
  it('moves an older .vitrin/ folder into metadata/ and refuses a metadata/ folder the user owns', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-ws-'));
    for (const [f, body] of [['.vitrin/metadata/tr.json', '{}'], ['.vitrin/keywords/tr.json', '{}'], ['.vitrin/competitors.json', '{}'], ['.vitrin/cache/http/a', 'x'], ['.vitrin/cache/html/b.html', 'x'], ['.vitrin/shots.json', '{}'], ['.vitrin/state.json', '{"version":1,"stages":{"write":{"hash":"h","at":"t","outputs":[".vitrin/metadata/tr.json"]}}}']] as const) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), body);
    }
    const res = await ensureWorkspace(root);
    expect(res.migrated.length).toBe(6);
    for (const f of ['metadata/.vitrin-workspace', 'metadata/listing/tr.json', 'metadata/research/keywords/tr.json', 'metadata/research/competitors.json', 'metadata/research/cache/http/a', 'metadata/.cache/html/b.html', 'metadata/shots.json']) expect(existsSync(join(root, f)), f).toBe(true);
    expect(existsSync(join(root, '.vitrin'))).toBe(false);
    expect(readFileSync(join(root, 'metadata', 'state.json'), 'utf8')).toContain('metadata/listing/tr.json');

    const mine = mkdtempSync(join(tmpdir(), 'vitrin-ws-'));
    mkdirSync(join(mine, 'metadata'));
    writeFileSync(join(mine, 'metadata', 'notes.md'), 'mine');
    await expect(ensureWorkspace(mine)).rejects.toBeInstanceOf(WorkspaceTaken);
    expect(readFileSync(join(mine, 'metadata', 'notes.md'), 'utf8')).toBe('mine');
  });
});
