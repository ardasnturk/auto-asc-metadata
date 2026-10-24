# Art direction

There is no fixed template. From `app_profile.brand` and the competitor visual analysis (`competitors.analysis.paletteUsage`, `screenshotHeadlineTerms`), propose **2–3 directions** and pick the one that differs most from competitors. Write the rationale to `selectionReason`.

## Parts of a direction

- **Palette:** `background` (1–4 colors; gradient/mesh stops), `surface`, `primary`, `accent`, `text`, `textMuted`, `badgeBackground`, `badgeText`. Text must reach ≥ 3:1 against every background stop (validate measures it). Keep the brand color, but move away from the dominant competitor hue.
- **Typography:** embedded OFL families only — Inter, Manrope, Space Grotesk, Plus Jakarta Sans, DM Sans, Fraunces, Playfair Display, Noto Sans. Noto fallbacks for CJK, Arabic, Hebrew and Indic scripts are automatic; `dir=rtl` is automatic for RTL languages.
- **Background:** solid, linear, radial, mesh, grid, dots, panoramic (a continuous strip across consecutive screenshots). `intensity` 0–1.
- **Device:** `frame` none/minimal/realistic (no Apple product imagery; CSS frame), `shadow`, `tilt` (−12…12).

## Set strategy (start here)

Sources: the AppScreenshotStudio 2026 guide, the MobileAction 2026 guide, Apple's Screenshot specifications; example gallery: screensdesign.com.

- **The first 3 screenshots are the story** — most users never look past the third and spend 3–6 seconds on the first impression:
  1. **Hook** — the outcome/benefit ("One tap a day"), not a feature name.
  2. **Proof** — the core action, with the real UI.
  3. **Trust / payoff** — the result, a streak, the real rating, or the second strongest benefit.
  4–10. For people who dig deeper: one screenshot = one idea.
- **Consistency:** one art direction, one accent color + neutrals, one headline typeface, similar headline lengths, similar device positions, one background language. Keep the caption position (top/bottom) fixed across the set; validate reports an info message if it is mixed.
- **Real-UI ratio:** at least 60% of screenshots show real UI (statement/testimonial lower the ratio). At least one of the first 3 screenshots must show UI.
- **Dark background + one bright accent** stands out in 2026; if competitors use light pastels, a dark background differentiates. It must read well in both the light and dark App Store themes.
- **5–7 good screenshots** are enough for most apps; 3–5 separate screenshots for iPad (iPhone screenshots are not copied to iPad — Vitrin renders iPad from iPad captures).
- **Avoid:** opening with a sign-in/login screen, mockups of things the app does not have, feature dumps, "two phones + a paragraph", calls to action ("Download now"), other platform names (Android, Google Play), prices/discounts, unsupported awards/rankings.

## Headline

- **At most 5 words recommended** (7 is the hard limit), **at most 2 lines**, understandable in 2 seconds. A bold, not thin, typeface; high contrast.
- Write the **outcome**, not the feature: not "Calorie tracking" but something like "Lose weight without counting" — and only outcomes backed by evidence.
- Two-tier headline: `kicker` is a small line on top ("Habit tracking", "Measure"), `headline` is the large main message. Kicker ≤ 3 words; putting the primary keyword into the kicker also helps ASO.
- Emphasis: writing `*word*` in a headline draws that word in the accent color ("Keep your *streak*"). One emphasis per headline is enough.

## Archetypes

| Archetype | When | Screens | Note |
| --- | --- | --- | --- |
| hero | First screenshot; main promise + main screen, large | 1 | Safest choice for the hook |
| feature | A single feature; badges float at the device edge | 1 | |
| callout | Magnify a piece of the UI and let it break out of the screen (card, chart, heat map) | 1 | `callouts[].rect` as fractions (0–1) of the capture; if the iPad layout differs, provide `rects.ipad`, otherwise no excerpt is drawn on iPad |
| fullbleed | When the UI itself is the visual (calculator, chart, map) | 1 | Frameless, edge to edge; the top of the UI always stays visible |
| tilted | Dynamic, energetic feel (games, music, sports) | 1 | A large device rotates −12° and bleeds off the edge; badges float |
| split | Compare two screens / a flow | 2 | |
| collage | Versatility | 3 | |
| before-after | Transformation; left faded, right vivid, arrow | 2 | |
| stat | Big number + headline | 1 | `stat.value` must be evidence-backed and general |
| social-proof | Real rating/award, large | 1 | Only the real rating from Lookup |
| panoramic | The device bleeds off the right edge; use with a panoramic background | 1 | |
| statement | Brand/statement slide: icon + large headline + badges | 0 | Not UI; at the end of the set or (with real evidence) at the start |
| testimonial | Real App Store reviews | 0 | `quotes[locale]` is the review's **verbatim** text **in its own language**; validate compares it with competitors.json → self.reviews. Translated or invented reviews are errors |

`captionPosition: "bottom"` moves the caption to the bottom; the device bleeds off the top (in fullbleed the top of the UI stays visible). Bottom captions work well when the top part of the UI is the most meaningful.

## Badges

| Kind | Rule | Example |
| --- | --- | --- |
| feature | `featureId` required | "iCloud sync" (cloud), "Offline" (wifi-off), "No ads" (ban) |
| new | `featureId` required; only for features shipped in this version | "New" (sparkles) |
| proof | `proof.kind: rating` with the **real** value and count from Lookup; `award` with a documented URL | "4.8 · 12K ratings" |
| platform | Only if actually supported: ipad, apple-watch, iphone-duo, widgets, mac, vision | "Also on iPad" (tablet) |

Badge styles (`style`): `pill` (default chip), `sticker` (accent color, slightly rotated, bold — "New in 1.2"), `laurel` (a large value between two laurel branches — **proof badges only**; anywhere else it is an error because it implies an award).

No price badges. Apple marks (Apple Health, iCloud, Apple Watch) only with a real integration. Icons are Lucide names (https://lucide.dev/icons); SF Symbols are not used. At most 3 badges per screenshot; 1–2 on the first one.

## Quality checks (the CLI measures; you look too)

- No text overflow/clipping (the fitter shrinks text; if it still overflows at the minimum size, it is an error).
- On the 6.9" screenshot, headline ≥ 96 px.
- Safe area: text and badges at least 3.5% inside the edges.
- The first 3 screenshots are legible at 25% size (`.vitrin/cache/thumbs`).
- After rendering, open at least 2 PNGs and check them visually; do not skip iPad and Duo.

## Creatives

- Header 21:9 and search 3:2: text column on the left, 1–3 devices on the right. They appear small in search: short, large headline.
- In-App Event: separate `copy` for the 16:9 card and the 9:16 detail.
