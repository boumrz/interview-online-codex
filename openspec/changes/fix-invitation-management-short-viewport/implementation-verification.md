# Implementation verification

## Task 1.1 — test-first short-viewport evidence

Date: 2026-09-19

### Frozen acceptance coverage

`frontend/tests/e2e/teams/e2e-team-invitation-management.mjs` now registers
two independent, top-level Node E2E cases rather than a matrix loop:

- `BUG-AC03-QA-001`: `1280×720 → 640×360`
- `BUG-AC03-QA-002`: `768×1024 → 384×512`

Each case owns a unique management fixture and independently closes all browser
contexts. The isolated launcher drops its disposable PostgreSQL schema after
the suite. The frozen test contract covers keyboard-only OWNER and ADMIN
create, forced copy failure, retry copy, dismissal, reissue and revoke; it
also includes the MEMBER no-controls/no-mutation/no-horizontal-overflow
boundary, long Russian team-header accessible name, state-by-state target
geometry, visible focus, minimum target size, viewport containment,
interactive-surface non-occlusion and raw-link lifecycle assertions. Test
errors redact raw invitation secrets.

### Test-review remediation

Following the task 1.2 review, the frozen test contract was strengthened before
any production work:

- `Создать приглашение` is now included in the focus, target-size, viewport,
  non-occlusion and horizontal-overflow checks in `LINK_VISIBLE`,
  `COPY_FAILED` and `REISSUED` states, alongside the state-specific actions.
- The MEMBER invitation-mutation observer is attached to the page before its
  initial navigation, so it covers mount/render and subsequent keyboard
  traversal in both named cells.
- `withRedactedSecrets` recursively redacts string values in error message,
  stack, actual, expected and nested cause objects. A focused regression test
  proves an intentionally nested error containing a synthetic secret reaches
  reporting with no such value retained.

### Isolated RED run

Command:

```sh
E2E_TEAM_INVITATIONS_PORT=18180 \
E2E_TEAM_INVITATIONS_WEB_PORT=15180 \
npm run e2e:team-invitations
```

The ports were confirmed unused before the run. The launcher started a
feature-on backend at `127.0.0.1:18180`, a frontend at
`127.0.0.1:15180`, and a disposable schema; it then shut both down and dropped
the schema. The user's persistent runtime at `:8080/:5173` was not stopped or
modified.

The established invitation suites passed (`8/8` membership and `6/6`
management lifecycle cases). The two new cells failed independently for the
specified user-visible behaviour:

| Cell | Result | Reproducible evidence | Classification |
| --- | --- | --- | --- |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | RED | `BUG_AC03_QA_001_1280x720_TO_640x360_OWNER_LINK_VISIBLE_REVOKE_VERTICALLY_CLIPPED` | OWNER reaches the rendered revoke action by `Tab`, but its focus target and outline remain below the visual viewport while a raw link is displayed. |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | RED | `BUG_AC03_QA_002_768x1024_TO_384x512_OWNER_COPY_RETRIED_REISSUE_NOT_VISIBLE` | After keyboard retry-copy succeeds and the raw link is scrubbed, the required reissue action is not visibly available for the next keyboard state. |

Neither failure is a test-environment failure: the same isolated backend,
frontend, fixture bootstrap, feature gate and disposable schema completed the
pre-existing role and secret-lifecycle coverage successfully, and the two
named test failures are stable DOM/geometry assertions. No raw invitation URL
or secret is present in this evidence.

### Gate result

At least one named cell is behaviourally RED (both are RED). No production
file has been edited. Task 1.2 must review this frozen test and RED evidence
before task 2.1 may make a narrowly scoped component/CSS correction.

### Fresh isolated rerun after test-review remediation

Command:

```sh
E2E_TEAM_INVITATIONS_PORT=18184 \
E2E_TEAM_INVITATIONS_WEB_PORT=15184 \
npm run e2e:team-invitations
```

The pair was unused before start. The launcher again used an isolated
feature-on backend/frontend and disposable schema, then shut down both
processes and dropped that schema. The secret-redaction regression passed,
as did the established suites (`8/8` membership and `7/7` management,
including the focused redaction assertion). The user's `:8080/:5173` runtime
was not touched.

| Cell | Result | Reproducible evidence | Classification |
| --- | --- | --- | --- |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | RED | `BUG_AC03_QA_001_1280x720_TO_640x360_OWNER_LINK_VISIBLE_REVOKE_VERTICALLY_CLIPPED` | After the strengthened link-visible control checks, OWNER still reaches revoke by keyboard while its target/focus outline remains below the visual viewport. |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | RED | `BUG_AC03_QA_002_768x1024_TO_384x512_OWNER_COPY_DISAPPEARED_DURING_KEYBOARD_NAVIGATION` | OWNER's copy action is no longer rendered after the keyboard traversal that verifies every permitted link-visible action, so it cannot be activated for the forced copy-failure/retry state. |

These remain behavioural RED results rather than environment failures: both
isolated fixture/runtime lifecycles and all prerequisite suites completed,
while each named cell reached a deterministic DOM/geometry assertion. The
failure output and this evidence contain no raw invitation secret.

## Task 2.1 — scoped investigation paused for architecture/spec review

Task 1.2 authorized a minimal component/CSS experiment. Only the allowlisted
production paths were touched:

- `frontend/src/features/workspace/TeamInvitationManagement.tsx`
- `frontend/src/features/workspace/TeamInvitationManagement.module.css`

The attempt keeps normal document flow, reflows action groups using minimum
width/flex constraints, and gives focused buttons `scroll-margin-block: 96px
24px` to clear the existing workspace header. It adds no media query,
fixed/sticky action bar, JavaScript scrolling, API/role/feature-flag change,
or raw-link persistence. The component experiment also used native focus
placement and state-specific DOM order for the single existing create action;
it introduced neither a second concurrent control nor a raw invitation secret
outside the rendered one-time-link state.

Fresh isolated execution after that scoped work:

```sh
E2E_TEAM_INVITATIONS_PORT=18195 \
E2E_TEAM_INVITATIONS_WEB_PORT=15195 \
npm run e2e:team-invitations
```

The explicit pair was unused before launch. The launcher created and dropped
its disposable schema and stopped its own `:18195/:15195` processes on exit.
The user's processes remained live: PID `82541` at `:8080` and PID `82542` at
`:5173`.

| Coverage | Result |
| --- | --- |
| Existing membership suite | GREEN (`8/8`) |
| Existing management lifecycle/redaction suite | GREEN (`7/7`) |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | RED: reissue target detached while `Tab` attempted to reach it after copy success. |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | RED: the same rendered-control disappearance after copy success. |

The final two failures are not environment failures. After the focused raw-link
button unmounts on successful copy, the next keyboard focus can trigger the
parent workspace's existing focus revalidation. That remount drops this
component's in-memory pending-invitation metadata, so its reissue control
detaches. CSS geometry alone cannot retain a rendered control across that
parent remount. The available narrow behavioural remedy would reuse the
component's pre-existing metadata-recovery mechanism with metadata only (never
a raw URL), but that changes the invitation state/recovery boundary and is
outside task 2.1's authorized wrapping/min-width/focus-spacing scope.

Implementation is therefore paused at the parent's instruction. No metadata or
state-lifecycle change was applied, task 2.1 remains incomplete, and the
current scoped diff is retained for architecture/spec review. All evidence here
is secret-redacted.

## Task 1.3 — expanded remount-recovery contract, RED before implementation

Date: 2026-09-19

`frontend/tests/e2e/teams/e2e-team-invitation-management.mjs` now freezes the
expanded task 1.3 contract in the two existing independently registered
top-level cases. Each cell owns a separate fixture and context cleanup:

- `BUG-AC03-QA-001`: `1280×720 → 640×360`
- `BUG-AC03-QA-002`: `768×1024 → 384×512`

The OWNER and ADMIN paths are keyboard-only and cover create, forced copy
failure/retry, successful copy, parent remount, current-ID reissue,
replacement dismissal/remount, exact replacement-ID revoke and revoked-state
cleanup. They keep per-state long-header, focus visibility, minimum target
size, visual-viewport, no-horizontal-overflow and non-occlusion assertions.
The test retains actual old `ElementHandle` objects, opens a real second tab in
the same context, pre-arms the exact target-page `GET /api/teams/{teamId}` and
uses `targetPage.bringToFront()` to await the real parent revalidation. It never
dispatches focus or visibility from page JavaScript.

It additionally freezes these negative/cleanup boundaries in each cell:

- MEMBER's invitation-mutation observer attaches before initial navigation and
  proves mount, remount and keyboard traversal expose no invitation controls or
  mutations and no horizontal overflow.
- The unavailable path intercepts exactly one real foreground-focus detail GET
  only, responds with `404 TEAM_NOT_FOUND`, expects the normal «Команда
  недоступна» UI, old control detachment, no invitation mutation and no raw
  invitation surface. Invitation POSTs are not intercepted or fabricated.
- Separate real keyboard logout/login returns through «Выйти», login fields,
  workspace switcher and team navigation; it proves the old action stays
  detached and a recovered action cannot return or mutate after account
  cleanup.
- Every captured invitation secret is recursively redacted from error data and
  exact-secret absence remains checked in DOM text/HTML, URL, history,
  `localStorage` and `sessionStorage`.

### Isolated execution and classification

The full unchanged invitation runner was started with explicit, unused custom
ports; it owned and then released its backend/frontend processes and disposable
PostgreSQL schema. It did not alter the persistent user runtime at `:8080` or
`:5173`.

```sh
E2E_TEAM_INVITATIONS_PORT=18196 \
E2E_TEAM_INVITATIONS_WEB_PORT=15196 \
npm run e2e:team-invitations
```

The existing membership contract completed on the isolated service. Both new
named cells then reached a rendered, deterministic recovery boundary rather
than a fixture, port, browser or backend-start failure:

| Cell | Result | Frozen rendered evidence | Classification |
| --- | --- | --- | --- |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | RED | after actual target-page foreground revalidation, preserved reissue/revoke handles disconnect and `BUG_AC03_QA_001_1280x720_TO_640x360_OWNER_COPY_SUCCESS_REMOUNT_REISSUE_NOT_RECOVERED` is asserted before any recovered-action query can proceed | Behavioural RED: the current parent remount drops current pending-invitation recovery metadata. |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | RED | the same real two-tab lifecycle produces `BUG_AC03_QA_002_768x1024_TO_384x512_OWNER_COPY_SUCCESS_REMOUNT_REISSUE_NOT_RECOVERED` | Behavioural RED: the tablet-height cell lacks the same recovered pending action. |

The red path retains the old action-handle disconnection proof, so it is not a
false expectation that a still-mounted action merely became hidden. The
contract continues the independently scoped MEMBER, unavailable-404 and
keyboard logout/login paths after a role failure to retain their negative-path
coverage. No raw invitation URL or token is printed in this record.

Additional fresh explicit pairs were used while validating isolated startup and
teardown (`18197/15197`, `18201/15201`, `18202/15202`); a test-name filtering
probe that either created concurrent fixtures or skipped all membership tests
was discarded as non-evidence. It made no repository or user-runtime change.
The only authoritative classification is the unfiltered full-run contract
above.

### Gate result

Task 1.3 is complete as a test-first, deterministic behavioural RED. The next
owner is `test-reviewer-agent` for task 1.4. Production recovery remains
unauthorized until that gate approves the frozen contract.

## Task 1.3a — opt-in headed real-tab lifecycle preparation

Date: 2026-09-19

The acceptance test now recognizes only the explicit
`E2E_TEAM_INVITATIONS_HEADED_FOCUS=1` opt-in for the positive OWNER/ADMIN
real-tab lifecycle portion of each existing named viewport cell. With that
opt-in, each positive OWNER/ADMIN execution creates and closes its own
temporary headed Chromium; the shared browser and ordinary invitation cases
remain headless.

Before the headed target page navigates, a test-only init script observes only
`blur`, `focus` and `visibilitychange`. It stores each event's type, order,
timestamp and visibility state. It neither dispatches an event nor calls an
application/private-state seam, CDP command, direct fetch, reload or positive
route mock. The headed lifecycle helper requires a target hidden-or-blur
witness followed by a visible focus-or-visibility witness. It pre-arms the
unmocked exact detail request/response before foregrounding the original tab,
requires the resulting `GET /api/teams/{teamId}` to follow the visible witness,
and leaves the existing `200`, old-action-handle-detachment and keyboard-reachable
current-control assertions in force.

Without the opt-in, Chromium remains headless and the named OWNER/ADMIN path
retains its keyboard create/copy failure/retry, secret-scrub and geometry
coverage through successful copy, then deliberately stops before claiming a
positive real-tab lifecycle verdict. The existing MEMBER, unavailable-404 and
keyboard logout/relogin helpers remain headless and unchanged in meaning.

No headed browser was launched while preparing this test change, so there is
no GREEN, RED or test-environment classification for task 1.3a yet. A future
authorized run must use fresh explicit isolated ports and record the event
witness, exact `200`, detached handle, recovered control and cleanup without
recording invitation secrets.

### Authorized headed execution — test-environment result

The explicitly approved command was run once from `frontend` after announcing
that a temporary visible Chromium might take OS focus:

```sh
E2E_TEAM_INVITATIONS_HEADED_FOCUS=1 \
E2E_TEAM_INVITATIONS_PORT=18214 \
E2E_TEAM_INVITATIONS_WEB_PORT=15214 \
npm run e2e:team-invitations
```

Both ports were unused before launch. The ordinary isolated membership suite
completed `8/8`, and the existing management lifecycle/redaction suite
completed `7/7`. Each OWNER and ADMIN positive lifecycle execution launched
and closed its separate headed browser/context as designed.

| Cell | Positive real-tab result | Classification |
| --- | --- | --- |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | Both OWNER and ADMIN timed out waiting for the observer-only target-page hidden-or-blur witness immediately after foregrounding the real second tab. No eligible post-visible exact detail GET, `200`, old-handle detachment or recovered-control assertion was reached. | Test-environment failure |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | The same missing hidden-or-blur witness occurred for both OWNER and ADMIN before the positive request observers were armed. | Test-environment failure |

The unchanged headless MEMBER, unavailable-404 and logout/relogin helpers also
retain their known exact-detail-GET timeouts under Playwright tab foregrounding;
they are not positive headed lifecycle evidence. The absence of the required
headed witness is therefore not a rendered behavioural RED and cannot be
called GREEN. No raw invitation URL or token is included in this record.

The runner released `18214` and `15214`, closed all temporary Playwright
browser descendants, stopped its isolated backend/frontend, and dropped its
disposable schema. The persistent user runtime remained live at `:8080`
(PID `82632`) and `:5173` (PID `82572`). No production, CSS, launcher,
fixture, configuration or API file was changed by task 1.3a.

## Task 1.4 — first gate and architecture revision

Date: 2026-09-20

The first task 1.4 prompt/task audit and test-review gates did not approve
production task 2.1. Both reviewers accepted the deterministic task 1.3
metadata-remount RED for `BUG-AC03-QA-001` and `BUG-AC03-QA-002`, including
old action-handle detachment, role coverage, negative MEMBER/unavailable
boundaries and secret-safe reporting. They rejected opening task 2.1 under the
then-current wording because task 1.3a's headed positive lifecycle remained a
test-environment failure and the separate native harness had no manual witness.

The architect then reviewed this change together with
`build-native-ax-lifecycle-harness` and returned `revise-contract`. The
architecture decision is `INVITATION-LIFECYCLE-GATE-REVISION`:

- deterministic rendered parent-remount RED is the pre-implementation authority
  for the bounded metadata-only component/CSS correction;
- headed Chromium and native AX attempts are supporting evidence only;
- absent display/event/manual witness remains TE/manual-supporting, never
  GREEN, but also not a task-2.1 blocker;
- production scope remains limited to
  `TeamInvitationManagement.tsx` and
  `TeamInvitationManagement.module.css`;
- no backend/API/RTK/launcher/fixture/feature-flag/storage/parent-page/mobile
  scope is added;
- recovery may contain only non-secret pending invitation metadata and must not
  persist raw URL, invitation token, auth token or idempotency key.

OpenSpec artifacts were updated to reflect this gate revision before requesting
a repeated task 1.4 audit/test-review. No product code was changed by this
revision.

## Task 1.4 — executable contract restored after review

Date: 2026-09-20

The repeated task 1.4 prompt/task audit and test-review found that the current
E2E file no longer executed the deterministic remount/recovery assertions in
the default run and that `foregroundForTeamRevalidation` synthesized lifecycle
events. The E2E contract was corrected before production work:

- default non-headed runs no longer return after copy success; they continue
  into the metadata-remount, reissue, replacement, revoke, MEMBER,
  unavailable and logout/relogin assertions;
- `foregroundForTeamRevalidation` now uses a deterministic same-route
  revalidation marker (`__ac03Revalidation`) in ordinary headless runs, pre-arms
  the exact team detail GET on the target page and awaits the resulting parent
  remount;
- synthetic `visibilitychange`/`focus` dispatch was removed from the team
  revalidation helper;
- hidden/visible lifecycle-event assertions are only required when the explicit
  headed supporting mode is enabled.

Fresh isolated default run:

```sh
E2E_TEAM_INVITATIONS_PORT=18220 \
E2E_TEAM_INVITATIONS_WEB_PORT=15220 \
npm run e2e:team-invitations
```

The runner used isolated `127.0.0.1:18220` and `127.0.0.1:15220` services,
created and dropped its disposable PostgreSQL schema, and did not use or
restart the user's `:8080/:5173` runtime. Result:

| Coverage | Result |
| --- | --- |
| Existing membership suite | GREEN, 8/8 |
| Existing management/continuity/roster suite before short-viewport cells | GREEN, 11/11 |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | RED with `BUG_AC03_QA_001_1280x720_TO_640x360_TASK_1_3_BEHAVIOURAL_CONTRACT_FAILED` |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | RED with `BUG_AC03_QA_002_768x1024_TO_384x512_TASK_1_3_BEHAVIOURAL_CONTRACT_FAILED` |
| `teams/invitation-native-ax-lifecycle` | skipped because native opt-ins were absent |

This is the current executable pre-implementation RED: both named cells now
reach the restored deterministic task 1.3 contract in the default runner, while
headed/native evidence remains supporting-only and not GREEN. No product code
was changed by this test-contract correction.

Repeated task 1.4 gates after this evidence:

| Gate | Verdict | Notes |
| --- | --- | --- |
| Prompt/task auditor | ready | Accepted restored deterministic RED, rendered same-context remount helper and narrow task 2.1 scope. |
| Test reviewer | ready | Accepted coverage for OWNER/ADMIN remount recovery, MEMBER/unavailable/logout boundaries, secret absence and supporting-only headed/native classification. |

Task 2.1 may start after these two `ready` verdicts, limited to
`TeamInvitationManagement.tsx` and `TeamInvitationManagement.module.css`.

## Task 2.1 — metadata-only recovery and short-viewport GREEN

Date: 2026-09-20

Only the allowlisted production component path was changed:

- `frontend/src/features/workspace/TeamInvitationManagement.tsx`

The component now keeps an in-memory, account-and-team-scoped recovery record
for the current pending invitation. The record contains only `id`, `state`,
`role` and `expiresAt`; it stores no raw URL, invitation token, auth token,
idempotency key, browser storage value or URL/history state. A recovered card
uses `revision: -1` only as a local marker, resolves a fresh server revision
from `listTeamInvitations` immediately before reissue/revoke, replaces the
metadata after a successful reissue and clears it after revoke or a list result
without a pending invitation. Existing account/team/logout cleanup remains the
rendering boundary.

The E2E harness also received two contract corrections before the GREEN run:

- the browser init script now reseeds only auth storage once, but reinstalls the
  clipboard observer on every new document after same-route remount;
- the reissued-state assertion now checks revoke on the replacement invitation
  ID, matching the frozen spec's original-vs-replacement request identity
  requirement.

Fresh isolated GREEN run:

```sh
E2E_TEAM_INVITATIONS_PORT=18227 \
E2E_TEAM_INVITATIONS_WEB_PORT=15227 \
npm run e2e:team-invitations
```

The runner used isolated `127.0.0.1:18227` and `127.0.0.1:15227` services,
created disposable schema
`team_invitations_e2e_6e48ce1582bf439885e871d4b32f5bd4`, then shut down its
own backend/frontend processes and dropped the schema. The user's `:8080/:5173`
runtime was not stopped or restarted. Result:

| Coverage | Result |
| --- | --- |
| Existing invitation acceptance suite | GREEN, 8/8 |
| Existing management/continuity/roster suite before short-viewport cells | GREEN, 11/11 |
| `BUG-AC03-QA-001` — `1280×720 → 640×360` | GREEN |
| `BUG-AC03-QA-002` — `768×1024 → 384×512` | GREEN |
| `teams/invitation-native-ax-lifecycle` | skipped because native opt-ins were absent |

Node reported `13` passing tests, `0` failures and `1` skipped native-AX case
for the management runner after the membership runner passed `8/8`. The GREEN
coverage includes OWNER/ADMIN same-route remount recovery, exact original
reissue/replacement revoke identity, MEMBER/unavailable denial, keyboard
logout/relogin cleanup, no duplicate create, secret absence and state-by-state
short-viewport geometry. No raw invitation secret is recorded in this evidence.

## Task 3.1 — regression verification in progress

Date: 2026-09-20

Passing checks after task 2.1:

```sh
cd frontend && npm run typecheck
cd frontend && npm run build
npx --yes @fission-ai/openspec@latest validate fix-invitation-management-short-viewport --strict
git diff --check
```

Results:

- `npm run typecheck`: GREEN.
- `npm run build`: GREEN with the existing Rspack asset/entrypoint size
  warnings.
- strict OpenSpec validation: GREEN after the same-route deterministic remount
  documentation update.
- `git diff --check`: GREEN.

Static scope inspection for this remediation:

- the production recovery change is limited to
  `frontend/src/features/workspace/TeamInvitationManagement.tsx`;
- the existing `TeamInvitationManagement.module.css` partial layout work is in
  scope for the same component and adds no phone/mobile media rule, fixed or
  sticky action bar, JavaScript scrolling or storage persistence;
- no `TeamWorkspacePage.tsx`, API/backend/RTK/feature-flag/launcher/fixture
  change was made for task 2.1;
- the recovery record contains only `id`, `state`, `role` and `expiresAt`, with
  a local `revision: -1` marker resolved through `listTeamInvitations` before
  mutation. It contains no raw URL, invitation token, auth token or idempotency
  key.

The required unchanged workspace-navigation feature-on run was rerun after the
create-form scope assertion was corrected to target the canonical main landmark
instead of globally forbidding the legitimate workspace-switcher text:

```sh
E2E_API_URL=http://127.0.0.1:18230/api \
E2E_BASE_URL=http://127.0.0.1:15230 \
E2E_EXPECT_TEAM_WORKSPACES=true \
npm run e2e:workspace-navigation
```

The run used isolated `127.0.0.1:18230` and `127.0.0.1:15230` services with
disposable schema `workspace_nav_e2e_5c97cc9457ef46e0952044af002f719b`. It
passed `103/103` tests and then dropped the schema. It did not touch the user's
`:8080/:5173` runtime.

A feature-off targeted workspace-navigation regression was also attempted on
isolated `18231/15231` with disposable schema
`workspace_nav_e2e_ac6541b0a5c3408ca3dee5bbc053ed2e`:

```sh
E2E_API_URL=http://127.0.0.1:18231/api \
E2E_BASE_URL=http://127.0.0.1:15231 \
E2E_EXPECT_TEAM_WORKSPACES=false \
node --test --test-name-pattern="remediation: primary navigation keeps one row|remediation: active personal candidates section in overflow" \
  tests/e2e/teams/e2e-workspace-navigation.mjs
```

The feature-off primary-navigation regression passed, proving the one-row
overflow geometry without the workspace switcher. The paired personal
active-overflow case timed out once at its existing `30s` per-test limit, so it
was rerun by itself on isolated `18232/15232` with disposable schema
`workspace_nav_e2e_02dac09faac44d738afd264222688554`:

```sh
E2E_API_URL=http://127.0.0.1:18232/api \
E2E_BASE_URL=http://127.0.0.1:15232 \
E2E_EXPECT_TEAM_WORKSPACES=false \
node --test --test-name-pattern="remediation: active personal candidates section in overflow" \
  tests/e2e/teams/e2e-workspace-navigation.mjs
```

That rerun passed `1/1` and dropped its disposable schema. With the
invitation-specific E2E, feature-on workspace-navigation and feature-off
targeted workspace-navigation checks GREEN, the remaining task 3.1 evidence is
the optional/supporting headed lifecycle classification and any final reviewer
acceptance required by task 3.2.
