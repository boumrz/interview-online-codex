# independent-interviewer-step-navigation Specification

## Purpose
TBD - created by archiving change decouple-step-navigation-from-room-sync. Update Purpose after archive.
## Requirements
### Requirement: Interviewer task selection is private until explicitly published

The system MUST let every owner or interviewer select a task in their own room interface without changing the persisted room-wide active step or emitting a room-wide step update. A local selection MUST switch that manager's central workspace to the selected task. A candidate MUST continue to follow only the room-wide active step and MUST NOT receive interviewer task-selection controls. A manager's local selection MUST initially equal the room-wide active step when no valid session selection exists, persist within that browser session, and fall back to the published step only if the selected task is no longer valid.

#### Scenario: Two interviewers select different tasks locally

- **WHEN** an owner selects task 2 locally and another interviewer selects task 3 locally while task 1 is active for the room
- **THEN** each manager sees their own selected task in the central manager workspace
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

### Requirement: Any interviewer can explicitly publish the room-wide active task

The system MUST provide owners and interviewers with a separate action to publish their locally selected task to every room visitor. The visible action MUST be labelled `Переключить`, use server-authoritative step switching, and remain forbidden to candidates. Publishing MUST update the persisted room-wide active step and synchronize the existing shared task context to participants who are following that published step.

#### Scenario: Interviewer publishes the selected task

- **WHEN** an interviewer selects task 3 locally and activates `Переключить` for that selected task
- **THEN** the system publishes task 3 as the room-wide active task using the authorized step-switch operation
- **AND** every connected candidate and every manager following the published task receives task 3 as the active room task
- **AND** the persisted room `currentStep` becomes 2

#### Scenario: Candidate attempts to publish a task

- **WHEN** a candidate attempts to invoke the room-wide step-switch operation
- **THEN** the server rejects the request as forbidden
- **AND** the candidate's room view remains on the published room-wide step

### Requirement: The room-wide active task is visibly identifiable

The manager task list MUST distinguish the task selected by that manager from the single task that is active for all visitors. The room-wide task MUST show an accessible, borderless marker visibly labelled `Активен`; exactly one task has this marker at a time. The marker's accessible name MUST identify the active task title. The selected non-published task MUST expose a compact transparent-blue tag labelled `Переключить`, rather than a filled primary button. The manager panel MUST use `Шаг N из M` as its compact list context and MUST NOT render a separate bordered local-selection preview card, repeated selected-task title, or explanatory local-preview copy.

#### Scenario: Manager reviews a non-published task

- **WHEN** a manager locally selects a task different from the room-wide active task
- **THEN** the selected task is visually identified by its task-row selection state without a new border treatment
- **AND** the selected row exposes the `Переключить` tag with a target-aware accessible label
- **AND** the room-wide task retains the `Активен` marker with its task title in the accessible name

#### Scenario: Manager publishes the selected task

- **WHEN** a manager publishes their selected task to the room
- **THEN** the `Активен` marker moves to that task
- **AND** the previously published task no longer has the marker
- **AND** the `Переключить` tag is no longer shown for the now-active selected task

### Requirement: A non-published manager workspace is isolated and read-only

When a manager's selected task differs from the room-wide active task, the system MUST render an isolated read-only workspace using that task's current saved code, effective language, and briefing or description. The system MUST refresh the snapshot when it re-enters a preview after that task was published, so it does not reuse obsolete saved content. It MUST NOT initialise a collaborative editor, Yjs document, awareness channel, shared briefing editor, shared language update, focus-mode update, or rating update for this preview. The currently published task MUST continue to use the existing server-authoritative realtime collaboration path.

#### Scenario: Manager locally opens a non-published task

- **WHEN** an interviewer selects task 2 while task 1 remains published
- **THEN** that interviewer's central workspace shows task 2's title, saved briefing and saved code in read-only form
- **AND** the workspace has no controls that modify task 1's shared editor, language, briefing, focus mode or rating
- **AND** no Yjs, briefing, language, focus-mode or `set_step` event is emitted by this local switch

#### Scenario: Manager returns to the published task

- **WHEN** the manager selects the room-wide active task
- **THEN** the central workspace returns to the existing shared editable code and briefing context for that task

#### Scenario: A previously previewed task becomes active and then inactive

- **WHEN** a manager previews task 2, task 2 is later published and updated, and another task is then published while the manager retains task 2 as their local selection
- **THEN** the manager's restored task-2 preview shows its newly saved code and briefing
- **AND** it does not show the earlier cached snapshot

### Requirement: Inactive workspace snapshots are manager-only

The backend MUST provide a dedicated workspace snapshot for a valid room task only to room owners and interviewers. The snapshot MUST contain the task index, title, effective language, saved code and saved briefing content with safe fallbacks to the task's starter code and description. It MUST NOT be included in normal room SSE payloads. Candidates MUST receive a forbidden response for this endpoint.

#### Scenario: Manager requests an inactive task workspace

- **WHEN** an authorised owner or interviewer requests the workspace snapshot for a valid task index
- **THEN** the backend returns the saved task workspace with language, code and briefing fallbacks where no saved value exists

#### Scenario: Candidate requests an inactive task workspace

- **WHEN** a candidate requests the workspace snapshot for any task index
- **THEN** the backend returns `403 Forbidden`
- **AND** it does not include code or briefing data for that task

