# Clean Studio Light (`clean-studio-light`)

> Vitrin's own preset, distilled from the look most top-grossing apps share in the store galleries: a light product-shot sweep, one brand color and a headline that leads.

A product shot on a seamless sweep: near-white canvas, a dark phone with a soft white halo behind it, a big flush-left headline with one word in the brand color and the kicker set as a small category tag above it.

```json
{ "preset": "clean-studio-light", "brand": { "primary": "#…" } }
```

## Palette (as rendered)

| Token | Value |
|---|---|
| Sweep | `#F7F8FA` → `#ECEEF3`, ink `#101218` |
| Accent | `#2D5BFF` (replaced by the brand, darkened until it clears 4.6:1 on the sweep) |
| Inverted slide | solid accent `#2D5BFF` with white type; its emphasis is a white box with accent type |
| Muted | `#525868` |

## Typography

Plus Jakarta Sans 800, ~0.122 × width, leading 1.0, tracking −0.035em, flush left. Body and tag Inter.

## Headline emphasis

The phrase in the accent color. On the inverted slide: a white box behind the phrase.

## Background and decoration

A vertical sweep with a soft white light at the top; behind the device a near-white halo. Slides without a device get two soft tinted spheres (a corner and the bottom). The kicker becomes a tag chip (`kicker: "tag"` is built in). Density: minimal.

## Device and framing

Black frame, soft shadow, upright. Rhythm: bleed-bottom → offset → bleed-bottom → two-devices → offset. Avoid `bleed-top` with a caption under the device: on a light sweep the device's shadow falls on the type.

## Copy tone

Plain and confident, a benefit in four or five words: "Watch your money grow", "Plan your week in minutes". The tag names the feature area ("Budgets", "Widgets").

## Avoid

More than one accent color, decorative stickers, tilted phones. Use 1–2 `inverted` slides for rhythm, usually the hero or the closer.
