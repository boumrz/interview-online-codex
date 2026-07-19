## Why

The project collects useful product events in Yandex Metrika, but the native reporting UI is hard to read quickly. The requested deliverable is a portable HTML report for personal use, not another screen inside interview-online.

## What Changes

- Add a local Node.js generator that reads fixed aggregated metrics from the Yandex Metrika Reporting API and writes one self-contained HTML report to the ignored `analytics/` directory.
- Render traffic KPIs, a daily trend chart, configured product-goal conversions, and reporting-quality indicators directly in the generated HTML.
- Read the OAuth token and optional goal IDs only from the generator process environment; never add a product route, backend endpoint, deployment secret, or browser-side credential.
- Remove the previously proposed application page and server-side dashboard integration from this change.

## Capabilities

### New Capabilities

- `product-metrics-report`: Generates a portable, static product-metrics HTML report from a server-side/local Yandex Metrika API credential.

### Modified Capabilities

- None.

## Impact

- A new root-level Node.js utility and a generated local HTML artifact under `analytics/`.
- No changes to the deployed frontend, backend, authentication, API surface, database, or existing client-side Metrika tracking.
- The report generator requires a local `METRIKA_OAUTH_TOKEN` with read-only access to the existing counter and optional numeric IDs for configured Metrika goals.
