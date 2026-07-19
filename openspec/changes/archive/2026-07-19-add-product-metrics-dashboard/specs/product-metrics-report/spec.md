## ADDED Requirements

### Requirement: User can generate a standalone product-metrics HTML report
The project SHALL provide a local Node.js command that generates one self-contained HTML report from the configured Yandex Metrika counter. The command SHALL support 7-day, 30-day, and 90-day periods and SHALL write the report under `analytics/` by default unless the user supplies an output path.

#### Scenario: User generates the default report
- **WHEN** the user provides a valid local Metrika credential and runs the generator without a period option
- **THEN** the generator writes a 30-day standalone HTML report under `analytics/`

#### Scenario: User selects a supported period
- **WHEN** the user runs the generator with `--period=7d`, `--period=30d`, or `--period=90d`
- **THEN** the generated report contains exactly that reporting period

#### Scenario: User supplies an unsupported period
- **WHEN** the user runs the generator with any other period value
- **THEN** the generator exits with a validation error and does not write a report

### Requirement: Generated report presents readable fixed product metrics
The generated HTML SHALL display aggregate users, sessions, page views, a daily traffic trend, configured product-goal conversions, report dates, generation time, and available sampling/data-lag indicators. It SHALL label a product goal without a configured numeric goal ID as unavailable instead of displaying zero.

#### Scenario: Counter has configured product goals
- **WHEN** approved numeric goal IDs are available in the generator environment
- **THEN** the report displays their conversions and session-based conversion rates

#### Scenario: Counter goal mapping is absent
- **WHEN** a fixed product event has no numeric goal ID in the generator environment
- **THEN** the report labels the event unavailable and explains that its Metrika goal must be configured

#### Scenario: Report maps to an emitted client event
- **WHEN** the user provides a numeric goal ID for a funnel step
- **THEN** that step corresponds to a named event already emitted by the client-side Metrika integration

### Requirement: Credentials stay outside the generated report and deployed product
The generator SHALL read its Metrika credential only from its local process environment. The generated HTML SHALL contain no token and SHALL not call Metrika after it is opened. The deployed frontend, backend, deployment configuration, and public API surface SHALL remain unchanged by this capability.

#### Scenario: User opens a generated report
- **WHEN** the user opens the generated HTML file in a browser without a server
- **THEN** the report renders its embedded metrics without requesting an OAuth credential or Metrika API data

#### Scenario: Generator credential is absent or an API response is malformed
- **WHEN** the local token is absent or Metrika returns an invalid/unavailable report
- **THEN** the generator exits with a safe error and does not write an incomplete report
