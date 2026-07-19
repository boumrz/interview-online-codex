## ADDED Requirements

### Requirement: Test-first acceptance gate precedes production implementation

For every new feature, bug fix, or behaviour-changing refactor with executable behaviour, the delivery workflow MUST proceed in this order: validated OpenSpec planning, test design and test authoring, a demonstrated failing test for the missing or incorrect behaviour, production implementation, and green verification. For a user-observable flow, the acceptance test MUST be E2E unless an integration or unit test is more proportionate or technically applicable; that exception and its reason MUST be recorded in the OpenSpec design or task list. Documentation-only, formatting-only, comment-only, and configuration-only work without executable behaviour MAY omit an automated test when the reason is recorded.

#### Scenario: User-observable story enters implementation

- **WHEN** a validated OpenSpec change adds or alters a user-observable product flow
- **THEN** its task list identifies an E2E acceptance test before the associated production implementation task
- **AND** the delivery owner runs that test and confirms it fails for the absent or incorrect behaviour before production code is written

#### Scenario: E2E test is not proportionate or applicable

- **WHEN** a change is best verified at an integration or unit boundary rather than through a user-observable E2E flow
- **THEN** the OpenSpec design or task list identifies the selected test level and records why E2E is not proportionate or technically applicable
- **AND** the selected test is authored and demonstrated failing before its production implementation begins

#### Scenario: Task-quality review checks a new behavioural change

- **WHEN** the prompt/task auditor reviews a planned behavioural task
- **THEN** the task is not ready unless it has a test-first task preceding implementation and an E2E choice or documented exception

#### Scenario: Non-behavioural work has no executable test

- **WHEN** a change is limited to documentation, comments, formatting, or non-executable configuration
- **THEN** the task list records why an automated test is not applicable before implementation proceeds
