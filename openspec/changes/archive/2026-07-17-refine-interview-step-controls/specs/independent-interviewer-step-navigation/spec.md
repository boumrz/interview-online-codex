## MODIFIED Requirements

### Requirement: Any interviewer can explicitly publish the room-wide active task

The system MUST provide owners and interviewers with a separate action to publish their locally selected task to every room visitor. The visible action MUST be labelled `Сделать активным`, use server-authoritative step switching, and remain forbidden to candidates. Publishing MUST update the persisted room-wide active step and synchronize the existing shared task context to all participants.

#### Scenario: Interviewer publishes the selected task

- **WHEN** an interviewer selects task 3 locally and activates `Сделать активным` for that selected task
- **THEN** the system publishes task 3 as the room-wide active task using the authorized step-switch operation
- **AND** every connected interviewer and candidate receives task 3 as the active room task
- **AND** the persisted room `currentStep` becomes 2

#### Scenario: Candidate attempts to publish a task

- **WHEN** a candidate attempts to invoke the room-wide step-switch operation
- **THEN** the server rejects the request as forbidden
- **AND** the candidate's room view remains on the published room-wide step

### Requirement: The room-wide active task is visibly identifiable

The manager task list MUST distinguish the task selected by that manager from the single task that is active for all visitors. The room-wide task MUST show an accessible, borderless marker visibly labelled `Активен`; exactly one task has this marker at a time. The manager panel MUST use `Шаг N из M` as its compact list context and MUST NOT render a separate bordered local-selection preview card, repeated selected-task title, or explanatory local-preview copy.

#### Scenario: Manager reviews a non-published task

- **WHEN** a manager locally selects a task different from the room-wide active task
- **THEN** the selected task is visually identified by its task-row selection state without a new border treatment
- **AND** the selected row exposes the `Сделать активным` action
- **AND** the room-wide task retains the `Активен` marker

#### Scenario: Manager publishes the selected task

- **WHEN** a manager publishes their selected task to the room
- **THEN** the `Активен` marker moves to that task
- **AND** the previously published task no longer has the marker
- **AND** the `Сделать активным` action is no longer shown for the now-active selected task
