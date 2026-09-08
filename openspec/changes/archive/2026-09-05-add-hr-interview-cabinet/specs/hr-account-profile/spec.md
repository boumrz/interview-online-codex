## Purpose

Let an account enable HR interview-management features without changing its existing account authority or its role in any interview room.

## ADDED Requirements

### Requirement: HR registration is an optional independent checkbox

Registration SHALL offer one optional, initially unchecked HR checkbox and persist its boolean value as `isHr`. Omission SHALL be equivalent to `false`. Registration SHALL NOT add an interviewer/candidate account-type selector. The existing user/admin account role, registration validation, authentication, and anonymous candidate invitation behavior SHALL retain their established semantics. A client-supplied HR value SHALL NOT authorize account-admin authority or room-manager authority.

Pre-implementation acceptance-test level: **E2E**, supplemented by a **backend integration exception** for omitted-field compatibility and forged authority fields, which cannot be fully verified through normal registration controls.

#### Scenario: User registers with HR enabled

- **WHEN** a new user submits otherwise valid registration with the HR checkbox selected
- **THEN** the authenticated account has `isHr: true` and can reach its HR cabinet
- **AND** the account retains the ordinary registration role without automatic authority in any room

#### Scenario: Existing registration callers omit the HR field

- **WHEN** valid registration omits `isHr` or the user leaves the checkbox unchecked
- **THEN** registration succeeds with `isHr: false`
- **AND** the interface provides no interviewer/candidate account-type selection

### Requirement: Existing users can enable HR in their own profile

An authenticated account SHALL be able to enable its own HR features through the profile. The saved flag SHALL be reflected in the current authenticated UI and retained after reload and subsequent login. Only the authenticated account's own profile SHALL be changed by this operation; account identifiers in a forged request SHALL NOT redirect the update to another user. Enabling HR SHALL NOT retroactively treat candidate participation as managed interviews.

Pre-implementation acceptance-test level: **E2E**, supplemented by a **backend integration exception** for cross-account update denial.

#### Scenario: Existing interviewer enables HR

- **WHEN** an existing non-HR account enables HR in its profile and reloads
- **THEN** the account can open the HR cabinet with its existing identity
- **AND** its existing account authority, room roles, and candidate-only participation remain unchanged

#### Scenario: A user attempts to enable another account

- **WHEN** an authenticated user submits another user's identity to the profile update operation
- **THEN** the operation does not modify that other account

### Requirement: HR invitation identity is the existing account UUID

The profile and HR cabinet SHALL show a copyable invitation ID equal to the account's existing UUID. The ID SHALL remain stable across reload, login, and HR enablement. Copying SHALL provide visible success or recoverable failure feedback. The displayed ID SHALL NOT contain an authentication token, room invitation secret, email address, or newly allocated alternate identity.

Pre-implementation acceptance-test level: **E2E** for visible identity and copy feedback; browser clipboard interaction can use the browser test runner's clipboard permission support.

#### Scenario: HR copies the invitation ID

- **WHEN** HR activates the copy control on the visible ID
- **THEN** the copied value equals the authenticated account UUID
- **AND** the UI confirms copying, or explains failure while keeping the ID selectable

### Requirement: HR features remain independent from candidate participation

An account marked HR SHALL remain able to participate as a candidate under the existing room-local admission rules. Candidate-only participation SHALL NOT add a room to that user's HR cabinet, permit HR metadata access, or unlock manager controls. The HR flag SHALL be resolved from authenticated server-side account data for protected HR operations rather than trusted from client state.

Pre-implementation acceptance-test level: **E2E**, supplemented by a **backend integration exception** for forged `isHr` and direct protected-operation attempts.

#### Scenario: HR participates as a candidate

- **WHEN** an HR account joins a room with candidate-only authority and no authorized manager association
- **THEN** that room does not appear in the account's HR list
- **AND** the participant retains candidate controls and receives no HR interview metadata

#### Scenario: Non-HR client claims HR capability

- **WHEN** an authenticated non-HR account forges client state or request fields claiming `isHr: true`
- **THEN** protected HR list and export operations remain denied
