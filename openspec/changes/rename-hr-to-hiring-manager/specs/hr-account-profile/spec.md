## MODIFIED Requirements

### Requirement: HR registration is an optional independent checkbox

Registration SHALL offer one optional, initially unchecked checkbox labelled “Я нанимающий менеджер” and persist its boolean account-capability value as `isHr`. Omission SHALL be equivalent to `false`. Registration SHALL NOT add an interviewer/candidate account-type selector. The existing user/admin account role, registration validation, authentication, and anonymous candidate invitation behavior SHALL retain their established semantics. A client-supplied hiring-manager value SHALL NOT authorize account-admin authority or room-manager authority.

Pre-implementation acceptance-test level: **E2E**, supplemented by a **backend integration exception** for omitted-field compatibility and forged authority fields, which cannot be fully verified through normal registration controls.

#### Scenario: User registers with HR enabled

- **WHEN** a new user submits otherwise valid registration with “Я нанимающий менеджер” selected
- **THEN** the authenticated account has `isHr: true` and can reach its hiring-manager cabinet
- **AND** the account retains the ordinary registration role without automatic authority in any room

#### Scenario: Existing registration callers omit the HR field

- **WHEN** valid registration omits `isHr` or the user leaves the hiring-manager checkbox unchecked
- **THEN** registration succeeds with `isHr: false`
- **AND** the interface provides no interviewer/candidate account-type selection

### Requirement: Existing users can enable HR in their own profile

An authenticated account SHALL be able to enable or disable its own hiring-manager capability through a profile checkbox labelled “Я нанимающий менеджер”. The saved boolean SHALL be reflected in the current authenticated UI and retained after reload and subsequent login. Only the authenticated account's own profile SHALL be changed by this operation; account identifiers or capability values in a forged request SHALL NOT redirect the update to another user. Enabling or disabling the capability SHALL NOT retroactively change the account's user/admin authority, room owner/interviewer/candidate memberships, candidate-only participation, interview content, or retained tracking history.

When the account disables the capability, the current UI SHALL remove its hiring-manager-only navigation and cabinet access after confirmed save, and protected hiring-manager cabinet/list/detail/export operations SHALL be denied from the server using the current stored value. The account's stable invitation UUID SHALL not be reallocated. A failed update SHALL preserve the last server-confirmed checkbox state, communicate an understandable retryable error, and SHALL NOT falsely remove or restore protected UI access.

Pre-implementation acceptance-test level: **E2E** for the checked and unchecked profile flow, current UI change, reload/login persistence, and recoverable failure; supplemented by a **backend integration exception** for self-only update enforcement, direct protected-operation denial, and preservation of room memberships/history, which cannot be fully verified through normal profile controls.

#### Scenario: Existing interviewer enables HR

- **WHEN** an existing account without the capability selects “Я нанимающий менеджер”, saves, and reloads
- **THEN** the account can open the hiring-manager cabinet with its existing identity
- **AND** its existing account authority, room roles, and candidate-only participation remain unchanged

#### Scenario: A hiring manager disables the capability

- **GIVEN** an authenticated account currently has the hiring-manager capability enabled
- **WHEN** that account clears “Я нанимающий менеджер” and the save succeeds
- **THEN** the confirmed authenticated UI no longer exposes the hiring-manager cabinet or capability-only controls after reload or later login
- **AND** the protected cabinet/list/detail/export operations are denied while its pre-existing room roles, room content, and tracking history remain unchanged

#### Scenario: Profile save fails while changing the capability

- **WHEN** an authenticated account saves either checkbox transition and the request fails
- **THEN** the UI retains the last confirmed state, shows understandable retryable feedback, and does not claim that the transition succeeded

#### Scenario: A user attempts to enable another account

- **WHEN** an authenticated user submits another user's identity or a forged capability value to the profile update operation
- **THEN** the operation does not modify that other account
- **AND** protected hiring-manager operations continue to use the stored capability of the authenticated account

### Requirement: HR invitation identity is the existing account UUID

For an account whose hiring-manager capability is enabled, the profile and hiring-manager cabinet SHALL show a copyable invitation ID equal to the account's existing UUID. The ID SHALL remain stable across reload, login, capability enablement, and capability disablement; disabling the capability SHALL hide capability-only invitation controls without allocating a replacement ID. Copying SHALL provide visible success or recoverable failure feedback. The displayed ID SHALL NOT contain an authentication token, room invitation secret, email address, or newly allocated alternate identity.

Pre-implementation acceptance-test level: **E2E** for visible identity and copy feedback; browser clipboard interaction can use the browser test runner's clipboard permission support.

#### Scenario: HR copies the invitation ID

- **WHEN** an enabled hiring manager activates the copy control on the visible ID
- **THEN** the copied value equals the authenticated account UUID
- **AND** the UI confirms copying, or explains failure while keeping the ID selectable

#### Scenario: Capability state changes without changing the invitation identity

- **WHEN** an account enables, disables, and later enables its hiring-manager capability
- **THEN** the invitation ID shown when enabled remains its original account UUID
- **AND** no token, email address, or alternate identifier is exposed

### Requirement: HR features remain independent from candidate participation

An account marked as a hiring manager SHALL remain able to participate as a candidate under the existing room-local admission rules. Candidate-only participation SHALL NOT add a room to that user's hiring-manager cabinet, permit hiring-manager metadata access, or unlock manager controls. The stored capability SHALL be resolved from authenticated server-side account data for protected hiring-manager operations rather than trusted from client state.

Pre-implementation acceptance-test level: **E2E**, supplemented by a **backend integration exception** for forged `isHr` and direct protected-operation attempts.

#### Scenario: HR participates as a candidate

- **WHEN** a hiring-manager account joins a room with candidate-only authority and no authorized manager association
- **THEN** that room does not appear in the account's hiring-manager list
- **AND** the participant retains candidate controls and receives no hiring-manager interview metadata

#### Scenario: Non-HR client claims HR capability

- **WHEN** an authenticated account without the capability forges client state or request fields claiming `isHr: true`
- **THEN** protected hiring-manager list and export operations remain denied

## ADDED Requirements

### Requirement: Hiring-manager terminology is consistent in account-facing interface

The authenticated product interface SHALL use “нанимающий менеджер” and its grammatically necessary Russian forms for the account capability in registration, profile, invitation-ID/copy feedback, dashboard navigation and cabinet, room-creation form, and room assignment/removal controls. It SHALL NOT display “HR”, “HR-менеджер”, “HR-функции”, or “HR-кабинет” as the product-facing name for this capability. Existing user/admin and owner/interviewer/candidate role names SHALL remain unchanged. This terminology requirement applies to visible labels, help text, empty/loading/error/success feedback, titles, and accessible names; internal persistence, API-route, telemetry, test-only, and source-code identifiers are outside this presentation requirement.

Pre-implementation acceptance-test level: **E2E** for the registration, profile, cabinet, room-creation, and room-manager journeys; a focused **frontend unit/source-audit exception** is proportionate for exhaustively checking static user-facing copy variants that cannot all be reached in one browser journey.

#### Scenario: User encounters the capability in the authenticated interface

- **WHEN** a user opens the relevant registration, profile, cabinet, personal room-creation, or room-management surface
- **THEN** each visible capability label and accessible control uses the agreed hiring-manager terminology
- **AND** existing user/admin and owner/interviewer/candidate labels retain their established meaning

#### Scenario: Hiring-manager action returns feedback

- **WHEN** an enable, disable, copy, assign, remove, or room-creation action succeeds or fails
- **THEN** its visible feedback uses hiring-manager terminology where it identifies this capability
- **AND** a recoverable failure still offers the established retry path without exposing credentials or unrelated account data
