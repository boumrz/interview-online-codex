## Purpose

Make the compact hiring-manager invitation preview in personal room creation faster to scan while preserving its existing accessible, privacy-safe feedback behavior.

## ADDED Requirements

### Requirement: Room-creation preview uses the exact compact hiring-manager copy

In the authenticated personal-dashboard room-creation form, the invitation-preview control SHALL use exactly `Нанимающие` as its visible label and `UUID нанимающего` as its placeholder. For each relevant preview state, the visible and accessible feedback SHALL use exactly the following supplied copy:

- pending lookup: `Проверяем нанимающего…`;
- incomplete or malformed local UUID: `Введите полный UUID нанимающего`;
- privacy-safe unavailable result: `Нанимающий не найден или недоступен`;
- retryable preview availability failure: `Не удалось проверить нанимающего. Повторите попытку.`

The form's post-submit invalid-identifier error SHALL use exactly `Некорректный идентификатор нанимающего`. These strings SHALL replace the longer `нанимающий менеджер` wording only in this room-creation preview/control and its post-submit error. The existing successful prospective-assignment message, validation/privacy classification, debounce/cancellation, retry, draft retention, submission availability, and accessible status/error semantics SHALL remain unchanged.

Pre-implementation acceptance-test level: **E2E** for label, placeholder, pending, local-validation, unavailable, retryable-preview, and post-submit error feedback in the authenticated creator journey; supplemented by a **frontend unit/source-audit exception** for exact punctuation and copy variants that are disproportionate to reach through one browser journey.

#### Scenario: Creator sees compact preview feedback

- **WHEN** an authenticated creator enters invitation UUID drafts that are pending, incomplete, unavailable, or temporarily cannot be checked
- **THEN** the room-creation form exposes the exact corresponding compact string from this requirement
- **AND** it preserves the existing draft, accessibility, privacy-safe classification, and correction behavior

#### Scenario: Creator receives an invalid identifier after submission

- **WHEN** an authenticated creator submits a room draft whose invitation identifier is rejected as invalid
- **THEN** the post-submit feedback is exactly `Некорректный идентификатор нанимающего`
- **AND** the title, selected tasks, and entered invitation draft remain available for correction under the existing create behavior

#### Scenario: A successful preview remains advisory

- **WHEN** an authenticated creator receives a successful prospective-assignment preview and creates a room
- **THEN** the existing successful preview and server-authoritative creation behavior remain unchanged apart from the compact strings in scope
- **AND** no role, cabinet, endpoint, or technical identifier is renamed by this copy change

### Requirement: Compact preview copy is scoped to room creation

The compact terms in this change SHALL be limited to the authenticated personal-dashboard invitation preview and its post-submit invalid-identifier feedback. Product copy for the account capability, existing room assignment/removal controls, hiring-manager cabinet, technical endpoint/type names, and public/guest room-creation behavior SHALL retain their established terminology and semantics. The public/guest form SHALL continue to expose neither the hiring-manager preview nor its copy.

Pre-implementation acceptance-test level: **E2E** for absence from public/guest creation and unchanged successful authenticated assignment journey; supplemented by a **frontend unit/source-audit exception** for confirming the bounded set of rendered literals without interpreting technical identifiers.

#### Scenario: Public creator does not receive preview copy

- **WHEN** a user opens the public or guest room-creation surface
- **THEN** it exposes neither the preview control nor any compact preview feedback string
- **AND** its established creation behavior is unchanged

#### Scenario: Existing role surfaces retain their terminology

- **WHEN** a user opens the profile, hiring-manager cabinet, or existing room assignment/removal controls
- **THEN** those surfaces retain their established role terminology and behavior
- **AND** the compact copy is confined to the room-creation preview/error scope
