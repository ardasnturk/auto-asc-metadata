import { byteLength, existsSync, graphemeLength, localeInfo, readJsonIfExists, splitKeywords, writeText } from '@vitrin/core';
import { esc } from '@vitrin/render';
import {
  AppMetadata,
  AppProfile,
  Competitors,
  EVENT_LIMITS,
  PlatformEnum,
  RenderManifest,
  TEXT_LIMITS,
  ValidationReport,
  type CustomProductPage,
  type InAppEventSpec,
  type Issue,
  type LocaleMetadata,
  uploaderOf,
} from '@vitrin/schemas';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { z } from 'zod';
import { buildInventory, checkApproval, summarize, syncFastlaneMetadata, writeSnapshot, type Inventory, type InventoryItem } from './approval.js';
import type { Ctx } from './context.js';
import { loadLocaleMetadata } from './commands/pipeline.js';
import { fill, loadUiText, UI_EN, type UiText } from './i18n.js';

/** Gallery words for this render (ui.language); set at the start of buildReport. */
let T: UiText = UI_EN;

type EventSpec = z.infer<typeof InAppEventSpec>;

/** Known text fields: exported file key → label, limit and the field name validate uses in issues. */
interface FieldSpec {
  label: string;
  max?: number;
  unit?: 'chars' | 'bytes';
  issueField?: string;
}
const ASC_FIELDS: Record<string, FieldSpec> = {
  name: { label: 'Name', max: TEXT_LIMITS.name.max, unit: 'chars', issueField: 'name' },
  subtitle: { label: 'Subtitle', max: TEXT_LIMITS.subtitle.max, unit: 'chars', issueField: 'subtitle' },
  promotional_text: { label: 'Promotional text', max: TEXT_LIMITS.promotionalText.max, unit: 'chars', issueField: 'promotionalText' },
  keywords: { label: 'Keywords', max: TEXT_LIMITS.keywords.max, unit: 'bytes', issueField: 'keywords' },
  description: { label: 'Description', max: TEXT_LIMITS.description.max, unit: 'chars', issueField: 'description' },
  release_notes: { label: 'What’s New', max: TEXT_LIMITS.whatsNew.max, unit: 'chars', issueField: 'whatsNew' },
  support_url: { label: 'Support URL', issueField: 'supportUrl' },
  marketing_url: { label: 'Marketing URL', issueField: 'marketingUrl' },
  privacy_url: { label: 'Privacy URL', issueField: 'privacyUrl' },
  copyright: { label: 'Copyright', issueField: 'copyright' },
  'review_information/notes': { label: 'Review notes', max: TEXT_LIMITS.reviewNotes.max, unit: 'bytes', issueField: 'reviewNotes' },
};
/** Google Play listing limits (Play Console, Oct 2026). */
const PLAY_FIELDS: Record<string, FieldSpec> = {
  title: { label: 'Title', max: 30, unit: 'chars', issueField: 'title' },
  short_description: { label: 'Short description', max: 80, unit: 'chars', issueField: 'shortDescription' },
  full_description: { label: 'Full description', max: 4000, unit: 'chars', issueField: 'fullDescription' },
  video: { label: 'Promo video URL', issueField: 'video' },
};
const PLAY_CHANGELOG: FieldSpec = { label: 'Changelog', max: 500, unit: 'chars', issueField: 'changelog' };
/** In-App Event text limits. */

const STORE_LABEL: Record<string, string> = { 'app-store': 'App Store', 'google-play': 'Google Play' };
const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS / iPadOS', macos: 'macOS', watchos: 'watchOS', tvos: 'tvOS', visionos: 'visionOS', android: 'Android' };
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function fieldSpec(store: string, key: string): FieldSpec | undefined {
  if (store === 'google-play') return key.startsWith('changelogs/') ? { ...PLAY_CHANGELOG, label: `Changelog ${key.slice(11)}` } : PLAY_FIELDS[key];
  return ASC_FIELDS[key];
}

function counter(value: string, spec?: FieldSpec): string {
  const chars = graphemeLength(value);
  const bytes = byteLength(value);
  if (!spec?.max) return `<span class="count muted">${chars} chars</span>`;
  const used = spec.unit === 'bytes' ? bytes : chars;
  const pct = Math.min(100, Math.round((used / spec.max) * 100));
  const cls = used > spec.max ? 'bad' : pct > 90 ? 'warn' : 'ok';
  return `<span class="count ${cls === 'bad' ? 'over' : ''}">${used} / ${spec.max} ${spec.unit === 'bytes' ? 'bytes' : 'chars'}</span><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>`;
}

function inRange(r: { min: [number, number]; max: [number, number] } | undefined, w: number, h: number): boolean {
  return Boolean(r && w >= r.min[0] && w <= r.max[0] && h >= r.min[1] && h <= r.max[1] && Math.abs(w / h - r.min[0] / r.min[1]) < 0.01);
}

function fmtBytes(n?: number): string {
  if (n === undefined) return '';
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function issueList(issues: Issue[]): string {
  if (!issues.length) return '';
  return `<ul class="issues-inline">${issues
    .map((i) => `<li class="${i.severity}"><b>${i.severity === 'error' ? T.error : i.severity === 'warning' ? T.warning : T.info}</b> <code>${esc(i.code)}</code> ${esc(i.message)}${i.fix ? `<div class="muted small">→ ${esc(i.fix)}</div>` : ''}</li>`)
    .join('')}</ul>`;
}

function rejectControl(item: InventoryItem): string {
  return `<div class="decide"><button type="button" class="rej" data-reject="${esc(item.id)}">${esc(T.reject)}</button><textarea class="comment" placeholder="${esc(T.rejectPlaceholder)}" hidden></textarea><code class="item-id" title="Item id">${esc(item.id)}</code></div>`;
}

/** `metadata/report.html` — the complete review gallery: everything that would be uploaded, grouped by store → platform → locale → target. */
export async function buildReport(ctx: Ctx, opts: { inventory?: Inventory; text?: UiText } = {}): Promise<string> {
  T = opts.text ?? (await loadUiText(ctx)).text;
  const p = ctx.paths;
  // Refresh metadata/store/metadata so the text shown is byte-for-byte what deliver will read.
  if (!opts.inventory) await syncFastlaneMetadata(ctx);
  const inv = opts.inventory ?? (await buildInventory(ctx));
  const profile = await readJsonIfExists(p.profile, AppProfile).catch(() => undefined);
  const competitors = await readJsonIfExists(p.competitors, Competitors).catch(() => undefined);
  const app = await readJsonIfExists(p.appMetadata, AppMetadata).catch(() => undefined);
  const manifest = await readJsonIfExists(p.renderManifest, RenderManifest).catch(() => undefined);
  const validation = await readJsonIfExists(p.validation, ValidationReport).catch(() => undefined);
  const metadata = await loadLocaleMetadata(ctx).catch(() => [] as LocaleMetadata[]);
  const approval = await checkApproval(ctx, inv);
  const rel = (f: string) => relative(p.vitrin, f).split('/').map(encodeURIComponent).join('/');
  const icon = profile?.brand.appIcon ? rel(join(ctx.root, profile.brand.appIcon)) : '';
  const rating = competitors?.self;
  const sharp = (await import('sharp')).default;

  // Attach validation issues to the item they concern; the rest go to the general list.
  const issuesFor = new Map<string, Issue[]>();
  const general: Issue[] = [];
  const add = (id: string, i: Issue) => issuesFor.set(id, [...(issuesFor.get(id) ?? []), i]);
  for (const issue of validation?.issues ?? []) {
    const file = issue.file ? relative(ctx.root, resolve(ctx.root, issue.file)).split('\\').join('/') : undefined;
    let target = file ? inv.items.find((i) => i.abs && i.files.includes(file)) : undefined;
    if (!target && issue.locale && (issue.field || (file && file.startsWith('metadata/listing/')))) target = inv.items.find((i) => i.kind === 'metadata' && i.locale === issue.locale);
    if (!target && file === 'metadata/listing/app.json') target = inv.items.find((i) => i.id === 'metadata/app-store/app');
    if (target) add(target.id, issue);
    else general.push(issue);
  }

  const localeOrder = (l?: string) => (l === undefined ? 1e6 : ctx.config.app.locales.indexOf(l) >= 0 ? ctx.config.app.locales.indexOf(l) : 1e5);
  const platformOrder = (x: string) => {
    const n = (PlatformEnum.options as readonly string[]).indexOf(x);
    return n < 0 ? 99 : n;
  };

  // ---------------------------------------------------------------- item renderers
  const thumbOf = async (it: InventoryItem): Promise<string | undefined> => {
    if (!it.abs || !it.locale) return undefined;
    const thumb = join(p.cache, 'thumbs', it.locale, it.abs.split('/').pop()!.replace(/\.(png|jpe?g)$/i, '.jpg'));
    if (!existsSync(thumb)) return undefined;
    // Never show a stale thumbnail as the approved content.
    return (await stat(thumb)).mtimeMs >= (await stat(it.abs)).mtimeMs ? rel(thumb) : undefined;
  };

  const imageCard = async (it: InventoryItem): Promise<string> => {
    let w: number | undefined;
    let h: number | undefined;
    try {
      const meta = await sharp(it.abs!).metadata();
      w = meta.width;
      h = meta.height;
    } catch {
      /* unreadable image: validation reports it */
    }
    const full = rel(it.abs!);
    const thumb = (await thumbOf(it)) ?? full;
    const issues = issuesFor.get(it.id) ?? [];
    const sizeOk = !it.targetInfo || !w || (w === it.targetInfo.width && h === it.targetInfo.height) || it.targetInfo.acceptedSizes.some(([a, b]) => a === w && b === h) || inRange(it.targetInfo.sizeRange, w, h ?? 0);
    return `<figure class="card${issues.some((i) => i.severity === 'error') ? ' has-error' : ''}" data-item="${esc(it.id)}">
  <a class="zoom" href="${full}" data-full="${full}" data-caption="${esc(it.label)}"><img src="${thumb}" loading="lazy" decoding="async" alt="${esc(it.label)}"${w && h ? ` width="${w}" height="${h}"` : ''}></a>
  <figcaption><b>#${it.order ?? '–'}</b> <span class="fname">${esc(it.abs!.split('/').pop()!)}</span><div class="muted small">${w && h ? `<span class="${sizeOk ? '' : 'over'}">${w}×${h}</span>` : '?×?'} · ${fmtBytes(it.bytes)}${sizeOk ? '' : ` · <span class="over">${esc(fill(T.expectedSize, { size: `${it.targetInfo!.width}×${it.targetInfo!.height}` }))}</span>`}</div></figcaption>
  ${issueList(issues)}${rejectControl(it)}
</figure>`;
  };

  const videoCard = (it: InventoryItem): string => {
    const src = rel(it.abs!);
    const issues = issuesFor.get(it.id) ?? [];
    const dur = it.durationSec !== undefined ? `${it.durationSec.toFixed(1)} s` : '<span class="js-duration">– s</span>';
    return `<figure class="card video${issues.some((i) => i.severity === 'error') ? ' has-error' : ''}" data-item="${esc(it.id)}">
  <video src="${src}" controls muted playsinline preload="metadata"></video>
  <figcaption><b>#${it.order ?? '–'}</b> <span class="fname">${esc(it.abs!.split('/').pop()!)}</span><div class="muted small">${dur} · ${fmtBytes(it.bytes)}</div></figcaption>
  ${issueList(issues)}${rejectControl(it)}
</figure>`;
  };

  const mediaCard = (it: InventoryItem) => (/\.(mp4|mov|m4v)$/i.test(it.abs ?? '') ? Promise.resolve(videoCard(it)) : imageCard(it));

  const metadataCard = (it: InventoryItem): string => {
    const issues = issuesFor.get(it.id) ?? [];
    const dir = it.locale ? (localeInfo(it.locale)?.dir ?? 'ltr') : 'ltr';
    const known = Object.keys(it.store === 'google-play' ? PLAY_FIELDS : ASC_FIELDS);
    const rank = (k: string) => (known.indexOf(k) < 0 ? known.length + (k.startsWith('changelogs/') ? 0 : 1) : known.indexOf(k));
    const rows = [...(it.fields ?? [])]
      .sort((a, b) => rank(a.key) - rank(b.key) || natural(a.key, b.key))
      .map((f) => {
        const spec = fieldSpec(it.store, f.key);
        const own = issues.filter((i) => spec?.issueField && i.field === spec.issueField);
        const value =
          f.key === 'keywords'
            ? `<div class="chips">${splitKeywords(f.value).map((k) => `<span>${esc(k)}</span>`).join('')}</div><div class="raw muted small">${esc(f.value)}</div>`
            : `<div class="val">${esc(f.value) || `<em class="muted">${esc(T.emptyClears)}</em>`}</div>`;
        return `<tr><th>${esc(spec?.label ?? f.key)}<div class="muted small mono">${esc(f.file)}</div></th><td dir="${dir}">${value}${issueList(own)}</td><td class="num">${counter(f.value, spec)}</td></tr>`;
      })
      .join('');
    const fieldIssues = new Set(Object.values({ ...ASC_FIELDS, ...PLAY_FIELDS }).map((s) => s.issueField));
    const rest = issues.filter((i) => !i.field || !fieldIssues.has(i.field));
    return `<div class="meta card-wide" data-item="${esc(it.id)}"><div class="scroll"><table class="fields">${rows || `<tr><td class="muted">${esc(T.noTextFiles)}</td></tr>`}</table></div>${issueList(rest)}${rejectControl(it)}</div>`;
  };

  const searchAndProductPage = (locale: string, items: InventoryItem[], meta?: InventoryItem): string => {
    const m = metadata.find((x) => x.locale === locale);
    const val = (k: string, fallback = '') => meta?.fields?.find((f) => f.key === k)?.value ?? fallback;
    const name = val('name', m?.name ?? '—');
    const subtitle = val('subtitle', m?.subtitle ?? '');
    const promo = val('promotional_text', m?.promotionalText ?? '');
    const desc = val('description', m?.description ?? '');
    const whatsNew = val('release_notes', m?.whatsNew ?? '');
    const shots = items.filter((i) => i.kind === 'screenshot');
    const best = ['iphone-6.9', 'iphone-6.3'].map((t) => shots.filter((s) => s.target === t)).find((l) => l.length) ?? shots;
    const iphone = best.map((s) => rel(s.abs!));
    const previews = items.filter((i) => i.kind === 'preview' && i.target !== 'preview-ipad').map((i) => rel(i.abs!));
    const descLines = desc.split('\n').filter(Boolean);
    return `<div class="grid2">
    <div>
      <h4>${esc(T.searchResult)}</h4>
      <div class="search-row">
        <div class="sr-head">${icon ? `<img class="icon" src="${icon}" alt="">` : '<div class="icon ph"></div>'}
          <div><b>${esc(name)}</b><div class="muted">${esc(subtitle)}</div>
          <div class="muted small">${rating?.averageUserRating ? `★ ${rating.averageUserRating.toFixed(1)} · ${rating.userRatingCount}` : '★ —'}</div></div>
          <span class="get">${esc(T.get)}</span></div>
        <div class="sr-shots">${(previews.length ? [] : iphone.slice(0, 3)).map((s) => `<img src="${s}" loading="lazy" alt="">`).join('')}${previews.slice(0, 1).map((v) => `<video src="${v}" muted loop playsinline preload="metadata"></video>`).join('')}${previews.length ? iphone.slice(0, 2).map((s) => `<img src="${s}" loading="lazy" alt="">`).join('') : ''}</div>
      </div>
    </div>
    <div>
      <h4>${esc(T.productPage)}</h4>
      <div class="pp">
        <div class="pp-head">${icon ? `<img class="icon big" src="${icon}" alt="">` : ''}<div><h5>${esc(name)}</h5><div class="muted">${esc(subtitle)}</div></div></div>
        <div class="pp-shots">${previews.map((v) => `<video src="${v}" controls muted playsinline preload="none"></video>`).join('')}${iphone.map((s) => `<img src="${s}" loading="lazy" alt="">`).join('')}</div>
        ${promo ? `<p class="promo">${esc(promo)}</p>` : ''}
        <p class="desc">${descLines.slice(0, 3).map(esc).join('<br>')}<span class="more"> ${esc(T.more)}</span></p>
        ${whatsNew ? `<h6>${esc(T.whatsNew)}</h6><p class="small">${esc(whatsNew).replace(/\n/g, '<br>')}</p>` : ''}
      </div>
    </div>
  </div>`;
  };

  const eventCard = (it: InventoryItem): string => {
    const e = it.data as EventSpec;
    const locales = [...new Set([...Object.keys(e.name), ...Object.keys(e.shortDescription), ...Object.keys(e.longDescription)])].sort((a, b) => localeOrder(a) - localeOrder(b));
    const rows = locales
      .map((l) => {
        const cell = (v: string | undefined, max: number) => `<td dir="${localeInfo(l)?.dir ?? 'ltr'}"><div class="val">${esc(v ?? '')}</div>${counter(v ?? '', { label: '', max, unit: 'chars' })}</td>`;
        return `<tr><th>${esc(l)}</th>${cell(e.name[l], EVENT_LIMITS.name)}${cell(e.shortDescription[l], EVENT_LIMITS.shortDescription)}${cell(e.longDescription[l], EVENT_LIMITS.longDescription)}</tr>`;
      })
      .join('');
    return `<div class="meta card-wide" data-item="${esc(it.id)}"><h4>${esc(it.label)} <span class="pill small">${esc(e.badge)}</span></h4>
  <div class="scroll"><table class="fields ev"><tr><th></th><th>Name</th><th>Short description</th><th>Long description</th></tr>${rows}</table></div>
  <div class="muted small">Card and detail images are listed under each locale (event items). Created as drafts only with <code>vitrin upload --events</code>.</div>${issueList(issuesFor.get(it.id) ?? [])}${rejectControl(it)}</div>`;
  };

  const cppCard = (it: InventoryItem): string => {
    const page = it.data as CustomProductPage;
    const promo = Object.entries(page.promotionalText)
      .sort(([a], [b]) => localeOrder(a) - localeOrder(b))
      .map(([l, v]) => `<tr><th>${esc(l)}</th><td dir="${localeInfo(l)?.dir ?? 'ltr'}"><div class="val">${esc(v)}</div></td><td class="num">${counter(v, { label: '', max: TEXT_LIMITS.promotionalText.max, unit: 'chars' })}</td></tr>`)
      .join('');
    const primary = ctx.config.app.primaryLocale;
    const iphone = (i: InventoryItem) => i.target === 'iphone-6.9' || i.target === 'iphone-6.3';
    // The page's own set (rendered by vitrin design); before that, the default screenshots it is built from.
    const own = inv.items.filter((i) => i.kind === 'cpp' && i.abs && i.locale === primary && iphone(i) && i.id.includes(`/cpp/${page.id}/`));
    const fallback = page.shots
      .map((id) => inv.items.find((i) => i.kind === 'screenshot' && i.locale === primary && i.abs?.split('/').pop()!.startsWith(`${id}_`) && iphone(i)))
      .filter((x): x is InventoryItem => Boolean(x));
    const thumbs = (own.length ? own.sort((a, b) => natural(a.id, b.id)) : fallback).map((i) => `<img src="${rel(i.abs!)}" loading="lazy" alt="">`).join('');
    return `<div class="meta card-wide" data-item="${esc(it.id)}"><h4>${esc(page.name)} <span class="muted small">${esc(page.id)}</span></h4>
  <p><b>Segment:</b> ${esc(page.segment)}<br><span class="muted">${esc(page.rationale)}</span>${page.deepLink ? `<br><b>Deep link:</b> <code>${esc(page.deepLink)}</code>` : ''}</p>
  ${page.keywords.length ? `<div class="chips">${page.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}
  ${promo ? `<table class="fields">${promo}</table>` : ''}
  ${thumbs ? `<div class="sheet-row">${thumbs}</div>` : ''}
  <div class="muted small">${own.length ? `Its own screenshot set (${esc(primary)} shown; every locale is uploaded). ` : page.shots.length ? 'Run <code>vitrin design</code> to render its own set. ' : 'No own screenshots: the page would only change promotional text. '}Created only with <code>vitrin upload --cpp</code>; Apple reviews each page.</div>${issueList(issuesFor.get(it.id) ?? [])}${rejectControl(it)}</div>`;
  };

  // ---------------------------------------------------------------- group store → platform → locale → target
  type Group = { store: string; platform: string; locale?: string; items: InventoryItem[] };
  const groups = new Map<string, Group>();
  for (const it of inv.items) {
    const key = `${it.store}|${it.platform}|${it.locale ?? ''}`;
    const g = groups.get(key) ?? { store: it.store, platform: it.platform, locale: it.locale, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => (a.store === b.store ? 0 : a.store === 'app-store' ? -1 : 1) || platformOrder(a.platform) - platformOrder(b.platform) || localeOrder(a.locale) - localeOrder(b.locale) || natural(a.locale ?? '', b.locale ?? ''),
  );

  const KIND_TITLE: Record<string, string> = { screenshot: T.kindScreenshot, preview: T.kindPreview, creative: T.kindCreative, event: T.kindEvent };
  const sections: string[] = [];
  const toc: string[] = [];
  for (const g of ordered) {
    const anchor = `s-${g.store}-${g.platform}-${g.locale ?? 'all'}`.replace(/[^a-zA-Z0-9-]/g, '_');
    const localeName = g.locale ? `${localeInfo(g.locale)?.name ?? g.locale} <small>${esc(g.locale)}</small>` : esc(T.allLocales);
    toc.push(`<a href="#${anchor}">${esc(STORE_LABEL[g.store] ?? g.store)} · ${esc(PLATFORM_LABEL[g.platform] ?? g.platform)} · ${esc(g.locale ?? 'all')}</a>`);
    const parts: string[] = [];
    const meta = g.items.filter((i) => i.kind === 'metadata');
    if (g.store === 'app-store' && g.locale && g.platform === 'ios' && (meta.length || g.items.some((i) => i.kind === 'screenshot'))) parts.push(searchAndProductPage(g.locale, g.items, meta[0]));
    for (const m of meta) parts.push(`<h3>${esc(T.metadata)}</h3>${metadataCard(m)}`);
    for (const kind of ['screenshot', 'preview', 'creative', 'event'] as const) {
      const media = g.items.filter((i) => i.kind === kind && i.abs);
      if (!media.length) continue;
      const byTarget = new Map<string, InventoryItem[]>();
      for (const i of media) byTarget.set(i.target ?? '(unknown target)', [...(byTarget.get(i.target ?? '(unknown target)') ?? []), i]);
      const blocks: string[] = [];
      for (const [tid, list] of byTarget) {
        list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || natural(a.id, b.id));
        const t = list[0]!.targetInfo;
        const head = `${esc(t?.label ?? tid)}${t ? ` · ${t.width}×${t.height}` : ''} · ${list.length === 1 ? esc(T.file) : esc(fill(T.files, { n: list.length }))}`;
        blocks.push(`<div class="target"><div class="target-label">${head} <code class="muted">${esc(tid)}</code></div><div class="gallery">${(await Promise.all(list.map(mediaCard))).join('')}</div></div>`);
      }
      parts.push(`<h3>${esc(KIND_TITLE[kind]!)} <small class="muted">${esc(T.inUploadOrder)}</small></h3>${blocks.join('')}`);
    }
    for (const it of g.items.filter((i) => i.kind === 'event' && !i.abs)) parts.push(eventCard(it));
    const cpps = g.items.filter((i) => i.kind === 'cpp' && !i.abs);
    if (cpps.length) parts.push(`<h3>${esc(T.cppSuggestions)}</h3>${cpps.map(cppCard).join('')}`);
    sections.push(`<section class="locale" id="${anchor}" dir="ltr"><h2><span class="crumb">${esc(STORE_LABEL[g.store] ?? g.store)} › ${esc(PLATFORM_LABEL[g.platform] ?? g.platform)} ›</span> ${localeName}</h2>${parts.join('\n')}</section>`);
  }

  // ---------------------------------------------------------------- summary: exactly what goes where
  const chosen = uploaderOf(ctx.config);
  const uploader =
    chosen === 'asset-library'
      ? 'deliver (text) + App Asset Library (media)'
      : chosen === 'asc'
        ? 'asc CLI (text and media) + App Asset Library (iPhone Duo)'
        : 'fastlane deliver';
  const dest = (store: string, kind: string) =>
    store === 'google-play'
      ? 'Google Play · fastlane supply'
      : kind === 'creative'
        ? 'App Asset Library · only with --creatives'
        : kind === 'cpp'
          ? 'Custom Product Pages · only with --cpp'
          : kind === 'event'
            ? 'In-App Events (draft) · only with --events'
            : `App Store Connect · ${uploader}`;
  const sumRows: string[] = [];
  for (const g of ordered) {
    const byKind = new Map<string, InventoryItem[]>();
    for (const i of g.items) {
      const k = i.kind === 'event' ? (i.abs ? 'event images' : 'event text') : i.kind;
      byKind.set(k, [...(byKind.get(k) ?? []), i]);
    }
    for (const [kind, list] of byKind) {
      const bytes = list.reduce((n, i) => n + (i.bytes ?? 0), 0);
      const detail = kind === 'metadata' ? `${list.reduce((n, i) => n + (i.fields?.length ?? 0), 0)} fields` : bytes ? fmtBytes(bytes) : '';
      sumRows.push(`<tr><td>${esc(STORE_LABEL[g.store] ?? g.store)}</td><td>${esc(g.platform)}</td><td>${esc(g.locale ?? 'all')}</td><td>${esc(kind)}</td><td class="num">${list.length}</td><td class="num">${detail}</td><td>${esc(dest(g.store, kind.split(' ')[0]!))}</td></tr>`);
    }
  }
  const approvalPill = approval.ok
    ? `<span class="pill ok">${esc(fill(T.approved, { date: approval.approval!.approvedAt }))}</span>`
    : approval.approval?.status === 'changes-requested'
      ? `<span class="pill bad">${esc(fill(T.changesRequested, { n: approval.approval.rejections.length }))}</span>`
      : approval.approval
        ? `<span class="pill bad">${esc(fill(T.approvalOutdated, { n: approval.changed.length + approval.added.length + approval.removed.length }))}</span>`
        : `<span class="pill warn">${esc(T.notApproved)}</span>`;

  // ---------------------------------------------------------------- extras (not uploaded)
  const rivals = (competitors?.apps ?? []).slice(0, 8);
  const rivalRows = rivals
    .map((a) => `<div class="rival"><div><b>${esc(a.name)}</b><div class="muted small">${a.storefront.toUpperCase()} · ★ ${a.averageUserRating?.toFixed(1) ?? '–'} (${a.userRatingCount ?? 0})</div><div class="pal">${a.palette.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</div></div><div class="rival-shots">${a.screenshotUrls.slice(0, 3).map((u) => `<img src="${esc(u)}" loading="lazy" referrerpolicy="no-referrer" alt="">`).join('')}</div></div>`)
    .join('');
  const firstLocale = ctx.config.app.primaryLocale;
  const own = inv.items.filter((i) => i.kind === 'screenshot' && i.locale === firstLocale && i.target === 'iphone-6.3').slice(0, 3);
  const generalIssues = general
    .map((i) => `<tr class="${i.severity}"><td>${i.severity === 'error' ? T.error : i.severity === 'warning' ? T.warning : T.info}</td><td><code>${esc(i.code)}</code></td><td>${esc(i.locale ?? '')}</td><td>${esc(i.message)}${i.fix ? `<div class="muted small">→ ${esc(i.fix)}</div>` : ''}</td></tr>`)
    .join('');
  const summary = summarize(inv);
  const boot = JSON.stringify({ hash: inv.overallHash, items: inv.items.length, t: T }).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="${esc(ctx.config.ui?.language ?? 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>Vitrin ${esc(T.review)} — ${esc(profile?.app.displayName ?? '')}</title>
<style>
:root{--bg:#F5F5F7;--card:#FFF;--text:#1D1D1F;--muted:#6E6E73;--line:#E5E5EA;--ok:#248A3D;--warn:#B25000;--bad:#D70015;--accent:#0A6CFF;--okbar:#34C759;--warnbar:#FF9F0A;--badbar:#FF3B30}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1C1C1E;--text:#F5F5F7;--muted:#98989D;--line:#38383A;--ok:#30D158;--warn:#FFB340;--bad:#FF6961;--accent:#4C9BFF}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:24px 16px 120px}
main{max-width:1320px;margin:0 auto}h1{margin:0 0 4px}h2{margin:12px 0;font-size:24px}h2 small{color:var(--muted);font-weight:500;font-size:15px}.crumb{color:var(--muted);font-weight:500;font-size:16px}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 8px}h3 small{text-transform:none;letter-spacing:0}h4{margin:8px 0;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.summary{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.pill{padding:5px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line);display:inline-block}.pill.ok{color:var(--ok)}.pill.bad{color:var(--bad)}.pill.warn{color:var(--warn)}.pill.small{padding:1px 8px;font-size:12px}
section{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:8px 20px 20px;margin:20px 0}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}@media(max-width:820px){.grid2{grid-template-columns:minmax(0,1fr)}}
.muted{color:var(--muted)}.small{font-size:13px}.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:400}.icon{width:56px;height:56px;border-radius:13px;flex:none}.icon.big{width:96px;height:96px;border-radius:22px}.icon.ph{background:var(--line)}
.search-row{border:1px solid var(--line);border-radius:16px;padding:14px}.sr-head{display:flex;gap:12px;align-items:center}.sr-head>div:not(.icon){flex:1;min-width:0}.get{background:var(--line);color:var(--accent);font-weight:700;border-radius:999px;padding:5px 16px}
.sr-shots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.sr-shots img,.sr-shots video{width:100%;border-radius:10px;aspect-ratio:1206/2622;object-fit:cover;background:var(--line)}
.pp{border:1px solid var(--line);border-radius:16px;padding:16px}.pp-head{display:flex;gap:14px;align-items:center}.pp-head h5{margin:0;font-size:20px}
.pp-shots{display:flex;gap:10px;overflow-x:auto;margin:14px 0;padding-bottom:6px}.pp-shots img,.pp-shots video{height:300px;border-radius:14px;flex:none}
.promo{font-weight:600}.desc .more{color:var(--accent)}h6{margin:10px 0 2px;font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips span{background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:13px}
table{border-collapse:collapse;width:100%}.scroll{overflow-x:auto;max-width:100%}.sum{min-width:640px}.ev{min-width:560px}.fields th,.fields td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top;text-align:start}.fields th{width:200px;font-weight:600}.fields .val{white-space:pre-wrap;overflow-wrap:anywhere}.fields .raw{margin-top:4px;overflow-wrap:anywhere}
.num{white-space:nowrap;font-variant-numeric:tabular-nums;width:150px}.count.over,.over{color:var(--bad);font-weight:700}.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden;min-width:80px;margin-top:4px}.bar i{display:block;height:100%}.bar .ok{background:var(--okbar)}.bar .warn{background:var(--warnbar)}.bar .bad{background:var(--badbar)}
.target{margin:12px 0 18px}.target-label{font-size:13px;color:var(--muted);margin-bottom:8px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.card{margin:0;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0}.card.has-error{border-color:var(--bad)}
.card img{width:100%;height:auto;border-radius:6px;display:block;background:var(--line);cursor:zoom-in}.card video{width:100%;border-radius:6px;background:#000;max-height:360px}
.card figcaption{font-size:13px;overflow-wrap:anywhere}.fname{font-family:ui-monospace,Menlo,monospace;font-size:11px}
.card-wide{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 0}
.issues-inline{list-style:none;margin:6px 0 0;padding:0;font-size:12.5px}.issues-inline li{padding:4px 6px;border-radius:6px;margin-top:4px;background:var(--card)}.issues-inline li.error b{color:var(--bad)}.issues-inline li.warning b{color:var(--warn)}
.decide{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:auto}.decide .item-id{font-size:10px;color:var(--muted);overflow-wrap:anywhere;flex-basis:100%}.decide .comment{flex-basis:100%;min-height:54px;font:inherit;font-size:13px;border-radius:8px;border:1px solid var(--line);padding:6px;background:var(--card);color:var(--text)}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:4px 10px}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rej{display:none;font-size:12px}body.serve .rej{display:inline-block}.rejected{outline:2px solid var(--bad);outline-offset:2px}.rejected .rej{background:var(--bad);color:#fff;border-color:var(--bad)}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.toc a{font-size:13px;padding:3px 10px;border-radius:999px;border:1px solid var(--line);color:var(--text);text-decoration:none;background:var(--card)}
.sum td,.sum th{padding:6px;border-bottom:1px solid var(--line);text-align:start;font-size:14px}.hash{font-family:ui-monospace,Menlo,monospace;font-size:12px;overflow-wrap:anywhere}
.sheet-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.sheet-row img{height:200px;border-radius:8px;flex:none;border:1px solid var(--line)}
.rival{display:grid;grid-template-columns:220px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.rival-shots{display:flex;gap:6px;overflow-x:auto}.rival-shots img{height:180px;border-radius:8px}.pal{display:flex;gap:3px;margin-top:6px}.pal i{width:16px;height:16px;border-radius:4px;display:block}
table.issues td{padding:6px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}tr.error td:first-child{color:var(--bad);font-weight:700}tr.warning td:first-child{color:var(--warn);font-weight:700}
.variants{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.variants figure{margin:0}.variants video{width:100%;border-radius:12px;background:#000}.variants figcaption{text-align:center;font-size:13px;color:var(--muted);margin-top:4px}
.actions{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 16px;z-index:5}.actions .in{max-width:1320px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.actions .grow{flex:1;min-width:200px;font-size:14px}
.primary{background:var(--accent);color:#fff;border-color:var(--accent);padding:8px 16px;font-weight:600}.primary:disabled{opacity:.45;cursor:not-allowed}.danger{color:var(--bad);border-color:var(--bad);padding:8px 16px;font-weight:600}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center}.lightbox[hidden]{display:none}.lightbox .stage{overflow:auto;max-width:100vw;max-height:calc(100vh - 60px);display:flex}.lightbox img{max-width:96vw;max-height:calc(100vh - 70px);cursor:zoom-in;margin:auto}.lightbox.actual img{max-width:none;max-height:none;cursor:zoom-out}.lightbox .cap{color:#eee;font-size:13px;padding:8px;text-align:center}.lightbox button{position:absolute;top:12px;right:12px;background:#333;color:#fff;border-color:#555}
@media(max-width:600px){.rival{grid-template-columns:1fr}.pp-shots img,.pp-shots video{height:220px}.fields th{width:auto;display:block;border-bottom:0}.fields td{display:block}.gallery{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><main>
<h1>${esc(profile?.app.displayName ?? 'Vitrin')} — ${esc(T.review)}</h1>
<div class="muted">${esc(profile?.app.bundleId ?? '')} · ${esc(app?.primaryCategory ?? '')}${app?.secondaryCategory ? ` / ${esc(app.secondaryCategory)}` : ''} · ${esc(app?.copyright ?? '')} · ${esc(T.generated)} ${esc(new Date().toLocaleString(ctx.config.ui?.language ?? 'en-US'))}</div>
<div class="summary">
  ${approvalPill}
  <span class="pill ${validation?.ok ? 'ok' : 'bad'}">${esc(validation ? (validation.ok ? T.validationPassed : T.validationFailed) : T.validateNotRun)}</span>
  <span class="pill">${esc(fill(T.errors, { n: validation?.counts.error ?? '–' }))}</span><span class="pill">${esc(fill(T.warnings, { n: validation?.counts.warning ?? '–' }))}</span>
  <span class="pill">${esc(fill(T.screenshots, { n: inv.items.filter((i) => i.kind === 'screenshot').length }))}</span><span class="pill">${esc(fill(T.previews, { n: inv.items.filter((i) => i.kind === 'preview').length }))}</span>
  <span class="pill">${esc(fill(T.creatives, { n: inv.items.filter((i) => i.kind === 'creative' || (i.kind === 'event' && i.abs)).length }))}</span>
  <span class="pill">${esc(fill(T.artDirection, { name: manifest?.artDirection ?? '–' }))}</span>
</div>
<section><h2>${esc(T.whatWillBeUploaded)}</h2>
<p class="muted small">${esc(T.uploadIntro)}</p>
<div class="scroll"><table class="sum"><tr>${[T.colStore, T.colPlatform, T.colLocale, T.colType, T.colItems, T.colSize, T.colDestination].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${sumRows.join('') || `<tr><td colspan="7" class="muted">${esc(T.nothingToUpload)}</td></tr>`}</table></div>
<p class="small">${summary.lines.slice(-2, -1).map(esc).join('')}<br>${esc(T.overallHash)} <span class="hash" id="overall-hash">${esc(inv.overallHash)}</span></p>
<nav class="toc">${toc.join('')}</nav>
</section>
${sections.join('\n') || `<section><p class="muted">${fill(esc(T.noAssets), { commands: '<code>vitrin write</code>, <code>vitrin design</code>, <code>vitrin video</code>' })}</p></section>`}
${await styleVariantsBlock(p.vitrin, ctx.config.app.locales, rel)}
<section><h2>${esc(T.competitorComparison)} <small>${esc(T.notUploaded)}</small></h2>
<div class="rival"><div><b>${esc(profile?.app.displayName ?? '')}</b><div class="muted small">${esc(fill(T.ourFirstScreenshots, { locale: firstLocale }))}</div></div><div class="rival-shots">${own.map((f) => `<img src="${rel(f.abs!)}" loading="lazy" alt="">`).join('')}</div></div>
${rivalRows || `<p class="muted">${esc(T.researchNotRun)}</p>`}
</section>
<section><h2>${esc(T.otherIssues)}</h2><table class="issues">${generalIssues || `<tr><td>${esc(T.noOtherIssues)}</td></tr>`}</table></section>
</main>
<div class="actions"><div class="in">
  <div class="grow" id="act-text">${fill(esc(T.approveHint), { command: `<code>vitrin approve --expect-hash ${esc(inv.overallHash.slice(0, 12))}</code>`, serve: '<code>vitrin review --serve</code>' })}</div>
  <button type="button" class="danger" id="send-rej" hidden>${esc(T.sendRejections)}</button>
  <button type="button" class="primary" id="approve" hidden>${esc(T.approveAll)}</button>
</div></div>
<div class="lightbox" id="lb" hidden><button type="button" id="lb-close">${esc(T.close)}</button><div class="stage"><img id="lb-img" alt=""></div><div class="cap" id="lb-cap"></div></div>
<script>
const VITRIN = ${boot};
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const t = (k, v = {}) => VITRIN.t[k].replace(/\{(\w+)\}/g, (m, n) => (n in v ? String(v[n]) : m));
  // Zoom: click a thumbnail for the full-size file, click again for 100 %, arrows to step, Esc to close.
  const lb = $('#lb'), img = $('#lb-img'), cap = $('#lb-cap');
  const links = [...document.querySelectorAll('a.zoom')];
  let at = -1;
  const show = (i) => { at = (i + links.length) % links.length; const a = links[at]; img.src = a.dataset.full; cap.textContent = a.dataset.caption + ' (' + (at + 1) + '/' + links.length + ')'; lb.classList.remove('actual'); lb.hidden = false; };
  links.forEach((a, i) => a.addEventListener('click', (e) => { e.preventDefault(); show(i); }));
  img.addEventListener('click', () => lb.classList.toggle('actual'));
  $('#lb-close').addEventListener('click', () => (lb.hidden = true));
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.hidden = true; });
  document.addEventListener('keydown', (e) => { if (lb.hidden) return; if (e.key === 'Escape') lb.hidden = true; if (e.key === 'ArrowRight') show(at + 1); if (e.key === 'ArrowLeft') show(at - 1); });
  // Fill in durations that the render manifest did not record.
  document.querySelectorAll('figure.video').forEach((f) => { const v = $('video', f), d = $('.js-duration', f); if (v && d) v.addEventListener('loadedmetadata', () => (d.textContent = v.duration.toFixed(1) + ' s')); });

  // Decision buttons exist only when served by \`vitrin review --serve\`.
  if (!location.protocol.startsWith('http')) return;
  const rejected = new Map();
  const approve = $('#approve'), send = $('#send-rej'), text = $('#act-text');
  const refresh = () => {
    approve.disabled = rejected.size > 0;
    send.hidden = rejected.size === 0;
    send.textContent = t('sendNRejections', { n: rejected.size });
    text.textContent = rejected.size ? t('markedForChanges', { n: rejected.size }) : t('lookThrough');
  };
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  };
  fetch('/api/state').then((r) => r.ok ? r.json() : Promise.reject()).then(() => {
    document.body.classList.add('serve');
    approve.hidden = false;
    refresh();
    document.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => {
      const box = b.closest('[data-item]'), ta = $('.comment', box), id = b.dataset.reject;
      if (rejected.has(id)) { rejected.delete(id); box.classList.remove('rejected'); ta.hidden = true; b.textContent = t('reject'); }
      else { rejected.set(id, ta); box.classList.add('rejected'); ta.hidden = false; ta.focus(); b.textContent = t('undoReject'); }
      refresh();
    }));
    approve.addEventListener('click', async () => {
      if (!confirm(t('confirmApprove', { n: VITRIN.items }))) return;
      try { const j = await post('/api/approve', { overallHash: VITRIN.hash }); text.textContent = t('approvedClose', { hash: j.overallHash.slice(0, 12) }); approve.disabled = true; }
      catch (e) { alert(t('notApprovedError', { error: e.message })); }
    });
    send.addEventListener('click', async () => {
      const rejections = [...rejected].map(([item, ta]) => ({ item, comment: ta.value.trim() }));
      if (rejections.some((r) => !r.comment)) { alert(t('commentEach')); return; }
      try { await post('/api/reject', { overallHash: VITRIN.hash, rejections }); text.textContent = t('sentRejections', { n: rejections.length }); send.disabled = true; approve.disabled = true; }
      catch (e) { alert(t('notSent', { error: e.message })); }
    });
  }).catch(() => {});
})();
</script>
</body></html>`;
  await writeText(p.report, html);
  await writeSnapshot(ctx, inv);
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
  return `<section><h2>${esc(T.videoStyles)} <small>vitrin video --styles · ${esc(T.notUploaded)}</small></h2>${rows.join('')}</section>`;
}
