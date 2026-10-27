import { appPaths, ensureVitrinGitignore, ensureWorkspace, WorkspaceTaken, findAppRoot, hashValue, loadConfig, loadEnv, log, readJson, StateStore, type AppPaths } from '@vitrin/core';
import { AppProfile, type StageName, type VitrinConfig } from '@vitrin/schemas';
import { existsSync } from 'node:fs';

/** Exit codes shared with the skill: 0 ok, 1 failure/validation errors, 2 waiting for user or Claude input. */
export const EXIT = { OK: 0, FAIL: 1, NEEDS_INPUT: 2 } as const;

export class NeedsInput extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
  }
}

export interface GlobalOptions {
  cwd?: string;
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export interface Ctx {
  root: string;
  paths: AppPaths;
  config: VitrinConfig;
  state: StateStore;
  env: NodeJS.ProcessEnv;
  force: boolean;
  json: boolean;
}

export async function createContext(opts: GlobalOptions): Promise<Ctx> {
  const root = findAppRoot(opts.cwd ?? process.cwd());
  const paths = appPaths(root);
  const env = loadEnv(paths.env);
  const config = loadConfig(paths.config);
  await prepareWorkspace(root);
  const state = await StateStore.load(paths.state);
  await syncGitignore(root, config);
  return { root, paths, config, state, env, force: Boolean(opts.force), json: Boolean(opts.json) };
}

/** `metadata/` is the workspace: created on first use, an older `.vitrin/` folder is moved into it. */
async function prepareWorkspace(root: string): Promise<void> {
  try {
    const res = await ensureWorkspace(root);
    if (res.migrated.length) log.ok(`Moved the Vitrin files from .vitrin/ to metadata/ (${res.migrated.length} entries); everything Vitrin generates now lives in metadata/.`);
  } catch (err) {
    if (err instanceof WorkspaceTaken) throw new NeedsInput(err.message);
    throw err;
  }
}

/** Keeps the managed .gitignore block current (every command that writes files runs through here). */
async function syncGitignore(root: string, config: VitrinConfig): Promise<void> {
  try {
    const res = await ensureVitrinGitignore(root, config);
    if (res.changed) log.dim('.gitignore: updated the Vitrin block (generated files are not committed).');
    if (res.trackedIgnored.length) {
      const total = res.trackedIgnored.reduce((n, g) => n + g.files, 0);
      const paths = res.trackedIgnored.map((g) => g.path);
      log.warn(`${total} generated file(s) are tracked by git but now ignored (${paths.slice(0, 6).join(', ')}${paths.length > 6 ? ', …' : ''}); to stop tracking them: git rm -r --cached ${paths.slice(0, 6).join(' ')}`);
    }
  } catch (err) {
    log.warn(`.gitignore was not updated: ${(err as Error).message}`);
  }
}

export async function loadProfile(ctx: Ctx): Promise<AppProfile> {
  if (!existsSync(ctx.paths.profile)) throw new NeedsInput('app_profile.json not found; run `vitrin analyze` first.');
  const profile = await readJson(ctx.paths.profile, AppProfile);
  // app_profile.json stores the project root relative to the app repo.
  return { ...profile, project: { ...profile.project, root: ctx.root } };
}

export function bundleIdOf(ctx: Ctx, profile?: AppProfile): string {
  const id = ctx.config.app.bundleId || ctx.env.APP_BUNDLE_ID || profile?.app.bundleId;
  if (!id) throw new NeedsInput('Bundle ID not found: set vitrin.config.yaml app.bundleId or APP_BUNDLE_ID, or check the Xcode project.');
  return id;
}

/** Runs `fn` unless the stage already completed with the same input hash. */
export async function stage(ctx: Ctx, name: StageName, inputs: unknown, fn: () => Promise<string[] | void>): Promise<boolean> {
  const hash = typeof inputs === 'string' ? inputs : hashValue(inputs);
  if (!ctx.force && ctx.state.isFresh(name, hash)) {
    log.ok(`${name}: inputs unchanged, skipped (use --force to re-run).`);
    return false;
  }
  const outputs = (await fn()) ?? [];
  await ctx.state.mark(name, hash, outputs.map((o) => o.replace(ctx.root + '/', '')));
  return true;
}
