## 1. Governance baseline

- [x] 1.1 Add the test-first acceptance gate and its E2E-or-documented-exception scenarios to the OpenSpec governance baseline.
- [x] 1.2 Update the project entry rules and OpenSpec project context with the canonical order: SDD, test first, implementation, verification.
- [x] 1.3 Update the project-local SDD skill to block production implementation until the planned test has been run red.

## 2. Delivery-contract enforcement

- [x] 2.1 Update shared handoff flow and canonical planner, task-auditor, developer, reviewer, QA, and test-reviewer contracts to require a test-first task, test-level choice, red-run evidence, and final verification.
- [x] 2.2 Mirror the same gate in Codex, Claude, and Cursor role entry points so supported tools cannot bypass it.

## 3. Verification

- [x] 3.1 Record that this governance-only documentation and instruction change has no executable product behaviour requiring a red automated test.
- [x] 3.2 Run strict OpenSpec validation and static consistency checks confirming every active entry point states the test-first gate.
