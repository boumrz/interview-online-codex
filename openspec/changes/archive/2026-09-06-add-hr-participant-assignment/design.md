## Context

Accepted scope is recorded in `product-scope.yaml`. HR is the optional account capability `User.isHr`; room roles remain owner/interviewer/candidate. Candidate-link admission does not elevate HR. The shortcut lets a manager assign the HR account already visible among participants without UUID entry.

Exact source seams were checked: `TopBar.tsx` participant menu, `useRoomSocket.ts` server state, `RoomPage.tsx` room actions, `RoomHrController`/`RoomHrTrackingService.invite`, and `CollaborationService` participant aggregation and permission publication. `RoomRole.canGrantAccess` is owner-only; `canManageRoom` includes interviewers. Preserve that distinction.

## Goals / Non-Goals

Deliver explicit participant-menu HR assignment, feedback and durable reconnect behavior. Keep ID invitations for absent HR, ordinary owner-only interviewer controls, private-note isolation and current candidate admission. No new endpoint, role enum, database migration, library, polling, cabinet subscription or HR removal protocol. Code execution and sandbox behavior remain unchanged.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| CollaborationService | Resolve admission-time authenticated HR eligibility, aggregate and publish it; preserve current durable role mutation/publication. |
| ParticipantPayload | Add `isHr: Boolean = false` to existing participant state. |
| RoomHrController / RoomHrTrackingService | Reuse manager authorization, stored HR validation, locked atomic membership/tracking and idempotency. |
| useRoomSocket | Carry server eligibility and expose a minimal callback to its existing terminal room-unavailable transition. |
| RoomPage | Call existing mutation with selected account ID/current credentials; own request lifetime and feedback. |
| TopBar | Present HR action/status; retain separate owner-only ordinary role controls. |

## Additive participant contract

Backend `ParticipantMeta.isHr` is initialized from authenticated server-resolved `User.isHr` on admission. Anonymous participants are false. It is serialized through `ParticipantPayload.isHr` in initial SSE state and subsequent state synchronization. Frontend participant types add `isHr?: boolean`; absent/false is ineligible for backward compatibility.

Eligibility requires `isAuthenticated === true`, nonempty server-projected `userId`, and `isHr === true`. Neither display name, Yjs awareness nor client query/body fields can establish identity or eligibility. The only added public account datum is this Boolean; no email, token or unrelated profile information is exposed to room recipients.

When the existing identity aggregator groups sessions belonging to the same authenticated user, merge `isHr` with `any { it.isHr }`. HR opt-in is monotonic in this MVP, so a stale older session cannot mask a newer authenticated HR session. Guest grouping cannot confer authentication or HR eligibility. Reconnect reads current stored eligibility. Already open sessions need refresh/reconnect after profile enablement; live profile propagation is out of scope. The mutation always revalidates current stored `isHr`.

## Existing REST mutation

Reuse `useAddHrManagerMutation` with no body:

```http
PUT /api/rooms/{inviteCode}/hr-managers/{userId}
Authorization: Bearer <current account token, when present>
X-Room-Owner-Token: <when present>
X-Room-Interviewer-Token: <when present>
X-Room-Event-Token: <current session event token, when present>
```

Target `userId` comes from selected server participant state. Keep existing HTTP 200 `HrManagerDto[]` response (`userId`, `displayName`, `isOwner`), no-store behavior and RTK tags `HrManagers`/`HrInterviews`. Supported promoted guests use the current event-token path.

The existing operation locks the room, rejects archived rooms with 410, checks current manager authority, resolves the target UUID and stored HR flag, upserts interviewer membership without downgrading an owner, ensures the unique assignment, commits and publishes current durable permissions. Retain existing 403 authority denial, 404 missing room/HR and invalid-target semantics and the current error shape. Do not duplicate that path. Network failure can occur after commit; explicit retry remains safe through idempotent PUT.

A selected account may disconnect before submission completes; durable account invitation semantics still apply. A new session-target endpoint would duplicate security logic and unnecessarily require presence.

## Participant controls and capability separation

Pass a separate HR-assignment capability derived from current server `canManageRoom` into TopBar. Retain existing `canGrantAccess` for ordinary promotion/removal. Menu opening is the union of permitted ordinary actions and HR actions/status; do not broaden `canGrantAccess`.

| Target / initiating authority | Presentation |
| --- | --- |
| Eligible HR candidate; any current manager | Enabled **Назначить HR**. Owner additionally retains existing **Назначить интервьюером**. |
| Eligible HR with interviewer role | HR indicator and disabled **HR назначен** status. Existing **Снять роль интервьюера** remains owner-only. |
| Ordinary account / anonymous guest | No enabled HR action; existing ordinary controls retain their existing permissions. |
| Owner target | Preserve owner presentation and current exclusion from role changes. |
| Candidate initiating user | No assignment controls. |

The HR indicator means positive account eligibility plus current interviewer access (`isHr && role === "interviewer"`), not a separate persisted role. Ordinary HR promotion retains current tracking behavior. Demotion removes assigned status, leaves retained tracking inaccessible and allows an authorized explicit HR regrant. Non-owner managers never receive ordinary promotion/removal controls through this shortcut.

During assignment, show **Назначаем HR…** for the target, with a synchronous duplicate guard and disabled repeated action. Disable that target's ordinary role-changing control while the HR request is pending to avoid contradictory local commands. Other actors remain governed by server serialization. Show success only after confirmed response; do not optimistically assign participant roles or permissions. Report understandable retryable errors and keep feedback visible after the menu closes using the existing room feedback surface or compact accessible equivalent.

## Request lifetime and realtime reliability

- Preserve server-authoritative SSE plus POST relay. HR assignment uses existing PUT and permission publication; no new realtime event or replay channel.
- Keep current row-lock/transaction discipline. Membership plus tracking remain atomic and unique; current durable roles are reread before publication. Do not modify the bounded permission-sync executor or transaction boundaries.
- Reconnect resolves durable membership. Candidate tombstones/current-role checks outrank retained tracking, cached flags and stale grants; explicit authorized regrant can restore access.
- Scope each operation by current room, auth identity/token, manager authority/session, target user ID and a request generation. Abort active requests and invalidate completions on room/account/manager-session changes or unmount. Check context before applying any success/error/410. Losing then regaining authority must not make an old completion current again.
- Browser abort does not undo a server commit. Server state remains authoritative; late responses must never write privileges or revive controls in a new context.
- Current-context 410 calls the hook callback delegating to `terminateRoomUnavailableRef.current()`. The established transition closes SSE, drops relay/activity queues, cancels retries and displays terminal unavailable state. Ignore stale-context 410 rather than terminating another room. Do not implement a separate reconnect path.
- No automatic mutation retries or cabinet polling. One existing mutation per action; no broadcast-time account query, new unbounded queue or new latency budget. Existing transport retry and latency behavior stay unchanged.

## Data model, rollout and trade-offs

Reuse User.isHr, durable RoomParticipant(room,user,role), RoomHrAssignment(room,user), existing unique constraints and indexes. No schema/data rewrite. Cabinet/history/export still require both tracking and current durable manager authority.

Backend-first additive rollout is compatible with old clients. Missing eligibility in old server payloads hides the shortcut in new clients while retaining manual ID invitations. Reverting the shortcut preserves all stored grants/tracking. Deployment is outside this local change.

Admission-time eligibility avoids database queries during broadcasts but may omit the action until refresh/reconnect after opt-in; current server validation remains decisive. The HR badge intentionally does not identify which grant UI was used. Separate manager/owner capabilities and context-checked completions are mandatory boundaries, not cosmetic details.

## Verification and handoff

E2E-first acceptance: HR candidate-link entry stays candidate/untracked; owner uses participant action with no UUID entry; current HR gains manager controls; cabinet refresh shows one row. Cover non-owner/promoted-guest HR assignment without ordinary authority expansion, ineligible targets, pending/error/retry and demotion/reconnect/regrant/context changes proportionately. Focused integration tests justify the exception for payload provenance, multisession aggregation, current authority, stored HR validation, idempotency and archive denial. Reuse existing endpoint checks for unchanged guarantees; no broad export/performance rerun is needed for this shortcut.

Frontend owns TopBar.tsx, useRoomSocket.ts, RoomPage.tsx and required room CSS only. Root/backend owns participant projection and focused E2E/integration tests. Existing mutation implementation and database schema need no edits. Architecture is ready for Team Lead/task audit; production work still requires strict validation and recorded RED acceptance evidence. No unresolved product or technical questions remain. Responsive spacing can follow existing Mantine/CSS patterns without changing these labels or permissions.
