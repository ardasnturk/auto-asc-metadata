import { analyzeProject, locateProject } from '@vitrin/analyzer';
import { appPaths, ensureVitrinGitignore, ensureWorkspace, existsSync, WorkspaceTaken, loadConfig, log, storefrontForLocale, writeText } from '@vitrin/core';
import { UploaderEnum, uploaderOf } from '@vitrin/schemas';
import { installFastlaneTemplates } from '@vitrin/upload';
import { relative, resolve } from 'node:path';
import { stringify } from 'yaml';
import { NeedsInput } from '../context.js';

// Secrets, caches and machine-local pipeline state stay out of git; the JSON Claude writes is meant to be committed.

export async function initCommand(opts: { cwd?: string; force?: boolean; uploader?: string; language?: string }): Promise<number> {
  if (opts.uploader && !(UploaderEnum.options as readonly string[]).includes(opts.uploader)) throw new Error(`Unknown uploader: ${opts.uploader}. Valid: ${UploaderEnum.options.join(', ')}.`);
  const root = resolve(opts.cwd ?? process.cwd());
  const paths = appPaths(root);
  log.step(`Vitrin setup: ${root}`);
  // Everything Vitrin generates lives in metadata/; a user folder with that name stops the setup before it writes anything.
  try {
    const ws = await ensureWorkspace(root);
    if (ws.migrated.length) log.ok(`Moved the Vitrin files from .vitrin/ to metadata/ (${ws.migrated.length} entries).`);
  } catch (err) {
    if (err instanceof WorkspaceTaken) throw new NeedsInput(err.message);
    throw err;
  }

  let detectedAndroid: boolean | undefined;
  if (!existsSync(paths.config) || opts.force) {
    let detected: { project?: string; scheme?: string; bundleId?: string; locales: string[]; primary: string; holder?: string; android?: boolean } = { locales: ['en-US'], primary: 'en-US' };
    try {
      const loc = await locateProject(root);
      const profile = await analyzeProject({ root });
      const asc = profile.app.locales.map((l) => l.asc).filter((x): x is string => Boolean(x));
      const dev = profile.app.locales.find((l) => l.xcode === profile.app.developmentRegion)?.asc ?? asc[0] ?? 'en-US';
      detected = {
        project: loc.workspace ? relative(root, loc.workspace) : loc.xcodeproj ? relative(root, loc.xcodeproj) : undefined,
        scheme: profile.project.scheme,
        bundleId: profile.app.bundleId,
        locales: asc.length ? [...new Set(asc)] : ['en-US'],
        primary: dev,
        android: profile.app.platforms.includes('android'),
      };
      log.ok(`Xcode project: ${detected.project} (scheme ${detected.scheme}, ${detected.locales.join(', ')})`);
    } catch (err) {
      log.warn(`Could not read the project automatically: ${(err as Error).message}`);
    }
    const storefronts = [...new Set([...detected.locales.map((l) => storefrontForLocale(l)), "us"])];
    const config = {
      // The language Vitrin talks to the user in (the skill asks); store copy follows app.locales.
      ...(opts.language ? { ui: { language: opts.language } } : {}),
      app: {
        bundleId: detected.bundleId,
        project: detected.project,
        scheme: detected.scheme,
        primaryLocale: detected.primary,
        locales: detected.locales,
      },
      storefronts,
      urls: { support: 'https://example.com/support', privacy: 'https://example.com/privacy', marketing: undefined },
      copyrightHolder: 'Company Name',
      review: { firstName: '', lastName: '', phone: '', email: '' },
      research: { seeds: Object.fromEntries(detected.locales.map((l) => [l, []])), competitors: 15, candidates: 40, limit: 50, cacheHours: 24, reviewsPerApp: 50, ocr: true },
      targets: { enable: [], disable: [] },
      capture: {
        // html: Claude recreates the screens from the source code; no build or simulator (launch-args = real capture).
        mode: 'html',
        configuration: 'Debug',
        appearance: 'light',
        screens: [
          { id: 'home', source: [] },
        ],
        recordings: [],
        simulators: {},
      },
      video: { enabled: true, loops: true },
      // upload.uploader (asc | deliver) is the user's choice: `vitrin uploader`, then `vitrin select --uploader`.
      upload: { ...(opts.uploader ? { uploader: opts.uploader } : {}), platform: 'ios' },
    };
    const header = [
      '# Vitrin configuration — non-secret values only. Keys live in .env.',
      '# Fill in urls, copyrightHolder and review with real values.',
      '# research.seeds and capture.screens are filled in by Claude while the /vitrin skill runs.',
      '',
    ].join('\n');
    detectedAndroid = detected.android;
    await writeText(paths.config, header + stringify(config, { lineWidth: 120 }));
    log.ok('Created vitrin.config.yaml');
  } else {
    log.dim('vitrin.config.yaml already exists (use --force to overwrite).');
  }

  // .env.example is written by `vitrin doctor` at the upload gate, when keys are actually needed.

  // .gitignore: one managed block for secrets and everything Vitrin generates (kept up to date by every command).
  const gi = await ensureVitrinGitignore(root, loadConfig(paths.config));
  if (gi.changed) log.ok('.gitignore: wrote the Vitrin block (secrets and generated files are not committed).');
  if (gi.trackedIgnored.length) log.warn(`Already tracked but now ignored: ${gi.trackedIgnored.map((g) => g.path).join(', ')} — to stop tracking: git rm -r --cached ${gi.trackedIgnored.map((g) => g.path).join(' ')}`);

  // fastlane files are written only once the user picked fastlane (vitrin select --uploader) or at the upload.
  const config = loadConfig(paths.config);
  if (config.upload.uploader && uploaderOf(config) !== 'asc') {
    const installed = await installFastlaneTemplates(paths, opts.force);
    for (const f of installed) log.ok(`Wrote ${relative(root, f)}`);
  }
  if (detectedAndroid) log.dim('Google Play uploads use fastlane supply; its Fastfile is written only when the upload is prepared.');
  if (!config.upload.uploader) log.info('How the listing is uploaded (asc CLI or fastlane) is asked after the user approved a design.');
  log.info('\nNext step: `vitrin doctor --tools` (keys are needed only for the upload).');
  return 0;
}

