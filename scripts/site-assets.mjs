#!/usr/bin/env node
// Builds the web-sized images and videos for the landing page (site/assets) from the
// examples/Ritim outputs. Run after `vitrin design` / `vitrin video` in examples/Ritim:
//   node scripts/site-assets.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/render/package.json'));
const sharp = require('sharp');

const ex = join(root, 'examples/Ritim');
const shots = join(ex, 'fastlane/screenshots/en-US');
const out = join(root, 'site/assets');
mkdirSync(out, { recursive: true });

const need = (f) => {
  if (!existsSync(f)) throw new Error(`Missing ${f} — render the example first (vitrin -C examples/Ritim design && vitrin -C examples/Ritim video --styles all --locale en-US).`);
  return f;
};

async function webp(src, dest, width, quality = 82) {
  await sharp(need(src)).resize({ width }).webp({ quality }).toFile(join(out, dest));
}

for (const [i, slug] of ['today', 'streaks', 'charts', 'reminders', 'custom', 'everywhere'].entries()) {
  const n = String(i + 1).padStart(2, '0');
  await webp(join(shots, `${n}_${slug}_iphone-6.9.png`), `shot-${n}.webp`, 600);
}
await webp(join(shots, '01_today_ipad-13.png'), 'ipad-01.webp', 900);
await webp(join(shots, '02_streaks_ipad-13.png'), 'ipad-02.webp', 900);
await webp(join(shots, '01_today_duo-outer.png'), 'duo-01.webp', 520);
await webp(join(ex, '.vitrin/creative/en-US/header_header.png'), 'header.webp', 1600);
await webp(join(ex, '.vitrin/creative/en-US/search_search.png'), 'search.webp', 1100);

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

// Full App Preview (showcase), web-sized.
const preview = need(join(ex, 'fastlane/app-previews/en-US/01_IPHONE_67.mp4'));
ffmpeg(['-i', preview, '-vf', 'scale=432:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(out, 'preview.mp4')]);
ffmpeg(['-ss', '5', '-i', preview, '-frames:v', '1', '-vf', 'scale=432:-2', join(out, 'preview.jpg')]);

// Short silent loops of each style for the style picker.
for (const style of ['classic', 'showcase', 'kinetic', 'energetic']) {
  const src = need(join(ex, `.vitrin/video-styles/en-US/01_${style}.mp4`));
  ffmpeg(['-ss', '2', '-t', '7', '-i', src, '-vf', 'scale=300:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(out, `style-${style}.mp4`)]);
  ffmpeg(['-ss', '3.5', '-i', src, '-frames:v', '1', '-vf', 'scale=300:-2', join(out, `style-${style}.jpg`)]);
}

// Home-screen icon from the logo.
await sharp(join(out, 'logo.svg'), { density: 300 }).resize(180, 180).flatten({ background: '#0b0a1f' }).png().toFile(join(out, 'apple-touch-icon.png'));

// Social preview card (1200×630), rendered from HTML with the page's own fonts and screenshots.
const { chromium } = require('playwright');
const url = (f) => pathToFileURL(join(out, f)).href;
const card = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:J;src:url('${url('fonts/plus-jakarta-sans-latin-wght-normal.woff2')}');font-weight:200 800}
@font-face{font-family:I;src:url('${url('fonts/inter-latin-wght-normal.woff2')}');font-weight:100 900}
body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0b0a1f;color:#f4f3ff;font-family:I;position:relative}
.bg{position:absolute;inset:-20%;filter:blur(40px);background:radial-gradient(35% 45% at 75% 35%,rgba(123,108,255,.55),transparent 70%),radial-gradient(30% 40% at 90% 85%,rgba(226,85,122,.45),transparent 70%),radial-gradient(30% 35% at 10% 10%,rgba(58,44,156,.7),transparent 70%)}
.copy{position:absolute;left:72px;top:96px;width:560px}
.brand{display:flex;align-items:center;gap:14px;font:700 30px J}
h1{font:800 58px/1.05 J;letter-spacing:-.02em;margin:34px 0 20px}
h1 span{background:linear-gradient(90deg,#ff8a6b,#ffb38f);-webkit-background-clip:text;color:transparent}
p{font-size:22px;color:#b9b5e0;margin:0}
img.s{position:absolute;width:230px;border-radius:26px;box-shadow:0 30px 70px rgba(0,0,0,.55)}
</style></head><body><div class="bg"></div>
<img class="s" src="${url('shot-04.webp')}" style="left:690px;top:120px;rotate:-8deg">
<img class="s" src="${url('shot-01.webp')}" style="left:820px;top:60px;z-index:2">
<img class="s" src="${url('shot-02.webp')}" style="left:955px;top:120px;rotate:8deg">
<div class="copy"><div class="brand"><img src="${url('logo.svg')}" width="48" height="48">Vitrin</div>
<h1>Your App Store listing, <span>built from your code.</span></h1>
<p>Metadata, screenshots and animated App Previews — generated, validated and uploaded. Open source.</p></div>
</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const tmp = join(out, '.og.html');
writeFileSync(tmp, card);
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(out, 'og.png') });
await browser.close();
rmSync(tmp);

console.log(`✓ Site assets written to ${out}`);
