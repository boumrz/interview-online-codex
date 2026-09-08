## 1. Scope and inventory

- [x] 1.1 Create verification-only scope/spec/design/tasks, read project contracts, and document why no artificial behavior RED is required.
- [x] 1.2 Validate strictly and record complete runnable test inventory, coverage groups and isolated runtime plan.

## 2. Execution

- [x] 2.1 Run all frontend unit/contract and script tests, typecheck/build, and all backend tests/package; record failures and warnings.
- [x] 2.2 Run every inventoried browser/API test entry point serially, including HR, activity, chaos, visibility and authoring; preserve original failures and justified fixture corrections.
- [x] 2.3 Build/start isolated production artifacts and verify health, deep links, static assets, API/SSE and fresh PostgreSQL migrations; verify V8 upgrade preserves seeded data.
- [x] 2.4 Diagnose failures sufficiently to distinguish application defect, obsolete assertion and environment limitation; do not modify production behavior in this audit.

## 3. Review and decision

- [x] 3.1 Reconcile independent requirements/coverage, deployment/migration/security and final Yjs repair reviews with fresh test results.
- [x] 3.2 Write reproducible release report with source fingerprint, pass/fail matrix, blocking findings, explicit unverified conditions and GO/conditional GO/NO-GO verdict.
- [x] 3.3 Validate final artifacts, preserve unrelated changes, and archive this verification only when the requested audit and report are complete; audit completion does not imply application readiness.

Final audit: all inventoried scope executed (47 entrypoints after full recovery supplement), report independently accepted in qa-review.yaml. Application verdict NO-GO. Archive this verification with --skip-specs: these are audit-process requirements, not a new product capability; existing product specs remain unchanged.
