## Why

The product currently exposes the internal term “HR” to users, and an account that has enabled the “Я HR-менеджер” flag cannot turn it off. Room creators also have to create a room first and then separately assign the people who should manage the interview.

This change makes the user-facing role understandable as “нанимающий менеджер”, makes the profile setting reversible, and lets a creator include hiring managers while creating a room from the personal dashboard.

## What Changes

- Replace user-visible “HR” terminology in the authenticated product interface with the agreed Russian hiring-manager terminology, including controls, section names, help text, success/error feedback, and accessible labels. This is a presentation terminology change; existing technical identifiers and stored account data are not renamed by this change.
- Make the self-service hiring-manager profile checkbox bidirectional: an authenticated user can save both enabled and disabled states and receives confirmed, recoverable feedback.
- Add an optional hiring-manager assignment control to the authenticated personal-dashboard room-creation form. The creator can supply one or more existing hiring-manager invitation IDs; valid selections receive the same room-local interviewer-equivalent access and durable interview tracking as the established in-room invitation flow.
- Preserve the current owner/interviewer/candidate role model, server-side authorization, candidate privacy, room archive behavior, public/guest room-creation flow, and existing post-creation hiring-manager assignment/removal controls.

## Product acceptance decisions

- **P0 — terminology:** “нанимающий менеджер” is the sole Russian product term for this account capability. Technical compatibility identifiers such as `isHr` and existing API paths are not product copy and remain out of scope.
- **P0 — reversible self-service setting:** the authenticated account owner can explicitly save either checkbox state. Opting out removes only capability-only cabinet access; it does not silently remove the account from existing rooms or erase retained interview history.
- **P0 — creation-time assignment:** the dashboard creation form supports one or more copied invitation UUIDs, including at least two distinct managers in one submission. This is justified parity with the accepted post-creation assignment capability, which already supports multiple managers: restricting creation to one would force a creator with two intended managers back into the extra post-creation workflow this change removes. The scope remains intentionally bounded to pasted UUIDs—no directory, lookup, approval workflow, bulk edit of existing rooms, new room role, or public/guest assignment.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hr-account-profile`: rename the account capability in user-facing profile/registration/cabinet language and allow its authenticated owner to disable it as well as enable it.
- `hr-room-tracking`: allow the authenticated room creator to assign existing eligible hiring-manager accounts as part of personal-dashboard room creation, with the established room-access and tracking guarantees.

## Impact

- Frontend registration, dashboard profile/cabinet, room-creation form, room participant/list controls, and their accessible feedback/copy need a consistent terminology update; UI-only test selectors remain stable unless a selector itself is user-facing.
- The authenticated room-creation request and server transaction require an additive target-account list and server-derived validation/assignment. Existing room HR routes and persisted `isHr` data remain compatibility inputs rather than a public product vocabulary.
- Account-profile mutation behavior and protected hiring-manager cabinet operations need security and regression coverage for disabling a capability, stale authenticated state, and direct forged calls.
- Browser E2E acceptance covers all user-observable paths; focused backend integration tests cover authorization, atomicity, validation, and persistence boundaries that cannot be established solely in a browser journey.
