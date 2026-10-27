#!/usr/bin/env node
// Builds the Vitrin Studio UI (React, TypeScript) into dist/: one script, one stylesheet and index.html.
// The CLI serves dist/ from `vitrin studio`; scripts/pack.mjs copies it into the published package as studio/.
// Usage: node build.mjs [--watch]
import { context } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');
const watch = process.argv.includes('--watch');
mkdirSync(DIST, { recursive: true });

const version = JSON.parse(readFileSync(join(HERE, '..', '..', 'package.json'), 'utf8')).version;

const ctx = await context({
  entryPoints: { studio: join(HERE, 'src', 'main.tsx') },
  outdir: DIST,
  bundle: true,
  format: 'esm',
  target: ['es2022', 'safari16', 'chrome110', 'firefox115'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  jsx: 'automatic',
  charset: 'utf8',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __VITRIN_VERSION__: JSON.stringify(version) },
  loader: { '.css': 'css', '.svg': 'dataurl' },
  logLevel: 'info',
});

writeFileSync(join(DIST, 'index.html'), readFileSync(join(HERE, 'src', 'index.html'), 'utf8').replaceAll('__VERSION__', version));
copyFileSync(join(HERE, 'src', 'favicon.svg'), join(DIST, 'favicon.svg'));

if (watch) {
  await ctx.watch();
  console.log('studio: watching src/ → dist/');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
