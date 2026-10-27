import { exec, existsSync, log, VITRIN_HOME } from '@vitrin/core';
import { watch, type FSWatcher } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildInventory, checkApproval, recordApproval, recordRejections, summarize, syncFastlaneMetadata } from '../approval.js';
import { createContext } from '../context.js';
import { buildReport } from '../report.js';
import { briefPrompt, ClaudeRunner } from './claude.js';
import { EditableError, readEditable, resolveEditable, writeEditable } from './files.js';
import { JobRunner } from './jobs.js';
import { buildOverview } from './overview.js';

/**
 * `vitrin studio`: the whole Vitrin flow in a local web UI on 127.0.0.1 — stages, editors, previews, the review
 * gallery, approval and upload, plus a panel that runs the user's Claude Code for the creative stages.
 *
 * Security model (same as the review server): the server answers only requests addressed to itself (DNS-rebinding
 * guard), JSON writes need a same-origin Origin, only metadata/ (and the app icon) is ever served, and `.env`, `.p8`
 * files and `secrets/` are never readable. Secret values never reach the browser: the logger masks them.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
};
const MAX_BODY = 4_000_000;

/** Where the built UI lives: the monorepo (packages/studio/dist) or the published package (<pkg>/studio). */
export function studioUiDir(): string | undefined {
  return [join(VITRIN_HOME, 'packages', 'studio', 'dist'), join(VITRIN_HOME, 'studio')].find((d) => existsSync(join(d, 'index.html')));
}

const inside = (p: string, base: string) => {
  const r = relative(base, p);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};

/** A file under the app root the Studio may serve: anything in metadata/ (never secrets) or the app icon. */
async function servedFile(root: string, rel: string, extra: string[]): Promise<string | undefined> {
  if (rel.includes('\0') || rel.includes('\\')) return undefined;
  const abs = resolve(root, rel);
  if (!inside(abs, root) || !existsSync(abs)) return undefined;
  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(abs), realpath(root)]);
  } catch {
    return undefined;
  }
  if (!inside(real, realRoot)) return undefined;
  const r = relative(realRoot, real).split(sep).join('/');
  if (r.split('/').some((seg) => seg === '.env' || seg.startsWith('.env.') || seg.endsWith('.p8') || seg === 'secrets')) return undefined;
  if (!(r.startsWith('metadata/') || extra.includes(r))) return undefined;
  if (!TYPES[extname(r).toLowerCase()]) return undefined;
  if (!(await stat(real)).isFile()) return undefined;
  return real;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cache = 'no-cache'): Promise<void> {
  const st = await stat(file);
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': cache, 'x-content-type-options': 'nosniff' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return void res.end();
    }
    start = Math.max(0, start);
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

export interface StudioServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Remotion Studio, started from the Studio for the first preview (`vitrin video --studio`), until stopped. */
class RemotionStudio {
  private child?: ChildProcess;
  url?: string;
  log: string[] = [];

  constructor(
    private readonly root: string,
    private readonly onEvent: (e: { running: boolean; url?: string; line?: string }) => void,
  ) {}

  get running(): boolean {
    return Boolean(this.child);
  }

  start(locale?: string): void {
    if (this.child) throw Object.assign(new Error('Remotion Studio is already running.'), { status: 409 });
    const args = [process.argv[1]!, '--cwd', this.root, 'video', '--studio', ...(locale ? ['--locale', locale] : [])];
    const env = { ...process.env, BROWSER: 'none' };
    const child = spawn(process.execPath, args, { cwd: this.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.url = undefined;
    this.log = [];
    const onData = (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        const text = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!text) continue;
        this.log.push(text);
        if (this.log.length > 200) this.log.shift();
        const m = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/.exec(text);
        if (m && !this.url) {
          this.url = m[1];
          this.onEvent({ running: true, url: this.url });
        }
        this.onEvent({ running: true, url: this.url, line: text });
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('close', () => {
      this.child = undefined;
      this.url = undefined;
      this.onEvent({ running: false });
    });
    this.onEvent({ running: true });
  }

  stop(): void {
    this.child?.kill('SIGTERM');
  }
}

export async function startStudioServer(root: string, opts: { port?: number; host?: string } = {}): Promise<StudioServer> {
  const host = opts.host ?? '127.0.0.1';
  const ui = studioUiDir();
  const jobs = new JobRunner(root);
  const claude = new ClaudeRunner(root);
  let port = 0;

  // Server-sent events: log lines, job and Claude state, file changes and Remotion Studio.
  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(payload);
  };
  jobs.on('log', (e) => broadcast('log', e));
  jobs.on('job', (j) => broadcast('job', j));
  claude.on('event', (e) => broadcast('claude', e));
  const remotion = new RemotionStudio(root, (e) => broadcast('remotion', e));

  let watcher: FSWatcher | undefined;
  let changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const watchDir = join(root, 'metadata');
  const startWatch = () => {
    if (watcher || !existsSync(watchDir)) return;
    try {
      watcher = watch(watchDir, { recursive: true }, (_ev, file) => {
        const f = typeof file === 'string' ? file.split(sep).join('/') : '';
        if (f.startsWith('.cache/')) return;
        changed.add(`metadata/${f}`);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          broadcast('changed', { paths: [...changed].slice(0, 50), count: changed.size });
          changed = new Set();
        }, 700);
      });
      watcher.on('error', () => undefined);
    } catch {
      watcher = undefined;
    }
  };
  startWatch();
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
    startWatch();
  }, 25_000);

  const allowedHost = (h?: string) => h === `127.0.0.1:${port}` || h === `localhost:${port}` || (host !== '127.0.0.1' && h === `${host}:${port}`);

  const iconPath = async (): Promise<string[]> => {
    try {
      const profile = JSON.parse(await readFile(join(root, 'metadata', 'app_profile.json'), 'utf8')) as { brand?: { appIcon?: string } };
      const icon = profile.brand?.appIcon;
      return icon ? [relative(root, resolve(root, icon)).split(sep).join('/')] : [];
    } catch {
      return [];
    }
  };

  /** The review gallery's state and decisions, the contract report.html's buttons use (same as `vitrin review --serve`). */
  async function reviewState() {
    const ctx = await createContext({ cwd: root });
    await syncFastlaneMetadata(ctx);
    const inv = await buildInventory(ctx);
    await buildReport(ctx, { inventory: inv });
    const approval = await checkApproval(ctx, inv);
    return { ctx, inv, approval };
  }

  const server: Server = createServer(async (req, res) => {
    try {
      if (!allowedHost(req.headers.host)) return sendJson(res, 403, { error: 'Forbidden host.' });
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const path = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        const origin = req.headers.origin;
        if (origin && !allowedHost(origin.replace(/^https?:\/\//, ''))) return sendJson(res, 403, { error: 'Forbidden origin.' });
        if (method !== 'DELETE' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'Expected application/json.' });
        const body = method === 'DELETE' ? {} : await readBody(req);

        if (path === '/api/jobs' && method === 'POST') {
          if (claude.running) return sendJson(res, 409, { error: 'Claude is working in this project; wait for it to finish or cancel it.' });
          const command = typeof body.command === 'string' ? body.command : '';
          if (!command) return sendJson(res, 400, { error: 'command is required.' });
          const args = typeof body.args === 'object' && body.args !== null ? (body.args as Record<string, unknown>) : {};
          const job = jobs.start(command, args, { force: body.force === true });
          return sendJson(res, 202, jobs.summary(job));
        }
        if (path === '/api/file' && method === 'PUT') {
          const f = resolveEditable(root, typeof body.path === 'string' ? body.path : '');
          if (!f) return sendJson(res, 404, { error: 'Not an editable file.' });
          if (typeof body.text !== 'string') return sendJson(res, 400, { error: 'text is required.' });
          await writeEditable(f, body.text);
          return sendJson(res, 200, { ok: true, path: f.rel });
        }
        if (path === '/api/claude' && method === 'POST') {
          if (jobs.running) return sendJson(res, 409, { error: `“${jobs.running.command}” is still running; wait for it before starting Claude.` });
          const extra = typeof body.extra === 'string' ? body.extra : undefined;
          let prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
          if (!prompt && typeof body.stage === 'string') {
            const brief = `metadata/briefs/${body.stage.replace(/[^\w-]/g, '')}.md`;
            if (!existsSync(join(root, brief))) return sendJson(res, 404, { error: `No brief for “${body.stage}” yet; run the stage first.` });
            prompt = briefPrompt(body.stage, brief, extra);
          }
          if (!prompt) return sendJson(res, 400, { error: 'prompt or stage is required.' });
          const run = await claude.start(prompt, { fresh: body.fresh === true });
          return sendJson(res, 202, { id: run.id, startedAt: run.startedAt });
        }
        if (path === '/api/claude/cancel' && method === 'POST') return sendJson(res, 200, { cancelled: claude.cancel() });
        if (path === '/api/remotion' && method === 'POST') {
          remotion.start(typeof body.locale === 'string' ? body.locale : undefined);
          return sendJson(res, 202, { running: true });
        }
        if (path === '/api/remotion' && method === 'DELETE') {
          remotion.stop();
          return sendJson(res, 200, { running: false });
        }
        if (path === '/api/approve' || path === '/api/reject') {
          if (jobs.running) return sendJson(res, 409, { error: 'A stage is running; decide once it finished.' });
          const { ctx, inv } = await reviewState();
          if (typeof body.overallHash !== 'string' || body.overallHash !== inv.overallHash) {
            return sendJson(res, 409, { error: 'The files changed since this page was generated; reload the page and review again.', overallHash: inv.overallHash });
          }
          if (path === '/api/approve') {
            const approval = await recordApproval(ctx, inv, 'review-server');
            await buildReport(ctx, { inventory: inv });
            return sendJson(res, 200, { ok: true, overallHash: approval.overallHash, approvedAt: approval.approvedAt });
          }
          const list = Array.isArray(body.rejections) ? body.rejections : [];
          const rejections = list
            .filter((r): r is { item: string; comment: string } => typeof r === 'object' && r !== null && typeof (r as { item?: unknown }).item === 'string' && typeof (r as { comment?: unknown }).comment === 'string')
            .map((r) => ({ item: r.item, comment: r.comment.slice(0, 4000) }));
          if (!rejections.length || rejections.length !== list.length) return sendJson(res, 400, { error: 'Expected rejections: [{ item, comment }].' });
          if (rejections.some((r) => !r.comment.trim())) return sendJson(res, 400, { error: 'Every rejection needs a comment.' });
          try {
            const feedback = await recordRejections(ctx, inv, rejections, 'review-server');
            return sendJson(res, 200, { ok: true, rejected: feedback.rejections.length });
          } catch (err) {
            return sendJson(res, 400, { error: (err as Error).message });
          }
        }
        if (path === '/api/open' && method === 'POST') {
          // Opens a served file in the user's default app (Finder / browser), macOS only.
          const target = typeof body.path === 'string' ? await servedFile(root, body.path.replace(/^\/+/, ''), await iconPath()) : undefined;
          if (!target) return sendJson(res, 404, { error: 'Not found.' });
          if (process.platform !== 'darwin') return sendJson(res, 501, { error: 'Only on macOS.' });
          await exec('open', [body.reveal === true ? '-R' : '', target].filter(Boolean));
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 404, { error: 'Not found.' });
      }

      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });

      if (path === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(`event: hello\ndata: ${JSON.stringify({ job: jobs.running ? jobs.summary(jobs.running) : null, claude: claude.running ? { id: claude.running.id } : null, remotion: { running: remotion.running, url: remotion.url } })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (path === '/api/overview') return sendJson(res, 200, { ...(await buildOverview(root)), job: jobs.running ? jobs.summary(jobs.running) : null, claude: { available: await claude.available(), running: Boolean(claude.running), sessionId: claude.sessionId ?? null }, remotion: { running: remotion.running, url: remotion.url ?? null, available: Boolean(studioRemotionAvailable()) }, ui: Boolean(ui) });
      if (path === '/api/jobs') return sendJson(res, 200, jobs.list());
      if (path.startsWith('/api/jobs/')) {
        const job = jobs.get(path.slice('/api/jobs/'.length));
        return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'No such job.' });
      }
      if (path === '/api/file') {
        const f = resolveEditable(root, url.searchParams.get('path') ?? '');
        if (!f) return sendJson(res, 404, { error: 'Not an editable file.' });
        return sendJson(res, 200, { path: f.rel, kind: f.kind, readOnly: f.readOnly, exists: f.exists, ...(await readEditable(f)) });
      }
      if (path === '/api/claude') return sendJson(res, 200, { available: await claude.available(), running: claude.running ? claude.running.id : null, sessionId: claude.sessionId ?? null, runs: claude.runs });
      if (path === '/api/remotion') return sendJson(res, 200, { running: remotion.running, url: remotion.url ?? null, log: remotion.log.slice(-40) });
      if (path === '/api/review') {
        const { inv, approval } = await reviewState();
        return sendJson(res, 200, { overallHash: inv.overallHash, approval, summary: summarize(inv).lines, items: inv.items.map(({ id, kind, store, platform, locale, target, label }) => ({ id, kind, store, platform, locale, target, label })), report: 'metadata/report.html' });
      }
      if (path === '/api/state') {
        const { inv } = await reviewState();
        return sendJson(res, 200, { overallHash: inv.overallHash, summary: summarize(inv).lines, items: inv.items.map(({ id, kind, store, platform, locale, target, label }) => ({ id, kind, store, platform, locale, target, label })) });
      }
      if (path.startsWith('/files/')) {
        let rel: string;
        try {
          rel = decodeURIComponent(path.slice('/files/'.length));
        } catch {
          return sendJson(res, 400, { error: 'Bad path.' });
        }
        const file = await servedFile(root, rel, await iconPath());
        if (!file) return sendJson(res, 404, { error: 'Not found.' });
        return sendFile(req, res, file);
      }
      // The UI: index.html for every route the single-page app owns, assets by name.
      if (!ui) return sendJson(res, 503, { error: 'The Studio UI is not built (packages/studio/dist is missing). Run `pnpm build`.' });
      const asset = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      const abs = resolve(ui, asset);
      if (inside(abs, ui) && existsSync(abs) && (await stat(abs)).isFile()) return sendFile(req, res, abs);
      if (!path.startsWith('/api/') && !extname(path)) return sendFile(req, res, join(ui, 'index.html'));
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (err) {
      const status = (err as { status?: number }).status ?? (err instanceof EditableError ? err.status : 500);
      const body: Record<string, unknown> = { error: (err as Error).message };
      if (err instanceof EditableError) body.issues = err.issues;
      if (!res.headersSent) sendJson(res, status, body);
      else res.destroy();
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 0, host, () => ok());
  });
  port = (server.address() as AddressInfo).port;
  const urlStr = `http://${host}:${port}/`;
  return {
    url: urlStr,
    port,
    close: () =>
      new Promise<void>((ok) => {
        clearInterval(heartbeat);
        watcher?.close();
        remotion.stop();
        claude.cancel();
        for (const c of clients) c.end();
        server.closeAllConnections?.();
        server.close(() => ok());
      }),
  };
}

/** Remotion Studio needs @remotion/cli, which only a development checkout installs. */
function studioRemotionAvailable(): string | undefined {
  const candidates = [join(VITRIN_HOME, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'), join(VITRIN_HOME, 'packages', 'video', 'node_modules', '@remotion', 'cli', 'remotion-cli.js')];
  return candidates.find((c) => existsSync(c));
}

export interface StudioOptions {
  cwd?: string;
  port?: number;
  open?: boolean;
}

/** `vitrin studio [--port] [--no-open]` — serves the Studio until Ctrl+C. */
export async function studioCommand(opts: StudioOptions): Promise<number> {
  const root = resolve(opts.cwd ?? process.cwd());
  const server = await startStudioServer(root, { port: opts.port ?? 4871 });
  log.ok(`Vitrin Studio: ${server.url}  (127.0.0.1 only; Ctrl+C stops it)`);
  if (!studioUiDir()) log.warn('The Studio UI is not built: run `pnpm build` in the Vitrin checkout (packages/studio/dist).');
  log.result({ url: server.url });
  if (opts.open !== false && process.platform === 'darwin') await exec('open', [server.url]);
  await new Promise<void>((ok) => {
    process.once('SIGINT', () => ok());
    process.once('SIGTERM', () => ok());
  });
  await server.close();
  return 0;
}
