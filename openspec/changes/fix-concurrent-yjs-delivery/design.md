## Context

See `proposal.md` for the incident and scope. The stack remains React/TypeScript/RTK with Yjs and server-authoritative SSE plus POST relay backed by Kotlin/Spring persistence. No transport or data-model replacement is authorized by this fix.

The preceding verification established a real RED in `output/playwright/multi-activity/1788690452995/report.json` and `1788689867384/report.json`: each candidate retains their own 300 typed characters, while managers and other candidates see only a subset. Activity UUID persistence succeeds independently. Read-only inspection of `frontend/src/features/room/useRoomSocket.ts` identified three lossy transitions: empty-delta heartbeat dedupe removes nonempty Yjs messages of the same type and may abort the in-flight one; recovery drops queued editor mutations; queue overflow shifts the oldest item above 300. The heartbeat path matches the reproduced workload; overflow still requires a deterministic RED.

The following technical constraints were supplied by the coordinating owner from the investigation and are recorded for the Architect/implementation owner to confirm before production work. The specification agent is not asserting an independent architecture approval.

## Goals / Non-Goals

**Goals:** Distinguish replaceable state announcements from cumulative CRDT updates, retain causal delivery and identity through retry, and prove correctness under deterministic loss triggers plus the real ten-context browser scenario.

**Non-Goals:** Durable offline storage across page closure, automatic recovery of already lost historic edits, new retry/public API contracts, bypassing snapshot freshness, or refactoring unrelated room features.

## Decisions and implementation constraints

1. **Incremental updates are nonreplaceable data.** Preserve valid nonempty Yjs updates in FIFO order and keep a stable queued mutation identity until acknowledgment or an explicit terminal/context boundary. Only semantically replaceable messages, such as a full-state heartbeat for the same scope, may be coalesced. A heartbeat must not abort or remove an incremental update. The precise helper/module extraction is an implementation choice; a pure queue boundary is encouraged where it makes these rules directly testable. Coalescing arbitrary deltas by message type is rejected because later Yjs deltas can depend on missing earlier structs. Merging deltas would need proof of semantic completeness and unchanged identity/sequence handling; it is not required for this minimal repair.

2. **A backlog limit must not delete document content.** The existing 300-message cap may continue to constrain replaceable messages only if that does not evict incremental data or reorder its causal predecessors. Preserve the current valid-session incremental backlog and drain it serially. A larger lossy fixed limit merely postpones the same defect and is not an acceptable fix. This finite-workload guarantee is not a promise of unlimited memory or durable offline editing.

3. **Recovery and acknowledgment are distinct.** SSE recovery within the same authoritative workspace must retain valid unacknowledged edits, including an accepted request whose response is unknown. Retries retain their original client event/update sequence rather than generating a new identity. A recovery snapshot must merge with the valid local CRDT document rather than overwrite local edits. Room or workspace changes and terminal authorization failures remain discard fences. The current public sync key includes invite, published step and language; preserve only applicable pending public Yjs deltas, never rewriting their key. Acknowledgment must remove the exact acknowledged queued object rather than blindly shift the current head after concurrent recovery filtering. A direct client-side queue repair is the first scope. If the retained-queue E2E exposes an independent inbound gap, record its reproduced failure, concrete recovery contract and task amendment before touching that path.

4. **Server guards remain binding.** Keep snapshot freshness, base server sequence, mutation sequence and sync-key/task validation intact. A stale full snapshot cannot be used as a recovery shortcut that overwrites newer concurrent state. Candidate/manager visibility and the single permitted 403 recovery remain unchanged. Backend changes require an explicit design amendment and RED focused on the changed contract; backend realtime tests run even if the implementation remains frontend-only.

5. **Acceptance uses independent observable oracles.** Reuse the ten-context test's exact per-editor models and typed-character counts; do not weaken or remove its convergence assertion. Add a deterministic browser test which holds a real nonempty relay update across heartbeat generation and more than 300 subsequent actual incremental updates, then releases delivery and verifies independent editor models. Exercise real SSE reconnection with pending local and remote edits. Test delayed/accepted-lost responses separately where a single fault fixture cannot establish both. Pure queue tests are optional if a helper is independently justified; minimal inline production changes are preferred. Preserve reported runtime failures; expected abort classification is not proof that the corresponding mutation was delivered.

## Test and evidence plan

- New browser location: `frontend/tests/e2e/realtime/e2e-yjs-delivery-reliability.mjs` (or a documented existing realtime harness extension). Record the exact runnable command in `verification.md` before the first production edit.
- Optional focused queue tests: use the repository's existing frontend test runner and naming convention; record exact path/command in `verification.md`. Reconstruct with the installed Yjs package, not a mock that merely counts queue entries. The planned browser backlog test is sufficient without extracting a helper.
- Existing overall RED: from `frontend/`, `E2E_API_URL=http://localhost:18080/api E2E_BASE_URL=http://localhost:5173 node tests/e2e/interview/e2e-multi-participant-activity.mjs`. Preserve the original report and record a fresh pre-fix execution where needed to validate the test harness against the current source.
- Existing regression commands from `frontend/`: `npm run e2e:five-participants`, `npm run e2e:yjs-multi`, `npm run e2e:slow-network`, `npm run e2e:refresh-sync`, `npm run e2e:yjs-refresh-api`, `npm run e2e:yjs-abc-refresh-join`; inspect current scripts for step-boundary and bounded authorization scenarios and document the selected commands.
- Run `npm run typecheck`, `npm run build` and relevant backend realtime/authorization tests with Java 17. Do not run overlapping Maven work against shared build output.
- Browser convergence deadline is the pre-existing test's 45-second recovery budget for this local functional workload. Record observed times and injected delays; do not present that budget as a production SLA. Every expected edit must converge, not a sample or percentage.
- Keep prior activity and HR working-tree edits intact. No release-readiness claim until independent solution/security review, QA evidence and final acceptance agree.

## Risks / Trade-offs

- [Retaining a backlog increases memory during a prolonged interruption] → Exercise a backlog above 300, preserve replaceable-message coalescing and document valid-page-session scope; never hide the risk through silent data loss.
- [Replaying old context could corrupt another task] → Assert sync-key/task boundaries with a delayed old update and an authoritative task switch; keep server guards unchanged.
- [Retrying an accepted request could duplicate application effects] → Preserve identity and verify actual Yjs reconstruction plus existing server duplicate/sequence behavior.
- [A recovered client can miss inbound deltas independently of its own queue] → Require a pending-local/remote-change reconnect convergence test and amend design only if it exposes a remaining gap.
- [Concurrent tests can mistake delayed convergence for success or exhaust a shared test runtime] → Compare all ten documents after bounded quiescence and run browser workloads sequentially against the existing isolated fixture runtime.
- [Unrelated uncommitted HR/activity work could be overwritten] → File ownership, targeted edits and review only the repair's delta; no resets or broad cleanup.

## Migration Plan

No schema or data migration is planned. Deploy the repaired frontend through the existing pipeline after checks pass; do not deploy automatically in this task. Active old clients retain old behavior until they reload, so release notes must not claim existing pages are repaired in place. A code rollback restores the defect and does not reconstruct historical missing edits.

## Open Questions

### Validated slow-network amendment

The first repaired queue passes losslessness but fails the existing slow-network scenario: a 3,000ms request delay serializes every keystroke and exceeds its unchanged 30s deadline. Before further production work, preserve that RED log, add a merged-envelope accepted-response-loss acceptance scenario, and validate this amendment strictly.

At the drain boundary, combine only adjacent public nonempty `yjs_update` entries with the same nonempty sync key which have never been attempted. Use installed `Y.mergeUpdates` and existing base64 codecs; do not substitute a full snapshot for incremental data. Stop at attempted entries, heartbeats, other actions or a different context. Keep the latest constituent's metadata (operationId, clientEventSequence, yjsClientSequence, code, full snapshot and its original baseServerYjsSequence) together; retain the oldest queue time. Skipped unsent sequence numbers are legal under the server's increasing-sequence contract. Replace the contiguous run with this one new envelope before sending, then mark it attempted so retries cannot merge it with newer edits or change any of its payload. Bound each merge by a conservative total encoded input size (64 KiB); retain the remaining queue for later batches. If local decoding fails, leave originals intact for normal handling. All server snapshot freshness, authorization and task fences remain unchanged. This supersedes the earlier decision to defer merging: actual slow-network RED now demonstrates its necessity.

No P0/P1 product questions remain: the required outcome is preservation and convergence of currently authorized shared edits. Whether retained pending deltas alone also close every inbound reconnect gap is an investigation checkpoint, not an assumed implemented behavior; the specified reconnect acceptance test decides whether further documented work is necessary.
