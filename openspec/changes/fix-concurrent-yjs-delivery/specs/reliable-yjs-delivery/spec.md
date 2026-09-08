## Purpose

Keep every authorized participant's shared interview code consistent when concurrent editing overlaps delayed event delivery or a recoverable connection interruption.

## ADDED Requirements

### Requirement: Concurrent participants converge without losing incremental edits

The system SHALL preserve incremental shared-editor changes produced in a valid, unchanged room/workspace session. After editing stops and delivery recovers, every participant following that workspace SHALL converge to the same document, including every test edit exactly once. Delivery SHALL NOT require a user to refresh the page or retype missing changes. A periodic synchronization message SHALL NOT erase, supersede or interrupt an undelivered incremental change merely because both are editor messages.

Acceptance-test level: E2E, with real browser keyboard input and independently inspected editor models. A deterministic delayed-request E2E is required in addition to the existing ten-participant reproduction.

#### Scenario: Seven candidates type concurrently in a ten-participant room

- **WHEN** an owner, an interviewer, an assigned HR participant and seven candidates follow the same published task and every candidate types 100 identifying characters in each of three overlapping rounds
- **THEN** all ten editor models eventually contain the same document and all 300 characters from each candidate, without duplicated inserted characters
- **AND** candidate reconnect and manager disconnect/recovery during the workload do not cause any participant to retain a divergent document
- **AND** the existing exact activity UUID, download and candidate privacy assertions continue to pass

#### Scenario: A heartbeat overlaps a delayed incremental update

- **WHEN** relay delivery of a browser-generated incremental edit is delayed until at least one periodic synchronization message and subsequent dependent edits have been generated
- **THEN** the earlier edit remains deliverable and is not cancelled or removed by that synchronization message
- **AND** after delivery resumes, a second participant displays the complete final code without waiting for a manual reload

### Requirement: Backlog and uncertain delivery preserve the document

The client SHALL NOT silently evict still-applicable incremental document changes when a delivery backlog grows. An uncertain outcome SHALL retain the existing mutation identity for retry, and retries SHALL NOT duplicate document content. Later dependent updates SHALL NOT bypass an unresolved predecessor from the same client in a way that loses content.

Acceptance-test level: E2E through a deliberately held browser relay with more than 300 actual incremental updates and independent editor-model reconstruction. If a pure queue helper is justified during implementation, a focused unit/integration exception may additionally exercise its transitions with real Yjs updates; extracting a new module solely for testing is not required.

#### Scenario: More than 300 incremental updates accumulate

- **WHEN** at least 301 dependent incremental updates are queued while their delivery is held and replaceable synchronization messages are interleaved
- **THEN** releasing the queue reconstructs the complete source document from the delivered updates with no missing or duplicated content
- **AND** the outstanding document changes are not removed solely because a message-count threshold was reached

#### Scenario: An accepted update has an uncertain response

- **WHEN** an update is accepted but its response is lost and the sender retries after a recoverable interruption
- **THEN** the retry represents the same original mutation identity
- **AND** a receiving document contains the mutation exactly once and also receives subsequent dependent changes

#### Scenario: A slow relay accumulates a typing burst

- **WHEN** a candidate types the existing slow-network canary while each relay delivery is delayed by 3,000ms, or the sender uses the existing 800ms CDP network latency profile
- **THEN** the owner and watcher receive the complete canary within the existing respective 30-second and 15-second recovery deadlines
- **AND** adjacent compatible updates that have never been attempted may be merged losslessly into a single delivery envelope before its first dispatch, without crossing another queued action or workspace boundary
- **AND** once an envelope is attempted, its delta bytes, operation identity, sequences and snapshot metadata remain unchanged through uncertain-response retries, even while newer edits are queued

### Requirement: Recovery retains only changes valid for the current workspace and access

Recoverable transport interruption within a still-authorized, unchanged room/workspace session SHALL retain pending incremental changes and merge authoritative recovery state without erasing valid local edits. Delivery SHALL remain bound to the original room, task/workspace context and mutation sequence. Pending changes from an obsolete task or closed session SHALL NOT modify a replacement workspace. The existing bounded authorization recovery contract SHALL remain enforced by both the client transport and server authorization checks.

Acceptance-test level: E2E for recoverable SSE interruption, task switching and terminal authorization recovery; focused integration tests may exercise duplicate/rejected relay requests and server snapshot fences. Existing regression harnesses are acceptable when they assert the complete corresponding behavior.

#### Scenario: Candidate reconnects with an unacknowledged edit

- **WHEN** a candidate has valid pending edits and their SSE stream reconnects while the published workspace and authorization remain unchanged
- **THEN** those edits remain visible locally and eventually become visible to the other participants after recovery
- **AND** the recovered candidate receives remote changes that occurred during the gap, yielding the same complete document

#### Scenario: A task changes while an old task update is pending

- **WHEN** an old task's pending update is delayed and the authoritative room switches to a different task
- **THEN** delivery or retry of that old update does not alter the new task's code
- **AND** the new task can continue to synchronize without an obsolete queue item causing permanent blockage

#### Scenario: Room access fails terminally

- **WHEN** the same queued event is rejected with 403 again after the single permitted authorization recovery attempt
- **THEN** the client stops the transport and further delivery attempts for that session
- **AND** neither queued code nor activity is delivered after terminal access failure

### Requirement: Delivery repair preserves authoritative snapshots and room privacy

The system SHALL retain its server-authoritative step/workspace and snapshot freshness checks. A stale full snapshot SHALL NOT replace newer accepted code merely to compensate for lost incremental updates. Reconnect SHALL NOT widen workspace visibility, grant a candidate manager data or let an HR account flag bypass a room-role permission check.

Acceptance-test level: existing targeted API/integration tests for stale-snapshot acceptance and authorization are proportionate because these are server contracts; E2E refresh/join and candidate-privacy checks verify their user-visible consequences.

#### Scenario: A stale client submits a full snapshot after concurrent editing

- **WHEN** another participant has advanced the server's accepted shared document and an older snapshot is submitted
- **THEN** existing freshness validation prevents it from overwriting the newer accepted state
- **AND** a refreshed or newly joined authorized participant receives the converged current document

#### Scenario: Candidate delivery recovers in a room with HR and interviewers

- **WHEN** a candidate's valid editor transport recovers while managers hold private activity history or private task workspaces
- **THEN** the candidate receives only the room data authorized for their actual room role
- **AND** private activity history remains absent from candidate HTTP/SSE payloads and forbidden through direct history/export requests
