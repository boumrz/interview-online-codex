# live-metrika-analytics-dashboard Specification

## Purpose
TBD - created by archiving change add-live-metrika-analytics-dashboard. Update Purpose after archive.
## Requirements
### Requirement: User can open a live private Metrika dashboard without regenerating HTML
The project SHALL provide a local Node.js command that binds only to `127.0.0.1` and serves an independent HTML analytics dashboard. When the dashboard opens, it SHALL load current metric aggregates automatically, default to the latest 90 completed Moscow days, and support a manual refresh, the fixed 30- or 90-day view, and a custom completed-day date range without generating a new HTML file or modifying interview-online's deployed frontend or backend.

#### Scenario: User opens the dashboard
- **WHEN** the user starts the local dashboard with a valid read-only Metrika token and opens its loopback URL
- **THEN** the separate HTML page automatically loads the 90-day aggregate view without a deployed product route

#### Scenario: User switches the supported view
- **WHEN** the user selects 30 days, 3 months, or a valid custom start and end date in the dashboard
- **THEN** the dashboard requests and presents aggregates for exactly that inclusive completed-day range while preserving clearly labelled DAU, WAU, and MAU windows ending on the selected end date

### Requirement: Dashboard keeps Metrika credentials and raw data outside the browser
The local dashboard server SHALL read the OAuth credential only from its process environment and SHALL use it only for fixed Reporting API requests. It SHALL bind exclusively to loopback, expose no arbitrary upstream-query endpoint, and return only normalised aggregate data and safe error states to the browser. The HTML, localhost API payloads, logs, launcher sources, command wrappers, and user-facing errors SHALL contain no OAuth token, Authorization header, raw upstream body, or raw visitor-level data. The data endpoint SHALL accept only one mutually exclusive range mode: the period enum 30 or 90, or one `start` and one `end` ISO calendar date; it SHALL accept an optional bounded refresh control and SHALL reject arbitrary dates outside one through 365 completed days, counters, metrics, dimensions, filters, duplicate query keys, or other query controls. It SHALL cache, de-duplicate, and fall back to stale data independently by canonical date range, and issue no more than two fixed upstream requests concurrently.

#### Scenario: Browser selects an allowed period
- **WHEN** the page requests the dashboard data endpoint with `period=30`, `period=90`, or a valid inclusive `start` and `end` pair
- **THEN** it receives only the fixed aggregate contract for that range and no Metrika credential or raw upstream response

#### Scenario: Browser supplies an invalid query
- **WHEN** a request includes an unsupported period, a duplicate allowed parameter, a partial, invalid, future, reversed, or overlong custom range, or another query parameter
- **THEN** the loopback server returns a safe validation error and does not issue a Metrika request

### Requirement: Owner can open the local dashboard without manually setting a terminal variable
The project SHALL provide a Windows one-click launcher that obtains the dashboard token from the current user's Windows Credential Manager, supplies it only to the local dashboard process environment, and opens the loopback dashboard URL. The credential value SHALL NOT be embedded in the launcher, its wrapper, the HTML, or a source-controlled configuration file.

#### Scenario: Owner has saved a valid local credential
- **WHEN** the owner opens the dashboard launcher
- **THEN** it starts or reuses the loopback dashboard and opens the live dashboard without asking the owner to type a token or an environment-variable command

#### Scenario: Local credential is absent
- **WHEN** the owner opens the dashboard launcher without the expected Windows Credential Manager item
- **THEN** it shows a local actionable message and does not expose or invent a credential

### Requirement: Dashboard presents accurate active-user metrics
The dashboard SHALL define active users as Metrika unique users with at least one visit, based on `ym:s:users`. It SHALL show DAU for the selected range's final completed day, rolling seven-day WAU, rolling thirty-day MAU, and a daily active-user trend for the selected 30-day, 90-day, or custom range. WAU and MAU SHALL be distinct-user counts from their respective inclusive rolling windows and SHALL NOT be sums of daily active-user values. It SHALL also show distinct active users in the selected period, total first-visit users in that period, average DAU, and a neutral comparison of average DAU in the early and recent halves of that period. The dashboard SHALL state its timezone, selected dates, end-date anchor, and the period of every displayed aggregate.

#### Scenario: User views a custom historical period
- **WHEN** Metrika returns valid reports for a custom completed-day range
- **THEN** the dashboard shows that range's daily trend and selected-period aggregates, and labels DAU, WAU, and MAU as windows ending on the selected end date

#### Scenario: Current day is incomplete
- **WHEN** the dashboard determines its reporting anchor date
- **THEN** it uses the latest completed Moscow day as the maximum allowed end date and identifies the selected end date in the UI

### Requirement: Dashboard presents daily first-visit cohort retention
The dashboard SHALL calculate first-visit, any-visit cohort retention from aggregate Reporting API rows grouped by `ym:s:date` and `ym:s:firstVisitDate`. For a cohort date C and day N, it SHALL calculate Dn retention as the distinct users active on C+N whose first visit was C divided by distinct users active on C whose first visit was C. It SHALL display D0, D1, D7, D14, and D30 for daily cohorts and SHALL distinguish a future return day from zero retention. For a selected range longer than 90 days, it SHALL calculate the retention panels from the final 90 days of that selected range and identify that narrower cohort scope in the UI.

#### Scenario: Retention return date has occurred
- **WHEN** a cohort's C+N return date is on or before the selected reporting end date and Metrika returns a valid matching aggregate row
- **THEN** the dashboard displays the calculated Dn percentage and cohort size

#### Scenario: Retention return date has not occurred or report is unavailable
- **WHEN** a cohort's C+N return date is after the selected reporting end date or the cohort report cannot be interpreted safely
- **THEN** the dashboard labels the value respectively as not yet available or unavailable and does not substitute zero

### Requirement: Dashboard documents metric names, source parameters, and data quality
The dashboard SHALL contain a visible Russian reading guide followed by a visible or expandable glossary. The guide SHALL explain, in plain language, the order in which to inspect the selected-period summary, daily trend, end-date active-user KPIs, and cohort retention. It SHALL identify observations as observations rather than causal claims. The glossary SHALL explain DAU, WAU, MAU, selected-period users, active user, new user, cohort, Dn retention, `ym:s:users`, `ym:s:newUsers`, `ym:s:date`, `ym:s:firstVisitDate`, timezone, sampling, data lag, and the browser-scoped nature of Metrika user identity. It SHALL explain the custom range limit and the retention cohort scope for ranges over 90 days. It SHALL display any available sampling fraction, reporting delay, and last successful refresh time next to the data.

#### Scenario: User needs to understand the selected result
- **WHEN** the user opens the dashboard with either a preset or custom range
- **THEN** the page explains what the selected-period summary measures, how it differs from end-date DAU/WAU/MAU, and how to read the activity and retention panels

#### Scenario: Metrika flags data quality limits
- **WHEN** any fixed report indicates sampling or a non-zero data lag
- **THEN** the dashboard presents the corresponding quality indicator with the affected data

### Requirement: Dashboard follows the supplied analytical visual direction
The dashboard SHALL use a dark, high-contrast analytical layout with a compact adaptive toolbar, a selected-period summary, DAU/WAU/MAU KPI row, D0/D1/D7/D14/D30 retention checkpoints, two aligned upper analytical panels, and a full-width daily active-user graph. It SHALL use its own local CSS/SVG and real project metric names and SHALL NOT display unsupported reference metrics or fabricated comparison values. It SHALL use an offline system font stack, tabular metric numerals, consistent two-level section surfaces, readable secondary text, and a clear type and spacing hierarchy. It SHALL provide visible keyboard focus for controls, readable integer labels for people-count axes, and shall not rely on colour alone to communicate a metric state.

#### Scenario: User views the loaded dashboard on a desktop display
- **WHEN** the dashboard receives valid aggregate data on a desktop-width display
- **THEN** the selected-period summary is the first visual focus, controls form one compact toolbar, card and chart surfaces share a consistent hierarchy, and retention panels and daily active-user trend follow the specified visual hierarchy

#### Scenario: User views the dashboard on a narrow display
- **WHEN** the viewport is 580 pixels wide or narrower
- **THEN** controls wrap without overlap, interactive targets remain usable, retention checkpoints remain readable, panels stack, and legends, labels, and the glossary remain readable

