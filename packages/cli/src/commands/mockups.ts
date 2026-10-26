import { log } from '@vitrin/core';
import { composeScreenMockups, MOCKUPS, renderMockupTemplates } from '@vitrin/render';
import { join, relative } from 'node:path';
import { EXIT, type Ctx } from '../context.js';

/**
 * `vitrin mockups` — the ready-made device mockups in metadata/mockups/: empty templates (transparent PNG and the
 * screen rectangles in mockups.json) and, with `--screens`, the app's rendered screens placed into them. The
 * screenshots use the very same frames, so what the user sees here is what the store images show.
 */
export async function mockupsCommand(ctx: Ctx, opts: { screens?: boolean; locales?: string[]; ids?: string[]; list?: boolean } = {}): Promise<number> {
  if (opts.list) {
    for (const m of MOCKUPS) log.info(`${m.id.padEnd(22)} ${m.label}  (screen ${m.screenTarget}, raw ${m.rawFamily})`);
    return EXIT.OK;
  }
  const dir = ctx.paths.mockups;
  const templates = await renderMockupTemplates(join(dir, 'templates'), { ids: opts.ids });
  log.ok(`${templates.length} mockup templates → ${relative(ctx.root, join(dir, 'templates'))}/ (index.html, mockups.json with the screen rectangles)`);
  if (opts.screens) {
    const composed = await composeScreenMockups(ctx.paths.raw, join(dir, 'screens'), { locales: opts.locales, mockups: opts.ids });
    if (!composed.length) log.warn('No rendered screens in metadata/raw yet; run `vitrin capture` first.');
    else log.ok(`${composed.length} screens placed in mockups → ${relative(ctx.root, join(dir, 'screens'))}/index.html`);
    log.result({ templates: templates.map((t) => relative(ctx.root, t.file)), composed: composed.map((c) => relative(ctx.root, c.file)) });
  } else {
    log.result({ templates: templates.map((t) => relative(ctx.root, t.file)) });
  }
  return EXIT.OK;
}
