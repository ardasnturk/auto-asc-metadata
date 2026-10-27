# Recreating the app's screens 1:1 in HTML

With `capture.mode: html` the store screenshots are built around HTML recreations of the app's real screens. They must be indistinguishable from a screenshot of the running app — whatever the app is written in. Nothing is built and no simulator runs.

## Workflow per screen
1. **Find the code that draws it.** Start at `capture.screens[].source`, then follow every child view/component it uses down to the leaves (cells, cards, charts, empty states). Note the data each one shows.
2. **Collect the design tokens** before writing HTML:
   - Colors: Xcode asset catalog (`*.colorset/Contents.json`, light and dark), `AccentColor`, `Color(...)`/`UIColor(...)` literals; Android `res/values*/colors.xml`, `themes.xml`, Compose `Color.kt`/`Theme.kt`; Flutter `ThemeData`/`ColorScheme`; React Native style constants or theme files.
   - Fonts: bundled font files (Info.plist `UIAppFonts`, `res/font`, `pubspec.yaml` fonts, `expo-font`), else the system font (SF Pro via `-apple-system`, Roboto on Android).
   - Spacing, radii and sizes as written in the code (`.padding(20)`, `Modifier.padding(16.dp)`, `EdgeInsets.all(12)`, `padding: 12`).
   - Icons: SF Symbols / Material Symbols names → redraw as inline SVG at the same size and weight; app images from `Assets.xcassets`, `res/drawable*`, `assets/` copied next to the screen.
3. **Start from the kit** (`metadata/screens/kit/ios.css`, `material.css`, `watchos.css`, `macos.css`) for system metrics, then override its `:root` tokens with the app's values.
4. **Write the screen** with demo data that is realistic for the feature (names, numbers, dates that make sense together across screens) and UI text from the app's localization through `{{key}}` placeholders.
5. **Render and compare**: `vitrin capture --locale <l> --family <f>`, open the PNG with Read, compare it element by element with the code (and with a real screenshot if the user has one). Fix and repeat until nothing differs. `vitrin mockups --screens` shows the result inside the device mockups.

## Mapping table

| Concept | SwiftUI / UIKit | Jetpack Compose / XML | Flutter | React Native / Expo | HTML/CSS |
|---|---|---|---|---|---|
| Vertical stack | `VStack(spacing:)`, `UIStackView(.vertical)` | `Column(verticalArrangement = spacedBy())`, `LinearLayout vertical` | `Column` + `SizedBox` | `<View>` (column is default) | `display:flex;flex-direction:column;gap:` |
| Horizontal stack | `HStack`, `.horizontal` | `Row` | `Row` | `flexDirection:'row'` | `display:flex;gap:` |
| Overlay | `ZStack`, `.overlay`, `.background` | `Box` | `Stack` + `Positioned` | `position:'absolute'` | `position:relative` / `absolute` |
| Spacer | `Spacer()` | `Spacer(Modifier.weight(1f))` | `Spacer()`, `Expanded` | `flex:1` | `flex:1` |
| Default padding | `.padding()` = 16 pt | `16.dp` (Material margins) | `EdgeInsets.all(16)` | as written | 16px |
| Units | pt = CSS px | dp = sp = CSS px | logical px = CSS px | number = CSS px | px |
| Corner radius | `.cornerRadius`, `RoundedRectangle(cornerRadius:, style: .continuous)` | `RoundedCornerShape` | `BorderRadius.circular` | `borderRadius` | `border-radius` (continuous ≈ +10 %) |
| Lists | `List` (inset grouped), `Form`, `UITableView .insetGrouped` | `LazyColumn` + `ListItem` | `ListView` + `ListTile` | `FlatList` | kit `.list`/`.row`, `.list-item` |
| Navigation | `NavigationStack` + `.navigationTitle` (large) | `TopAppBar`/`LargeTopAppBar` | `AppBar`, `CupertinoNavigationBar` | React Navigation header | kit `.nav-large` / `.appbar` |
| Tabs | `TabView` | `NavigationBar` | `NavigationBar`, `CupertinoTabBar` | bottom tabs | kit `.tabbar` / `.navbar` |
| Text styles | `.font(.largeTitle/.headline/.footnote)` | `MaterialTheme.typography.titleLarge` | `textTheme.titleLarge` | `fontSize`/`fontWeight` | kit classes (`.large-title`, `.title-large` …) |
| Toggles / switches | `Toggle` | `Switch` | `Switch`, `CupertinoSwitch` | `Switch` | kit `.toggle` / `.switch` |
| Progress | `ProgressView`, `Gauge`, `Circle().trim` | `LinearProgressIndicator`, `CircularProgressIndicator` | `LinearProgressIndicator` | as built | kit `.progress`, `.ring`, SVG arcs |
| Charts | Swift Charts | Vico / Canvas | fl_chart / CustomPaint | victory / svg | inline SVG with the same data |
| Sheets | `.sheet`, `.presentationDetents` | `ModalBottomSheet` | `showModalBottomSheet` | modal | kit `.sheet` |

## Platform specifics
- **iPhone**: Vitrin draws the status bar; keep `var(--safe-top)` (62 px) and `var(--safe-bottom)` (34 px) free. iPhone Duo uses the iPhone screen when the app has no fold-specific layout; write `<id>.duo.html` (669×951, a crease runs down the middle when open) when it does.
- **iPad**: `NavigationSplitView` / `UISplitViewController` → kit `.split` with a 320 px sidebar; never stretch the iPhone layout.
- **Apple Watch**: 211×257 viewport, black background, content clear of the rounded corners (kit `watchos.css`).
- **Mac**: 1440×900 window content; Vitrin's frame adds the window chrome. Sidebar 240 px, toolbar 52 px (kit `macos.css`).
- **Android**: status bar drawn by Vitrin (24 px); bottom gesture bar is yours (kit `.gesture-bar`). Material 3 unless the app uses Material 2 or a custom design system — then follow the code, not the kit.
- **Dark appearance**: when `capture.appearance: dark`, `html[data-appearance="dark"]` switches the kit tokens; use the dark values from the asset catalog / `values-night` too.

## Never
- Invent features, screens or UI text the app does not have.
- Show real user data, real people's names from a database, or another company's brand.
- Load anything from the network.
