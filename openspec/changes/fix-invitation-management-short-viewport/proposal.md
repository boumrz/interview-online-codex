# Proposal: keep invitation-management actions reachable in short desktop/tablet viewports

## Why

An earlier exploratory browser run reported that «Отозвать приглашение» could
fall below the viewport at the supported `1280×720` desktop cell rendered at
the existing `200%` zoom-equivalent geometry. The original two-cell browser
contract made that a behavioural RED and a bounded CSS/semantic-order
experiment improved the geometry. It did **not** make the change GREEN.

After a successful copy, ordinary keyboard focus can cause the existing
`TeamWorkspacePage` focus/visibility access revalidation and remount. The
component then loses the pending-invitation metadata needed to render
«Перевыпустить ссылку». This is a state-continuity failure, not a further CSS
problem. Architecture decision `INVITATION-SHORT-VIEWPORT-REMOUNT` permits only
a narrow reuse of the component's existing in-memory, metadata-only recovery
mechanism for a current `PENDING` invitation. The expanded browser contract
must demonstrate that missing behaviour RED before that recovery is changed.

Architecture decision `INVITATION-LIFECYCLE-GATE-REVISION` clarifies the
pre-implementation gate: the deterministic rendered task 1.3 remount RED is the
authority to start the metadata-only component/CSS correction after task 1.4
review. Headed/native lifecycle attempts are supporting evidence only. A
missing display, event witness or manual native witness remains TE/manual
supporting evidence, not GREEN and not a blocker for the bounded remediation.

## What Changes

- Retain the two separately named, keyboard-only browser acceptance cells:
  `1280×720 → 640×360` and `768×1024 → 384×512`. Add a test-first recovery
  contract in both cells for OWNER and ADMIN: after successful copy and the
  existing focus/visibility revalidation-remount, «Перевыпустить ссылку» stays
  visible and keyboard-reachable while the raw secret is absent. The contract
  also covers replacement dismissal plus revalidation, and recovery clearing
  after revoke.
- Keep the existing create, forced copy failure/retry, dismiss, reissue and
  revoke sequence; extend it with exact one-reissue/current-pending-ID and
  no-duplicate-create assertions. MEMBER and unavailable-access paths must
  expose no recovered controls and issue no invitation mutation after
  revalidation.
- Treat unavailable access as an explicit UI-boundary case only: the E2E may
  intercept exactly one real focus-triggered `GET /api/teams/{teamId}` and
  return the existing non-disclosing `404 TEAM_NOT_FOUND` status. It must not simulate
  server authority revocation, fake a mutation or bypass the parent UI; server
  authorization remains separately authoritative and unchanged.
- Require the ordinary deterministic headless acceptance path to force the
  parent revalidation/remount through the real team page by changing only a
  test-owned same-route query marker, awaiting the exact
  `GET /api/teams/{teamId}` response, and proving the old action
  `ElementHandle` is disconnected before a recovered control is queried. Keep
  a separate keyboard logout/relogin cleanup path proving prior account/team
  metadata and actions do not return or send a mutation after real application
  cleanup. The same-route remount is the state-continuity acceptance authority;
  headed tab lifecycle remains supporting evidence only.
- Require geometry and non-occlusion checks after every rendered invitation
  state, including focus visibility and `44×44` CSS-pixel targets for each
  permitted action. The raw secret must be absent from the DOM, URL, browser
  history, local storage and session storage whenever the one-time link is no
  longer displayed.
- Permit a long Russian team header to ellipsize visually only when its complete
  name remains its programmatic accessible name and the truncation does not
  hide, cover or displace an invitation action.
- After the expanded recovery test is independently reviewed as a behavioural
  RED, authorize a narrowly scoped component/CSS correction that reuses only
  existing in-memory metadata recovery. A test-environment failure is not a RED
  result and does not authorize production work.
- Keep a separate test-only proof of the **real** tab lifecycle from
  architecture decision `INVITATION-REAL-TAB-LIFECYCLE` as optional/supporting
  final evidence. Only the positive lifecycle cases opt into temporary headed
  Chromium through `E2E_TEAM_INVITATIONS_HEADED_FOCUS=1`; ordinary invitation
  suites remain headless. When available, they must witness genuine hide/blur
  then show/focus (or `visibilitychange`), a real
  `GET /api/teams/{teamId}` with `200`, old-control detachment and the final
  recovered control. Synthetic events, CDP, direct fetches, reloads and mocks
  do not prove the positive path; an absent witness is TE/supporting-only and
  does not block the metadata-only remediation once the deterministic remount
  contract is GREEN.
- Architecture feasibility/security found that native AX automation is
  infeasible in this change's test-file-only scope: no direct macOS AX bridge is
  available, while AppleScript, CUA, coordinates and user-browser paths remain
  prohibited. `INVITATION-NATIVE-TAB-LIFECYCLE` therefore stays blocked and is
  not a CI replacement. A manual witnessed check is optional supporting
  evidence only, never GREEN and never sole production authority. A future
  automated route requires a separate native-test-infrastructure OpenSpec
  change.
- Require final evidence to rerun the invitation-secret lifecycle contract from
  an isolated custom-port runtime, inspect the allowlisted production diff for
  no phone/mobile media rule, and confirm that no release feature flag changes.

## Capabilities

### New Capabilities

- `invitation-management-layout-affordance`: reachable and keyboard-usable
  invitation-management actions in the supported desktop/tablet viewport and
  zoom range.

### Modified Capabilities

- None. The parent `design-team-interview-journey` change contains the
  unaccepted `team-workspaces` capability. This narrow remediation depends on
  its implemented invitation UI without changing its invitation API, roles,
  secret lifecycle or authorization contract.

## Impact

- Test-first scope: `frontend/tests/e2e/teams/e2e-team-invitation-management.mjs`
  and later verification evidence only. The runner/launcher and fixtures remain
  unchanged. The existing one-exact-GET `404` route boundary remains exclusively
  for the unavailable **negative** UI case; it is not reused for a positive
  lifecycle proof.
- The native-AX task remains unchecked and blocked. No current test, runner,
  launcher, product page or user browser is changed to work around the missing
  bridge. Any later automated native-AX route, including its profile/process
  ownership and receipt design, must begin in a separate
  `native-test-infrastructure` OpenSpec change.
- Conditional production scope, only after the new RED test-review gate:
  `TeamInvitationManagement.tsx` and `TeamInvitationManagement.module.css`.
  The recovery record may contain only non-secret pending-invitation metadata;
  it must never contain a raw URL, token, auth token or idempotency key.
- `TeamWorkspacePage.tsx` is deliberately not changed: its existing
  focus/visibility revalidation remains authoritative. No backend endpoint,
  database migration, RTK state/cache, local/session storage, invitation token
  handling, clipboard contract, role permission, feature-flag default, API
  payload, realtime or phone/mobile-browser behaviour changes are in scope.
- The normal team-detail unavailable contract remains `404 TEAM_NOT_FOUND` for
  a missing or inaccessible team. This change neither weakens that server-side
  authorization nor provides a test-only mechanism to revoke it.
- The partial CSS experiment already present in the working tree is evidence of
  a non-GREEN attempt, not accepted implementation. It remains unaccepted and
  unreleased until the revised task 1.4 gate approves the deterministic remount
  RED, the expanded contract turns GREEN, and the final allowlist inspection
  passes.
- The feature remains subject to the existing parent release/security gates;
  this change does not enable team workspaces for users.
