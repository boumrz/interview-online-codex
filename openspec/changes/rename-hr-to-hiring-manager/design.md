## Context

See [proposal.md](proposal.md). The accepted baseline stores the optional account capability as `isHr`; it is independent of user/admin authority and room-local owner/interviewer/candidate permissions. Existing room assignment creates an interviewer-equivalent membership plus a unique tracked-interview association, while current creation from the authenticated dashboard only creates the room and its tasks. The current profile API accepts an optional capability value but rejects a true-to-false transition.

The change crosses the authenticated React UI, the current profile contract, authenticated room creation, persisted room membership/tracking, and authorization checks. It therefore needs explicit compatibility, authorization, transaction, and stale-state rules before implementation.

## Goals / Non-Goals

**Goals:**

- Present one consistent Russian product term: “нанимающий менеджер”.
- Persist a user's explicit enable and disable decisions without granting or revoking unrelated authority.
- Allow dashboard room creation to give existing eligible accounts the same durable access/tracking that the established invitation path gives them.
- Keep server state authoritative over capability eligibility, assignments, and protected cabinet access.

**Non-Goals:**

- Renaming database columns, Kotlin/TypeScript symbols, existing endpoint paths, analytics fields, test-only identifiers, or historical records.
- Introducing a fourth room role, account-admin authority, a hiring-manager directory/autocomplete, email lookup, target approval, bulk editing of old rooms, or changes to public/guest room creation.
- Treating profile opt-out as global room-role revocation, deleting history, creating a cabinet realtime subscription, adding mutation auto-retries, or changing Yjs/SSE transport behavior.

## Decisions

### 1. Separate product vocabulary from compatibility identifiers

All rendered Russian product language will use “нанимающий менеджер”; the controlled checkbox text is exactly “Я нанимающий менеджер”. The implementation maintains a central copy map or equivalent auditable source so profile, cabinet, creation, participant, list, and feedback wording do not drift. Accessibility names are part of the same surface.

The stored boolean and existing technical contracts remain compatible during this change. Renaming them would expand a UI change into a persistence/API migration and risk existing clients without benefiting the user-visible requirement. The alternative—renaming every `Hr` identifier now—is excluded. The Architect must confirm that any API error text that reaches the UI also uses the product vocabulary, while protocol-only identifiers remain unchanged.

### 2. Profile capability is an explicit, self-only boolean update

`PATCH /api/me/profile` retains its current request and response shape: `displayName` is required, while `isHr` is an optional boolean. An explicit `"isHr": false` SHALL persist `users.is_hr = false`; `true` persists `true`; omission (and the current nullable binding representation) retains the stored value. The endpoint remains self-only: it derives the account solely from the bearer session, ignores identity/role fields outside the DTO, returns the canonical `200` `UserDto`, and creates neither a role nor a room mutation. The profile write SHALL lock/reload the current stored account row in its transaction before changing the flag, so it serializes with creation-time eligibility checks instead of saving a stale managed `User` instance.

The frontend sends the explicit boolean for this controlled checkbox, and changes the authenticated Redux user only from the confirmed `UserDto`; it does not optimistically hide or restore capability-only UI. On a confirmed disable it invalidates the `HrInterviews` RTK Query tag (which covers the list and detail), discards/revokes any pending hiring-manager export result, and redirects away from the hiring-manager dashboard section if it is open. It does not clear ordinary room, participant, metadata, or task caches: those are governed by room-local permission and remain valid where the user is still an interviewer. A failed/late profile response keeps the later confirmed account context and exposes a retryable error. On reload, login, re-enable, or a remounted cabinet query, the server-authoritative profile/`no-store` cabinet response is fetched again; cache state alone cannot restore access.

Disabling prevents current and future protected hiring-manager cabinet/list/detail/export operations, but does not mutate existing room memberships, owner/interviewer/candidate roles, interview content, or tracking records. This follows the baseline separation between the account capability and room authority, avoids surprising multi-room demotions, and leaves ordinary room-role management as the established explicit mechanism. The rejected alternative—silently removing every existing room assignment—would be a new destructive workflow that the request does not authorize.

### 3. Creation-time assignment is additive, authenticated, and all-or-nothing

Only authenticated `POST /api/rooms` gains one optional JSON property:

```json
{
  "title": "Техническое интервью",
  "language": "nodejs",
  "taskIds": ["task-uuid"],
  "hiringManagerIds": [
    "9b7157ab-34f0-4a18-b5f2-2bb1c2d09b5e",
    "0b65a49f-7f35-42a5-8060-53d70440cd80"
  ]
}
```

`hiringManagerIds` is `List<String>` at the boundary and defaults to the empty list when omitted. `[]` has the same result as omission; `null`, a non-array, or a non-string element is a malformed request. Each non-blank string is trimmed, parsed as a UUID, rendered to its canonical UUID string, deduplicated, and sorted for locking. The field is optional for backward compatibility, not a new required client capability. The success response remains the existing `200 OK` `RoomResponse`, with no new assignment/identity response field; the owner uses the existing room response and the targets discover their durable state through their ordinary room/cabinet reads. This avoids a target directory or additional cross-account disclosure.

`POST /api/public/rooms` and every guest flow retain `CreateGuestRoomRequest` and expose no target control. If its request body contains `hiringManagerIds`, it SHALL be rejected as an unsupported public-create field with `400` and the existing `{ "error": "..." }` error envelope; it must not silently ignore the field or create any assignment. A caller without a valid bearer token on `/api/rooms` retains the current `401` behavior. A client-supplied creator id, role, or `isHr` claim never affects authorization; any authenticated account may use the existing personal-dashboard creation capability, and the creator is always the session user.

For target validation, malformed UUIDs, absent accounts, and accounts whose currently stored `isHr` is false deliberately produce the same `404` status and the same generic `{ "error": "Указанный нанимающий менеджер не найден или недоступен" }` response. The response contains no failing UUID, email, token, display name, capability state, or per-target result. Structural payload errors use the existing privacy-safe `400` envelope. This preserves the established unknown-versus-ineligible behavior and lets the UI render one recoverable “not found or unavailable” message. Unexpected conflict/service errors remain generic under the existing error envelope and must never add target data.

The user interface accepts only copied invitation UUIDs; it does not add account search, autocomplete, lookup, or a client-side eligibility decision. It may trim/deduplicate to make the draft legible, but the server repeats all normalization and validation. It preserves title, tasks, and raw target input after a non-success response, disables overlapping submits, and does not automatically retry a timed-out/transport-failed create. Only a confirmed `RoomResponse` navigates to the room. The public creation client contract deliberately has no `hiringManagerIds` TypeScript property.

Within one Spring transaction, the implementation SHALL: resolve the authenticated creator and requested tasks; normalize the entire target list before room persistence; acquire the target user rows in canonical UUID order with a write lock; verify every canonical target exists and has current `isHr = true`; create the room and tasks; then create the established interviewer membership for each non-owner target and exactly one tracked-assignment row for every target (including an owner supplied as a target, matching existing invitation semantics). The transaction commits all of those records together, or rolls back all of them. It uses no `REQUIRES_NEW`, asynchronous write, client follow-up request, or partial-success response. Existing unique constraints on `(room_id, user_id)` in `room_participants` and `room_hr_assignments` are the final one-row guard; no table, index, migration, or fourth role is added.

The shared membership/tracking write primitive SHALL be extracted or exposed inside the established room HR tracking seam and used by both the current post-creation invitation route and creation-time assignment. The creation endpoint's authorization is only its existing authenticated-owner creation authorization; it is not a new public assignment endpoint or a second client-authorized permission path. The deterministic target-user locks serialize enable/disable versus final eligibility validation. Together with the profile-row lock above, a disable that commits first rejects creation, while a creation that commits first has a target that was eligible at its commit point; neither can leave a room without the corresponding durable assignment.

An all-or-nothing request is chosen over “create room, then report some failed targets” because a room without its intended hiring managers can cause a missed interview and leaves an opaque partial state. A post-creation sequence of client calls is rejected because it creates an observable race and can leave orphan rooms if a later invitation fails.

### 4. Reuse existing room access and tracking semantics

Every target assigned at creation receives the existing interviewer-equivalent role and unique tracked association, not a new role or special owner grant. The owner stays the creator. Existing server checks continue to prevent account-admin/owner/private-note disclosure and to ensure a target that is no longer eligible at commit time is not assigned. Duplicates in a request and concurrent lifecycle events must converge to one effective membership and one tracked association per target/room.

No new realtime event is needed for creation-time assignment because a new room has no established target session. The persisted participant/assignment state is committed before it becomes observable; subsequent entry, SSE reconnect, and POST-relay authorization resolve the durable server state using the existing server-authoritative permission flow. Profile opt-out is not a room-role revocation, so it does not broadcast an artificial candidate demotion; protected cabinet/list/detail/export requests independently re-check the current stored capability and reject after opt-out. The implementation must neither assume a client-side role claim nor resurrect hiring-manager UI from a stale profile cache after opt-out.

### 5. Interaction reliability and error behavior

The room-creation submit control and profile save prevent overlapping local submissions. They do not automatically retry: a transport failure may have an unknown server outcome under the existing create semantics, so the UI must retain the draft and offer an intentional recovery path rather than silently producing duplicate rooms. Confirmed success alone changes profile state or navigates to the new room. Error feedback is accessible, uses the new terminology, avoids token/email/other-account disclosure, and does not overwrite a new account/room context with a late response.

## Risks / Trade-offs

- **A profile disable leaves an existing interviewer membership active** → The profile copy and confirmation state make clear that only hiring-manager features are disabled; ordinary room permissions remain server-enforced and unchanged.
- **An invalid target might otherwise leave a new room without intended managers** → Validate all targets in the authoritative transaction and roll back all new room/assignment persistence on failure.
- **A target changes capability while a creation request is in flight** → Lock target account rows in canonical order and validate current stored eligibility in the final transaction; profile updates lock the same row. Do not trust the original form state.
- **Terminology can drift between seldom-used feedback paths** → Cover key journeys with E2E and use a bounded static-copy audit for unvisited copy variants.
- **Client retries after a network failure can duplicate a room** → Suppress automatic retries and preserve intentional recovery; no new idempotency protocol is introduced in this scoped change.
- **Existing clients omit the new target list** → Make the field optional and preserve the existing authenticated create behavior when absent.

## Migration Plan

1. Deploy the server support for explicit profile `false` and optional `hiringManagerIds` on authenticated `POST /api/rooms`, including public-field rejection, while preserving omitted-field behavior and the unchanged `RoomResponse`/public creation compatibility.
2. Deploy the frontend wording, controlled profile toggle, and optional creation control. Old clients continue to create rooms without targets and retain legacy strings only until they update.
3. Verify profile disable/reenable, protected endpoint denial, valid/invalid multi-target creation, candidate privacy, and reconnect through the specified E2E and integration suite.
4. If the frontend must be rolled back, remove only new controls/copy; do not delete stored account flags, room memberships, or tracked associations. If server rollback is necessary, first confirm no clients require the additive target field; data created by a successful request remains a valid ordinary room with established memberships.
