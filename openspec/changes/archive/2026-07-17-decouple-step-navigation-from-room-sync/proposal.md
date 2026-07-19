## Why

An interviewer's normal task selection currently writes the single room-wide step immediately, interrupting every interviewer and the candidate. Interviewers need to inspect and prepare another task independently, then deliberately choose when to show that task to every visitor in the room.

## What Changes

- Separate an interviewer's local task selection from the room-wide active task.
- Keep the persisted room step as the authoritative task shown to all visitors, and change it only through a distinct, interviewer-only “show to everyone” action.
- Render two clear manager states in the task list: the task selected locally by that interviewer and the task currently active for everyone in the room.
- Preserve candidates' existing behaviour: they follow only the room-wide active task and cannot select or publish another task.
- Add a browser E2E acceptance test covering two independent interviewers, a candidate, local selections, explicit publication, and the active-for-everyone marker.

## Capabilities

### New Capabilities

- `independent-interviewer-step-navigation`: Defines private interviewer task selection and explicit publication of the room-wide active task.

### Modified Capabilities

- None.

## Impact

- Frontend room navigation, task-list presentation, editor/briefing selection rules, and client realtime event dispatch.
- The existing server-authoritative `set_step` event remains the room-wide publication mechanism; its authorization and persistence semantics must remain intact.
- Browser E2E coverage and the frontend E2E command list.
