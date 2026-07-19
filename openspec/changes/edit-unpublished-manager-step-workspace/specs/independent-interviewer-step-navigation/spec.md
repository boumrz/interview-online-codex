## MODIFIED Requirements

### Requirement: Interviewer task selection is private until explicitly published

The system MUST let every owner or interviewer select a task in their own room interface without changing the persisted room-wide active step or emitting a room-wide step update. A local selection MUST switch that manager's central workspace to the selected task. If the selected task is not published, that workspace MUST be the room-level manager-shared workspace for the selected task, rather than a personal draft. A candidate MUST continue to follow only the room-wide active step and MUST NOT receive interviewer task-selection controls. A manager's local selection MUST initially equal the room-wide active step when no valid session selection exists, persist within that browser session, and fall back to the published step only if the selected task is no longer valid.

#### Scenario: Two interviewers select different tasks locally

- **WHEN** an owner selects task 2 locally and another interviewer selects task 3 locally while task 1 is active for the room
- **THEN** each manager sees the manager-shared workspace for their own selected task
- **AND** neither local selection sends a room-wide step update
- **AND** the candidate and managers without a different local selection remain on the room-wide task 1
- **AND** the persisted room `currentStep` remains 0

#### Scenario: Candidate opens the room

- **WHEN** a candidate opens a room with an active task
- **THEN** the candidate sees only the room-wide active task
- **AND** the candidate has no control to select a private task or publish a step

#### Scenario: Another interviewer publishes a step

- **WHEN** a room-wide active task changes through an authorized publication
- **THEN** every candidate follows the newly published room-wide active task
- **AND** a manager whose valid local selection matches the newly published task sees its shared workspace
- **AND** each manager with a different valid local selection retains their independent local workspace while the global marker moves to the published task

#### Scenario: Manager is notified about a room-wide step change

- **WHEN** another interviewer publishes a room-wide step that differs from a manager's current local selection
- **THEN** that manager retains their local selection and editable workspace
- **AND** a dismissible, accessible top notification identifies the newly active task and tells the manager to open it from the task list when they are ready
- **AND** candidates do not receive this manager-only notification because their workspace already follows the published step automatically

#### Scenario: Notified manager publishes a step

- **WHEN** a manager retains a notification about a step published by another interviewer and then explicitly publishes any locally selected step
- **THEN** the manager's prior step-change notification is dismissed immediately when the publication is initiated
- **AND** no stale notification remains after the room-wide active step changes
- **AND** the publishing manager does not receive a replacement notification for their own publication

#### Scenario: Another interviewer publishes the notified manager's current task

- **WHEN** a manager retains a notification about an earlier room-wide active task while their local selection remains on another task
- **AND** another interviewer publishes that manager's currently selected task
- **THEN** the prior notification is dismissed because the manager is now already aligned with the room-wide active task
- **AND** the manager remains on that selected task without being directed back to the previously active task

### Requirement: Any interviewer can explicitly publish the room-wide active task

The system MUST provide owners and interviewers with a separate action to publish their locally selected task to every room visitor. The visible action MUST be labelled `Переключить`, use server-authoritative step switching, and remain forbidden to candidates. Publishing MUST atomically use the selected task's latest manager-shared workspace, update the persisted room-wide active step, and synchronize the resulting shared task context to participants who are following that published step.

#### Scenario: Interviewer publishes the selected task

- **WHEN** an interviewer selects task 3 locally and activates `Переключить` for that selected task
- **THEN** the system publishes task 3 as the room-wide active task using the authorized step-switch operation
- **AND** every connected candidate and every manager following the published task receives task 3 with the code, language, briefing, and focus mode prepared in its manager workspace
- **AND** the persisted room `currentStep` becomes 2

#### Scenario: Publication preserves concurrent manager preparation

- **WHEN** multiple authorised interviewers edit the same non-published task and one of them explicitly publishes that task
- **THEN** the published room state uses the latest task-scoped code, briefing, language, focus mode, and Yjs snapshot accepted by the server
- **AND** no publisher-local cache, stale public-room state, or task fallback overwrites any other interviewer's accepted edit
- **AND** every candidate receives that preserved prepared state after the room-wide step changes

#### Scenario: Candidate attempts to publish a task

- **WHEN** a candidate attempts to invoke the room-wide step-switch operation
- **THEN** the server rejects the request as forbidden
- **AND** the candidate's room view remains on the published room-wide step

### Requirement: A non-published manager workspace is isolated and read-only

When a manager's selected task differs from the room-wide active task, the system MUST render an isolated, editable manager-only workspace for that task. All owners and interviewers who open the same task MUST collaborate in the same code, briefing, language, and focus-mode state in real time. The workspace MUST initialise from that task's saved state and MUST refresh/recover its snapshot after reconnect, reload, or re-entry after publication, so it does not reuse obsolete saved content. It MUST NOT initialise or mutate the currently published task's collaborative editor, awareness channel, shared briefing editor, shared language update, focus-mode update, or rating update. The currently published task MUST continue to use the existing server-authoritative realtime collaboration path.

#### Scenario: Two managers prepare a non-published task together

- **WHEN** two authorised interviewers open task 2 while task 1 remains published and the first interviewer edits task 2 code, briefing, language, or focus mode
- **THEN** the second interviewer receives the change in the task-2 manager workspace in real time
- **AND** task 1's public workspace and persisted room `currentStep` do not change
- **AND** no candidate receives the task-2 content, Yjs update, or awareness update

#### Scenario: Manager locally opens a non-published task

- **WHEN** an interviewer selects task 2 while task 1 remains published
- **THEN** that interviewer's central workspace shows task 2's title, saved briefing and saved code in editable manager-only form
- **AND** the workspace has no controls that modify task 1's shared editor, language, briefing, focus mode or rating
- **AND** no Yjs, briefing, language, focus-mode or `set_step` event is emitted by this local switch through the published-task channel

#### Scenario: Manager returns to the published task

- **WHEN** the manager selects the room-wide active task
- **THEN** the central workspace returns to the existing shared editable code and briefing context for that task

#### Scenario: A previously previewed task becomes active and then inactive

- **WHEN** a manager previews task 2, task 2 is later published and updated, and another task is then published while the manager retains task 2 as their local selection
- **THEN** the manager's restored task-2 preview shows its newly saved code and briefing
- **AND** it does not show the earlier cached snapshot

### Requirement: Inactive workspace snapshots are manager-only

The backend MUST provide a dedicated workspace snapshot for a valid room task only to room owners and interviewers. The snapshot MUST contain the task index, title, effective language, saved code and saved briefing content with safe fallbacks to the task's starter code and description. The manager-only realtime snapshot MUST additionally contain the task workspace Yjs state and revisions needed to resume collaboration. Neither snapshot MUST be included in normal room SSE payloads. Candidates MUST receive a forbidden response for this endpoint and for every manager-workspace read, subscribe, update, or awareness operation.

#### Scenario: Manager requests an inactive task workspace

- **WHEN** an authorised owner or interviewer requests the workspace snapshot for a valid task index
- **THEN** the backend returns the saved task workspace with language, code and briefing fallbacks where no saved value exists

#### Scenario: Candidate requests an inactive task workspace

- **WHEN** a candidate requests an inactive task workspace for any task index or forges a manager-workspace realtime event
- **THEN** the backend returns or emits `403 Forbidden`
- **AND** it does not include code, briefing, Yjs, revision, or awareness data for that task

## ADDED Requirements

### Requirement: A five-participant room preserves realtime collaboration and role boundaries

The system MUST support at least five simultaneously connected browser sessions in a room, including `4 interviewers + 1 candidate` and `3 interviewers + 2 candidates`. Separate browser sessions MUST receive collaborative code changes made by each authorised manager on the published active step without duplicate application. Candidates MUST receive only the room-wide active workspace and MUST NOT receive manager-only task controls or unpublished workspace data. The browser-level acceptance suite MUST record propagation time from editor dispatch to each recipient and report aggregate p50, p95, and maximum latency with an explicit local pass/fail threshold.

#### Scenario: Four interviewers collaborate with one candidate

- **WHEN** four authorised managers and one candidate are connected to the same published room task and managers edit it in turn
- **THEN** every other manager and the candidate receives each unique editor marker exactly once
- **AND** the candidate has no manager-only step or publication control
- **AND** the test records the observed delivery delay for every recipient

#### Scenario: Three interviewers collaborate with two candidates

- **WHEN** three authorised managers and two candidates are connected to the same published room task and managers edit it in turn
- **THEN** every other manager and both candidates receive each unique editor marker exactly once
- **AND** each candidate remains limited to the room-wide active workspace
- **AND** the test records the observed delivery delay for every recipient

#### Scenario: A room-wide publication occurs while a manager stays on another task

- **WHEN** one manager publishes a prepared task while another manager retains a different local task selection and candidates follow the published step
- **THEN** both candidates move to the newly published active task
- **AND** the manager with the different local selection keeps that selection and receives an accessible notification that names the new active task
- **AND** the publishing manager does not receive that notification

### Requirement: Manager workspace hydration and task identity preserve prepared work

The system MUST treat the server-provided manager workspace as authoritative before mounting an inactive-step editor or emitting Yjs, awareness, briefing, language, or focus-mode updates. While that workspace is loading, the manager MUST see a non-editable loading state rather than a fallback document. The backend MUST associate every manager workspace and subscription with the immutable room-task identity in addition to its current step index. A task-list deletion or reindex MUST NOT allow a stale manager client to write, publish, or expose the previously opened workspace as the contents of a different task.

#### Scenario: Delayed manager-workspace hydration

- **WHEN** a manager opens an inactive task whose authoritative manager-workspace response is delayed
- **THEN** no fallback editor or Yjs snapshot is emitted before the authoritative response arrives
- **AND** the saved workspace code remains unchanged until the manager deliberately edits it
- **AND** the editor becomes available only with the authoritative task workspace

#### Scenario: Task reindex while a manager workspace is open

- **WHEN** one manager has an inactive task open and another authorised manager deletes an earlier task so numeric step indexes change
- **THEN** a queued or subsequent update from the first manager cannot be persisted to the task now occupying the previous index
- **AND** the first manager must rehydrate a valid current task workspace before further editing or publication

### Requirement: Manager workspace realtime events are task-scoped and durable

The system MUST scope every manager-workspace Yjs, awareness, briefing, language, and focus-mode event to one valid inactive task. The server MUST accept those events only from an authorised manager subscribed to that workspace and MUST relay them only to authorised managers subscribed to the same workspace. Accepted state MUST be persisted to the room task, including the Yjs snapshot and revision, so a newly connected manager can recover it. Code collaboration MUST merge concurrent edits through Yjs; briefing, language, and focus-mode updates MUST reject stale revisions and provide the latest state for resynchronisation.

#### Scenario: Manager reconnects to prepared task

- **WHEN** an interviewer edits a non-published task, then another authorised interviewer opens it after a reconnect, reload, or server restart
- **THEN** the interviewer receives the saved code, language, briefing, focus mode, Yjs state, and current revision for that task
- **AND** editing can resume without modifying the published task

#### Scenario: Stale manager briefing update is rejected

- **WHEN** two managers submit non-CRDT workspace updates based on different revisions and the older revision arrives after a newer accepted update
- **THEN** the server rejects the stale update without overwriting the newer state
- **AND** the stale client receives the latest workspace state required to resynchronise

#### Scenario: Publication does not reset a shared manager document

- **WHEN** a manager publishes a non-published task after another manager has most recently updated its shared code document
- **THEN** the public collaboration state is hydrated from that task's current persisted Yjs snapshot and sequence
- **AND** the newly published code contains the other manager's latest accepted edit

#### Scenario: Manager changes task workspace scope

- **WHEN** an interviewer changes the selected inactive task from task 2 to task 3 and later returns to task 2
- **THEN** task 2 and task 3 use separate collaborative documents and awareness scopes
- **AND** code or cursor data from one task is never merged into the other task

#### Scenario: A manager workspace event arrives after its task becomes published

- **WHEN** an authorised manager's queued `manager_workspace_open` request or manager-workspace transport update reaches the server after another interviewer has published that same task
- **THEN** the server clears any obsolete manager-workspace subscription and accepts the late request as a no-op
- **AND** the manager receives no internal error message because the task now correctly uses the published shared channel
- **AND** candidates remain forbidden from opening any manager workspace, including the published task

#### Scenario: Manager changes language after preparing code

- **WHEN** a manager edits code in a non-published task and then changes that task's language
- **THEN** the remounted task-scoped editor restores the same full Yjs document and code
- **AND** its periodic snapshot cannot persist an empty document over the prepared task
- **AND** another manager can reload the workspace and receive the prepared code

#### Scenario: Two managers reopen a formerly published task

- **WHEN** the room-wide task changes from task 1 to task 2 and two authorised interviewers then select the now non-published task 1
- **THEN** both manager editors hydrate one task-1 Yjs document and receive each other's insertions and deletions
- **AND** a deletion made by either manager removes the deleted text from the other manager's editor and from the persisted task-1 workspace
- **AND** the candidate remains on task 2 and never receives task-1 manager-workspace content

#### Scenario: Concurrent manager updates require recovery

- **WHEN** two managers submit task-1 Yjs updates from the same acknowledged sequence and one update reaches the server first
- **THEN** the server does not replace the canonical task-1 document with the second mismatched full snapshot
- **AND** the second manager receives and applies the canonical task-1 snapshot, merges its local change, and resubmits against the recovered sequence
- **AND** both managers converge on the same document before either later deletion is persisted

### Requirement: Publishing a step preserves the prior public workspace

The system MUST serialize a room-wide step publication with every public code, Yjs, language, and briefing update for that room. Any public edit accepted by the server before the publication transition MUST be persisted with the task that was active when it was accepted. A delayed save or late old-step transport event MUST NOT overwrite the newly active task, its prepared manager workspace, or its persisted Yjs snapshot. The server MUST bind asynchronous public persistence to the immutable source task rather than resolving `room.currentStep` when it runs.

#### Scenario: Candidate and interviewer edit before another interviewer publishes

- **WHEN** an interviewer and a candidate both make public code edits on active task 1, the server accepts those edits, and another interviewer immediately publishes prepared task 2
- **THEN** task 2 remains exactly the prepared task-2 code, language, briefing, focus mode, and Yjs document for every room participant
- **AND** reopening task 1 as a manager shows both accepted task-1 edits
- **AND** those edits remain present after the former debounce interval and after manager reload

#### Scenario: Delayed old-step Yjs event arrives after publication

- **WHEN** a public Yjs event bearing task 1's sync scope arrives after task 2 has become room-wide active
- **THEN** the server does not apply that event to task 2 or its current public realtime state
- **AND** no participant sees task-1 code in task 2
- **AND** the sender's recovery path can synchronize to the current task scope without corrupting either task

#### Scenario: A manager uses the legacy REST next-step endpoint

- **WHEN** a manager invokes the authorised REST next-step endpoint while participants have accepted public edits on the current task
- **THEN** that endpoint uses the same serialized public-transition boundary as the realtime publication operation
- **AND** the next task is not overwritten by a delayed save from the previous task
- **AND** the previous task retains the edits that were accepted before the transition
