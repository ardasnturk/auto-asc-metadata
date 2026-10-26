import { enabledTargets, existsSync, localeInfo, readJsonIfExists, storefrontForLocale, storefrontInfo, writeText } from '@vitrin/core';
import { Competitors, KeywordPlan, StylePreset, type AppProfile } from '@vitrin/schemas';
import { PRESETS, suggestStyles } from '@vitrin/render';
import { join } from 'node:path';
import type { Ctx } from './context.js';
import { sampleLocale, sampleTarget } from './commands/select.js';

/**
 * Briefs are the hand-off from the deterministic CLI to Claude: a compact summary of the inputs plus the exact
 * file Claude must write. The CLI exits with code 2 after writing one; the skill reads it, writes the JSON,
 * and re-runs the command.
 */
export async function writeBrief(ctx: Ctx, name: string, body: string): Promise<string> {
  const file = join(ctx.paths.briefs, `${name}.md`);
  await writeText(file, body);
  return file;
}

function featureTable(profile: AppProfile): string {
  return profile.features
    .map((f) => `| \`${f.id}\` | ${f.title} | ${f.kind} | ${f.evidence.map((e) => `${e.path}${e.line ? `:${e.line}` : ''}`).slice(0, 2).join(', ')} |`)
    .join('\n');
}

export async function profileBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  return writeBrief(
    ctx,
    'analyze',
    `# Brief: complete app_profile

File: \`.vitrin/app_profile.json\` (schema: AppProfile). The analyzer filled in the deterministic part. Your tasks:

1. Read the source code (especially screen/view files) and add the **core features** the analyzer could not see to the \`features\` list:
   \`{ "id": "kebab-case", "title": "…", "description": "…", "kind": "core", "evidence": [{ "path": "path relative to the project root", "line": 12 }], "confidence": "high", "source": "claude" }\`
   Evidence must be a real file; never add a feature the app does not have (App Review 2.3). Marketing copy (paywall bullets etc.) is not evidence; working code is.
2. Fill in \`positioning\`: \`{ "audience": "…", "jobToBeDone": "…", "tone": "…" }\`.
3. Correct \`categorySuggestion\` if needed (an ASC category constant, e.g. HEALTH_AND_FITNESS) and write down the reasoning.
4. In \`vitrin.config.yaml\`, write 4–8 seed search terms per locale under \`research.seeds\` (phrases users would actually type in the App Store; not competitor brands).
${
      ctx.config.capture.mode === 'html'
        ? `5. Fill \`capture.screens\` with the app's 5–8 screens worth showing: \`{ "id": "home", "source": ["App/Views/HomeView.swift", …] }\` — \`source\` lists the view files each screen is built from. capture.mode is \`html\`: no build and no demo mode; you recreate these screens in HTML in the next step (brief: screens.md).`
        : `5. Fill \`capture.screens\` with the app's 5–8 screens worth showing (launch arguments such as \`-VitrinScreen <id>\`). If the app has no \`-VitrinDemo\` support, show the user the file to add (the /vitrin skill’s references/troubleshooting.md).`
    }

Open notes (todo):
${profile.todo.map((t) => `- ${t}`).join('\n') || '- none'}

Current features:

| id | title | kind | evidence |
|---|---|---|---|
${featureTable(profile)}

When done, there is no need to re-run \`vitrin analyze\` (your additions survive re-analysis anyway); continue with \`vitrin research\`.
`,
  );
}

/** capture.mode html: what Claude writes in .vitrin/screens so Vitrin can render the screens without a build. */
export async function screensBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  const screens = ctx.config.capture.screens.map((s) => `| \`${s.id}\` | ${(s.source ?? []).map((f) => `\`${f}\``).join(', ') || '(find the view)'} |`).join('\n');
  const colors = [profile.brand.accentColor, ...profile.brand.colors.map((c) => `${c.hex}${c.name ? ` (${c.name})` : ''}`)].filter(Boolean).join(', ');
  const families = [...new Set(enabledTargets(ctx.config, profile, { quiet: true }).filter((t) => t.kind === 'screenshot').map((t) => t.family))];
  return writeBrief(
    ctx,
    'screens',
    `# Brief: the app's screens in HTML (capture.mode: html)

No build and no simulator: you recreate each screen of the app in HTML/CSS from its source code, and \`vitrin capture\` renders it at the device's screen size into \`.vitrin/raw/<locale>/<family>/<id>.png\`. The store screenshots are then designed around these screens as usual.

## Screens

| id | source |
|---|---|
${screens}

Device families in this run: ${families.join(', ') || 'iphone'}. Locales: ${ctx.config.app.locales.join(', ')}.

## Files to write
- \`.vitrin/screens/<id>.html\` — one complete page per screen (\`<!doctype html>\`, inline \`<style>\` or a shared \`.vitrin/screens/app.css\` linked relatively; images/icons next to it, relative paths). It is rendered in a viewport of the device's screen in CSS points (iPhone 440×956, iPad 1032×1376, Mac 1440×900, Watch 211×257, TV/Vision 1920×1080, Android phone 360×640, tablet 800×1280) and must fill it exactly, without scrolling.
- Optional \`.vitrin/screens/<id>.<family>.html\` when a family has its own layout (e.g. \`home.ipad.html\` with a sidebar, \`home.watch.html\`); otherwise the generic file is used with \`html[data-family="ipad"]\` CSS.
- \`.vitrin/screens/strings/<locale>.json\` — \`{ "key": "text" }\` for every \`{{key}}\` placeholder used in the HTML, for each locale. Take the texts from the app's own localization (String Catalog / Localizable.strings / strings.xml / ARB / i18n JSON); never invent UI text the app does not have.

## Fidelity rules (App Review 2.3: screenshots must show the app in use)
- Recreate what the code renders: layout, hierarchy, components, spacing, corner radii, colors (asset catalog / theme${colors ? `: ${colors}` : ''}), typography (\`-apple-system\`/SF Pro on Apple platforms, Roboto on Android), light/dark appearance as \`capture.appearance\` (${ctx.config.capture.appearance}).
- System chrome: Vitrin draws a 9:41 status bar with full battery on iPhone, iPad and Android; keep \`var(--safe-top)\` free at the top and \`var(--safe-bottom)\` at the bottom. On a dark top area set \`<html data-status-bar="light">\`; \`none\` hides it. Draw the app's own navigation bars, tab bars, lists and sheets yourself (native look: large titles, SF-like icons as inline SVG, system blue \`#007AFF\` only if the app uses the default tint).
- Content: realistic demo data that matches the app's features (no user data, no lorem ipsum, no placeholder brands); numbers and charts consistent between screens.
- Only features with evidence in app_profile.json; nothing the app cannot show.
- No external network resources (fonts, images, scripts from the web); everything local.

## Check
Run \`vitrin capture --locale ${sampleLocale(ctx.config)}\` and open two of the PNGs with Read: compare them against the code (and against a real screenshot if the user has one). Fix the HTML until it matches; then the other locales only need their strings files.
`,
  );
}

export async function metadataBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  const competitors = await readJsonIfExists(ctx.paths.competitors, Competitors).catch(() => undefined);
  const sections: string[] = [];
  for (const locale of ctx.config.app.locales) {
    const kw = await readJsonIfExists(ctx.paths.keywordFile(locale), KeywordPlan).catch(() => undefined);
    const sf = storefrontInfo(storefrontForLocale(locale));
    const top = (kw?.candidates ?? [])
      .slice()
      .sort((a, b) => b.popularity.score * (1 - b.competition.score) - a.popularity.score * (1 - a.competition.score))
      .slice(0, 30)
      .map((c) => `${c.term} (pop ${c.popularity.score}${c.popularity.source === 'estimate' ? '~' : ''}, comp ${c.competition.score}${c.relevance !== null ? `, rel ${c.relevance}` : ''})`)
      .join('; ');
    sections.push(`### ${locale} — ${localeInfo(locale)?.name ?? locale}
- Storefront: ${sf ? `${sf.country} (default ${sf.default}; additional: ${sf.additional.join(', ') || 'none'})` : '?'}
- Candidate keywords (~ = estimated popularity): ${top || '(research has not run)'}
- Files: \`.vitrin/metadata/${locale}.json\`; also fill in each candidate's \`relevance\` (0–1) in \`.vitrin/keywords/${locale}.json\` and write \`selected\`.`);
  }
  const rivals = (competitors?.apps ?? [])
    .slice(0, 12)
    .map((a) => `- ${a.name} — ${a.averageUserRating?.toFixed(1) ?? '?'}★ (${a.userRatingCount ?? 0}), ${a.storefront}`)
    .join('\n');
  return writeBrief(
    ctx,
    'write',
    `# Brief: write metadata

App: **${profile.app.displayName}** (${profile.app.bundleId}). Audience: ${profile.positioning?.audience ?? '?'}. Job to be done: ${profile.positioning?.jobToBeDone ?? '?'}. Tone: ${profile.positioning?.tone ?? '?'}.
Developer: ${ctx.config.copyrightHolder ?? '?'} — this name does not go in the keyword field.

## Rules (validate checks these)
- Name 2–30 characters = brand + primary keyword. Subtitle ≤ 30 = benefit + secondary keyword; do not repeat words from the name.
- Keywords ≤ **100 bytes** (UTF-8; accented Latin letters such as ç ş ğ ö ü are 2 bytes, CJK 3 bytes), comma-separated with no spaces, singular, each term > 2 characters, no words repeated from the name/subtitle, no competitor/company names, Apple trademarks or prices.
- Description ≤ 4000, plain text; the first 3 lines are the hook. No keyword stuffing. No unproven or price claims such as “#1 / best / free”.
- Promotional text ≤ 170 (changes without review). What’s New ≤ 4000, written from git log in user language (leave empty on the first release).
- What’s New lists significant changes specifically (App Review 2.3.12); a generic “bug fixes and improvements” is only for bug-fix releases.
- Review notes (app.json) describe every new feature specifically and where to find it, non-obvious features and in-app purchases, and the demo account or demo mode (2.1, 2.3.1). No placeholder text (Lorem ipsum, TODO, TBD).
- Never use Apple recognitions (Editor’s Choice, App of the Day, Apple Design Award), other platforms or marketplaces, or “for kids / for children” wording unless the app is in the Kids Category.
- Every locale is a **local rewrite**, not a translation. Write different keywords for additional locales that count toward the same storefront.
- Every claim is linked in \`claims\` to a feature in app_profile.
- en-US copy should use the target concepts clearly for App Store tags (tags are assigned only in the US, from en-US).

## Files to write
\`.vitrin/metadata/<locale>.json\` (one per locale, e.g. \`en-US\`, \`tr\`):
\`\`\`json
{ "locale": "en-US", "name": "", "subtitle": "", "promotionalText": "", "description": "", "keywords": "keyword1,keyword2",
  "whatsNew": "", "claims": [{ "text": "exact phrase from the description", "featureIds": ["icloud-sync"] }] }
\`\`\`
\`.vitrin/metadata/app.json\`:
\`\`\`json
{ "copyright": "${new Date().getFullYear()} ${ctx.config.copyrightHolder ?? 'Company'}", "primaryCategory": "${profile.categorySuggestion?.primary ?? 'PRODUCTIVITY'}", "secondaryCategory": "",
  "reviewNotes": "Demo mode, test steps…", "ageRatingDraft": { "answers": {}, "rationale": "", "needsUserConfirmation": true },
  "accessibilityDraft": [{ "criterion": "VoiceOver", "supported": "partial", "evidence": "…" }] }
\`\`\`
Optional \`.vitrin/cpp-suggestions.json\`: 2–5 Custom Product Page suggestions (segment, rationale, non-overlapping keyword set, shot ids to use).
${profile.app.platforms.includes('android') ? `
**Google Play listing** (the app ships on Android). For each locale write \`.vitrin/metadata/play/<locale>.json\`: \`{ "locale", "title" (≤ 30, brand + primary keyword, no emoji/ALL CAPS/#1/best/free/new), "shortDescription" (≤ 80, one benefit sentence with the secondary keyword), "fullDescription" (≤ 4000; indexed, so use the main phrases naturally 2–3 times; no keyword lists; no App Store/iPhone mentions), "changelog" (≤ 500, optional), "video" (optional public YouTube URL), "claims" }\`. Set \`playLocale\` only to override data/play-locales.json. Write \`.vitrin/metadata/play/app.json\` with \`{ "track": "production", "versionCode": <int, only with a changelog> }\`. Google Play has no keyword field; see references/aso-rules.md (Google Play).
` : ''}
For the age rating questionnaire and accessibility, see app_profile.signals (age.*, accessibility.*); these are drafts, the user gives final approval.

## Locales
${sections.join('\n\n')}

## Competitors (analysis only; never copy their copy or branding)
${rivals || '- (none)'}
Gaps: ${(competitors?.analysis.gaps ?? []).join('; ') || '(write them yourself in competitors.json analysis.gaps)'}

When done: \`vitrin write\` (validates and exports to .vitrin/store/metadata).
`,
  );
}

export async function designBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  const competitors = await readJsonIfExists(ctx.paths.competitors, Competitors).catch(() => undefined);
  const palettes = (competitors?.analysis.paletteUsage ?? []).slice(0, 8).map((p) => `${p.hex}×${p.count}`).join(', ');
  const headlines = (competitors?.apps ?? []).flatMap((a) => a.screenshotText.flatMap((s) => s.lines.slice(0, 1))).slice(0, 12);
  const screens = ctx.config.capture.screens.map((s) => s.id).join(', ');
  const category = profile.categorySuggestion?.primary;
  const suggested = suggestStyles(4, category);
  const brand = [profile.brand.accentColor, ...profile.brand.colors.map((c) => c.hex)].filter((c, i, all): c is string => Boolean(c) && all.indexOf(c) === i);
  const hasShots = existsSync(ctx.paths.shots);
  const sample = { locale: sampleLocale(ctx.config), target: sampleTarget(ctx.config, profile) };
  const presetRows = StylePreset.options.map((id) => `| \`${id}\` | ${PRESETS[id].name} | ${PRESETS[id].surfaces[0]!.dark ? 'dark' : 'light'} | ${PRESETS[id].device.tilt ? `tilted ±${PRESETS[id].device.tilt}°` : 'upright'} |`).join('\n');
  return writeBrief(
    ctx,
    'design',
    `# Brief: style samples, art direction and shot list

Method: the /vitrin skill’s references/art-direction.md (iron rules, narrative arc, framing, quality bar) and references/styles/ (one spec per preset — read the one you pick).

## Input
- App: **${profile.app.displayName}** — category ${category ?? '?'}; audience: ${profile.positioning?.audience ?? '?'}
- Brand colors (tint the preset): ${brand.join(', ') || '?'}
- Competitor palettes (most common): ${palettes || '?'}
- Competitor first-screenshot headlines (OCR, analysis only): ${headlines.map((h) => `“${h}”`).join(', ') || '?'}
- Captured screens (capture.screens): ${screens || '(none)'}
- Icons: Lucide names (e.g. cloud, chart-column, bell, lock, sparkles). Do not use SF Symbols.

## Step 1 — the first two shots, then samples${hasShots ? ' (shots.json exists: check its first two shots)' : ''}
Write \`.vitrin/shots.json\` with **only the hero and the second shot** (real copy, real screens; see Step 3 for the format), with copy in **${sample.locale} only**. The samples use one language and one format (${sample.target.id}), so capture just that first: \`vitrin capture --locale ${sample.locale} --family ${sample.target.family}\`. Then run:

\`\`\`
vitrin design --samples --json            # suggested for this app: ${suggested.join(', ')}
vitrin design --samples --styles a,b,c,d  # or pick the presets yourself (2–8, --count N)
\`\`\`

It renders those two shots in each preset (\`.vitrin/design-samples/<preset>/\`) plus one contact sheet labelled A, B, C, D (\`.vitrin/design-samples/contact-sheet.png\`). Pick presets that differ clearly (light and dark, sans and serif, upright and tilted) and that stand apart from the competitor palettes above.

## Step 2 — ask the user
Show the contact sheet and ask: **“Which design should the screenshots use — A, B, C or D?”** Wait for the answer; never choose for them. Then write \`.vitrin/art-direction.json\`:
\`\`\`json
{ "options": [{ "id": "picked", "name": "…", "rationale": "why it fits the app", "differentiation": "why it stands apart from competitors",
    "preset": "liquid-glass-aurora", "brand": { "primary": "${brand[0] ?? '#5B4BE8'}"${brand[1] ? `, "secondary": "${brand[1]}"` : ''} } }],
  "selected": "picked", "selectionReason": "The user chose B." }
\`\`\`
Then ask which store languages and which formats to produce (\`vitrin platforms --json\` → \`locales\`, \`formats\`) and store them with \`vitrin select --locales … --targets …\`. Only now capture and render the rest.

| Preset | Name | Surface | Device |
|---|---|---|---|
${presetRows}

## Step 3 — the full shot list
Copy for every chosen language (\`app.locales\`: ${ctx.config.app.locales.join(', ')}); each locale is a local rewrite, not a word-for-word translation. 5–7 shots for iPhone (3–5 are enough for iPad). Follow the narrative arc: 1 hero (main benefit; proof only here) → 2 differentiator → 3 ecosystem/core → features, one per shot → trust → closer (\`feature-wall\` or \`mosaic\`).
- **Headlines:** one idea, ≤ 5 words recommended (7 max), 3–5 words per line, ≤ 2 lines, \`\\n\` for an intentional break, exactly one \`*emphasis*\`. Write them in the preset's copy tone (styles/<preset>.md). Reinforce the main keyword from the name/subtitle. \`kicker\` ≤ 3 words.
- **Framing varies:** leave \`"framing": "auto"\` (never repeats the previous shot) or set bleed-bottom / bleed-top / offset / tilted / two-devices / no-device yourself; mix at least two framings. 1–2 shots \`"inverted": true\` for rhythm (cycling presets change surface on their own). For 5+ shots set \`"bridge": true\` on one shot to carry a decorative element into the next (never text).
- **Archetypes:** hero, feature, callout, fullbleed, tilted, split, collage, before-after, stat, social-proof, panoramic, statement, testimonial, feature-wall, mosaic. At least 60 % real UI, one UI shot in the first 3.
- No calls to action (“Download now”), other platform names, prices or unproven awards. Badges: feature/new need \`featureId\`; proof only a real Lookup rating or documented award, on the hero; platform only if supported. Max 2 badges on the hero.
- callout: \`"callouts": [{ "screen": 0, "rect": { "x": 0.04, "y": 0.47, "w": 0.92, "h": 0.3 }, "scale": 1.45, "side": "center", "at": 0.6 }]\` — rect in fractions of the iPhone capture; add \`"rects": { "ipad": {…} }\` if the iPad layout differs.
- testimonial: only verbatim reviews from competitors.json → self.reviews, in their own language. stat: \`"stat": { "value": "12 weeks", "featureId": "…" }\`, backed by evidence. feature-wall: \`"wall": [{ "en-US": "Widgets" }, …]\`, every line a real feature listed in \`featureIds\`.
\`\`\`json
{ "shots": [{ "id": "01", "slug": "hero", "archetype": "hero", "screens": ["home"], "featureIds": ["…"], "framing": "auto",
    "copy": { "en-US": { "kicker": "…", "headline": "Keep your *streak*", "subheadline": "…" } },
    "badges": [{ "type": "feature", "icon": "cloud", "featureId": "icloud-sync", "label": { "en-US": "iCloud sync" } }] },
  { "id": "06", "slug": "more", "archetype": "feature-wall", "screens": [], "featureIds": ["…"], "copy": { "en-US": { "headline": "And so much *more*" } }, "wall": [{ "en-US": "Widgets" }] }],
  "creatives": { "header": { "copy": {…}, "screens": ["home","stats"], "featureIds": ["…"] },
                 "search": { "copy": {…}, "screens": ["home"], "featureIds": ["…"] }, "events": [] } }
\`\`\`
\`creatives.header\` also supplies the Google Play feature graphic line (short brand line, not a screenshot headline).

## Step 4 — render and check
Run \`vitrin design\`. Open the first three iPhone PNGs, one iPad and one Android/Duo/Mac/Watch PNG if those targets are enabled, and read the quality issues in \`.vitrin/validation.json\` (\`image.device-small\`, \`image.empty-band\`, \`image.headline-contrast\`, \`image.thumbnail\` …). Fix copy or framing until the set passes the thumbnail test.
`,
  );
}

export async function videoBrief(ctx: Ctx): Promise<string> {
  const recs = ctx.config.capture.recordings.map((r) => r.id);
  return writeBrief(
    ctx,
    'video',
    `# Brief: video plan

Write \`.vitrin/video-plan.json\` (details: the /vitrin skill’s references/video.md). App Preview: 886×1920 (iPhone), 1200×1600 (iPad), 1920×1080 landscape for \`"device": "mac"\` / \`"tv"\` (targets preview-mac / preview-tv); 30 fps, 15–30 s (target 20–25).
The preview uses the art direction's preset colors and fonts and the same device frames as the screenshots, so keep the hook line consistent with the hero screenshot.
Real app footage should dominate; keep text cards short. The first ~1.5 s of each recording is the app launch: \`from\` ≥ 1.5.
Sources: recordings (${recs.join(', ') || 'capture.recordings is empty'}) or screen ids (${ctx.config.capture.screens.map((s) => s.id).join(', ')}).

Style: \`classic\` | \`showcase\` (3D device, camera push, light leaks) | \`kinetic\` (word-by-word text cards) | \`energetic\` (tilted device, banner headline, fast transitions).
If unsure, first render all four with \`vitrin video --styles all\` and show them to the user.
Scenes: device, zoom (\`zoom\` rectangle), split (\`secondSource\`), stat (\`stat\`), badges (\`badges\`), text. \`*accent*\` is supported.

\`\`\`json
{ "previews": [{ "id": "01", "device": "iphone", "style": "showcase", "transition": "auto",
    "hookSource": "home-flow", "hookFrom": 1.5, "hook": { "en-US": "One tap, *every day*", "tr": "Günde *tek dokunuş*" },
    "beats": [
      { "scene": "device", "source": "home-flow", "from": 1.5, "to": 5, "caption": { "en-US": "…", "tr": "…" }, "featureIds": ["…"] },
      { "scene": "zoom", "source": "detail", "from": 0, "to": 4, "zoom": { "x": 0.04, "y": 0.47, "w": 0.92, "h": 0.3 }, "caption": { … }, "featureIds": ["…"] },
      { "scene": "stat", "source": "stats-flow", "from": 1.5, "to": 5, "stat": { "value": 12, "suffix": { "en-US": "weeks" }, "label": { "en-US": "…" }, "featureId": "…" }, "caption": { … }, "featureIds": ["…"] },
      { "scene": "badges", "source": "stats-flow", "from": 2, "to": 5.5, "badges": [{ "icon": "bell", "label": { … }, "featureId": "…" }], "caption": { … }, "featureIds": ["…"] }
    ],
    "outro": { "title": { "en-US": "…", "tr": "…" }, "subtitle": { "en-US": "…", "tr": "…" } } }],
  "loops": { "header": { "durationSec": 12, "fps": 30, "copy": { … }, "sources": ["home","stats","detail"], "featureIds": ["…"] },
             "search": { "durationSec": 10, "fps": 30, "copy": { … }, "sources": ["home","stats"], "featureIds": ["…"] } } }
\`\`\`
When done: \`vitrin video\`.
`,
  );
}
