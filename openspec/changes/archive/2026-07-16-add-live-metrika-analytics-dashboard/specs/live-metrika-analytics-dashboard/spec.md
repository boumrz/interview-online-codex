## ADDED Requirements

### Requirement: User can open a live private Metrika dashboard without regenerating HTML
The project SHALL provide a local Node.js command that binds only to `127.0.0.1` and serves an independent HTML analytics dashboard. When the dashboard opens, it SHALL load current metric aggregates automatically and SHALL support a manual refresh without generating a new HTML file or modifying interview-online's deployed frontend or backend.

#### Scenario: User opens the dashboard
- **WHEN** the user starts the local dashboard with a valid read-only Metrika token and opens its loopback URL
- **THEN** the separate HTML page loads analytics data automatically without a deployed product route

#### Scenario: Local process is not available
- **WHEN** the user attempts to open the loopback URL while the local dashboard process is stopped
- **THEN** no deployed interview-online feature or Metrika credential is exposed as a fallback

### Requirement: Dashboard keeps Metrika credentials and raw data outside the browser
The local dashboard server SHALL read the OAuth credential only from its process environment and SHALL use it only for fixed Reporting API requests. It SHALL bind exclusively to loopback, expose no arbitrary upstream-query endpoint, and return only normalised aggregate data and safe error states to the browser. The HTML, localhost API payloads, logs, launcher sources, command wrappers, and user-facing errors SHALL contain no OAuth token, Authorization header, raw upstream body, or raw visitor-level data.

#### Scenario: Browser loads dashboard data
- **WHEN** the page requests its dashboard-data endpoint
- **THEN** it receives only the fixed aggregate metric contract and no Metrika credential or raw upstream response

#### Scenario: Metrika rejects or delays a request
- **WHEN** the Reporting API returns an authorization, quota, malformed-response, timeout, or temporary error
- **THEN** the dashboard presents a safe actionable state and does not display invented zero values or the raw upstream error

### Requirement: Owner can open the local dashboard without manually setting a terminal variable
The project SHALL provide a Windows one-click launcher that obtains the dashboard token from the current user's Windows Credential Manager, supplies it only to the local dashboard process environment, and opens the loopback dashboard URL. The credential value SHALL NOT be embedded in the launcher, its wrapper, the HTML, or a source-controlled configuration file.

#### Scenario: Owner has saved a valid local credential
- **WHEN** the owner opens the dashboard launcher
- **THEN** it starts or reuses the loopback dashboard and opens the live dashboard without asking the owner to type a token or an environment-variable command

#### Scenario: Local credential is absent
- **WHEN** the owner opens the dashboard launcher without the expected Windows Credential Manager item
- **THEN** it shows a local actionable message and does not expose or invent a credential

### Requirement: Dashboard presents accurate active-user metrics
The dashboard SHALL define active users as Metrika unique users with at least one visit, based on `ym:s:users`. It SHALL show DAU for the latest completed day, rolling seven-day WAU, rolling thirty-day MAU, and a daily active-user trend. WAU and MAU SHALL be distinct-user counts from their respective inclusive windows and SHALL NOT be sums of daily active-user values. The dashboard SHALL state its timezone and as-of date.

#### Scenario: User views latest active-user metrics
- **WHEN** Metrika returns valid reports for the latest completed day
- **THEN** the dashboard shows DAU, WAU, and MAU together with the applicable date windows and a 30-day daily active-user trend

#### Scenario: Current day is incomplete
- **WHEN** the dashboard determines its reporting anchor date
- **THEN** it uses the latest completed day for KPI cards and identifies the day in the UI

### Requirement: Dashboard presents daily first-visit cohort retention
The dashboard SHALL calculate first-visit, any-visit cohort retention from aggregate Reporting API rows grouped by `ym:s:date` and `ym:s:firstVisitDate`. For a cohort date C and day N, it SHALL calculate Dn retention as the distinct users active on C+N whose first visit was C divided by distinct users active on C whose first visit was C. It SHALL display D0, D1, D7, D14, and D30 for daily cohorts and SHALL distinguish a future return day from zero retention.

#### Scenario: Retention return date has occurred
- **WHEN** a cohort's C+N return date is on or before the reporting anchor date and Metrika returns a valid matching aggregate row
- **THEN** the dashboard displays the calculated Dn percentage and cohort size

#### Scenario: Retention return date has not occurred or report is unavailable
- **WHEN** a cohort's C+N return date is after the reporting anchor date or the cohort report cannot be interpreted safely
- **THEN** the dashboard labels the value respectively as not yet available or unavailable and does not substitute zero

### Requirement: Dashboard documents metric names, source parameters, and data quality
The dashboard SHALL contain a visible or expandable Russian glossary that explains DAU, WAU, MAU, active user, new user, cohort, Dn retention, `ym:s:users`, `ym:s:newUsers`, `ym:s:date`, `ym:s:firstVisitDate`, timezone, sampling, data lag, and the browser-scoped nature of Metrika user identity. It SHALL display any available sampling fraction, reporting delay, and last successful refresh time next to the data.

#### Scenario: User needs to interpret a metric
- **WHEN** the user opens the metric glossary on the dashboard
- **THEN** the page explains the human-readable definition, source parameter, formula or window, and relevant limitation for each displayed metric

#### Scenario: Metrika flags data quality limits
- **WHEN** any fixed report indicates sampling or a non-zero data lag
- **THEN** the dashboard presents the corresponding quality indicator with the affected data

### Requirement: Dashboard follows the supplied analytical visual direction
The dashboard SHALL use a dark, high-contrast analytical layout with a compact header, DAU/WAU/MAU KPI row, D0/D1/D7/D14/D30 retention checkpoints, two aligned upper analytical panels, and a full-width daily active-user graph. It SHALL use its own CSS/SVG and real project metric names and SHALL NOT display unsupported reference metrics or fabricated comparison values.

#### Scenario: User views the loaded dashboard on a desktop display
- **WHEN** the dashboard receives valid aggregate data
- **THEN** the primary KPIs, retention checkpoints, retention panels, and daily active-user trend follow the specified visual hierarchy

#### Scenario: User views the dashboard on a narrow display
- **WHEN** the viewport cannot fit the two analytical panels side by side
- **THEN** the panels stack while keeping legends, labels, and the glossary readable
