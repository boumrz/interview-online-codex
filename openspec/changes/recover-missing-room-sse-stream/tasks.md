## 1. Architecture and test-first gates

- [x] 1.1 **Architect gate:** select and record the same-origin,
  server-authoritative missing-room classification contract required by
  `design.md`; confirm that it needs no new port, grants no authority, and
  preserves existing invitation/role checks. **Decision:** a side-effect-free
  `GET /api/realtime/rooms/{inviteCode}/stream-status` returns `204` for an
  admissible existing room and empty `404` only for a missing room. The client
  uses per-stream leases to fence stale relay callbacks. **Owner:**
  architect-agent.
- [x] 1.2 Add and run a red browser E2E regression that establishes a real
  `state_sync`, causes the next stream handshake to receive the documented
  missing-room `404`, and proves terminal unavailable UI, no editable editor,
  no raw status/body, and no increase in stream or `/events` traffic after the
  terminal state through focus/visibility callbacks. **Acceptance level:** E2E.
  Red evidence (2026-08-02): `MISSING_ROOM_SCENARIO=live npm run
  e2e:missing-room-recovery` timed out waiting for the unavailable UI, proving
  that the current client retries rather than terminalizing. **Owner:**
  developer-agent.
- [x] 1.2a Add and run a red browser E2E regression for an initial stream that
  receives the approved missing-room classification before any `state_sync`.
  Prove the same terminal UI and no retry traffic. **Acceptance level:** E2E.
  Red evidence (2026-08-02): `MISSING_ROOM_SCENARIO=initial npm run
  e2e:missing-room-recovery` times out waiting for the unavailable UI on the
  current client. **Owner:** developer-agent.
- [x] 1.3 Add and run a red browser E2E regression for the stale-token race:
  cause the first queued event to receive `403`, then confirm a missing-room
  `404` on recovery. Prove that terminal unavailable wins and a stale timer
  cannot resume stream or `/events` traffic. **Acceptance level:** E2E. Record
  the current failure before production changes. Red evidence (2026-08-02):
  `MISSING_ROOM_SCENARIO=race npm run e2e:missing-room-recovery` timed out
  waiting for the unavailable UI after the synthetic `403` and missing-stream
  handshake. **Owner:** developer-agent.
- [x] 1.4 Add a focused backend integration regression for the Architect-approved
  missing-room stream contract: it returns the documented missing result without
  a usable session, event token, state payload, or mutation, while existing
  authorization rules remain intact. **Acceptance level:** backend integration
  exception, because these server-side effects are not safely provable through
  UI alone. If already green, record it as a verified baseline; 1.2 and 1.3 are
  the mandatory red product baselines. Red evidence (2026-08-02):
  `RealtimeStreamStatusIntegrationTest` expected `204` for an existing room
  but received `404` because the endpoint did not exist. **Owner:**
  developer-agent.
- [x] 1.5 Have `prompt-task-auditor-agent` confirm that the red E2E assertions
  isolate the missing-room stream behavior from the active activity-timeline
  change and that the backend exception is proportionate. **Depends on:**
  1.1–1.4.

- [x] 1.6 Add and run a red E2E regression for a delayed status probe: after a
  real stream loss, focus/visibility must not emit control `/events` traffic;
  timeout must resume transient reconnect for an existing room rather than
  terminalizing it. **Acceptance level:** E2E. **Owner:** developer-agent.
  **Evidence (2026-08-02):** red baseline was
  `DELAYED_STATUS_PROBE_CONTROL_TRAFFIC {before:2,after:4}`; green after the
  bounded probe/fence implementation via
  `MISSING_ROOM_SCENARIO=delayed npm run e2e:missing-room-recovery`.

## 2. Scoped recovery implementation

- [x] 2.1 Implement the Architect-approved backend/client classification path
  using existing same-origin realtime infrastructure only. Preserve server-side
  authorization; do not create a port, token, membership, room-state leak, or
  activity-`5xx` behavior change. **Depends on:** 1.1, 1.2, 1.2a, 1.3, 1.4,
  and 1.5.
  **Owner:** developer-agent.
- [x] 2.2 Implement one idempotent missing-room terminal transition in the room
  realtime lifecycle: close SSE, cancel timers, abort/clear relay and activity
  work, and make later reconnect, focus, visibility, and stale-token callbacks
  no-ops for the current page-room session. **Depends on:** 1.2, 1.2a, 1.3,
  and 2.1. **Owner:** developer-agent.
- [x] 2.3 Render a distinct accessible, non-editable room-unavailable state;
  remove editable workspace access and use safe action-oriented copy without a
  raw HTTP status or backend message. Keep the existing access-denied state for
  authorization failures. **Depends on:** 2.2. **Owner:** developer-agent.
- [x] 2.4 Preserve the existing reconnect behavior for a temporary outage and
  the existing bounded stale-token `403` recovery when the room exists. Do not
  reclassify a generic transport error as room absence. **Depends on:** 2.1–2.3.

  **Owner:** developer-agent.

- [x] 2.5 Make the status probe non-cacheable and bounded; fence queued
  focus/visibility control traffic until a current stream is open. **Depends
  on:** 1.6 and 2.1. **Owner:** developer-agent.

## 3. Verification and handoff

- [x] 3.1 Run the new missing-room and stale-token-race E2E tests, the existing
  `npm run e2e:sse-reconnect` and `npm run e2e:realtime-auth-recovery`
  regressions, frontend typecheck/build, and the focused backend integration
  test. Record that the new E2E tests transition from their required red
  baseline to green. **Depends on:** 2.4.
  **Evidence (2026-08-02):** green after restarting the local backend on 8080:
  `npm run e2e:missing-room-recovery`, `npm run e2e:sse-reconnect`,
  `npm run e2e:realtime-auth-recovery`, `npm run e2e:activity-timeline`,
  `npm run typecheck`, `npm run build`, and focused Maven tests
  `RealtimeStreamStatusIntegrationTest,DurableCandidateActivityIntegrationTest`.
- [ ] 3.2 Run `openspec validate recover-missing-room-sse-stream --strict` and
  obtain review from `solution-reviewer-agent` and
  `security-reliability-agent`; hand evidence to `qa-agent` and
  `test-reviewer-agent` for release-readiness review. **Depends on:** 3.1.
- [ ] 3.3 Hand the verified scope and evidence to `product-owner-agent` for
  acceptance. Keep `group-activity-timeline-events` untouched unless a newly
  observed, independently scoped requirement is raised. **Depends on:** 3.2.
