## Verification tasks

- [x] 1. Validate the test-only proposal, capability and design strictly; record scope/readiness. No production behavior change is proposed and no artificial RED is required.
- [x] 2. Add a ten-context browser harness with real concurrent keyboard input, source/acknowledgement collection, manager/HR access, candidate privacy, reconnects, full UI paging and JSON/CSV downloads. Use three rounds of 100 keys per each of seven candidates (2,100 minimum keyboard events).
- [x] 3. Run the harness and the unchanged five-participant and Yjs multi-participant tests. Capture desktop/narrow screenshots, inspect them, and record exact workload, layout assertions, interaction timings and classified runtime errors. If a genuine product failure occurs, record RED and amend scope before production remediation.
- [x] 4. Obtain a bounded independent test/UX review of the evidence, reconcile outcomes and limitations, and validate strictly.
- [ ] 5. Resolve the recorded product RED and unverified visibility criterion before acceptance/archive. Archival is deliberately deferred; no production remediation is included in this test-only scope.

Root owns test implementation, runtime and evidence. Specification agent authored proposal/spec/design; root completed the bounded task/readiness handoff. No linked Linear issue exists. Existing uncommitted application changes must remain intact.

## Recorded execution findings

- Diagnostic RED: `output/playwright/multi-activity/1788689867384/report.json` proves persistent editor divergence after all 2,100 physical key actions were acknowledged and durably recorded. The failing editor assertion remains in the harness while independent activity/export/layout phases continue. No application edits are part of this verification change.
- `output/playwright/multi-activity/1788690297060/report.json` proves complete JSON/CSV UI downloads, candidate denials and desktop paging/layout, then stops on a harness-only assumption that 900px uses compact Team navigation. The real compact breakpoint is 760px; the harness now uses its existing adaptive navigation.
- Real tab activation did not expose a hidden/visible lifecycle transition, including the headed-candidate attempt `1788690219017`. This scenario remains explicitly unverified; browser tab operations alone are not accepted as lifecycle coverage.
- Archival is deferred while the demonstrated editor defect and the unverified visibility criterion remain unresolved. The requested test execution can be reported with these failures; it must not be presented as product readiness.

Final complete execution evidence: `verification.md` and `output/playwright/multi-activity/1788690452995/report.json`. All independent activity/export/privacy/layout phases ran; the retained editor integrity assertion failed.

## Follow-up repair evidence

The editor divergence is repaired under `../fix-concurrent-yjs-delivery/`; final report `output/playwright/multi-activity/1788713972602/report.json` passes complete editor equality for all ten participants and owner/HR full reloads, alongside all 2100 activity sources and privacy/export assertions. Original RED evidence above remains historical evidence, not a current failed repair. The real hidden/visible lifecycle criterion is still unverified, so task 5 and this verification change remain open. The repair's independent final review is also pending after provider usage-limit errors; see its `verification.md`.
