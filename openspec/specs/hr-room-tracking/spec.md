# hr-room-tracking Specification

## Purpose
Give HR managers a durable, refreshable list of the interview rooms they are authorized to oversee, with useful scheduling metadata and retained outcomes.

## Requirements

### Requirement: Authorized HR manager entry creates one durable tracked association

When an authenticated HR account successfully enters a room as its server-authorized owner or interviewer, the system SHALL associate that room with the HR account. The association SHALL be unique for the account/room pair, survive reload and backend restart, and be idempotent across multiple tabs, reconnects, and concurrent entry/invitation requests. The HR flag, a room UUID, or a plain candidate invitation link SHALL NOT independently grant manager access. Candidate-only entry SHALL NOT create an association. A retained association SHALL NOT bypass a later loss of room permission.

Pre-implementation acceptance-test level: **E2E**, supplemented by a **backend integration exception** for durable persistence, concurrent deduplication, and forged direct-entry requests.

#### Scenario: HR opens an already authorized interview room

- **WHEN** an authenticated HR account enters a room with valid owner or interviewer permission
- **THEN** exactly one corresponding interview appears after refreshing that account's cabinet
- **AND** repeated entry, two browser tabs, and reconnect do not create additional rows

#### Scenario: A plain candidate link is opened by HR

- **WHEN** HR uses a candidate invitation without room-manager authorization
- **THEN** the account receives only the existing candidate admission rights
- **AND** no HR tracking association or manager permission is created

#### Scenario: Room authorization is lost after tracking

- **WHEN** an account no longer has manager access to a previously tracked room
- **THEN** subsequent cabinet reads, interview detail requests, and exports omit or deny that room
- **AND** reconnect or a retained association cannot restore unauthorized access

### Requirement: Every confirmed room manager can assign existing HR accounts by ID

Any server-confirmed room owner or interviewer SHALL be able to invite an existing `isHr: true` account by its UUID through a room HR invitation control. Successful invitation SHALL immediately persist HR tracking and room-local interviewer-equivalent access for that account; no acceptance step or prior room visit SHALL be required. Multiple HR accounts SHALL be supported. Repeating an invitation, inviting oneself when already authorized, or racing an invitation with entry SHALL succeed idempotently without duplicate memberships or tracked rows. The inviter's authority SHALL be checked on the server for the particular room, including the existing supported guest-interviewer authorization path.

Pre-implementation acceptance-test level: **E2E** for owner, non-owner interviewer, and supported guest-interviewer invitation flows; supplemented by a **backend integration exception** for concurrent writes and server authorization boundaries.

#### Scenario: Non-owner interviewer invites an HR account

- **WHEN** a confirmed non-owner interviewer submits an existing HR UUID in the room invitation control
- **THEN** the inviter receives successful feedback and the target has durable interviewer access to that room
- **AND** the target sees the room on its next cabinet refresh without first entering the room

#### Scenario: Two managers invite the same HR concurrently

- **WHEN** two authorized managers invite the same HR account to the same room concurrently
- **THEN** there is one HR association and one effective room membership for that account
- **AND** repeating either request does not fail solely because the association already exists

#### Scenario: Candidate attempts an HR invitation

- **WHEN** a candidate invokes the invitation operation or forges an inviter role
- **THEN** the server denies it without creating either membership or tracking

#### Scenario: Invitation ID is invalid or belongs to a non-HR account

- **WHEN** the inviter submits a malformed, unknown, or non-HR account UUID
- **THEN** the UI shows a recoverable validation/not-available error and no assignment is created
- **AND** the response contains no email address, token, or unrelated account details

### Requirement: HR room access uses interviewer permissions without owner or private-note grants

An explicitly assigned HR SHALL use the existing local interviewer role and its current manager capabilities. The system SHALL NOT introduce an HR room role or automatically make HR a room owner. Assignment SHALL NOT grant owner-only actions, account-admin access, or reading another participant's private interviewer notes. Existing server enforcement and candidate privacy SHALL apply to both ordinary interviewer and HR-assigned interviewer sessions. Newly added candidate/interview metadata SHALL be omitted from candidate-facing REST responses, SSE state sync, and incremental messages.

Pre-implementation acceptance-test level: **E2E** for assigned HR entry/reconnect and role-visible controls, supplemented by a **backend integration exception** for direct owner/private-note access denial and candidate payload inspection.

#### Scenario: Assigned HR joins and reconnects

- **WHEN** an invited HR account enters the room and later reconnects
- **THEN** the server confirms the existing interviewer role and preserves applicable interviewer controls
- **AND** owner-only controls and another interviewer's private notes remain inaccessible

#### Scenario: Candidate receives room updates after metadata changes

- **WHEN** a manager changes candidate name, position, or scheduled time while a candidate is connected or reconnecting
- **THEN** no candidate REST or realtime payload contains the newly added HR metadata fields or their values

### Requirement: Managers maintain minimal interview metadata and accurate results

The room's authorized managers SHALL be able to set candidate name, optional position, and optional scheduled date/time. Legacy rooms without these values SHALL show explicitly missing data rather than invented identities or dates. Metadata writes SHALL validate their input on the server, preserve unrelated room state, and reject unauthorized updates. The cabinet SHALL present existing finished state, verdict, verdict comment, and task scores when available without exposing private notes or recomputing a hiring verdict. The first completion time SHALL be persisted once and retained when verdicts, comments, or scores are later corrected; older missing completion times SHALL remain unknown unless the existing data provides an authoritative value.

Pre-implementation acceptance-test level: **E2E** for metadata and visible outcomes, supplemented by a **backend integration exception** for first-completion timestamp stability, input validation, and migration compatibility.

#### Scenario: Manager schedules an interview before candidate attendance

- **WHEN** a manager saves a candidate name, optional position, and future scheduled time
- **THEN** HR can identify that interview and its planned time without the candidate joining first
- **AND** the saved values survive refresh while unrelated task/editor state remains unchanged

#### Scenario: A verdict is corrected after completion

- **WHEN** a manager amends the verdict or comment of a completed room
- **THEN** the cabinet shows the current result and the original completion timestamp
- **AND** the correction does not create another interview or change its first completion date

#### Scenario: A legacy room lacks metadata

- **WHEN** an authorized HR views a tracked legacy room without candidate metadata or completion time
- **THEN** missing values are visibly unspecified
- **AND** an anonymous participant display name or later edit time is not silently used as historical candidate identity or completion time

### Requirement: The cabinet displays only the authenticated HR account's permitted interviews

The HR cabinet SHALL list one row per currently authorized tracked room and SHALL be available only to an authenticated account whose stored HR flag is true. A row SHALL identify the room, candidate name, position, scheduled time, completion/result information, and archived state as available, with an authorized action to open or review it. The product unit SHALL be an interview room, not a cross-room candidate profile. Completed rooms SHALL be identifiable by existing finished state; non-archived unfinished future-scheduled rooms SHALL be identified as upcoming; missing schedules and elapsed schedules without completion SHALL be distinguishable from completed interviews. Archived rooms SHALL be identified as archived and SHALL NOT appear as upcoming live interviews even when their scheduled date is still in the future. List loading SHALL not require joining room SSE sessions. Discovery of new assignments SHALL occur on initial load, manual refresh, or page reload without polling or a new realtime cabinet subscription.

Pre-implementation acceptance-test level: **E2E**, including two separate HR accounts, candidate-only participation, initial/loading/empty/error views, and refresh after external invitation.

#### Scenario: HR refreshes after an invitation

- **WHEN** another manager assigns a room while the HR cabinet is already open and HR refreshes the list or reloads
- **THEN** the invited room appears once with its current metadata and authorized open action
- **AND** no prior room visit or automatic live update is required

#### Scenario: Two HR accounts have different assigned rooms

- **WHEN** each HR account opens its cabinet
- **THEN** each sees only its own tracked rooms for which manager permission remains valid
- **AND** changing a target account or room ID in a direct request does not disclose the other account's interviews

#### Scenario: The list cannot be loaded

- **WHEN** a cabinet request fails or the account has no tracked interviews
- **THEN** the UI distinguishes a recoverable load error from an empty successful list
- **AND** a failed refresh never labels stale values as newly loaded data

#### Scenario: An unfinished future interview is archived

- **WHEN** an authorized owner archives an unfinished tracked room whose scheduled time is still in the future
- **THEN** the HR cabinet identifies it as archived rather than an upcoming live interview
- **AND** its retained record remains available only for authorized historical review

### Requirement: Removal from active use preserves authorized HR interview history

A room with persisted HR tracking SHALL retain its interview record and existing result data when removed from active use through the existing room removal operation. That operation SHALL archive the tracked room instead of destroying the HR history; the authorized caller SHALL receive understandable archive feedback. Archived tracked rooms SHALL remain identifiable and reviewable in the authorized HR cabinet and exports, including after backend restart, and SHALL be read-only: archive SHALL NOT permit reopening a live collaboration or accepting room mutations. Owner-only removal authority SHALL remain owner-only; HR assignment SHALL not gain removal authority. Untracked-room removal semantics SHALL remain compatible with existing behavior. An unrelated HR or revoked participant SHALL not gain historical access merely because a room was archived.

Pre-implementation acceptance-test level: **E2E** for owner archive and HR historical review, supplemented by a **backend integration exception** for persistence, manager/owner boundaries, archived mutation denial, and compatibility of untracked-room deletion.

#### Scenario: Owner removes an HR-tracked completed room

- **WHEN** the owner removes a completed room with HR tracking from active use
- **THEN** the room is archived and its authorized HR cabinet/export still contains its candidate metadata and outcome
- **AND** HR can review the retained record but cannot edit it or resume live collaboration

#### Scenario: A tracked room is archived while a session is active

- **WHEN** an authorized removal archives a tracked room with existing realtime sessions
- **THEN** subsequent mutation requests are denied and connected clients reach a non-editable archived/unavailable state
- **AND** reconnect cannot restore live editing or create repeated authorization retry traffic

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
