## Specification Evidence

## Current implementation evidence

Final production source matches the packaged PostgreSQL runtime verified at 23:05 on 2026-09-05. Maven and Gradle each pass **65 tests across 16 suites**; the browser passes **10 HR acceptance cases and 7 existing regression scripts**. Typecheck, production frontend build, backend packaging, strict OpenSpec validation and whitespace checks pass. The original saturated-pool failure is resolved: **12/12 successful invitations**, with all database connections returned idle. The scoped XLSX workload parses **1,000 interviews and 5,000 task scores**. The queue-rejection mutation was reverted byte-for-byte; only the additional coverage test followed the final runtime verification.

Detailed RED/GREEN history and independent review/QA evidence follow below or in adjacent review artifacts.

Final product acceptance is **accepted**: all 11 agreed product criteria groups pass. Solution review approves, security/reliability have no feature-specific blockers, QA confirms 33/33 groups, and test review reports sufficient coverage with no missing scenarios. See `product-acceptance.yaml`, `solution-review.yaml`, `security-review.yaml`, `qa-verification.yaml` and `test-review.yaml`. Implementation and review are complete; the chronological entries below preserve the original baseline and intermediate evidence.

- Created `add-hr-interview-cabinet` with `npx --yes @fission-ai/openspec@latest new change add-hr-interview-cabinet`.
- Read CLI artifact instructions and authored proposal, three capability specs, design handoff, tasks, and structured handoff.
- Initial strict validation: `npx --yes @fission-ai/openspec@latest validate add-hr-interview-cabinet --strict` -> exit 0, `Change 'add-hr-interview-cabinet' is valid`.
- Product review requested an explicit exclusion of archived future rooms from upcoming interviews; the cabinet requirement and scenario now include that distinction.
- No production code or tests were changed during specification. Behavioral red-to-green, migration, workbook, runtime, and regression evidence must be recorded by the executing owners before delivery is marked complete.

## Implementation Gate

Specification validity is not implementation approval. Product acceptance, Architect contracts, Team Lead ownership, task-quality audit, and the relevant pre-implementation failing test remain required as recorded in `tasks.md`.

## Baseline (before production changes)

- Isolated PostgreSQL database `interview_hr_1788631751397`, backend on port 18080, frontend on port 5173. Existing application migrated a fresh schema through V8 successfully; user databases were not changed.
- `cd frontend && npm run typecheck` -> exit 0.
- `cd frontend && E2E_API_URL=http://localhost:18080/api npm run e2e:account-binding` -> exit 0, `ACCOUNT_ROOM_BINDING_OK`.
- Real browser inspection of current login/registration/dashboard confirmed no HR controls. Baseline screenshots are in ignored `output/playwright/hr-baseline-*.png`.
- Product scope accepted in `product-scope.yaml`; the requested archive/upcoming clarification is present in the specification.

## Browser acceptance RED (before any production code)

- Command: `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api npm --prefix frontend run e2e:hr-cabinet`.
- Exit 1, 3 tests executed, 3 failed, 0 skipped, 14.7 seconds.
- Registration: explicit assertion `Registration must offer the optional HR checkbox`, expected 1 checkbox, actual 0.
- Full interview journey: existing dashboard routing lacks the HR cabinet heading.
- Candidate exclusion/manager tracking: current candidate room successfully loads, then `GET /api/me/hr/rooms` returns 404 because the endpoint is absent.
- These are actual missing feature behaviors on the working baseline, not fixture/service/compile failures. Backend developer received this evidence before production permission; focused backend RED still precedes its slices.
- Baseline full backend: `JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home mvn -q -f backend/pom.xml test` passed 29 tests, 0 failures/errors/skips.
- Planning/task audit is ready in `task-audit.yaml`; root checked final task ownership and test-first dependencies against the Prompt/Task Auditor role. Backend and frontend can execute independently against the frozen API; integrated GREEN waits for both and PostgreSQL proof.

## Additional acceptance and UX evidence

- UX package completed; root acted as the permitted UX Critic fallback and approved `ux-review.yaml` after designer corrected exact badges and removed an obsolete control reference. Rendered cabinet inspected at desktop width; production browser verification remains pending.
- Browser acceptance now also covers real manager metadata 409, retained draft/explicit reload, export failure without a false XLSX, manual retry, archived terminal requests after focus recovery, and same-browser HR account switching.
- Separate owner/promoted-guest scenario executed against baseline: existing anonymous guest admission and owner promotion succeeded; test then failed on absent `Кандидат и HR` control (exit 1). No fixture/role harness failure.
- All five initial backend integration classes executed RED; requested new routes returned 404, HR flag was absent, while untracked hard deletion compatibility already passed. Backend worker owns expanded contract coverage and GREEN evidence.
- Preserved a V8 migration fixture with two verdict writes: first completion `2026-09-05T18:45:36.027708Z`, overwritten baseline completion `2026-09-05T18:45:36.035500Z`. V9 must restore the authoritative first timestamp from existing product metrics.
- Isolated workload harness prepared at ignored `output/hr-workload-verify.py`: 1,000 rooms / 5,000 scores, parsed OOXML, personal scope, archived history, inclusive Moscow filtering, 10,001-room rejection. Initial seed stopped as expected because baseline registration does not persist `isHr`; no workload rows were inserted before V9.

## PostgreSQL migration, concurrency, workload and restart

- Clean database `interview_hr_clean_1788634575467` started successfully through all nine Flyway migrations on port 18082.
- Populated V8 database `interview_hr_1788631751397` upgraded successfully from V8 to V9 on port 18080. Existing HR flag defaults to false, metadata values are null with revision 0, first completion was restored from the existing metrics projection. A subsequent verdict correction retained that first completion.
- Root reproduced a real PostgreSQL concurrency defect before the fix: four concurrent metadata writes all returned revision 1; a verdict blocked behind a row archive lock then returned 200. Backend changed locking to acquire a scalar row-ID lock before entity materialization.
- Repeated PostgreSQL probe passed: eight concurrent invitations returned 200; concurrent metadata statuses were `[200,409,409,409]`; a verdict genuinely blocked behind an archive transaction returned 410. Probe waits for `pg_stat_activity` lock evidence instead of assuming scheduling order.
- Workload: 1,000 authorized interviews / 5,000 task rows. Warm list page: 0.024 seconds; complete XLSX generation/download: 0.511 seconds, 310,580 bytes. All three sheets were parsed; all unique room/task links and 3,000 absent scores were retained. Formula-like text remained literal; private/code/credential sentinels and external links were absent. A single Moscow calendar date selected exactly 501 interviews in both list and workbook. Other HR detail/list/export isolation passed.
- Workload cap: 10,001 interviews returned JSON 413 in 0.120 seconds; ordinary first-page listing still returned 20 rows in 0.055 seconds. Extra cap fixtures were removed from the isolated database.
- Archived the migrated room through the real owner DELETE API, restarted the backend process, then verified historical detail, first completion/current verdict, authorized XLSX and live-room 410: `ARCHIVE_RESTART_DETAIL_EXPORT_OK`.

## Integrated browser GREEN and existing regressions

- Final runtime for these checks: frontend 5173, PostgreSQL-backed backend 18080 after V9 and restart.
- `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api npm --prefix frontend run e2e:hr-cabinet` -> exit 0, **5 passed, 0 failed, 0 skipped**, 28.4 seconds.
- Corrected harness assumptions discovered at first integration: existing required-label asterisks, existing login button wording, CSS-uppercase badges, displayed task number prefix, and existing privacy-preserving 404 for non-owner DELETE. No production behavior was changed to satisfy those selector assumptions.
- `e2e:account-binding` -> `ACCOUNT_ROOM_BINDING_OK`.
- `e2e:account-switch` -> `ACCOUNT_SWITCH_FRESH_DATA_OK`.
- `e2e:roles` -> `INTERVIEWER_ROLE_NOTES_CHAT_OK`.
- `e2e:realtime-auth-recovery` -> `REALTIME_AUTHORIZATION_RECOVERY_OK`, exactly 2 rejected requests, no retry storm.
- Frontend developer's current `typecheck` and production `build` both pass; build emits the existing bundle-size warnings. See `frontend-verification.md`.

## Frontend independent review and regression RED

- `frontend-solution-review.yaml` returned REVISE with concrete pending-request, terminal 410 and mobile-target gaps. Normal five-flow GREEN was insufficient for those latency edges.
- Root authored four additional browser cases before fixes. Delayed export after logout reproduced a former-account download. A direct relay 410 and fresh anonymous archived-room GET both failed to enter terminal UI. Delayed metadata, followed by demotion, owner correction and re-grant, restored the old candidate name instead of fetching current metadata. All four cases executed RED for the reported behavior, without service/fixture failures.
- Frontend developer received RED evidence before the corresponding production fixes. Final HR browser GREEN now requires all nine cases.
- Production screenshot also showed generic profile/statistics pushing HR content below the first viewport; the HR section will place navigation and interview content first, consistent with the approved mock. Existing non-HR sections keep their profile entry point. This reversible layout correction uses visual verification rather than a redundant unit test.


## Final review corrections — 2026-09-05

The browser acceptance suite was expanded from five to nine cases. All four added cases reproduced real missing behavior before production fixes: a delayed workbook after logout, a relay 410 while SSE stayed alive, a fresh anonymous archived link, and delayed private metadata across demotion/regrant. The final pre-review run passed all nine cases in 30.4 seconds, with none skipped; the final packaged-runtime rerun is recorded below.

Backend review corrections were also test first:

- Untracked DELETE initially failed the frozen `archived: false` assertion because the key was absent. The controller now always returns the boolean and the frontend type requires it. Archive suite: 4/4 green.
- Two REST/realtime rollback cases observed candidate authority in an active session before commit. Three controlled commit/callback interleavings reproduced stale reconnect elevation, token-only metadata returning 200, and realtime manager writes returning 204 after durable demotion. All five cases pass after shared after-commit synchronization and current durable role checks.
- A deterministic competing-commit test reproduced an older invitation callback restoring INTERVIEWER after a newer committed demotion. Permission publication now reads through a fresh REQUIRES_NEW transaction under the scalar room lock; the test passes.
- A focused workbook failure test injects actual write and close failures through Mockito construction interception. Initially the close error replaced the write error, dispose was skipped, and a temporary candidate workbook remained. Cleanup now always attempts all three actions and preserves the original failure with suppressed cleanup errors; the test passes. This focused unit level is proportionate to a filesystem failure path that cannot be meaningfully triggered through browser UI.

Final Maven backend run after these corrections: **60 tests, 0 failures, 0 errors, 0 skipped, 15 suites**. Logs: `output/hr-final-backend-maven.log`, `output/hr-final-archive-red.log`, `output/hr-final-permissions-red.log`, `output/hr-final-callback-red.log`, and `output/hr-final-review-fixes.log` (cleanup RED plus permission GREEN). Frontend typecheck/build and `git diff --check` pass after the final API type and date display correction.

Desktop and 320px mobile previews were visually inspected. An unscheduled interview explicitly shows “Не указано” for its appointment and the creation/completion fallback with its source; the date-filter help explains inclusive Moscow boundaries and precedence. Mobile cabinet actions are at least 44px and the page has no horizontal overflow. The final desktop screenshot is `output/playwright/hr-cabinet-desktop-final.png`.


## Final packaged runtime — GREEN

The final jar on PostgreSQL port 18080 passed `e2e:hr-cabinet`: **9 passed, 0 failed/cancelled/skipped/todo**, 25.732 seconds. All four existing regression commands exited 0: `ACCOUNT_ROOM_BINDING_OK`, `ACCOUNT_SWITCH_FRESH_DATA_OK`, `INTERVIEWER_ROLE_NOTES_CHAT_OK`, and `REALTIME_AUTHORIZATION_RECOVERY_OK` with exactly two rejected event requests. These runs use `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api`; each has a matching `output/hr-final-*.log`.

The final PostgreSQL race probe also exited 0: eight concurrent invitations returned 200, same-revision metadata updates yielded one 200 and three 409, and the blocked stale verdict writer returned 410 after archive commit (`PG_SERIALIZATION_RACES_OK`). No production changes followed these verification runs.


## Pool saturation finding — acceptance reopened

A final deterministic PostgreSQL probe queued 12 authorized invitations while an external room row lock occupied all 10 pooled request connections. Once released, four requests returned 500 after 30.028 seconds (`active=10, idle=0, waiting=8`). The fresh REQUIRES_NEW permission read was waiting for a second connection while its completed write transaction still retained the original connection through Spring afterCommit. This is a feature regression, not an infrastructure exception. `output/hr-final-pool-probe.log` is the actual RED evidence; QA tracks it as BUG-HR-QA-001 and readiness is reopened.

The correction keeps Hibernate/Spring connection configuration unchanged: a global release-mode change would conflict with the export's required REPEATABLE_READ isolation. Permission-changing entrypoints instead complete and clean up their TransactionTemplate write scope before synchronous publication. Nested transaction use defers publication off-thread after successful outer commit to avoid holding one connection while synchronously waiting for another. Current durable authority remains mandatory for requests and reconnects.


## Pool correction — final packaged GREEN

BUG-HR-QA-001 is fixed. The same PostgreSQL probe queued all 10 connections before releasing 12 invitations: **12/12 HTTP 200 in 0.183 seconds**, followed by all 10 connections idle (`output/hr-post-pool-probe.log`). The new four-case small-pool integration suite previously failed for invitation, REST role change, and realtime role change on a second connection checkout; after the transaction facade correction all four cases pass. Existing tracking, nested rollback/callback ordering, and synchronous normal-HTTP role publication also pass.

Final results after the correction, with no later production edits:

- Maven and Gradle: **64 tests, 16 suites, zero failures/errors/skips**, both exit 0. Maven package exits 0. See `output/hr-post-pool-backend-{maven,gradle}.log` and `output/hr-post-pool-package.log`.
- Packaged backend restarted on PostgreSQL at 23:05:04 Moscow. HR browser suite: **9/9 passed**, zero failed/cancelled/skipped/todo, 22.829 seconds.
- Seven existing browser regression commands all exit 0: account-binding, account-switch, roles, realtime-auth-recovery (exactly two rejected requests), sse-reconnect, auth-negative, and five-participants. The last covers simultaneous interviewer/candidate writes, publication and private workspace isolation in two five-person topologies; its 48 public samples had p95 17.1 ms/max 17.2 ms. Logs are `output/hr-post-pool-<script>.log`.
- PostgreSQL CAS/archive probe exits 0 again: eight invitations return 200, four same-revision metadata edits return one 200 and three 409, and the waiting verdict after archive returns 410.
- XLSX workload repeated against the final jar: 1,000 interviews/5,000 tasks, all three sheets parsed; scoped list 16 ms, export 590 ms, 310,579 bytes. Single Moscow day matched 501 records, archived detail remained readable, and the second HR stayed isolated (`output/hr-post-pool-workload.log`). Export isolation/timeout configuration is unchanged and its backend tests pass.
- Frontend sources have not changed since their successful typecheck/build and responsive visual inspection. Strict OpenSpec validation and whitespace checks pass.


## Post-review failure-branch coverage

A focused integration test now forces rejection from the nested permission-publication executor. It verifies that the affected HR connection loses its event token and cannot request state, while the unrelated owner connection remains valid and receives state normally. For a controlled mutation check, only the rejection branch's disconnection call was temporarily omitted; the test failed exactly because the old HR token still resolved to CANDIDATE rather than being invalidated. The original production file was restored byte-for-byte (SHA-256 checked), matching the already verified packaged runtime. This is post-review test-strength evidence, not a claim that the extra test preceded the original implementation. The red log is `output/hr-queue-mutation-red.log`; final restored-source backend results are recorded next.

Final restored-source full backend results: **65/65 Maven and 65/65 Gradle, 16 suites, zero failures/errors/skips**, both exit 0. The only addition since the 64-case packaged-runtime verification is the queue-rejection coverage test; production source is byte-identical. Logs: `output/hr-accepted-backend-maven.log`, `output/hr-accepted-backend-gradle.log`.


## Final browser state coverage

The test-quality review requested one explicit loading/pending UI evidence case. It was added without production changes and the full HR suite passed **10/10, 0 failures/cancelled/skips/todo**, 20.599 seconds (`output/hr-accepted-e2e.log`). Controlled delays preserve real API authority and prove initial aria-busy loading without a false empty state, disabled “Обновляем…” while retaining previous records, and disabled “Готовим Excel…” before successful real workbook download. QA-HR-14 is updated and QA remains READY (33/33 groups). This is supplemental coverage of the existing implementation; the original feature's pre-implementation RED evidence remains recorded above.


## Final reconciliation and archive — 2026-09-05

- HR-056 accepted all 11 product criterion groups; all delivery tasks are complete.
- Final active-change strict validation passed before archival.
- `npx --yes @fission-ai/openspec@latest archive add-hr-interview-cabinet --yes` exited 0, synchronized all 14 added requirements and archived this change under `openspec/changes/archive/2026-09-05-add-hr-interview-cabinet/`.
- Accepted main specifications `hr-account-profile`, `hr-room-tracking` and `hr-room-export` each passed `validate <name> --type spec --strict` after synchronization.
- Final handoff reflects accepted implementation and completed archive; zero unchecked tasks remain. `git diff --check` passed.
- Informational CLI suggestions about delta count and requirement length do not block validation. No production deployment, commit, PR or external task update was performed.
