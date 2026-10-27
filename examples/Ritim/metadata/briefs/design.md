# Brief: style samples, art direction and shot list

Method: the /vitrin skill’s references/art-direction.md (iron rules, narrative arc, framing, quality bar) and references/styles/ (one spec per preset — read the one you pick).

## Input
- App: **Ritim** — category HEALTH_AND_FITNESS; audience: Düzenli rutin oluşturmak isteyen, sade ve reklamsız bir araç arayan iPhone/iPad kullanıcıları
- Brand colors (tint the preset): #5B4BE8, #FF6B5E, #F25F8C, #2BC79B, #FFFFFF
- Competitor palettes (most common): #FFFFFF×6, #202020×4, #FFE0E0×3, #FFE0A0×3, #C0E0A0×2, #60C0A0×2, #606040×2, #E0E0E0×2
- Competitor first-screenshot headlines (OCR, analysis only): ?
- Captured screens (capture.screens): home, home-7, home-done, stats, stats-more, detail, reminders, add
- Icons: Lucide names (e.g. cloud, chart-column, bell, lock, sparkles). Do not use SF Symbols.

## Step 1 — the first three shots, then samples (shots.json exists: check its first three shots)
Write `metadata/shots.json` with **only the first three shots** — what the App Store search result shows (real copy, real screens; see Step 3 for the format), with copy in **en-US only**. The samples use one language and one format (iphone-6.3), so capture just that first: `vitrin capture --locale en-US --family iphone`. Then run:

```
vitrin design --samples --json            # suggested for this app: neon-athletic-night, soft-clay-wellness, liquid-glass-aurora, midnight-glow-pro
vitrin design --samples --styles a,b,c,d  # or pick the presets yourself (2–8, --count N)
```

It renders those shots in each design (`metadata/design-samples/<id>/`), one contact sheet labelled A, B, C, D (`metadata/design-samples/contact-sheet.png`) and a store preview (`metadata/design-samples/store-preview.html` and `.png`) with menus for the **store** (App Store iPhone; iPad and Google Play when those formats are enabled), the **design** (A, B, C, D or all side by side) and light/dark **appearance**. Pick designs that differ clearly (light and dark, sans and serif, upright and tilted) and that stand apart from the competitor palettes above.

**Do not only pick presets.** At least one of the four should be designed for this app: write a bespoke option into `metadata/art-direction.json` (its own `palette`, `typography`, `background` and `device` taken from the app's brand, icon and subject — no `preset`, or a preset with overrides) and sample it by its id: `--styles neon-athletic-night,soft-clay-wellness,<your-option-id>,…`. For screenshots no preset can express (a hand-built collage, a story across two devices, a layout shaped by the app's own UI), give a shot a bespoke `template` (references/custom-designs.md): an HTML layout in `metadata/designs/` with the copy placeholders and `<vitrin-device>` mockups — it renders in every sampled design's colors and fonts.

## Step 2 — ask the user
Open the store preview for the user (`open metadata/design-samples/store-preview.html` on macOS), tell them they can switch the store and the design with the menus at the top, show `store-preview.png` in the chat too, and ask: **“Which design should the screenshots use — A, B, C or D?”** Wait for the answer; never choose for them, and change nothing until they answered. Then write `metadata/art-direction.json` (a bespoke choice keeps its own option; set `selected` to it):
```json
{ "options": [{ "id": "picked", "name": "…", "rationale": "why it fits the app", "differentiation": "why it stands apart from competitors",
    "preset": "liquid-glass-aurora", "brand": { "primary": "#5B4BE8", "secondary": "#FF6B5E" } }],
  "selected": "picked", "selectionReason": "The user chose B." }
```
Only now — after the user approved a design — ask how the listing should be uploaded (`vitrin uploader --json`: asc CLI or fastlane; if the chosen tool is missing, say it will be installed first and install it only after their yes), store it with `vitrin select --uploader asc|deliver`, then ask which store languages and which formats to produce (`vitrin platforms --json` → `locales`, `formats`) and store them with `vitrin select --locales … --targets …`. Only now capture and render the rest.

| Preset | Name | Surface | Device |
|---|---|---|---|
| `vitrin-classic` | Vitrin Classic | dark | tilted ±8° |
| `liquid-glass-aurora` | Liquid Glass Aurora | light | upright |
| `swiss-grid-bold` | Swiss Grid Bold | light | upright |
| `midnight-glow-pro` | Midnight Glow Pro | dark | upright |
| `soft-clay-wellness` | Soft Clay Wellness | light | tilted ±3° |
| `quiet-japandi` | Quiet Japandi | light | upright |
| `bento-keynote-grid` | Bento Keynote Grid | light | upright |
| `magazine-cover-editorial` | Magazine Cover Editorial | light | upright |
| `candy-pop-social` | Candy Pop Social | light | tilted ±7° |
| `neon-athletic-night` | Neon Athletic Night | dark | tilted ±8° |
| `paper-sticker-skeuomorphic` | Paper Sticker Skeuomorphic | light | tilted ±3° |
| `hand-drawn-editorial` | Hand-Drawn Editorial | dark | tilted ±12° |

## Step 3 — the full shot list
Copy for every chosen language (`app.locales`: en-US, tr); each locale is a local rewrite, not a word-for-word translation. 8–10 shots for iPhone when the features carry them (the first 3 sell in search; the rest convert people who open the page and scroll), at least 5; 3–5 are enough for iPad. Google Play shows at most 8 and needs at least 2, and the same shots are used there: keep App Store-only shots (ratings, testimonials, Apple platforms) out of Play with `targets`. Follow the narrative arc: 1 hero (main benefit; proof only here) → 2 differentiator → 3 ecosystem/core → features, one per shot → trust → closer (`feature-wall` or `mosaic`).
- **Headlines:** one idea, ≤ 5 words recommended (7 max), 3–5 words per line, ≤ 2 lines, `\n` for an intentional break, exactly one `*emphasis*`. Write them in the preset's copy tone (styles/<preset>.md). Reinforce the main keyword from the name/subtitle. `kicker` ≤ 3 words.
- **Panoramic pair:** `"archetype": "panoramic", "bridge": true` puts a large tilted phone on the right edge that continues into the next screenshot, which shows its other half next to its own device (the two read as one image in the store). Use it once, e.g. shots 2→3, and give the next shot a real screen of its own.
- **Framing varies:** leave `"framing": "auto"` (never repeats the previous shot) or set bleed-bottom / bleed-top / offset / tilted / two-devices / no-device yourself; mix at least two framings. 1–2 shots `"inverted": true` for rhythm (cycling presets change surface on their own). For 5+ shots set `"bridge": true` on one shot to carry a decorative element into the next (never text).
- **Archetypes:** hero, feature, callout, fullbleed, tilted, split, collage, before-after, stat, social-proof, panoramic, statement, testimonial, feature-wall, mosaic. At least 60 % real UI, one UI shot in the first 3.
- No calls to action (“Download now”), other platform names, prices or unproven awards. Badges: feature/new need `featureId`; proof only a real Lookup rating or documented award, on the hero; platform only if supported. Max 2 badges on the hero.
- callout: `"callouts": [{ "screen": 0, "rect": { "x": 0.04, "y": 0.47, "w": 0.92, "h": 0.3 }, "scale": 1.45, "side": "center", "at": 0.6 }]` — rect in fractions of the iPhone capture; add `"rects": { "ipad": {…} }` if the iPad layout differs.
- testimonial: only verbatim reviews from competitors.json → self.reviews, in their own language. stat: `"stat": { "value": "12 weeks", "featureId": "…" }`, backed by evidence. feature-wall: `"wall": [{ "en-US": "Widgets" }, …]`, every line a real feature listed in `featureIds`.
```json
{ "shots": [{ "id": "01", "slug": "hero", "archetype": "hero", "screens": ["home"], "featureIds": ["…"], "framing": "auto",
    "copy": { "en-US": { "kicker": "…", "headline": "Keep your *streak*", "subheadline": "…" } },
    "badges": [{ "type": "feature", "icon": "cloud", "featureId": "icloud-sync", "label": { "en-US": "iCloud sync" } }] },
  { "id": "06", "slug": "more", "archetype": "feature-wall", "screens": [], "featureIds": ["…"], "copy": { "en-US": { "headline": "And so much *more*" } }, "wall": [{ "en-US": "Widgets" }] }],
  "creatives": { "header": { "copy": {…}, "screens": ["home","stats"], "featureIds": ["…"] },
                 "search": { "copy": {…}, "screens": ["home"], "featureIds": ["…"] }, "events": [] } }
```
`creatives.header` also supplies the Google Play feature graphic line (short brand line, not a screenshot headline).
In-App Events (`creatives.events[]`): `name` ≤ 30, `shortDescription` ≤ 50, `longDescription` ≤ 120 characters per locale; a `deepLink` that opens the event; `schedule` `{ "territories": ["USA"], "publishStart", "eventStart", "eventEnd" }` (RFC 3339; 15 minutes to 31 days, promoted at most 14 days ahead); `purpose` (ATTRACT_NEW_USERS, KEEP_ACTIVE_USERS_INFORMED, BRING_BACK_LAPSED_USERS or APPROPRIATE_FOR_ALL_USERS). Show the event's outcome on the card, not a plain screenshot; Apple sets the event name over it.

## Step 4 — render and check
Run `vitrin design`. Open the first three iPhone PNGs, one iPad and one Android/Duo/Mac/Watch PNG if those targets are enabled, and read the quality issues in `metadata/validation.json` (`image.device-small`, `image.empty-band`, `image.headline-contrast`, `image.thumbnail` …). Fix copy or framing until the set passes the thumbnail test.
