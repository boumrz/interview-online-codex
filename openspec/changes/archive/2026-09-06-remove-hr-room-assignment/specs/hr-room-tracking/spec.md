## MODIFIED Requirements

### Requirement: Managers can assign a joined HR from the participant menu

Any server-confirmed room owner or interviewer, including a supported promoted guest interviewer, SHALL be able to assign a joined, authenticated HR account through an explicit “Назначить HR” action in that participant's room menu. Eligibility SHALL derive from the account's server-confirmed HR flag and identity. The user SHALL NOT need to type or copy the target's UUID. A candidate-only invitation link SHALL still admit an HR account as a candidate until an authorized manager explicitly grants access. The action SHALL grant existing interviewer-equivalent room access and persist the same unique HR tracking association as an ID invitation, without creating an HR room-role enum or changing the account's HR flag. The existing ID invitation flow SHALL remain available for HR accounts that are not present.

Pre-implementation acceptance-test level: **E2E** for joined-HR assignment and preservation of the ordinary interviewer menu; supplemented by a **backend integration exception** for server-generated eligibility and direct authorization boundaries. Removal acceptance is specified below.

#### Scenario: Owner assigns HR after candidate-link entry

- **GIVEN** an authenticated HR account has joined a room through its candidate link and has no manager access or tracked row
- **WHEN** the owner opens that participant's menu and selects “Назначить HR”
- **THEN** the selected account gains interviewer-equivalent room controls without anyone entering an account ID
- **AND** the room appears exactly once after that HR refreshes their cabinet
- **AND** candidate-link entry alone did not grant those rights or create the row

#### Scenario: A non-owner interviewer assigns the joined HR

- **WHEN** a server-confirmed non-owner interviewer or supported promoted guest interviewer assigns an eligible joined participant as HR
- **THEN** the target obtains the same durable membership and tracking as when the owner performs the action
- **AND** the target does not receive owner-only or account-admin permissions

#### Scenario: A joined ordinary account or anonymous guest is ineligible

- **WHEN** a manager opens the menu of an ordinary authenticated account without the HR flag or an anonymous participant
- **THEN** the menu does not offer an enabled HR assignment action
- **AND** existing interviewer assignment remains available under its existing rules
- **AND** neither a matching display name nor a client-supplied HR flag establishes HR eligibility

#### Scenario: Assignment controls reflect existing HR access

- **WHEN** the joined HR is already assigned with interviewer-equivalent access
- **THEN** the room provides an understandable assigned HR state and does not invite accidental repeated submission as a new assignment
- **AND** every current manager sees an explicit “Снять роль HR” action for an assigned non-owner HR, including themselves
- **AND** the room owner cannot be removed and the existing ordinary non-HR interviewer controls retain their current authority rules

## ADDED Requirements

### Requirement: Managers can durably remove an assigned HR from a room

Any server-confirmed room manager, including a supported promoted guest interviewer, SHALL be able to select “Снять роль HR” for an assigned non-owner HR in the participant menu and the existing “Кандидат и HR” manager list, including an offline target or themselves. The server SHALL independently authorize the caller against current room permissions. Successful removal SHALL persist the target's candidate membership without changing global `isHr`, owner identity, other accounts, or interview content. The target SHALL lose manager operations, manager-only/private information, and cabinet/detail/export access for that room. Any retained tracking association SHALL remain insufficient for access. Existing-candidate retries by a still-authorized caller SHALL succeed without creating membership or tracking for an unrelated account. Owner removal SHALL be forbidden. Ordinary non-HR role controls SHALL retain their existing authorization rules.

The server SHALL synchronize confirmed candidate permissions to all active target sessions through the existing room realtime flow; subsequent privileged REST/POST operations and SSE projections SHALL apply the new permission. Reload, reconnect, old messages, and automatic tracking SHALL NOT restore interviewer rights. Only a new explicit authorized assignment SHALL be able to restore them. Removal and concurrent permission operations SHALL use one authoritative ordering with no partial membership/permission result. Both controls SHALL show a pending state, prevent duplicate local submissions, show success only after confirmation, and provide retryable errors without falsely changing the role. A result received after switching room/account SHALL NOT overwrite the current context.

Pre-implementation acceptance-test level: **E2E** for both removal controls, active and offline targets, self-removal, visible candidate controls, reconnect, cabinet refresh, error feedback, and preservation of ordinary role controls; supplemented by a **backend integration exception** for the full authorization/error matrix, private payload/access denial, persistence, concurrent ordering, and retries because these security and transactional boundaries cannot be reliably isolated through UI alone.

#### Scenario: A current manager removes a joined HR

- **GIVEN** an HR account has interviewer-equivalent access in a room they do not own
- **WHEN** the owner, another current interviewer, or a supported promoted guest interviewer selects “Снять роль HR” in the participant menu
- **THEN** the server persists candidate membership and active target sessions receive candidate permissions
- **AND** manager controls and access to manager/private data disappear while global HR status remains enabled
- **AND** ordinary non-HR interviewer controls still follow their existing rules

#### Scenario: An offline HR is removed from the manager list

- **GIVEN** an assigned non-owner HR is not connected to the room
- **WHEN** a current manager removes the account through “Кандидат и HR”
- **THEN** the assignment list reflects the confirmed removal
- **AND** the next entry or reconnect grants only candidate permissions
- **AND** refreshing the target's cabinet omits the room and direct interview detail/export requests cannot retrieve it

#### Scenario: An assigned HR removes their own room access

- **WHEN** a non-owner HR with current manager permission removes their own assignment
- **THEN** the operation succeeds and that account becomes a durable candidate
- **AND** further manager operations, including another removal attempt by that now-candidate, are denied using current authority

#### Scenario: Repetition does not grant or create access

- **WHEN** a still-authorized manager repeats removal for an HR account that already has durable candidate membership in that room
- **THEN** the operation returns 204 with no body, as on first successful removal, with the target remaining a candidate
- **AND** no duplicate membership or tracking association is created
- **AND** submitting an unrelated HR account does not create a room membership
- **AND** existing room membership is sufficient to remove HR before automatic tracking finishes; a retained association without membership permits creating the durable candidate override

#### Scenario: Direct removal requests obey room boundaries

- **WHEN** a candidate, revoked manager, or unrelated caller submits `DELETE /api/rooms/{inviteCode}/hr-managers/{userId}`
- **THEN** the server returns 403 without changing membership or tracking, including when the target UUID is malformed
- **AND** an authorized caller targeting the room owner receives 403
- **AND** only after checking current caller authorization, a malformed target UUID or unknown, non-HR, or unrelated account receives 404 without unrelated account details
- **AND** removal from an archived room is denied with 410 under the existing archive authorization rules

#### Scenario: Reconnect or a concurrent operation cannot silently regrant HR

- **GIVEN** an assigned HR is removed while other tabs, entry, or automatic tracking requests are active
- **WHEN** those sessions reconnect or their pending updates are processed
- **THEN** they respect the last server-confirmed candidate permission and cannot restore manager rights from cached roles or tracking
- **AND** concurrent explicit assignment/removal requests resolve according to their serialized authorized order
- **AND** a later explicit authorized HR assignment can restore interviewer access with a single tracked association

#### Scenario: A pending removal fails or the client context changes

- **WHEN** removal is submitted from either control
- **THEN** that action is visibly pending and suppresses overlapping local submissions until it completes
- **AND** a recoverable failure preserves confirmed role state, shows an understandable error, and permits retry
- **AND** an archived-room response reaches the existing terminal archived/unavailable state
- **AND** a response after the initiating client changes room/account or loses permission does not restore obsolete controls or overwrite the new context
