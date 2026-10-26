import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { launchChromium } from '@vitrin/render';
import { beforeAll, describe, expect, it } from 'vitest';
import { fillStrings, screenFile, wrapScreen } from '../src/html-screens.js';

const BIN = resolve(import.meta.dirname, '..', 'dist', 'bin.js');
const run = promisify(execFile);

let browserOk = false;
beforeAll(async () => {
  // Use a preinstalled Chromium when the pinned Playwright browser is missing (CI images).
  if (!process.env.VITRIN_CHROMIUM && existsSync('/opt/pw-browsers/chromium')) {
    try {
      await (await launchChromium()).close();
    } catch {
      process.env.VITRIN_CHROMIUM = '/opt/pw-browsers/chromium';
    }
  }
  browserOk = await launchChromium().then((b) => b.close().then(() => true), () => false);
}, 60_000);

async function vitrin(cwd: string, ...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const r = await run('node', [BIN, ...args], { cwd, env: process.env });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

const write = (file: string, value: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
};

describe('HTML screens (capture.mode: html)', () => {
  it('fills placeholders per locale with base-language and fallback chains, escaping the text', () => {
    const strings = { 'en-US': { title: 'Today', streak: '12 <days>' }, tr: { title: 'Bugün' }, 'pt-BR': { title: 'Hoje' } };
    expect(fillStrings('<h1>{{title}}</h1><p>{{ streak }}</p>', strings, 'tr', 'en-US')).toEqual({ html: '<h1>Bugün</h1><p>12 &lt;days&gt;</p>', missing: [], fellBack: ['streak'] });
    expect(fillStrings('{{title}}', strings, 'pt-PT', 'en-US').html).toBe('Hoje');
    expect(fillStrings('{{nope}}', strings, 'en-US', 'en-US')).toMatchObject({ html: '', missing: ['nope'] });
  });

  it('prefers a family layout and injects language, direction and safe areas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vitrin-screens-'));
    write(join(dir, 'home.html'), 'x');
    write(join(dir, 'home.ipad.html'), 'x');
    expect(screenFile(dir, 'home', 'ipad')).toBe(join(dir, 'home.ipad.html'));
    expect(screenFile(dir, 'home', 'watch')).toBe(join(dir, 'home.html'));
    expect(screenFile(dir, 'stats', 'iphone')).toBeUndefined();
    const page = wrapScreen('<html><head><title>t</title></head><body></body></html>', { dir, family: 'iphone', locale: 'ar-SA' });
    expect(page).toContain('--safe-top:62px');
    expect(page).toContain('d.dir="rtl"');
    expect(page).toContain(`<base href="file://${dir}/">`);
  });

  it('renders the screens per locale at the device screen size, without a build', async (ctx) => {
    if (!browserOk) ctx.skip();
    const root = mkdtempSync(join(tmpdir(), 'vitrin-html-'));
    write(join(root, 'vitrin.config.yaml'), 'app:\n  bundleId: com.example.a\n  primaryLocale: en-US\n  locales: [en-US, tr]\nurls: {}\ncapture:\n  mode: html\n  screens:\n    - id: home\n      source: [App/HomeView.swift]\nselection:\n  assets: [screenshots]\n');
    write(join(root, 'metadata', 'app_profile.json'), JSON.stringify({ generatedAt: 'x', project: { root: '.', targets: [] }, app: { displayName: 'A', platforms: ['ios'], supportsIPhone: true, supportsIPad: true }, features: [], brand: {}, docs: {} }));
    // Without the HTML: exit 2 with the screens brief.
    let res = await vitrin(root, 'capture');
    expect(res.code).toBe(2);
    expect(res.out).toContain('metadata/screens/home.html');
    expect(readFileSync(join(root, 'metadata', 'briefs', 'screens.md'), 'utf8')).toContain('App/HomeView.swift');

    write(join(root, 'metadata', 'screens', 'home.html'), '<!doctype html><html><head><meta charset="utf-8"><style>body{background:#123;color:#fff;font:20px sans-serif}h1{margin:0;padding-top:var(--safe-top)}</style></head><body><h1>{{title}}</h1></body></html>');
    write(join(root, 'metadata', 'screens', 'strings', 'en-US.json'), JSON.stringify({ title: 'Today' }));
    write(join(root, 'metadata', 'screens', 'strings', 'tr.json'), JSON.stringify({ title: 'Bugün' }));
    res = await vitrin(root, 'capture');
    expect(res.code, res.out).toBe(0);
    for (const [family, w, h] of [['iphone', 1320, 2868], ['ipad', 2064, 2752]] as const) {
      for (const locale of ['en-US', 'tr']) {
        const file = join(root, 'metadata', 'raw', locale, family, 'home.png');
        expect(existsSync(file), file).toBe(true);
        const meta = await sharp(file).metadata();
        expect([meta.width, meta.height]).toEqual([w, h]);
      }
    }
    // The native UI kit is installed next to the screens and loads through the relative link.
    expect(existsSync(join(root, 'metadata', 'screens', 'kit', 'ios.css'))).toBe(true);
    expect(existsSync(join(root, 'metadata', 'screens', 'kit', 'material.css'))).toBe(true);
    write(join(root, 'metadata', 'screens', 'home.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="kit/ios.css"></head><body><div class="screen"><h1 class="large-title">{{title}}</h1></div><div class="toggle on" style="position:absolute;left:100px;top:500px;transform:scale(4);transform-origin:0 0"></div></body></html>');
    res = await vitrin(root, 'capture', '--force', '--locale', 'en-US', '--family', 'iphone');
    expect(res.code, res.out).toBe(0);
    const { data, info } = await sharp(join(root, 'metadata', 'raw', 'en-US', 'iphone', 'home.png')).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    expect(at(1320 / 2, 2868 - 40)).toEqual([0xf2, 0xf2, 0xf7]); // --bg of ios.css
    expect(at((100 + 8) * 3, (500 + 60) * 3)).toEqual([0x34, 0xc7, 0x59]); // .toggle.on green
    // Nothing was built and nothing appeared outside metadata/.
    expect(existsSync(join(root, 'fastlane'))).toBe(false);
    expect(existsSync(join(root, '.env.example'))).toBe(false);
  }, 120_000);
});
