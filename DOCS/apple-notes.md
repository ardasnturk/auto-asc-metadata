# Apple notları (24 Ekim 2026)

Kod yazılmadan önce aşağıdaki sayfalar okundu. Master prompt ile güncel doküman çeliştiğinde doküman kazanır; farklar en altta.
Değerler `data/targets.json`, `data/asc-locales.json`, `data/storefront-languages.json` ve `packages/schemas/src/limits.ts` içine işlendi.

## Ekran görüntüleri — Screenshot specifications

- Cihaz boyutu ve dil başına 1–10 görsel; `.jpeg`, `.jpg`, `.png`; alfa/saydamlık yok. Eksik boyutlar bir yedek sınıftan ölçeklenir.
- **iPhone, Dynamic Island orta ekran: 1206×2622 veya 1179×2556 — zorunlu (en az bir set).** Yedek: Face ID büyük.
- iPhone, Dynamic Island büyük ekran: 1320×2868, 1290×2796, 1260×2736 — zorunlu değil. Yedek: Face ID büyük.
- Face ID büyük: 1284×2778, 1242×2688 — uygulama iPhone’da çalışıyor ve Dynamic Island büyük set verilmemişse zorunlu.
- **iPhone Duo dış: 1398×2034 / 2034×1398; iç: 2007×2853 / 2853×2007.** iOS 27.1 SDK ile derlenen uygulamalarda Nisan 2027’den itibaren zorunlu. Yüklenince ürün sayfasında “iPhone Duo için optimize” rozeti.
- **iPad 13": 2064×2752 / 2048×2732 — iPad’de çalışan uygulamalarda zorunlu.** 12,9" ve 11" yedek olarak 13" kullanır.

## App Preview — App preview specifications

- iPhone Duo, 6,9", 6,5", 6,1" (Dynamic Island orta), 5,8": **886×1920** (yatayda tersi).
- iPad 13", 11", 10,5": **1200×1600**. Mac/Apple TV 1920×1080, Vision Pro 3840×2160.
- 15–30 sn, en çok 500 MB, en çok 30 fps, varsayılan poster karesi 5. saniye, cihaz/dil başına en çok 3, işleme 24 saate kadar; önizlemeler ekran görüntülerinden önce görünür.
- H.264: `.mov/.m4v/.mp4`, 10–12 Mbps, progresif, en çok High Profile Level 4.0, stereo AAC 256 kbps 44,1/48 kHz.
- ProRes 422 (yalnız HQ): `.mov`, ~220 Mbps VBR, ses PCM ya da AAC 256 kbps.

## Kreatif varlıklar — Creative assets specifications

- Ürün sayfası başlığı 21:9: **3840×1646** görsel veya video (5–30 sn, 30/60 fps).
- Arama sonucu 3:2: **1920×1280 – 3840×2560** görsel veya video (5–30 sn, 30/60 fps). Aramada sessiz ve açılamaz.
- **16:9, 5244×2950, yalnız PNG** — hem başlık hem arama yerleşimi için listelenmiş; amacı sayfada açıklanmıyor (açık soru, aşağıda).
- In-App Event kartı 16:9 (1920×1080–3840×2160), detay 9:16 (1080×1920–2160×3840); video 15–30 sn; 500 MB.
- Ürün sayfası videoları varsayılan sessiz, kullanıcı sesi açabilir.

## Metin alanları — Platform version information, App information

| Alan | Limit | Not |
| --- | --- | --- |
| Ad | 2–30 karakter | |
| Alt başlık | 30 karakter | |
| Promosyon metni | 170 karakter | |
| Açıklama | 4000 karakter | düz metin, HTML yok |
| Anahtar kelimeler | 100 **bayt** | her kelime 2 karakterden uzun; uygulama/şirket adını tekrar etme |
| Yenilikler | 4000 karakter | ilk sürümde yok |
| İnceleme notları | 4000 **bayt** | demo hesabın süresi dolmamalı |
| Telif | — | yılla başlar (“2026 Şirket”); © otomatik eklenir |
| Destek / Pazarlama URL | protokollü tam URL | destek zorunlu |
| Gizlilik URL | — | iOS ve macOS için zorunlu |
| Alt kategori | — | Games/Stickers için 1–2 |

## Diller — App Store localizations

- 50 dil. Sayfa dil adları veriyor; kodlar fastlane deliver dil listesinden alındı (`ar-SA, bn-BD, ca, … zh-Hans, zh-Hant`).
- Storefront → varsayılan + ek diller tablosu tamamen `data/storefront-languages.json` içinde (175 storefront). Örnek: Meksika = İspanyolca (Meksika) + İngilizce (B.K.); Türkiye = İngilizce (B.K.) + Türkçe; ABD = İngilizce (ABD) + 9 ek dil.

## ASC API 4.5.1

- **Kullanımdan kalktı:** App Screenshot Sets, App Screenshots, App Preview Sets, App Previews, App Event Screenshots, App Event Video Clips → App Asset Library images, videos, placements.
- **Yeni uç noktalar:** `POST /v1/appAssetLibraryImages`, `POST /v1/appAssetLibraryVideos`, `GET /v1/apps/{id}/assetLibrary`, `GET /v1/appAssetLibraries/{id}/images|videos`, `POST /v1/appAssetLibraryPlacements`, `POST /v1/appAssetLibraryPlacementOrderingRequests`, `GET /v1/{appStoreVersionLocalizations|appCustomProductPageLocalizations|appEventLocalizations|appStoreVersionExperimentTreatmentLocalizations}/{id}/placements`, `GET /v1/appAssetLibraryRefData`.
- `AppAssetLibraryDisplayClass` enum’una `IPHONE_DUO` eklendi.
- Release notes’ta öznitelik adları yok. “Understanding / Migrating to the App Asset Library” ve refData sayfaları okunduğunda yalnız başlık döndü (JS ile yükleniyor).

## fastlane

- `app_store_connect_api_key(key_id:, issuer_id:, key_filepath: | key_content:, is_key_content_base64:, duration: ≤1200, in_house:)`.
- deliver metadata dosyaları: `<dil>/{name,subtitle,privacy_url,description,keywords,release_notes,support_url,marketing_url,promotional_text}.txt`; kök: `copyright.txt`, `primary_category.txt`, `secondary_category.txt`, alt kategori dosyaları; `review_information/{first_name,last_name,phone_number,email_address,demo_user,demo_password,notes}.txt`.
- `app_previews_path` cihazı **dosya adından** çıkarır: `IPHONE_40, 47, 55, 58, 61, 65, 67, IPAD_97, IPAD_105, IPAD_PRO_129, IPAD_PRO_3GEN_11, IPAD_PRO_3GEN_129, DESKTOP`; dil/cihaz başına en çok 3. Vitrin önizlemeleri `NN_IPHONE_67.mp4` ve `NN_IPAD_PRO_3GEN_129.mp4` olarak adlandırır (886×1920 tüm modern iPhone sınıflarını kapsar).
- Ekran görüntüsü sınıfı **piksel boyutundan** çıkarılır; sınıflar aynı klasörde durabilir. Vitrin adları `NN_<slug>_<hedef>.png`.

## Master prompt ile farklar ve açık sorular

1. **fastlane ve Duo:** deliver dokümanında `APP_IPHONE_DUO` ya da Duo geçmiyor; Duo desteği yalnız 2.241.1 PR’ından biliniyor. Bu makinede `fastlane 2.241.1` kurulu. Duo yüklemesi ilk gerçek çalışmada doğrulanmalı; sorun çıkarsa `--uploader=asset-library` (IPHONE_DUO sınıfı API’de doğrulanmış).
2. **Önizleme dosya adı listesi** 6,9"/Duo içermiyor; 886×1920 `IPHONE_67` adıyla yüklenir. Apple’a göre bu çözünürlük tüm modern sınıflarda kabul edilir.
3. **Asset Library öznitelik adları doğrulanamadı.** `packages/upload/src/asset-library.ts` yükleme akışını ASC’nin bilinen varlık deseniyle (rezervasyon → uploadOperations → PUT → MD5 ile commit → işleme durumu) kurar ve her yanıtı savunmacı kontrol eder. `placementType` değerleri (`SCREENSHOT`, `PRODUCT_PAGE_HEADER`, `SEARCH_RESULT`) ve iPhone/iPad display class adları (`IPHONE_61`, `IPHONE_69`, `IPAD_PRO_3GEN_129`) **tahmindir**; `vitrin doctor` her çalışmada refData’yı `.vitrin/cache/refdata.json`’a yazar ve `data/targets.json` ile karşılaştırır.
4. **5244×2950 PNG varyantı** — yerleşimi belirsiz; şimdilik üretilmiyor.
5. **Apple Ads popülerliği:** Apple Ads Campaign Management API’sinde rastgele terim için popülerlik döndüren bir uç nokta yok (1–5 göstergesi yalnız web arayüzünde). Anahtar varsa bu durum açıkça raporlanır ve popülerlik “tahmin” olarak işaretlenir; AppTweak anahtarı varsa ondan okunur.
6. **Yaş derecelendirmesi yeni soruları** (sosyal medya, Eylül 2026) için fastlane `app_rating_config_path` desteği doğrulanmadı; Vitrin yalnız taslak cevap üretir, son onay kullanıcıdadır.

## Kaynaklar

- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations
- https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes
- https://docs.fastlane.tools/actions/deliver/ · https://docs.fastlane.tools/app-store-connect-api/
