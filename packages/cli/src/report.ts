import { enabledTargets, existsSync, localeInfo, readJsonIfExists, splitKeywords, writeText } from '@vitrin/core';
import { esc } from '@vitrin/render';
import { AppMetadata, AppProfile, Competitors, RenderManifest, ValidationReport, type LocaleMetadata } from '@vitrin/schemas';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Ctx } from './context.js';
import { loadLocaleMetadata } from './commands/pipeline.js';

/** `.vitrin/report.html` — search-result and product-page previews, contact sheets, counters, competitor row, issues. */
export async function buildReport(ctx: Ctx): Promise<string> {
  const p = ctx.paths;
  const profile = await readJsonIfExists(p.profile, AppProfile).catch(() => undefined);
  const competitors = await readJsonIfExists(p.competitors, Competitors).catch(() => undefined);
  const app = await readJsonIfExists(p.appMetadata, AppMetadata).catch(() => undefined);
  const manifest = await readJsonIfExists(p.renderManifest, RenderManifest).catch(() => undefined);
  const validation = await readJsonIfExists(p.validation, ValidationReport).catch(() => undefined);
  const metadata = await loadLocaleMetadata(ctx).catch(() => [] as LocaleMetadata[]);
  const rel = (f: string) => relative(p.vitrin, f).split('/').map(encodeURIComponent).join('/');
  const icon = profile?.brand.appIcon ? rel(join(ctx.root, profile.brand.appIcon)) : '';
  const targets = enabledTargets(ctx.config, profile);
  const rating = competitors?.self;

  const localeSections: string[] = [];
  for (const locale of ctx.config.app.locales) {
    const m = metadata.find((x) => x.locale === locale);
    const shots = existsSync(join(p.screenshots, locale)) ? (await readdir(join(p.screenshots, locale))).filter((f) => f.endsWith('.png')).sort() : [];
    const byTarget = (id: string) => shots.filter((s) => s.endsWith(`_${id}.png`)).map((s) => rel(join(p.screenshots, locale, s)));
    const iphone = byTarget('iphone-6.9').length ? byTarget('iphone-6.9') : byTarget('iphone-6.3');
    const previews = existsSync(join(p.appPreviews, locale)) ? (await readdir(join(p.appPreviews, locale))).filter((f) => f.endsWith('.mp4')).map((f) => rel(join(p.appPreviews, locale, f))) : [];
    const meas = validation?.measurements[locale] ?? {};
    const dir = localeInfo(locale)?.dir ?? 'ltr';
    const counters = Object.entries(meas)
      .map(([field, v]) => {
        const used = v.unit === 'bytes' ? v.bytes : v.chars;
        const pct = Math.min(100, Math.round((used / v.limit) * 100));
        const cls = used > v.limit ? 'bad' : pct > 90 ? 'warn' : 'ok';
        return `<tr><td>${field}</td><td class="num">${used} / ${v.limit} ${v.unit === 'bytes' ? 'bytes' : 'chars'}</td><td><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div></td></tr>`;
      })
      .join('');
    const descLines = (m?.description ?? '').split('\n').filter(Boolean);
    localeSections.push(`
<section class="locale" dir="${dir}">
  <h2>${esc(localeInfo(locale)?.name ?? locale)} <small>${locale}</small></h2>
  <div class="grid2">
    <div>
      <h3>Search result</h3>
      <div class="search-row">
        <div class="sr-head">${icon ? `<img class="icon" src="${icon}">` : '<div class="icon ph"></div>'}
          <div><b>${esc(m?.name ?? '—')}</b><div class="muted">${esc(m?.subtitle ?? '')}</div>
          <div class="muted small">${rating?.averageUserRating ? `★ ${rating.averageUserRating.toFixed(1)} · ${rating.userRatingCount}` : '★ —'}</div></div>
          <span class="get">GET</span></div>
        <div class="sr-shots">${(previews.length ? [] : iphone.slice(0, 3)).map((s) => `<img src="${s}">`).join('')}${previews.slice(0, 1).map((v) => `<video src="${v}" muted autoplay loop playsinline></video>`).join('')}${previews.length ? iphone.slice(0, 2).map((s) => `<img src="${s}">`).join('') : ''}</div>
      </div>
      <h3>Counters</h3>
      <table class="counters">${counters || '<tr><td>validate has not run</td></tr>'}</table>
      <h3>Keywords</h3>
      <div class="chips">${splitKeywords(m?.keywords ?? '').map((k) => `<span>${esc(k)}</span>`).join('')}</div>
    </div>
    <div>
      <h3>Product page</h3>
      <div class="pp">
        <div class="pp-head">${icon ? `<img class="icon big" src="${icon}">` : ''}<div><h4>${esc(m?.name ?? '')}</h4><div class="muted">${esc(m?.subtitle ?? '')}</div></div></div>
        <div class="pp-shots">${previews.map((v) => `<video src="${v}" controls muted playsinline></video>`).join('')}${iphone.map((s) => `<img src="${s}">`).join('')}</div>
        ${m?.promotionalText ? `<p class="promo">${esc(m.promotionalText)}</p>` : ''}
        <p class="desc">${descLines.slice(0, 3).map(esc).join('<br>')}<span class="more"> … more</span></p>
        ${m?.whatsNew ? `<h5>What’s New</h5><p class="small">${esc(m.whatsNew).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
    </div>
  </div>
  <h3>Contact sheet</h3>
  ${targets
    .filter((t) => t.kind === 'screenshot')
    .map((t) => {
      const list = byTarget(t.id);
      return `<div class="sheet"><div class="sheet-label">${esc(t.label)} · ${t.width}×${t.height} · ${list.length}</div><div class="sheet-row">${list.map((s) => `<a href="${s}"><img src="${s}" loading="lazy"></a>`).join('') || '<em>none</em>'}</div></div>`;
    })
    .join('')}
  ${await creativesBlock(p.creative, locale, rel)}
</section>`);
  }

  const rivals = (competitors?.apps ?? []).slice(0, 8);
  const rivalRows = rivals
    .map((a) => `<div class="rival"><div><b>${esc(a.name)}</b><div class="muted small">${a.storefront.toUpperCase()} · ★ ${a.averageUserRating?.toFixed(1) ?? '–'} (${a.userRatingCount ?? 0})</div><div class="pal">${a.palette.map((c) => `<i style="background:${c}"></i>`).join('')}</div></div><div class="rival-shots">${a.screenshotUrls.slice(0, 3).map((u) => `<img src="${esc(u)}" loading="lazy" referrerpolicy="no-referrer">`).join('')}</div></div>`)
    .join('');
  const firstLocale = ctx.config.app.primaryLocale;
  const own = existsSync(join(p.screenshots, firstLocale)) ? (await readdir(join(p.screenshots, firstLocale))).filter((f) => f.endsWith('_iphone-6.3.png')).sort().slice(0, 3) : [];

  const issues = (validation?.issues ?? [])
    .map((i) => `<tr class="${i.severity}"><td>${i.severity === 'error' ? 'ERROR' : i.severity === 'warning' ? 'WARNING' : 'info'}</td><td><code>${esc(i.code)}</code></td><td>${esc(i.locale ?? '')}</td><td>${esc(i.message)}${i.fix ? `<div class="muted small">→ ${esc(i.fix)}</div>` : ''}</td></tr>`)
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vitrin report — ${esc(profile?.app.displayName ?? '')}</title>
<style>
:root{--bg:#F5F5F7;--card:#FFF;--text:#1D1D1F;--muted:#6E6E73;--line:#E5E5EA;--ok:#34C759;--warn:#FF9F0A;--bad:#FF3B30;--accent:#0A84FF}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1C1C1E;--text:#F5F5F7;--muted:#98989D;--line:#38383A}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:24px 16px}
main{max-width:1280px;margin:0 auto}h1{margin:0 0 4px}h2{margin:40px 0 12px;font-size:24px}h2 small{color:var(--muted);font-weight:500;font-size:15px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 8px}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.pill{padding:6px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line)}.pill.ok{color:var(--ok)}.pill.bad{color:var(--bad)}
section{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:8px 20px 20px;margin:20px 0}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}@media(max-width:820px){.grid2{grid-template-columns:1fr}}
.muted{color:var(--muted)}.small{font-size:13px}.icon{width:56px;height:56px;border-radius:13px;flex:none}.icon.big{width:96px;height:96px;border-radius:22px}.icon.ph{background:var(--line)}
.search-row{border:1px solid var(--line);border-radius:16px;padding:14px}.sr-head{display:flex;gap:12px;align-items:center}.sr-head>div{flex:1;min-width:0}.get{background:var(--line);color:var(--accent);font-weight:700;border-radius:999px;padding:5px 16px}
.sr-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.sr-shots img,.sr-shots video{width:100%;border-radius:10px;aspect-ratio:1206/2622;object-fit:cover;background:var(--line)}
.counters{width:100%;border-collapse:collapse}.counters td{padding:4px 6px;border-bottom:1px solid var(--line)}.num{white-space:nowrap;font-variant-numeric:tabular-nums}.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;min-width:80px}.bar i{display:block;height:100%}.bar .ok{background:var(--ok)}.bar .warn{background:var(--warn)}.bar .bad{background:var(--bad)}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips span{background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:13px}
.pp{border:1px solid var(--line);border-radius:16px;padding:16px}.pp-head{display:flex;gap:14px;align-items:center}.pp-head h4{margin:0;font-size:20px}
.pp-shots{display:flex;gap:10px;overflow-x:auto;margin:14px 0;padding-bottom:6px}.pp-shots img,.pp-shots video{height:340px;border-radius:14px;flex:none}
.promo{font-weight:600}.desc .more{color:var(--accent)}
.sheet{margin:10px 0}.sheet-label{font-size:13px;color:var(--muted);margin-bottom:6px}.sheet-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.sheet-row img{height:220px;border-radius:8px;flex:none;border:1px solid var(--line)}
.rival{display:grid;grid-template-columns:220px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.rival-shots{display:flex;gap:6px;overflow-x:auto}.rival-shots img{height:180px;border-radius:8px}.pal{display:flex;gap:3px;margin-top:6px}.pal i{width:16px;height:16px;border-radius:4px;display:block}
table.issues{width:100%;border-collapse:collapse;font-size:14px}table.issues td{padding:6px;border-bottom:1px solid var(--line);vertical-align:top}tr.error td:first-child{color:var(--bad);font-weight:700}tr.warning td:first-child{color:var(--warn);font-weight:700}
.variants{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.variants figure{margin:0}.variants video{width:100%;border-radius:12px;background:#000}.variants figcaption{text-align:center;font-size:13px;color:var(--muted);margin-top:4px}
.creatives img,.creatives video{max-width:100%;border-radius:12px;border:1px solid var(--line);margin:6px 0}
@media(max-width:600px){.rival{grid-template-columns:1fr}.pp-shots img,.pp-shots video{height:260px}}
</style></head><body><main>
<h1>${esc(profile?.app.displayName ?? 'Vitrin')}</h1>
<div class="muted">${esc(profile?.app.bundleId ?? '')} · ${esc(app?.primaryCategory ?? '')}${app?.secondaryCategory ? ` / ${esc(app.secondaryCategory)}` : ''} · ${esc(app?.copyright ?? '')} · ${new Date().toLocaleString('en-US')}</div>
<div class="summary">
  <span class="pill ${validation?.ok ? 'ok' : 'bad'}">${validation ? (validation.ok ? 'Validation passed' : 'Validation failed') : 'validate has not run'}</span>
  <span class="pill">${validation?.counts.error ?? '–'} errors</span><span class="pill">${validation?.counts.warning ?? '–'} warnings</span>
  <span class="pill">${manifest?.images.length ?? 0} images</span><span class="pill">${manifest?.videos.length ?? 0} videos</span>
  <span class="pill">Art direction: ${esc(manifest?.artDirection ?? '–')}</span>
</div>
${localeSections.join('\n')}
${await styleVariantsBlock(p.vitrin, ctx.config.app.locales, rel)}
<section><h2>Competitor comparison</h2>
<div class="rival"><div><b>${esc(profile?.app.displayName ?? '')}</b><div class="muted small">Our first 3 screenshots (${firstLocale})</div></div><div class="rival-shots">${own.map((f) => `<img src="${rel(join(p.screenshots, firstLocale, f))}">`).join('')}</div></div>
${rivalRows || '<p class="muted">research has not run</p>'}
</section>
<section><h2>Validation</h2><table class="issues">${issues || '<tr><td>No issues.</td></tr>'}</table></section>
</main></body></html>`;
  await writeText(p.report, html);
  return p.report;
}

/** Comparison renders from `vitrin video --styles` (not uploaded). */
async function styleVariantsBlock(vitrinDir: string, locales: string[], rel: (f: string) => string): Promise<string> {
  const rows: string[] = [];
  for (const locale of locales) {
    const d = join(vitrinDir, 'video-styles', locale);
    if (!existsSync(d)) continue;
    const files = (await readdir(d)).filter((f) => f.endsWith('.mp4')).sort();
    if (!files.length) continue;
    rows.push(`<h3>${esc(locale)}</h3><div class="variants">${files
      .map((f) => `<figure><video src="${rel(join(d, f))}" muted controls playsinline preload="metadata"></video><figcaption>${esc(f.replace(/^\d{2}_|\.mp4$/g, ''))}</figcaption></figure>`)
      .join('')}</div>`);
  }
  if (!rows.length) return '';
  return `<section><h2>Video styles <small>vitrin video --styles · not uploaded</small></h2>${rows.join('')}</section>`;
}

async function creativesBlock(dir: string, locale: string, rel: (f: string) => string): Promise<string> {
  const d = join(dir, locale);
  if (!existsSync(d)) return '';
  const files = (await readdir(d)).filter((f) => /\.(png|mp4)$/.test(f) && !f.includes('.remotion.')).sort();
  if (!files.length) return '';
  return `<h3>Creatives</h3><div class="creatives">${files
    .map((f) => (f.endsWith('.mp4') ? `<div class="small muted">${esc(f)}</div><video src="${rel(join(d, f))}" muted autoplay loop playsinline></video>` : `<div class="small muted">${esc(f)}</div><img src="${rel(join(d, f))}">`))
    .join('')}</div>`;
}
