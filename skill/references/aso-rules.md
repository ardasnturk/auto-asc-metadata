# ASO rules

Text that earns ranking in App Store search comes from three fields: **name**, **subtitle**, **keyword field**. The description does not count toward in-store ranking (it is used by web search).

## Keyword selection

1. Set `relevance` (0–1) for the candidates in `.vitrin/keywords/<locale>.json`: does the app really do the job of the person searching for this term? If not, 0.
2. `total = relevance × popularity × (1 − competition)` — computed by the CLI. `popularity.source: "estimate"` is an estimate; do not present it as an exact number.
3. Distribution: the strongest 1–2 terms go into the **name**, the next 1–2 into the **subtitle**, the rest into the **keyword field**. Write them to the `selected` field.

## Name (2–30)

- Brand + primary keyword: `Ritim: Alışkanlık Takibi` (Turkish for "Ritim: Habit Tracker"). The brand alone is not enough; keyword stuffing is also forbidden.

## Subtitle (≤ 30)

- Benefit + secondary keyword. **Do not repeat** words from the name (validate reports an error).

## Keyword field (≤ 100 bytes)

- Comma-separated, **no spaces**: `goal,routine,streak`. Every space costs a byte.
- **The byte trap:** Turkish ç ş ğ ı ö ü are 2 bytes each in UTF-8; Japanese/Chinese/Korean characters are 3 bytes. `alışkanlık` ("habit") = 13 bytes for 10 characters.
- Use the singular; plurals still match. Do not include words from the name/subtitle, the developer name, competitor/brand names, Apple marks (iPhone, iPad, Apple Watch…), prices, or "free".
- Every term longer than 2 characters (except CJK). Low-value words such as `app`, `iphone` or `uygulama` ("app") waste bytes.
- Do not leave bytes unused (< 80 bytes triggers an info message).

## Storefront additional languages

- In each storefront, the default language and the additional languages are indexed (an observation, not an Apple commitment). E.g. US: en-US + es-MX, zh-Hans, …; Türkiye: en-GB + tr.
- Write **different** keywords for two languages that may count in the same storefront (validate warns about more than 3 shared terms). E.g. putting secondary English terms into the `es-MX` field for the US is a known strategy — but only if the app actually has metadata in that language.

## App Store tags (US only)

- Assigned from en-US metadata by AI plus human curation. Use the target concepts explicitly in the en-US name/subtitle/description. Remind the user to check the tags in ASC after upload.

## Custom Product Pages

- 2–5 suggestions: derive segments from competitor gaps and review clusters (e.g. "morning routine", "water intake goal"). Give each page a **non-overlapping** keyword set; keywords are assigned from the keyword field of the latest approved version.

## Screenshot headlines

- Their ranking impact is disputed (Appfigures' 2025 observation vs. weak tests). Write for both possibilities: the first 3 headlines should be large, high-contrast and reinforce the primary keyword from the name/subtitle.
