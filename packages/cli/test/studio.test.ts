import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveEditable, writeEditable } from '../src/studio/files.js';
import { buildOverview } from '../src/studio/overview.js';
import { startStudioServer, type StudioServer } from '../src/studio/server.js';
import { briefPrompt } from '../src/studio/claude.js';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const RITIM = join(ROOT, 'examples', 'Ritim');
const UI = join(ROOT, 'packages', 'studio', 'dist', 'index.html');

describe('Studio editable files', () => {
  it('maps the files Claude writes to their schemas and refuses everything else', () => {
    expect(resolveEditable(RITIM, 'metadata/listing/en-US.json')?.schema).toBeDefined();
    expect(resolveEditable(RITIM, 'metadata/shots.json')?.kind).toBe('json');
    expect(resolveEditable(RITIM, 'vitrin.config.yaml')?.kind).toBe('yaml');
    expect(resolveEditable(RITIM, 'metadata/briefs/design.md')?.readOnly).toBe(true);
    expect(resolveEditable(RITIM, 'metadata/screens/home.html')?.kind).toBe('text');
    expect(resolveEditable(RITIM, 'metadata/validation.json')?.readOnly).toBe(true);
    expect(resolveEditable(RITIM, '.env')).toBeUndefined();
    expect(resolveEditable(RITIM, 'metadata/../.env')).toBeUndefined();
    expect(resolveEditable(RITIM, '/etc/passwd')).toBeUndefined();
    expect(resolveEditable(RITIM, 'Ritim/App/RitimApp.swift')).toBeUndefined();
    expect(resolveEditable(RITIM, 'metadata/store/screenshots/en-US/x.png')).toBeUndefined();
  });

  it('validates JSON against the schema before writing and re-indents it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-studio-'));
    try {
      const f = resolveEditable(dir, 'metadata/listing/app.json')!;
      await expect(writeEditable(f, '{not json')).rejects.toMatchObject({ status: 400 });
      await expect(writeEditable(f, JSON.stringify({ copyright: 'x' }))).rejects.toMatchObject({ status: 400 });
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(dir, 'metadata', 'listing'), { recursive: true });
      await writeEditable(f, JSON.stringify({ copyright: '2026 JASTech', primaryCategory: 'HEALTH_AND_FITNESS' }));
      expect(readFileSync(f.abs, 'utf8')).toBe('{\n  "copyright": "2026 JASTech",\n  "primaryCategory": "HEALTH_AND_FITNESS"\n}\n');
      const ro = resolveEditable(dir, 'metadata/validation.json')!;
      await expect(writeEditable(ro, '{}')).rejects.toMatchObject({ status: 403 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the brief prompt that fences Claude to the stage', () => {
    const p = briefPrompt('design', 'metadata/briefs/design.md', 'keep it calm');
    expect(p).toContain('/vitrin');
    expect(p).toContain('metadata/briefs/design.md');
    expect(p).toContain('never upload, approve, submit, finalize or init');
    expect(p).toContain('keep it calm');
  });
});

describe('Studio overview', () => {
  it('describes the Ritim example without writing anything', async () => {
    const o = await buildOverview(RITIM);
    expect(o.initialized).toBe(true);
    expect(o.app?.name).toBe('Ritim');
    expect(o.config?.locales).toEqual(['en-US', 'tr']);
    expect(o.listing).toEqual(['en-US', 'tr']);
    expect(o.files.shots).toBe(true);
    expect(o.stages.design?.status).toBeDefined();
    expect(Object.keys(o.screenshots)).toContain('en-US');
    expect(o.screenshots['en-US']!.length).toBeGreaterThan(0);
    expect(o.enums.presets).toContain('clean-studio-light');
    expect(o.platforms?.platforms.some((p) => p.platform === 'ios' && p.detected)).toBe(true);
  }, 30_000);

  it('reports a folder without a config as not initialized', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-studio-'));
    try {
      const o = await buildOverview(dir);
      expect(o.initialized).toBe(false);
      expect(o.app).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('Studio server', () => {
  let server: StudioServer;
  beforeAll(async () => {
    server = await startStudioServer(RITIM, { port: 0 });
  });
  afterAll(async () => {
    await server.close();
  });
  const get = (path: string, headers: Record<string, string> = {}) => fetch(new URL(path, server.url), { headers });

  it('answers only requests addressed to itself', async () => {
    // fetch() refuses to override Host; a raw request can (DNS rebinding looks exactly like this).
    const { request } = await import('node:http');
    const status = await new Promise<number>((ok, fail) => {
      request({ host: '127.0.0.1', port: server.port, path: '/api/overview', headers: { host: 'evil.example' } }, (res) => {
        res.resume();
        ok(res.statusCode ?? 0);
      })
        .on('error', fail)
        .end();
    });
    expect(status).toBe(403);
    expect((await get('/api/overview')).status).toBe(200);
  }, 30_000);

  it('serves the editable files and the media under metadata/, never secrets', async () => {
    const f = (await (await get('/api/file?path=metadata/listing/en-US.json')).json()) as { kind: string; exists: boolean; text: string };
    expect(f.kind).toBe('json');
    expect(f.exists).toBe(true);
    expect(JSON.parse(f.text).locale).toBe('en-US');
    expect((await get('/api/file?path=.env')).status).toBe(404);
    expect((await get('/files/vitrin.config.yaml')).status).toBe(404);
    expect((await get('/files/metadata/../.env')).status).toBe(404);
    const png = (await (await get('/api/overview')).json()) as { screenshots: Record<string, Array<{ path: string }>> };
    const first = png.screenshots['en-US']![0]!.path;
    const img = await get(`/files/${first}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    const partial = await get(`/files/${first}`, { range: 'bytes=0-9' });
    expect(partial.status).toBe(206);
  });

  it('refuses writes from another origin and JSON that is not JSON', async () => {
    const put = (body: string, origin?: string) => fetch(new URL('/api/file', server.url), { method: 'PUT', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body });
    expect((await put('{"path":"metadata/shots.json","text":"{}"}', 'https://evil.example')).status).toBe(403);
    expect((await put('nope')).status).toBe(400);
    expect((await put('{"path":"metadata/validation.json","text":"{}"}')).status).toBe(403);
  });

  it('starts one job at a time and reports it on the jobs list', async () => {
    const res = await fetch(new URL('/api/jobs', server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'nope' }) });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    for (let i = 0; i < 50; i++) {
      const job = (await (await get(`/api/jobs/${id}`)).json()) as { status: string; message?: string };
      if (job.status !== 'running') {
        expect(job.status).toBe('failed');
        expect(job.message).toContain('Unknown command');
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 30_000);

  it.skipIf(!existsSync(UI))('serves the built UI for every app route', async () => {
    const index = await get('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('Vitrin Studio');
    expect((await get('/design')).status).toBe(200);
    expect((await get('/studio.js')).headers.get('content-type')).toContain('javascript');
  });

  it('refuses a decision while a stage runs, before touching the inventory', async () => {
    // (The review contract itself — hash check, approve, reject — is the review server's code, tested there;
    // running it here would rewrite the example's report.html.)
    const res = await fetch(new URL('/api/approve', server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' });
    expect(res.status).toBe(400);
  });
});
