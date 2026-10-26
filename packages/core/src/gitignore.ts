import type { VitrinConfig } from '@vitrin/schemas';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from './exec.js';

export const GITIGNORE_BEGIN = '# >>> vitrin (managed block, edits inside are overwritten)';
export const GITIGNORE_END = '# <<< vitrin';

/** Files under `metadata/` that are source (written by Claude or the analyzer) and meant to be committed. */
export const VITRIN_COMMITTED = ['.vitrin-workspace', 'app_profile.json', 'listing/', 'art-direction.json', 'shots.json', 'video-plan.json', 'cpp-suggestions.json', 'screens/', 'designs/'];

/** Readable outputs under `metadata/` that are committed only with `retention.commit: true`. */
export const VITRIN_OUTPUTS = ['app-store/', 'google-play/', 'manifest.json', 'store/', 'creative/', 'mockups/'];

/** The ignore patterns Vitrin maintains: secrets and everything it generates. */
export function vitrinGitignoreLines(config?: Pick<VitrinConfig, 'retention'>): string[] {
  return [
    '# secrets',
    '.env',
    '*.p8',
    'secrets/',
    '# Vitrin workspace: generated files stay local, the sources Claude writes are committable',
    '/metadata/*',
    ...VITRIN_COMMITTED.map((f) => `!/metadata/${f}`),
    // Keyword research is worth keeping in git; downloads and competitor data are not.
    '!/metadata/research/',
    '/metadata/research/*',
    '!/metadata/research/keywords/',
    ...(config?.retention?.commit ? ['# store outputs (retention.commit: true)', ...VITRIN_OUTPUTS.map((f) => `!/metadata/${f}`)] : []),
    '# older Vitrin versions',
    '/.vitrin/',
    '/fastlane/screenshots/',
    '/fastlane/app-previews/',
    '/fastlane/metadata/android/**/images/',
    '/fastlane/report.xml',
    '/fastlane/README.md',
  ];
}

function renderBlock(lines: string[]): string {
  return [GITIGNORE_BEGIN, ...lines, GITIGNORE_END].join('\n');
}

/** Returns `.gitignore` text with the managed block inserted or replaced in place (idempotent). */
export function applyGitignoreBlock(current: string, lines: string[]): string {
  const block = renderBlock(lines);
  const start = current.indexOf(GITIGNORE_BEGIN);
  const end = start >= 0 ? current.indexOf(GITIGNORE_END, start) : -1;
  if (start >= 0 && end >= 0) return current.slice(0, start) + block + current.slice(end + GITIGNORE_END.length);
  const sep = current === '' ? '' : current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  return `${current}${sep}${block}\n`;
}

export interface GitignoreResult {
  file: string;
  changed: boolean;
  /** Tracked files that the block now ignores, grouped by their top-level generated path. */
  trackedIgnored: Array<{ path: string; files: number }>;
}

/** Top-level path a tracked, ignored file belongs to (what `git rm -r --cached` should be given). */
function groupOf(file: string): string {
  const parts = file.split('/');
  if (parts[0] === 'metadata' || parts[0] === '.vitrin') return parts.length > 2 ? `${parts[0]}/${parts[1]}/` : file;
  if (parts[0] === 'fastlane' && parts.length > 2) {
    const img = parts.indexOf('images');
    if (img > 0) return `${parts.slice(0, img + 1).join('/')}/`;
    return `${parts[0]}/${parts[1]}/`;
  }
  return file;
}

/**
 * Maintains the marked Vitrin block in the project's `.gitignore` and reports tracked files the block ignores.
 * Never changes the git index: removing tracked files is the user's decision (`git rm -r --cached <path>`).
 */
export async function ensureVitrinGitignore(root: string, config?: Pick<VitrinConfig, 'retention'>): Promise<GitignoreResult> {
  const file = join(root, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const next = applyGitignoreBlock(current, vitrinGitignoreLines(config));
  const changed = next !== current;
  if (changed) writeFileSync(file, next, 'utf8');

  const trackedIgnored: GitignoreResult['trackedIgnored'] = [];
  if (existsSync(join(root, '.git'))) {
    const res = await exec('git', ['ls-files', '-ci', '--exclude-standard', '-z'], { cwd: root, timeoutMs: 15_000 }).catch(() => undefined);
    if (res?.code === 0) {
      const counts = new Map<string, number>();
      for (const f of res.stdout.split('\0').filter(Boolean)) counts.set(groupOf(f), (counts.get(groupOf(f)) ?? 0) + 1);
      for (const [path, files] of [...counts].sort(([a], [b]) => a.localeCompare(b))) trackedIgnored.push({ path, files });
    }
  }
  return { file, changed, trackedIgnored };
}
