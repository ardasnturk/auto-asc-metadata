# Bento Keynote Grid (`bento-keynote-grid`)

> Condensed from the "15 Bento Keynote Grid" spec in [app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) by Parth Jadhav (MIT) — see [README](README.md#credits-and-licence).

Apple keynote bento: flat #F5F5F7, rounded tiles on a grid, the phone rising out of a stage tile that crops it, one brand tile, one gradient phrase.

```json
{ "preset": "bento-keynote-grid", "brand": { "primary": "#…", "secondary": "#…" } }
```

## Palette (as rendered)

| Token | Value |
|---|---|
| Ground | `#F5F5F7` flat; tiles white / warm tint / night `#1D1D1F` |
| Ink | `#1D1D1F`, captions `#5E5E63` |
| Brand tile | `#B4441C` (brand color), white type |
| Emphasis | gradient `#C43A0E` → `#D0224A` → `#B5179E`, brand-tinted, every stop ≥ 4.5:1 |

## Typography

Inter Tight 700, ~0.108 × width, tracking −0.035em, left aligned; body Inter.

## Headline emphasis

One gradient phrase.

## Background and decoration

Flat ground, no grain. The stage tile (tint or night, alternating) grows into the space under the caption and crops the device at its edge; badges and the stat become small tiles under the headline; the feature wall becomes a numbered tile grid. Density: tiles only, no floating decoration.

## Device and framing

Black frame, faint shadow inside the tile, upright. Rhythm: bleed-bottom → bleed-bottom (offset in tile) → two-devices.

## Copy tone

Keynote captions: "*10 h* sleep-ready.", "Scan a bag. Bedtime aware."

## Avoid

Floating cards, more than one brand tile, crops through a UI row.
