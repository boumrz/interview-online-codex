## MODIFIED Requirements

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
