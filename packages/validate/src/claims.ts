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
        issues.error('evidence.missing-file', `“${f.id}” özelliğinin kanıt dosyası yok: ${ev.path}.`, { file: '.vitrin/app_profile.json', fix: 'Kanıtı gerçek bir dosyaya bağla ya da özelliği kaldır.' });
      }
    }
  }

  const checkIds = (ids: string[], where: string) => {
    for (const id of ids) {
      if (!features.has(id)) issues.error('claim.unknown-feature', `${where}: “${id}” app_profile’da kanıtlı bir özellik değil.`, { file: '.vitrin/shots.json', fix: 'Uygulamada olmayan özelliği gösterme (App Review 2.3).' });
    }
  };

  const checkBadge = (b: Badge, where: string) => {
    if (b.style === 'laurel' && b.type !== 'proof') {
      issues.error('badge.laurel-without-proof', `${where}: defne (laurel) stili ödül/puan izlenimi verir; yalnız doğrulanabilir proof rozetinde kullanılır.`);
    }
    switch (b.type) {
      case 'feature':
      case 'new':
        if (!b.featureId) issues.error('badge.no-feature', `${where}: ${b.type} rozeti featureId olmadan kullanılamaz.`);
        else checkIds([b.featureId], `${where} rozet`);
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
        if (!p) issues.error('badge.platform-missing', `${where}: platform rozetinde platform alanı yok.`);
        else if (!ok) issues.error('badge.platform-unsupported', `${where}: “${p}” rozeti için projede destek yok.`);
        break;
      }
      case 'proof': {
        const proof = b.proof;
        if (!proof) {
          issues.error('badge.proof-missing', `${where}: proof rozeti doğrulanabilir veri (proof) olmadan kullanılamaz.`);
        } else if (proof.kind === 'rating') {
          const self = competitors?.self;
          if (!self) issues.error('badge.proof-unverified', `${where}: puan rozeti için uygulama App Store’da bulunamadı (Lookup).`);
          else if (self.trackId !== proof.trackId || Math.abs((self.averageUserRating ?? 0) - proof.value) > 0.05 || (self.userRatingCount ?? 0) < proof.count) {
            issues.error('badge.proof-mismatch', `${where}: puan rozeti Lookup verisiyle uyuşmuyor (gerçek: ${self.averageUserRating?.toFixed(1)} / ${self.userRatingCount}).`);
          }
        } else {
          issues.warn('badge.award-manual', `${where}: ödül rozeti (${proof.name}) otomatik doğrulanamadı; ${proof.url} kaynağını kontrol et.`);
        }
        break;
      }
    }
    for (const [locale, label] of Object.entries(b.label)) {
      if (/\d+[.,]?\d*\s*(₺|\$|€|£|TL|USD)/i.test(label)) issues.error('badge.price', `${where} (${locale}): fiyat rozeti kullanılamaz.`);
    }
  };

  if (shots) {
    const forbidden = loadForbiddenTerms();
    const selfReviews = (competitors?.self?.reviews ?? []).map((r) => `${r.title}\n${r.content}`.toLocaleLowerCase());
    const headlines = new Map<string, string>();
    for (const s of shots.shots) {
      const where = `Görsel ${s.id}_${s.slug}`;
      const need = { split: 2, 'before-after': 2, collage: 3 } as Record<string, number>;
      if (!NON_UI_ARCHETYPES.includes(s.archetype) && s.screens.length < (need[s.archetype] ?? 1)) {
        issues.error('shot.screens', `${where}: ${s.archetype} için en az ${need[s.archetype] ?? 1} ekran gerekli.`);
      }
      if (s.archetype === 'callout' && !s.callouts.length) issues.error('shot.callouts', `${where}: callout arketipi en az bir callouts öğesi ister.`);
      if (s.archetype === 'stat' && !s.stat) issues.error('shot.stat', `${where}: stat arketipi stat.value ister.`);
      if (s.archetype === 'testimonial') {
        for (const locale of config.app.locales) {
          const quotes = s.quotes[locale] ?? [];
          if (!quotes.length) issues.error('quote.missing', `${where} (${locale}): bu dilde gerçek yorum yok; testimonial yalnız App Store’daki yorumlarla yapılır.`, { locale, fix: 'Bu dil için shot.targets/dil kapsamını daralt ya da başka arketip seç.' });
          for (const q of quotes) {
            const needle = q.text.toLocaleLowerCase().replace(/[“”"…]/g, '').trim();
            if (!selfReviews.some((r) => r.includes(needle))) {
              issues.error('quote.unverified', `${where} (${locale}): “${q.text}” uygulamanın App Store yorumlarında birebir bulunamadı (uydurma ya da çeviri yorum kullanılamaz).`, { locale });
            }
          }
        }
      }
      for (const locale of config.app.locales) {
        const h = s.copy[locale]?.headline.replace(/\*/g, '').trim().toLocaleLowerCase(locale);
        if (!h) continue;
        const prev = headlines.get(`${locale}:${h}`);
        if (prev) issues.warn('shot.duplicate-headline', `${where} (${locale}): başlık ${prev} ile aynı; her görsel tek bir fikir anlatmalı.`, { locale });
        headlines.set(`${locale}:${h}`, s.id);
      }
      checkIds(s.featureIds, where);
      if (s.stat) checkIds([s.stat.featureId], `${where} istatistik`);
      s.badges.forEach((b, i) => checkBadge(b, `${where} rozet ${i + 1}`));
      for (const locale of config.app.locales) {
        const copy = s.copy[locale];
        if (!copy) {
          issues.error('shot.missing-copy', `${where}: ${locale} için başlık yok.`, { locale, file: '.vitrin/shots.json' });
          continue;
        }
        const plain = copy.headline.replace(/\*/g, '');
        const words = wordCount(plain, locale);
        const cjk = /^(ja|zh|ko|th)/.test(locale);
        if (!cjk && words > MAX_HEADLINE_WORDS) issues.error('shot.headline-words', `${where} (${locale}): başlık ${words} kelime; en çok ${MAX_HEADLINE_WORDS}.`, { locale });
        else if (!cjk && words > IDEAL_HEADLINE_WORDS) issues.warn('shot.headline-long', `${where} (${locale}): başlık ${words} kelime; 2 saniyede okunması için en fazla ${IDEAL_HEADLINE_WORDS} önerilir.`, { locale, fix: 'Kelime sayısını azalt ya da bir kısmını kicker/alt başlığa taşı.' });
        if (copy.kicker && wordCount(copy.kicker, locale) > 3) issues.warn('shot.kicker-long', `${where} (${locale}): kicker 3 kelimeyi aşıyor.`, { locale });
        if ((copy.headline.match(/\*/g) ?? []).length % 2) issues.error('shot.accent-markup', `${where} (${locale}): *vurgu* işaretleri eşleşmiyor.`, { locale });
        const texts = [copy.kicker, plain, copy.subheadline, ...s.badges.map((b) => b.label[locale] ?? '')].join(' \n ');
        for (const t of [...(forbidden.cta[baseLanguage(locale)] ?? []), ...(forbidden.cta.en ?? [])]) {
          if (texts.toLocaleLowerCase(locale).includes(t)) issues.error('shot.cta', `${where} (${locale}): eylem çağrısı (“${t}”) ekran görüntüsünde kullanılmaz.`, { locale });
        }
        for (const t of forbidden.otherPlatforms) {
          if (new RegExp(`\\b${t}\\b`, 'i').test(texts)) issues.error('shot.other-platform', `${where} (${locale}): başka platform adı (“${t}”) kullanılamaz.`, { locale });
        }
        if (/^(ja|zh|ko)/.test(locale) && graphemeLength(copy.headline) > 16) issues.warn('shot.headline-long', `${where} (${locale}): başlık 16 karakteri aşıyor.`, { locale });
        for (const b of s.badges) if (!b.label[locale]) issues.error('badge.missing-label', `${where}: rozet etiketi ${locale} dilinde yok.`, { locale });
      }
      const ids = s.id;
      if (shots.shots.filter((x) => x.id === ids).length > 1) issues.error('shot.duplicate-id', `${where}: aynı sıra numarası birden fazla görselde.`);
    }
    if (shots.shots.length) {
      const ordered = [...shots.shots].sort((a, b) => a.id.localeCompare(b.id));
      const ui = ordered.filter((x) => !NON_UI_ARCHETYPES.includes(x.archetype)).length;
      if (ui / ordered.length < MIN_REAL_UI_RATIO) {
        issues.warn('shot.real-ui-ratio', `Görsellerin ${ui}/${ordered.length} tanesi gerçek arayüz gösteriyor; en az %${MIN_REAL_UI_RATIO * 100} önerilir (App Review 2.3).`);
      }
      if (!ordered.slice(0, 3).some((x) => !NON_UI_ARCHETYPES.includes(x.archetype))) {
        issues.error('shot.first-three-ui', 'İlk 3 görselin hiçbiri uygulama arayüzü göstermiyor; kullanıcıların çoğu 3. görselden sonrasını görmez.');
      }
      const positions = new Set(ordered.filter((x) => !NON_UI_ARCHETYPES.includes(x.archetype)).map((x) => x.captionPosition));
      if (positions.size > 1) issues.info('shot.mixed-caption-position', 'Başlıklar hem üstte hem altta; tutarlılık için tek konum genelde daha iyi okunur.');
      const sorted = [...shots.shots].map((s) => Number(s.id)).sort((a, b) => a - b);
      sorted.forEach((n, i) => {
        if (n !== i + 1) issues.warn('shot.order-gap', `Görsel sıra numaraları 01’den başlayıp ardışık olmalı (bulunan: ${sorted.join(', ')}).`);
      });
    }
    for (const [name, c] of Object.entries({ header: shots.creatives.header, search: shots.creatives.search })) {
      if (!c) continue;
      checkIds(c.featureIds, `Kreatif ${name}`);
      c.badges.forEach((b, i) => checkBadge(b, `Kreatif ${name} rozet ${i + 1}`));
    }
    for (const e of shots.creatives.events) {
      checkIds([...e.card.featureIds, ...e.detail.featureIds], `Etkinlik ${e.id}`);
    }
  }

  if (videoPlan) {
    for (const p of videoPlan.previews) {
      for (const b of p.beats) checkIds(b.featureIds, `Video ${p.id} vuruş`);
      const textBeats = p.beats.filter((b) => b.scene === 'text');
      // App Previews must mostly show the real app (Apple: footage captured from the app).
      if (textBeats.length > 2) issues.warn('video.text-heavy', `Video ${p.id}: ${textBeats.length} metin kartı var; önizleme ağırlıkla uygulama görüntüsü göstermeli (en çok 2).`);
      p.beats.forEach((b, i) => {
        const where = `Video ${p.id} vuruş ${i + 1} (${b.scene})`;
        if (b.scene !== 'text' && !b.source) issues.error('video.beat-source', `${where}: source gerekli.`);
        if (b.scene === 'text' && b.to - b.from > 1.5) issues.warn('video.text-long', `${where}: metin kartı 1,5 sn’den uzun.`);
        if (b.scene === 'zoom' && !b.zoom) issues.error('video.beat-zoom', `${where}: zoom dikdörtgeni gerekli.`);
        if (b.scene === 'split' && !b.secondSource) issues.error('video.beat-split', `${where}: secondSource gerekli.`);
        if (b.scene === 'stat') {
          if (!b.stat) issues.error('video.beat-stat', `${where}: stat gerekli.`);
          else checkIds([b.stat.featureId], `${where} sayaç`);
        }
        if (b.scene === 'badges') {
          if (!b.badges.length) issues.error('video.beat-badges', `${where}: en az bir rozet gerekli.`);
          checkIds(b.badges.map((x) => x.featureId), `${where} rozet`);
          for (const locale of config.app.locales) for (const x of b.badges) if (!x.label[locale]) issues.error('video.missing-copy', `${where}: rozet etiketi ${locale} dilinde yok.`, { locale });
        }
        if ((b.caption ? Object.values(b.caption).join('') : '').split('*').length % 2 === 0) issues.error('video.accent-markup', `${where}: *vurgu* işaretleri eşleşmiyor.`);
      });
      for (const locale of config.app.locales) {
        if (!p.hook[locale]) issues.error('video.missing-copy', `Video ${p.id}: ${locale} kanca metni yok.`, { locale });
        for (const b of p.beats) if (!b.caption[locale] && b.scene !== 'device') issues.error('video.missing-copy', `Video ${p.id}: ${locale} vuruş metni yok.`, { locale });
      }
    }
    for (const [name, loop] of Object.entries(videoPlan.loops)) {
      if (loop) checkIds(loop.featureIds, `Döngü ${name}`);
    }
  }

  return issues;
}
