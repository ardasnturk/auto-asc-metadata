# Apple özellikleri (Ekim 2026)

Tek doğru kaynak `data/targets.json` ve `docs/apple-notes.md`’dir; bu dosya özet.

## Render matrisi

| Hedef id | Varlık | px | Durum |
| --- | --- | --- | --- |
| `iphone-6.3` | iPhone Dynamic Island orta | 1206×2622 (1179×2556 da kabul) | **Zorunlu** |
| `iphone-6.9` | iPhone Dynamic Island büyük | 1320×2868 | Önerilen, her zaman üretilir |
| `ipad-13` | iPad 13" | 2064×2752 | iPad destekleniyorsa zorunlu |
| `duo-outer` | iPhone Duo dış | 1398×2034 | Nisan 2027’den itibaren zorunlu (iOS 27.1 SDK) |
| `duo-inner` | iPhone Duo iç | 2007×2853 | Aynı |
| `preview-iphone` | App Preview iPhone (Duo dahil) | 886×1920 | İsteğe bağlı, ≤ 3 |
| `preview-ipad` | App Preview iPad | 1200×1600 | İsteğe bağlı (config ile aç) |
| `header` | Ürün sayfası başlığı 21:9 | 3840×1646 | İsteğe bağlı, Asset Library |
| `search` | Arama sonucu 3:2 | 1920×1280 – 3840×2560 | İsteğe bağlı, Asset Library |
| `event-card` / `event-detail` | In-App Event 16:9 / 9:16 | aralık | Etkinlik varsa |

Mac, Apple TV, Vision Pro hedefleri `targets.enable` ile açılır.

## Ekran görüntüsü

- Dil ve cihaz başına 1–10; PNG/JPEG; **alfa yok** (Vitrin flatten + removeAlpha uygular).
- İçerik gerçek arayüzü göstermeli (App Review 2.3).
- 6,9" görselde başlık ≥ 96 px; WCAG AA kontrast (büyük metin ≥ 3:1).

## App Preview

- 15–30 sn (hedef 20–25), **30 fps sabit**, H.264 High@4.0 10–12 Mbps, stereo AAC 256 kbps 48 kHz, ≤ 500 MB.
- Müzik yoksa sessiz stereo kanal (Vitrin ekler). Poster karesi 5. saniye — o anda okunur bir kare olsun.
- Farklı en-boy oranı “A Closer Look” bölümüne düşer. Önizlemeler görsellerden önce görünür; işleme 24 saate kadar sürer.
- Yalnız uygulama görüntüsü + metin/hareket; el veya kişi yok.

## Kreatif varlıklar

- Başlık 21:9 ve arama 3:2: görsel veya 5–30 sn video (30/60 fps). Aramada sessiz ve sürekli döner → sessiz izlenince anlaşılmalı.
- Sürümden bağımsız onaylanır; CPP, In-App Event ve PPO’da tekrar kullanılır.

## Metin limitleri

Ad 2–30 · alt başlık 30 · promosyon 170 · açıklama 4000 · yenilikler 4000 · **anahtar kelimeler 100 bayt** · inceleme notları 4000 bayt.

## API

- ASC API 4.5.1: Screenshot/Preview Sets deprecated → App Asset Library (images, videos, placements). `GET /v1/appAssetLibraryRefData` desteklenen yerleşim/boyutları döndürür; doctor bunu targets.json ile karşılaştırır.
- Uygulama kaydı API anahtarıyla açılamaz (403). İlk App Store sürümü yalnız TestFlight’taki uygulamada elle açılmalı olabilir.
