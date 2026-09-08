## ADDED Requirements

### Requirement: Managers can assign a joined HR from the participant menu

Any server-confirmed room owner or interviewer, including a supported promoted guest interviewer, SHALL be able to assign a joined, authenticated HR account through an explicit “Назначить HR” action in that participant's room menu. Eligibility SHALL derive from the account's server-confirmed HR flag and identity. The user SHALL NOT need to type or copy the target's UUID. A candidate-only invitation link SHALL still admit an HR account as a candidate until an authorized manager explicitly grants access. The action SHALL grant existing interviewer-equivalent room access and persist the same unique HR tracking association as an ID invitation, without creating an HR room-role enum or changing the account's HR flag. The existing ID invitation flow SHALL remain available for HR accounts that are not present.

Pre-implementation acceptance-test level: **E2E** for joined-HR assignment and preservation of the ordinary interviewer menu; supplemented by a **backend integration exception** for server-generated eligibility and direct authorization boundaries.

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
- **AND** the existing interviewer-removal operation remains available to an authorized manager

### Requirement: Participant HR assignment remains server-authoritative and reliable

The server SHALL independently validate the inviter's current room-manager authority and the target account's current stored HR eligibility when processing an assignment. The selected target SHALL be the authenticated account identified by the server's participant projection, not an editable display name or untrusted awareness identity. The operation SHALL use the existing atomic, idempotent HR assignment semantics; repetition and concurrent ID/participant assignment SHALL NOT create duplicate membership or tracking. Existing room archive denial and candidate/private-note restrictions SHALL apply unchanged. Participant projection SHALL expose only the minimal extra eligibility state needed by the control, without adding email addresses, tokens, or unrelated account details.

Pre-implementation acceptance-test level: **backend integration exception** for payload provenance, forged requests, concurrent operations, archive denial, and durable role precedence, which cannot be reliably isolated through UI alone; **E2E** for pending/error feedback and reconnect/demotion behavior observed by users.

#### Scenario: A candidate or revoked interviewer submits a forged assignment

- **WHEN** a candidate or a manager whose access has been revoked directly submits an HR assignment request, including one prepared while they still had manager controls
- **THEN** the server denies the request without changing membership or tracking
- **AND** a spoofed role or HR eligibility field does not bypass the denial

#### Scenario: Assignment is repeated or the selected participant disconnects

- **WHEN** authorized managers repeat assignment for the same server-identified HR account or the account disconnects after the manager has selected it
- **THEN** the existing account invitation semantics still apply and at most one membership and tracking association exist
- **AND** the target sees their durable granted role on the next successful entry or reconnect

#### Scenario: A pending assignment succeeds or fails

- **WHEN** a manager triggers participant HR assignment
- **THEN** the affected action has a visible pending state and cannot issue overlapping duplicate submissions from that control
- **AND** success is shown only after server confirmation
- **AND** a recoverable failure shows an understandable error and permits retry without falsely displaying granted access
- **AND** an archived-room response reaches the existing terminal archived/unavailable state

#### Scenario: HR is demoted and reconnects

- **GIVEN** a participant was explicitly assigned as HR and later demoted to candidate through the existing interviewer-removal control
- **WHEN** the HR account reconnects or refreshes their cabinet
- **THEN** the durable candidate role is respected and the room is inaccessible from the HR cabinet despite the retained tracking association
- **AND** old realtime messages, cached eligibility, and reconnect do not restore manager rights
- **AND** a new explicit authorized HR assignment can restore interviewer access and the original single tracked row

#### Scenario: A target or inviter changes while a request is pending

- **WHEN** a pending assignment completes after the initiating client has switched account, room, or lost manager authority
- **THEN** that completion does not restore obsolete controls or overwrite the new room/account state
- **AND** subsequent operations continue to use current server-confirmed authority
