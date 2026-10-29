import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pruneStrayLocales } from '@vitrin/upload';
import { appPaths } from '@vitrin/core';
import { afterEach, describe, expect, it } from 'vitest';
import { applySelection } from '../src/commands/select.js';
import { systemPrompt } from '../src/studio/claude.js';
import { approvalProblem, briefOpen, buildOverview, designChoice, nextStep, stageFlow, type Blocker } from '../src/studio/overview.js';
import { configWith } from './helpers.js';

/** The Studio's stage model: open briefs, approval validity, stage status, blockers and the next step. */

const at = (h: number) => `2026-10-28T${String(h).padStart(2, '0')}:00:00.000Z`;
const rec = (h: number, status = 'ok') => ({ completedAt: at(h), status });

describe('briefs', () => {
  it('are open until the stage that answers them completes after they were written', () => {
    expect(briefOpen({ name: 'write', modifiedAt: at(10) }, {})).toBe(true);
    expect(briefOpen({ name: 'write', modifiedAt: at(10) }, { write: rec(9) })).toBe(true);
    expect(briefOpen({ name: 'write', modifiedAt: at(10) }, { write: rec(11) })).toBe(false);
    // The analyze brief asks for research seeds: a research run after it answers it.
    expect(briefOpen({ name: 'analyze', modifiedAt: at(10) }, { analyze: rec(10), research: rec(12) })).toBe(false);
    expect(briefOpen({ name: 'screens', modifiedAt: at(10) }, { capture: rec(12, 'blocked') })).toBe(true);
    expect(briefOpen({ name: 'design', modifiedAt: at(10) }, { capture: rec(12) })).toBe(true);
    expect(briefOpen({ name: 'review', modifiedAt: at(10) }, {}, { status: 'approved', approvedAt: at(11) })).toBe(false);
    expect(briefOpen({ name: 'finalize', modifiedAt: at(10) }, {}, { status: 'approved', approvedAt: at(9) })).toBe(true);
    // Claude wrote every file the brief asks for: its part is done even though nobody ran the stage yet.
    expect(briefOpen({ name: 'video', modifiedAt: at(10) }, {}, undefined, [at(11)])).toBe(false);
    expect(briefOpen({ name: 'write', modifiedAt: at(10) }, {}, undefined, [at(11), undefined])).toBe(true);
    expect(briefOpen({ name: 'write', modifiedAt: at(10) }, {}, undefined, [at(11), at(9)])).toBe(true);
  });
});

describe('approval validity', () => {
  it('is invalid with validation errors, after a content stage ran, or when changes were requested', () => {
    const approved = { status: 'approved' as const, approvedAt: at(12) };
    expect(approvalProblem(approved, { write: rec(11) }, { ok: true })).toBeUndefined();
    expect(approvalProblem(approved, { write: rec(11) }, { ok: false })).toBe('validation-errors');
    expect(approvalProblem(approved, { design: rec(13) }, { ok: true })).toBe('content-changed');
    // A capture alone changes nothing that is uploaded.
    expect(approvalProblem(approved, { capture: rec(13) }, { ok: true })).toBeUndefined();
    expect(approvalProblem({ status: 'changes-requested', approvedAt: at(12) }, {}, { ok: true })).toBe('rejected');
  });
});

describe('stage flow', () => {
  const config = configWith({ app: { locales: ['tr'], primaryLocale: 'tr' } });
  const base = { stages: {}, briefs: [], blockers: [] as Blocker[], approval: undefined, validation: undefined, mockups: undefined };

  it('shows an open brief as waiting for Claude, a newer input as outdated and a failed validation as blocked', () => {
    const flow = stageFlow(
      {
        ...base,
        stages: { analyze: rec(8), research: rec(9), write: rec(9), capture: rec(12), design: rec(11), validate: rec(13, 'blocked') },
        briefs: [{ name: 'video', path: 'metadata/briefs/video.md', modifiedAt: at(10), stage: 'video' }],
        validation: { ok: false, counts: { error: 2, warning: 0, info: 0 }, issues: [] },
      },
      config,
    );
    const by = Object.fromEntries(flow.map((s) => [s.id, s]));
    expect(by.analyze).toMatchObject({ status: 'done' });
    expect(by.design).toMatchObject({ status: 'outdated', reason: 'capture' });
    expect(by.video).toMatchObject({ status: 'needs-claude', brief: 'video' });
    expect(by.validate).toMatchObject({ status: 'blocked', reason: 'validation-errors' });
    expect(by.review).toMatchObject({ status: 'not-run' });
    expect(by.mockups).toMatchObject({ optional: true });
    expect(nextStep(flow, [])).toEqual({ stage: 'design', action: 'run' });
  });

  it('marks an approval with validation errors as blocked and skips stages the selection leaves out', () => {
    const flow = stageFlow(
      {
        ...base,
        stages: { analyze: rec(8), research: rec(8), write: rec(8), capture: rec(8), design: rec(9), validate: rec(10, 'blocked') },
        validation: { ok: false, counts: { error: 1, warning: 0, info: 0 }, issues: [] },
        approval: { status: 'approved', approvedAt: at(9), via: 'cli', overallHash: 'x', rejections: 0, valid: false, problem: 'validation-errors' },
      },
      configWith({ app: { locales: ['tr'], primaryLocale: 'tr' }, selection: { assets: ['metadata', 'screenshots'] } }),
    );
    const by = Object.fromEntries(flow.map((s) => [s.id, s]));
    expect(by.video).toMatchObject({ status: 'skipped' });
    expect(by.review).toMatchObject({ status: 'blocked', reason: 'validation-errors' });
    expect(nextStep(flow, [])).toEqual({ stage: 'validate', action: 'run' });
  });

  it('puts an error blocker first and ends at the upload once every stage is done', () => {
    const done = stageFlow(
      {
        ...base,
        stages: { analyze: rec(8), research: rec(8), write: rec(8), capture: rec(8), design: rec(9), video: rec(9), validate: rec(10) },
        validation: { ok: true, counts: { error: 0, warning: 0, info: 0 }, issues: [] },
        approval: { status: 'approved', approvedAt: at(11), via: 'cli', overallHash: 'x', rejections: 0, valid: true },
      },
      config,
    );
    expect(done.filter((s) => !s.optional && s.id !== 'upload').every((s) => s.status === 'done')).toBe(true);
    expect(done.find((s) => s.id === 'upload')).toMatchObject({ status: 'needs-user' });
    expect(nextStep(done, [])).toEqual({ stage: 'upload', action: 'upload' });
    const keys: Blocker = { code: 'keys-missing', severity: 'error', stage: 'upload', params: { keys: ['ASC_KEY_ID'] }, fixes: [] };
    expect(nextStep(done, [keys])).toEqual({ stage: 'upload', action: 'fix', blocker: 'keys-missing' });
    const ffmpeg: Blocker = { code: 'ffmpeg-missing', severity: 'error', stage: 'video', params: {}, fixes: [] };
    const flow = stageFlow({ ...base, stages: { analyze: rec(8), research: rec(8), write: rec(8), capture: rec(8), design: rec(9) }, blockers: [ffmpeg] }, config);
    expect(flow.find((s) => s.id === 'video')).toMatchObject({ status: 'blocked', reason: 'ffmpeg-missing' });
    const withBrief = stageFlow({ ...base, briefs: [{ name: 'video', path: 'metadata/briefs/video.md', modifiedAt: at(10), stage: 'video' }], blockers: [ffmpeg] }, config);
    expect(withBrief.find((s) => s.id === 'video')).toMatchObject({ status: 'needs-claude', brief: 'video', reason: 'ffmpeg-missing' });
    expect(nextStep(flow, [ffmpeg])).toEqual({ stage: 'video', action: 'fix', blocker: 'ffmpeg-missing' });
  });
});

describe('upload and finish', () => {
  const config = configWith({ app: { locales: ['tr'], primaryLocale: 'tr' } });
  const stages = { analyze: rec(8), research: rec(8), write: rec(8), capture: rec(8), design: rec(9), video: rec(9), validate: rec(10) };
  const flowWith = (upload?: { readBack: string; overallHash?: string }) =>
    stageFlow(
      {
        stages,
        briefs: [],
        blockers: [],
        mockups: undefined,
        validation: { ok: true, counts: { error: 0, warning: 0, info: 0 }, issues: [] },
        approval: { status: 'approved', approvedAt: at(11), via: 'cli', overallHash: 'h', rejections: 0, valid: true, ...(upload ? { upload: { uploadedAt: at(12), overallHash: upload.overallHash ?? 'h', readBack: upload.readBack, differences: [] } } : {}) },
      },
      config,
    );

  it('marks the upload done once the approved content was uploaded and read back, then asks to finish the run', () => {
    const done = flowWith({ readBack: 'ok' });
    expect(done.find((s) => s.id === 'upload')).toMatchObject({ status: 'done', completedAt: at(12) });
    expect(nextStep(done, [])).toEqual({ stage: 'upload', action: 'finalize' });
    expect(nextStep(done, [], true)).toBeUndefined();
  });

  it('keeps the upload open after read-back differences or an upload of other content', () => {
    expect(flowWith({ readBack: 'differences' }).find((s) => s.id === 'upload')).toMatchObject({ status: 'needs-user', reason: 'readback-differences' });
    expect(flowWith({ readBack: 'ok', overallHash: 'older' }).find((s) => s.id === 'upload')).toMatchObject({ status: 'needs-user' });
  });
});

describe('design choice', () => {
  const samples = { styles: ['a', 'b'], generatedAt: at(10), options: [{ letter: 'A', style: 'atleva-fresh', name: 'Atleva Fresh' }, { letter: 'B', style: 'bold-poster-type', name: 'Bold Poster' }] };

  it('waits for the user after the samples, until the art direction is written or the design renders', () => {
    const open = designChoice({ samples, stages: {} }, at(9));
    expect(open).toMatchObject({ code: 'design-choice', severity: 'decision', stage: 'design', params: { n: 2, options: ['A · Atleva Fresh', 'B · Bold Poster'] } });
    expect(designChoice({ samples, stages: {} }, undefined)).toBeDefined();
    expect(designChoice({ samples, stages: {} }, at(11))).toBeUndefined();
    expect(designChoice({ samples, stages: { design: rec(11) } }, at(9))).toBeUndefined();
    expect(designChoice({ samples: { ...samples, options: [] }, stages: {} }, at(9))).toBeUndefined();

    const config = configWith({ app: { locales: ['tr'], primaryLocale: 'tr' } });
    const flow = stageFlow({ stages: { analyze: rec(8), research: rec(8), write: rec(8), capture: rec(8) }, briefs: [{ name: 'design', path: 'metadata/briefs/design.md', modifiedAt: at(9), stage: 'design' }], blockers: [open!], approval: undefined, validation: undefined, mockups: undefined }, config);
    expect(flow.find((s) => s.id === 'design')).toMatchObject({ status: 'needs-user', reason: 'design-choice', brief: 'design' });
    expect(nextStep(flow, [open!])).toEqual({ stage: 'design', action: 'decide', blocker: 'design-choice' });
  });
});

describe('locale consistency', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  const file = (rel: string, text = 'x\n') => {
    mkdirSync(dirname(join(dir!, rel)), { recursive: true });
    writeFileSync(join(dir!, rel), text);
  };

  it('reports store folders of unselected locales and a primary locale outside the store locales, with fixes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vitrin-status-'));
    file('vitrin.config.yaml', 'app:\n  bundleId: com.example.app\n  primaryLocale: en-US\n  locales: [tr]\nurls: {}\nupload:\n  uploader: asc\n');
    for (const l of ['tr', 'de-DE', 'en-US']) file(`metadata/listing/${l}.json`, '{}');
    file('metadata/store/metadata/tr/name.txt');
    file('metadata/store/metadata/de-DE/name.txt');
    file('metadata/store/metadata/en-US/name.txt');
    file('metadata/store/metadata/review_information/notes.txt');
    // Stale briefs from runs whose stages finished later are not shown; the one still waiting is.
    file('metadata/briefs/write.md');
    file('metadata/briefs/design.md');
    utimesSync(join(dir, 'metadata/briefs/write.md'), new Date(at(9)), new Date(at(9)));
    file('metadata/state.json', JSON.stringify({ version: 1, stages: { write: { completedAt: at(10), inputHash: 'x', outputs: [], status: 'ok' } } }));
    const o = await buildOverview(dir);
    expect(o.briefs.map((b) => b.name)).toEqual(['design']);
    const stray = o.blockers.find((b) => b.code === 'stray-locales')!;
    expect(stray).toMatchObject({ severity: 'error', stage: 'validate', params: { locales: ['de-DE', 'en-US'], selected: ['tr'] } });
    expect(stray.fixes).toEqual([
      { id: 'add-locales', command: 'select', args: { locales: ['tr', 'de-DE', 'en-US'] } },
      { id: 'drop-locales', command: 'write', args: {} },
    ]);
    const primary = o.blockers.find((b) => b.code === 'primary-locale')!;
    expect(primary.fixes.map((f) => f.id)).toEqual(['set-primary', 'add-primary']);
    expect(primary.fixes[0]!.args).toEqual({ primaryLocale: 'tr' });
    expect(o.flow.find((s) => s.id === 'validate')).toMatchObject({ status: 'blocked', reason: 'stray-locales' });
  }, 30_000);

  it('vitrin write removes only the store folders Vitrin wrote for locales no longer selected', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vitrin-status-'));
    file('metadata/store/metadata/tr/name.txt');
    file('metadata/store/metadata/de-DE/name.txt');
    file('metadata/store/metadata/de-DE/.DS_Store');
    file('metadata/store/metadata/fr-FR/notes-from-the-user.txt');
    file('metadata/store/metadata/android/en-US/title.txt');
    const removed = await pruneStrayLocales(appPaths(dir), configWith({ app: { locales: ['tr'] } }));
    expect(removed).toEqual(['de-DE']);
  });

  it('select stores the primary locale', () => {
    const yaml = applySelection('app:\n  primaryLocale: en-US\n  locales: [tr]\n', { primaryLocale: 'tr' });
    expect(yaml).toContain('primaryLocale: tr');
  });
});

describe('Claude panel language', () => {
  it('asks Claude to write to the user in ui.language and never to run background commands', () => {
    expect(systemPrompt('tr')).toContain('Turkish (tr)');
    expect(systemPrompt(null)).not.toContain('Write every message to the user in');
    expect(systemPrompt('en')).toBe(systemPrompt(null));
    expect(systemPrompt(null)).toContain('never start background commands');
  });
});
