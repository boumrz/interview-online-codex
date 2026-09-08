## Why

The ten-participant browser test reproducibly leaves participants with different code after seven candidates type concurrently. All 2,100 activity events are retained, but the final observed manager document contains only 653 of those typed characters; this is a collaboration data-loss defect that the user explicitly requests fixing.

## What Changes

- Preserve every still-applicable incremental Yjs update through heartbeat coalescing, delayed relay responses, recoverable reconnects and a backlog exceeding the old 300-message boundary.
- Retry uncertain deliveries without changing the update identity or allowing later dependent updates to bypass it. Coalesce only messages whose semantics permit replacement.
- Preserve room, task/workspace and authorization fences: reconnect is not permission to replay an obsolete task or continue after terminal access failure.
- Prove convergence with deterministic transport fault tests and repeat the existing ten-participant RED, including candidate activity and privacy assertions.
- Preserve server-authoritative snapshot freshness and existing SSE plus POST contracts. Repair missing inbound recovery only if an acceptance test reproduces a remaining gap and its contract is documented before that production change.

## Capabilities

### New Capabilities

- `reliable-yjs-delivery`: Lossless incremental update delivery and eventual shared-editor convergence within a valid room/workspace session under concurrency, delayed responses and recoverable reconnects.

### Modified Capabilities

None. Existing `realtime-room-access`, `independent-interviewer-step-navigation`, HR and candidate activity requirements remain binding regression constraints.

## Impact

- Frontend room relay queue and its focused tests; the shared editor integration only where required to preserve valid updates across recovery.
- Browser acceptance coverage under `frontend/tests/e2e/realtime/` and the existing `frontend/tests/e2e/interview/e2e-multi-participant-activity.mjs`.
- Backend realtime/security verification remains required because delivery semantics interact with event sequence and snapshot validation. No new endpoint, database migration, dependency or transport replacement is planned.
- Prior evidence remains unchanged in `openspec/changes/verify-multi-participant-activity/` and `output/playwright/multi-activity/1788690452995/report.json`. That verification-only change does not authorize the production fix; this change does.

Out of scope: new HR behavior, activity timeline optimization, unlimited durable offline editing, recovery of characters already lost in historical rooms, mobile redesign, pixel-baseline creation and production capacity/SLA claims.

## Slow-network regression amendment

The initial lossless repair exposed a required regression: `e2e:slow-network` fails its existing 30-second deadline with a 3,000ms relay delay per request (`output/yjs-delivery-fix/regression-e2e-slow-network.log`). A serial request per character cannot drain promptly. Extend the same repair with lossless Yjs merging of adjacent, compatible, never-attempted queued edits before their first dispatch. Freeze the resulting envelope for all retries; retain server freshness and context boundaries. No timeout relaxation or server contract change is proposed.
