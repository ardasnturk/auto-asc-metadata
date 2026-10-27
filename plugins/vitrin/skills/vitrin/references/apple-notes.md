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

## Other Apple platforms (re-checked October 26, 2026)

Read from the screenshot and app preview specification pages on October 26, 2026 (`curl` of the live pages); encoded as `mac-16x10`, `watch-ultra`, `watch-series`, `appletv-4k`, `vision-pro`, `preview-mac`, `preview-tv` in `data/targets.json`.

- **Mac:** 16:10, one of 1280×800, 1440×900, 2560×1600, 2880×1800 — required for Mac apps. Vitrin renders 2880×1800 (1440×900 @2x).
- **Apple TV:** 1920×1080 or 3840×2160 — required for Apple TV apps. Vitrin renders 3840×2160.
- **Apple Vision Pro:** 3840×2160 — required for visionOS apps.
- **Apple Watch:** one of 422×514 (Ultra 4, Ultra 3), 410×502 (Ultra 2, Ultra), 416×496 (Series 12, 11, 10), 396×484 (Series 9, 8, 7), 368×448 (Series 6, 5, 4, SE 3, SE 2, SE), 312×390 (Series 3, 2, 1) — required for Apple Watch apps; **the same size must be used across all localizations.** Vitrin produces `watch-ultra` (422×514) by default; `watch-series` (416×496) is an opt-in alternative, never both.
- **App Previews:** Mac 1920×1080, Apple TV 1920×1080, Vision Pro 3840×2160 (all landscape, 16:9; Vision Pro only landscape). `preview-mac` / `preview-tv` / `preview-vision` are opt-in like `preview-ipad`. H.264 High@4.0 is the iPhone/iPad preview profile; the Vision Pro preview is 4K, so `preview-vision` pins no H.264 level.
- **Not verified:** the simctl device type names (`Apple Watch Ultra 3 (49mm)`, `Apple Watch Series 11 (46mm)`, `Apple TV 4K (3rd generation)`, `Apple Vision Pro`) — no Xcode on the machine that wrote this; `capture.simulators` overrides them. Their display types are in `data/asc-display-types.json` (see “ASC API 4.5.1”).

### Platform detection

`vitrin analyze` fills `app.platforms` from the Xcode targets that ship (applications and watch apps; not extensions, tests or the watch container stub):
SDKROOT / SUPPORTED_PLATFORMS `iphoneos` → iOS, `macosx` or `SUPPORTS_MACCATALYST = YES` → macOS, `watchos` → watchOS, `appletvos` → tvOS, `xros` (or TARGETED_DEVICE_FAMILY 7) → visionOS.
"Designed for iPad/iPhone" on Mac or Vision Pro (`SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD`, `SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD`) does **not** add a platform: App Store Connect shows the iPad screenshots there.

### iPhone Duo heuristic

Every iPhone app runs on iPhone Duo, but Duo screenshots are only asked for (and from April 2027 required) for apps built with the iOS 27.1 SDK, which also earns the "Optimized for iPhone Duo" badge. Project files cannot prove the SDK of a build, so `app.supportsDuo` is true when the app runs on iPhone **and** either `LastUpgradeCheck` / `LastSwiftUpdateCheck` ≥ 2710 (the project was upgraded in Xcode 27.1+) or `IPHONEOS_DEPLOYMENT_TARGET` ≥ 27.1. Otherwise Duo targets stay off and the analyzer leaves a todo; `targets.enable: [duo-outer, duo-inner]` overrides it. A false negative is possible for teams that build with Xcode 27.1 without accepting the project upgrade — check before April 2027.

## Google Play (October 26, 2026)

Google's Play Console help (support.google.com) was **not reachable** from the machine that wrote this, so only the icon is verified:

- **Verified** (https://developer.android.com/google-play/resources/icon-design-specifications): app icon 512×512, 32-bit PNG (alpha allowed), sRGB, at most 1024 KB, full square — Play applies the mask (30% radius) and shadow. Target `play-icon`.
- **Unverified, from prior knowledge — check https://support.google.com/googleplay/android-developer/answer/9866151 before relying on them:**
  - feature graphic exactly 1024×500, JPEG or 24-bit PNG without alpha, required to publish (`play-feature-graphic`);
  - 2–8 phone screenshots, JPEG or 24-bit PNG without alpha, each side 320–3840 px, the long side at most twice the short side; 1080×1920 (9:16) meets the promotion guideline (`play-phone`);
  - 7-inch tablet screenshots each side 320–3840 px (`play-tablet-7`, 1200×1920), 10-inch tablet screenshots each side 1080–7680 px (`play-tablet-10`, 1600×2560). Tablet targets are enabled only when the Android app has tablet resources (`layout-sw600dp`, `values-large`, …).
- AVD device profiles (`pixel_9`, `Nexus 7 2013`, `pixel_tablet`) are avdmanager ids from prior knowledge; `capture.android.avds` overrides them.

## App Preview — App preview specifications

- iPhone Duo, 6.9", 6.5", 6.1" (Dynamic Island medium), 5.8": **886×1920** (reversed in landscape).
- iPad 13", 11", 10.5": **1200×1600**. Mac/Apple TV 1920×1080, Vision Pro 3840×2160.
- 15–30 s, at most 500 MB, at most 30 fps, default poster frame at 5 seconds, at most 3 per device and locale, processing can take up to 24 hours; previews appear before screenshots.
- H.264: `.mov/.m4v/.mp4`, 10–12 Mbps, progressive, at most High Profile Level 4.0, stereo AAC 256 kbps 44.1/48 kHz.
- ProRes 422 (HQ only): `.mov`, ~220 Mbps VBR, audio PCM or AAC 256 kbps.

## Creative assets — Creative assets specifications

- Product page header 21:9: **3840×1646** image or video (5–30 s, 30/60 fps).
- Search result 3:2: **1920×1280 – 3840×2560** image or video (5–30 s, 30/60 fps). Muted in search and cannot be unmuted.
- **16:9, 5244×2950, PNG only** — an alternative format for both the product page header and the search result asset (not rendered by Vitrin yet).
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

Source: the **App Store Connect API OpenAPI specification 4.5.1** (`info.version` `4.5.1`; Apple's download `https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip`, read from the offline snapshot `docs/openapi/latest.json` of [rorkai/App-Store-Connect-CLI](https://github.com/rorkai/App-Store-Connect-CLI) (MIT), synced 2026-10-07). The enums and request schemas Vitrin uses are copied unchanged into `packages/upload/test/fixtures/asc-openapi-4.5.1-subset.json`, and every request body Vitrin sends is validated against them in `packages/upload/test/asc-media.test.ts`. The mapping per target is `data/asc-display-types.json`.

- **Release notes:** App Screenshot Sets, App Screenshots, App Preview Sets, App Previews, App Event Screenshots and App Event Video Clips are deprecated in favour of the App Asset Library. **The 4.5.1 spec still publishes all of their operations without a `deprecated` flag** (`POST /v1/appScreenshotSets`, `POST|PATCH|DELETE /v1/appScreenshots`, `PATCH /v1/appScreenshotSets/{id}/relationships/appScreenshots`, the `appPreview*` equivalents, `GET /v1/appStoreVersionLocalizations/{id}/appScreenshotSets?filter[screenshotDisplayType]=…`), and fastlane deliver and asc use them.
- **Classic types:** `ScreenshotDisplayType` = `APP_IPHONE_67, 61, 65, 58, 55, 47, 40, 35`, `APP_IPAD_PRO_3GEN_129, APP_IPAD_PRO_3GEN_11, APP_IPAD_PRO_129, APP_IPAD_105, APP_IPAD_97`, `APP_DESKTOP`, `APP_WATCH_ULTRA, APP_WATCH_SERIES_10, 7, 4, 3`, `APP_APPLE_TV`, `APP_APPLE_VISION_PRO` and the `IMESSAGE_APP_*` variants. **There is no `APP_IPHONE_69` and no Duo type:** 6.9" screenshots (1320×2868, 1290×2796, 1260×2736) go into `APP_IPHONE_67` (asc's `internal/screenshotcatalog/catalog.go` maps its local alias `APP_IPHONE_69` → `APP_IPHONE_67` for the same reason). `PreviewType` = `IPHONE_67, 61, 65, 58, 55, 47, 40, 35`, `IPAD_PRO_3GEN_129, IPAD_PRO_3GEN_11, IPAD_PRO_129, IPAD_105, IPAD_97`, `DESKTOP`, `APPLE_TV`, `APPLE_VISION_PRO`.
- **Classic upload flow:** `POST /v1/appScreenshots` (`fileName`, `fileSize`, relationship `appScreenshotSet`) → `uploadOperations` (method, url, offset, length, requestHeaders) → `PATCH` with `uploaded: true` and `sourceFileChecksum` (MD5) → poll `assetDeliveryState.state` (`AWAITING_UPLOAD`, `UPLOAD_COMPLETE`, `COMPLETE`, `FAILED`). App Previews: `POST /v1/appPreviews` also takes `mimeType` and `previewFrameTimeCode`; `assetDeliveryState` is deprecated there in favour of `videoDeliveryState` (adds `PROCESSING`).
- **Asset Library enums:** `AppAssetLibraryPlacementType` = `APP_SCREENSHOT, IMESSAGE_APP_SCREENSHOT, APP_PREVIEW, PRODUCT_PAGE_HEADER_ASSET, APP_STORE_SEARCH_RESULTS_ASSET, SEARCH_RESULTS_ADS_ASSET, TODAY_TAB_ADS_ASSET, EVENT_CARD_ASSET, EVENT_DETAILS_PAGE_ASSET, RETENTION_MESSAGE_ASSET`. `AppAssetLibraryDisplayClass` = `DEFAULT, WATCH_ULTRA, WATCH_SERIES_10, 7, 4, 3, IPHONE_DUO, IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY, IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY, IPHONE_FACE_ID_LARGE_DISPLAY, IPHONE_FACE_ID_MEDIUM_DISPLAY, IPHONE_HOME_BUTTON_LARGE/MEDIUM/40/35_DISPLAY, IPAD_13_DISPLAY, IPAD_11_DISPLAY, IPAD_129_DISPLAY, IPAD_105_DISPLAY, IPAD_97_DISPLAY` — there is no Mac, TV or Vision class: those use `DEFAULT` with `AppAssetLibraryPlacementPlatform` `MAC_APP_STORE`, `TV_APP_STORE`, `VISION_PRO_APP_STORE` (others: `IPHONE_APP_STORE, IPAD_APP_STORE, WATCH_APP_STORE, IMESSAGE_APP_STORE, ANY`). `AppAssetLibraryAssetCategory` = `CREATIVE_ASSETS, APP_SCREENSHOTS_AND_PREVIEWS`.
- **Asset Library requests:** `POST /v1/appAssetLibraryImages|Videos` requires `fileName`, `fileSize`, `category` and the `assetLibrary` relationship (`GET /v1/apps/{id}/assetLibrary` gives its id); videos may carry `previewFrameTimeCode`. The commit is `PATCH` with `uploaded: true` — **no `sourceFileChecksum`** on these resources. Processing is the top-level `state` (`AppAssetLibraryAssetState`: `AWAITING_UPLOAD, UPLOAD_COMPLETE, FAILED, COMPLETE, PREPARE_FOR_SUBMISSION, … APPROVED, REJECTED, ARCHIVED`) with `stateDetails`. `POST /v1/appAssetLibraryPlacements` takes attributes `placementType` (required) and `placementGroup`, and relationships `image` or `video` plus exactly one of `appStoreVersionLocalization`, `appCustomProductPageLocalization`, `appEventLocalization`, `appStoreVersionExperimentTreatmentLocalization`. **Placements have no `displayClass` attribute**: the device set is the `placementGroup`, an id from `GET /v1/appAssetLibraryRefData` → `placementProfileGroups[] { placementProfileGroupId, platform, displayClassId }` (refData also lists `placementTypes[].specMappings[].placementGroupId`, `displayClasses[].screenDimensions`, `imageSpecs`, `videoSpecs`, `features`). `GET /v1/{owner}/{id}/placements` filters by `placementType`, `placementGroup`, `state`. Order: `POST /v1/appAssetLibraryPlacementOrderingRequests` with `placementGroup` + `orderedPlacements` + the owner localization (not for In-App Event localizations).
- `IPHONE_DUO` is in `AppAssetLibraryDisplayClass` (also in the release notes).

### How Vitrin uploads (packages/upload)

- **Complete sets** (every enabled target of the version and locale): fastlane deliver with overwrite, unchanged.
- **One display type** (partial runs, and Mac/TV/Vision previews deliver has no type for): `screenshot-sets.ts` — find the set of that localization and type (`filter[screenshotDisplayType]` / `filter[previewType]`, refusing if the response holds another type), create it if missing, delete only its items, reserve → upload operations → commit with MD5 → poll, then set the order (`PATCH …/relationships/appScreenshots|appPreviews`). Limits (10 screenshots, 3 previews) and every file are checked before anything is deleted. Other display types and locales are never read or written.
- **App Asset Library** only where the classic API has no type: iPhone Duo screenshots, product page header and search creatives (`--creatives`); or every set with `upload.uploader: asset-library`. `asset-library.ts` resolves the `placementGroup` from refData (platform + displayClassId), deletes only placements whose `placementType` **and** `placementGroup` match (refusing if the filtered list contains anything else), uploads with the right `category`, places and requests the order. Header, search and event creatives use `DEFAULT_PROFILE` when refData lists no group for them (the value asc sends).
- `vitrin doctor` saves refData to `metadata/.cache/refdata.json` and checks that every screenshot/preview mapping has a placement group, that the target sizes are among the class's `screenDimensions`, and that refData has no display class the spec does not list.

### Open points (not settled by the spec)

1. **Which display class a size belongs to** is not in the spec: Vitrin maps 6.3" → `IPHONE_DYNAMIC_ISLAND_MEDIUM_DISPLAY`, 6.9" → `…_LARGE_DISPLAY`, iPad 13" → `IPAD_13_DISPLAY`, and the 886×1920 iPhone preview → `…_LARGE_DISPLAY` (classic `IPHONE_67`). The live refData (`displayClasses[].screenDimensions`) confirms or refutes this; doctor reports any mismatch.
2. **`placementGroup` ids** are runtime data (refData), not an enum. asc documents `IPHONE_DUO_PROFILE` and `DEFAULT_PROFILE`; Vitrin never hard-codes a device group.
3. **iPhone Duo in the classic API:** not in 4.5.1's `ScreenshotDisplayType`/`PreviewType`. asc accepts `APP_IPHONE_DUO` / `IPHONE_DUO` as device types anyway (unverified against the spec); Vitrin uses the Asset Library for Duo in every uploader. Whether a Duo App Preview has its own placement group is unknown (Vitrin renders no Duo preview).
4. **Processing states:** which `AppAssetLibraryAssetState` a finished `APP_SCREENSHOTS_AND_PREVIEWS` image reports first (`COMPLETE` or `PREPARE_FOR_SUBMISSION`); Vitrin accepts either. asc waits for `PREPARE_FOR_SUBMISSION` on creative images.
5. **Deprecation timeline** of the classic set endpoints: the release notes deprecate them, the spec still lists them. If Apple starts rejecting them, `fastlane.ts` points to `--uploader=asset-library`.

## fastlane

- `app_store_connect_api_key(key_id:, issuer_id:, key_filepath: | key_content:, is_key_content_base64:, duration: ≤1200, in_house:)`.
- deliver metadata files: `<locale>/{name,subtitle,privacy_url,description,keywords,release_notes,support_url,marketing_url,promotional_text}.txt`; root: `copyright.txt`, `primary_category.txt`, `secondary_category.txt`, subcategory files; `review_information/{first_name,last_name,phone_number,email_address,demo_user,demo_password,notes}.txt`.
- `app_previews_path` infers the device **from the file name**: `IPHONE_40, 47, 55, 58, 61, 65, 67, IPAD_97, IPAD_105, IPAD_PRO_129, IPAD_PRO_3GEN_11, IPAD_PRO_3GEN_129, DESKTOP`; at most 3 per locale/device. Vitrin names previews after their `PreviewType`: `NN_IPHONE_67.mp4`, `NN_IPAD_PRO_3GEN_129.mp4`, `NN_DESKTOP.mp4`, `NN_APPLE_TV.mp4`, `NN_APPLE_VISION_PRO.mp4` (886×1920 covers all modern iPhone classes; the classic enum has no 6.9" type).
- The screenshot class is inferred **from the pixel size**; classes can live in the same folder. Vitrin names files `NN_<slug>_<target>.png`.

## Differences from the master prompt and open questions

1. **fastlane and Duo:** the deliver documentation does not mention `APP_IPHONE_DUO` or Duo at all; Duo support is known only from the 2.241.1 PR, and the 4.5.1 spec has no Duo `ScreenshotDisplayType`. A complete set (deliver overwrite) relies on deliver; a Duo-only or partial run goes through the App Asset Library (`IPHONE_DUO`, in the spec). Verify on the first real run.
2. **The preview file name list** does not include 6.9"/Duo; 886×1920 is uploaded under the `IPHONE_67` name — the only 6.7"/6.9" `PreviewType` in the spec. According to Apple, this resolution is accepted for all modern classes.
3. **Asset Library attribute names — settled by the 4.5.1 spec** (see “ASC API 4.5.1”). The earlier guesses (`SCREENSHOT`, `PRODUCT_PAGE_HEADER`, `SEARCH_RESULT`, a `displayClass` attribute, `IPHONE_61`/`IPHONE_69`/`IPAD_PRO_3GEN_129`/`DESKTOP`/`APPLE_TV`/`APPLE_VISION_PRO` as display classes) were wrong and are gone. What remains open is listed under “Open points”.
4. **5244×2950 PNG variant — answered:** Apple's creative assets specifications list a 16:9 5244×2950 PNG as an alternative format for both the product page header and the search result asset. Vitrin does not render it yet (it renders the 21:9 header and the 3:2 search result).
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
- App Store Connect API OpenAPI specification 4.5.1 (https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip; offline snapshot `docs/openapi/latest.json` in rorkai/App-Store-Connect-CLI, MIT)
- https://github.com/rorkai/App-Store-Connect-CLI (MIT): `commands/{metadata,screenshots,video-previews,validate}.mdx`, `authentication.mdx`, `internal/{asc,screenshotcatalog,cli/assets,cli/metadata,cli/shared}`
- https://docs.fastlane.tools/actions/deliver/ · https://docs.fastlane.tools/app-store-connect-api/
- https://developer.android.com/google-play/resources/icon-design-specifications (verified) · https://support.google.com/googleplay/android-developer/answer/9866151 (unreachable, unverified)

## fastlane per platform, partial uploads and Google Play (October 26, 2026)

docs.fastlane.tools and support.google.com were not reachable from the build session (proxy policy), so everything below was read from the **fastlane 2.241.1 gem source** (downloaded from rubygems.org) and from Google's **Android Publisher v3 discovery document** (`https://androidpublisher.googleapis.com/$discovery/rest?version=v3`). Implementation: `packages/upload/src/{platforms,scope,stores,play,play-client}.ts`, `fastlane/Fastfile` (`# vitrin-template: 2`).

### deliver and the Apple platforms

- `platform:` accepts `ios`, `appletvos`/`tvos`, `xros` and `osx` (`deliver/lib/deliver/options.rb`); Spaceship maps `xros`/`visionos` to `VISION_OS` for App Store versions. Vitrin runs one deliver per Apple platform the app ships on (`profile.app.platforms`), iOS first: `bundle exec fastlane ios vitrin_upload platform:<p>`.
- There is no watchOS App Store version: **Apple Watch screenshots belong to the iOS version**. deliver picks the display type from the pixel size (`deliver/lib/deliver/app_screenshot.rb`): `APP_WATCH_ULTRA` 410×502 / 422×514, `APP_WATCH_SERIES_10` 416×496, `SERIES_7` 396×484, `SERIES_4` 368×448, `SERIES_3` 312×390. Mac (`APP_DESKTOP`): 1280×800, 1440×900, 2560×1600, 2880×1800. Apple TV: 1920×1080, 3840×2160. Vision Pro: 3840×2160 — the same size as Apple TV, so deliver chooses `APP_APPLE_VISION_PRO` only when the **path contains “vision”** (Vitrin adds `_vision` to the copied name if the target id lacks it).
- deliver uploads every image in a locale folder to the version of its `platform` and **aborts on an unknown size**, and it rejects unknown language folders under `metadata_path` (so `fastlane/metadata/android/`, supply's folder, cannot sit next to deliver's locales). Vitrin therefore builds `metadata/deliver/<platform>/{metadata,screenshots,app-previews}/` per run from `metadata/render-manifest.json` (routing by target `store`/`platform`), with release notes dropped when that platform's version is a first release.
- **App Previews:** deliver matches a token in the file name (`IPHONE_67`, `IPAD_PRO_3GEN_129`, …, `DESKTOP`) and then checks the resolution (`spaceship/.../app_preview_set.rb`). `DESKTOP` has **no accepted resolution** in 2.241.1 and deliver has **no Apple TV or Vision Pro preview type**, so Mac/TV/Vision previews cannot go through deliver; Vitrin replaces their classic preview set (`DESKTOP`, `APPLE_TV`, `APPLE_VISION_PRO` are all in the 4.5.1 `PreviewType`) with `screenshot-sets.ts`.

### Partial uploads (`config.selection`) — overwrite decision

- `overwrite_screenshots: true` (`upload_screenshots.rb#delete_screenshots`) deletes **every screenshot set of every display type** for each locale that has at least one local screenshot. Uploading only Apple Watch screenshots with it would wipe the iPhone and iPad sets of that locale.
- `sync_screenshots` (beta, `sync_screenshots.rb`) diffs against **every remote screenshot of every locale** and deletes what is not local — unsafe for partial runs as well.
- Without overwrite, deliver appends to existing sets (duplicates, then the 10-per-set limit).
- `overwrite_preview_videos` deletes the previews of **every preview type** of a locale that has local videos; previews are uploaded whenever `app_previews_path` is set, even with `skip_screenshots`.
- **Decision:** deliver's overwrite is used only for a *complete* set — every covered platform selected (e.g. iOS **and** watchOS for the iOS version) and, for every locale in the run, every enabled target of that kind present. In that case the plan says “replaces EVERY screenshot set of <locale> on <platform>” (display types Vitrin does not render are deleted too, as before). Anything less is partial: the per-platform deliver folders stay empty for that kind and the selected sets are replaced **one display type at a time**: the classic `appScreenshotSets`/`appPreviewSets` set of that localization and type (only its items are deleted), or for iPhone Duo the App Asset Library placements of that `placementType` + refData `placementGroup`. A target with neither a classic type nor an Asset Library placement in `data/asc-display-types.json` cannot be replaced partially and becomes a plan blocker. Text is uploaded only when `metadata` is selected (`skip_metadata`); unselected platforms get no deliver run and need no editable version.
- The dry-run plan lists, per platform/locale/display type, what is replaced and an `[untouched · <platform>]` section for everything else; `plan.scope` in `metadata/upload-plan.json` holds the same.

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

## asc as an optional uploader (October 26, 2026)

`upload.uploader: asc` in `vitrin.config.yaml` (or `vitrin upload --uploader=asc`) uploads to App Store Connect with the [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI) (MIT, `brew install asc`) instead of fastlane deliver, so Apple uploads need no Ruby. fastlane deliver stays the default; Google Play still uses supply. Read from asc's `commands/*.mdx`, `authentication.mdx` and Go source; implementation in `packages/upload/src/asc-cli.ts` (pure command builders, tested with a recorded runner — the binary is never run in tests).

- **Text:** `asc metadata push --app <id> --version <v> --platform IOS|MAC_OS|TV_OS|VISION_OS --dir metadata/asc/<platform>/metadata` (`--dry-run` during `vitrin upload --dry-run`). Layout (`internal/cli/metadata/foundation.go`; the docs' tree says `versions/`, the code reads `version/`): `app-info/<locale>.json` (`name`, `subtitle`, `privacyPolicyUrl`) and `version/<version>/<locale>.json` (`description`, `keywords`, `marketingUrl`, `promotionalText`, `supportUrl`, `whatsNew`), generated from the fastlane export. A missing field leaves the remote value; an emptied `subtitle`/`promotionalText`/`privacyPolicyUrl` is written as `null` (asc's only clearable fields; the push then adds `--confirm`, which never enables deletes — that is `--allow-deletes`, which Vitrin never passes). App info is pushed with the first platform only. asc's metadata push does not cover categories, copyright or review information; the plan says so.
- **Media:** per locale and classic display type, `asc screenshots upload --version-localization <id> --path <dir> --device-type <APP_…> --replace --confirm` and `asc video-previews upload … --device-type <PreviewType> --replace --confirm`. `--replace` deletes the existing items of that one set only. Files are staged in `metadata/asc/<platform>/media/<locale>/<type>/` with an `NN_` prefix so asc's sorted directory read keeps Vitrin's order. iPhone Duo is not sent through asc (see open point 3); it goes through the App Asset Library.
- **Auth:** asc's documented environment credential — `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_TYPE=team` and one of `ASC_PRIVATE_KEY_PATH` / `ASC_PRIVATE_KEY_B64` — built from Vitrin's `.env` (`ASC_KEY_PATH` → absolute `ASC_PRIVATE_KEY_PATH`, `ASC_KEY_CONTENT_BASE64` → `ASC_PRIVATE_KEY_B64`); `ASC_PROFILE` and the other key sources are cleared so a stored profile cannot win (authentication.mdx resolution matrix). Values only go into the child environment and are registered for log masking.
- **doctor:** with `uploader: asc`, `asc version` must succeed (fix: `brew install asc`), and Ruby/Bundler/fastlane failures become warnings for apps without Android. With `upload.ascValidate: true`, doctor also runs `asc validate --app <id> --platform <p>` (submission readiness: build, metadata, screenshots, age rating, pricing, review contact); a non-zero exit is a warning.
- Not verified on a real account: asc's exit codes for partial failures (it documents `0`/`1` and `10–99` for HTTP errors), the exact `asc version` output format (`asc --version` prints `v1.2.3 (commit: …)`), and whether an empty `ASC_PROFILE`/`ASC_PRIVATE_KEY` counts as unset for asc.
