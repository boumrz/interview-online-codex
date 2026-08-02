## 0. Validated test plan

**Owner:** specification-agent. **Scope:** OpenSpec planning only.

- [x] 0.1 Run `npx --yes @fission-ai/openspec@latest validate
  stabilize-room-e2e-selectors --strict` with an isolated temporary npm cache
  before any test-file edit. **Evidence:** strict validation passed using the
  isolated cache recorded in the specification handoff. Every later task depends
  on this green planning gate.

## 1. Test-first red evidence

**Owner:** developer-agent. **Scope:** test files only; do not change
application code, APIs, test IDs, dependencies, or other OpenSpec changes.

- [x] 1.1 Before any selector correction, run `npm run e2e:pdf-progress`
  against the existing configured E2E stack and record the red failure caused
  by unconditional activation of `room-rail-tasks` leaving
  `room-private-notes-input` unavailable. **Acceptance level:** E2E; record
  the command, failure signature, and environment URL.
- [x] 1.2 Before any selector correction, run `npm run e2e:task-lang-default`
  and record the red selector evidence: direct
  `[data-testid="create-task-language-select"]` count is `1`, while its
  descendant `input` count is `0`. **Acceptance level:** E2E; preserve the
  existing Python, Kotlin, and Plain text product assertions.
- [x] 1.3 Have `prompt-task-auditor-agent` confirm that the red baselines
  isolate selector setup failures from the PDF-progress and default-language
  behaviours being tested. **Evidence:** `2026-08-01` validator verdict
  `ready`; section 2 may perform only the two scoped test-only corrections.
- [x] 1.4 Have `prompt-task-auditor-agent` validate the additional executable
  two-panel-state assertion requested by `test-reviewer-agent`: it must prove
  both the already-open and deliberately closed panel branches inside the
  checked-in PDF E2E, not in a narrative-only browser probe. **Scope:** test
  code and this OpenSpec change only; do not change application code, APIs,
  test IDs, dependencies, or PDF product assertions. **Depends on:** 0.1 and
  the 3.5 review finding. **Evidence:** `2026-08-01` prompt-task-auditor
  verdict `ready`; only 2.3 and its green verification are now authorized.
- [x] 1.5 Have `prompt-task-auditor-agent` validate the QA-discovered initial
  closed-panel correction: the checked-in PDF E2E must invoke its idempotent
  helper *before* its first input-visibility wait, then exercise the already
  open and deliberately closed branches. **Scope:** the same test-only PDF
  script and this OpenSpec change; no product/API/test-ID/dependency change.
  **Depends on:** 0.1 and recorded QA-SEL-002. **Evidence:** QA-SEL-002 found
  that `privateNotesInput.waitFor({ state: "visible" })` preceded
  `openTasksPanelIfNeeded`, so a naturally closed panel timed out before the
  helper could run. QA-GAP-001 was the earlier, resolved two-branch-probe gap;
  it is not an alias or dependency for this correction. **Audit evidence:**
  `2026-08-01` prompt-task-auditor verdict `ready`; only the 2.3 test-only
  reorder and its 3.1 verification are authorized.

### Recorded red evidence

- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `npm run e2e:pdf-progress` — red: after the unconditional
  `room-rail-tasks` activation, `[data-testid="room-private-notes-input"]`
  did not become visible within 15 seconds.
- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `npm run e2e:task-lang-default` — red: descendant selector
  `[data-testid="create-task-language-select"] input` did not resolve within
  30 seconds. A direct browser diagnostic established direct test-ID count `1`
  and descendant-input count `0`, with the direct element an `INPUT` carrying
  value `Python`.

## 2. Test-only selector corrections

**Owner:** developer-agent. **Depends on:** 0.1, 1.1 and 1.2 recorded red, and
the `prompt-task-auditor-agent` ready verdict in 1.3.

- [x] 2.1 In `frontend/tests/e2e/authoring/e2e-pdf-export-progress.mjs`, add
  an idempotent open-if-needed helper: first check visibility of
  `room-private-notes-input`; activate `room-rail-tasks` only when the input is
  not visible and the control is available; then wait for the input. Do not add
  a retry that masks a failed panel or alter the PDF assertions.
- [x] 2.2 In
  `frontend/tests/e2e/authoring/e2e-task-create-language-default.mjs`, read
  `inputValue()` from the direct
  `[data-testid="create-task-language-select"]` locator rather than a
  descendant input. Do not weaken any of the three expected-language
  assertions.
- [x] 2.3 In `frontend/tests/e2e/authoring/e2e-pdf-export-progress.mjs`, remove
  the pre-helper direct input-visibility wait and first establish initial panel
  state through the existing idempotent helper (the room may initially arrive
  with the input hidden). Retain and reorder the existing checked-in deterministic
  probe rather than duplicating it: call the helper while the input is visible
  and assert the rail was not toggled; deliberately close the panel and assert
  the input is hidden; call the helper again and assert it opens the panel
  exactly once before continuing the unchanged PDF assertions. A missing or
  broken rail MUST still fail at the helper's input-visibility wait rather than
  being retried away. **Depends on:** 0.1, recorded 1.1 red evidence, and the
  renewed auditor-ready verdict in 1.5.

## 3. Green verification and handoff

**Owner:** developer-agent, qa-agent, test-reviewer-agent. **Depends on:**
section 2.

- [x] 3.1 Run `npm run e2e:pdf-progress` and confirm that the checked-in
  executable probe proves both already-open and closed-panel setup branches,
  including an initially closed room panel, then that the existing private-notes
  PDF progress, responsive checkbox, and recorded download assertions pass. A
  narrative-only browser probe is not sufficient evidence. **Depends on:** 2.1
  and 2.3.
- [x] 3.2 Run `npm run e2e:task-lang-default` and confirm that Python, Kotlin,
  and Plain text values pass through the direct Mantine input locator; a wrong
  product default must still fail with the explicit mismatch assertion.
- [x] 3.3 Run the neighbouring focused regressions `npm run e2e:private-notes`
  and `npm run e2e:plaintext-lang`; record commands and results. No frontend
  typecheck/build is required for these JavaScript test-only selector edits.
- [x] 3.4 Verify the changed-file boundary contains only the two E2E scripts
  and this change's OpenSpec artifacts; run
  `npx --yes @fission-ai/openspec@latest validate stabilize-room-e2e-selectors --strict`
  with an isolated temporary npm cache and record the green result.
- [x] 3.5 Have `qa-agent` and `test-reviewer-agent` review the focused results;
  hand the test-only scope to `product-owner-agent` for final acceptance before
  archive consideration. **Evidence:** `2026-08-01` QA verdict `ready` after
  QA-GAP-001 and QA-SEL-002 corrections; `test-reviewer-agent` verdict
  `approve`; `product-owner-agent` decision `accept`. No product behavior was
  changed.

### Recorded green evidence

- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `npm run e2e:pdf-progress` -- green: `PDF_EXPORT_PROGRESS_OK` with the
  recorded PDF file name. A controlled browser probe also exercised both panel
  initial states: already-open left the rail untouched; after `Escape` closed
  it, the visibility-first helper reopened it once (`PDF_PANEL_STATE_PROBE_OK
  already-open=untouched closed=reopened-once`).
- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `npm run e2e:task-lang-default` -- green:
  `TASK_CREATE_LANGUAGE_DEFAULT_OK` for Python, Kotlin, and Plain text through
  the direct `create-task-language-select` input locator.
- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `npm run e2e:private-notes` -- green: `PRIVATE_NOTES_SLASH_EXPORT_OK`.
- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `npm run e2e:plaintext-lang` -- green: `PLAINTEXT_LANGUAGE_OK`.
- `2026-08-01`, scoped `git status --short` and `git diff --check` -- the
  changed-file boundary contains only the two assigned E2E scripts and this
  change's OpenSpec artifacts; no whitespace errors. Unrelated concurrent
  worktree changes were left untouched and excluded from this scoped check.
- `2026-08-01`, isolated temporary npm cache,
  `npx --yes @fission-ai/openspec@latest validate
  stabilize-room-e2e-selectors --strict` -- green: `Change
  'stabilize-room-e2e-selectors' is valid`.
- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `E2E_API_URL=http://127.0.0.1:8080/api`, `npm run e2e:pdf-progress` --
  green: the checked-in executable probe emitted
  `PDF_PANEL_SETUP_PROBE_OK open=0 closed=1`, proving that the already-open
  helper branch made zero rail clicks and the deliberately closed-via-Escape
  branch made exactly one before the input became visible. The unchanged PDF flow then
  emitted `PDF_EXPORT_PROGRESS_OK` with its recorded PDF file name.
- `2026-08-01`, `E2E_BASE_URL=http://127.0.0.1:5173`,
  `E2E_API_URL=http://127.0.0.1:8080/api`, `npm run e2e:pdf-progress` --
  green after QA-SEL-002 correction: `openTasksPanelIfNeeded` established the
  initial panel state before any direct input-visibility wait; the checked-in
  probe emitted `PDF_PANEL_SETUP_PROBE_OK open=0 closed=1`, followed by
  `PDF_EXPORT_PROGRESS_OK`.
- `2026-08-01`, isolated temporary npm cache,
  `npx --yes @fission-ai/openspec@latest validate
  stabilize-room-e2e-selectors --strict` -- green after QA-SEL-002 correction:
  `Change 'stabilize-room-e2e-selectors' is valid`.
