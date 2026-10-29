import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalManifest, ReviewFeedback } from '@vitrin/schemas';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildInventory,
  checkApproval,
  diffHashes,
  findItem,
  overallHash,
  recordApproval,
  recordRejections,
  requireApproval,
  requireReviewedContent,
  summarize,
} from '../src/approval.js';
import { createContext, NeedsInput, type Ctx } from '../src/context.js';
import { buildReport } from '../src/report.js';
import { makeFixture, type Fixture } from './fixture.js';

const h = (c: string) => c.repeat(64);

describe('approval hashing', () => {
  it('overall hash is order-independent and changes with any path or content', () => {
    const a = [{ path: 'a.png', sha256: h('1'), bytes: 1 }, { path: 'b.png', sha256: h('2'), bytes: 1 }];
    const m = [{ path: 'metadata/listing/tr.json', sha256: h('3'), bytes: 1 }];
    expect(overallHash(a, m)).toBe(overallHash([...a].reverse(), m));
    expect(overallHash(a, m)).not.toBe(overallHash([a[0]!, { ...a[1]!, sha256: h('4') }], m));
    expect(overallHash(a, m)).not.toBe(overallHash([a[0]!, { ...a[1]!, path: 'c.png' }], m));
    expect(overallHash(a, m)).not.toBe(overallHash(a, []));
    // A file moving between the upload set and the source JSON set is a change too.
    expect(overallHash(a, m)).not.toBe(overallHash([...a, ...m], []));
  });

  it('diffs by path', () => {
    const before = [{ path: 'a', sha256: h('1'), bytes: 1 }, { path: 'b', sha256: h('2'), bytes: 1 }];
    const after = [{ path: 'b', sha256: h('3'), bytes: 1 }, { path: 'c', sha256: h('4'), bytes: 1 }];
    expect(diffHashes(before, after)).toEqual({ added: ['c'], removed: ['a'], changed: ['b'] });
  });
});

describe('inventory, approval and change detection', () => {
  let fx: Fixture;
  let ctx: Ctx;
  beforeAll(async () => {
    fx = await makeFixture();
    ctx = await createContext({ cwd: fx.root });
  });

  it('inventories every uploadable file with sha256, grouped by store / platform / locale / target', async () => {
    const inv = await buildInventory(ctx);
    const paths = inv.files.map((f) => f.path);
    expect(paths).toContain('metadata/store/screenshots/en-US/01_shot1_iphone-6.3.png');
    expect(paths).toContain('metadata/store/app-previews/tr/01_IPHONE_67.mp4');
    expect(paths).toContain('metadata/creative/en-US/header_header.png');
    expect(paths).toContain('metadata/store/metadata/android/en-US/images/phoneScreenshots/1_shot1.png');
    expect(paths.some((p) => p.includes('.remotion.'))).toBe(false);
    expect(inv.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(inv.metadataJson.map((f) => f.path)).toEqual(expect.arrayContaining(['metadata/listing/en-US.json', 'metadata/listing/app.json', 'metadata/cpp-suggestions.json', 'metadata/shots.json']));

    const shot = inv.items.find((i) => i.id === 'metadata/store/screenshots/tr/02_shot2_iphone-6.9.png')!;
    expect(shot).toMatchObject({ kind: 'screenshot', store: 'app-store', platform: 'ios', locale: 'tr', target: 'iphone-6.9', order: 2 });
    expect(inv.items.find((i) => i.id.endsWith('01_IPHONE_67.mp4'))).toMatchObject({ kind: 'preview', target: 'preview-iphone', durationSec: 2 });
    expect(inv.items.find((i) => i.id.endsWith('event-card_event-launch-card.png'))).toMatchObject({ kind: 'event', target: 'event-card' });
    expect(inv.items.find((i) => i.id === 'event/launch')?.files).toContain('metadata/creative/en-US/event-card_event-launch-card.png');
    expect(inv.items.find((i) => i.id === 'cpp/students')).toMatchObject({ kind: 'cpp', store: 'app-store' });
    const play = inv.items.filter((i) => i.store === 'google-play');
    expect(play.find((i) => i.kind === 'screenshot')).toMatchObject({ platform: 'android', locale: 'en-US' });
    expect(play.find((i) => i.id === 'metadata/google-play/en-US')?.fields?.map((f) => f.key)).toEqual(['changelogs/42', 'full_description', 'short_description', 'title']);
    expect(summarize(inv).lines.join('\n')).toMatch(/Google Play · android · en-US: .*2 screenshots/);
  });

  it('exports and covers the App Store text files from metadata/listing', async () => {
    const { syncFastlaneMetadata } = await import('../src/approval.js');
    expect(await syncFastlaneMetadata(ctx)).toBe(true);
    const inv = await buildInventory(ctx);
    const en = inv.items.find((i) => i.id === 'metadata/app-store/en-US')!;
    expect(en.fields?.find((f) => f.key === 'name')?.value).toBe('Ritim: Habit Tracker');
    expect(en.files).toContain('metadata/listing/en-US.json');
    expect(inv.items.find((i) => i.id === 'metadata/app-store/app')?.fields?.map((f) => f.key)).toContain('copyright');
  });

  it('refuses without approval, passes after approval and detects every later change', async () => {
    rmSync(ctx.paths.approval, { force: true });
    expect((await checkApproval(ctx)).ok).toBe(false);
    await expect(requireApproval(ctx)).rejects.toBeInstanceOf(NeedsInput);

    const approval = await recordApproval(ctx, await buildInventory(ctx), 'cli');
    expect(ApprovalManifest.parse(JSON.parse(readFileSync(ctx.paths.approval, 'utf8'))).overallHash).toBe(approval.overallHash);
    expect((await checkApproval(ctx)).ok).toBe(true);

    // Changed screenshot
    const shot = fx.shot('en-US', '01_shot1_iphone-6.3.png');
    const original = readFileSync(shot);
    appendFileSync(shot, Buffer.from([0]));
    let res = await checkApproval(ctx);
    expect(res.ok).toBe(false);
    expect(res.changed).toEqual(['metadata/store/screenshots/en-US/01_shot1_iphone-6.3.png']);
    await expect(requireApproval(ctx)).rejects.toMatchObject({ details: ['changed: metadata/store/screenshots/en-US/01_shot1_iphone-6.3.png'] });
    writeFileSync(shot, original);
    expect((await checkApproval(ctx)).ok).toBe(true);

    // Added and removed files
    const extra = fx.shot('tr', '04_extra_iphone-6.3.png');
    writeFileSync(extra, original);
    res = await checkApproval(ctx);
    expect(res.added).toEqual(['metadata/store/screenshots/tr/04_extra_iphone-6.3.png']);
    rmSync(extra);
    const pv = join(fx.root, 'metadata', 'store', 'app-previews', 'tr', '01_IPHONE_67.mp4');
    const pvData = readFileSync(pv);
    rmSync(pv);
    expect((await checkApproval(ctx)).removed).toEqual(['metadata/store/app-previews/tr/01_IPHONE_67.mp4']);
    writeFileSync(pv, pvData);

    // Metadata JSON change (the source the export and the event / CPP upload read)
    const meta = join(fx.root, 'metadata', 'listing', 'tr.json');
    const metaData = readFileSync(meta, 'utf8');
    writeFileSync(meta, metaData.replace('Seriyi bozma', 'Seriyi asla bozma'));
    expect((await checkApproval(ctx)).changed).toEqual(['metadata/listing/tr.json']);
    writeFileSync(meta, metaData);
    expect((await checkApproval(ctx)).ok).toBe(true);
  });

  it('binds approval to the content of the last generated report', async () => {
    rmSync(ctx.paths.reviewSnapshot, { force: true });
    const inv = await buildInventory(ctx);
    await expect(requireReviewedContent(ctx, inv)).rejects.toThrow(/No review report/);
    await buildReport(ctx);
    const fresh = await buildInventory(ctx);
    await expect(requireReviewedContent(ctx, fresh)).resolves.toBeUndefined();
    await expect(requireReviewedContent(ctx, fresh, h('0'))).rejects.toThrow(/content changed/);
    const card = join(fx.root, 'metadata', 'creative', 'tr', 'header_header.png');
    const data = readFileSync(card);
    appendFileSync(card, Buffer.from([1]));
    await expect(requireReviewedContent(ctx, await buildInventory(ctx))).rejects.toMatchObject({ details: ['changed: metadata/creative/tr/header_header.png'] });
    writeFileSync(card, data);
  });

  it('records rejections as feedback, a brief and a changes-requested approval that blocks upload', async () => {
    const inv = await buildInventory(ctx);
    expect(findItem(inv, '03_shot3_iphone-6.9.png')).toBeUndefined(); // ambiguous across locales
    expect(findItem(inv, 'metadata/store/screenshots/tr/03_shot3_iphone-6.9.png')?.locale).toBe('tr');
    await expect(recordRejections(ctx, inv, [{ item: 'nope.png', comment: 'x' }], 'cli')).rejects.toThrow(/Unknown or ambiguous review item/);
    const fb = await recordRejections(ctx, inv, [{ item: 'metadata/store/screenshots/tr/03_shot3_iphone-6.9.png', comment: 'Headline too long' }, { item: 'metadata/app-store/en-US', comment: 'Subtitle: say "daily"' }], 'cli');
    expect(ReviewFeedback.parse(JSON.parse(readFileSync(ctx.paths.reviewFeedback, 'utf8'))).rejections).toHaveLength(2);
    expect(fb.rejections[1]!.files).toContain('metadata/listing/en-US.json');
    const brief = readFileSync(join(ctx.paths.briefs, 'review.md'), 'utf8');
    expect(brief).toContain('Headline too long');
    expect(brief).toContain('`metadata/app-store/en-US`');
    const res = await checkApproval(ctx);
    expect(res.ok).toBe(false);
    expect(res.approval?.status).toBe('changes-requested');
    // A later approval clears the feedback.
    await recordApproval(ctx, inv, 'cli');
    expect(existsSync(ctx.paths.reviewFeedback)).toBe(false);
    expect(existsSync(join(ctx.paths.briefs, 'review.md'))).toBe(false);
  });
});

describe('approval and validation', () => {
  it('refuses to approve while the last validation found errors, and approves once it passes', async () => {
    const fx = await makeFixture({ android: false });
    try {
      const ctx = await createContext({ cwd: fx.root });
      const inv = await buildInventory(ctx);
      const report = JSON.parse(readFileSync(ctx.paths.validation, 'utf8'));
      const failing = { ...report, ok: false, counts: { error: 1, warning: 0, info: 0 }, issues: [{ severity: 'error', code: 'metadata.stray-locale', message: 'metadata/store/metadata/de-DE is a locale not in the config.' }] };
      writeFileSync(ctx.paths.validation, JSON.stringify(failing));
      const err = await recordApproval(ctx, inv, 'cli').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NeedsInput);
      expect((err as NeedsInput).message).toContain('1 error(s)');
      expect(err).toMatchObject({ code: 'validation-errors', params: { n: 1 } });
      expect((err as NeedsInput).details).toEqual(['[metadata.stray-locale] metadata/store/metadata/de-DE is a locale not in the config.']);
      expect(existsSync(ctx.paths.approval)).toBe(false);
      writeFileSync(ctx.paths.validation, JSON.stringify(report));
      await expect(recordApproval(ctx, inv, 'cli')).resolves.toMatchObject({ status: 'approved' });
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});

describe('Custom Product Page screenshot sets', () => {
  it('are hashed for approval, listed under their page and shown in the report', async () => {
    const fx = await makeFixture();
    const ctx = await createContext({ cwd: fx.root });
    const src = join(ctx.paths.screenshots, 'en-US', '01_shot1_iphone-6.3.png');
    const dir = join(ctx.paths.cppScreenshots, 'students', 'en-US');
    const { mkdirSync, copyFileSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    copyFileSync(src, join(dir, '01_shot1_iphone-6.3.png'));
    const inv = await buildInventory(ctx);
    const id = 'metadata/store/cpp/students/en-US/01_shot1_iphone-6.3.png';
    expect(inv.files.map((f) => f.path)).toContain(id);
    expect(inv.items.find((i) => i.id === id)).toMatchObject({ kind: 'cpp', locale: 'en-US', target: 'iphone-6.3' });
    expect(inv.items.find((i) => i.id === 'cpp/students')?.files).toContain(id);
    const html = readFileSync(await buildReport(ctx, { inventory: inv }), 'utf8');
    expect(html).toContain('store/cpp/students/en-US/01_shot1_iphone-6.3.png');
  });
});

describe('Product Page Optimization treatment sets', () => {
  it('are hashed for approval, listed under their test and shown in the report', async () => {
    const fx = await makeFixture();
    const ctx = await createContext({ cwd: fx.root });
    writeFileSync(
      ctx.paths.experiments,
      JSON.stringify({ experiments: [{ id: 'hero', name: 'Hero', hypothesis: 'If the hero states the outcome, conversion rises because people search for outcomes.', treatments: [{ id: 'outcome', name: 'Outcome', change: 'hero copy', copy: { '01': { 'en-US': { headline: 'Never miss a day' } } } }] }] }),
    );
    const { mkdirSync, copyFileSync } = await import('node:fs');
    const dir = join(ctx.paths.experimentScreenshots, 'hero', 'outcome', 'en-US');
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(ctx.paths.screenshots, 'en-US', '01_shot1_iphone-6.3.png'), join(dir, '01_shot1_iphone-6.3.png'));
    const inv = await buildInventory(ctx);
    const id = 'metadata/store/experiments/hero/outcome/en-US/01_shot1_iphone-6.3.png';
    expect(inv.files.map((f) => f.path)).toContain(id);
    expect(inv.metadataJson.map((f) => f.path)).toContain('metadata/experiments.json');
    expect(inv.items.find((i) => i.id === id)).toMatchObject({ kind: 'experiment', locale: 'en-US', target: 'iphone-6.3' });
    expect(inv.items.find((i) => i.id === 'experiment/hero')?.files).toContain(id);
    const html = readFileSync(await buildReport(ctx, { inventory: inv }), 'utf8');
    expect(html).toContain('If the hero states the outcome');
    expect(html).toContain('vitrin upload --experiment hero');
  });
});
