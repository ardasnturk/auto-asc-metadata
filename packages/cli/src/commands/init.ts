import { analyzeProject, locateProject } from '@vitrin/analyzer';
import { appPaths, ensureDir, existsSync, log, renderEnvExample, ENV_KEYS, storefrontForLocale, writeText } from '@vitrin/core';
import { installFastlaneTemplates } from '@vitrin/upload';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { stringify } from 'yaml';

const GITIGNORE_LINES = ['.env', '*.p8', 'secrets/', '.vitrin/cache/', '.vitrin/raw/', 'fastlane/report.xml', 'fastlane/README.md'];

export async function initCommand(opts: { cwd?: string; force?: boolean }): Promise<number> {
  const root = resolve(opts.cwd ?? process.cwd());
  const paths = appPaths(root);
  log.step(`Vitrin kurulumu: ${root}`);

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
      log.ok(`Xcode projesi: ${detected.project} (şema ${detected.scheme}, ${detected.locales.join(', ')})`);
    } catch (err) {
      log.warn(`Proje otomatik okunamadı: ${(err as Error).message}`);
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
      copyrightHolder: 'Şirket Adı',
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
      '# Vitrin yapılandırması — gizli olmayan değerler. Anahtarlar .env içinde durur.',
      '# urls, copyrightHolder ve review alanlarını gerçek değerlerle doldur.',
      '# research.seeds ve capture.screens /vitrin skill’i çalışırken Claude tarafından doldurulur.',
      '',
    ].join('\n');
    await writeText(paths.config, header + stringify(config, { lineWidth: 120 }));
    log.ok('vitrin.config.yaml oluşturuldu');
  } else {
    log.dim('vitrin.config.yaml zaten var (üzerine yazmak için --force).');
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
  log.ok('.env.example güncellendi');

  // .gitignore
  const gi = `${root}/.gitignore`;
  const current = existsSync(gi) ? await readFile(gi, 'utf8') : '';
  const missing = GITIGNORE_LINES.filter((l) => !current.split('\n').some((x) => x.trim() === l));
  if (missing.length) {
    await writeText(gi, `${current}${current && !current.endsWith('\n') ? '\n' : ''}\n# Vitrin\n${missing.join('\n')}\n`);
    log.ok(`.gitignore: ${missing.join(', ')} eklendi`);
  }

  await ensureDir(paths.vitrin);
  const installed = await installFastlaneTemplates(paths, opts.force);
  for (const f of installed) log.ok(`${relative(root, f)} yazıldı`);
  log.info('\nSonraki adım: `vitrin doctor` (anahtarlar eksikse üretim yine devam eder).');
  return 0;
}

