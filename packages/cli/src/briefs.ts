import { localeInfo, readJsonIfExists, storefrontForLocale, storefrontInfo, writeText } from '@vitrin/core';
import { Competitors, KeywordPlan, type AppProfile } from '@vitrin/schemas';
import { FONT_FAMILIES } from '@vitrin/render';
import { join } from 'node:path';
import type { Ctx } from './context.js';

/**
 * Briefs are the hand-off from the deterministic CLI to Claude: a compact summary of the inputs plus the exact
 * file Claude must write. The CLI exits with code 2 after writing one; the skill reads it, writes the JSON,
 * and re-runs the command.
 */
export async function writeBrief(ctx: Ctx, name: string, body: string): Promise<string> {
  const file = join(ctx.paths.briefs, `${name}.md`);
  await writeText(file, body);
  return file;
}

function featureTable(profile: AppProfile): string {
  return profile.features
    .map((f) => `| \`${f.id}\` | ${f.title} | ${f.kind} | ${f.evidence.map((e) => `${e.path}${e.line ? `:${e.line}` : ''}`).slice(0, 2).join(', ')} |`)
    .join('\n');
}

export async function profileBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  return writeBrief(
    ctx,
    'analyze',
    `# Brief: app_profile’ı tamamla

Dosya: \`.vitrin/app_profile.json\` (şema: AppProfile). Analyzer deterministik kısmı doldurdu. Sen şunları yap:

1. Kaynak kodu (özellikle ekran/görünüm dosyalarını) oku ve analyzer’ın göremediği **çekirdek özellikleri** \`features\` listesine ekle:
   \`{ "id": "kebab-case", "title": "…", "description": "…", "kind": "core", "evidence": [{ "path": "proje köküne göre yol", "line": 12 }], "confidence": "high", "source": "claude" }\`
   Kanıt gerçek bir dosya olmalı; uygulamada olmayan hiçbir özelliği ekleme (App Review 2.3). Pazarlama metni (paywall maddeleri vb.) kanıt değildir, çalışan kod kanıttır.
2. \`positioning\` alanını doldur: \`{ "audience": "…", "jobToBeDone": "…", "tone": "…" }\`.
3. \`categorySuggestion\` gerekirse düzelt (ASC kategori sabiti, ör. HEALTH_AND_FITNESS) ve gerekçesini yaz.
4. \`vitrin.config.yaml\` içinde \`research.seeds\` alanına her dil için 4–8 tohum arama terimi yaz (kullanıcının App Store’da gerçekten yazacağı ifadeler; rakip markası değil).
5. \`capture.screens\` listesini uygulamanın gösterilmeye değer 5–8 ekranıyla doldur (\`-VitrinScreen <id>\` vb. launch argümanları). Uygulamada \`-VitrinDemo\` yoksa kullanıcıya eklenecek dosyayı göster (skill/references/troubleshooting.md).

Bekleyen notlar (todo):
${profile.todo.map((t) => `- ${t}`).join('\n') || '- yok'}

Mevcut özellikler:

| id | başlık | tür | kanıt |
|---|---|---|---|
${featureTable(profile)}

Bitince \`vitrin analyze\` yeniden çalıştırılmaz (eklemelerin korunur); \`vitrin research\` ile devam et.
`,
  );
}

export async function metadataBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  const competitors = await readJsonIfExists(ctx.paths.competitors, Competitors).catch(() => undefined);
  const sections: string[] = [];
  for (const locale of ctx.config.app.locales) {
    const kw = await readJsonIfExists(ctx.paths.keywordFile(locale), KeywordPlan).catch(() => undefined);
    const sf = storefrontInfo(storefrontForLocale(locale));
    const top = (kw?.candidates ?? [])
      .slice()
      .sort((a, b) => b.popularity.score * (1 - b.competition.score) - a.popularity.score * (1 - a.competition.score))
      .slice(0, 30)
      .map((c) => `${c.term} (pop ${c.popularity.score}${c.popularity.source === 'estimate' ? '~' : ''}, rek ${c.competition.score}${c.relevance !== null ? `, alaka ${c.relevance}` : ''})`)
      .join('; ');
    sections.push(`### ${locale} — ${localeInfo(locale)?.nameTr ?? locale}
- Storefront: ${sf ? `${sf.country} (varsayılan ${sf.default}; ek: ${sf.additional.join(', ') || 'yok'})` : '?'}
- Aday kelimeler (~ = tahmini popülerlik): ${top || '(research çalışmadı)'}
- Dosyalar: \`.vitrin/metadata/${locale}.json\`; ayrıca \`.vitrin/keywords/${locale}.json\` içinde her adayın \`relevance\` (0–1) alanını doldur ve \`selected\` yaz.`);
  }
  const rivals = (competitors?.apps ?? [])
    .slice(0, 12)
    .map((a) => `- ${a.name} — ${a.averageUserRating?.toFixed(1) ?? '?'}★ (${a.userRatingCount ?? 0}), ${a.storefront}`)
    .join('\n');
  return writeBrief(
    ctx,
    'write',
    `# Brief: metadata yaz

Uygulama: **${profile.app.displayName}** (${profile.app.bundleId}). Kitle: ${profile.positioning?.audience ?? '?'}. İş: ${profile.positioning?.jobToBeDone ?? '?'}. Ton: ${profile.positioning?.tone ?? '?'}.
Geliştirici: ${ctx.config.copyrightHolder ?? '?'} — bu ad kelime alanına yazılmaz.

## Kurallar (validate bunları denetler)
- Ad 2–30 karakter = marka + birincil kelime. Alt başlık ≤ 30 = fayda + ikincil kelime; addaki kelimeyi tekrar etme.
- Anahtar kelimeler ≤ **100 bayt** (UTF-8; ç ş ğ ı ö ü 2 bayt, CJK 3 bayt), virgülle ve boşluksuz, tekil, her terim > 2 karakter, ad/alt başlıktaki kelimeleri tekrar etme, rakip/şirket adı, Apple markası ve fiyat yok.
- Açıklama ≤ 4000, düz metin; ilk 3 satır kanca. Kelime doldurma yok. “#1 / en iyi / ücretsiz” gibi kanıtsız ve fiyat ifadeleri yok.
- Promosyon metni ≤ 170 (incelemesiz değişir). Yenilikler ≤ 4000, git log’dan kullanıcı diliyle (ilk sürümde boş bırak).
- Her dilde çeviri değil **yerel yeniden yazım**. Aynı storefront’ta sayılabilecek ek dillere farklı kelimeler yaz.
- Her iddia \`claims\` içinde app_profile’daki bir özelliğe bağlanır.
- en-US metni App Store etiketleri için hedef kavramları net kullansın (etiketler yalnız ABD’de en-US’ten atanır).

## Yazılacak dosyalar
\`.vitrin/metadata/<locale>.json\`:
\`\`\`json
{ "locale": "tr", "name": "", "subtitle": "", "promotionalText": "", "description": "", "keywords": "kelime1,kelime2",
  "whatsNew": "", "claims": [{ "text": "açıklamadan birebir ifade", "featureIds": ["icloud-sync"] }] }
\`\`\`
\`.vitrin/metadata/app.json\`:
\`\`\`json
{ "copyright": "${new Date().getFullYear()} ${ctx.config.copyrightHolder ?? 'Şirket'}", "primaryCategory": "${profile.categorySuggestion?.primary ?? 'PRODUCTIVITY'}", "secondaryCategory": "",
  "reviewNotes": "Demo modu, test adımları…", "ageRatingDraft": { "answers": {}, "rationale": "", "needsUserConfirmation": true },
  "accessibilityDraft": [{ "criterion": "VoiceOver", "supported": "partial", "evidence": "…" }] }
\`\`\`
İsteğe bağlı \`.vitrin/cpp-suggestions.json\`: 2–5 Custom Product Page önerisi (segment, gerekçe, çakışmayan kelime kümesi, kullanılacak görsel id’leri).

Yaş anketi ve erişilebilirlik için app_profile.signals’a bak (age.*, accessibility.*); bunlar taslaktır, son onay kullanıcıdadır.

## Diller
${sections.join('\n\n')}

## Rakipler (yalnız analiz; metin veya marka kopyalanmaz)
${rivals || '- (yok)'}
Boşluklar: ${(competitors?.analysis.gaps ?? []).join('; ') || '(competitors.json analysis.gaps alanına sen yaz)'}

Bitince: \`vitrin write\` (doğrular ve fastlane/metadata’ya aktarır).
`,
  );
}

export async function designBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  const competitors = await readJsonIfExists(ctx.paths.competitors, Competitors).catch(() => undefined);
  const palettes = (competitors?.analysis.paletteUsage ?? []).slice(0, 8).map((p) => `${p.hex}×${p.count}`).join(', ');
  const headlines = (competitors?.apps ?? []).flatMap((a) => a.screenshotText.flatMap((s) => s.lines.slice(0, 1))).slice(0, 12);
  const screens = ctx.config.capture.screens.map((s) => s.id).join(', ');
  return writeBrief(
    ctx,
    'design',
    `# Brief: sanat yönü ve görsel listesi

## Girdi
- Marka renkleri: ${profile.brand.accentColor ?? '?'} ${profile.brand.colors.map((c) => `${c.name}=${c.hex}`).join(', ')}
- Rakip paletleri (sık): ${palettes || '?'}
- Rakip ilk görsel başlıkları (OCR, yalnız analiz): ${headlines.map((h) => `“${h}”`).join(', ') || '?'}
- Yakalanan ekranlar (capture.screens): ${screens || '(yok)'}
- Fontlar (yalnız bunlar): ${Object.keys(FONT_FAMILIES).join(', ')}
- İkonlar: Lucide adları (ör. cloud, chart-column, bell, lock, sparkles). SF Symbols kullanma.

## 1) \`.vitrin/art-direction.json\`
2–3 yön öner (palet, tipografi, arka plan dili, cihaz çerçevesi) ve **rakiplerden en çok ayrışanı** seç.
\`\`\`json
{ "options": [{ "id": "deep-night", "name": "…", "rationale": "…", "differentiation": "…",
  "palette": { "background": ["#0F1029","#2B2D7A","#6C3CE0"], "surface": "#1B1C3F", "primary": "#7C7CFF", "accent": "#FFB547",
               "text": "#FFFFFF", "textMuted": "#C9CBF2", "badgeBackground": "#FFFFFF", "badgeText": "#1B1C3F" },
  "typography": { "headline": "Plus Jakarta Sans", "body": "Inter", "headlineWeight": 800, "headlineCase": "none", "letterSpacing": -0.02 },
  "background": { "style": "mesh", "angle": 160, "intensity": 0.6 },
  "device": { "frame": "minimal", "shadow": true, "tilt": 0 } }],
  "selected": "deep-night", "selectionReason": "…" }
\`\`\`
Arka plan stilleri: solid, linear, radial, mesh, grid, dots, panoramic (ardışık görsellerde devam eder). Metin/arka plan kontrastı ≥ 3:1 (validate ölçer).

## 2) \`.vitrin/shots.json\`
5–7 görsel (iPad için 3–5 yeterli). Arketipler: hero, feature, callout, fullbleed, tilted, split, collage, before-after, stat, social-proof, panoramic, statement, testimonial (bkz. skill/references/art-direction.md).
- İlk 3 görsel = kanca (sonuç) → kanıt (çekirdek eylem, gerçek UI) → güven/kazanç. En az %60 gerçek UI; ilk 3’te en az bir UI.
- Başlık en çok 5 kelime önerilir (7 sınır), en çok 2 satır, ad/alt başlıktaki **ana kelimeyi pekiştirir**. \`kicker\` küçük üst satır (≤ 3 kelime); \`*kelime*\` vurgu renginde çizilir.
- Eylem çağrısı (“Hemen indir”), başka platform adı, fiyat yok. Set boyunca tek başlık konumu (\`captionPosition\`: top/bottom).
- callout: \`"callouts": [{ "screen": 0, "rect": { "x": 0.04, "y": 0.47, "w": 0.92, "h": 0.3 }, "scale": 1.45, "side": "center", "at": 0.6 }]\` — rect yakalanan iPhone ekranının kesirleri; iPad düzeni farklıysa \`"rects": { "ipad": {…} }\`. Kesirleri bulmak için .vitrin/raw/<dil>/iphone/<id>.png dosyasını aç ve bölgeyi ölç.
- testimonial: yalnız competitors.json → self.reviews içindeki gerçek yorumların birebir metni, kendi dilinde (\`"quotes": { "tr": [{ "text": "…", "rating": 5 }] }\`).
- Her görselde başlık, (isteğe bağlı) alt başlık, ekran ve 0–3 rozet. \`featureIds\` zorunlu.
- Rozet türleri: feature (featureId zorunlu), new (featureId zorunlu), proof (yalnız Lookup’taki gerçek puan ya da belgeli ödül), platform (ipad / apple-watch / iphone-duo / widgets — yalnız gerçekten destekleniyorsa). Fiyat rozeti yok. Stil: pill | sticker | laurel (laurel yalnız proof).
\`\`\`json
{ "shots": [{ "id": "01", "slug": "hero", "archetype": "hero", "screens": ["home"], "featureIds": ["…"],
    "copy": { "tr": { "kicker": "…", "headline": "… *vurgu*", "subheadline": "…" }, "en-US": { "kicker": "…", "headline": "… *accent*", "subheadline": "…" } },
    "badges": [{ "type": "feature", "icon": "cloud", "featureId": "icloud-sync", "label": { "tr": "iCloud senkron", "en-US": "iCloud sync" } }] }],
  "creatives": { "header": { "copy": {…}, "screens": ["home","stats"], "featureIds": ["…"] },
                 "search": { "copy": {…}, "screens": ["home"], "featureIds": ["…"] }, "events": [] } }
\`\`\`
\`stat\` arketipi için \`"stat": { "value": "42 gün", "featureId": "…" }\` — değer kanıtlı olmalı (demo verisi pazarlama iddiası değildir; genel ifade seç).

Bitince: \`vitrin design\`.
`,
  );
}

export async function videoBrief(ctx: Ctx): Promise<string> {
  const recs = ctx.config.capture.recordings.map((r) => r.id);
  return writeBrief(
    ctx,
    'video',
    `# Brief: video planı

\`.vitrin/video-plan.json\` yaz (ayrıntı: skill/references/video.md). App Preview: 886×1920, 30 fps, 15–30 sn (hedef 20–25).
Gerçek uygulama görüntüsü ağırlıkta; metin kartları kısa. Kayıtların ilk ~1,5 sn’si açılıştır: \`from\` ≥ 1,5.
Kaynaklar: kayıtlar (${recs.join(', ') || 'capture.recordings boş'}) veya ekran id’leri (${ctx.config.capture.screens.map((s) => s.id).join(', ')}).

Stil: \`classic\` | \`showcase\` (3B cihaz, kamera itişi, ışık sızması) | \`kinetic\` (kelime kelime metin kartları) | \`energetic\` (eğik cihaz, bant başlık, hızlı geçişler).
Emin değilsen önce \`vitrin video --styles all\` ile dördünü üret, kullanıcıya göster.
Sahneler: device, zoom (\`zoom\` dikdörtgeni), split (\`secondSource\`), stat (\`stat\`), badges (\`badges\`), text. \`*vurgu*\` desteklenir.

\`\`\`json
{ "previews": [{ "id": "01", "device": "iphone", "style": "showcase", "transition": "auto",
    "hookSource": "home-flow", "hookFrom": 1.5, "hook": { "tr": "Günde *tek dokunuş*", "en-US": "One tap, *every day*" },
    "beats": [
      { "scene": "device", "source": "home-flow", "from": 1.5, "to": 5, "caption": { "tr": "…", "en-US": "…" }, "featureIds": ["…"] },
      { "scene": "zoom", "source": "detail", "from": 0, "to": 4, "zoom": { "x": 0.04, "y": 0.47, "w": 0.92, "h": 0.3 }, "caption": { … }, "featureIds": ["…"] },
      { "scene": "stat", "source": "stats-flow", "from": 1.5, "to": 5, "stat": { "value": 12, "suffix": { "tr": "hafta" }, "label": { "tr": "…" }, "featureId": "…" }, "caption": { … }, "featureIds": ["…"] },
      { "scene": "badges", "source": "stats-flow", "from": 2, "to": 5.5, "badges": [{ "icon": "bell", "label": { … }, "featureId": "…" }], "caption": { … }, "featureIds": ["…"] }
    ],
    "outro": { "title": { "tr": "…", "en-US": "…" }, "subtitle": { "tr": "…", "en-US": "…" } } }],
  "loops": { "header": { "durationSec": 12, "fps": 30, "copy": { … }, "sources": ["home","stats","detail"], "featureIds": ["…"] },
             "search": { "durationSec": 10, "fps": 30, "copy": { … }, "sources": ["home","stats"], "featureIds": ["…"] } } }
\`\`\`
Bitince: \`vitrin video\`.
`,
  );
}
