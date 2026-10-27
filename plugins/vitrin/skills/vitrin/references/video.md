# App Previews and creative videos

Vitrin renders videos with Remotion. You write `metadata/video-plan.json`; the CLI builds the scene list, fits it to 15–30 s, renders it and normalizes it to the App Store format (H.264 High@4.0, 30 fps, stereo AAC).

## Rules (Apple)

- 15–30 s, 30 fps, 886×1920 (iPhone, including Duo) / 1200×1600 (iPad) / 1920×1080 landscape (Mac: `device: "mac"`, target `preview-mac`; Apple TV: `device: "tv"`, target `preview-tv` — both off by default, enable them in `targets.enable`); at most 3 per locale and device.
- App Review 2.3.4: previews may only use **video screen captures of the app itself**; narration and video or text overlays may explain what is not clear. The camera and the device may move, but the UI on screen must stay readable; never show footage that is not from the app. No icon or logo end card and no "Download now" (Vitrin's closing line runs over the app's own outcome screen).
- Up to 3 previews per device size and language; they always appear **before** the screenshots on iPhone, iPad, Mac and Apple TV, so the first preview takes the place of the first screenshot in search results.
- Audio is muted by default: the video must work silently (Vitrin adds a silent stereo track). Make the first 2 seconds strong. Cut fast but readable: every screen stays at least 0.6 s, and a caption stays long enough to read (≈ 1.5 s for five words).
- Vision Pro previews are 3840×2160 landscape (`device: "vision"`, target `preview-vision`, off by default); Mac and Apple TV previews are landscape only. Processing in App Store Connect can take up to 24 hours.
- **Real app footage must dominate.** Text cards are short (≤ 1.5 s) and few: at most 2 in a preview, counting the `text` beats and the kinetic style's cards (Vitrin keeps the kinetic cards within that budget). No hands, people or footage outside the device; the touch indicator of a `flow` is a dot, not a hand.
- It must make sense without sound (it plays muted in search). The poster frame is at 5 seconds: Vitrin holds the scene before it a little longer when needed, so that frame shows a settled UI scene — not a cut, a device still flying in or a text card. The hook starts already half-way into its entrance, so the very first frame shows the device and the hook line too (autoplay starts there).
- The first ~1.5 s of a recording is the app launch: `from` ≥ 1.5 (for the hook, `hookFrom`, default 1.5).

## Look and device frames

The preview takes its colors and fonts from the selected art direction (its style preset, tinted with the brand) and draws the device with **the same HTML/CSS frames as the screenshots**: iPhone with Dynamic Island and side buttons, iPad, a macOS window for Mac footage and a TV bezel for Apple TV. Mac and TV previews are landscape: the caption runs in a column on the left, the device fills the right; every scene type works in both orientations. Record Mac/TV footage at 16:10 / 16:9 so it fills the screen.

## Styles (`previews[].style`)

| Style | Feel | What it does |
| --- | --- | --- |
| `classic` | Calm, corporate | Soft rise, slow push-in, fade transitions |
| `showcase` (default) | Premium, product-focused | Device enters with a 3D rotation and keeps orbiting slightly while the camera pushes in, push/iris transitions, light leaks on cuts |
| `kinetic` | Modern, typographic | A full-screen text card that bursts in word by word before up to two beats (the first and the middle one); the other captions pop in word by word over the UI; device "punch-in", slide/push/wipe transitions |
| `energetic` | Games, sports, music | Tilted, swaying device, caption band in the accent color with popping words, moving striped background, wipe/flip/slide |

In every style the camera keeps moving after the device has landed (push-in, drift), and the backdrop shifts on every cut, so the preview reads as one moving shot rather than a slide show.

If unsure, `vitrin video --styles all` renders the first preview in all four styles under `metadata/video-styles/<locale>/` (not uploaded). In a development checkout, `vitrin video --studio` opens the first preview with the exact props it would render in Remotion Studio, to scrub it and tune the motion before rendering (run it in the background; it keeps running until stopped). Show them to the user and write the chosen one to the `style` field. `transition` (`fade|slide|wipe|flip|push|iris|none`) forces a single transition type; `lightLeaks` turns light leaks on/off.

## Scenes (`beats[].scene`)

| Scene | When | Required fields |
| --- | --- | --- |
| `device` | Default: recording/screen on the device + animated caption | `source` |
| `zoom` | The camera flies to a region of the UI and marks it with a ring (heat map, chart, card) | `source`, `zoom {x,y,w,h}` (fractions of the capture) |
| `split` | Two screens slide in side by side | `source`, `secondSource` |
| `stat` | Large counter + label + device | `source`, `stat {value, suffix, label, featureId}` — the value must be a **product fact** ("12 weeks of history"), not demo data |
| `badges` | Feature chips pop out around the device | `source`, `badges[{icon, label, featureId}]` (Lucide icon names) |
| `text` | Full-screen kinetic text card | only `caption`; keep it short |
| `flow` | **The app in use**: 2–5 screens in one device. A finger taps (`tap {x,y}`, fractions of the capture, on the real control) and the next screen arrives the way the app shows it — `change`: `push` (navigation, default), `sheet` (a modal sheet rising from the bottom), `fade` (state change on the same screen), `scroll` (the same screen further down; the status bar stays), `cut` (quick montage cut, no tap needed) | `steps[{source, tap?, change?, from?}]`; the beat's `source` and caption are optional |

In captions, `*word*` appears in the accent color with an animated underline. One idea per beat, ≤ 5 words.

## Structure (≈ 18–24 s)

1. **Hook** (2.2 s): the outcome, not a menu — the screen that shows what the user gets.
2. **Demo** (6–10 s): one or two `flow` beats that do the core task the way a user does it, taps included (≈ 1.2 s per step).
3. **Breadth** (3–5 s): a `flow` of `cut` steps (3–4 screens, ≈ 0.8 s each), or `badges` / `split`.
4. **Proof** (2–3 s): `stat` (a product fact) or `zoom` on the result.
5. **Closing line** (optional, 2.4 s): `outro { title, subtitle?, source? }` over the outcome screen (default: the last beat's screen). Leave `outro` out to end on the last beat.

Other beats last 1.5–2.5 s. Vary beat types: do not use the same scene back to back. Vitrin only stretches or shrinks beats when the preview falls outside 15–30 s.

**Up to three previews, three hooks:** A leads with the outcome (the default first preview), B is a pure demo of the core task, C leads with proof (`stat`, results). Not three copies of one cut.

**HTML screens (no recordings):** flows are what make the preview move. For every tap, write the screen *after* it as its own screen and add it to `capture.screens` — e.g. `home-done` (the habit checked), `add-sheet` (the sheet open, `change: "sheet"`), `stats-more` (the same screen with its content moved up, for `change: "scroll"`). Keep everything else identical between two states, so only what the tap changed moves.

## Creative loops

`loops.header` (21:9) and `loops.search` (3:2) loop seamlessly; they are muted in search. Short, large text; 3 source screens.
