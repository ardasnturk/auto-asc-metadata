import { loadForbiddenTerms } from '@vitrin/core';
import { VitrinConfig, type AppMetadata, type AppProfile, type LocaleMetadata } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { findAppleAward, findKidsTerm, findPlaceholder, isGenericWhatsNew, validateText } from '../src/index.js';

const terms = loadForbiddenTerms();
const config = VitrinConfig.parse({ app: { locales: ['en-US'], primaryLocale: 'en-US' }, urls: { support: 'https://ritim.app/support', privacy: 'https://ritim.app/privacy' }, copyrightHolder: 'JASTech' });
const profile = {
  app: { displayName: 'Ritim' },
  features: [{ id: 'streaks', title: 'Streaks', evidence: [{ path: 'a.swift' }] }],
  docs: { commitsSinceTag: [{ hash: 'a1', subject: 'Add home screen widgets' }, { hash: 'b2', subject: 'Fix a crash' }] },
} as unknown as AppProfile;
const app: AppMetadata = { copyright: '2026 JASTech', primaryCategory: 'HEALTH_AND_FITNESS', secondaryCategory: 'PRODUCTIVITY', primarySubcategories: [], secondarySubcategories: [], reviewNotes: 'New: home screen widgets. Long-press the Home Screen, add the Ritim widget. No login needed.' };
const meta = (over: Partial<LocaleMetadata>): LocaleMetadata =>
  ({ locale: 'en-US', name: 'Ritim: Habit Tracker', subtitle: 'Daily routine and streaks', promotionalText: '', description: 'Check in your habits with one tap every day.\nKeep your streaks.\nSee progress in charts.', keywords: 'goal,planner,motivation,calendar,reminder', whatsNew: 'Home screen widgets for every habit.', claims: [{ text: 'Keep your streaks', featureIds: ['streaks'] }], ...over }) as LocaleMetadata;
const codes = (m: LocaleMetadata, a: AppMetadata = app) => validateText({ config, profile, appMetadata: a, locales: new Map([['en-US', m]]) }).issues.items.map((i) => i.code);

describe('App Review rules', () => {
  it('finds template markers but not the word "todo"', () => {
    expect(findPlaceholder('Lorem ipsum dolor')).toBe('Lorem ipsum');
    expect(findPlaceholder('Feature list TODO: fill in')).toBe('TODO');
    expect(findPlaceholder('The simplest todo list')).toBeUndefined();
    expect(codes(meta({ description: 'Track habits.\nTBD\nMore soon.' }))).toContain('text.placeholder');
  });

  it('rejects Apple-designated recognitions in any spelling', () => {
    expect(findAppleAward('As seen in App of the Day', terms)).toBe('App of the Day');
    expect(findAppleAward('An Editor’s Choice pick', terms)).toBeTruthy();
    expect(codes(meta({ promotionalText: "Editor's Choice in 40 countries" }))).toContain('text.apple-award');
  });

  it('reserves "for kids" wording for the Kids Category', () => {
    expect(findKidsTerm('Habits for kids', terms, 'en-US')).toBe('for kids');
    expect(findKidsTerm('Çocuklar için alışkanlıklar', terms, 'tr')).toBe('çocuklar için');
    expect(codes(meta({ subtitle: 'Habit tracker for kids' }))).toContain('text.kids-reserved');
    const kids = { ...app, ageRatingDraft: { answers: { kidsAgeBand: '6-8' }, rationale: '', needsUserConfirmation: true } } as AppMetadata;
    expect(codes(meta({ subtitle: 'Habit tracker for kids' }), kids)).not.toContain('text.kids-reserved');
  });

  it('flags generic release notes only when the release adds features', () => {
    expect(isGenericWhatsNew('Bug fixes and performance improvements.', terms, 'en-US')).toBe(true);
    expect(isGenericWhatsNew('• Hata düzeltmeleri\n• Performans iyileştirmeleri', terms, 'tr')).toBe(true);
    expect(isGenericWhatsNew('Home screen widgets and bug fixes.', terms, 'en-US')).toBe(false);
    expect(codes(meta({ whatsNew: 'Bug fixes and improvements.' }))).toContain('whatsnew.generic');
    expect(codes(meta({}))).not.toContain('whatsnew.generic');
  });

  it('asks for specific review notes', () => {
    expect(codes(meta({}), { ...app, reviewNotes: '' })).toContain('review.notes-short');
    expect(codes(meta({}))).not.toContain('review.notes-short');
  });
});
