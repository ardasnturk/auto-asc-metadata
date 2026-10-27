import { log, writeJson } from '@vitrin/core';
import { storefrontPlan } from '@vitrin/research';
import type { AppProfile, Competitors, LiveListing } from '@vitrin/schemas';
import { AscClient, AscCredentialError, credentialsFromEnv, fetchLiveListing } from '@vitrin/upload';
import { bundleIdOf, type Ctx } from './context.js';

/**
 * What the store shows today, for the write brief and the checks (`metadata/research/live-listing.json`): App Store
 * Connect — name, subtitle, keywords, promotional text, description — when the API key is set, otherwise the public
 * lookup of the live app (name and description only). Nothing is written for an app that is not live and has no key.
 */
export async function refreshLiveListing(ctx: Ctx, profile: AppProfile, competitors?: Competitors): Promise<LiveListing | undefined> {
  let live: LiveListing | undefined;
  if (profile.app.platforms.some((p) => p !== 'android')) {
    try {
      live = (await fetchLiveListing(new AscClient(credentialsFromEnv(ctx.env)), bundleIdOf(ctx, profile))) ?? undefined;
    } catch (err) {
      // No key yet is normal before the upload gate; anything else is worth a warning, not a failed research run.
      if (err instanceof AscCredentialError) log.dim('No App Store Connect key: the live subtitle and keyword field are not read (the public lookup has neither).');
      else log.warn(`Could not read the live listing from App Store Connect: ${(err as Error).message}`);
    }
  }
  const self = competitors?.self;
  if (!live && self) {
    const locale = storefrontPlan(ctx.config).find((p) => p.storefront === self.storefront)?.locale ?? ctx.config.app.primaryLocale;
    live = { generatedAt: new Date().toISOString(), source: 'lookup', locales: { [locale]: { name: self.name, description: self.description } } };
  }
  if (live) await writeJson(ctx.paths.liveListing, live);
  return live;
}
