---
name: vitrin
description: iOS uygulaması için App Store Connect metadata’sı, ekran görüntüleri, kreatif görseller ve App Preview videoları üretir, doğrular ve fastlane + ASC API ile yükler. Tetikleyiciler — App Store metadata, ASO, anahtar kelime, ekran görüntüsü, store screenshot, App Preview, fastlane deliver, ASC’ye yükle, App Store Connect upload.
---

# /vitrin

Vitrin iki parçadır. `vitrin` CLI’ı (global kurulu) deterministik işleri yapar: veri toplama, render, doğrulama, yükleme. **Sen** yaratıcı kararları verirsin: metin, anahtar kelime seçimi, sanat yönü, görsel listesi, video planı, rakip yorumu. Yazdıklarını şemaya uygun JSON dosyalarına kaydedersin; CLI bunları doğrular. Ek LLM anahtarı gerekmez.

Çalışma dizini uygulama reposudur. Her komut şu çıkış kodlarını kullanır:

| Kod | Anlam | Ne yaparsın |
| --- | --- | --- |
| 0 | Tamam | Sonraki adıma geç |
| 1 | Hata / doğrulama başarısız | Çıktıyı oku, düzelt, tekrar çalıştır |
| 2 | Girdi bekleniyor | `.vitrin/briefs/<aşama>.md` dosyasını oku ve istenen JSON’u yaz; ya da kullanıcıdan anahtar iste |

Aşamalar idempotenttir: girdisi değişmeyen aşama atlanır (`--force` ile zorlanır). Kullanıcı “devam” dediğinde kaldığın aşamadan devam et; üretilmiş dosyaları yeniden üretme.

## Akış

1. **doctor (erken uyarı)** — `vitrin doctor`. Kod 2 ise eksik anahtarları kullanıcıya bildir (aşağıdaki şablon) ama **üretime devam et**. Araç eksikse (fastlane < 2.241.1, ffmpeg, Playwright) kurulum komutunu söyle.
   Repo ilk kez kullanılıyorsa önce `vitrin init`.
2. **analyze** — `vitrin analyze`. Kod 2 → `.vitrin/briefs/analyze.md`:
   - Kaynak kodu oku; çekirdek özellikleri **kanıtıyla** (`path` + `line`) `.vitrin/app_profile.json` → `features` içine `"source": "claude"` ile ekle. Pazarlama metni (paywall maddesi, README iddiası) kanıt değildir; çalışan kod kanıttır.
   - `positioning` (kitle, iş, ton) ve gerekirse `categorySuggestion` yaz.
   - `vitrin.config.yaml`: `research.seeds` (dil başına 4–8 gerçek arama ifadesi) ve `capture.screens` (gösterilmeye değer 5–8 ekran, launch argümanlarıyla). Uygulamada `-VitrinDemo` yoksa kullanıcıya hangi dosyaya ne ekleneceğini göster (references/troubleshooting.md → Demo modu) ve onay iste.
3. **research** — `vitrin research`. Sonra `.vitrin/competitors.json` → `analysis.gaps` ve `reviewClusters` alanlarını yorumla; `.vitrin/keywords/<dil>.json` içindeki her adayın `relevance` (0–1) değerini ver.
4. **write** — `vitrin write`. Kod 2 → `briefs/write.md`’ye göre `.vitrin/metadata/<dil>.json` ve `app.json` yaz (kurallar: references/aso-rules.md, references/copy-guidelines.md). Kod 1 → hataları düzelt. İsteğe bağlı `cpp-suggestions.json`.
5. **capture** — `vitrin capture`. Simülatörleri Vitrin kendi açar (“Vitrin · <cihaz>”), saat 9:41, tam pil. iPhone Duo katlama pozisyonu otomatikleştirilemez; kullanıcıya söyle.
6. **design** — `vitrin design`. Kod 2 → `briefs/design.md`’ye göre `.vitrin/art-direction.json` (2–3 yön, rakiplerden en çok ayrışanı seç) ve `.vitrin/shots.json` yaz (references/art-direction.md: set stratejisi, ilk 3 görsel = kanca/kanıt/güven, ≤ 5 kelime, 13 arketip). Arketipleri uygulamanın türüne göre çeşitlendir; aynı düzeni art arda tekrarlama. Render sonrası en az iki görseli **gözünle kontrol et** (Read ile PNG’yi aç): taşma, okunurluk, rozet yerleşimi.
7. **video** — `vitrin video`. Kod 2 → `.vitrin/video-plan.json` yaz (references/video.md: 4 stil, 6 sahne türü). Stil belirsizse `vitrin video --styles all` ile dördünü üret, kullanıcıya göster ve seçtir. Render sonrası birkaç kareyi (`ffmpeg -ss <sn> -frames:v 1`) gözle kontrol et. İlk çalışmada Remotion kendi tarayıcısını indirir.
8. **validate** — `vitrin validate`. Hata varsa düzelt ve tekrar çalıştır; **en çok 3 tur**. Üçüncü turdan sonra kalan hataları kullanıcıya listele.
9. **review** — `vitrin review` → `.vitrin/report.html`. Kullanıcıya yolunu ver ve önemli noktaları özetle (sayaçlar, ilk 3 görsel, uyarılar).
10. **doctor (kapı)** — `vitrin doctor`. Kod 2 ise **dur**: eksik anahtar mesajını yaz ve “devam” bekle. Kullanıcı “devam” deyince doctor’u yeniden çalıştır.
11. **upload --dry-run** — `vitrin upload --dry-run` planını kullanıcıya göster ve **açık onay** iste. Kreatifler/CPP/etkinlikler ayrı bayraklardır (`--creatives`, `--cpp`, `--events`), her biri ayrıca onay ister.
12. **upload** — yalnız kullanıcı “evet” dedikten sonra `vitrin upload --yes [bayraklar]`.
13. **Özet** — yüklenenler, geri okumada fark varsa onlar, elle kalanlar: gizlilik etiketleri, yaş anketinin son onayı, ABD’de App Store etiketlerinin kontrolü, Duo katlama pozisyonu.

İncelemeye gönderme yalnız kullanıcı açıkça isterse: `vitrin submit --confirm <bundleId>`. Fiyat, sürüm yayınlama gibi geri alması zor işleri hiç yapma.

## Eksik anahtar mesajı

Değerleri asla sohbete yapıştırmasını önerme; `.env`’e yazmasını iste. Şablon:

> Yükleme için şu anahtarlar eksik:
> - **ASC_KEY_ID** — App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys (rol en az App Manager).
> - **ASC_ISSUER_ID** — aynı sayfanın üstündeki Issuer ID.
> - **ASC_KEY_PATH** — indirilen `AuthKey_<KEYID>.p8` dosyasının yolu (repo dışında ya da `secrets/` altında).
>
> Değerleri `<repo>/.env` dosyasına yaz (örnek: `.env.example`). Ekleyince devam yaz.

Listeyi doctor çıktısından al; yalnız gerçekten eksik olanları yaz.

## Sınırlar

- Uygulamada olmayan özelliği gösterme veya yazma; her başlık, rozet ve iddia `app_profile.features` içindeki kanıtlı bir özelliğe bağlanır (App Review 2.3).
- Rakip metnini, görselini veya marka adını kopyalama; rakip verisi yalnız analiz içindir.
- Gizli değerleri loglama, commit etme, sohbete yazma. `.env`, `*.p8` asla commit edilmez.
- Proof rozeti yalnız Lookup’taki gerçek puanla; fiyat rozeti yok; Apple markaları yalnız gerçekse.
- Emin olmadığın Apple kuralında `docs/apple-notes.md`’ye ve references/apple-specs.md’ye bak; hâlâ belirsizse kullanıcıya sor.

## Referanslar (gerektiğinde oku)

- `references/apple-specs.md` — boyutlar, video kuralları, limitler, Asset Library.
- `references/aso-rules.md` — ad/alt başlık/kelime stratejisi, bayt tuzağı, storefront ek dilleri.
- `references/copy-guidelines.md` — açıklama, promosyon, yenilikler, yerel yeniden yazım.
- `references/art-direction.md` — arketipler, rozet kuralları, renk/tipografi, kalite kontrolü.
- `references/video.md` — App Preview stilleri, sahne türleri, süre ve içerik kuralları.
- `references/troubleshooting.md` — demo modu, Duo, ilk sürüm, 401/403, işlenmeyen video, deliver deprecation.
