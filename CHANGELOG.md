# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

