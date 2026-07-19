## ADDED Requirements

### Requirement: Server records a privacy-safe interview lifecycle projection
The backend SHALL maintain at most one product-metrics projection for each room. The projection SHALL contain only internal room linkage, bounded categorical attributes, lifecycle timestamps, and bounded reliability counters; it SHALL NOT contain invite codes, user or session identifiers, names, code, keystrokes, paste previews, task text, notes, verdict comments, OAuth credentials, or raw error messages.

#### Scenario: A room is created with prepared tasks
- **WHEN** a room is successfully created with one or more tasks
- **THEN** the backend creates its product-metrics projection with the creation time, safe creation source, initial task count, and prepared-room state

#### Scenario: A candidate first joins a room
- **WHEN** the realtime service accepts a participant with the effective candidate role
- **THEN** the backend records the first candidate-join timestamp once for that room
- **AND** repeated reconnects do not change that timestamp or create another projection

#### Scenario: A verdict is amended
- **WHEN** an authorised interviewer saves a verdict after a prior verdict already exists
- **THEN** the backend preserves the first-verdict timestamp
- **AND** records the latest-verdict timestamp separately

### Requirement: Product metrics use defined room and interviewer outcomes
The backend SHALL calculate decision-ready technical interviews as unique rooms with first candidate attendance, first meaningful candidate activity, and a first persisted verdict. It SHALL calculate active and retained interviewers only from authenticated room owners or interviewer participants and SHALL not label browser visitors or candidate visits as interviewer retention.

#### Scenario: A room reaches the decision-ready outcome
- **WHEN** a room has all three required lifecycle facts in the selected completed-day range
- **THEN** its aggregate contributes exactly once to decision-ready technical interviews

#### Scenario: A candidate only opens or reconnects to a room
- **WHEN** a room has no persisted meaningful activity or first verdict
- **THEN** it does not contribute to the decision-ready interview count

### Requirement: Administrator product metrics are aggregate-only and range-bounded
The backend SHALL provide an administrator-authorised product-metrics aggregate endpoint accepting only an inclusive `start` and `end` ISO date range of one through 365 completed Moscow days. Its response SHALL contain only documented aggregate counts, rates, percentiles, daily aggregate series, source/freshness metadata, and unavailable states.

#### Scenario: Administrator requests a valid aggregate range
- **WHEN** an authorised administrator requests a valid completed-day range
- **THEN** the endpoint returns the product funnel, decision-ready outcome, interviewer activation and repeat-use aggregates, and reliability denominators without any room- or person-level identifiers

#### Scenario: Unauthorised or invalid request
- **WHEN** a request is unauthorised or has a partial, future, reversed, overlong, duplicate, or unsupported range parameter
- **THEN** the endpoint rejects it without returning product aggregates or issuing an arbitrary data query
