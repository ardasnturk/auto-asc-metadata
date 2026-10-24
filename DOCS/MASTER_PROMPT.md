# Vitrin — ASC Metadata & Asset Otomasyonu

Oct 24, 2026 · @Arda

## Özet

Vitrin; bir iOS projesini okuyup rakip analiziyle ASO uyumlu metadata, HTML tabanlı rozetli ekran görüntüleri ve Remotion videoları üreten, bunları doğrulayıp fastlane + ASC API ile yükleyen bir CLI ve `/vitrin` skill'i olacak. Claude Code'a yapıştıracağın master prompt aşağıdaki “Master prompt” bölümünde.

Tasarımı değiştiren 5 güncel bulgu:

1. Zorunlu iPhone ekran görüntüsü sınıfı artık 6,3" (1206 × 2622); 6,9" ve iPad 13" ile birlikte üretilmeli.
2. iPhone Duo (23 Ekim 2026'da satışa çıktı) iki yeni boyut getirdi; Nisan 2027'den itibaren zorunlu ve fastlane ≥ 2.241.1 gerektiriyor.
3. ASC API 4.5.1 eski ekran görüntüsü ve video API'lerini kullanımdan kaldırdı; yerine App Asset Library geldi.
4. 5 Ekim 2026'dan beri ürün sayfası başlığı ve arama sonucu kreatifleri yüklenebiliyor; fastlane'de karşılığı yok, API ile yüklenmeli.
5. Uygulama kaydı API anahtarıyla açılamıyor; bu adım ile gizlilik etiketleri ve yaş anketinin son onayı sende kalıyor.

Metadata, görsel ve fastlane bölümleri referanstır; skill akışı bölümü anahtar kapısının nasıl çalıştığını gösterir.

## Güncel ASC metadata alanları (Ekim 2026)

App Store aramasında puan getiren metin üç alandan gelir: ad (30 karakter), alt başlık (30 karakter) ve anahtar kelimeler (100 **bayt**). Apple açıklamanın web arama motorları için kullanıldığını belirtiyor; ASO pratiğinde App Store içi sıralamaya etkisi yok sayılır.

### Uygulama düzeyi (tüm platformlar için ortak)

| Alan | Limit | Lokalize | Skill için not |
| --- | --- | --- | --- |
| Ad (Name) | 2–30 karakter | Evet | En güçlü sıralama sinyali; marka + 1–2 ana kelime |
| Alt başlık (Subtitle) | 30 karakter | Evet | İndekslenir; addaki kelimeleri tekrar etme |
| Gizlilik politikası URL | URL | Evet | iOS ve macOS için zorunlu |
| Birincil / ikincil kategori | Seçim | Hayır | Oyunlarda 1–2 alt kategori; Entertainment/Games seçimi iOS 27 Time Allowance kategorisini belirler |
| Yaş derecelendirmesi | Anket | Hayır | Eylül 2026'dan beri sosyal medya özelliği sorusu zorunlu |
| Diğer | Seçim/metin | — | Content Rights, Made for Kids, EULA, AB DSA trader beyanı, düzenlenmiş tıbbi cihaz beyanı |

### Sürüm düzeyi (her platform ve her sürüm için)

| Alan | Limit | Zorunlu | Skill için not |
| --- | --- | --- | --- |
| Ekran görüntüleri | 1–10 / cihaz boyutu / dil | Evet | Bkz. sonraki bölüm |
| App Preview videosu | En çok 3 / cihaz boyutu / dil | Hayır | 15–30 sn, Remotion ile üretilecek |
| Promosyon metni | 170 karakter | Hayır | İncelemeye girmeden değişir; kampanya duyurusu için |
| Açıklama | 4000 karakter, düz metin | Evet | HTML yok; ilk 3 satır “devamını oku” öncesi görünür |
| Anahtar kelimeler | 100 bayt | Evet | Her kelime 2 karakterden uzun; ad ve geliştirici adını tekrar etme; başka uygulama/şirket adı yasak |
| Yenilikler (What's New) | 4000 karakter | İlk sürüm hariç | Her güncellemede dil başına |
| Destek URL | URL | Evet | Gerçek iletişim bilgisi içermeli |
| Pazarlama URL | URL | Hayır |  |
| Telif (Copyright) | Metin | Evet | “2026 Şirket Adı” biçimi |
| İnceleme notları | 4000 bayt | — | Demo hesap, test adımları; müşteri görmez |

**Bayt tuzağı:** anahtar kelime alanı karakter değil bayt sayar. UTF-8'de ç, ş, ğ, ı, ö, ü 2 bayt; Japonca, Çince ve Korece karakterler 3 bayt tutar. Skill doğrulamayı `Buffer.byteLength(str, 'utf8')` ile yapmalı.

### Diller

Metadata 50 dil ve yerel ayarda lokalize edilebilir: Arapça, Bengalce, Katalanca, Çince (Basit/Geleneksel), Hırvatça, Çekçe, Danca, Felemenkçe, İngilizce (Avustralya, Kanada, Birleşik Krallık, ABD), Fince, Fransızca (Fransa/Kanada), Almanca, Yunanca, Guceratça, İbranice, Hintçe, Macarca, Endonezce, İtalyanca, Japonca, Kannada, Korece, Malayca, Malayalam, Marathi, Norveççe, Odia, Lehçe, Portekizce (Brezilya/Portekiz), Pencapça, Rumence, Rusça, Slovakça, Slovençe, İspanyolca (Meksika/İspanya), İsveççe, Tamil, Telugu, Tay, Türkçe, Ukraynaca, Urduca, Vietnamca.

Her storefront bir varsayılan dil ve ek diller gösterir (ör. Meksika: İspanyolca (Meksika) + İngilizce (B.K.)). Skill bu tabloyu kullanarak ek dillere farklı anahtar kelimeler yazabilmeli; ek dillerin aramada da sayıldığı ASO topluluğunun gözlemi, Apple'ın resmi taahhüdü değil.

Kaynak: [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information), [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information), [App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations), [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store)

## Görsel ve video spesifikasyonları

Apple'ın güncel sayfasına göre zorunlu iPhone sınıfı artık “Dynamic Island (orta ekran)”, yani 1206 × 2622 veya 1179 × 2556 px. 2026 ortasındaki üçüncü parti rehberler hâlâ 6,9 inçi zorunlu gösteriyor; skill bu yüzden 6,9 ve 6,3 inçi her zaman birlikte üretmeli.

### Skill'in render matrisi

| Varlık | Boyut (px, dikey) | Format | Durum | Üretim |
| --- | --- | --- | --- | --- |
| iPhone 6,3" (Dynamic Island orta) | 1206 × 2622 | PNG/JPEG, alfa yok | Zorunlu | HTML → Playwright |
| iPhone 6,9" (Dynamic Island büyük) | 1320 × 2868 | PNG/JPEG, alfa yok | Önerilen | HTML → Playwright |
| iPad 13" | 2064 × 2752 | PNG/JPEG, alfa yok | iPad destekleniyorsa zorunlu | HTML → Playwright |
| iPhone Duo dış ekran | 1398 × 2034 | PNG/JPEG | iOS 27.1 SDK ile Nisan 2027'den itibaren zorunlu | HTML → Playwright |
| iPhone Duo iç ekran | 2007 × 2853 | PNG/JPEG | Aynı | HTML → Playwright |
| App Preview iPhone (tüm modern sınıflar, Duo dahil) | 886 × 1920 | H.264 .mp4/.mov, ≤30 fps | İsteğe bağlı, en çok 3 | Remotion |
| App Preview iPad 13"/11" | 1200 × 1600 | H.264, ≤30 fps | İsteğe bağlı | Remotion |
| Ürün sayfası başlığı (yeni) | 3840 × 1646 (21:9) | Görsel veya 5–30 sn video, 30/60 fps | İsteğe bağlı | HTML / Remotion |
| Arama sonucu kreatifi (yeni) | 1920 × 1280 – 3840 × 2560 (3:2) | Görsel veya 5–30 sn video | İsteğe bağlı | HTML / Remotion |
| In-App Event kartı | 1920 × 1080 – 3840 × 2160 (16:9) | Görsel veya 15–30 sn video | Etkinlik varsa | HTML / Remotion |
| In-App Event detay | 1080 × 1920 – 2160 × 3840 (9:16) | Görsel veya 15–30 sn video | Etkinlik varsa | HTML / Remotion |

Yatay sürümler aynı değerlerin tersidir. Mac (16:10, ör. 2880 × 1800), Apple TV (3840 × 2160), Vision Pro (3840 × 2160) ve Watch boyutları da aynı sayfada; skill bunları `targets.json` içinde isteğe bağlı tutmalı.

### Ekran görüntüsü kuralları

- Cihaz boyutu ve dil başına 1–10 görsel; .jpeg, .jpg veya .png; alfa kanalı ve saydamlık yasak.
- En yüksek çözünürlük verilirse küçük cihazlar için otomatik küçültülür.
- iPhone Duo görselleri yüklenince ürün sayfasında “Duo için optimize” rozeti çıkar.
- İçerik App Review 2.3 (doğru metadata) kuralına uymalı: uygulamada olmayan özellik gösterilmez.

### App Preview kuralları

- 15–30 saniye, en çok 500 MB, H.264 (High Profile 4.0, 10–12 Mbps) veya ProRes 422 HQ.
- En çok 30 fps. 60 fps Remotion çıktısı reddedilir; `fps: 30` sabit kalır.
- Stereo ses: 256 kbps AAC, 44,1 veya 48 kHz. Müzik yoksa sessiz stereo kanal eklenmeli.
- Varsayılan poster karesi 5. saniye; videolar ekran görüntülerinden önce görünür, işleme 24 saate kadar sürebilir.
- Farklı en-boy oranındaki video “A Closer Look” bölümüne düşer.

### Yeni kreatif varlıklar (WWDC26)

Ürün sayfası başlığı ve arama sonuçları için görsel/video yüklenebiliyor. Videolar sürekli döner; aramada sessizdir ve açılamaz, ürün sayfasında kullanıcı sesi açabilir. Bu yüzden Remotion kompozisyonları sessiz izlenince de anlaşılmalı.

Açık soru: Apple tablosunda ayrıca 16:9, 5244 × 2950 PNG bir varyant geçiyor; hangi yerleşim için olduğu sayfada net değil.

Kaynak: [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [App preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications), [Creative assets specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)

## Ek ASC özellikleri ve 2026 yenilikleri

ASO yüzeyi metin alanlarından çok daha geniş: 70 özel ürün sayfası, 5 Ekim 2026'da açılan başlık ve arama kreatifleri, In-App Events ve App Store etiketleri ayrı ayrı yönetiliyor. Skill bunları “faz 2” olarak, ana metadata'dan sonra ele almalı.

| Özellik | Güncel durum | Skill'in rolü |
| --- | --- | --- |
| [Custom Product Pages](https://developer.apple.com/help/app-store-connect/create-custom-product-pages/configure-multiple-product-page-versions) | Uygulama başına 70 sayfa; farklı görsel, video, promosyon metni ve anahtar kelime; kendi URL'si; iOS 18+ için deep link; onay gerekir | Rakip açıklarından ve kullanıcı segmentlerinden 2–5 CPP önerir, her biri için görsel set üretir |
| CPP anahtar kelimeleri | Son onaylı sürümün kelimelerinden atanır; sayfa görünür ve onaylıysa aramada çıkar | Her sayfaya çakışmayan kelime kümesi dağıtır |
| Product Page Optimization | Varsayılan sayfaya karşı görsel testleri; WWDC26 ile kreatif varlıklar da test edilebiliyor | Her test için alternatif görsel varyantı üretir |
| [Kreatif varlıklar ve Asset Library](https://developer.apple.com/help/app-store-connect/release-notes) | 5 Ekim 2026'da açıldı; varlıklar sürümden bağımsız onaylanır ve CPP, In-App Event ve PPO'da tekrar kullanılır | Başlık (21:9) ve arama (3:2) varlığını HTML/Remotion ile üretir |
| In-App Events | Kart 16:9, detay 9:16 medya; Games uygulamasında ABD'de yeni rozetler: In-Game Offer, Now On Sale, Try Before You Buy | Etkinlik metni ve medyasını üretir (isteğe bağlı) |
| [App Store etiketleri](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-tags) | Metadata, yapay zekâ ve insan kürasyonuyla otomatik atanır; yalnız ABD'de ve en-US metadata'ya göre; geliştirici istemediğini kaldırabilir | en-US metinde hedef kavramları net kullanır; yükleme sonrası etiket kontrolü için hatırlatır |
| Yaş derecelendirmesi | 4+, 9+, 13+, 16+, 18+; Eylül 2026'dan beri sosyal medya özelliği sorusu zorunlu; sosyal özellik 13+ alt sınır getirir | Koddan anket için taslak cevap çıkarır, kullanıcı onaylar |
| Erişilebilirlik etiketleri | VoiceOver, Voice Control, büyük metin, koyu arayüz, kontrast, azaltılmış hareket, altyazı vb. beyanı | SwiftUI kodunu tarayarak hangi kriterlerin karşılandığına dair taslak çıkarır; beyan kullanıcıda |
| Personalized Collections | Uygulama, Oyunlar ve Arama sekmelerinde kişisel öneriler; seçili ülkelerde, sınırlı sayıda uygulama | Doğrudan kontrol yok; net kategori ve açıklama yeterli |
| iPhone Duo rozeti | Duo görselleri yüklenince ürün sayfasında “optimize” rozeti; cihaz 23 Ekim 2026'da satışa çıktı | Duo setlerini varsayılan olarak üretir |

### Ekran görüntüsü metni sıralamayı etkiliyor mu?

Tartışmalı. Appfigures 2025 ortasında ekran görüntüsü başlıklarının anahtar kelime gibi davrandığını gözlemledi; başka uygulayıcı testleri zayıf kanıt buldu ve Apple bunu resmen doğrulamadı. Skill her iki ihtimale göre yazmalı: ilk 3 görselin başlığı büyük, yüksek kontrastlı ve ad/alt başlıktaki ana kelimeyi pekiştiren bir ifade olmalı.

Kaynak: [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store), [Appfigures](https://appfigures.com/resources/guides/app-store-algorithm-update-2025/amp), [AppScreenshotStudio test özeti](https://appscreenshotstudio.com/blog/app-store-screenshot-seo-the-2026-keyword-strategy-guide), [Yaş derecelendirmesi özeti](https://trysonar.app/blog/app-store-age-rating), [Asset Library özeti](https://adapty.io/blog/app-store-asset-library/)

## fastlane ve ASC API: neler otomatikleşir

Metin metadata, ekran görüntüleri ve App Preview videoları fastlane `deliver` ile API anahtarı üzerinden yüklenebilir. Başlık/arama kreatifleri, CPP ve In-App Events için doğrudan ASC API gerekir; uygulama kaydını API anahtarıyla oluşturmak mümkün değil.

| İş | fastlane | Doğrudan ASC API | Not |
| --- | --- | --- | --- |
| Metin metadata (ad, alt başlık, açıklama, kelimeler, promosyon, yenilikler, URL'ler) | `deliver`, `metadata/<locale>/*.txt` | Evet | — |
| Kategori, telif, inceleme bilgisi | `deliver` | Evet | `review_information/` klasörü |
| Ekran görüntüleri | `deliver` (Duo için ≥ 2.241.1) | App Asset Library | Eski uç noktalar API 4.5.1'de kullanımdan kalktı |
| App Preview | `deliver`, `app_previews_path` | App Asset Library videoları | — |
| Ürün sayfası başlığı, arama kreatifi | Karşılığı bulunamadı | App Asset Library yerleşimleri | Yalnız API |
| Custom Product Pages, PPO | Karşılığı bulunamadı | Evet | Yalnız API |
| In-App Events | Karşılığı bulunamadı | Evet | Medya artık Asset Library'de |
| Yaş derecelendirmesi | `app_rating_config_path` (JSON) | Evet (≈) | Yeni sorular için fastlane desteği doğrulanmalı |
| Uygulama kaydı oluşturma | `produce`, yalnız Apple ID + 2FA | Hayır (API anahtarıyla 403) | Kullanıcı bir kez ASC'de oluşturur |
| İncelemeye gönderme | `submit_for_review` | `reviewSubmissions` | Skill her zaman önce onay ister |

≈ = kaynakla birebir doğrulanmadı, skill ilk çalışmada kontrol etmeli.

### Skill tasarımını değiştiren 5 bulgu

1. **fastlane ≥ 2.241.1 şart.** `deliver` görselin sınıfını piksel boyutundan çıkarır; 2.241.1 öncesi sürümler Duo boyutlarını tanımıyor ve tüm yüklemeyi durduruyor. Gemfile'da sabitlenmeli.
2. **Eski görsel API'leri kullanımdan kalktı.** ASC API 4.5.1 App Screenshot Sets, Screenshots, Preview Sets ve Previews kaynaklarını deprecate etti; yerine App Asset Library images, videos ve placements geldi. fastlane'in geçiş yaptığına dair kayıt bulamadım. Yükleyici bu yüzden değiştirilebilir bir adaptör olmalı: şimdilik `deliver`, gerektiğinde Asset Library istemcisi.
3. **Boyutları sabit kodlama.** `GET /v1/appAssetLibraryRefData` desteklenen yerleşimleri, boyutları ve limitleri döndürür; `IPHONE_DUO` sınıfı da burada. Skill her çalışmada bunu okuyup `targets.json` ile karşılaştırmalı.
4. **Uygulama kaydı API ile açılmaz.** `produce` API anahtarını desteklemiyor; Apple forumunda API anahtarıyla uygulama oluşturma 403 dönüyor. Skill kayıt yoksa durur ve kullanıcıdan ASC'de oluşturmasını ister.
5. **İlk App Store sürümü.** Yalnız TestFlight'ta olan bir uygulamada API'nin ilk App Store sürümünü oluşturmayı reddettiği raporlanıyor. Skill düzenlenebilir sürüm bulamazsa aynı şekilde durup uyarır.

### Kimlik doğrulama

`app_store_connect_api_key` aksiyonu Key ID, Issuer ID ve `.p8` dosyasıyla JWT üretir (en fazla 1200 sn). Ortam değişkenleri: `APP_STORE_CONNECT_API_KEY_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_KEY_FILEPATH`. Anahtar ASC → Users and Access → Integrations → App Store Connect API'den “Team Key” olarak alınır; rol en az App Manager olmalı.

Kaynak: [ASC API 4.5.1 release notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes.md), [fastlane App Store Connect API](https://docs.fastlane.tools/app-store-connect-api/), [fastlane deliver](https://docs.fastlane.tools/actions/deliver/), [fastlane 2.241.1 Duo desteği (PR)](https://github.com/sesori-ai/sesori_apps_monorepo/pull/2014), [Apple forum: API ile uygulama oluşturma](https://origin-devforums.apple.com/forums/profile/davestothers), [İlk sürüm sorunu (PR)](https://github.com/RealUnitCH/app/pull/646)

## Master prompt

Aşağıdaki metni boş bir repoda Claude Code'a olduğu gibi yapıştır. Prompt önce Apple dokümanlarını yeniden okutur, sonra aracı 7 fazda inşa ettirir ve en sonda `/vitrin` skill'ini paketletir.

```markdown
# VİTRİN — Master Prompt (Claude Code)

Sen kıdemli bir iOS release mühendisi, ASO uzmanı, metin yazarı ve motion/UI tasarımcısısın. Bu repoda “Vitrin” adlı bir araç inşa edeceksin. Vitrin herhangi bir iOS uygulama projesini analiz eder, rakip analizi yapar; App Store Connect (ASC) için ASO uyumlu ve uygulamayı doğru anlatan tüm metadata'yı, ekran görüntülerini, kreatif görselleri ve App Preview videolarını otomatik üretir, doğrular ve fastlane + ASC API ile yükler. Sonunda tüm akış tek bir Claude Code skill'i (/vitrin) ile çalışır.

## 0. Önce oku, sonra kodla
ASC kuralları 2026'da değişti. Kod yazmadan önce şu sayfaları WebFetch ile oku ve özetini docs/apple-notes.md'ye yaz:
- Screenshot specifications, App preview specifications, Creative assets specifications
- Platform version information, App information, App Store localizations
- ASC API 4.5.1 release notes, Understanding the App Asset Library, Migrating to the App Asset Library, Uploading assets to App Store Connect
- fastlane deliver ve app_store_connect_api_key dokümanları
Bu prompttaki bir değer güncel dokümanla çelişirse doküman kazanır; farkı docs/apple-notes.md'ye not et.

Bilinen gerçekler (Ekim 2026):
- Ad 2–30 karakter, alt başlık 30, promosyon metni 170, açıklama 4000 (düz metin), yenilikler 4000, anahtar kelimeler 100 BAYT (UTF-8: ç ş ğ ı ö ü 2 bayt, CJK 3 bayt), inceleme notları 4000 bayt.
- Zorunlu iPhone sınıfı: Dynamic Island orta ekran (1206×2622 veya 1179×2556). Ayrıca 6,9" (1320×2868) ve iPad destekleniyorsa 13" (2064×2752) üret. iPhone Duo: dış 1398×2034, iç 2007×2853; iOS 27.1 SDK ile Nisan 2027'den itibaren zorunlu. Cihaz/dil başına 1–10 görsel; PNG/JPEG; alfa yok.
- App Preview: 886×1920 (tüm modern iPhone'lar, Duo dahil), iPad 1200×1600; 15–30 sn; ≤30 fps; H.264 High 4.0, 10–12 Mbps; stereo AAC 256 kbps 44,1/48 kHz; cihaz/dil başına en çok 3; gerçek uygulama görüntüsü içermeli.
- Kreatif varlıklar (5 Ekim 2026'dan beri): ürün sayfası başlığı 3840×1646 (21:9), arama sonucu 3:2 (1920×1280–3840×2560); görsel ya da 5–30 sn video, 30/60 fps; aramada sessiz oynar. Marka/sezon görseli olabilir.
- In-App Event medyası: kart 16:9, detay 9:16; video 15–30 sn.
- 50 metadata dili; her storefront'ta varsayılan + ek diller (Apple tablosunu data/storefront-languages.json olarak tut).
- ASC API 4.5.1: App Screenshot Sets/Screenshots/Preview Sets/Previews deprecated → App Asset Library (images, videos, placements). Boyut ve limitler GET /v1/appAssetLibraryRefData'dan okunur; Duo sınıfı IPHONE_DUO.
- fastlane deliver görsel sınıfını piksel boyutundan çıkarır; Duo için fastlane ≥ 2.241.1 (APP_IPHONE_DUO) gerekir.
- Uygulama kaydı API anahtarıyla oluşturulamaz (fastlane produce Apple ID ister). Yalnız TestFlight'taki bir uygulamada ilk App Store sürümünün bir kez ASC'de açılması gerekebilir.

## 1. Mimari ilkeleri
- Yaratıcı kararlar Claude'da, deterministik işler CLI'da. Metin, sanat yönetimi, yerleşim seçimi ve rakip yorumu skill çalışırken Claude tarafından yazılır ve şemaya uygun JSON dosyalarına kaydedilir. Veri toplama, render, doğrulama ve yükleme TypeScript CLI'ın işidir. Ek LLM API anahtarı gerekmez.
- Her aşama idempotent ve devam ettirilebilir: .vitrin/state.json tamamlanan aşamaları ve girdi hash'lerini tutar; aynı girdiyle tekrar çalışınca atlanır.
- Güvenli varsayılan: upload önce --dry-run planı gösterir; incelemeye gönderme ayrı komut ve açık onay ister.

## 2. Teknoloji
- Node.js 22+, TypeScript, pnpm workspace; tüm JSON'lar için zod şemaları.
- HTML→PNG: Playwright (Chromium). Şablonlar mantıksal boyutta tasarlanır, deviceScaleFactor ile kesin piksele çıkar: 6,9" 440×956 @3x, 6,3" 402×874 @3x, iPad 13" 1032×1376 @2x, Duo dış 699×1017 @2x, Duo iç 669×951 @3x. Çıktıyı sharp ile flatten + removeAlpha yap, boyutu sharp.metadata ile doğrula.
- Video: Remotion 4.x (5.0 henüz çıkmadı; birey ve ≤3 çalışanlı şirketlere ücretsiz lisans). fps 30 sabit; render: --codec h264 --video-bitrate 11M --audio-codec aac --audio-bitrate 256k --enforce-audio-track. ffprobe ile çözünürlük, fps, süre ve ses kanalını kontrol et; gerekirse ffmpeg ile -profile:v high -level 4.0 yeniden kodla.
- Ham ekran görüntüleri: xcodebuild + iOS Simulator + XCUITest (veya fastlane snapshot). xcrun simctl status_bar override ile saat 9:41, tam pil. Her dil için -AppleLanguages/-AppleLocale. Uygulamaya -VitrinDemo launch argument'ı ile seed veri modu öner ve hangi dosyaya ekleneceğini kullanıcıya göster. App Preview kaydı: xcrun simctl io <udid> recordVideo.
- Rakip görsel metni: macOS Vision (VNRecognizeTextRequest) çalıştıran küçük bir Swift script; renk paleti için sharp + k-means.
- Yükleme: Ruby + Bundler, Gemfile'da fastlane '>= 2.241.1'. ASC API istemcisi TypeScript, ES256 JWT (jose), token ömrü ≤ 20 dk.
- İkonlar: Lucide veya Phosphor (MIT); SF Symbols'ü pazarlama görsellerinde kullanma. Fontlar OFL lisanslı ve projeye gömülü; CJK, Hint dilleri, Arapça/İbranice için Noto yedekleri; RTL dillerde dir=rtl.

## 3. Repo yapısı
vitrin/
  packages/cli        komutlar, state, maskeleyen logger
  packages/schemas    AppProfile, Competitors, KeywordPlan, Metadata, ArtDirection, ShotList, VideoPlan, Report
  packages/analyzer   Xcode projesi okuma
  packages/research   iTunes Search/Lookup, RSS listeleri, yorumlar, opsiyonel Apple Ads/AppTweak
  packages/validate   metin, görsel, video ve iddia-kanıt kontrolleri
  packages/render     HTML şablon motoru; Badge, DeviceFrame, Caption, Background bileşenleri; Playwright renderer
  packages/video      Remotion projesi: AppPreview, HeaderLoop, SearchLoop, EventCard
  packages/upload     fastlane köprüsü + App Asset Library / CPP / In-App Events istemcisi
  fastlane/           Fastfile ve Gemfile şablonları
  data/               targets.json, storefront-languages.json, forbidden-terms.json
  skill/              SKILL.md, references/, scripts/
Uygulama reposundaki çıktılar: .vitrin/ (state, cache, rapor) ve fastlane/{metadata,screenshots,app-previews}/.

## 4. Pipeline (CLI)
vitrin init → vitrin.config.yaml ve .env.example oluşturur; .gitignore'a .env, *.p8, .vitrin/cache ekler.
vitrin doctor → ortam ve anahtar kontrolü (bölüm 5).
vitrin analyze → .vitrin/app_profile.json
  Oku: .pbxproj (bundle id, hedefler, deployment target, iPad desteği), Info.plist (görünen ad, izin açıklamaları), entitlements (HealthKit, iCloud, Push, Sign in with Apple), Localizable.xcstrings ve knownRegions, Assets.xcassets (AppIcon, AccentColor, renk setleri), .storekit (IAP adları), App Intents, widget/watch/extension hedefleri, README, CHANGELOG, son tag'den beri git log.
  Çıktı: özellik listesi ve her biri için kanıt (dosya yolu), hedef kitle, kullanıcının işi (job-to-be-done), gelir modeli, ton, marka renkleri, kategori önerisi, dil → ASC locale eşlemesi (tr, en-US, de-DE, ja, zh-Hans, pt-BR …).
vitrin research → .vitrin/competitors.json, .vitrin/keywords/<locale>.json
  Hedef storefront'lar config'ten (varsayılan: birincil dilin ülkesi + US). iTunes Search API ile her tohum terim için ilk 50 sonuç; Lookup ile ad, açıklama, puan, puan sayısı, sürüm notları, ekran görüntüsü URL'leri (Lookup alt başlık döndürmez); kategori top listeleri; son yorumlar.
  Analiz: ad kelime frekans matrisi, rakiplerin ilk 3 görselindeki başlıklar (OCR), renk paletleri, yorumlardaki şikâyet/övgü kümeleri, boş kalan konumlanma alanları. Rakip metni veya görseli kopyalanmaz; yalnız analizde kullanılır. Rate limit'e uy, sonuçları 24 saat cache'le.
  Kelime puanı: alaka (Claude), rekabet (sonuç sayısı + ilk 10'un puan sayısı), popülerlik (Apple Ads anahtarı varsa ondan; yoksa tahmin olarak işaretle).
vitrin write → .vitrin/metadata/<locale>.json ve cpp-suggestions.json
  Claude yazar, CLI doğrular. Kurallar: ad = marka + birincil kelime; alt başlık = fayda + ikincil kelime; ad, alt başlık ve kelime alanı arasında tekrar yok; kelime alanı virgülle, boşluksuz, tekil, rakip/marka adı ve fiyat ifadesi yok; açıklamanın ilk 3 satırı kancadır; kelime doldurma yok; her dilde çeviri değil yerel yeniden yazım; storefront ek dillerine farklı kelimeler; yenilikler git log'dan kullanıcı diliyle; promosyon metni güncel kampanyaya göre. Her iddia app_profile'daki bir kanıta bağlanır.
vitrin capture → .vitrin/raw/<locale>/<device>/NN.png ve önizleme kayıtları
vitrin design → .vitrin/art-direction.json, fastlane/screenshots/<locale>/NN_<slug>.png
  Sabit şablon yok. Claude app_profile ve rakip görsel analizinden 2–3 sanat yönü önerir (palet, tipografi, arka plan dili, yerleşim arketipleri) ve rakiplerden en çok ayrışanı seçer. Arketipler: hero, tek özellik, bölünmüş ekran, kolaj, öncesi/sonrası, istatistik, sosyal kanıt, panoramik (ardışık görsellerde devam eden arka plan). Her görselde başlık (en çok 6–7 kelime, ana kelimeyi pekiştirir), alt başlık, ekran ve rozet(ler) bulunur.
  Badge bileşeni türleri: feature (Çevrimdışı, Reklamsız, iCloud senkron, Apple Health), new (Yeni), proof (puan, ödül), platform (iPad, Apple Watch, iPhone Duo). Proof rozetleri yalnız doğrulanabilir veriyle (Lookup'tan gerçek puan, belgeli ödül); fiyat rozeti yok; Apple markaları ve ödül adları yalnız gerçekse.
  Kalite kontrolü: Playwright ile metin taşması/kesilme ölçümü, 6,9" görselde başlık ≥ 96 px, WCAG AA kontrast, güvenli alan; ilk 3 görsel %25 boyutta render edilip okunurluk kontrol edilir.
  Ayrıca başlık (3840×1646) ve arama (3:2) kreatifleri ile istenirse In-App Event medyası.
vitrin video → fastlane/app-previews/<locale>/NN.mp4 ve .vitrin/creative/*.mp4
  App Preview (886×1920, hedef 20–25 sn): 0–3 sn kanca, gerçek ekran kaydıyla 3–4 özellik vuruşu, kapanış kartı; yalnız uygulama görüntüsü + metin/hareket katmanı, el ya da kişi görüntüsü yok. Header/Search döngüleri: 5–30 sn, sessiz izlenince anlaşılır, kesintisiz döngü. Tüm metinler dile göre.
vitrin validate → .vitrin/validation.json; hata varsa çıkış kodu 1.
vitrin review → .vitrin/report.html: arama sonucu satırı ve ürün sayfası benzeri önizleme, tüm diller için temas sayfası, bayt/karakter sayaçları, rakip karşılaştırması.
vitrin upload [--dry-run] → fastlane + ASC API; önce plan, onaydan sonra yükleme.
vitrin submit → incelemeye gönderir; açık onay ister.
vitrin all → hepsini sırayla çalıştırır, her aşamadan sonra state yazar.

## 5. Anahtarlar, .env ve doctor
.env.example (yorumlarıyla):
  ASC_KEY_ID=          # ASC > Users and Access > Integrations > App Store Connect API (Team Key)
  ASC_ISSUER_ID=
  ASC_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8   # veya ASC_KEY_CONTENT_BASE64
  APP_BUNDLE_ID=       # boşsa Xcode projesinden okunur
  # Opsiyonel
  APPLE_ADS_CLIENT_ID= APPLE_ADS_TEAM_ID= APPLE_ADS_KEY_ID= APPLE_ADS_PRIVATE_KEY_PATH= APPLE_ADS_ORG_ID=
  APPTWEAK_API_KEY=
  FASTLANE_USER= FASTLANE_PASSWORD=   # yalnız uygulama kaydı oluşturmak (produce) için
Fastfile ASC_* değerlerini app_store_connect_api_key aksiyonuna geçirir (key_id, issuer_id, key_filepath, duration 1200).
Gizli olmayan alanlar (destek/pazarlama/gizlilik URL'leri, telif sahibi, birincil dil, hedef storefront'lar) vitrin.config.yaml'da durur.
doctor sırası:
  1. Araçlar: Node, pnpm, Ruby/Bundler, fastlane ≥ 2.241.1, Xcode + simctl, ffmpeg/ffprobe, Playwright tarayıcısı.
  2. .env var mı, zorunlu anahtarlar dolu mu, .p8 dosyası var ve PEM biçiminde mi.
  3. JWT ile canlı test: GET /v1/apps?filter[bundleId]=… → anahtar geçerli mi, rol yeterli mi, uygulama kaydı var mı.
  4. Düzenlenebilir App Store sürümü var mı; yoksa deliver app_version ile açmayı dener, reddedilirse uyarır.
  5. Config'teki URL'ler 200 dönüyor mu, destek sayfasında iletişim bilgisi var mı.
  6. appAssetLibraryRefData'yı çekip data/targets.json ile karşılaştırır, fark varsa uyarır.
Davranış:
  - Değerleri asla yazdırmaz, logda maskeler.
  - Eksik varsa .env.example'ı günceller; eksik anahtarları tek bir Türkçe listede, her biri için nereden alınacağıyla verir; çıkış kodu 2 (kullanıcı girdisi bekleniyor) ile durur.
  - Erken uyarı, geç kapı: ASC anahtarları eksikse analiz ve üretim devam eder (kullanıcı bu sırada anahtarları ekleyebilir); upload doctor geçmeden başlamaz.
  - Kullanıcı “devam” dediğinde doctor yeniden çalışır ve kalan aşamalardan devam edilir; üretilmiş dosyalar yeniden üretilmez.

## 6. Doğrulama kuralları
Metin: karakter limitleri (Intl.Segmenter ile grafem sayımı), kelime alanında Buffer.byteLength ≤ 100, ad/alt başlık/kelime tekrarı, yasaklı terimler (rakip markaları, fiyat, kanıtsız “#1”/“en iyi”), HTML yok, URL biçimi, her dilde zorunlu alanlar dolu.
Görsel: kesin piksel boyutu ve sınıf eşlemesi, alfa yok, 1–10 adet, dosya sırası, her dilde aynı sayı, başlık taşması yok, kontrast.
Video: 15–30 sn, 30 fps, doğru çözünürlük, H.264, stereo AAC, ≤ 500 MB; kreatiflerde 5–30 sn.
İddia-kanıt: her başlık ve rozet iddiası app_profile'daki bir özelliğe bağlı; bağlanamayan iddia hatadır (App Review 2.3).
Uyum: ekran görüntüleri gerçek arayüzü, App Preview gerçek kaydı gösterir.

## 7. Yükleme
fastlane/metadata/<locale>/: name.txt, subtitle.txt, description.txt, keywords.txt, promotional_text.txt, release_notes.txt, support_url.txt, marketing_url.txt, privacy_url.txt. Kök: copyright.txt, primary_category.txt, secondary_category.txt; review_information/ altında iletişim ve demo hesap.
Lane vitrin_upload: api_key ile deliver(skip_binary_upload: true, overwrite_screenshots: true, force: true, submit_for_review: false, app_previews_path: 'fastlane/app-previews').
Asset Library istemcisi: başlık ve arama kreatifleri, CPP'ler (görsel, promosyon metni, kelime ataması, deep link), PPO varyantları, In-App Event medyası. Akış: rezervasyon → parçaları PUT → checksum ile commit → işlenmeyi bekle → placement oluştur → sıralama isteği.
fastlane eski görsel uçlarında deprecation uyarısı ya da hata verirse görselleri Asset Library'ye yükleyen --uploader=asset-library bayrağına geç.
Her yüklemeden sonra ASC'den geri oku ve yerel dosyalarla karşılaştır.

## 8. Skill (/vitrin)
skill/SKILL.md: ad vitrin; açıklama: iOS uygulaması için ASC metadata, ekran görüntüleri, kreatifler ve App Preview üretip yükler; tetikleyiciler: App Store metadata, ASO, ekran görüntüsü, fastlane deliver, ASC'ye yükle.
Akış: 1) doctor (erken uyarı) 2) analyze 3) research 4) Claude metadata ve sanat yönünü yazar 5) capture 6) design 7) video 8) validate (hata varsa Claude düzeltir, en çok 3 tur) 9) review raporunu gösterir 10) doctor (kapı) 11) upload --dry-run ve kullanıcı onayı 12) upload 13) özet.
Eksik anahtar durumunda Claude şunu yazar: hangi anahtarlar eksik, her biri nereden alınır, .env dosyasının yolu, “Ekleyince devam yaz.” Değerleri sohbete yapıştırmayı önermez; .env'e yazılmasını ister.
references/: apple-specs.md, aso-rules.md, copy-guidelines.md, art-direction.md (arketipler, rozet kuralları), troubleshooting.md (Duo sınıfı, ilk sürüm, 403, işlenmeyen video). SKILL.md 500 satırı geçmez; uzun bilgi references'tan gerektiğinde okunur.

## 9. Faz sırası ve bitti tanımı
Faz 0: iskelet, şemalar, init, doctor (testleriyle).
Faz 1: analyze + research.
Faz 2: write + validate + fastlane metin yüklemesi (--dry-run).
Faz 3: capture + design (HTML, rozetler, 6,3"/6,9"/iPad/Duo).
Faz 4: video (Remotion) + ffprobe doğrulaması.
Faz 5: Asset Library, CPP ve In-App Events istemcisi.
Faz 6: skill paketleme ve örnek uygulamada uçtan uca deneme.
Her faz sonunda: birim testleri (bayt sayımı, limitler, boyut eşleme, iddia-kanıt), örnek uygulamada çalışan komut, CHANGELOG girdisi.
Bitti: örnek bir SwiftUI uygulamasında `vitrin all` en az 2 dilde metadata, 6,3"/6,9"/iPad görselleri ve 1 App Preview üretir; validate temiz geçer; upload --dry-run doğru planı gösterir; anahtar eksikken doctor çıkış kodu 2 ve doğru Türkçe uyarıyla durur.

## 10. Sınırlar
- Uygulamada olmayan özelliği gösterme veya yazma.
- Rakip metin, görsel ve marka adlarını kopyalama.
- Gizli değerleri loglama, commit etme veya sohbete yazma.
- İncelemeye gönderme, fiyat değişikliği, sürüm yayınlama gibi geri alması zor işleri açık onay olmadan yapma.
- Emin olmadığın Apple kuralında dokümanı yeniden oku; yine belirsizse kullanıcıya sor.
```

## Skill akışı ve .env kapısı

Skill anahtar eksikse en başta uyarır ama üretimi durdurmaz; yalnız yüklemeden önceki kapıda durur ve sen `.env`'i doldurup “devam” yazana kadar bekler.

&#91;embedded content: /vitrin akışı · 9 adım, 1 anahtar kapısı\]

Kapıda durunca skill eksik anahtarları ve her birinin nereden alınacağını listeler, `.env.example`'ı günceller; üretilmiş dosyalar devam ederken yeniden üretilmez.

### Skill ile neler yapılabilir

| Seviye | İşler |
| --- | --- |
| Tam otomatik | Proje analizi, rakip ve anahtar kelime araştırması, 50 dile kadar metadata, ekran görüntüsü yakalama, HTML tasarım ve rozetler, Remotion videoları, doğrulama, önizleme raporu |
| Senin onayınla | ASC'ye yükleme, CPP ve PPO oluşturma, kreatif varlık gönderimi, incelemeye gönderme |
| Elle kalır | Uygulama kaydını ASC'de açmak, API anahtarını oluşturmak, gizlilik etiketleri ve yaş anketinin son onayı, iPhone Duo simülatöründe katlama pozisyonu (otomasyon komutu bulunamadı) |

Skill `~/.claude/skills/vitrin/SKILL.md` olarak kurulur ve uygulama reposunda `/vitrin` ile çağrılır; asıl işi global kurulan `vitrin` CLI yapar.

## Kaynaklar

Açılıp okunan Apple sayfaları:

- [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store)
- [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [App preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications)
- [Creative assets specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)
- [App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations)
- [Manage app tags](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-tags)
- [Configure multiple product page versions](https://developer.apple.com/help/app-store-connect/create-custom-product-pages/configure-multiple-product-page-versions)
- [App Store Connect API 4.5.1 release notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes.md)

Arama özetlerinden alınan, sayfası açılmayan kaynaklar:

- [App Store Connect release notes](https://developer.apple.com/help/app-store-connect/release-notes)
- [fastlane deliver](https://docs.fastlane.tools/actions/deliver/) ve [fastlane App Store Connect API](https://docs.fastlane.tools/app-store-connect-api/)
- [fastlane 2.241.1 iPhone Duo desteği (GitHub PR)](https://github.com/sesori-ai/sesori_apps_monorepo/pull/2014)
- [İlk App Store sürümü sorunu (GitHub PR)](https://github.com/RealUnitCH/app/pull/646)
- [Apple forum: API anahtarıyla uygulama oluşturma](https://origin-devforums.apple.com/forums/profile/davestothers)
- [Remotion lisansı](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)
- [Appfigures algoritma güncellemesi](https://appfigures.com/resources/guides/app-store-algorithm-update-2025/amp), [AppScreenshotStudio test özeti](https://appscreenshotstudio.com/blog/app-store-screenshot-seo-the-2026-keyword-strategy-guide)
- [Yaş derecelendirmesi özeti](https://trysonar.app/blog/app-store-age-rating), [Asset Library özeti](https://adapty.io/blog/app-store-asset-library/)
