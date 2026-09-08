## Purpose

Give HR managers a durable, refreshable list of the interview rooms they are authorized to oversee, with useful scheduling metadata and retained outcomes.

## ADDED Requirements

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
