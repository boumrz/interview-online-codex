## Context

The loopback dashboard currently accepts only the fixed `period=30|90` API query and renders a dark analytical page using local HTML, CSS, and SVG. The user needs to inspect exact historical intervals while retaining the existing privacy boundary: only the local Node process may access Metrika, and the browser may request only a bounded aggregate contract.

The design audit found that typography, section rhythm, control grouping, chart surfaces, contrast, and narrow-screen controls are inconsistent. The dashboard remains intentionally dependency-free and must not load a remote font or UI kit.

## Goals / Non-Goals

**Goals:**

- Allow a calendar start/end interval of one to 365 completed Moscow days, with the existing 90-day view as the default.
- Keep active-user values and trend data tied to the complete selected interval and clearly label the end date used by DAU, WAU, and MAU.
- Keep retention meaningful and bounded for long ranges by calculating it from no more than the selected interval's final 90 cohort days and disclosing that scope.
- Preserve loopback binding, fixed Metrika reports, aggregate-only browser data, no-token output, bounded concurrency, and cache isolation.
- Establish a calm operational visual system with readable typography, consistent surfaces, focused controls, accessible contrast, and usable narrow-screen layout.

**Non-Goals:**

- Exposing arbitrary Metrika metrics, dimensions, filters, counter IDs, or raw Reporting API data to the browser.
- Adding a public deployment route, external font, charting/UI library, account-level identity, or causal product analysis.
- Providing custom retention formulas or unlimited date spans.

## Decisions

### Canonical custom range contract

The API will accept either an optional preset `period=30|90` or a pair of `start=YYYY-MM-DD&end=YYYY-MM-DD`, never both. Dates are parsed as real calendar dates, use the configured Metrika timezone, are inclusive, must satisfy `start <= end`, must end on or before the latest completed day, and may span one through 365 days. The local server rejects invalid, duplicate, unknown, future, reversed, and overlong parameters before invoking Metrika.

This provides date-level freedom while preventing an unbounded reporting proxy. An open-ended arbitrary query API was rejected because it would weaken the credential boundary and can create expensive retention matrices.

### Date anchoring and report scopes

The selected interval supplies daily activity, selected-period users, first-visit users, and average comparison. DAU is the final selected day; WAU and MAU are rolling distinct-user windows ending on that same selected end date. The UI labels this explicitly so historical selection is not mistaken for a current KPI.

Retention continues to use the same aggregate first-visit cohort formula. For an interval longer than 90 days, the retention report uses only the final 90 days of the interval and returns `retentionStart` metadata; the page states this scope beside the retention panels. This avoids unsafe growth in two-dimensional cohort rows while keeping activity analysis available for the whole selected interval.

### Isolated caching and load protection

Each request is canonicalised to the `start:end` key before loading. Fresh cache, stale fallback, in-flight de-duplication, and forced-refresh cooldown remain isolated by that key. The five fixed upstream reports continue to run in batches of at most two requests; retention retains its maximum row limit and fails safely when incomplete.

### Date controls and visual system

The header becomes a compact toolbar: a preset selector, `from` and `to` native date inputs revealed for custom mode, and one primary refresh button. The selector defaults to three months. The browser sends only the approved canonical query and uses server-returned boundaries to update control limits and labels.

The CSS uses an offline system font stack (`Inter, ui-sans-serif, system-ui, sans-serif`) with tabular metric numerals; an 8px spacing scale; two surface levels for sections and cards; clearer secondary text; one mint activity accent, coral retention accent, and neutral blue comparison accent; visible keyboard focus; and integer DAU-axis labels. The summary remains the first visual focus, the reading guide becomes a compact disclosure, and chart panels gain their own consistent surface. At widths at or below 580px, the toolbar wraps, inputs become full width, targets remain at least 44px, and retention checkpoints remain readable through an adapted grid or horizontal scroll.

## Risks / Trade-offs

- [A user expects multi-year retention for a long custom range] → Activity data supports up to 365 days, while retention is explicitly scoped to the final 90 days to protect report completeness.
- [Client calendar differs from Metrika's reporting day] → The server remains authoritative and rejects future/incomplete Moscow dates; returned metadata resets UI controls and labels.
- [A custom range produces a slow or quota-limited upstream response] → Existing timeout, maximum two concurrent requests, safe quota mapping, per-range cache, and stale fallback remain in force.
- [Visual refinement hides important caveats] → The data-quality badge and explanatory labels remain visible; colour is never the sole status indicator.
- [Native date inputs render differently across browsers] → They remain semantic, keyboard accessible, and server validated; no untrusted date-picker dependency is introduced.

## Migration Plan

1. Preserve the default `period=90` request so existing launcher and bookmark behaviour continues to work.
2. Add the validated `start/end` path and range metadata without changing the local port, credential lookup, or Metrika permission scope.
3. Apply the visual-token changes in the static local assets.
4. Verify preset and custom requests, invalid inputs, cache isolation, a narrow viewport, and token exclusion.
5. Roll back by restoring the prior local scripts; no deployed service, database, or user data migration exists.

## Open Questions

None. The one-year maximum and final-90-day retention scope are intentionally visible product constraints rather than hidden implementation limits.
