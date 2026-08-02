## Purpose

Keeps browser acceptance checks focused on the intended private-notes and task
language behaviours instead of failing because a control's reachable DOM state
or test-ID placement was assumed incorrectly.

## ADDED Requirements

### Requirement: PDF private-notes acceptance setup is idempotent

The PDF private-notes browser acceptance test SHALL establish access to the
private-notes input without changing an already-correct side-panel state. If
the input is already visible, the test MUST leave the room rail untouched. If
the input is not visible and the room rail control is available, the test MUST
open the panel before waiting for the input. The test MUST then continue to
exercise the existing PDF progress and responsive-UI assertions.

Pre-implementation acceptance-test level: **E2E**. This is a test-only
correction: the existing browser flow is the proportionate acceptance harness,
and its red reproduction must be recorded before its selector setup changes.

#### Scenario: The private-notes panel is already open

- **WHEN** the PDF progress E2E reaches a room where the private-notes input is
  already visible
- **THEN** the test does not activate the panel toggle
- **AND** it reaches the visible private-notes input and continues the PDF
  progress scenario

#### Scenario: The private-notes panel is closed

- **WHEN** the PDF progress E2E reaches a room where the private-notes input is
  not visible and the room rail control is available
- **THEN** the test opens the panel once
- **AND** it waits for the private-notes input to become visible before adding
  notes

### Requirement: Task-language acceptance reads the actual language control

The task-creation language browser acceptance test SHALL read the value from
the control that carries `data-testid="create-task-language-select"` without
requiring a descendant input element. It MUST retain the existing assertions
that a new task defaults to the active Python, Kotlin, and Plain text language
tabs.

Pre-implementation acceptance-test level: **E2E**. The browser test is the
proportionate acceptance level because the regression depends on Mantine's
rendered DOM, not on an isolated application function.

#### Scenario: Mantine attaches the test ID to its input control

- **WHEN** the create-task modal renders one input carrying
  `data-testid="create-task-language-select"` and no descendant input
- **THEN** the E2E reads that input's value successfully
- **AND** it verifies the expected default language for each supported tab

#### Scenario: Selector mechanics do not mask a wrong default language

- **WHEN** the selected language differs from the active task-language tab
- **THEN** the E2E fails with the existing default-language mismatch assertion
- **AND** it does not fail merely because it searched for an absent descendant
  input
