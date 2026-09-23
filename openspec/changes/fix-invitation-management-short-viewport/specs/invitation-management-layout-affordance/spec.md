# Spec Delta

## Purpose

Keep sensitive invitation-management actions visible, keyboard-usable and
continuous across the existing access-revalidation remount in the supported
short desktop and tablet viewport/zoom range, without changing access rights,
invitation secrets or the release feature gate.

## ADDED Requirements

### Requirement: Invitation-management actions remain reachable in short desktop/tablet layouts

When team workspaces are enabled for an authorized OWNER or ADMIN, the pending
invitation management surface SHALL keep every currently permitted action
reachable through ordinary keyboard navigation in both supported
zoom-equivalent cells: `1280×720 → 640×360` and `768×1024 → 384×512`. In each
cell, both roles SHALL complete the actual keyboard-only action sequence:
create an invitation, encounter a forced clipboard-copy failure, retry copy,
dismiss the displayed one-time link, reissue the still-pending invitation and
revoke the resulting pending invitation. `Tab`/`Shift+Tab` and `Enter` SHALL
perform every user-visible transition in that sequence; test-fixture setup is
not part of the interaction sequence.

The acceptance suite SHALL register these cells as two independent named E2E
tests, `BUG-AC03-QA-001` for the short desktop cell and `BUG-AC03-QA-002` for
the short tablet cell. A loop or parameterized registration that can stop one
cell after the other fails SHALL NOT substitute for the two named tests.

At initial render and after each settled invitation state (link displayed,
copy failure, copy retry, dismissal, reissue and revoke), each currently
permitted action SHALL be geometrically non-occluded: when focused, its entire
target and visible focus indicator are inside the visual viewport and are not
covered or intersected by another visible interactive surface. Each such target
SHALL be at least `44×44` CSS pixels. The page MAY use normal vertical document
scrolling to show a focused action, but SHALL NOT cause page-level horizontal
overflow, clipping behind fixed or sticky content, overlapping controls or a
pointer-only interaction.

A long Russian team header MAY visually ellipsize in either cell. When it does,
the full, untruncated team name SHALL remain its programmatic accessible name;
ellipsis SHALL NOT remove a permitted action, overlap it or make that action
unreachable by keyboard.

A MEMBER opening either cell SHALL see a readable layout without create,
copy-retry, dismiss, reissue or revoke invitation controls. Keyboard traversal
and rendering for a MEMBER SHALL issue no invitation mutation and SHALL not
introduce page-level horizontal overflow. Responsive rendering SHALL NOT create
a membership or change an authorization decision for any role.

The layout change SHALL NOT add phone/mobile behaviour or media-query scope,
alter owner/admin/member authorization, create a membership, change
invitation/reissue/revoke API calls, extend raw-link lifetime, persist secrets,
or change the exact-string team-workspace feature-flag contract.

After an authorized OWNER or ADMIN has successfully copied a one-time link,
the existing `TeamWorkspacePage` focus/visibility access revalidation MAY
remount invitation management. For the same currently authorized
account-and-team context, that remount SHALL restore only the metadata of the
current `PENDING` invitation so that «Перевыпустить ссылку» and «Отозвать
приглашение» remain rendered and keyboard-reachable. It SHALL NOT restore the
raw one-time URL. The existing workspace-page revalidation, its unavailable
state and its authority decision remain unchanged and authoritative; this
capability SHALL NOT change `TeamWorkspacePage.tsx`.

The recovery record SHALL reuse the existing in-memory metadata-only recovery
boundary in invitation management. It MAY contain only the current invitation
identifier, state, role and expiry metadata needed to address the current
`PENDING` invitation in its account-and-team context. It SHALL NOT contain or
persist a raw URL, invitation token, authentication token or idempotency key in
that recovery record, browser URL/history, DOM, `localStorage` or
`sessionStorage`. Existing context cleanup on account/team switch and logout
remains in force. The record MUST be replaced by the returned metadata after a
successful reissue and MUST be cleared when the invitation is revoked; a
revoked invitation SHALL not be recovered as `PENDING` after a later remount.

Recovery SHALL run only inside the already authorized invitation-management
surface. A MEMBER, or an account for which the existing revalidation renders
the team unavailable, SHALL see no recovered create, copy/retry, dismiss,
reissue or revoke control and SHALL issue no invitation mutation because of
recovery. The recovery mechanism SHALL NOT create a membership, weaken a
server-side or client-side authorization decision, alter an API payload,
request idempotency semantics, RTK state/cache, feature flag or backend
contract.

The existing server contract for a missing or inaccessible team remains the
non-disclosing `404 TEAM_NOT_FOUND` response to `GET /api/teams/{teamId}`.
Server-side authorization remains independently enforced, unchanged and outside
this test-only change. The unavailable E2E is a UI-boundary test: it MAY
intercept only the next real focus-triggered exact team-detail `GET` and return
that existing `404` result. It SHALL NOT simulate authority revocation, alter a
backend fixture, intercept or fulfill an invitation mutation, or bypass the
normal `TeamWorkspacePage` unavailable rendering. The rendered unavailable
surface SHALL have no recovered invitation control and its mutation observer
SHALL prove no create, reissue or revoke request is sent.

The ordinary deterministic acceptance path for authorized OWNER/ADMIN recovery
MAY force the parent revalidation/remount by navigating the same team route with
only a test-owned query marker such as `__ac03Revalidation`, then awaiting the
real exact `GET /api/teams/{teamId}` response. This path SHALL retain the old
invitation action `ElementHandle`; after the parent remount, it SHALL prove the
handle is disconnected before querying the current recovered control. The
same-route remount is sufficient for deterministic state-continuity acceptance,
but it is not a claim that the operating system delivered a real tab lifecycle
event.

An ordinary headless two-tab exercise may remain a regression check, but it is
not sufficient evidence for the expected authorized remount. Under architecture
decision `INVITATION-REAL-TAB-LIFECYCLE`, the positive remount proof SHALL run
only with the explicit test opt-in `E2E_TEAM_INVITATIONS_HEADED_FOCUS=1` in a
dedicated temporary **headed** Chromium instance. The ordinary invitation suite
and every non-positive lifecycle case remain headless. Before navigation, that
headed case SHALL install an observer-only init script that records lifecycle
events and visibility state without dispatching, modifying or synthesizing an
event or application state.

For each positive OWNER/ADMIN case in both named cells, the headed instance
SHALL open and foreground a real second browser tab, witness a genuine
hidden/`blur` transition on the original team page, pre-arm the exact detail
request/response observers, then bring that `targetPage` to the foreground and
witness a genuine visible/`focus` transition or visible `visibilitychange`.
The observer SHALL then associate that post-visible-transition request with one
real, unmocked exact `GET /api/teams/{teamId}` response with status `200`.
Before the lifecycle, it SHALL retain the existing invitation
action `ElementHandle`; after parent revalidation/remount, it SHALL prove that
handle is disconnected before it queries the current recovered control. This
distinguishes an actual parent remount from a reused stale DOM node.

For this positive proof, CDP lifecycle emulation, `dispatchEvent`, direct
`fetch`, reload, route fulfillment/mock and app-private React/Redux seams are
forbidden. The ordinary API-origin routing necessary for the isolated runtime
may continue the target request but SHALL not intercept or fulfill it. If the
headed display cannot be created or the observer lacks the required genuine
event witness, record a **test-environment failure**, neither behavioural GREEN
nor behavioural RED; it cannot be used as positive lifecycle proof and cannot
be called GREEN. It also SHALL NOT block task 2.1 or final acceptance when the
deterministic remount contract is reviewed and GREEN. The user's screen may
briefly receive focus from the temporary headed Chromium, so the runner SHALL
announce that effect before executing the opted-in command.

Architecture feasibility/security has determined that native AX automation is
**infeasible in this change**. The test-file-only scope has no direct macOS AX
bridge, and adding one is native test infrastructure outside this OpenSpec
change. AppleScript, CUA, coordinates, global shortcuts, fuzzy selection and
any user Chrome/in-app-browser path remain prohibited alternatives. Therefore
task 1.3d SHALL remain unchecked unless a separate native infrastructure change
supplies accepted evidence; no native automation, CI substitute or production
fallback is authorized here.

`INVITATION-NATIVE-TAB-LIFECYCLE` records only the security contract for a
future separate native-test-infrastructure change: a test-owned Chromium with
an exact temporary profile, random non-secret sentinel, non-secret readiness
receipt, exact PID-plus-sentinel AX identity, observer-authoritative ordered
barriers and exact owned cleanup. Such a future route must still prohibit user
browsers, coordinates, global shortcuts, fuzzy selection, broad termination,
synthetic events, CDP, direct fetch, reload and positive-path mocks.

Under the present change, a manually witnessed local check is optional
supporting evidence only. It SHALL NOT be called GREEN, shall not repair the
missing browser lifecycle witness, and shall not by itself permit task 2.1 or
production acceptance. If a future automated route is desired, it MUST begin as
a separate native-test-infrastructure OpenSpec change with its own security and
test gates.

For a recovered pending invitation, the test SHALL capture the original and
replacement identifiers from redacted-safe response metadata. It SHALL observe
exactly one `POST /api/teams/{teamId}/invitations/{originalId}/reissue` and no
create-invitation request; the returned `replacementId` SHALL differ from
`originalId`. After replacement-link dismissal and the expected remount, it
SHALL observe exactly one `POST /api/teams/{teamId}/invitations/{replacementId}/revoke`
and never revoke `originalId`. The old link after reissue and the replacement
link after revoke SHALL each return the established generic unavailable result.

Expected same-account/team remount recovery is distinct from cleanup. After an
actual application keyboard logout and relogin through the existing UI, the
prior account/team recovery record, action handle and cached metadata SHALL NOT
be restored and SHALL issue no invitation mutation. This cleanup test SHALL not
use direct storage/Redux manipulation or a synthetic parent seam; it verifies
the existing account cleanup boundary separately from authorized remount
recovery.

Pre-implementation acceptance-test level: **E2E**. The named browser tests are
required because browser focus scrolling, computed geometry, occlusion,
accessible naming, real tab hide/show lifecycle, focus/visibility remount,
clipboard/revoke transitions and secret absence are observable only in the
rendered application. The established invitation-secret lifecycle assertions
remain part of the same final E2E contract; raw secrets SHALL be redacted from
test errors and verification evidence.

#### Scenario: OWNER and ADMIN complete every invitation action and recover a pending invitation at both supported cells
- **WHEN** an OWNER or ADMIN opens invitation management at either named
  short-viewport/zoom-equivalent cell and uses only keyboard navigation through
  create, copy-failure/retry, successful copy, the existing team-page
  revalidation/remount, dismiss, reissue and revoke
- **THEN** every action that is rendered in each state receives visible focus,
  is at least `44×44` CSS pixels, is fully inside the visual viewport when
  focused and is not occluded by another interactive element
- **AND** the document has no page-level horizontal overflow at initial render
  and after each state transition
- **AND** after successful copy and the deterministic same-route remount, the
  old action handle is detached and `PENDING` reissue and revoke controls remain
  visible/reachable while the copied raw secret is absent from the DOM, URL,
  browser history, `localStorage` and `sessionStorage`
- **AND** retry does not create another invitation; reissue sends exactly one
  request for the current pending invitation ID and no create request;
  dismissal removes the raw link; reissue invalidates the previous secret; a
  dismissal plus remount recovers the replacement invitation only; and revoke
  clears recovery and leaves the old link generically unavailable

#### Scenario: Long team name may ellipsize without losing context or actions
- **WHEN** either authorized role opens a team whose Russian name exceeds the
  available header width in either named cell
- **THEN** the visible header may be ellipsized, but its accessible name is the
  complete team name
- **AND** every permitted invitation action remains reachable, non-occluded and
  unchanged in meaning

#### Scenario: MEMBER does not gain invitation controls through responsive reflow
- **WHEN** a MEMBER opens either named short desktop/tablet cell and traverses
  the rendered page by keyboard, including after the existing
  focus/visibility revalidation
- **THEN** create, copy/retry, dismiss, reissue and revoke controls are absent,
  no invitation mutation request is issued and no membership or permission is
  changed
- **AND** the page has no page-level horizontal overflow

#### Scenario: Unavailable revalidation never revives pending-invitation controls
- **WHEN** the E2E pre-arms and awaits the next real focus-triggered exact
  `GET /api/teams/{teamId}`, intercepts only that request and returns the
  existing unavailable `404 TEAM_NOT_FOUND` result after an authorized user has
  copied or dismissed a pending invitation link in either named cell
- **THEN** the unavailable surface, rather than recovered invitation management,
  is rendered; no create, copy/retry, dismiss, reissue or revoke control is
  available and no invitation mutation is issued
- **AND** no raw secret is present in the DOM, URL, browser history,
  `localStorage` or `sessionStorage`
- **AND** any later remount must still obey the current, revalidated authority
  decision; recovery cannot restore access or a membership
- **AND** the test does not revoke or otherwise alter server authority; the
  server-side authorization contract remains separately unchanged

#### Scenario: Application logout/relogin clears recovery instead of reviving stale actions
- **WHEN** an authorized user reaches a recoverable pending invitation state,
  activates the existing «Выйти» UI action by keyboard and relogs in through the
  existing application login form
- **THEN** prior account/team metadata and recovered invitation actions are not
  restored, no invitation mutation is sent and no raw secret is present
- **AND** this result is evaluated separately from the expected same-account/team
  focus/visibility remount recovery

#### Scenario: Headed real-tab lifecycle proves authorized pending recovery
- **WHEN** `E2E_TEAM_INVITATIONS_HEADED_FOCUS=1` explicitly opts in to the
  positive OWNER/ADMIN lifecycle case for either named cell
- **THEN** only that positive case runs in a temporary headed Chromium; ordinary
  invitation cases remain headless
- **AND** an observer-only init script witnesses hidden/`blur`, then
  visible/`focus` or visible `visibilitychange` on the real target tab
- **AND** the post-visible-transition real unmocked
  `GET /api/teams/{teamId}` returns `200`, the old action handle is detached,
  and the final current recovered action is rendered and reachable
- **AND** the positive proof uses no synthetic event, CDP lifecycle command,
  direct fetch, reload, network fulfillment/mock or app-private lifecycle seam
- **AND** the existing unavailable path remains a separate one-exact-GET `404`
  negative UI boundary with no invitation mutation
- **AND** absent headed display or event witness is a test-environment failure,
  neither GREEN nor RED, and supporting-only rather than a blocker when the
  deterministic remount contract passes

#### Scenario: Native AX infeasibility opens no production fallback
- **WHEN** headed lifecycle evidence is recorded as a test-environment failure
  and no direct macOS AX bridge is available inside the test-file-only scope
- **THEN** task 1.3d remains unchecked unless a separate native infrastructure
  change supplies accepted evidence, and no AppleScript, CUA, coordinate,
  global-shortcut, fuzzy-selection, user-Chrome or in-app-browser workaround is
  used
- **AND** an optional manually witnessed local check is supporting evidence only
  and is never called GREEN or used as sole production authority
- **AND** a future automated native route requires a separate
  native-test-infrastructure OpenSpec change with the PID/sentinel,
  observer-barrier and safe-cleanup security contract described above
