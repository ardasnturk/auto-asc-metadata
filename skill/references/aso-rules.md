# ASO kuralları

App Store aramasında puan getiren metin üç alandan gelir: **ad**, **alt başlık**, **anahtar kelimeler**. Açıklama App Store içi sıralamada sayılmaz (web aramada kullanılır).

## Kelime seçimi

1. `.vitrin/keywords/<dil>.json` adaylarına `relevance` ver (0–1): uygulama bu aramayı yapan kişinin işini gerçekten görüyor mu? Görmüyorsa 0.
2. `total = relevance × popülerlik × (1 − rekabet)` — CLI hesaplar. `popularity.source: "estimate"` tahmindir; kesin sayı gibi sunma.
3. Dağıtım: en güçlü 1–2 terim **ada**, sonraki 1–2 **alt başlığa**, kalanlar **kelime alanına**. `selected` alanına yaz.

## Ad (2–30)

- Marka + birincil kelime: `Ritim: Alışkanlık Takibi`. Marka tek başına yetmez; kelime doldurma da yasak.

## Alt başlık (≤ 30)

- Fayda + ikincil kelime. Addaki kelimeleri **tekrar etme** (validate hata verir).

## Anahtar kelimeler (≤ 100 bayt)

- Virgülle, **boşluksuz**: `hedef,rutin,seri`. Her boşluk bir bayt.
- **Bayt tuzağı:** ç ş ğ ı ö ü 2 bayt; Japonca/Çince/Korece 3 bayt. `alışkanlık` = 13 bayt.
- Tekil yaz; çoğul eşleşir. Ad/alt başlıktaki kelimeleri, geliştirici adını, rakip/marka adlarını, Apple markalarını (iPhone, iPad, Apple Watch…), fiyat ve “free/ücretsiz”i yazma.
- Her terim 2 karakterden uzun (CJK hariç). `app`, `iphone`, `uygulama` gibi düşük değerli kelimeler bayt israfı.
- Kalan baytı boş bırakma (< 80 bayt bilgi verir).

## Storefront ek dilleri

- Her storefront’ta varsayılan + ek diller indekslenir (gözlem; Apple taahhüdü değil). Örn. ABD: en-US + es-MX, zh-Hans, … ; Türkiye: en-GB + tr.
- Aynı storefront’ta sayılabilecek iki dile **farklı** kelimeler yaz (validate 3’ten fazla ortak terimi uyarır). Örn. ABD için `es-MX` alanına İngilizce ikincil terimler koymak bir stratejidir — ancak yalnız uygulama o dilde de metadata’ya sahipse.

## App Store etiketleri (yalnız ABD)

- en-US metadata’dan yapay zekâ + kürasyonla atanır. en-US ad/alt başlık/açıklamada hedef kavramları açık kullan. Yüklemeden sonra ASC’de etiketleri kontrol etmeyi hatırlat.

## Custom Product Pages

- 2–5 öneri: rakip boşluklarından ve yorum kümelerinden segment çıkar (ör. “sabah rutini”, “su içme hedefi”). Her sayfaya **çakışmayan** kelime kümesi; kelimeler son onaylı sürümün kelime alanından atanır.

## Ekran görüntüsü başlıkları

- Etkisi tartışmalı (Appfigures 2025 gözlemi vs. zayıf testler). İki ihtimale göre yaz: ilk 3 başlık büyük, kontrastlı ve ad/alt başlıktaki ana kelimeyi pekiştirsin.
