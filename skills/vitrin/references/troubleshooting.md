# Troubleshooting

## Demo mode (-VitrinDemo)

Screenshots must not show real user data and must be identical on every run. If the app does not have this yet, suggest the following to the user (do not touch the app's code without approval):

```swift
// Support/VitrinDemo.swift
enum VitrinDemo {
    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("-VitrinDemo") }
    /// -VitrinScreen <id> → screen to show at launch
    static var screen: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-VitrinScreen"), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
}
```

- While `isEnabled`: in-memory store + fixed, locale-specific demo data; permission prompts and network/StoreKit calls disabled.
- In the root view, select a tab / push / present a sheet based on `VitrinDemo.screen`.
- The language comes from `-AppleLanguages (tr) -AppleLocale tr_TR`; do not hard-code strings.
- Sample app: `examples/Ritim/Ritim/Support/VitrinDemo.swift`.

## iPhone Duo

- fastlane < 2.241.1 does not recognize the Duo sizes and **aborts the whole upload** → `>= 2.241.1` in the Gemfile, `bundle update fastlane`.
- The deliver documentation does not mention a Duo class; if the upload fails, use `vitrin upload --uploader=asset-library` (`IPHONE_DUO` is verified in the API).
- The fold posture (outer/inner display) cannot be automated in the simulator: select it manually in the simulator during capture, or provide the Duo raw screenshots with `capture.mode: manual`. If there is no Duo raw screenshot, the iPhone screenshot is used and a warning is shown.

## No app record / 403

- An app cannot be created with an API key. Create it once manually via ASC > Apps > + (bundle id, SKU, primary language). `fastlane produce` only works with an Apple ID + 2FA (FASTLANE_USER/PASSWORD).
- 401: Key ID / Issuer ID / .p8 do not match, or the key has been revoked.
- 403: insufficient key role (at least App Manager, Team Key).

## No editable version

- `vitrin doctor --create-version 1.2.0` tries to create one with deliver.
- For an app that is only on TestFlight, the API may reject the first App Store version → create it once manually with "+ Version" in ASC, then "continue".

## Video stuck processing

- In ASC, preview "Processing" can take up to 24 hours. If the `ffprobe` checks passed, wait.
- Rejection reasons: 60 fps, no audio track, mono audio, duration < 15 s, wrong resolution. `vitrin validate` measures all of these; Vitrin normalizes videos with ffmpeg to High@4.0, 30 fps CFR, stereo AAC 48 kHz.
- Remotion downloads Chrome Headless Shell on the first run; without network access, `vitrin video` fails.

## deliver deprecation / legacy screenshot endpoints

- ASC API 4.5.1 deprecated Screenshot/Preview Sets. If deliver fails on these endpoints, Vitrin's message suggests `--uploader=asset-library`. The Asset Library attribute names are not fully verified (docs/apple-notes.md); on the first run, check `.vitrin/cache/refdata.json`.

## Playwright / fonts

- `npx playwright install chromium`.
- If a typeface looks missing, `art-direction.json` → typography must use only the embedded families (Inter, Manrope, Space Grotesk, Plus Jakarta Sans, DM Sans, Fraunces, Playfair Display, Noto Sans).

## A stage is skipped

- If the input hash is unchanged, the stage is skipped. To force it, `vitrin --force <command>`; to reset completely, delete `.vitrin/state.json`.
