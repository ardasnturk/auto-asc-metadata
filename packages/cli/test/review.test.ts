import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ApprovalManifest, ReviewFeedback } from '@vitrin/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvalStage, buildInventory, recordApproval } from '../src/approval.js';
import { createContext, type Ctx } from '../src/context.js';
import { buildReport } from '../src/report.js';
import { resolveServedFile, startReviewServer, type ReviewServer } from '../src/review-server.js';
import { makeFixture, type Fixture } from './fixture.js';

describe('review report', () => {
  let fx: Fixture;
  let ctx: Ctx;
  let html: string;
  beforeAll(async () => {
    fx = await makeFixture();
    ctx = await createContext({ cwd: fx.root });
    html = readFileSync(await buildReport(ctx), 'utf8');
  });

  it('shows every screenshot of every locale × target with relative, lazy-loaded paths', async () => {
    const inv = await buildInventory(ctx);
    const shots = inv.items.filter((i) => i.kind === 'screenshot');
    expect(shots.length).toBe(14); // 2 locales × 2 targets × 3 + 2 Play screenshots
    for (const s of shots) expect(html).toContain(`data-item="${s.id}"`);
    expect(html).toContain('src="store/screenshots/tr/03_shot3_iphone-6.9.png" loading="lazy"');
    expect(html).not.toContain(fx.root); // self-contained, relative paths only
    expect(html).toContain('1320×2868');
    expect(html).toContain('iPhone 6.9&quot; (Dynamic Island, large)');
  });

  it('includes previews, creatives, event cards, CPP, metadata with counters and the Play listing', () => {
    expect(html).toMatch(/<video src="store\/app-previews\/en-US\/01_IPHONE_67.mp4" controls/);
    expect(html).toContain('2.0 s');
    expect(html).toContain('creative/en-US/header_header.png');
    expect(html).toContain('event-card_event-launch-card.png');
    expect(html).toContain('Lansman haftası');
    expect(html).toContain('Study habits');
    expect(html).toContain('20 / 30 chars'); // name "Ritim: Habit Tracker"
    expect(html).toContain('49 / 100 bytes'); // keywords
    expect(html).toContain('Google Play › Android ›');
    expect(html).toContain('Short description');
    expect(html).toContain('/ 80 chars');
    expect(html).toContain('Search result');
    expect(html).toContain('Product page');
  });

  it('puts validation issues next to the item they concern and summarizes the destinations', () => {
    const card = html.slice(html.indexOf('data-item="metadata/store/screenshots/en-US/02_shot2_iphone-6.9.png"'));
    expect(card.slice(0, card.indexOf('</figure>'))).toContain('image.contrast');
    const tr = html.slice(html.indexOf('data-item="metadata/app-store/tr"'));
    expect(tr.slice(0, tr.indexOf('data-reject'))).toContain('text.subtitle-duplicate');
    expect(html).toContain('What will be uploaded');
    expect(html).toContain('Google Play · fastlane supply');
    expect(html).toContain('App Asset Library · only with --creatives');
    expect(html).toMatch(/Overall hash: <span class="hash" id="overall-hash">[0-9a-f]{64}</);
    expect(existsSync(ctx.paths.reviewSnapshot)).toBe(true);
  });
});

function raw(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

describe('review server', () => {
  let fx: Fixture;
  let ctx: Ctx;
  let server: ReviewServer;
  beforeAll(async () => {
    fx = await makeFixture();
    ctx = await createContext({ cwd: fx.root });
    server = await startReviewServer(ctx, { port: 0 });
  });
  afterAll(() => server.close());

  it('binds to 127.0.0.1 and serves the gallery, media and state', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const root = await fetch(server.url, { redirect: 'manual' });
    expect(root.status).toBe(302);
    const page = await fetch(new URL('/metadata/report.html', server.url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Approve everything');
    const img = await fetch(new URL('/metadata/store/screenshots/en-US/01_shot1_iphone-6.3.png', server.url));
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    const vid = await fetch(new URL('/metadata/store/app-previews/en-US/01_IPHONE_67.mp4', server.url), { headers: { range: 'bytes=0-3' } });
    expect(vid.status).toBe(206);
    expect((await vid.arrayBuffer()).byteLength).toBe(4);
    const state = await (await fetch(new URL('/api/state', server.url))).json();
    expect(state.overallHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.items.some((i: { id: string }) => i.id === 'metadata/google-play/en-US')).toBe(true);
  });

  it('rejects path traversal, secrets, files outside the served trees and foreign hosts', async () => {
    for (const p of ['/../../../../etc/passwd', '/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/metadata/store/screenshots/..%2f..%2f.env', '/.env', '/vitrin.config.yaml', '/metadata/app_profile.json', '/metadata/store/screenshots/%00x.png', '/metadata/store/screenshots/..\\..\\.env']) {
      const res = await raw(server.port, p, { host: `127.0.0.1:${server.port}` });
      expect(res.status, p).toBe(404);
      expect(res.body).not.toContain('SECRET');
    }
    expect((await raw(server.port, '/metadata/report.html', { host: `evil.example:${server.port}` })).status).toBe(403);
    // A symlink inside a served tree that points outside the project is not followed.
    const outside = join(fx.root, '..', `vitrin-outside-${Date.now()}.png`);
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(fx.root, 'metadata', 'store', 'screenshots', 'en-US', 'zz_link_iphone-6.3.png'));
    expect(await resolveServedFile(fx.root, '/metadata/store/screenshots/en-US/zz_link_iphone-6.3.png')).toBeUndefined();
    expect(await resolveServedFile(fx.root, '/metadata/store/screenshots/en-US/01_shot1_iphone-6.3.png')).toBeDefined();
  });

  it('requires JSON, the same origin and the current hash before approving', async () => {
    const url = new URL('/api/approve', server.url);
    expect((await fetch(url, { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await fetch(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status).toBe(403);
    const stale = await fetch(url, { method: 'POST', body: JSON.stringify({ overallHash: '0'.repeat(64) }), headers: { 'content-type': 'application/json' } });
    expect(stale.status).toBe(409);
    expect(existsSync(ctx.paths.approval)).toBe(false);
  });

  it('approve writes approval.json for exactly the served content and resolves the decision', async () => {
    // The symlink from the previous test changed the set; the page must be reloaded first.
    const { overallHash } = await (await fetch(new URL('/api/state', server.url))).json();
    let res = await fetch(new URL('/api/approve', server.url), { method: 'POST', body: JSON.stringify({ overallHash }), headers: { 'content-type': 'application/json' } });
    if (res.status === 409) res = await fetch(new URL('/api/approve', server.url), { method: 'POST', body: JSON.stringify({ overallHash: (await res.json()).overallHash }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
    const approval = ApprovalManifest.parse(JSON.parse(readFileSync(ctx.paths.approval, 'utf8')));
    expect(approval).toMatchObject({ status: 'approved', via: 'review-server' });
    expect(approval.files.some((f) => f.path === 'metadata/store/metadata/android/en-US/title.txt')).toBe(true);
    await expect(server.decision).resolves.toMatchObject({ kind: 'approved', overallHash: approval.overallHash });
  });

  it('reject writes review-feedback.json and the review brief', async () => {
    const fx2 = await makeFixture({ android: false });
    const ctx2 = await createContext({ cwd: fx2.root });
    const s2 = await startReviewServer(ctx2, { port: 0 });
    try {
      const { overallHash } = await (await fetch(new URL('/api/state', s2.url))).json();
      const post = (body: unknown) => fetch(new URL('/api/reject', s2.url), { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      expect((await post({ overallHash, rejections: [{ item: 'metadata/store/screenshots/tr/01_shot1_iphone-6.3.png', comment: ' ' }] })).status).toBe(400);
      expect((await post({ overallHash, rejections: [{ item: 'does-not-exist', comment: 'x' }] })).status).toBe(400);
      const res = await post({ overallHash, rejections: [{ item: 'metadata/store/screenshots/tr/01_shot1_iphone-6.3.png', comment: 'Use the dark variant' }, { item: 'cpp/students', comment: 'Drop this page' }] });
      expect(res.status).toBe(200);
      await expect(s2.decision).resolves.toEqual({ kind: 'rejected', count: 2 });
      expect(ReviewFeedback.parse(JSON.parse(readFileSync(ctx2.paths.reviewFeedback, 'utf8'))).rejections.map((r) => r.item)).toEqual(['metadata/store/screenshots/tr/01_shot1_iphone-6.3.png', 'cpp/students']);
      expect(readFileSync(join(ctx2.paths.briefs, 'review.md'), 'utf8')).toContain('Use the dark variant');
      expect(JSON.parse(readFileSync(ctx2.paths.approval, 'utf8')).status).toBe('changes-requested');
    } finally {
      await s2.close();
    }
  });
});

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

describe('upload approval gate (cli)', () => {
  it('refuses a real upload until approved, re-requires approval after any change, and --yes never bypasses it', async () => {
    const fx = await makeFixture();
    // .env in the fixture holds a dummy key; remove it so the run behaves like a fresh repo.
    writeFileSync(join(fx.root, '.env'), '');

    let res = await vitrin(fx.root, 'upload', '--yes');
    expect(res.code).toBe(2);
    expect(res.out).toContain('Upload refused');

    res = await vitrin(fx.root, 'upload', '--dry-run');
    expect(res.out).not.toContain('Upload refused');
    expect(res.out).toContain('Not approved for upload yet');

    res = await vitrin(fx.root, 'approve');
    expect(res.code).toBe(2);
    expect(res.out).toContain('No review report');

    res = await vitrin(fx.root, 'review');
    expect(res.code).toBe(0);
    const hash = /--expect-hash ([0-9a-f]{12})/.exec(res.out)?.[1];
    expect(hash).toBeTruthy();
    expect((await vitrin(fx.root, 'approve', '--expect-hash', 'ffffffffffff')).code).toBe(2);
    res = await vitrin(fx.root, 'approve', '--expect-hash', hash!);
    expect(res.code).toBe(0);
    expect(res.out).toContain('Overall hash:');
    expect(res.out).toMatch(/App Store · ios · tr: 6 screenshots/);

    // Gate passes now: the run continues to the next check (validation / keys), not the approval refusal.
    res = await vitrin(fx.root, 'upload', '--yes');
    expect(res.out).not.toContain('Upload refused');

    // Change one screenshot after approval → refused, the changed file is listed.
    appendFileSync(fx.shot('tr', '01_shot1_iphone-6.3.png'), Buffer.from([0]));
    res = await vitrin(fx.root, 'upload', '--yes');
    expect(res.code).toBe(2);
    expect(res.out).toContain('Upload refused');
    expect(res.out).toContain('changed: metadata/store/screenshots/tr/01_shot1_iphone-6.3.png');

    // Rejections from the chat
    res = await vitrin(fx.root, 'approve', '--reject', 'metadata/app-store/tr', '--comment', 'Shorter subtitle');
    expect(res.code).toBe(2);
    expect(readFileSync(join(fx.root, 'metadata', 'briefs', 'review.md'), 'utf8')).toContain('Shorter subtitle');
  }, 120_000);

  it('vitrin all stops after review until the content is approved', async () => {
    const fx = await makeFixture({ android: false });
    const ctx = await createContext({ cwd: fx.root });
    expect(await approvalStage(ctx)).toBe(2);
    await recordApproval(ctx, await buildInventory(ctx), 'cli');
    expect(await approvalStage(ctx)).toBe(0);
    writeFileSync(join(fx.root, 'metadata', 'creative', 'tr', 'header_header.png'), 'changed');
    expect(await approvalStage(ctx)).toBe(2);
    const bin = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'bin.ts'), 'utf8');
    expect(bin.indexOf("['review'")).toBeLessThan(bin.indexOf("['approval'"));
    expect(bin.indexOf("['approval'")).toBeLessThan(bin.indexOf("['upload --dry-run'"));
  });
});
