# Apple specifications (October 2026)

The single source of truth is `data/targets.json` and `references/apple-notes.md`; this file is a summary.

## Render matrix

| Target id | Asset | px | Status |
| --- | --- | --- | --- |
| `iphone-6.3` | iPhone Dynamic Island medium | 1206×2622 (1179×2556 also accepted) | **Required** |
| `iphone-6.9` | iPhone Dynamic Island large | 1320×2868 | Recommended, always generated |
| `ipad-13` | iPad 13" | 2064×2752 | Required if iPad is supported |
| `duo-outer` | iPhone Duo outer | 1398×2034 | Required from April 2027 (iOS 27.1 SDK) |
| `duo-inner` | iPhone Duo inner | 2007×2853 | Same |
| `preview-iphone` | App Preview iPhone (including Duo) | 886×1920 | Optional, ≤ 3 |
| `preview-ipad` | App Preview iPad | 1200×1600 | Optional (enable in config) |
| `preview-mac` / `preview-tv` / `preview-vision` | App Preview Mac / Apple TV / Vision Pro (landscape) | 1920×1080 / 1920×1080 / 3840×2160 | Optional (enable in config) |
| `header` | Product page header 21:9 | 3840×1646 | Optional, Asset Library |
| `search` | Search result 3:2 | 1920×1280 – 3840×2560 | Optional, Asset Library |
| `event-card` / `event-detail` | In-App Event 16:9 / 9:16 | range | If there are events |

Mac, Apple TV and Vision Pro targets are enabled with `targets.enable`.

## Screenshots

- 1–10 per locale and device; PNG/JPEG; **no alpha** (Vitrin applies flatten + removeAlpha).
- Content must show the real UI (App Review 2.3).
- On the 6.9" screenshot, headline ≥ 96 px; WCAG AA contrast (large text ≥ 3:1).

## App Preview

- 15–30 s (target 20–25), **constant 30 fps**, H.264 High@4.0 10–12 Mbps, stereo AAC 256 kbps 48 kHz, ≤ 500 MB.
- Without music, a silent stereo track (Vitrin adds it). The poster frame is at 5 seconds — make that frame legible.
- A different aspect ratio ends up in the "A Closer Look" section. Previews appear before screenshots; processing can take up to 24 hours.
- Only app footage + text/motion; no hands or people.

## Creative assets

- Header 21:9 and search 3:2: image or 5–30 s video (30/60 fps). In search they are muted and loop continuously → they must make sense when watched without sound.
- Approved independently of app versions; reused in CPP, In-App Events and PPO.

## Text limits

Name 2–30 · subtitle 30 · promotional text 170 · description 4000 · What's New 4000 · **keywords 100 bytes** · review notes 4000 bytes.

## API

- ASC API 4.5.1 (OpenAPI spec 4.5.1; details in references/apple-notes.md): the release notes deprecate Screenshot/Preview Sets in favour of the App Asset Library, but the spec still lists them. Classic types per target are in `data/asc-display-types.json` — 6.9" iPhone is `APP_IPHONE_67` / preview `IPHONE_67` (there is no 69), Mac `APP_DESKTOP`/`DESKTOP`, TV `APP_APPLE_TV`/`APPLE_TV`, Vision `APP_APPLE_VISION_PRO`/`APPLE_VISION_PRO`; iPhone Duo has no classic type.
- Partial runs replace one set per localization and display type through the classic API; iPhone Duo and the header/search creatives go through the App Asset Library (`placementType` + `placementGroup` from `GET /v1/appAssetLibraryRefData`, `category`, ordering requests). doctor compares refData with `data/asc-display-types.json`.
- `upload.uploader: asc` uses the asc CLI (`brew install asc`, no Ruby) for App Store text and media; fastlane deliver stays the default.
- An app record cannot be created with an API key (403). For an app that is only on TestFlight, the first App Store version may have to be created manually.
