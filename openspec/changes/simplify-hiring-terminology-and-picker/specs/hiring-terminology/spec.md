## Purpose

Use one compact, natural Russian name for the hiring role across every product
surface and API error, without changing the role's existing data model,
permissions, or technical contracts.

## ADDED Requirements

### Requirement: User-visible Russian role copy uses only «нанимающий» variants

Every user-visible Russian phrase in the authenticated or public frontend and
every backend-produced API `error` message that currently names the hiring
role as «нанимающий менеджер» SHALL instead use the grammatically appropriate
form of «нанимающий». This includes registration/profile controls, dashboard
and cabinet headings, invitation-ID help/copy feedback, room participant
controls, assignment/removal progress and failures, candidate-and-hiring
dialogs, empty states, notifications, and room-create errors. The resulting
copy SHALL have no user-visible Russian occurrence of the noun phrase
`нанимающий менеджер` in any grammatical form.

Required examples include: `Нанимающий`, `Я нанимающий`, `Кабинет
нанимающего`, `ID нанимающего`, `Кандидат и нанимающие`, `Назначить
нанимающим`, `Снять роль нанимающего`, `Нанимающие пока не добавлены`,
`Требуется профиль нанимающего`, and `Нанимающий с таким ID не найден`.
Existing messages that include a role name SHALL retain their former outcome,
actor, privacy classification, and actionable meaning after this grammatical
substitution.

This requirement applies only to product/API text. It SHALL NOT rename
technical route/class/type/property names such as `hiringManagerIds`,
`HiringManagerPreview`, `isHr`, or `hr`, nor rewrite user-entered display
names or historical data values. HTTP statuses, JSON keys, response fields,
authorization decisions, tracking/membership side effects, and realtime
behavior remain unchanged.

Pre-implementation acceptance-test level: **E2E** for representative
user-observable profile, dashboard, room-assignment/removal, cabinet/dialog,
and create-error surfaces; supplemented by a **source-copy audit exception**
for exhaustive literal coverage across all frontend render paths and
backend-produced API errors, which cannot proportionately be traversed in one
browser journey. A **backend integration exception** verifies compact error
bodies while retaining status, privacy, and authorization semantics.

#### Scenario: A user sees compact role wording in profile and room controls

- **WHEN** an eligible authenticated user opens the profile, then a room's
  participant controls and candidate/hiring dialog
- **THEN** each visible role label/action/result uses an appropriate
  `нанимающий` form and no visible phrase says `нанимающий менеджер`
- **AND** the established controls, participants, and permissions are
  otherwise unchanged

#### Scenario: A protected API rejects an unavailable hiring target

- **WHEN** an authenticated client submits an unknown, ineligible, or stale
  hiring-target ID to an established protected preview, invitation, or
  room-create operation
- **THEN** its existing status and privacy semantics are preserved
- **AND** any role-naming `error` uses the compact `нанимающий` form with no
  target detail that the previous response did not expose

#### Scenario: Technical contracts remain stable despite copy changes

- **WHEN** the browser adds a target or creates a room using existing
  hiring-target APIs
- **THEN** endpoint paths, JSON key names, canonical UUID normalization,
  authorization checks, and response data shape remain compatible
- **AND** only visible Russian copy changes
