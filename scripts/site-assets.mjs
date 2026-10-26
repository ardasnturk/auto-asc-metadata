#!/usr/bin/env node
// Builds the web-sized images and videos for the landing page (site/assets).
//
//   node scripts/site-assets.mjs --samples <dir> [--review <dir>] [--no-video]
//
// --samples   a folder with one sub-folder per style preset, each holding the PNGs `vitrin design` rendered for
//             examples/Ritim (`NN_<slug>_<target>.png`, `header_header.png`, `play-feature-graphic_feature-graphic.png`),
//             plus `video/` with Remotion stills (`mac-40.png`, `tv-140.png`).
// --review    a folder with screenshots of `vitrin review --serve` (`gallery-desktop.png`, `gallery-reject.png`).
// --no-video  skip the App Preview clips (they come from examples/Ritim: `vitrin -C examples/Ritim video --styles all`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/render/package.json'));
const sharp = require('sharp');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const samples = opt('--samples');
const review = opt('--review');
if (!samples) throw new Error('Pass --samples <dir> (one folder per style preset with the rendered PNGs, plus video/).');

const ex = join(root, 'examples/Ritim');
const out = join(root, 'site/assets');
mkdirSync(out, { recursive: true });

const need = (f) => {
  if (!existsSync(f)) throw new Error(`Missing ${f}`);
  return f;
};

async function webp(src, dest, width, quality = 80, extract) {
  let img = sharp(need(src));
  if (extract) img = img.extract(extract);
  await img.resize({ width, withoutEnlargement: true }).webp({ quality, effort: 6 }).toFile(join(out, dest));
}

// The style switcher: three of the twelve presets, six iPhone shots each, plus iPad, Play phone and feature graphic.
const styles = { glass: 'liquid-glass-aurora', midnight: 'midnight-glow-pro', candy: 'candy-pop-social' };
const slugs = ['today', 'streaks', 'charts', 'reminders', 'custom', 'more'];
for (const [key, style] of Object.entries(styles)) {
  const dir = join(samples, style);
  for (const [i, slug] of slugs.entries()) {
    const n = String(i + 1).padStart(2, '0');
    await webp(join(dir, `${n}_${slug}_iphone-6.9.png`), `${key}-shot-${n}.webp`, 500, 78);
  }
  await webp(join(dir, '01_today_ipad-13.png'), `${key}-ipad.webp`, 640, 78);
  await webp(join(dir, '01_today_play-phone.png'), `${key}-play.webp`, 420, 78);
  await webp(join(dir, 'play-feature-graphic_feature-graphic.png'), `${key}-feature.webp`, 720, 80);
}

// The platforms showcase, all in one preset.
const mid = join(samples, styles.midnight);
await webp(join(mid, '01_today_mac-16x10.png'), 'plat-mac.webp', 960, 78);
await webp(join(mid, '01_today_appletv-4k.png'), 'plat-tv.webp', 960, 78);
await webp(join(mid, '01_today_vision-pro.png'), 'plat-vision.webp', 960, 78);
await webp(join(mid, '01_today_watch-ultra.png'), 'plat-watch.webp', 320, 82);
await webp(join(mid, '01_today_duo-outer.png'), 'plat-duo.webp', 440, 78);
await webp(join(mid, 'header_header.png'), 'header.webp', 1600, 78);

// Landscape App Preview stills (Remotion, 1920×1080).
await webp(join(samples, 'video/mac-40.png'), 'preview-mac.webp', 900, 80);
await webp(join(samples, 'video/tv-140.png'), 'preview-tv.webp', 900, 80);

// The review gallery: the "What will be uploaded" summary with the approve bar, and a screenshot marked for changes.
if (review) {
  await webp(join(review, 'gallery-desktop.png'), 'review-summary.webp', 1100, 82, { left: 0, top: 0, width: 1360, height: 1000 });
  await webp(join(review, 'gallery-reject.png'), 'review-reject.webp', 560, 82, { left: 30, top: 18, width: 562, height: 562 });
}

if (!args.includes('--no-video')) {
  const ffmpeg = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { stdio: 'inherit' });
  const missing = (f) => {
    if (!existsSync(f)) throw new Error(`Missing ${f} — render the example first (vitrin -C examples/Ritim video --styles all --locale en-US), or pass --no-video.`);
    return f;
  };
  // Full App Preview (showcase), web-sized.
  const preview = missing(join(ex, 'fastlane/app-previews/en-US/01_IPHONE_67.mp4'));
  ffmpeg(['-i', preview, '-vf', 'scale=432:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(out, 'preview.mp4')]);
  ffmpeg(['-ss', '5', '-i', preview, '-frames:v', '1', '-vf', 'scale=432:-2', join(out, 'preview.jpg')]);
  // Short silent loops of each style for the style picker.
  for (const style of ['classic', 'showcase', 'kinetic', 'energetic']) {
    const src = missing(join(ex, `metadata/video-styles/en-US/01_${style}.mp4`));
    ffmpeg(['-ss', '2', '-t', '7', '-i', src, '-vf', 'scale=300:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(out, `style-${style}.mp4`)]);
    ffmpeg(['-ss', '3.5', '-i', src, '-frames:v', '1', '-vf', 'scale=300:-2', join(out, `style-${style}.jpg`)]);
  }
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
.copy{position:absolute;left:72px;top:92px;width:560px}
.brand{display:flex;align-items:center;gap:14px;font:700 30px J}
h1{font:800 56px/1.05 J;letter-spacing:-.02em;margin:34px 0 20px}
h1 span{background:linear-gradient(90deg,#ff8a6b,#ffb38f);-webkit-background-clip:text;color:transparent}
p{font-size:22px;color:#b9b5e0;margin:0}
img.s{position:absolute;width:230px;border-radius:26px;box-shadow:0 30px 70px rgba(0,0,0,.55)}
</style></head><body><div class="bg"></div>
<img class="s" src="${url('glass-shot-02.webp')}" style="left:690px;top:120px;rotate:-8deg">
<img class="s" src="${url('midnight-shot-01.webp')}" style="left:820px;top:60px;z-index:2">
<img class="s" src="${url('candy-shot-04.webp')}" style="left:955px;top:120px;rotate:8deg">
<div class="copy"><div class="brand"><img src="${url('logo.svg')}" width="48" height="48">Vitrin</div>
<h1>Your store listing, <span>built from your code.</span></h1>
<p>Metadata, screenshots and App Previews for the App Store and Google Play — reviewed by you, then uploaded. Open source.</p></div>
</body></html>`;
const browser = await chromium.launch(process.env.VITRIN_CHROMIUM ? { executablePath: process.env.VITRIN_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const tmp = join(out, '.og.html');
writeFileSync(tmp, card);
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(out, 'og.png') });
await browser.close();
rmSync(tmp);

console.log(`✓ Site assets written to ${out}`);
