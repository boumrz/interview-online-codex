# Implementation Verification

## Task 0.1 — RED

- Command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml -Dtest=RoomRealtimeLifecycleDiagnosticsTest test`
- Result: failed at Kotlin test compilation, as expected before the diagnostic
  scaffold exists. The missing symbols were
  `RoomRealtimeLifecycleDiagnostics`, `RoomRealtimeLifecycleRegistryCounts`,
  `RoomRealtimeLifecycleHikariCounts`, and
  `RoomRealtimeLifecycleDiagnosticReason`.
- Interpretation: the new test cannot yet observe either required behavior:
  default-off emits no record, while explicit enablement emits the single fixed
  aggregate record. No lifecycle cleanup, transport, transaction,
  authorization, endpoint, pool, feature-flag, client, or E2E behavior changed
  in this RED step.

## Task 0.2 — GREEN

- Command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml -Dtest=RoomRealtimeLifecycleDiagnosticsTest test`
- Result: passed. The direct unit test proves that the explicitly disabled
  diagnostic writes no record and that explicit enablement writes exactly one
  `ROOM_REALTIME_LIFECYCLE_DIAG` line with `sequence=1`, a permitted reason,
  aggregate registry counts, and Hikari active/idle counts in the fixed order.
- Scope: `RoomRealtimeLifecycleDiagnostics` receives its enablement once at
  Spring construction, defaulting to false. The live test runtime may opt in
  with `ROOM_REALTIME_LIFECYCLE_DIAGNOSTICS=true`; normal callers receive no
  endpoint, response, metric, or identifier-bearing record. The only
  `CollaborationService` additions are aggregate callbacks after existing
  completion/timeout/error, explicit route-unmount, and replacement lifecycle
  actions. They leave cleanup, emitter ownership, transport, transaction,
  authorization, pool configuration, Yjs, client, and E2E code unchanged.
- Additional wiring check: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q
  -f backend/pom.xml -Dtest=HrPermissionPoolIntegrationTest test` passed and
  started the regular Spring context with the diagnostic default-off.
- Specification check: `npx --yes @fission-ai/openspec@latest validate
  investigate-room-sse-resource-saturation --strict` passed.

### Scope correction for task 0.2

The original two test cases covered only no-record disabled behavior and one
enabled fixed-schema record. They did not cover lazy aggregate evaluation,
concurrent append ordering, coherent registry observation, or stale replacement
callbacks; those properties are covered by tasks 0.3–0.4 below.

## Task 0.3 — RED

- Command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml -Dtest=RoomRealtimeLifecycleDiagnosticsTest,RealtimeConnectionLifecycleDiagnosticsIntegrationTest test`
- Result: failed with four required diagnostic-integrity failures:
  - disabled diagnostic mode eagerly invoked the registry supplier once;
  - concurrent callbacks appended `sequence=2` before `sequence=1`;
  - the forced interleaving observed a hybrid registry tuple of
    `connections=1`, `participants=0`, `roomMemberships=1`;
  - an explicit same-session replacement wrote the required `replacement`
    record, but a later stale completion added a second `normal-close` record.
- The expanded unit test also covers every permitted reason and its full ordered
  schema; that existing narrow behavior already passed. The focused Spring test
  uses an enabled in-process sink solely to prove aggregate diagnostic
  integrity—no HTTP/API, cleanup result, room state, transport, authorization,
  event-token, pool, frontend, Yjs, or E2E behavior changed during RED.

## Task 0.4 — GREEN

- Command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml -Dtest=RoomRealtimeLifecycleDiagnosticsTest,RealtimeConnectionLifecycleDiagnosticsIntegrationTest test`
- Result: passed. The focused suite proves that disabled mode invokes neither
  supplier nor sink; every permitted reason preserves the exact schema; two
  coordinated concurrent records append `1` then `2`; the forced join/detach
  interleaving emits a coherent registry triple; and an old completion after
  same-session replacement writes no second diagnostic line.
- Implementation: the diagnostic operation now locks lazy aggregate snapshot,
  Hikari sampling, sequence allocation and append together. Registry membership
  map mutations and aggregate observation share a private service lock. A
    callback records only after its existing detachment returned a live room;
    this suppresses diagnostic duplication without changing cleanup or transport
    results.

## Task 1.3 — architecture and security/reliability classification

- Confirmed facts: the fresh full suite retains SSE registry membership while
  Hikari reaches `active=10, idle=0`; delayed transport-error callbacks reduce
  those registrations only later. A stale same-session `leave_room` is accepted
  after replacement even though a stale `key_press` is rejected with 403.
- The timed-out production state-sync send is inside the transactional room
  admission call, but the reviewers agree that this stack is correlation, not
  enough to attribute every held Hikari lease to that transaction.
- Consequence: stale `leave_room` is an independent, confirmed authority fix;
  no transaction, broadcast, browser cleanup, pool, timeout, retry, API,
  reconnect, token-format or Yjs remediation is authorized yet. Tasks 1.4A–C
  add the exact real-send transaction discriminator before task 2.1 can be
  audited for implementation.

## Tasks 1.4A–1.4C — exact send-boundary classification

- Task 1.4A RED: the new exact-boundary test did not compile because
  `RoomRealtimeSendBoundaryProbe` was intentionally absent.
- Task 1.4B diagnostic result: at the held immediate state-sync
  `SseEmitter.send` boundary, `transactionActive=true`, Hikari active was `1`,
  idle was `9`, and the pre-admission active baseline was `0`. This is a
  transaction-candidate RED under the required two-signal rule; it is not a
  remediation.
- Task 1.4C authorized only two independent server-side slices in
  `CollaborationService`: bounded admission persistence before emitter/registry
  publication and state send; and current-token authority for leave plus stale
  supplied passive-token rejection. It expressly prohibits pool/timeout/retry,
  controller/API, client/reconnect, Yjs, role/privacy, diagnostics-transport
  and probe-hygiene changes. A fresh task audit is required before production.

### Task 0.4 review amendment — deterministic concurrency assertion

- The previous concurrent test submitted both records together, so a scheduler
  could let route-unmount acquire `sequence=1` before normal-close; it did not
  provide a stable proof of the intended ordering.
- The repaired test first waits until normal-close has acquired `sequence=1`
  and is blocked at append, then schedules route-unmount. Before the operation
  lock, route-unmount reaches append and exposes `sequence=2` before the held
  first line; the test now rejects that condition deterministically. With the
  lock, it cannot reach append until normal-close is released, and the exact
  final sequence remains normal-close `1`, route-unmount `2`.
- Re-run command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f
  backend/pom.xml -Dtest=RoomRealtimeLifecycleDiagnosticsTest,RealtimeConnectionLifecycleDiagnosticsIntegrationTest test`.
  Result: passed. No production behavior changed for this amendment.
- Re-run specification validation: `npx --yes @fission-ai/openspec@latest
  validate investigate-room-sse-resource-saturation --strict`. Result: passed.

## Task 1.1 — RED lifecycle characterization

- Acceptance-test scope: the existing top-level scenario `owner and assigned
  interviewer select locally and publish only through the explicit action` now
  owns the lifecycle sequence. It remains one of exactly 18 top-level tests
  (`node --check ...` passed and the top-level count is 18). Its test-only
  EventSource proxy records open/error/close for the page under test, and it
  reads only the exact aggregate `ROOM_REALTIME_LIFECYCLE_DIAG` schema from
  `E2E_REALTIME_LIFECYCLE_LOG`. The ordered assertions cover browser-context
  close, route unmount, the later editor/SSE admission, owner then interviewer,
  same-session replacement then old-page close, stale-token relay `403`, and a
  synthetic current-stream `onerror` followed by a new EventSource lease. The
  first forced close seeds the otherwise unavailable aggregate baseline; each
  later forced close/replacement compares every registry and Hikari count to
  its pre-admission aggregate baseline within five seconds.
- Fresh feature-on runtime: stopped only the authorized prior local-preview
  PIDs `52166` (frontend) and `52182` (backend). The literal matrix was then
  started with `FEATURE_TEAM_WORKSPACES=true`,
  `ROOM_REALTIME_LIFECYCLE_DIAGNOSTICS=true`, local PostgreSQL values, Java 17,
  and a generated 32-byte Base64URL test secret held only in a shell variable.
  The recorded test-pair PIDs were backend `80314` and frontend `80315`; the
  readiness checks returned frontend `/` = `200` and anonymous
  `/api/me/workspaces` = `401`. Evidence remains in
  `/tmp/interview-online-sse.6Gl61n/backend.log`.
- E2E RED command: `(cd frontend && E2E_REALTIME_LIFECYCLE_LOG=/tmp/interview-online-sse.6Gl61n/backend.log node --test --test-concurrency=1 tests/e2e/interview/e2e-room-context-panels.mjs)`.
  Result: `1..18`, `pass 7`, `fail 11`, `skipped 0`, duration
  `189403.97975ms`. The first failure is the embedded scenario #8, not test
  setup: `openRoomPage` timed out after 15 seconds waiting for
  `[data-testid="room-code-editor-host"] .cm-editor` while admitting the next
  owner context. The same real admission timeout then affected #9--#18.
- Lifecycle-category baseline at that RED boundary: the local-only backend log
  recorded the fixed-schema aggregate lines
  `sequence=1 reason=transport-error registryConnections=12
  registryParticipants=12 registryRoomMemberships=12 hikariActive=8
  hikariIdle=2` and immediately `sequence=2 reason=transport-error
  registryConnections=12 registryParticipants=12
  registryRoomMemberships=12 hikariActive=7 hikariIdle=3`. It subsequently
  reported Hikari `total=10, active=10, idle=0` acquisition timeouts. This
  confirms retained server registry/SSE state together with JDBC/Hikari
  exhaustion; it does not yet identify which lifecycle owner is permitted to
  remediate it.
- Focused backend RED command:
  `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml -Dtest=RealtimeConnectionLifecycleIntegrationTest test`.
  Result: compiled and ran one Spring integration test, then failed at
  `RealtimeConnectionLifecycleIntegrationTest.kt:80`: `Expected ApiException
  to be thrown, but nothing was thrown`. The preceding stale `key_press`
  assertion returned `403`, and the explicit stale `leaveRoomConnection` call
  left the one active replacement mapping intact before the failed assertion.
  The failed assertion is the stale old-lease `leave_room` after a same-session
  replacement. Therefore the active replacement registry mapping is present
  before that callback, but current route-unmount authority is not scoped to
  the old event token and can remove the replacement. This implicates the
  replacement/route-unmount authority boundary; no cleanup or authorization
  behavior was changed in this task.
- No production source, endpoint, transport, feature flag, Hikari setting,
  authorization rule, transaction boundary, token behavior, Yjs code, or E2E
  retry/skip workaround was changed. Tasks 1.2 onward remain pending; task 1.1
  is checked only because the requested RED test and category evidence are
  recorded.

## Task 1.2 — one-pair cumulative full-suite RED

- Fresh feature-on diagnostic pair: stopped only the authorized ordinary preview
  PIDs `81292` (backend) and `81293` (frontend). Started one new process pair
  with Java 17, local PostgreSQL values, `FEATURE_TEAM_WORKSPACES=true`,
  `ROOM_REALTIME_LIFECYCLE_DIAGNOSTICS=true`, and a generated 32-byte Base64URL
  HMAC secret held only in the shell variable. The recorded pair PIDs were
  backend `81846` and frontend `81847`; readiness was frontend `/` = `200` and
  anonymous backend `/api/me/workspaces` = `401`. Its single saved backend log
  is `/tmp/interview-online-sse.wMUFEi/backend.log`.
- First command, run from `frontend/`: `E2E_REALTIME_LIFECYCLE_LOG=/tmp/interview-online-sse.wMUFEi/backend.log node --test --test-concurrency=1 tests/e2e/interview/e2e-room-context-panels.mjs`.
  TAP result: `tests 18`, `pass 7`, `fail 11`, `skipped 0`, duration
  `190043.779792ms`. Its first failure is top-level test #8 `owner and assigned
  interviewer select locally and publish only through the explicit action`:
  `openRoomPage` timed out after 15 seconds waiting for the CodeMirror editor.
- Second command, run immediately on that same pair without restart, cleanup,
  or log rotation: `E2E_REALTIME_LIFECYCLE_LOG=/tmp/interview-online-sse.wMUFEi/backend.log npm run e2e:room-context-panels`.
  TAP result: `tests 18`, `pass 0`, `fail 18`, `skipped 0`, duration
  `30581.485958ms`. The first failure is now the shared fixture hook for test
  #1: `POST /auth/register` returned `500` after `30374.012917ms`, before any
  browser page could be admitted. This is intentionally recorded as the
  cumulative second-run outcome, not retried as a success.
- EventSource trace: the instrumented browser trace has no serializable entry
  for the first run's failing #8 page because `openRoomPage` timed out before
  that page completed SSE admission; the first seven contexts had already been
  destroyed when their per-window trace arrays went away. The corresponding
  server-side SSE trace is retained in the required diagnostic log: failed
  room-state and heartbeat sends reported `SocketTimeoutException` immediately
  before the aggregate lifecycle records below. No IDs, tokens, names, or room
  codes were emitted.
- Immediately following aggregate diagnostics and baseline deviation:
  `sequence=1 reason=transport-error registryConnections=13
  registryParticipants=13 registryRoomMemberships=13 hikariActive=10
  hikariIdle=0` followed the first-run failed SSE sends. Against the fresh
  clean registry baseline of zero connections/participants/memberships, this
  is a `+13/+13/+13` retained registry deviation while all ten Hikari
  connections are active. The backend then logged acquisition timeouts with
  `total=10, active=10, idle=0` and waiting requests up to 22. During the same
  unchanged pair's package run, the next aggregate lines were
  `sequence=2 transport-error registry=11/11/11 hikari=10/0`,
  `sequence=3 transport-error registry=10/10/10 hikari=10/0`, and
  `sequence=4 replacement registry=11/11/11 hikari=10/0`; the fixture's 500
  is therefore accompanied by continuing retained SSE registrations and pool
  exhaustion, not a new test setup error.
- No source, test, configuration, pool size, timeout, retry, skip, API,
  authorization, token, Yjs, or transport behavior changed in task 1.2. The
  evidence is RED-only and task 1.3 remains the required architecture/security
  classification gate before any remediation.

## Task 1.4A — exact-boundary RED

- Command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f
  backend/pom.xml -Dtest=RoomStreamAdmissionSendBoundaryIntegrationTest test`.
- Result: failed at Kotlin test compilation, as required before the probe
  exists: `RoomStreamAdmissionSendBoundaryIntegrationTest.kt:28:59 Unresolved
  reference: RoomRealtimeSendBoundaryProbe`.
- Scope: the new integration test creates a room admission on an executor,
  waits for the required pre-direct-state-sync-send test gate, and states that
  an active transaction must be false and Hikari active connections must equal
  the pre-admission baseline. No `RealtimeFaultInjectionService`, route,
  configuration, transaction, broadcast, cleanup, client, or pool behavior was
  altered in this RED step.

## Task 1.4B — exact send-boundary observation

- Implementation: added the default-no-op `RoomRealtimeSendBoundaryProbe` and
  one call immediately before the existing direct state-sync `emitter.send` in
  `CollaborationService.broadcastState`. An unarmed call returns before it
  samples transaction/Hikari state. The internal one-shot test gate stores only
  `transactionActive` and aggregate Hikari active/idle counts, waits no more
  than five seconds, and has no runtime arming path, property/environment
  switch, endpoint, response, log, metric, scheduler, room, identity, token,
  connection, or payload data. The test releases it and waits for the admission
  future in `finally`.
- Command: `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f
  backend/pom.xml -Dtest=RoomStreamAdmissionSendBoundaryIntegrationTest test`.
- Result: the one focused test reached the held physical send boundary and
  failed at its desired invariant with
  `SEND_BOUNDARY_TRANSACTION_ACTIVE active=1 idle=9 baseline=0`. The test
  process had `transactionActive=true`; the active count was above the
  pre-admission baseline. A scheduled H2-only cleanup SQL error was also logged
  by the pre-existing test context, but Maven's sole test failure was the
  controlled send-boundary assertion (`Tests run: 1, Failures: 1`).
- Classification: **transaction-candidate RED** — both required signals are
  present (`transactionActive=true` and Hikari active `1 > 0`). This is the
  single task-1.4B result. No transaction, outbound-send, registry, cleanup,
  authorization, client, timeout, pool, retry, endpoint, configuration, or
  transport remediation was implemented; task 1.4C remains the required review
  gate before any such change.

## Task 2.1A — test-first admission and authority RED

- Reconfirmed exact-send command:
  `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml
  -Dtest=RoomStreamAdmissionSendBoundaryIntegrationTest test`.
  Its sole test reached the held direct state-sync send and failed with
  `SEND_BOUNDARY_TRANSACTION_ACTIVE active=1 idle=9 baseline=0`:
  `transactionActive=true` and Hikari active remains above the pre-admission
  baseline. Maven reported `Tests run: 1, Failures: 1, Errors: 0, Skipped: 0`.
  The H2-only scheduled cleanup SQL error was logged by unrelated existing test
  context setup; the controlled assertion was the only Maven test failure.
  This is the required transaction-candidate RED, not a remediation.
- Strengthened lifecycle authority command:
  `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml
  -Dtest=RealtimeConnectionLifecycleIntegrationTest test`.
  It first failed at the `null` token in the ordered rejected-leave matrix:
  `Expected ApiException to be thrown, but nothing was thrown`
  (`RealtimeConnectionLifecycleIntegrationTest.kt:76 ->
  assertRejectedLeavePreservesActive:270 -> assertForbidden:399`). Maven
  reported `Tests run: 2, Failures: 1, Errors: 0, Skipped: 0`; the sibling
  `actual HTTP completion of an old stream cannot detach the newer replacement`
  test passed through a RANDOM_PORT `HttpClient` SSE stream (not Spring private
  callback/delegate reflection). The failing test contains ordered assertions
  for `null`, empty, whitespace-only, old and random nonblank leave tokens,
  each snapshotting the active mapping id, event token, emitter, membership,
  room state and test-owned no-send count. It retains blank bootstrap for both
  passive events and rejects both old and random nonblank tokens for each,
  before checking current-only leave and retired-token no-op after rejoin.
- Strengthened publication command:
  `JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -f backend/pom.xml
  -Dtest=RoomStreamAdmissionPublicationIntegrationTest test`.
  It failed at Kotlin test compilation as required before the scaffold exists:
  `RoomStreamAdmissionPublicationIntegrationTest.kt:36:65 Unresolved
  reference: RoomStreamAdmissionPublicationProbe` (followed only by dependent
  unresolved-type diagnostics). The rollback arm requires a test-owned
  `RoomProductMetricsProjector` spy to observe `recordParticipantJoin`, then
  requires the future probe's `durableAdmissionPrepared=true` alongside its
  in-transaction observation. The existing test-owned exact-send gate must
  remain unentered. The snapshot compares replacement mapping, participant,
  emitter, event token, membership, guest-capability count and metric, with no
  Spring `ResponseBodyEmitter` callback or early-send-field introspection. The
  committed arm requires one identical new id across mapping/participant/emitter/
  membership and `assertSame` between the returned emitter and the registered
  emitter.
- Safe RED ordering note: the publication test was temporarily absent only
  while the first two literal commands compiled; it was restored unchanged
  before its literal missing-probe command. No production source, configuration,
  controller/API, client, pool, timeout, retry, transport, Yjs, or lifecycle
  remediation was changed in task 2.1A.
