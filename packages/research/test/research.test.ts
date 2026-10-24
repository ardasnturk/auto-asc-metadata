import type { CompetitorApp } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { competitionScore, estimatePopularity, kmeans, median, nameTermFrequency, rgbToHex, totalScore } from '../src/index.js';

describe('keyword scoring', () => {
  it('computes median and competition', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const empty = competitionScore(0, [], 50);
    expect(empty.score).toBe(0);
    const crowded = competitionScore(50, Array(10).fill(1_000_000), 50);
    expect(crowded.score).toBeGreaterThan(0.95);
  });

  it('leaves total null until Claude sets relevance', () => {
    const c = { relevance: null, popularity: { score: 0.8, source: 'estimate' as const }, competition: { resultCount: 10, top10MedianRatings: 10, score: 0.2 } };
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

describe('palette', () => {
  it('finds dominant colours deterministically', () => {
    const px: Array<[number, number, number]> = [...Array(70).fill([250, 10, 10]), ...Array(30).fill([10, 10, 250])];
    const res = kmeans(px, 2);
    expect(rgbToHex(res[0]!.color)).toBe('#FA0A0A');
    expect(res[0]!.weight).toBeCloseTo(0.7);
    expect(kmeans(px, 2)).toEqual(res);
  });
});
