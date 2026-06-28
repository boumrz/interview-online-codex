# sdd-workflow-governance Specification

## Purpose
Defines the project's specification-driven development governance, OpenSpec source-of-truth rules, legacy-spec replacement policy, and default multi-agent delivery path.
## Requirements
### Requirement: OpenSpec is the specification source of truth

The project MUST store current product and technical requirements in OpenSpec artifacts. Active changes MUST live under `openspec/changes/<change-id>/`, and accepted baseline requirements MUST live under `openspec/specs/`.

#### Scenario: New behavior change starts

- **WHEN** a bug fix, feature, or behavior-changing refactor is requested
- **THEN** the work starts by creating or updating an OpenSpec change before production code is edited

#### Scenario: Change is completed

- **WHEN** all implementation tasks for an OpenSpec change are complete and verified
- **THEN** the change is archived so the accepted requirements are reflected in `openspec/specs/`

### Requirement: Legacy specification files are not active specification sources

The project MUST NOT use `TECHNICAL_SPECIFICATION.md`, `docs/specs/`, or `docs/adr/` as active specification locations for new work.

#### Scenario: Agent needs product requirements

- **WHEN** an agent needs current requirements or proposed requirement deltas
- **THEN** it reads `openspec/specs/` and the relevant `openspec/changes/<change-id>/` artifacts instead of legacy spec files

### Requirement: Spec-first gate precedes implementation

Implementation MUST NOT begin until the relevant OpenSpec proposal, capability specs, and task list are present and valid.

#### Scenario: Developer receives a task

- **WHEN** a developer-agent is asked to implement a bug or feature
- **THEN** the agent verifies that an OpenSpec change exists, acceptance criteria are testable, and tasks are ready before editing code

### Requirement: Multi-agent workflow is implicit

The existing multi-agent delivery route MUST be used by default for project work without requiring the user to explicitly request multi-agent orchestration.

#### Scenario: User asks for a feature without mentioning agents

- **WHEN** the user asks to build or fix behavior in the project
- **THEN** the workflow begins with specification-agent and proceeds through product, architecture, task, audit, implementation, review, QA, coverage review, and final acceptance roles as applicable

### Requirement: Linear remains task-state source when available

When a Linear issue exists, agents MUST use Linear as the source of task state while keeping OpenSpec as the source of requirement state.

#### Scenario: Linear issue is linked

- **WHEN** an OpenSpec change or task references a Linear issue
- **THEN** agents keep task status and handoff comments aligned with Linear while preserving requirement details in OpenSpec
