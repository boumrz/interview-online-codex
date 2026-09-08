# Activity history verification

Feature baseline copies are in `output/activity-history-baseline` (including prior uncommitted HR changes).

Strict OpenSpec validation passed before test/source edits; planning-review.yaml records product, architecture and task readiness. Frontend/history and backend production work may proceed independently against the approved API after their matching RED; backend completion remains prerequisite for integrated browser GREEN.

Initial browser RED: `node --test frontend/tests/e2e/interview/e2e-activity-history-recovery.mjs`, exit 1. Five cases fail because the older-history action is absent (50-event tail), delayed-recording recovery is absent for repeated 503/hung POST/429, and a 55-event persisted history is not all displayed. Log: `output/activity-history-baseline/browser-red.log`. Fixtures are unique local accounts/rooms; browser contexts close in finally. Raw fixtures are retained in the isolated acceptance database.

Retry helper unit RED: missing new module at the specified import, followed by two behavioral GREEN cases for 1/2/4/8/16/30-second delays and invalid counters. The browser missing recovery behavior is the executable acceptance predecessor for the transport change. Logs: `retry-unit-red.log`, `retry-unit-green.log` in the baseline folder.

Superseded legacy grouping assertions are updated to retain the 50-event SSE expectation while requiring complete loaded timeline history. Its prior three-error permanent-shutdown regression now invokes the new deadline/recoverable FIFO browser cases; grouping, source identity, raw export and role tests stay in the legacy harness.

Backend RED: eight tests/eight failures, zero errors: missing paged endpoint404, stale JSON bootstrap expected50 got0, deterministic accepted-event/state-replacement race loses source, and real HTTP with pool1 returns500 due to nested connection acquisition. `output/activity-history-baseline/backend-red.log`.

## Additional review regressions

- `unfinished-body-red.log`: an HTTP400 with headers received but an unfinished response body blocked the next source action. The focused browser assertion failed before the activity error-body path changed. `unfinished-body-green.log`: 1/1 passes after body cancellation without awaiting error JSON; raw error text is not rendered.
- `tab-history-red.log`: loading all451 sources worked, but Logs→Chat→Logs lost earlier sources and failed at the post-tab-switch assertion. This exposed component-lifetime cache loss; the room-scoped hook correction is now green in the expanded browser suite.
- Backend explicit-null concern was disproved: actual history JSON already includes both nullable cursor keys. `backend-explicit-null-contract.log` adds a passing regression for empty/latest/older/catch-up; no production annotation was necessary.

## Completed backend and migration verification

- `JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home mvn -q -f backend/pom.xml package`: exit0, **96 tests, 0 failures/errors/skips**, including prior HR work. `backend-full-green.log` and Surefire XML reports.
- Targeted initial backend GREEN:21/21 (history7,pool1,existing durable13); the additional explicit-null test raises the new history class to8. The blank-query regression also failed before correction (`backend-empty-parameter-red.log`), then passed.
- PostgreSQL16.13 actual V10 fixture: null-only source/sequence backfill across two rooms, existing non-null identity/sequence and event content preserved, composite index created, replay idempotent. `migration-postgres.log`. An initial attempt to create this fixture as the application user was denied; the local database owner created and removed only the uniquely named fixture database. The application user's privileges were not changed.
- Real application Flyway upgrade on the isolated acceptance database applied version9→10 successfully; `output/activity-backend-runtime.log`. H2 is not claimed as migration verification.
- Frontend unit suite:16/16 passes (retry2,existing projection7,history7), `frontend-units-green.log`. The history helper has8 killed targeted mutants (`frontend-mutation.log`); this is scoped mutation evidence, not a whole-project score.
- Initial integrated transport/read suite:5/5 passes (`transport-green.log`): repeated503,10-second hung POST,429, read failure+revocation, unfinished400body. A subsequent run adds explicit reconnect-during-backoff and same-room tab preservation assertions.

## Test-level scope

Browser tests own timeout/cancellation, one-in-flight FIFO, recovery/reconnect and stale-permission behavior. Unit tests cover pure backoff values and exhaustive cursor/merge invariants; fake-clock hook scheduling is not claimed. Existing grouping E2E retains response-loss retry, source identity, normal realtime/Yjs independence, role privacy, post-publication durability and JSON/CSV behavior. This mix tests observable behavior through the actual runtime rather than mirroring hook internals.

## Final frontend integration

- `E2E_API_URL=http://localhost:18080/api E2E_BASE_URL=http://localhost:5173 node --test frontend/tests/e2e/interview/e2e-activity-history-recovery.mjs`: **6/6 passed**, `browser-green.log`. Whole-history coverage includes451 seed events, failed older-page retention with new live activity, successful explicit retry, tab round trip, empty/subset state,201 missed events with frozen read and concurrent future live arrival, reload, complete JSON/CSV exports, and direct candidate denial. Other cases verify repeated503 plus forced SSE reconnect during backoff and independent Yjs code delivery, a10-second aborted POST,429, delayed private response after role revocation, and unfinished400error body. Accepted actions have stable UUIDs, ordered sends and one raw row each.
- `npm run e2e:public-step-preservation`, `npm run e2e:sse-reconnect`, and `npm run e2e:realtime-auth-recovery`: all exit0. Individual logs and `realtime-regressions.json` record commands/results with the same isolated API runtime.
- Final `npm run typecheck` and `npm run build`: exit0; `frontend-typecheck.log`, `frontend-build.log`.

The first full grouping run failed only its native paste expectations: no paste event/summary/CSV source appeared after Ctrl+V. `native-paste-diagnostic.log` independently demonstrates the cause on MacIntel: Control+V produces no native paste event or textarea content, whereas Meta+V produces both. The two native paste steps now choose Meta on darwin and Control elsewhere. No paste production code was changed, and paste assertions were retained. A rerun was interrupted when a wrong working-directory edit had not applied; the corrected full rerun is the final gate.

- Clean final `npm run e2e:activity-timeline`: exit0, `grouping-final-green.log` contains `ACTIVITY_TIMELINE_GROUPING_OK`. This preserves physical-key/paste capture, raw idempotency, grouped summary, bounded SSE versus complete loaded timeline, real reconnect and post-publication continuity, normal/Yjs event independence, non-owner and promoted-guest access, revocation, JSON/CSV export, and bounded403 handling. `grouping-green.log` was shared with the interrupted process and is superseded by this clean single-run artifact.

## QA UI acceptance additions

`node --test --test-name-pattern='history UI contract' frontend/tests/e2e/interview/e2e-activity-history-recovery.mjs`: **2/2 passed**, `history-ui-green.log`. These use real room UI with controlled valid history responses to verify pending versus confirmed-empty text; serialized 10-second history GET timeout; retained rows and five-second retry cadence; generic failure and explicit same-cursor retry; and one displayed group across401 sources loaded in200+200+1 pages. They supplement, and are not represented as substitutes for, the six persistence/transport E2E cases. No production changes were required by these additional assertions.

The role-revocation browser test now waits for source nodes to be removed from the DOM (the source spans are intentionally display:none), then explicitly awaits settlement of the released late response before its final negative assertion. This strengthens the privacy regression without changing the implementation.

The strengthened role-revocation case passes (`revocation-final-green.log`,1/1). Final browser acceptance consists of six real persistence/transport scenarios plus two controlled UI-contract scenarios; the modified revocation scenario was rerun after its synchronization improvement.

## Final acceptance

Planning/product/architecture/task audit: READY. Solution/security/reliability: APPROVE. QA: READY. Independent test review and UX review: APPROVE. Final product acceptance: ACCEPTED. Reports are stored alongside this document as `planning-review.yaml`, `solution-security-review.yaml`, `qa-review.yaml`, and `acceptance-review.yaml`. All12 task checkboxes are complete. No production deployment or commit is claimed; prior HR work is preserved.
