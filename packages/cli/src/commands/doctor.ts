import { ENV_KEYS, exec, existsSync, loadTargets, log, renderEnvExample, writeJson, writeText, type EnvKey } from '@vitrin/core';
import { AscApiError, AscClient, AscCredentialError, credentialsFromEnv, diffRefData, isEditableVersion, isPem, runLane } from '@vitrin/upload';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import pc from 'picocolors';
import { bundleIdOf, EXIT, type Ctx } from '../context.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';
export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}

export interface DoctorResult {
  checks: Check[];
  missingKeys: Array<Pick<EnvKey, 'name' | 'where'>>;
  exitCode: number;
}

export const MIN_FASTLANE = '2.241.1';

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

async function versionOf(cmd: string, args: string[], re: RegExp, cwd?: string): Promise<string | null> {
  const r = await exec(cmd, args, { cwd, timeoutMs: 60_000 });
  if (r.code !== 0) return null;
  return re.exec(r.stdout + r.stderr)?.[1] ?? null;
}

/** Which of the upload-required keys are missing (ASC_KEY_PATH and ASC_KEY_CONTENT_BASE64 are alternatives). */
export function missingUploadKeys(env: NodeJS.ProcessEnv): Array<Pick<EnvKey, 'name' | 'where'>> {
  const missing: Array<Pick<EnvKey, 'name' | 'where'>> = [];
  for (const k of ENV_KEYS.filter((x) => x.required === 'upload')) {
    if (k.name === 'ASC_KEY_PATH' && env.ASC_KEY_CONTENT_BASE64?.trim()) continue;
    if (!env[k.name]?.trim()) missing.push({ name: k.name, where: k.where });
  }
  return missing;
}

export async function runDoctor(ctx: Ctx, opts: { createVersion?: string; offline?: boolean } = {}): Promise<DoctorResult> {
  const checks: Check[] = [];
  const add = (c: Check) => {
    checks.push(c);
    const icon = { ok: pc.green('✓'), warn: pc.yellow('⚠'), fail: pc.red('✗'), skip: pc.dim('–') }[c.status];
    log.info(`${icon} ${c.title}${c.detail ? pc.dim(` — ${c.detail}`) : ''}`);
    if (c.fix && c.status !== 'ok') log.info(pc.dim(`    → ${c.fix}`));
  };

  // 1. Tools
  log.step('1/6 Tools');
  const node = process.versions.node;
  add({ id: 'node', title: `Node.js ${node}`, status: compareVersions(node, '22.0.0') >= 0 ? 'ok' : 'fail', fix: 'Install Node 22 or later.' });
  const pnpm = await versionOf('pnpm', ['--version'], /(\d+\.\d+\.\d+)/);
  add({ id: 'pnpm', title: 'pnpm', status: pnpm ? 'ok' : 'warn', detail: pnpm ?? 'not found', fix: 'corepack enable && corepack prepare pnpm@latest --activate (only needed to install Vitrin from source).' });
  const ruby = await versionOf('ruby', ['--version'], /ruby (\d+\.\d+\.\d+)/);
  add({ id: 'ruby', title: 'Ruby', status: ruby ? 'ok' : 'fail', detail: ruby ?? 'not found', fix: 'brew install ruby' });
  const bundler = await versionOf('bundle', ['--version'], /(\d+\.\d+\.\d+)/);
  add({ id: 'bundler', title: 'Bundler', status: bundler ? 'ok' : 'fail', detail: bundler ?? 'not found', fix: 'gem install bundler' });
  const hasGemfile = existsSync(join(ctx.root, 'Gemfile'));
  let fastlane = hasGemfile ? await versionOf('bundle', ['exec', 'fastlane', '--version'], /fastlane (\d+\.\d+\.\d+)/, ctx.root) : null;
  fastlane ??= await versionOf('fastlane', ['--version'], /fastlane (\d+\.\d+\.\d+)/);
  add({
    id: 'fastlane',
    title: `fastlane ≥ ${MIN_FASTLANE}`,
    status: fastlane && compareVersions(fastlane, MIN_FASTLANE) >= 0 ? 'ok' : 'fail',
    detail: fastlane ?? 'not found',
    fix: `Add gem "fastlane", ">= ${MIN_FASTLANE}" to the Gemfile and run \`bundle install\`. Older versions do not know the iPhone Duo sizes and abort the upload.`,
  });
  const xcode = await versionOf('xcodebuild', ['-version'], /Xcode (\d+(?:\.\d+)*)/);
  add({ id: 'xcode', title: 'Xcode', status: xcode ? 'ok' : 'fail', detail: xcode ?? 'not found', fix: 'Install Xcode and run `sudo xcode-select -s /Applications/Xcode.app`.' });
  const simctl = await exec('xcrun', ['simctl', 'list', 'runtimes']);
  add({ id: 'simctl', title: 'iOS Simulator (simctl)', status: simctl.code === 0 && /iOS/.test(simctl.stdout) ? 'ok' : 'fail', fix: 'Download an iOS simulator runtime from Xcode > Settings > Components.' });
  const ffmpeg = await versionOf('ffmpeg', ['-version'], /ffmpeg version (\S+)/);
  const ffprobe = await versionOf('ffprobe', ['-version'], /ffprobe version (\S+)/);
  add({ id: 'ffmpeg', title: 'ffmpeg / ffprobe', status: ffmpeg && ffprobe ? 'ok' : 'fail', detail: ffmpeg ?? 'not found', fix: 'brew install ffmpeg' });
  let chromiumOk = false;
  try {
    chromiumOk = existsSync(chromium.executablePath());
  } catch {
    chromiumOk = false;
  }
  add({ id: 'playwright', title: 'Playwright Chromium', status: chromiumOk ? 'ok' : 'fail', fix: 'npx playwright install chromium' });

  // 2. .env and keys
  log.step('2/6 .env and keys');
  const hasEnv = existsSync(ctx.paths.env);
  add({ id: 'env', title: '.env file', status: hasEnv ? 'ok' : 'warn', detail: hasEnv ? ctx.paths.env : 'missing', fix: `cp .env.example .env and fill in the values (${ctx.paths.env}).` });
  const missingKeys = missingUploadKeys(ctx.env);
  for (const k of missingKeys) add({ id: `key:${k.name}`, title: k.name, status: 'fail', detail: 'missing', fix: k.where });
  let keyFileOk = Boolean(ctx.env.ASC_KEY_CONTENT_BASE64?.trim());
  if (ctx.env.ASC_KEY_PATH?.trim() && !ctx.env.ASC_KEY_CONTENT_BASE64?.trim()) {
    const p = ctx.env.ASC_KEY_PATH.trim();
    const full = p.startsWith('/') ? p : join(ctx.root, p);
    if (!existsSync(full)) add({ id: 'p8', title: '.p8 file', status: 'fail', detail: `not found: ${p}`, fix: 'Put the AuthKey_<KEYID>.p8 file downloaded from ASC at this path.' });
    else if (!isPem(await readFile(full, 'utf8'))) add({ id: 'p8', title: '.p8 file', status: 'fail', detail: 'not in PEM format', fix: 'The file must start with “-----BEGIN PRIVATE KEY-----”.' });
    else {
      keyFileOk = true;
      process.env.ASC_KEY_PATH = full;
      add({ id: 'p8', title: '.p8 file', status: 'ok', detail: 'PEM' });
    }
  }

  // 3–4. Live API
  log.step('3/6 App Store Connect API');
  let client: AscClient | undefined;
  let appId: string | undefined;
  if (opts.offline) add({ id: 'api', title: 'Live API test', status: 'skip', detail: '--offline' });
  else if (missingKeys.length || !keyFileOk) add({ id: 'api', title: 'Live API test', status: 'skip', detail: 'keys missing' });
  else {
    try {
      client = new AscClient(credentialsFromEnv(process.env));
      const bundleId = bundleIdOf(ctx);
      const app = await client.findApp(bundleId);
      if (!app) {
        add({ id: 'app', title: 'App record', status: 'fail', detail: `${bundleId} not found in ASC`, fix: 'The app record cannot be created with an API key (403). Create it once by hand in App Store Connect > Apps > +.' });
      } else {
        appId = app.id;
        add({ id: 'api', title: 'JWT and role', status: 'ok', detail: 'key valid' });
        add({ id: 'app', title: 'App record', status: 'ok', detail: `${app.attributes.name} (${app.id})` });
      }
    } catch (err) {
      if (err instanceof AscCredentialError) add({ id: 'api', title: 'ASC key', status: 'fail', detail: err.message });
      else if (err instanceof AscApiError && err.status === 401) add({ id: 'api', title: 'JWT', status: 'fail', detail: '401 — key/issuer invalid or revoked', fix: 'Check that the Key ID, Issuer ID and .p8 file belong to the same key.' });
      else if (err instanceof AscApiError && err.status === 403) add({ id: 'api', title: 'Role', status: 'fail', detail: '403 — insufficient permissions', fix: 'The key needs at least the App Manager role (Team Key).' });
      else add({ id: 'api', title: 'Live API test', status: 'fail', detail: (err as Error).message });
    }
  }

  log.step('4/6 Editable version');
  if (client && appId) {
    const platform = { osx: 'MAC_OS', appletvos: 'TV_OS', xros: 'VISION_OS', ios: 'IOS' }[ctx.config.upload.platform];
    let versions = await client.appStoreVersions(appId, platform);
    let editable = versions.find(isEditableVersion);
    if (!editable && opts.createVersion) {
      log.info(`  Trying to create version ${opts.createVersion} with deliver…`);
      try {
        await runLane(ctx.paths, 'vitrin_create_version', { bundleId: bundleIdOf(ctx), languages: [], appVersion: opts.createVersion, platform: ctx.config.upload.platform, skipMetadata: true, skipScreenshots: true });
        versions = await client.appStoreVersions(appId, platform);
        editable = versions.find(isEditableVersion);
      } catch (err) {
        log.warn((err as Error).message);
      }
    }
    if (editable) add({ id: 'version', title: 'Editable version', status: 'ok', detail: `${editable.attributes.versionString} (${editable.attributes.appVersionState ?? editable.attributes.appStoreState})` });
    else
      add({
        id: 'version',
        title: 'Editable version',
        status: 'fail',
        detail: versions.length ? 'all versions are locked' : 'no App Store version exists',
        fix: 'For a new version run `vitrin doctor --create-version 1.2.0`. For an app that is only on TestFlight the API may reject the first version; create it once by hand in ASC.',
      });
  } else add({ id: 'version', title: 'Editable version', status: 'skip' });

  // 5. URLs
  log.step('5/6 URLs');
  for (const [key, url] of Object.entries(ctx.config.urls)) {
    if (!url) continue;
    if (opts.offline) {
      add({ id: `url:${key}`, title: `${key} URL`, status: 'skip', detail: url });
      continue;
    }
    if (/example\.(com|org)/.test(url)) {
      add({ id: `url:${key}`, title: `${key} URL`, status: 'fail', detail: `${url} is a placeholder`, fix: 'Put the real address in vitrin.config.yaml urls.' });
      continue;
    }
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      const text = key === 'support' ? await res.text() : '';
      const contact = /@[a-z0-9-]+\.[a-z]{2,}|mailto:|tel:|\+\d[\d\s]{6,}|contact|iletişim|kontakt|contacto|お問い合わせ|<form/i.test(text);
      if (!res.ok) add({ id: `url:${key}`, title: `${key} URL`, status: 'fail', detail: `${res.status} ${url}` });
      else if (key === 'support' && !contact) add({ id: `url:${key}`, title: 'Support page', status: 'warn', detail: 'no contact information found', fix: 'The support page must include real contact information (email/form).' });
      else add({ id: `url:${key}`, title: `${key} URL`, status: 'ok', detail: `${res.status}` });
    } catch (err) {
      add({ id: `url:${key}`, title: `${key} URL`, status: 'fail', detail: `${url}: ${(err as Error).message}` });
    }
  }

  // 6. refData vs targets.json
  log.step('6/6 App Asset Library refData');
  if (client) {
    try {
      const ref = await client.assetLibraryRefData();
      await writeJson(join(ctx.paths.cache, 'refdata.json'), ref);
      const diffs = diffRefData(ref, loadTargets());
      add({ id: 'refdata', title: 'refData ↔ data/targets.json', status: diffs.length ? 'warn' : 'ok', detail: diffs.length ? `${diffs.length} differences` : 'in sync', fix: diffs.slice(0, 6).join('\n      ') });
    } catch (err) {
      add({ id: 'refdata', title: 'refData', status: 'warn', detail: (err as Error).message });
    }
  } else add({ id: 'refdata', title: 'refData', status: 'skip' });

  let exitCode: number = EXIT.OK;
  if (checks.some((c) => c.status === 'fail')) exitCode = EXIT.FAIL;
  if (missingKeys.length) {
    exitCode = EXIT.NEEDS_INPUT;
    // Keep .env.example current so the user sees every key with its explanation.
    await writeText(ctx.paths.envExample, renderEnvExample(await extraEnvExampleLines(ctx.paths.envExample)));
    log.info('');
    log.info(pc.bold('Missing keys required for upload:'));
    for (const k of missingKeys) log.info(`  • ${pc.bold(k.name)} — ${k.where}`);
    log.info(`\nWrite the values to ${pc.bold(ctx.paths.env)} (example: ${ctx.paths.envExample}). Do not paste them into the chat.`);
    log.info('Add them to .env, then reply "continue".');
  }
  return { checks, missingKeys, exitCode };
}

async function extraEnvExampleLines(file: string): Promise<string[]> {
  if (!existsSync(file)) return [];
  const known = new Set(ENV_KEYS.map((k) => k.name));
  return (await readFile(file, 'utf8')).split('\n').filter((l) => {
    const m = /^([A-Z0-9_]+)=/.exec(l);
    return m && !known.has(m[1]!);
  });
}
