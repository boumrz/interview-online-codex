## Why

The user requests a full-project test and evidence-based GO/NO-GO decision before exposing the current HR, activity-history and realtime changes to users. Earlier checks covered a repair subset and left independent review and real visibility lifecycle gaps.

## What Changes

- Inventory every checked-in test entry point and relevant accepted/open OpenSpec requirement; execute a complete runnable matrix, not only the incomplete e2e:all alias.
- Verify frontend unit/contract/browser behavior, backend tests/package, production frontend build and isolated production Compose startup using PostgreSQL.
- Verify fresh migrations plus a pre-HR/activity V8 database upgrade with preserved representative data; assess production configuration and release procedure.
- Record failures with evidence, distinguish application defects from stale test fixtures and environment limitations, and give a conditional or unconditional release verdict.
- Close the previous Yjs repair independent review through delegated audit when available.

## Capabilities

### New Capabilities

- `project-release-verification`: Traceable release-test inventory, execution evidence and explicit readiness decision.

### Modified Capabilities

None. This is verification-only; application bug fixes require a separate validated behavioral change and RED evidence.

## Impact

Test runners/evidence under output and this change's report; test instrumentation may be corrected only when the failure is proven to be in the harness and the behavior assertion remains intact. No production deployment, user database mutation, external messaging, dependency upgrade or application changes are authorized by this audit.
