## 1. Extend the protected 30/90-day data contract

- [x] 1.1 Add validated 30/90-day period windows with 90 days as the default; reject every unsupported or duplicate dashboard query before an upstream request.
- [x] 1.2 Retrieve and normalise selected-period users, summed first-visit users, average DAU, and early-versus-recent average DAU alongside the existing fixed aggregates.
- [x] 1.3 Isolate cache, stale fallback, in-flight refresh, and forced-refresh limits by selected period; bound upstream concurrency to two and safely map 420/429 quota responses.

## 2. Make the HTML self-explanatory

- [x] 2.1 Add a 30-day/3-month selector that defaults to three months and refreshes the same-origin data safely.
- [x] 2.2 Add a plain-Russian selected-period summary and numbered reading guide that distinguish period aggregates, rolling KPIs, trend observations, and retention.
- [x] 2.3 Update the glossary and labels to define all new selected-period values and retain source/identity/data-quality limitations.

## 3. Verify and report

- [x] 3.1 Add focused tests for period parsing/windows, cache isolation, fixed period queries, summary calculations, invalid/duplicate-query rejection, truncated-retention rejection, 420/429 quota states, and token exclusion.
- [x] 3.2 Validate the default 90-day response against the authorised counter, record only normalised aggregates, and create a plain-language three-month report with caveats.
- [x] 3.3 Run dashboard tests, strict OpenSpec validation, source leak checks, and a browser check; update task checkboxes and archive the completed change.
