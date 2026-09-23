---
name: sdd-openspec
description: Legacy compatibility skill for the interview-online project. OpenSpec is no longer the active workflow; use the feature specifications linked by SPEC.md.
---

# Legacy OpenSpec Compatibility

OpenSpec used to be the active specification workflow for this repository.
It is now deprecated for ordinary work.

## Current rule

Use `SPEC.md` at the repository root as the index and work order. The active
product and implementation specification for each feature lives in
`specs/features/`.

Do not create new OpenSpec changes, capability specs or task files for normal
feature/bug work. Do not run the OpenSpec CLI unless the user explicitly asks
to inspect or maintain historical OpenSpec artifacts.

## Workflow

1. Read `AGENTS.md`.
2. Open the relevant feature specification linked from `SPEC.md`.
3. If the requirement changed, update that feature specification directly and briefly.
4. For executable behavior, keep the test-first workflow:
   - write or update the most relevant test first;
   - prefer E2E for user-visible flows;
   - use backend integration tests for permissions, persistence, migrations,
     security and concurrency;
   - run targeted verification after implementation.
5. Treat `openspec/` only as historical context and evidence.

## Completion gate

Do not declare a task complete unless:

- the delivered behavior matches the relevant feature specification;
- relevant tests/checks were run or a documentation-only exception is clear;
- remaining work in the feature specification and status in `SPEC.md` are updated if scope changed.
