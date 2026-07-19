## Why

The first version of independent interviewer task selection makes the distinction between a selected task and the room-wide task technically clear, but the persistent preview card, borders, and explanatory copy make the room panel feel heavy and use unfamiliar language. Interviewers need to recognise the active step and intentionally change it without reading interface instructions.

## What Changes

- Replace the room-wide marker text with the concise, state-focused label `Активен`.
- Remove the bordered local-selection preview card, its repeated selected-task title, and its explanatory text.
- Keep the interviewer’s local selection visible through the task-row selection state without a new border treatment.
- Use concise HR-oriented wording: `Шаг N из M` for the list context and `Сделать активным` for the explicit room-wide action.
- Keep the room-wide action available only to owners and interviewers, and retain the existing candidate restrictions and server-authoritative publication behaviour.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `independent-interviewer-step-navigation`: refine the manager task-list presentation and publication control labels while preserving independent selection and explicit room-wide publication.

## Impact

- Affected code: `frontend/src/pages/RoomPage.tsx`, `frontend/src/pages/RoomPage.module.css`, and the focused browser E2E.
- No backend, API, persistence, realtime-protocol, or permission changes.
- UX research basis: Greenhouse, Ashby, and Workable consistently frame interview work as a plan with stages, reserve concise labels for the current/active stage, and use direct move-to-stage actions rather than persistent explanatory cards.
