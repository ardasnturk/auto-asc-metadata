# Swiss Grid Bold (`swiss-grid-bold`)

> Condensed from the "08 Swiss Grid Bold" spec in [app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) by Parth Jadhav (MIT) — see [README](README.md#credits-and-licence).

Müller-Brockmann on a phone: paper and ink slides, a visible 12-column hairline grid, giant flush-left grotesk, hard-cropped upright phones and exactly one international-orange signal.

```json
{ "preset": "swiss-grid-bold", "brand": { "primary": "#…", "secondary": "#…" } }
```

## Palette (as rendered)

| Token | Value |
|---|---|
| Paper | `#F2F1EC` with ink `#0E0E0C` (17:1) |
| Ink slide | `#0E0E0C` with paper type |
| Signal | `#FF4F00` — on paper only as a block with ink type (5.9:1), on ink as the emphasis word |
| Labels | grey `#5E5D57` / `#A3A29B` |

## Typography

Inter Tight 800, ~0.13 × width, leading 0.9, tracking −0.045em, flush left. Labels JetBrains Mono uppercase.

## Headline emphasis

On paper: the phrase sits on a solid orange block. On ink: the phrase is orange.

## Background and decoration

Flat single hex (no gradient, no grain), 13 grid hairlines, index row on top (`APP · KICKER · 01 / 06` with a 3 px rule). Badges are mono labels in a ruled box. Density: minimal — no floating decorations.

## Device and framing

Black frame, crisp contact shadow, upright. Hard crop is the signature: bottom bleed ~10 %, or side bleed on offset slides. Rhythm: bleed-bottom → bleed-top → offset …; surfaces alternate paper ↔ ink.

## Copy tone

Blunt, numeric, two beats: "Fresh beans. Tracked to the day.", "Every pound. Accounted for." Digits, not words.

## Avoid

A second accent color, rounded chips, sparkles, centred headlines. The brand replaces orange only if ink type reads on it at 4.5:1.
