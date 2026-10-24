# Metin yazım rehberi

## Genel

- **Doğruluk önce:** her iddia `claims` ile kanıtlı bir özelliğe bağlanır. Demo verisindeki sayılar (ör. “42 günlük seri”) pazarlama iddiası değildir.
- **Yerel yeniden yazım, çeviri değil:** her dilde o pazarın arama dilini ve tonunu kullan. Türkçede “alışkanlık takibi”, İngilizcede “habit tracker”; birebir çeviri değil, aranan ifade.
- Ton `app_profile.positioning.tone`’a uyar. Ünlem ve emoji ölçülü.
- Yasak: fiyat, “ücretsiz/free”, kanıtsız “#1/en iyi/tek”, rakip adları, HTML, kelime doldurma.

## Açıklama (≤ 4000, düz metin)

- **İlk 3 satır** “devamını oku” öncesi görünür: 1) ana fayda + birincil kelime, 2) ikinci fayda, 3) güven/ayrışma.
- Sonra kısa bölümler: özellik madde işaretleri (•), kimler için, gizlilik/veri yaklaşımı (yalnız kanıtlıysa), abonelik bilgisi (varsa: süre, otomatik yenileme, Ayarlar’dan iptal; fiyat yazma).
- Aynı kelimeyi 6’dan fazla kullanma.

## Promosyon metni (≤ 170)

- İncelemesiz değişir: güncel kampanya, mevsim, yeni özellik. Fiyat ve indirim yazma.

## Yenilikler (≤ 4000)

- `app_profile.docs.commitsSinceTag` ve CHANGELOG’dan **kullanıcı diliyle**: “Takvim görünümü artık 12 haftayı gösteriyor.” Teknik iç detay (refactor, CI) yazma. İlk sürümde boş bırak.

## İnceleme notları (≤ 4000 bayt)

- Demo hesap (varsa `.env` REVIEW_DEMO_* — dosyaya yazma), test adımları, özel donanım/izin gereksinimleri. Müşteri görmez.

## Ekran görüntüsü başlıkları

- 2–7 kelime, fiil veya fayda ile başla: “Serini kırma”, “İlerlemeni grafiklerle gör”.
- İlk 3 görsel en güçlü 3 mesaj; ana kelimeyi pekiştir.
- Alt başlık isteğe bağlı, tek satır.

## Video metinleri

- Kanca ≤ 5 kelime; her vuruş tek fikir; kapanış: uygulama adı + kısa vaat. Sessiz izlenince anlaşılmalı.
