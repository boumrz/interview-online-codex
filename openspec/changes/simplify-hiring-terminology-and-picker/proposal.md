## Why

The product currently presents the same role to Russian-speaking users as
«нанимающий менеджер». The requested name is the shorter role noun
«нанимающий» in the grammatically appropriate form. The authenticated
room-creation form also asks creators to paste a free-form, multi-line list
of UUIDs, which makes it hard to tell which people have actually been added
to the room draft.

## What Changes

- Replace every user-visible Russian occurrence of the role phrase
  «нанимающий менеджер» in the frontend and every API error body with the
  grammatically appropriate form of «нанимающий». This includes profile,
  cabinet, room controls, notifications, dialogs, labels, empty states, and
  server-returned error messages.
- Replace the authenticated personal dashboard's multi-line hiring-ID draft
  field with one `ID нанимающего` input and an `Добавить` action. A valid,
  eligible ID is resolved before it is appended to a visible, removable draft
  list beneath the input; it is not assigned to a room until room creation
  succeeds.
- Preserve the existing authenticated, one-ID preview endpoint, UUID rule,
  privacy-safe unavailable result, server-authoritative room creation, room
  permissions, and public/guest restrictions. Technical API paths,
  TypeScript/Kotlin identifiers, payload field names, persistence schema, and
  `isHr` storage names remain unchanged.

## Capabilities

### New Capabilities

- `hiring-terminology`: Consistent compact Russian product and API-error copy
  for the hiring role.
- `room-hiring-picker`: Explicit add/verify/remove draft picker for
  authenticated personal room creation.

### Modified Capabilities

- `hr-account-profile`: Its user-facing role copy changes from the longer
  phrase to «нанимающий» variants; account capability semantics do not
  change.
- `hr-room-tracking`: Its user-facing room/cabinet/invitation copy changes
  from the longer phrase to «нанимающий» variants; tracking and authorization
  semantics do not change.

## Impact

- Frontend: visible Russian copy must be audited across product surfaces;
  `CreateRoomSection` and its dashboard state must move from a delimited text
  draft to a verified selection list.
- Backend: existing error texts and their integration expectations require
  the compact terminology, while statuses, headers, payload shape, endpoint
  names, and authorization remain stable.
- Tests: browser E2E covers the visible picker and representative global
  surfaces; an exact source-copy audit detects any remaining old
  user-visible literal; backend integration tests cover unchanged protected
  preview/create semantics and renamed error bodies.
- No migration, realtime event, public API schema, or permission expansion is
  proposed.
