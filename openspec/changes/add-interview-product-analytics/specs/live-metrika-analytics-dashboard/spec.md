## ADDED Requirements

### Requirement: Dashboard adds a fixed product-event aggregate contract
The local dashboard server SHALL resolve a fixed, versioned Metrika product-goal catalogue server-side and query only fixed aggregate goal metrics for the selected dashboard range. It SHALL cache goal catalogue and report data, preserve the existing request-concurrency limits, and never return OAuth credentials, raw Management API responses, numeric goal IDs, or raw upstream responses to the browser.

#### Scenario: Dashboard loads product-event metrics
- **WHEN** a valid dashboard range is requested and the product-goal catalogue is available
- **THEN** the server returns only normalised product-event signal aggregates and safe source/quality metadata for that range

#### Scenario: Counter goal cannot be resolved
- **WHEN** a required v1 goal is missing, duplicated, inactive, or its report is unavailable
- **THEN** the server marks only that signal unavailable and preserves the existing traffic dashboard response

### Requirement: Dashboard exposes curated existing Metrika goals as separate browser signals

The loopback dashboard SHALL resolve a fixed server-side catalogue of active exact-action legacy goals in addition to the v1 product goals. It SHALL group selected goals into acquisition and access, interview launch, supporting room activity, and realtime diagnostics. The browser response SHALL expose only stable keys, Russian labels, group metadata, availability state, aggregate goal reaches, and quality metadata; it SHALL NOT expose numeric goal IDs, action targets, raw Management API payloads, or arbitrary user-selected Metrika goals.

#### Scenario: Curated legacy goals are available for the selected range

- **WHEN** the dashboard resolves the approved legacy goal catalogue and loads a valid selected period
- **THEN** it shows the selected goal reaches under their product group
- **AND** it identifies them as Metrika browser-event occurrences rather than unique users, rooms, or a sequential two-sided funnel

#### Scenario: A curated legacy goal is unavailable or ambiguous

- **WHEN** an approved legacy goal is missing, duplicated, inactive, has a non-exact condition, or its report cannot be loaded
- **THEN** only that goal is rendered as unavailable with a safe explanation
- **AND** the dashboard does not replace it with zero or expose upstream configuration

#### Scenario: User opens the diagnostics catalogue

- **WHEN** the user expands the legacy-goal diagnostics catalogue
- **THEN** the dashboard presents the supporting goals grouped by meaning, with their selected-period reaches and a short Russian explanation
- **AND** the primary v1 interview path remains visually distinct from diagnostic legacy goals
