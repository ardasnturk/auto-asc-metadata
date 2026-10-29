import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerPrompt } from '../src/studio/claude.js';
import { buildOverview, nextStep, stageFlow } from '../src/studio/overview.js';
import { startStudioServer, type StudioServer } from '../src/studio/server.js';
import { configWith } from './helpers.js';

/** Questions Claude leaves in metadata/questions.json: shown as the next step, answered once, handed back to Claude. */

const QUESTION = { id: 'design-style', stage: 'design', question: 'Hangi tasarım kullanılsın?', options: [{ label: 'A · Atleva Fresh', value: 'A' }, { label: 'B · Bold Poster', value: 'B' }] };

describe('questions in the stage model', () => {
  it('come before everything else and mark their stage as waiting for the user', () => {
    const config = configWith({ app: { locales: ['tr'], primaryLocale: 'tr' } });
    const base = { stages: {}, briefs: [], blockers: [], approval: undefined, validation: undefined, mockups: undefined };
    const flow = stageFlow({ ...base, questions: [QUESTION] }, config);
    expect(flow.find((s) => s.id === 'design')).toMatchObject({ status: 'needs-user', reason: 'question' });
    expect(nextStep(flow, [], false, [QUESTION])).toEqual({ stage: 'design', action: 'answer', question: 'design-style' });
    // A question without a stage waits at the first stage that is not done.
    expect(nextStep(flow, [], false, [{ ...QUESTION, stage: undefined }])).toEqual({ stage: 'analyze', action: 'answer', question: 'design-style' });
  });

  it('hand the answer back in a prompt that stands on its own', () => {
    const p = answerPrompt(QUESTION, 'B', 'metadata/briefs/design.md');
    expect(p).toContain('Question (design stage): Hangi tasarım kullanılsın?');
    expect(p).toContain('Answer: B');
    expect(p).toContain('metadata/briefs/design.md');
  });
});

describe('answering a question in the Studio', () => {
  let dir: string;
  let bin: string;
  let server: StudioServer;
  const path = process.env.PATH;
  const post = (p: string, body: unknown) => fetch(new URL(p, server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vitrin-questions-'));
    bin = mkdtempSync(join(tmpdir(), 'vitrin-fake-claude-'));
    writeFileSync(join(dir, 'vitrin.config.yaml'), 'app:\n  bundleId: com.example.app\n  primaryLocale: tr\n  locales: [tr]\nurls: {}\nui:\n  language: tr\n');
    mkdirSync(join(dir, 'metadata', 'briefs'), { recursive: true });
    writeFileSync(join(dir, 'metadata', 'briefs', 'design.md'), '# Brief\n');
    writeFileSync(join(dir, 'metadata', 'questions.json'), JSON.stringify({ questions: [QUESTION, { id: 'install-ffmpeg', question: 'ffmpeg kurulsun mu?', options: [] }] }));
    // A stand-in for Claude Code: records its arguments and answers like `claude -p --output-format stream-json`.
    writeFileSync(
      join(bin, 'claude'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(bin, 'args.txt')}"\necho '{"type":"system","subtype":"init","session_id":"s1"}'\necho '{"type":"result","subtype":"success","is_error":false,"result":"tamam","session_id":"s1","total_cost_usd":0.01}'\n`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
    process.env.PATH = `${bin}:${path}`;
    server = await startStudioServer(dir, { port: 0 });
  }, 30_000);

  afterAll(async () => {
    await server.close();
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  it('shows the question as the next step', async () => {
    const o = await buildOverview(dir);
    expect(o.questions.map((q) => q.id)).toEqual(['design-style', 'install-ffmpeg']);
    expect(o.next).toEqual({ stage: 'design', action: 'answer', question: 'design-style' });
  }, 30_000);

  it('refuses unknown questions and empty answers, then removes the answered one and starts Claude with it', async () => {
    expect((await post('/api/questions/answer', { id: 'nope', answer: 'B' })).status).toBe(404);
    expect((await post('/api/questions/answer', { id: 'design-style', answer: '  ' })).status).toBe(400);
    const res = await post('/api/questions/answer', { id: 'design-style', answer: 'B' });
    expect(res.status).toBe(202);
    const left = JSON.parse(readFileSync(join(dir, 'metadata', 'questions.json'), 'utf8')) as { questions: Array<{ id: string }> };
    expect(left.questions.map((q) => q.id)).toEqual(['install-ffmpeg']);
    let runs: Array<{ status: string; label: unknown }> = [];
    for (let i = 0; i < 100; i++) {
      const c = (await (await fetch(new URL('/api/claude', server.url))).json()) as { running: string | null; runs: typeof runs };
      runs = c.runs;
      if (!c.running && runs.length) break;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'done', label: { kind: 'answer', question: QUESTION.question, answer: 'B' } });
    const args = readFileSync(join(bin, 'args.txt'), 'utf8');
    expect(args).toContain('Answer: B');
    expect(args).toContain('metadata/briefs/design.md');
    expect(args).toContain('Turkish (tr)');
    expect(args).toContain('metadata/questions.json');
    // The last question goes away with its file.
    expect((await post('/api/questions/answer', { id: 'install-ffmpeg', answer: 'Evet' })).status).toBe(202);
    for (let i = 0; i < 100 && existsSync(join(dir, 'metadata', 'questions.json')); i++) await new Promise((ok) => setTimeout(ok, 50));
    expect(existsSync(join(dir, 'metadata', 'questions.json'))).toBe(false);
  }, 30_000);

  it('starts a new conversation without sending anything', async () => {
    for (let i = 0; i < 100; i++) {
      const c = (await (await fetch(new URL('/api/claude', server.url))).json()) as { running: string | null };
      if (!c.running) break;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect((await post('/api/claude/reset', {})).status).toBe(200);
    const c = (await (await fetch(new URL('/api/claude', server.url))).json()) as { runs: unknown[]; sessionId: string | null };
    expect(c.runs).toEqual([]);
    expect(c.sessionId).toBeNull();
  }, 30_000);
});
