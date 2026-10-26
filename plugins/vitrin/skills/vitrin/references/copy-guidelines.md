# Copy guidelines

## General

- **Accuracy first:** every claim is tied to an evidence-backed feature via `claims`. Numbers in demo data (e.g. "42-day streak") are not marketing claims.
- **Rewrite for each locale, don't translate:** in every language, use that market's search vocabulary and tone. In Turkish "alışkanlık takibi", in English "habit tracker" — not a literal translation, but the phrase people actually search for.
- Match `app_profile.positioning.tone`. Use exclamation marks and emoji sparingly.
- Forbidden: prices, "free", unsupported "#1/best/only", competitor names, HTML, keyword stuffing.

## Description (≤ 4000, plain text)

- **The first 3 lines** are visible before "more": 1) main benefit + primary keyword, 2) second benefit, 3) trust/differentiation.
- Then short sections: feature bullets (•), who it is for, privacy/data approach (only if backed by evidence), subscription information (if any: duration, auto-renewal, cancel in Settings; never state the price).
- Do not use the same word more than 6 times.

## Promotional text (≤ 170)

- Can change without review: current campaign, season, new feature. Never mention prices or discounts.

## What's New (≤ 4000)

- From `app_profile.docs.commitsSinceTag` and the CHANGELOG, **in the user's language**: "The calendar view now shows 12 weeks." No technical internals (refactors, CI). Leave it empty for the first version.

## Review notes (≤ 4000 bytes)

- Demo account (from `.env` REVIEW_DEMO_* if present — never write it to a file), test steps, special hardware/permission requirements. Customers never see this.

## Screenshot headlines

- 2–7 words, start with a verb or a benefit: "Keep your streak", "See your progress in charts".
- The first 3 screenshots carry the 3 strongest messages; reinforce the primary keyword.
- The subheadline is optional, one line.

## Video copy

- Hook ≤ 5 words; one idea per beat; closing: app name + a short promise. It must make sense when watched without sound.

## Google Play listing

Same accuracy rules (`claims` with feature ids), written per locale, never a literal copy of the App Store text: Play has no subtitle and no keyword field, so the copy itself has to carry the search terms.

- **Title (≤ 30):** usually the App Store name works (`Ritim: Habit Tracker`). No emoji, ALL CAPS, “#1/best/top/new/free/sale”, no “Download now”.
- **Short description (≤ 80):** one sentence, benefit first, includes the secondary keyword phrase: “Check in your habits with one tap and keep your streaks going.” Avoid emoji and promo wording.
- **Full description (≤ 4000):** first line = what the app does + primary keyword (it is what shows first); then short paragraphs or `•` bullets per feature, who it is for, privacy approach (only with evidence), subscription terms without prices. Use the important phrases two or three times in natural sentences; never a keyword list. Do not mention the App Store, iPhone or Apple Watch.
- **Release notes (≤ 500, `changelog`):** the same user-facing changes as What's New, shorter. One per language that has notes on Play.
- **Promo video:** a public YouTube URL in `video`; the App Preview file itself is not uploaded to Google Play.
