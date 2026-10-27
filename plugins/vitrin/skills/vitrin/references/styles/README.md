# Style presets

Each preset is a complete look — palette, type pairing, background recipe, decoration recipe, device treatment and copy tone — that Vitrin renders from HTML. Set it in `art-direction.json` → `options[].preset`; the app's brand colors tint it (`options[].brand`, or app_profile.brand). Read [`../art-direction.md`](../art-direction.md) first: its iron rules and quality bar apply to every preset.

Use `vitrin design --samples` to show the user several presets side by side before writing the full shot list. Presets are starting points: sample at least one bespoke direction made for the app next to them ([`../custom-designs.md`](../custom-designs.md)).

| Preset | Spec | Feel | Surface | Tilt | Use for |
|---|---|---|---|---|---|
| `vitrin-classic` | [vitrin-classic.md](vitrin-classic.md) | confident, colorful night | dark mesh | ±8° on tilted shots | Anything; Vitrin's original look, and the default for old art directions |
| `liquid-glass-aurora` | [liquid-glass-aurora.md](liquid-glass-aurora.md) | premium, calm, native iOS | pastel aurora | upright | AI assistants, premium utilities, health |
| `swiss-grid-bold` | [swiss-grid-bold.md](swiss-grid-bold.md) | blunt, numeric, exact | paper ↔ ink | upright, hard crop | Finance, analytics, dev tools, B2B |
| `midnight-glow-pro` | [midnight-glow-pro.md](midnight-glow-pro.md) | fast, crafted, pro | near-black + beam | upright | AI/dev tools, pro productivity, crypto |
| `soft-clay-wellness` | [soft-clay-wellness.md](soft-clay-wellness.md) | slow, earthy, tactile | oat / sage / dusk | upright | Meditation, sleep, journaling, habits |
| `quiet-japandi` | [quiet-japandi.md](quiet-japandi.md) | calm, crafted, minimal | washi paper | upright, on a shelf | Notes, calendars, reading, tea, minimalist tools |
| `bento-keynote-grid` | [bento-keynote-grid.md](bento-keynote-grid.md) | keynote, feature-dense | #F5F5F7 + tiles | upright, cropped by a tile | Feature-dense utilities, dashboards |
| `magazine-cover-editorial` | [magazine-cover-editorial.md](magazine-cover-editorial.md) | editorial, considered | paper + spot color | upright | Food, coffee, reading, travel, lifestyle |
| `candy-pop-social` | [candy-pop-social.md](candy-pop-social.md) | loud, playful, social | flat saturated, cycling | 4–10° | Social, events, messaging, gen-Z, games |
| `neon-athletic-night` | [neon-athletic-night.md](neon-athletic-night.md) | performance, night run | near-black + volt | 6–12° | Fitness, running, sports, recovery |
| `paper-sticker-skeuomorphic` | [paper-sticker-skeuomorphic.md](paper-sticker-skeuomorphic.md) | scrapbook, friendly | construction paper, cycling | ±3° | Students, notes, hobbies, kids-adjacent |
| `hand-drawn-editorial` | [hand-drawn-editorial.md](hand-drawn-editorial.md) | designer taste, doodles | navy / purple / cream / coral | 10–12° | Productivity, tasks, notes |
| `clean-studio-light` | [clean-studio-light.md](clean-studio-light.md) | clean, product shot | near-white sweep ↔ accent | upright | Finance, productivity, utilities, shopping, health — the safe light default |
| `bold-poster-type` | [bold-poster-type.md](bold-poster-type.md) | loud, graphic, printed | ink / paper / signal, cycling | upright, hard crop | Habits, fitness, study, music, entertainment |
| `color-block-sequence` | [color-block-sequence.md](color-block-sequence.md) | friendly, colorful, clean | a new flat color per slide | upright | Education, languages, social, food |
| `noir-gold-luxe` | [noir-gold-luxe.md](noir-gold-luxe.md) | premium, calm, gilded | black lacquer ↔ cream | upright | Premium subscriptions, reading, finance, lifestyle |

## Picking by category

| Category | First pick | Also try |
|---|---|---|
| Productivity, tasks, notes | hand-drawn-editorial | clean-studio-light, liquid-glass-aurora, quiet-japandi, bento-keynote-grid |
| Finance, analytics, business | swiss-grid-bold | clean-studio-light, bento-keynote-grid, midnight-glow-pro, noir-gold-luxe |
| Developer tools, AI, pro apps | midnight-glow-pro | swiss-grid-bold, liquid-glass-aurora |
| Utilities, dashboards, smart home | bento-keynote-grid | clean-studio-light, liquid-glass-aurora |
| Health & fitness, sports, habits | neon-athletic-night | bold-poster-type, soft-clay-wellness, swiss-grid-bold |
| Meditation, sleep, wellness | soft-clay-wellness | quiet-japandi, liquid-glass-aurora |
| Food, reading, lifestyle, travel | magazine-cover-editorial | noir-gold-luxe, quiet-japandi, color-block-sequence |
| Shopping, premium memberships | clean-studio-light | noir-gold-luxe, color-block-sequence |
| Social, music, entertainment | candy-pop-social | bold-poster-type, color-block-sequence, paper-sticker-skeuomorphic |
| Education, languages, students | color-block-sequence | paper-sticker-skeuomorphic, candy-pop-social, bento-keynote-grid |

Then check competitors: if their first screenshots are light pastels, a dark preset stands out (and vice versa).

## What Vitrin does for you (and what you still decide)

The renderer applies the preset's palette (contrast-checked), fonts, emphasis treatment, background, decorations, device finish, shadows and framing rhythm; it fits the type and measures the quality bar. You decide the copy (in the preset's tone), the one emphasis word, the archetypes and screens, which shots are `inverted`, and where the one `bridge` goes.

Presets also combine. On any option: `"emphasis"` picks another treatment for the emphasised phrase (`color`, `gradient`, `block`, `box`, `pill`, `italic`, `script`, `kenten`, `underline`, `outline`), `"kicker": "tag"` sets the kicker as a category chip, and `"cycle": ["#…", "#…", …]` gives every screenshot the next of 2–6 background colors with black or white type. `"preset": "midnight-glow-pro", "emphasis": "box"` or `"preset": "clean-studio-light", "cycle": [brand colors]` are directions of their own; sample them next to the plain presets. [`../art-direction.md`](../art-direction.md#pattern-library) maps what top apps do to these settings.

## Credits and licence

`clean-studio-light`, `bold-poster-type`, `color-block-sequence` and `noir-gold-luxe` are Vitrin's own: they distil looks that recur across the store galleries of popular apps; no app's screenshots or assets were copied.

The other presets and their specs are condensed from the named deep-spec styles in **[app-store-screenshots](https://github.com/ParthJadhav/app-store-screenshots) by Parth Jadhav**, adapted to Vitrin's HTML templates (fonts are substituted with the OFL families Vitrin bundles; frames are Vitrin's own CSS devices). The original material is used under the MIT licence:

```
MIT License

Copyright (c) 2026 Parth Jadhav

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
