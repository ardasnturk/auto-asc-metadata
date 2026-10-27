# Product Page Optimization tests

App Store Connect's Product Page Optimization shows up to three treatments of the product page to a share of the organic visitors and reports which converts better. Vitrin plans the test with you, renders each treatment's own screenshot set, shows it in the review gallery, and creates the test as a draft with `vitrin upload --experiment`. App Review checks the treatments; the user starts the test in App Store Connect and reads the result there.

## Rules (Apple)

- Elements: screenshots (and previews) and the app icon. Name, subtitle and description cannot be tested.
- Up to 3 treatments against the original, one test at a time, 7–90 days; a winner only at ≥ 90 % confidence (aim for 95 %).
- An icon treatment needs the alternate icon **in the binary** under review (`appIconName` is its name there). Vitrin does not change the build.
- Only organic App Store traffic is tested; ads and Custom Product Pages are not part of it.

## When to offer one

After the first upload of a live app, or whenever the user asks how to improve conversion. Do not start a test on a page that is about to change anyway (a new release, a new design): the result would mix both.

Order (highest impact first): the **first screenshot** (benefit vs. feature headline, a different hero screen) → the **icon** → the **order** of the screenshots → the **style** (light/dark, framing) → the preview video.

## `metadata/experiments.json`

```json
{ "experiments": [{
  "id": "hero-benefit", "name": "Hero: benefit headline", "element": "screenshots",
  "hypothesis": "If the first screenshot leads with the outcome (\"Never miss a day\") instead of the feature, conversion will rise because the outcome is what people search for.",
  "metric": "conversion rate", "minimumDetectableEffect": 0.1, "trafficProportion": 50,
  "dailyPageViews": 1800, "baselineConversion": 0.32,
  "treatments": [
    { "id": "outcome", "name": "Outcome headline", "change": "Shot 01 headline states the outcome",
      "copy": { "01": { "en-US": { "headline": "Never miss *a day*" }, "tr": { "headline": "Hiçbir günü *kaçırma*" } } } },
    { "id": "stats-first", "name": "Stats first", "change": "The statistics screen opens the set", "shots": ["03", "01", "02", "04", "05"] }
  ] }] }
```

- **Hypothesis:** "If we <change>, <metric> will <improve> because <reason>." (`experiment.hypothesis`).
- **One variable per treatment:** a new order *or* new copy *or* a new icon (`experiment.many-changes`); a treatment that changes nothing is an error.
- `shots` is the treatment's order (ids from shots.json; empty = the original order); `copy` overrides headlines per shot and locale. `vitrin design` renders every treatment that changes the screenshots to `metadata/store/experiments/<test id>/<treatment id>/<locale>/`.
- **Duration:** with `dailyPageViews` and `baselineConversion` (App Store Connect → Analytics) validate estimates the days a two-sided 95 % / 80 % power test needs to see `minimumDetectableEffect`; over 90 days it warns — test a bolder change or fewer treatments.
- Several tests may be planned; App Store Connect runs one at a time (`experiment.one-at-a-time`). `vitrin upload --experiment <id>` creates one (default: the first without a result).

## After the test

When the user reads the result in App Store Connect, write it into the test: `"result": { "endedAt": "2026-12-01T00:00:00Z", "winner": "outcome", "liftPct": 12.4, "confidence": 0.94, "notes": "…" }` (`winner`: `original`, a treatment id or `inconclusive`). A winning treatment becomes the new original: move its copy/order into `shots.json`, run `vitrin design`, review and upload. Then plan the next test from the order above; an inconclusive result means the change was too small — try a bolder one.
