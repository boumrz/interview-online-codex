# Frontend implementation verification

## Scope

- Implemented HR-040 through HR-045 under `frontend/src/**`.
- Root owns the browser acceptance script and task checkboxes; neither was edited by the frontend worker.
- Backend implementation and migrations remain owned by the backend worker.

## Static verification

- `npm --prefix frontend run typecheck` -> exit 0.
- `npm --prefix frontend run build` -> exit 0. Rspack reported only the repository's existing asset/entrypoint size warnings and produced compressed assets successfully.
- `git diff --check -- frontend/src` -> exit 0.

## Integrated browser verification

Root ran the five-scenario HR browser acceptance suite against frontend `http://localhost:5174` and a clean-V9 backend at `http://localhost:18082`.

- Result: 5 passed, 0 failed, 0 skipped, 24.2 seconds.
- Covered optional HR registration, existing-account opt-in, stable/copyable UUID, and same-browser account isolation.
- Covered candidate exclusion, authenticated-HR automatic tracking only after manager admission, role revocation, and recoverable list refresh failure.
- Covered manager metadata, a real HTTP 409 retaining the local draft, explicit reload, repeated invitation, and guest-interviewer event-token invitation.
- Covered all-time/inclusive Moscow date filters, valid empty XLSX, binary download validation, HTTP 503 no-download behavior, and manual retry.
- Covered tracked-room archive history, connected and reloaded terminal room state, and no realtime requests after terminal detection.

Root will rerun the suite against the final backend locking implementation and V8-to-V9 migration runtime before project acceptance.

## Review revisions

The solution review identified four lifecycle and responsive-layout gaps. Root added browser acceptance scenarios before the production revisions and confirmed each executable behavior failed for the expected reason:

- A delayed export still downloaded after logout.
- A direct realtime relay `410` did not render the terminal room state.
- A fresh anonymous archived-room `GET 410` remained on the loading screen.
- A delayed private metadata response survived demotion and RTK pending-query deduplication, then replaced the fresh value after access was restored.

The frontend revision now:

- aborts and generation-guards direct workbook downloads across token changes and unmounts;
- treats persisted `410` responses from room GET, main relay, activity relay, and fire-and-forget presence paths as terminal;
- aborts and generation-guards private-panel load/save/invite requests on close, role loss, unmount, room change, and identity change, while giving each load generation a distinct RTK query key;
- places the HR cabinet directly after the section navigation and hides generic profile/stat cards in the HR section; and
- gives the new cabinet and manager-panel actions a mobile-only 44 px minimum touch target, with full-width mobile toolbar and row actions.

Static verification after these revisions:

- `npm --prefix frontend run typecheck` -> exit 0.
- `npm --prefix frontend run build` -> exit 0 with only the existing asset/entrypoint size warnings.
- `git diff --check -- frontend/src` -> exit 0.
- Focused acceptance rerun for the four review regressions -> 4 passed, 0 failed, 0 skipped in 8.3 seconds.
- A finished empty HR cabinet remained stable for 1.5 seconds after its heading appeared: 0 console errors and 0 `Maximum update depth exceeded` errors.

Root owns the final nine-scenario integrated browser rerun and will append or incorporate its result in project-level acceptance evidence.
