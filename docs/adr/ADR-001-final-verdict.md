# ADR-001: Final Interview Verdict (Feature #7)

**Date:** 2026-05-23  
**Status:** Accepted  
**Author:** architect-agent

---

## Context

The platform needs a way for the interviewer/owner to record a final hiring decision
after the interview ends. The decision must persist in the database, be broadcast to
all connected participants, and gate the room into a "finished" state that prevents
further editing.

Existing state: `Room` entity has no `verdict` or `status` fields. `RoomResponse` and
`RoomSummaryDto` carry no such fields. `RoomRealtimePayload` (SSE push) also has none.
`RoomAccessService.RoomRole.canManageRoom` already captures the correct permission
boundary (owner + interviewer).

---

## Decision

### 1. Data model changes — `Room.kt`

Add two nullable columns directly to the existing `rooms` table via ddl-auto:update:

```
verdict          VARCHAR(32)   NULL   -- STRONG_HIRE | HIRE | NO_HIRE | STRONG_NO_HIRE
verdict_comment  TEXT          NULL
status           VARCHAR(32)   NOT NULL DEFAULT 'active'  -- active | finished
finished_at      TIMESTAMPTZ   NULL
```

Rationale: verdict is a property of the room, not a separate aggregate. The data is
small, always fetched with the room, and no querying by verdict is planned for MVP.
A separate `VerdictRecord` table would add join overhead with no benefit at this scale.

Status enum is stored as a string column (not PostgreSQL ENUM type) to avoid migration
pain under ddl-auto. The Kotlin side uses a string constant set.

### 2. New Kotlin enum — `RoomStatus.kt`

New file: `backend/src/main/kotlin/com/interviewonline/model/RoomStatus.kt`

```
ACTIVE    = "active"
FINISHED  = "finished"
```

New file: `backend/src/main/kotlin/com/interviewonline/model/VerdictValue.kt`

```
STRONG_HIRE     = "STRONG_HIRE"
HIRE            = "HIRE"
NO_HIRE         = "NO_HIRE"
STRONG_NO_HIRE  = "STRONG_NO_HIRE"
```

Both are simple Kotlin enums with a `wireValue: String` property following the
existing `RoomAccessService.RoomRole` pattern.

### 3. Request/Response DTOs — `RoomDto.kt`

Add to the existing file (no new file needed):

```kotlin
data class SetVerdictRequest(
    val verdict: String,           // one of VerdictValue.wireValue
    val verdictComment: String? = null,
)
```

Extend `RoomResponse` with:
```kotlin
val verdict: String? = null,
val verdictComment: String? = null,
val status: String = "active",
val finishedAt: String? = null,   // ISO-8601
```

Extend `RoomSummaryDto` with:
```kotlin
val verdict: String? = null,
val status: String = "active",
```

### 4. Service logic — `RoomService.kt`

New method `setVerdict(inviteCode, request, ownerToken, interviewerToken, user)`:

1. Load room by inviteCode. Throw 404 if absent.
2. Call `roomAccessService.requireManager(...)`. Throw 403 if not canManageRoom.
3. Validate `request.verdict` against `VerdictValue` enum. Throw 400 on unknown value.
4. Guard: if `room.status == "finished"` throw 409 Conflict ("Verdict already set").
5. Set `room.verdict`, `room.verdictComment`, `room.status = "finished"`,
   `room.finishedAt = Instant.now()`.
6. Save via `roomRepository.save(room)`.
7. Call `collaborationService.broadcastVerdictSet(inviteCode, verdict, verdictComment)`.
8. Return updated `RoomResponse`.

The 409 guard is intentional: a verdict is final. Re-setting it requires a separate
admin action not in scope for MVP.

### 5. CollaborationService — broadcast method

New method `broadcastVerdictSet(inviteCode, verdict, verdictComment)`:

Sends SSE event to all connections in `roomSseConnections[inviteCode]`:

```json
{
  "type": "verdict_set",
  "payload": {
    "verdict": "HIRE",
    "verdictComment": "Strong problem solving",
    "finishedAt": 1716451200000
  }
}
```

The `WsMessages.kt` file gets a new data class:

```kotlin
data class VerdictSetPayload(
    val verdict: String,
    val verdictComment: String? = null,
    val finishedAt: Long,
)
```

The `RoomRealtimePayload` (initial SSE state push on join) must also include:

```kotlin
val verdict: String? = null,
val verdictComment: String? = null,
val status: String = "active",
val finishedAt: Long? = null,
```

This ensures a participant who joins after the verdict was set sees the correct state.

### 6. REST endpoint — `RoomController.kt`

```
POST /api/rooms/{inviteCode}/verdict
Headers: X-Room-Owner-Token | X-Room-Interviewer-Token | Authorization: Bearer ...
Body: SetVerdictRequest
Response 200: RoomResponse
Response 400: unknown verdict value
Response 403: not canManageRoom
Response 404: room not found
Response 409: verdict already set
```

The endpoint follows the exact pattern of existing `nextStep`, `addRoomTasks` calls:
accept all three auth vectors, resolve the user, delegate to RoomService.

### 7. Frontend changes

Files changed:
- `frontend/src/features/room/useRoomSocket.ts` — extend `RealtimeState` with
  `verdict`, `verdictComment`, `status`, `finishedAt`; handle `verdict_set` event
  type to update local state.
- `frontend/src/services/api.ts` — add `useSetVerdictMutation` RTK Query mutation
  targeting `POST /api/rooms/{inviteCode}/verdict`.
- `frontend/src/pages/RoomPage.tsx` — add "Завершить интервью" button/modal, visible
  only when `canManageRoom && state.status !== 'finished'`. Modal contains a
  SegmentedControl for the four verdict values plus an optional Textarea for the
  comment. On submit calls `useSetVerdictMutation`.
- New file: `frontend/src/features/room/VerdictBadge.tsx` — small component that
  renders a colored `<Badge>` for each verdict value. Shown in the room header and
  in the RoomSummary list once status is `finished`.

No new RTK slice needed: verdict state lives inside the SSE-driven realtime state
already managed by `useRoomSocket`.

### 8. Application order

1. `VerdictValue.kt` + `RoomStatus.kt` — pure enums, no dependencies.
2. `Room.kt` — add four columns. ddl-auto:update handles the migration.
3. `RoomDto.kt` — extend request/response types.
4. `WsMessages.kt` — add `VerdictSetPayload`, extend `RoomRealtimePayload`.
5. `RoomService.kt` — add `setVerdict` method.
6. `CollaborationService.kt` — add `broadcastVerdictSet` method.
7. `RoomController.kt` — add endpoint.
8. Frontend: `useRoomSocket.ts` → `api.ts` → `RoomPage.tsx` → `VerdictBadge.tsx`.

---

## Risks

**R1 — ddl-auto:update column order.** Spring Boot ddl-auto:update adds columns but
does not set DEFAULT values for existing rows in PostgreSQL. `status` must be nullable
at the Kotlin level during migration OR a manual SQL backfill must run:
`UPDATE rooms SET status = 'active' WHERE status IS NULL`. Because ddl-auto is used
in production, the column definition must be `@Column(nullable = true)` initially;
the application code must treat null status as "active".

**R2 — Double-submit race on verdict.** Two concurrent POST requests could both pass
the `status != finished` check before either saves. The 409 guard alone is not
sufficient without a database-level constraint. Resolution: add a partial unique index
or rely on `@Transactional` + Hibernate's optimistic lock. For MVP the transaction
isolation at READ COMMITTED is sufficient because the two requests would arrive
milliseconds apart and the second will see the committed state when it re-reads inside
the transaction. Document this limitation for review.

**R3 — SSE broadcast ordering.** `broadcastVerdictSet` must be called inside or after
the `roomRepository.save` transaction commits, not before. If called inside a
`@Transactional` method before commit, clients receive the event but the subsequent
GET /api/rooms/{inviteCode} returns the old state. Decision: move the broadcast call
to after the `@Transactional` boundary in `RoomService`, or use a
`TransactionSynchronizationManager.registerSynchronization` after-commit hook.

**R4 — Finished room still accepts realtime events.** Once `status=finished`, the
server should reject `code_update`, `notes_update`, etc. via the SSE event POST
endpoint. This enforcement is NOT in scope for this ADR's MVP — it must be a
follow-up task. Document it explicitly so the Team Lead creates the task.

---

## Tradeoffs

| Decision | Alternative | Reason chosen |
|---|---|---|
| Columns on `rooms` table | Separate `interview_results` table | No querying by verdict for MVP; avoids join |
| String column for status | PostgreSQL ENUM | Avoids migration complexity under ddl-auto |
| 409 on double-submit | Allow override | Verdict is final; accidental double-click must be safe |
| Server-side broadcast | Client-side re-fetch | All participants see verdict simultaneously without polling |
