## ADDED Requirements

### Requirement: Interviewer task selection is private until explicitly published

The system MUST let every owner or interviewer select a task in their own room interface without changing the persisted room-wide active step or emitting a room-wide step update. A candidate MUST continue to follow only the room-wide active step and MUST NOT receive interviewer task-selection controls. A manager's local selection MUST initially equal the room-wide active step when no valid session selection exists, persist within that browser session, and fall back to the published step only if the selected task is no longer valid.

#### Scenario: Two interviewers select different tasks locally

- **WHEN** an owner selects task 2 locally and another interviewer selects task 3 locally while task 1 is active for the room
- **THEN** each manager sees their own selected task in the manager working view
- **AND** the candidate and the other manager remain on the room-wide task 1
- **AND** the persisted room `currentStep` remains 0

#### Scenario: Candidate opens the room

- **WHEN** a candidate opens a room with an active task
- **THEN** the candidate sees only the room-wide active task
- **AND** the candidate has no control to select a private task or publish a step

#### Scenario: Another interviewer publishes a step

- **WHEN** a room-wide active task changes through an authorized publication
- **THEN** every candidate follows the newly published room-wide active task
- **AND** each manager retains their own valid local selection while the global marker moves to the published task

### Requirement: Any interviewer can explicitly publish the room-wide active task

The system MUST provide owners and interviewers with a separate action to publish their locally selected task to every room visitor. The action MUST use server-authoritative step switching and MUST remain forbidden to candidates. Publishing MUST update the persisted room-wide active step and synchronize the existing shared task context to all participants.

#### Scenario: Interviewer publishes the selected task

- **WHEN** an interviewer selects task 3 locally and activates “Показать этот шаг всем”
- **THEN** the system publishes task 3 as the room-wide active task using the authorized step-switch operation
- **AND** every connected interviewer and candidate receives task 3 as the active room task
- **AND** the persisted room `currentStep` becomes 2

#### Scenario: Candidate attempts to publish a task

- **WHEN** a candidate attempts to invoke the room-wide step-switch operation
- **THEN** the server rejects the request as forbidden
- **AND** the candidate's room view remains on the published room-wide step

### Requirement: The room-wide active task is visibly identifiable

The manager task list MUST distinguish the task selected by that manager from the single task that is active for all visitors. The room-wide task MUST show an accessible marker labelled “Активно для всех”; exactly one task has this marker at a time.

#### Scenario: Manager reviews a non-published task

- **WHEN** a manager locally selects a task different from the room-wide active task
- **THEN** the selected task is visually identified as that manager's selection
- **AND** the room-wide task retains the “Активно для всех” marker

#### Scenario: Manager publishes the selected task

- **WHEN** a manager publishes their selected task to the room
- **THEN** the “Активно для всех” marker moves to that task
- **AND** the previously published task no longer has the marker
