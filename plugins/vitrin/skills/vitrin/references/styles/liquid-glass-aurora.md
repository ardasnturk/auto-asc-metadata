# Liquid Glass Aurora (`liquid-glass-aurora`)

> Condensed from the "07 Liquid Glass Aurora" spec in [app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) by Parth Jadhav (MIT) — see [README](README.md#credits-and-licence).

Premium, calm, "Apple made it": a pale aurora of lavender, ice blue, blush and apricot; upright phones; frosted glass chips; near-black grotesk with one deep-gradient word.

```json
{ "preset": "liquid-glass-aurora", "brand": { "primary": "#…", "secondary": "#…" } }
```

## Palette (as rendered)

| Token | Value |
|---|---|
| Base | `#EFE9FD` → `#E6EEFC` → `#F7ECF3` → `#FDEBDF` (4 stops, real hue shift) |
| Blooms | `#CDBBFF` `#AFD5FF` `#FFCDB2` `#FFC4D6`, blur ≈ 0.1 × canvas, plus a white halo behind the headline |
| Headline | ink `#16131F` |
| Sub | `#4A4660` |
| Emphasis | gradient `#1D46B8` → `#4A2FC0` → `#9A2250` (deep stops, never pastel) — brand-tinted stops are darkened to ≥ 4.6:1 |

## Typography

Inter Tight 700 (substitute for the spec's Inter Tight/SF Pro), ~0.122 × width, tracking −0.032em, leading 0.98. Centred on hero/closer, left on offset slides.

## Headline emphasis

Exactly one aurora-gradient word, same weight and size.

## Background and decoration

Aurora mesh + halo + 3.5 % grain. No vignette, no doodles. Badges become liquid-glass pills (translucent white, backdrop blur, specular rim, violet shadow). Density: editorial (2–4 glass elements).

## Device and framing

Titanium frame, upright 0°, violet-tinted shadow; a sky bloom behind dark screenshots. Rhythm: bleed-bottom → offset → offset → bleed-bottom → two-devices.

## Copy tone

Calm, confident, two short declaratives, periods: "Every bag. At its *peak*.", "Your day, *quietly* planned." Avoid "revolutionary", "unlock", exclamation marks.

## Avoid

Tilt, dark backgrounds, pastel gradient text, more than four glass elements.
