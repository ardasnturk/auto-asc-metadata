import { VitrinConfig, type AppMetadata, type AppProfile, type Competitors, type LocaleMetadata } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { containsTerm, pluralForms, validateText } from '../src/index.js';

const config = VitrinConfig.parse({
  app: { locales: ['tr', 'en-US'], primaryLocale: 'tr' },
  urls: { support: 'https://ritim.app/support', privacy: 'https://ritim.app/privacy' },
  copyrightHolder: 'JASTech',
});

const profile = {
  app: { displayName: 'Ritim' },
  features: [
    { id: 'streaks', title: 'Seriler', evidence: [{ path: 'a.swift' }] },
    { id: 'charts', title: 'Grafikler', evidence: [{ path: 'b.swift' }] },
  ],
} as unknown as AppProfile;

const appMeta: AppMetadata = { copyright: '2026 JASTech', primaryCategory: 'HEALTH_AND_FITNESS', secondaryCategory: 'PRODUCTIVITY', primarySubcategories: [], secondarySubcategories: [], reviewNotes: '' };

function meta(over: Partial<LocaleMetadata> & { locale: string }): LocaleMetadata {
  return {
    name: 'Ritim: Alışkanlık Takibi',
    subtitle: 'Günlük rutin ve seri',
    promotionalText: '',
    description: 'Ritim ile alışkanlıklarını her gün tek dokunuşla işaretle.\nSerilerini koru, grafiklerle ilerlemeni gör.\nHatırlatıcılar seni yolda tutar.',
    keywords: 'hedef,plan,motivasyon,takvim,hatırlatıcı',
    whatsNew: '',
    claims: [{ text: 'Serilerini koru', featureIds: ['streaks'] }],
    ...over,
  } as LocaleMetadata;
}

function run(locales: LocaleMetadata[], extra: { competitors?: Competitors; app?: AppMetadata } = {}) {
  return validateText({ config, profile, competitors: extra.competitors, appMetadata: extra.app ?? appMeta, locales: new Map(locales.map((l) => [l.locale, l])) });
}

const codes = (r: ReturnType<typeof run>) => r.issues.items.map((i) => i.code);

describe('text limits', () => {
  it('passes a clean locale', () => {
    const r = run([meta({ locale: 'tr' }), meta({ locale: 'en-US', name: 'Ritim: Habit Tracker', subtitle: 'Daily routine and streaks', keywords: 'goal,planner,motivation,calendar,reminder', description: 'Check in your habits with one tap every day.\nKeep your streaks.\nSee progress in charts.', claims: [{ text: 'Keep your streaks', featureIds: ['streaks'] }] })]);
    expect(r.issues.errors).toEqual([]);
  });

  it('measures the keyword field in bytes, not characters', () => {
    // 50 Turkish characters "ş" = 100 bytes → ok; one more letter → 101 bytes.
    const ok = 'şş'.repeat(25);
    expect(run([meta({ locale: 'tr', keywords: ok })]).measurements.tr!.keywords!.bytes).toBe(100);
    const r = run([meta({ locale: 'tr', keywords: ok + 'a' })]);
    expect(codes(r)).toContain('text.too-long');
    expect(r.measurements.tr!.keywords).toMatchObject({ bytes: 101, chars: 51, unit: 'bytes' });
  });

  it('counts name length in graphemes', () => {
    expect(codes(run([meta({ locale: 'tr', name: 'A' })]))).toContain('text.too-short');
    expect(codes(run([meta({ locale: 'tr', name: 'Ritim: Alışkanlık ve Rutin Takibi' })]))).toContain('text.too-long');
  });

  it('rejects HTML and missing required fields', () => {
    const c = codes(run([meta({ locale: 'tr', description: '<b>Merhaba</b> dünya, bu bir açıklamadır.' })]));
    expect(c).toContain('text.html');
    expect(codes(run([meta({ locale: 'tr', keywords: '' })]))).toContain('text.required');
  });
});

describe('ASO rules', () => {
  it('flags subtitle words repeated from the name', () => {
    expect(codes(run([meta({ locale: 'tr', subtitle: 'Alışkanlık ve seri' })]))).toContain('aso.subtitle-repeats-name');
  });

  it('flags keyword problems', () => {
    const c = codes(run([meta({ locale: 'tr', keywords: 'hedef, plan,ab,hedef,ritim,jastech,iphone' })]));
    expect(c).toContain('keywords.spaces');
    expect(c).toContain('keywords.too-short');
    expect(c).toContain('keywords.duplicate');
    expect(c).toContain('keywords.repeats-name');
    expect(c).toContain('keywords.developer-name');
    expect(c).toContain('keywords.apple-trademark');
  });

  it('warns on singular/plural pairs', () => {
    expect(codes(run([meta({ locale: 'en-US', name: 'Ritim', subtitle: 'Daily', keywords: 'goal,goals,planner', description: 'Long enough description for the hook line here.' })]))).toContain('keywords.plural');
    expect(pluralForms('hedef', 'tr')).toContain('hedefler');
  });

  it('rejects price and unproven superlatives in strict fields', () => {
    const c = codes(run([meta({ locale: 'tr', subtitle: 'En iyi ücretsiz rutin' })]));
    expect(c).toContain('text.price');
    expect(c).toContain('text.superlative');
    const en = codes(run([meta({ locale: 'en-US', name: 'Ritim', subtitle: '#1 habit app, free', keywords: 'goal', description: 'Long enough description for the hook line here.' })]));
    expect(en).toContain('text.price');
    expect(en).toContain('text.superlative');
  });

  it('rejects competitor brand names', () => {
    const competitors = { apps: [{ name: 'Streaks: Habit Tracker', sellerName: 'Crunchy Bagel' }] } as unknown as Competitors;
    const c = codes(run([meta({ locale: 'tr', description: 'Streaks uygulamasına alternatif, sade bir takipçi. Uzun açıklama.' })], { competitors }));
    expect(c).toContain('text.competitor-brand');
  });

  it('only warns about price in promotional text', () => {
    const r = run([meta({ locale: 'tr', promotionalText: 'Bu hafta indirim var' })]);
    expect(r.issues.items.find((i) => i.code === 'text.price' && i.field === 'promotionalText')?.severity).toBe('warning');
  });

  it('checks claims against features', () => {
    const c = codes(run([meta({ locale: 'tr', claims: [{ text: 'Apple Watch ile', featureIds: ['apple-watch'] }] })]));
    expect(c).toContain('claim.unknown-feature');
  });

  it('checks copyright format', () => {
    expect(codes(run([meta({ locale: 'tr' })], { app: { ...appMeta, copyright: '© JASTech' } }))).toContain('copyright.format');
  });
});

describe('containsTerm', () => {
  it('matches whole words across scripts', () => {
    expect(containsTerm('Free trial', 'free')).toBe(true);
    expect(containsTerm('Freedom', 'free')).toBe(false);
    expect(containsTerm('Uygulama #1', '#1')).toBe(true);
    expect(containsTerm('EN İYİ', 'en iyi', 'tr')).toBe(true);
    expect(containsTerm('無料アプリ', '無料')).toBe(true);
    expect(containsTerm('Distraction-free timer', 'free')).toBe(false);
    expect(containsTerm('100% offline', '$')).toBe(false);
  });
});

describe('competitor brands', () => {
  it('does not treat generic category phrases as brands', async () => {
    const { competitorBrands } = await import('../src/index.js');
    const competitors = {
      apps: [
        { name: 'Habit Tracker', sellerName: 'Davetech Co., Ltd' },
        { name: 'Productive - Habit Tracker', sellerName: 'Apalon Apps' },
        { name: 'Strides: Habit Tracker + Goals' },
        { name: 'Daily Habit Tracker & Planner' },
        { name: 'Grit: Habits, Goals', sellerName: 'Goals LLC' },
      ],
    } as unknown as Competitors;
    const brands = competitorBrands(competitors, ['Ritim'], ['habit tracker', 'goal tracker']);
    expect(brands).not.toContain('Habit Tracker');
    expect(brands).toContain('Productive');
    expect(brands).toContain('Strides');
    expect(brands).not.toContain('Goals');
  });
});
