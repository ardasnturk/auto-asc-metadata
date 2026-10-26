import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyGitignoreBlock, ensureVitrinGitignore, GITIGNORE_BEGIN, vitrinGitignoreLines } from '@vitrin/core';
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
    expect(vitrinGitignoreLines({ retention: { commit: true } })).not.toContain('/metadata/');
    expect(vitrinGitignoreLines({ retention: { commit: false } })).toContain('/metadata/');
  });

  it('ignores generated files but keeps the committed sources, and reports tracked ignored files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vitrin-gi-'));
    git(root, 'init', '-q');
    const files = [
      '.env', 'secrets/AuthKey.p8', 'AuthKey_X.p8',
      '.vitrin/state.json', '.vitrin/cache/http/a', '.vitrin/raw/tr/iphone/home.png', '.vitrin/creative/tr/header_header.png', '.vitrin/video-styles/tr/01_classic.mp4', '.vitrin/report.html', '.vitrin/approval.json',
      '.vitrin/app_profile.json', '.vitrin/metadata/tr.json', '.vitrin/keywords/tr.json', '.vitrin/art-direction.json', '.vitrin/shots.json', '.vitrin/video-plan.json', '.vitrin/cpp-suggestions.json',
      '.vitrin/store/screenshots/tr/01_a_iphone-6.3.png', '.vitrin/store/app-previews/tr/01_IPHONE_67.mp4', '.vitrin/store/metadata/android/en-US/images/phoneScreenshots/1.png', '.vitrin/store/metadata/android/en-US/title.txt',
      '.vitrin/store/metadata/tr/name.txt', '.vitrin/screens/home.html', 'fastlane/Fastfile', 'fastlane/report.xml', 'fastlane/README.md', 'metadata/app-store/ios/tr/name.txt', 'Sources/App.swift',
    ];
    for (const f of files) {
      mkdirSync(join(root, f, '..'), { recursive: true });
      writeFileSync(join(root, f), 'x');
    }
    // A generated file that was committed before the block existed.
    git(root, 'add', '-f', '.vitrin/cache/http/a', '.vitrin/raw/tr/iphone/home.png');
    const res = await ensureVitrinGitignore(root, { retention: { commit: false } });
    expect(res.changed).toBe(true);
    expect((await ensureVitrinGitignore(root, { retention: { commit: false } })).changed).toBe(false);
    expect(res.trackedIgnored).toEqual([{ path: '.vitrin/cache/', files: 1 }, { path: '.vitrin/raw/', files: 1 }]);

    const ignored = (f: string) => {
      try {
        git(root, 'check-ignore', '-q', '--no-index', f);
        return true;
      } catch {
        return false;
      }
    };
    const shouldIgnore = files.slice(0, 10).concat(['.vitrin/store/screenshots/tr/01_a_iphone-6.3.png', '.vitrin/store/app-previews/tr/01_IPHONE_67.mp4', '.vitrin/store/metadata/android/en-US/images/phoneScreenshots/1.png', '.vitrin/store/metadata/android/en-US/title.txt', '.vitrin/store/metadata/tr/name.txt', 'fastlane/report.xml', 'fastlane/README.md', 'metadata/app-store/ios/tr/name.txt']);
    const shouldKeep = ['.vitrin/app_profile.json', '.vitrin/metadata/tr.json', '.vitrin/keywords/tr.json', '.vitrin/art-direction.json', '.vitrin/shots.json', '.vitrin/video-plan.json', '.vitrin/cpp-suggestions.json', '.vitrin/screens/home.html', 'fastlane/Fastfile', 'Sources/App.swift'];
    for (const f of shouldIgnore) expect(ignored(f), f).toBe(true);
    for (const f of shouldKeep) expect(ignored(f), f).toBe(false);
    // retention.commit: true makes metadata/ committable
    await ensureVitrinGitignore(root, { retention: { commit: true } });
    expect(ignored('metadata/app-store/ios/tr/name.txt')).toBe(false);
    // The index is never changed by Vitrin.
    expect(git(root, 'ls-files').trim().split('\n').sort()).toEqual(['.vitrin/cache/http/a', '.vitrin/raw/tr/iphone/home.png']);
  });

  it('is maintained by every command through the CLI context', async () => {
    const fx = await makeFixture({ android: false });
    await createContext({ cwd: fx.root });
    expect(readFileSync(join(fx.root, '.gitignore'), 'utf8')).toContain('!/.vitrin/shots.json');
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
    expect(play.files.every((f) => f.path.startsWith('.vitrin/store/metadata/android/'))).toBe(true);
    expect(play.overallHash).not.toBe(all.overallHash);
    ctx.config.selection = { assets: ['metadata'] };
    const text = await buildInventory(ctx);
    expect(new Set(text.items.map((i) => i.kind))).toEqual(new Set(['metadata', 'cpp']));
    expect(text.files.some((f) => f.path.endsWith('.png'))).toBe(false);
    expect(text.metadataJson.map((f) => f.path)).not.toContain('.vitrin/shots.json');
  });
});

async function uploaded(opts: { readBack?: string[] } = {}) {
  const fx = await makeFixture();
  const ctx = await createContext({ cwd: fx.root });
  const { syncFastlaneMetadata } = await import('../src/approval.js');
  await syncFastlaneMetadata(ctx);
  // Research and render artifacts that finalize removes.
  for (const f of ['.vitrin/cache/http/abc', '.vitrin/cache/competitor-shots/1-0.jpg', '.vitrin/cache/vitrin-ocr-1234', '.vitrin/cache/html/tr/x.html', '.vitrin/raw/tr/iphone/home.png', '.vitrin/video-styles/tr/01_classic.mp4']) {
    mkdirSync(join(fx.root, f, '..'), { recursive: true });
    writeFileSync(join(fx.root, f), 'generated');
  }
  writeFileSync(join(fx.root, '.vitrin', 'competitors.json'), '{}');
  mkdirSync(join(fx.root, '.vitrin', 'keywords'), { recursive: true });
  writeFileSync(join(fx.root, '.vitrin', 'keywords', 'tr.json'), '{}');
  mkdirSync(join(fx.root, 'Sources'), { recursive: true });
  writeFileSync(join(fx.root, 'Sources', 'App.swift'), '// user code');
  const approval = await recordApproval(ctx, await buildInventory(ctx), 'cli');
  await recordUpload(ctx, approval, opts.readBack ?? []);
  return { fx, ctx, approval };
}

describe('metadata in the project', () => {
  it('copies the written store text into metadata/ and never touches a user folder', async () => {
    const fx = await makeFixture({ android: true });
    const ctx = await createContext({ cwd: fx.root });
    const res = await exportProjectMetadata(ctx);
    expect(res.skipped).toBeUndefined();
    expect(readFileSync(join(fx.root, 'metadata/app-store/ios/en-US/name.txt'), 'utf8')).toBe(readFileSync(join(fx.root, '.vitrin/store/metadata/en-US/name.txt'), 'utf8'));
    expect(res.files).toContain('metadata/google-play/android/en-US/title.txt');
    const manifest = JSON.parse(readFileSync(join(fx.root, 'metadata/manifest.json'), 'utf8'));
    expect(manifest.generator).toBe('vitrin');
    // Running again replaces its own files.
    expect((await exportProjectMetadata(ctx)).files.length).toBe(res.files.length);

    const other = await makeFixture({ android: false });
    mkdirSync(join(other.root, 'metadata'), { recursive: true });
    writeFileSync(join(other.root, 'metadata', 'notes.md'), 'mine');
    const skipped = await exportProjectMetadata(await createContext({ cwd: other.root }));
    expect(skipped.skipped).toMatch(/not written by Vitrin/);
    expect(existsSync(join(other.root, 'metadata', 'app-store'))).toBe(false);
  });
});

describe('vitrin finalize', () => {
  it('refuses without a recorded, clean upload', async () => {
    const fx = await makeFixture({ android: false });
    const ctx = await createContext({ cwd: fx.root });
    await expect(finalizeCommand(ctx, { keep: true, checked: true })).rejects.toThrow(/No successful upload/);
    const bad = await uploaded({ readBack: ['tr name differs'] });
    await expect(finalizeCommand(bad.ctx, { keep: true, checked: true })).rejects.toMatchObject({ details: ['tr name differs'] });
  });

  it('asks (exit 2 + brief) until the read-back is checked and keep/discard is known', async () => {
    const { ctx } = await uploaded();
    await expect(finalizeCommand(ctx, {})).rejects.toBeInstanceOf(NeedsInput);
    const brief = readFileSync(join(ctx.paths.briefs, 'finalize.md'), 'utf8');
    expect(brief).toContain('Keep the generated content in metadata/ or delete it after upload?');
    expect(brief).toContain('check the listing');
    await expect(finalizeCommand(ctx, { checked: true })).rejects.toThrow(/keep or delete/);
    expect(existsSync(ctx.paths.screenshots)).toBe(true); // nothing deleted yet
  });

  it('--keep copies exactly the uploaded set into metadata/ and deletes the working copies', async () => {
    const { fx, ctx, approval } = await uploaded();
    expect(await finalizeCommand(ctx, { keep: true, checked: true })).toBe(0);
    const manifest = JSON.parse(readFileSync(join(fx.root, 'metadata', 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ generator: 'vitrin', overallHash: approval.overallHash });
    const byPath = new Map(manifest.files.map((f: { path: string; sha256: string; source: string }) => [f.path, f]));
    const shot = byPath.get('metadata/app-store/ios/tr/screenshots/02_shot2_iphone-6.9.png') as { sha256: string; source: string };
    expect(shot.sha256).toBe(approval.files.find((f) => f.path === shot.source)!.sha256);
    expect(byPath.has('metadata/app-store/ios/en-US/previews/01_IPHONE_67.mp4')).toBe(true);
    expect(byPath.has('metadata/app-store/ios/tr/creatives/header_header.png')).toBe(true);
    expect(byPath.has('metadata/google-play/android/en-US/screenshots/1_shot1.png')).toBe(true);
    expect(readFileSync(join(fx.root, 'metadata/app-store/ios/en-US/name.txt'), 'utf8').trim()).toBe('Ritim: Habit Tracker');
    expect(existsSync(join(fx.root, 'metadata/google-play/android/en-US/changelogs/42.txt'))).toBe(true);
    expect(existsSync(join(fx.root, 'metadata/app-store/ios/all/events/launch.json'))).toBe(true);
    for (const gone of ['.vitrin/store/screenshots', '.vitrin/store/app-previews', '.vitrin/creative', '.vitrin/raw', '.vitrin/video-styles', '.vitrin/cache', '.vitrin/store/metadata/android/en-US/images']) expect(existsSync(join(fx.root, gone)), gone).toBe(false);
    for (const kept of ['.vitrin/metadata/tr.json', '.vitrin/shots.json', '.vitrin/cpp-suggestions.json', '.vitrin/competitors.json', '.vitrin/keywords/tr.json', '.vitrin/store/metadata/tr/name.txt', '.vitrin/store/metadata/android/en-US/title.txt', 'Sources/App.swift', '.env']) expect(existsSync(join(fx.root, kept)), kept).toBe(true);
    expect(readFileSync(ctx.paths.config, 'utf8')).toMatch(/retention:\s*\n\s*keep: true/);
    expect(JSON.parse(readFileSync(ctx.paths.approval, 'utf8')).finalized.mode).toBe('keep');
  });

  it('--discard deletes the generated media and research artifacts but keeps the source JSON', async () => {
    const { fx, ctx } = await uploaded();
    expect(await finalizeCommand(ctx, { keep: false, checked: true })).toBe(0);
    expect(existsSync(join(fx.root, 'metadata'))).toBe(false);
    for (const gone of ['.vitrin/store/screenshots', '.vitrin/store/app-previews', '.vitrin/creative', '.vitrin/cache', '.vitrin/report.html']) expect(existsSync(join(fx.root, gone)), gone).toBe(false);
    for (const kept of ['.vitrin/metadata/en-US.json', '.vitrin/metadata/app.json', '.vitrin/shots.json', '.vitrin/competitors.json', '.vitrin/app_profile.json', 'Sources/App.swift']) expect(existsSync(join(fx.root, kept)), kept).toBe(true);
  });

  it('uses config.retention.keep and never overwrites a metadata/ folder it did not write', async () => {
    const { fx, ctx } = await uploaded();
    ctx.config.retention = { keep: true, commit: false };
    mkdirSync(join(fx.root, 'metadata'));
    writeFileSync(join(fx.root, 'metadata', 'notes.md'), 'user file');
    await expect(finalizeCommand(ctx, { checked: true })).rejects.toThrow(/not written by Vitrin/);
    expect(readFileSync(join(fx.root, 'metadata', 'notes.md'), 'utf8')).toBe('user file');
    expect(existsSync(ctx.paths.screenshots)).toBe(true);
  });

  it('never resolves paths outside the project', () => {
    expect(() => insideProject('/tmp/app', '../etc')).toThrow(/outside the project/);
    expect(() => insideProject('/tmp/app', '.')).toThrow(/outside the project/);
    expect(insideProject('/tmp/app', '.vitrin/store/screenshots')).toBe('/tmp/app/.vitrin/store/screenshots');
  });
});
