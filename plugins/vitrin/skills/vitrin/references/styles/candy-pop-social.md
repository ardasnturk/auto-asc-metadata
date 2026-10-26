# Candy Pop Social (`candy-pop-social`)

> Condensed from the "11 Candy Pop Social" spec in [app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) by Parth Jadhav (MIT) — see [README](README.md#credits-and-licence).

Partiful energy: one flat saturated color per slide (pink → cobalt → lime → tangerine), chunky lowercase type with one word in a tilted pill, stickers with hard ink shadows, tilted phones.

```json
{ "preset": "candy-pop-social", "brand": { "primary": "#…", "secondary": "#…" } }
```

## Palette (as rendered)

| Token | Value |
|---|---|
| Slides | pink `#FF5FA8`, cobalt `#2B44F0`, lime `#C6F135`, tangerine `#FF7A1F` (cycle; never two adjacent alike) |
| Type | ink `#16121F` everywhere except white on cobalt |
| Pills | cobalt/white on pink, lime/ink on cobalt, pink/ink on lime, ink/lime on tangerine — kept per slide; the brand tints the emphasis only |

## Typography

Bricolage Grotesque 800 (opsz 96), ~0.158 × width, lowercase, leading 0.92, left aligned; body Rubik 700.

## Headline emphasis

One word in a full-radius pill: ink border, hard offset shadow, rotated −3°.

## Background and decoration

Flat color + 5 % grain. Stickers (sparkles, hearts, dots) with ink outlines and hard shadows around the phone, an app tag (icon + name) top-left; badges become sticker pills on the device. Density: maximal (8–14), never on the type.

## Device and framing

Black frame with a hard slab shadow in the slide's deep tone, tilted 7° alternating. Rhythm: tilted → tilted → two-devices → tilted → bleed-bottom.

## Copy tone

Lowercase, playful, social: "find your *people*", "plans in *2 taps*".

## Avoid

Gradients, soft blurry shadows on stickers, emoji in the headline, white text on lime/tangerine.
