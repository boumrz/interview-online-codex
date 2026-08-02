## Context

The current room flow accepts candidate `keydown`, paste, window-focus, and
tab-visibility activity over the realtime event relay. The frontend applies a
120 ms keydown throttle and the backend applies a 20 ms candidate-key throttle;
therefore rapid actions can be absent from the current in-memory timeline and
are never persisted. Accepted events are currently kept as individual raw
keystroke records for export, while the SSE room state exposes a bounded recent
history that the interviewer-only `ActivityTimeline` renders one row at a time.

The feature must make normal typing readable without turning a display concern
into source-event aggregation. It also touches the security boundary: candidate
activity is sensitive and must remain visible only to authorized room managers.

## Goals / Non-Goals

**Goals:**

- Capture every activity source action in the existing keyboard/paste/window-tab
  taxonomy as an individual raw audit event while a candidate has confirmed
  realtime access.
- Replace one-row-per-event presentation with deterministic, immediately updated
  grouped entries for authorized interviewers.
- Keep group boundaries stable across reordered delivery, SSE reconnects, and
  repeated state synchronization.
- Preserve editor/Yjs responsiveness and the existing bounded authorization
  recovery policy under rapid activity.
- Prevent any new candidate-visible, analytics, persistence, or export exposure
  of grouped data.

**Non-Goals:**

- Adding new activity categories such as mouse movement, editor selection, or
  full code-diff auditing.
- Changing raw-event export shape, retention policy, or manager authorization.
- Persisting grouped entries, changing the database schema solely for grouping,
  or making grouped entries editable.
- Reconstructing code state, clipboard contents, or unrecorded text from input
  events.

## Decisions

### Preserve source events; derive entries only for presentation

Every supported candidate action remains an individual, identifiable raw audit
event. The current keydown throttles must be removed or replaced by a delivery
mechanism that preserves a one-to-one source-event record; it cannot use a
source-event debounce, throttle, or coalescing rule. Physical delivery may be
bounded or batched only if every original event remains individually identifiable,
ordered, retry-safe, and persistable.

The grouped entry is a non-persisted presentation projection over the currently
available recent raw history. This is chosen over saving aggregate rows because
the export/audit contract needs raw detail and a saved projection would introduce
duplicate truth, retention, and reconciliation semantics. Source capture and
group display are therefore independently testable.

### Give every source event a durable identity and canonical acceptance order

The browser SHALL create a UUID `sourceEventId` when it observes an activity
action. A retry of that action SHALL reuse the same ID. Candidate activity uses
a dedicated FIFO with at most one in-flight POST, separate from Yjs/code
synchronization; it retains its head until a successful response. This removes
the current client-side keydown drop without turning the event stream into the
Yjs queue.

The server SHALL assign its authoritative timestamp and an increasing
`acceptedSequence` when it durably accepts a previously unseen source event. It
shall persist `sourceEventId` and `acceptedSequence` before updating recent
history or broadcasting to managers. A unique `(room_id, source_event_id)`
constraint makes retries successful no-ops: they return the originally accepted
event without adding another raw record or SSE broadcast. Canonical presentation
order is `(timestampEpochMs, acceptedSequence)` and reconciliation/deduplication
uses `sourceEventId`, never event payload equality.

An additive migration stores those fields and adds indexes for idempotent lookup
and canonical room ordering. Raw export remains append-only and is not limited by
the 50-event recent history. Legacy messages without `sourceEventId` remain
readable during rollout; the server mints an ID for them, while exactly-once retry
semantics apply to updated clients.

Raw acceptance uses an independent committed transaction, rather than joining
the enclosing realtime-relay transaction. A successful return from the
acceptance service is therefore a durable-commit boundary before any live
history mutation or SSE publication. The relay obtains immutable room metadata
under the in-memory room-state monitor, releases that monitor for database
acceptance, then reacquires it only to update the bounded history from the
accepted record. This keeps raw audit I/O from serializing Yjs/code operations
on the same room monitor.

The FIFO follows the accepted server-authoritative bounded `403` recovery: a
first `403` may trigger one recovery; a second rejection terminally clears and
stops activity capture. It must not treat rejected events as accepted or create
an unbounded direct-fetch retry stream. Activity `401` semantics are not part of
this change and require a separate OpenSpec/architecture decision. Network/5xx
failures retain the source event for reconnect retry with the same ID.

### Define canonical event order before grouping

The projection consumes the complete current retained history in canonical source
order, not transport-arrival order. Its ordering key is authoritative accepted
event time followed by a stable source acceptance order/identity. The
implementation must make that tie-break information available to the projection;
it must not rely on a React array index, display name, or a client receive time.
Repeated state synchronization deduplicates by source-event identity.

This requirement avoids a delivery race in which a late event is appended to the
wrong group, or a reconnect displays duplicate events. The Architect must select
the compatible wire/data representation for the stable tie-breaker; existing raw
record IDs and any accepted-event sequence are candidates, but the presentation
contract does not require a particular transport field name.

### Use a same-session, adjacent, anchored five-second grouping rule

For each canonical event in order, add it to the open entry only when all of the
following are true:

1. its stable participant/session identity matches the open entry;
2. it is adjacent to the prior raw event (an event from another participant
   closes the entry); and
3. its authoritative time is no more than 5,000 ms after the first event in the
   open entry.

The five-second comparison is inclusive. The window is anchored at the first
event in an entry, rather than sliding with each following event, so a continuous
long typing run produces readable bounded entries. A late event causes the
projection to sort and recompute the affected retained history; it never changes
the source data. The first event in an already-truncated history starts a new
visible entry because continuity before that retained boundary is unknown.

Grouping by stable session identity rather than display name prevents two people
with the same name from being merged. This satisfies the current participant
identity model and remains safe when names change. If two retained groups share
one display name but have different session identities, the timeline appends a
short non-sensitive suffix derived from the session ID. Unique names remain
unmodified so the normal interview view stays compact.

### Make action summaries readable without inventing data

Within an entry, consecutive printable keydowns are rendered as typed text,
including spaces, and non-editing actions remain ordered semantic tokens. These
include shortcut/special keys with modifiers, paste with its recorded character
count, and existing window/tab focus or visibility signals. A paste preview is
not promoted into the grouped UI. Unknown or non-printable input is represented
as a safe action token rather than being silently treated as text.

Each entry identifies the participant and its start/end time context, and is
rendered as plain text only. It does not become an editor, an event replay
control, or a source for analytics. This approach communicates phrases such as
typed text followed by `Ctrl+Z` without claiming that the candidate's code now
contains the displayed string.

### Treat rapid capture, authorization, and reconnect as one reliability boundary

The source-capture path must remain isolated from the Yjs/code synchronization
queue so rapid activity cannot delay collaboration. It must preserve the existing
server-authoritative authorization model and bounded `403` recovery: a capture
change cannot create an unbounded retry storm or let a candidate send/view data
after terminal access denial. Events observed after a confirmed session becomes
terminally unauthorized cannot be represented as successfully captured; the UI
must follow the established terminal access state rather than fabricate audit
records.

On a reconnect or late state/event update, the client replaces/reconciles its
bounded recent source history by source identity, orders it canonically, and
recomputes entries. It must not append a second copy of an already represented
event or retain a stale group that contradicts the authoritative state.

The server updates and broadcasts recent activity only after durable acceptance,
including when no manager is connected. It sends `lastCandidateKey` and
`candidateKeyHistory` only to server-authorized managers; candidate state-sync
messages omit both raw fields. Recent history remains bounded to 50 raw events
for live rendering, and its truncation never affects individual persistence or
manager-authorized JSON/CSV export.

### Verification strategy

The visible grouped timeline, raw-download preservation, participant separation,
and reconnect behavior require browser E2E acceptance tests. Exact temporal
reduction, equal-time tie handling, text/action tokenization, and late insertion
use a focused unit-test exception because a pure deterministic projection can be
exhaustively tested with controlled timestamps without browser timing flakiness.
Rapid accepted-event persistence and server-side manager/candidate authorization
use focused backend integration-test exceptions because they validate internal
durability and permission enforcement not observable solely through the rendered
timeline. The E2E test remains the pre-implementation acceptance gate for the
user-observable behavior.

## Risks / Trade-offs

- [Rapid input increases telemetry volume] -> Use a bounded delivery strategy
  that retains each source event individually, keeps telemetry out of the Yjs
  queue, and exercises slow-network and repeated-`403` regressions.
- [A raw event lacks a stable ordering identity in the current live history] ->
  Make canonical tie-break data part of the realtime contract before relying on
  it; cover equal timestamps and reconnect reconciliation in tests.
- [A bounded recent history can begin mid-activity run] -> Treat its first event
  as a new visible entry; raw export remains the complete individual audit view.
- [Grouped text is easier to read and therefore sensitive] -> Keep it
  manager-only, render untrusted values as text, avoid paste-preview expansion,
  and add candidate-isolation/server-authorization tests.
- [A rollback restores a less readable UI] -> Roll back only the grouped
  projection if required; do not roll back the raw-capture preservation fix or
  alter existing raw exports.

## Migration Plan

1. Add test fixtures and a canonical source identity/order contract if needed,
   while maintaining compatibility with existing recent raw-history payloads.
2. Remove/remediate source-event loss and prove individual raw persistence before
   enabling the grouped presentation.
3. Release the derived timeline projection; it reads raw events and writes no
   aggregate state or schema migration.
4. If the presentation must be rolled back, restore the individual-row renderer
   while retaining individual raw capture, authorization, and export behavior.

## Architecture Addendum

The accepted source identity is a client-generated UUID `sourceEventId`, reused
unchanged for every retry. On first acceptance the server assigns a room-local,
monotonic `acceptedSequence`; canonical order is exactly
`(timestampEpochMs, acceptedSequence)`. The server persists the raw event before
manager broadcast, including when no manager is connected, and deduplicates a
reused ID per room.

Activity delivery uses a separate FIFO with at most one request in flight. It is
authorized through the ordinary event relay and bounded `403` recovery; direct
fire-and-forget activity requests are forbidden. The V8 additive migration adds
`source_event_id` and `accepted_sequence`, a unique `(room_id, source_event_id)`
index, and canonical `(room_id, timestamp_epoch_ms, accepted_sequence)` index.
It backfills existing rows deterministically and permits legacy payloads without
`sourceEventId` by allocating an ID server-side. New fields are additive.

Only manager state sync and manager activity broadcasts contain activity history,
source IDs, or sequences. Candidate state sync omits them entirely. This addendum
supersedes the prior Architect ordering question.

## Persisted-room transition and persistent activity-failure addendum

### Treat persisted Room ID as a realtime-state invariant

An in-memory `RealtimeState` represents a persisted room and is therefore not
valid without its persisted Room ID. The ID is a required constructor value: it
has no empty fallback. `toRealtimeState` obtains it from a persisted `Room`, and
the direct reconstruction in the published-step transition copies the same
nonblank `room.id` that it just loaded from the repository. This makes an
omission compiler-visible rather than leaving a later candidate action to fail
after the room has already been published.

The transition does not create a new room. Its current candidate history,
connections, roles, and durable activity identity remain associated with that
same Room ID. The server-side integration regression sends the normal validated
manager step event followed by the normal candidate activity event, so it proves
both the state-rebuild invariant and exact durable acceptance/broadcast rather
than testing a private constructor in isolation.

### Bound only persistent `5xx` activity traffic

The existing activity FIFO remains separate from Yjs and retains an unchanged
`sourceEventId` for a transient server failure. It adds state local to one hook
instance/page-room session for the current FIFO head: a `5xx` response schedules
the second attempt after one second and the third after two seconds. It does not
tear down EventSource, clear an event token, or enter the authorization recovery
path. A successful response resets the failure count and continues FIFO drain.

The retry metadata belongs to the current FIFO head, not to a connection cycle:
it contains that head's `sourceEventId`, failed-`5xx` count,
`retryPending`, and `retryDueAt`. While `retryPending` is true and the due
time has not arrived, every activity-drain invocation returns without a POST.
It creates no second retry timer. In particular, a repeated `state_sync` or an
unrelated EventSource reconnect may refresh connection state but MUST NOT clear,
replace, or bypass this head gate. When the one timer becomes due, it may retry
only if the same head is still queued and the page-room session is neither
disposed nor activity-disabled. Removing a successfully accepted head clears
only that head's retry metadata; a later head never inherits its failure count.

After the third `5xx` for the head, the hook disables only activity capture for
that page-room session and clears its in-memory activity queue. The terminal flag
is not reset by a subsequent `state_sync` or automatic SSE reconnect; reload or
room re-entry creates a new hook session. The hook emits a rate-limited failure
metric and sends one generic, non-authorization message to the existing room
error presenter: `Запись активности временно недоступна. Вы можете продолжать
редактирование; обновите комнату, чтобы повторить.` It MUST NOT surface a raw
server invariant message to the candidate, remove access, or affect editing.

This activity-only terminal state is separate from the authorization-terminal
state and the ordinary capture-confirmation flag, so a later `state_sync`
cannot re-enable it. After it is set, newly observed activity—including a
physical Space key—does not enter the FIFO and cannot cause a fourth activity
POST. For an activity `5xx`, neither a raw response error body nor a
status-specific server message is passed to the visible room error presenter; the
one generic recording-unavailable notice is the only candidate-facing error for
this terminal condition.

The terminal notice state is retained and deduplicated with the activity-disabled
state. A real post-terminal `state_sync` followed by an unrelated EventSource
reconnect must leave that notice visibly rendered exactly once; neither callback
may re-enable capture, schedule or send activity traffic, or mint a new source
ID before a later physical key is processed. The E2E records `t1`, `t2`, and
`t3` for the three failed attempts and accepts the intended +1 second/+2
second cadence only when `t2 - t1 >= 850 ms` and `t3 - t2 >= 1,850 ms`,
which applies the documented 150 ms clock tolerance.

This is deliberately narrower than a generic room-event retry redesign. Network
failures, the main mutation queue, HTTP `403`, and HTTP `401` retain their
already specified behavior and are not altered by this defect remediation.

## Coverage-completion addendum

### Evidence is manifest-complete and reproducible

The coverage ledger SHALL be
`openspec/changes/group-activity-timeline-events/verification.md`. It freezes
the frontend manifest revision and every script whose name matches
`^(test:|e2e:|chaos:)` before execution. At the time of this addendum the
manifest contains 42 such scripts. The ledger must also include the standalone
`node tests/e2e/interview/e2e-activity-timeline-grouping.mjs`, the
post-registration `npm run e2e:activity-timeline` alias, `npm run typecheck`,
`npm run build`, and `mvn -q test` from `backend/`.

`e2e:all` is a required command in its own right even though it invokes a subset
of the individual commands. The ledger records command, manifest commit or
working-tree fingerprint, frontend/backend base URLs where relevant, result,
elapsed time, artifact/log location, and one of `green`, `product-red`,
`environment-blocked`, or `not-applicable`. If the manifest changes after it is
frozen, the executor must refresh the list and route newly added matching scripts
through the same gate rather than silently omit them. A blocked/not-applicable
entry cannot satisfy the release gate until qa-agent and test-reviewer-agent
provide written approval in that same ledger, naming the missing precondition and
the safe next action. If a completed historical task lacks its red/green
transcript, the ledger records `historical-evidence-gap` with the missing command
and assertion; it is not silently converted to green and cannot close a gate
without a rerun or the same reviewers' explicit exception.

### Test-first classification for audit gaps

The following additions are coverage-only baselines. Their first execution may
legitimately be green because the accepted behaviour already exists; that result
must be recorded separately from a red-before-production failure:

1. a real browser Space key's exact activity relay payload and readable grouped
   text;
2. a manager's 50-event live recent history compared with an unbounded,
   manager-authorized raw export;
3. manager reconnect visibility and candidate reload/reconnect isolation;
4. a burst through a transient 5xx with FIFO order, retry identity, and at most
   one activity POST in flight;
5. the accepted server-authoritative 403 activity recovery only; and
6. backend legacy-absent, malformed-present, and concurrent duplicate
   `sourceEventId` handling, including a single durable record and broadcast.

If any baseline is red because the product violates its assertion, preserve the
first red transcript and activate only its corresponding remediation task. No
implementation change may start merely to make a new coverage test green without
that evidence. A test that fails because the required browser/API stack is
unavailable must instead be repaired or marked environment-blocked.

Activity 401 handling is excluded from this change. No audit test or remediation
task may infer a 401 retry/terminal policy from the existing 403 contract; adding
that behaviour requires a separate OpenSpec proposal and architecture decision.

### Wire and migration verification boundaries

A physical DOM Space action is represented at capture by `KeyboardEvent.key ===
" "` and `KeyboardEvent.code === "Space"`. The E2E observes the actual relay
body, finds the same `sourceEventId` in raw JSON export, and checks both the
relay `key` and export's raw key representation (`keyValue`) plus `keyCode`.
This prevents a normalization layer from turning typed whitespace into the
literal word `Space`, dropping it, or changing it between transport and export.
The implementation may normalize an audit label internally only if the
relay/projection/export contract retains enough information to render the
original typed whitespace correctly.

The privacy E2E must simulate a genuine manager SSE transport disconnect and
subsequent reconnect, not merely a manager page reload. The post-reconnect
manager state-sync replaces local history and is checked for canonical,
non-duplicated source IDs. The candidate test captures a nonblank post-reconnect
event token from its actual EventSource state-sync, asserts the sensitive fields
are absent from every parsed candidate transport payload, then uses that token in
`X-Room-Event-Token` for the negative export request. This makes the expected
403 an authorization result for a valid candidate session, not a missing-token
artifact.

For transient 5xx coverage, the browser route fulfills the first activity POST
synthetically and never forwards it to the server. The retry therefore proves
FIFO behaviour without permitting an unobserved first server acceptance to hide
a duplicate or idempotency defect. The backend concurrent-ID integration case
covers both the same-ID single-row/single-broadcast invariant and distinct-ID
two-row/two-broadcast invariant with unique canonical sequences.

Empty-state and export-error presentation remain P2 deferred work. They are not
added to the audit suite or remediation tasks in this change.

The migration test is conditional. The repository's ordinary H2 test profile
uses `ddl-auto: create-drop` and has Flyway disabled; the checked-in development
compose file uses a persistent volume and is not by itself proof of a disposable
environment. Run a V1-to-V8 migration test only when an executor is given an
isolated PostgreSQL database that can be created and discarded without touching
shared, developer, or production data. Otherwise record the exact missing
precondition in the ledger and do not reset or mutate any existing database.

## Superseded questions

The two questions below are retained for historical traceability only. Product
scope is limited to the existing keyboard/paste/window/tab taxonomy, and the
architecture decision is `sourceEventId` plus server-assigned
`acceptedSequence`, as defined in the preceding addendum.

- **P1 — Product Owner:** Is the existing keyboard/paste/window-tab activity
  taxonomy the complete meaning of “every action,” or should a later change add
  mouse, selection, or other activity categories? This change intentionally
  preserves and fully captures only the existing taxonomy.
- **P1 — Architect:** Which backward-compatible stable source identity and
  equal-timestamp tie-break will be exposed to the recent-history projection?
  The requirement is deterministic order; the field/transport design remains
  an architectural decision.
