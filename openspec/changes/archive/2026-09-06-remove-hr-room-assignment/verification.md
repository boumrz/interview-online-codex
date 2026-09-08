# HR removal verification

Scope: explicit HR removal from the participant menu and the online/offline manager list. The account HR flag and interview history remain intact; room access becomes candidate until explicit reassignment.

## Test-first evidence

Planning: `planning-review.yaml` approves scope, API/permission architecture and ownership; strict OpenSpec validation passed before tests and production changes.

Browser acceptance was authored before production changes in `frontend/tests/e2e/hr/e2e-hr-cabinet.mjs`:

- `node --test --test-name-pattern='HR removal' frontend/tests/e2e/hr/e2e-hr-cabinet.mjs`: first five new cases failed because the explicit menu/panel removal controls did not exist. Exit 1; `output/hr-revoke-baseline/browser-red.log`.
- Two subsequently authored delayed-response cases also failed at the missing removal controls before production changes. Exit 1; `output/hr-revoke-baseline/browser-stale-red.log`.
- The participant pending/error/retry case likewise failed at the missing removal action before production changes. Exit 1; `output/hr-revoke-baseline/browser-pending-red.log`.

The existing registered and promoted-guest interviewer cases now require explicit HR removal while retaining the owner-only restriction for ordinary interviewer controls.

Backend integration supplements E2E for server-only authorization, persistence, private payloads and transaction ordering, as specified in task 1.3. Final results and independent reviews will be recorded after implementation.

Backend RED: `JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home mvn -q -f backend/pom.xml -Dtest=HrRoleRemovalIntegrationTest test` exited 1: 20 tests, 20 failures, 0 errors/skips. Missing DELETE returned 405; race cases observed immediate failure instead of waiting for the room transaction. Stream, private-note and promoted-guest setup succeeded. Evidence: `output/hr-revoke-baseline/backend-red.log`. Both RED gates passed before production edits.

Backend targeted GREEN: same Maven command, production-matching `spring.jpa.open-in-view=false` explicitly set on the new MockMvc test class. 20 passed, 0 failures/errors/skips. The first green attempt exhausted the test-only OSIV/SSE connection pool; production already disables OSIV. Final log: `output/hr-revoke-baseline/backend-green-parity.log`.

## Final verification

- Maven `package`: PASS; 87 tests in 18 suites, no failures, errors or skips. `output/hr-revoke-baseline/backend-full.log` and Surefire XML.
- Full HR browser suite: PASS, 23/23 including eight new removal cases. `output/hr-revoke-baseline/browser-green.log`.
- Existing role/notes and account-switch browser regression: PASS. Explicit `E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api` selects this task's local runtime. Logs `roles-green.log` and `account-switch-green.log` in the same folder.
- Frontend typecheck and build: PASS, `frontend-typecheck.log` and `frontend-build.log` in the same folder.
- Desktop and 390px mobile manager-list preview: PASS; removal button remains within viewport and at least 44px tall, owner has no removal control. `output/hr-revoke-panel-desktop.png`, `output/hr-revoke-panel-mobile.png`, `output/hr-revoke-baseline/preview.log`.
- Runtime rebuilt and restarted against the existing isolated PostgreSQL acceptance database, backend18080/frontend5173. No production deployment performed.

## Test sensitivity and independent review

A focused manual mutation replaced the new DELETE verb with PUT, causing the real two-tab removal test to fail because manager controls remained visible. The original API file was restored byte-for-byte in `finally`; the same focused test then passed. Logs: `output/hr-revoke-baseline/mutation-verb.log` and `mutation-restored-green.log`. One selected mutation killed, none survived; this is a focused fallback for the existing browser/Node harness, not a claim of full mutation or coverage measurement. No new Stryker dependency/setup was added to this permission change.

Independent engineering, security and reliability review approved with no blocking findings: `implementation-review.yaml`.

QA, Test Reviewer, UX and Product Owner acceptance all approved with no blocking findings: `acceptance-review.yaml`. Limits: browser evidence is Chromium; focused server transaction tests use H2 while browser integration uses PostgreSQL. Removal-specific room/account switches were not separately injected; the shared guard was reviewed and existing account-switch regressions passed. No 100% coverage claim is made.

Strict validation and diff whitespace checks passed. Final source hashes are recorded in `output/hr-revoke-baseline/final-source-sha256.txt`. Prior unrelated uncommitted changes were preserved; this change modifies six production files and two test files, with no schema/dependency changes.
