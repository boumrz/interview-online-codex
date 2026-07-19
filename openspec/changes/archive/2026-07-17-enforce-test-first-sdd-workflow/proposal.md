## Why

A validated specification alone does not prove that a delivered feature behaves as a user expects. New stories need executable acceptance checks written before implementation so regressions and incorrect interpretations are detected before code is considered complete.

## What Changes

- Establish a mandatory delivery sequence for new behavior: SDD/OpenSpec, test design and test-first implementation, production implementation, then verification.
- Require an E2E acceptance test first whenever the story changes a user-observable flow; allow focused integration or unit tests only when E2E is not proportionate or technically applicable, with the reason recorded.
- Require the test to fail for the missing behavior before implementation begins, except for documentation/configuration-only work where an executable test is not applicable.
- Update project governance, Codex SDD instructions, and relevant delivery-role contracts to enforce the same gate.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sdd-workflow-governance`: Add the mandatory test-first/TDD gate between validated OpenSpec planning and implementation.

## Impact

- `AGENTS.md`, `openspec/project.md`, the project-local `sdd-openspec` skill, and applicable planner/developer/QA/test-reviewer role contracts.
- Future OpenSpec task lists and implementation verification for all new user stories.
