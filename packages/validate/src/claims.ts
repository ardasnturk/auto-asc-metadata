import { baseLanguage, existsSync, graphemeLength, loadForbiddenTerms, wordCount } from '@vitrin/core';
import { IDEAL_HEADLINE_WORDS, MAX_HEADLINE_WORDS, MIN_REAL_UI_RATIO, NON_UI_ARCHETYPES, type AppProfile, type Badge, type Competitors, type ShotList, type VideoPlan, type VitrinConfig } from '@vitrin/schemas';
import { join } from 'node:path';
import { IssueList } from './issues.js';

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
  enabledTargets: string[];
}): IssueList {
  const { config, profile, shots, videoPlan, competitors } = opts;
  const issues = new IssueList();
  const features = new Map(profile.features.map((f) => [f.id, f]));

  for (const f of profile.features) {
    for (const ev of f.evidence) {
      if (!existsSync(join(profile.project.root, ev.path))) {
        issues.error('evidence.missing-file', `Evidence file for feature “${f.id}” does not exist: ${ev.path}.`, { file: '.vitrin/app_profile.json', fix: 'Point the evidence to a real file or remove the feature.' });
      }
    }
  }

  const checkIds = (ids: string[], where: string) => {
    for (const id of ids) {
      if (!features.has(id)) issues.error('claim.unknown-feature', `${where}: “${id}” is not an evidenced feature in app_profile.`, { file: '.vitrin/shots.json', fix: 'Do not show features the app does not have (App Review 2.3).' });
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
          (p === 'apple-watch' && profile.project.targets.some((t) => t.kind === 'watch')) ||
          (p === 'widgets' && profile.project.targets.some((t) => t.kind === 'widget')) ||
          (p === 'iphone-duo' && opts.enabledTargets.some((t) => t.startsWith('duo-'))) ||
          (p === 'mac' && profile.project.targets.some((t) => t.devices.includes('mac'))) ||
          (p === 'vision' && profile.project.targets.some((t) => t.devices.includes('vision')));
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
          issues.error('shot.missing-copy', `${where}: no headline for ${locale}.`, { locale, file: '.vitrin/shots.json' });
          continue;
        }
        const plain = copy.headline.replace(/\*/g, '');
        const words = wordCount(plain, locale);
        const cjk = /^(ja|zh|ko|th)/.test(locale);
        if (!cjk && words > MAX_HEADLINE_WORDS) issues.error('shot.headline-words', `${where} (${locale}): headline is ${words} words; maximum ${MAX_HEADLINE_WORDS}.`, { locale });
        else if (!cjk && words > IDEAL_HEADLINE_WORDS) issues.warn('shot.headline-long', `${where} (${locale}): headline is ${words} words; at most ${IDEAL_HEADLINE_WORDS} is recommended so it reads in 2 seconds.`, { locale, fix: 'Cut words or move some into the kicker/subheadline.' });
        if (copy.kicker && wordCount(copy.kicker, locale) > 3) issues.warn('shot.kicker-long', `${where} (${locale}): kicker exceeds 3 words.`, { locale });
        if ((copy.headline.match(/\*/g) ?? []).length % 2) issues.error('shot.accent-markup', `${where} (${locale}): unbalanced *accent* markers.`, { locale });
        const texts = [copy.kicker, plain, copy.subheadline, ...s.badges.map((b) => b.label[locale] ?? '')].join(' \n ');
        for (const t of [...(forbidden.cta[baseLanguage(locale)] ?? []), ...(forbidden.cta.en ?? [])]) {
          if (texts.toLocaleLowerCase(locale).includes(t)) issues.error('shot.cta', `${where} (${locale}): calls to action (“${t}”) are not allowed in screenshots.`, { locale });
        }
        for (const t of forbidden.otherPlatforms) {
          if (new RegExp(`\\b${t}\\b`, 'i').test(texts)) issues.error('shot.other-platform', `${where} (${locale}): other platform names (“${t}”) are not allowed.`, { locale });
        }
        if (/^(ja|zh|ko)/.test(locale) && graphemeLength(copy.headline) > 16) issues.warn('shot.headline-long', `${where} (${locale}): headline exceeds 16 characters.`, { locale });
        for (const b of s.badges) if (!b.label[locale]) issues.error('badge.missing-label', `${where}: badge label missing for ${locale}.`, { locale });
      }
      const ids = s.id;
      if (shots.shots.filter((x) => x.id === ids).length > 1) issues.error('shot.duplicate-id', `${where}: the same sequence number is used by more than one screenshot.`);
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
        if (b.scene !== 'text' && !b.source) issues.error('video.beat-source', `${where}: source is required.`);
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
        for (const b of p.beats) if (!b.caption[locale] && b.scene !== 'device') issues.error('video.missing-copy', `Video ${p.id}: no beat caption for ${locale}.`, { locale });
      }
    }
    for (const [name, loop] of Object.entries(videoPlan.loops)) {
      if (loop) checkIds(loop.featureIds, `Loop ${name}`);
    }
  }

  return issues;
}
