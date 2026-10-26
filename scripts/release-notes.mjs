#!/usr/bin/env node
// Prints the CHANGELOG.md section of a version (default: package.json version) for the GitHub Release notes.
// Usage: node scripts/release-notes.mjs [version]   — exits 1 when the section is missing or empty.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const isHeading = (l) => /^## /.test(l);
  const start = lines.findIndex((l) => isHeading(l) && l.slice(3).split(/\s/)[0] === version);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && isHeading(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2] ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const notes = releaseNotes(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
