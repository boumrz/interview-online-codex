## Purpose

Allow authorized interview managers to review all retained candidate activity
without loss caused by a recent-history window, realtime reconnection, or
transient delivery failure.

## ADDED Requirements

### Requirement: All retained interview activity is accessible through bounded history pages

An authorized room manager SHALL be able to review every retained individual
candidate activity event for the room from the Activity Timeline. Initial entry
SHALL show the latest available history page and SHALL expose a discoverable
older-history action while older events remain. A history response SHALL contain
at most 200 individual events. Page limits, the bounded SSE recent tail, and
timeline grouping SHALL NOT delete durable records or impose a total review cap.
Individual JSON and CSV exports SHALL retain their existing fields and include
all retained events independently of which timeline pages have been loaded.

Pre-implementation acceptance-test level: **E2E** for review and raw downloads;
supplemented by a **backend integration exception** for complete cursor traversal
and row-count equality beyond multiple pages without browser fixture overhead.

#### Scenario: An interview exceeds both the former recent limit and one history page
- **GIVEN** a room has 451 retained candidate activity events
- **WHEN** an authorized manager opens the Activity Timeline and loads all older pages
- **THEN** all 451 source identities are available exactly once in the timeline projection
- **AND** every history response contains at most 200 individual events
- **AND** the oldest activity remains accessible and no older-history action remains after exhaustion

#### Scenario: Export is independent of loaded pages
- **GIVEN** the manager has loaded only the newest page of a longer interview
- **WHEN** the manager downloads JSON and CSV activity exports
- **THEN** each export contains all retained source events in its existing canonical order
- **AND** grouping and paging do not alter individual source IDs, sequences, or event fields

### Requirement: History reconciliation preserves loaded events across snapshots and reconnects

For the same authorized room context, the client SHALL reconcile history pages,
recent snapshots, and live activity by stable source identity rather than replace
loaded history with a bounded snapshot. Repeated, overlapping, late, or empty
recent snapshots SHALL NOT erase successfully loaded history. On initial manager
entry, reconnection, or regained manager permission, the client SHALL reconcile
with durable history and recover events accepted while its stream was unavailable,
including a gap larger than one page. A live event received during catch-up SHALL
not advance the completed catch-up boundary past still-unfetched events.
While the manager activity panel is open and authorized, the client SHALL begin
the next serialized catch-up cycle within five seconds after its preceding cycle
finishes, so an otherwise healthy stream with a missed activity message does not
leave the timeline permanently stale. Initial reads, older-page reads, and
catch-up reads SHALL not overlap within the same client room-history context.

Pre-implementation acceptance-test level: **E2E** for retained visible history,
reconnect catch-up, and live continuity; supplemented by a **unit exception** for
exhaustive merge permutations that are disproportionately difficult to schedule
through a browser.

#### Scenario: A bounded or empty snapshot arrives after earlier history is loaded
- **GIVEN** a manager has loaded more than 50 source events
- **WHEN** a room update supplies a recent subset or empty recent activity array
- **THEN** previously loaded source events remain available
- **AND** the client obtains authoritative durable history without presenting the snapshot as deletion

#### Scenario: Manager reconnect spans more events than fit in a page
- **GIVEN** the manager has a previously confirmed history boundary
- **WHEN** at least 201 further source events are accepted while its SSE connection is interrupted
- **AND** the manager reconnects while another candidate event is being accepted
- **THEN** every accepted event after the confirmed boundary is recovered exactly once
- **AND** earlier loaded events remain available and subsequent live activity continues updating

#### Scenario: History from a previous context completes late
- **WHEN** the viewer changes room, loses manager permission, or signs out before an outstanding history read completes
- **THEN** the old response cannot repopulate the current history or disclose the previous room's activity

#### Scenario: An activity broadcast is missed without an SSE disconnect
- **WHEN** one source event is durably accepted but its activity broadcast is missed by an otherwise connected manager
- **THEN** the next bounded periodic catch-up recovers it while the activity panel remains open
- **AND** history requests remain serialized and do not cause SSE reconnection

### Requirement: History is reconstructed from durable activity records

Every acknowledged source event SHALL remain durably retrievable for the retained
room regardless of the current in-memory recent window or cached room snapshot.
Activity accepted without an online manager SHALL be available when a manager
later joins. Backend restart, room-state reconstruction, and published-step
transition SHALL NOT discard retained history or prevent the next valid source
event from being accepted. Existing room deletion and archive access semantics
SHALL remain in force; this change SHALL NOT claim recovery of already deleted
records or grant access to an archived room through a live collaboration.

Pre-implementation acceptance-test level: **E2E** for manager reload and a
published-step transition; **backend integration exception** for clearing the
volatile state and stale room snapshot then reconstructing from the same durable
database, because database durability cannot be established from rendered UI alone.

#### Scenario: Cached room history is missing or stale
- **GIVEN** retained activity exists in durable storage and the room's cached history is empty or older
- **WHEN** volatile room state is reconstructed and an authorized manager requests history
- **THEN** all retained activity is recoverable from durable records
- **AND** the manager's bounded recent state reflects the latest retained activity

#### Scenario: Recording continues through a published step transition
- **WHEN** a manager advances a persisted interview to another published step and the candidate performs a source action
- **THEN** that action is accepted once against the same persisted room
- **AND** both pre-transition and post-transition activity remain retrievable

### Requirement: Activity acceptance can complete without a second database connection

An authorized candidate source action SHALL be able to commit and receive an
acknowledgement when the database connection pool has one available connection
and no unrelated database work is holding it. Realtime dispatch SHALL NOT retain
an unused enclosing connection while activity acceptance waits for another one.
Activity acceptance SHALL retain its durable-before-broadcast boundary,
source-event idempotency, and existing server-side authorization; other room
permission mutations SHALL retain their current transaction semantics.

Pre-implementation acceptance-test level: **backend integration exception** with
a one-connection pool and a bounded request deadline. This resource-deadlock
condition and commit/broadcast order cannot be proven reliably through browser
rendering; the end-to-end activity tests separately verify user-visible progress.

#### Scenario: A one-connection pool accepts and deduplicates activity
- **GIVEN** the test database pool has exactly one connection and no competing workload
- **WHEN** an authorized candidate sends an activity POST and retries its source identity
- **THEN** both requests complete within the test's five-second deadline
- **AND** exactly one durable row and one manager activity broadcast exist
- **AND** room snapshot and metrics operations still complete

### Requirement: Paging and presentation use stable identity and deterministic ordering

The history contract SHALL provide a stable source identity and server acceptance
sequence for each retained event, including supported legacy records. Paging
SHALL use a stable server acceptance boundary that is independent of timestamp
ordering, with a fixed upper boundary for each traversal. New events accepted
during traversal SHALL remain available to subsequent catch-up without skipping
or duplicating any source event. Presentation and existing raw exports SHALL
retain canonical `(timestampEpochMs, acceptedSequence)` ordering. Grouping SHALL
retain the same-session, adjacent, inclusive 5,000 ms window anchored at the first
event and SHALL recompute across loaded page boundaries; no event is coalesced in
durable storage.

Pre-implementation acceptance-test level: **E2E** for a group spanning a loaded
page boundary; **backend integration exception** for frozen cursor boundaries,
equal timestamps, backward timestamp movement, and supported legacy rows;
**unit exception** for deterministic source deduplication and grouping permutations.

#### Scenario: Concurrent append occurs while older pages load
- **GIVEN** a manager traverses history at a fixed accepted-sequence boundary
- **WHEN** a new event is accepted before older page reads finish
- **THEN** the original traversal contains all events through its fixed boundary exactly once
- **AND** the later event is available through live delivery or catch-up

#### Scenario: A later accepted event has an earlier timestamp
- **WHEN** a newly accepted event has a higher acceptance sequence and an equal or earlier timestamp
- **THEN** acceptance-sequence catch-up still retrieves it
- **AND** the timeline places it at its canonical timestamp and sequence position without duplicating it

#### Scenario: One group spans two loaded pages
- **WHEN** older-page loading supplies adjacent same-session events within the existing anchored five-second window
- **THEN** the projection recomputes their single appropriate group without losing individual source events

### Requirement: Retryable activity delivery failures do not permanently stop capture

During a valid page-room session, an activity request that does not complete
SHALL time out within 10 seconds. Network failures, timeouts, HTTP `429`, and HTTP
`5xx` SHALL retain the queued source event, its source identity, and the order of
subsequent captured events. The activity lane SHALL have at most one request in
flight and SHALL retry with delays of 1, 2, 4, 8, 16, then 30 seconds between
completed failed attempts, capped at 30 seconds for subsequent failures. Retries
SHALL continue while the room context remains valid; three failures SHALL NOT
drop the queue or permanently disable capture. A reconnect or repeated state
sync SHALL NOT bypass a scheduled delay or create duplicate timers. A successful
acknowledgement SHALL release that event once and permit the next queued event.

The candidate SHALL see recoverable delayed-recording feedback while retryable
delivery is pending, and the feedback SHALL clear when the pending delivery
recovers. Raw server error bodies SHALL NOT be rendered. Yjs editing and the
normal room event lane SHALL remain usable. Existing bounded `401`/`403`
authorization behavior and terminal archived-room `410` handling SHALL not be
converted into indefinite retries, and leaving the room or destroying the page
SHALL cancel old-context work. A temporary SSE interruption alone SHALL not
suppress capture or delete pending events for the still-current page-room
session. The outgoing queue is volatile: retaining unacknowledged actions across
full page reload or close is outside this capability; acknowledged durable
history SHALL survive those actions.

Pre-implementation acceptance-test level: **E2E** for delayed feedback, more than
three failures followed by automatic recovery, and editor continuity; **unit
exception** for deterministic verification of the full 30-second backoff ceiling.
Real-browser fault injection verifies timeout cleanup and scheduling fences against
the running transport, including a reconnect while the failed head waits.

#### Scenario: Three server errors are followed by recovery
- **WHEN** one candidate source event receives three retryable `5xx` responses and then succeeds
- **THEN** it is retried with the same source identity and durably accepted once
- **AND** queued later activity is delivered in FIFO order without requiring a page reload
- **AND** recoverable delayed-recording feedback clears after recovery and new capture continues

#### Scenario: A request never responds
- **WHEN** an activity POST does not complete
- **THEN** the client aborts it within 10 seconds and schedules the same source event for retry
- **AND** the activity lane cannot remain indefinitely blocked by that request

#### Scenario: Server commit succeeds but the response is lost
- **WHEN** the client retries a source event after its committed acceptance response was lost
- **THEN** the server returns successful acknowledgement without an additional durable record or manager broadcast
- **AND** the client advances its queue once

#### Scenario: Reconnect occurs during backoff
- **WHEN** a state sync or unrelated SSE reconnect occurs before the queued event's retry is due
- **THEN** it does not send an early request or create a second in-flight activity request
- **AND** normal editor and room events continue independently

#### Scenario: A simple SSE interruption occurs during candidate input
- **GIVEN** the candidate has a confirmed current page-room session
- **WHEN** its SSE connection temporarily disconnects while the candidate performs supported source actions
- **THEN** those actions remain queued with stable source identities for authorized recovery
- **AND** restoring the stream resumes delivery without requiring new input or a page reload

### Requirement: History retrieval states are explicit and failures preserve successful data

The manager timeline SHALL distinguish initial loading, confirmed empty history,
partially loaded history with more available, complete history, and a recoverable
history-read failure. A failed or timed-out history request SHALL not be treated
as an empty result and SHALL not erase already loaded source events. Loading an
older page SHALL preserve the current live history. The viewer SHALL be able to
retry a failed read without a room reload; repeated clicks SHALL not create
concurrent duplicate reads for the same page. A history read SHALL have a finite
10-second timeout and SHALL not start an unbounded-rate automatic request loop.
Periodic catch-up SHALL obey the serialized five-second cadence even after a
failure; a failure SHALL not start an additional immediate retry loop.

Pre-implementation acceptance-test level: **E2E**, using a real room and controlled
history read failures to prove visible loading, empty, partial, complete, retry,
and timeout states.

#### Scenario: Older history fails while live activity continues
- **GIVEN** a manager has already loaded recent activity
- **WHEN** the older-history request fails while a new candidate event arrives
- **THEN** the existing and new live activity remain available
- **AND** the timeline shows a recoverable history error and retry action
- **WHEN** the manager retries successfully
- **THEN** older history merges once and the error clears

#### Scenario: Confirmed empty interview history
- **WHEN** an authorized durable history request succeeds with no retained events
- **THEN** the timeline displays a confirmed empty state rather than loading or failure feedback

### Requirement: Complete history retains server-side manager authorization and room isolation

Every history read SHALL enforce the existing server-side room manager policy,
including current authorization for owners, persisted non-owner interviewers,
and supported promoted guest interviewers. A candidate, revoked manager,
unrelated account, HR-only flag, forged cursor, or room identifier SHALL NOT grant
activity access. Candidate state sync and broadcasts SHALL omit raw history,
source identities, acceptance sequences, and history metadata. Losing manager
permission SHALL immediately clear client history and prevent pending reads from
restoring it. History reads SHALL not silently downgrade an authorization failure
into an empty successful page.

Pre-implementation acceptance-test level: **E2E** for manager visibility and
revocation during a pending read; **backend integration exception** for direct
API permission matrix, forged/cross-room cursors, and candidate SSE payload
inspection independent of hidden UI.

#### Scenario: A candidate directly requests complete history
- **WHEN** a candidate uses their valid realtime credential to request room activity history
- **THEN** the server denies access without exposing source events or history metadata

#### Scenario: Guest manager loses permission with a request pending
- **GIVEN** a promoted guest manager has displayed history and an outstanding page request
- **WHEN** the server revokes that manager role
- **THEN** displayed history is cleared and the late page response is ignored
- **AND** subsequent direct history and raw export reads are denied under the existing authorization policy

#### Scenario: A cursor is reused in another room
- **WHEN** a caller supplies a history boundary obtained from another room
- **THEN** authorization and every record query remain scoped to the requested room
- **AND** no source event from another room is disclosed
