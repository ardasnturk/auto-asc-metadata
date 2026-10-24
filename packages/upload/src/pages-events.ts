import type { CustomProductPage, InAppEventSpec } from '@vitrin/schemas';
import { z } from 'zod';
import type { AscClient, JsonApiDocument, JsonApiResource } from './asc-client.js';

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

/** In-App Event draft with localizations. Media is attached through Asset Library placements. */
export async function createInAppEvent(asc: AscClient, appId: string, e: EventSpec, primaryLocale: string, locales: string[]): Promise<{ eventId: string; localizations: Record<string, string> }> {
  const eventId = idOf(
    await asc.request<JsonApiDocument>('POST', '/v1/appEvents', {
      data: {
        type: 'appEvents',
        attributes: { referenceName: e.id, badge: e.badge, primaryLocale, purchaseRequirement: 'NO_COST_ASSOCIATED', priority: 'NORMAL', purpose: 'APPROPRIATE_FOR_ALL_USERS' },
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
