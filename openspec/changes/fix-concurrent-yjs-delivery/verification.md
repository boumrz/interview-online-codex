# Concurrent editor delivery — verification

## Result and scope

The lossless queue repair in `frontend/src/features/room/useRoomSocket.ts` passed the historical native development functional matrix: 11 regression commands, including four deterministic delivery scenarios and the full ten-context interview workload. Backend source was not changed by this repair; all 96 backend tests pass. No deployment, schema migration or commit was performed.

Independent final implementation/security and QA/test reviews resumed after the prior provider-limit interruption and approved this bounded repair; see review.yaml and qa.yaml. The later full-project release audit passed all four focused Yjs cases on production Docker, but its ten-participant workload exposed missing durable history (1399/1400 events), while a native-upstream run had connection timeouts and one divergent model. **Project release is NO-GO and archival remains deferred pending resolution of this conflicting evidence.** See the verify-project-release-readiness audit report; the historical passing matrix below does not override fresh failures.

## Repair

- Nonempty incremental Yjs updates survive heartbeat coalescing, backlog growth and same-workspace recovery. The lossy 300-message eviction is removed.
- Coalescing cannot cancel the actual in-flight request. Acknowledgments remove the acknowledged object, even if recovery has filtered the queue meanwhile.
- Adjacent, compatible, never-attempted deltas are merged with installed `Y.mergeUpdates` at dispatch, bounded by 64 KiB of encoded input per group. Other actions, heartbeats and context changes remain barriers. The batch retains a consistent latest snapshot/sequence envelope.
- An attempted envelope is frozen for retries, including delta bytes, operation ID, both sequences and snapshot freshness metadata. A batch accepted before its response is lost is retried unchanged and appears exactly once.
- Recovery retains only nonempty deltas matching the authoritative invite/step/language key. Terminal access failure and existing server snapshot/privacy guards remain binding.

## Test-first evidence

OpenSpec proposal/spec/design/tasks and planning readiness were validated strictly before test authoring and production work. Baselines are preserved in `output/yjs-delivery-fix/baseline/`; the final implementation snapshot is `repaired-batched-useRoomSocket.ts`.

| Before implementation | Observed failure | Evidence |
| --- | --- | --- |
| Original ten-context test | All activity recorded, editor models diverge | `output/playwright/multi-activity/1788711471455/report.json` |
| Held first delta, 350 real A edits and heartbeat | UI can heal from snapshots, but incremental-only Y.Doc loses all 350 A | `output/playwright/yjs-delivery/1788711831353/report.json` |
| Accepted response lost | Other editors contain 1 A while sender contains 50 A | Same report |
| Real SSE recovery with pending local edits and remote input | Complete-document convergence fails | `output/playwright/yjs-delivery/1788712041894/report.json` |
| Initial lossless repair under 3s relay latency | Watcher has only marker prefix after unchanged 30s deadline | `output/yjs-delivery-fix/regression-e2e-slow-network.log` |
| Pre-batching accepted-envelope test | Delivery contains one edit, not a merged keyboard burst | `output/playwright/yjs-delivery/1788713381420/report.json` |

The first offline-only recovery fixture did not close Chromium's established SSE; its setup failure is not counted as product RED. It was corrected to actual server stream replacement plus blocked reconnects before production edits. Existing task/auth boundary checks passed before the repair and protect against regressions.

## Historical repair execution

All browser/API commands below use `E2E_API_URL=http://localhost:18080/api E2E_BASE_URL=http://localhost:5173` from the repository root. Run an individual script with `npm --prefix frontend run <command>`. Exact exit statuses and logs are in `output/yjs-delivery-fix/final-regression-report.json`; every entry exits 0.

| Command | Verified behavior |
| --- | --- |
| `e2e:yjs-delivery` | Four scenarios: heartbeat/backlog, real SSE recovery, single accepted-response loss, merged accepted-response loss |
| `e2e:yjs-queue-boundaries` | Delayed old-task edits remain absent from replacement task; subsequent edits sync; exactly two 403s terminate access |
| `e2e:multi-activity` | Ten independent browser contexts, seven concurrent writers, 2,100 source events, complete editor equality, logs/exports/privacy and manager reload |
| `e2e:five-participants` | Published and manager-workspace collaboration |
| `e2e:yjs-multi` | Multi-participant Yjs editing |
| `e2e:slow-network` | Existing 3,000ms relay delay and 800ms CDP profiles; unchanged 30s/15s deadlines |
| `e2e:refresh-sync` | Room refresh synchronization |
| `e2e:yjs-refresh-api` | Snapshot persistence and stale-snapshot handling |
| `e2e:yjs-abc-refresh-join` | Concurrent update, refresh and join server contracts |
| `e2e:public-step-preservation` | Published task preservation across navigation |
| `e2e:realtime-auth-recovery` | Bounded authorization recovery |

Final four-scenario report: `output/playwright/yjs-delivery/1788713952831/report.json`. Every browser model equals an independent Y.Doc reconstructed only from initial bootstrap plus actual SSE incremental updates, ignoring later full snapshots. Backlog holds the first request for 4,304ms across a real heartbeat and preserves 350 A plus 100 B. Recovery preserves 50 A plus 60 remote B. Lost-response cases preserve 50 A/50 B and 60 A/50 B respectively. The accepted/retried merged envelope contains **49 actual keyboard edits**; the complete serialized envelope remains identical across attempts.

Final ten-context report: `output/playwright/multi-activity/1788713972602/report.json`. All ten models contain exactly 2,112 characters (12 initial plus 7 × 300 inserted), with identical order and contents. Owner and HR full reloads receive the same complete code. All 2,100 activity source UUIDs, paging/download and candidate HTTP/SSE/direct-access privacy assertions pass. Unexpected runtime errors: **0**. Expected transport diagnostics are classified separately: 3,267 successful-header body cancellations and 52 injected network/cleanup failures. Root inspected the final desktop screenshot; automated layout checks also cover the 900px HR view.

Slow network: watcher sees the first complete canary after 20s with the 3s server delay, and the second after 1,209ms from typing completion under the 800ms CDP profile. These are local observations under test faults, not production latency promises.

Static/build verification:

- `npm --prefix frontend run typecheck`: exit 0, `output/yjs-delivery-fix/typecheck-batch.log`.
- `npm --prefix frontend run build`: exit 0, `output/yjs-delivery-fix/build-batch-final.log`. Two existing asset/entrypoint size warnings; no compilation errors.
- `JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home mvn -q -f backend/pom.xml test`: exit 0; 96 tests, zero failures/errors/skips, `output/yjs-delivery-fix/backend-tests.log`.
- New/modified E2E syntax checks and `git diff --check`: passed.

## Test strength and diagnostic history

Three targeted automated mutations of the initial queue repair restored cap eviction, recovery discard and heartbeat tail coalescing. All were killed by missing-content assertions: `output/yjs-delivery-fix/mutation-report.json`. These historical results precede batching and are not presented as whole-project mutation coverage. Two additional mutations against the final batching source were also killed: replacing the merge with only the last delta fails independent document reconstruction; allowing attempted envelopes to merge fails the unchanged retry-identity assertion. Evidence: `output/yjs-delivery-fix/batch-mutation-report.json` (reports `1788714110048` and `1788714162696`). The final source was restored byte-for-byte from the saved batch baseline; focused delivery and boundary checks are rerun after restoration in `restored-regression-report.json`.

An intermediate ten-context run already converged after both reloads but exposed a test-inspector race: a response body from the prior document was unavailable after navigation. The harness now tracks request/document generation, waits for pending inspectors and accepts only the exact observed old-document CDP error. Current-document failures, malformed JSON and candidate privacy checks remain failures. Historical failure report `1788712633387` is preserved; final run has no unexpected errors.

## Limits and remaining gate

The queue is memory within the current page session; prolonged interruption increases memory and drain time. This repair does not reconstruct historically lost edits or provide durable offline storage across page closure. Old deployed clients retain their old implementation until updated/reloaded.

The separate `verify-multi-participant-activity` change retains its historical RED and unverified hidden/visible lifecycle criterion. Ten headless Chromium contexts and two tested layouts establish this functional workload, not production capacity, mobile completeness, a pixel baseline or universal UI readiness.

Independent final batching implementation/test review is complete and approves the bounded change. The remaining archival gate is reconciliation of the fresh full-project audit failures described above; do not represent the historical green matrix as current whole-project readiness.
