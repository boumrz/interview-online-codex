## 1. Replace the snapshot workflow

- [x] 1.1 Remove the superseded manual HTML generator and its focused tests without changing deployed analytics tracking or unrelated worktree files.
- [x] 1.2 Add a separately runnable, loopback-only Node.js dashboard server and static dashboard assets outside the deployed product.
- [x] 1.3 Add a Windows Credential Manager-backed, one-click local launcher that keeps the token out of source and command-line arguments.

## 2. Implement protected live metric retrieval

- [x] 2.1 Read the Metrika read token only from the local process environment; bind only to `127.0.0.1`, serve a fixed same-origin data contract, and prevent token/raw-error/upstream-query exposure.
- [x] 2.2 Retrieve and normalise fixed Reporting API reports for latest-completed-day DAU, rolling 7-day WAU, rolling 30-day MAU, and a 30-day daily active/new-user trend with timezone, sampling, and data-lag metadata.
- [x] 2.3 Retrieve and validate the date/first-visit-date aggregate matrix; calculate D0, D1, D7, D14, and D30 first-visit cohort retention without converting unavailable or future values to zero.
- [x] 2.4 Add timeout, safe 401/403/420/network/malformed-response states, a five-minute in-memory cache, and single-flight refresh protection.

## 3. Present and document the metrics

- [x] 3.1 Build the automatically refreshing HTML view with DAU, WAU, MAU, daily active-user chart, daily cohort retention table, last-refresh state, and data-quality indicators.
- [x] 3.2 Add a Russian on-page glossary that maps every visible metric to its Metrika parameter, formula/window, timezone, sampling/data-lag meaning, and user-identity limitation.
- [x] 3.3 Implement the supplied dark analytical visual direction with responsive KPI/checkpoint/panel hierarchy, original CSS/SVG, and no fabricated reference metrics.

## 4. Verify

- [x] 4.1 Add focused tests using fixtures for window calculations, retention matrix, safe API parsing/error states, token exclusion, cache/single-flight behaviour, loopback binding, and dashboard static assets.
- [x] 4.2 Validate the fixed Reporting API requests against the authorised existing counter without logging secrets or raw visitor data; record only aggregate compatibility results.
- [x] 4.3 Run dashboard tests, proportionate frontend/backend regression checks, `openspec validate add-live-metrika-analytics-dashboard --strict`, and update completed task checkboxes.
- [x] 4.4 Verify launcher behaviour with a local Windows credential and confirm that no dashboard asset, launcher source, or safe API response contains the token.
