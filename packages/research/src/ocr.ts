import { ensureDir, exec, existsSync, sha256 } from '@vitrin/core';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ocr.swift');

/** Compiles the Vision OCR helper once into the cache dir (keyed by script hash). Returns null off macOS. */
export async function ocrBinary(cacheDir: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const hash = sha256(await readFile(SCRIPT)).slice(0, 12);
  const bin = join(cacheDir, `vitrin-ocr-${hash}`);
  if (existsSync(bin)) return bin;
  await ensureDir(cacheDir);
  const res = await exec('xcrun', ['swiftc', '-O', SCRIPT, '-o', bin]);
  return res.code === 0 ? bin : null;
}

/** Large-text lines from each image (headline captions). */
export async function ocrImages(bin: string, files: string[], languages: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!files.length) return out;
  const res = await exec(bin, [languages.join(','), ...files], { timeoutMs: 180_000 });
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const { file, lines } = JSON.parse(line) as { file: string; lines: string[] };
      out.set(file, lines);
    } catch {
      // ignore malformed line
    }
  }
  return out;
}

/** Map ASC locale → Vision recognition language. */
export function visionLanguage(locale: string): string {
  const map: Record<string, string> = { 'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant', ja: 'ja-JP', ko: 'ko-KR', tr: 'tr-TR', 'pt-BR': 'pt-BR', ar: 'ar-SA' };
  return map[locale] ?? locale;
}
