import { VitrinConfig } from '@vitrin/schemas';
import { parse as parseDotenv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseWith } from './fsx.js';
import { registerEnvSecrets } from './logger.js';

export function loadConfig(file: string): VitrinConfig {
  if (!existsSync(file)) {
    throw new Error(`vitrin.config.yaml not found (${file}). Run \`vitrin init\` first.`);
  }
  const data = parseYaml(readFileSync(file, 'utf8')) ?? {};
  return parseWith(file, data, VitrinConfig);
}

/**
 * Loads `.env` without overriding variables already set in the process environment,
 * and registers every secret for log masking. Returns the merged view.
 */
export function loadEnv(file: string): NodeJS.ProcessEnv {
  if (existsSync(file)) {
    const parsed = parseDotenv(readFileSync(file));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
    }
  }
  // Relative key paths in .env are relative to the app repo, not to the shell's working directory.
  for (const k of ['ASC_KEY_PATH', 'APPLE_ADS_PRIVATE_KEY_PATH']) {
    const v = process.env[k]?.trim();
    if (v && !isAbsolute(v)) process.env[k] = resolve(dirname(file), v);
  }
  registerEnvSecrets(process.env);
  return process.env;
}
