# Apple notes (October 24, 2026)

The pages below were read before any code was written. When the master prompt ([docs/design/master-prompt.md](design/master-prompt.md)) and the current documentation disagree, the documentation wins; the differences are listed at the end.
The values are encoded in `data/targets.json`, `data/asc-locales.json`, `data/storefront-languages.json` and `packages/schemas/src/limits.ts`.

## Screenshots — Screenshot specifications

- 1–10 screenshots per device size and locale; `.jpeg`, `.jpg`, `.png`; no alpha/transparency. Missing sizes are scaled from a fallback class.
- **iPhone, Dynamic Island medium display: 1206×2622 or 1179×2556 — required (at least one set).** Fallback: Face ID large.
- iPhone, Dynamic Island large display: 1320×2868, 1290×2796, 1260×2736 — not required. Fallback: Face ID large.
- Face ID large: 1284×2778, 1242×2688 — required if the app runs on iPhone and no Dynamic Island large set is provided.
- **iPhone Duo outer: 1398×2034 / 2034×1398; inner: 2007×2853 / 2853×2007.** Required from April 2027 for apps built with the iOS 27.1 SDK. Once uploaded, the product page shows an "Optimized for iPhone Duo" badge.
- **iPad 13": 2064×2752 / 2048×2732 — required for apps that run on iPad.** 12.9" and 11" fall back to 13".

## App Preview — App preview specifications

- iPhone Duo, 6.9", 6.5", 6.1" (Dynamic Island medium), 5.8": **886×1920** (reversed in landscape).
- iPad 13", 11", 10.5": **1200×1600**. Mac/Apple TV 1920×1080, Vision Pro 3840×2160.
- 15–30 s, at most 500 MB, at most 30 fps, default poster frame at 5 seconds, at most 3 per device and locale, processing can take up to 24 hours; previews appear before screenshots.
- H.264: `.mov/.m4v/.mp4`, 10–12 Mbps, progressive, at most High Profile Level 4.0, stereo AAC 256 kbps 44.1/48 kHz.
- ProRes 422 (HQ only): `.mov`, ~220 Mbps VBR, audio PCM or AAC 256 kbps.

## Creative assets — Creative assets specifications

- Product page header 21:9: **3840×1646** image or video (5–30 s, 30/60 fps).
- Search result 3:2: **1920×1280 – 3840×2560** image or video (5–30 s, 30/60 fps). Muted in search and cannot be unmuted.
- **16:9, 5244×2950, PNG only** — listed for both the header and the search placement; its purpose is not explained on the page (open question, see below).
- In-App Event card 16:9 (1920×1080–3840×2160), detail 9:16 (1080×1920–2160×3840); video 15–30 s; 500 MB.
- Product page videos are muted by default; the user can turn sound on.

## Text fields — Platform version information, App information

| Field | Limit | Note |
| --- | --- | --- |
| Name | 2–30 characters | |
| Subtitle | 30 characters | |
| Promotional text | 170 characters | |
| Description | 4000 characters | plain text, no HTML |
| Keywords | 100 **bytes** | each keyword longer than 2 characters; do not repeat the app or company name |
| What's New | 4000 characters | not available for the first version |
| Review notes | 4000 **bytes** | the demo account must not expire |
| Copyright | — | starts with the year ("2026 Company"); © is added automatically |
| Support / Marketing URL | full URL with protocol | support URL is required |
| Privacy URL | — | required for iOS and macOS |
| Subcategory | — | 1–2 for Games/Stickers |

## Locales — App Store localizations

- 50 locales. The page gives language names; the codes were taken from the fastlane deliver language list (`ar-SA, bn-BD, ca, … zh-Hans, zh-Hant`).
- The full storefront → default + additional languages table is in `data/storefront-languages.json` (175 storefronts). Examples: Mexico = Spanish (Mexico) + English (U.K.); Türkiye = English (U.K.) + Turkish; United States = English (U.S.) + 9 additional languages.

## ASC API 4.5.1

- **Deprecated:** App Screenshot Sets, App Screenshots, App Preview Sets, App Previews, App Event Screenshots, App Event Video Clips → App Asset Library images, videos, placements.
- **New endpoints:** `POST /v1/appAssetLibraryImages`, `POST /v1/appAssetLibraryVideos`, `GET /v1/apps/{id}/assetLibrary`, `GET /v1/appAssetLibraries/{id}/images|videos`, `POST /v1/appAssetLibraryPlacements`, `POST /v1/appAssetLibraryPlacementOrderingRequests`, `GET /v1/{appStoreVersionLocalizations|appCustomProductPageLocalizations|appEventLocalizations|appStoreVersionExperimentTreatmentLocalizations}/{id}/placements`, `GET /v1/appAssetLibraryRefData`.
- `IPHONE_DUO` was added to the `AppAssetLibraryDisplayClass` enum.
- The release notes do not include attribute names. The "Understanding / Migrating to the App Asset Library" and refData pages returned only their titles when fetched (they are rendered with JavaScript).

## fastlane

- `app_store_connect_api_key(key_id:, issuer_id:, key_filepath: | key_content:, is_key_content_base64:, duration: ≤1200, in_house:)`.
- deliver metadata files: `<locale>/{name,subtitle,privacy_url,description,keywords,release_notes,support_url,marketing_url,promotional_text}.txt`; root: `copyright.txt`, `primary_category.txt`, `secondary_category.txt`, subcategory files; `review_information/{first_name,last_name,phone_number,email_address,demo_user,demo_password,notes}.txt`.
- `app_previews_path` infers the device **from the file name**: `IPHONE_40, 47, 55, 58, 61, 65, 67, IPAD_97, IPAD_105, IPAD_PRO_129, IPAD_PRO_3GEN_11, IPAD_PRO_3GEN_129, DESKTOP`; at most 3 per locale/device. Vitrin names previews `NN_IPHONE_67.mp4` and `NN_IPAD_PRO_3GEN_129.mp4` (886×1920 covers all modern iPhone classes).
- The screenshot class is inferred **from the pixel size**; classes can live in the same folder. Vitrin names files `NN_<slug>_<target>.png`.

## Differences from the master prompt and open questions

1. **fastlane and Duo:** the deliver documentation does not mention `APP_IPHONE_DUO` or Duo at all; Duo support is known only from the 2.241.1 PR. `fastlane 2.241.1` is installed on this machine. Duo upload must be verified on the first real run; if it fails, use `--uploader=asset-library` (the IPHONE_DUO class is verified in the API).
2. **The preview file name list** does not include 6.9"/Duo; 886×1920 is uploaded under the `IPHONE_67` name. According to Apple, this resolution is accepted for all modern classes.
3. **Asset Library attribute names could not be verified.** `packages/upload/src/asset-library.ts` implements the upload flow following ASC's known asset pattern (reservation → uploadOperations → PUT → commit with MD5 → processing state) and checks every response defensively. The `placementType` values (`SCREENSHOT`, `PRODUCT_PAGE_HEADER`, `SEARCH_RESULT`) and the iPhone/iPad display class names (`IPHONE_61`, `IPHONE_69`, `IPAD_PRO_3GEN_129`) are **guesses**; `vitrin doctor` writes refData to `.vitrin/cache/refdata.json` on every run and compares it with `data/targets.json`.
4. **5244×2950 PNG variant** — placement unclear; not generated for now.
5. **Apple Ads popularity:** the Apple Ads Campaign Management API has no endpoint that returns popularity for an arbitrary term (the 1–5 indicator exists only in the web UI). If a key is present, this is reported explicitly and popularity is marked as an "estimate"; if an AppTweak key is present, popularity is read from AppTweak.
6. **New age rating questions** (social media, September 2026): fastlane `app_rating_config_path` support has not been verified; Vitrin only produces draft answers, and the final approval stays with the user.

## Sources

- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations
- https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes
- https://docs.fastlane.tools/actions/deliver/ · https://docs.fastlane.tools/app-store-connect-api/

## fastlane per platform, partial uploads and Google Play (October 26, 2026)

docs.fastlane.tools and support.google.com were not reachable from the build session (proxy policy), so everything below was read from the **fastlane 2.241.1 gem source** (downloaded from rubygems.org) and from Google's **Android Publisher v3 discovery document** (`https://androidpublisher.googleapis.com/$discovery/rest?version=v3`). Implementation: `packages/upload/src/{platforms,scope,stores,play,play-client}.ts`, `fastlane/Fastfile` (`# vitrin-template: 2`).

### deliver and the Apple platforms

- `platform:` accepts `ios`, `appletvos`/`tvos`, `xros` and `osx` (`deliver/lib/deliver/options.rb`); Spaceship maps `xros`/`visionos` to `VISION_OS` for App Store versions. Vitrin runs one deliver per Apple platform the app ships on (`profile.app.platforms`), iOS first: `bundle exec fastlane ios vitrin_upload platform:<p>`.
- There is no watchOS App Store version: **Apple Watch screenshots belong to the iOS version**. deliver picks the display type from the pixel size (`deliver/lib/deliver/app_screenshot.rb`): `APP_WATCH_ULTRA` 410×502 / 422×514, `APP_WATCH_SERIES_10` 416×496, `SERIES_7` 396×484, `SERIES_4` 368×448, `SERIES_3` 312×390. Mac (`APP_DESKTOP`): 1280×800, 1440×900, 2560×1600, 2880×1800. Apple TV: 1920×1080, 3840×2160. Vision Pro: 3840×2160 — the same size as Apple TV, so deliver chooses `APP_APPLE_VISION_PRO` only when the **path contains “vision”** (Vitrin adds `_vision` to the copied name if the target id lacks it).
- deliver uploads every image in a locale folder to the version of its `platform` and **aborts on an unknown size**, and it rejects unknown language folders under `metadata_path` (so `fastlane/metadata/android/`, supply's folder, cannot sit next to deliver's locales). Vitrin therefore builds `.vitrin/deliver/<platform>/{metadata,screenshots,app-previews}/` per run from `.vitrin/render-manifest.json` (routing by target `store`/`platform`), with release notes dropped when that platform's version is a first release.
- **App Previews:** deliver matches a token in the file name (`IPHONE_67`, `IPAD_PRO_3GEN_129`, …, `DESKTOP`) and then checks the resolution (`spaceship/.../app_preview_set.rb`). `DESKTOP` has **no accepted resolution** in 2.241.1 and there is **no Apple TV or Vision Pro preview type**, so Mac/TV/Vision previews cannot go through deliver; Vitrin routes them to the App Asset Library (display classes unverified, see open question 3).

### Partial uploads (`config.selection`) — overwrite decision

- `overwrite_screenshots: true` (`upload_screenshots.rb#delete_screenshots`) deletes **every screenshot set of every display type** for each locale that has at least one local screenshot. Uploading only Apple Watch screenshots with it would wipe the iPhone and iPad sets of that locale.
- `sync_screenshots` (beta, `sync_screenshots.rb`) diffs against **every remote screenshot of every locale** and deletes what is not local — unsafe for partial runs as well.
- Without overwrite, deliver appends to existing sets (duplicates, then the 10-per-set limit).
- `overwrite_preview_videos` deletes the previews of **every preview type** of a locale that has local videos; previews are uploaded whenever `app_previews_path` is set, even with `skip_screenshots`.
- **Decision:** deliver's overwrite is used only for a *complete* set — every covered platform selected (e.g. iOS **and** watchOS for the iOS version) and, for every locale in the run, every enabled target of that kind present. In that case the plan says “replaces EVERY screenshot set of <locale> on <platform>” (display types Vitrin does not render are deleted too, as before). Anything less is partial: the per-platform deliver folders stay empty for that kind and the selected sets are replaced **one display class at a time through the App Asset Library**, deleting only placements that report that `placementType` + `displayClass` (`clearPlacements(…, { strict: true })` refuses when the response does not carry those attributes). A target without `assetLibraryDisplayClass` cannot be replaced partially and becomes a plan blocker. Text is uploaded only when `metadata` is selected (`skip_metadata`); unselected platforms get no deliver run and need no editable version.
- The dry-run plan lists, per platform/locale/display type, what is replaced and an `[untouched · <platform>]` section for everything else; `plan.scope` in `.vitrin/upload-plan.json` holds the same.

### Google Play (supply)

- Lane: `bundle exec fastlane android vitrin_play_upload [validate_only:true]` → `upload_to_play_store` with `skip_upload_apk`/`skip_upload_aab`; Vitrin never sets `rollout`, `track_promote_to` or `release_status`. Key: `json_key` (path, `GOOGLE_PLAY_JSON_KEY_PATH`) or `json_key_data` decoded from `GOOGLE_PLAY_JSON_KEY_BASE64` inside the Fastfile (the content never appears on a command line; supply masks `json_key_data` in its summary; Vitrin registers the base64, `private_key` and `private_key_id` for log masking).
- Layout (`supply/lib/supply.rb`): `<metadata_path>/<language>/{title,short_description,full_description,video}.txt`, `changelogs/<versionCode>.txt` (or `default.txt`), `images/{featureGraphic,icon,tvBanner}.{png,jpg}`, `images/{phoneScreenshots,sevenInchScreenshots,tenInchScreenshots,tvScreenshots,wearScreenshots}/*`. Language folders come from `supply/lib/supply/languages.rb` → `data/play-locales.json`.
- **supply always reads a release on `track`** (default `production`), even for listing-only runs (`perform_upload_meta` → `fetch_track_and_release!`): no release → “Could not find release”; more than one release and no `version_code` → error. Vitrin checks this in the plan through a read-only API edit (`edits.insert` → `listings.list` + `tracks.get` → `edits.delete`).
- Partial safety: supply only touches image types that have local files (`upload_images`/`upload_screenshots` skip empty types; with `sync_image_upload` it compares sha256 within that type), and only languages that have a folder. But **release notes are replaced for all languages of the version code at once** (`upload_changelogs` sets `release.release_notes`): a language without a local changelog ends up empty, and languages Vitrin does not export are dropped. The plan blocks (`play.changelog.would-clear`) when the remote release has notes in a language without a local changelog; unselected `metadata` skips listing text and changelogs.
- `validate_only: true` uploads into an edit that Google validates and does not commit (`client.validate_current_edit!`); `vitrin upload --dry-run` runs it when a key and a Gemfile exist.
- Android Publisher v3: `Listing` = `language`, `title`, `shortDescription`, `fullDescription`, `video` (YouTube URL); image upload `maxSize` 15 MB, `accept: image/*`; image types `phoneScreenshots, sevenInchScreenshots, tenInchScreenshots, tvScreenshots, wearScreenshots, icon, featureGraphic, tvBanner`; scope `https://www.googleapis.com/auth/androidpublisher`.
- App icon (developer.android.com, Google Play icon design specifications, last updated 2026-10-20): 512×512, 32-bit PNG, at most 1024 KB.
- **Not verified in this session** (Play Console Help unreachable; values from the task brief and earlier knowledge, encoded in `PLAY_TEXT_LIMITS`/`PLAY_IMAGE_RULES`): title ≤ 30, short description ≤ 80, full description ≤ 4000, release notes ≤ 500; screenshots JPEG or 24-bit PNG without alpha, 320–3840 px per side, long side ≤ 2× short side, 2–8 per type, ≤ 8 MB; feature graphic exactly 1024×500 JPEG or 24-bit PNG; the metadata policy (no emoji, emoticons or repeated special characters in the title, no ALL CAPS unless the brand, no ranking/performance/price/promotional claims in title, icon or developer name).

Sources: rubygems.org fastlane-2.241.1.gem (`deliver/lib/deliver/{options,app_screenshot,loader,upload_screenshots,sync_screenshots,sync_app_previews,runner}.rb`, `spaceship/lib/spaceship/connect_api.rb`, `spaceship/lib/spaceship/connect_api/models/app_preview_set.rb`, `supply/lib/supply{,/options,/uploader,/languages}.rb`) · https://androidpublisher.googleapis.com/$discovery/rest?version=v3 · https://developer.android.com/distribute/google-play/resources/icon-design-specifications
