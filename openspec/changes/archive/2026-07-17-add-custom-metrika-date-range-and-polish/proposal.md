## Why

The dashboard currently offers only 30- and 90-day presets, so an owner cannot inspect a specific campaign, release, or historical interval. Its information architecture is useful but the visual rhythm, typography, and chart presentation need a final polish to make the metrics easier to scan.

## What Changes

- Add an explicit custom start/end date mode while keeping the three-month view as the default.
- Permit any inclusive completed-day interval from one to 365 days; reject malformed, reversed, future, and overlong ranges locally before any Metrika request.
- Keep all activity and selected-period aggregates anchored to the selected end date. For ranges longer than 90 days, label retention as calculated from the final 90 days of cohorts so the protected aggregate query remains bounded.
- Preserve the loopback-only, fixed-query, no-token browser contract and isolate caching, refresh limiting, and in-flight loads by canonical date range.
- Refine the standalone HTML dashboard's type scale, spacing, card hierarchy, control states, chart legibility, colour contrast, and narrow-screen layout without adding a UI framework.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `live-metrika-analytics-dashboard`: support a validated custom completed-day date range and establish the visual/readability requirements for the local dashboard.

## Impact

- `scripts/metrika-dashboard-core.mjs`: validated date-window construction, bounded retention scope, cache keys, and aggregate metadata.
- `scripts/serve-metrika-dashboard.mjs`: allowlist and validate the date-range query contract.
- `scripts/metrika-dashboard-ui/`: date controls, URL construction, explanatory labels, and visual-system refinements.
- `scripts/metrika-dashboard-core.test.mjs`: date parsing, server validation, cache isolation, and UI contract coverage.
