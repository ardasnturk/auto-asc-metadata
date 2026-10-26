import { ensureDir, existsSync, localeInfo, loadTargets, log } from '@vitrin/core';
import { launchChromium } from '@vitrin/render';
import type { RenderTarget } from '@vitrin/schemas';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Ctx } from './context.js';

/**
 * capture.mode `html`: no build, no simulator. Claude reads the app's source and writes each screen as an HTML/CSS
 * recreation with demo data in `.vitrin/screens/<id>.html` (optionally `<id>.<family>.html` for an iPad, Mac, Watch
 * … layout), with text as `{{key}}` placeholders filled from `.vitrin/screens/strings/<locale>.json`. Vitrin renders
 * each screen per locale and device family at the device's screen size into the same raw files a simulator capture
 * writes (`.vitrin/raw/<locale>/<family>/<id>.png`), so design, video and review work unchanged.
 */

export type ScreenFamily = 'iphone' | 'ipad' | 'duo' | 'mac' | 'watch' | 'tv' | 'vision' | 'android-phone' | 'android-tablet';

/** The screenshot format whose logical size is the device screen of each family. */
const SCREEN_TARGET: Record<ScreenFamily, string> = {
  iphone: 'iphone-6.9',
  ipad: 'ipad-13',
  duo: 'duo-inner',
  mac: 'mac-16x10',
  watch: 'watch-ultra',
  tv: 'appletv-4k',
  vision: 'vision-pro',
  'android-phone': 'play-phone',
  'android-tablet': 'play-tablet-10',
};

/** Safe areas (CSS px) the status bar and home indicator take; exposed as --safe-top / --safe-bottom. */
const SAFE_AREA: Record<ScreenFamily, { top: number; bottom: number; statusBar: 'ios' | 'ipados' | 'android' | 'none' }> = {
  iphone: { top: 62, bottom: 34, statusBar: 'ios' },
  duo: { top: 62, bottom: 34, statusBar: 'ios' },
  ipad: { top: 24, bottom: 20, statusBar: 'ipados' },
  mac: { top: 0, bottom: 0, statusBar: 'none' },
  watch: { top: 0, bottom: 0, statusBar: 'none' },
  tv: { top: 0, bottom: 0, statusBar: 'none' },
  vision: { top: 0, bottom: 0, statusBar: 'none' },
  'android-phone': { top: 24, bottom: 0, statusBar: 'android' },
  'android-tablet': { top: 24, bottom: 0, statusBar: 'android' },
};

export function screenViewport(family: ScreenFamily): RenderTarget['logical'] & { width: number; height: number } {
  const t = loadTargets().find((x) => x.id === SCREEN_TARGET[family]);
  if (!t) throw new Error(`No screen size for ${family}`);
  return t.logical;
}

/** `<id>.<family>.html` first, then `<id>.html`. */
export function screenFile(dir: string, id: string, family: ScreenFamily): string | undefined {
  for (const name of [`${id}.${family}.html`, ...(family === 'duo' ? [`${id}.iphone.html`] : []), `${id}.html`]) {
    const f = join(dir, name);
    if (existsSync(f)) return f;
  }
  return undefined;
}

export type Strings = Record<string, Record<string, string>>;

export async function loadStrings(dir: string): Promise<Strings> {
  const out: Strings = {};
  const sdir = join(dir, 'strings');
  if (!existsSync(sdir)) return out;
  for (const f of await readdir(sdir)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(join(sdir, f), 'utf8')) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${join(sdir, f)}: expected an object of "key": "text".`);
    out[f.slice(0, -5)] = Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Fills `{{key}}` from the locale's strings (then its base language, then the fallback locale). Returns the keys
 * that had no text anywhere and the ones that used the fallback (shown in another language).
 */
export function fillStrings(html: string, strings: Strings, locale: string, fallback: string): { html: string; missing: string[]; fellBack: string[] } {
  const base = locale.split('-')[0]!;
  const chain = [strings[locale], ...Object.entries(strings).filter(([l]) => l !== locale && l.split('-')[0] === base).map(([, s]) => s)];
  const missing = new Set<string>();
  const fellBack = new Set<string>();
  const out = html.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => {
    for (const s of chain) if (s && key in s) return escapeHtml(s[key]!);
    if (strings[fallback] && key in strings[fallback]) {
      fellBack.add(key);
      return escapeHtml(strings[fallback][key]!);
    }
    missing.add(key);
    return '';
  });
  return { html: out, missing: [...missing], fellBack: [...fellBack] };
}

const IOS_ICONS = `<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.6c2.2 0 4.2.9 5.7 2.3l1.1-1.1A9.6 9.6 0 0 0 8 1 9.6 9.6 0 0 0 1.2 3.8l1.1 1.1A8 8 0 0 1 8 2.6Zm0 3.3c1.3 0 2.5.5 3.4 1.3l1.1-1.1A6.4 6.4 0 0 0 8 4.3a6.4 6.4 0 0 0-4.5 1.8l1.1 1.1c.9-.8 2.1-1.3 3.4-1.3ZM8 9.2c.5 0 .9.2 1.2.5L8 11 6.8 9.7c.3-.3.7-.5 1.2-.5Z"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2"/><rect x="25" y="4.5" width="1.5" height="4" rx=".75" opacity=".4"/></svg>`;

/** The 9:41, full-battery status bar Vitrin draws over the screen (HTML: `<html data-status-bar="light|dark|none">`). */
export function statusBarHtml(family: ScreenFamily): string {
  const kind = SAFE_AREA[family].statusBar;
  if (kind === 'none') return '';
  const h = SAFE_AREA[family].top;
  if (kind === 'android') {
    return `<div id="vitrin-status-bar" style="position:fixed;left:0;right:0;top:0;height:${h}px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font:500 13px Roboto,system-ui,sans-serif;z-index:2147483647;pointer-events:none"><span>9:41</span><span style="display:flex;gap:6px;align-items:center;transform:scale(.8);transform-origin:right center">${IOS_ICONS}</span></div>`;
  }
  const time = kind === 'ios' ? `font:600 17px -apple-system,'SF Pro Text',system-ui,sans-serif;width:33%;text-align:center` : `font:600 13px -apple-system,'SF Pro Text',system-ui,sans-serif`;
  const pad = kind === 'ios' ? '0 26px 0 6px' : '0 20px';
  return `<div id="vitrin-status-bar" style="position:fixed;left:0;right:0;top:0;height:${kind === 'ios' ? 54 : h}px;display:flex;align-items:center;justify-content:space-between;padding:${pad};z-index:2147483647;pointer-events:none"><span style="${time}">9:41</span><span style="display:flex;gap:6px;align-items:center;fill:currentColor">${IOS_ICONS}</span></div>`;
}

/** The page Vitrin renders: Claude's HTML with the base URL, language, family, safe areas and status bar. */
export function wrapScreen(html: string, opts: { dir: string; family: ScreenFamily; locale: string }): string {
  const safe = SAFE_AREA[opts.family];
  const textDir = localeInfo(opts.locale)?.dir ?? 'ltr';
  const head = `<base href="${pathToFileURL(opts.dir + '/').href}"><script>(()=>{const d=document.documentElement;d.lang=${JSON.stringify(opts.locale)};if(!d.hasAttribute('dir'))d.dir=${JSON.stringify(textDir)};d.dataset.family=${JSON.stringify(opts.family)};})()</script><style>:root{--safe-top:${safe.top}px;--safe-bottom:${safe.bottom}px}html,body{margin:0;width:100%;height:100%;overflow:hidden}*{-webkit-font-smoothing:antialiased}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`;
}

export interface HtmlScreenJob {
  locale: string;
  family: ScreenFamily;
  id: string;
}

/** Renders every screen × locale × family to its raw PNG. Throws with the list when HTML or strings are missing. */
export async function renderHtmlScreens(ctx: Ctx, jobs: HtmlScreenJob[], fallbackLocale: string): Promise<{ outputs: string[]; missingFiles: string[]; missingStrings: string[] }> {
  const dir = ctx.paths.screens;
  const strings = await loadStrings(dir);
  const missingFiles = [...new Set(jobs.filter((j) => !screenFile(dir, j.id, j.family)).map((j) => `.vitrin/screens/${j.id}.html`))];
  const missingStrings: string[] = [];
  const outputs: string[] = [];
  if (missingFiles.length) return { outputs, missingFiles, missingStrings };
  const browser = await launchChromium();
  try {
    const byFamily = new Map<ScreenFamily, HtmlScreenJob[]>();
    for (const j of jobs) byFamily.set(j.family, [...(byFamily.get(j.family) ?? []), j]);
    for (const [family, list] of byFamily) {
      const vp = screenViewport(family);
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.scale });
      const page = await context.newPage();
      for (const j of list) {
        const file = screenFile(dir, j.id, family)!;
        const filled = fillStrings(await readFile(file, 'utf8'), strings, j.locale, fallbackLocale);
        for (const k of filled.missing) missingStrings.push(`${j.locale}: ${k} (${j.id})`);
        if (filled.fellBack.length) log.warn(`  ${j.locale}/${j.id}: no ${j.locale} text for ${filled.fellBack.join(', ')}; used ${fallbackLocale}.`);
        await page.setContent(wrapScreen(filled.html, { dir: dirname(file), family, locale: j.locale }), { waitUntil: 'load' });
        await page.evaluate(async (bar: string) => {
          const d = document.documentElement;
          const mode = d.getAttribute('data-status-bar');
          if (bar && mode !== 'none') {
            document.body.insertAdjacentHTML('beforeend', bar);
            const el = document.getElementById('vitrin-status-bar')!;
            el.style.color = mode === 'light' ? '#fff' : mode === 'dark' ? '#000' : getComputedStyle(document.body).color;
          }
          await document.fonts.ready;
          await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((res) => (img.onload = img.onerror = res)))));
        }, statusBarHtml(family));
        const out = ctx.paths.rawShot(j.locale, family, j.id);
        await ensureDir(dirname(out));
        await page.screenshot({ path: out, type: 'png' });
        outputs.push(out);
        log.dim(`  ${j.locale}/${family}/${j.id}.png (HTML)`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { outputs, missingFiles, missingStrings };
}
