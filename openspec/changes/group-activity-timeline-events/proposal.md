## Why

The interviewer Activity Timeline currently renders each accepted candidate activity
event as a separate row, which makes normal typing difficult to read during a live
interview. Interviewers need compact entries that communicate what was typed and
which meaningful non-editing actions occurred, without weakening the detailed raw
event audit trail.

## What Changes

- Add an interviewer-visible Activity Timeline projection that groups consecutive
  candidate activity events from the same participant when their authoritative
  event times are no more than five seconds apart.
- Render each grouped entry as a readable, ordered summary of typed text and
  non-editing actions, including shortcuts, paste, and window/tab-focus signals.
- Preserve capture, relay, persistence, export, and authorization of every
  candidate activity source event produced while realtime access is confirmed as
  individual source events. Existing keydown throttles that lose source events
  SHALL be removed or remediated; grouping SHALL NOT add source-event debounce,
  throttling, coalescing, or loss.
- Define deterministic ordering, five-second boundary, reconnect, and late-event
  behavior so the timeline does not duplicate, merge across participants, or
  silently discard a displayed source event.
- Preserve privacy: only authorized room managers may receive or view source
  activity or its grouped summaries, and grouping creates no new analytics,
  persistence, export format, or candidate-visible data channel.
- Add an additive V8 persistence migration for immutable `sourceEventId` UUIDs,
  server-assigned per-room acceptance sequences, idempotency/canonical-order
  indexes, and compatibility with activity history created before those fields.
- Replace the fire-and-forget activity relay with a separate one-in-flight FIFO:
  it retries using the same source-event ID, is authorized through the normal
  event relay, and never bypasses bounded `403` recovery.
- Preserve a persisted room identity whenever an active room moves to another
  published step, so later candidate activity is accepted against the same
  durable room rather than failing in an incomplete in-memory state.
- Keep the activity-only FIFO safe during a persistent server failure: a
  transient `5xx` may retry the same source event, but a repeated `5xx` must
  stop activity recording for the current page-room session rather than create
  an unbounded `/events` and SSE-reconnect storm. Editing and normal room
  collaboration remain available.

## Capabilities

### New Capabilities

- `grouped-activity-timeline`: Deterministic, privacy-preserving presentation of
  recent raw candidate activity as readable interviewer-only grouped entries.

### Modified Capabilities

- None.

## Impact

- Frontend Activity Timeline rendering and its pure activity-formatting helpers.
- Existing room realtime state/history consumption, including reconnect and
  out-of-order/late updates; activity history is manager-only in state sync and
  the server remains the authorization authority.
- Kotlin persistence, DTO/SSE contracts, and additive V8 database migration for
  source IDs, accepted sequences, and supporting indexes.
- Browser E2E acceptance coverage and focused unit/integration coverage for the
  deterministic grouping projection, raw-event preservation under rapid input,
  and bounded authorization/reconnect behavior.
- The activity relay's post-step durable-room invariant and bounded persistent
  server-failure behavior, without changing the existing authorization policy,
  Yjs relay, or general room-event retry policy.
- No external dependency, analytics event, aggregate timeline persistence, or
  breaking raw-export change is requested; raw-event schema additions are
  backward-compatible and preserve existing retention.

## Approved coverage-completion scope

This change also includes a release-evidence expansion. It does not add product
scope or a second activity transport: it proves the accepted behaviour against
the repository's complete automated command surface and closes only the
critical, currently unaudited cases below.

- Execute every frontend manifest script whose name starts with `test:`,
  `e2e:`, or `chaos:` (including the aggregate `e2e:all`, which is evidence in
  addition to—not a substitute for—its individual commands), the standalone
  activity-timeline E2E, frontend typecheck/build, and the full backend Maven
  suite.
- Add a package-script alias for the standalone activity E2E. The missing alias
  has a known configuration red baseline; its registration is not a product
  behaviour change.
- Add only the following critical coverage: a physical Space key's browser wire
  format and readable space; 50-event live-history truncation versus complete
  raw export; manager reconnect and candidate reload privacy; FIFO burst
  delivery through 5xx/retry with one request in flight; the accepted
  server-authoritative activity 403 policy; and legacy, malformed, and
  concurrently duplicated source IDs with one broadcast; a registered persisted
  non-owner interviewer's actual state-sync/history/incremental activity, visible
  Activity Timeline, and Bearer-authorized raw export; a guest promoted through
  the realtime room path whose token-only export succeeds and whose revoke/reconnect
  returns that same guest to privacy-preserving candidate denial; and a manager UI
  CSV download that retains individual canonical rows, count, source identity,
  accepted sequence, physical-Space key data, and paste length while the revoked
  guest candidate's own valid realtime token remains forbidden. Activity 401
  behaviour is explicitly excluded pending a separate OpenSpec/architecture change.
- Add release-only browser coverage for two baseline room-access denials: a
  non-existent invite must not expose an editable room workspace, and an event
  token made stale by a same-session reconnect must be rejected by the protected
  relay without producing an action. This proves existing denial behaviour; it
  does not change token lifetime, room access, or authorization policy.
- Verify the V8 Flyway migration only when a disposable, repeatable local
  PostgreSQL/Flyway environment is actually available. The normal H2 test
  profile disables Flyway, so an unavailable disposable environment is recorded
  as `not run` evidence rather than misclassified as a product failure.

Evidence is recorded in
`openspec/changes/group-activity-timeline-events/verification.md`. Any
`environment-blocked` or `not-applicable` entry requires written approval from
both qa-agent and test-reviewer-agent before it can satisfy a release gate.

**P2 deferred:** empty-timeline state and raw-export error presentation are not
expanded by this coverage change. They require a separate scoped proposal unless
they become necessary to keep one of the release gates above truthful and
non-weakened.

Every newly authored audit assertion is first a coverage-only baseline. A green
result increases evidence without authorizing unrelated implementation work. A
product-caused red result becomes the required test-first predecessor of the
matching, narrowly scoped remediation task; an unavailable stack remains an
environment blocker, not a red product test.
