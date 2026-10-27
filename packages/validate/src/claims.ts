import { baseLanguage, existsSync, graphemeLength, loadForbiddenTerms, wordCount } from '@vitrin/core';
import { EVENT_LIMITS, experimentDays, IDEAL_HEADLINE_WORDS, MAX_HEADLINE_WORDS, MIN_REAL_UI_RATIO, NON_UI_ARCHETYPES, type AppProfile, type Badge, type Competitors, type CppSuggestions, type ExperimentPlan, type ShotList, type VideoPlan, type VitrinConfig } from '@vitrin/schemas';
import { join } from 'node:path';
import { findAppleAward, findKidsTerm, findPlaceholder, URL_ON_ASSET_RE } from './apple-rules.js';
import { containsTerm, IssueList } from './issues.js';

/**
 * Claim ↔ evidence checks (App Review 2.3): every headline, badge and video caption must point to a feature
 * in app_profile.json, and every feature must point to files that exist in the project.
 */
export function validateClaims(opts: {
  config: VitrinConfig;
  profile: AppProfile;
  shots?: ShotList;
  videoPlan?: VideoPlan;
  competitors?: Competitors;
  /** metadata/cpp-suggestions.json */
  cpp?: CppSuggestions;
  /** metadata/experiments.json */
  experiments?: ExperimentPlan;
  enabledTargets: string[];
  /** metadata/photos/ (shots[].photo). */
  photosDir?: string;
}): IssueList {
  const { config, profile, shots, videoPlan, competitors, cpp, experiments } = opts;
  const playShots = opts.enabledTargets.filter((id) => PLAY_SCREENSHOT.test(id));
  const onPlay = (s: { targets?: string[] }) => playShots.length > 0 && (!s.targets || s.targets.some((id) => PLAY_SCREENSHOT.test(id)));
  const issues = new IssueList();
  // Google Play needs a real 512 px icon; without the app's own icon Vitrin would render a letter placeholder.
  if (opts.enabledTargets.includes('play-icon') && !(profile.brand?.appIcon && existsSync(join(profile.project.root, profile.brand.appIcon)))) {
    issues.error('icon.missing', 'No app icon was found (app_profile.json brand.appIcon); Google Play needs the real 512 px icon, not a generated placeholder.', { file: 'metadata/app_profile.json', fix: 'Point brand.appIcon to the 1024 px icon in the project.' });
  }
  const features = new Map(profile.features.map((f) => [f.id, f]));

  for (const f of profile.features) {
    for (const ev of f.evidence) {
      if (!existsSync(join(profile.project.root, ev.path))) {
        issues.error('evidence.missing-file', `Evidence file for feature “${f.id}” does not exist: ${ev.path}.`, { file: 'metadata/app_profile.json', fix: 'Point the evidence to a real file or remove the feature.' });
      }
    }
  }

  const checkIds = (ids: string[], where: string) => {
    for (const id of ids) {
      if (!features.has(id)) issues.error('claim.unknown-feature', `${where}: “${id}” is not an evidenced feature in app_profile.`, { file: 'metadata/shots.json', fix: 'Do not show features the app does not have (App Review 2.3).' });
    }
  };

  const checkBadge = (b: Badge, where: string) => {
    if (b.style === 'laurel' && b.type !== 'proof') {
      issues.error('badge.laurel-without-proof', `${where}: the laurel style implies an award/rating; use it only on a verifiable proof badge.`);
    }
    switch (b.type) {
      case 'feature':
      case 'new':
        if (!b.featureId) issues.error('badge.no-feature', `${where}: a ${b.type} badge requires a featureId.`);
        else checkIds([b.featureId], `${where} badge`);
        break;
      case 'platform': {
        const p = b.platform;
        const ok =
          (p === 'ipad' && profile.app.supportsIPad) ||
          (p === 'apple-watch' && (profile.app.platforms.includes('watchos') || profile.project.targets.some((t) => t.kind === 'watch'))) ||
          (p === 'widgets' && profile.project.targets.some((t) => t.kind === 'widget')) ||
          (p === 'iphone-duo' && opts.enabledTargets.some((t) => t.startsWith('duo-'))) ||
          (p === 'mac' && (profile.app.platforms.includes('macos') || profile.project.targets.some((t) => t.devices.includes('mac')))) ||
          (p === 'vision' && (profile.app.platforms.includes('visionos') || profile.project.targets.some((t) => t.devices.includes('vision'))));
        if (!p) issues.error('badge.platform-missing', `${where}: platform badge has no platform field.`);
        else if (!ok) issues.error('badge.platform-unsupported', `${where}: the project does not support “${p}” for this badge.`);
        break;
      }
      case 'proof': {
        const proof = b.proof;
        if (!proof) {
          issues.error('badge.proof-missing', `${where}: a proof badge requires verifiable data (proof).`);
        } else if (proof.kind === 'rating') {
          const self = competitors?.self;
          if (!self) issues.error('badge.proof-unverified', `${where}: the app was not found on the App Store for the rating badge (Lookup).`);
          else if (self.trackId !== proof.trackId || Math.abs((self.averageUserRating ?? 0) - proof.value) > 0.05 || (self.userRatingCount ?? 0) < proof.count) {
            issues.error('badge.proof-mismatch', `${where}: rating badge does not match Lookup data (actual: ${self.averageUserRating?.toFixed(1)} / ${self.userRatingCount}).`);
          }
        } else {
          issues.warn('badge.award-manual', `${where}: award badge (${proof.name}) could not be verified automatically; check the source at ${proof.url}.`);
        }
        break;
      }
    }
    for (const [locale, label] of Object.entries(b.label)) {
      if (/\d+[.,]?\d*\s*(₺|\$|€|£|TL|USD)/i.test(label)) issues.error('badge.price', `${where} (${locale}): price badges are not allowed.`);
    }
  };

  if (shots) {
    const forbidden = loadForbiddenTerms();
    const selfReviews = (competitors?.self?.reviews ?? []).map((r) => `${r.title}\n${r.content}`.toLocaleLowerCase());
    const headlines = new Map<string, string>();
    for (const s of shots.shots) {
      const where = `Screenshot ${s.id}_${s.slug}`;
      const need = { split: 2, 'before-after': 2, collage: 3 } as Record<string, number>;
      if (!NON_UI_ARCHETYPES.includes(s.archetype) && s.screens.length < (need[s.archetype] ?? 1)) {
        issues.error('shot.screens', `${where}: ${s.archetype} needs at least ${need[s.archetype] ?? 1} screens.`);
      }
      if (s.archetype === 'callout' && !s.callouts.length) issues.error('shot.callouts', `${where}: the callout archetype needs at least one callouts entry.`);
      if (s.photo && opts.photosDir && !existsSync(join(opts.photosDir, s.photo))) {
        issues.error('shot.photo-missing', `${where}: the photo ${s.photo} is not in metadata/photos/.`, { file: 'metadata/shots.json', fix: 'Add the developer’s photo there or remove `photo`.' });
      }
      if (s.archetype === 'stat' && !s.stat) issues.error('shot.stat', `${where}: the stat archetype needs stat.value.`);
      if (s.archetype === 'testimonial') {
        for (const locale of config.app.locales) {
          const quotes = s.quotes[locale] ?? [];
          if (!quotes.length) issues.error('quote.missing', `${where} (${locale}): no real reviews in this language; testimonials may only use App Store reviews.`, { locale, fix: 'Narrow shot.targets/locale coverage for this language or pick another archetype.' });
          for (const q of quotes) {
            const needle = q.text.toLocaleLowerCase().replace(/[“”"…]/g, '').trim();
            if (!selfReviews.some((r) => r.includes(needle))) {
              issues.error('quote.unverified', `${where} (${locale}): “${q.text}” was not found verbatim in the app’s App Store reviews (invented or translated reviews are not allowed).`, { locale });
            }
          }
        }
      }
      for (const locale of config.app.locales) {
        const h = s.copy[locale]?.headline.replace(/\*/g, '').trim().toLocaleLowerCase(locale);
        if (!h) continue;
        const prev = headlines.get(`${locale}:${h}`);
        if (prev) issues.warn('shot.duplicate-headline', `${where} (${locale}): headline is the same as ${prev}; each screenshot should convey a single idea.`, { locale });
        headlines.set(`${locale}:${h}`, s.id);
      }
      checkIds(s.featureIds, where);
      if (s.stat) checkIds([s.stat.featureId], `${where} stat`);
      s.badges.forEach((b, i) => checkBadge(b, `${where} badge ${i + 1}`));
      for (const locale of config.app.locales) {
        const copy = s.copy[locale];
        if (!copy) {
          issues.error('shot.missing-copy', `${where}: no headline for ${locale}.`, { locale, file: 'metadata/shots.json' });
          continue;
        }
        const plain = copy.headline.replace(/\*/g, '');
        const words = wordCount(plain, locale);
        const cjk = /^(ja|zh|ko|th)/.test(locale);
        if (!cjk && words > MAX_HEADLINE_WORDS) issues.error('shot.headline-words', `${where} (${locale}): headline is ${words} words; maximum ${MAX_HEADLINE_WORDS}.`, { locale });
        else if (!cjk && words > IDEAL_HEADLINE_WORDS) issues.warn('shot.headline-long', `${where} (${locale}): headline is ${words} words; at most ${IDEAL_HEADLINE_WORDS} is recommended so it reads in 2 seconds.`, { locale, fix: 'Cut words or move some into the kicker/subheadline.' });
        if (copy.kicker && wordCount(copy.kicker, locale) > 3) issues.warn('shot.kicker-long', `${where} (${locale}): kicker exceeds 3 words.`, { locale });
        if ((copy.headline.match(/\*/g) ?? []).length % 2) issues.error('shot.accent-markup', `${where} (${locale}): unbalanced *accent* markers.`, { locale });
        const bullets = s.bullets.map((b) => b[locale] ?? '');
        if (bullets.some((b) => !b)) issues.error('shot.bullet-missing', `${where} (${locale}): a bullets line has no ${locale} text.`, { locale });
        for (const b of bullets) if (graphemeLength(b) > 32) issues.warn('shot.bullet-long', `${where} (${locale}): “${b}” is long for a bullet; keep each line to a few words (≤ 32 characters).`, { locale });
        const texts = [copy.kicker, plain, copy.subheadline, ...s.badges.map((b) => b.label[locale] ?? ''), ...bullets].join(' \n ');
        for (const t of [...(forbidden.cta[baseLanguage(locale)] ?? []), ...(forbidden.cta.en ?? [])]) {
          if (texts.toLocaleLowerCase(locale).includes(t)) issues.error('shot.cta', `${where} (${locale}): calls to action (“${t}”) are not allowed in screenshots.`, { locale });
        }
        for (const t of forbidden.otherPlatforms) {
          if (new RegExp(`\\b${t}\\b`, 'i').test(texts)) issues.error('shot.other-platform', `${where} (${locale}): other platform names (“${t}”) are not allowed.`, { locale });
        }
        // Apple asset best practices: no pricing or discounts, website URLs, copyright symbols or Apple recognitions;
        // Kids Category wording is reserved (2.3.8); placeholders never ship (2.1).
        const base = baseLanguage(locale);
        const price = [...new Set([...(forbidden.price['*'] ?? []), ...(forbidden.price[base] ?? [])])].find((t) => containsTerm(texts, t, locale));
        if (price) issues.error('shot.price', `${where} (${locale}): pricing or discount wording (“${price}”) is not allowed on screenshots.`, { locale });
        if (URL_ON_ASSET_RE.test(texts)) issues.error('shot.url', `${where} (${locale}): website addresses are not allowed on screenshots.`, { locale });
        if (/[©®]/.test(texts)) issues.error('shot.copyright', `${where} (${locale}): copyright or registered symbols are not allowed on screenshots.`, { locale });
        const award = findAppleAward(texts, forbidden, locale);
        if (award) issues.error('shot.apple-award', `${where} (${locale}): Apple-designated recognitions (“${award}”) are not allowed on assets.`, { locale });
        const kids = findKidsTerm(texts, forbidden, locale);
        if (kids) issues.warn('shot.kids-reserved', `${where} (${locale}): “${kids}” is reserved for apps in the Kids Category (App Review 2.3.8, 5.1.4).`, { locale });
        const ph = findPlaceholder(texts);
        if (ph) issues.error('shot.placeholder', `${where} (${locale}): template text (“${ph}”) in the screenshot copy.`, { locale });
        // The same shots become the Google Play set: Play's metadata policy forbids ranking claims and other stores on graphics.
        if (onPlay(s)) {
          const superlative = [...new Set([...(forbidden.superlatives['*'] ?? []), ...(forbidden.superlatives[base] ?? [])])].find((t) => containsTerm(texts, t, locale));
          if (superlative) issues.error('shot.play-superlative', `${where} (${locale}): “${superlative}” on a Google Play screenshot; Play does not allow ranking or performance claims in store graphics.`, { locale, fix: 'Rephrase, or restrict the shot to App Store targets with `targets`.' });
          const apple = forbidden.appleTrademarks.find((t) => containsTerm(texts, t, locale));
          if (apple) issues.error('shot.play-apple-term', `${where} (${locale}): “${apple}” on a Google Play screenshot.`, { locale, fix: 'Rephrase, or restrict the shot to App Store targets with `targets`.' });
        }
        if (/^(ja|zh|ko)/.test(locale) && graphemeLength(copy.headline) > 16) issues.warn('shot.headline-long', `${where} (${locale}): headline exceeds 16 characters.`, { locale });
        for (const b of s.badges) if (!b.label[locale]) issues.error('badge.missing-label', `${where}: badge label missing for ${locale}.`, { locale });
      }
      const ids = s.id;
      if (shots.shots.filter((x) => x.id === ids).length > 1) issues.error('shot.duplicate-id', `${where}: the same sequence number is used by more than one screenshot.`);
      if (onPlay(s) && s.archetype === 'testimonial') issues.warn('shot.play-testimonial', `${where}: App Store reviews would appear on the Google Play listing; restrict the shot to App Store targets with \`targets\`.`);
    }
    if (shots.shots.some((s) => s.photo)) {
      issues.info('shot.photo-rights', 'Screenshots use developer photos: they must be yours or licensed for App Store marketing, with a model release for every recognisable person.', { file: 'metadata/shots.json' });
    }
    if (shots.shots.length) {
      const ordered = [...shots.shots].sort((a, b) => a.id.localeCompare(b.id));
      const ui = ordered.filter((x) => !NON_UI_ARCHETYPES.includes(x.archetype)).length;
      if (ui / ordered.length < MIN_REAL_UI_RATIO) {
        issues.warn('shot.real-ui-ratio', `${ui}/${ordered.length} screenshots show real UI; at least ${MIN_REAL_UI_RATIO * 100}% is recommended (App Review 2.3).`);
      }
      if (!ordered.slice(0, 3).some((x) => !NON_UI_ARCHETYPES.includes(x.archetype))) {
        issues.error('shot.first-three-ui', 'None of the first 3 screenshots shows the app UI; most users never look past the third screenshot.');
      }
      const positions = new Set(ordered.filter((x) => !NON_UI_ARCHETYPES.includes(x.archetype)).map((x) => x.captionPosition));
      if (positions.size > 1) issues.info('shot.mixed-caption-position', 'Captions are both above and below; a single position usually reads better for consistency.');
      const sorted = [...shots.shots].map((s) => Number(s.id)).sort((a, b) => a - b);
      sorted.forEach((n, i) => {
        if (n !== i + 1) issues.warn('shot.order-gap', `Screenshot sequence numbers must start at 01 and be consecutive (found: ${sorted.join(', ')}).`);
      });
    }
    for (const [name, c] of Object.entries({ header: shots.creatives.header, search: shots.creatives.search })) {
      if (!c) continue;
      checkIds(c.featureIds, `Creative ${name}`);
      c.badges.forEach((b, i) => checkBadge(b, `Creative ${name} badge ${i + 1}`));
    }
    for (const e of shots.creatives.events) {
      checkIds([...e.card.featureIds, ...e.detail.featureIds], `Event ${e.id}`);
      checkEvent(e, config.app.locales, issues);
    }
  }

  if (cpp) {
    const shotIds = new Set(shots?.shots.map((s) => s.id) ?? []);
    for (const page of cpp.pages) {
      const where = `Custom Product Page ${page.id}`;
      const file = 'metadata/cpp-suggestions.json';
      if (page.featureIds.length) checkIds(page.featureIds, where);
      if (!page.shots.length) {
        issues.warn('cpp.no-shots', `${where}: no screenshots of its own; a page that only changes the promotional text barely moves conversion — list this audience's shots in \`shots\`, its hero first.`, { file });
      }
      for (const id of page.shots) if (shots && !shotIds.has(id)) issues.error('cpp.unknown-shot', `${where}: shot “${id}” is not in shots.json.`, { file });
      for (const [id, byLocale] of Object.entries(page.copy)) {
        if (!page.shots.includes(id)) issues.warn('cpp.copy-unused', `${where}: copy for shot “${id}”, which is not in the page's \`shots\`.`, { file });
        for (const [locale, copy] of Object.entries(byLocale)) {
          const words = wordCount(copy.headline.replace(/\*/g, ''), locale);
          if (!/^(ja|zh|ko|th)/.test(locale) && words > MAX_HEADLINE_WORDS) issues.error('shot.headline-words', `${where} shot ${id} (${locale}): headline is ${words} words; maximum ${MAX_HEADLINE_WORDS}.`, { locale, file });
        }
      }
    }
  }

  if (experiments) {
    const file = 'metadata/experiments.json';
    const original = (shots?.shots ?? []).map((s) => s.id).sort();
    const open = experiments.experiments.filter((e) => !e.result);
    if (open.length > 1) issues.warn('experiment.one-at-a-time', `${open.length} tests have no result; App Store Connect runs one test at a time — upload them one after another.`, { file });
    for (const e of experiments.experiments) {
      const where = `Test ${e.id}`;
      if (e.result) {
        const winners = ['original', 'inconclusive', ...e.treatments.map((t) => t.id)];
        if (!winners.includes(e.result.winner)) issues.error('experiment.result', `${where}: winner “${e.result.winner}” is not original, inconclusive or one of its treatments.`, { file });
        continue;
      }
      if (e.hypothesis.trim().length < 30) issues.error('experiment.hypothesis', `${where}: write the hypothesis out — “If we <change>, <metric> will <improve> because <reason>.”`, { file });
      for (const t of e.treatments) {
        const at = `${where} treatment ${t.id}`;
        const order = t.shots.length > 0 && t.shots.join() !== original.join();
        const copy = Object.keys(t.copy).length > 0;
        const icon = Boolean(t.appIconName);
        if (!order && !copy && !icon) issues.error('experiment.no-change', `${at}: nothing differs from the original product page.`, { file });
        // One variable per test, or the result cannot say which change worked.
        if ([order, copy, icon].filter(Boolean).length > 1) issues.warn('experiment.many-changes', `${at}: changes more than one thing (order, copy, icon); the result could not say which one worked.`, { file });
        if (e.element === 'icon' && !icon) issues.error('experiment.element', `${at}: an icon test needs \`appIconName\` (an alternate icon in the build).`, { file });
        if (e.element === 'screenshots' && icon) issues.warn('experiment.element', `${at}: changes the icon in a screenshot test; make it an icon test of its own.`, { file });
        for (const id of t.shots) if (shots && !original.includes(id)) issues.error('experiment.unknown-shot', `${at}: shot “${id}” is not in shots.json.`, { file });
        for (const [id, byLocale] of Object.entries(t.copy)) {
          if (shots && !original.includes(id)) issues.error('experiment.unknown-shot', `${at}: copy for shot “${id}”, which is not in shots.json.`, { file });
          for (const [locale, c] of Object.entries(byLocale)) {
            const words = wordCount(c.headline.replace(/\*/g, ''), locale);
            if (!/^(ja|zh|ko|th)/.test(locale) && words > MAX_HEADLINE_WORDS) issues.error('shot.headline-words', `${at} shot ${id} (${locale}): headline is ${words} words; maximum ${MAX_HEADLINE_WORDS}.`, { locale, file });
          }
        }
      }
      const days = experimentDays(e);
      const lift = Math.round(e.minimumDetectableEffect * 100);
      if (days === undefined) issues.info('experiment.duration-unknown', `${where}: add dailyPageViews and baselineConversion (App Store Connect → Analytics) to estimate how long it runs.`, { file });
      else if (days > 90) issues.warn('experiment.too-slow', `${where}: needs about ${days} days to see +${lift} %; a test runs at most 90 — test a bolder change (a higher minimumDetectableEffect) or fewer treatments.`, { file });
      else issues.info('experiment.duration', `${where}: about ${Math.max(days, 7)} days to see +${lift} % (Apple needs at least 7 and 90 % confidence).`, { file });
    }
  }

  if (videoPlan) {
    for (const p of videoPlan.previews) {
      for (const b of p.beats) checkIds(b.featureIds, `Video ${p.id} beat`);
      const textBeats = p.beats.filter((b) => b.scene === 'text');
      // App Previews must mostly show the real app (Apple: footage captured from the app).
      if (textBeats.length > 2) issues.warn('video.text-heavy', `Video ${p.id}: ${textBeats.length} text cards; a preview should mostly show app footage (at most 2).`);
      p.beats.forEach((b, i) => {
        const where = `Video ${p.id} beat ${i + 1} (${b.scene})`;
        if (b.scene !== 'text' && b.scene !== 'flow' && !b.source) issues.error('video.beat-source', `${where}: source is required.`);
        if (b.scene === 'flow') {
          if (b.steps.length < 2) issues.error('video.beat-flow', `${where}: a flow needs at least 2 steps (screens).`);
          // Each screen should be on screen long enough to read before the next one arrives.
          else if ((b.to - b.from) / b.steps.length < 0.6) issues.warn('video.flow-fast', `${where}: ${b.steps.length} screens in ${(b.to - b.from).toFixed(1)} s; give each at least 0.6 s.`);
        }
        if (b.scene === 'text' && b.to - b.from > 1.5) issues.warn('video.text-long', `${where}: text card is longer than 1.5 s.`);
        if (b.scene === 'zoom' && !b.zoom) issues.error('video.beat-zoom', `${where}: a zoom rectangle is required.`);
        if (b.scene === 'split' && !b.secondSource) issues.error('video.beat-split', `${where}: secondSource is required.`);
        if (b.scene === 'stat') {
          if (!b.stat) issues.error('video.beat-stat', `${where}: stat is required.`);
          else checkIds([b.stat.featureId], `${where} counter`);
        }
        if (b.scene === 'badges') {
          if (!b.badges.length) issues.error('video.beat-badges', `${where}: at least one badge is required.`);
          checkIds(b.badges.map((x) => x.featureId), `${where} badge`);
          for (const locale of config.app.locales) for (const x of b.badges) if (!x.label[locale]) issues.error('video.missing-copy', `${where}: badge label missing for ${locale}.`, { locale });
        }
        if ((b.caption ? Object.values(b.caption).join('') : '').split('*').length % 2 === 0) issues.error('video.accent-markup', `${where}: unbalanced *accent* markers.`);
      });
      for (const locale of config.app.locales) {
        if (!p.hook[locale]) issues.error('video.missing-copy', `Video ${p.id}: no hook text for ${locale}.`, { locale });
        for (const b of p.beats) if (!b.caption[locale] && b.scene !== 'device' && b.scene !== 'flow') issues.error('video.missing-copy', `Video ${p.id}: no beat caption for ${locale}.`, { locale });
        if (p.outro && !p.outro.title[locale]) issues.error('video.missing-copy', `Video ${p.id}: no closing line for ${locale}.`, { locale });
      }
    }
    for (const [name, loop] of Object.entries(videoPlan.loops)) {
      if (loop) checkIds(loop.featureIds, `Loop ${name}`);
    }
  }

  return issues;
}

const PLAY_SCREENSHOT = /^play-(phone|tablet)/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** In-App Event copy limits, the deep link App Review needs, and Apple's schedule rules (15 min – 31 days, promoted ≤ 14 days ahead). */
function checkEvent(e: NonNullable<ShotList['creatives']['events']>[number], locales: string[], issues: IssueList): void {
  const where = `In-App Event ${e.id}`;
  for (const locale of locales) {
    for (const field of ['name', 'shortDescription', 'longDescription'] as const) {
      const v = e[field][locale];
      const max = EVENT_LIMITS[field];
      if (!v?.trim()) issues.error('event.missing-copy', `${where}: no ${field} for ${locale}.`, { locale });
      else if (graphemeLength(v) > max) issues.error('event.too-long', `${where}: ${field} is ${graphemeLength(v)}/${max} characters (${locale}).`, { locale, fix: `Shorten by ${graphemeLength(v) - max}.` });
    }
  }
  if (!e.deepLink) issues.warn('event.deep-link', `${where}: no deepLink; App Review needs one that opens the event in the app.`);
  if (!e.schedule) {
    issues.warn('event.no-schedule', `${where}: no schedule; the draft gets one in App Store Connect before it can be submitted.`);
    return;
  }
  const start = Date.parse(e.schedule.eventStart);
  const end = Date.parse(e.schedule.eventEnd);
  const publish = e.schedule.publishStart ? Date.parse(e.schedule.publishStart) : start;
  if ([start, end, publish].some(Number.isNaN)) {
    issues.error('event.schedule', `${where}: schedule times must be RFC 3339 (2026-11-20T09:00:00Z).`);
    return;
  }
  if (end - start < 15 * MINUTE) issues.error('event.schedule', `${where}: the event must run at least 15 minutes.`);
  if (end - start > 31 * DAY) issues.error('event.schedule', `${where}: the event runs ${Math.round((end - start) / DAY)} days; at most 31.`);
  if (publish > start) issues.error('event.schedule', `${where}: publishStart is after eventStart.`);
  if (start - publish > 14 * DAY) issues.error('event.schedule', `${where}: it is promoted ${Math.round((start - publish) / DAY)} days ahead; at most 14.`);
  if (start < Date.now()) issues.warn('event.schedule-past', `${where}: the event starts in the past.`);
}
