import pc from 'picocolors';

/**
 * Logger that never prints secret values. Every value registered with `addSecret`
 * (and every env var matched by SECRET_ENV_PATTERN at startup) is replaced with a mask.
 */
const secrets = new Set<string>();

export const SECRET_ENV_PATTERN = /^(ASC_KEY_ID|ASC_ISSUER_ID|ASC_KEY_CONTENT_BASE64|APPLE_ADS_.*|APPTWEAK_API_KEY|FASTLANE_PASSWORD|FASTLANE_USER|APP_STORE_CONNECT_API_KEY_.*|REVIEW_DEMO_PASSWORD|REVIEW_DEMO_USER|GOOGLE_PLAY_JSON_KEY_BASE64|SUPPLY_JSON_KEY_DATA)$/;

export function addSecret(value: string | undefined): void {
  if (value && value.trim().length >= 4) secrets.add(value.trim());
}

export function registerEnvSecrets(env: NodeJS.ProcessEnv = process.env): void {
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_ENV_PATTERN.test(k) && !k.endsWith('_PATH')) addSecret(v);
  }
}

export function mask(text: string): string {
  let out = text;
  // Longest first so that a secret containing another secret is fully masked.
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(maskValue(s));
  }
  // Defensive: PEM blocks and bearer tokens never reach the terminal.
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE KEY]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer ***');
  return out;
}

export function maskValue(value: string): string {
  return value.length <= 6 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`;
}

let quiet = false;
let json = false;
export function setLogMode(opts: { quiet?: boolean; json?: boolean }): void {
  quiet = Boolean(opts.quiet);
  json = Boolean(opts.json);
}

export type LogLevel = 'info' | 'step' | 'ok' | 'warn' | 'error' | 'dim' | 'result' | 'raw';
export interface LogEvent {
  level: LogLevel;
  /** Masked, without ANSI colors. */
  text: string;
}

/**
 * Listeners get every line the logger (and `exec` with `stream: true`) emits, masked and without colors, whether
 * or not it is printed (`--quiet`, `--json`). Vitrin Studio streams them to the browser.
 */
const listeners = new Set<(e: LogEvent) => void>();
export function onLog(fn: (e: LogEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

function notify(level: LogLevel, masked: string): void {
  if (!listeners.size) return;
  const e = { level, text: stripAnsi(masked) };
  for (const fn of listeners) fn(e);
}

function emit(stream: NodeJS.WriteStream, line: string, level: LogLevel, print: boolean): void {
  const masked = mask(line);
  if (print) stream.write(masked + '\n');
  notify(level, masked);
}

/** Writes already-formatted output (a subprocess's stream) masked, and tells the listeners. */
export function emitRaw(stream: NodeJS.WriteStream, text: string): void {
  const masked = mask(text);
  stream.write(masked);
  notify('raw', masked.endsWith('\n') ? masked.slice(0, -1) : masked);
}

export const log = {
  info(msg: string): void {
    emit(process.stdout, msg, 'info', !quiet && !json);
  },
  step(msg: string): void {
    emit(process.stdout, pc.bold(pc.cyan('▸ ')) + msg, 'step', !quiet && !json);
  },
  ok(msg: string): void {
    emit(process.stdout, pc.green('✓ ') + msg, 'ok', !quiet && !json);
  },
  warn(msg: string): void {
    emit(process.stderr, pc.yellow('⚠ ') + msg, 'warn', !json);
  },
  error(msg: string): void {
    emit(process.stderr, pc.red('✗ ') + msg, 'error', true);
  },
  dim(msg: string): void {
    emit(process.stdout, pc.dim(msg), 'dim', !quiet && !json);
  },
  /** Machine-readable result (only in --json mode). */
  result(value: unknown): void {
    if (json) emit(process.stdout, JSON.stringify(value, null, 2), 'result', true);
  },
};
