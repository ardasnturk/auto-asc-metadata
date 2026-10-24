---
name: vitrin
description: Generates, validates and uploads App Store Connect metadata, screenshots, creatives and App Preview videos for an iOS app using fastlane and the ASC API. Triggers — App Store metadata, ASO, keywords, keyword field, screenshots, store screenshots, App Store screenshots, App Preview, app preview video, product page, custom product page, fastlane deliver, upload to ASC, App Store Connect upload, App Store listing. Turkish triggers — anahtar kelime, ekran görüntüsü, ASC’ye yükle, mağaza görselleri.
---

# /vitrin

Vitrin has two parts. The `vitrin` CLI (installed globally) does the deterministic work: data collection, rendering, validation, upload. **You** make the creative decisions: copy, keyword selection, art direction, shot list, video plan, competitor interpretation. You save what you write to schema-conforming JSON files; the CLI validates them. No additional LLM API key is needed.

The working directory is the app's repository. Every command uses these exit codes:

| Code | Meaning | What you do |
| --- | --- | --- |
| 0 | Done | Move on to the next step |
| 1 | Error / validation failed | Read the output, fix, run again |
| 2 | Waiting for input | Read `.vitrin/briefs/<stage>.md` and write the requested JSON; or ask the user for keys |

Stages are idempotent: a stage whose inputs have not changed is skipped (force with `--force`). When the user says "continue", resume from the stage where you stopped; do not regenerate files that already exist.

## Flow

1. **doctor (early warning)** — `vitrin doctor`. On code 2, tell the user which keys are missing (template below) but **keep generating**. If a tool is missing (fastlane < 2.241.1, ffmpeg, Playwright), give the install command.
   If the repository is used for the first time, run `vitrin init` first.
2. **analyze** — `vitrin analyze`. Code 2 → `.vitrin/briefs/analyze.md`:
   - Read the source code; add core features **with evidence** (`path` + `line`) to `.vitrin/app_profile.json` → `features` with `"source": "claude"`. Marketing copy (a paywall bullet, a README claim) is not evidence; working code is.
   - Write `positioning` (audience, job, tone) and, if needed, `categorySuggestion`.
   - `vitrin.config.yaml`: `research.seeds` (4–8 real search phrases per locale) and `capture.screens` (5–8 screens worth showing, with launch arguments). If the app has no `-VitrinDemo` mode, show the user what to add to which file (references/troubleshooting.md → Demo mode) and ask for approval.
3. **research** — `vitrin research`. Then interpret `.vitrin/competitors.json` → `analysis.gaps` and `reviewClusters`; set `relevance` (0–1) for every candidate in `.vitrin/keywords/<locale>.json`.
4. **write** — `vitrin write`. Code 2 → write `.vitrin/metadata/<locale>.json` and `app.json` according to `briefs/write.md` (rules: references/aso-rules.md, references/copy-guidelines.md). Code 1 → fix the errors. Optionally `cpp-suggestions.json`.
5. **capture** — `vitrin capture`. Vitrin boots its own simulators ("Vitrin · <device>"), clock at 9:41, full battery. The iPhone Duo fold posture cannot be automated; tell the user.
6. **design** — `vitrin design`. Code 2 → write `.vitrin/art-direction.json` (2–3 directions; pick the one that differs most from competitors) and `.vitrin/shots.json` according to `briefs/design.md` (references/art-direction.md: set strategy, first 3 screenshots = hook/proof/trust, ≤ 5 words, 13 archetypes). Vary archetypes to suit the kind of app; do not repeat the same layout back to back. After rendering, **check at least two screenshots visually** (open the PNG with Read): overflow, legibility, badge placement.
7. **video** — `vitrin video`. Code 2 → write `.vitrin/video-plan.json` (references/video.md: 4 styles, 6 scene types). If the style is unclear, render all four with `vitrin video --styles all`, show them to the user and let them choose. After rendering, check a few frames visually (`ffmpeg -ss <s> -frames:v 1`). On the first run Remotion downloads its own browser.
8. **validate** — `vitrin validate`. On errors, fix and run again; **at most 3 rounds**. After the third round, list the remaining errors for the user.
9. **review** — `vitrin review` → `.vitrin/report.html`. Give the user the path and summarize the key points (counters, first 3 screenshots, warnings).
10. **doctor (gate)** — `vitrin doctor`. On code 2, **stop**: write the missing-keys message and wait for "continue". When the user says "continue", run doctor again.
11. **upload --dry-run** — show the user the `vitrin upload --dry-run` plan and ask for **explicit approval**. Creatives/CPP/events are separate flags (`--creatives`, `--cpp`, `--events`), each requiring its own approval.
12. **upload** — only after the user says "yes": `vitrin upload --yes [flags]`.
13. **Summary** — what was uploaded, any differences found in the read-back, and what remains manual: privacy labels, final approval of the age rating questionnaire, checking App Store tags in the US, the Duo fold posture.

Submit for review only if the user explicitly asks: `vitrin submit --confirm <bundleId>`. Never touch pricing, releasing a version or other hard-to-reverse actions.

## Missing-keys message

Never suggest pasting values into the chat; ask the user to put them in `.env`. Template:

> These keys are missing for the upload:
> - **ASC_KEY_ID** — App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys (role at least App Manager).
> - **ASC_ISSUER_ID** — the Issuer ID at the top of the same page.
> - **ASC_KEY_PATH** — path to the downloaded `AuthKey_<KEYID>.p8` file (outside the repository or under `secrets/`).
>
> Add them to .env, then reply "continue".

Take the list from the doctor output; include only keys that are actually missing. The `.env` file lives at `<repo>/.env` (see `.env.example`).

## Boundaries

- Never show or write a feature the app does not have; every headline, badge and claim is tied to an evidence-backed feature in `app_profile.features` (App Review 2.3).
- Never copy competitor copy, images or brand names; competitor data is for analysis only.
- Never log, commit or write secret values in the chat. `.env` and `*.p8` are never committed.
- Proof badges only with the real rating from Lookup; no price badges; Apple marks only when the integration is real.
- When unsure about an Apple rule, check `references/apple-notes.md` (in the repository: `docs/apple-notes.md`) and references/apple-specs.md; if it is still unclear, ask the user.

## References (read when needed)

- `references/apple-specs.md` — sizes, video rules, limits, Asset Library.
- `references/aso-rules.md` — name/subtitle/keyword strategy, the byte trap, storefront additional languages.
- `references/copy-guidelines.md` — description, promotional text, What's New, localization by rewriting.
- `references/art-direction.md` — archetypes, badge rules, color/typography, quality checks.
- `references/video.md` — App Preview styles, scene types, duration and content rules.
- `references/troubleshooting.md` — demo mode, Duo, first version, 401/403, video stuck processing, deliver deprecation.
