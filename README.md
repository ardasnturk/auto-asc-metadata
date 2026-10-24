# Vitrin

[![CI](https://github.com/ardasnturk/auto-asc-metadata/actions/workflows/ci.yml/badge.svg)](https://github.com/ardasnturk/auto-asc-metadata/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Vitrin reads an iOS project, researches competitors and keywords, and produces everything an App Store Connect listing needs: ASO-friendly metadata, badged screenshots, product page and search creatives, and App Preview videos. It validates all of it against Apple's current rules and uploads it with fastlane and the App Store Connect API. The whole flow runs inside Claude Code through the `/vitrin` skill: Claude makes the creative decisions (copy, keyword selection, art direction, shot list, video plan), while this TypeScript CLI does the deterministic work (data collection, rendering, validation, upload). No additional LLM API key is required.

> Vitrin is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Apple Inc. App Store, App Store Connect, iPhone, iPad and other Apple marks are trademarks of Apple Inc.

Apple's rules as of October 2026, and the points that could not be verified, are documented in [docs/apple-notes.md](docs/apple-notes.md).

## Features

- **Project analysis** — reads `.pbxproj`, `Info.plist`, entitlements, String Catalogs, asset catalogs, StoreKit configuration, App Intents and code signals to build an app profile with evidence-backed features.
- **Competitor and keyword research** — iTunes Search/Lookup, RSS top charts and reviews (cached, rate-limited), macOS Vision OCR of competitor screenshots, k-means color palettes, and keyword scoring (relevance × popularity × competition). Optional Apple Ads and AppTweak providers.
- **Metadata** — validates Claude-written name, subtitle, keyword field, description, promotional text and release notes (grapheme and UTF-8 byte counts, duplicates across fields, forbidden terms, competitor brands, claim-to-evidence checks) and exports them to `fastlane/metadata/`.
- **Screenshots** — captures raw screens in dedicated simulators (9:41 status bar, per-locale system language), then renders HTML templates with Playwright: 13 layout archetypes, CSS device frames, Lucide badges, embedded OFL fonts, RTL support, automatic text fitting and legibility checks, exact pixel sizes without alpha.
- **App Previews and creatives** — Remotion compositions in four styles (`classic`, `showcase`, `kinetic`, `energetic`) with six scene types, normalized with ffmpeg to H.264 High@4.0, 30 fps CFR, stereo AAC; header and search loops; In-App Event cards.
- **Validation** — text, image, video and claim-to-evidence checks in one report (`.vitrin/validation.json`).
- **Review report** — an HTML preview of the search result row, product page, contact sheets, counters and competitor comparison.
- **Upload** — fastlane `deliver` or the App Asset Library API, Custom Product Pages and In-App Events; always a dry-run plan first, explicit approval, and a read-back after upload.
- **Idempotent, resumable stages** — `.vitrin/state.json` tracks input hashes so unchanged stages are skipped.

## Requirements

- macOS (simulators, Vision OCR)
- Node.js ≥ 22 and pnpm
- Xcode (with `simctl`)
- Ruby + Bundler (fastlane ≥ 2.241.1 is pinned in the generated `Gemfile`)
- ffmpeg / ffprobe
- [Claude Code](https://claude.com/claude-code) for the `/vitrin` skill

## Installation

```bash
skill/scripts/install.sh
```

The script installs dependencies, builds the CLI, downloads Playwright Chromium, writes a `vitrin` launcher into npm's global bin directory (`npm prefix -g`/bin; override with `VITRIN_BIN_DIR`), and copies the skill to `~/.claude/skills/vitrin` (override with `CLAUDE_SKILLS_DIR`). The launcher runs the build inside this repository, so if you move the repository, run the script again.

## Quick start

In your app's repository:

```bash
vitrin init
```

Then open Claude Code in that repository and run:

```
/vitrin
```

The skill walks through every stage, writes the creative inputs itself, stops when it needs your keys or your approval, and never uploads or submits without an explicit "yes".

## Commands

| Command | Output |
| --- | --- |
| `vitrin init` | `vitrin.config.yaml`, `.env.example`, `.gitignore` entries, `Gemfile` (fastlane ≥ 2.241.1), `fastlane/Fastfile` |
| `vitrin doctor` | Tools, `.env`, `.p8`, live JWT test, app record, editable version, URLs, Asset Library refData |
| `vitrin analyze` | `.vitrin/app_profile.json` — targets, iPad, locales, entitlements, permissions, IAP, App Intents, colors, evidence-backed features |
| `vitrin research` | `.vitrin/competitors.json`, `.vitrin/keywords/<locale>.json` — iTunes Search/Lookup, RSS, reviews, OCR, palettes, competition/popularity |
| `vitrin write` | Validates Claude's metadata → `fastlane/metadata/` |
| `vitrin capture` | Raw screenshots and recordings from the simulator → `.vitrin/raw/<locale>/<family>/` |
| `vitrin design` | HTML → Playwright → `fastlane/screenshots/<locale>/NN_<slug>_<target>.png`, `.vitrin/creative/` |
| `vitrin video` | Remotion → `fastlane/app-previews/<locale>/NN_IPHONE_67.mp4`, header/search loops |
| `vitrin validate` | `.vitrin/validation.json` (exit code 1 on errors) |
| `vitrin review` | `.vitrin/report.html` — search row, product page, contact sheets, counters, competitors |
| `vitrin upload [--dry-run]` | Plan; after approval: deliver / Asset Library / CPP / In-App Events, then read-back |
| `vitrin submit --confirm <bundleId>` | Submits for review (only with explicit confirmation) |
| `vitrin all` | Runs every stage in order; stops at the stage that needs input |

Global options: `-C, --cwd <dir>`, `-f, --force`, `--json`, `-q, --quiet`. Run `vitrin <command> --help` for command-specific flags.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Done |
| `1` | Error or validation failure |
| `2` | Waiting for input — a brief for Claude in `.vitrin/briefs/<stage>.md`, or missing keys for the user |

Stages are idempotent through `.vitrin/state.json`; `--force` re-runs a stage.

## Keys and `.env`

`.env` (never committed):

```
ASC_KEY_ID=          # ASC > Users and Access > Integrations > App Store Connect API (Team Key, ≥ App Manager)
ASC_ISSUER_ID=
ASC_KEY_PATH=./secrets/AuthKey_XXXXXXXXXX.p8   # or ASC_KEY_CONTENT_BASE64
```

Optional: Apple Ads, AppTweak, `FASTLANE_USER/PASSWORD` (only for `produce`), `REVIEW_DEMO_USER/PASSWORD`. While keys are missing, analysis and generation continue; upload does not start until `doctor` passes ("warn early, gate late"). Secret values are masked in all logs.

## Render matrix

| Asset | Size (px) |
| --- | --- |
| iPhone 6.3" (required) | 1206×2622 |
| iPhone 6.9" | 1320×2868 |
| iPad 13" (if the app supports iPad) | 2064×2752 |
| iPhone Duo outer / inner | 1398×2034 / 2007×2853 |
| App Preview (30 fps, H.264 High@4.0, stereo AAC) | 886×1920 |
| Product page header (21:9) | 3840×1646 |
| Search result (3:2) | 1920×1280 – 3840×2560 |

Full list: [data/targets.json](data/targets.json).

## Repository layout

```
packages/cli        commands, state, briefs, simulator, report
packages/schemas    zod schemas (AppProfile, Competitors, KeywordPlan, Metadata, ArtDirection, ShotList, VideoPlan, Report, Config)
packages/core       masking logger, exec, state, config/.env, data files, cached HTTP
packages/analyzer   pbxproj / Info.plist / entitlements / xcstrings / xcassets / storekit / code signals
packages/research   iTunes Search/Lookup, RSS, reviews, Vision OCR (Swift), k-means palette, keyword scoring
packages/validate   text, image, video and claim-to-evidence checks
packages/render     HTML template engine (Background, DeviceFrame, Caption, Badge), Playwright + sharp
packages/video      Remotion: AppPreview, HeaderLoop, SearchLoop, EventCard; ffmpeg normalization
packages/upload     fastlane bridge, ASC API (JWT), App Asset Library, CPP, In-App Events, plan and read-back
fastlane/           Gemfile and Fastfile templates
data/               targets.json, asc-locales.json, storefront-languages.json, forbidden-terms.json
skill/              SKILL.md, references/, scripts/install.sh
docs/               apple-notes.md, design/master-prompt.md (original design spec)
examples/Ritim      SwiftUI sample app for end-to-end testing (tr + en)
```

## Development

```bash
pnpm install
pnpm build
pnpm test
node packages/cli/dist/bin.js --cwd examples/Ritim validate
```

## Example app

[`examples/Ritim`](examples/Ritim) is a small SwiftUI habit tracker (Turkish and English) used for end-to-end runs. It includes a `-VitrinDemo` launch-argument demo mode (`examples/Ritim/Ritim/Support/VitrinDemo.swift`) that you can copy into your own app so screenshots show stable, non-personal data.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE)

### Licenses of dependencies

- Fonts are licensed under the SIL Open Font License (OFL), bundled via [@fontsource](https://fontsource.org).
- Icons are from [Lucide](https://lucide.dev) (ISC).
- [Remotion](https://www.remotion.dev) is free for individuals and for companies with up to 3 employees; larger teams need a [Remotion company license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
