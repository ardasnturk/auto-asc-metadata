import { existsSync, log } from '@vitrin/core';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { buildInventory, checkApproval, recordApproval, recordRejections, summarize, syncFastlaneMetadata, type Inventory } from './approval.js';
import { EXIT, NeedsInput, type Ctx } from './context.js';
import { buildReport } from './report.js';
import { i18nFile, loadUiText, UI_EN } from './i18n.js';

/**
 * `vitrin review --serve`: serves the review gallery on 127.0.0.1 with approve / reject buttons.
 * Approve writes `metadata/approval.json`; rejections write `metadata/review-feedback.json` and `briefs/review.md`.
 */

export type ReviewDecision = { kind: 'approved'; overallHash: string } | { kind: 'rejected'; count: number };

export interface ReviewServer {
  url: string;
  port: number;
  /** Resolves once the user approved or sent rejections. */
  decision: Promise<ReviewDecision>;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

/** Only these trees (relative to the app root) are ever served, and only files with a known media/text type. */
const SERVED_ROOTS = ['metadata/report.html', 'metadata/creative/', 'metadata/.cache/thumbs/', 'metadata/video-styles/', 'metadata/store/'];
const MAX_BODY = 1_000_000;

/**
 * Maps a request path to a file under the app root, or undefined when it escapes the root, is not in an
 * allowed tree, or names a secret. Symlinks are resolved before the check.
 */
export async function resolveServedFile(root: string, urlPath: string, extra: string[] = []): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]!.split('#')[0]!);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const relPath = decoded.replace(/^\/+/, '');
  const abs = resolve(root, relPath);
  const inside = (p: string, base: string) => {
    const r = relative(base, p);
    return r !== '' && !r.startsWith('..') && !isAbsolute(r);
  };
  if (!inside(abs, root)) return undefined;
  if (!existsSync(abs)) return undefined;
  let real: string;
  let realRoot: string;
  try {
    real = await realpath(abs);
    realRoot = await realpath(root);
  } catch {
    return undefined;
  }
  if (!inside(real, realRoot)) return undefined;
  const r = relative(realRoot, real).split(sep).join('/');
  if (r.split('/').some((seg) => seg === '.env' || seg.startsWith('.env.') || seg.endsWith('.p8') || seg === 'secrets')) return undefined;
  const allowed = SERVED_ROOTS.some((a) => (a.endsWith('/') ? r.startsWith(a) : r === a)) || extra.includes(r);
  if (!allowed || !TYPES[extname(r).toLowerCase()]) return undefined;
  if (!(await stat(real)).isFile()) return undefined;
  return real;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  const st = await stat(file);
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
  // Range requests let browsers seek in App Preview videos.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      res.end();
      return;
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

export async function startReviewServer(ctx: Ctx, opts: { port?: number; host?: string } = {}): Promise<ReviewServer> {
  const host = opts.host ?? '127.0.0.1';
  await syncFastlaneMetadata(ctx);
  let inv: Inventory = await buildInventory(ctx);
  await buildReport(ctx, { inventory: inv });
  const profileIcon = await (async () => {
    try {
      const icon = (JSON.parse(await readFile(ctx.paths.profile, 'utf8')) as { brand?: { appIcon?: string } }).brand?.appIcon;
      return icon ? relative(ctx.root, resolve(ctx.root, icon)).split(sep).join('/') : undefined;
    } catch {
      return undefined;
    }
  })();
  let resolveDecision!: (d: ReviewDecision) => void;
  const decision = new Promise<ReviewDecision>((r) => (resolveDecision = r));
  let port = 0;
  let busy = false;

  const allowedHost = (h?: string) => h === `127.0.0.1:${port}` || h === `localhost:${port}` || (host !== '127.0.0.1' && h === `${host}:${port}`);

  const server = createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: only answer requests addressed to this local server.
      if (!allowedHost(req.headers.host)) return sendJson(res, 403, { error: 'Forbidden host.' });
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const path = url.pathname;
      if (req.method === 'POST') {
        // CSRF guard: other sites cannot send JSON here without a preflight, and their Origin would differ.
        const origin = req.headers.origin;
        if (origin && !allowedHost(origin.replace(/^https?:\/\//, ''))) return sendJson(res, 403, { error: 'Forbidden origin.' });
        if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'Expected application/json.' });
        if (busy) return sendJson(res, 409, { error: 'Another decision is being recorded.' });
        busy = true;
        try {
          const body = (await readBody(req)) as { overallHash?: unknown; rejections?: unknown };
          // The page must have been generated from exactly the current files.
          const current = await buildInventory(ctx);
          if (typeof body.overallHash !== 'string' || body.overallHash !== current.overallHash) {
            inv = current;
            await buildReport(ctx, { inventory: inv });
            return sendJson(res, 409, { error: 'The files changed since this page was generated; reload the page and review again.', overallHash: current.overallHash });
          }
          if (path === '/api/approve') {
            const approval = await recordApproval(ctx, current, 'review-server');
            await buildReport(ctx, { inventory: current });
            sendJson(res, 200, { ok: true, overallHash: approval.overallHash, approvedAt: approval.approvedAt });
            resolveDecision({ kind: 'approved', overallHash: approval.overallHash });
            return;
          }
          if (path === '/api/reject') {
            const list = Array.isArray(body.rejections) ? body.rejections : [];
            const rejections = list
              .filter((r): r is { item: string; comment: string } => typeof r === 'object' && r !== null && typeof (r as { item?: unknown }).item === 'string' && typeof (r as { comment?: unknown }).comment === 'string')
              .map((r) => ({ item: r.item, comment: r.comment.slice(0, 4000) }));
            if (!rejections.length || rejections.length !== list.length) return sendJson(res, 400, { error: 'Expected rejections: [{ item, comment }].' });
            if (rejections.some((r) => !r.comment.trim())) return sendJson(res, 400, { error: 'Every rejection needs a comment.' });
            try {
              const feedback = await recordRejections(ctx, current, rejections, 'review-server');
              sendJson(res, 200, { ok: true, rejected: feedback.rejections.length });
              resolveDecision({ kind: 'rejected', count: feedback.rejections.length });
            } catch (err) {
              sendJson(res, 400, { error: (err as Error).message });
            }
            return;
          }
          return sendJson(res, 404, { error: 'Not found.' });
        } finally {
          busy = false;
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
      if (path === '/') {
        res.writeHead(302, { location: '/metadata/report.html' });
        return void res.end();
      }
      if (path === '/api/state') {
        return sendJson(res, 200, { overallHash: inv.overallHash, summary: summarize(inv).lines, items: inv.items.map(({ id, kind, store, platform, locale, target, label }) => ({ id, kind, store, platform, locale, target, label })) });
      }
      const file = await resolveServedFile(ctx.root, path, profileIcon ? [profileIcon] : []);
      if (!file) return sendJson(res, 404, { error: 'Not found.' });
      await sendFile(req, res, file);
    } catch (err) {
      const status = (err as { status?: number }).status ?? (err instanceof NeedsInput ? 409 : 500);
      if (!res.headersSent) sendJson(res, status, { error: (err as Error).message });
      else res.destroy();
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 0, host, () => ok());
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://${host === '127.0.0.1' ? '127.0.0.1' : host}:${port}/`,
    port,
    decision,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections?.();
        server.close(() => ok());
      }),
  };
}

export interface ReviewOptions {
  serve?: boolean;
  port?: number;
  /** Print the gallery's English words as JSON (the template for metadata/i18n/<language>.json). */
  printLabels?: boolean;
}

/** `vitrin review [--serve]` — writes the gallery; with --serve also waits for the user's decision. */
export async function reviewCommand(ctx: Ctx, opts: ReviewOptions): Promise<number> {
  if (opts.printLabels) {
    process.stdout.write(JSON.stringify(UI_EN, null, 2) + '\n');
    return EXIT.OK;
  }
  const ui = await loadUiText(ctx);
  if (ui.missing) log.warn(`The gallery has no ${ui.language} words yet and is shown in English: translate \`vitrin review --print-labels\` into ${relative(ctx.root, i18nFile(ctx, ui.language))} (same keys), then run review again.`);
  if (!opts.serve) {
    await syncFastlaneMetadata(ctx);
    const inv = await buildInventory(ctx);
    const file = await buildReport(ctx, { inventory: inv });
    const approval = await checkApproval(ctx, inv);
    log.ok(`Report: ${relative(process.cwd(), file) || file}`);
    for (const l of summarize(inv).lines) log.info(`  ${l}`);
    log.info(
      approval.ok
        ? 'Status: approved — this exact content may be uploaded.'
        : `Status: not approved (${approval.reason}) Show the report to the user; on their explicit "yes" run \`vitrin approve --expect-hash ${inv.overallHash.slice(0, 12)}\`.`,
    );
    log.result({ report: file, overallHash: inv.overallHash, approved: approval.ok });
    return EXIT.OK;
  }
  const server = await startReviewServer(ctx, { port: opts.port });
  log.ok(`Review server: ${server.url}  (127.0.0.1 only; Ctrl+C stops it without a decision)`);
  log.result({ url: server.url });
  const interrupted = new Promise<'interrupted'>((ok) => process.once('SIGINT', () => ok('interrupted')));
  const outcome = await Promise.race([server.decision, interrupted]);
  await server.close();
  if (outcome === 'interrupted') {
    log.warn('Review server stopped without a decision; nothing was approved.');
    return EXIT.NEEDS_INPUT;
  }
  if (outcome.kind === 'approved') {
    log.ok(`Approved by the user on the review page (overall hash ${outcome.overallHash.slice(0, 12)}…) → metadata/approval.json`);
    return EXIT.OK;
  }
  log.warn(`The user rejected ${outcome.count} item(s): see metadata/briefs/review.md and metadata/review-feedback.json.`);
  return EXIT.NEEDS_INPUT;
}
