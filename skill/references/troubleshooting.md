# Sorun giderme

## Demo modu (-VitrinDemo)

Ekran görüntüleri gerçek kullanıcı verisi göstermemeli ve her çalışmada aynı olmalı. Uygulamada yoksa kullanıcıya şunu öner (onay almadan uygulama koduna dokunma):

```swift
// Support/VitrinDemo.swift
enum VitrinDemo {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-VitrinDemo") }
    /// -VitrinScreen <id> → açılışta gösterilecek ekran
    static var screen: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-VitrinScreen"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
```

- `isEnabled` iken bellek içi depo + sabit, dile göre demo verisi; izin istemleri ve ağ/StoreKit çağrıları kapalı.
- Kök görünümde `VitrinDemo.screen`’e göre sekme seç / push / sheet aç.
- Dil `-AppleLanguages (tr) -AppleLocale tr_TR` ile gelir; sabit metin kullanma.
- Örnek uygulama: `examples/Ritim/Ritim/Support/VitrinDemo.swift`.

## iPhone Duo

- fastlane < 2.241.1 Duo boyutlarını tanımaz ve **tüm yüklemeyi durdurur** → Gemfile’da `>= 2.241.1`, `bundle update fastlane`.
- deliver dokümanında Duo sınıfı geçmiyor; yükleme hatası olursa `vitrin upload --uploader=asset-library` (API’de `IPHONE_DUO` doğrulanmış).
- Simülatörde katlama pozisyonu (dış/iç ekran) otomatikleştirilemiyor: capture sırasında simülatörde elle seç ya da Duo ham görüntülerini `capture.mode: manual` ile koy. Duo ham görüntüsü yoksa iPhone görüntüsü kullanılır ve uyarı verilir.

## Uygulama kaydı yok / 403

- API anahtarıyla uygulama oluşturulamaz. ASC > Apps > + ile bir kez elle oluştur (bundle id, SKU, birincil dil). `fastlane produce` yalnız Apple ID + 2FA ile çalışır (FASTLANE_USER/PASSWORD).
- 401: Key ID / Issuer ID / .p8 eşleşmiyor ya da anahtar iptal edilmiş.
- 403: anahtar rolü yetersiz (en az App Manager, Team Key).

## Düzenlenebilir sürüm yok

- `vitrin doctor --create-version 1.2.0` deliver ile açmayı dener.
- Yalnız TestFlight’ta olan uygulamada API ilk App Store sürümünü reddedebilir → ASC’de “+ Version” ile bir kez elle aç, sonra “devam”.

## Video işlenmiyor

- ASC’de önizleme “Processing” 24 saate kadar sürebilir. `ffprobe` kontrolleri geçtiyse bekle.
- Reddedilme nedenleri: 60 fps, ses kanalı yok, mono ses, süre < 15 sn, yanlış çözünürlük. `vitrin validate` bunların hepsini ölçer; Vitrin videoları ffmpeg ile High@4.0, 30 fps CFR, stereo AAC 48 kHz’e normalize eder.
- Remotion ilk çalışmada Chrome Headless Shell indirir; ağ yoksa `vitrin video` başarısız olur.

## deliver deprecation / eski görsel uçları

- ASC API 4.5.1 Screenshot/Preview Sets’i kullanımdan kaldırdı. deliver bu uçlarda hata verirse Vitrin mesajı `--uploader=asset-library` önerir. Asset Library öznitelik adları tam doğrulanmadı (docs/apple-notes.md); ilk çalışmada `.vitrin/cache/refdata.json`’a bak.

## Playwright / fontlar

- `npx playwright install chromium`.
- Yazı tipi eksik görünüyorsa `art-direction.json` → typography yalnız gömülü ailelerden olmalı (Inter, Manrope, Space Grotesk, Plus Jakarta Sans, DM Sans, Fraunces, Playfair Display, Noto Sans).

## Aşama atlanıyor

- Girdi hash’i aynıysa aşama atlanır. Zorlamak için `vitrin --force <komut>`; tamamen sıfırlamak için `.vitrin/state.json`’ı sil.
