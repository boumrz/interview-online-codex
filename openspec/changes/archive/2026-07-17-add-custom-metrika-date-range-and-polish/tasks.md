## 1. Add a protected custom date-range contract

- [x] 1.1 Parse canonical preset or `start/end` calendar ranges, calculate the selected reporting window and its final-90-day retention scope, and reject invalid, future, reversed, partial, duplicate, and over-365-day inputs.
- [x] 1.2 Load selected-period aggregates and end-anchored DAU/WAU/MAU using the canonical window; key cache, in-flight work, stale fallback, and refresh cooldown by canonical date range.
- [x] 1.3 Extend the loopback endpoint allowlist for the mutually exclusive date-range contract while preserving aggregate-only responses, request concurrency limits, and safe error handling.

## 2. Improve controls, clarity, and visual polish

- [x] 2.1 Add accessible preset and custom start/end date controls that default to three months, preserve the selected range while refreshing, and never construct an unapproved query.
- [x] 2.2 Update selected-period, KPI, and retention labels so historical end-date anchoring and the final-90-day retention scope are unambiguous.
- [x] 2.3 Apply the designer-reviewed local visual system: adaptive toolbar, offline type scale, spacing and surface tokens, contrast, focus/loading states, integer chart axes, and narrow-screen layout.

## 3. Verify and finish

- [x] 3.1 Extend focused Node tests for custom window parsing, server query rejection, report boundaries, retention scoping, and date-range cache isolation; retain token-exclusion coverage.
- [x] 3.2 Verify live authorised Metrika aggregates for the default and one custom historical range without recording a credential or raw upstream response.
- [x] 3.3 Run focused tests, source leak checks, strict OpenSpec validation, and desktop/narrow-browser checks; update tasks and archive the completed change.
