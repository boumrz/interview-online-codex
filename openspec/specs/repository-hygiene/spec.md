## Purpose

Keep the repository navigable and safe to maintain by separating durable project material from reproducible local state.

## Requirements

### Requirement: Evidence-based repository cleanup
The repository hygiene workflow SHALL classify each cleanup candidate as durable source, generated output, local runtime state, or ambiguous working material before deleting or moving it. It MUST preserve active OpenSpec changes, user-owned worktree changes, and material whose purpose cannot be established from repository evidence.

#### Scenario: Generated runtime artefact is found
- **WHEN** an ignored log, PID file, cache, generated build, or browser recording has no active process dependency
- **THEN** the workflow removes it and ensures the ignore policy prevents it from appearing as a version-control candidate again

#### Scenario: Ambiguous artefact is found
- **WHEN** an ignored directory may contain analysis inputs, presentation sources, or other deliberate work products
- **THEN** the workflow leaves it intact and reports it as outside the safe cleanup scope

### Requirement: Local launchers do not accumulate logs
The local development launcher SHALL not retain backend or frontend log files after a normal run. It MUST remove its transient PID metadata during normal shutdown and MUST keep development output available in the invoking terminal.

#### Scenario: Local launcher is stopped normally
- **WHEN** a developer ends the local launcher or invokes its stop operation
- **THEN** no persistent backend or frontend log files remain in the repository workspace from that run

### Requirement: Logical test organization
Frontend contract tests SHALL reside under `frontend/tests/contract/`, frontend end-to-end tests SHALL reside under `frontend/tests/e2e/` grouped by product area, and standalone dashboard Node tests SHALL reside under `scripts/tests/`. Existing named test commands MUST continue to invoke their corresponding tests after relocation.

#### Scenario: A frontend end-to-end command is run
- **WHEN** a developer invokes an existing named `e2e:` command from `frontend/package.json`
- **THEN** it resolves to the relocated test script and preserves the command's prior test scope

#### Scenario: Dashboard Node tests are run
- **WHEN** the dashboard test commands are executed from the repository root
- **THEN** the relocated test files resolve their core modules, UI fixtures, and launcher paths correctly

### Requirement: Reusable project hygiene skill
The repository SHALL provide a project-local `repository-hygiene` Codex skill. The skill MUST require reference checks before deletion, a separate retention decision for ambiguous artefacts, and verification after file moves or cleanup changes.

#### Scenario: A future cleanup request is received
- **WHEN** Codex uses the project-local repository-hygiene skill
- **THEN** it inventories candidates, verifies ownership and references, applies only the approved safe cleanup scope, and records validation results
