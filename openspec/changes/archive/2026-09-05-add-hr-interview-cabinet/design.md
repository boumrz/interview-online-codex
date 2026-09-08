## Context and scope

This is the implementation contract for `add-hr-interview-cabinet`. The approved proposal and three capability specs remain the behavior source of truth. Architecture uses the existing React/TypeScript/RTK Query/CSS Modules/Rspack/Mantine frontend, Kotlin/Spring Boot backend, PostgreSQL and current SSE + POST/Yjs collaboration. No new account role, room role, transport, candidate CRM, realtime dashboard or UI library is introduced.

Existing foundations: `User.id` is the stable UUID; `User.role` remains `user|admin`; `RoomAccessService` owns room authorization; `RoomParticipant` has unique room/user membership; `RoomRepository.lockById` provides a PostgreSQL/H2-compatible room serialization point; `CollaborationService.syncParticipantPermissions` updates active account sessions. Existing room removal is owner-only and destructive. `finishedAt` currently changes on every verdict correction.

## Decisions and module boundaries

1. **Independent HR capability.** `User.isHr` defaults false and never participates in `RoomRole` resolution. Auth/profile DTOs propagate it. Profile permits self-enablement; disabling HR and its product policy are outside this MVP. Tradeoff: no role hierarchy or new auth flow, while existing accounts can opt in.
2. **Tracking separate from authorization.** Add `RoomHrAssignment`; existing owner/interviewer membership alone determines room authority. Explicit invitation writes interviewer membership and assignment atomically. Authenticated HR tracking writes assignment only after verifying manager authority. Tradeoff: a small additional relation preserves durable HR intent without conflating candidate attendance with candidate management.
3. **REST-only HR metadata.** Keep candidate/schedule fields out of `RoomResponse` and every shared realtime envelope. Expose them through the dedicated manager metadata endpoint and authorized HR projection. Tradeoff: other managers reload the metadata panel to see another manager's changes; no new realtime privacy projection is required.
4. **Retain the room on ordinary removal if tracked.** `archivedAt` is a terminal lifecycle flag independent of existing active/finished status. Keep metadata, results/tasks and membership in the database. Historical review uses the HR detail endpoint; live room APIs reject archive access. Tradeoff: retained history uses existing entities, with explicit archive guards and no second snapshot format.
5. **One projection for list/detail/export.** `HrInterviewService` selects authenticated HR assignments with current durable manager authority; `HrWorkbookService` renders that projection. `HrController` handles self-scoped queries; room HR operations may live in a small `RoomHrController`. `RoomService`, `RoomAccessService`, `CollaborationService`, and administrative deletion receive only necessary lifecycle/permission integration. Avoid cyclic service injection: a small `RoomHrTrackingService` may depend on repositories/access and return affected account IDs; the existing service/controller orchestrates after-commit collaboration notification.
6. **True XLSX.** Use `org.apache.poi:poi-ooxml:5.5.1` in both Maven and Gradle. The root verified this release against [Apache POI downloads](https://poi.apache.org/download.cgi). Use POI literal string cells, never formula setters. Tradeoff: a JVM dependency buys maintained OOXML writing/parsing; verify resolved runtime transitive versions against Spring dependency management and align only where needed.

## Data model and migration

Add migration `V9__hr_interview_cabinet.sql` after current V8; recheck migration numbering before creating it if another worker adds a migration.

| Entity/table | Additions and constraints |
|---|---|
| `User` / `users` | `is_hr BOOLEAN NOT NULL DEFAULT FALSE`; map as `isHr: Boolean` |
| `Room` / `rooms` | nullable `candidate_name VARCHAR(200)`, `position VARCHAR(200)`, `scheduled_at` timestamp instant, `archived_at` timestamp instant; `interview_metadata_revision BIGINT NOT NULL DEFAULT 0` |
| `RoomHrAssignment` / `room_hr_assignments` | generated UUID `id`; non-null `room_id`, `user_id`, `created_at`; unique `(room_id,user_id)`; FK room and user with cascade on administrative hard delete |
| Existing `RoomParticipant` | keep unique `(room_id,user_id)` and `interviewer|candidate` values; no HR room role |

Index assignments on `(user_id,room_id)` for personal reads; the unique pair supports room archive checks and deduplication. Keep existing participant/owner/task FK indexes. Rooms and tasks remain a one-to-many relationship; workbook score rows reference room UUID and task UUID (with step index). Do not add duplicate candidate entities or historical participant backfills.

Use the project's existing instant/JPA/SQL timestamp conventions and UTC database/JDBC configuration; explicit conversion to `Europe/Moscow` happens at the reporting boundary. Preserve the existing `finishedAt` field as first completion going forward: under the room lock, set only if absent. A V9 correction may replace a known later `finished_at` with earlier authoritative `room_product_metrics.first_verdict_saved_at`; otherwise retain the existing stored timestamp, and never fill a missing completion time from migration time. Legacy timestamps may reflect a past correction that cannot be reconstructed; the UI must not claim reconstructed history.

H2 schema generation must match entity fields, uniqueness, and explicit cleanup paths. Production migrations are additive. Existing users remain non-HR; candidate metadata stays null. Do not rewrite previous Flyway migrations. Administrative account deletion retains its existing destructive meaning: remove assignment rows for the deleted user and for owned rooms being hard-deleted before deleting FK targets, including explicit cleanup for H2. This administrative purge is separate from ordinary `/me/rooms/{id}` removal and does not silently create an anonymous owner or grant remaining HRs owner authority.

## Identity, authorization and concurrency

Every personal HR operation derives user identity from the existing `Authorization: Bearer <token>` and rereads stored `isHr`; it accepts no HR user ID as scope. Authorize before returning room data or looking up invite targets. `401` is missing/invalid account authentication, `403` is a non-HR account or unauthorized in-room action, and an inaccessible HR detail returns `404` without describing another account's interview.

Room-scoped metadata/invitation endpoints accept the established optional headers `Authorization`, `X-Room-Owner-Token`, `X-Room-Interviewer-Token`, and `X-Room-Event-Token`. Resolve event-token authority through `resolveRoleByEventToken(inviteCode,eventToken)` and pass that server-derived role to existing access resolution. Never trust a body role, user ID, or HR checkbox as caller authority. This supports the already-promoted guest interviewer. Existing account membership takes precedence over guest-token fallback.

Personal visible predicate:

`stored user.isHr AND assignment(user,room) AND (room.owner_user_id = user.id OR durable participant(room,user).role = interviewer)`.

Archived status does not relax this predicate. Candidate-only HRs, other HR accounts and obsolete assignments are excluded. Automatic tracking is an explicit authenticated POST after confirmed room admission; it does not turn a GET into a write. When verified entry uses supported manager credentials and no durable membership exists, bind the authenticated account as interviewer before tracking, preserving existing owner identity. Candidate authority never triggers binding.

Serialize invitation, tracking, role changes that affect tracked accounts, metadata writes, first verdict, and archive under the scalar room-ID `SELECT ... FOR UPDATE` boundary (`lockById`/`lockByInviteCode`), before entity materialization. Reread authority/archived state after taking the lock. Unique constraints remain the final duplicate defense; do not catch a persistence exception and continue a rollback-only transaction. Duplicate invite/tracking is `200` with the same effective relationship; retrying cannot downgrade the owner. Metadata uses a separate optimistic revision to avoid lost updates, independent of code/Yjs revisions.

Owner revocation uses existing REST/realtime participant-role operations; no new remove-HR UI is introduced. For tracked accounts, demotion persists an explicit `candidate` membership rather than deleting the row, so old room credentials cannot restore manager authority on reconnect. Keep the assignment for archive/history identity but exclude it from every HR data query. Both REST and realtime demotion paths apply this rule. Reinvitation by a current manager may explicitly grant interviewer again. Return the mutation result and affected account IDs explicitly from the transactional core; refresh those identities from durable state and clear stale active role overrides after commit. The HTTP service facade executes its write core through TransactionTemplate and lets transaction cleanup release the original connection before a synchronous permission refresh and successful HTTP result. If a service call joins an existing outer transaction, publication is instead queued after its successful commit; rollback queues nothing. The bounded background executor never falls back to running on the committing thread; queue saturation closes affected active connections so reconnect must resolve current durable authority. It uses a fresh `REQUIRES_NEW` transaction and the same scalar room lock before reading membership and broadcasting, so a late callback cannot restore an older grant from its original persistence context. Authenticated SSE admission, event-token authority, and realtime events also resolve current durable membership; guest overrides cannot supersede an authenticated candidate tombstone. New HR reads always consult durable authority.

## Frozen API contract

All timestamps are ISO-8601 instants (`2026-09-05T12:30:00Z`) or JSON null. Enums below use existing lowercase wire style. Do not add HR metadata to shared `Room` payloads. New responses set `Cache-Control: no-store`. Errors preserve current JSON `{ "error": "<safe actionable message>" }`; new paths must not include stack traces, SQL or database connection details. Validation errors use `400`, stale metadata `409`, archived live access `410`, workload exceeded `413`, and exhausted export concurrency `429` with `Retry-After: 5`.

### Account additions

- `POST /api/auth/register`: existing fields plus optional `isHr: boolean = false`.
- `UserDto` from register/login/GET profile/PATCH profile: existing fields plus `isHr: boolean`.
- `PATCH /api/me/profile`: keep required `displayName`; add optional `isHr: boolean`. Omitted preserves stored flag, `true` enables, `false` when already enabled returns `400` because disabling is outside MVP; `false` for an ordinary account is a no-op. Submitted `id`/`role` cannot redirect identity or modify authority.

### Room HR operations

| Method and route | Body | Success / access |
|---|---|---|
| `GET /api/rooms/{inviteCode}/interview-metadata` | none | `200 InterviewMetadata`; manager only |
| `PUT /api/rooms/{inviteCode}/interview-metadata` | complete `InterviewMetadata` | `200 InterviewMetadata` with incremented revision; manager only; archived denied |
| `GET /api/rooms/{inviteCode}/hr-managers` | none | `200 HrManager[]`; manager only |
| `PUT /api/rooms/{inviteCode}/hr-managers/{userId}` | none | `200 HrManager[]`; manager only; target must be valid existing HR UUID; archived denied |
| `POST /api/rooms/{inviteCode}/hr-tracking` | none | `200 {roomId:string,tracked:true}`; authenticated HR and verified manager only; idempotent; archived denied |

```typescript
type InterviewMetadata = {
  candidateName: string | null;
  position: string | null;
  scheduledAt: string | null;
  revision: number;
};
type HrManager = { userId: string; displayName: string; isOwner: boolean };
```

Metadata PUT requires all four keys. Null clears an optional field; trim name/position, convert blank to null, reject more than 200 Unicode characters; valid scheduled time must have a timezone offset and represent an instant. Negative/fractional revisions are invalid. Legacy null candidate names remain allowed; the UI labels missing information. A stale revision returns `409`, retains the local form and offers reload of current data; do not automatically overwrite another manager's changes. PUT persists only these metadata columns/revision, preserving editor/task/room state.

Invitation trims/parses canonical UUID. Missing target and existing non-HR target both return `404` with the same safe message (`HR-специалист с таким ID не найден`); no global user search endpoint or target email/nickname is exposed. Self-invitation by an HR owner creates tracking without changing ownership. The returned manager list contains only current authorized assigned HRs, ordered by assignment creation then user ID. A successful repeated invite reports ordinary success and one row.

### Personal list/detail/export

- `GET /api/me/hr/rooms?page=0&size=20&from=YYYY-MM-DD&to=YYYY-MM-DD` returns `HrInterviewPage`.
- `GET /api/me/hr/rooms/{roomId}` returns `HrInterview` using identical visibility, including archived records. Use this data for a read-only historical detail panel; it does not join a room.
- `GET /api/me/hr/rooms/export?from=YYYY-MM-DD&to=YYYY-MM-DD` returns XLSX bytes. Route matching must favor `/export` over the `{roomId}` variable.

```typescript
type HrTaskScore = { taskId: string; stepIndex: number; title: string; score: number | null };
type HrInterview = {
  roomId: string; title: string; inviteCode: string;
  candidateName: string | null; position: string | null;
  scheduledAt: string | null; createdAt: string; finishedAt: string | null;
  archivedAt: string | null;
  status: "active" | "finished";
  interviewState: "scheduled" | "active" | "finished";
  verdict: string | null; verdictComment: string | null;
  effectiveAt: string; dateSource: "scheduled" | "finished" | "created";
  taskScores: HrTaskScore[];
};
type HrInterviewPage = {
  items: HrInterview[]; page: number; size: number;
  totalElements: number; totalPages: number;
  timezone: "Europe/Moscow";
  from: string | null; to: string | null;
};
```

Defaults: page 0, size 20; require integer page >= 0 and size 1..100. Stable ordering is effective instant descending, then room UUID ascending. Out-of-range valid pages return empty items with correct totals. No HR ID query is supported. Fetch tasks only for selected records; avoid a fetch-join that silently paginates in memory. Detail and export return the same score identities and nullable values as the list.

`interviewState = finished` when persisted status is finished; otherwise `scheduled` when a scheduled timestamp exists (even overdue), otherwise `active`. Archive is a separate badge derived from `archivedAt`; scheduling is not attendance, and overdue scheduling never implies completion.

Date rules for both list and export: `effectiveAt = scheduledAt ?? finishedAt ?? createdAt`. `from` and `to` are both absent or both ISO local dates; reject partial, invalid or reversed dates. Convert interval `[from atStartOfDay(Europe/Moscow), (to+1 day) atStartOfDay(Europe/Moscow))` to UTC and compare effective instants. Include future scheduled dates. Client filters and date displays use Moscow explicitly; no dependence on device timezone. No implicit current-month window. The workbook displays the date source and reports the same range.

## Archive, realtime and sandbox

Ordinary `DELETE /api/me/rooms/{roomId}` retains owner authorization. Under the room lock: if any HR assignment exists, set `archivedAt` once and retain room/tasks/memberships/assignments; return the additive compatible response `{status:"ok",archived:true}`. Repeated owner removal of this archived room returns the same result. Untracked deletion keeps existing hard-delete cleanup and returns `{status:"ok",archived:false}`. Active `/me/rooms` lists omit archived rooms; the management UI explains whether deletion or archival occurred.

Every live room access/admission path and room mutation rejects a persisted archived room with `410`; do not only hide UI controls. This includes REST task/workspace/verdict/export-of-live-activity routes, SSE admission, POST relay, and delayed code/activity persistence. Archive and accepted writes must share a room serialization boundary or conditional active-row write so a stale JPA entity cannot undo `archivedAt` or change results after archival. Do not replace full room state from a stale metadata entity. The backend worker must select the smallest central guard compatible with the existing room locking and verify the archive/write race.

After successful archive commit, cancel pending room writes, invalidate/close existing SSE connections through `closeRoom`, and remove in-memory permission overrides. For a connected browser, transport closure triggers one persisted room check; `410` is terminal, disables controls and stops automatic reconnect/presence/state retry loops. Fresh/reloaded room entry is also terminal. An authorized HR can use the cabinet's historical detail panel. Ordinary permission demotion uses the existing `state_sync` shape and updated role fields; no new HR event payload or replay log is introduced. Reconnect resolves fresh account/membership authority and fetches the dedicated metadata only after manager admission.

The repository has no active code-execution runner in this scope. This change adds no execution service or sandbox permissions. Existing editor collaboration stays on SSE plus POST/Yjs; no WebRTC work is needed.

## Workbook, consistency and NFR guardrails

Workbook sheets and column order:

1. `Интервью`: `ID интервью`, `Комната`, `Кандидат`, `Позиция`, `Запланировано`, `Создано`, `Завершено`, `Состояние`, `Архив`, `Вердикт`, `Комментарий`, `Дата фильтра`, `Источник даты`.
2. `Оценки`: `ID интервью`, `ID задачи`, `Шаг`, `Задача`, `Оценка`. One row per task, null score is blank and is never fabricated as zero.
3. `Параметры`: generated timestamp, range/all-time, `Europe/Moscow`, interview count, field/date-source legend and blank-value explanation. Empty result still contains all sheets/headings and count 0.

Write user-controlled text as literal STRING cells, preserving Unicode/newlines/formula-looking prefixes; no formula nodes, external links, candidate inviteCode, credentials, private notes, raw activity or owner/interviewer tokens. The workbook uses room UUID for identity; no room hyperlink is required. Timestamps may be ISO local text with explicit Moscow offset to avoid Excel timezone ambiguity. Split oversized legacy text into adjacent continuation rows/sheets if needed or reject explicitly; never silently truncate a current comment to satisfy Excel cell limits. New metadata bounds and the existing 2,000-character verdict comment fit normal Excel cells.

Headers: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="hr-interviews-YYYY-MM-DD.xlsx"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Interview-Count: <number>`. Expose `Content-Disposition, Interview-Count` in existing CORS config for the separate-origin dev client. Request has existing bearer auth. Return complete generated bytes/file only after successful generation; JSON failures must never become an `.xlsx` download.

Use one repeatable-read database snapshot to acquire authorized projection rows/tasks for the export, so concurrent invitations/removals do not cause offset skips or double rows. Authorization is evaluated at snapshot acquisition; revocation completed before that snapshot excludes the record. An already-started successful read is not retroactively recallable. Export is bounded at 10,000 interview rows and 100,000 task rows; exceeding either fails with `413` and asks for a smaller date range, never partial success. Read at most limit+1 to detect overflow. Generate with SXSSF (100-row window), write to a private temporary file or bounded byte buffer, always close/dispose workbook and delete temp files. Set a 30-second generation/data-acquisition deadline; fail explicitly on timeout before success headers. Permit one export per account and two globally per application instance, released in `finally`; `429 Retry-After: 5` for contention. No retry of generation automatically on the client; the user can retry after an error.

Acceptance workload: 1,000 interviews, up to 5 tasks each, mixed archive/status/date fields. On local PostgreSQL test infrastructure after warmup: list first page <= 2 seconds; full export <= 10 seconds and all 1,000 summary rows/5,000 score rows parse; generation remains under its 30-second hard guard. Record actual timing rather than claiming a production SLA. Normal invite/metadata target <= 1 second without external network dependencies. Cabinet refresh is user-driven; RTK cache shows pending/stale feedback and a failed refresh never masquerades as fresh success.

## Frontend integration and delivery ownership

Frontend worker owns `frontend/**` production integration and corresponding tests unless root reserves the E2E file. Add `HrCabinetSection` under `pages/dashboard`, an HR navigation item guarded by server-synced `user.isHr`, optional registration checkbox and profile self-enable control. Reuse existing components/CSS Modules. Profile and HR cabinet expose selectable UUID with copy success/failure. New data lives in RTK Query, not a second auth store. Reset personal query cache on account switch/logout through existing mechanism.

Add a manager-only room HR/metadata panel (separate component) with candidate/position/date inputs, explicit Moscow display, save pending/conflict/error states, HR UUID invitation and assigned list. Fetch only after confirmed manager authority; role loss hides and clears private panel state. Invoke idempotent self-tracking after HR manager admission; failure is visible with retry and does not silently claim tracking. Candidate admission never issues it. Use existing `canManageRoom`, rather than `canGrantAccess`, for HR invitations; owner-only general role controls remain unchanged.

Cabinet has loading, empty, error/retry, manual refresh, pagination, paired date filters with clear-all, and download pending/success/error. Active records open existing room route; archived records open a read-only local detail panel from the HR detail endpoint. The panel shows task scores and current verdict/comment without private notes. Download authenticated binary through a dedicated helper or RTK `queryFn` that returns serializable metadata; do not retain Blob objects in Redux. Revoke object URLs after download and read `Interview-Count` for empty-result feedback.

Backend worker owns `backend/**` including migration, auth/profile mappings, tracking/metadata/query/export modules, POI dependency alignment in both build descriptors, room lifecycle and current REST/realtime role integration, account-delete FK cleanup, CORS exposed download headers, and proportionate backend tests. Root owns orchestration and full real-browser acceptance; no shared-file backend/frontend overlap is required.

## Verification, rollout and handoff

No production code precedes strict OpenSpec validation, ready task audit, and recorded behavioral red tests. Root's E2E test covers HR registration, existing-profile opt-in, ID, actual invitation by non-owner manager, cabinet refresh/metadata/results, all-time/period download, candidate-only exclusion, archive and historical review. Backend integration supplements direct non-HR/candidate/other-HR denial, guest event-token authority, concurrent invitation/tracking, revoke/reconnect, archive/mutation race, metadata revision, instant boundary precedence, first-verdict correction stability, parsed literal workbook cells and no secret fields, and workload bounds.

Commands: from repository root run `npx --yes @fission-ai/openspec@latest validate add-hr-interview-cabinet --strict`; backend worker runs `mvn -f backend/pom.xml test` with the project's configured Java/Maven path, and PostgreSQL V8-to-V9 migration/restart verification against the isolated database. Frontend runs `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`; root runs the new HR E2E file plus affected existing `e2e:account-binding`, `e2e:account-switch`, `e2e:roles`, and `e2e:realtime-auth-recovery` with the active fixture ports. Tests for docs are inapplicable; architecture is checked by validation, contract audit, solution review and security/reliability review.

Deploy migration/backend before frontend. A blind downgrade to pre-archive backend is unsafe because it may reopen retained rooms: rollback frontend independently, or roll backend back only to a compatibility build that preserves archive denial/assignment cleanup. Keep additive columns/relations on rollback. This implementation is not deployment authorization; root reports local validation and remaining release risks.

Review gates: solution-reviewer-agent for correctness/complexity and security-reliability-agent for HR access, metadata privacy, export, revocation, archive/reconnect. Architecture is ready for team-lead task decomposition after the API/task audit; no unresolved product choice blocks implementation under the supplied MVP defaults.


### Verification of connection reuse under contention

The `RoomPermissionMutation` boundary returns value plus affected user IDs, without ambient thread-local state. For an owned transaction, synchronous permission refresh runs only after TransactionTemplate cleanup. For an outer transaction, its callback enqueues work on a one-thread executor with a queue of 256; rollback schedules nothing. Queue rejection or asynchronous refresh failure closes affected account connections so old event tokens are invalidated and reconnect must resolve durable membership. There is no CallerRuns policy or pooled-connection-size workaround. The executor shuts down with the service.

This preserves the existing Spring/Hibernate connection handling and export isolation settings. Hibernate supports releasing connections after each transaction, but Spring HibernateJpaDialect requires ON_CLOSE to prepare a custom isolation level, so a global mode change would break the export snapshot. References: [Hibernate 6.5 connection handling](https://docs.jboss.org/hibernate/orm/6.5/userguide/html_single/Hibernate_User_Guide.html#database-connection-handling), [Spring HibernateJpaDialect](https://docs.spring.io/spring-framework/docs/6.1.14/javadoc-api/org/springframework/orm/jpa/vendor/HibernateJpaDialect.html).
