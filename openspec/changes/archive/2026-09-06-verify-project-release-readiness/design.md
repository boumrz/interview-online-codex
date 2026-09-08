## Scope and approach

Verification-only cross-project audit. Root owns sequential browser workloads and all local runtime mutations. Delegated read-only coverage, production/migration and final Yjs implementation reviewers run independently. Existing working-tree HR/activity/realtime changes are the release candidate and must remain unchanged.

Inventory source is every frontend/tests entry point, scripts/tests, backend/src/test, package scripts and OpenSpec accepted/open requirements. Do not execute e2e:all plus the same entries redundantly; expand it and include omitted files. Unit/contract tests can run while building isolated services; browser workloads are serial to avoid resource/fault interference. Continue after test failures and classify them before the final verdict. Capture logs privately in output/release-audit with no real credentials printed.

Use production Dockerfiles/Compose when the local runtime can start, with unique container/network/volume names and loopback ports. Render configurations using synthetic test credentials, never the user's real env. Fresh PostgreSQL migration and V8-to-current upgrade checks use newly created audit databases only. Never delete or reset existing project databases/containers. External telemetry/integration calls should use existing mocks or be reported as unverified; no user-facing external effects.

This task does not change executable product behavior, so artificial test RED before production implementation is not applicable. Existing tests provide verification; any added harness assertion or correction must preserve the product oracle and be documented with the observed fixture failure. Real product defects become report findings and separately specified follow-up work.

## Readiness criteria

GO requires all relevant executed tests green, no confirmed critical data/security/migration defect, completed independent code/security review for changed sensitive paths and verified release configuration. Environment-sensitive remaining conditions lead to a conditional decision only when their bounded risk can be stated; unresolved critical functional failures yield NO-GO. Missing exhaustive combinatorial/browser/load coverage must not be disguised as a green suite.

## Observed test-harness corrections

- Backend CandidateActivityPoolIntegrationTest: an initial unexpected 400 instead of 403 did not preserve the HTTP body. Add status/body/protocol diagnostics to existing assertions, redact fixture secrets; keep the exact expected statuses, Java HTTP client and behavior checks. Targeted and complete 96-test repeat pass; original failure remains recorded as unexplained/non-reproduced.
- Metrika host E2E: both native-upstream and full-Docker runs failed in asynchronous route.fetch while context.close destroyed the page during a lazy CSS request. Await completion of network loading for each finite mocked analytics page in finally before closing it. A first unrouteAll(behavior=wait) attempt still failed with Route is already handled and is preserved in the audit log; it is not the retained correction. Keep all host gating, analytics configuration and invite-redaction assertions unchanged; do not ignore route errors. This test-only teardown repair is based on two observed harness REDs, not a product behavior change.
