## Why

Two independently reproduced browser E2E checks fail before exercising their
intended user-visible behaviour because their selectors assume an unstable DOM
state. The PDF-progress test can close the already-open room side panel, and the
task-language-default test looks for a descendant input even though Mantine puts
the test ID on the input itself. Stabilising those selectors restores trustworthy
automation without changing product behaviour.

## What Changes

- Make the PDF private-notes E2E open the relevant room side panel only when the
  private-notes input is not already visible; it MUST not toggle an open panel
  closed.
- Make the task-creation language E2E read the control carrying
  `data-testid="create-task-language-select"` directly, while retaining its
  Python, Kotlin, and Plain text default-language assertions.
- Record the exact red reproduction commands and require focused green reruns
  after the test-only selector corrections.
- Keep application code, UI semantics, APIs, dependencies, and test IDs
  unchanged.

## Capabilities

### New Capabilities

- `e2e-selector-reliability`: Browser acceptance automation locates controls by
  their actual, idempotently reachable UI state so selector mechanics do not
  obscure the product behaviour being checked.

### Modified Capabilities

- None.

## Impact

- `frontend/tests/e2e/authoring/e2e-pdf-export-progress.mjs`
- `frontend/tests/e2e/authoring/e2e-task-create-language-default.mjs`
- Focused frontend E2E execution evidence only; no production source, backend,
  data, realtime, API, dependency, or migration change.
