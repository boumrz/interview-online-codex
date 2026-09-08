# Backend verification

Verified on 2026-09-05 with Java 17 (`temurin-17`) against the backend implementation for `add-hr-interview-cabinet`.

## Test-first evidence

The five focused HTTP integration suites were written and executed before backend production implementation. Their initial failures were caused by the absent HR contract, rather than test infrastructure:

- `HrAccountProfileIntegrationTest`: 2/2 failed because registration and profile responses had no `isHr` field.
- `HrRoomTrackingIntegrationTest`: 3/3 failed with the missing tracking/invitation routes (404).
- `HrInterviewProjectionIntegrationTest`: the first manager invitation failed with 404, preventing metadata/list/detail behavior.
- `HrRoomArchiveIntegrationTest`: the tracked-room branch failed with 404; the existing untracked destructive-deletion compatibility scenario passed.
- `HrWorkbookIntegrationTest`: setup failed at the missing HR invitation route (404), so no workbook could be produced.

After implementation and coverage expansion, the focused command passed 24 tests:

```text
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  mvn -f backend/pom.xml \
  -Dtest=HrAccountProfileIntegrationTest,HrRoomTrackingIntegrationTest,HrInterviewProjectionIntegrationTest,HrRoomArchiveIntegrationTest,HrWorkbookIntegrationTest \
  test -q

Result: 24 tests, 0 failures, 0 errors, 0 skipped.
```

The final export transaction bound was also introduced test-first. The new test initially observed the Spring transaction timeout as `-1` and failed; after production configuration it observes `30` seconds and passes.

The focused suites cover account opt-in and UUID stability; forged identity fields; assignment FK cleanup; current manager authority; guest event-token invitation; concurrent invite deduplication; REST and realtime demotion tombstones; reinvitation; metadata validation and optimistic revision conflicts; HR scope isolation; paging and Moscow date boundaries/fallback; stable first completion time; tracked archive terminal behavior; delayed-save cancellation; untracked deletion compatibility; workbook structure, literal text cells, task linkage, secret absence, download/CORS headers, empty exports, per-account concurrency, and the snapshot transaction timeout.

## Backend regression and build

```text
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  mvn -f backend/pom.xml test

Result: BUILD SUCCESS; 53 tests, 0 failures, 0 errors, 0 skipped (14 suites).
```

```text
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  gradle -p backend test --no-daemon

Result: BUILD SUCCESSFUL; 53 tests, 0 failures, 0 errors, 0 skipped (14 suites).
```

Gradle 9 requires an explicit `junit-platform-launcher` runtime dependency. Before that dependency was added, compilation succeeded but the test executor failed to load JUnit Platform; the final command above verifies both build definitions can execute the same suite.

```text
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  mvn -f backend/pom.xml package -DskipTests -q

Result: success.
```

```text
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
  mvn -f backend/pom.xml dependency:tree '-Dincludes=org.apache.poi:*'

Result: poi-ooxml 5.5.1, poi 5.5.1, and poi-ooxml-lite 5.5.1; BUILD SUCCESS.
```

`git diff --check -- backend` passed. Strict OpenSpec validation also passed:

```text
npx --yes @fission-ai/openspec@latest validate add-hr-interview-cabinet --strict
Change 'add-hr-interview-cabinet' is valid
```

## PostgreSQL runtime evidence

The root orchestrator ran the production runtime checks on isolated PostgreSQL databases after V9 was implemented:

- A clean V9 migration and a V8-to-V9 upgrade both succeeded. Existing users received `is_hr=false`, new room metadata remained nullable, and the earliest known `finished_at` was restored from `room_product_metrics.first_verdict_saved_at`. A later verdict correction did not change that first completion time.
- A scoped workload of 1,000 rooms and 5,000 tasks returned the cabinet list in 24 ms and generated/parsed all three XLSX sheets in 511 ms. The workbook checks covered row scope, archive state, date selection, task linkage, literal formula-looking strings, and absence of room credentials/private data.
- A 10,001-room export was rejected with 413 before bulk task/workbook materialization (observed in 120 ms); the corresponding list page completed in 55 ms.
- Eight concurrent invitations all returned 200 while producing one durable assignment. Four same-revision metadata writes produced one 200 and three 409 responses.
- A deterministic archive/write race held the room row lock in an external transaction, committed `archived_at`, and then released a waiting verdict request. The request re-read the locked current state and returned 410, proving the stale managed entity cannot write after archive.
- The upgraded runtime retained archived historical detail and export visibility after restart.

The H2 archive integration test proves pending debounced Yjs persistence is cancelled and subsequently guarded. It is not used as evidence for database row-lock serialization; that proof comes from the PostgreSQL race probe described above.

The export has two bounded phases: its repeatable-read snapshot transaction declares a 30-second Spring transaction timeout, and the streaming renderer checks one shared 30-second monotonic deadline between rows and before returning bytes. The test verifies the transaction metadata is wired to 30 seconds. The runtime workload verifies normal completion and early row-cap rejection; these checks establish configured/cooperative bounds, not a hard end-to-end HTTP latency guarantee under an unresponsive database or transport.

The backend worker did not stop or restart the shared runtime. The only production change after the orchestrator's 22:08 runtime load is the export snapshot transaction timeout; the final runtime should reload the backend artifact before acceptance evidence is finalized.


## Final review gate rerun

After the review corrections documented in `verification.md`, Maven and Gradle both pass **60 tests across 15 suites**, with 0 failures/errors/skips. Maven `package -DskipTests` also exits 0. The seven additional cases cover REST/realtime commit ordering and rollback, current authority during stale-session reconnect/token/event interleavings, an older invitation callback following a newer demotion commit, and workbook cleanup when both render and close fail. Final production jar was loaded on PostgreSQL port 18080 at 22:44:56 Moscow on 2026-09-05, including every review correction. This supersedes the worker's earlier 53-test and runtime-reload note above.


## Pool correction — final packaged GREEN

BUG-HR-QA-001 is fixed. The same PostgreSQL probe queued all 10 connections before releasing 12 invitations: **12/12 HTTP 200 in 0.183 seconds**, followed by all 10 connections idle (`output/hr-post-pool-probe.log`). The new four-case small-pool integration suite previously failed for invitation, REST role change, and realtime role change on a second connection checkout; after the transaction facade correction all four cases pass. Existing tracking, nested rollback/callback ordering, and synchronous normal-HTTP role publication also pass.

Final results after the correction, with no later production edits:

- Maven and Gradle: **64 tests, 16 suites, zero failures/errors/skips**, both exit 0. Maven package exits 0. See `output/hr-post-pool-backend-{maven,gradle}.log` and `output/hr-post-pool-package.log`.
- Packaged backend restarted on PostgreSQL at 23:05:04 Moscow. HR browser suite: **9/9 passed**, zero failed/cancelled/skipped/todo, 22.829 seconds.
- Seven existing browser regression commands all exit 0: account-binding, account-switch, roles, realtime-auth-recovery (exactly two rejected requests), sse-reconnect, auth-negative, and five-participants. The last covers simultaneous interviewer/candidate writes, publication and private workspace isolation in two five-person topologies; its 48 public samples had p95 17.1 ms/max 17.2 ms. Logs are `output/hr-post-pool-<script>.log`.
- PostgreSQL CAS/archive probe exits 0 again: eight invitations return 200, four same-revision metadata edits return one 200 and three 409, and the waiting verdict after archive returns 410.
- XLSX workload repeated against the final jar: 1,000 interviews/5,000 tasks, all three sheets parsed; scoped list 16 ms, export 590 ms, 310,579 bytes. Single Moscow day matched 501 records, archived detail remained readable, and the second HR stayed isolated (`output/hr-post-pool-workload.log`). Export isolation/timeout configuration is unchanged and its backend tests pass.
- Frontend sources have not changed since their successful typecheck/build and responsive visual inspection. Strict OpenSpec validation and whitespace checks pass.

Final restored-source full backend results: **65/65 Maven and 65/65 Gradle, 16 suites, zero failures/errors/skips**, both exit 0. The only addition since the 64-case packaged-runtime verification is the queue-rejection coverage test; production source is byte-identical. Logs: `output/hr-accepted-backend-maven.log`, `output/hr-accepted-backend-gradle.log`.
