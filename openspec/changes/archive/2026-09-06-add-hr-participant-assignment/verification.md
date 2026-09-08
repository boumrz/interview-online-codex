# Participant HR assignment — verification

## Delivered behavior

A manager selects an authenticated HR participant and chooses **Назначить HR**. The existing server operation grants interviewer access and saves the tracked interview; no UUID input is required. The menu shows pending and assigned states, the participant receives an HR badge, and the room appears on cabinet refresh. Ordinary role promotion/removal remains owner-only. Candidate-link entry alone grants no manager access.

## Final checks

| Check | Result | Evidence under ignored output/ |
| --- | --- | --- |
| Full Maven backend suite | 67 tests, 17 suites; zero failures/errors/skips | hr-participant-backend-green.log |
| Restored projection tests and package | 2 tests pass; executable JAR built | hr-participant-package.log |
| Full HR browser acceptance | 15/15 pass; zero failures/cancellations/skips; 33.4 seconds | hr-participant-browser-accepted.log |
| Existing interviewer/notes/chat regression | PASS | hr-participant-roles.log |
| Existing same-browser account switch | PASS | hr-participant-account-switch.log |
| Existing participant presence regression | PASS | hr-participant-presence.log |
| Frontend typecheck and build | PASS | hr-participant-frontend-typecheck.log; hr-participant-frontend-build.log |
| Real UI preview | Assignment and assigned menus captured and inspected | playwright/hr-participant-menu.png; playwright/hr-participant-assigned.png |

The final browser run includes all ten prior HR cases and five new cases: owner assignment with failure/pending/retry and demotion/regrant; registered interviewer assignment; guest interviewer assignment; current 410 terminal handling; stale 410 isolation across demotion and regrant. Non-owner tests also verify the shortcut does not expose ordinary promotion/removal. Existing HR integration coverage exercises the unchanged assignment endpoint's authorization, stored eligibility, idempotency, archive and revoked-role boundaries.

## Runtime provenance

Backend is the restored and packaged source, running against isolated PostgreSQL database interview_hr_1788631751397 on port 18080. PID 63152 became ready on 2026-09-06 at 09:06:54 Europe/Moscow; log hr-participant-runtime.log. Frontend dev server on 5173 serves the same source that passed typecheck/build. No production code changed after these checks. Scoped before-change snapshots in output/hr-participant-baseline distinguish this shortcut from the previous, still uncommitted HR implementation.

## Test-first and test-strength evidence

- OpenSpec strict validation passed before test authoring. Product/architecture/task ownership were confirmed. Dedicated auditor spawning initially hit the agent thread limit; root performed the equivalent checklist in task-audit.yaml. Production still waited for recorded RED.
- Initial browser RED: candidate admission and ordinary controls succeeded, then the new test expected one **Назначить HR** action and found zero. All five new browser cases subsequently ran on the old runtime and failed on missing HR action/menu, with zero cancellations/skips. Logs: hr-participant-browser-red.log and hr-participant-browser-all-red.log.
- Backend RED: two new HTTP/SSE tests failed on absent authenticated HR eligibility and missing eligibility after opt-in with old/refreshed sessions. The second fixture initially omitted required profile displayName; that fixture was corrected and both intended assertion failures were rerun before production. Log: hr-participant-backend-red.log.
- Five additive Kotlin production lines implement the authenticated flag and same-identity any-session aggregation. Existing permission transactions and invitation API were unchanged.
- A controlled Kotlin mutation replaced any-session aggregation with the old representative flag. The mixed-session behavior test killed it on the intended assertion. Production source was restored byte-for-byte in a finally block, and the two tests passed again during packaging. Log: hr-participant-mutation.log. This is a focused executed mutation check, not a global mutation or coverage percentage claim.
- Initial integrated run passed 14/15; one immediate menu-count assertion raced the asynchronous menu mount. Added locator.waitFor before the count, without changing production. The primary case then passed 1/1 (hr-participant-primary-green.log), followed by the clean 15/15 run above.

## Review and operational bounds

Solution review approves and security/reliability pass with no scoped findings. See adjacent review artifacts for final QA, UX, coverage and product verdicts. Build reports existing asset/entrypoint size warnings. Admission-time HR eligibility refreshes on reconnect; every assignment still revalidates stored eligibility. Client cancellation cannot undo an already committed server assignment.

No new endpoint, database migration, dependency, room-role enum, polling or export behavior was introduced. No production deployment, commit, PR or external task update was performed. This is a local implementation and verification result.

## Final acceptance

Solution APPROVE, security/reliability PASS, QA READY, test review coverage-sufficient and UX approved. Product accepted all eight criteria with no remaining work or blocking gaps. Final strict validation and archival are recorded below.

Archive completed on 2026-09-06: `openspec archive add-hr-participant-assignment --yes` exited 0 and synchronized both added requirements into `openspec/specs/hr-room-tracking/spec.md`. Accepted main spec strict validation passed. All 12 tasks are checked; no implementation or review work remains. Archived directory: `openspec/changes/archive/2026-09-06-add-hr-participant-assignment/`. Final whitespace and YAML checks passed.
