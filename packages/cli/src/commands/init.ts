import { analyzeProject, locateProject } from '@vitrin/analyzer';
import { appPaths, ensureDir, existsSync, log, renderEnvExample, ENV_KEYS, storefrontForLocale, writeText } from '@vitrin/core';
import { installFastlaneTemplates } from '@vitrin/upload';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { stringify } from 'yaml';

// Secrets, caches and machine-local pipeline state stay out of git; the JSON Claude writes is meant to be committed.
const GITIGNORE_LINES = ['.env', '*.p8', 'secrets/', '.vitrin/cache/', '.vitrin/raw/', '.vitrin/briefs/', '.vitrin/state.json', '.vitrin/upload-plan.json', 'fastlane/report.xml', 'fastlane/README.md'];

export async function initCommand(opts: { cwd?: string; force?: boolean }): Promise<number> {
  const root = resolve(opts.cwd ?? process.cwd());
  const paths = appPaths(root);
  log.step(`Vitrin setup: ${root}`);

  if (!existsSync(paths.config) || opts.force) {
    let detected: { project?: string; scheme?: string; bundleId?: string; locales: string[]; primary: string; holder?: string } = { locales: ['en-US'], primary: 'en-US' };
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
      };
      log.ok(`Xcode project: ${detected.project} (scheme ${detected.scheme}, ${detected.locales.join(', ')})`);
    } catch (err) {
      log.warn(`Could not read the project automatically: ${(err as Error).message}`);
    }
    const storefronts = [...new Set([...detected.locales.map((l) => storefrontForLocale(l)), "us"])];
    const config = {
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
        mode: 'launch-args',
        configuration: 'Debug',
        appearance: 'light',
        screens: [
          { id: 'home', launchArgs: ['-VitrinScreen', 'home'], waitMs: 2500 },
        ],
        recordings: [],
        simulators: {},
      },
      video: { enabled: true, loops: true },
      upload: { uploader: 'deliver', platform: 'ios' },
    };
    const header = [
      '# Vitrin configuration — non-secret values only. Keys live in .env.',
      '# Fill in urls, copyrightHolder and review with real values.',
      '# research.seeds and capture.screens are filled in by Claude while the /vitrin skill runs.',
      '',
    ].join('\n');
    await writeText(paths.config, header + stringify(config, { lineWidth: 120 }));
    log.ok('Created vitrin.config.yaml');
  } else {
    log.dim('vitrin.config.yaml already exists (use --force to overwrite).');
  }

  // .env.example — keep keys the user added.
  const extra: string[] = [];
  if (existsSync(paths.envExample)) {
    const known = new Set(ENV_KEYS.map((k) => k.name));
    for (const line of (await readFile(paths.envExample, 'utf8')).split('\n')) {
      const m = /^([A-Z0-9_]+)=/.exec(line);
      if (m && !known.has(m[1]!)) extra.push(line);
    }
  }
  await writeText(paths.envExample, renderEnvExample(extra));
  log.ok('Updated .env.example');

  // .gitignore
  const gi = `${root}/.gitignore`;
  const current = existsSync(gi) ? await readFile(gi, 'utf8') : '';
  const missing = GITIGNORE_LINES.filter((l) => !current.split('\n').some((x) => x.trim() === l));
  if (missing.length) {
    await writeText(gi, `${current}${current && !current.endsWith('\n') ? '\n' : ''}\n# Vitrin\n${missing.join('\n')}\n`);
    log.ok(`.gitignore: added ${missing.join(', ')}`);
  }

  await ensureDir(paths.vitrin);
  const installed = await installFastlaneTemplates(paths, opts.force);
  for (const f of installed) log.ok(`Wrote ${relative(root, f)}`);
  log.info('\nNext step: `vitrin doctor` (generation still works if keys are missing).');
  return 0;
}

