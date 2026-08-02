## ADDED Requirements

### Requirement: Candidate activity source actions remain individually captured

For every keyboard, paste, window-focus, or tab-visibility activity source action
observed for a candidate while that candidate has a confirmed realtime session
and activity recording remains available,
the system SHALL create exactly one individual raw audit event. The raw event
SHALL retain its stable source identity, stable participant/session identity,
event kind, action data, and server-authoritative acceptance order/time. It SHALL
be relayed/persisted as an individual event and remain available through the
existing manager-authorized raw-event export. The system MUST NOT debounce,
throttle, coalesce, or discard such source actions merely to make the timeline
readable; a bounded physical delivery strategy is permitted only when it preserves
every original event separately and does not weaken authorization or bounded
failure recovery.

Pre-implementation acceptance-test level: **E2E** for rapid candidate input and
authorized raw download, supplemented by a **backend integration-test exception**
for exact individual persistence and server authorization because those internal
durability guarantees are not fully observable in the rendered page.

#### Scenario: Rapid candidate actions remain distinct raw audit events

- **WHEN** a candidate with a confirmed realtime session rapidly produces
  printable keydowns, a shortcut, a paste, and a window/tab signal
- **THEN** the manager-authorized raw export contains one distinct raw event for
  each produced action in authoritative source order
- **AND** no event is missing because of a client or server keydown throttle
- **AND** no raw audit record is replaced by a grouped timeline entry

#### Scenario: Repeated delivery does not duplicate an already accepted event

- **WHEN** a reconnect or transport retry presents an activity event whose stable
  source identity was already accepted
- **THEN** the raw audit trail contains that source event exactly once
- **AND** the event is not silently merged with a different source action

#### Scenario: Terminal authorization remains bounded during activity capture

- **WHEN** the relay rejects activity after a candidate's realtime authorization
  becomes terminally invalid
- **THEN** the system follows the existing bounded authorization recovery policy
- **AND** it does not create an unbounded activity retry loop or fabricate a raw
  audit event that the server did not accept

### Requirement: Room transitions preserve activity persistence and persistent server failures are traffic-bounded

Every activity-capable realtime state for a persisted room SHALL retain that
room's nonblank persisted Room ID across bootstrap, state synchronization,
reconnect, and published-step transitions. A valid candidate activity action
after a manager changes the published step SHALL be accepted against that same
durable room, rather than failing because an in-memory state lacks its identity.

For the activity FIFO only, one transient HTTP `5xx` MAY retry the unchanged
head `sourceEventId` while preserving FIFO order and at most one in-flight POST.
The head SHALL retain its failed-`5xx` count, `retryPending` flag, and
`retryDueAt` timestamp until that same head succeeds or the activity session
becomes terminal. While `retryPending` is true and `retryDueAt` has not
arrived, a drain initiated by a repeated `state_sync` or an unrelated
EventSource reconnect SHALL make no activity POST and SHALL NOT create another
retry timer. If the same head receives three HTTP `5xx` responses in one
page-room session, the client SHALL stop activity capture, clear its volatile
activity FIFO, and show the candidate one persistent non-authorization notice
that recording is temporarily unavailable and a room refresh can retry it. It
SHALL make no later automatic activity POST or activity-caused SSE reconnect in
that page-room session. The room's event token, authorization state, editor, Yjs
collaboration, and main room-event queue SHALL remain usable. A later page reload
or room re-entry starts a fresh activity-capture session. This terminal
server-failure exception is the only case in which newly observed activity is not
guaranteed to be durably recorded; the UI MUST NOT claim that it was recorded.

The terminal activity state SHALL be independent of the authorization-terminal
state and capture-confirmation state, so neither a later `state_sync` nor an
unrelated reconnect can re-enable activity capture. A physical Space key or any
other activity observed after that terminal state SHALL not enqueue a source
event or cause a fourth activity POST. A real post-terminal `state_sync` and
then an unrelated EventSource reconnect SHALL each preserve the generic
recording-unavailable notice visibly exactly once, without an activity POST or a
new source ID, before any subsequent physical key is captured. For an activity
`5xx`, raw server error body/status text MUST NOT be rendered to the candidate;
only the generic recording-unavailable notice may be shown.

HTTP `403` keeps its existing authorization-specific recovery policy. HTTP `401`
and retry policy for non-activity room events are outside this requirement.

Pre-implementation acceptance-test level: **E2E** for the post-step candidate
flow and browser-bounded `5xx` behavior, supplemented by a **backend
integration-test exception** for the durable Room-ID association and exact
single persistence/broadcast invariant.

#### Scenario: Candidate activity after a published-step transition remains durable

- **WHEN** an authorized manager changes the active step of a persisted room and
  a candidate with a confirmed realtime session sends one tracked activity action
- **THEN** its relay response is successful and does not contain the
  `Room activity state has no persisted room ID` failure
- **AND** manager-authorized raw export contains exactly one record for the same
  `sourceEventId` under that room
- **AND** managers receive at most one corresponding activity broadcast
- **AND** the browser makes no retry of that successful source action.

#### Scenario: An unsaved Room cannot create activity-capable realtime state

- **WHEN** either realtime-state factory ingress receives a Room whose persisted
  ID is null, empty, or whitespace
- **THEN** it rejects the Room before registering or replacing its in-memory
  realtime state
- **AND** the failure identifies the missing persisted Room ID rather than
  allowing a later candidate activity relay to fail with a server error

#### Scenario: Persistent activity `5xx` cannot create a request storm

- **WHEN** every attempt to relay one queued activity source event receives a
  synthetic HTTP `5xx` before it reaches the server
- **THEN** the browser makes at most three attempts with that unchanged
  `sourceEventId`, using a one-second delay before the second attempt and a
  two-second delay before the third attempt
- **AND** browser-recorded attempt times `t1`, `t2`, and `t3` satisfy
  `t2 - t1 >= 850 ms` and `t3 - t2 >= 1,850 ms`, applying the documented
  150 ms clock tolerance to the +1 second/+2 second policy
- **AND** no more than one activity POST is in flight, queued later activity
  does not overtake the failed head, and no raw record or manager broadcast is
  fabricated
- **AND** after the third failure it stops automatic activity traffic and shows
  the non-authorization recording-unavailable notice while collaborative editing
  remains functional.

#### Scenario: State synchronization and an unrelated reconnect cannot bypass a pending retry

- **WHEN** the first `5xx` has scheduled the +1 second retry for one activity
  FIFO head, the client receives a repeated `state_sync`, and its EventSource
  reconnects for a non-activity reason before that retry is due
- **AND WHEN** the second `5xx` has scheduled the +2 second retry and the
  client receives another repeated `state_sync` before that retry is due
- **THEN** the same head, failed-attempt count, and due time remain in effect
- **AND** no activity POST occurs before the due time and only one retry timer
  exists for that head
- **AND** the later retry uses the unchanged `sourceEventId` and preserves the
  three-total-attempt budget.

#### Scenario: Terminal lifecycle callbacks cannot restart activity delivery

- **WHEN** the third `5xx` has terminally disabled activity capture, the client
  receives a real post-terminal `state_sync`, and then its EventSource
  reconnects for an unrelated reason
- **THEN** after each callback the generic recording-unavailable notice remains
  visibly present exactly once
- **AND** no activity POST is made and no new source ID is created during those
  callbacks
- **WHEN** the candidate then presses physical Space
- **THEN** the browser sends no fourth activity POST for either the failed head
  or a new source event across the full terminal sequence
- **AND** the visible notice remains the generic recording-unavailable notice,
  not raw `5xx` response text or status detail.

### Requirement: Source activity has idempotent delivery and canonical order

Each captured candidate activity action SHALL receive a client-generated stable
`sourceEventId`; a reconnect or retry SHALL reuse that ID. The server SHALL
durably record a single event for a `(room, sourceEventId)` pair, assign a
server-authoritative `timestampEpochMs` and increasing `acceptedSequence`, and
use `(timestampEpochMs, acceptedSequence)` as canonical order. It SHALL persist
the raw event before manager history/SSE publication, including when no manager
is currently connected. Raw export remains individual and unbounded; only live
history may retain its most recent 50 raw events.

#### Scenario: A retry is acknowledged without a duplicate audit row or broadcast

- **WHEN** a client retries a previously accepted action with the same
  `sourceEventId`
- **THEN** raw export contains one record for that ID
- **AND** managers receive no duplicate activity broadcast

#### Scenario: An activity broadcast follows a committed raw record without blocking collaboration

- **WHEN** the server accepts a previously unseen activity source event
- **THEN** its raw record is committed durably before the server updates live
  manager history or emits a `candidate_key` broadcast
- **AND** database acceptance work does not execute while holding the in-memory
  room-state monitor used by code/Yjs collaboration
- **AND** a slow persistence operation therefore cannot serialize unrelated
  code/Yjs updates behind candidate activity

#### Scenario: Equal timestamps still have deterministic activity order

- **WHEN** two accepted actions have the same authoritative timestamp
- **THEN** `acceptedSequence` determines their export, state-sync, and grouped
  timeline order
- **AND** repeated identical key presses remain separate raw actions

### Requirement: Activity data remains manager-only in realtime state

The server SHALL include raw candidate activity and recent history only in
state-sync and SSE messages delivered to server-authorized room managers.
Candidates SHALL receive neither `lastCandidateKey` nor
`candidateKeyHistory`, including after reconnect or role changes.

#### Scenario: Candidate reconnects after activity was recorded

- **WHEN** a candidate reconnects to a room with retained activity
- **THEN** candidate state-sync omits raw activity fields
- **AND** manager state-sync retains bounded raw history for grouping

### Requirement: The interviewer timeline groups only same-session adjacent events in an anchored five-second window

The interviewer-visible Activity Timeline SHALL derive entries from the complete
currently retained raw candidate-event history in canonical source order:
authoritative acceptance time followed by stable source acceptance order/identity.
It SHALL start a new entry unless the next event has the same stable
participant/session identity, is adjacent to the preceding raw event, and occurs
no later than 5,000 ms after the first raw event in the open entry. The 5,000 ms
boundary is inclusive and is anchored to that first event; an entry SHALL NOT use
a sliding window. An event from another participant SHALL close the open entry,
even if both timestamps are within five seconds. Display names MUST NOT be used
as the grouping identity.

Pre-implementation acceptance-test level: **E2E** for the rendered manager
timeline. A **unit-test exception** SHALL cover exhaustive controlled timestamp,
participant-interleaving, and equal-time ordering cases because those are a pure
projection whose browser timing would be non-deterministic.

#### Scenario: Same-session typing is grouped at the inclusive boundary

- **WHEN** adjacent canonical events for the same session occur at `t0`,
  `t0 + 4,999 ms`, and `t0 + 5,000 ms`
- **THEN** the timeline renders one grouped entry containing all three actions
- **AND** an otherwise eligible event at `t0 + 5,001 ms` starts the next entry

#### Scenario: The anchored window prevents an unbounded continuous group

- **WHEN** same-session adjacent events occur at `t0`, `t0 + 4,000 ms`, and
  `t0 + 8,000 ms`
- **THEN** the first two events are in one entry
- **AND** the event at `t0 + 8,000 ms` starts a new entry despite being within
  five seconds of the immediately preceding raw event

#### Scenario: An intervening participant event prevents cross-participant grouping

- **WHEN** canonical history contains candidate session A at `t0`, session B at
  `t0 + 1,000 ms`, and session A at `t0 + 2,000 ms`
- **THEN** the timeline renders three entries in A, B, A order
- **AND** neither A entry includes B's action, even when A and B use the same
  display name

#### Scenario: Same-name candidates remain visually distinguishable

- **WHEN** retained groups belong to two or more different session identities
  with the same candidate display name
- **THEN** each affected timeline entry renders a stable, non-sensitive session
  qualifier alongside that name
- **AND** a unique display name remains uncluttered by that qualifier

### Requirement: Grouped entries preserve readable typed text and ordered non-editing actions

Each grouped entry SHALL identify its participant and time context and SHALL
render an ordered plain-text summary of its source actions. Consecutive printable
key events, including spaces, SHALL be combined as typed text. Shortcut or
special-key events, paste actions with their recorded character count, and
window/tab focus or visibility actions SHALL remain visible semantic action tokens
in their original order. Unknown or non-printable input MUST be represented as a
safe action token rather than silently appended to typed text. The summary SHALL
not infer code state or unrecorded text, render untrusted data as HTML, expose a
paste preview, or provide any event-editing/replay control.

Pre-implementation acceptance-test level: **E2E** for a manager's readable
summary. A **unit-test exception** SHALL verify complete tokenization and ordering
of text/action combinations because it is a pure formatter with privacy-critical
edge cases.

#### Scenario: Typed text and shortcut remain in one readable ordered entry

- **WHEN** a candidate types the printable sequence `hello world`, then presses
  `Ctrl+Z`, then types `!` within one eligible group window
- **THEN** the manager sees one entry that conveys the typed `hello world`, the
  `Ctrl+Z` action, and the later `!` in that order
- **AND** the entry does not render one row per key or claim that the editor's
  final code equals that text

#### Scenario: Non-editing signals are not hidden by grouping

- **WHEN** an eligible group contains a paste of 42 characters, a window-focus
  change, a tab-visibility change, and a non-printable key
- **THEN** the manager sees semantic tokens for all four actions in source order
- **AND** the paste summary exposes the recorded length but not its preview

### Requirement: Timeline reconciliation is deterministic, private, and non-mutating

Whenever the recent activity history is received again through SSE state sync or
a late source event arrives, the client SHALL reconcile source events by stable
identity, canonicalize their order, and recompute the visible groups from the
current retained history. It SHALL update an affected group in place or insert it
at its canonical location rather than appending the late event blindly. A repeated
state sync SHALL NOT create duplicate source actions or duplicate grouped entries.
The oldest event of a truncated retained history SHALL begin a new visible group;
the timeline SHALL NOT assert continuity with omitted history. Grouping SHALL NOT
alter raw events, persistence, retention, exports, or code collaboration.

Only a room owner or interviewer authorized by the server to manage the room
SHALL receive or view raw activity or grouped timeline entries. Candidates SHALL
receive neither the raw history nor a grouped summary, including after reconnect
or role/session changes. The feature SHALL emit no grouped text/action data to
analytics or a new endpoint.

Pre-implementation acceptance-test level: **E2E** for manager reconnect/late
update visibility and candidate isolation, supplemented by a **backend
integration-test exception** for server-side authorization because UI concealment
is not an authorization boundary.

#### Scenario: A late event recomputes its canonical group without duplication

- **WHEN** a manager has rendered a retained history and a same-session raw event
  arrives late with a canonical position inside an existing five-second window
- **THEN** the timeline recomputes the entry at that canonical position and
  includes the late action once
- **AND** later entries retain their correct order and no raw event is lost

#### Scenario: Reconnect replaces stale groups with the authoritative recent history

- **WHEN** an interviewer reconnects and receives a repeated or updated
  authoritative recent activity history
- **THEN** the timeline shows the groups derived from that canonical retained
  history exactly once
- **AND** it does not preserve a stale local grouping that contradicts the
  authoritative history

#### Scenario: A candidate cannot access grouped activity after reconnect

- **WHEN** a candidate reloads or reconnects to the room while activity exists
- **THEN** the candidate receives no raw activity history or grouped summary over
  the room channel
- **AND** a direct raw-export request remains rejected by server-side room-role
  authorization

### Requirement: Critical activity contracts are covered at their real boundary

The activity feature SHALL have release evidence for the browser relay, manager
view, server authorization, durable source identity, and the distinction between
bounded live history and raw export. New audit tests are coverage-only until an
assertion demonstrates a product defect; a product remediation SHALL be preceded
by the recorded failing assertion. Evidence SHALL be stored in
`openspec/changes/group-activity-timeline-events/verification.md`. A missing
local runtime is not evidence of a product defect; qa-agent and
test-reviewer-agent must jointly approve every `environment-blocked` or
`not-applicable` ledger entry before it can satisfy a release gate. If historical
red/green evidence is unavailable, the ledger SHALL record a
`historical-evidence-gap` rather than fabricate a result, and it must be rerun or
receive the same reviewers' approved exception.

Pre-implementation acceptance-test level: **E2E** for browser wire values,
manager/candidate reconnect behaviour, live-history/export behaviour, and FIFO
failure handling. A **backend integration-test exception** applies to malformed
or legacy source IDs, concurrent duplicate acceptance, and the exact single
broadcast/durable-row invariant because those server-side effects cannot be
reliably derived from UI visibility alone.

#### Scenario: A physical Space remains typed whitespace end to end

- **WHEN** a candidate presses the physical Space key in a browser
- **THEN** the activity relay contains the browser wire values `key: " "` and
  `keyCode: "Space"` for that source action
- **AND** the raw JSON export record with that same `sourceEventId` retains
  `keyValue: " "` and `keyCode: "Space"`
- **AND** the manager's grouped summary renders a typed space in its text rather
  than dropping it or substituting the literal word `Space`

#### Scenario: Live history is bounded independently from raw export

- **WHEN** more than 50 individually accepted candidate source events exist in
  canonical order
- **THEN** an authorized manager receives and renders exactly the most recent 50
  raw events in live history
- **AND** the manager-authorized JSON export still contains every accepted raw
  event, including the earlier events omitted from live history

#### Scenario: Reconnect preserves manager access and candidate isolation

- **WHEN** a manager's actual room EventSource transport disconnects and
  reconnects after candidate activity is accepted, and a candidate reloads or
  reconnects to the same room
- **THEN** the manager's post-reconnect authoritative state-sync replaces prior
  local history, derives it once, and contains no stale or duplicate source ID
- **AND** the candidate's state-sync and every observed post-reconnect room
  message omit the incremental `candidate_key` activity message and raw activity
  fields (`lastCandidateKey`, `candidateKeyHistory`, `sourceEventId`,
  `acceptedSequence`, and `pastePreview`)
- **AND** candidate state sync retains a valid nonblank event token, whose direct
  raw-export request is nevertheless forbidden by server-side room-role
  authorization

#### Scenario: A transient activity failure preserves FIFO behaviour

- **WHEN** a candidate captures a burst of activity while the first relay
  attempt receives a transient 5xx response
- **THEN** the client retries the retained head with the same `sourceEventId`
  and preserves source order
- **AND** at no time is more than one activity POST in flight
- **AND** each eventually accepted source action has one durable/exported record

#### Scenario: The accepted 403 activity failure remains bounded

- **WHEN** the activity relay returns 403 for a candidate source event
- **THEN** it follows the existing single-recovery then terminal policy with the
  same source identity during its allowed retry
- **AND** a terminal status stops later activity transmission and creates no
  fabricated raw record or retry storm

Activity 401 handling is explicitly outside this change and SHALL NOT be tested,
implemented, or inferred from the accepted 403 policy without a separate
OpenSpec proposal and architecture decision.

#### Scenario: Legacy, malformed, and concurrent source IDs remain safe

- **WHEN** a legacy activity request omits `sourceEventId`
- **THEN** the server mints one UUID and persists/broadcasts it as a normal raw
  source event
- **WHEN** a request supplies a nonblank malformed source ID
- **THEN** the server rejects it with a client error and creates neither a raw
  record nor a manager activity broadcast
- **WHEN** concurrent requests present the same valid source ID for one room
- **THEN** there is exactly one durable raw event and exactly one manager
  `candidate_key` broadcast for that identity
- **WHEN** concurrent requests present two distinct valid source IDs for one room
- **THEN** there are two durable raw events with unique canonical
  `acceptedSequence` values and exactly two manager `candidate_key` broadcasts

### Requirement: Release evidence covers non-owner manager and raw CSV export boundaries

Release evidence SHALL prove the raw-activity access path for both a registered,
persisted interviewer who is not the room owner and a guest promoted through the
actual realtime room path, rather than treating an owner-only success as evidence
for all managers. It SHALL also prove that the manager-authorized CSV export is an
individual raw-event representation, not a grouped timeline projection.
Authorization remains server-side: after guest-interviewer revocation and
reconnect, that same guest's own current realtime token SHALL NOT grant either
JSON or CSV raw-export access.

Pre-implementation acceptance-test level: **E2E**. The observable browser,
realtime, timeline, export, and authorization path must use real state-sync and
candidate relay traffic; a unit or mocked-transport substitute is not
proportionate for this coverage.

#### Scenario: A registered persisted non-owner interviewer receives live activity

- **WHEN** a distinct registered user is server-authorized and persisted as an
  interviewer, receives an actual room `state_sync`, and a candidate sends source
  actions through the actual browser activity relay
- **THEN** the interviewer's real SSE state identifies that user as
  `role: interviewer`, `isOwner: false`, and `canManageRoom: true`, and the
  post-acceptance manager history contains the first accepted source action
- **AND** a later accepted candidate source action reaches that same interviewer as
  an actual incremental `candidate_key` SSE message
- **AND** that interviewer's visible Activity Timeline renders each tracked source
  action once
- **AND** a direct manager raw JSON export with only that interviewer's valid
  `Authorization: Bearer` session (no owner header and no realtime-token header)
  returns the tracked source records once

#### Scenario: A promoted guest loses raw-activity access after revocation

- **WHEN** a guest candidate is promoted to interviewer through the actual room
  realtime path
- **THEN** that guest's real manager state-sync has a nonblank current event token
  and permits a direct raw JSON export using only that guest's
  `X-Room-Event-Token`, with no Bearer or owner credential
- **WHEN** the same guest is revoked and actually reconnects to the room as a
  candidate
- **THEN** the refreshed candidate state-sync and observed post-reconnect room
  messages omit `lastCandidateKey`, `candidateKeyHistory`, `sourceEventId`,
  `acceptedSequence`, and `pastePreview`
- **AND** a malformed observed post-reconnect room payload fails the privacy
  verification rather than being treated as an opaque safe message
- **AND** a direct raw JSON export using that guest's new nonblank current event
  token is forbidden by server-side authorization

#### Scenario: Manager CSV UI export preserves individual raw rows and candidate denial

- **WHEN** the registered non-owner interviewer triggers the Activity Timeline CSV
  download UI after tracked candidate relay actions include a physical Space key
  and a paste with a known length
- **THEN** the actual download response has the raw-contract columns
  `source_event_id` and `accepted_sequence` (the CSV representations of
  `sourceEventId` and `acceptedSequence`)
- **AND** every exported raw source event has exactly one individual CSV data row,
  the parsed row count matches the manager-authorized raw JSON export, and the
  tracked source IDs appear once in canonical acceptance order with their matching
  acceptance sequences
- **AND** the Space row preserves `key_value: " "` and `key_code: "Space"`, and
  the paste row preserves the known `paste_length`
- **AND** the revoked guest candidate using that guest's own nonblank current
  realtime token remains forbidden by server-side authorization from the CSV raw
  export, and the denial response contains neither the raw CSV schema header nor
  any tracked raw source ID

### Requirement: Baseline room-access denials remain safe

Release evidence SHALL include browser coverage of existing invalid-invite and
stale-event-token denial behaviour. This is coverage-only: it SHALL NOT change
token lifetime, room access, authorization policy, or the scoped exclusion of
activity-relay 401 behaviour.

Pre-implementation acceptance-test level: **E2E** because the result depends on
the actual room URL, realtime session lifecycle, and server-side protected relay.

#### Scenario: A non-existent invite cannot initialize an editable room

- **WHEN** a browser opens a room URL with an invite code that identifies no room
- **THEN** it does not render an editable workspace or receive a usable realtime
  room state

#### Scenario: A stale event token cannot perform a protected room action

- **WHEN** one realtime session reconnects and receives a replacement event token
- **THEN** a protected room relay request with its previously issued token is
  rejected server-side
- **AND** no room action is accepted or broadcast from that rejected request
