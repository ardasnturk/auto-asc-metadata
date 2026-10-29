import { log, onLog, SchemaError, type LogEvent } from '@vitrin/core';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { approveCommand } from '../approval.js';
import { runDoctor } from '../commands/doctor.js';
import { initCommand } from '../commands/init.js';
import { mockupsCommand } from '../commands/mockups.js';
import { analyzeCommand, captureCommand, designCommand, researchCommand, validateCommand, videoCommand, writeCommand } from '../commands/pipeline.js';
import { rankCommand } from '../commands/rank.js';
import { selectCommand } from '../commands/select.js';
import { submitCommand, uploadCommand } from '../commands/upload.js';
import { createContext, EXIT, NeedsInput, type Ctx } from '../context.js';
import { finalizeCommand } from '../finalize.js';
import { reviewCommand } from '../review-server.js';

/**
 * Vitrin Studio runs the CLI's stages in-process, one at a time, and streams their log lines to the browser.
 * Every job gets a fresh context (the config may have changed in between) and ends like the CLI would:
 * ok (exit 0), failed (1) or needs-input (2, with the brief or the question the stage left behind).
 */

export type JobStatus = 'running' | 'ok' | 'failed' | 'needs-input';

export interface Job {
  id: string;
  command: string;
  args: Record<string, unknown>;
  status: JobStatus;
  startedAt: string;
  endedAt?: string;
  code?: number;
  /** The NeedsInput message and details, or the error message. */
  message?: string;
  details?: string[];
  lines: LogEvent[];
  /** Structured result some commands return (doctor checks, validation report, review state). */
  result?: unknown;
}

type Runner = (ctx: Ctx, args: Record<string, unknown>, job: Job) => Promise<number>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;
const list = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  const s = str(v);
  return s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
};

/** The commands the Studio can start; the arguments mirror the CLI flags. */
export const RUNNERS: Record<string, Runner> = {
  doctor: async (ctx, a, job) => {
    const res = await runDoctor(ctx, { tools: bool(a.tools), offline: bool(a.offline), playLive: bool(a.playLive) });
    job.result = { checks: res.checks, missingKeys: res.missingKeys };
    return res.exitCode;
  },
  analyze: (ctx) => analyzeCommand(ctx),
  research: (ctx, a) => researchCommand(ctx, { skipImages: bool(a.skipImages) }),
  write: (ctx) => writeCommand(ctx),
  rank: (ctx) => rankCommand(ctx),
  select: (ctx, a) =>
    selectCommand(ctx, {
      platforms: list(a.platforms),
      assets: list(a.assets),
      targets: list(a.targets),
      locales: list(a.locales),
      primaryLocale: str(a.primaryLocale),
      supportUrl: typeof a.supportUrl === 'string' ? a.supportUrl : undefined,
      privacyUrl: typeof a.privacyUrl === 'string' ? a.privacyUrl : undefined,
      marketingUrl: typeof a.marketingUrl === 'string' ? a.marketingUrl : undefined,
      language: str(a.language) ?? (a.language === null ? 'default' : undefined),
      uploader: str(a.uploader),
      capture: str(a.capture),
    }),
  capture: (ctx, a) => captureCommand(ctx, { families: list(a.families), locales: list(a.locales) }),
  mockups: (ctx, a) => mockupsCommand(ctx, { screens: bool(a.screens), locales: list(a.locales), ids: list(a.only) }),
  design: (ctx, a) => designCommand(ctx, { only: list(a.only), samples: bool(a.samples), count: typeof a.count === 'number' ? a.count : undefined, styles: list(a.styles), locale: str(a.locale) }),
  video: (ctx, a) => videoCommand(ctx, { styles: list(a.styles), locales: list(a.locales) }),
  validate: async (ctx, _a, job) => {
    const { code, report } = await validateCommand(ctx);
    job.result = report;
    return code;
  },
  review: (ctx) => reviewCommand(ctx, {}),
  approve: (ctx, a) => approveCommand(ctx, { expectHash: str(a.expectHash) }),
  upload: (ctx, a) =>
    uploadCommand(ctx, {
      dryRun: bool(a.dryRun),
      // `yes` is only ever set after the user confirmed the plan in the Studio; the approval gate still applies.
      yes: bool(a.yes),
      creatives: bool(a.creatives),
      cpp: bool(a.cpp),
      events: bool(a.events),
      experiment: typeof a.experiment === 'string' ? a.experiment : bool(a.experiment) || undefined,
      skipScreenshots: bool(a.skipScreenshots),
    }),
  finalize: (ctx, a) => finalizeCommand(ctx, { checked: bool(a.checked), deleteResearch: a.deleteResearch === undefined ? undefined : bool(a.deleteResearch) }),
  submit: (ctx, a) => submitCommand(ctx, { confirm: str(a.confirm) }),
};

export class JobRunner extends EventEmitter {
  private jobs: Job[] = [];
  private current?: Job;

  constructor(private readonly root: string) {
    super();
  }

  get running(): Job | undefined {
    return this.current;
  }

  list(): Job[] {
    return this.jobs.map((j) => ({ ...j, lines: [] }));
  }

  get(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  /** Starts a job (one at a time); resolves once it is running, not when it ends. */
  start(command: string, args: Record<string, unknown> = {}, opts: { force?: boolean } = {}): Job {
    if (this.current) throw Object.assign(new Error(`“${this.current.command}” is still running.`), { status: 409, code: 'job-busy' });
    const job: Job = { id: randomUUID().slice(0, 8), command, args, status: 'running', startedAt: new Date().toISOString(), lines: [] };
    this.jobs.push(job);
    if (this.jobs.length > 50) this.jobs.splice(0, this.jobs.length - 50);
    this.current = job;
    this.emit('job', this.summary(job));
    void this.execute(job, opts);
    return job;
  }

  summary(job: Job): Omit<Job, 'lines'> {
    const { lines: _lines, ...rest } = job;
    return rest;
  }

  private async execute(job: Job, opts: { force?: boolean }): Promise<void> {
    const off = onLog((e) => {
      job.lines.push(e);
      if (job.lines.length > 5000) job.lines.splice(0, job.lines.length - 5000);
      this.emit('log', { jobId: job.id, ...e });
    });
    try {
      let code: number;
      if (job.command === 'init') {
        code = await initCommand({ cwd: this.root, force: opts.force, language: str(job.args.language), uploader: str(job.args.uploader) });
      } else {
        const runner = RUNNERS[job.command];
        if (!runner) throw new Error(`Unknown command: ${job.command}`);
        const ctx = await createContext({ cwd: this.root, force: opts.force });
        code = await runner(ctx, job.args, job);
      }
      job.code = code;
      job.status = code === EXIT.OK ? 'ok' : code === EXIT.NEEDS_INPUT ? 'needs-input' : 'failed';
    } catch (err) {
      if (err instanceof NeedsInput) {
        job.status = 'needs-input';
        job.code = EXIT.NEEDS_INPUT;
        job.message = err.message;
        job.details = err.details;
        log.warn(err.message);
        for (const d of err.details) log.info(`  ${d}`);
      } else {
        job.status = 'failed';
        job.code = EXIT.FAIL;
        job.message = err instanceof SchemaError ? err.message : ((err as Error).message ?? String(err));
        log.error(job.message);
      }
    } finally {
      off();
      job.endedAt = new Date().toISOString();
      this.current = undefined;
      this.emit('job', this.summary(job));
    }
  }
}
