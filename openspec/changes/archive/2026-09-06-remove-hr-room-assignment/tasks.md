## 1. Clarification and acceptance before implementation

- [x] 1.1 Product Owner, Architect, Team Lead, and Prompt/Task Auditor confirm scope, supplied API/permission constraints, task ownership, and readiness; verify `npx --yes @fission-ai/openspec@latest validate remove-hr-room-assignment --strict` succeeds and record any gate findings before production work.
- [x] 1.2 Author E2E acceptance for participant-menu and offline manager-list removal by current managers, self-removal, candidate controls, reconnect/cabinet consequences, pending/error state, and ordinary non-HR control preservation; run the new acceptance before production edits and record failure caused by the missing removal behavior.
- [x] 1.3 Author backend integration tests for current manager/promoted-guest authority, self-removal then denial, owner/non-HR/unknown/unrelated/archive errors, malformed target UUID 404 after authorization with unauthorized callers still receiving 403, 204 idempotency, retained-association candidate overrides, unchanged global HR/history, cabinet/private/export denial, and concurrent permission ordering; run red before production edits and record missing endpoint/behavior failures. Integration is proportionate for server-only security, persistence, and transaction boundaries.

## 2. Implementation after the acceptance gate

- [x] 2.1 Implement the authorized 204 DELETE operation through the existing locked permission mutation and synchronization path, with durable candidate precedence and retained tracking; verify all task 1.3 tests pass without expanding ordinary non-HR permissions or changing schema/dependencies.
- [x] 2.2 Connect the RTK Query mutation and explicit participant action, using server identity/assigned state and pending/error/context guards; verify joined-HR and self-removal E2E cases pass and the target applies confirmed candidate permissions.
- [x] 2.3 Add removal to the existing “Кандидат и HR” assignment list for online/offline non-owner HR targets, with an accessible target-specific action such as “Снять роль HR у {displayName}”; verify offline removal, refresh/reconnect, retry feedback, and owner protection E2E cases pass.

## 3. Verification and completion

- [x] 3.1 Obtain Solution Reviewer and Security/Reliability review, then QA/Test Reviewer/UX and Product Owner acceptance; run targeted E2E/backend regression, frontend typecheck/build, and strict OpenSpec validation, recording results and fixing blocking findings.
- [x] 3.2 Update task status and red/green evidence to match delivered behavior; verify no unrelated changes were reverted and archive this completed change into the accepted baseline only after all required gates pass.
