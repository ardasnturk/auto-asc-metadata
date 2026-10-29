import { mask, which } from '@vitrin/core';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

/**
 * The Studio's Claude panel: the user's own Claude Code (`claude -p`, headless, stream-json) runs the creative stages
 * from a brief, inside the app repository. No API key: it uses the Claude Code the user is signed in to. The run is
 * fenced to the files the /vitrin skill writes (metadata/ and vitrin.config.yaml) and can never upload, approve,
 * submit or finalize: those stay the user's clicks in the Studio.
 */

export type ClaudeEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'result'; ok: boolean; text: string; costUsd?: number; durationMs?: number; turns?: number }
  | { type: 'error'; text: string }
  | { type: 'exit'; code: number };

export interface ClaudeRun {
  id: string;
  prompt: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  events: ClaudeEvent[];
}

const ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'MultiEdit', 'Skill', 'Bash(vitrin:*)', 'Bash(cat:*)', 'Bash(ls:*)', 'Bash(ffmpeg:*)', 'Bash(ffprobe:*)', 'Bash(open:*)'];
const DISALLOWED_TOOLS = ['Bash(vitrin upload:*)', 'Bash(vitrin approve:*)', 'Bash(vitrin submit:*)', 'Bash(vitrin finalize:*)', 'Bash(vitrin init:*)', 'Bash(git:*)', 'WebFetch', 'WebSearch'];

const SYSTEM = `You are running headless inside Vitrin Studio, a local web UI for the Vitrin pipeline (the /vitrin skill). The user watches your output in a panel and cannot answer questions mid-run: never wait for an answer. When you need a decision from the user, do everything that does not depend on it and end with a short message that asks the question. Run every command in the foreground and wait for it to finish: never start background commands, never sleep or poll for them. Write only inside metadata/ and vitrin.config.yaml. Never run vitrin upload, approve, submit, finalize or init, never use git, never commit: the user does those in the Studio. When you are done, end with a short summary of what you wrote and what to run next.`;

/** The Studio's rules plus the language the user reads the panel in (ui.language; unset = English). */
export function systemPrompt(language?: string | null): string {
  if (!language || language === 'en') return SYSTEM;
  let name = language;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
  } catch {
    /* not a language tag Intl knows: name it by the tag */
  }
  return `${SYSTEM} Write every message to the user in ${name} (${language}), including questions and the final summary. Files keep the language they need: store copy is written in its store locale, JSON keys and commands stay as they are.`;
}

/** Short, human-readable line for a tool call in the panel. */
function toolSummary(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const v = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return v('file_path') ?? '';
    case 'Glob':
    case 'Grep':
      return [v('pattern'), v('path')].filter(Boolean).join(' in ');
    case 'Bash':
      return v('command') ?? '';
    case 'Skill':
      return v('skill') ?? '';
    default: {
      const first = Object.values(input).find((x) => typeof x === 'string') as string | undefined;
      return first ? first.slice(0, 120) : '';
    }
  }
}

export class ClaudeRunner extends EventEmitter {
  private child?: ChildProcess;
  private current?: ClaudeRun;
  readonly runs: ClaudeRun[] = [];
  /** Session id of the last run, so a follow-up message continues the conversation. */
  sessionId?: string;
  private binary?: string | null;

  constructor(private readonly root: string) {
    super();
  }

  async available(): Promise<boolean> {
    if (this.binary === undefined) this.binary = await which('claude');
    return Boolean(this.binary);
  }

  get running(): ClaudeRun | undefined {
    return this.current;
  }

  /** Starts `claude -p` with the prompt; `fresh` drops the conversation so far. */
  async start(prompt: string, opts: { fresh?: boolean; language?: string | null } = {}): Promise<ClaudeRun> {
    if (this.current) throw Object.assign(new Error('Claude is still working.'), { status: 409 });
    if (!(await this.available())) throw Object.assign(new Error('Claude Code (`claude`) is not installed or not on PATH.'), { status: 424 });
    const run: ClaudeRun = { id: randomUUID().slice(0, 8), prompt, startedAt: new Date().toISOString(), status: 'running', events: [] };
    this.runs.push(run);
    if (this.runs.length > 30) this.runs.splice(0, this.runs.length - 30);
    this.current = run;
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ALLOWED_TOOLS.join(','), '--disallowedTools', DISALLOWED_TOOLS.join(','), '--append-system-prompt', systemPrompt(opts.language)];
    if (!opts.fresh && this.sessionId) args.push('--resume', this.sessionId);
    // A Studio started from inside Claude Code must not look like a nested session to the child.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const child = spawn(this.binary!, args, { cwd: this.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let buf = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.handleLine(run, line);
      }
    });
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on('error', (err) => this.push(run, { type: 'error', text: mask(err.message) }));
    child.on('close', (code) => {
      if (buf.trim()) this.handleLine(run, buf.trim());
      if (run.status === 'running') {
        if (code === 0) run.status = 'done';
        else {
          run.status = 'failed';
          if (stderr.trim()) this.push(run, { type: 'error', text: mask(stderr.trim().slice(-2000)) });
        }
      }
      run.endedAt = new Date().toISOString();
      this.push(run, { type: 'exit', code: code ?? 1 });
      this.current = undefined;
      this.child = undefined;
    });
    return run;
  }

  cancel(): boolean {
    if (!this.child || !this.current) return false;
    this.current.status = 'cancelled';
    this.child.kill('SIGTERM');
    return true;
  }

  private push(run: ClaudeRun, e: ClaudeEvent): void {
    run.events.push(e);
    if (run.events.length > 2000) run.events.splice(0, run.events.length - 2000);
    this.emit('event', { runId: run.id, ...e });
  }

  private handleLine(run: ClaudeRun, line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.push(run, { type: 'text', text: mask(line) });
      return;
    }
    const type = msg.type;
    if (type === 'system' && msg.subtype === 'init') {
      const sid = typeof msg.session_id === 'string' ? msg.session_id : undefined;
      if (sid) this.sessionId = sid;
      this.push(run, { type: 'init', sessionId: sid ?? '', model: typeof msg.model === 'string' ? msg.model : undefined });
      return;
    }
    if (type === 'assistant') {
      const content = (msg.message as { content?: unknown } | undefined)?.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) this.push(run, { type: 'text', text: mask(block.text) });
        else if (block.type === 'tool_use') this.push(run, { type: 'tool', name: String(block.name ?? 'tool'), summary: mask(toolSummary(String(block.name ?? ''), block.input as Record<string, unknown> | undefined)) });
      }
      return;
    }
    if (type === 'result') {
      const ok = msg.subtype === 'success' && !msg.is_error;
      run.status = ok ? 'done' : 'failed';
      if (typeof msg.session_id === 'string') this.sessionId = msg.session_id;
      this.push(run, {
        type: 'result',
        ok,
        text: mask(typeof msg.result === 'string' ? msg.result : ok ? '' : String(msg.subtype ?? 'error')),
        costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
        durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : undefined,
        turns: typeof msg.num_turns === 'number' ? msg.num_turns : undefined,
      });
    }
  }
}

/** The prompt for “let Claude do this stage”: the brief the CLI wrote plus the Studio's rules. */
export function briefPrompt(stage: string, briefRel: string, extra?: string): string {
  const base = `Use the /vitrin skill. Read ${briefRel} (the brief Vitrin wrote for the “${stage}” stage) and do exactly what it asks, writing the files it names. Then run the vitrin command the brief says to run next (never upload, approve, submit, finalize or init) and fix what it reports, at most three rounds.`;
  return extra?.trim() ? `${base}\n\nThe user adds: ${extra.trim()}` : base;
}
