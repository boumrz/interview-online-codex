## MODIFIED Requirements

### Requirement: Yandex Metrika runs on production migration domains

The frontend SHALL initialize the existing Yandex Metrika counter on the accepted production domains and SHALL keep local development hosts blocked by default. It SHALL not transmit full room URLs, invite codes, query strings, navigation targets, interview content, or raw error text, and it SHALL keep Webvisor disabled on routes where interview content can be displayed or entered.

#### Scenario: New production domain initializes Metrika

- **WHEN** the app is opened on `https://interview.vtools.tech/`
- **THEN** the frontend initializes the Yandex Metrika counter
- **AND** page views and approved goals can be sent through that counter using safe route templates

#### Scenario: Legacy production domain initializes Metrika

- **WHEN** the app is opened on `https://interview.domiknote.ru/`
- **THEN** the frontend initializes the same Yandex Metrika counter
- **AND** page views and approved goals can be sent through that counter using safe route templates

#### Scenario: Localhost stays blocked by default

- **WHEN** the app is opened on `http://localhost`
- **THEN** the frontend does not initialize Yandex Metrika by default

#### Scenario: Counter identity stays unchanged

- **WHEN** analytics is initialized on either accepted production domain
- **THEN** the frontend uses the existing Yandex Metrika counter ID

#### Scenario: User opens an invite-bearing room URL

- **WHEN** the frontend records its page view or an analytics event from a room route
- **THEN** it sends the route class `/room/:invite` and permitted low-cardinality fields only
- **AND** it does not send the invite value, query string, or redirect destination

## ADDED Requirements

### Requirement: Client analytics uses an allowlisted product event catalogue
The frontend SHALL emit only approved product-event targets and allowlisted primitive payload fields. Event payloads SHALL use controlled low-cardinality values and SHALL reject or omit sensitive, unrecognised, free-text, or oversized values. Existing legacy technical events SHALL remain available as diagnostics during the v1 transition.

#### Scenario: Product lifecycle event is emitted
- **WHEN** a client lifecycle event is eligible for Metrika reporting
- **THEN** it uses its exact versioned catalogue target and permitted payload fields
- **AND** it contains no room, invite, person, session, code, note, verdict-comment, URL, or raw error value

### Requirement: Metrika conversion goals are versioned and verified
The project SHALL preserve existing counter goals and SHALL create verified versioned goals for candidate join, meaningful candidate activity, and verdict save. Interview start and productive completion SHALL remain server-only lifecycle facts, and existing realtime goals SHALL remain diagnostics. Numeric goal IDs are non-secret configuration and SHALL be resolved or used only by the local dashboard server.

#### Scenario: Counter accepts a new v1 goal
- **WHEN** an authorised Management API write creates a v1 goal
- **THEN** the project reads it back and verifies its target, type, condition, name, and active status before it is used in dashboard reporting
