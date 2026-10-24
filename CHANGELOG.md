# Changelog

## 0.3.0 — 2026-10-24

### Animasyonlu App Preview
- Remotion skill rehberine göre yeniden yazıldı: `TransitionSeries` ile sahne geçişleri (fade, slide, wipe, flip, push-cut, iris), `@remotion/effects` ışık sızması katmanları, `@remotion/media` `<Video>` ile kırpılmış gerçek kayıtlar; tüm animasyonlar `interpolate` + `Easing` ile kare tabanlı.
- 4 stil: `classic`, `showcase` (3B cihaz girişi, kamera itişi, ışık sızması), `kinetic` (kelime kelime tam ekran metin kartları, punch-in), `energetic` (eğik/sallanan cihaz, vurgu bandı, şeritli arka plan).
- 6 sahne türü: `device`, `zoom` (kamera UI bölgesine uçar), `split`, `stat` (sayaç), `badges` (özellik çipleri), `text`; başlıklarda `*vurgu*` ve animasyonlu alt çizgi.
- `vitrin video --styles all`: ilk önizlemeyi dört stilde karşılaştırma için üretir (yüklenmez).
- Süre otomatik 15–30 sn’ye uyar (geçiş bindirmeleri hesaba katılır); `hookFrom` ile kaydın açılış kısmı atlanır.
- Doğrulama: sahne türüne göre gerekli alanlar, metin kartı sayısı/süresi, sayaç ve rozet iddialarının kanıtlı özelliğe bağlanması.
- skill/references/video.md eklendi; video brief’i yeni şemaya göre güncellendi.

## 0.2.0 — 2026-10-24

### Ekran görüntüsü tipleri ve best practice kuralları
- Yeni arketipler: `callout` (gerçek arayüzden büyütülmüş kesit; aileye göre ayrı dikdörtgen), `fullbleed` (çerçevesiz tam ekran UI), `tilted` (eğik büyük cihaz), `statement` (ikon + büyük ifade + rozetler), `testimonial` (yalnız uygulamanın gerçek App Store yorumları, birebir).
- İki katmanlı başlık (`kicker`), `*vurgu*` işaretlemesi, alt başlık konumu (`captionPosition: bottom`).
- Rozet stilleri: `sticker` ve `laurel` (yalnız doğrulanabilir proof).
- Doğrulama: başlık ≤ 5 kelime önerisi ve ≤ 2 satır ölçümü, %60 gerçek arayüz oranı, ilk 3 görselde gerçek arayüz, eylem çağrısı ve başka platform yasağı, tekrar eden başlıklar, arketip gereksinimleri, uydurma/çeviri yorum tespiti.
- research artık yayındaki uygulamanın kendi yorumlarını da çeker (testimonial kaynağı).
- skill/references/art-direction.md: set stratejisi (kanca → kanıt → güven), başlık kuralları, arketip seçimi; kaynaklar AppScreenshotStudio ve MobileAction 2026 rehberleri, Apple Screenshot specifications ve screensdesign.com örnekleri.

## 0.1.0 — 2026-10-24

### Faz 0 — iskelet, şemalar, init, doctor
- pnpm workspace (Node ≥ 22, TypeScript 6, ESM), zod şemaları: AppProfile, Competitors, KeywordPlan, LocaleMetadata/AppMetadata, CppSuggestions, ArtDirection, ShotList, VideoPlan, ValidationReport, RenderManifest, VitrinConfig, State.
- `data/targets.json` (Ekim 2026 boyutları, iPhone Duo dahil), `asc-locales.json` (50 dil), `storefront-languages.json` (175 storefront), `forbidden-terms.json`.
- Gizli değerleri maskeleyen logger, idempotent `.vitrin/state.json`, `vitrin init`, `vitrin doctor` (6 adım; eksik anahtarda Türkçe liste + çıkış 2).
- `docs/apple-notes.md`: Apple sayfalarından doğrulanan değerler ve açık sorular.

### Faz 1 — analyze + research
- pbxproj (OpenStep plist) ayrıştırıcı, Info.plist/INFOPLIST_KEY_*, entitlements, String Catalog, asset catalog renkleri ve ikon, StoreKit ürünleri, App Intents, hedef türleri, kod sinyalleri (erişilebilirlik ve yaş derecelendirmesi taslağı için), git log.
- iTunes Search/Lookup, RSS top chart ve yorumlar (24 saat önbellek, hız sınırı), macOS Vision OCR, k-means palet, ad terim frekansı, rekabet ve tahmini popülerlik; AppTweak sağlayıcısı.

### Faz 2 — write + validate + fastlane
- Grafem/bayt sayımı, limitler, ad/alt başlık/kelime tekrarı, tekil/çoğul, yasaklı terimler, jenerik terimleri ayıran rakip marka tespiti, HTML, URL, telif, iddia-kanıt.
- fastlane metadata dışa aktarımı (demo hesap dosyaya yazılmaz), Fastfile lane’leri, `upload --dry-run` planı (ASC ile alan alan karşılaştırma).

### Faz 3 — capture + design
- Ayrı “Vitrin · <cihaz>” simülatörleri, 9:41 durum çubuğu, dil başına sistem dili ve yeniden başlatma, launch-argument ile ekran açma, boş/siyah yakalama tespiti, ekran kaydı.
- HTML şablon motoru: 8 arketip, 7 arka plan stili, CSS cihaz çerçevesi, Lucide rozetleri, OFL fontlar ve script yedekleri, RTL; otomatik metin sığdırma, taşma/kontrast/güvenli alan/küçük boyut okunurluk ölçümü; sharp ile flatten + alfa kaldırma ve kesin boyut doğrulaması.

### Faz 4 — video
- Remotion 4 kompozisyonları (AppPreview, HeaderLoop, SearchLoop, EventCard), 15–30 sn süre uydurma, ffmpeg ile H.264 High@4.0 / 30 fps CFR / stereo AAC 48 kHz normalizasyonu, ffprobe doğrulaması.

### Faz 5 — Asset Library, CPP, In-App Events
- App Asset Library istemcisi (rezervasyon → parça yükleme → MD5 commit → işleme bekleme → placement → sıralama), refData karşılaştırması, Custom Product Page ve In-App Event oluşturma, yükleme sonrası geri okuma.

### Faz 6 — skill ve uçtan uca deneme
- `/vitrin` SKILL.md ve references/, `skill/scripts/install.sh`, `vitrin review` HTML raporu, `vitrin all`.
- `examples/Ritim` SwiftUI örnek uygulaması üzerinde uçtan uca çalıştırma.
