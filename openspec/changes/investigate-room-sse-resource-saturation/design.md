# Design

## Context

See `proposal.md` for motivation. A fresh feature-on run of the current full
room-context E2E passes its first seven tests and then fails later `openRoom`
calls waiting for CodeMirror. The concurrent backend logs report Hikari
`total=10, active=10, idle=0` acquisition timeouts and failed SSE responses.
After a restart, the first failing baseline and the new UX scenarios pass in
isolation. This localizes the present failure to cumulative lifecycle use but
does not establish whether the retained resource belongs to the browser,
emitter registry, transaction, or another database path.

`CollaborationService` owns the server SSE registry and callbacks;
`useRoomSocket` owns browser EventSource/reconnect/normal-close behavior.
`RoomContextPanels` and the new UX change are not allowed to own this fix.
The prior UX remediation is the accepted AC-11 interface baseline; this change
may amend only its existing test file and must not alter its 18 top-level-test
contract. `recover-missing-room-sse-stream` supplies the current reconnect
contract but does not own connection-resource accounting.

## Goals / Non-Goals

**Goals:**

- Find a reproducible resource-retention boundary before changing production
  lifecycle behavior.
- Make normal close and replacement/reconnect release exactly the obsolete
  server state while preserving authorization and active-session behavior.
- Restore a fresh full 18/18 `e2e-room-context-panels` run with its existing
  role, privacy, CodeMirror and Yjs assertions.

**Non-Goals:**

- Changing Hikari capacity, connection timeout, SSE timeout, global servlet
  executor sizing, or test retries as a standalone workaround.
- Changing public realtime endpoints, guest reconnect capabilities, role
  resolution, event-token security, Yjs wire format, room persistence or
  feature flags.
- Treating isolated UI tests as a substitute for the complete room regression.

## Decisions

### 1. Diagnose resource ownership before selecting the fix

The first RED slice will add test-scoped lifecycle accounting around the current
full-room fixture and a focused backend integration check for normal close and
same-session replacement. It will account for browser EventSource closure,
server connection registry membership and the ability to acquire admission for
the next room. It will not expose pool metrics or event tokens through an API.

This establishes whether the leak is client normal-close, server emitter
detachment, transaction lifetime or a separate data-access operation. Increasing
pool capacity was rejected because it can conceal every one of those faults.

The diagnostic records only counts/categories and uses the following internal,
test-scoped observation contract; none is served via HTTP:

| Candidate boundary | Test-only evidence | Clean baseline after bounded cleanup wait |
| --- | --- | --- |
| Browser close/unmount | EventSource proxy open/close trace for the exact test context | every source opened by the closed context was closed before the next admission |
| Server registry/emitter | package-internal `CollaborationService` lifecycle snapshot containing only aggregate connection, participant and per-room registration counts | aggregate counts return to their pre-test baseline; no connection identity is exposed |
| Replacement/reconnect | stale old-close and stale-token relay attempt plus active replacement state/Yjs sync | old relay is 403; replacement remains connected and synchronised |
| JDBC/Hikari retention | integration-test-only `HikariDataSource` MXBean active/idle counts, sampled before admission and after cleanup | active connections return to the pre-test baseline before the next admission |

The bounded cleanup wait is five seconds, polling no more often than 100 ms. A
timeout reports the first non-baseline category; it is evidence of failure, not
a retry trigger. The test-only snapshot belongs in the Kotlin service package or
test configuration and returns no IDs, tokens, names, room codes or raw pool
details to application callers.

For the separately running live E2E backend, an explicitly enabled,
default-off test diagnostic logger is the sole observation transport. It appends
one line after each lifecycle callback in this fixed schema:

```
ROOM_REALTIME_LIFECYCLE_DIAG sequence=<integer> reason=<normal-close|route-unmount|transport-error|replacement> registryConnections=<integer> registryParticipants=<integer> registryRoomMemberships=<integer> hikariActive=<integer> hikariIdle=<integer>
```

The logger has no public route, response or application metric. The E2E runner
receives the temporary log path only through `E2E_REALTIME_LIFECYCLE_LOG`; after
each forced lifecycle action it records the next monotonic line and compares
counts to the pre-admission baseline. The reason and aggregate counts are
sufficient to classify the first retained category without correlating an ID,
token, room or participant. The separate backend integration test remains the
deterministic proof of registry/replacement semantics.

The logger is a deliberately bounded test-infrastructure exception, not a
lifecycle remediation. Its initial TDD slice may add only
`RoomRealtimeLifecycleDiagnostics` and a non-mutating aggregate callback from
`CollaborationService`: the RED test proves that disabled mode writes no line
and enabled mode writes exactly the fixed aggregate schema. That slice must not
change emitter cleanup, EventSource behavior, transaction boundaries,
authorization, pool configuration or any public API. Only after it is GREEN
may the E2E RED use the logger to identify a lifecycle boundary.

Diagnostic integrity is part of that bounded scaffold. Disabled mode must not
evaluate the registry or Hikari suppliers. An enabled diagnostic operation
linearizes aggregate snapshot, sequence allocation and local-log append, so
the log order is strictly `1, 2, …` even for concurrent callbacks. Registry
membership mutations and the aggregate reader share one internal observation
boundary: the reader may observe a later state, but never a hybrid of several
map mutation steps. A diagnostic reason is recorded only after a successful
live detachment; an old emitter completion after an explicit replacement emits
no second normal-close record. This boundary is solely for coherent
observation—cleanup, emitted room state, transport completion, authorization
and event authority retain their existing semantics.

### 1a. Exact outbound-send transaction discriminator

The production stack containing both `TransactionInterceptor` and
`SseEmitter.send` is correlation, not standalone proof that a held admission
transaction causes every active Hikari lease. Before changing transaction,
broadcast, container or client lifecycle behavior, a test-only internal
`RoomRealtimeSendBoundaryProbe` will pause immediately before the existing
direct state-sync `SseEmitter.send` in `CollaborationService.broadcastState`.

The probe is permanently default-no-op: it has no environment switch, HTTP
route, response, metric, log line, scheduler or normal-runtime arming path. An
unarmed call does not sample Hikari or transaction state and retains no room,
participant, connection, identity, payload or token data. Only an in-process
Kotlin integration test may arm a one-shot gate. Its observation contains only
`transactionActive: Boolean` and aggregate Hikari active/idle counts.

The gate is inserted immediately before the direct `emitter.send` state-sync
call—not in the fault-latency branch, controller, or generic helper. It exposes
an `entered` latch and waits on an internal `release` latch for at most five
seconds. The test arms it, begins normal room admission on an executor, waits
until the exact send boundary is reached and asserts the desired invariant:
while outbound delivery is mechanically held, the admission transaction has
already completed and Hikari active count equals the pre-admission baseline.
It releases the gate and waits for the future in `finally`.

The current behavior must first produce a transaction-candidate RED only when
the transaction is active **and** Hikari active count is above baseline. A
one-signal difference is INCONCLUSIVE and cannot authorize transaction,
broadcast or client-cleanup remediation. The probe itself is not a GREEN
remediation and cannot alter cleanup, emitter completion, SSE semantics, Yjs,
authorization, transaction outcome, pool configuration or client behavior.
`RealtimeFaultInjectionService` is not an acceptable classifier because its
latency is before `broadcastState` reaches the physical send boundary.

| Exact-send classifier | Meaning | Consequence |
| --- | --- | --- |
| Transaction candidate RED | `transactionActive=true` **and** Hikari active count is above the pre-admission baseline at the held real send boundary | Only `CollaborationService` transaction-versus-outbound-send remediation may be considered after re-audit. |
| GREEN | `transactionActive=false` **and** Hikari active count equals the pre-admission baseline | The log correlation does not authorize a transaction/broadcast change; investigate another database owner. |
| INCONCLUSIVE | Exactly one signal differs from GREEN | Do not change transaction, broadcast or client cleanup; add a separate database-owner investigation. |

The confirmed stale `leave_room` authority flaw is independent in both rows:
an old token must receive 403 and never detach the active replacement, while a
current-token normal leave remains idempotent. It must not be presented as a
remedy for Hikari saturation.

### 1b. Authorized post-classification boundaries

Task 1.4B is a transaction-candidate RED: at the held physical state-sync send
boundary `transactionActive=true`, Hikari active is `1`, and the pre-admission
baseline is `0`. The permitted saturation remediation is limited to
`CollaborationService`: both public room-stream admission entry points must
complete a bounded admission transaction before any emitter creation,
registry publication, callback attachment, duplicate eviction, or
`broadcastState` call. The bounded transaction contains only the existing
lock/read/access-resolution, durable participant metric projection, and
durable admission work and
returns an immutable admission snapshot after commit or rollback. It must not
use `afterCommit`, because transaction synchronizations may still retain the
resource when their callbacks run.

After a successful commit, register the new emitter and authoritative
invite-code/session mapping atomically under the existing registry observation
lock, then detach/complete only the displaced connection and call the existing
`broadcastState` outside every admission transaction. A rollback publishes no
emitter, event token, reconnect capability, callback or broadcast. The latest
successfully published connection remains authoritative: a late old completion
or leave can remove only its validated connection id, never a replacement.

`RoomStreamAdmissionPublicationProbe` is a second, internal test-only
publication discriminator. It has no runtime arming path, property, endpoint,
response, metric, log, scheduler, or identifier-bearing state. Its unarmed
path performs one non-mutating atomic read and returns. A Kotlin integration
test may arm exactly one mutually exclusive action: a final in-transaction
rollback failure after the immutable admission snapshot and durable metric work
have been prepared but before the template returns; or a five-second pause
immediately after the template returns and before any emitter,
token/capability, callback, registry, replacement or broadcast work. The
failure gate observes only `transactionActive=true` and throws an internal test
exception; the pause gate proves successful durable work is committed while
the existing published stream remains the only runtime stream. The probe is
observation infrastructure—not a production lifecycle branch.

The rollback observation also declares only the non-sensitive boolean
`durableAdmissionPrepared=true`; a test-owned spy must first observe the
existing durable metric projection in the bounded transaction, so the test
cannot accept a probe placed at the beginning of admission. The test-owned
exact-send probe, rather than Spring `ResponseBodyEmitter` private callback or
early-send fields, proves that the failed admission did not send state. The
successful path compares one exact new connection id across the authoritative
mapping, participant map, emitter map and room membership, and compares the
returned emitter with that registered emitter.

Publication assertions use immutable room-state fingerprints, exact
room-session mapping entries and a deterministic reader under the existing
registry observation lock. During post-commit publication it may observe only
the complete old tuple or complete new tuple, never a hybrid. The test attaches
an observer to the displaced physical emitter: forced rollback completes none
and successful replacement completes it exactly once. The embedded full E2E
uses only newline-complete diagnostic records, requires the direct next
monotonic sequence, requires zero registry counts after its first forced close
to establish a quiescent Hikari baseline, and requires exactly one replacement
EventSource after a bounded stabilization interval.

The corresponding integration test must establish an active same-session
replacement, force a third admission to roll back, and prove the replacement
mapping, participant, emitter, event token, membership, guest-capability count
and product metric remain unchanged; the exact-send gate must stay unentered.
On a successful paused replacement it must prove the metric is durable before
publication, then after release prove one coherent new
mapping/participant/emitter/membership tuple and an absent old tuple. A
current-token leave detaches once; a retry after that token is retired is 403
and mutates nothing, and the same retired token is also 403 after rejoin. No
token tombstone or new HTTP-status contract is introduced.

The independent authorization repair remains server-side and is separately
verified. `leave_room` always requires the current nonblank event token;
blank, stale and mismatched tokens return 403 without changing the registry,
emitter, room state or replacement. `presence_update` and
`request_state_sync` retain their existing blank-token bootstrap behavior,
because the client sends them before its first `state_sync`; if either carries
a nonblank token, it must match the current connection or return 403 without
presence mutation or state send. Repeated leave after its mapping was revoked
returns 403; idempotence means it performs no second mutation and cannot
remove a replacement.

No other production source is permitted. `RoomRealtimeSendBoundaryProbe`
remains an internal test-only measurement seam: its current unarmed atomic
gate implementation is intentionally not part of the lifecycle or authority
remediation and needs a separately scoped diagnostic-hygiene TDD slice before
any alteration. Hikari sizing/timeouts, servlet/executor settings, retries,
controllers, public API/DTOs, frontend cleanup, reconnect capability,
role/privacy policy, Yjs format and diagnostics transport remain prohibited.

### 2. Preserve one authoritative normal-close path

After the failing ownership boundary is known, production code will use the
smallest existing lifecycle path that removes only the obsolete session,
invalidates its event authority and notifies the room state once. Completion,
timeout, transport error and client `leave_room` must remain idempotent so
reconnect/replacement cannot double-remove a newer session.

Changing a client cleanup hook alone was rejected until the RED evidence proves
that normal browser close fails to signal the existing server cleanup. Changing
server registry logic alone was rejected until the same evidence proves the
client close actually reaches the server. Any lifecycle change must retain
candidate visibility, interviewer privacy and reconnect conflict semantics.

### 3. Treat the full E2E as the final observable contract

The full current room suite runs in one fresh backend/frontend pair and proves
all 18 tests. Focused named cases remain fast diagnosis, but only a complete
successful run closes this change. If it fails, recorded diagnostics identify
the first resource category and the task stays open; no retry-only success is
accepted.

### 4. Constrain diagnostics and review

Test-only inspection must be unavailable to normal HTTP clients and must not
return connection IDs, event tokens or user identities. A reliability/security
review follows code changes because session detachment changes the boundary
between active and stale event authority. Solution review checks transaction and
registry ownership; QA runs full suite; test reviewer checks cumulative and
reconnect coverage.

## Test runtime matrix

Run every RED/full-suite command in one manually started, fresh feature-on pair.
The supplied `scripts/dev-up.sh` is not used because this checkout does not
serve its expected actuator health endpoint. The test operator supplies a
test-only `CHAT_RECEIPT_HMAC_SECRET` through their shell; commands never print
the secret or write a configuration file.

1. Before startup, confirm that no process listens on TCP ports 8080 or 5173;
   if one does, record its PID and stop only that known prior test process.
2. In terminal A, from `backend/`, run with Java 17, the local test database
   values, `FEATURE_TEAM_WORKSPACES=true` and the pre-exported secret:
   `mvn -q spring-boot:run`. Capture its PID and stdout/stderr in a temporary
   log outside the repository.
3. In terminal B, from `frontend/`, run
   `FEATURE_TEAM_WORKSPACES=true npm run dev`, again capturing its PID and a
   temporary log outside the repository.
4. Wait until `http://localhost:5173/` returns 200 and
   `http://localhost:8080/api/me/workspaces` returns 401 for an anonymous
   request; 401 proves the API is running without treating authorization as an
   error. Capture backend Hikari diagnostics in the temporary log if a suite
   fails.
5. Run the exact unfiltered command
   `node --test --test-concurrency=1 tests/e2e/interview/e2e-room-context-panels.mjs`
   from `frontend/`; then run the package command unchanged as confirmation:
   `npm run e2e:room-context-panels`.
6. Teardown only the recorded backend/frontend PIDs after evidence is saved.
   A restart, retry or different process pair cannot convert a failed full run
   into a passing result.

The following shell block is the required literal procedure. It is run from the
repository root; it requires a test-only secret already exported by the
operator, never prints it, and writes logs only to a temporary directory.

```sh
: "${CHAT_RECEIPT_HMAC_SECRET:?Export a test-only 32-byte Base64URL secret first}"
sse_java_home="$(/usr/libexec/java_home -v 17)"
sse_run_dir="$(mktemp -d /tmp/interview-online-sse.XXXXXX)"
if lsof -nP -iTCP:8080 -sTCP:LISTEN; then exit 1; fi
if lsof -nP -iTCP:5173 -sTCP:LISTEN; then exit 1; fi
(
  cd backend
  JAVA_HOME="$sse_java_home" DB_URL=jdbc:postgresql://localhost:5432/interview_online \
  DB_USER=interview DB_PASSWORD=interview FEATURE_TEAM_WORKSPACES=true \
  ROOM_REALTIME_LIFECYCLE_DIAGNOSTICS=true \
  CHAT_RECEIPT_HMAC_SECRET="$CHAT_RECEIPT_HMAC_SECRET" mvn -q spring-boot:run
) >"$sse_run_dir/backend.log" 2>&1 &
sse_backend_pid=$!
(
  cd frontend
  FEATURE_TEAM_WORKSPACES=true npm run dev
) >"$sse_run_dir/frontend.log" 2>&1 &
sse_frontend_pid=$!
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/)" = 200 ]; do sleep 1; done
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/me/workspaces)" = 401 ]; do sleep 1; done
export E2E_REALTIME_LIFECYCLE_LOG="$sse_run_dir/backend.log"
```

Run `node --test --test-concurrency=1 tests/e2e/interview/e2e-room-context-panels.mjs`
and `npm run e2e:room-context-panels` from `frontend/` without restarting or
clearing the pair between them. Save `$sse_run_dir` with the evidence before
teardown, then execute only `kill "$sse_backend_pid" "$sse_frontend_pid"`.

## Risks / Trade-offs

- [Client close races with EventSource reconnect] → bind cleanup to a lease or
  connection identity and test an old close after a replacement opens.
- [Server cleanup removes a newer replacement] → keep removal idempotent and
  scoped to the obsolete connection identity.
- [A transaction remains open across asynchronous emission] → measure the
  failing boundary first and end database work before retaining an emitter.
- [Extra diagnostics leak operational state] → restrict them to test-only
  in-process inspection and keep production routes unchanged.
- [The full suite is slow] → retain isolated named tests for diagnosis, but
  do not permit them to replace the required complete run.

## Migration Plan

1. Add and run RED lifecycle diagnostics against the fresh full suite; record
   the first retained resource category and server evidence.
2. Implement only the diagnosed lifecycle cleanup, adding focused backend and
   browser tests first.
3. Run focused reconnect/authorization regressions, then the full fresh
   `e2e-room-context-panels` suite until all 18 tests pass in one run.
4. Run backend tests, frontend typecheck/build where frontend code changed,
   strict OpenSpec validation, security/reliability review and QA.
5. Roll back only the lifecycle change if needed; there are no data migrations
   or API contracts to unwind.
