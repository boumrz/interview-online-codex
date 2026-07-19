## MODIFIED Requirements

### Requirement: User can open a live private Metrika dashboard without regenerating HTML
The project SHALL provide a local Node.js command that binds only to `127.0.0.1` and serves an independent HTML analytics dashboard. When the dashboard opens, it SHALL load current metric aggregates automatically, default to the latest 90 completed days, and support a manual refresh and a choice of the fixed 30- or 90-day view without generating a new HTML file or modifying interview-online's deployed frontend or backend.

#### Scenario: User opens the dashboard
- **WHEN** the user starts the local dashboard with a valid read-only Metrika token and opens its loopback URL
- **THEN** the separate HTML page automatically loads the 90-day aggregate view without a deployed product route

#### Scenario: User switches the supported view
- **WHEN** the user selects 30 days or 3 months in the dashboard
- **THEN** the dashboard requests and presents aggregates for exactly that completed-day range while preserving the defined current WAU and MAU windows

### Requirement: Dashboard keeps Metrika credentials and raw data outside the browser
The local dashboard server SHALL read the OAuth credential only from its process environment and SHALL use it only for fixed Reporting API requests. It SHALL bind exclusively to loopback, expose no arbitrary upstream-query endpoint, and return only normalised aggregate data and safe error states to the browser. The HTML, localhost API payloads, logs, launcher sources, command wrappers, and user-facing errors SHALL contain no OAuth token, Authorization header, raw upstream body, or raw visitor-level data. The data endpoint SHALL accept only the period enum 30 or 90 and an optional bounded refresh control; it SHALL reject arbitrary dates, counters, metrics, dimensions, filters, duplicate query keys, or other query controls. It SHALL cache, de-duplicate, and fall back to stale data independently by validated period, and issue no more than two fixed upstream requests concurrently.

#### Scenario: Browser selects an allowed period
- **WHEN** the page requests the dashboard data endpoint with `period=30` or `period=90`
- **THEN** it receives only the fixed aggregate contract for that period and no Metrika credential or raw upstream response

#### Scenario: Browser supplies an invalid query
- **WHEN** a request includes an unsupported period, a duplicate allowed parameter, or another query parameter
- **THEN** the loopback server returns a safe validation error and does not issue a Metrika request

### Requirement: Dashboard presents accurate active-user metrics
The dashboard SHALL define active users as Metrika unique users with at least one visit, based on `ym:s:users`. It SHALL show DAU for the latest completed day, rolling seven-day WAU, rolling thirty-day MAU, and a daily active-user trend for the selected 30- or 90-day range. WAU and MAU SHALL be distinct-user counts from their respective inclusive rolling windows and SHALL NOT be sums of daily active-user values. It SHALL also show distinct active users in the selected period, total first-visit users in that period, average DAU, and a neutral comparison of average DAU in the early and recent halves of that period. The dashboard SHALL state its timezone, as-of date, and the period of every displayed aggregate.

#### Scenario: User views the default three-month period
- **WHEN** Metrika returns valid reports for the default 90-day range
- **THEN** the dashboard shows the 90-day daily trend, the selected-period aggregates, and the current DAU/WAU/MAU together with unambiguous date windows

#### Scenario: Current day is incomplete
- **WHEN** the dashboard determines its reporting anchor date
- **THEN** it uses the latest completed day for all selected-period ranges and identifies that day in the UI

### Requirement: Dashboard documents metric names, source parameters, and data quality
The dashboard SHALL contain a visible Russian reading guide followed by a visible or expandable glossary. The guide SHALL explain, in plain language, the order in which to inspect the selected-period summary, daily trend, current active-user KPIs, and cohort retention. It SHALL identify observations as observations rather than causal claims. The glossary SHALL explain DAU, WAU, MAU, selected-period users, active user, new user, cohort, Dn retention, `ym:s:users`, `ym:s:newUsers`, `ym:s:date`, `ym:s:firstVisitDate`, timezone, sampling, data lag, and the browser-scoped nature of Metrika user identity. It SHALL display any available sampling fraction, reporting delay, and last successful refresh time next to the data.

#### Scenario: User needs to understand the three-month result
- **WHEN** the user opens the dashboard with the default period
- **THEN** the page explains what the three-month summary measures, how it differs from current DAU/WAU/MAU, and how to read the activity and retention panels

#### Scenario: Metrika flags data quality limits
- **WHEN** any fixed report indicates sampling or a non-zero data lag
- **THEN** the dashboard presents the corresponding quality indicator with the affected data
