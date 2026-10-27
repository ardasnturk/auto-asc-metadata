# Ritim

Ritim ("rhythm" in Turkish) is a small SwiftUI habit tracker for iPhone and iPad. It is **Vitrin's
example app**: the repository contains everything a `/vitrin` run produced for it, so you can see the
result without running anything — see [What Vitrin produced](#what-vitrin-produced).

## Features

- **Today**: progress summary for the day, one card per habit with a check-in ring, current
  streak and the last 7 days. Searchable habit list (`.searchable`).
- **Statistics** (Swift Charts): weekly completion bar chart, 30-day trend (7-day rolling
  average) and current streaks per habit. Share a progress summary (`ShareLink`) and export all
  check-ins as CSV (`.fileExporter`).
- **Habit detail**: 12-week calendar heatmap, current/best streak, 30-day success rate and recent
  days.
- **Reminders**: one repeating daily local notification per habit (UserNotifications).
- **New habit** form: name, SF Symbol icon, color, daily goal and optional reminder.
- **Ritim Plus** paywall for a monthly auto-renewable subscription (StoreKit 2, minimal purchase
  code, `Ritim.storekit` configuration attached to the `Ritim` scheme).
- SwiftData storage, light/dark mode, Dynamic Type (`@ScaledMetric`), VoiceOver labels on custom
  controls, iPhone and iPad (`sidebarAdaptable` tab view, adaptive grids).
- Localized in English (development language) and Turkish through `Localizable.xcstrings`;
  the display name is localized through `InfoPlist.xcstrings`.

## Requirements

iOS 18.0+, Swift 6, Xcode 26 or later. The project is generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml`; the generated
`Ritim.xcodeproj` is committed so tools can parse it directly.

```sh
xcodegen generate
xcodebuild -project Ritim.xcodeproj -scheme Ritim -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath build build CODE_SIGNING_ALLOWED=NO
```

## What Vitrin produced

This is a `/vitrin` run as the developer of Ritim would do it: the conversation in English, the App
Store for iPhone and iPad, the store languages en-US and tr, every kind of content, fastlane as the
uploader. It stops where the developer's own part begins — approving the review gallery and adding the
App Store Connect key for the upload. Nothing here was uploaded.

| Step | What to look at |
| --- | --- |
| Analysis | [`metadata/app_profile.json`](metadata/app_profile.json) — platforms, locales, 14 features with the code that proves them |
| Screens, 1:1 from the code (no build) | [`metadata/screens/`](metadata/screens) — the app's views recreated in HTML (`app.css`, `screen.js` for locale-aware dates and the heatmap, `strings/en-US.json`, `strings/tr.json`), rendered per device and language in [`metadata/raw/`](metadata/raw). The `home-7`, `home-done`, `stats-more` and `add` states are what the App Preview changes to after a tap or a scroll. |
| Research | [`metadata/research/keywords/`](metadata/research/keywords) — keyword candidates with popularity, competition, the relevance Claude gave them and the terms selected for name, subtitle and keyword field |
| Store text | [`metadata/listing/`](metadata/listing) (what Claude wrote) and [`metadata/app-store/`](metadata/app-store) (the finished text per locale) |
| Design choice | [`metadata/design-samples/store-preview.html`](metadata/design-samples/store-preview.html) — four designs of the first three screenshots in the App Store search result and product page, with store, design and light/dark menus ([PNG](metadata/design-samples/store-preview.png), [contact sheet](metadata/design-samples/contact-sheet.png)). The developer picked **A · Night rhythm**, the one designed for this app. |
| Screenshots | [`metadata/store/screenshots/`](metadata/store/screenshots) — 8 iPhone 6.3" and 7 iPad 13" screenshots per language ([`shots.json`](metadata/shots.json), [`art-direction.json`](metadata/art-direction.json)) |
| App Preview | [`metadata/store/app-previews/`](metadata/store/app-previews) — 17.5 s per language ([`video-plan.json`](metadata/video-plan.json)): taps that check a habit in, a zoom into the heatmap, the statistics scrolling, the "New Habit" sheet, feature chips and a closing line over the finished day |
| Creatives and event | [`metadata/creative/`](metadata/creative) — product page header and search result images, and the card and detail page of an In-App Event for the 1.2 Statistics update |
| Review | [`metadata/report.html`](metadata/report.html) — the gallery of everything that would be uploaded, with the validation notes; open it locally in a browser |

Validation passes with warnings that describe the example honestly: the support and privacy URLs
are `example.com` placeholders, the In-App Event has no deep link (the app has no URL scheme), and
some creative headlines are below the 4.5:1 contrast Vitrin aims for.

To run it yourself, open Claude Code in this folder and run `/vitrin`. Vitrin skips the stages whose
inputs did not change; `vitrin <stage> --force` re-runs one.

## Vitrin launch arguments

With `capture.mode: launch-args` instead of the HTML screens, Vitrin builds the app and captures it in
the simulator with these arguments:

| Argument | Effect |
| --- | --- |
| `-VitrinDemo` | In-memory SwiftData store seeded with 7 demo habits and 12 weeks of history. Habit names follow the app language. No permission prompts or StoreKit calls. |
| `-VitrinScreen <id>` | Opens a screen at launch: `home`, `stats`, `detail`, `reminders`, `add`, `paywall`. |
| `-AppleLanguages (tr)` `-AppleLocale tr_TR` | Standard language/region override (`en` / `en_US` for English). |

```sh
xcrun simctl launch --terminate-running-process booted com.jastech.ritim \
  -VitrinDemo -VitrinScreen stats -AppleLanguages "(tr)" -AppleLocale tr_TR
```

The demo-mode code lives in `Ritim/Support/VitrinDemo.swift`.

## Project layout

```
project.yml                 XcodeGen spec (bundle id com.jastech.ritim, version 1.2.0 (12))
Ritim.storekit              StoreKit test configuration (Ritim Plus, monthly)
Ritim/App                   App entry point and root tab view
Ritim/Models                SwiftData models and streak/progress logic
Ritim/Views                 Screens and shared components
Ritim/Support               Vitrin demo mode, router, reminders, CSV export, StoreKit
Ritim/Resources             Asset catalog, Localizable.xcstrings, InfoPlist.xcstrings
scripts/generate_assets.py  Regenerates the color sets and the 1024 px app icon (Pillow)
```
