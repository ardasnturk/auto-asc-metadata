import { existsSync, log } from '@vitrin/core';
import type { CustomProductPage, Experiment, ExperimentTreatment, InAppEventSpec } from '@vitrin/schemas';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AscClient, JsonApiDocument, JsonApiResource } from './asc-client.js';
import { AssetLibraryClient, type OwnerType } from './asset-library.js';
import { displayTypesFor } from './display-types.js';
import type { PollOptions } from './upload-operations.js';

type EventSpec = z.infer<typeof InAppEventSpec>;

function idOf(doc: JsonApiDocument): string {
  const d = Array.isArray(doc.data) ? doc.data[0] : doc.data;
  if (!d?.id) throw new Error('The ASC response has no resource id.');
  return d.id;
}

/**
 * Custom Product Pages: page → version → localization (promotional text) → keyword assignment.
 * Keyword assignment (searchKeywords relationship) is marked ≈ in the docs and checked on first use.
 */
export async function createCustomProductPage(asc: AscClient, appId: string, page: CustomProductPage, locales: string[]): Promise<{ pageId: string; localizations: Record<string, string> }> {
  const created = await asc.request<JsonApiDocument>('POST', '/v1/appCustomProductPages', {
    data: {
      type: 'appCustomProductPages',
      attributes: { name: page.name },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    },
  });
  const pageId = idOf(created);
  const versions = await asc.getAll(`/v1/appCustomProductPages/${pageId}/appCustomProductPageVersions`);
  let versionId = versions[0]?.id;
  if (!versionId) {
    versionId = idOf(
      await asc.request<JsonApiDocument>('POST', '/v1/appCustomProductPageVersions', {
        data: {
          type: 'appCustomProductPageVersions',
          attributes: page.deepLink ? { deepLink: page.deepLink } : {},
          relationships: { appCustomProductPage: { data: { type: 'appCustomProductPages', id: pageId } } },
        },
      }),
    );
  } else if (page.deepLink) {
    await asc.request('PATCH', `/v1/appCustomProductPageVersions/${versionId}`, { data: { type: 'appCustomProductPageVersions', id: versionId, attributes: { deepLink: page.deepLink } } });
  }
  const localizations: Record<string, string> = {};
  for (const locale of locales) {
    const loc = await asc.request<JsonApiDocument>('POST', '/v1/appCustomProductPageLocalizations', {
      data: {
        type: 'appCustomProductPageLocalizations',
        attributes: { locale, promotionalText: page.promotionalText[locale] ?? '' },
        relationships: { appCustomProductPageVersion: { data: { type: 'appCustomProductPageVersions', id: versionId } } },
      },
    });
    localizations[locale] = idOf(loc);
  }
  if (page.keywords.length) {
    // Keywords are assigned from the last approved version's keyword field.
    const appKeywords = await asc.getAll<{ value?: string }>(`/v1/apps/${appId}/searchKeywords?limit=200`).catch(() => [] as Array<JsonApiResource<{ value?: string }>>);
    const wanted = new Set(page.keywords.map((k) => k.toLowerCase()));
    const ids = appKeywords.filter((k) => wanted.has(String(k.attributes.value ?? k.id).toLowerCase())).map((k) => ({ type: 'appKeywords', id: k.id }));
    for (const locId of Object.values(localizations)) {
      if (ids.length) await asc.request('POST', `/v1/appCustomProductPageLocalizations/${locId}/relationships/searchKeywords`, { data: ids });
    }
  }
  return { pageId, localizations };
}

/** `appEvents` attributes of a spec: schedule and deep link only when the plan has them (a draft can do without). */
export function eventAttributes(e: EventSpec, primaryLocale: string): Record<string, unknown> {
  return {
    referenceName: e.id,
    badge: e.badge,
    primaryLocale,
    purchaseRequirement: e.purchaseRequirement,
    priority: e.priority,
    purpose: e.purpose,
    ...(e.deepLink ? { deepLink: e.deepLink } : {}),
    ...(e.schedule ? { territorySchedules: [{ territories: e.schedule.territories, publishStart: e.schedule.publishStart ?? e.schedule.eventStart, eventStart: e.schedule.eventStart, eventEnd: e.schedule.eventEnd }] } : {}),
  };
}

/** In-App Event draft with localizations. Its card and detail images are placed with placeEventMedia. */
export async function createInAppEvent(asc: AscClient, appId: string, e: EventSpec, primaryLocale: string, locales: string[]): Promise<{ eventId: string; localizations: Record<string, string> }> {
  const eventId = idOf(
    await asc.request<JsonApiDocument>('POST', '/v1/appEvents', {
      data: {
        type: 'appEvents',
        attributes: eventAttributes(e, primaryLocale),
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    }),
  );
  const localizations: Record<string, string> = {};
  for (const locale of locales) {
    localizations[locale] = idOf(
      await asc.request<JsonApiDocument>('POST', '/v1/appEventLocalizations', {
        data: {
          type: 'appEventLocalizations',
          attributes: { locale, name: e.name[locale] ?? '', shortDescription: e.shortDescription[locale] ?? '', longDescription: e.longDescription[locale] ?? '' },
          relationships: { appEvent: { data: { type: 'appEvents', id: eventId } } },
        },
      }),
    );
  }
  return { eventId, localizations };
}

/** Target id of a rendered screenshot (`NN_<slug>_<target>.png`; slugs and target ids never contain `_`). */
export function screenshotTargetOf(file: string): string | undefined {
  const m = /^\d{2}_[a-z0-9-]+_([a-z0-9.-]+)\.(png|jpe?g)$/.exec(file);
  return m?.[1];
}

/** A Custom Product Page's own screenshot set (rendered by `vitrin design`) on each of its localizations. */
export function placeCustomProductPageMedia(asc: AscClient, appId: string, dir: string, localizations: Record<string, string>, opts: { uploadFetch?: typeof fetch; poll?: PollOptions } = {}): Promise<number> {
  return placeScreenshotSets(asc, appId, dir, 'appCustomProductPageLocalizations', localizations, opts);
}

/**
 * A screenshot set rendered by `vitrin design` (`<dir>/<locale>/NN_slug_<target>.png`) on each localization of a
 * Custom Product Page or test treatment: one Asset Library placement group per target, in file order. Returns the
 * count placed.
 */
export async function placeScreenshotSets(asc: AscClient, appId: string, dir: string, ownerType: OwnerType, localizations: Record<string, string>, opts: { uploadFetch?: typeof fetch; poll?: PollOptions } = {}): Promise<number> {
  if (!existsSync(dir)) return 0;
  const lib = new AssetLibraryClient(asc, opts);
  let libraryId: string | undefined;
  let n = 0;
  for (const [locale, locId] of Object.entries(localizations)) {
    const localeDir = join(dir, locale);
    if (!existsSync(localeDir)) continue;
    const byTarget = new Map<string, string[]>();
    for (const f of (await readdir(localeDir)).sort()) {
      const target = screenshotTargetOf(f);
      if (target) byTarget.set(target, [...(byTarget.get(target) ?? []), join(localeDir, f)]);
    }
    for (const [target, files] of byTarget) {
      const spec = displayTypesFor(target)?.assetLibrary;
      if (!spec) {
        log.warn(`${locale} ${target}: no App Asset Library placement in data/asc-display-types.json; not placed.`);
        continue;
      }
      libraryId ??= await lib.libraryId(appId);
      const res = await lib.replaceSet(libraryId, { type: ownerType, id: locId }, spec, files.map((file) => ({ file, kind: 'image' as const })));
      n += res.placements.length;
    }
  }
  return n;
}

/**
 * An In-App Event's card (16:9) and detail page (9:16) images on each of its localizations, from
 * `<creativeDir>/<locale>/event-card_event-<id>-card.png` and `event-detail_event-<id>-detail.png`.
 */
export async function placeEventMedia(asc: AscClient, appId: string, creativeDir: string, eventKey: string, localizations: Record<string, string>, opts: { uploadFetch?: typeof fetch; poll?: PollOptions } = {}): Promise<number> {
  const lib = new AssetLibraryClient(asc, opts);
  let libraryId: string | undefined;
  let n = 0;
  for (const [locale, locId] of Object.entries(localizations)) {
    for (const [target, file] of [['event-card', `event-card_event-${eventKey}-card.png`], ['event-detail', `event-detail_event-${eventKey}-detail.png`]] as const) {
      const path = join(creativeDir, locale, file);
      const spec = displayTypesFor(target)?.assetLibrary;
      if (!existsSync(path) || !spec) continue;
      libraryId ??= await lib.libraryId(appId);
      const res = await lib.replaceSet(libraryId, { type: 'appEventLocalizations', id: locId }, spec, [{ file: path, kind: 'image' }]);
      n += res.placements.length;
    }
  }
  return n;
}

// ---- Product Page Optimization ----

/** AppStoreVersionExperimentV2CreateRequest: a test belongs to the app and one platform. */
export function experimentCreateBody(e: Pick<Experiment, 'name' | 'trafficProportion'>, appId: string, platform: string) {
  return {
    data: {
      type: 'appStoreVersionExperiments' as const,
      attributes: { name: e.name, platform, trafficProportion: e.trafficProportion },
      relationships: { app: { data: { type: 'apps' as const, id: appId } } },
    },
  };
}

/** AppStoreVersionExperimentTreatmentCreateRequest; `appIconName` makes it an icon treatment. */
export function treatmentCreateBody(t: Pick<ExperimentTreatment, 'name' | 'appIconName'>, experimentId: string) {
  return {
    data: {
      type: 'appStoreVersionExperimentTreatments' as const,
      attributes: { name: t.name, ...(t.appIconName ? { appIconName: t.appIconName } : {}) },
      relationships: { appStoreVersionExperimentV2: { data: { type: 'appStoreVersionExperiments' as const, id: experimentId } } },
    },
  };
}

export function treatmentLocalizationCreateBody(locale: string, treatmentId: string) {
  return {
    data: {
      type: 'appStoreVersionExperimentTreatmentLocalizations' as const,
      attributes: { locale },
      relationships: { appStoreVersionExperimentTreatment: { data: { type: 'appStoreVersionExperimentTreatments' as const, id: treatmentId } } },
    },
  };
}

/**
 * A Product Page Optimization test: the test (v2, per app and platform), its treatments, one localization per locale
 * and each treatment's own screenshot set (`<dir>/<treatment id>/<locale>/…`) placed through the App Asset Library.
 * It stays a draft: App Review checks the treatments and the user starts the test in App Store Connect. The request
 * bodies follow the App Store Connect API resources above and are checked on first use, like the CPP keywords.
 */
export async function createExperiment(
  asc: AscClient,
  appId: string,
  e: Experiment,
  opts: { platform?: string; locales: string[]; dir: string; uploadFetch?: typeof fetch; poll?: PollOptions },
): Promise<{ experimentId: string; treatments: Record<string, string>; placed: number }> {
  const experimentId = idOf(await asc.request<JsonApiDocument>('POST', '/v2/appStoreVersionExperiments', experimentCreateBody(e, appId, opts.platform ?? 'IOS')));
  const treatments: Record<string, string> = {};
  let placed = 0;
  for (const t of e.treatments) {
    const treatmentId = idOf(await asc.request<JsonApiDocument>('POST', '/v1/appStoreVersionExperimentTreatments', treatmentCreateBody(t, experimentId)));
    treatments[t.id] = treatmentId;
    const localizations: Record<string, string> = {};
    for (const locale of e.locales ?? opts.locales) {
      localizations[locale] = idOf(await asc.request<JsonApiDocument>('POST', '/v1/appStoreVersionExperimentTreatmentLocalizations', treatmentLocalizationCreateBody(locale, treatmentId)));
    }
    placed += await placeScreenshotSets(asc, appId, join(opts.dir, t.id), 'appStoreVersionExperimentTreatmentLocalizations', localizations, opts);
  }
  return { experimentId, treatments, placed };
}
