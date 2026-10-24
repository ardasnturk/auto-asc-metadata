# Ritim

Ritim ("rhythm" in Turkish) is a small SwiftUI habit tracker for iPhone and iPad. It is the
end-to-end test fixture for **Vitrin**, which reads this Xcode project, launches the app in the
simulator with demo data and captures App Store screenshots.

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

## Vitrin launch arguments

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
