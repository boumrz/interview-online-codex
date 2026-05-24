# ADR-003: Full Keystroke Timeline (Feature #5)

**Date:** 2026-05-23  
**Status:** Accepted  
**Author:** architect-agent

---

## Context

The existing `candidateKeyHistory` is a rolling ring-buffer of 50 events stored as a
JSON TEXT column on the `rooms` table. It is adequate for the live "last activity"
panel but cannot serve post-interview analysis, export, or audit.

Feature #5 requires a full, persistent timeline of all candidate activity events —
keydowns, focus changes, and paste events (introduced by Feature #19) — stored in a
dedicated table with batch persistence and an export API.

This ADR depends on ADR-002 (paste detection) because the event payload must include
the new `pasteLength`/`pastePreview` fields from day one. The persistent table schema
must be a superset of `CandidateKeyPayload`.

---

## Decision

### 1. New entity — `RoomKeystrokeEvent.kt`

New file: `backend/src/main/kotlin/com/interviewonline/model/RoomKeystrokeEvent.kt`

```kotlin
@Entity
@Table(
    name = "room_keystroke_events",
    indexes = [
        Index(name = "idx_rke_room_ts", columnList = "room_id, timestamp_epoch_ms"),
    ]
)
class RoomKeystrokeEvent(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    var id: String? = null,

    @Column(name = "room_id", nullable = false)
    var roomId: String = "",              // Room.id (UUID), NOT inviteCode

    @Column(name = "session_id", nullable = false, length = 128)
    var sessionId: String = "",

    @Column(name = "display_name", nullable = false, length = 128)
    var displayName: String = "",

    @Column(name = "key_value", length = 64)
    var keyValue: String? = null,         // null for paste/focus events

    @Column(name = "key_code", length = 64)
    var keyCode: String? = null,

    @Column(name = "ctrl_key", nullable = false)
    var ctrlKey: Boolean = false,

    @Column(name = "alt_key", nullable = false)
    var altKey: Boolean = false,

    @Column(name = "shift_key", nullable = false)
    var shiftKey: Boolean = false,

    @Column(name = "meta_key", nullable = false)
    var metaKey: Boolean = false,

    @Column(name = "event_kind", nullable = false, length = 32)
    var eventKind: String = "keydown",

    @Column(name = "paste_length")
    var pasteLength: Int? = null,

    @Column(name = "paste_preview", length = 50)
    var pastePreview: String? = null,

    @Column(name = "timestamp_epoch_ms", nullable = false)
    var timestampEpochMs: Long = 0L,
)
```

Design notes:
- `roomId` stores `Room.id` (UUID), not `inviteCode`. This survives any future
  inviteCode regeneration and keeps the join simple.
- No `@ManyToOne` FK to `Room`. The table is append-only and high-write; a FK
  constraint would add a row-level lock on inserts. The application enforces
  referential integrity by only inserting when the room exists.
- The compound index `(room_id, timestamp_epoch_ms)` covers the primary read pattern:
  "all events for this room, ordered by time". No index on `session_id` alone for MVP.
- `keyValue` is nullable because paste and focus events have no meaningful key value.
- No versioning column: the table is immutable once written.

### 2. Repository — `RoomKeystrokeEventRepository.kt`

New file: `backend/src/main/kotlin/com/interviewonline/repository/RoomKeystrokeEventRepository.kt`

```kotlin
interface RoomKeystrokeEventRepository : JpaRepository<RoomKeystrokeEvent, String> {

    fun findByRoomIdOrderByTimestampEpochMsAsc(roomId: String): List<RoomKeystrokeEvent>

    @Query("SELECT r FROM RoomKeystrokeEvent r WHERE r.roomId = :roomId ORDER BY r.timestampEpochMs ASC")
    fun streamByRoomId(@Param("roomId") roomId: String): Stream<RoomKeystrokeEvent>
}
```

The streaming query variant is used for CSV export to avoid loading all rows into
memory. For JSON export the list variant is acceptable at MVP scale (< 50,000 events
per room is the realistic upper bound for a 2-hour interview).

### 3. Batch persistence service — `KeystrokePersistenceService.kt`

New file: `backend/src/main/kotlin/com/interviewonline/service/KeystrokePersistenceService.kt`

Responsibilities:
- Receive individual `CandidateKeyPayload` + `roomId` from `CollaborationService`
  via a non-blocking enqueue call.
- Buffer events in a per-room `ConcurrentLinkedQueue`.
- Flush to the database when either condition is met:
  - Buffer reaches 100 events (count threshold).
  - 5 seconds have elapsed since last flush (time threshold).
- Use the existing `Executors.newSingleThreadScheduledExecutor()` pattern already
  established in `CollaborationService` for the time-based flush tick.

Internal state:
```
pendingByRoom: ConcurrentHashMap<String, ConcurrentLinkedQueue<RoomKeystrokeEvent>>
scheduledFlushByRoom: ConcurrentHashMap<String, ScheduledFuture<*>>
flushScheduler: ScheduledExecutorService (single-thread)
```

Flush logic (per room):
1. Drain the queue atomically: `val batch = drainQueue(roomId)`.
2. If batch is empty, return.
3. Call `roomKeystrokeEventRepository.saveAll(batch)` inside a `@Transactional`
   method.
4. Log count at DEBUG level.

The `flushScheduler` runs a global tick every 5 seconds and calls flush for all rooms
with non-empty queues. This avoids N scheduled futures (one per room) and a single
scheduled future pattern that already exists in `CollaborationService`.

Graceful shutdown: implement `@PreDestroy` to flush all pending queues synchronously
before the Spring context closes.

**Why not use Spring's `@Async` or a thread pool?**
The existing codebase uses a single-thread scheduler for debounced DB saves
(`roomCodeDbSaveScheduler`, `roomCandidateKeyHistorySaveScheduler`). Consistency with
this pattern avoids introducing a new concurrency model. The single-thread flush is
sufficient: 100 events × 5s max latency means throughput of 20 events/sec per room
minimum, which is far above realistic keystroke rates.

### 4. CollaborationService changes

In the `key_press` handler, after building `CandidateKeyPayload` and broadcasting,
call:

```kotlin
keystrokePersistenceService.enqueue(
    roomId = room.id!!,
    payload = candidateKeyPayload,
)
```

`room.id` is always non-null at this point (the room was loaded from DB to resolve
the inviteCode). The call is non-blocking (enqueue into ConcurrentLinkedQueue).

`CollaborationService` takes `KeystrokePersistenceService` as a constructor-injected
dependency.

### 5. Export DTO — `KeystrokeExportDto.kt`

New file: `backend/src/main/kotlin/com/interviewonline/dto/KeystrokeExportDto.kt`

```kotlin
data class KeystrokeEventDto(
    val id: String,
    val sessionId: String,
    val displayName: String,
    val keyValue: String?,
    val keyCode: String?,
    val ctrlKey: Boolean,
    val altKey: Boolean,
    val shiftKey: Boolean,
    val metaKey: Boolean,
    val eventKind: String,
    val pasteLength: Int?,
    val pastePreview: String?,
    val timestampEpochMs: Long,
)
```

Mapping from entity to DTO is a single constructor call; no Jackson mixins needed.

### 6. REST endpoint — `RoomController.kt`

```
GET /api/rooms/{inviteCode}/keystroke-events?format=json|csv
Headers: X-Room-Owner-Token | X-Room-Interviewer-Token | Authorization: Bearer ...
Response 200 (json): application/json — List<KeystrokeEventDto>
Response 200 (csv): text/csv — CSV file with header row
Response 403: not canManageRoom
Response 404: room not found
```

Permission model: only `canManageRoom` (owner + interviewer) can export. Candidates
cannot access the timeline. This is server-enforced in the new `KeystrokeController`
method.

For CSV format, use Spring's `StreamingResponseBody` to stream the response without
loading all rows into memory. Column order in CSV: `timestamp_epoch_ms, session_id,
display_name, event_kind, key_value, key_code, ctrl_key, alt_key, shift_key, meta_key,
paste_length, paste_preview`.

Add to `RoomController.kt` rather than a new controller, following existing patterns.

### 7. In-room UI — Activity Timeline panel

**Frontend changes:**

New file: `frontend/src/features/room/ActivityTimeline.tsx`

A scrollable list component. Data source: the `candidateKeyHistory` already in
realtime state (last 50 events from SSE) for the live view, supplemented by a
lazy-loaded full timeline via the export API.

Two display modes:
- **Live mode** (default): shows the in-memory `candidateKeyHistory` (last 50 events).
  No new API call. This is the primary UX during the interview.
- **Full export mode**: triggered by a "Download" button. Calls
  `GET /api/rooms/{inviteCode}/keystroke-events?format=json` and opens the result as
  a downloadable file. No in-browser rendering of the full set (could be thousands
  of rows).

The panel is shown only when `canManageRoom` is true (same guard as the existing
key history rendering in `RoomPage.tsx`).

The component reuses `formatCandidateKey`, `formatCandidateKeyHistoryTimestamp`, and
the new paste formatting from ADR-002.

**Changes to `api.ts`:**

Add a new RTK Query endpoint:

```typescript
getKeystrokeEvents: builder.query<KeystrokeEventDto[], { inviteCode: string }>({
  query: ({ inviteCode }) => ({
    url: `/rooms/${inviteCode}/keystroke-events`,
    params: { format: 'json' },
    ...
  }),
})
```

For CSV download, use a direct `window.open` or `<a href>` trigger rather than RTK
Query, because the response is a file download, not JSON to be stored in the Redux
cache.

**Changes to `RoomPage.tsx`:**
- Add "Activity Timeline" tab or expandable section in the owner panel.
- Render `<ActivityTimeline>` when the section is active.
- Pass `canManageRoom` and `inviteCode` as props.

### 8. Application order

**Phase A — Backend (can deploy independently):**
1. `RoomKeystrokeEvent.kt` — new entity (ddl-auto creates table).
2. `RoomKeystrokeEventRepository.kt` — new repository.
3. `KeystrokePersistenceService.kt` — new service (depends on 1, 2).
4. `KeystrokeExportDto.kt` — new DTO.
5. ADR-002 changes (WsMessages.kt, RealtimeEventRequest.kt,
   CandidateKeyHistoryHelpers.kt) — must land before step 6.
6. `CollaborationService.kt` — inject `KeystrokePersistenceService`, call `enqueue`
   in key_press handler.
7. `RoomController.kt` — add export endpoint.

**Phase B — Frontend (depends on Phase A step 7):**
8. `candidateKeys.ts` — extend type (from ADR-002).
9. `ActivityTimeline.tsx` — new component.
10. `api.ts` — add `getKeystrokeEvents`.
11. `RoomPage.tsx` — wire panel.

### 9. Index design rationale

The single compound index `(room_id, timestamp_epoch_ms)` covers:
- `findByRoomIdOrderByTimestampEpochMsAsc` — index seek on `room_id`, scan by time.
- CSV streaming — same path.

No additional indexes at MVP. If post-interview analytics needs "all events for
session X across rooms", a `(session_id)` index can be added separately.

Table growth estimate: a 90-minute interview with an active candidate generates
roughly 5,000-15,000 keydown events plus focus/paste events. At ~200 bytes per row
(all columns), that is 1-3 MB per room. At 1,000 rooms total, the table is under
3 GB — manageable without partitioning at MVP scale.

---

## Risks

**R1 — Unbounded queue growth on server restart.** Events buffered in
`pendingByRoom` are in-memory. A server restart loses the current batch (up to 100
events or up to 5 seconds of activity). This is acceptable for MVP: the ring-buffer
backup in `candidateKeyHistory` (Room entity) survives restarts and provides
continuity for the live panel. The full timeline will have a small gap at restart
boundaries. Document this explicitly.

**R2 — Duplicate events if client retries.** The SSE POST `/events` endpoint has no
idempotency key for `key_press` events. A client retry (network error, timeout) will
submit the event twice. The persistent table will have duplicate rows. For MVP this
is acceptable: keystroke timelines are investigative tools, and a small number of
duplicates does not invalidate the analysis. A deduplication pass (GROUP BY
session_id, timestamp_epoch_ms, event_kind) can be applied at export time if needed.

**R3 — saveAll performance under high load.** `saveAll(batch)` with 100 entities
uses a single transaction with 100 individual INSERT statements under Hibernate's
default batch mode. To get actual JDBC batch inserts, `spring.jpa.properties.
hibernate.jdbc.batch_size=50` must be set in `application.properties`. Without this,
each entity is a separate round-trip. For 100 events at ~1ms each, that is 100ms
per flush — acceptable but measurable. Recommend setting `hibernate.jdbc.batch_size`.

**R4 — CSV streaming and connection pool exhaustion.** `StreamingResponseBody` for
CSV holds a database `Stream<RoomKeystrokeEvent>` open during the entire HTTP
response. This holds a JDBC connection for the duration. Under Hikari's default pool
size of 10, 10 concurrent CSV downloads would exhaust the pool. For MVP (low traffic)
this is acceptable. Mitigation: set a reasonable cursor fetch size on the JPA query
and ensure the `@Transactional(readOnly = true)` annotation is present to allow
connection release after result set is fetched.

Alternative: read all rows into a List, close the transaction, then stream the CSV.
This is simpler and safe at MVP scale (max ~3 MB per room). Recommend this approach.

**R5 — Entity table and ddl-auto.** ddl-auto:update will CREATE TABLE IF NOT EXISTS
on first startup. The index `idx_rke_room_ts` is declared via `@Table(indexes = [...])`.
Hibernate will attempt to CREATE INDEX on startup; if the index already exists it will
log a warning but not fail. This is safe.

**R6 — Feature ordering dependency.** If #5 is deployed before #19, the persistent
table will have `paste_length = NULL` and `paste_preview = NULL` for all events. This
is correct by schema design. No special handling needed.

---

## Tradeoffs

| Decision | Alternative | Reason chosen |
|---|---|---|
| Separate `room_keystroke_events` table | Expand `rooms.candidateKeyHistory` TEXT | Unbounded growth; TEXT column can't be queried efficiently |
| Batch flush (100 events or 5s) | Immediate per-event write | Reduces DB round-trips; acceptable 5s max latency for audit data |
| Single scheduler thread | Thread pool | Consistent with existing codebase patterns; throughput is sufficient |
| No FK constraint on room_id | FK with ON DELETE CASCADE | Avoids row-level lock on every insert; room deletion is a rare admin op |
| List<all rows> for CSV at MVP | StreamingResponseBody | Simpler; safe at MVP scale; avoids connection pool risk |
| canManageRoom permission on export | Separate export permission | Follows existing permission model; no new role concept needed |
