## Context

`Room.currentStep` is a server-authoritative, persisted pointer. It also selects the active code, language, briefing, and Yjs synchronization key, so treating it as an interviewer-private value would corrupt the shared workspace. Today every manager task-row click sends `set_step`, which changes that pointer and broadcasts a full room state to all participants.

The new interaction must let owners and interviewers inspect/select a task independently while preserving one clearly marked task that is active for everyone, including candidates.

## Goals / Non-Goals

**Goals:**

- Allow every manager to select a task locally without emitting a room event or changing `Room.currentStep`.
- Provide an explicit manager-only action that publishes the locally selected task to the room through the existing authorized `set_step` event.
- Clearly distinguish local selection from the room-wide active task in the manager task list and provide stable E2E selectors.
- Preserve a manager's valid local selection when another interviewer publishes a room-wide task.

**Non-Goals:**

- Give candidates independent task navigation or publication controls.
- Make code, language, briefing, ratings, or Yjs documents independently editable per interviewer while another task is active for the room.
- Persist a private interviewer selection across a full page refresh or create a new database/realtime protocol for it.

## Decisions

### Keep `Room.currentStep` as the global published pointer

The backend model, REST response, SSE payload, and `set_step` authorization remain unchanged. The explicit “show this step to everyone” control is the only frontend path that calls `sendSetStep`; its existing server-side `canManageRoom` authorization continues to protect the action.

This avoids a migration and prevents a local click from resetting the shared Yjs/code context.

### Store manager selection in frontend state only

`RoomPage` will keep a manager-local selected-step state in session storage, seeded from the received global step only when there is no valid stored selection. A normal task-row click updates only this state. The manager UI will show a local working-step title/preview for that selection, while the shared editor and other room-wide mutable controls remain bound to the published global task.

An incoming room-wide state update changes the global marker and shared workspace but does not overwrite another manager's valid local selection. If tasks are deleted or reindexed and the stored local step is no longer valid, the client falls back to the published step. A refresh restores a valid session selection.

### Render separate local and global task-list states

Each manager task row exposes `data-testid="room-step-row-{stepIndex}"` and a local-selection data attribute. The unique room-wide row contains `data-testid="room-global-active-step-{stepIndex}"` with accessible text “Активно для всех”. A separate `room-publish-step` button, labelled “Показать этот шаг всем”, publishes the current local selection and is unavailable to candidates.

The prior single active styling is split so the local selection remains clear without obscuring the global marker.

### Use browser E2E as the first acceptance test

Create a Playwright script with an owner, a granted interviewer, and a candidate. It verifies two different local selections leave REST/SSE `currentStep` and other visitors unchanged, then verifies an explicit publication synchronizes every browser and moves the global marker. The test fails before implementation because selection currently sends `set_step` and the new controls/markers do not exist.

## Risks / Trade-offs

- **A local preview could be mistaken for an independently editable workspace.** → Label the local selected task clearly and keep shared editor/briefing mutations tied to the room-wide active task.
- **A remote publication may leave a manager viewing an unexpected task.** → Keep the local-preview label and global-active marker visible at the same time; only fall back when the selected task is no longer valid.
- **The existing global `set_step` test semantics could be accidentally removed.** → Preserve and run API/SSE coverage for explicit publication in addition to the new browser E2E.
- **Candidates could discover the publish control by direct event call.** → The backend authorization remains unchanged and is covered by existing role tests.

## Migration Plan

1. Add the failing browser E2E and the dedicated frontend script.
2. Implement manager-local selection, task-list marker, and explicit publish control without changing backend contracts.
3. Verify the targeted E2E, existing global step API/SSE regression, typecheck, and backend tests.

Rollback is a frontend revert: the existing backend `set_step` contract and persisted room state remain compatible.

## Open Questions

- None for this increment. Independent editing of a non-published task requires per-step document isolation and is intentionally deferred.
