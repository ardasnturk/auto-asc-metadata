# Troubleshooting

## Demo mode (-VitrinDemo)

Screenshots must not show real user data and must be identical on every run. If the app does not have this yet, suggest the code below for its framework to the user (do not touch the app's code without approval). Every framework receives the same two inputs:

| Input | Apple platforms (simctl / Mac launch) | Android (`am start`) |
| --- | --- | --- |
| Demo mode | launch argument `-VitrinDemo` | intent extra `--ez vitrinDemo true` |
| Screen to open | `-VitrinScreen <id>` | `--es vitrinScreen <id>` |
| Other `capture.screens[].launchArgs` | passed as-is | `-Name value` → `--es name value` (`YES`/`NO` → `--ez`, integers → `--ei`), `-Flag` → `--ez flag true` |
| Language | `-AppleLanguages (tr) -AppleLocale tr_TR` + simulator system language | per-app language (`cmd locale set-app-locales`, Android 13+) |

While demo mode is on: in-memory store with fixed, locale-specific demo data; no permission prompts, sign-in, network, ads or purchase calls; the root view opens the requested screen. Never hard-code strings — the language comes from the system.

### Swift (iOS, iPadOS, macOS, watchOS, tvOS, visionOS)

Launch arguments arrive in `ProcessInfo` on every Apple platform (simulators and the Mac app alike):

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

- In the root view, select a tab / push / present a sheet based on `VitrinDemo.screen`.
- `-VitrinScreen home` also lands in `UserDefaults.standard.string(forKey: "VitrinScreen")` (argument domain), which is handy in a watch extension.
- Sample app: `examples/Ritim/Ritim/Support/VitrinDemo.swift`.
- Native Android apps: see "Android (Kotlin)" below.

### Flutter

Dart cannot read process arguments on iOS, so the host apps forward them over a method channel:

```swift
// ios/Runner/AppDelegate.swift (inside application(_:didFinishLaunchingWithOptions:))
let controller = window?.rootViewController as! FlutterViewController
FlutterMethodChannel(name: "vitrin", binaryMessenger: controller.binaryMessenger).setMethodCallHandler { call, result in
    let args = ProcessInfo.processInfo.arguments
    let screen = args.firstIndex(of: "-VitrinScreen").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
    result(["demo": args.contains("-VitrinDemo"), "screen": screen as Any])
}
```

```kotlin
// android/app/src/main/kotlin/…/MainActivity.kt
class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "vitrin").setMethodCallHandler { _, result ->
            result.success(mapOf("demo" to intent.getBooleanExtra("vitrinDemo", false), "screen" to intent.getStringExtra("vitrinScreen")))
        }
    }
}
```

```dart
// lib/vitrin_demo.dart — await before runApp, pick the demo repository and initial route
const _channel = MethodChannel('vitrin');
Future<({bool demo, String? screen})> vitrinDemo() async {
  if (kReleaseMode) return (demo: false, screen: null); // drop this line if capture uses a release build
  final m = Map<String, dynamic>.from(await _channel.invokeMethod('get') ?? {});
  return (demo: m['demo'] == true, screen: m['screen'] as String?);
}
```

- Capture builds Flutter apps in debug mode (`flutter build ios --simulator --debug`, `flutter build apk --debug`); macOS desktop (`macos/`) uses the Swift snippet in its `MainFlutterWindow.swift`.
- Languages come from `MaterialApp(localizationsDelegates: …, supportedLocales: …)` and the device; declare iOS languages in `ios/Runner/Info.plist` `CFBundleLocalizations`.

### React Native and Expo

Use `react-native-launch-arguments` (reads `ProcessInfo` arguments on iOS and intent extras on Android) — no native code needed:

```ts
// src/vitrinDemo.ts
import { LaunchArguments } from 'react-native-launch-arguments';
const args = LaunchArguments.value<{ VitrinDemo?: boolean; VitrinScreen?: string; vitrinDemo?: boolean; vitrinScreen?: string }>();
export const vitrinDemo = Boolean(args.VitrinDemo ?? args.vitrinDemo);
export const vitrinScreen = args.VitrinScreen ?? args.vitrinScreen; // iOS: -VitrinScreen, Android: vitrinScreen extra
```

- Pass `vitrinScreen` as the initial route of React Navigation / Expo Router (`router.replace('/' + vitrinScreen)` in the root layout).
- Expo: the library has native code, so it needs a development or prebuilt build (not Expo Go). Vitrin runs `npx expo prebuild` when `ios/`/`android/` are missing.
- Without the library, a tiny native module works too: on iOS return `ProcessInfo.processInfo.arguments`, on Android `currentActivity?.intent?.extras` from a `@ReactMethod`.
- Capture builds **Release** variants by default (the JS bundle is embedded, no Metro server, no dev overlays). If demo mode is behind `__DEV__`, set `capture.reactNative.metro: true`, start Metro (`npx react-native start` / `npx expo start`) and capture runs Debug builds.

### Android (Kotlin, also the Flutter/React Native host)

```kotlin
// MainActivity.kt
val vitrinDemo = intent.getBooleanExtra("vitrinDemo", false)
val vitrinScreen = intent.getStringExtra("vitrinScreen") // "home", "stats", …
```

- Vitrin launches with `am start -W -S -n <applicationId>/<launcher activity> --ez vitrinDemo true --es vitrinScreen <id>` (cold start each time), installs with `adb install -g` so runtime permissions are pre-granted, and turns on System UI demo mode (clock 09:41, full battery and signal, notifications hidden).
- Per-app language needs Android 13+ and, for AppCompat apps, `android:localeConfig` / `AppCompatDelegate.setApplicationLocales`. Older images show the device language.
- The launcher activity is resolved from the device; set `capture.android.activity` if the app has several.

## Capture on other platforms

- **watchOS / tvOS / visionOS:** each needs its simulator runtime (`xcodebuild -downloadPlatform watchOS|tvOS|visionOS`). Device types come from `data/targets.json` (`watch-ultra` → "Apple Watch Ultra 3 (49mm)", …); override with `capture.simulators.watch|tv|vision`. The watch app is built from its own target (scheme = target name).
- **Mac:** the app is built (native or Mac Catalyst, ad-hoc signed), started with the demo arguments, resized to 1440×900 points and captured with `screencapture -l <window>`, then scaled to 2880×1800. Resizing needs Accessibility permission for the terminal; without it the capture is cropped/scaled to 16:10.
- **Android:** needs the Android SDK (`ANDROID_HOME`) with `emulator`, `platform-tools` and a system image. Vitrin creates `Vitrin_<device>` AVDs (`pixel_9`, `Nexus 7 2013`, `pixel_tablet`) or uses `capture.android.avds`. Pass a pre-built APK with `capture.prebuilt.android`.
- **React Native Release builds fail to sign on Android:** the template signs release with the debug keystore; if yours requires a release keystore, set `capture.reactNative.metro: true` or `capture.prebuilt.android`.
- **A selected platform was not detected:** provide its build with `capture.prebuilt.<platform>` or use `capture.mode: manual`.

## iPhone Duo

- fastlane < 2.241.1 does not recognize the Duo sizes and **aborts the whole upload** → `>= 2.241.1` in the Gemfile, `bundle update fastlane`.
- The deliver documentation does not mention a Duo class, and the ASC API 4.5.1 classic `ScreenshotDisplayType` has none. A Duo-only or partial run always goes through the App Asset Library (`IPHONE_DUO`, in the spec); if a full deliver run fails on Duo, use `vitrin upload --uploader=asset-library`.
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

- The ASC API 4.5.1 release notes deprecate Screenshot/Preview Sets; the 4.5.1 spec still lists them and Vitrin uses them for single display types. If deliver fails on these endpoints, Vitrin's message suggests `--uploader=asset-library` or `--uploader=asc`.
- Asset Library names come from the 4.5.1 spec (docs/apple-notes.md). If doctor reports “refData has no placement group for …” or a size that is not among a display class's `screenDimensions`, open `.vitrin/cache/refdata.json`: the device set is the `placementProfileGroups[].placementProfileGroupId` with that `platform` and `displayClassId`; fix `data/asc-display-types.json` if Apple maps the size to another class.
- A partial upload stops with “refusing to touch any set” / “Refusing to replace”: App Store Connect returned a set or placement of another type for a filtered request, so Vitrin deleted nothing. Replace that set in App Store Connect by hand and report it.

## asc uploader (`upload.uploader: asc`)

- `asc is not installed` / doctor “asc CLI” fails: `brew install asc` (https://github.com/rorkai/App-Store-Connect-CLI), then `asc version`.
- asc reads the same `.env` keys through its environment credential (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH` or `ASC_PRIVATE_KEY_B64`, set by Vitrin). If asc still uses another account, a stored asc profile may win: unset `ASC_PROFILE` and check `asc auth status`.
- asc's `metadata push` does not upload categories, copyright or review information; set them in App Store Connect or run that part with the deliver uploader.
- `upload.ascValidate: true` makes `vitrin doctor` run `asc validate --app <id>`; its warnings (no build attached, pricing) do not block an upload.

## Playwright / fonts

- `npx playwright install chromium`.
- If a typeface looks missing, `art-direction.json` → typography must use only the embedded families (Inter, Manrope, Space Grotesk, Plus Jakarta Sans, DM Sans, Fraunces, Playfair Display, Noto Sans).

## A stage is skipped

- If the input hash is unchanged, the stage is skipped. To force it, `vitrin --force <command>`; to reset completely, delete `.vitrin/state.json`.
