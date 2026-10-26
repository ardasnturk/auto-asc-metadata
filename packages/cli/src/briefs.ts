import { localeInfo, readJsonIfExists, storefrontForLocale, storefrontInfo, writeText } from '@vitrin/core';
import { Competitors, KeywordPlan, type AppProfile } from '@vitrin/schemas';
import { FONT_FAMILIES } from '@vitrin/render';
import { join } from 'node:path';
import type { Ctx } from './context.js';

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
5. Fill \`capture.screens\` with the app's 5–8 screens worth showing (launch arguments such as \`-VitrinScreen <id>\`). If the app has no \`-VitrinDemo\` support, show the user the file to add (skills/vitrin/references/troubleshooting.md).

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

When done: \`vitrin write\` (validates and exports to fastlane/metadata).
`,
  );
}

export async function designBrief(ctx: Ctx, profile: AppProfile): Promise<string> {
  const competitors = await readJsonIfExists(ctx.paths.competitors, Competitors).catch(() => undefined);
  const palettes = (competitors?.analysis.paletteUsage ?? []).slice(0, 8).map((p) => `${p.hex}×${p.count}`).join(', ');
  const headlines = (competitors?.apps ?? []).flatMap((a) => a.screenshotText.flatMap((s) => s.lines.slice(0, 1))).slice(0, 12);
  const screens = ctx.config.capture.screens.map((s) => s.id).join(', ');
  return writeBrief(
    ctx,
    'design',
    `# Brief: art direction and shot list

## Input
- Brand colors: ${profile.brand.accentColor ?? '?'} ${profile.brand.colors.map((c) => `${c.name}=${c.hex}`).join(', ')}
- Competitor palettes (most common): ${palettes || '?'}
- Competitor first-screenshot headlines (OCR, analysis only): ${headlines.map((h) => `“${h}”`).join(', ') || '?'}
- Captured screens (capture.screens): ${screens || '(none)'}
- Fonts (only these): ${Object.keys(FONT_FAMILIES).join(', ')}
- Icons: Lucide names (e.g. cloud, chart-column, bell, lock, sparkles). Do not use SF Symbols.

## 1) \`.vitrin/art-direction.json\`
Propose 2–3 directions (palette, typography, background language, device frame) and pick the one that **stands out most from the competitors**.
\`\`\`json
{ "options": [{ "id": "deep-night", "name": "…", "rationale": "…", "differentiation": "…",
  "palette": { "background": ["#0F1029","#2B2D7A","#6C3CE0"], "surface": "#1B1C3F", "primary": "#7C7CFF", "accent": "#FFB547",
               "text": "#FFFFFF", "textMuted": "#C9CBF2", "badgeBackground": "#FFFFFF", "badgeText": "#1B1C3F" },
  "typography": { "headline": "Plus Jakarta Sans", "body": "Inter", "headlineWeight": 800, "headlineCase": "none", "letterSpacing": -0.02 },
  "background": { "style": "mesh", "angle": 160, "intensity": 0.6 },
  "device": { "frame": "minimal", "shadow": true, "tilt": 0 } }],
  "selected": "deep-night", "selectionReason": "…" }
\`\`\`
Background styles: solid, linear, radial, mesh, grid, dots, panoramic (continues across consecutive shots). Text/background contrast ≥ 3:1 (validate measures it).

## 2) \`.vitrin/shots.json\`
5–7 shots (3–5 are enough for iPad). Archetypes: hero, feature, callout, fullbleed, tilted, split, collage, before-after, stat, social-proof, panoramic, statement, testimonial (see skills/vitrin/references/art-direction.md).
- First 3 shots = hook (outcome) → proof (core action, real UI) → trust/payoff. At least 60% real UI; at least one UI in the first 3.
- Headlines: 5 words or fewer recommended (limit 7), at most 2 lines, and they **reinforce the main keyword** from the name/subtitle. \`kicker\` is a small line above (≤ 3 words); \`*word*\` is drawn in the accent color.
- No calls to action (“Download now”), other platform names or prices. One caption position for the whole set (\`captionPosition\`: top/bottom).
- callout: \`"callouts": [{ "screen": 0, "rect": { "x": 0.04, "y": 0.47, "w": 0.92, "h": 0.3 }, "scale": 1.45, "side": "center", "at": 0.6 }]\` — rect is in fractions of the captured iPhone screen; if the iPad layout differs, add \`"rects": { "ipad": {…} }\`. To find the fractions, open .vitrin/raw/<locale>/iphone/<id>.png and measure the region.
- testimonial: only verbatim text of real reviews from competitors.json → self.reviews, in their own language (\`"quotes": { "tr": [{ "text": "…", "rating": 5 }] }\`).
- Every shot has a headline, an (optional) subheadline, a screen and 0–3 badges. \`featureIds\` is required.
- Badge types: feature (featureId required), new (featureId required), proof (only a real rating from Lookup or a documented award), platform (ipad / apple-watch / iphone-duo / widgets — only if actually supported). No price badges. Style: pill | sticker | laurel (laurel for proof only).
\`\`\`json
{ "shots": [{ "id": "01", "slug": "hero", "archetype": "hero", "screens": ["home"], "featureIds": ["…"],
    "copy": { "en-US": { "kicker": "…", "headline": "… *accent*", "subheadline": "…" }, "tr": { "kicker": "…", "headline": "… *vurgu*", "subheadline": "…" } },
    "badges": [{ "type": "feature", "icon": "cloud", "featureId": "icloud-sync", "label": { "en-US": "iCloud sync", "tr": "iCloud senkron" } }] }],
  "creatives": { "header": { "copy": {…}, "screens": ["home","stats"], "featureIds": ["…"] },
                 "search": { "copy": {…}, "screens": ["home"], "featureIds": ["…"] }, "events": [] } }
\`\`\`
For the \`stat\` archetype: \`"stat": { "value": "42 days", "featureId": "…" }\` — the value must be backed by evidence (demo data is not a marketing claim; prefer a general statement).

When done: \`vitrin design\`.
`,
  );
}

export async function videoBrief(ctx: Ctx): Promise<string> {
  const recs = ctx.config.capture.recordings.map((r) => r.id);
  return writeBrief(
    ctx,
    'video',
    `# Brief: video plan

Write \`.vitrin/video-plan.json\` (details: skills/vitrin/references/video.md). App Preview: 886×1920, 30 fps, 15–30 s (target 20–25).
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
