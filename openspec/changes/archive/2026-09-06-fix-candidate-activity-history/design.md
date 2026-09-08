## Context

See `proposal.md` for the reported freeze, disappearing history, and whole-interview
review goal. Diagnosis established these independent failure paths:

- `RoomPage.tsx` sets `LOG_HISTORY_LIMIT = 50`, trims in snapshot, incremental,
  and render paths, and replaces loaded history with the incoming tail or `[]`.
- `useRoomSocket.ts` permanently disables the activity lane and clears its FIFO
  after three `5xx` responses. The fetch has no deadline, so a stalled request
  can block all later activity. Temporary SSE availability also affects capture.
- `CollaborationService` reconstructs the recent activity from room JSON with a
  50-event cap. That snapshot is saved through a 260 ms debounce with errors
  swallowed; it is not the durable activity source of truth.
- Individual `room_keystroke_events` records are durable and not count-limited.
  They are deleted with room deletion. `KeystrokePersistenceService.accept`
  commits in `REQUIRES_NEW`, with a room lock, immutable source UUID, and room-local
  acceptance sequence. Its dispatcher currently enters an outer permission
  transaction first; the nested acceptance can wait for a second pool connection.
- V8 added source UUID and sequence fields and backfilled legacy records, but the
  columns remain nullable. Existing canonical order is timestamp then sequence;
  the index has that same ordering. A separate sequence index supports bounded
  catch-up without dependence on timestamp monotonicity.

The unrelated active grouped-timeline change is left intact. This change
supersedes its exact-50 rendered-history scenario, replacement of loaded history
by a recent state sync, and three-`5xx` terminal queue-drop requirement. It retains
its source identity, canonical grouping/export order, durable-before-broadcast
rule, and bounded authorization recovery. The accepted `realtime-room-access`
capability remains authoritative for `403` behavior.

## Goals / Non-Goals

**Goals:** separate durable history, bounded realtime cache, incremental delivery,
and loaded presentation; make each recover independently without event loss;
provide explicit API/error/security contracts and test-first execution gates.

**Non-Goals:** a persistent browser outbox; recovery of previously deleted or
never-acknowledged page-close events; changing activity taxonomy, grouping window,
raw JSON/CSV formats, archive/delete semantics, roles, Yjs, or the fixed stack;
broad transaction refactoring; rewriting previous active changes or HR edits.

## Decisions

These are root-task-owner decisions, supplied after frontend/backend diagnosis,
recorded for Architect and security/reliability review before implementation.
The Specification Agent does not independently select a replacement architecture.

### Add a bounded durable-history API

`GET /api/rooms/{inviteCode}/activity-history` uses the existing room-manager
authorization paths, including authenticated owner/interviewer and supported
event-token guest-manager access. Authorization precedes any history disclosure.

| Query field | Contract |
| --- | --- |
| `limit` | Optional integer, default 200, range 1..200. |
| `beforeSequence` | Optional non-negative long, exclusive older boundary. |
| `afterSequence` | Optional non-negative long, exclusive catch-up boundary. |
| `throughSequence` | Optional non-negative long, inclusive frozen upper acceptance boundary. |

`beforeSequence` and `afterSequence` are mutually exclusive. Without either,
return the latest page. An initial request without `throughSequence` captures
the highest committed sequence for that room, or zero for an empty history.
Every continuation uses the response's frozen boundary. The response contains:

```text
events: CandidateKeyPayload[]
hasMore: boolean
nextBeforeSequence: long | null
nextAfterSequence: long | null
throughSequence: long
```

The initial/older query selects the highest sequences below `beforeSequence`, if
supplied, and at or below `throughSequence`; the next older cursor is the minimum
selected sequence. Catch-up selects the lowest sequences strictly greater than
`afterSequence` and at or below the frozen upper boundary; its next cursor is the
maximum selected sequence. Query at most `limit + 1` rows to determine `hasMore`;
return at most `limit`. Return only the applicable continuation cursor when more
rows exist, otherwise null. Emit events in canonical timestamp/sequence order
within the page; clients merge all loaded events into that same order. Cursor
progress derives from sequence minima/maxima, never array position after sort.

Responses use `400` for malformed or incompatible cursor/limit arguments, `403`
for a non-manager, `404` for a missing room, and `410` for an archived room, while
preserving the current API's authorization/error ordering. A cursor is a numeric
room-local boundary, not a credential. Every query includes the authorized room
ID. Normalize a supplied upper boundary to
`min(requestedThroughSequence, currentCommittedMaximum)`; return that normalized
boundary. A future `beforeSequence` is permitted and selects the latest rows
within the normalized upper bound. An `afterSequence` beyond the normalized upper
bound returns an empty result with that bounded `throughSequence`. A supplied
future cursor therefore cannot certify uncommitted events. Integration coverage
must include `Long.MAX_VALUE` and subsequent complete traversal.

**Rationale:** increasing/removing the 50-row SSE cap still leaves snapshot loss
and sends the entire interview repeatedly. Unbounded raw export remains useful
for downloads, but is not suitable as a polling history endpoint. Sequence-based
paging avoids missing later accepted events if server timestamps move backward;
display/export timestamp ordering remains compatible.

### Preserve append-only persistence and repair durable reconstruction

Add `V10__candidate_activity_history.sql`; do not edit V8 or the concurrently
created V9. Add an index on `(room_id, accepted_sequence)`. Backfill only null
source IDs from each row's existing ID. Backfill only null sequences in each room
after that room's existing maximum, ordered deterministically by timestamp and
row ID. Preserve every existing non-null source ID, sequence, and event payload.
No history is deleted or renumbered. Apply migration before enabling paged reads.

Restore the bounded 50-event realtime tail from durable activity rows. Room JSON
is only a legacy fallback when no durable activity exists; stale JSON must never
replace durable history. Keep existing manager-only SSE payload selection.

Special-case only activity dispatch so `key_press` reaches its already-authorized
handler without an enclosing permission transaction retaining a connection.
Its independent committed acceptance transaction, room locking, idempotency,
and before-broadcast commit remain intact. Leave ordinary permission mutations
inside their current transaction path. Prove the change first with a pool-size-1
integration test and a five-second completion deadline.

### Reconcile loaded history instead of replacing it

Create one room/permission-scoped history context. The initial manager read loads
the latest page; older-history control walks toward the beginning without a
total UI cap. Merge by immutable `sourceEventId`, canonicalize timestamp/sequence,
and recompute the existing grouping projection across page boundaries.

The history context belongs to the stable owner layout in `RoomPage`, outside
the conditionally rendered timeline. Switching between Logs, Chat, other rail
panels, or mobile tabs preserves loaded events and both traversal cursors for
the same authorized room/account. A hook `active` option (default true) controls
visibility-dependent work: hiding Logs aborts current history/export requests
and pauses polling without clearing the cache; SSE tails can still merge.
Showing Logs resumes durable catch-up from the completed cursor, including an
unfinished frozen traversal. Room/account changes, manager permission loss, and
leaving the room still invalidate and clear the private context.

The **confirmed durable catch-up cursor** advances only after the entire frozen
API traversal is exhausted. It is separate from the highest sequence seen over
SSE. A live event arriving ahead of missing durable rows cannot advance this
cursor and hide the gap. Initial latest-page completion confirms its returned
upper boundary for future catch-up; its unloaded older records remain reachable
through the independent older cursor.

Trigger catch-up on initial entry, reconnect, and regained permission. While the
activity panel is open, start a new catch-up cycle within five seconds after the
prior cycle completes, with a freshly captured upper boundary. Serialize initial,
older, and catch-up reads; use one queue of pending intents rather than overlap.
Abort/timeout reads after 10 seconds and allow visible retry. A failed page leaves
its cursor unchanged and retains loaded rows. Bounded empty snapshots are merge
inputs, never deletion commands. On room change, sign-out, or current-role loss,
abort reads, invalidate their context generation, and clear sensitive state;
late completions from that generation cannot restore it.

Loading, confirmed empty, partial-with-more, complete, and recoverable-error states
must be distinguishable. Use `Показать более ранние события` for older history and
`Повторить загрузку` for retry. The older-history control is disabled while its read
is pending. Existing JSON/CSV downloads remain independent of page loading.
Other feedback must communicate the current state without raw server details.

### Keep the activity FIFO recoverable without retry storms

Retain the one-in-flight FIFO and immutable UUID per captured source action. Add
a 10-second request deadline. Treat timeout, network error, `429`, and `5xx` as
retryable with 1, 2, 4, 8, 16, then 30-second delays from completion of each failed
attempt. Keep subsequent failures at 30 seconds. Preserve the head, queued later
events, and active capture while the current page-room session remains valid.
Temporary SSE outage alone does not disable capture. Do not add a three-attempt
terminal state or clear the queue due to these retryable failures.

Store retry state/due time with the current head, enforce it from every drain
entry, and schedule at most one timer. State sync, token recovery, and unrelated
reconnect do not bypass due time or create overlap. Abort timed-out fetches before
retry scheduling, and ignore late completions of abandoned attempts. Successful
acknowledgement advances the head once; the backend idempotency boundary covers
commit-success/response-loss. Show recoverable delayed-recording feedback during
failure and clear it after the pending delivery recovers; preserve normal editor
and room-event operation and keep raw error bodies out of the UI.

Retain current `401`, bounded `403`, and archived-room `410` terminal semantics;
none enters the indefinite retry lane. Cancel timers/requests on context teardown.
The queue is explicitly volatile across full page close/reload. A browser durable
outbox would add persistence, retention, and recovery scope and is deferred.

## Risks / Trade-offs

- Loaded history and a volatile outage queue can grow during a long interview →
  network pages and in-flight work remain bounded; no silent count-based drop is
  allowed. A later virtualization/outbox change can address measured capacity.
- Future cursor values could skip committed-boundary guarantees → clamp the upper
  bound to the current committed maximum and test future-cursor traversal.
- A backend transaction shortcut could bypass permission checks → scope it to
  already-authorized activity dispatch and require permission, durability,
  duplicate-broadcast, and one-connection integration evidence.
- Backfill on a busy database can take locks → use an additive deterministic
  migration, verify against a disposable supported database when available,
  preserve all current identities and avoid editing versioned migrations.
- Old E2E assertions encode deliberate three-failure shutdown and 50-row display →
  replace those assertions with the new stronger recovery/history assertions
  before production changes; do not remove grouping/privacy regressions.
- Late history responses can expose revoked activity → context-generation fences,
  server authorization on every read, immediate role-loss clearing, and a delayed
  response revocation regression are mandatory.

## Migration Plan

1. Strictly validate the change and obtain product/architecture/task-quality gates.
2. Author and run the new browser, persistence/cursor/auth/pool integration, and
   deterministic retry/merge tests; preserve product-red evidence before edits.
3. Apply additive V10 and verify null-only backfill and the sequence index. H2
   integration verification does not claim PostgreSQL/Flyway execution.
4. Deploy compatible backend history/reconstruction/dispatch support before the
   client consumes the new endpoint. Existing raw export and SSE remain valid.
5. Deploy client paging/reconciliation/retry changes and run targeted regression.
6. Rollback can disable the new UI consumer and restore the prior client while
   keeping additive schema/data. Do not reverse the backfill or delete history.

## Open Questions

None. The root task owner resolved future-cursor clamping and confirmed a local
PostgreSQL server with permission to create an additional disposable fixture
database for migration tests. QA must use that disposable database, preserve the
existing HR database, and record the actual PostgreSQL/Flyway result. No Linear
issue was supplied.
