# Color Block Sequence (`color-block-sequence`)

> Vitrin's own preset, distilled from the store-gallery sets where every screenshot has its own saturated color (language, learning, social and note apps).

Every screenshot a different flat color — blue, coral, green, amber, violet — with black or white type, whichever reads better, a rounded heavy sans and the emphasis word in an inverse box (type-colored plate, background-colored letters). A big circle a shade off the background sits behind the device.

```json
{ "preset": "color-block-sequence" }
```

Your own colors instead of the preset's five: `"cycle": ["#4B3BD6", "#E2557A", "#0E7C66"]` on the option (2–6 colors, in order; this works on any preset).

## Palette (as rendered)

| Slide | Background | Type | Emphasis box |
|---|---|---|---|
| 1 | `#3D5AFE` | white | white with `#2F47D9` letters |
| 2 | `#FF6A3D` | `#1A1410` | ink with coral letters |
| 3 | `#0B7A5E` | white | white with green letters |
| 4 | `#FFC23D` | `#1A1410` | ink with amber letters |
| 5 | `#7B3FE4` | white | white with violet letters |

## Typography

Rubik 800, ~0.13 × width, leading 1.02, centred. Body DM Sans.

## Headline emphasis

`box` (inverse plate). With `"emphasis": "color"` the phrase takes a highlight picked from the other colors of the cycle that clears 4.5:1.

## Background and decoration

Flat color. Behind the device one large circle (type color at 12 %) and a thin ring, both kept below the device's top edge so the caption never sits on them. Slides without a device get a circle and a ring in the bottom corners. The cross-canvas moment is a translucent white disc on the seam.

## Device and framing

Black frame, soft shadow, upright. Rhythm: bleed-bottom → offset → bleed-bottom → two-devices → bleed-top.

## Copy tone

Friendly and direct, sentence case: "Learn 40 languages free", "Never miss a moment". One idea per color.

## Avoid

Gradients, stickers and a second decoration style. Two neighbours in the same color (the cycle prevents it; keep `inverted` off unless you want the coral slide).
