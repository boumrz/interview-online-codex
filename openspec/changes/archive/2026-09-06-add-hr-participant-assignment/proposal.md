## Why

An HR account that enters through a candidate invitation link correctly remains a candidate, but assigning that person as HR currently requires copying their account UUID into a separate invitation form. A room manager should be able to assign the visible, already joined HR participant directly from the participant menu.

## What Changes

- Add an explicit “Назначить HR” action beside the existing interviewer action for joined, authenticated HR accounts.
- Use the participant's server-confirmed account identity; the manager does not enter or copy an ID.
- Apply the existing HR invitation behavior: durable interviewer access and one tracked interview, visible on the HR cabinet's next manual refresh.
- Provide understandable pending, success/already assigned, and retryable error states, preserving server authority across demotion, reconnect, and concurrent actions.
- Preserve the HR account checkbox, room-local candidate/interviewer roles, candidate-link admission, ordinary interviewer assignment, and the existing ID invitation form for absent HR accounts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hr-room-tracking`: Assign an eligible, joined HR directly from participant controls while retaining existing authorization, tracking, and privacy requirements.

## Impact

- Backend participant projection exposes minimal server-confirmed HR eligibility; the existing HR assignment operation continues to validate the stored account and room-manager authority.
- Frontend participant menu, room action handling, and realtime participant types gain the direct assignment flow.
- Focused browser acceptance and backend integration tests cover the new flow, eligibility, authorization, and durable revocation behavior.
- No new account role, room-role enum, schema migration, library, export behavior, or cabinet subscription is required by this change.

## Scope boundaries

This is a shortcut for assigning an existing HR account, not automatic promotion on a candidate link. It does not enable HR on another user's account, add anonymous HR accounts, introduce a global interviewer/candidate choice, or remove the ID invitation flow. Interviewer demotion remains the existing way to remove manager access; retained HR tracking does not restore access.
