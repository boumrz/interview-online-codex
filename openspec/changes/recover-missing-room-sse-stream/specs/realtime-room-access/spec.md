## ADDED Requirements

### Requirement: A backend-confirmed missing room terminates its realtime session

When the backend confirms that the room for the current SSE session is missing
(the documented missing-room `404` result), the room client SHALL enter a
terminal unavailable state. It SHALL close the active stream, cancel scheduled
reconnect work, abort or discard queued room mutations and activity delivery,
and SHALL NOT automatically issue another room stream or room-event request for
that page-room session. The terminal state SHALL remain effective through later
focus, visibility, and stale asynchronous reconnect callbacks; a deliberate new
room navigation or page reload may start a new session.

The page SHALL replace any editable workspace with an accessible, non-editable
room-unavailable alert. Its copy SHALL clearly say that the room is unavailable
and direct the visitor to use a current invitation or contact the organizer. It
MUST NOT display a raw HTTP status, backend response text, token, or other
internal error detail.

Pre-implementation acceptance-test level: **E2E**. The terminal UI and absence
of retry-generated browser traffic are user-observable lifecycle behavior.

#### Scenario: A previously synchronized room disappears before reconnect

- **WHEN** a browser has received room `state_sync`, loses its SSE connection,
  and the next server-authoritative stream attempt confirms that the room is
  missing with the documented `404` result
- **THEN** the page renders the non-editable room-unavailable alert and no
  editable room workspace remains available
- **AND** after the alert appears, the observed counts of room stream and
  room-event requests remain unchanged across a wait longer than the normal
  reconnect interval and across focus/visibility callbacks
- **AND** the alert contains no raw `404` value or backend error body

#### Scenario: The first stream attempt confirms that the room is missing

- **WHEN** the initial room stream attempt receives the documented missing-room
  `404` result before any `state_sync`
- **THEN** the page shows the same terminal room-unavailable alert instead of
  an indefinite access-pending state
- **AND** it does not render an editable workspace or schedule another stream
  connection for that session

### Requirement: Transient SSE failures retain normal reconnect behavior

A stream failure that is not a server-authoritative missing-room confirmation
SHALL remain a transient transport failure. The client SHALL preserve the
existing reconnect and authoritative `state_sync` recovery behavior and SHALL
NOT present the terminal room-unavailable state merely because the network is
offline, a stream is interrupted, or a non-missing server failure occurs.

Pre-implementation acceptance-test level: **E2E**. Reconnection and restored
editing are observable browser behavior; a mocked unit transport is not a
proportionate substitute.

#### Scenario: A transient outage reconnects to an existing room

- **WHEN** a browser temporarily loses and restores network access while its
  room still exists
- **THEN** it reconnects, receives authoritative `state_sync`, and restores the
  normal editable room workspace
- **AND** it does not show the terminal room-unavailable alert

### Requirement: Missing-room recovery preserves server-side authorization and bounded token recovery

The backend SHALL continue to resolve room existence and authorization
server-side. Any status-aware classification used by the client SHALL neither
grant access, mint or retain a usable event token, create membership, nor expose
room state for a missing or unauthorized request. The existing bounded stale
event-token `403` recovery contract remains unchanged for an existing room.
If a confirmed missing-room result races with a scheduled stale-token recovery,
the missing-room terminal state SHALL win and stale callbacks SHALL NOT reopen
the stream or resume room-event delivery.

Pre-implementation acceptance-test level: **E2E** for the stale-token/missing-
room race. A **backend integration-test exception** SHALL verify the
missing-room stream status and absence of a usable realtime session because
these server-side authorization effects cannot be established safely from the
rendered UI alone.

#### Scenario: A missing-room result wins a stale-token recovery race

- **WHEN** a queued room event receives its allowed first `403` recovery and a
  reconnect then receives the documented missing-room `404` result before or
  after the recovery timer fires
- **THEN** the page shows the terminal room-unavailable alert rather than a
  recoverable token error
- **AND** no stale recovery callback can issue another stream or room-event
  request after that terminal state is reached

#### Scenario: A stale token recovers when the room still exists

- **WHEN** the first `403` is caused by a stale event token and the next stream
  connection for an existing room provides authoritative `state_sync`
- **THEN** the client resumes the existing bounded authorization-recovery flow
  and does not classify the room as unavailable
- **AND** a second rejection of the same queued event remains governed by the
  existing terminal access-denied requirement

#### Scenario: A missing stream request cannot create a usable realtime session

- **WHEN** a request targets a room that the backend cannot resolve for the
  realtime stream
- **THEN** the backend returns the documented missing-room result and creates
  no usable realtime session, event token, room mutation, or room-state payload
- **AND** existing invitation and role authorization rules remain enforced for
  all other realtime requests

#### Scenario: The status probe is side-effect-free

- **WHEN** the client requests `GET /api/realtime/rooms/{inviteCode}/stream-status`
  after a stream failure
- **THEN** it returns `204` only for a room that can still admit the caller and
  an empty `404` only for a missing room
- **AND** it creates no participant, SSE connection, event token, room-state
  payload, metric, or room mutation
- **AND** any status other than this endpoint's `404` remains a transient
  transport outcome
- **AND** the response is explicitly non-cacheable and the client does not
  reuse a cached room-status result

#### Scenario: A delayed status probe remains a transient outage

- **WHEN** a synchronized room loses its SSE stream and its status probe does
  not resolve before the documented client deadline
- **THEN** focus and visibility callbacks do not send room-event control
  traffic while the probe is pending
- **AND** the client resumes ordinary reconnect for the existing room without
  showing the terminal unavailable alert or spending its stale-token recovery
  budget
