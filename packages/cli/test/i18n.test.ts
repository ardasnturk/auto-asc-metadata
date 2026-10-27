import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/context.js';
import { fill, loadUiText, UI_EN } from '../src/i18n.js';
import { configWith } from './helpers.js';

function ctxWith(language?: string) {
  const vitrin = join(mkdtempSync(join(tmpdir(), 'vitrin-i18n-')), 'metadata');
  return { paths: { vitrin }, config: configWith(language ? { ui: { language } } : {}) } as unknown as Pick<Ctx, 'paths' | 'config'>;
}

describe('review gallery language', () => {
  it('defaults to English', async () => {
    expect(await loadUiText(ctxWith())).toMatchObject({ language: 'en', missing: false, text: UI_EN });
  });

  it('has Turkish built in, also for regional tags', async () => {
    const { text, missing } = await loadUiText(ctxWith('tr-TR'));
    expect(missing).toBe(false);
    expect(text.approveAll).toBe('Hepsini onayla');
    expect(Object.keys(text).sort()).toEqual(Object.keys(UI_EN).sort());
  });

  it('reads a translation Claude wrote for any other language, falling back to English per key', async () => {
    const ctx = ctxWith('de');
    expect((await loadUiText(ctx)).missing).toBe(true);
    mkdirSync(join(ctx.paths.vitrin, 'i18n'), { recursive: true });
    writeFileSync(join(ctx.paths.vitrin, 'i18n', 'de.json'), JSON.stringify({ approveAll: 'Alles freigeben', unknownKey: 'x', errors: '' }));
    const { text, missing } = await loadUiText(ctx);
    expect(missing).toBe(false);
    expect(text.approveAll).toBe('Alles freigeben');
    expect(text.errors).toBe(UI_EN.errors);
    expect('unknownKey' in text).toBe(false);
  });

  it('fills placeholders', () => {
    expect(fill('{n} files, {n} done, {other}', { n: 3 })).toBe('3 files, 3 done, {other}');
  });
});
