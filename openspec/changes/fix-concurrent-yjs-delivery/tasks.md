## 1. Specification and readiness

- [x] 1.1 Specification agent: capture the confirmed RED, lossless delivery requirements, scope fences and pre-implementation E2E levels; verify complete proposal/spec/design/task artifacts and strict validation of `fix-concurrent-yjs-delivery`.
- [x] 1.2 Coordinating owner: confirm the supplied technical constraints and consolidated planning review before production work; verify `planning-review.yaml` records the confirmation, owners and remaining release review gates. No user approval is required for this authorized fix.

## 2. Acceptance tests before production

- [x] 2.1 Developer/test owner: author `frontend/tests/e2e/realtime/e2e-yjs-delivery-reliability.mjs` or extend a documented existing harness with a real delayed nonempty POST, heartbeat overlap, more than 300 actual queued deltas, uncertain-response retry and same-workspace SSE recovery; compare independent editor models and preserved identities. Add delayed old-task update and bounded 403 checks if existing harnesses do not cover them. Run against unchanged production code and record concrete behavior RED, commands and evidence in `verification.md`; a setup failure does not satisfy RED.
- [x] 2.2 Developer/test owner: preserve the existing ten-context convergence assertion and its RED evidence from `output/playwright/multi-activity/1788690452995/report.json`; verify seven concurrent writers produce 300 characters each and record the unchanged test command in `verification.md`. Tests in 2.1 and evidence in 2.2 precede all production edits.

## 3. Minimal repair

- [x] 3.1 Developer owner, after 1.2 and 2.1–2.2: repair queue handling in `frontend/src/features/room/useRoomSocket.ts` so heartbeats and capacity handling cannot discard or abort nonempty applicable Yjs deltas, retry identity/order are preserved, and acknowledgments remove only the acknowledged queue object; verify the deterministic backlog/heartbeat RED becomes GREEN.
- [x] 3.2 Developer owner, after 3.1: preserve valid pending public deltas during recovery while maintaining invite/step/language sync-key and terminal-access fences; verify pending-edit SSE recovery, delayed old-task delivery and bounded authorization cases. If an independent inbound gap is reproduced, amend design/tasks and validate before the additional implementation; verify that specific prewritten RED becomes GREEN without weakening snapshot guards.

- [x] 3.3 Regression amendment: preserve existing slow-network RED; validate lossless never-attempted batch design, author merged-envelope retry acceptance before production, then implement bounded adjacent Yjs merging with frozen attempted payloads. Verify unchanged slow-network deadlines plus focused, boundary and ten-context checks; submit the final delta for independent review under task 4.3.

## 4. Regression and independent review

- [x] 4.1 QA owner: rerun the full ten-participant activity harness and obtain identical complete editor models in all ten contexts plus existing activity/export/privacy checks; record PASS/FAIL, per-editor counts, runtime classification and report path. Run five-participant, Yjs multi, slow-network, refresh, stale-snapshot and refresh/join commands listed in design; verify no regressions and preserve any failures.
- [x] 4.2 Developer/QA owner: run frontend typecheck/build and targeted backend realtime/authorization tests; verify exit status and record exact commands in `verification.md`. Review changed files and `git diff --check` without reverting unrelated HR/activity work.
- [x] 4.3 Independent solution reviewer and security/reliability reviewer: inspect only the repair and evidence for delta loss, acknowledgment/recovery races, task fencing, retry bounds and stale-snapshot/security regressions; record verdict and close all blocking findings. QA/test review and final product acceptance must agree the requested convergence defect is fixed.
- [ ] 4.4 Coordinating owner: update completed checkboxes and concise verification report, run final strict validation, and archive this repair only when all required work passes; preserve the separate verification change's historical RED and visibility limitation. No deployment or commit is required.

The independent final implementation/security and QA/test reviews resumed and approved the bounded repair; task 4.3 is complete. Historical native functional matrix remains preserved. A subsequent full-project release audit passed the four focused Yjs cases on production Docker but exposed an unresolved ten-participant durable-history failure (1399/1400 events); the native-upstream audit run also had connection timeouts and a divergent model. Task 4.4 and archival remain deferred until this conflicting release evidence is resolved. See archive/2026-09-06-verify-project-release-readiness/release-report.md and realtime-review.yaml. This is no longer a provider-limit gate.
