## ADDED Requirements

### Requirement: Local dashboard presents Metrika product-event signals separately from product outcomes
The loopback dashboard SHALL show a labelled interview event-signal funnel and realtime diagnostic section in addition to the existing audience metrics. Each signal SHALL identify Metrika as its source, show the metric unit and denominator where applicable, and state that browser events are not unique rooms or an ordered two-person funnel.

#### Scenario: New product goals have aggregate data
- **WHEN** the dashboard loads a selected period after configured Metrika product goals have data
- **THEN** it displays room-created, candidate-joined, activity, verdict, and reliability signals with source and data-quality labels

#### Scenario: Goal or backend aggregate is unavailable
- **WHEN** a configured goal is absent, data is not yet processed, or an authoritative backend aggregate is unavailable
- **THEN** the dashboard displays an explicit unavailable state and does not render the metric as zero

### Requirement: Dashboard guides product interpretation
The dashboard SHALL place outcome and funnel interpretation ahead of browser DAU/WAU/MAU, preserve the existing audience section as supporting context, and explain in Russian the definitions of decision-ready interview, prepared room, candidate attendance, meaningful activity, interviewer retention, source badges, and the limits of Metrika identity.

#### Scenario: User opens the dashboard
- **WHEN** the user opens the default 90-day dashboard view
- **THEN** the page identifies which metrics are browser signals and which are authoritative room aggregates before presenting audience retention
