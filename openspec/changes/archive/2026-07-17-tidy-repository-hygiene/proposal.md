## Why

Generated artefacts, local logs, and scattered test scripts make the repository harder to navigate and increase the risk of reviewing or committing irrelevant files. The project needs a repeatable, evidence-based hygiene workflow rather than one-off deletions.

## What Changes

- Add a project-local repository-hygiene skill that requires a usage check, an ignore-policy check, and verification before deleting or moving files.
- Remove confirmed local logs and generated run artefacts that are not project inputs or deliverables; prevent them from being reintroduced into version control.
- Reorganize standalone test scripts into logical test directories and update all package scripts, CI references, and documentation paths that invoke them.
- Remove only code and files proven unused by imports, build/test configuration, and project documentation; preserve user-owned work and active specifications.

## Capabilities

### New Capabilities

- `repository-hygiene`: Safe repository cleanup, generated-file policy, and logical test-file organization.

### Modified Capabilities

- None.

## Impact

- Project-local Codex skills and repository ignore rules.
- Frontend and dashboard test-script locations plus their npm or documentation references.
- Generated local output and logging artefacts only after their ownership and usage are verified.
