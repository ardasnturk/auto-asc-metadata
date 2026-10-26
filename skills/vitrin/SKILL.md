---
name: vitrin
description: Generates, validates and uploads store listings for mobile apps — App Store Connect (iPhone, iPad, iPhone Duo, Mac, Apple Watch, Apple TV, Vision Pro) and Google Play — with HTML-rendered screenshots, Remotion App Preview videos, ASO metadata, fastlane and the ASC API. Swift/SwiftUI first; Flutter, React Native, Expo and native Android projects are supported. Triggers — App Store metadata, ASO, keywords, keyword field, screenshots, store screenshots, App Store screenshots, Google Play screenshots, Play Store listing, feature graphic, App Preview, app preview video, product page, custom product page, fastlane deliver, fastlane supply, upload to ASC, App Store Connect upload, App Store listing. Turkish triggers — anahtar kelime, ekran görüntüsü, ASC’ye yükle, mağaza görselleri, Play Store görselleri.
---

# /vitrin

Vitrin has two parts. The `vitrin` CLI (installed globally) does the deterministic work: project detection, data collection, rendering, validation, upload. **You** make the creative decisions: copy, keyword selection, art direction, shot list, video plan, competitor interpretation. You save what you write to schema-conforming JSON files; the CLI validates them. No additional LLM API key is needed.

All images are rendered from HTML (Playwright) and all videos are rendered in code (Remotion). Never produce store images or videos any other way.

The working directory is the app's repository. Every command uses these exit codes:

| Code | Meaning | What you do |
| --- | --- | --- |
| 0 | Done | Move on to the next step |
| 1 | Error / validation failed | Read the output, fix, run again |
| 2 | Waiting for input | Read `.vitrin/briefs/<stage>.md` and write the requested JSON; or ask the user (keys, a choice, an approval) |

Stages are idempotent: a stage whose inputs have not changed is skipped (force with `--force`). When the user says "continue", resume from the stage where you stopped; do not regenerate files that already exist.

## Asking the user

Whenever this flow says **ask**, use your multiple-choice question tool (in Claude Code: AskUserQuestion; `multiSelect: true` where several answers are allowed). Without such a tool, show a short numbered list and wait for the answer. Never pick for the user when the flow says ask; recommend an option when you have a reason.

## Flow

1. **doctor (early warning)** — `vitrin doctor`. On code 2, tell the user which keys are missing (template below) but **keep generating**. If a tool is missing (fastlane < 2.241.1, ffmpeg, Playwright, Android SDK for Android apps), give the install command.
   If the repository is used for the first time, run `vitrin init` first. Vitrin maintains its own block in `.gitignore` on every command so generated files are never committed; if it reports files that are already tracked, show the user the suggested `git rm -r --cached …` command and let them decide.
2. **analyze** — `vitrin analyze`. It detects the project kind (native Xcode, Flutter, React Native, Expo, native Android) and every platform the app ships on. Code 2 → `.vitrin/briefs/analyze.md`:
   - Read the source code; add core features **with evidence** (`path` + `line`) to `.vitrin/app_profile.json` → `features` with `"source": "claude"`. Marketing copy (a paywall bullet, a README claim) is not evidence; working code is.
   - Write `positioning` (audience, job, tone) and, if needed, `categorySuggestion`.
   - `vitrin.config.yaml`: `research.seeds` (4–8 real search phrases per locale) and `capture.screens` (5–8 screens worth showing, with launch arguments). If the app has no demo mode, show the user what to add to which file for their framework (references/troubleshooting.md → Demo mode) and ask for approval.
3. **Choose platforms** — `vitrin platforms --json` lists the detected platforms with their evidence. **Ask** (multi-select) which platforms this run should produce content for: offer every detected platform (pre-recommend all of them) and mention that an undetected platform can still be chosen if they are about to ship it. Store the answer: `vitrin select --platforms ios,watchos,…`.
4. **Choose content** — **ask** (multi-select) what to produce for those platforms: metadata text, screenshots, App Preview videos, creatives (header/search, Play feature graphic and icon), In-App Event cards. Typical answers: "everything", "only watchOS screenshots", "only update the App Preview". Store it: `vitrin select --assets screenshots,previews,…`. Every later stage, the review and the upload cover only this selection; nothing else in the store is touched.
5. **research** — `vitrin research` (needed when metadata or screenshot copy is selected). Then interpret `.vitrin/competitors.json` → `analysis.gaps` and `reviewClusters`; set `relevance` (0–1) for every candidate in `.vitrin/keywords/<locale>.json`.
6. **write** (metadata selected) — `vitrin write`. Code 2 → write `.vitrin/metadata/<locale>.json` and `app.json` according to `briefs/write.md` (rules: references/aso-rules.md, references/copy-guidelines.md). For Android also write the Google Play listing (`.vitrin/metadata/play/<locale>.json` + `app.json`) and fix every `play.*` error from validate. Code 1 → fix the errors. Optionally `cpp-suggestions.json`.
7. **capture** — `vitrin capture`. Vitrin builds the app for each selected platform (xcodebuild, `flutter build`, `pod install` + xcodebuild, `expo prebuild`, Gradle) and captures in its own simulators/emulators ("Vitrin · <device>", 9:41, full battery), the Mac window, or an Android emulator in System UI demo mode. The iPhone Duo fold posture cannot be automated; tell the user.
8. **Choose a design** (screenshots selected) — write the first two shots of `.vitrin/shots.json` (the design brief explains; without them `--samples` exits 2 with the brief), then `vitrin design --samples --json` renders the first shots in several clearly different styles plus one labelled contact sheet (A/B/C/D). Open the contact sheet with Read, show it to the user and **ask** which design they want (single choice; they may ask for changes or new samples). Write the chosen style into `.vitrin/art-direction.json` as the brief explains.
9. **design** — `vitrin design`. Code 2 → write `.vitrin/art-direction.json` and `.vitrin/shots.json` according to `briefs/design.md` (references/art-direction.md and references/styles/: set strategy, first 3 screenshots = hook/proof/trust, ≤ 5 words, varied framing, quality bar). After rendering, **check at least two screenshots visually** (open the PNG with Read): overflow, legibility, badge placement; fix every quality-gate issue the command prints.
10. **video** (previews selected) — `vitrin video`. Code 2 → write `.vitrin/video-plan.json` (references/video.md: 4 styles, 6 scene types). If the style is unclear, render all four with `vitrin video --styles all`, show them and **ask** which one. After rendering, check a few frames visually (`ffmpeg -ss <s> -frames:v 1`). On the first run Remotion downloads its own browser.
11. **validate** — `vitrin validate`. On errors, fix and run again; **at most 3 rounds**. After the third round, list the remaining errors for the user.
12. **review** — every image, video and text that would be uploaded must be shown to the user first. Run `vitrin review --serve` in the background and give the user the printed `http://127.0.0.1:…` URL (or `vitrin review` → `.vitrin/report.html`). The gallery shows every screenshot per store × platform × locale × target in upload order, App Previews, creatives, event cards, CPP suggestions, all metadata with counters, validation issues inline and a "What will be uploaded" summary with an overall hash. Summarize the key points.
    - Exit 0 from `--serve` → the user approved in the browser (`.vitrin/approval.json` written).
    - Exit 2 → the user rejected items: read `.vitrin/briefs/review.md` (and `.vitrin/review-feedback.json`), fix each item at its source (metadata JSON → `vitrin write`; shots/art direction → `vitrin design --only …`; video plan → `vitrin video`), run `vitrin validate`, then review again. Repeat until approved.
13. **approval** — never upload anything the user has not seen. If the user approves in the chat instead of the browser, only after an explicit "yes" to the report you showed: `vitrin approve --expect-hash <the 12-character hash printed by vitrin review>`. If they reject something in the chat: `vitrin approve --reject <item id from the report> --comment "<their words>"` (exit 2, then fix as above). Any file change after approval (including your own fixes) invalidates it: review and get approval again.
14. **doctor (gate)** — `vitrin doctor`. On code 2, **stop**: write the missing-keys message and wait for "continue". When the user says "continue", run doctor again.
15. **upload --dry-run** — show the user the `vitrin upload --dry-run` plan, including its `[untouched · …]` sections (partial selections never use deliver's overwrite: only the selected display types are replaced), and ask for **explicit approval**. Creatives/CPP/events are separate flags (`--creatives`, `--cpp`, `--events`), each requiring its own approval.
16. **upload** — only after the user says "yes": `vitrin upload --yes [flags]`. It runs one deliver per Apple platform and supply for Google Play. `--yes` only skips the terminal prompt; the upload still refuses (exit 2, listing the changed files) unless `.vitrin/approval.json` matches every current file. In that case go back to step 12 — never try to work around it.
17. **Summary** — what was uploaded, any differences found in the read-back, and what remains manual: privacy labels / Play data safety, final approval of the age rating questionnaire, checking App Store tags in the US, the Duo fold posture.
18. **finalize** — show the user the read-back and ask them to check the listing in the store. When they confirm, run `vitrin finalize --checked`. If `retention.keep` is not set, **ask**: "Keep the generated content in `metadata/` in the project, or delete it after the upload?" and run `vitrin finalize --checked --keep` or `--discard` (the flag stores the answer in vitrin.config.yaml, so it is asked only once). Research downloads (HTTP cache, competitor screenshots, OCR files) are deleted automatically either way. Report what was kept and deleted with sizes. If `metadata/` is already a user folder, tell the user and do not move it yourself.

Submit for review only if the user explicitly asks: `vitrin submit --confirm <bundleId>`. Never touch pricing, releases, tracks, rollouts or other hard-to-reverse actions.

## Missing-keys message

Never suggest pasting values into the chat; ask the user to put them in `.env`. Template:

> These keys are missing for the upload:
> - **ASC_KEY_ID** — App Store Connect > Users and Access > Integrations > App Store Connect API > Team Keys (role at least App Manager).
> - **ASC_ISSUER_ID** — the Issuer ID at the top of the same page.
> - **ASC_KEY_PATH** — path to the downloaded `AuthKey_<KEYID>.p8` file (outside the repository or under `secrets/`).
> - **GOOGLE_PLAY_JSON_KEY_PATH** (Android only) — a Google Cloud service-account JSON key, invited in Play Console > Users and permissions with "Edit store listing".
>
> Add them to .env, then reply "continue".

Take the list from the doctor output; include only keys that are actually missing. The `.env` file lives at `<repo>/.env` (see `.env.example`).

## Boundaries

- Never show or write a feature the app does not have; every headline, badge and claim is tied to an evidence-backed feature in `app_profile.features` (App Review 2.3, Play metadata policy).
- Never copy competitor copy, images or brand names; competitor data is for analysis only.
- Never log, commit or write secret values in the chat. `.env`, `*.p8` and Play key files are never committed.
- Every image, video and metadata text must be shown to the user (the review gallery) and approved before upload. Never run `vitrin approve` without the user's explicit approval of the report you showed them, never edit or delete `.vitrin/approval.json` by hand, and never regenerate assets between their approval and the upload.
- Never run `git rm --cached` or commit on the user's behalf; when Vitrin reports tracked files that are now ignored, show the suggested command and let the user decide.
- Proof badges only with the real rating from Lookup; no price badges; Apple marks only when the integration is real.
- When unsure about an Apple or Google Play rule, check `references/apple-notes.md` (in the repository: `docs/apple-notes.md`) and references/apple-specs.md; if it is still unclear, ask the user.

## References (read when needed)

- `references/apple-specs.md` — sizes, video rules, limits, Asset Library.
- `references/aso-rules.md` — name/subtitle/keyword strategy, the byte trap, storefront additional languages, Google Play title and descriptions.
- `references/copy-guidelines.md` — description, promotional text, What's New, localization by rewriting, Google Play copy.
- `references/art-direction.md` — the design method, archetypes, framing, badge rules, color/typography, the quality bar.
- `references/styles/` — the style presets offered as design samples.
- `references/video.md` — App Preview styles, scene types, duration and content rules.
- `references/troubleshooting.md` — demo mode per framework, capture on other platforms, Duo, first version, 401/403, video stuck processing, deliver deprecation.
