# Joined HR participant assignment delivery plan

Change: `add-hr-participant-assignment`. Product input: `product-scope.yaml`, AC-01–08. Technical input: final `design.md`. Requirement source: delta `specs/hr-room-tracking/spec.md`. No linked Linear issue is supplied; this plan does not claim external issue creation or status changes.

One deliverable: a room manager selects a joined HR in the participant menu, explicitly grants interviewer access, and that HR sees one interview on the next cabinet refresh. Production path: TopBar → RoomPage → existing RTK addHrManager/PUT HR invitation → existing atomic durable role/tracking operation → server participant update → HR cabinet refresh. Candidate-link entry alone preserves candidate rights. Existing ID invitation remains available for absent HRs.

## Milestones and sequencing

| Milestone / streams | Tasks | Deliverable and definition of done |
| --- | --- | --- |
| M1 Contract and RED gates (A, B, G) | 1.1–1.3; 2.1–2.2 | Product and architecture accepted, every task audited ready, scope snapshots retained, browser and server eligibility tests demonstrate expected RED before linked production edits. |
| M2 Participant shortcut (B, F) | 3.1–3.3 | Server-confirmed eligibility, direct assignment, assigned state and request lifecycle implemented within owned files; prewritten focused tests GREEN. Backend projection is an additive, independently verifiable prerequisite for this vertical slice. |
| M3 Release evidence (G) | 4.1–4.4 | Final focused/regression/build verification passes; solution, security, QA, test, UX and product gates accept; specs synchronized and change archived. No deployment or commit is included. |

Task sequence is sprint-like: refine/audit → parallel browser and backend RED → scoped backend/frontend implementation → integrated verification → review and closure. Each task in tasks.md has a single execution owner or root as coordinator for named independent gates. Review findings produce a narrowly owned correction within the affected task; a new behavioral correction requires its own failing test before production correction.

## Dependency graph

```text
1.1 → 1.2 → 1.3 → 2.1 RED → 3.2 → 3.3 ──┐
                    └→ 2.2 RED → 3.1 ────┴→ 4.1 → 4.2 → 4.3 → 4.4
```

3.2 can be authored after browser RED using the finalized additive contract; its runtime acceptance waits for 3.1. Task 3.3 remains sequential in the same frontend handoff to avoid overlapping edits. Root is the sole checkbox/evidence coordinator after this plan handoff.

## Ownership, inputs and outputs

All owners share an already modified codebase: preserve prior HR changes and other agents' edits. Review this delta against `output/hr-participant-baseline`, not solely against Git HEAD. No schema, dependency, role enum, invitation API, export or cabinet changes are authorized by this plan.

| Task | Executor / owned output | Inputs and acceptance proof |
| --- | --- | --- |
| 1.1 | Specification Agent / proposal, delta spec, initial design/tasks | User request and accepted main HR specs; artifacts present and strict validation. |
| 1.2 | Team Lead / tasks.md, execution-plan.md | Product AC-01–08 and final architecture; small tasks, ownership and no unresolved P0/P1. |
| 1.3 | Prompt/Task Auditor / task-audit.yaml | All task definitions and final contracts; explicit ready verdict before any execution task. |
| 2.1 | Root / existing frontend/tests/e2e/hr/e2e-hr-cabinet.mjs | Product AC-01–08 and UX contract; observable acceptance assertions, original browser RED. |
| 2.2 | Root / new backend/src/test/kotlin/com/interviewonline/controller/HrParticipantProjectionIntegrationTest.kt | Projection contract and existing HR integration tests; new projection RED plus unchanged guard coverage mapping. |
| 3.1 | Root / backend/src/main/kotlin/com/interviewonline/service/CollaborationService.kt; backend/src/main/kotlin/com/interviewonline/ws/WsMessages.kt | 2.2 RED and design; focused projection GREEN, authenticated eligibility aggregated correctly, existing authority flow unchanged. |
| 3.2 | Frontend Developer / frontend/src/features/room/TopBar.tsx; frontend/src/features/room/useRoomSocket.ts; frontend/src/pages/RoomPage.tsx; frontend/src/pages/RoomPage.module.css | 2.1 RED, finalized payload/labels and existing addHrManager; primary participant-assignment flow GREEN. |
| 3.3 | Same Frontend Developer / same four files | Prewritten lifecycle E2E from 2.1; disabled pending control, error/retry, terminal 410 and stale response protection GREEN. |
| 4.1 | Root / verification.md and ignored output logs | Final sources plus RED records; commands below, result totals and runtime provenance. |
| 4.2 | Root coordinates Solution Reviewer and Security/Reliability / their review YAMLs | 4.1 evidence and scoped baseline delta; no unresolved blocker in engineering or permission boundary. |
| 4.3 | Root coordinates QA → Test Reviewer/UX Critic → Product Owner / their review YAMLs | Accepted solution/security reviews, eight product AC and final evidence; coverage, UX and final product acceptance. |
| 4.4 | Root / reconciled docs, archive and accepted main specs | All accepted gates; strict validation, diff hygiene and archive synchronization confirmed. |

Non-code tasks use artifact inspection, not artificial behavioral tests. Browser behavior defaults to E2E; backend payload provenance and direct permission enforcement use focused integration as the documented exception. Existing unchanged guard tests may be cited and rerun; do not claim their historical RED as new feature RED.

## Commands and test gates

Run from repository root using Java 17. E2E assumes frontend on 5173 and the matching backend on 18080; verify those endpoints and runtime revision before interpreting a failure. Preserve separate RED and GREEN logs under ignored `output/`.

```sh
npx --yes @fission-ai/openspec@latest validate add-hr-participant-assignment --strict
E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api node --test --test-name-pattern='participant HR' frontend/tests/e2e/hr/e2e-hr-cabinet.mjs
mvn -f backend/pom.xml -Dtest=HrParticipantProjectionIntegrationTest test
mvn -f backend/pom.xml test
npm --prefix frontend run typecheck
npm --prefix frontend run build
E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api npm --prefix frontend run e2e:hr-cabinet
E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api npm --prefix frontend run e2e:roles
E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:18080/api npm --prefix frontend run e2e:account-switch
```

The first focused browser command must run before frontend production edits; the focused Maven command must run before backend production edits. Root rebuilds/restarts the backend when required for final browser proof. Do not run competing Maven/build processes against the same outputs. Final verification does not repeat broad workbook workload or performance probes because this change leaves those paths unchanged.

After all review gates:

```sh
npx --yes @fission-ai/openspec@latest validate add-hr-participant-assignment --strict
git diff --check
npx --yes @fission-ai/openspec@latest archive add-hr-participant-assignment --yes
```

## Risk register

| Risk | Owner / mitigation | Gate |
| --- | --- | --- |
| Existing uncommitted HR implementation makes HEAD diff too broad | Root retains baseline snapshots and reviewers inspect only this delta; never revert other changes. | 4.2 |
| Anonymous/client-claimed HR flag or multi-session aggregation leaks eligibility | Root uses authenticated stored account state; integration tests cover false/true and session aggregation/reconnect. | 2.2, 3.1 |
| New action accidentally inherits owner-only permission gate or broadens ordinary role assignment | Frontend keeps canManageRoom for HR shortcut and existing canGrantAccess for interviewer assignment/removal; E2E includes non-owner and promoted guest. | 2.1, 3.2 |
| Async completion crosses account/room change, demotion or archive | Frontend scopes request lifecycle and uses existing terminal 410 handling; prewritten UI assertions and security review. | 3.3, 4.2 |
| Stale runtime gives false RED/GREEN evidence | Root records source/build identity and starts matching backend before final browser proof. | 4.1 |
| Cached HR account flag briefly omits menu after profile enablement | Architect's bounded refresh/reconnect behavior; assignment endpoint always revalidates stored eligibility. No new live account-setting broadcast. | 4.3 |

Readiness: product accepted and final design.md/architecture-review.yaml read and reconciled. Labels are `Назначить HR`, `Назначаем HR…` and `HR назначен`; exact error prose remains flexible. Request context/generation, abort guards and the existing terminal callback are architecture requirements. Task audit remains required before execution. Team Lead hands this plan to Prompt/Task Auditor; auditor records the execution-ready verdict.
