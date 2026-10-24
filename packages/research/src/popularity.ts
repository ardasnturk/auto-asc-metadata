import { cachedJson, log } from '@vitrin/core';

export interface PopularityProvider {
  source: 'apple-ads' | 'apptweak';
  /** term → 0–1 */
  fetch(terms: string[], storefront: string, locale: string): Promise<Map<string, number>>;
}

/**
 * AppTweak keyword metrics (volume 5–100 mapped to 0–1).
 * Docs: https://developers.apptweak.com/reference/keyword-metrics
 */
export function appTweakProvider(apiKey: string, cacheDir: string): PopularityProvider {
  return {
    source: 'apptweak',
    async fetch(terms, storefront, locale) {
      const out = new Map<string, number>();
      for (let i = 0; i < terms.length; i += 25) {
        const batch = terms.slice(i, i + 25);
        const url = `https://public-api.apptweak.com/api/public/store/keywords/metrics/current.json?${new URLSearchParams({
          keywords: batch.join(','),
          country: storefront,
          language: locale.split('-')[0]!,
          device: 'iphone',
          metrics: 'volume',
        })}`;
        try {
          const res = await cachedJson<{ result?: Record<string, { volume?: { value?: number } }> }>(url, {
            cacheDir,
            minIntervalMs: 500,
            headers: { 'x-apptweak-key': apiKey },
          });
          for (const [term, m] of Object.entries(res.result ?? {})) {
            const v = m.volume?.value;
            if (typeof v === 'number') out.set(term, Math.max(0, Math.min(1, (v - 5) / 95)));
          }
        } catch (err) {
          log.warn(`AppTweak isteği başarısız, tahmine dönülüyor: ${(err as Error).message}`);
          break;
        }
      }
      return out;
    },
  };
}

/**
 * Apple Ads: the public Campaign Management API has no endpoint that returns search popularity for
 * arbitrary terms (the 1–5 popularity indicator only exists in the Apple Ads web UI). When credentials
 * are present we report that clearly and fall back to the estimate rather than inventing numbers.
 */
export function appleAdsAvailable(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.APPLE_ADS_CLIENT_ID && env.APPLE_ADS_TEAM_ID && env.APPLE_ADS_KEY_ID && env.APPLE_ADS_PRIVATE_KEY_PATH && env.APPLE_ADS_ORG_ID);
}
