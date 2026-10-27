# Bespoke designs for one app

The style presets are a starting point, not the menu. Every app gets at least one design made for it, and any shot can get a layout no archetype offers. Both render through the same pipeline as the presets: exact store sizes, no alpha, the quality gate (overflow, contrast, thumbnail, device size), the review gallery and the approval.

## 1. A bespoke art direction (own colors and type)

Add an option without `preset` (or with a preset plus overrides) to `metadata/art-direction.json`. Up to six options may live there; `selected` names the one the full set uses.

```json
{
  "options": [
    {
      "id": "ritim-sunrise",
      "name": "Ritim Sunrise",
      "rationale": "The app's coral/mint brand and its morning-routine story: warm paper, rounded type.",
      "differentiation": "Competitors are dark and neon; this is light, warm and calm.",
      "palette": { "background": ["#FFE7D1", "#FFC9A8"], "surface": "#FFFFFF", "primary": "#E8613C", "accent": "#2BB673",
                   "text": "#2A1406", "textMuted": "#5C3A28", "badgeBackground": "#2A1406", "badgeText": "#FFFFFF" },
      "typography": { "headline": "Fraunces", "body": "Inter", "headlineWeight": 700 },
      "background": { "style": "mesh", "angle": 160, "intensity": 0.6 },
      "device": { "frame": "realistic", "shadow": true, "tilt": -4 }
    }
  ],
  "selected": "ritim-sunrise",
  "selectionReason": "The user chose A."
}
```

Derive it from the app, not from taste: the asset catalog / theme colors, the app icon's palette, the subject (a finance app is not a candy shop), the audience in `app_profile.positioning`, and what the competitors do (stand apart). Text colors must clear WCAG AA on every background stop. Fonts must be bundled families (`vitrin design` lists them in its error if one is unknown).

Sample it next to presets: `vitrin design --samples --styles ritim-sunrise,swiss-grid-bold,midnight-glow-pro,soft-clay-wellness`. Bespoke options carry a ✦ in the store preview.

## 2. A bespoke layout for a shot (`template`)

When the story needs a composition the archetypes cannot draw — two devices in conversation, the app's own UI element blown up as the hero, a hand-built collage, a watch next to a phone — write the canvas yourself:

```json
{ "id": "02", "slug": "plan", "archetype": "feature", "template": "plan.html", "screens": ["today", "week"],
  "featureIds": ["weekly-plan"], "copy": { "en-US": { "headline": "Plan your *week*", "subheadline": "Drag habits onto days" } } }
```

`metadata/designs/plan.html` (and optionally `plan.ipad.html`, `plan.android-phone.html` … for another device family):

```html
<style>
  body { background: radial-gradient(120% 80% at 20% 0%, var(--bg2), var(--bg)); }
  .caption { position: absolute; left: 7%; right: 7%; top: 6%; }
  .headline { margin: 0; font: 800 64px/1.02 var(--headline); color: var(--text); letter-spacing: -0.02em; }
  .subheadline { margin: 14px 0 0; font: 500 26px/1.25 var(--body); color: var(--muted); }
</style>
<div class="caption">
  <h1 class="headline fit" data-min="44">{{headline}}</h1>
  <p class="subheadline fit" data-min="20">{{subheadline}}</p>
</div>
<vitrin-device screen="today" x="40" y="330" width="250" tilt="-5"></vitrin-device>
<vitrin-device screen="week" x="170" y="410" width="250" tilt="4" z="2"></vitrin-device>
```

The canvas is the format's logical size (iPhone 6.9": 440×956, iPad 13": 1032×1376, Google Play phone: 360×640, …; `{{width}}`/`{{height}}` and `--w`/`--h` hold it). Write positions for the main format and use `<name>.<family>.html` where another family needs its own composition.

### Placeholders
| Placeholder | Becomes |
|---|---|
| `{{headline}}`, `{{subheadline}}`, `{{kicker}}` | The shot's copy for the locale being rendered, as measured words; `*word*` gets the design's emphasis |
| `{{badges}}` | The shot's badges as chips |
| `{{appName}}`, `{{icon}}` | App name, app icon URL (`<img src="{{icon}}">`) |
| `{{bullets}}` | The shot's `bullets` as `<li>` items (wrap them in a `<ul class="bullets">`) |
| `{{photo}}` | URL of the shot's `photo` from metadata/photos/ (empty without one) |
| `{{width}}`, `{{height}}`, `{{index}}`, `{{total}}`, `{{locale}}` | Canvas size, position in the set, locale |

### `<vitrin-device>`
| Attribute | Meaning |
|---|---|
| `screen` | A screen id from the shot's `screens`, or its 0-based position |
| `x`, `y`, `width` | Position and outer device width in canvas px |
| `tilt` | Rotation in degrees |
| `family` | Another frame than the format's (e.g. `watch` next to an iPhone) |
| `variant` | `inner`/`outer` (iPhone Duo open/closed), `window`/`laptop` (Mac), `bare`/`bezel` (TV) |
| `finish` | `titanium`, `graphite`, `silver`, `black` |
| `frameless`, `noshadow`, `z` | Screen only with display corners; no drop shadow; stacking order |

The frames are the same mockups as `vitrin mockups` and the preset layouts.

### CSS variables (from the selected or sampled design)
`--bg`, `--bg2`, `--text`, `--muted`, `--accent`, `--emphasis`, `--chip-bg`, `--chip-text`, `--plate`, `--plate-text` (fill and ink of a boxed emphasis), `--headline`, `--body`. Using them makes one template work in every sampled design; hard-coded colors pin it to one look.

### Rules that still apply
- Put the copy in `.caption` → `.headline.fit` / `.subheadline.fit` / `.kicker` so the quality gate can measure overflow, contrast and the thumbnail; `data-min` is the smallest font size the auto-fit may shrink to.
- Phones and tablets: visible device height 68–82 % of the canvas; nothing important in the outer 3.5 % (safe area).
- Real UI only (rendered screens), real features only (`featureIds`), no prices, calls to action or other platforms' names.
- Everything local: no web fonts, images or scripts from the network.
- Check every bespoke render visually (open the PNG with Read) in at least two locales; long languages break layouts first.
