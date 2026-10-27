# Vitrin

[![CI](https://github.com/ardasnturk/vitrin/actions/workflows/ci.yml/badge.svg)](https://github.com/ardasnturk/vitrin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-vitrin.ardasnturk.com-7b6cff.svg)](https://vitrin.ardasnturk.com)

Vitrin reads a mobile app project, researches competitors and keywords, and produces everything a store listing needs: ASO-friendly metadata, screenshots, product page and search creatives, and App Preview videos. It covers the App Store (iPhone, iPad, iPhone Duo, Mac, Apple Watch, Apple TV, Vision Pro) and Google Play. Swift/SwiftUI apps are the primary case; Flutter, React Native, Expo and native Android projects are detected and handled too. Every image is rendered from HTML and every video is rendered in code with Remotion. Vitrin validates all of it against the stores' current rules, shows you everything in a review gallery, and uploads only what you approved, with fastlane and the store APIs.

The whole flow runs inside Claude Code through the `/vitrin` skill. Claude makes the creative decisions (copy, keyword selection, art direction, shot list, video plan) and asks you the choices that are yours: the language Vitrin talks to you in, which platforms, which content, which design, then how to upload (asc CLI or fastlane), which store languages and formats, and after the upload whether to delete the research data. It does nothing you did not approve. Everything it generates lives in your project's `metadata/` folder. The TypeScript CLI does the deterministic work (detection, data collection, rendering, validation, upload). No additional LLM API key is required.

> Vitrin is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Apple Inc. App Store, App Store Connect, iPhone, iPad and other Apple marks are trademarks of Apple Inc.

Apple's rules as of October 2026, and the points that could not be verified, are documented in [apple-notes.md](plugins/vitrin/skills/vitrin/references/apple-notes.md).

## Features

- **Project and platform detection** — native Xcode, Flutter, React Native, Expo and native Android projects; every platform the app ships on (iPhone, iPad, iPhone Duo, macOS incl. Mac Catalyst, watchOS, tvOS, visionOS, Android) with evidence. You pick the platforms for each run from that list.
- **Project analysis** — reads `.pbxproj`, `Info.plist`, entitlements, String Catalogs, asset catalogs, StoreKit configuration, App Intents, `pubspec.yaml`, `app.json`, Gradle files, Android resources and code signals to build an app profile with evidence-backed features.
- **Competitor and keyword research** — iTunes Search/Lookup, RSS top charts and reviews (cached, rate-limited), macOS Vision OCR of competitor screenshots, k-means color palettes, and keyword scoring (relevance × popularity × competition), the app's own rank per term and what its live listing says today. `vitrin write` checks the fields against the keyword plan (selected terms present, ranked terms kept, storefront-shared locales not repeating each other) and `vitrin rank` measures the result afterwards. Optional Apple Ads and AppTweak providers.
- **Metadata** — validates Claude-written App Store fields (name, subtitle, keyword field, description, promotional text, release notes: grapheme and UTF-8 byte counts, duplicates, forbidden terms, competitor brands, claim-to-evidence checks) and the Google Play listing (title, short and full description, changelog, Play metadata policy), and exports them to `metadata/store/metadata/` (the layout deliver and supply read).
- **Screens from the code, 1:1, no build** — by default Claude reads the app's views, whatever they are written in (SwiftUI, UIKit, Compose, Android XML, Flutter, React Native), and recreates each screen worth showing in HTML/CSS with measured spacing, the app's colors and fonts, realistic demo data and the app's own UI texts (`metadata/screens/`), starting from a native UI kit (iOS, Material 3, watchOS, macOS). Vitrin renders them per language and device at the exact screen size, with a 9:41 status bar. No Xcode build, no simulator, no demo mode.
- **Ready-made device mockups** — `vitrin mockups` renders transparent templates with their screen rectangles for iPhone, iPad, iPhone Duo (closed, open with its fold, and both together), Apple Watch, Mac (laptop and window), Apple TV, Vision Pro and Android phone and tablet, and places the app's rendered screens into them (`metadata/mockups/`). The screenshots use the same frames.
- **Real capture (optional)** — `capture.mode: launch-args` builds the app per platform (xcodebuild, `flutter build`, CocoaPods + xcodebuild, `expo prebuild`, Gradle) and captures raw screens in dedicated simulators (9:41 status bar, per-locale language), the Mac app window, or an Android emulator in System UI demo mode.
- **Screenshots** — HTML templates rendered with Playwright, following a proven App Store design method: 12 style presets tinted with your brand colors, headline-first layouts with mixed emphasis, varied device framing (bleed, tilted, two devices, no device), realistic CSS device frames for every family (iPhone, iPad, Duo, Mac, Watch, TV, Vision Pro, Android phone and tablet), Google Play feature graphic and icon templates, RTL, exact pixel sizes without alpha. Claude designs for each app instead of only picking presets: bespoke art directions (own palette, type and device treatment) and bespoke HTML layouts per shot with `<vitrin-device>` mockups. `vitrin design --samples` renders four designs side by side, and `store-preview.html` lets you switch the store (App Store iPhone/iPad, Google Play), the design and light/dark with drop-down menus before the full set is made.
- **Quality gate** — every rendered image is measured in the browser: device height ratio, largest empty band, widest headline word, worst-pixel headline contrast, visual layer count and a thumbnail legibility test.
- **App Previews and creatives** — Remotion compositions in four styles (`classic`, `showcase`, `kinetic`, `energetic`) with seven scene types — including `flow`, the app in use with taps and screen changes — a camera that keeps moving, the same device frames as the screenshots, portrait iPhone/iPad and landscape Mac/Apple TV previews, normalized with ffmpeg to H.264 High@4.0, 30 fps CFR, stereo AAC; header and search loops; In-App Event cards.
- **Review and approval** — `vitrin review --serve` opens a local gallery of everything that would be uploaded (every image, video and text, per store, platform, locale and target, with validation issues inline). You approve everything or reject single items with a comment; the approval records a hash of every file, and any later change requires approving again.
- **Upload** — one fastlane `deliver` run per Apple platform for complete sets, `supply` for Google Play; single display types are replaced through the App Store Connect API (one screenshot or preview set per locale, the App Asset Library for iPhone Duo and creatives), plus Custom Product Pages and In-App Events. You choose the App Store uploader: fastlane `deliver` or the [asc CLI](https://github.com/rorkai/App-Store-Connect-CLI) (`brew install asc`, no Ruby needed); `vitrin uploader` shows which is installed. Partial runs ("only watchOS screenshots", "only the App Preview") never delete or overwrite anything you did not select. Always a dry-run plan first, explicit approval, and a read-back after upload. Display types and Asset Library names follow Apple's App Store Connect API 4.5.1 OpenAPI spec.
- **One folder, tidy repository** — everything Vitrin generates lives in `metadata/` (an older `.vitrin/` folder is moved there automatically); a managed `.gitignore` block keeps generated files out of git while the sources Claude writes stay committable. After a checked upload, `vitrin finalize` asks whether to delete the research data (`metadata/research/`) and deletes nothing else.
- **Your language** — Vitrin talks English by default; the skill asks first and then writes every question, summary and the review gallery in the language you pick (English and Turkish built in, any other language translated by Claude).
- **Fast first run** — four design samples in one language and one format come first; only after you pick a design and the store languages and formats is the rest captured and rendered.
- **Idempotent, resumable stages** — `metadata/state.json` tracks input hashes so unchanged stages are skipped.

## Requirements

- macOS (Vision OCR; simulators and Mac window capture only for `capture.mode: launch-args`)
- Node.js ≥ 22 (pnpm only for development)
- Xcode (with `simctl`) only for real captures (`capture.mode: launch-args`); HTML screens need no Xcode
- For App Store uploads, one of: the asc CLI (`brew install asc`, no Ruby) or Ruby + Bundler with fastlane ≥ 2.241.1 (pinned in the generated `Gemfile`); the skill asks which. Google Play always uses fastlane
- ffmpeg / ffprobe
- For cross-platform or Android apps: the Flutter SDK, Node/CocoaPods for React Native and Expo, or the Android SDK (`adb`, `emulator`, an AVD) as needed
- [Claude Code](https://claude.com/claude-code) for the `/vitrin` skill

## Installation

Vitrin is a Claude Code plugin. Install it once, in Claude Code:

```text
/plugin marketplace add ardasnturk/vitrin
/plugin install vitrin@vitrin
```

or from a terminal: `claude plugin install vitrin --marketplace ardasnturk/vitrin` (Claude Code 2.1.292 or newer; older versions: `claude plugin marketplace add ardasnturk/vitrin && claude plugin install vitrin@vitrin`).

The plugin adds the `/vitrin` skill and a `vitrin` command for Claude. Nothing else is needed up front besides Node.js 22+: the first time the skill runs `vitrin`, it installs the CLI for the plugin's version into `~/.local/share/vitrin/<version>/` (override with `VITRIN_HOME`), including Playwright Chromium. That one-time step downloads roughly 450 MB and takes a few minutes; it needs no sudo and no global npm packages. Update with `claude plugin update vitrin@vitrin` (or `/plugin` → Marketplaces → Update); the new version installs its CLI on its next run.

To use the CLI in your own terminal as well: `npm install -g @ardasnturk/vitrin`.

The skill alone can also be added with the [skills CLI](https://github.com/vercel-labs/skills) (`npx skills add ardasnturk/vitrin`), but then the `vitrin` command is missing; prefer the plugin.

**Contributors** working from a clone can still run `plugins/vitrin/skills/vitrin/scripts/install.sh`: it builds this checkout, writes a `vitrin` launcher into npm's global bin directory (override with `VITRIN_BIN_DIR`) and copies the skill to `~/.claude/skills/vitrin` (override with `CLAUDE_SKILLS_DIR`). With the plugin installed, `VITRIN_DEV=/path/to/vitrin` makes the plugin's `vitrin` run your local build instead.

## Quick start

Open Claude Code in your app's repository and run:

```
/vitrin
```

The skill first asks which language to talk in (English by default). On a new repository it runs `vitrin init` (config and `.gitignore` block only; everything Vitrin generates stays in `metadata/`). It asks which platforms and which content to produce. It recreates the app's screens in HTML from the code (no build), places them in device mockups, then renders four sample designs — at least one designed for your app — in one language (English when the app has it), with a store preview you can switch between stores and designs. Only after you approved a design does it ask how to upload (asc CLI or fastlane; a missing tool is installed first, after you agree) and which store languages and formats to produce. It walks through every stage, writes the creative inputs itself, shows you everything in the review gallery, asks for your keys only at the upload, and never uploads or submits without an explicit "yes". If `/vitrin` is taken by another command, use `/vitrin:vitrin`.

## Commands

| Command | Output |
| --- | --- |
| `vitrin init [--language tr] [--uploader asc\|deliver]` | `vitrin.config.yaml` and the managed `.gitignore` block; `Gemfile` (fastlane ≥ 2.241.1) and `fastlane/Fastfile` only once fastlane is chosen or for Google Play; `.env.example` only at the upload gate |
| `vitrin doctor [--tools] [--play-live]` | Tools, `.env`, `.p8`, live JWT test, app record, editable version, URLs, Asset Library refData; the Google Play key for Android apps |
| `vitrin analyze` | `metadata/app_profile.json` — project kind, platforms, targets, locales, entitlements, permissions, IAP, App Intents, colors, evidence-backed features |
| `vitrin platforms [--json]` | Detected platforms with evidence and the targets each would produce |
| `vitrin select --platforms … --assets … --targets … --locales … --language … --uploader … --capture …` | Stores the user's choices in `vitrin.config.yaml`: platforms, content kinds (`metadata`, `screenshots`, `previews`, `creatives`, `events`), formats (target ids), store locales, the conversation language and the App Store uploader |
| `vitrin uploader [--json]` | Whether the asc CLI and fastlane are installed, for the uploader question |
| `vitrin research` | `metadata/research/competitors.json`, `metadata/research/keywords/<locale>.json` (with the app's own rank per term), `live-listing.json` (what the store shows today) — iTunes Search/Lookup, RSS, reviews, OCR, palettes, competition/popularity, App Store Connect when the key is set |
| `vitrin write` | Validates Claude's metadata (App Store and Google Play) against the rules and the keyword plan → `metadata/store/metadata/`, and the finished text, readable, in `metadata/<store>/<platform>/<locale>/*.txt` |
| `vitrin rank` | The app's own search rank for its selected and best-scored terms → `metadata/rankings/<date>.json`, compared with the previous snapshot (run before a change and 1–2 weeks after) |
| `vitrin capture` | Raw screens → `metadata/raw/<locale>/<family>/`: Claude's HTML screens from `metadata/screens/` (default, no build) or simulators, Mac window, Android emulator (`capture.mode: launch-args`) |
| `vitrin mockups [--screens] [--only …] [--list]` | Device mockup templates (transparent PNG + `mockups.json` screen rectangles) → `metadata/mockups/templates/`; `--screens` places the rendered screens into them → `metadata/mockups/screens/` |
| `vitrin design --samples [--styles …] [--locale …]` | The first three shots in four designs (presets and/or bespoke options from `art-direction.json`), in one language, a labelled contact sheet and `store-preview.html` with store, design and appearance menus (App Store iPhone, iPad and Google Play when enabled) → `metadata/design-samples/` (comparison only) |
| `vitrin design` | HTML → Playwright → `metadata/store/screenshots/<locale>/NN_<slug>_<target>.png`, `metadata/creative/`, quality gate |
| `vitrin video [--styles all] [--studio]` | Remotion → `metadata/store/app-previews/<locale>/…mp4`, header/search loops; `--studio` opens the first preview in Remotion Studio (development checkout) |
| `vitrin validate` | `metadata/validation.json` (exit code 1 on errors) |
| `vitrin review [--serve] [--print-labels]` | `metadata/report.html`, the gallery of everything that would be uploaded, in `ui.language`; `--serve` adds approve and reject buttons on `127.0.0.1`; `--print-labels` prints the words to translate into `metadata/i18n/<language>.json` |
| `vitrin approve [--expect-hash …] [--reject … --comment …]` | Records the user's approval (or rejections) in `metadata/approval.json` |
| `vitrin upload [--dry-run]` | Plan with replaced and untouched sets; after approval: deliver per Apple platform / single display types (ASC API, Asset Library) / asc / supply / CPP / In-App Events, then read-back |
| `vitrin finalize --checked --delete-research \| --keep-research` | After a checked upload: records what was uploaded (`metadata/uploaded.json`) and deletes the research data only when the user said so |
| `vitrin submit --confirm <bundleId>` | Submits for review (only with explicit confirmation) |
| `vitrin all` | Runs every stage in order; stops at the stage that needs input or approval |

Global options: `-C, --cwd <dir>`, `-f, --force`, `--json`, `-q, --quiet`. Run `vitrin <command> --help` for command-specific flags.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Done |
| `1` | Error or validation failure |
| `2` | Waiting for input — a brief for Claude in `metadata/briefs/<stage>.md`, or missing keys for the user |

Stages are idempotent through `metadata/state.json`; `--force` re-runs a stage.

## Keys and `.env`

`.env` (never committed):

```
ASC_KEY_ID=          # ASC > Users and Access > Integrations > App Store Connect API (Team Key, ≥ App Manager)
ASC_ISSUER_ID=
ASC_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8   # or ASC_KEY_CONTENT_BASE64
```

For Google Play (Android apps only):

```
GOOGLE_PLAY_JSON_KEY_PATH=./secrets/play-service-account.json   # or GOOGLE_PLAY_JSON_KEY_BASE64
GOOGLE_PLAY_PACKAGE_NAME=      # optional; defaults to the detected applicationId
```

The service account must be invited in Play Console with permission to edit the store listing. Vitrin uploads listing text and images only; it never touches binaries, tracks or rollouts.

Optional: Apple Ads, AppTweak, `FASTLANE_USER/PASSWORD` (only for `produce`), `REVIEW_DEMO_USER/PASSWORD`, `VITRIN_CHROMIUM` (a Chromium path when the pinned Playwright browser is missing). While keys are missing, analysis and generation continue; upload does not start until `doctor` passes ("warn early, gate late"). Secret values are masked in all logs.

## Render matrix

| Asset | Size (px) |
| --- | --- |
| iPhone 6.3" (required) / 6.9" | 1206×2622 / 1320×2868 |
| iPad 13" (if the app supports iPad) | 2064×2752 |
| iPhone Duo outer / inner | 1398×2034 / 2007×2853 |
| Mac (16:10) | 2880×1800 |
| Apple Watch Ultra / Series | 422×514 / 416×496 |
| Apple TV 4K · Apple Vision Pro | 3840×2160 |
| App Preview iPhone (30 fps, H.264 High@4.0, stereo AAC) · Mac / Apple TV · Vision Pro | 886×1920 · 1920×1080 · 3840×2160 |
| Product page header (21:9) · Search result (3:2) | 3840×1646 · 1920×1280 – 3840×2560 |
| Google Play phone · 7" tablet · 10" tablet | 1080×1920 · 1200×1920 · 1600×2560 |
| Google Play feature graphic · icon | 1024×500 · 512×512 |

Only the targets of the platforms you select are produced. Full list, sources and what is still unverified: [data/targets.json](data/targets.json) and [apple-notes.md](plugins/vitrin/skills/vitrin/references/apple-notes.md).

## Repository layout

```
packages/cli        commands, state, briefs, HTML screens, build + capture (simulators, Mac, Android), review gallery, approval, finalize
packages/schemas    zod schemas (AppProfile, Competitors, KeywordPlan, Metadata, PlayListing, ArtDirection, ShotList, VideoPlan, Approval, Config)
packages/core       masking logger, exec, state, config/.env, data files, cached HTTP, enabled targets, .gitignore block
packages/analyzer   project kind and platform detection; pbxproj / plists / entitlements / catalogs / StoreKit / Flutter / React Native / Gradle / code signals
packages/research   iTunes Search/Lookup, RSS, reviews, Vision OCR (Swift), k-means palette, keyword scoring
packages/validate   text (App Store and Google Play), image quality, video and claim-to-evidence checks
packages/render     HTML templates, style presets, device frames, quality measurement, design samples; Playwright + sharp
packages/video      Remotion: AppPreview (portrait and landscape), HeaderLoop, SearchLoop, EventCard; ffmpeg normalization
packages/upload     fastlane deliver / supply, ASC API (JWT), App Asset Library, Google Play API, CPP, In-App Events, partial-upload plan and read-back
fastlane/           Gemfile and Fastfile templates
data/               targets.json, asc-display-types.json, asc-locales.json, play-locales.json, storefront-languages.json, forbidden-terms.json
plugins/vitrin/     Claude Code plugin: .claude-plugin/plugin.json, bin/vitrin (self-installing launcher),
                    skills/vitrin/ (SKILL.md, references/ incl. apple-notes.md and styles/, scripts/install.sh)
.claude-plugin/     marketplace.json (this repository is the `vitrin` plugin marketplace)
scripts/            pack.mjs (`pnpm pack:release` → @ardasnturk/vitrin tarball), release-notes.mjs, site-assets.mjs
docs/               design/master-prompt.md (original design spec)
examples/Ritim      SwiftUI sample app for end-to-end testing (tr + en)
```

## Development

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/bin.js --cwd examples/Ritim validate
```

Releases: bump `version` in `package.json` (the single source), `plugins/vitrin/.claude-plugin/plugin.json`, the `vitrin` entry of `.claude-plugin/marketplace.json` and every `packages/*/package.json` to the same value (a test checks this), add the CHANGELOG section, then push a tag `v<version>`. The release workflow tests, runs `pnpm pack:release` and creates the GitHub Release with `ardasnturk-vitrin-<version>.tgz`, which the plugin's launcher installs; it also publishes to npm when the `NPM_TOKEN` secret is set.

## Example app

[`examples/Ritim`](examples/Ritim) is a small SwiftUI habit tracker (Turkish and English) used for end-to-end runs. It includes a `-VitrinDemo` launch-argument demo mode (`examples/Ritim/Ritim/Support/VitrinDemo.swift`) that you can copy into your own app so screenshots show stable, non-personal data.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE)

### Licenses of dependencies

- Fonts are licensed under the SIL Open Font License (OFL), bundled via [@fontsource](https://fontsource.org).
- Icons are from [Lucide](https://lucide.dev) (ISC).
- The screenshot design method and style presets in `plugins/vitrin/skills/vitrin/references/styles/` are adapted from [ParthJadhav/app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) (MIT, © 2026 Parth Jadhav).
- [Remotion](https://www.remotion.dev) is free for individuals and for companies with up to 3 employees; larger teams need a [Remotion company license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
