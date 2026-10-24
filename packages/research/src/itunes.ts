import { cachedJson, type CachedFetchOptions } from '@vitrin/core';
import type { CompetitorApp } from '@vitrin/schemas';

/** Raw iTunes Search/Lookup result (software entity). Lookup does not return the subtitle. */
export interface ItunesSoftware {
  trackId: number;
  trackName: string;
  sellerName?: string;
  bundleId?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  price?: number;
  formattedPrice?: string;
  primaryGenreName?: string;
  primaryGenreId?: number;
  genres?: string[];
  description?: string;
  releaseNotes?: string;
  version?: string;
  currentVersionReleaseDate?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  artworkUrl512?: string;
  artworkUrl100?: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesSoftware[];
}

export class ItunesClient {
  constructor(private readonly opts: CachedFetchOptions) {}

  async search(term: string, country: string, limit = 50): Promise<ItunesResponse> {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({
      term,
      country,
      entity: 'software',
      media: 'software',
      limit: String(limit),
    })}`;
    return cachedJson<ItunesResponse>(url, this.opts);
  }

  async lookup(params: { id?: number[]; bundleId?: string }, country: string): Promise<ItunesSoftware[]> {
    const q = new URLSearchParams({ country, entity: 'software' });
    if (params.id?.length) q.set('id', params.id.join(','));
    if (params.bundleId) q.set('bundleId', params.bundleId);
    const res = await cachedJson<ItunesResponse>(`https://itunes.apple.com/lookup?${q}`, this.opts);
    return res.results.filter((r) => r.trackId);
  }

  /** Legacy RSS top charts support genre filtering (the newer marketing-tools feed does not). */
  async topChart(country: string, chart: 'topfreeapplications' | 'toppaidapplications' | 'topgrossingapplications', genreId?: number, limit = 100): Promise<number[]> {
    const genre = genreId ? `/genre=${genreId}` : '';
    const url = `https://itunes.apple.com/${country}/rss/${chart}/limit=${limit}${genre}/json`;
    const res = await cachedJson<{ feed?: { entry?: Array<{ id?: { attributes?: { 'im:id'?: string } } }> } }>(url, this.opts);
    return (res.feed?.entry ?? []).map((e) => Number(e.id?.attributes?.['im:id'])).filter((n) => Number.isFinite(n));
  }

  async reviews(trackId: number, country: string, pages = 1): Promise<CompetitorApp['reviews']> {
    const out: CompetitorApp['reviews'] = [];
    for (let page = 1; page <= pages; page++) {
      const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${trackId}/sortby=mostrecent/json`;
      try {
        const res = await cachedJson<{
          feed?: { entry?: Array<{ 'im:rating'?: { label: string }; title?: { label: string }; content?: { label: string }; 'im:version'?: { label: string } }> };
        }>(url, this.opts);
        for (const e of res.feed?.entry ?? []) {
          if (!e['im:rating']) continue;
          out.push({
            rating: Number(e['im:rating'].label),
            title: e.title?.label ?? '',
            content: (e.content?.label ?? '').slice(0, 600),
            version: e['im:version']?.label,
          });
        }
      } catch {
        break;
      }
    }
    return out;
  }
}

export function toCompetitor(r: ItunesSoftware, storefront: string): CompetitorApp {
  return {
    trackId: r.trackId,
    name: r.trackName,
    sellerName: r.sellerName,
    bundleId: r.bundleId,
    storefront,
    averageUserRating: r.averageUserRating,
    userRatingCount: r.userRatingCount,
    price: r.price,
    formattedPrice: r.formattedPrice,
    primaryGenre: r.primaryGenreName,
    genres: r.genres ?? [],
    description: r.description?.slice(0, 4000),
    releaseNotes: r.releaseNotes?.slice(0, 1000),
    version: r.version,
    currentVersionReleaseDate: r.currentVersionReleaseDate,
    screenshotUrls: r.screenshotUrls ?? [],
    ipadScreenshotUrls: r.ipadScreenshotUrls ?? [],
    iconUrl: r.artworkUrl512 ?? r.artworkUrl100,
    rankBySeed: {},
    screenshotText: [],
    palette: [],
    reviews: [],
  };
}

/** App Store genre ids for the ASC primary category names. */
export const GENRE_IDS: Record<string, number> = {
  BOOKS: 6018, BUSINESS: 6000, DEVELOPER_TOOLS: 6026, EDUCATION: 6017, ENTERTAINMENT: 6016, FINANCE: 6015,
  FOOD_AND_DRINK: 6023, GAMES: 6014, GRAPHICS_AND_DESIGN: 6027, HEALTH_AND_FITNESS: 6013, LIFESTYLE: 6012,
  MAGAZINES_AND_NEWSPAPERS: 6021, MEDICAL: 6020, MUSIC: 6011, NAVIGATION: 6010, NEWS: 6009, PHOTO_AND_VIDEO: 6008,
  PRODUCTIVITY: 6007, REFERENCE: 6006, SHOPPING: 6024, SOCIAL_NETWORKING: 6005, SPORTS: 6004, STICKERS: 6025,
  TRAVEL: 6003, UTILITIES: 6002, WEATHER: 6001,
};
