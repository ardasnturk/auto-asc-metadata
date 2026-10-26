# Contributing to Vitrin

Thanks for helping! Vitrin automates App Store Connect metadata, screenshots, creatives and App Previews. This guide covers how to set up the repo, how the code is organised, and what we expect in a pull request.

## Ground rules

- **Never commit secrets.** `.env`, `*.p8` and `secrets/` are git-ignored; keep it that way. Do not paste key values into issues or PRs.
- **Truthful store content.** Vitrin must not help ship screenshots, videos or copy that show features an app does not have (App Review Guideline 2.3). New features that create marketing content need a claim ↔ evidence check in `packages/validate`.
- **Apple rules change.** If you change a size, limit or upload behaviour, cite the Apple page you checked in the PR and update `docs/apple-notes.md` and `data/targets.json`.
- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Requirements: macOS (for simulator capture and Vision OCR; everything else also runs on Linux), Node.js ≥ 22, pnpm (via `corepack enable`), Xcode, Ruby + Bundler, ffmpeg.

```bash
corepack enable
pnpm install
pnpm build          # tsc -b for all packages
pnpm test           # vitest
pnpm typecheck      # also checks the Remotion (.tsx) sources
```

Run the CLI from source against the sample app:

```bash
node packages/cli/dist/bin.js -C examples/Ritim validate
node packages/cli/dist/bin.js -C examples/Ritim design --only 01
```

Playwright's Chromium is needed for `design` (`pnpm --filter @vitrin/render exec playwright install chromium`); Remotion downloads its own headless shell on the first `video` run.

## Repository layout

| Path | What lives there |
| --- | --- |
| `packages/cli` | Commands, pipeline stages, Claude briefs, simulator capture, HTML review report |
| `packages/schemas` | zod schemas for every JSON file exchanged with Claude |
| `packages/core` | Masking logger, exec, state store, config/.env loading, data files |
| `packages/analyzer` | Project kind (native, Flutter, React Native, Expo, Android) and platform detection; Xcode/Gradle parsing, catalogs, StoreKit, code signals |
| `packages/research` | iTunes Search/Lookup, RSS, reviews, Vision OCR, palettes, keyword scoring |
| `packages/validate` | Text, image, video and claim ↔ evidence rules |
| `packages/render` | HTML screenshot templates rendered with Playwright + sharp |
| `packages/video` | Remotion compositions and the plan → scene builder |
| `packages/upload` | fastlane deliver/supply bridge, ASC and Google Play clients, partial-upload plan and read-back |
| `skills/vitrin/` | The `/vitrin` Claude Code skill, its references and style presets |
| `data/` | Render targets, locales, storefront languages, forbidden terms |
| `examples/Ritim` | SwiftUI sample app used for end-to-end runs |

The split of responsibilities matters: **creative decisions** (copy, keyword choice, art direction, shot list, video plan) are written by Claude into schema-checked JSON; **deterministic work** (collecting data, rendering, validating, uploading) belongs in the CLI. Don't add LLM calls to the CLI.

## Making changes

1. Open an issue first for larger changes (new archetype, video style, uploader behaviour) so we can agree on the design.
2. Keep changes focused; match the style of the surrounding code (ESM, strict TypeScript, small pure functions where possible).
3. Add or update tests in the package you touch (`packages/<name>/test`). Validation rules need a failing and a passing case.
4. For visual changes (screenshot layouts, video scenes) render `examples/Ritim` and look at the output — attach a before/after image to the PR.
5. User-facing CLI output is English; keep messages short and actionable (say what is wrong and how to fix it).
6. Update `CHANGELOG.md` under an "Unreleased" heading.

## Website

The landing page at [vitrin.ardasnturk.com](https://vitrin.ardasnturk.com) is plain HTML/CSS in `site/`, deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that touches `site/`. Preview it with `python3 -m http.server 4173 --directory site`. Its images and videos come from the sample app: after re-rendering `examples/Ritim`, run `node scripts/site-assets.mjs` to rebuild `site/assets`.

## Commit messages

Use the imperative mood ("Add callout archetype", "Fix keyword byte count for CJK"). Reference issues with `#123` in the body.

## Reporting bugs and security issues

Use the issue templates for bugs and feature requests. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
