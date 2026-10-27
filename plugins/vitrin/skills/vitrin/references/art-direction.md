# Art direction

**Screenshots are advertisements, not documentation.** Every screenshot sells one idea — a feeling, an outcome or a killed pain — and the UI inside the device is the proof. Vitrin renders everything from HTML (Playwright) with a named **style preset**; you pick the preset, write the copy and the shot list, and vary the framing. The method below is adapted from [ParthJadhav/app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) (MIT); the preset specs are in [`styles/`](styles/README.md).

## Workflow

1. Write the first three shots of `shots.json` (what the search result shows: real copy, real screens).
2. Design for this app: at least one bespoke art direction in `art-direction.json` (own palette, type, background, device; see [custom-designs.md](custom-designs.md)), and a bespoke `template` layout for any shot whose story no archetype tells.
3. Run `vitrin design --samples --styles <preset>,<preset>,<bespoke-id>,…` (default 4 suggested presets, `--count N`). It renders those shots per design into `metadata/design-samples/<id>/`, a **contact sheet** labelled A/B/C/D and **`store-preview.html`** with store, design and light/dark menus (App Store iPhone, iPad and Google Play when enabled; `--json` prints the paths).
4. Open the store preview for the user, show `store-preview.png` in the chat and ask which design they want (A/B/C/D). Do not pick for them.
5. Write `art-direction.json` with the chosen design (`selected`), then the full `shots.json`, then `vitrin design`.
6. Open the rendered PNGs yourself (at least the first three iPhone shots, one iPad, one Android if present) and read `metadata/validation.json` — the quality gate below measures every image.

## art-direction.json

```json
{ "options": [{ "id": "glass", "name": "Liquid Glass Aurora", "rationale": "…", "differentiation": "…",
    "preset": "liquid-glass-aurora",
    "brand": { "primary": "#5B4BE8", "secondary": "#FF6B5E", "strength": 0.35 } }],
  "selected": "glass", "selectionReason": "…" }
```

- **`preset`** supplies palette, type pairing (bundled OFL fonts), background recipe, decoration recipe and device treatment. Pick it from [`styles/README.md`](styles/README.md) by category and by what stands apart from the competitors (`competitors.analysis.paletteUsage`).
- **`brand`** tints the preset with the app's colors (app_profile.brand): the emphasis takes the brand hue, darkened or lightened until it clears WCAG AA on that background; `strength` (0–1) rotates the background hues of "full"-tint presets toward the brand. Without `brand`, the profile's brand colors are used. One-accent presets (Swiss, Neon) only swap their signal color if the brand passes the same contrast pairs.
- Optional overrides: `palette`, `typography`, `background`, `device` (the pre-preset fields). An explicit `palette` is used as is. Old files without `preset` still work: they render with their own palette and background style on the `vitrin-classic` composition.
- **Combining presets:** `emphasis` picks another treatment for the emphasised phrase (`color`, `gradient`, `block`, `box`, `pill`, `italic`, `script`, `kenten`, `underline`, `outline`); `kicker: "tag"` sets the kicker as an accent chip above the headline (a category label); `cycle: ["#…", "#…", …]` gives each screenshot the next of 2–6 background colors with black or white type (an inverse box for `box` emphasis). Any preset takes them, so `{ "preset": "neon-athletic-night", "emphasis": "outline" }` is a direction of its own.

## Iron rules (copy)

1. **One idea per headline.** Never join two things with "and".
2. **Short, common words.** 3–5 words per line, at most 2 lines (3 for the big condensed presets). Five words or fewer recommended, seven is the hard limit.
3. **Line breaks are intentional:** `\n` in a headline is a visible break. Hand-break for rhythm; avoid a fat line over a one-word widow.
4. **Mixed emphasis:** wrap exactly one word or short phrase in `*asterisks*`. The preset draws it (gradient, signal block, pill, italic, script, kenten dots, highlighter) — never two.
5. Three approaches, offer the user three options per slide: **paint a moment** ("Check in before the coffee's done"), **state an outcome** ("Your week, quietly planned"), **kill a pain** ("Never lose a streak again"). Then rewrite the chosen one in the preset's copy tone (`styles/<preset>.md`).
6. Outcomes must be backed by evidence (`featureIds`). No calls to action, prices, other platform names or unproven awards.

## Narrative arc

| Slot | Purpose |
|---|---|
| 1 | **Hero / main benefit** — the only slide most people see. Proof (rating, award) lives here and nowhere else. |
| 2 | **Differentiator** — why this app and not the others. |
| 3 | **Ecosystem or core feature** — widgets, watch, iPad (skip if not real). |
| 4+ | **Core features**, one per slide, most important first. |
| 2nd-to-last | **Trust** — "made for people who…", real reviews (`testimonial`). |
| Last | **Closer** — `feature-wall` (big one-line features, `wall: [{ "en-US": "Widgets" }, …]`) or `mosaic` (three real screens). Never another single-feature hero. |

## Layout variation (framing)

`framing` per shot: `auto` (default), `bleed-bottom`, `bleed-top`, `offset`, `tilted`, `two-devices`, `no-device`, `contained`.

- `auto` follows the archetype and the preset's rhythm and **never repeats the previous shot's framing**. Hero is always `bleed-bottom`.
- The device is **anchored to an edge** (bleeding off the bottom, off the top under a bottom caption, or standing on a shelf) and covers **68–82 % of the canvas height**. Never a centred phone with empty bands above and below.
- Mix at least two framings across the set; every 2–3 slides break the phone parade (`two-devices`, `mosaic`, `feature-wall`, `statement`).
- Upright presets (Liquid Glass, Swiss, Midnight, Japandi, Bento, Magazine, Studio, Poster, Color Block, Noir Gold) never tilt; tilted presets alternate direction. iPhone Duo is always straight on.
- `inverted: true` switches to the preset's contrast surface (Swiss ink, Clay dusk, Neon volt, Studio accent, Noir cream). Use 1–2 per set; cycling presets (Candy, Paper, Hand-Drawn, Poster, Color Block, any `cycle`) change surface on every slide by themselves.
- Watch, Apple TV, Mac and Vision Pro frames are always **contained** (a cropped TV reads as a mistake); their slides alternate caption-left and caption-top.

## Archetypes

| Archetype | Use | Screens |
|---|---|---|
| hero | Slide 1: main benefit, large device | 1 |
| feature | One feature; badges float at the device edge | 1 |
| callout | A magnified piece of the UI breaks out of the screen (`callouts[].rect` fractions of the capture; `rects.ipad` for iPad) | 1 |
| fullbleed | Frameless UI when the UI is the visual | 1 |
| tilted | Energy: large tilted device (tilted presets) | 1 |
| split / before-after | Two devices layered (back up-left, front down-right) | 2 |
| collage | Three devices | 3 |
| stat | Big evidence-backed number + headline (`stat`) | 1 |
| social-proof | The real rating from Lookup, large | 1 |
| panoramic | Large tilted device that continues into the next screenshot (with `bridge`) | 1 |
| statement | Icon + big claim + badges (no UI) | 0 |
| testimonial | Verbatim App Store reviews (no UI) | 0 |
| feature-wall | Closer: wall of one-line features (`wall`) | 0 |
| mosaic | Closer: three real screens as frameless tiles | 2–3 |

At least 60 % of shots show real UI and one of the first three must.

## Shot extras

| Field | What it draws | Rules |
|---|---|---|
| `bullets` + `bulletStyle` | Up to four short benefit lines. `check` (default): a ticked list; next to a device it floats as one card over the device's side edge (the caption keeps its room, the device its height); on slides without a device it sits under the caption. `chips`: a wrapped row of small chips under the caption. | Every line is a real feature in `featureIds`, ≤ 32 characters, localized. With three chips drop the subheadline. Validated like headlines (no prices, CTAs, other platforms). |
| `brandMark: true` | The app icon and name above the kicker — the lockup a hero or a closer opens with. | Once or twice per set. |
| `photo: "hero.jpg"` | A photo from `metadata/photos/` full-bleed behind the shot, under a scrim in the slide's tone where the caption sits. With a device the phone stands in that scene; on a `statement` it is a lifestyle slide with the line set low. The preset's props stay out of photo slides. | **Only a photo the developer gave you** (ask; never generate, download or use stock). They must own the rights, with a model release for any recognisable person. A photo `statement` is not real UI. |

## Pattern library

What the store galleries of popular apps do, and how to get it in Vitrin. Use it to propose directions, not to copy any app.

| Pattern seen | Vitrin |
|---|---|
| Light canvas, dark phone, big flush-left headline with one colored word, category tag above | `clean-studio-light` (or any preset + `kicker: "tag"`) |
| Giant condensed caps, words in solid boxes, dark / cream / signal slides in turn | `bold-poster-type`; `emphasis: "box"` on another preset |
| Every screenshot its own saturated color | `color-block-sequence`, or `cycle` with the brand's colors |
| Black and gold, serif, laurels | `noir-gold-luxe` + a verified `proof` badge with `style: "laurel"` |
| Phrase in a white pill/box on a colored slide ("Learn *40 plus* languages") | `emphasis: "box"` |
| Hollow outlined word in a heavy headline | `emphasis: "outline"` (heavy or condensed faces only) |
| Hero with a ticked list of benefits | `bullets` (check) on the hero |
| Chips listing what the app covers ("Budgets · Bills · Goals") | `bullets` + `bulletStyle: "chips"` |
| UI card popping out of the phone | `callout` archetype |
| Phone crossing from one screenshot into the next | `panoramic` + `bridge` |
| Lifestyle photo first, phone later / phone in a real scene | `photo` (developer's own) on a `statement` or a device shot |
| Logo and app name at the top of the hero | `brandMark: true` |
| "#1", "1M+ users", rating laurels | `social-proof` / `proof` badge — only with Lookup data or a documented award |
| One-word headlines ("Block", "Switch", "Guard") | copy: one verb per shot, `bold-poster-type` or `swiss-grid-bold` |
| Caption under the phone on some slides | `captionPosition: "bottom"` (avoid on light presets: the device's shadow falls on the type) |
| Two or three phones fanned out | `collage` (3 screens) or `split` |
| Wall of feature names to close | `feature-wall` |

Not available, and why: hand-held phones and mascots need artwork the app does not have (give a bespoke `template` the developer's own asset if they supply one); press logos and "As seen in" rows need permission and proof; integration logos of other companies are trademarks.

## Cross-canvas moment

`"bridge": true` on a shot sends a decorative element (bloom, band, ribbon, comet, sticker trail) across the seam into the next screenshot. On a `panoramic` shot the device itself crosses: the next screenshot draws its other half beside its own device, so the pair reads as one continuous image in the store. In a 5+ shot set use **one**, at most two in 8–10. Text, ratings and key UI never cross; each PNG must still read on its own.

## Badges

| Kind | Rule |
|---|---|
| feature | `featureId` required ("iCloud sync", "Offline") |
| new | `featureId` required; only for this version |
| proof | Real rating from Lookup or a documented award — **first screenshot only** (`social-proof`/`testimonial` excepted) |
| platform | Only if actually supported |

Badges render in the preset's material (glass, dark glass, mono label, tile, sticker, paper). At most 2 on the hero, 3 elsewhere. Lucide icon names only.

## What Apple does not allow on screenshots and creatives

From Apple's asset best practices and the App Review Guidelines (validate enforces the checkable ones):

- No specific pricing or discounts (`shot.price`), website URLs (`shot.url`), copyright symbols (`shot.copyright`), logos or names of other platforms and marketplaces (`shot.other-platform`), calls to action (`shot.cta`).
- No Apple-designated recognitions — Editor's Choice, App of the Day, Game of the Day, Apple Design Award (`shot.apple-award`) — and no awards or claims that cannot be verified.
- Screenshots show the app in use, not only title art, a login page or a splash screen (2.3.3); text and image overlays are allowed. Text is a short phrase that enhances the visual rather than describes it, localized for every language.
- Everything must fit a 4+ age rating even if the app is rated higher (2.3.8); use fictional account data, never a real person's (2.3.9 — that is what demo mode is for). "For Kids" wording only in the Kids Category.
- Up to 10 screenshots per device size; up to three appear in search results depending on orientation. Keep focal points away from the edges of creatives so cropping never cuts them.

## Density

Dense inside the device, sparse outside: one headline, one optional sub-line, one optional badge row. Decorations follow the preset's density (minimal 0–2, editorial 2–5, maximal 8–14) and never touch the type.

## Quality bar (measured on every render)

`vitrin design` measures each image in the browser and `validate` reports:

| Code | Rule | Severity |
|---|---|---|
| `image.device-small` | Device < 65 % of canvas height (phones/tablets) — < 68 % warns | error / warning |
| `image.device-large` | Device > 90 % | warning |
| `image.empty-band` | Largest empty horizontal band > 22 % | warning |
| `image.word-width` | A headline word wider than 88 % of the canvas | error |
| `image.headline-contrast` | Headline vs the **worst pixel under its glyphs** (glyph mask, not the box average) < 4.5:1 — < 3:1 is an error | warning / error |
| `image.text-contrast` | Kicker/subheadline < 4.5:1 | warning |
| `image.layers` | More than background → device → headline + one accent | warning |
| `image.thumbnail` | Downscaled to 220 px (search result): headline < 11 px or glyph contrast < 3:1 | warning (first 3) / info |
| `image.overflow`, `image.safe-area`, `image.headline-small` | As before | error / warning |

Fix by shortening the headline, choosing another framing, or a preset whose surface suits the screenshots — never by hoping.

## Thumbnail test

Shrink the first three screenshots to ~220 px wide (`metadata/.cache/thumbs`). In one sentence you must be able to say: what style is this, what does the app do, why tap it. If not, the headline is too long or too thin.

## Store graphics

- **App Store creatives** (header 21:9, search 3:2): caption left, 1–3 devices right; short brand line, not a screenshot headline.
- **Google Play feature graphic** (1024×500): no device frame — app icon as the hero object, app name + one short line (taken from `creatives.header`, else the hero copy). **Play icon** (512×512): the app icon full-bleed (Google applies the mask).
- Android screenshots use the Android frames (punch-hole, flat edge) and Android captures; never Apple hardware or iOS UI on Google Play (`image.ios-ui-on-play`). App Store ratings and Apple platform badges are dropped from Play images automatically; ranking words (“#1”, “best”) and Apple names on a shot that reaches Play are errors (`shot.play-superlative`, `shot.play-apple-term`) — restrict App Store-only shots with `targets`.
- Every screenshot shows the UI in its own language: a fallback to the primary locale's capture is an error in the first three shots (`image.language-mismatch`).
