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

- From `app_profile.docs.commitsSinceTag` and the CHANGELOG, **in each store locale's own language** (the en-US notes in English, the tr notes in Turkish — not in the chat language): "The calendar view now shows 12 weeks." No technical internals (refactors, CI). Leave it empty for the first version.
- App Review 2.3.12: significant changes must be listed specifically. "Bug fixes and performance improvements" is acceptable only when the release really is just fixes; validate warns (`whatsnew.generic`) when the commits add features.

## Review notes (≤ 4000 bytes)

- Demo account (from `.env` REVIEW_DEMO_* if present — never write it to a file), test steps, special hardware/permission requirements. Customers never see this.
- App Review 2.3.1(a): describe every new feature and product change **specifically** and say where to find it ("Widgets: long-press the Home Screen → + → Ritim"); generic notes are rejected. Explain non-obvious features and in-app purchases. If the app has a login, provide a demo account or a fully featured demo mode (2.1(a)).
- No placeholder text anywhere (Lorem ipsum, TODO, TBD, FIXME): over 40% of unresolved review issues are guideline 2.1, App Completeness.

## Words Apple does not allow in metadata

- No Apple-designated recognitions (Editor's Choice, App of the Day, Game of the Day, Apple Design Award) and no awards the app has not received.
- "For Kids" / "For Children" (and their translations) are reserved for the Kids Category (2.3.8, 5.1.4).
- No trademarked terms, popular app names, prices or phrases unrelated to the field (2.3.7); no other platforms or marketplaces (2.3.10).

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
