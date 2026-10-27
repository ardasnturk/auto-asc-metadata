import { spawn } from 'node:child_process';
import { emitRaw, mask } from './logger.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Stream output to the terminal (masked) while capturing it. */
  stream?: boolean;
  timeoutMs?: number;
  input?: string;
}

export class CommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly result: ExecResult,
  ) {
    super(mask(`Command failed (${result.code}): ${command}\n${result.stderr.slice(-2000) || result.stdout.slice(-2000)}`));
  }
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    // Stream complete lines only, so a secret split across two chunks is still masked.
    const pending = { out: '', err: '' };
    const flush = (key: 'out' | 'err', stream: NodeJS.WriteStream, final = false) => {
      const buf = pending[key];
      const cut = final ? buf.length : buf.lastIndexOf('\n') + 1;
      if (cut > 0) {
        emitRaw(stream, buf.slice(0, cut));
        pending[key] = buf.slice(cut);
      }
    };
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (opts.stream) {
        pending.out += d.toString();
        flush('out', process.stdout);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (opts.stream) {
        pending.err += d.toString();
        flush('err', process.stderr);
      }
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err.message) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (opts.stream) {
        flush('out', process.stdout, true);
        flush('err', process.stderr, true);
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Like exec but throws CommandError on a non-zero exit code. */
export async function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const res = await exec(cmd, args, opts);
  if (res.code !== 0) throw new CommandError([cmd, ...args].join(' '), res);
  return res;
}

export async function which(cmd: string): Promise<string | null> {
  const res = await exec('/usr/bin/which', [cmd]);
  return res.code === 0 ? res.stdout.trim() : null;
}
