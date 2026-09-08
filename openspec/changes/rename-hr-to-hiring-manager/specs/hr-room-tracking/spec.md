## ADDED Requirements

### Requirement: Personal-dashboard room creation can assign hiring managers

The authenticated personal-dashboard room-creation form SHALL provide an optional “Нанимающие менеджеры” control where the creator can add one or more existing account invitation UUIDs before submitting the room. Each submitted UUID SHALL be normalized and deduplicated, and each target's current stored hiring-manager capability SHALL be validated by the server at creation time. For every valid target, successful creation SHALL establish the same durable tracked association and room-local interviewer-equivalent access as the established post-creation invitation operation, without requiring target acceptance or a prior room visit. The creator remains the room owner; target accounts SHALL not receive owner-only, account-admin, or another interviewer's private-note access.

Omitting the optional control SHALL preserve the existing authenticated room-creation behavior. The public/guest room-creation path SHALL NOT expose or accept hiring-manager targets. If any supplied target is malformed, unknown, no longer has the stored hiring-manager capability, or cannot be assigned, the server SHALL reject the request without creating a partially configured room or assigning any target. The UI SHALL retain the creator's title, task, and target input, show a recoverable “not found or unavailable” validation error without unrelated account data, and allow correction and resubmission. The form SHALL show pending state and suppress overlapping local submissions; it SHALL not automatically retry a failed creation request.

Pre-implementation acceptance-test level: **E2E** for optional multi-target selection, successful creation/opening, inherited room controls, omission compatibility, and visible validation/pending/retry behavior; supplemented by a **backend integration exception** for authenticated-route enforcement, current stored eligibility, all-or-nothing persistence, deduplication, forged fields, concurrent target changes, and privacy-safe errors that cannot be reliably isolated in a browser flow.

#### Scenario: Owner creates a room with two hiring managers

- **WHEN** an authenticated user supplies a title, optional tasks, and two distinct valid hiring-manager invitation UUIDs in the personal-dashboard form and submits it
- **THEN** one new room is created and opened for its owner
- **AND** each target has the established interviewer-equivalent room access and sees exactly one tracked interview after refreshing their hiring-manager cabinet without first entering the room
- **AND** neither target receives owner-only, account-admin, or another interviewer's private-note access

#### Scenario: Owner creates a room without hiring managers

- **WHEN** an authenticated user leaves “Нанимающие менеджеры” empty and creates a room from the personal dashboard
- **THEN** room creation succeeds with the existing owner, task, and invitation behavior
- **AND** no hiring-manager membership or tracking association is created solely by omission

#### Scenario: A target is invalid or no longer eligible

- **WHEN** the creator submits a malformed, unknown, duplicate-normalized, or currently non-hiring-manager invitation UUID
- **THEN** the UI keeps the draft values, identifies the target as not found or unavailable with retryable correction feedback, and does not claim success
- **AND** the server creates neither the new room nor a membership/tracking association for any supplied target
- **AND** the response does not disclose an email address, token, or unrelated account details

#### Scenario: Public room creation tries to supply hiring-manager targets

- **WHEN** an anonymous or public/guest room-creation request supplies hiring-manager target fields directly
- **THEN** the server ignores neither authorization nor validation by silently assigning targets; it rejects the unsupported target assignment without granting room access
- **AND** existing public room creation without such fields retains its established behavior

#### Scenario: A stale or forged creation request is submitted

- **WHEN** a target disables the capability, is changed, or is forged in client request state before the creator's request commits
- **THEN** the server uses current stored target eligibility and authenticated creator identity rather than client-provided role claims
- **AND** no room is created with unintended hiring-manager membership or tracking

### Requirement: Room management controls use hiring-manager terminology

The room interface SHALL label the existing account-ID invitation, joined-participant assignment, assignment list, assigned state, and removal actions with the hiring-manager terminology defined by `hr-account-profile`. “Назначить нанимающим менеджером”, “Снять роль нанимающего менеджера”, and an equivalent clear “Нанимающие менеджеры” list label SHALL communicate the existing actions without changing who is eligible, who may act, or which room role is granted. A current stored capability is still required for assignment, and removal SHALL continue to affect room-local access rather than the target's global account capability.

Pre-implementation acceptance-test level: **E2E** for the existing ID invitation, participant assignment, assigned state, and removal flows; a focused **frontend unit/source-audit exception** is proportionate for static error and empty-state copy variants.

#### Scenario: Authorized manager assigns a hiring manager from a room

- **WHEN** an authorized room manager opens either established assignment control for an eligible account
- **THEN** the action and confirmed state use hiring-manager terminology
- **AND** the target receives only the established interviewer-equivalent room access and durable tracking after server confirmation

#### Scenario: Authorized manager removes a hiring manager from a room

- **WHEN** an authorized room manager removes an assigned non-owner through an established room control
- **THEN** the action, pending state, and success/error feedback use hiring-manager terminology
- **AND** the target's global hiring-manager capability and existing ordinary role-control authorization remain unchanged
