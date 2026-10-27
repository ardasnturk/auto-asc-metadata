import type { LiveListing } from '@vitrin/schemas';
import type { AscClient } from './asc-client.js';

const LIVE_STATES = new Set(['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION']);
const stateOf = (a: { appStoreState?: string; appVersionState?: string; state?: string }) => String(a.appVersionState ?? a.state ?? a.appStoreState ?? '');

/**
 * The listing as it is live today: name and subtitle from the live app info, keywords, promotional text and
 * description from the live version (or the newest one before the first release). Null without an app record.
 */
export async function fetchLiveListing(client: AscClient, bundleId: string, platform = 'IOS'): Promise<LiveListing | null> {
  const app = await client.findApp(bundleId);
  if (!app) return null;
  const versions = await client.appStoreVersions(app.id, platform);
  const version = versions.find((v) => LIVE_STATES.has(stateOf(v.attributes))) ?? versions[0];
  const infos = await client.appInfos(app.id);
  const info = infos.find((i) => LIVE_STATES.has(stateOf(i.attributes))) ?? infos[0];
  const locales: LiveListing['locales'] = {};
  const text = (v: string | null | undefined) => (v ?? undefined) || undefined;
  if (info) {
    for (const l of await client.appInfoLocalizations(info.id)) {
      const a = l.attributes;
      if (a.locale) locales[a.locale] = { ...locales[a.locale], name: text(a.name), subtitle: text(a.subtitle) };
    }
  }
  if (version) {
    for (const l of await client.versionLocalizations(version.id)) {
      const a = l.attributes;
      if (a.locale) locales[a.locale] = { ...locales[a.locale], keywords: a.keywords ?? '', promotionalText: text(a.promotionalText), description: text(a.description) };
    }
  }
  return { generatedAt: new Date().toISOString(), source: 'asc', version: version?.attributes.versionString, locales };
}
