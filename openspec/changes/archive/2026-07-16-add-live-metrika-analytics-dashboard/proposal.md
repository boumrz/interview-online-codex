## Why

The current static Metrika report is a snapshot, so it becomes stale and requires manual regeneration. The owner needs an independent page that always loads current product-usage data without adding analytics access or a route to interview-online itself.

## What Changes

- Replace the manual snapshot workflow with a local, loopback-only live dashboard. Its separate HTML page automatically requests normalised aggregates from a local Node.js process when it opens and on an explicit refresh.
- Use the Yandex Metrika Reporting API to show daily active users (DAU), current rolling WAU and MAU, a daily active-user trend, and daily first-visit cohort retention for D1, D7, D14, and D30.
- Keep the read-only OAuth token only in the local process environment. The dashboard HTML and its localhost API responses never contain a token, arbitrary upstream query controls, raw upstream response bodies, or raw errors.
- Provide an opt-in Windows one-click launcher that reads the local token from Windows Credential Manager and starts the loopback process without requiring the owner to set environment variables manually. The launcher source, HTML, and repository never contain the token.
- Add a built-in Russian glossary that describes each metric, its Reporting API parameter, the retention formula, timezone, data freshness, sampling, and the difference between a Metrika user and a product account.
- Use the supplied dashboard reference as the visual direction: a dark desktop-first analytical canvas, compact KPI row, retention checkpoints, two upper analytical panels, and a prominent DAU trend. Only the layout and visual hierarchy are referenced; labels and values remain specific to the project's real metrics.
- Remove the superseded manual-report generator and its focused tests; do not modify the deployed frontend, backend, database, or Metrika tracking code.

## Capabilities

### New Capabilities

- `live-metrika-analytics-dashboard`: Provides a local live analytics dashboard with protected Metrika access, active-user metrics, cohort retention, and metric documentation.

### Modified Capabilities

- None.

## Impact

- Adds root-level local Node.js dashboard assets and focused tests.
- Replaces the earlier root-level snapshot generator only; the ignored `analytics/` output is no longer required.
- Calls the Yandex Metrika Reporting API with a local `METRIKA_OAUTH_TOKEN` that has `metrika:read` access.
- Adds a local-only Windows Credential Manager entry and launcher outside the deployed application; neither is part of production configuration.
- Does not change deployed application routes, backend endpoints, public APIs, databases, or client-side Metrika event collection.
