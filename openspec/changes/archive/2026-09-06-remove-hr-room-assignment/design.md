## Context

See proposal.md for motivation and `specs/hr-room-tracking/spec.md` for acceptance. The accepted baseline already treats the durable candidate role as stronger than automatic HR tracking and denies cabinet/export access after demotion. The coordinating agent supplied the implementation constraints below; the Architect confirms technical detailing before production work.

## Goals / Non-Goals

**Goals:** expose explicit removal in both existing surfaces, use current server authority, retain durable candidate precedence, and synchronize permission loss to active sessions.

**Non-Goals:** global account HR changes, a new HR role enum, new schemas/dependencies/transports, cabinet subscriptions, ordinary non-HR permission expansion, physical deletion of retained interview history, or rewriting the prior HR assignment work.

## Decisions and constraints supplied for architecture handoff

- Add `DELETE /api/rooms/{inviteCode}/hr-managers/{userId}` alongside the existing assignment endpoint, returning 204 with no body on success, including self-removal. After the room lock and current-manager check (including supported promoted guests), resolve the canonical target UUID. A malformed target UUID returns 404 only after current caller authorization; an unauthorized caller receives 403 regardless of malformed target input. Owner targets return 403 regardless of the HR flag. Unknown/non-HR/unrelated targets return 404; archived mutations return 410 under existing authorization rules. Avoid unrelated identity disclosures.
- Route removal through `mutateRoomPermissions`, the room row lock, and current role/state synchronization without an additional `@Transactional` wrapper around the facade. Assignment, removal, and entry must respect serialized durable membership. Either an existing room participant or retained HR association establishes the target's room relationship: existing HR interviewer membership is sufficient even before automatic tracking finishes. If only the retained association exists, create the durable candidate override; if neither exists, return 404 without creating membership. Keep the tracking association. Do not delete membership: removing the durable candidate override could permit automatic manager restoration. Reuse existing storage and access filtering instead of introducing a separate revocation model.
- A target already persisted as candidate is an idempotent success for a caller who still has manager authority. An unrelated target must not acquire membership. Self-removal succeeds once; a retry from the now-candidate is 403 because current authorization precedes idempotency. Explicit later assignment can restore access; automatic tracking cannot.
- Reuse participant identity/HR eligibility projected by the server and the existing assignment list for offline targets. Show “Снять роль HR” for assigned non-owners, retain ordinary role restrictions, and show pending/error feedback without optimistic role grants or stale context writes. The target's active tabs must apply the confirmed candidate state and clear manager-only/private views using the existing permission-loss flow.
- Keep existing tracking/history rows subject to current permission filtering. Removal is not account HR deactivation and is not deletion of room content. Verify cabinet list/detail/export omission or denial after removal rather than changing export or archive contracts.

## Risks / Trade-offs

- Concurrent grant, removal, or auto-entry could restore stale rights → share existing serialized permission mutation and test ordering and durable candidate precedence.
- An active or cached target session could retain manager/private views → verify permission sync in all connected target sessions and deny subsequent privileged reads/writes on the server.
- UI capability changes could broaden ordinary interviewer demotion → branch only for the explicit HR removal operation and retain regression coverage for non-HR controls.
- Retained tracking is not visibly deleted → existing cabinet/detail/export authorization must continue to filter it; explicit reassignment reuses the original unique association.

## Migration Plan

No schema/data migration or dependency change. Deliver the server endpoint with frontend callers in the existing release path. A frontend rollback removes the new controls while leaving persisted candidate memberships and server authorization intact; never roll back by deleting those memberships.

## Acceptance and handoff

Before production code, author and run E2E coverage red for the joined participant removal and offline manager-list removal, with role/cabinet/reconnect consequences. Add focused backend integration tests red for authorization, self-removal, retries, owner/archive/non-HR boundaries, durable state, private access, and concurrent ordering. Use these exceptions for server-only or transactional invariants; keep the visible flows E2E.

No unresolved product questions in the coordinating scope. Product Owner confirms scope/value; Architect confirms the supplied permission/response/sync constraints; Team Lead checks task ownership and order; Prompt/Task Auditor gates execution. Solution Reviewer and Security/Reliability review the final permission and realtime implementation.
