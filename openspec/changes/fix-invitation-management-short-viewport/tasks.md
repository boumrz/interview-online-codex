# Tasks

## 1. Test-first evidence and recovery gate

- [x] 1.1 **Developer-agent, initial geometry contract; test file only.**
  `frontend/tests/e2e/teams/e2e-team-invitation-management.mjs` now registers
  independent top-level named tests `BUG-AC03-QA-001` for `1280×720 → 640×360`
  and `BUG-AC03-QA-002` for `768×1024 → 384×512`, not a stopping matrix loop.
  The initial contract covers the long Russian name, keyboard-only geometry,
  OWNER/ADMIN actions, MEMBER denial, no overflow and secret redaction. Its
  behavioural RED is retained in `implementation-verification.md`; it did not
  authorize state recovery.

- [x] 1.1a **Developer-agent, initial test-review remediation; test file only.**
  The initial contract gained create-state coverage, a pre-navigation MEMBER
  mutation observer and recursive assertion-error redaction. The existing
  isolated runs and their behavioural RED evidence remain recorded. This is not
  the expanded remount-recovery contract below.

- [x] 1.2 **Test-reviewer-agent, historical geometry gate.** Reviewed the
  initial two named-cell RED and authorized only the bounded
  `TeamInvitationManagement` CSS/semantic-order experiment. It did not review
  or authorize metadata recovery. The experiment is explicitly non-GREEN and
  remains unaccepted; it may not be treated as a completed implementation or a
  release candidate.

- [x] 1.3 **Developer-agent, RED first; test file only.** Change only
  `frontend/tests/e2e/teams/e2e-team-invitation-management.mjs`. Preserve the
  two independent top-level named tests (`BUG-AC03-QA-001`,
  `BUG-AC03-QA-002`), their respective `1280×720 → 640×360` and
  `768×1024 → 384×512` cells, and their separate fixtures/cleanup so a failure
  in one cannot suppress the other. In **each** named cell, use keyboard-only
  `Tab`/`Shift+Tab`/`Enter` interaction (other than the browser lifecycle event)
  and test both OWNER and ADMIN through all of the following observable states:

  - create the pending invitation; retain the existing forced copy failure and
    keyboard retry evidence; then complete a successful copy;
  - cause the existing focus/visibility revalidation and resulting invitation
    management remount without an internal React/Redux seam; prove that reissue
    and revoke for the current `PENDING` invitation are visible, focusable,
    `44×44` CSS pixels, inside the visual viewport and non-occluded, while the
    copied exact secret is absent from DOM text/HTML, URL, browser history,
    `localStorage` and `sessionStorage`;
  - keyboard-activate exactly one reissue. Observe that it targets the current
    recovered pending invitation ID, sends no create-invitation mutation and
    returns a replacement one-time link. Dismiss that replacement link, repeat
    the parent revalidation/remount, and prove recovery presents the replacement
    pending invitation only, with its raw secret absent from the same five
    surfaces;
  - keyboard-activate revoke, repeat revalidation/remount, and prove recovery
    for that revoked invitation is cleared (no recovered reissue/revoke target
    for it; the prior link remains generically unavailable).

  Keep state-by-state no-page-horizontal-overflow and geometry/non-occlusion
  assertions. In **each** cell also cover: (a) a MEMBER after revalidation has
  no create, copy/retry, dismiss, reissue or revoke control, emits no invitation
  mutation and has no page-level horizontal overflow; (b) an existing
  revalidation that renders the team unavailable has no recovered invitation
  controls, no invitation mutation and no raw secret in those five surfaces.
  Redact every captured secret from thrown errors and
  `implementation-verification.md`. Do not change fixtures, launcher, product
  code, CSS, `TeamWorkspacePage`, API/backend/RTK/storage/feature flags. Run
  both cells before production work with an explicit unused pair, e.g.
  `E2E_TEAM_INVITATIONS_PORT=<unused>` and
  `E2E_TEAM_INVITATIONS_WEB_PORT=<unused>`, and record independent `RED`,
  `GREEN` or `test-environment failure` results plus process/schema cleanup.
  The expected missing remount recovery must be a rendered behavioural RED; an
  infrastructure failure does not open task 2.1.

  The deterministic remount MUST be reproducible without a React/Redux seam:
  retain the old reissue/revoke `ElementHandle`, navigate the same team route
  with only a test-owned `__ac03Revalidation` query marker, pre-arm and await
  the exact next `GET /api/teams/{teamId}` on the target page, and assert the
  preserved handle is disconnected after the parent revalidation/remount and
  before querying a recovered control. This is the ordinary state-continuity
  acceptance path; the headed real-tab lifecycle remains supporting-only.
  For the unavailable case, install a one-request interception only for that
  exact real focus-triggered GET and fulfill it with the existing
  `404 TEAM_NOT_FOUND` unavailable result. Do not use a fixture or backend call
  to simulate authority revocation, do not intercept/fake any invitation POST,
  and assert the normal «Команда недоступна» parent UI plus zero invitation
  mutations. Server authorization remains separately enforced and unchanged.

  Capture `originalId` and `replacementId` from safe response metadata while
  redacting raw links. Assert exactly one POST to
  `/api/teams/{teamId}/invitations/{originalId}/reissue`, no create POST and a
  distinct replacement ID. After replacement dismissal/remount, assert exactly
  one POST to `/api/teams/{teamId}/invitations/{replacementId}/revoke` and no
  revoke POST for `originalId`; assert the old link after reissue and the
  revoked replacement link are generically unavailable. Separately exercise the
  existing application keyboard logout/relogin flow: activate «Выйти» with
  keyboard, authenticate through the existing login form with keyboard and
  verify the prior account/team cached metadata, old action and recovered
  controls do not return or send a mutation. Do not substitute direct storage,
  Redux or route-state manipulation for this cleanup; report it separately from
  expected authorized same-context remount recovery.

  Completed with the isolated behavioural RED recorded in
  `implementation-verification.md`. The two named cells remain independently
  registered and both reached the deterministic same-route parent remount after
  their old action handle disconnected; current production did not render the
  required metadata-only recovered action. No production/API/fixture/launcher
  change was made by this task.

- [x] 1.3a **Developer-agent, real-tab lifecycle test only.** Before any
  resumed production acceptance, change only
  `frontend/tests/e2e/teams/e2e-team-invitation-management.mjs` to implement
  architecture decision `INVITATION-REAL-TAB-LIFECYCLE`. The shared browser and
  ordinary invitation cases must remain headless. Only the positive
  OWNER/ADMIN lifecycle subcases for `BUG-AC03-QA-001` and
  `BUG-AC03-QA-002` may launch a separate temporary headed Chromium, and only
  when `E2E_TEAM_INVITATIONS_HEADED_FOCUS=1` is explicitly present. With no
  opt-in, do not launch headed Chromium; retain ordinary headless coverage and
  record that a final positive lifecycle verdict is incomplete.

  Before target-page navigation, install a test-only observer init script that
  records lifecycle-event type/order/timestamp and visibility state only. It
  must be observer-only: no synthetic `dispatchEvent`, application mutation,
  network operation, React/Redux/private-state seam, CDP command, direct fetch,
  reload or positive-path route intercept/fulfill/mock. For each opted-in
  OWNER/ADMIN cell, use real tabs to witness target-page hidden/`blur`, then
  visible/`focus` or visible `visibilitychange`; pre-arm request/response
  observers before foregrounding, prove the exact post-visible-transition real
  `GET /api/teams/{teamId}` returns `200`, prove the preserved old action
  `ElementHandle` is detached, then prove the final current recovered action is
  visible and keyboard-reachable. The ordinary isolated API-origin route may
  continue a request but may not intercept/fulfill this exact positive GET.

  Preserve the existing unavailable-negative test unchanged in meaning: it may
  intercept/fulfill **exactly one** real focus-triggered detail GET as `404
  TEAM_NOT_FOUND`, then proves normal unavailable UI and zero invitation
  mutations; it is not positive lifecycle evidence. Do not change runner,
  launcher, fixtures, production/CSS files, `TeamWorkspacePage`, API/backend,
  RTK, storage or flags. Immediately before an opted-in headed command, announce
  in commentary that temporary visible Chromium may briefly take OS focus. Run
  with explicit unused ports, for example
  `E2E_TEAM_INVITATIONS_HEADED_FOCUS=1 E2E_TEAM_INVITATIONS_PORT=<unused> E2E_TEAM_INVITATIONS_WEB_PORT=<unused> npm run e2e:team-invitations`,
  and record command, `headed` mode, event witness, exact GET/`200`, handle
  detachment, final control and browser/process/schema cleanup without secrets.
  If headed display creation or the required witness is absent, record a
  **test-environment failure**, neither GREEN nor RED, and treat it as
  supporting-only evidence rather than deterministic remount proof.

  Execution status (2026-09-19): the explicitly authorized headed run used
  `18214/15214` and cleaned up its temporary browsers, processes and schema.
  Both named cells lacked the required target-page hidden/blur event witness,
  so each positive lifecycle result is a test-environment failure, neither RED
  nor GREEN. Architecture decision `INVITATION-LIFECYCLE-GATE-REVISION`
  recorded on 2026-09-20 changes this from a task-2.1 blocker into
  supporting-only evidence: it did not authorize production by itself, but it
  also does not block the deterministic metadata-remount RED gate.

- [ ] 1.3b **Developer-agent, native-AX automation — blocked/infeasible in this
  change.** Architecture feasibility/security found no direct macOS AX bridge
  available from the current test-file-only scope. Do not add AppleScript, CUA,
  coordinate/global-shortcut/fuzzy-selection automation, user Chrome/in-app
  browser access, a runner/launcher change or native infrastructure as a
  workaround. This task remains unchecked; it is retained solely to describe
  the future security contract (test-owned Chromium/profile, non-secret receipt,
  exact PID-plus-sentinel identity, observer barriers and exact cleanup) for a
  separate native-test-infrastructure OpenSpec change.

- [ ] 1.3c **Prompt-task-auditor-agent and security-reliability-agent,
  native-AX feasibility gate — blocked.** Record the security finding that task
  1.3b cannot be authorized in this change without a new direct native AX bridge.
  Preserve the prohibition on AppleScript, CUA, coordinates, global shortcuts,
  fuzzy selection, user-browser access, broad kill/delete and production
  fallback. A future automated path requires a separate
  native-test-infrastructure change with fresh architecture, task-audit and
  security gates. Do not classify the absence of this path as GREEN.

- [ ] 1.3d **Developer-agent, local/manual native-AX automation —
  blocked/unverified.** Remains intentionally unchecked: no direct macOS AX
  bridge is available under the test-file-only scope, and no native command is
  run in this change. A manually witnessed local check may be recorded as
  optional supporting evidence only; it is never GREEN, never a substitute for
  the missing browser event witness and never sole authority to modify
  production. Future automation must begin in a separate
  native-test-infrastructure OpenSpec change.

- [x] 1.4 **Test-reviewer-agent and prompt-task-auditor-agent, expanded RED and
  lifecycle-supporting test-audit gate.** Review the frozen task
  1.3 result before any further production edit. Reject a loop/parameterized
  registration that masks either cell, pointer-only action, unobserved real
  focus/visibility revalidation-remount, missing OWNER or ADMIN action path,
  a stale/unknown reissue ID, any duplicate create, omitted replacement
  dismissal/remount or revoke cleanup, incomplete exact-secret absence check,
  MEMBER/unavailable control/mutation leakage, geometry/occlusion gap,
  unredacted evidence, changed fixture/launcher/default user runtime, or a
  test-environment failure labelled RED. Reject unavailable coverage that does
  not pre-arm/await the exact real team-detail GET, reuses a connected old
  `ElementHandle`, simulates server authority, fakes a mutation or omits the
  normal unavailable parent UI/zero-mutation assertion. Reject cleanup that
  bypasses the actual keyboard logout/relogin UI or conflates it with
  authorized remount recovery.
  Also reject a positive lifecycle proof that is not opt-in headed Chromium,
  makes ordinary cases headed, lacks an observer-only init script, lacks genuine
  hidden/blur then visible/focus-or-visibilitychange evidence, does not correlate
  the post-visible event with exact real `GET /api/teams/{teamId}` `200`, omits
  old-handle detachment or final current-control evidence, uses synthetic events,
  CDP, direct fetch, reload or a positive route mock, changes runner/launcher,
  or conflates the exactly-one-GET `404` unavailable negative boundary with
  positive evidence. Treat absent headed display/event witness as a
  test-environment failure—not a RED or GREEN—and supporting-only, not a
  task-2.1 blocker, after the deterministic task 1.3 remount RED is accepted.
  Verify the executor announced the temporary focus effect before the headed
  command and recorded browser/context/process/schema cleanup.
  Current disposition: native AX is infeasible without a new direct bridge and
  tasks 1.3b–1.3d remain unchecked. Reject AppleScript, CUA, coordinate/global
  shortcut/fuzzy-selection, user Chrome/in-app browser paths, a CI substitute or
  native infrastructure grafted into this change. Optional manual witness is
  never GREEN and cannot open task 2.1 by itself. A future automated route
  requires a separate native-test-infrastructure OpenSpec change with fresh
  security review. Approve task 2.1 only when the task 1.3 contract has
  deterministic rendered RED at one or both cells, the metadata-only acceptance
  assertions are frozen, and all synthetic/native lifecycle boundaries above
  remain supporting-only. The historical task 1.2 approval does not satisfy
  this gate. **Evidence (2026-09-20):** repeated prompt/task audit and
  test-review both returned `ready` after the current E2E file restored default
  deterministic remount RED on isolated ports `18220/15220`; see
  `implementation-verification.md`.

## 2. Conditional metadata-only recovery and layout completion

- [x] 2.1 **Developer-agent; only after task 1.4 approval.** Modify only
  `frontend/src/features/workspace/TeamInvitationManagement.tsx` and
  `frontend/src/features/workspace/TeamInvitationManagement.module.css` to make
  the frozen task 1.3 contract GREEN. Reuse the current component-owned,
  account-and-team-scoped in-memory recovery path for metadata of the current
  `PENDING` invitation across the existing parent focus/visibility
  revalidation-remount. The recovery record may contain only invitation ID,
  state, role and expiry metadata; it must not contain a raw URL, invitation
  token, auth token or idempotency key, and must not be persisted. Replacement
  reissue replaces the metadata; revoke clears it; existing context cleanup
  remains. Do not weaken rendering or server authorization for MEMBER/
  unavailable paths. Do not change `TeamWorkspacePage.tsx`, API/backend/RTK,
  storage, feature flags, test launcher, fixtures, request/idempotency contract,
  phone/mobile media rules, fixed/sticky controls or JavaScript scrolling.
  The existing partial CSS experiment is unaccepted and unreleased: retain,
  revise or remove it only as part of this approved result, and do not mark this
  task complete until every expanded E2E assertion is GREEN.

  Completed on 2026-09-20 after the task 1.4 `ready` gate. The scoped
  component recovery stores only `id`, `state`, `role` and `expiresAt` in
  memory for the current account/team, resolves a fresh revision from the list
  endpoint before reissue/revoke, replaces metadata after reissue and clears it
  after revoke. The full isolated invitation contract passed on
  `18227/15227` with `13` passing tests and `1` native-AX skip. No
  `TeamWorkspacePage`, API/backend/RTK/storage/feature-flag/launcher/fixture,
  phone/mobile, fixed/sticky or JavaScript scrolling change was made.

## 3. Regression and acceptance

- [x] 3.1 **Developer-agent.** Run the full `npm run e2e:team-invitations`
  contract with explicit unused `E2E_TEAM_INVITATIONS_PORT` and
  `E2E_TEAM_INVITATIONS_WEB_PORT`, retaining both named cells, all OWNER/ADMIN
  recovery states, MEMBER/unavailable negative paths, geometric evidence and
  the full secret lifecycle. Record commands, concrete ports, isolated process
  and disposable-schema cleanup, independent role/cell results and secret-safe
  evidence in `implementation-verification.md`; never interrupt the user's
  `:8080/:5173` runtime. Run `npm run typecheck`, `npm run build`,
  `npx --yes @fission-ai/openspec@latest validate fix-invitation-management-short-viewport --strict`
  and `git diff --check`. Statically inspect the recorded production diff: its
  changed production path set must be a subset of
  `TeamInvitationManagement.tsx` and `.module.css`, and it must contain no
  `TeamWorkspacePage` edit, raw URL/token/auth-token/idempotency-key recovery
  field, browser-storage persistence, API/backend/RTK/flag/launcher/fixture
  change, phone/mobile media rule, fixed/sticky action bar or JavaScript
  scrolling. Re-run the unchanged feature-on and feature-off workspace-
  navigation checks. The final E2E evidence must retain the exact original and
  replacement POST-ID assertions, deterministic same-route parent remount with
  old-handle detachment, the one-GET `404 TEAM_NOT_FOUND` unavailable UI
  boundary and the keyboard logout/relogin cleanup separately from expected
  recovery. In addition, before issuing the
  headed command, announce that temporary visible Chromium may briefly take OS
  focus, then run and record an explicit isolated positive-lifecycle command:
  `E2E_TEAM_INVITATIONS_HEADED_FOCUS=1 E2E_TEAM_INVITATIONS_PORT=<unused> E2E_TEAM_INVITATIONS_WEB_PORT=<unused> npm run e2e:team-invitations`.
  Evidence must state the headed mode; genuine hidden/blur then
  visible/focus-or-visibilitychange witness; post-visible exact real
  `GET /api/teams/{teamId}` `200`; old-handle detachment; final current
  recovered control; and dedicated browser/context/process/schema cleanup. The
  shared and ordinary cases remain headless. A missing headed display or event
  witness is a test-environment failure, neither GREEN nor RED, and supporting
  only; it does not block final acceptance when the deterministic remount
  contract is GREEN. Native AX automation is infeasible in the current
  test-file-only scope because no direct macOS AX bridge exists; do not run an
  `E2E_TEAM_INVITATIONS_NATIVE_AX` command or substitute AppleScript, CUA,
  coordinates, user-browser control or native infrastructure. Final evidence
  records tasks 1.3b–1.3d as unchecked and optional manual witness only—not
  GREEN or sole production authority. A future automated route requires a
  separate native-test-infrastructure OpenSpec change. Do not globally enable
  team workspaces.

  Completed on 2026-09-20. Evidence is in
  `implementation-verification.md`: full invitation E2E GREEN on
  `18227/15227`, typecheck/build/strict validation/diff-check GREEN,
  feature-on workspace-navigation GREEN on `18230/15230` (`103/103`), and
  feature-off targeted workspace-navigation GREEN across `18231/15231` and
  `18232/15232`. The previously authorized headed positive lifecycle run
  remains recorded as test-environment/supporting-only, not a deterministic
  acceptance blocker; native AX tasks 1.3b–1.3d remain intentionally unchecked.

- [ ] 3.2 **Solution-reviewer-agent, security-reliability-agent, ux-critic-agent
  and product-owner-agent.** Review final evidence against the capability and
  architecture decision: independent named cells; keyboard-only OWNER/ADMIN
  recovery after parent revalidation; correct one-time current-pending reissue
  with no duplicate create; replacement dismissal/remount; revoke/context
  cleanup; exact secret absence; MEMBER/unavailable denial; state-by-state
  geometry; long-header accessible name; exact original/replacement request
  identity; headed opt-in real-tab lifecycle evidence when locally available
  (mode, genuine event order, exact `200`, detached handle and final current
  control) or supporting TE classification when unavailable; preserved
  one-GET `404` unavailable negative boundary; keyboard logout/relogin cleanup;
  and static allowlist/no-persistence verification. Record native AX as
  infeasible under the present test-file-only scope unless a separate native
  infrastructure change supplies accepted evidence: tasks 1.3b–1.3d remain
  unchecked, optional manual witness is not GREEN and future automation requires
  a separate native-test-infrastructure change. Confirm the expanded RED gate
  preceded implementation, no
  feature flag/mobile/API/permission/parent-page boundary changed, and product
  acceptance is limited to this remediation rather than a global team-workspace
  release.
