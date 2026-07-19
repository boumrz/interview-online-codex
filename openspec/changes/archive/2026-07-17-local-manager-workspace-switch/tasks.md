## 1. Specification and test-first acceptance

- [x] 1.1 Extend the three-participant step-publication E2E fixture with unique step code sentinels and a stable central-workspace hook; assert a local manager context changes while the server, candidate and another manager remain on the published task.
- [x] 1.2 Add the E2E checks for exact `Переключить` copy, target-aware accessible label, transparent-blue pill style, absence of the action on the active task, and no local preview write controls.
- [x] 1.3 Run the extended E2E before implementation and record the expected failure caused by the missing local workspace switch and old button treatment.

## 2. Secure workspace snapshot contract

- [x] 2.1 Add a manager-authorised room-task workspace snapshot endpoint with effective-language, code and briefing fallback rules; preserve the existing SSE room payload.
- [x] 2.2 Add backend tests for owner/interviewer access, candidate `403`, invalid task handling and persisted-value/fallback behaviour.

## 3. Local manager workspace and action presentation

- [x] 3.1 Fetch and cache an inactive task workspace only for an authorised manager selection; retain `localStepIntent` without emitting a room event.
- [x] 3.2 Render an isolated static read-only briefing/code preview for a manager-local non-published step; keep all shared editor, Yjs, language, briefing, focus and rating paths bound to the published step.
- [x] 3.3 Render the existing editable shared workspace only when the local and published step match; ensure remote publication preserves a different manager's local preview.
- [x] 3.4 Rename the publication action to `Переключить` and style it as a transparent-blue compact tag compatible with `Активен`.

## 4. Verification and completion

- [x] 4.1 Make the new E2E acceptance test pass and run the focused step-publication and Yjs/code-sync regression suites.
- [x] 4.2 Run backend tests for the endpoint plus frontend typecheck and production build.
- [x] 4.3 Strictly validate OpenSpec, mark completed tasks and archive the completed change.
