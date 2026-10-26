---
name: vitrin
description: Generates, validates and uploads store listings for mobile apps — App Store Connect (iPhone, iPad, iPhone Duo, Mac, Apple Watch, Apple TV, Vision Pro) and Google Play — with HTML-rendered screenshots, Remotion App Preview videos, ASO metadata, fastlane and the ASC API. Swift/SwiftUI first; Flutter, React Native, Expo and native Android projects are supported. Triggers — App Store metadata, ASO, keywords, keyword field, screenshots, store screenshots, App Store screenshots, Google Play screenshots, Play Store listing, feature graphic, App Preview, app preview video, product page, custom product page, fastlane deliver, fastlane supply, upload to ASC, App Store Connect upload, App Store listing. Turkish triggers — anahtar kelime, ekran görüntüsü, ASC’ye yükle, mağaza görselleri, Play Store görselleri.
---

# /vitrin

Vitrin has two parts. The `vitrin` CLI (it comes with the Vitrin plugin and installs itself on first use) does the deterministic work: project detection, data collection, rendering, validation, upload. **You** make the creative decisions: copy, keyword selection, art direction, shot list, video plan, competitor interpretation. You save what you write to schema-conforming JSON files; the CLI validates them. No additional LLM API key is needed.

All images are rendered from HTML (Playwright) and all videos are rendered in code (Remotion). Never produce store images or videos any other way.

The app's own screens are HTML too: by default (`capture.mode: html`) you read the source code and recreate each screen worth showing as an HTML/CSS page with realistic demo data, and Vitrin renders it at the device's screen size. No build, no Xcode, no simulator, no demo mode. Building and capturing in simulators (`capture.mode: launch-args`) is only used when the user asks for real captures.

The working directory is the app's repository. Every command uses these exit codes:

| Code | Meaning | What you do |
| --- | --- | --- |
| 0 | Done | Move on to the next step |
| 1 | Error / validation failed | Read the output, fix, run again |
| 2 | Waiting for input | Read `metadata/briefs/<stage>.md` and write the requested JSON; or ask the user (keys, a choice, an approval) |

Stages are idempotent: a stage whose inputs have not changed is skipped (force with `--force`). When the user says "continue", resume from the stage where you stopped; do not regenerate files that already exist.

## Asking the user

Whenever this flow says **ask**, use your multiple-choice question tool (in Claude Code: AskUserQuestion; `multiSelect: true` where several answers are allowed). Without such a tool, show a short numbered list and wait for the answer. Never pick for the user when the flow says ask; recommend an option when you have a reason.

## Language

Vitrin speaks English by default, but the user chooses — **once per project**. Before anything else, read `vitrin.config.yaml` if it exists (`cat vitrin.config.yaml`): when it has `ui.language`, use that language and do not ask. Otherwise **ask** which language Vitrin should talk in: English (default), Türkçe, or another language (recommend the language the user wrote their message in), and store the answer right away (below). Never ask it again — not after a design was chosen, not when the user says "continue", not in a later session: the config holds the answer.

From then on, every question, progress note, summary, missing-keys message and report you write is in that language. CLI output stays English: relay it in the user's language, never paste it untranslated. Store the answer with `vitrin init --language <tag>` (new repository) or `vitrin select --language <tag>` (BCP 47: `en`, `tr`, `de`, `pt-BR` …). The review gallery uses it too: English and Turkish are built in; for any other language run `vitrin review --print-labels`, translate the values (keep the keys and `{placeholders}`) and save them as `metadata/i18n/<tag>.json` before the first review. The store copy is a separate choice (step 8): talking Turkish does not mean the listing is Turkish.

Paths such as `references/aso-rules.md` in this skill and in the CLI's briefs are relative to this skill's directory: `${CLAUDE_SKILL_DIR}`.

## Keep it fast

A full run across every language and every format takes hours; most of that time is capture and rendering. So nothing expensive runs before the user has chosen what they want:

- The app's screens are HTML recreations from the code (no build, no simulator), unless the user asked for real captures.
- The design samples use **one** language (English when the app has it, else the primary locale) and **one** format (the main iPhone size), captured on their own.
- Every other language and format is produced only after the user picked the design **and** the languages and formats (steps 7–8).
- Stages are cached; never pass `--force` unless something changed outside Vitrin's view. Re-render single shots with `vitrin design --only 03`.
- Before a long command (first install, capture, design, video) tell the user what runs and roughly how long, and give a short progress line when it finishes.

## Flow

0. **Language** — read `ui.language` from the config; ask only when it is missing (see Language). Once per project.
1. **CLI check** — run `vitrin --version` before anything else, with a long timeout (10 minutes), and never run other `vitrin` commands in parallel with it.
   - The first time, the Vitrin plugin's `vitrin` launcher installs the CLI for this plugin version into `~/.local/share/vitrin/<version>/`: no sudo and no global npm packages, but it downloads roughly 450 MB (npm packages and Playwright Chromium) and takes a few minutes. Tell the user that this one-time install is running before you start it; later runs start instantly.
   - `Node.js 22 or newer is required` → ask the user to install or update Node.js (`brew install node`), then run it again. A network error → run it once more, then show the user the error.
   - `vitrin: command not found` → the skill was installed without the plugin. Ask the user to install the plugin (`/plugin marketplace add ardasnturk/vitrin`, then `/plugin install vitrin@vitrin`) and restart Claude Code. Never ask the user to clone the Vitrin repository.
2. **init + doctor (early warning)** — on a repository used for the first time run `vitrin init --language <tag>` first; it writes only `vitrin.config.yaml` and the `.gitignore` block (everything Vitrin generates lives in `metadata/`; no `fastlane/` folder unless fastlane is chosen, no `.env` files until the upload). Then `vitrin doctor --tools` (local tools only, writes nothing). Mention missing tools that block generation (ffmpeg, Playwright) with the install command; Xcode and simulators are not needed for HTML screens. Do **not** ask for keys or create `.env`/`.env.example` now: say in one sentence that App Store Connect keys are needed only for the upload and you will ask for them then.
   If `capture.mode` is `launch-args` in a config made by an older Vitrin, **ask** once whether to switch to HTML screens from the code (recommended: no build, minutes instead of hours) or keep real simulator captures; store it with `vitrin select --capture html` or `--capture launch-args`. Vitrin keeps its own block in `.gitignore`; if it reports files that are already tracked, show the suggested `git rm -r --cached …` command and let the user decide.
3. **analyze** — `vitrin analyze`. It detects the project kind (native Xcode, Flutter, React Native, Expo, native Android) and every platform the app ships on. Code 2 → `metadata/briefs/analyze.md`:
   - Read the source code; add core features **with evidence** (`path` + `line`) to `metadata/app_profile.json` → `features` with `"source": "claude"`. Marketing copy (a paywall bullet, a README claim) is not evidence; working code is.
   - Write `positioning` (audience, job, tone) and, if needed, `categorySuggestion`.
   - `vitrin.config.yaml`: `research.seeds` (4–8 real search phrases per locale) and `capture.screens` (5–8 screens worth showing). With `capture.mode: html` each entry is `{ id, source: [view files] }` and nothing is added to the app. Only with `launch-args`: launch arguments per screen, and if the app has no demo mode, show the user what to add to which file for their framework (references/troubleshooting.md → Demo mode) and ask for approval.
4. **Choose platforms** — `vitrin platforms --json` lists the detected platforms with their evidence. **Ask** (multi-select) which platforms this run should produce content for: offer every detected platform (pre-recommend all of them) and mention that an undetected platform can still be chosen if they are about to ship it. Store the answer: `vitrin select --platforms ios,watchos,…`.
5. **Choose content** — **ask** (multi-select) what to produce for those platforms: metadata text, screenshots, App Preview videos, creatives (header/search, Play feature graphic and icon), In-App Event cards. Typical answers: "everything", "only watchOS screenshots", "only update the App Preview". Store it: `vitrin select --assets screenshots,previews,…`. Every later stage, the review and the upload cover only this selection; nothing else in the store is touched.
6. **Choose the uploader** (an App Store platform is selected) — run `vitrin uploader --json`: it shows whether the **asc CLI** (`asc`, App-Store-Connect-CLI, no Ruby) and **fastlane** (≥ 2.241.1, Ruby + Bundler) are installed. Never assume fastlane. **Ask** which one uploads the App Store metadata and media: list both with their installed status, recommend the `recommended` value (an installed tool beats one that needs installing), and give the install command for a tool that is missing (`brew install asc`, or the Gemfile line + `bundle install`). Store it: `vitrin select --uploader asc` or `--uploader deliver`. Skip the question when `uploader` is already set and its tool is installed. Google Play always uses fastlane supply; say so when Android is selected. Both uploaders use the same App Store Connect API key from `.env`.
7. **Choose a design** (screenshots selected) — four samples in one language and one format, before anything else is captured or rendered:
   - `vitrin platforms --json` → `samples` gives the locale (English when the app has it, else the primary locale), the format and the device family.
   - HTML screens: write `metadata/screens/<id>.html` for the screens the first three shots use, and `metadata/screens/strings/<samples.locale>.json` (`vitrin capture` exits 2 with `metadata/briefs/screens.md`, which has the rules). Recreate what the code renders: layout, colors, fonts, components, real UI text from the app's localization, realistic demo data. Open the rendered PNG with Read and fix the HTML until it matches the code.
   - Capture only that locale and family: `vitrin capture --locale <samples.locale> --family <samples.family>`.
   - Write the first three shots of `metadata/shots.json` (what the search result shows) with copy in that locale only (the design brief explains; without them `--samples` exits 2 with the brief).
   - `vitrin design --samples --json` renders four clearly different designs (A/B/C/D) of those shots, a contact sheet and **`store-preview.html`**: each option as an App Store search result and product page ("if you choose A, your listing looks like this"), in the user's language. Open it for the user (`open metadata/design-samples/store-preview.html` on macOS), show `store-preview.png` with Read in the chat, and **ask** which design they want (single choice; they may ask for changes or new samples: `--styles a,b,c,d`). Write the chosen style into `metadata/art-direction.json` as the brief explains. Continue with step 8 — the language question is not repeated.
8. **Choose languages and formats** — only after the design is chosen. From `vitrin platforms --json`:
   - **Ask** (multi-select) which store languages to produce: `locales` (the sample language and the detected ones first; a language the project is not localized in can still get a store listing). Remind the user that every language multiplies capture and render time.
   - **Ask** (multi-select) which formats to produce: `formats` with their pixel sizes; pre-recommend the `required` ones and the ones the app needs (e.g. iPad 13" for an iPad app). Unselected formats are not rendered, and their sets in the store stay untouched.
   - Store both: `vitrin select --locales en-US,tr --targets iphone-6.9,ipad-13,…`. Nothing in steps 9–12 runs for anything else.
9. **research** — `vitrin research` (needed when metadata or screenshot copy is selected). Then interpret `metadata/research/competitors.json` → `analysis.gaps` and `reviewClusters`; set `relevance` (0–1) for every candidate in `metadata/research/keywords/<locale>.json`.
10. **write** (metadata selected) — `vitrin write`. On success the finished text is also in the project, readable: `metadata/app-store/<platform>/<locale>/*.txt` (and `metadata/google-play/…`); tell the user where. Code 2 → write `metadata/listing/<locale>.json` and `app.json` according to `briefs/write.md` (rules: references/aso-rules.md, references/copy-guidelines.md). For Android also write the Google Play listing (`metadata/listing/play/<locale>.json` + `app.json`) and fix every `play.*` error from validate. Code 1 → fix the errors. Optionally `cpp-suggestions.json`.
11. **capture** — `vitrin capture` for the chosen languages and formats.
    - HTML screens (default): write the remaining screens, `strings/<locale>.json` for every chosen language (from the app's own localization), and `<id>.<family>.html` where a device family has its own layout (iPad sidebar, Mac window, Watch). Rendering takes seconds; check one PNG per family visually.
    - Real capture (`launch-args`, only if the user chose it): Vitrin builds the app for each selected platform (xcodebuild, `flutter build`, `pod install` + xcodebuild, `expo prebuild`, Gradle) and captures in its own simulators/emulators ("Vitrin · <device>", 9:41, full battery), the Mac window, or an Android emulator in System UI demo mode. The iPhone Duo fold posture cannot be automated; tell the user.
12. **design** — `vitrin design`. Code 2 → complete `metadata/art-direction.json` and `metadata/shots.json` (all shots, copy in every chosen language) according to `briefs/design.md` (references/art-direction.md and references/styles/: set strategy, first 3 screenshots = hook/proof/trust, ≤ 5 words, varied framing, quality bar). After rendering, **check at least two screenshots visually** (open the PNG with Read): overflow, legibility, badge placement; fix every quality-gate issue the command prints.
13. **video** (previews selected) — `vitrin video`. Code 2 → write `metadata/video-plan.json` (references/video.md: 4 styles, 6 scene types). With HTML screens there are no screen recordings: build the scenes from the screens (`device`, `zoom`, `split`, `stat`, `badges`, `text`). If the style is unclear, render all four with `vitrin video --styles all`, show them and **ask** which one. After rendering, check a few frames visually (`ffmpeg -ss <s> -frames:v 1`). On the first run Remotion downloads its own browser.
14. **validate** — `vitrin validate`. On errors, fix and run again; **at most 3 rounds**. After the third round, list the remaining errors for the user.
15. **review** — every image, video and text that would be uploaded must be shown to the user first. Run `vitrin review --serve` in the background and give the user the printed `http://127.0.0.1:…` URL (or `vitrin review` → `metadata/report.html`). The gallery is in the user's language (see Language) and shows every screenshot per store × platform × locale × format in upload order, App Previews, creatives, event cards, CPP suggestions, all metadata with counters, validation issues inline and a "What will be uploaded" summary with an overall hash. Summarize the key points.
    - Exit 0 from `--serve` → the user approved in the browser (`metadata/approval.json` written).
    - Exit 2 → the user rejected items: read `metadata/briefs/review.md` (and `metadata/review-feedback.json`), fix each item at its source (metadata JSON → `vitrin write`; shots/art direction → `vitrin design --only …`; video plan → `vitrin video`), run `vitrin validate`, then review again. Repeat until approved.
16. **approval** — never upload anything the user has not seen. If the user approves in the chat instead of the browser, only after an explicit "yes" to the report you showed: `vitrin approve --expect-hash <the 12-character hash printed by vitrin review>`. If they reject something in the chat: `vitrin approve --reject <item id from the report> --comment "<their words>"` (exit 2, then fix as above). Any file change after approval (including your own fixes) invalidates it: review and get approval again.
17. **doctor (gate)** — `vitrin doctor`. This is where keys are asked for. On code 2, **stop**: write the missing-keys message (in the user's language) and wait for "continue". When the user says "continue", run doctor again. If the chosen uploader's tool is missing, give its install command.
18. **upload --dry-run** — show the user the `vitrin upload --dry-run` plan, including its `[untouched · …]` sections (partial selections never use deliver's overwrite: only the selected display types are replaced), and ask for **explicit approval**. Creatives/CPP/events are separate flags (`--creatives`, `--cpp`, `--events`), each requiring its own approval.
19. **upload** — only after the user says "yes": `vitrin upload --yes [flags]`. With `deliver` it runs one deliver per Apple platform; with `asc` the asc CLI uploads text and media; Google Play always uses supply. `--yes` only skips the terminal prompt; the upload still refuses (exit 2, listing the changed files) unless `metadata/approval.json` matches every current file. In that case go back to step 15 — never try to work around it. Exit 2 with "No uploader chosen" → go back to step 6. `upload.ascValidate: true` adds `asc validate` to doctor as a submission-readiness warning. Partial runs replace one display type per locale (classic set API; App Asset Library for iPhone Duo) and never touch other sets.
20. **Summary** — what was uploaded, any differences found in the read-back, and what remains manual: privacy labels / Play data safety, final approval of the age rating questionnaire, checking App Store tags in the US, the Duo fold posture.
21. **finalize** — show the user the read-back and ask them to check the listing in the store. When they confirm, run `vitrin finalize --checked`. If `retention.keep` is not set, **ask**: "Keep the generated content in `metadata/` in the project, or delete it after the upload?" and run `vitrin finalize --checked --keep` or `--discard` (the flag stores the answer in vitrin.config.yaml, so it is asked only once). Research downloads (HTTP cache, competitor screenshots, OCR files) are deleted automatically either way. Report what was kept and deleted with sizes. If `metadata/` is already a user folder, tell the user and do not move it yourself.

Submit for review only if the user explicitly asks: `vitrin submit --confirm <bundleId>`. Never touch pricing, releases, tracks, rollouts or other hard-to-reverse actions.

## Missing-keys message

Ask for keys only at the upload gate (step 17), in the user's language. Never suggest pasting values into the chat; ask the user to put them in `.env`. The same keys serve both uploaders (Vitrin hands them to the asc CLI). Template:

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
- Every image, video and metadata text must be shown to the user (the review gallery) and approved before upload. Never run `vitrin approve` without the user's explicit approval of the report you showed them, never edit or delete `metadata/approval.json` by hand, and never regenerate assets between their approval and the upload.
- Never run `git rm --cached` or commit on the user's behalf; when Vitrin reports tracked files that are now ignored, show the suggested command and let the user decide.
- Proof badges only with the real rating from Lookup; no price badges; Apple marks only when the integration is real.
- When unsure about an Apple or Google Play rule, check `references/apple-notes.md` (verified rules, sources and open questions) and `references/apple-specs.md`; if it is still unclear, ask the user.

## References (read when needed)

- `references/apple-specs.md` — sizes, video rules, limits, Asset Library.
- `references/aso-rules.md` — name/subtitle/keyword strategy, the byte trap, storefront additional languages, Google Play title and descriptions.
- `references/copy-guidelines.md` — description, promotional text, What's New, localization by rewriting, Google Play copy.
- `references/art-direction.md` — the design method, archetypes, framing, badge rules, color/typography, the quality bar.
- `references/styles/` — the style presets offered as design samples.
- `references/video.md` — App Preview styles, scene types, duration and content rules.
- `references/troubleshooting.md` — demo mode per framework, capture on other platforms, Duo, first version, 401/403, video stuck processing, deliver deprecation.
