## Why

HR managers currently lack a durable account view of the interviews they oversee, including upcoming meetings and past results. They need to find assigned interviews without joining every room first, and download their interview records for reporting.

## What Changes

- Add an optional `Я HR-менеджер` registration checkbox backed by an independent `isHr` account flag. Do not introduce an interviewer/candidate account-type selector or change the existing user/admin role. Existing users can enable HR in their profile and copy their existing account UUID as the invitation ID.
- Add a personal HR cabinet in which one room represents one interview. Display candidate name, optional position, scheduled time, current interview state, and existing completion/verdict/comment/score results when present.
- Persist a unique association between an HR account and a room after authorized manager entry or an explicit HR invitation. Candidate participation never creates HR tracking or elevated access.
- Let any server-confirmed room owner or interviewer invite an existing HR account by UUID. Assignment grants that room's interviewer permissions immediately, supports multiple HR accounts, and appears after the invitee refreshes the cabinet; no acceptance step or live cabinet subscription is required.
- Preserve room-local authority: `isHr` alone grants neither room access nor owner privileges. HR assignments do not share another interviewer's private notes and do not disclose HR metadata through candidate payloads.
- Add manager-editable interview metadata (`candidateName`, optional `position`, optional `scheduledAt`) and preserve the first completion timestamp when a verdict is corrected.
- Preserve tracked interview history when a room is removed from active use, through the minimal compatible archiving behavior detailed by the Architect. Historical rows must identify archived rooms and retain their authorized results.
- Provide a real `.xlsx` download for the authenticated HR account's currently permitted tracked rooms. Default to all retained history; optional inclusive date filters use scheduled time, otherwise first completion time, otherwise creation time, with the date basis and timezone identified.

## Capabilities

### New Capabilities

- `hr-account-profile`: Independent HR account flag, compatible registration/profile behavior, and copyable invitation identity.
- `hr-room-tracking`: Explicit and entry-based HR associations, manager-only interview metadata, refreshable cabinet, permission boundaries, and retained interview history.
- `hr-room-export`: Server-authorized XLSX export with consistent scope, date filtering, safe cell values, and visible result/date semantics.

### Modified Capabilities

- None. The existing room owner/interviewer/candidate authority model remains intact; an HR assignment authorizes the existing room-local interviewer role.

## Impact

- Account persistence/migration, registration/profile contracts and UI, and authenticated account state.
- Room membership/authorization, lifecycle and interview metadata persistence, invitation/list/detail/export contracts, and deletion/archive behavior for tracked rooms.
- Frontend HR cabinet, profile, room invitation/metadata controls, and download feedback using the fixed React/TypeScript/RTK Query/CSS Modules/Rspack/Mantine stack.
- Backend Kotlin/Spring Boot/PostgreSQL-compatible implementation and an XLSX writer selected by the Architect; no transport-stack replacement.
- Real browser test-first acceptance, focused backend integration coverage for permissions/concurrency/migrations/workbook contents, and applicable security/reliability review.

## Scope Decisions and Boundaries

The registration correction and implementation scope are user-authorized. The root orchestrator supplied the following MVP defaults for refinement and implementation: room-based interviews, existing UUIDs, optional HR enablement for existing accounts, immediate idempotent assignments to multiple HRs, interviewer-equivalent room access without owner/private-note grants, minimal candidate/schedule metadata, existing result fields, and a date fallback for export.

This change does not add a candidate CRM, candidate deduplication across rooms, calendar integration, organizations, email invitations, invitation approval, a new account role hierarchy, live cabinet updates, or unrelated privacy cleanup. Existing room collaboration continues through server-authoritative SSE plus POST with the current Yjs sync. No historical candidate identity, planned time, or outcome may be fabricated when legacy data lacks it.
