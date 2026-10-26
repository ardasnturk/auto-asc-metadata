import { addSecret, ensureDir, exec, existsSync, log, writeText, type AppPaths } from '@vitrin/core';
import { copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import type { AscClient } from './asc-client.js';
import { classicTypeFor } from './display-types.js';
import type { CommandRunner, LaneInvocation } from './fastlane.js';
import { isActive, type UploadPlan } from './plan.js';
import { ASC_PLATFORM, type DeliverPlatform, type RenderedAsset } from './platforms.js';
import { perDisplayTypeAssetsFor } from './scope.js';

/**
 * Optional uploader `upload.uploader: asc`: drives the `asc` CLI (https://github.com/rorkai/App-Store-Connect-CLI,
 * MIT, `brew install asc`) instead of fastlane deliver, so Apple uploads need no Ruby. Every command is built by a
 * pure function below; the runner is injected (tests never run the binary).
 *
 * - Text: `asc metadata push --app <id> --version <v> --platform <IOS|MAC_OS|TV_OS|VISION_OS> --dir <dir>` with
 *   `--dry-run` for the plan. asc's canonical layout (internal/cli/metadata/foundation.go: `app-info/<locale>.json`
 *   and `version/<version>/<locale>.json`) is generated from Vitrin's fastlane/metadata export.
 * - Media: one `asc screenshots upload` / `asc video-previews upload --version-localization <id> --path <dir>
 *   --device-type <type> --replace --confirm` per locale and display type: `--replace` deletes only the screenshots
 *   of that one set, so other display types stay untouched.
 * - Auth: Vitrin's .env (ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH | ASC_KEY_CONTENT_BASE64) is mapped to asc's
 *   documented environment credential (authentication.mdx: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_TYPE=team and one of
 *   ASC_PRIVATE_KEY_PATH / ASC_PRIVATE_KEY_B64). Values go only into the child's environment, never into arguments
 *   or logs.
 */

export const ASC_BIN = 'asc';
export const ASC_INSTALL_HINT = 'brew install asc (https://github.com/rorkai/App-Store-Connect-CLI)';

export type AscPlatform = 'IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS';

/** asc's environment credential built from Vitrin's .env. `problems` is non-empty when something is missing. */
export function ascEnv(env: NodeJS.ProcessEnv, root: string): { env: Record<string, string>; problems: string[] } {
  const problems: string[] = [];
  const keyId = env.ASC_KEY_ID?.trim();
  const issuer = env.ASC_ISSUER_ID?.trim();
  const b64 = env.ASC_KEY_CONTENT_BASE64?.trim();
  const path = env.ASC_KEY_PATH?.trim();
  if (!keyId) problems.push('ASC_KEY_ID is missing');
  if (!issuer) problems.push('ASC_ISSUER_ID is missing');
  if (!b64 && !path) problems.push('ASC_KEY_PATH (or ASC_KEY_CONTENT_BASE64) is missing');
  const out: Record<string, string> = {
    ASC_KEY_ID: keyId ?? '',
    ASC_ISSUER_ID: issuer ?? '',
    ASC_KEY_TYPE: 'team',
    // Exactly one private-key source; clear the others so a value in the user's shell cannot mix in.
    ASC_PRIVATE_KEY_PATH: '',
    ASC_PRIVATE_KEY_B64: '',
    ASC_PRIVATE_KEY: '',
    // A selected profile would win over the environment credential (authentication.mdx resolution matrix).
    ASC_PROFILE: '',
  };
  if (b64) {
    addSecret(b64);
    out.ASC_PRIVATE_KEY_B64 = b64;
  } else if (path) {
    const full = isAbsolute(path) ? path : resolve(root, path);
    if (!existsSync(full)) problems.push(`.p8 file not found: ${path}`);
    out.ASC_PRIVATE_KEY_PATH = full;
  }
  if (keyId) addSecret(keyId);
  if (issuer) addSecret(issuer);
  return { env: out, problems };
}

export function ascVersionInvocation(): LaneInvocation {
  return { command: ASC_BIN, args: ['version'], env: {} };
}

export function ascMetadataPushInvocation(o: { appId: string; version: string; platform: AscPlatform; dir: string; dryRun: boolean; confirm?: boolean }, env: Record<string, string>): LaneInvocation {
  const args = ['metadata', 'push', '--app', o.appId, '--version', o.version, '--platform', o.platform, '--dir', o.dir];
  if (o.dryRun) args.push('--dry-run');
  // --confirm is required only for field clears (explicit null); it never enables deletes (that is --allow-deletes).
  else if (o.confirm) args.push('--confirm');
  return { command: ASC_BIN, args, env };
}

export function ascScreenshotsUploadInvocation(o: { localizationId: string; path: string; deviceType: string; dryRun?: boolean }, env: Record<string, string>): LaneInvocation {
  const args = ['screenshots', 'upload', '--version-localization', o.localizationId, '--path', o.path, '--device-type', o.deviceType, '--replace'];
  args.push(o.dryRun ? '--dry-run' : '--confirm');
  return { command: ASC_BIN, args, env };
}

export function ascVideoPreviewsUploadInvocation(o: { localizationId: string; path: string; deviceType: string; dryRun?: boolean }, env: Record<string, string>): LaneInvocation {
  const args = ['video-previews', 'upload', '--version-localization', o.localizationId, '--path', o.path, '--device-type', o.deviceType, '--replace'];
  args.push(o.dryRun ? '--dry-run' : '--confirm');
  return { command: ASC_BIN, args, env };
}

export function ascValidateInvocation(o: { appId: string; platform?: AscPlatform; version?: string }, env: Record<string, string>): LaneInvocation {
  const args = ['validate', '--app', o.appId];
  if (o.version) args.push('--version', o.version);
  if (o.platform) args.push('--platform', o.platform);
  return { command: ASC_BIN, args, env };
}

// ---- metadata export: fastlane/metadata → asc canonical layout ----

/** deliver file → asc field, per scope. */
const APP_INFO_FIELDS: Record<string, string> = { 'name.txt': 'name', 'subtitle.txt': 'subtitle', 'privacy_url.txt': 'privacyPolicyUrl' };
const VERSION_FIELDS: Record<string, string> = {
  'description.txt': 'description',
  'keywords.txt': 'keywords',
  'marketing_url.txt': 'marketingUrl',
  'promotional_text.txt': 'promotionalText',
  'support_url.txt': 'supportUrl',
  'release_notes.txt': 'whatsNew',
};
/** asc supports an explicit `null` clear only for these (metadata.mdx, “Clearing nullable fields”). */
const ASC_CLEARABLE = new Set(['subtitle', 'privacyPolicyUrl', 'promotionalText']);
/** deliver files that asc metadata push (phase 1) does not upload. */
const NOT_IN_ASC = ['copyright.txt', 'primary_category.txt', 'secondary_category.txt', 'primary_first_sub_category.txt', 'primary_second_sub_category.txt', 'secondary_first_sub_category.txt', 'secondary_second_sub_category.txt', 'review_information'];

export interface AscMetadataExport {
  dir: string;
  files: string[];
  /** Number of explicit `null` clears (the push then needs --confirm). */
  clears: number;
  warnings: string[];
}

/**
 * Writes `<dir>/app-info/<locale>.json` (when `includeAppInfo`) and `<dir>/version/<version>/<locale>.json` from the
 * deliver tree. A missing deliver file means “leave the remote value”, so the key is omitted; an empty file means
 * “clear”, written as `null` where asc supports it.
 */
export async function exportAscMetadata(fastlaneMetadata: string, dir: string, o: { locales: string[]; version: string; includeAppInfo: boolean; dropReleaseNotes?: boolean }): Promise<AscMetadataExport> {
  await rm(dir, { recursive: true, force: true });
  const out: AscMetadataExport = { dir, files: [], clears: 0, warnings: [] };
  for (const locale of o.locales) {
    const src = join(fastlaneMetadata, locale);
    if (!existsSync(src)) continue;
    const scopes: Array<[Record<string, string>, string]> = [[VERSION_FIELDS, join(dir, 'version', o.version, `${locale}.json`)]];
    if (o.includeAppInfo) scopes.unshift([APP_INFO_FIELDS, join(dir, 'app-info', `${locale}.json`)]);
    for (const [fields, target] of scopes) {
      const doc: Record<string, string | null> = {};
      for (const [file, key] of Object.entries(fields)) {
        if (file === 'release_notes.txt' && o.dropReleaseNotes) continue;
        const f = join(src, file);
        if (!existsSync(f)) continue;
        const value = (await readFile(f, 'utf8')).trim();
        if (value) doc[key] = value;
        else if (ASC_CLEARABLE.has(key)) {
          doc[key] = null;
          out.clears++;
        } else out.warnings.push(`${locale} ${key}: asc cannot clear this field; the App Store Connect value stays.`);
      }
      if (!Object.keys(doc).length) continue;
      await writeText(target, JSON.stringify(doc, null, 2) + '\n');
      out.files.push(target);
    }
  }
  if (existsSync(fastlaneMetadata)) {
    const root = await readdir(fastlaneMetadata);
    const skipped = NOT_IN_ASC.filter((f) => root.includes(f));
    if (skipped.length) out.warnings.push(`asc metadata push does not upload ${skipped.join(', ')}; they stay as they are in App Store Connect (use the deliver uploader or App Store Connect for them).`);
  }
  return out;
}

// ---- media jobs ----

export interface AscMediaJob {
  platform: DeliverPlatform;
  locale: string;
  kind: 'screenshot' | 'preview';
  /** ScreenshotDisplayType (APP_…) or PreviewType. */
  deviceType: string;
  targets: string[];
  files: string[];
}

/**
 * One job per (platform, locale, kind, classic display type) for the sets this run replaces. Targets without a
 * classic type (iPhone Duo) are left out: they go through the App Asset Library.
 */
export function ascMediaJobs(plan: UploadPlan, assets: RenderedAsset[], locales: string[]): AscMediaJob[] {
  const jobs = new Map<string, AscMediaJob>();
  for (const p of plan.platforms) {
    const ps = plan.scope?.apple.find((s) => s.platform === p.platform);
    if (!ps || !isActive(ps)) continue;
    const files = perDisplayTypeAssetsFor(ps, assets).filter((a) => locales.includes(a.locale));
    for (const a of [...files].sort((x, y) => x.order.localeCompare(y.order) || x.target.id.localeCompare(y.target.id))) {
      if (a.kind !== 'screenshot' && a.kind !== 'preview') continue;
      const type = classicTypeFor(a.target);
      if (!type) continue;
      const key = `${p.platform}|${a.locale}|${a.kind}|${type}`;
      const job = jobs.get(key) ?? { platform: p.platform, locale: a.locale, kind: a.kind, deviceType: type, targets: [], files: [] };
      if (!job.targets.includes(a.target.id)) job.targets.push(a.target.id);
      job.files.push(a.file);
      jobs.set(key, job);
    }
  }
  return [...jobs.values()];
}

/** `.vitrin/asc/<platform>/…` — rebuilt for every run. */
export function ascRoot(paths: AppPaths, platform: DeliverPlatform): string {
  return join(paths.vitrin, 'asc', platform);
}

/** Copies a job's files into their own folder, named so that asc's sorted directory read keeps Vitrin's order. */
export async function stageAscJob(paths: AppPaths, job: AscMediaJob): Promise<string> {
  const dir = join(ascRoot(paths, job.platform), 'media', job.locale, job.deviceType);
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
  let i = 0;
  for (const f of job.files) {
    i++;
    await copyFile(f, join(dir, `${String(i).padStart(2, '0')}_${basename(f, extname(f))}${extname(f)}`));
  }
  return dir;
}

async function runAsc(inv: LaneInvocation, root: string, runner: CommandRunner, what: string): Promise<void> {
  const res = await runner(inv.command, inv.args, { cwd: root, stream: true, env: inv.env });
  if (res.code === 0) return;
  if (res.code === 127 || /ENOENT|command not found/i.test(res.stderr)) throw new Error(`asc is not installed: ${ASC_INSTALL_HINT}`);
  throw new Error(`${what} failed (asc exit ${res.code}). See the details above.`);
}

/**
 * The `asc` uploader: per Apple platform, text through `asc metadata push` (app info with the first platform only;
 * it is shared) and each selected display type through `asc screenshots|video-previews upload --replace`.
 * Returns the number of media jobs run. Duo sets are not handled here (App Asset Library).
 */
export async function runAscForPlatforms(
  paths: AppPaths,
  plan: UploadPlan,
  assets: RenderedAsset[],
  client: AscClient | undefined,
  opts: { languages: string[]; env: NodeJS.ProcessEnv; dryRun?: boolean; skipScreenshots?: boolean },
  runner: CommandRunner = exec,
): Promise<{ metadataRuns: number; mediaJobs: number }> {
  const auth = ascEnv(opts.env, paths.root);
  if (auth.problems.length) throw new Error(`asc credentials: ${auth.problems.join('; ')}`);
  if (!plan.appId) throw new Error('No App Store Connect app id; the asc uploader needs the app record (run `vitrin doctor`).');
  let metadataRuns = 0;
  let appInfoDone = false;
  for (const p of plan.platforms) {
    const ps = plan.scope?.apple.find((s) => s.platform === p.platform);
    if (plan.scope && !isActive(ps)) continue;
    if (!p.version) continue;
    if (!ps || ps.metadata) {
      const dir = join(ascRoot(paths, p.platform), 'metadata');
      const exp = await exportAscMetadata(paths.fastlaneMetadata, dir, { locales: opts.languages, version: p.version.versionString, includeAppInfo: !appInfoDone, dropReleaseNotes: p.firstRelease });
      for (const w of exp.warnings) log.warn(w);
      if (exp.files.length) {
        log.step(`asc metadata push ${p.platform}${opts.dryRun ? ' (dry run)' : ''}…`);
        await runAsc(ascMetadataPushInvocation({ appId: plan.appId, version: p.version.versionString, platform: ASC_PLATFORM[p.platform] as AscPlatform, dir, dryRun: Boolean(opts.dryRun), confirm: exp.clears > 0 }, auth.env), paths.root, runner, 'asc metadata push');
        metadataRuns++;
        appInfoDone = true;
      }
    }
  }
  if (opts.skipScreenshots) return { metadataRuns, mediaJobs: 0 };
  const jobs = ascMediaJobs(plan, assets, opts.languages);
  if (jobs.length && !client) {
    if (opts.dryRun) return { metadataRuns, mediaJobs: 0 };
    throw new Error('The asc media upload needs the version localization ids (ASC API key).');
  }
  const locCache = new Map<string, Array<{ id: string; attributes: Record<string, string | null> }>>();
  let mediaJobs = 0;
  for (const job of jobs) {
    const version = plan.platforms.find((p) => p.platform === job.platform)?.version;
    if (!version) continue;
    if (!locCache.has(version.id)) locCache.set(version.id, await client!.versionLocalizations(version.id));
    const loc = locCache.get(version.id)!.find((l) => l.attributes.locale === job.locale);
    if (!loc) {
      log.warn(`${job.platform} ${job.locale}: no version localization (upload the text first); ${job.deviceType} skipped.`);
      continue;
    }
    const dir = await stageAscJob(paths, job);
    const inv = job.kind === 'screenshot' ? ascScreenshotsUploadInvocation({ localizationId: loc.id, path: dir, deviceType: job.deviceType, dryRun: opts.dryRun }, auth.env) : ascVideoPreviewsUploadInvocation({ localizationId: loc.id, path: dir, deviceType: job.deviceType, dryRun: opts.dryRun }, auth.env);
    log.step(`asc ${job.kind === 'screenshot' ? 'screenshots' : 'video-previews'} upload ${job.platform} ${job.locale} ${job.deviceType} (${job.files.length} files, replaces only this set)…`);
    await runAsc(inv, paths.root, runner, `asc ${inv.args[0]} upload ${job.deviceType}`);
    mediaJobs++;
  }
  return { metadataRuns, mediaJobs };
}

/** `asc version` → the version string, or null when asc is not installed. */
export async function ascVersion(runner: CommandRunner = exec): Promise<string | null> {
  const inv = ascVersionInvocation();
  const res = await runner(inv.command, inv.args, { timeoutMs: 30_000 }).catch(() => ({ code: 127, stdout: '', stderr: '' }));
  if (res.code !== 0) return null;
  return /v?(\d+\.\d+\.\d+)/.exec(res.stdout + res.stderr)?.[1] ?? ((res.stdout + res.stderr).trim() || 'unknown');
}
