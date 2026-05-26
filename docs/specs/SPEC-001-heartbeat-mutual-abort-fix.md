# SPEC-001 — Fix: heartbeat-vs-heartbeat mutual abort stalls real-time sync

- **Type:** Critical bug fix
- **Status:** clarified
- **Owner agent:** Specification (TZ) Agent
- **Stack:** React + TypeScript + Rspack (SSE + POST events, Yjs CRDT) / Kotlin 1.9.25 + Spring Boot 3.3.5 + Java 17 + H2 (dev) / PostgreSQL (prod). No Redis.

---

## 1. Goals and context

The collaborative editor uses a server-authoritative sync model. Candidates' Yjs deltas are
POSTed to `/api/realtime/rooms/{inviteCode}/events` and rebroadcast to watchers over SSE. A
periodic **heartbeat** (full-document snapshot, empty delta) fires every 2500 ms as the recovery
mechanism for lost incremental deltas.

When server response time exceeds the heartbeat interval (2500 ms) — due to GC pause, high load,
or a slow DB query — each new heartbeat aborts the previous in-flight heartbeat. Because there is
always a newer heartbeat queued before the previous one resolves, the POST request is **never
delivered**. The recovery mechanism mutually starves itself, watchers see a frozen editor, and the
candidate receives no error. This is a silent, unbounded sync stall.

The fix removes the heartbeat-vs-heartbeat abort, while preserving the intended behavior where a
heartbeat (full snapshot) supersedes an in-flight incremental delta. It also adds backend latency
instrumentation so operators can detect slow relays before they become stalls, and an E2E test that
reproduces the failure under injected latency.

## 2. Glossary

| Term | Meaning |
|------|---------|
| **Delta / incremental update** | A `yjs_update` POST with a non-empty `yjsUpdate` base64 CRDT delta. |
| **Heartbeat / snapshot-only update** | A `yjs_update` POST with `yjsUpdate === ""` and a full `yjsDocumentBase64`. Fired every 2500 ms by `emitFullSnapshot`. |
| **In-flight** | A POST request currently awaiting a server response (`inFlightControllerRef.current != null`). |
| **Abort-and-replace** | Cancelling the in-flight request via `AbortController` so a newer queued payload takes its place. |
| **Relay latency** | Wall-clock time from POST received at backend entry to the corresponding SSE broadcast. |
| **Watcher** | Any SSE subscriber (typically the interviewer) receiving rebroadcast updates. |

## 3. User roles and scenarios

- **Candidate** — types code; frontend emits deltas and 2500 ms heartbeats.
- **Interviewer (watcher)** — observes the candidate's editor in real time via SSE.

**Failure scenario (current):** Backend is temporarily slow (response > 2500 ms). Candidate keeps
typing. Heartbeats abort one another in a loop; backend receives nothing; interviewer's editor
freezes with no error shown.

**Target scenario (after fix):** Under the same slow backend, at most one heartbeat is aborted by a
*delta*; heartbeats never abort heartbeats. The in-flight heartbeat completes, backend applies it,
and the interviewer receives the candidate's latest text within a bounded window.

## 4. Functional requirements

- **FR-1** In `queuePayload`, when both the in-flight head payload and the incoming payload are
  heartbeats (`yjs_update` with empty `yjsUpdate`), `canReplaceInFlight` MUST be `false` (no abort).
- **FR-2** A heartbeat MUST still abort an in-flight **incremental delta** (`yjs_update` with
  non-empty `yjsUpdate`) — existing behavior, full snapshot supersedes the delta.
- **FR-3** A delta MUST still abort an in-flight delta of the same type (existing behavior unchanged).
- **FR-4** Backend MUST emit a structured `yjs_relay_latency` log entry for every processed
  `yjs_update` after its SSE broadcast, including `room`, `seq`, and `relay_ms`.
- **FR-5** Backend MUST emit a `state_broadcast` latency log marker when the debounced
  `broadcastState` fires, so operators can correlate the debounced full-state path.

## 5. Non-functional requirements

- **NFR-1 (Reliability)** Under sustained backend response time of 3000 ms (> heartbeat interval),
  sync MUST NOT permanently stall: a watcher receives at least one SSE update with the candidate's
  latest changes within 10 s (5 s typing window + 1 heartbeat period).
- **NFR-2 (Latency, no regression)** Under normal backend response (< 100 ms), watchers MUST receive
  incremental updates within 500 ms end-to-end.
- **NFR-3 (Observability)** Relay latency MUST be queryable from logs without additional tooling
  (plain structured `logger.info` lines).
- **NFR-4 (No new attack surface)** The change introduces no new endpoints, auth changes, or
  client-trusted fields; the fix is purely client-side queue logic plus backend logging.
- **NFR-5 (Consistency)** Server remains authoritative; `lastYjsSequence` and snapshot-acceptance
  rules are unchanged. The fix only affects *which* client POSTs are aborted, not their server-side
  validation.

## 6. Constraints and assumptions

**Fixed:**
- Transport stays SSE + POST; no WebSocket migration.
- No Redis or external queue.
- Heartbeat interval stays 2500 ms (`RoomCodeEditor.tsx:452–454`).
- `MAX_PENDING_MESSAGES = 300` unchanged.
- Code execution remains out of scope.

**Assumptions:**
- A heartbeat is uniquely identified on the client by `payload.type === "yjs_update"` with a falsy
  `yjsUpdate` field (`yjsUpdate === ""`), matching the `dedupeSameType: normalizedYjsUpdate.length === 0`
  contract at `useRoomSocket.ts:1032`.
- `RealtimeFaultInjectionService` (`backend/.../service/RealtimeFaultInjectionService.kt`) can inject
  a per-request delay on the realtime event path for the E2E test. *(See OQ-1.)*

## 7. Required changes (exact)

### 7.1 Frontend — `frontend/src/features/room/useRoomSocket.ts`, `queuePayload` (lines 354–357)

Current:
```typescript
const canReplaceInFlight =
  (payload.type === "code_update" || payload.type === "yjs_update") &&
  hasInFlight &&
  currentHead?.payload.type === payload.type;
```

Replace with (insert the two flag computations before, then extend the predicate):
```typescript
// A heartbeat is a yjs_update carrying only a full doc (empty incremental delta).
const isIncomingHeartbeat =
  payload.type === "yjs_update" && !(payload as { yjsUpdate?: string }).yjsUpdate;
const isInFlightHeartbeat =
  currentHead?.payload.type === "yjs_update" &&
  !(currentHead?.payload as { yjsUpdate?: string }).yjsUpdate;

const canReplaceInFlight =
  (payload.type === "code_update" || payload.type === "yjs_update") &&
  hasInFlight &&
  currentHead?.payload.type === payload.type &&
  !(isIncomingHeartbeat && isInFlightHeartbeat); // NEW: never abort heartbeat with heartbeat
```
No other lines in `queuePayload` change. `abortAndReplaceInFlight = canReplaceInFlight;`
(line 358) and the abort at line 373–375 remain as-is.

### 7.2 Backend — `backend/src/main/kotlin/com/interviewonline/service/CollaborationService.kt`

`logger` already exists at line 48 (`LoggerFactory.getLogger(javaClass)`).

**(a) `handleRealtimeEvent` (entry at line 275):** record `receivedAt` at function entry and thread it
into the `relayYjsUpdate` call at lines 355–363.
```kotlin
val receivedAt = System.currentTimeMillis()   // at handleRealtimeEvent entry
...
"yjs_update" -> relayYjsUpdate(
    connectionId = connectionId,
    yjsUpdate = request.yjsUpdate.orEmpty(),
    syncKey = request.syncKey,
    codeSnapshot = request.code,
    yjsClientSequence = request.yjsClientSequence,
    baseServerYjsSequence = request.baseServerYjsSequence,
    yjsDocumentBase64 = request.yjsDocumentBase64,
    receivedAt = receivedAt,                   // NEW parameter
)
```

**(b) `relayYjsUpdate` (signature at lines 468–476):** add the `receivedAt: Long` parameter and emit a
structured log immediately after the SSE broadcast (`broadcastTransportMessage` at line 621).
```kotlin
private fun relayYjsUpdate(
    connectionId: String,
    yjsUpdate: String,
    syncKey: String?,
    codeSnapshot: String?,
    yjsClientSequence: Long?,
    baseServerYjsSequence: Long?,
    yjsDocumentBase64: String?,
    receivedAt: Long,            // NEW
) {
    ...
    broadcastTransportMessage(  // existing call beginning line 621
        ...
    )
    logger.info(
        "yjs_relay_latency room={} seq={} relay_ms={}",
        participant.inviteCode, state.lastYjsSequence, System.currentTimeMillis() - receivedAt,
    )
}
```

**(c) Debounced state broadcast — `scheduleStateBroadcastFromYjs` (lines 672–679):** `receivedAt` is
not available inside the debounced callback. Emit a wall-clock marker inside the scheduled lambda
(after `broadcastState(inviteCode)` at line 676) so operators can correlate timing:
```kotlin
val next = yjsStateBroadcastScheduler.schedule({
    pendingYjsStateBroadcastByRoom.remove(inviteCode)
    broadcastState(inviteCode)
    logger.info("state_broadcast room={} at_ms={}", inviteCode, System.currentTimeMillis())
}, 110, TimeUnit.MILLISECONDS)
```

### 7.3 E2E verification (Playwright)

- Open two tabs: Interviewer (watcher) and Candidate.
- Inject a per-request delay on the candidate's POST realtime endpoint via
  `RealtimeFaultInjectionService`, simulating a 3000 ms response (> heartbeat interval).
- Candidate types text continuously for 5 s.
- Assert: the watcher's editor shows the candidate's latest text within ≤ 10 s
  (5 s typing window + one 2500 ms heartbeat period, rounded up).
- Control run: with delay disabled (< 100 ms), assert incremental updates reach the watcher within 500 ms.

## 8. Acceptance criteria (binary)

- **AC-1** With backend response time simulated at 3000 ms (> heartbeat interval), the watcher
  receives at least one SSE update carrying the candidate's changes within **10 seconds**.
- **AC-2** `canReplaceInFlight` never evaluates to `true` when BOTH the in-flight head and the
  incoming payload are heartbeats (`yjsUpdate === ""`).
- **AC-3** Backend logs contain a `yjs_relay_latency` entry for each processed `yjs_update`.
- **AC-4** No regression: when the backend responds in < 100 ms (normal), watchers receive
  incremental updates within **500 ms**.
- **AC-5** A heartbeat still aborts an in-flight incremental delta (full snapshot supersedes it).

## 9. Out of scope

- WebSocket migration.
- Redis / external queue.
- Changing the 2500 ms heartbeat interval.
- Changing `MAX_PENDING_MESSAGES = 300`.
- Code execution features.
- Backpressure / adaptive heartbeat throttling (potential follow-up; see Risks).

## 10. Open questions

| ID | Priority | Question |
|----|----------|----------|
| OQ-1 | P1 | Does `RealtimeFaultInjectionService` support per-endpoint *response delay* injection on the POST realtime path, or only fault/drop injection? If delay is unsupported, a test-only delay middleware is required — confirm the chosen mechanism with the Architect. |
| OQ-2 | P2 | Should `relay_ms` above a threshold (e.g. > 2500 ms) be emitted at `WARN` rather than `INFO` to make near-stall conditions alertable? |
| OQ-3 | P2 | The debounced `state_broadcast` marker cannot report true e2e latency (no `receivedAt`). Is the wall-clock-only marker sufficient for operators, or is a correlation id needed? |

No P0 questions remain; spec is ready for handoff.

## Files to change

- `frontend/src/features/room/useRoomSocket.ts` — `queuePayload` (lines 354–357).
- `backend/src/main/kotlin/com/interviewonline/service/CollaborationService.kt` —
  `handleRealtimeEvent` (line 275 + call site 355–363), `relayYjsUpdate` (signature 468–476,
  log after broadcast at 621), `scheduleStateBroadcastFromYjs` (672–679).
- E2E test (new) under the project's Playwright suite.
