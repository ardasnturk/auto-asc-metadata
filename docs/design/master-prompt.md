> Original design specification the project was built from (translated from Turkish). Some values may since have been superseded — see docs/apple-notes.md.

# Vitrin — ASC Metadata & Asset Automation

Oct 24, 2026 · @Arda

## Summary

Vitrin will be a CLI and a `/vitrin` skill that reads an iOS project and, informed by competitor analysis, produces ASO-friendly metadata, HTML-based badged screenshots and Remotion videos, validates them, and uploads them with fastlane + the ASC API. The master prompt to paste into Claude Code is in the "Master prompt" section below.

5 recent findings that change the design:

1. The required iPhone screenshot class is now 6.3" (1206 × 2622); it should be generated together with 6.9" and iPad 13".
2. iPhone Duo (on sale since October 23, 2026) introduced two new sizes; they are required from April 2027 and need fastlane ≥ 2.241.1.
3. ASC API 4.5.1 deprecated the legacy screenshot and video APIs; the App Asset Library replaces them.
4. Since October 5, 2026, product page header and search result creatives can be uploaded; fastlane has no equivalent, so they must be uploaded through the API.
5. An app record cannot be created with an API key; this step, the privacy labels and the final approval of the age rating questionnaire stay with you.

The metadata, visuals and fastlane sections are reference material; the skill flow section shows how the key gate works.

## Current ASC metadata fields (October 2026)

Text that earns ranking in App Store search comes from three fields: name (30 characters), subtitle (30 characters) and keywords (100 **bytes**). Apple states that the description is used for web search engines; in ASO practice it is assumed to have no effect on in-store ranking.

### App level (shared across all platforms)

| Field | Limit | Localized | Note for the skill |
| --- | --- | --- | --- |
| Name | 2–30 characters | Yes | Strongest ranking signal; brand + 1–2 primary keywords |
| Subtitle | 30 characters | Yes | Indexed; do not repeat words from the name |
| Privacy policy URL | URL | Yes | Required for iOS and macOS |
| Primary / secondary category | Selection | No | 1–2 subcategories for games; choosing Entertainment/Games determines the iOS 27 Time Allowance category |
| Age rating | Questionnaire | No | The social media feature question has been required since September 2026 |
| Other | Selection/text | — | Content Rights, Made for Kids, EULA, EU DSA trader declaration, regulated medical device declaration |

### Version level (per platform and per version)

| Field | Limit | Required | Note for the skill |
| --- | --- | --- | --- |
| Screenshots | 1–10 / device size / locale | Yes | See the next section |
| App Preview video | At most 3 / device size / locale | No | 15–30 s, to be produced with Remotion |
| Promotional text | 170 characters | No | Changes without review; for campaign announcements |
| Description | 4000 characters, plain text | Yes | No HTML; the first 3 lines are visible before "more" |
| Keywords | 100 bytes | Yes | Each keyword longer than 2 characters; do not repeat the name or developer name; other app/company names are forbidden |
| What's New | 4000 characters | Except for the first version | Per locale with every update |
| Support URL | URL | Yes | Must contain real contact information |
| Marketing URL | URL | No |  |
| Copyright | Text | Yes | "2026 Company Name" format |
| Review notes | 4000 bytes | — | Demo account, test steps; customers never see them |

**The byte trap:** the keyword field counts bytes, not characters. In UTF-8, ç, ş, ğ, ı, ö, ü are 2 bytes; Japanese, Chinese and Korean characters take 3 bytes. The skill must validate with `Buffer.byteLength(str, 'utf8')`.

### Locales

Metadata can be localized into 50 languages and locales: Arabic, Bangla, Catalan, Chinese (Simplified/Traditional), Croatian, Czech, Danish, Dutch, English (Australia, Canada, U.K., U.S.), Finnish, French (France/Canada), German, Greek, Gujarati, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Kannada, Korean, Malay, Malayalam, Marathi, Norwegian, Odia, Polish, Portuguese (Brazil/Portugal), Punjabi, Romanian, Russian, Slovak, Slovenian, Spanish (Mexico/Spain), Swedish, Tamil, Telugu, Thai, Turkish, Ukrainian, Urdu, Vietnamese.

Each storefront shows a default language and additional languages (e.g. Mexico: Spanish (Mexico) + English (U.K.)). The skill should be able to use this table to write different keywords for the additional languages; that additional languages also count in search is an observation of the ASO community, not an official Apple commitment.

Sources: [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information), [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information), [App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations), [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store)

## Image and video specifications

According to Apple's current page, the required iPhone class is now "Dynamic Island (medium display)", i.e. 1206 × 2622 or 1179 × 2556 px. Third-party guides from mid-2026 still list 6.9 inches as required; the skill should therefore always generate 6.9 and 6.3 inches together.

### The skill's render matrix

| Asset | Size (px, portrait) | Format | Status | Production |
| --- | --- | --- | --- | --- |
| iPhone 6.3" (Dynamic Island medium) | 1206 × 2622 | PNG/JPEG, no alpha | Required | HTML → Playwright |
| iPhone 6.9" (Dynamic Island large) | 1320 × 2868 | PNG/JPEG, no alpha | Recommended | HTML → Playwright |
| iPad 13" | 2064 × 2752 | PNG/JPEG, no alpha | Required if iPad is supported | HTML → Playwright |
| iPhone Duo outer display | 1398 × 2034 | PNG/JPEG | Required from April 2027 with the iOS 27.1 SDK | HTML → Playwright |
| iPhone Duo inner display | 2007 × 2853 | PNG/JPEG | Same | HTML → Playwright |
| App Preview iPhone (all modern classes, including Duo) | 886 × 1920 | H.264 .mp4/.mov, ≤30 fps | Optional, at most 3 | Remotion |
| App Preview iPad 13"/11" | 1200 × 1600 | H.264, ≤30 fps | Optional | Remotion |
| Product page header (new) | 3840 × 1646 (21:9) | Image or 5–30 s video, 30/60 fps | Optional | HTML / Remotion |
| Search result creative (new) | 1920 × 1280 – 3840 × 2560 (3:2) | Image or 5–30 s video | Optional | HTML / Remotion |
| In-App Event card | 1920 × 1080 – 3840 × 2160 (16:9) | Image or 15–30 s video | If there are events | HTML / Remotion |
| In-App Event detail | 1080 × 1920 – 2160 × 3840 (9:16) | Image or 15–30 s video | If there are events | HTML / Remotion |

Landscape versions are the same values reversed. Mac (16:10, e.g. 2880 × 1800), Apple TV (3840 × 2160), Vision Pro (3840 × 2160) and Watch sizes are on the same page; the skill should keep them optional in `targets.json`.

### Screenshot rules

- 1–10 screenshots per device size and locale; .jpeg, .jpg or .png; alpha channel and transparency are forbidden.
- If the highest resolution is provided, it is automatically scaled down for smaller devices.
- Once iPhone Duo screenshots are uploaded, an "Optimized for Duo" badge appears on the product page.
- Content must follow App Review 2.3 (accurate metadata): features the app does not have are never shown.

### App Preview rules

- 15–30 seconds, at most 500 MB, H.264 (High Profile 4.0, 10–12 Mbps) or ProRes 422 HQ.
- At most 30 fps. 60 fps Remotion output is rejected; `fps: 30` stays fixed.
- Stereo audio: 256 kbps AAC, 44.1 or 48 kHz. Without music, a silent stereo track must be added.
- The default poster frame is at 5 seconds; videos appear before screenshots, and processing can take up to 24 hours.
- A video with a different aspect ratio ends up in the "A Closer Look" section.

### New creative assets (WWDC26)

Images/videos can be uploaded for the product page header and search results. Videos loop continuously; in search they are muted and cannot be unmuted, while on the product page the user can turn sound on. Remotion compositions must therefore make sense when watched without sound.

Open question: Apple's table also lists a 16:9, 5244 × 2950 PNG variant; which placement it is for is not clear from the page.

Sources: [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [App preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications), [Creative assets specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)

## Additional ASC features and what is new in 2026

The ASO surface is much wider than the text fields: 70 custom product pages, the header and search creatives opened on October 5, 2026, In-App Events and App Store tags are all managed separately. The skill should treat these as "phase 2", after the main metadata.

| Feature | Current status | Role of the skill |
| --- | --- | --- |
| [Custom Product Pages](https://developer.apple.com/help/app-store-connect/create-custom-product-pages/configure-multiple-product-page-versions) | 70 pages per app; different screenshots, videos, promotional text and keywords; own URL; deep links for iOS 18+; requires approval | Suggests 2–5 CPPs from competitor gaps and user segments and produces a screenshot set for each |
| CPP keywords | Assigned from the keywords of the latest approved version; a page appears in search if it is visible and approved | Distributes a non-overlapping keyword set to each page |
| Product Page Optimization | Visual tests against the default page; since WWDC26, creative assets can also be tested | Produces an alternative screenshot variant for each test |
| [Creative assets and Asset Library](https://developer.apple.com/help/app-store-connect/release-notes) | Opened on October 5, 2026; assets are approved independently of versions and reused in CPPs, In-App Events and PPO | Produces the header (21:9) and search (3:2) assets with HTML/Remotion |
| In-App Events | Card 16:9, detail 9:16 media; new badges for Games apps in the US: In-Game Offer, Now On Sale, Try Before You Buy | Produces event copy and media (optional) |
| [App Store tags](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-tags) | Assigned automatically from metadata via AI and human curation; US only and based on en-US metadata; developers can remove unwanted tags | Uses the target concepts clearly in en-US copy; reminds the user to check tags after upload |
| Age rating | 4+, 9+, 13+, 16+, 18+; the social media feature question has been required since September 2026; social features impose a 13+ minimum | Derives draft questionnaire answers from the code; the user approves |
| Accessibility labels | Declaration of VoiceOver, Voice Control, larger text, dark interface, contrast, reduced motion, captions, etc. | Scans the SwiftUI code and drafts which criteria are met; the declaration is the user's |
| Personalized Collections | Personal recommendations in the Apps, Games and Search tabs; in selected countries, for a limited number of apps | No direct control; a clear category and description are enough |
| iPhone Duo badge | Once Duo screenshots are uploaded, an "optimized" badge appears on the product page; the device went on sale on October 23, 2026 | Generates Duo sets by default |

### Does screenshot text affect ranking?

Disputed. In mid-2025 Appfigures observed that screenshot captions behaved like keywords; other practitioners' tests found weak evidence, and Apple has not officially confirmed it. The skill should write for both possibilities: the captions of the first 3 screenshots should be large, high-contrast phrases that reinforce the primary keyword from the name/subtitle.

Sources: [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store), [Appfigures](https://appfigures.com/resources/guides/app-store-algorithm-update-2025/amp), [AppScreenshotStudio test summary](https://appscreenshotstudio.com/blog/app-store-screenshot-seo-the-2026-keyword-strategy-guide), [Age rating summary](https://trysonar.app/blog/app-store-age-rating), [Asset Library summary](https://adapty.io/blog/app-store-asset-library/)

## fastlane and the ASC API: what can be automated

Text metadata, screenshots and App Preview videos can be uploaded with fastlane `deliver` using an API key. Header/search creatives, CPPs and In-App Events require the ASC API directly; creating the app record with an API key is not possible.

| Task | fastlane | ASC API directly | Note |
| --- | --- | --- | --- |
| Text metadata (name, subtitle, description, keywords, promotional text, What's New, URLs) | `deliver`, `metadata/<locale>/*.txt` | Yes | — |
| Category, copyright, review information | `deliver` | Yes | `review_information/` folder |
| Screenshots | `deliver` (≥ 2.241.1 for Duo) | App Asset Library | Legacy endpoints deprecated in API 4.5.1 |
| App Preview | `deliver`, `app_previews_path` | App Asset Library videos | — |
| Product page header, search creative | No equivalent found | App Asset Library placements | API only |
| Custom Product Pages, PPO | No equivalent found | Yes | API only |
| In-App Events | No equivalent found | Yes | Media now lives in the Asset Library |
| Age rating | `app_rating_config_path` (JSON) | Yes (≈) | fastlane support for the new questions must be verified |
| Creating the app record | `produce`, Apple ID + 2FA only | No (403 with an API key) | The user creates it once in ASC |
| Submitting for review | `submit_for_review` | `reviewSubmissions` | The skill always asks for approval first |

≈ = not verified one-to-one against a source; the skill should check on the first run.

### 5 findings that change the skill's design

1. **fastlane ≥ 2.241.1 is required.** `deliver` infers the screenshot class from the pixel size; versions before 2.241.1 do not recognize the Duo sizes and abort the whole upload. It must be pinned in the Gemfile.
2. **The legacy screenshot APIs are deprecated.** ASC API 4.5.1 deprecated the App Screenshot Sets, Screenshots, Preview Sets and Previews resources; App Asset Library images, videos and placements replace them. I could not find any record of fastlane having migrated. The uploader must therefore be a swappable adapter: `deliver` for now, an Asset Library client when needed.
3. **Do not hard-code sizes.** `GET /v1/appAssetLibraryRefData` returns the supported placements, sizes and limits; the `IPHONE_DUO` class is also there. The skill should read it on every run and compare it with `targets.json`.
4. **The app record cannot be created via the API.** `produce` does not support API keys; on the Apple forums, creating an app with an API key returns 403. If there is no record, the skill stops and asks the user to create it in ASC.
5. **The first App Store version.** It is reported that for an app that is only on TestFlight, the API refuses to create the first App Store version. If the skill cannot find an editable version, it likewise stops and warns.

### Authentication

The `app_store_connect_api_key` action produces a JWT from the Key ID, Issuer ID and `.p8` file (at most 1200 s). Environment variables: `APP_STORE_CONNECT_API_KEY_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_KEY_FILEPATH`. The key is created in ASC → Users and Access → Integrations → App Store Connect API as a "Team Key"; the role must be at least App Manager.

Sources: [ASC API 4.5.1 release notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes.md), [fastlane App Store Connect API](https://docs.fastlane.tools/app-store-connect-api/), [fastlane deliver](https://docs.fastlane.tools/actions/deliver/), [fastlane 2.241.1 Duo support (PR)](https://github.com/sesori-ai/sesori_apps_monorepo/pull/2014), [Apple forum: creating an app via the API](https://origin-devforums.apple.com/forums/profile/davestothers), [First version issue (PR)](https://github.com/RealUnitCH/app/pull/646)

## Master prompt

Paste the text below into Claude Code as-is in an empty repository. The prompt first has it re-read the Apple documentation, then builds the tool in 7 phases and finally packages the `/vitrin` skill.

```markdown
# VITRIN — Master Prompt (Claude Code)

You are a senior iOS release engineer, ASO expert, copywriter and motion/UI designer. In this repository you will build a tool called "Vitrin". Vitrin analyzes any iOS app project, performs competitor analysis, and automatically produces all the ASO-friendly metadata that accurately describes the app, screenshots, creative images and App Preview videos for App Store Connect (ASC), validates them and uploads them with fastlane + the ASC API. In the end, the whole flow runs through a single Claude Code skill (/vitrin).

## 0. Read first, then code
The ASC rules changed in 2026. Before writing any code, read the following pages with WebFetch and write a summary to docs/apple-notes.md:
- Screenshot specifications, App preview specifications, Creative assets specifications
- Platform version information, App information, App Store localizations
- ASC API 4.5.1 release notes, Understanding the App Asset Library, Migrating to the App Asset Library, Uploading assets to App Store Connect
- The fastlane deliver and app_store_connect_api_key documentation
If a value in this prompt conflicts with the current documentation, the documentation wins; note the difference in docs/apple-notes.md.

Known facts (October 2026):
- Name 2–30 characters, subtitle 30, promotional text 170, description 4000 (plain text), What's New 4000, keywords 100 BYTES (UTF-8: ç ş ğ ı ö ü are 2 bytes, CJK 3 bytes), review notes 4000 bytes.
- Required iPhone class: Dynamic Island medium display (1206×2622 or 1179×2556). Also generate 6.9" (1320×2868) and, if iPad is supported, 13" (2064×2752). iPhone Duo: outer 1398×2034, inner 2007×2853; required from April 2027 with the iOS 27.1 SDK. 1–10 screenshots per device/locale; PNG/JPEG; no alpha.
- App Preview: 886×1920 (all modern iPhones, including Duo), iPad 1200×1600; 15–30 s; ≤30 fps; H.264 High 4.0, 10–12 Mbps; stereo AAC 256 kbps 44.1/48 kHz; at most 3 per device/locale; must contain real app footage.
- Creative assets (since October 5, 2026): product page header 3840×1646 (21:9), search result 3:2 (1920×1280–3840×2560); image or 5–30 s video, 30/60 fps; plays muted in search. May be a brand/seasonal visual.
- In-App Event media: card 16:9, detail 9:16; video 15–30 s.
- 50 metadata languages; every storefront has a default + additional languages (keep Apple's table as data/storefront-languages.json).
- ASC API 4.5.1: App Screenshot Sets/Screenshots/Preview Sets/Previews deprecated → App Asset Library (images, videos, placements). Sizes and limits are read from GET /v1/appAssetLibraryRefData; the Duo class is IPHONE_DUO.
- fastlane deliver infers the screenshot class from the pixel size; Duo requires fastlane ≥ 2.241.1 (APP_IPHONE_DUO).
- The app record cannot be created with an API key (fastlane produce requires an Apple ID). For an app that is only on TestFlight, the first App Store version may need to be created once in ASC.

## 1. Architecture principles
- Creative decisions in Claude, deterministic work in the CLI. Copy, art direction, layout choices and competitor interpretation are written by Claude while the skill runs and saved to schema-conforming JSON files. Data collection, rendering, validation and upload are the TypeScript CLI's job. No additional LLM API key is required.
- Every stage is idempotent and resumable: metadata/state.json stores completed stages and input hashes; running again with the same input skips the stage.
- Safe defaults: upload shows a --dry-run plan first; submitting for review is a separate command and requires explicit approval.

## 2. Technology
- Node.js 22+, TypeScript, pnpm workspace; zod schemas for all JSON.
- HTML→PNG: Playwright (Chromium). Templates are designed at logical size and scaled to exact pixels with deviceScaleFactor: 6.9" 440×956 @3x, 6.3" 402×874 @3x, iPad 13" 1032×1376 @2x, Duo outer 699×1017 @2x, Duo inner 669×951 @3x. Flatten the output with sharp + removeAlpha and verify the size with sharp.metadata.
- Video: Remotion 4.x (5.0 is not out yet; free license for individuals and companies with ≤3 employees). fps fixed at 30; render: --codec h264 --video-bitrate 11M --audio-codec aac --audio-bitrate 256k --enforce-audio-track. Check resolution, fps, duration and audio channels with ffprobe; re-encode with ffmpeg -profile:v high -level 4.0 if needed.
- Raw screenshots: xcodebuild + iOS Simulator + XCUITest (or fastlane snapshot). xcrun simctl status_bar override for 9:41 and full battery. -AppleLanguages/-AppleLocale for each locale. Suggest a seed-data mode with a -VitrinDemo launch argument to the app and show the user which file to add it to. App Preview recording: xcrun simctl io <udid> recordVideo.
- Competitor screenshot text: a small Swift script running macOS Vision (VNRecognizeTextRequest); sharp + k-means for color palettes.
- Upload: Ruby + Bundler, fastlane '>= 2.241.1' in the Gemfile. ASC API client in TypeScript, ES256 JWT (jose), token lifetime ≤ 20 min.
- Icons: Lucide or Phosphor (MIT); do not use SF Symbols in marketing images. Fonts OFL-licensed and embedded in the project; Noto fallbacks for CJK, Indic languages, Arabic/Hebrew; dir=rtl for RTL languages.

## 3. Repository layout
vitrin/
  packages/cli        commands, state, masking logger
  packages/schemas    AppProfile, Competitors, KeywordPlan, Metadata, ArtDirection, ShotList, VideoPlan, Report
  packages/analyzer   reading the Xcode project
  packages/research   iTunes Search/Lookup, RSS charts, reviews, optional Apple Ads/AppTweak
  packages/validate   text, image, video and claim-to-evidence checks
  packages/render     HTML template engine; Badge, DeviceFrame, Caption, Background components; Playwright renderer
  packages/video      Remotion project: AppPreview, HeaderLoop, SearchLoop, EventCard
  packages/upload     fastlane bridge + App Asset Library / CPP / In-App Events client
  fastlane/           Fastfile and Gemfile templates
  data/               targets.json, storefront-languages.json, forbidden-terms.json
  skill/              SKILL.md, references/, scripts/
Outputs in the app repository: metadata/ (state, cache, report) and fastlane/{metadata,screenshots,app-previews}/.

## 4. Pipeline (CLI)
vitrin init → creates vitrin.config.yaml and .env.example; adds .env, *.p8, metadata/.cache to .gitignore.
vitrin doctor → environment and key checks (section 5).
vitrin analyze → metadata/app_profile.json
  Read: .pbxproj (bundle id, targets, deployment target, iPad support), Info.plist (display name, permission descriptions), entitlements (HealthKit, iCloud, Push, Sign in with Apple), Localizable.xcstrings and knownRegions, Assets.xcassets (AppIcon, AccentColor, color sets), .storekit (IAP names), App Intents, widget/watch/extension targets, README, CHANGELOG, git log since the last tag.
  Output: feature list with evidence for each (file path), target audience, the user's job-to-be-done, revenue model, tone, brand colors, category suggestion, language → ASC locale mapping (tr, en-US, de-DE, ja, zh-Hans, pt-BR …).
vitrin research → metadata/research/competitors.json, metadata/research/keywords/<locale>.json
  Target storefronts from config (default: the primary language's country + US). For each seed term, the top 50 results via the iTunes Search API; via Lookup: name, description, rating, rating count, release notes, screenshot URLs (Lookup does not return the subtitle); category top charts; recent reviews.
  Analysis: name word frequency matrix, captions on competitors' first 3 screenshots (OCR), color palettes, complaint/praise clusters in reviews, unoccupied positioning space. Competitor copy or images are never copied; they are used only for analysis. Respect rate limits, cache results for 24 hours.
  Keyword score: relevance (Claude), competition (result count + rating counts of the top 10), popularity (from the Apple Ads key if present; otherwise marked as an estimate).
vitrin write → metadata/listing/<locale>.json and cpp-suggestions.json
  Claude writes, the CLI validates. Rules: name = brand + primary keyword; subtitle = benefit + secondary keyword; no repetition across name, subtitle and keyword field; keyword field comma-separated, no spaces, singular, no competitor/brand names or price terms; the first 3 lines of the description are the hook; no keyword stuffing; in every language a local rewrite, not a translation; different keywords for storefront additional languages; What's New from git log in user language; promotional text based on the current campaign. Every claim is tied to evidence in app_profile.
vitrin capture → metadata/raw/<locale>/<device>/NN.png and preview recordings
vitrin design → metadata/art-direction.json, fastlane/screenshots/<locale>/NN_<slug>.png
  No fixed template. From app_profile and the competitor visual analysis, Claude proposes 2–3 art directions (palette, typography, background language, layout archetypes) and picks the one that differs most from competitors. Archetypes: hero, single feature, split screen, collage, before/after, stat, social proof, panoramic (a background that continues across consecutive screenshots). Every screenshot has a caption (at most 6–7 words, reinforcing the primary keyword), a subcaption, a screen and badge(s).
  Badge component kinds: feature (Offline, No ads, iCloud sync, Apple Health), new (New), proof (rating, award), platform (iPad, Apple Watch, iPhone Duo). Proof badges only with verifiable data (real rating from Lookup, documented award); no price badges; Apple marks and award names only if real.
  Quality checks: measure text overflow/clipping with Playwright, caption ≥ 96 px on the 6.9" screenshot, WCAG AA contrast, safe area; the first 3 screenshots are rendered at 25% size and checked for legibility.
  Also the header (3840×1646) and search (3:2) creatives and, if requested, In-App Event media.
vitrin video → fastlane/app-previews/<locale>/NN.mp4 and metadata/creative/*.mp4
  App Preview (886×1920, target 20–25 s): 0–3 s hook, 3–4 feature beats with real screen recordings, closing card; only app footage + a text/motion layer, no footage of hands or people. Header/Search loops: 5–30 s, understandable without sound, seamless loop. All text per locale.
vitrin validate → metadata/validation.json; exit code 1 on errors.
vitrin review → metadata/report.html: search result row and product-page-like preview, contact sheet for all locales, byte/character counters, competitor comparison.
vitrin upload [--dry-run] → fastlane + ASC API; plan first, upload after approval.
vitrin submit → submits for review; requires explicit approval.
vitrin all → runs everything in order, writing state after each stage.

## 5. Keys, .env and doctor
.env.example (with comments):
  ASC_KEY_ID=          # ASC > Users and Access > Integrations > App Store Connect API (Team Key)
  ASC_ISSUER_ID=
  ASC_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8   # or ASC_KEY_CONTENT_BASE64
  APP_BUNDLE_ID=       # read from the Xcode project if empty
  # Optional
  APPLE_ADS_CLIENT_ID= APPLE_ADS_TEAM_ID= APPLE_ADS_KEY_ID= APPLE_ADS_PRIVATE_KEY_PATH= APPLE_ADS_ORG_ID=
  APPTWEAK_API_KEY=
  FASTLANE_USER= FASTLANE_PASSWORD=   # only for creating the app record (produce)
The Fastfile passes the ASC_* values to the app_store_connect_api_key action (key_id, issuer_id, key_filepath, duration 1200).
Non-secret fields (support/marketing/privacy URLs, copyright holder, primary language, target storefronts) live in vitrin.config.yaml.
doctor order:
  1. Tools: Node, pnpm, Ruby/Bundler, fastlane ≥ 2.241.1, Xcode + simctl, ffmpeg/ffprobe, Playwright browser.
  2. Does .env exist, are the required keys filled in, does the .p8 file exist and is it in PEM format.
  3. Live JWT test: GET /v1/apps?filter[bundleId]=… → is the key valid, is the role sufficient, does the app record exist.
  4. Is there an editable App Store version; if not, try to create one with deliver app_version and warn if refused.
  5. Do the URLs in the config return 200, does the support page contain contact information.
  6. Fetch appAssetLibraryRefData, compare it with data/targets.json and warn on differences.
Behavior:
  - Never prints values; masks them in logs.
  - If anything is missing, updates .env.example; lists the missing keys in a single Turkish list, each with where to obtain it; stops with exit code 2 (waiting for user input).
  - Warn early, gate late: if ASC keys are missing, analysis and generation continue (the user can add the keys meanwhile); upload does not start until doctor passes.
  - When the user says "continue" ("devam"), doctor runs again and the remaining stages resume; generated files are not regenerated.

## 6. Validation rules
Text: character limits (grapheme counting with Intl.Segmenter), Buffer.byteLength ≤ 100 for the keyword field, repetition across name/subtitle/keywords, forbidden terms (competitor brands, prices, unsupported "#1"/"best"), no HTML, URL format, required fields filled in every locale.
Images: exact pixel size and class mapping, no alpha, 1–10 items, file order, the same count in every locale, no caption overflow, contrast.
Video: 15–30 s, 30 fps, correct resolution, H.264, stereo AAC, ≤ 500 MB; 5–30 s for creatives.
Claim-to-evidence: every caption and badge claim is tied to a feature in app_profile; a claim that cannot be tied is an error (App Review 2.3).
Compliance: screenshots show the real UI, App Previews show real recordings.

## 7. Upload
fastlane/metadata/<locale>/: name.txt, subtitle.txt, description.txt, keywords.txt, promotional_text.txt, release_notes.txt, support_url.txt, marketing_url.txt, privacy_url.txt. Root: copyright.txt, primary_category.txt, secondary_category.txt; contact and demo account under review_information/.
Lane vitrin_upload: deliver with api_key (skip_binary_upload: true, overwrite_screenshots: true, force: true, submit_for_review: false, app_previews_path: 'fastlane/app-previews').
Asset Library client: header and search creatives, CPPs (screenshots, promotional text, keyword assignment, deep link), PPO variants, In-App Event media. Flow: reservation → PUT the parts → commit with checksum → wait for processing → create placement → ordering request.
If fastlane emits a deprecation warning or an error on the legacy screenshot endpoints, switch to the --uploader=asset-library flag, which uploads screenshots to the Asset Library.
After every upload, read back from ASC and compare with the local files.

## 8. Skill (/vitrin)
skill/SKILL.md: name vitrin; description: produces and uploads ASC metadata, screenshots, creatives and App Previews for an iOS app; triggers: App Store metadata, ASO, screenshots, fastlane deliver, upload to ASC.
Flow: 1) doctor (early warning) 2) analyze 3) research 4) Claude writes metadata and art direction 5) capture 6) design 7) video 8) validate (on errors Claude fixes, at most 3 rounds) 9) shows the review report 10) doctor (gate) 11) upload --dry-run and user approval 12) upload 13) summary.
When keys are missing, Claude writes: which keys are missing, where to obtain each, the path of the .env file, "Add them, then type continue." It never suggests pasting values into the chat; it asks for them to be written to .env.
references/: apple-specs.md, aso-rules.md, copy-guidelines.md, art-direction.md (archetypes, badge rules), troubleshooting.md (Duo class, first version, 403, video stuck processing). SKILL.md must not exceed 500 lines; longer information is read from references when needed.

## 9. Phase order and definition of done
Phase 0: skeleton, schemas, init, doctor (with tests).
Phase 1: analyze + research.
Phase 2: write + validate + fastlane text upload (--dry-run).
Phase 3: capture + design (HTML, badges, 6.3"/6.9"/iPad/Duo).
Phase 4: video (Remotion) + ffprobe verification.
Phase 5: Asset Library, CPP and In-App Events client.
Phase 6: skill packaging and an end-to-end run on the sample app.
At the end of every phase: unit tests (byte counting, limits, size mapping, claim-to-evidence), a working command on the sample app, a CHANGELOG entry.
Done: on a sample SwiftUI app, `vitrin all` produces metadata in at least 2 languages, 6.3"/6.9"/iPad screenshots and 1 App Preview; validate passes cleanly; upload --dry-run shows the correct plan; with keys missing, doctor stops with exit code 2 and the correct Turkish warning.

## 10. Boundaries
- Never show or write a feature the app does not have.
- Never copy competitor copy, images or brand names.
- Never log, commit or write secret values in the chat.
- Never perform hard-to-reverse actions such as submitting for review, changing prices or releasing a version without explicit approval.
- When unsure about an Apple rule, re-read the documentation; if it is still unclear, ask the user.
```

## Skill flow and the .env gate

If keys are missing, the skill warns at the very beginning but does not stop generation; it stops only at the gate before upload and waits until you fill in `.env` and type "continue".

&#91;embedded content: /vitrin flow · 9 steps, 1 key gate\]

When it stops at the gate, the skill lists the missing keys and where to obtain each one, and updates `.env.example`; generated files are not regenerated when it resumes.

### What the skill can do

| Level | Tasks |
| --- | --- |
| Fully automatic | Project analysis, competitor and keyword research, metadata in up to 50 languages, screenshot capture, HTML design and badges, Remotion videos, validation, preview report |
| With your approval | Uploading to ASC, creating CPPs and PPO tests, submitting creative assets, submitting for review |
| Stays manual | Creating the app record in ASC, creating the API key, privacy labels and final approval of the age rating questionnaire, the fold posture in the iPhone Duo simulator (no automation command found) |

The skill is installed as `~/.claude/skills/vitrin/SKILL.md` and invoked with `/vitrin` in the app repository; the globally installed `vitrin` CLI does the actual work.

## Sources

Apple pages that were opened and read:

- [WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store)
- [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [App preview specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications)
- [Creative assets specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications)
- [App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations)
- [Manage app tags](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-tags)
- [Configure multiple product page versions](https://developer.apple.com/help/app-store-connect/create-custom-product-pages/configure-multiple-product-page-versions)
- [App Store Connect API 4.5.1 release notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-4-5-1-release-notes.md)

Sources taken from search summaries whose pages were not opened:

- [App Store Connect release notes](https://developer.apple.com/help/app-store-connect/release-notes)
- [fastlane deliver](https://docs.fastlane.tools/actions/deliver/) and [fastlane App Store Connect API](https://docs.fastlane.tools/app-store-connect-api/)
- [fastlane 2.241.1 iPhone Duo support (GitHub PR)](https://github.com/sesori-ai/sesori_apps_monorepo/pull/2014)
- [First App Store version issue (GitHub PR)](https://github.com/RealUnitCH/app/pull/646)
- [Apple forum: creating an app with an API key](https://origin-devforums.apple.com/forums/profile/davestothers)
- [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)
- [Appfigures algorithm update](https://appfigures.com/resources/guides/app-store-algorithm-update-2025/amp), [AppScreenshotStudio test summary](https://appscreenshotstudio.com/blog/app-store-screenshot-seo-the-2026-keyword-strategy-guide)
- [Age rating summary](https://trysonar.app/blog/app-store-age-rating), [Asset Library summary](https://adapty.io/blog/app-store-asset-library/)
