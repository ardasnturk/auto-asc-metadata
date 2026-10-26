# App Previews and creative videos

Vitrin renders videos with Remotion. You write `.vitrin/video-plan.json`; the CLI builds the scene list, fits it to 15–30 s, renders it and normalizes it to the App Store format (H.264 High@4.0, 30 fps, stereo AAC).

## Rules (Apple)

- 15–30 s, 30 fps, 886×1920 (iPhone, including Duo) / 1200×1600 (iPad) / 1920×1080 landscape (Mac: `device: "mac"`, target `preview-mac`; Apple TV: `device: "tv"`, target `preview-tv` — both off by default, enable them in `targets.enable`); at most 3 per locale and device.
- **Real app footage must dominate.** Text cards are short (≤ 1.5 s) and few (≤ 2 explicit `text` beats); no hands, people or footage outside the device.
- It must make sense without sound (it plays muted in search). The poster frame is at 5 seconds: put a legible UI scene there.
- The first ~1.5 s of a recording is the app launch: `from` ≥ 1.5 (for the hook, `hookFrom`, default 1.5).

## Look and device frames

The preview takes its colors and fonts from the selected art direction (its style preset, tinted with the brand) and draws the device with **the same HTML/CSS frames as the screenshots**: iPhone with Dynamic Island and side buttons, iPad, a macOS window for Mac footage and a TV bezel for Apple TV. Mac and TV previews are landscape: the caption runs in a column on the left, the device fills the right; every scene type works in both orientations. Record Mac/TV footage at 16:10 / 16:9 so it fills the screen.

## Styles (`previews[].style`)

| Style | Feel | What it does |
| --- | --- | --- |
| `classic` | Calm, corporate | Soft entrance, fade transitions |
| `showcase` (default) | Premium, product-focused | Device enters with a 3D rotation, slow camera push, push/iris transitions, light leaks on cuts |
| `kinetic` | Modern, typographic | A full-screen text card that bursts in word by word before each beat, device "punch-in", slide/push/wipe transitions |
| `energetic` | Games, sports, music | Tilted, shaking device, caption band in the accent color, moving striped background, wipe/flip/slide |

If unsure, `vitrin video --styles all` renders the first preview in all four styles under `.vitrin/video-styles/<locale>/` (not uploaded). Show them to the user and write the chosen one to the `style` field. `transition` (`fade|slide|wipe|flip|push|iris|none`) forces a single transition type; `lightLeaks` turns light leaks on/off.

## Scenes (`beats[].scene`)

| Scene | When | Required fields |
| --- | --- | --- |
| `device` | Default: recording/screen on the device + animated caption | `source` |
| `zoom` | The camera flies to a region of the UI and marks it with a ring (heat map, chart, card) | `source`, `zoom {x,y,w,h}` (fractions of the capture) |
| `split` | Two screens slide in side by side | `source`, `secondSource` |
| `stat` | Large counter + label + device | `source`, `stat {value, suffix, label, featureId}` — the value must be a **product fact** ("12 weeks of history"), not demo data |
| `badges` | Feature chips pop out around the device | `source`, `badges[{icon, label, featureId}]` (Lucide icon names) |
| `text` | Full-screen kinetic text card | only `caption`; keep it short |

In captions, `*word*` appears in the accent color with an animated underline. One idea per beat, ≤ 5 words.

Suggested flow (≈ 20–25 s): hook (2.6 s, real recording) → 3–5 beats (3.5–5 s) → closing (icon + name + promise, 2.6 s). Vary beat types: do not use the same scene back to back.

## Creative loops

`loops.header` (21:9) and `loops.search` (3:2) loop seamlessly; they are muted in search. Short, large text; 3 source screens.
