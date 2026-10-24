# Sanat yönü

Sabit şablon yok. `app_profile.brand` ve rakip görsel analizinden (`competitors.analysis.paletteUsage`, `screenshotHeadlineTerms`) **2–3 yön** öner ve rakiplerden en çok ayrışanı seç. Seçim gerekçesini `selectionReason`’a yaz.

## Bir yönün parçaları

- **Palet:** `background` (1–4 renk; gradyan/mesh durakları), `surface`, `primary`, `accent`, `text`, `textMuted`, `badgeBackground`, `badgeText`. Metin her arka plan durağına karşı ≥ 3:1 olmalı (validate ölçer). Marka rengini koru ama rakiplerin baskın tonundan uzaklaş.
- **Tipografi:** yalnız gömülü OFL aileler — Inter, Manrope, Space Grotesk, Plus Jakarta Sans, DM Sans, Fraunces, Playfair Display, Noto Sans. CJK, Arapça, İbranice, Hint dilleri için Noto yedekleri otomatik; RTL dillerde `dir=rtl` otomatik.
- **Arka plan:** solid, linear, radial, mesh, grid, dots, panoramic (ardışık görsellerde kesintisiz şerit). `intensity` 0–1.
- **Cihaz:** `frame` none/minimal/realistic (Apple ürün görseli kullanılmaz, CSS çerçeve), `shadow`, `tilt` (−12…12).

## Set stratejisi (önce bu)

Kaynaklar: AppScreenshotStudio 2026 rehberi, MobileAction 2026 rehberi, Apple Screenshot specifications; örnek galeri screensdesign.com.

- **İlk 3 görsel hikâyedir**, çoğu kullanıcı 3. görselden sonrasını görmez ve ilk izlenime 3–6 sn ayırır:
  1. **Kanca** — sonuç/fayda (“Her gün tek dokunuş”), özellik adı değil.
  2. **Kanıt** — çekirdek eylem, gerçek arayüzle.
  3. **Güven / kazanç** — sonuç, seri, gerçek puan ya da en güçlü ikinci fayda.
  4–10. Derinlemesine bakanlar için: tek görsel = tek fikir.
- **Tutarlılık:** tek sanat yönü, tek vurgu rengi + nötr, tek başlık yazı tipi, benzer başlık uzunlukları, benzer cihaz konumları, tek arka plan dili. Başlık konumunu (üst/alt) set boyunca sabit tut; karışırsa validate bilgi verir.
- **Gerçek arayüz oranı:** görsellerin en az %60’ı gerçek UI (statement/testimonial bu oranı düşürür). İlk 3 görselden en az biri UI olmak zorunda.
- **Koyu zemin + tek parlak vurgu** 2026’da öne çıkıyor; rakipler açık pastel ise koyu zemin ayrışır. App Store’un açık ve koyu temasında ikisinde de okunmalı.
- **5–7 iyi görsel** çoğu uygulamaya yeter; iPad için 3–5 ayrı görsel (iPhone görselleri iPad’e kopyalanmaz — Vitrin iPad’i iPad yakalamasından üretir).
- **Kaçın:** giriş/login ekranıyla başlamak, uygulamada olmayan mockup, özellik yığını, “iki telefon + bir paragraf”, eylem çağrısı (“Hemen indir”), başka platform adları (Android, Google Play), fiyat/indirim, kanıtsız ödül/sıralama.

## Başlık

- **En çok 5 kelime önerilir** (7 sert sınır), **en çok 2 satır**, 2 saniyede anlaşılmalı. Kalın, ince olmayan yazı tipi; yüksek kontrast.
- Özellik değil **sonuç** yaz: “Kalori takibi” değil “Saymadan kilo ver” tarzı — ama yalnız kanıtlı sonuç.
- İki katmanlı başlık: `kicker` küçük üst satır (“Alışkanlık takibi”, “Measure”), `headline` büyük ana mesaj. Kicker ≤ 3 kelime; ana anahtar kelimeyi kicker’a koymak ASO’yu da destekler.
- Vurgu: başlıkta `*kelime*` yazınca o kelime vurgu renginde çizilir (“Serini *kırma*”). Başlık başına 1 vurgu yeter.

## Arketipler

| Arketip | Ne zaman | Ekran | Not |
| --- | --- | --- | --- |
| hero | İlk görsel; ana vaat + ana ekran büyük | 1 | Kanca için en güvenli seçim |
| feature | Tek özellik; rozetler cihazın kenarında yüzer | 1 | |
| callout | Bir arayüz parçasını büyütüp ekrandan dışarı taşırmak (kart, grafik, ısı haritası) | 1 | `callouts[].rect` yakalamanın kesirleri (0–1); iPad düzeni farklıysa `rects.ipad` ver, yoksa iPad’de kesit çizilmez |
| fullbleed | Arayüzün kendisi görsel olduğunda (hesap makinesi, grafik, harita) | 1 | Çerçevesiz, kenardan kenara; UI’nin üstü hep görünür |
| tilted | Dinamik, enerjik his (oyun, müzik, spor) | 1 | Büyük cihaz −12° döner ve kenardan taşar; rozetler yüzer |
| split | İki ekranı karşılaştır / akış | 2 | |
| collage | Çok yönlülük | 3 | |
| before-after | Dönüşüm; sol soluk, sağ canlı, ok | 2 | |
| stat | Büyük sayı + başlık | 1 | `stat.value` kanıtlı ve genel olmalı |
| social-proof | Gerçek puan/ödül büyük | 1 | Yalnız Lookup’taki gerçek puan |
| panoramic | Cihaz sağ kenardan taşar; panoramic arka planla | 1 | |
| statement | Marka/ifade slaytı: ikon + büyük başlık + rozetler | 0 | UI değil; setin sonunda ya da (gerçek kanıt varsa) başında |
| testimonial | Gerçek App Store yorumları | 0 | `quotes[locale]` yorumun **kendi dilinde, birebir** metni; validate competitors.json → self.reviews ile karşılaştırır. Çeviri ya da uydurma yorum hatadır |

`captionPosition: "bottom"` başlığı alta alır; cihaz üstten taşar (fullbleed’de UI’nin üstü görünür kalır). Alt başlık, arayüzün üst kısmı en anlamlı olduğunda iyi çalışır.

## Rozetler

| Tür | Kural | Örnek |
| --- | --- | --- |
| feature | `featureId` zorunlu | “iCloud senkron” (cloud), “Çevrimdışı” (wifi-off), “Reklamsız” (ban) |
| new | `featureId` zorunlu; yalnız bu sürümde gelen özellik | “Yeni” (sparkles) |
| proof | `proof.kind: rating` Lookup’taki **gerçek** değer ve sayıyla; `award` belgeli URL ile | “4,8 · 12 B puan” |
| platform | Yalnız gerçekten destekleniyorsa: ipad, apple-watch, iphone-duo, widgets, mac, vision | “iPad’de de” (tablet) |

Rozet stilleri (`style`): `pill` (varsayılan çip), `sticker` (vurgu renginde, hafif dönük, kalın — “1.2’de yeni”), `laurel` (iki defne dalı arasında büyük değer — **yalnız proof rozetinde**, aksi halde ödül izlenimi verdiği için hata).

Fiyat rozeti yok. Apple markaları (Apple Health, iCloud, Apple Watch) yalnız gerçek entegrasyon varsa. İkonlar Lucide adlarıdır (https://lucide.dev/icons); SF Symbols kullanılmaz. Görsel başına en çok 3 rozet; ilk görselde 1–2.

## Kalite kontrolü (CLI ölçer, sen de bak)

- Metin taşması/kesilme yok (fitter küçültür; minimumda hâlâ taşıyorsa hata).
- 6,9" görselde başlık ≥ 96 px.
- Güvenli alan: metin ve rozetler kenarlardan %3,5 içeride.
- İlk 3 görsel %25 boyutta okunur (`.vitrin/cache/thumbs`).
- Render sonrası en az 2 PNG’yi aç ve gözle kontrol et; iPad ve Duo’yu atlama.

## Kreatifler

- Başlık 21:9 ve arama 3:2: sol metin sütunu, sağda 1–3 cihaz. Aramada küçük görünür: kısa, büyük başlık.
- In-App Event: kart 16:9 ve detay 9:16 için ayrı `copy`.
