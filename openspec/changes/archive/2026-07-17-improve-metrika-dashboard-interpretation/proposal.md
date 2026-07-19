## Why

The live dashboard is technically accurate but difficult for a non-analyst to interpret. It always starts with a 30-day trend, while the owner needs a three-month view and a clear answer to two questions: what each value means, and what changed in the product over the selected period.

## What Changes

- Make the default dashboard period 90 completed days (three months) and add an explicit switch between the supported 30- and 90-day views.
- Extend the fixed, localhost-only aggregate contract with selected-period unique users, total new users, average DAU, and a within-period early-versus-recent activity comparison.
- Keep the existing last-completed-day DAU, rolling WAU, rolling MAU, daily trend, and first-visit cohort retention, but label which values describe the latest day/window and which describe the selected period.
- Add a plain-Russian reading guide and a short, data-driven period summary in the HTML. The summary must distinguish observations from causal claims and identify the scope and limitations of Metrika users and first-visit retention.
- Keep only the fixed 30/90 period options; do not add arbitrary date ranges, browser-side Metrika requests, or token exposure.

## Capabilities

### Modified Capabilities

- `live-metrika-analytics-dashboard`: Adds a constrained 30/90-day selector, three-month default, selected-period aggregates, and plain-language interpretation.

## Impact

- Updates only the root-level local dashboard server, its static assets, and focused tests.
- Makes a small number of additional fixed Reporting API aggregate requests; per-period cache and single-flight protection continue to apply.
- Does not modify the deployed interview platform, Metrika collection, user data, OAuth permissions, or Windows credential-storage approach.
