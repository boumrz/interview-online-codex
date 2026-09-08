# Delivery plan — simplify-hiring-terminology-and-picker

## Ownership and execution order

| Wave | Owner | Files / responsibility | Output | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Product Owner, Architect, Team Lead, Prompt/Task Auditor | OpenSpec change only | Scope, contract, and executable-task ready verdicts | — |
| 2 | Developer Agent — test ownership | `frontend/tests/unit/hiringManagerProductCopy.test.ts`, `frontend/tests/unit/hiringManagerPreviewCopy.test.ts`, `frontend/tests/e2e/hr/e2e-hr-cabinet.mjs`, `backend/src/test/kotlin/com/interviewonline/controller/HiringManagerPreviewIntegrationTest.kt`, `backend/src/test/kotlin/com/interviewonline/controller/HrRoomTrackingIntegrationTest.kt` | Test-only RED evidence; no production source edits in this wave | 1 |
| 3a | Developer Agent — account/dashboard copy | `frontend/src/pages/LoginPage.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/dashboard/HrProfileSection.tsx`, `frontend/src/pages/dashboard/dashboardConstants.ts`, `frontend/src/features/hr/CopyHrId.tsx` | Compact rendered role wording outside the picker | 2 |
| 3b | Developer Agent — room copy | `frontend/src/pages/RoomPage.tsx`, `frontend/src/features/room/TopBar.tsx`, `frontend/src/features/room/RoomInterviewPanel.tsx` | Compact rendered room wording, with no behavior change | 2 |
| 3c | Developer Agent — protected error copy | `backend/src/main/kotlin/com/interviewonline/controller/HiringManagerPreviewController.kt`, `RoomController.kt`; `backend/src/main/kotlin/com/interviewonline/service/HiringManagerPreviewService.kt`, `RoomService.kt`, `HrInterviewService.kt`, `RoomHrTrackingService.kt` | Compact API `error` values; unchanged contract/authority | 2 |
| 3d | Developer Agent — room-create picker | `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/dashboard/CreateRoomSection.tsx` | Explicit verified selected-list picker | 2 and 1.2 |
| 4 | Developer Agent, then reviewers | Changed sources and tests only | GREEN evidence, regressions, mutation evidence, review verdicts | 3a–3d |

The test owner may update selectors and fixture **expectations** that refer to
product copy. Existing test display names are user data and are not globally
renamed. Production identifiers, endpoint paths, JSON keys, database fields,
and helper/type/class names remain outside this change.

## 1. Scope, design, and readiness gates

- [x] 1.1 **Product Owner scope/value gate** — Confirm that the change only
  replaces user-visible Russian role wording and backend API `error` values;
  retains technical `HR`/hiring-manager identifiers; and introduces no
  directory/search, permission, public/guest, persistence, analytics, or
  realtime scope. Confirm the exact picker copy and success-clears /
  failure-retains contract in `design.md`. **Owner:** Product Owner. **Input:**
  proposal and both delta specs. **Output:** accepted scope record.

- [x] 1.2 **Architect contract/security gate** — Confirm reuse of the
  existing sequential `POST /api/me/hiring-manager-preview`, the local
  canonical selected list, and established `hiringManagerIds` payload;
  confirm server-side atomic create revalidation remains authoritative.
  Record the resolved pending-state rule: while one preview is outstanding,
  both the ID input and `Добавить` are disabled. Require a request/page/account
  generation or cancellation guard so obsolete responses cannot modify local
  state. **Owner:** Architect. **Input:** proposal, design, picker spec.
  **Output:** implementation seam and no-contract-drift decision.

- [x] 1.3 **Team Lead decomposition and Prompt/Task Auditor ready gate** —
  Review this ownership table and every task below. Do not permit production
  work until 2.1–2.4 have been authored and demonstrated RED for the stated
  missing behavior. Run:

  ```sh
  npx --yes @fission-ai/openspec@latest validate simplify-hiring-terminology-and-picker --strict
  ```

  **Owner:** Team Lead, then Prompt/Task Auditor. **Output:** `ready` verdict
  or concrete blocking gaps. Documentation/process work; no automated product
  test applies.

## 2. Tests authored and observed RED — production sources are frozen

- [x] 2.1 **Source-copy audit RED** — Test-only changes to
  `frontend/tests/unit/hiringManagerProductCopy.test.ts` and
  `frontend/tests/unit/hiringManagerPreviewCopy.test.ts` SHALL:

  - scan quoted/rendered frontend candidates in the nine product surfaces
    listed in the ownership table, and server-created API
    error literals in the six controller/service files named in 3c;
  - reject every grammatical Russian product/API occurrence of `нанимающий
    менеджер`, while explicitly excluding technical identifiers and
    user-provided display-name/test-fixture data;
  - assert the picker’s exact label, placeholder, description, add button,
    pending text, feedback, selected-list heading, visual remove text, and
    target-specific accessible remove name; and
  - assert that a textarea, delimiter/batch parser, or optimistic preview copy
    is not the picker contract.

  Run and record RED caused by the present long product/API copy and textarea:

  ```sh
  (cd frontend && node --experimental-strip-types --test tests/unit/hiringManagerProductCopy.test.ts tests/unit/hiringManagerPreviewCopy.test.ts)
  ```

  **Owner:** Developer Agent (test ownership). **Input:** delta specs and
  source inventory. **Output:** failing source-copy evidence only. **Test
  level exception:** static audit makes the exhaustive literal requirement
  verifiable; it supplements rather than replaces E2E. **Depends on:** 1.1–1.3.

- [x] 2.2 **Browser RED: global compact-copy journey** — In
  `frontend/tests/e2e/hr/e2e-hr-cabinet.mjs`, update product selectors and add
  representative assertions for registration/profile enable and opt-out,
  cabinet navigation and copied invitation ID, room participant assignment and
  removal, candidate-and-hiring dialog, empty state, notifications, and
  create-error feedback. Each exercised product surface SHALL use the
  grammatical compact form and no visible role label/action/result shall say
  `нанимающий менеджер`. Preserve user-display-name fixture values as data.
  Run and record RED because the application still renders the longer copy:

  ```sh
  E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm --prefix frontend run e2e:hr-cabinet
  ```

  **Owner:** Developer Agent (test ownership). **Input:** terminology spec.
  **Output:** failing user-observable global-copy evidence. **Test level:**
  E2E. **Depends on:** 1.1–1.3 and 2.1.

- [x] 2.3 **Browser RED: authenticated picker journey** — In the same E2E
  file, replace textarea/debounced-list scenarios with one-ID picker
  scenarios. Assert all of the following before production code is changed:

  - public/guest UI has no input, list, or preview request;
  - a blank or malformed UUID retains the input, shows its exact feedback, and
    makes no lookup; an unavailable result and a retryable failure retain it,
    expose no name, and append nobody;
  - successful click and Enter each make one preview request, show
    `Проверяем нанимающего…`, disable both the ID input and `Добавить`, do not
    submit the room, then clear only after a verified append and announce the
    exact success message;
  - two sequential verified people appear under `Добавленные нанимающие`; a
    case-varied duplicate retains its text, performs no lookup, and appends no
    second row;
  - the named `Удалить нанимающего {displayName}` action removes locally with
    no network request and a subsequent create payload contains only remaining
    canonical selected IDs, never typed-but-unadded, removed, or pending IDs;
  - room submission and picker controls are disabled during create; a stale
    eligibility rejection keeps title/tasks/selections with the compact error;
    obsolete/unmounted or superseded preview responses cannot clear, append,
    or replace feedback.

  Run the command from 2.2 and record RED specifically because the existing
  textarea/batch-preview interaction cannot satisfy it. **Owner:** Developer
  Agent (test ownership). **Input:** picker spec and architect decision.
  **Output:** failing E2E picker evidence. **Test level:** E2E. **Depends on:**
  1.1–1.3 and 2.1.

- [x] 2.4 **Backend integration RED: compact protected errors, same authority**
  — Update test expectations only in
  `HiringManagerPreviewIntegrationTest.kt` and `HrRoomTrackingIntegrationTest.kt`
  for compact role error bodies. Preserve or add direct assertions for their
  current status codes, authentication/public rejection, strict UUID parsing,
  opaque unavailable response, privacy/no-store behavior, no-preview-write,
  and atomic room-create eligibility revalidation/no partial assignment. Run:

  ```sh
  env JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home PATH=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin:$PATH mvn -f backend/pom.xml -Dtest=HiringManagerPreviewIntegrationTest,HrRoomTrackingIntegrationTest test
  ```

  Record RED due to old error literals, not test-fixture or environment
  failure. **Owner:** Developer Agent (test ownership). **Input:** terminology
  and picker specs. **Output:** failing protected-HTTP evidence. **Test level
  exception:** direct authorization, privacy headers, and atomic rejection are
  more reliable at integration level. **Depends on:** 1.1–1.3 and 2.1.

## 3. Production implementation after recorded RED evidence

- [x] 3.1 **Account/dashboard compact terminology** — Change only rendered
  role literals in `LoginPage.tsx`, `DashboardPage.tsx`,
  `HrProfileSection.tsx`, `dashboardConstants.ts`, and `CopyHrId.tsx` to the
  grammatically correct `нанимающий` variant. Keep profile toggle behavior,
  cabinet eligibility, focus/accessibility, and all technical names intact.
  **Owner:** Developer Agent — account/dashboard copy. **Input:** observed RED
  from 2.1–2.2. **Output:** compact account/dashboard product copy. **Depends
  on:** 2.1 and 2.2.

- [x] 3.2 **Room compact terminology** — Change only user-visible Russian role
  literals in `RoomPage.tsx`, `TopBar.tsx`, and `RoomInterviewPanel.tsx` to
  grammatical compact forms, including dialogs, menu labels, accessible names,
  pending status, empty states, toasts, and error fallback. Preserve room
  authority, assignment/removal side effects, and realtime behavior.
  **Owner:** Developer Agent — room copy. **Input:** observed RED from 2.1–2.2.
  **Output:** compact room product copy. **Depends on:** 2.1 and 2.2.

- [x] 3.3 **Protected backend error terminology** — Change only API-visible
  `error` strings in `HiringManagerPreviewController.kt`, `RoomController.kt`,
  `HiringManagerPreviewService.kt`, `RoomService.kt`, `HrInterviewService.kt`,
  and `RoomHrTrackingService.kt`. Keep paths, JSON keys, statuses, headers,
  opaque target outcomes, authorization, storage, and realtime semantics
  byte-for-byte compatible except for the requested Russian copy.
  **Owner:** Developer Agent — protected error copy. **Input:** observed RED
  from 2.1 and 2.4. **Output:** compact protected API error copy. **Depends
  on:** 2.1 and 2.4.

- [x] 3.4 **Authenticated single-ID hiring picker** — In `DashboardPage.tsx`
  and `CreateRoomSection.tsx`, replace the delimited textarea draft and
  debounce/batch preview state with an in-memory canonical selected-item list
  (`normalizedId`, `displayName`) plus one draft input. Implement the exact
  add/Enter validation, sequential preview, success/error/live-region copy,
  named local removal, payload mapping, and page/account/request generation
  guard specified in the picker delta. During preview, disable **both** the
  input and add button; during room submission disable input, add, and every
  remove action. Reuse existing preview/create API hooks and send only current
  selected canonical IDs through `hiringManagerIds`; add no endpoint, write,
  persistence, directory, or realtime feature.
  **Owner:** Developer Agent — room-create picker. **Input:** architect
  decision and observed RED from 2.1–2.4. **Output:** accessible verified
  picker. **Depends on:** 1.2 and 2.1–2.4.

## 4. GREEN verification and regression

- [x] 4.1 **Targeted GREEN** — Rerun the exact commands from 2.1, 2.2, and
  2.4 after 3.1–3.4. Confirm every scenario in 2.2–2.4 is green, especially
  failed-input retention, success-only clearing, pending input/add disablement,
  no lookup for local failures/duplicates, accessible removal, selected-only
  canonical payload, stale-result suppression, atomic server revalidation,
  guest absence, and global copy. **Owner:** Developer Agent. **Input:** all
  production tasks. **Output:** targeted GREEN logs. **Depends on:** 3.1–3.4.

- [x] 4.2 **Regression GREEN** — Run:

  ```sh
  npm --prefix frontend run typecheck
  npm --prefix frontend run build
  E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm --prefix frontend run e2e:roles
  E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm --prefix frontend run e2e:account-binding
  E2E_BASE_URL=http://localhost:5173 E2E_API_URL=http://localhost:8080/api npm --prefix frontend run e2e:room
  env JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home PATH=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin:$PATH mvn -f backend/pom.xml test
  git diff --check
  ```

  Confirm profile opt-out, cabinet access, room assignment/removal, guest
  restrictions, and existing room creation still work. **Owner:** Developer
  Agent. **Output:** regression evidence. **Depends on:** 4.1.

- [x] 4.3 **Manual mutation evidence** — If the repository still has no
  mutation-test configuration, make and immediately restore in a disposable
  working copy (a) one compact picker literal mutation and (b) one
  selected-ID/duplicate-guard mutation. Demonstrate that the focused source
  audit or E2E fails for each mutation, then rerun GREEN. Do not commit either
  mutation. **Owner:** Developer Agent. **Output:** two killed-mutation notes.
  **Depends on:** 4.1. **Recorded:** changing the exact picker label to `ID роли`
  made `hiringManagerPreviewCopy.test.ts` fail; sending an empty
  `hiringManagerIds` array made the focused browser payload assertion fail.
  Both mutations were restored and their tests rerun GREEN.

## 5. Post-GREEN review and close

- [x] 5.1 **Solution review** — Check both delta specs against the diff for
  contract drift, global-copy omissions, picker race/state errors, payload
  mapping, and regression risk. **Owner:** Solution Reviewer. **Depends on:**
  4.1–4.3.

- [x] 5.2 **Security and reliability review** — Verify unchanged server-side
  authorization, opaque errors, no enumeration/preview write, headers, atomic
  revalidation, public/guest rejection, obsolete-response safety, and no new
  realtime/reconnect responsibility. Blocking finding stops release.
  **Owner:** Security & Reliability Reviewer. **Depends on:** 5.1.

- [x] 5.3 **QA, test, and UX review** — QA validates the recorded acceptance
  evidence; Test Reviewer checks error/race/permission coverage; UX Critic
  checks Russian grammar, exact copy, one-ID/Enter flow, pending disabled
  state, removal clarity, focus, and live announcements. **Owners:** QA,
  Test Reviewer, UX Critic. **Depends on:** 5.2.

- [x] 5.4 **Product and final task-audit acceptance** — Product Owner accepts
  the global compact wording and add/list interaction. Prompt/Task Auditor
  confirms every checkbox, RED/GREEN artifact, review outcome, and strict
  validation is complete without a blocker. **Depends on:** 5.3. **Recorded:**
  product acceptance and final task audit returned `ready`.

- [x] 5.5 **Reconcile OpenSpec** — Record evidence and completed task states,
  then run:

  ```sh
  npx --yes @fission-ai/openspec@latest validate simplify-hiring-terminology-and-picker --strict
  ```

  Archive only after an explicit release decision. **Owner:** Team Lead.
  Documentation/process verification; automated product test not applicable.
  **Depends on:** 5.4. **Recorded:** strict validation passed; this change is
  intentionally not archived.
