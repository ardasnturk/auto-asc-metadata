#!/usr/bin/env node
// Builds the publishable `@ardasnturk/vitrin` npm package and packs it into <out>/ardasnturk-vitrin-<version>.tgz.
//
// The package holds one bundled CLI (dist/bin.js: packages/cli with every internal @vitrin/* workspace package
// inlined by esbuild), the runtime files the code reads from disk (data/, fastlane/ templates, the Remotion
// sources that @remotion/bundler compiles at render time, the Swift OCR script), LICENSE and README.
// Third-party packages (sharp, playwright, remotion, @remotion/*, fonts, zod, …) stay real `dependencies`
// with the same version ranges as the workspace packages declare.
//
// Usage: node scripts/pack.mjs [--out <dir>]   (needs `pnpm build` first; `pnpm pack:release` does both)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_NAME = '@ardasnturk/vitrin';
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = resolve(outIdx >= 0 && argv[outIdx + 1] ? argv[outIdx + 1] : join(ROOT, 'release'));
const STAGE = join(OUT, 'package');

const rootPkg = readJson(join(ROOT, 'package.json'));
const version = rootPkg.version;
const cliEntry = join(ROOT, 'packages', 'cli', 'dist', 'bin.js');
if (!existsSync(cliEntry)) {
  console.error('packages/cli/dist/bin.js is missing: run `pnpm build` first (or `pnpm pack:release`).');
  process.exit(1);
}

// 1. Third-party dependencies of every workspace package, with the ranges they declare today.
const workspace = readdirSync(join(ROOT, 'packages'))
  .map((d) => join(ROOT, 'packages', d, 'package.json'))
  .filter(existsSync)
  .map(readJson);
const internal = new Set(workspace.map((p) => p.name));
const dependencies = {};
for (const p of workspace) {
  for (const [name, range] of Object.entries(p.dependencies ?? {})) {
    if (internal.has(name)) continue;
    if (dependencies[name] && dependencies[name] !== range) {
      throw new Error(`${name} is declared as ${dependencies[name]} and ${range} in different workspace packages; align them first.`);
    }
    dependencies[name] = range;
  }
}
const sortedDeps = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));

// 2. Bundle the CLI: internal packages inlined, third-party packages external.
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
const result = await build({
  entryPoints: [cliEntry],
  outfile: join(STAGE, 'dist', 'bin.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: Object.keys(dependencies).flatMap((name) => [name, `${name}/*`]),
  metafile: true,
  logLevel: 'warning',
});
const strays = Object.keys(result.metafile.inputs).filter((f) => f.split(/[\\/]/).includes('node_modules'));
if (strays.length) {
  throw new Error(`Undeclared third-party code was bundled (add it to a workspace package's dependencies):\n  ${strays.join('\n  ')}`);
}

// 3. Runtime files, at the same paths relative to dist/ as in the monorepo:
//    - core finds data/ and fastlane/ by walking up from dist/ to the folder with data/targets.json;
//    - video bundles <dist>/../src/remotion/index.ts; research runs <dist>/../scripts/ocr.swift.
const copy = (from, to) => cpSync(join(ROOT, from), join(STAGE, to), { recursive: true });
for (const f of readdirSync(join(ROOT, 'data')).filter((f) => f.endsWith('.json'))) copy(join('data', f), join('data', f));
copy('fastlane/Fastfile', 'fastlane/Fastfile');
copy('fastlane/Gemfile', 'fastlane/Gemfile');
copy('packages/video/src/remotion', 'src/remotion');
copy('packages/video/src/types.ts', 'src/types.ts');
copy('packages/research/scripts/ocr.swift', 'scripts/ocr.swift');
copy('LICENSE', 'LICENSE');
copy('scripts/npm-readme.md', 'README.md');

const pkg = {
  name: PKG_NAME,
  version,
  description: 'Vitrin CLI: App Store Connect and Google Play metadata, HTML-rendered screenshots and Remotion App Previews, driven by the /vitrin Claude Code skill',
  type: 'module',
  bin: { vitrin: 'dist/bin.js' },
  files: ['dist', 'data', 'fastlane', 'src', 'scripts'],
  engines: { node: '>=22' },
  dependencies: sortedDeps,
  keywords: ['app-store', 'app-store-connect', 'google-play', 'aso', 'fastlane', 'screenshots', 'app-preview', 'remotion', 'ios', 'claude-code'],
  author: rootPkg.author,
  license: rootPkg.license,
  homepage: rootPkg.homepage,
  bugs: rootPkg.bugs,
  repository: rootPkg.repository,
};
writeFileSync(join(STAGE, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

// 4. npm pack → <out>/ardasnturk-vitrin-<version>.tgz
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', OUT], { cwd: STAGE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))[0];
const tarball = join(OUT, packed.filename);
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`${relative(process.cwd(), tarball) || tarball}: ${packed.entryCount} files, ${mb(packed.size)} packed, ${mb(packed.unpackedSize)} unpacked`);
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball.split(sep).join('/')}\n`, { flag: 'a' });
