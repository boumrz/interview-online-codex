## Why

When a room creator pastes invitation IDs into the optional hiring-manager field, the form provides no indication whether an ID belongs to an eligible account until the entire room-creation request fails. Showing the resolved eligible manager or a privacy-safe unavailable state before submission lets the creator correct the draft without weakening the server's all-or-nothing creation validation.

## What Changes

- Add authenticated, read-only resolution of one complete hiring-manager invitation UUID for the room-creation form.
- Show each complete unique UUID in the form as resolving, eligible with its display name, or a generic “not found or unavailable” result; incomplete tokens remain unlooked-up draft text.
- Make lookup resilient to rapid edits, pasted lists, cancellation, stale responses, and loss of authentication, while keeping the create request's existing server-authoritative validation unchanged.
- Preserve the existing optional multiple-ID draft, target normalization, and all-or-nothing create behavior. No public or guest room-creation lookup or assignment is introduced.

## P0 Product Decisions and Acceptance Boundary

- This is an **advisory pre-submit preview**, not an early membership change and not a reservation. A confirmed target is shown as `Будет добавлен: {displayName}`; the actual association exists only after successful room creation.
- For a syntactically complete UUID whose server outcome is unknown, ineligible, or otherwise unavailable, the UI uses exactly one privacy-safe product outcome: `Нанимающий менеджер не найден или недоступен`. It must not reveal which case applies.
- An incomplete or malformed UUID is a local draft state. It is not sent to the server and is labelled `Введите полный UUID нанимающего менеджера`, never as a missing manager.
- Preview feedback does not disable or otherwise gate a valid room-create submission. The existing server-side, all-or-nothing validation remains the source of truth at submit time, including when a preview is pending or has become stale.
- The feature is limited to the authenticated personal dashboard. Public and guest creation retain neither the manager-ID field nor any preview request or result.

## Capabilities

### New Capabilities

- `hiring-manager-input-preview`: Privacy-safe, authenticated eligibility feedback for invitation UUIDs entered during personal-dashboard room creation.

### Modified Capabilities

- `hr-room-tracking`: Extend authenticated creation-time hiring-manager assignment with pre-submit eligibility feedback while preserving creation-time authority and atomic validation.

## Impact

- Frontend room-creation state, typed API client, and accessible form feedback.
- A new authenticated backend read-only lookup contract backed by stored account capability; public routes remain unchanged.
- Backend authorization/privacy tests and browser E2E coverage for feedback, correction, debounce/cancellation, and no public-flow exposure.
