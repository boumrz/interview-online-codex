## Context

The repository currently mixes durable source code with local runtime logs, generated browser recordings, root-level debugging artefacts, and standalone test scripts. Existing ignore rules already classify most of these files as local, but `scripts/dev-up.sh` still retains logs after every run and `output/` is not ignored. The worktree contains unrelated user changes and active OpenSpec changes, so cleanup must preserve unverified material.

## Goals / Non-Goals

**Goals:**

- Keep only durable source, specifications, and deliberate deliverables in the project tree.
- Keep tests discoverable by grouping them by product area and test type.
- Make future cleanup repeatable through a project-local skill and explicit ignore policy.
- Prove that moved tests and retained build paths still work.

**Non-Goals:**

- Do not delete business deliverables or personal analysis from `analytics/` or presentation assets without an explicit retention decision.
- Do not remove a dependency, build tool, source file, or active OpenSpec change solely because it is not found by one text search.
- Do not alter product behavior, API contracts, database schemas, or archived OpenSpec records.

## Decisions

### 1. Keep a project-local hygiene skill

Create `.codex/skills/repository-hygiene/` so the procedure travels with this repository and applies to future Codex work. The skill will require an inventory, reference checks, a separation between generated and durable material, verification after moves, and an explicit retention check for ambiguous files. A global-only skill was rejected because the project-specific ignore rules and OpenSpec workflow are essential context.

### 2. Delete only classified local artefacts and prevent recurrence

Delete ignored logs, stale PID files, local runner caches, generated builds, root debugging files, and the generated `output/playwright/` recordings. Add ignore coverage for reproducible output and cache files. Keep `analytics/`, presentation material under `artifacts/`, and installed dependencies out of this pass because they may be deliberate local working inputs. `scripts/dev-up.sh` will no longer persist backend or frontend logs by default; output remains in the terminal and PID metadata is removed during normal shutdown.

### 3. Organize tests by ownership and purpose

Move frontend contract tests to `frontend/tests/contract/`, Playwright tests to `frontend/tests/e2e/<area>/`, and dashboard Node tests to `scripts/tests/`. Update direct npm commands and relative imports only; preserve the existing named test commands and the intentional membership of `e2e:all`. Keep backend tests in the conventional `backend/src/test/` layout and do not rewrite archived specifications that mention historical paths.

### 4. Use evidence-based unused-code removal

For each deletion candidate, inspect imports, package/build/test references, and user-facing documentation. A file is removable only when it is generated or has no valid project reference and is not an ambiguous local deliverable. This prevents accidental deletion of active user work in the dirty worktree.

## Risks / Trade-offs

- [A local process is using a log, PID, or build directory] → Check listeners and running processes before deletion; do not remove active runtime state.
- [Moving a test breaks a relative import or an npm command] → Update all command paths atomically and run the moved Node tests plus frontend typecheck.
- [A generated file is actually a presentation or analysis deliverable] → Preserve `analytics/` and presentation artefacts in this change; report them separately.
- [Console-only development output is less convenient after a failure] → Keep terminal output visible and require an explicit debug workflow for any future persisted diagnostics.

## Migration Plan

1. Add and validate the skill and hygiene specification.
2. Move tests and update invocation paths.
3. Change the local launcher and ignore policy, then remove only confirmed inactive artefacts.
4. Run targeted tests, typecheck, strict OpenSpec validation, and a final ignored/untracked-file audit.
5. Roll back by restoring the moved test paths and launcher behavior from version control; deleted local generated files are recreated by their documented build or recording commands.

## Open Questions

- None for the safe cleanup scope. Retention of `analytics/` and presentation assets remains explicitly outside this change.
