import type { CompetitorApp } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { compareRanks, competitionScore, estimatePopularity, kmeans, median, nameTermFrequency, rgbToHex, titleShare, totalScore, trackedTerms } from '../src/index.js';

describe('keyword scoring', () => {
  it('computes median and competition', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const empty = competitionScore(0, [], 0);
    expect(empty.score).toBe(0);
    const crowded = competitionScore(50, Array(10).fill(1_000_000), 1);
    expect(crowded.score).toBeGreaterThan(0.95);
    // A full result list alone is not competition: every real term returns the whole page.
    expect(competitionScore(50, Array(10).fill(10), 0).score).toBeLessThan(0.15);
    const results = [{ trackName: 'Habit Tracker' }, { trackName: 'Daily Habits' }, { trackName: 'Streaks' }, { trackName: 'Done' }];
    expect(titleShare('habit', results, 'en-US')).toBe(0.5);
  });

  it('leaves total null until Claude sets relevance', () => {
    const c = { relevance: null, popularity: { score: 0.8, source: 'estimate' as const }, competition: { resultCount: 10, top10MedianRatings: 10, score: 0.2 }, ownRank: null };
    expect(totalScore(c)).toBeNull();
    expect(totalScore({ ...c, relevance: 1 })).toBeGreaterThan(0.6);
  });

  it('estimates popularity from result names and volume', () => {
    const results = [{ trackId: 1, trackName: 'Habit Tracker', userRatingCount: 200_000 }, { trackId: 2, trackName: 'Streaks', userRatingCount: 50_000 }];
    expect(estimatePopularity('habit', results, 'en-US')).toBeGreaterThan(estimatePopularity('zebra', results, 'en-US'));
  });

  it('counts name terms without stopwords', () => {
    const apps = [{ name: 'Habit Tracker: Daily Goals' }, { name: 'Daily Habit Tracker' }, { name: 'The Habit App' }] as CompetitorApp[];
    const terms = nameTermFrequency(apps, 'en-US');
    expect(terms[0]).toEqual({ term: 'habit', count: 3 });
    expect(terms.some((t) => t.term === 'the' || t.term === 'app')).toBe(false);
    expect(terms.find((t) => t.term === 'habit tracker')?.count).toBe(2);
  });
});

describe('rank tracking', () => {
  const c = (term: string, total: number | null, ownRank: number | null = null) => ({ term, relevance: 1, competition: { resultCount: 50, top10MedianRatings: 1, score: 0 }, popularity: { score: 0, source: 'estimate' as const }, total, ownRank });

  it('tracks the selected terms first, then the best-scored and already-ranked ones', () => {
    const plan = { locale: 'en-US', storefront: 'us', generatedAt: '', candidates: [c('water', 0.2), c('habit', 0.9), c('streak', null, 7), c('zzz', null)], selected: { name: ['Habit Tracker'], subtitle: [], keywords: ['goal'] } };
    expect(trackedTerms(plan, ['seed'])).toEqual(['habit tracker', 'goal', 'habit', 'water', 'streak']);
    expect(trackedTerms(undefined, ['seed', 'other'], 1)).toEqual(['seed']);
  });

  it('compares a snapshot with the previous one', () => {
    const entry = (term: string, rank: number | null) => ({ locale: 'en-US', storefront: 'us', term, rank, limit: 50 });
    const before = { date: '2026-10-01', bundleId: 'x', entries: [entry('habit', 12), entry('goal', null)] };
    const after = { date: '2026-10-15', bundleId: 'x', entries: [entry('habit', 5), entry('goal', 30), entry('new', 3)] };
    expect(compareRanks(before, after)).toEqual([
      { locale: 'en-US', term: 'habit', before: 12, after: 5, delta: 7 },
      { locale: 'en-US', term: 'goal', before: null, after: 30, delta: null },
      { locale: 'en-US', term: 'new', before: null, after: 3, delta: null },
    ]);
  });
});

describe('palette', () => {
  it('finds dominant colours deterministically', () => {
    const px: Array<[number, number, number]> = [...Array(70).fill([250, 10, 10]), ...Array(30).fill([10, 10, 250])];
    const res = kmeans(px, 2);
    expect(rgbToHex(res[0]!.color)).toBe('#FA0A0A');
    expect(res[0]!.weight).toBeCloseTo(0.7);
    expect(kmeans(px, 2)).toEqual(res);
  });
});
