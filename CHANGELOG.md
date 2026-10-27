# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added — Product Page Optimization tests
- **`metadata/experiments.json`:** an A/B test of the product page — hypothesis, metric, minimum detectable effect, traffic share, and up to three treatments that each change one thing (headline copy per shot and locale, the screenshot order, or an alternate icon from the binary). With the app's daily page views and conversion, validate estimates how many days the test needs and warns past Apple's 90.
- **Treatment sets:** `vitrin design` renders every treatment that changes the screenshots to `metadata/store/experiments/<test>/<treatment>/<locale>/`; the review gallery shows a test card with the hypothesis, the estimate and each treatment's set, and approval hashes them.
- **`vitrin upload --experiment [id]`:** creates the test in App Store Connect as a draft (v2 experiment, treatments, one localization per locale) and places each treatment's set through the App Asset Library. App Review checks it; the user starts it and reads the result in App Store Connect.
- Checks: a written hypothesis, a treatment that changes nothing (error) or more than one thing (warning), icon tests without an alternate icon, unknown shots, one open test at a time, and a recorded `result` whose winner is the original, a treatment or inconclusive. `references/experiments.md` gives the order to test in (first screenshot → icon → order → style) and how a result becomes the next test.

### Added — Google Play images that fit Play, and an icon check
- **Google Play gets Play-safe images:** App Store ratings and Apple platform badges are left off Play images; ranking words (“#1”, “best”) and Apple names on a shot that reaches Play are errors (`shot.play-superlative`, `shot.play-apple-term`), a testimonial (App Store reviews) on Play is a warning, and Play needs at least 2 screenshots (`image.too-few`).
- **Borrowed captures are caught:** the render manifest records which device family and locale each screen came from; iOS UI on a Google Play screenshot (`image.ios-ui-on-play`) and another language's UI in one of the first three shots (`image.language-mismatch`) are errors instead of a log line.
- **Icon audit:** `vitrin research` renders `metadata/research/icons.png`, the app's icon outlined among the strongest competitors' icons at search-result size on light and dark; the skill asks Claude to judge it for the user. A missing app icon is an error when the Google Play icon is a target (before, a letter placeholder was rendered and uploaded).

### Changed
- The design brief asks for 8–10 iPhone shots when the features carry them (at least 5) and localized demo data (names, currency, dates, units) in the strings files, not only translated labels. SKILL.md's “first 3 = hook/proof/trust” now matches the art direction: hero (the only place for proof) → differentiator → core, trust near the end.

### Added — Custom Product Pages and In-App Events that are complete
- **Each Custom Product Page gets its own screenshot set:** `shots` (in the page's order) and per-shot `copy` overrides in `cpp-suggestions.json`; `vitrin design` renders them to `metadata/store/cpp/<page id>/<locale>/`, the review gallery shows them on the page card, approval hashes them, and `vitrin upload --cpp` places them on each page localization through the App Asset Library. Validate warns about pages without their own shots and unknown shot ids.
- **In-App Events are uploaded with their images:** the card and detail images `vitrin design` renders are placed on each event localization (they were rendered but never uploaded). Events take `deepLink`, `purpose`, `purchaseRequirement`, `priority` and a `schedule` (territories, publish start, start, end), sent to App Store Connect when set.
- Event checks: name ≤ 30, short description ≤ 50, long description ≤ 120 characters (errors; before, only counters in the review), a missing deep link, and Apple's schedule rules (15 minutes to 31 days, promoted at most 14 days ahead, publish before start).

### Fixed
- `vitrin upload --cpp` no longer claims that images are placed by the `--creatives` flow; it reports what it placed, or that the page has no screenshots of its own.

### Added — Keyword research that reaches the listing, and a way to measure it
- **The fields are checked against the keyword plan:** `vitrin write` recomputes every candidate's total after Claude set relevance, then warns about unscored candidates, a missing `selected`, selected terms that are not in their field (`keywords.plan-mismatch`), terms the app already ranks top 10 for that the new copy drops (`keywords.drops-ranked-term`) and the best-scored candidates left out.
- **What the store shows today:** `vitrin research` writes `metadata/research/live-listing.json` — name, subtitle, keywords, promotional text and description from App Store Connect when the key is set, otherwise the public lookup. The write brief shows it next to the app's own rank per candidate (`ownRank`), and validate lists what changed against the live keyword field.
- **`vitrin rank`:** the app's own search rank for its selected and best-scored terms, saved to `metadata/rankings/<date>.json` (committed, kept by finalize) and compared with the previous snapshot. Run it before a change and one to two weeks after.
- **Storefront-aware cross-locale checks:** locales indexed in the same storefront (e.g. en-US and es-MX in the US) are compared with each other — every shared keyword and every keyword that repeats the other locale's name/subtitle words is flagged. Before, only locales with the same base language were compared (en-US vs en-GB, which never share a storefront). The write brief lists indexing slots the app does not use yet.
- Warnings for an empty or short subtitle, a brand-only name and a keyword field under 90 bytes.

### Changed
- Keyword competition is now the share of the top 10 that carry the term in their name plus how entrenched they are; the result count (always the full page for real terms) no longer counts. The docs state the formula the CLI actually uses, and the write brief sorts candidates by their total.
- What's New is written in each store locale's own language, not the chat language; the write brief adds the review complaint/praise clusters and asks for a secondary category.

### Added — App Previews that move
- **`flow` scene, the app in use:** 2–5 screens in one device (`beats[].steps`). A touch indicator taps (`tap {x,y}`) and the next screen arrives the way the app shows it: `push` (navigation), `sheet` (modal sheet), `fade` (state change), `scroll` (the same screen further down, the status bar stays put) or `cut` (quick montage). With HTML screens, the state after each tap is its own screen (e.g. `home-done`).
- **The camera keeps moving:** after the device has landed it keeps pushing in and drifting in every style (showcase orbits slightly, energetic sways and bobs, split devices drift apart), and the backdrop shifts on every cut, so a preview reads as one moving shot instead of a slide show.

### Changed
- **Shorter, punchier timing:** hook 2.2 s, closing line 2.4 s, shorter cut transitions; the brief and `references/video.md` ask for 1.5–2.5 s beats in a hook → demo → breadth → proof structure and up to three previews with different hooks. Beats are stretched or shrunk only as far as Apple's 15–30 s needs (to 16 s or 28 s), not to a fixed 24 s.
- **No icon card at the end:** `outro` is optional and its line now runs over the outcome screen (`outro.source`, default the last beat's screen); without `outro` the preview ends on the last beat. App Review wants previews made of app footage.
- **Kinetic style:** typography cards go before at most two beats (the first and the middle one), counted together with the plan's `text` beats; the other captions pop in word by word over the UI. Energetic captions pop in as well.
- Screenshots in previews push in faster (5 % over 3 s instead of 6 % over 6 s).
- **No blank first frame, a settled poster frame:** the hook starts 0.6 s into its own entrance, so frame 0 (where autoplay starts) already shows the device and the hook line; the scene before the 5-second poster frame is held a little longer when that frame would land on a cut, an entrance or a text card.
- **`vitrin video --studio`:** the first preview with the props `vitrin video` would render, in Remotion Studio (development checkouts, where @remotion/cli is installed).

## 0.8.0 — 2026-10-26

### Added — Designed for each app, shown in the store you ship to
- **Bespoke designs:** Claude now designs screenshots for the app instead of only picking presets. Art directions without a preset (own palette, typography, background and device treatment) can be sampled next to presets (`vitrin design --samples --styles <preset>,<option-id>`), up to six options per `art-direction.json`. A shot can have its own HTML layout (`"template": "plan.html"` in `metadata/designs/`, per family `plan.ipad.html` …) with `{{headline}}`/`{{subheadline}}`/`{{badges}}` placeholders and `<vitrin-device screen="…">` mockups; it renders through the same size checks, quality gate and review. Guide: `references/custom-designs.md`.
- **Store preview with menus:** `store-preview.html` now has drop-down menus for the store (App Store iPhone; iPad and Google Play phone when those formats are enabled), the design (A, B, C, D or all side by side) and light/dark appearance. The samples are rendered for every store view; Google Play gets its own listing layout.
- **Ready-made device mockups:** `vitrin mockups` renders transparent templates with their screen rectangles (`mockups.json`) for iPhone, iPad, iPhone Duo closed, open (with its fold crease) and both together, Apple Watch, Mac laptop and window, Apple TV, Vision Pro, Android phone and tablet; `--screens` places the rendered screens into them. Prerendered templates ship with the skill (`assets/mockups/`).
- **1:1 screens from any framework:** a native UI kit (`ios.css`, `material.css`, `watchos.css`, `macos.css`) is copied to `metadata/screens/kit/`, and the screens brief plus `references/screen-recreation.md` map SwiftUI/UIKit, Compose/XML, Flutter and React Native layouts to HTML with measured values.

### Changed
- **Everything lives in `metadata/`:** the workspace moved from `.vitrin/` to the project's `metadata/` folder (`listing/` for the store copy JSON, `research/` for competitors, keywords and downloads, `screens/`, `designs/`, `mockups/`, `design-samples/`, `store/`, …). An existing `.vitrin/` folder is moved automatically on the next command; a `metadata/` folder the user owns is never touched.
- **The upload tool is asked after the design is approved**, not at the start. `vitrin uploader` warns when the chosen tool (asc CLI or fastlane) is missing: it is installed first, and only after the user agrees. `vitrin init` no longer writes fastlane files.
- **finalize asks about the research data:** `vitrin finalize --checked --delete-research | --keep-research`. Generated files stay in `metadata/`; only `metadata/research/` is deleted, and only when the user said so. `--keep`/`--discard` and `retention.keep` are gone.
- The skill does nothing the user has not approved: creating files, installing tools, uploading and deleting all wait for an explicit yes.

### Fixed
- HTML screens are loaded from a file, so the CSS, fonts and images they link render (pages set from a string could not read `file://` resources).

## 0.7.0 — 2026-10-26

### Added — See your choice in the store
- **Store preview of the design samples:** `vitrin design --samples` now also writes `.vitrin/design-samples/store-preview.html` (and a PNG of it). For each option A–D it shows an App Store search result and product page, "if you choose A, your listing looks like this", in the user's language. The samples cover the first three shots, which is what the search result shows.
- **Panoramic pair:** a `panoramic` shot with `bridge: true` now puts a large tilted phone on the right edge, and the next screenshot draws the rest of that phone beside its own device. The two screenshots read as one continuous image in the store. Before, the device was only cropped. This also works in the design samples.
- **Metadata in the project:** after a successful `vitrin write`, the finished store text is also in `metadata/app-store/<platform>/<locale>/*.txt` (and `metadata/google-play/android/<locale>/`), with a `metadata/manifest.json`. A `metadata/` folder Vitrin did not write is never touched.

### Fixed
- Devices no longer look pushed against one edge: in calm presets the `offset` framing keeps the device centred. Only bold presets (swiss, neon, candy, paper) and panoramic shots crop it at the side on purpose.
- The skill reads `ui.language` from the config and asks the language question once per project, never again after a design was chosen or on "continue".

## 0.6.0 — 2026-10-26

### Added — Screens from the code, no build
- **HTML screens (`capture.mode: html`, the new default):** Claude reads the app's views and recreates each screen worth showing in HTML/CSS with realistic demo data, the app's own UI texts as `{{key}}` placeholders (`.vitrin/screens/<id>.html`, optional `<id>.<family>.html` per device family, `.vitrin/screens/strings/<locale>.json`). `vitrin capture` renders them per language and device family at the exact screen size, with a 9:41 status bar and safe areas, into `.vitrin/raw/` — no Xcode build, no simulator, no demo mode. A missing screen exits 2 with `.vitrin/briefs/screens.md`. The store screenshots are then designed around them in HTML as before.
- `vitrin select --capture html|launch-args|manual`; `vitrin platforms --json` reports the mode. Simulator capture stays available as `launch-args`.
- `vitrin doctor --tools`: the early check of local tools only (no keys, no network, writes nothing). Xcode and simulators are not required with HTML screens.

### Changed
- **Nothing is generated outside `.vitrin/` any more:** the exported store set (metadata text, screenshots, App Previews, the Google Play listing) moved from `fastlane/metadata`, `fastlane/screenshots` and `fastlane/app-previews` to `.vitrin/store/` (same layout deliver and supply read). `fastlane/` now only holds the Fastfile, and only when fastlane is the chosen uploader or for Google Play.
- `vitrin init` no longer writes `.env.example`; `vitrin doctor` writes it at the upload gate when keys are missing.
- New configs use `capture.mode: html`; the skill asks once whether to switch a config made by an older Vitrin.

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

