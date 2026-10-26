import { VitrinConfig, type AppProfile, type Competitors, type PlayAppMetadata, type PlayListing } from '@vitrin/schemas';
import { describe, expect, it } from 'vitest';
import { allCapsWords, emojiOrEmoticon, isAllCaps, loadPlayLocaleTable, playLocaleOf, validatePlayText } from '../src/index.js';

const config = VitrinConfig.parse({ app: { locales: ['tr', 'en-US'], primaryLocale: 'tr' }, urls: {}, copyrightHolder: 'JASTech' });
const profile = { app: { displayName: 'Ritim' }, features: [{ id: 'streaks', title: 'Seriler', evidence: [{ path: 'a.swift' }] }] } as unknown as AppProfile;

function listing(over: Partial<PlayListing> & { locale: string }): PlayListing {
  return {
    title: 'Ritim: Habit Tracker',
    shortDescription: 'Check in your habits with one tap and keep your streaks going.',
    fullDescription: 'Ritim helps you build habits that stick, one tap a day.\nKeep your streaks and see your progress in charts.',
    changelog: '',
    claims: [{ text: 'Keep your streaks', featureIds: ['streaks'] }],
    ...over,
  } as PlayListing;
}

function run(listings: PlayListing[], extra: { app?: PlayAppMetadata; competitors?: Competitors } = {}) {
  return validatePlayText({ config, profile, competitors: extra.competitors, app: extra.app, listings: new Map(listings.map((l) => [l.locale, l])) });
}
const codes = (r: ReturnType<typeof run>) => r.issues.items.map((i) => i.code);

describe('Google Play listing text', () => {
  it('passes a clean listing and measures fields', () => {
    const r = run([listing({ locale: 'tr', title: 'Ritim: Alışkanlık Takibi', shortDescription: 'Alışkanlıklarını tek dokunuşla işaretle.', fullDescription: 'Ritim ile alışkanlıklarını her gün tek dokunuşla işaretle.\nSerilerini koru.', claims: [] }), listing({ locale: 'en-US' })]);
    expect(r.issues.errors).toEqual([]);
    expect(r.measurements['play:en-US']!.title).toMatchObject({ chars: 20, limit: 30, unit: 'chars' });
  });

  it('enforces the Play limits in characters', () => {
    const r = run([listing({ locale: 'en-US', title: 'R'.repeat(31), shortDescription: 'ş'.repeat(81), fullDescription: 'a '.repeat(2001), changelog: 'x'.repeat(501) })]);
    const tooLong = r.issues.items.filter((i) => i.code === 'play.text.too-long').map((i) => i.field);
    expect(tooLong).toEqual(['title', 'shortDescription', 'fullDescription', 'changelog']);
    expect(codes(run([listing({ locale: 'en-US', title: ' ' })]))).toContain('play.text.required');
  });

  it('applies the metadata policy to the title', () => {
    expect(codes(run([listing({ locale: 'en-US', title: 'Ritim 🔥 Habits' })]))).toContain('play.title.emoji');
    expect(codes(run([listing({ locale: 'en-US', title: 'Ritim :) Habits' })]))).toContain('play.title.emoji');
    expect(codes(run([listing({ locale: 'en-US', title: 'Ritim!!! Habits' })]))).toContain('play.title.special-chars');
    expect(codes(run([listing({ locale: 'en-US', title: 'RITIM HABIT TRACKER' })]))).toContain('play.title.all-caps');
    expect(codes(run([listing({ locale: 'en-US', title: 'Best Habit Tracker' })]))).toContain('play.title.promo');
    expect(codes(run([listing({ locale: 'en-US', title: '#1 Habit App' })]))).toContain('play.title.promo');
    expect(codes(run([listing({ locale: 'en-US', title: 'Ritim - Free Habits' })]))).toContain('play.title.promo');
    expect(codes(run([listing({ locale: 'tr', title: 'Ritim: En İyi Alışkanlık', claims: [] })]))).toContain('play.title.promo');
    expect(codes(run([listing({ locale: 'en-US', title: 'Habit Habit Tracker' })]))).toContain('play.title.repeated-word');
    expect(codes(run([listing({ locale: 'en-US', title: 'Ritim www.ritim.app' })]))).toContain('play.title.url');
    // Colons and single dashes are fine; ":" followed by a word is not an emoticon.
    expect(emojiOrEmoticon('Ritim: Planner')).toBeUndefined();
  });

  it('allows capitals that are the brand', () => {
    expect(isAllCaps('HABIT TRACKER')).toBe(true);
    expect(isAllCaps('Ritim')).toBe(false);
    expect(allCapsWords('NASA Habit Tracker', 'NASA Habits')).toEqual([]);
    expect(allCapsWords('Ritim HABIT Tracker', 'Ritim')).toEqual(['HABIT']);
  });

  it('flags promo wording, emoji and URLs in the short description', () => {
    const r = run([listing({ locale: 'en-US', shortDescription: 'The best habit app 🎯 download now at https://ritim.app' })]);
    expect(codes(r)).toEqual(expect.arrayContaining(['play.short.promo', 'play.short.emoji', 'play.short.url']));
    expect(r.issues.items.find((i) => i.code === 'play.short.promo')?.severity).toBe('warning');
  });

  it('detects keyword stuffing and keyword lists in the full description', () => {
    const stuffed = 'Habit tracker for habits. ' + Array.from({ length: 8 }, () => 'habit tracker').join(' and ');
    expect(codes(run([listing({ locale: 'en-US', fullDescription: stuffed })]))).toContain('play.description.stuffing');
    const list = 'Track habits every day.\nhabit, tracker, routine, streak, goal, planner, daily';
    expect(codes(run([listing({ locale: 'en-US', fullDescription: list })]))).toContain('play.description.keyword-list');
    expect(codes(run([listing({ locale: 'en-US', fullDescription: 'Track habits <b>every</b> day.<script>x</script>' })]))).toContain('play.description.html');
    expect(codes(run([listing({ locale: 'en-US', fullDescription: 'Track habits <b>every</b> day.<br>Keep your streaks.' })]))).not.toContain('play.description.html');
    expect(codes(run([listing({ locale: 'en-US', fullDescription: 'Also on the App Store for iPhone. Keep your streaks.' })]))).toContain('play.text.other-store');
  });

  it('checks the promo video URL', () => {
    expect(codes(run([listing({ locale: 'en-US', video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })]))).not.toContain('play.url.video');
    expect(codes(run([listing({ locale: 'en-US', video: 'https://youtu.be/dQw4w9WgXcQ' })]))).not.toContain('play.url.video');
    expect(codes(run([listing({ locale: 'en-US', video: 'https://vimeo.com/123' })]))).toContain('play.url.video');
    expect(codes(run([listing({ locale: 'en-US', video: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123' })]))).toContain('play.url.video-playlist');
  });

  it('maps locales and catches unmapped and duplicate Play languages', () => {
    const table = loadPlayLocaleTable();
    expect(playLocaleOf({ locale: 'tr' }, table)).toBe('tr-TR');
    expect(playLocaleOf({ locale: 'en-US' }, table)).toBe('en-US');
    expect(playLocaleOf({ locale: 'ur-PK' }, table)).toBeNull();
    expect(codes(run([listing({ locale: 'en-US', playLocale: 'xx-XX' })]))).toContain('play.locale.unknown');
    const dup = run([listing({ locale: 'en-US' }), listing({ locale: 'tr', playLocale: 'en-US', claims: [] })]);
    expect(codes(dup)).toContain('play.locale.duplicate');
    // Primary locale without a Play listing is an error, other locales a warning.
    const missing = validatePlayText({ config, profile, listings: new Map([['en-US', listing({ locale: 'en-US' })]]) });
    expect(missing.issues.items.find((i) => i.code === 'play.missing-locale')).toMatchObject({ severity: 'error', locale: 'tr' });
  });

  it('needs a version code for the changelog and evidence for claims', () => {
    expect(codes(run([listing({ locale: 'en-US', changelog: 'New charts.' })]))).toContain('play.changelog.no-version-code');
    expect(codes(run([listing({ locale: 'en-US', changelog: 'New charts.' })], { app: { track: 'production', versionCode: 7 } }))).not.toContain('play.changelog.no-version-code');
    expect(codes(run([listing({ locale: 'en-US', claims: [{ text: 'Keep your streaks', featureIds: ['nope'] }] })]))).toContain('play.claim.unknown-feature');
  });

  it('rejects competitor brands', () => {
    const competitors = { apps: [{ name: 'Streaks: Habit Tracker', sellerName: 'Crunchy Bagel' }] } as unknown as Competitors;
    expect(codes(run([listing({ locale: 'en-US', fullDescription: 'Like Streaks, but simpler. Keep your streaks.' })], { competitors }))).toContain('play.text.competitor-brand');
  });
});
