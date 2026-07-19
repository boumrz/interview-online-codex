---
name: repository-hygiene
description: Safely clean and reorganize the interview-online repository. Use for requests to remove logs, generated files, unused code, stale debug artefacts, duplicate configuration, or to group tests and scripts into logical directories.
---

# Repository hygiene

Use OpenSpec and the project `AGENTS.md` before changing project files. Treat a dirty worktree as user-owned until a task explicitly covers the affected path.

## Workflow

1. Inventory before changing anything.
   - List candidate files with `rg --files`, directory sizes, `git status --short`, `git ls-files`, and `git check-ignore -v`.
   - Search imports, package scripts, build configuration, CI, and current documentation with `rg`.
   - Check active processes before deleting logs, PID files, caches, or build output.

2. Classify every candidate.
   - **Safe generated state:** logs, PID files, caches, test output, browser recordings, build output, and ignored session/debug files.
   - **Durable project material:** source code, tests, package/build configuration, OpenSpec, shared agent rules, and assets referenced by code or documentation.
   - **Ambiguous material:** analytics, presentations, exports, screenshots, or any ignored directory that may be a deliverable. Keep it and report it unless the user explicitly approves removal.

3. Remove or move only with evidence.
   - Never delete source because it has no filename import alone; account for framework discovery, ambient declarations, configuration, and runtime entry points.
   - Delete only exact, verified safe paths. Do not use broad destructive patterns or recursive deletion against an unresolved path.
   - When moving tests, update all package commands and relative imports in the same change. Preserve the existing named command scope.
   - Do not rewrite archived OpenSpec files merely to update historical paths.

4. Prevent recurrence.
   - Add ignore rules for reproducible local output.
   - Make local launch scripts avoid persistent logs by default; terminal output is acceptable. Remove transient PID metadata during normal shutdown.
   - Use these test locations unless project conventions supersede them:
     - `frontend/tests/contract/`
     - `frontend/tests/e2e/<product-area>/`
     - `scripts/tests/`
     - `backend/src/test/`

5. Verify and report.
   - Run the moved tests, relevant typecheck/build commands, and `git diff --check`.
   - Re-run the inventory to confirm no safe artefacts remain as untracked candidates.
   - State what was deleted, what was deliberately retained, why, and any follow-up decision required.
