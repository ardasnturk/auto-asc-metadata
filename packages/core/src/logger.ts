import pc from 'picocolors';

/**
 * Logger that never prints secret values. Every value registered with `addSecret`
 * (and every env var matched by SECRET_ENV_PATTERN at startup) is replaced with a mask.
 */
const secrets = new Set<string>();

export const SECRET_ENV_PATTERN = /^(ASC_KEY_ID|ASC_ISSUER_ID|ASC_KEY_CONTENT_BASE64|APPLE_ADS_.*|APPTWEAK_API_KEY|FASTLANE_PASSWORD|FASTLANE_USER|APP_STORE_CONNECT_API_KEY_.*|REVIEW_DEMO_PASSWORD|REVIEW_DEMO_USER)$/;

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

function emit(stream: NodeJS.WriteStream, line: string): void {
  stream.write(mask(line) + '\n');
}

export const log = {
  info(msg: string): void {
    if (!quiet && !json) emit(process.stdout, msg);
  },
  step(msg: string): void {
    if (!quiet && !json) emit(process.stdout, pc.bold(pc.cyan('▸ ')) + msg);
  },
  ok(msg: string): void {
    if (!quiet && !json) emit(process.stdout, pc.green('✓ ') + msg);
  },
  warn(msg: string): void {
    if (!json) emit(process.stderr, pc.yellow('⚠ ') + msg);
  },
  error(msg: string): void {
    emit(process.stderr, pc.red('✗ ') + msg);
  },
  dim(msg: string): void {
    if (!quiet && !json) emit(process.stdout, pc.dim(msg));
  },
  /** Machine-readable result (only in --json mode). */
  result(value: unknown): void {
    if (json) emit(process.stdout, JSON.stringify(value, null, 2));
  },
};
