## Purpose

Let an authenticated creator explicitly verify and select each hiring person
for a new room, so the creator can see who has been added before submitting
the server-authoritative room-create request.

## ADDED Requirements

### Requirement: Authenticated room creation uses an explicit single-ID hiring picker

The personal authenticated dashboard's room-create form SHALL replace its
multi-line/delimited hiring-ID textarea with one text input labelled exactly
`ID нанимающего`, placeholder `UUID нанимающего`, description `Введите ID
нанимающего и нажмите «Добавить».`, and a button named exactly `Добавить`.
The input accepts one invitation UUID at a time. Activating `Добавить` or
pressing Enter in that input SHALL start the add workflow and SHALL NOT submit
the surrounding room form.

The picker SHALL locally validate and canonicalize the one UUID according to
the existing authenticated room-create rule before a network request. On a
valid, not-yet-selected UUID, it SHALL use the existing authenticated,
read-only, single-ID preview operation to determine current eligibility. While
that operation is pending, the input and add button SHALL be disabled and the
form SHALL expose exactly `Проверяем нанимающего…` through an accessible
status region. The picker SHALL not batch, search, enumerate, or otherwise
expose a directory capability.

When the operation confirms an eligible target, the picker SHALL append that
canonical UUID once to a visible list headed exactly `Добавленные
нанимающие`, clear the input, and announce exactly `Нанимающий добавлен:
{displayName}`. Each item SHALL visibly show its display name and expose a
button labelled exactly `Удалить` whose accessible name is exactly `Удалить
нанимающего {displayName}`. Removing an item SHALL update only the local
draft, immediately and without a network request; it SHALL not restore the
old text to the input or alter an existing room.

Pre-implementation acceptance-test level: **E2E** for input/add/Enter,
pending, success, clearing, visible selected list, remove, and eventual
room-create submission; supplemented by a **backend integration exception**
for direct authenticated preview/create authorization and canonical payload
assertions that are not safely inferred from browser rendering.

#### Scenario: A creator adds two eligible people one at a time

- **WHEN** an authenticated creator enters an eligible invitation UUID and
  activates `Добавить`, then repeats this with a second eligible UUID
- **THEN** each request displays `Проверяем нанимающего…`, then appends exactly
  one named item under `Добавленные нанимающие`
- **AND** the input clears only after each successful append, accepts the next
  ID, and the room is not created or assigned before the creator submits the
  room form

#### Scenario: Keyboard add does not create the room

- **WHEN** an authenticated creator presses Enter in a valid picker input
- **THEN** the picker performs the same one-ID verification/add flow as
  `Добавить`
- **AND** the surrounding create action is not invoked until the creator
  explicitly activates `Создать и открыть`

#### Scenario: A selected person is removed before submission

- **WHEN** the creator activates `Удалить нанимающего {displayName}` for a
  selected item
- **THEN** that item immediately disappears from the local selected list
- **AND** no membership, tracked association, preview write, or room mutation
  occurs, and no longer appears in the subsequent create payload

### Requirement: Picker feedback is recoverable, private, and deduplicated

The picker SHALL retain the typed input and append no list item in each of
the following exact feedback cases:

- blank add attempt: `Введите ID нанимающего`;
- incomplete or malformed UUID: `Введите полный UUID нанимающего`;
- canonical UUID already selected, including case variants: `Этот нанимающий
  уже добавлен`;
- unknown, ineligible, unavailable, or otherwise unusable preview target:
  `Нанимающий не найден или недоступен`;
- transport, throttling, or unexpected preview failure: `Не удалось
  проверить нанимающего. Повторите попытку.`.

Blank, malformed, and duplicate input SHALL not invoke the preview operation.
Unknown and ineligible targets SHALL remain observationally indistinguishable
and expose no display name, role/eligibility classification, email, nickname,
credential, room data, or other account information. The creator can correct
or retry the same visible input via `Добавить` without losing room title,
selected tasks, or previously selected people. At most one selected item and
one active request exist per canonical UUID.

A late response for a changed authentication context, route/page instance,
unmounted picker, or obsolete request SHALL be ignored: it MUST NOT append a
person, clear a current input, restore removed data, or replace current
feedback. No preview result is an authorization cache.

Pre-implementation acceptance-test level: **E2E** for invalid, unavailable,
transient failure/retry, case-duplicate, correction, and obsolete-response
states; supplemented by a **backend integration exception** for uniform
unavailable responses, request parsing, privacy headers, no-write behavior,
and direct authorization boundaries.

#### Scenario: An invalid or unavailable ID is corrected

- **WHEN** the creator attempts malformed or unavailable ID input
- **THEN** the picker shows exactly its corresponding feedback, keeps that
  input for correction, and adds nobody
- **AND** a corrected eligible ID can subsequently be added without losing
  other room-draft data

#### Scenario: A duplicate does not add or look up twice

- **WHEN** a creator attempts to add a case-varied version of a selected
  canonical UUID
- **THEN** the picker shows exactly `Этот нанимающий уже добавлен`, retains the
  input, and has only one selected item for that UUID
- **AND** no new preview request, membership, tracked association, or room is
  created

#### Scenario: A stale verification cannot alter the current draft

- **WHEN** a preview response completes after the picker is unmounted or its
  authenticated/page/request generation is no longer current
- **THEN** the response cannot append an item, clear an input, restore a
  removed selection, or expose a stale name/error
- **AND** it does not create persistent or realtime state

### Requirement: Only the server can create hiring assignments

The picker is available only on the authenticated personal dashboard. The
public/guest room-create UI SHALL render neither the picker nor a preview
result. On explicit room submission, the browser SHALL send the unique
canonical IDs represented by the current selected list using the existing
`hiringManagerIds` field; it SHALL send no stale, typed-but-unadded, removed,
or preview-pending ID.

The picker itself SHALL not create any room, membership, tracked association,
profile change, analytics event, or SSE/realtime event. The established
server-authoritative room-create operation SHALL revalidate every submitted
ID, including a target that was eligible at preview time but changed before
commit. A rejection SHALL leave the room draft available for correction and
use the compact privacy-safe server error `Указанный нанимающий не найден или
недоступен` for that existing unavailable condition. Picker input, add, and
remove controls SHALL be disabled while a room-create request is submitting.
Existing protected preview/create authentication and public direct-request
rejection continue to apply.

Pre-implementation acceptance-test level: **E2E** for authenticated-only
visibility, selected-payload submission, and stale-eligibility correction;
supplemented by a **backend integration exception** for forged/public direct
requests, atomic revalidation, no preview writes, and unchanged authorization.

#### Scenario: Server revalidation defeats a stale preview

- **WHEN** a creator has selected a previously eligible person and that person
  becomes ineligible before room creation commits
- **THEN** the server creates no partial room/assignment and returns its
  compact privacy-safe unavailable error
- **AND** the creator retains title, tasks, and selected draft items to
  correct the request

#### Scenario: Guest creation has no hiring picker

- **WHEN** a public or guest user opens its established room-create surface or
  directly supplies an unsupported hiring-target field
- **THEN** the UI contains no picker/list/preview and the server retains its
  existing public-request rejection behavior
- **AND** no target is exposed or assigned
