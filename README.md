# Vitrin

Vitrin bir iOS projesini okur, rakip ve anahtar kelime araştırması yapar; App Store Connect için ASO uyumlu metadata, rozetli ekran görüntüleri, ürün sayfası/arama kreatifleri ve App Preview videoları üretir, doğrular ve fastlane + ASC API ile yükler. Akışın tamamı Claude Code’da `/vitrin` skill’i ile çalışır.

**İş bölümü:** yaratıcı kararlar (metin, kelime seçimi, sanat yönü, görsel ve video planı) Claude’da; veri toplama, render, doğrulama ve yükleme bu TypeScript CLI’da. Ek LLM anahtarı gerekmez. Apple’ın Ekim 2026 kuralları ve doğrulanamayan noktalar için: [docs/apple-notes.md](docs/apple-notes.md).

## Kurulum

Gereksinimler: macOS, Node.js ≥ 22, pnpm, Xcode (simctl), Ruby + Bundler, ffmpeg.

```bash
skill/scripts/install.sh
```

Betik bağımlılıkları kurar, CLI’ı derler, Playwright Chromium’u indirir, `vitrin` komutunu bağlar ve skill’i `~/.claude/skills/vitrin` altına kopyalar. Uygulama reposunda:

```bash
vitrin init
```

ardından Claude Code’da `/vitrin`.

## Komutlar

| Komut | Çıktı |
| --- | --- |
| `vitrin init` | `vitrin.config.yaml`, `.env.example`, `.gitignore` satırları, `Gemfile` (fastlane ≥ 2.241.1), `fastlane/Fastfile` |
| `vitrin doctor` | Araçlar, `.env`, `.p8`, canlı JWT testi, uygulama kaydı, düzenlenebilir sürüm, URL’ler, Asset Library refData |
| `vitrin analyze` | `.vitrin/app_profile.json` — hedefler, iPad, diller, entitlements, izinler, IAP, App Intents, renkler, kanıtlı özellikler |
| `vitrin research` | `.vitrin/competitors.json`, `.vitrin/keywords/<dil>.json` — iTunes Search/Lookup, RSS, yorumlar, OCR, palet, rekabet/popülerlik |
| `vitrin write` | Claude’un metadata’sını doğrular → `fastlane/metadata/` |
| `vitrin capture` | Simülatörde ham görüntüler ve kayıtlar → `.vitrin/raw/<dil>/<aile>/` |
| `vitrin design` | HTML → Playwright → `fastlane/screenshots/<dil>/NN_<slug>_<hedef>.png`, `.vitrin/creative/` |
| `vitrin video` | Remotion → `fastlane/app-previews/<dil>/NN_IPHONE_67.mp4`, başlık/arama döngüleri |
| `vitrin validate` | `.vitrin/validation.json` (hata varsa çıkış 1) |
| `vitrin review` | `.vitrin/report.html` — arama satırı, ürün sayfası, temas sayfaları, sayaçlar, rakipler |
| `vitrin upload [--dry-run]` | Plan; onaydan sonra deliver / Asset Library / CPP / In-App Events, ardından geri okuma |
| `vitrin submit --confirm <bundleId>` | İncelemeye gönderir (yalnız açık onayla) |
| `vitrin all` | Hepsini sırayla; girdi beklenen aşamada durur |

Çıkış kodları: `0` tamam, `1` hata, `2` girdi bekleniyor (Claude için brief `.vitrin/briefs/<aşama>.md` ya da kullanıcı için eksik anahtar). Aşamalar `.vitrin/state.json` ile idempotenttir; `--force` yeniden çalıştırır.

## Anahtarlar

`.env` (asla commit edilmez):

```
ASC_KEY_ID=          # ASC > Users and Access > Integrations > App Store Connect API (Team Key, ≥ App Manager)
ASC_ISSUER_ID=
ASC_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8   # veya ASC_KEY_CONTENT_BASE64
```

Opsiyonel: Apple Ads, AppTweak, `FASTLANE_USER/PASSWORD` (yalnız `produce`), `REVIEW_DEMO_USER/PASSWORD`. Anahtarlar eksikken analiz ve üretim devam eder; yükleme `doctor` geçmeden başlamaz (erken uyarı, geç kapı).

## Render matrisi

iPhone 6,3" 1206×2622 (zorunlu), 6,9" 1320×2868, iPad 13" 2064×2752 (iPad varsa), iPhone Duo dış 1398×2034 / iç 2007×2853, App Preview 886×1920 (30 fps, H.264 High@4.0, stereo AAC), ürün sayfası başlığı 3840×1646, arama 3:2. Tam liste: [data/targets.json](data/targets.json).

## Repo yapısı

```
packages/cli        komutlar, state, brief’ler, simülatör, rapor
packages/schemas    zod şemaları (AppProfile, Competitors, KeywordPlan, Metadata, ArtDirection, ShotList, VideoPlan, Report, Config)
packages/core       maskeleyen logger, exec, state, config/.env, veri dosyaları, önbellekli HTTP
packages/analyzer   pbxproj / Info.plist / entitlements / xcstrings / xcassets / storekit / kod sinyalleri
packages/research   iTunes Search/Lookup, RSS, yorumlar, Vision OCR (Swift), k-means palet, kelime puanı
packages/validate   metin, görsel, video ve iddia-kanıt kontrolleri
packages/render     HTML şablon motoru (Background, DeviceFrame, Caption, Badge), Playwright + sharp
packages/video      Remotion: AppPreview, HeaderLoop, SearchLoop, EventCard; ffmpeg normalizasyonu
packages/upload     fastlane köprüsü, ASC API (JWT), App Asset Library, CPP, In-App Events, plan ve geri okuma
fastlane/           Gemfile ve Fastfile şablonları
data/               targets.json, asc-locales.json, storefront-languages.json, forbidden-terms.json
skill/              SKILL.md, references/, scripts/install.sh
examples/Ritim      uçtan uca test için SwiftUI örnek uygulama (tr + en)
```

## Geliştirme

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/bin.js --cwd examples/Ritim validate
```

## Lisanslar

Fontlar OFL (via @fontsource), ikonlar Lucide (ISC). Remotion bireyler ve ≤ 3 çalışanlı şirketler için ücretsizdir; daha büyük ekipler Remotion şirket lisansı almalıdır.
