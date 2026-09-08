## Why

A candidate can have the account-level HR checkbox enabled, and an accidental room HR assignment must be reversible. Managers need an explicit way to remove that room access, including when the target is offline, without changing the account's global HR status.

## What Changes

- Add “Снять роль HR” for assigned non-owner HR accounts in the participant menu and the existing “Кандидат и HR” manager list.
- Allow every current room manager, including a supported promoted guest interviewer, to remove an assigned HR or themselves; preserve existing controls for ordinary non-HR interviewers.
- Persist candidate membership, revoke room manager/private/cabinet/export access, and synchronize the confirmed role to active sessions. Reconnect and automatic tracking must not restore access; a later explicit authorized assignment may restore it.
- Add a server-authorized, idempotent room HR removal operation, with owner protection, archive denial, and conflict coverage.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hr-room-tracking`: explicit removal controls and durable room-local HR revocation, preserving the global HR flag and existing retained-history authorization rules.

## Impact

- Frontend participant actions, the existing manager list, RTK Query room HR mutation, and confirmed permission state.
- Backend HR assignment controller/service and the existing room permission mutation/synchronization path.
- Add `DELETE /api/rooms/{inviteCode}/hr-managers/{userId}`; no schema, dependency, room-role enum, transport, or account-profile change.
- E2E acceptance before production code, supplemented by backend integration coverage for authorization, persistence, idempotency, and races.
