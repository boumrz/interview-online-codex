## Context

The completed snapshot utility embeds aggregate data into a new HTML file, which makes every view a separate generation step. The Metrika counter already collects visits and named product events, but the requested dashboard is a private analytical tool rather than a deployed product capability.

Yandex Metrika's Reporting API provides session-level dimensions `ym:s:date` (visit date) and `ym:s:firstVisitDate` (first-session date), along with `ym:s:users` and `ym:s:newUsers`. That permits a first-visit cohort retention calculation without copying raw visitor identifiers into the dashboard. A browser-side Reporting API call is technically possible today, but it would expose the OAuth token and depends on an undocumented CORS policy.

## Goals / Non-Goals

**Goals:**

- Serve one independently runnable, localhost-only HTML dashboard that loads current aggregates automatically when opened and can refresh them without regenerating HTML.
- Keep the Metrika read token outside the browser and expose to the page only normalised aggregate data.
- Show a clearly defined latest-completed-day DAU, rolling WAU and MAU, daily active-user trend, daily first-visit cohorts with D1/D7/D14/D30 retention, and a Russian glossary of metric/API names and limitations.
- Respect Reporting API quotas through fixed queries, an in-memory cache, a single concurrent refresh, request timeouts, and explicit data-quality states.

**Non-Goals:**

- A route, API, secret, or authentication capability in deployed interview-online.
- A raw-visit export, Logs API pipeline, user-level data store, cross-device/account-level identity, activation-goal retention, or arbitrary Metrika query proxy.
- Permanent OAuth token persistence, automated OAuth consent, or refresh-token lifecycle management.

## Decisions

### Run a loopback dashboard server instead of a static live page

`node scripts/serve-metrika-dashboard.mjs` will bind only to `127.0.0.1` and serve the dashboard assets and one fixed JSON endpoint. The HTML automatically calls only that same-origin endpoint on opening, on a manual refresh, and at a bounded refresh interval.

The server reads `METRIKA_OAUTH_TOKEN` from its own environment and sends the OAuth header only to Metrika. It never returns the token, an upstream URL, an arbitrary metric/filter/counter control, raw upstream bodies, stack traces, or raw visitor data. A direct `file://` dashboard was rejected because its OAuth token would be exposed to browser storage, page source, and DevTools, and its CORS compatibility is not an API contract. A deployed backend was rejected because the request is for a private tool, not a product feature.

### Make local opening zero-command without putting a token in source

The owner can opt into a local Windows Credential Manager item created in their Windows profile. A checked-in PowerShell launcher reads that item through the Windows credential API, sets `METRIKA_OAUTH_TOKEN` only in its own process, starts the loopback Node server hidden, and opens the loopback URL. A small double-clickable command wrapper invokes that launcher without requiring the owner to type a terminal command.

The credential name is fixed and no token value, token prefix, authorization header, or encoded equivalent is written to the launcher, command wrapper, repository, browser, logs, or dashboard endpoint. If the credential is missing, the launcher stops with an actionable local message rather than starting an unauthorised dashboard. Direct browser-to-Metrika requests remain rejected: they would disclose the bearer token through page source and browser developer tools.

### Use fixed Reporting API aggregates and a stable reporting day

All metrics use the configured Metrika timezone, defaulting to `Europe/Moscow`; the dashboard states that timezone and the as-of date. The latest completed day (yesterday in that timezone) is the anchor for KPI cards, so the UI does not present a partial current day as final.

- DAU / daily active users: `ym:s:users` by `group=day`; they are the same measure and are shown once as the daily chart plus latest KPI.
- WAU: one `ym:s:users` aggregate for the inclusive 7-day window `[D-6, D]`.
- MAU: one `ym:s:users` aggregate for the inclusive 30-day window `[D-29, D]`.
- Daily trend: `ym:s:users,ym:s:newUsers` by day for a fixed 30-day history.

WAU and MAU are not calculated by summing DAU. The server uses two fixed reporting requests, avoiding the 60–180 requests that a historical rolling-series calculation would require.

### Calculate first-visit cohort retention from grouped aggregates

The server makes a fixed table request for `ym:s:users`, grouped by `ym:s:date,ym:s:firstVisitDate`, across enough completed days to calculate the selected cohort rows. It normalises rows into an in-memory matrix:

`retention(C, n) = users(activeDate = C+n, firstVisitDate = C) / users(activeDate = C, firstVisitDate = C)`.

The UI displays D0, D1, D7, D14, and D30. A value whose return date has not occurred is labelled “ещё рано”; an unavailable/malformed report is labelled unavailable rather than zero. This is first-visit, any-visit retention, not retention after registration or a product event.

### Make data quality visible and failure-safe

The server combines `sampled`, `sample_share`, and `data_lag` from all API responses and returns a freshness timestamp. It caches a successful response for five minutes, serialises refresh work, times out upstream calls, and maps 401/403, 420, malformed responses, and network failures to safe structured states. The page never silently replaces unavailable data with zero and retains the last successful aggregate only with its timestamp clearly shown.

### Keep the page self-describing

The HTML includes a collapsible Russian glossary with both product names and source parameter names: `ym:s:users`, `ym:s:newUsers`, `ym:s:date`, `ym:s:firstVisitDate`, DAU, WAU, MAU, cohort, Dn retention, timezone, sampling, and data lag. It explains that Metrika unique users are pseudonymous browser/ClientID-based visitors and are not necessarily unique application accounts or people.

### Use the supplied analytical visual hierarchy without inventing metrics

The page uses the supplied image as visual direction only: near-black/navy canvas with a restrained teal glow, compact controls in the header, a high-contrast row of DAU/WAU/MAU KPI cards, a row of D0/D1/D7/D14/D30 retention checkpoints, two aligned analytical panels, and a wide daily active-user chart. The page will use original CSS/SVG and real labels; it will not copy the reference's branding, “sticky factor”, activation values, or comparison figures that are not defined by this change.

The two upper panels are a D1–D30 aggregate retention curve and a compact cohort-retention view. The full-width lower panel is the daily active-user trend. All graphs must remain legible on smaller screens by stacking panels and preserving their visible legends and axis labels. The glossary follows the analytical panels in a collapsible section.

## Risks / Trade-offs

- [The dashboard requires a running local process] → Keep it a one-command, loopback-only Node utility; automatic browser refresh removes report generation from the viewing workflow.
- [The environment token disappears when its terminal closes] → Store it only in the current Windows user's encrypted Credential Manager and pass it to the dashboard process at launch; do not persist it in code, source-controlled configuration, browser storage, or command-line arguments.
- [Metrika delays or samples reports] → Anchor KPIs on the last completed day and display `data_lag` and sampling metadata.
- [Cohort dimensions might not be available for a particular counter/query combination] → Validate the shape, mark retention unavailable, and retain other metrics; do not manufacture cohort values.
- [A Metrika unique user is browser-scoped] → State this limitation in the glossary and avoid claiming account-level or cross-device retention.
- [Localhost browser attacks] → Bind only to loopback, use a fixed endpoint with same-origin assets, validate Host, return no secrets, and set a restrictive content-security policy.

## Migration Plan

1. Delete the snapshot generator and its tests after the live dashboard and its focused tests are in place.
2. Start the local dashboard with a process-local read token; it does not alter deployed services or user data.
3. Roll back by stopping the local Node process and removing the local dashboard files; no production deployment or database rollback is required.

## Open Questions

- None for the first implementation. The page will use first-visit retention; activation- or registration-based retention needs a separate identity/data-design decision.
