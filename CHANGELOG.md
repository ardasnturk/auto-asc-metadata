# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.5.0 — 2026-10-26

### Added — Your language, your uploader, a faster first run
- **Conversation language:** the `/vitrin` skill first asks which language to talk in (English by default). Questions, progress notes, summaries and the missing-keys message follow it, and so does the review gallery: English and Turkish are built in, any other language is translated by Claude into `.vitrin/i18n/<language>.json` (`vitrin review --print-labels` prints the template). Stored as `ui.language` (`vitrin init --language`, `vitrin select --language`). The store copy stays a separate choice.
- **Uploader choice:** `vitrin uploader [--json]` shows whether the asc CLI and fastlane (≥ 2.241.1) are installed, and the skill asks which one uploads the App Store metadata and media instead of assuming fastlane. Stored with `vitrin select --uploader asc|deliver`. A real upload without a choice stops and asks (exit 2).
- **Design samples first, in one language:** four designs (A–D) of the first two shots are rendered in one language (English when the app has it, else the primary locale) and one format (the main iPhone size), captured on their own (`vitrin capture --locale … --family …`, `vitrin design --samples [--locale …]`). Only after the user picks a design does the skill ask which store languages and which formats to produce.
- **Languages and formats:** `vitrin select --locales en-US,tr` sets the store languages of the run and `vitrin select --targets iphone-6.9,ipad-13` limits the formats. `vitrin platforms --json` now lists `formats` (with sizes and the required ones), `locales`, the sample locale/format, the language and the uploader. Unselected formats are neither rendered nor reviewed, and their sets in App Store Connect stay untouched (a format-limited run never uses deliver's overwrite).

### Changed
- `vitrin init` no longer writes a Gemfile and Fastfile up front; they are written once fastlane is chosen (or for Google Play supply). It no longer pushes `.env` keys at the start: keys are asked for at the upload gate. `doctor` reports a missing uploader choice as a warning and treats Ruby/fastlane as required only when fastlane will be used.
- `upload.uploader` has no default any more (unset behaves like `deliver` for dry runs).
- The skill flow is reordered: language → platforms → content → uploader → design samples → languages and formats → research, write, capture and render for the chosen set only.

### Fixed
- `vitrin select` with `all` for a selection key that was never set no longer fails.

## 0.4.0 — 2026-10-26

### Added — Every platform, your choices, approval before upload
- **Project kinds:** Flutter, React Native, Expo and native Android projects next to native Xcode (Swift stays the primary case). Names, ids, versions and locales are read from `pubspec.yaml`, `app.json`/`app.config.*`, Gradle files and Android resources.
- **Platforms:** iPhone, iPad, iPhone Duo (Xcode 27.1+ heuristic), macOS incl. Mac Catalyst, watchOS, tvOS, visionOS and Android are detected with evidence. New targets: `mac-16x10`, `watch-ultra`, `watch-series`, `appletv-4k`, `vision-pro`, `preview-mac`, `preview-tv`, `play-phone`, `play-tablet-7`, `play-tablet-10`, `play-feature-graphic`, `play-icon`.
- **Choices:** `vitrin platforms --json` and `vitrin select --platforms … --assets …`; the skill asks which platforms and which content (metadata, screenshots, previews, creatives, events) to produce, and every stage, the review and the upload follow that selection.
- **Build and capture per platform:** xcodebuild, `flutter build`, CocoaPods + xcodebuild, `expo prebuild`, Gradle; watchOS/tvOS/visionOS simulators, Mac window capture, Android emulator with System UI demo mode. Demo mode docs for Swift, Flutter, React Native/Expo and Kotlin.
- **Screenshot design:** 12 style presets (adapted from ParthJadhav/app-store-screenshots, MIT) tinted with the brand colors, headline-first layouts, varied framing, realistic HTML/CSS device frames for every family, Google Play feature graphic and icon templates, `feature-wall` and `mosaic` closing shots, and a measured quality gate (device ratio, empty bands, word width, worst-pixel contrast, layers, thumbnail test).
- **Design samples:** `vitrin design --samples` renders the first shots in several styles plus a labelled contact sheet; the skill asks which design to use before the full set.
- **Remotion:** the same frames in App Previews, landscape Mac and Apple TV previews (1920×1080).
- **Review gallery and approval:** `vitrin review --serve` (approve or reject items with comments on `127.0.0.1`), `vitrin approve`, `.vitrin/approval.json` with a hash of every uploaded file; a real upload refuses unapproved or changed content, `--yes` included.
- **Google Play:** listing schema, Play locale mapping, Play text and image rules, export to the `supply` layout, `vitrin_play_upload` lane (listing and images only), Play key checks in doctor.
- **Multi-platform App Store upload:** one deliver run per Apple platform; partial selections are replaced per display type and never delete unselected sets; the dry-run plan lists what is replaced and what stays untouched.
- **Tidy repository:** a managed `.gitignore` block kept up to date by every command; `vitrin finalize` keeps the uploaded set in `metadata/` or deletes it, as the user chooses, and always removes research downloads.
- **Install without cloning:** the repository is a Claude Code plugin marketplace. `/plugin marketplace add ardasnturk/vitrin` and `/plugin install vitrin@vitrin` add the `/vitrin` skill and a `vitrin` launcher that installs the CLI for the plugin's version into `~/.local/share/vitrin/<version>/` on first use (no sudo, Playwright Chromium included).
- **npm package `@ardasnturk/vitrin`:** one bundled CLI with its data, fastlane templates and Remotion sources; `pnpm pack:release` builds the tarball and the release workflow attaches it to the GitHub Release (and publishes to npm when `NPM_TOKEN` is set). `vitrin --version` reports the release version.

- **App Store Connect API 4.5.1 alignment:** display types and App Asset Library placement types, display classes, categories and placement groups follow Apple's OpenAPI spec (`data/asc-display-types.json`); partial runs replace exactly one screenshot or preview set per locale through the classic set API, and the Asset Library is used for iPhone Duo and creatives.
- **asc CLI uploader:** `upload.uploader: asc` uploads App Store text, screenshots and previews with [asc](https://github.com/rorkai/App-Store-Connect-CLI) (`brew install asc`), no Ruby needed; `upload.ascValidate` adds `asc validate` to doctor.
- **App Review checks:** placeholder text, Apple-designated recognitions and Kids Category wording in metadata; generic What's New when the release adds features; short review notes; prices, URLs, © and Apple recognitions in screenshot copy (from Apple's App Review Guidelines and asset best practices).
- **Vision Pro App Previews** (3840×2160, `preview-vision`). The Apple notes moved into the skill's references so the installed plugin carries them.

### Changed
- The skill moved to `plugins/vitrin/skills/vitrin/` inside the Claude Code plugin (`npx skills add ardasnturk/vitrin` still finds it) and the repository links use the Vitrin name (`ardasnturk/vitrin`). `skills/…/scripts/install.sh` remains for contributors working from a clone.
- The `/vitrin` flow asks for platforms, content, design and retention, and shows everything for approval before upload.

## 0.3.0 — 2026-10-24

### Added — Animated App Previews
- Four styles: `classic`, `showcase` (3D device entrance, camera push, light leaks), `kinetic` (word-by-word full-screen text cards, punch-in), `energetic` (tilted/shaking device, highlight band, striped background).
- Six scene types: `device`, `zoom` (the camera flies to a region of the UI), `split`, `stat` (counter), `badges` (feature chips), `text`; `*emphasis*` markup and an animated underline in captions.
- `vitrin video --styles all`: renders the first preview in all four styles for comparison (not uploaded).
- `skill/references/video.md`.

### Changed
- App Preview rendering rewritten following the Remotion skill guide: scene transitions with `TransitionSeries` (fade, slide, wipe, flip, push-cut, iris), `@remotion/effects` light-leak layers, trimmed real recordings via `@remotion/media` `<Video>`; all animation is frame-based with `interpolate` + `Easing`.
- Duration automatically fits 15–30 s (transition overlaps are accounted for); `hookFrom` skips the opening part of a recording.
- Validation: required fields per scene type, text card count/duration, and counter and badge claims tied to an evidence-backed feature.
- The video brief was updated for the new schema.

## 0.2.0 — 2026-10-24

### Added — Screenshot types and best-practice rules
- New archetypes: `callout` (a magnified excerpt of the real UI; separate rectangle per device family), `fullbleed` (frameless full-screen UI), `tilted` (large tilted device), `statement` (icon + large statement + badges), `testimonial` (only the app's own real App Store reviews, verbatim).
- Two-tier headlines (`kicker`), `*emphasis*` markup, bottom caption position (`captionPosition: bottom`).
- Badge styles: `sticker` and `laurel` (verifiable proof only).
- Validation: ≤ 5-word headline recommendation and ≤ 2-line measurement, 60% real-UI ratio, real UI within the first 3 screenshots, ban on calls to action and other platform names, repeated headlines, archetype requirements, detection of invented or translated reviews.
- `skill/references/art-direction.md`: set strategy (hook → proof → trust), headline rules, archetype selection; sources: the AppScreenshotStudio and MobileAction 2026 guides, Apple's Screenshot specifications and examples from screensdesign.com.

### Changed
- `research` now also fetches the published app's own reviews (source for testimonials).

## 0.1.0 — 2026-10-24

### Added

#### Phase 0 — skeleton, schemas, init, doctor
- pnpm workspace (Node ≥ 22, TypeScript 6, ESM) and zod schemas: AppProfile, Competitors, KeywordPlan, LocaleMetadata/AppMetadata, CppSuggestions, ArtDirection, ShotList, VideoPlan, ValidationReport, RenderManifest, VitrinConfig, State.
- `data/targets.json` (October 2026 sizes, including iPhone Duo), `asc-locales.json` (50 locales), `storefront-languages.json` (175 storefronts), `forbidden-terms.json`.
- Logger that masks secret values, idempotent `.vitrin/state.json`, `vitrin init`, `vitrin doctor` (6 steps; missing keys produce a list and exit code 2).
- `docs/apple-notes.md`: values verified against Apple's pages, plus open questions.

#### Phase 1 — analyze + research
- `pbxproj` (OpenStep plist) parser, Info.plist/`INFOPLIST_KEY_*`, entitlements, String Catalog, asset catalog colors and icon, StoreKit products, App Intents, target types, code signals (for draft accessibility and age-rating answers), git log.
- iTunes Search/Lookup, RSS top charts and reviews (24-hour cache, rate limiting), macOS Vision OCR, k-means palette, name term frequency, competition and estimated popularity; AppTweak provider.

#### Phase 2 — write + validate + fastlane
- Grapheme/byte counting, limits, duplicates across name/subtitle/keyword field, singular/plural, forbidden terms, competitor brand detection that separates generic terms, HTML, URL, copyright, claim-to-evidence checks.
- fastlane metadata export (the demo account is never written to disk), Fastfile lanes, `upload --dry-run` plan (field-by-field comparison with ASC).

#### Phase 3 — capture + design
- Dedicated "Vitrin · <device>" simulators, 9:41 status bar, per-locale system language and relaunch, opening screens via launch arguments, blank/black capture detection, screen recording.
- HTML template engine: 8 archetypes, 7 background styles, CSS device frame, Lucide badges, OFL fonts with script fallbacks, RTL; automatic text fitting, overflow/contrast/safe-area/small-size legibility measurement; flatten + alpha removal with sharp and exact size verification.

#### Phase 4 — video
- Remotion 4 compositions (AppPreview, HeaderLoop, SearchLoop, EventCard), 15–30 s duration fitting, ffmpeg normalization to H.264 High@4.0 / 30 fps CFR / stereo AAC 48 kHz, ffprobe verification.

#### Phase 5 — Asset Library, CPP, In-App Events
- App Asset Library client (reservation → chunked upload → MD5 commit → wait for processing → placement → ordering), refData comparison, Custom Product Page and In-App Event creation, post-upload read-back.

#### Phase 6 — skill and end-to-end run
- `/vitrin` SKILL.md and references/, `skill/scripts/install.sh`, `vitrin review` HTML report, `vitrin all`.
- End-to-end run on the `examples/Ritim` SwiftUI sample app.

