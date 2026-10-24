import { existsSync, type AppPaths } from '@vitrin/core';
import type { CppSuggestions, LocaleMetadata, ShotList, VitrinConfig } from '@vitrin/schemas';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isEditableVersion, type AscClient } from './asc-client.js';

export type ChangeKind = 'create' | 'update' | 'unchanged' | 'unknown' | 'skip';

export interface PlanItem {
  area: 'metadata' | 'screenshots' | 'previews' | 'creatives' | 'cpp' | 'events' | 'app';
  locale?: string;
  field?: string;
  change: ChangeKind;
  local?: string;
  remote?: string;
  via: 'deliver' | 'asset-library' | 'asc-api';
  note?: string;
}

export interface UploadPlan {
  generatedAt: string;
  bundleId: string;
  appId?: string;
  version?: { id: string; versionString: string; state: string };
  uploader: 'deliver' | 'asset-library';
  remoteKnown: boolean;
  /** True when the app was never released (App Store Connect rejects release notes then). */
  firstRelease?: boolean;
  items: PlanItem[];
  blockers: string[];
}

const VERSION_FIELDS: Array<[keyof LocaleMetadata, string]> = [
  ['description', 'description'],
  ['keywords', 'keywords'],
  ['promotionalText', 'promotionalText'],
  ['whatsNew', 'whatsNew'],
  ['supportUrl', 'supportUrl'],
  ['marketingUrl', 'marketingUrl'],
];
const INFO_FIELDS: Array<[keyof LocaleMetadata, string]> = [
  ['name', 'name'],
  ['subtitle', 'subtitle'],
  ['privacyUrl', 'privacyPolicyUrl'],
];

const CLEARABLE_FIELDS = new Set<keyof LocaleMetadata>(['subtitle', 'promotionalText', 'marketingUrl']);

function norm(v: unknown): string {
  return String(v ?? '').trim().replace(/\r\n/g, '\n');
}

function short(v: string): string {
  const one = v.replace(/\s+/g, ' ');
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

export async function buildPlan(opts: {
  paths: AppPaths;
  config: VitrinConfig;
  bundleId: string;
  metadata: LocaleMetadata[];
  shots?: ShotList;
  cpp?: CppSuggestions;
  client?: AscClient;
  include: { creatives: boolean; cpp: boolean; events: boolean };
}): Promise<UploadPlan> {
  const { config, metadata, client } = opts;
  const uploader = config.upload.uploader;
  const plan: UploadPlan = { generatedAt: new Date().toISOString(), bundleId: opts.bundleId, uploader, remoteKnown: false, items: [], blockers: [] };

  let firstRelease = false;
  let versionLocs: Array<{ id: string; attributes: Record<string, string | null> }> = [];
  let infoLocs: Array<{ id: string; attributes: Record<string, string | null> }> = [];
  if (client) {
    const app = await client.findApp(opts.bundleId);
    if (!app) {
      plan.blockers.push(`ASC’de ${opts.bundleId} kaydı yok. Uygulama kaydı API anahtarıyla açılamaz; App Store Connect’te elle oluştur.`);
    } else {
      plan.appId = app.id;
      const platform = config.upload.platform === 'osx' ? 'MAC_OS' : config.upload.platform === 'appletvos' ? 'TV_OS' : config.upload.platform === 'xros' ? 'VISION_OS' : 'IOS';
      const versions = await client.appStoreVersions(app.id, platform);
      const editable = versions.find((v) => isEditableVersion(v));
      // App Store Connect has no release notes for an app that was never released.
      firstRelease = versions.every((v) => isEditableVersion(v) || ['REJECTED', 'DEVELOPER_REMOVED_FROM_SALE'].includes(String(v.attributes.appVersionState ?? v.attributes.appStoreState)));
      if (!editable) {
        plan.blockers.push('Düzenlenebilir App Store sürümü yok. `vitrin doctor --create-version <x.y.z>` dene; yalnız TestFlight’taki uygulamalarda ilk sürüm ASC’de elle açılmalı.');
      } else {
        plan.version = { id: editable.id, versionString: editable.attributes.versionString, state: editable.attributes.appVersionState ?? editable.attributes.appStoreState ?? '' };
        versionLocs = await client.versionLocalizations(editable.id);
      }
      const infos = await client.appInfos(app.id);
      const info = infos.find((i) => !['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE'].includes(String(i.attributes.state ?? i.attributes.appStoreState))) ?? infos[0];
      if (info) infoLocs = await client.appInfoLocalizations(info.id);
      plan.remoteKnown = true;
      plan.firstRelease = firstRelease;
    }
  }

  for (const m of metadata) {
    const v = versionLocs.find((l) => l.attributes.locale === m.locale);
    const i = infoLocs.find((l) => l.attributes.locale === m.locale);
    const compare = (fields: Array<[keyof LocaleMetadata, string]>, remote?: { attributes: Record<string, string | null> }) => {
      for (const [local, remoteKey] of fields) {
        let value = norm(m[local]);
        if (!value && local === 'supportUrl') value = norm(config.urls.support);
        if (!value && local === 'marketingUrl') value = norm(config.urls.marketing);
        if (!value && local === 'privacyUrl') value = norm(config.urls.privacy);
        if (local === 'whatsNew' && firstRelease) continue;
        const rv0 = norm(remote?.attributes[remoteKey]);
        if (!value && !(CLEARABLE_FIELDS.has(local) && rv0)) continue;
        if (!plan.remoteKnown) {
          plan.items.push({ area: 'metadata', locale: m.locale, field: local, change: 'unknown', local: short(value), via: 'deliver' });
          continue;
        }
        const rv = norm(remote?.attributes[remoteKey]);
        plan.items.push({
          area: 'metadata',
          locale: m.locale,
          field: local,
          change: !remote ? 'create' : rv === value ? 'unchanged' : 'update',
          local: value ? short(value) : '(boş — silinecek)',
          remote: rv ? short(rv) : undefined,
          via: 'deliver',
        });
      }
    };
    compare(INFO_FIELDS, i);
    compare(VERSION_FIELDS, v);
  }

  // Screenshots / previews — deliver replaces sets (overwrite_screenshots: true).
  for (const locale of config.app.locales) {
    const dir = join(opts.paths.screenshots, locale);
    const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /\.(png|jpe?g)$/.test(f)) : [];
    const byTarget = new Map<string, number>();
    for (const f of files) {
      const t = /_([a-z0-9.-]+)\.(png|jpe?g)$/.exec(f)?.[1] ?? '?';
      byTarget.set(t, (byTarget.get(t) ?? 0) + 1);
    }
    for (const [t, n] of byTarget) {
      plan.items.push({ area: 'screenshots', locale, field: t, change: 'update', local: `${n} görsel`, via: uploader, note: 'mevcut set değiştirilir' });
    }
    const pdir = join(opts.paths.appPreviews, locale);
    const previews = existsSync(pdir) ? (await readdir(pdir)).filter((f) => /\.(mp4|mov)$/.test(f)) : [];
    if (previews.length) plan.items.push({ area: 'previews', locale, change: 'update', local: previews.join(', '), via: uploader, note: 'işlenmesi 24 saate kadar sürebilir' });
  }

  if (opts.include.creatives) {
    for (const locale of config.app.locales) {
      const dir = join(opts.paths.creative, locale);
      const files = existsSync(dir) ? (await readdir(dir)).filter((f) => /^(header|search)_/.test(f)) : [];
      for (const f of files) plan.items.push({ area: 'creatives', locale, field: f, change: 'create', via: 'asset-library', note: 'App Asset Library; sürümden bağımsız onaylanır' });
    }
  } else if (opts.shots?.creatives.header || opts.shots?.creatives.search) {
    plan.items.push({ area: 'creatives', change: 'skip', via: 'asset-library', note: '--creatives verilmedi' });
  }
  if (opts.include.cpp && opts.cpp) {
    for (const p of opts.cpp.pages) plan.items.push({ area: 'cpp', field: p.name, change: 'create', via: 'asc-api', note: `${p.keywords.length} kelime, ${p.shots.length} görsel; Apple onayı gerekir` });
  }
  if (opts.include.events) {
    for (const e of opts.shots?.creatives.events ?? []) plan.items.push({ area: 'events', field: e.id, change: 'create', via: 'asc-api', note: 'taslak olarak oluşturulur' });
  }
  return plan;
}

export function formatPlan(plan: UploadPlan): string {
  const lines: string[] = [];
  lines.push(`Uygulama: ${plan.bundleId}${plan.appId ? ` (ASC id ${plan.appId})` : ''}`);
  if (plan.version) lines.push(`Sürüm: ${plan.version.versionString} — ${plan.version.state}`);
  lines.push(`Yükleyici: ${plan.uploader}${plan.remoteKnown ? '' : '  (ASC’ye bağlanılmadı: uzak durum bilinmiyor)'}`);
  const symbol: Record<ChangeKind, string> = { create: '+', update: '~', unchanged: '=', unknown: '?', skip: '-' };
  let area = '';
  for (const it of plan.items) {
    if (it.area !== area) {
      area = it.area;
      lines.push('', `[${area}]`);
    }
    const head = `  ${symbol[it.change]} ${it.locale ?? ''}${it.field ? ` ${it.field}` : ''}`.padEnd(34);
    const body = it.change === 'update' && it.remote ? `“${it.remote}” → “${it.local}”` : (it.local ?? '');
    lines.push(`${head} ${body}${it.note ? `  (${it.note})` : ''}`);
  }
  const counts = plan.items.reduce<Record<string, number>>((a, i) => ((a[i.change] = (a[i.change] ?? 0) + 1), a), {});
  lines.push('', `Özet: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  for (const b of plan.blockers) lines.push(`ENGEL: ${b}`);
  return lines.join('\n');
}
