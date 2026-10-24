# App Preview ve kreatif videolar

Vitrin videoları Remotion ile üretir. Sen `.vitrin/video-plan.json` yazarsın; CLI sahne listesini kurar, 15–30 sn’ye uydurur, render eder ve App Store formatına (H.264 High@4.0, 30 fps, stereo AAC) normalize eder.

## Kurallar (Apple)

- 15–30 sn, 30 fps, 886×1920 (iPhone, Duo dahil) / 1200×1600 (iPad); dil ve cihaz başına en çok 3.
- **Gerçek uygulama görüntüsü ağırlıkta olmalı.** Metin kartları kısa (≤ 1,5 sn) ve az (≤ 2 açık `text` vuruşu); el, kişi, cihaz dışı çekim yok.
- Sessiz izlenince anlaşılmalı (aramada sessiz oynar). Poster karesi 5. saniye: o anda okunur bir UI sahnesi olsun.
- Kayıtların ilk ~1,5 sn’si uygulama açılışıdır: `from` ≥ 1,5 (kanca için `hookFrom`, varsayılan 1,5).

## Stiller (`previews[].style`)

| Stil | His | Ne yapar |
| --- | --- | --- |
| `classic` | Sakin, kurumsal | Yumuşak giriş, fade geçişler |
| `showcase` (varsayılan) | Premium, ürün odaklı | 3B dönerek giren cihaz, yavaş kamera itişi, push/iris geçişler, kesimlerde ışık sızması |
| `kinetic` | Modern, tipografik | Her vuruştan önce kelime kelime patlayan tam ekran metin kartı, cihaz “punch-in”, slide/push/wipe geçişler |
| `energetic` | Oyun, spor, müzik | Eğik ve sallanan cihaz, vurgu renginde başlık bandı, hareketli şeritli arka plan, wipe/flip/slide |

Kararsızsan `vitrin video --styles all` ilk önizlemeyi dört stilde `.vitrin/video-styles/<dil>/` altına üretir (yüklenmez). Kullanıcıya göster, seçileni `style` alanına yaz. `transition` (`fade|slide|wipe|flip|push|iris|none`) tek tip geçişe zorlar; `lightLeaks` ışık sızmasını açar/kapatır.

## Sahneler (`beats[].scene`)

| Sahne | Ne zaman | Gerekli alanlar |
| --- | --- | --- |
| `device` | Varsayılan: cihazda kayıt/ekran + animasyonlu başlık | `source` |
| `zoom` | Kamera UI’nin bir bölgesine uçar ve halka ile işaretler (ısı haritası, grafik, kart) | `source`, `zoom {x,y,w,h}` (yakalamanın kesirleri) |
| `split` | İki ekran yan yana kayarak gelir | `source`, `secondSource` |
| `stat` | Büyük sayaç + etiket + cihaz | `source`, `stat {value, suffix, label, featureId}` — değer **ürün gerçeği** olmalı (“12 hafta geçmiş”), demo verisi değil |
| `badges` | Özellik çipleri cihazın etrafında patlar | `source`, `badges[{icon, label, featureId}]` (Lucide ikon adları) |
| `text` | Tam ekran kinetik metin kartı | yalnız `caption`; kısa tut |

Başlıklarda `*kelime*` vurgu renginde ve altı çizili animasyonla çıkar. Her vuruş tek fikir, ≤ 5 kelime.

Önerilen akış (≈ 20–25 sn): kanca (2,6 sn, gerçek kayıt) → 3–5 vuruş (3,5–5 sn) → kapanış (ikon + ad + vaat, 2,6 sn). Vuruş türlerini çeşitlendir: aynı sahneyi art arda kullanma.

## Kreatif döngüler

`loops.header` (21:9) ve `loops.search` (3:2) kesintisiz döner; aramada sessizdir. Kısa, büyük metin; 3 kaynak ekran.
