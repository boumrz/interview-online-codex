# Design

## Context

`frontend/tests/e2e/teams/e2e-team-invitation-management.mjs` already covers
the invitation API, one-time-link lifecycle and basic role boundary. The
original short-viewport work added two independent geometry cells and a bounded
CSS/semantic-order experiment. That experiment is deliberately **not GREEN**:
after successful copy, ordinary keyboard focus can cause the existing
`TeamWorkspacePage` focus/visibility access revalidation to remount invitation
management. The component then loses the metadata it needs to render
«Перевыпустить ссылку».

Architecture decision `INVITATION-SHORT-VIEWPORT-REMOUNT` permits one narrow
extension: reuse invitation management's existing in-memory, metadata-only
recovery boundary for a current `PENDING` invitation. Parent revalidation stays
authoritative and is not modified. The expanded browser contract must first
demonstrate the missing recovery as a rendered behavioural RED; it is not
authority to generalize persistence, API, routing or workspace state.

Architecture decision `INVITATION-REAL-TAB-LIFECYCLE` adds a test-evidence
constraint, not a product behavior or runtime change. The existing headless
`bringToFront()` check remains useful regression coverage, but only an explicit
temporary headed Chromium opt-in can prove the positive tab hide/show lifecycle
that drives parent focus/visibility revalidation.

Architecture decision `INVITATION-NATIVE-TAB-LIFECYCLE` was assessed after the
headed test-environment failure. The required direct macOS AX bridge is absent
from this change's test-file-only scope, so native automation is infeasible
here. It is not a CI replacement and does not authorize production work. Any
future bridge must be introduced by a separate native-test-infrastructure
OpenSpec change; browser lifecycle observers remain the evidence authority.

Architecture decision `INVITATION-LIFECYCLE-GATE-REVISION` decouples the
bounded remediation from environment-bound focus proof. The deterministic
rendered task 1.3 RED after parent revalidation/remount is the
pre-implementation authority for task 2.1 after audit/test-review approval.
Headed Chromium and native AX attempts remain supporting evidence only: they
must never be called GREEN when the witness is absent, but their absence does
not block the metadata-only recovery/layout correction or final acceptance when
the deterministic remount contract is GREEN.

## Goals / Non-Goals

**Goals:**

- Prove keyboard reachability, focus visibility and non-occlusion for OWNER and
  ADMIN across both supported short-viewport cells and all invitation states.
- Prove that after successful copy and an existing parent focus/visibility
  revalidation-remount, the current `PENDING` invitation reappears as metadata
  only: reissue/revoke are reachable and the raw secret stays absent.
- Prove that replacement dismissal/revalidation follows the replacement
  invitation ID, revoke clears recovery, and MEMBER/unavailable access cannot
  revive controls or initiate a mutation.
- Preserve optional/supporting evidence for a genuine headed tab hidden/blur →
  visible/focus-or-visibilitychange lifecycle, a real detail `GET` `200`, old
  action-handle detachment and the current recovered control when the local
  environment can witness it.
- Record headed/native lifecycle attempts as TE/manual-supporting when the
  witness is unavailable; preserve the security contract for a future separate
  infrastructure change without attempting a workaround.
- Preserve the one-time-link, retry, dismiss, reissue and revoke state machine,
  long-header accessibility and normal document-flow geometry contract.

**Non-Goals:**

- No phone viewport, mobile media-query, sticky/fixed action bar, JavaScript
  scrolling or new breakpoint contract.
- No change to `TeamWorkspacePage.tsx`, invitation APIs, request IDs, clipboard
  behavior, roles, server checks, feature flag, backend code, RTK state/cache,
  local/session storage, test launcher or test fixtures.
- No raw URL, invitation token, auth token or idempotency key in the recovery
  record; no new storage or cross-context persistence.
- No change to the test runner/launcher. Headed mode is a test-file-only,
  explicit opt-in and does not make the ordinary suite headed.
- No native AX against the user's Chrome, in-app browser or another unowned
  process/window; no coordinates, global shortcuts, fuzzy selection or broad
  process/profile cleanup.
- No global release or feature-flag enablement.

## Decisions

### 1. Reuse only the existing metadata-only pending-invitation recovery boundary

`TeamInvitationManagement` already has a component-owned, in-memory recovery
path keyed by the active account-and-team context. Under
`INVITATION-SHORT-VIEWPORT-REMOUNT`, the current `PENDING` invitation's
`InvitationMetadata` may be published to and restored from that existing path
when a successful copy hides the raw link and the parent subsequently remounts
the component. The recovery record contains only invitation ID, state, role and
expiry metadata. It does not contain a raw URL, invitation token, auth token or
idempotency key, and it is never persisted to browser storage, URL/history, RTK
or a backend service.

The record is scoped to the current account/team context and follows existing
cleanup on context change and logout. Successful reissue replaces it with the
replacement invitation metadata. Successful revoke clears it. The parent still
decides whether the team is ready/unavailable and whether OWNER/ADMIN invitation
management renders. A component remount cannot reintroduce controls after that
parent check denies access; no `TeamWorkspacePage` change is authorized.

This is not a general invitation-state cache. It covers only a currently
authorized `PENDING` invitation and must never restore a raw secret or a revoked
invitation as pending. Existing create-intent idempotency handling is neither
moved into this recovery record nor changed.

### 2. Keep actions in normal document flow and retain the scoped geometry correction

Invitation controls remain in their current document-flow card. The existing
CSS experiment's wrapping, minimum-width and focus-spacing work is not accepted
on its own. It may be retained, revised or removed only as part of the final
component/CSS result that makes the expanded recovery and geometry contract
GREEN. It remains unreleased and not a deployment candidate until the
deterministic remount recovery and geometry contract is GREEN.

A fixed/sticky bottom action bar is rejected because it competes for viewport
ownership and can cover status text. JavaScript `scrollIntoView` handlers are
rejected because they introduce timing races and are not needed for native
keyboard scrolling.

### 3. Two named browser cells and a recovery-specific RED gate precede production code

The E2E file keeps two independently registered named cases rather than a loop:
`BUG-AC03-QA-001` for `1280×720 → 640×360` and `BUG-AC03-QA-002` for
`768×1024 → 384×512`. Each case runs OWNER and ADMIN through create, forced
copy failure/retry, successful copy, the existing focus/visibility
revalidation-remount, dismissal, reissue and revoke with
`Tab`/`Shift+Tab`/`Enter` only. It separately renders MEMBER and unavailable
results. Helpers may be shared, but both named cells always execute and report
independently.

At initial render and after every settled state transition, the test measures
document horizontal overflow and action geometry. It focuses each available
action and asserts `44×44` size, visible focus outline, full viewport
containment and no occlusion by an unrelated interactive surface. The test also
proves:

- a successful copy followed by remount restores the current `PENDING` action
  set but not the raw secret;
- reissue sends exactly one request against the current recovered pending ID and
  no create request;
- a replacement-link dismissal followed by remount restores the replacement
  metadata only; and
- revoke clears recovery, while MEMBER and unavailable revalidation show no
  recovery control and produce no invitation mutation.

Every point where the raw link is no longer displayed probes its exact secret in
DOM, URL, browser history, `localStorage` and `sessionStorage`. Error output and
evidence redact raw secret values.

The deterministic recovery acceptance path is deliberately rendered
application behaviour rather than an internal seam: navigate the same team
route with only a test-owned `__ac03Revalidation` query marker, pre-arm an
exact `GET /api/teams/{teamId}` observer, and await the real team-detail
response that causes the parent remount. Preserve the old reissue or revoke
`ElementHandle` before the transition; prove it is disconnected after the
parent remount before querying the recovered control. This prevents a stale
action node from passing as recovery. It does not claim OS-level tab lifecycle;
that evidence remains limited to the explicit headed supporting mode.

Unavailable coverage is likewise a narrow UI boundary, not an authorization
simulation. The test may fulfill only that next real focus-triggered exact team
GET with the existing non-disclosing `404 TEAM_NOT_FOUND` result, exactly once.
The production
backend normally returns that status for missing or inaccessible team detail;
`TeamWorkspacePage` already maps its request failure to the unavailable UI.
No backend fixture/authority mutation is permitted, no invitation POST may be
intercepted or faked, and observers must show that the UI sends no mutation.
Server-side authorization stays unchanged and separately authoritative.

Capture original and replacement invitation IDs from safe response metadata.
The contract requires exactly one reissue POST for `originalId`, no create POST,
and a distinct `replacementId`; after replacement dismissal and the remount, it
requires exactly one revoke POST for `replacementId` and never `originalId`.
The original link after reissue and replacement link after revoke retain the
existing generic-unavailable assertion. Cleanup is a separate actual
application keyboard logout/relogin path (using «Выйти» and the login form),
which must prove that prior account/team metadata, action handle and mutation
capability do not return; it must not be conflated with expected same-context
remount recovery.

The new tests must produce the expected rendered recovery RED before production
work. A test reviewer freezes that result and validates exact cells, roles,
revalidation transitions, request identities and secret checks before allowing
the implementation task. Launcher, fixture, network or unrelated test failures
are not behavioural REDs. The headed/native lifecycle witness remains
supporting-only and cannot block this implementation gate when task 1.3 has
deterministic remount RED. The earlier CSS-only experiment remains unaccepted
until this expanded contract is GREEN.

Browser E2E is necessary because focus scrolling, geometry, occlusion,
accessible naming, lifecycle remount and secret absence are observable only in
the rendered application.

### 4. Use opt-in headed Chromium only as supporting real-tab lifecycle evidence

The standard `before` browser and ordinary invitation cases remain headless.
Only a test-file-owned, dedicated browser used by positive OWNER/ADMIN
lifecycle cases may launch headed, and only when
`E2E_TEAM_INVITATIONS_HEADED_FOCUS=1` is set. It must be short-lived and close
with its context even after failure. The test requires no runner/launcher edit:
the current launcher already forwards this opt-in environment variable to the
test process.

Before navigation, an init script records only `blur`, `focus`,
`visibilitychange`, visibility state and ordering/timestamps. It does not call
`dispatchEvent`, mutate page state, invoke an application action or produce a
network request. The test must visibly move the real target tab to a background
state and then foreground it; a CDP command, direct fetch, reload, route mock
or internal React/Redux seam cannot be used for the positive lifecycle.

Before the foreground return, the test pre-arms observers for the exact
`GET /api/teams/{teamId}`. It must associate a post-visible event witness with
an unmocked `200` response, prove the old action `ElementHandle` disconnected,
and only then locate the final current recovered control. The regular
API-origin route continuation used for an isolated runtime is not a mock but
must not intercept/fulfill this target GET. The one-exact-GET `404` unavailable
route remains a separate negative UI-boundary test and must never satisfy this
positive proof.

The temporary headed browser may briefly take the user's OS focus. The executor
must announce that before the opted-in command. If Chromium cannot display or
the observer cannot witness the required genuine transitions, record a
test-environment failure—not a behavioural RED or GREEN. That failure cannot
serve as positive lifecycle proof, but it also cannot block the bounded
metadata-only remediation when the deterministic remount contract passes.

### 5. Record native AX infeasibility and reserve automation for a separate infrastructure change

The headed attempt is recorded as a test-environment failure, but architecture
feasibility/security found no direct macOS AX bridge within this change's
test-file-only scope. Adding that bridge would be a new native test
infrastructure capability, so task 1.3d is intentionally unchecked and the
lifecycle evidence remains optional/supporting. This change does not execute a
native AX command in order to authorize production.

AppleScript, CUA, coordinate clicks, global shortcuts, fuzzy AX selection and
any interaction with user Chrome or the in-app browser are not acceptable
substitutes. The absence of a safe bridge cannot be converted to behavioural
GREEN, a CI replacement or sole authorization for the pending TSX/CSS patch.

The earlier native-AX proposal remains a security contract for a future
standalone native-test-infrastructure OpenSpec change only: exact test-owned
Chromium, temporary profile, non-secret readiness receipt, exact owned
PID-plus-sentinel identity, observer-authoritative event/GET/handle barriers
and exact owned process/profile cleanup without broad kill/delete operations.
That future change must go through separate architecture, task-audit and
security gates before it can offer an automated local/manual command.

An optional manually witnessed local check may be recorded as supporting
evidence. It is never an E2E GREEN result, never repairs the missing browser
event witness and never serves as sole production authority or a fallback path.

### 6. Limit production ownership to invitation management and CSS

Only after the new test-review gate, production work is restricted to
`TeamInvitationManagement.tsx` and `TeamInvitationManagement.module.css`. The
TSX may extend the existing metadata-only recovery lifecycle and only the
component/CSS layout needed for the frozen test. It may not move revalidation
into `TeamWorkspacePage`, persist state, add global state or change
API/idempotency/authorization semantics. Backend, workspace shell, API, RTK,
launcher or fixture expansion requires a separate OpenSpec decision.

The production change does not modify `TeamWorkspacePage`, its catch-all
unavailable branch or the `404 TEAM_NOT_FOUND` server contract. Nothing in the
metadata recovery mechanism is allowed to override parent rendering or weaken
server authorization; the test-only unavailable interception validates that
boundary rather than emulating an authority transition.

### 7. Final verification is isolated and inspects the narrow production diff

The existing invitation E2E launcher creates a disposable schema and accepts
`E2E_TEAM_INVITATIONS_PORT` and `E2E_TEAM_INVITATIONS_WEB_PORT`. Each RED/GREEN
and final run uses an explicit unused custom pair, records the pair and cleanup,
and does not touch the user's `:8080/:5173` runtime.

Final verification includes the full invitation-secret lifecycle, not only the
geometry tests, plus typecheck, build, strict OpenSpec validation and
`git diff --check`. One explicitly headed lifecycle command with
`E2E_TEAM_INVITATIONS_HEADED_FOCUS=1` may be recorded as supporting evidence:
when available, evidence records the command, explicit headed mode, observed
hidden/blur and visible/focus-or-visibilitychange order, the exact real
`GET /api/teams/{teamId}` `200`, old-handle detachment, final current control,
isolated browser/process/schema cleanup and the separate one-GET `404`
unavailable boundary. A display/event-witness failure is recorded as
test-environment failure, never GREEN or RED, and does not block deterministic
remount acceptance. Static inspection confirms
that changed production paths
are a subset of the two allowlisted component/CSS files and contain no
`TeamWorkspacePage` change, phone/mobile media rule, fixed/sticky action bar,
JavaScript scrolling, raw URL/token/auth-token/idempotency-key recovery field,
storage persistence, API/RTK/launcher/fixture change or feature-flag change.
This scope check does not replace behavioural E2E evidence.

If headed evidence is a test-environment failure, final evidence records the
native-AX feasibility decision: no direct bridge in the test-file-only scope,
task 1.3d unchecked and optional manual evidence only. It records no native
command or automated receipt. A future automated route requires a separate
native-test-infrastructure OpenSpec change; production acceptance remains based
on deterministic remount RED→GREEN, role denial, secret absence, geometry and
the static allowlist.

## Risks / Trade-offs

- **A remount can make a CSS fix look sufficient until focus changes** → the
  recovery test forces the observable focus/visibility transition in both cells.
- **A metadata record could leak a secret** → the record is metadata-only and
  E2E probes DOM, URL, history and both browser storage surfaces.
- **Recovery could bypass authority** → parent revalidation remains the render
  gate; MEMBER and unavailable flows assert no controls and zero mutations.
- **A replacement could target a stale invitation** → assert one reissue for
  the current recovered ID, no create, replacement-only recovery and revoke
  cleanup.
- **A single matrix loop hides one result** → two top-level named tests must
  execute independently.
- **Wrapping can make the card taller** → vertical scrolling is allowed; focus
  visibility and no horizontal overflow remain release criteria.
- **A visibility test could pass against a stale DOM node** → force a same-route
  parent remount through the real team-detail GET and require the old
  `ElementHandle` to disconnect before checking recovery.
- **A test could confuse unavailable UI with a server-side revocation flow** →
  intercept only the next real team-detail GET as the existing 404 response;
  do not change server authority or mock invitation mutations.
- **A headless foreground switch may not cause a real OS tab lifecycle** → the
  positive proof uses the explicit headed opt-in, observer-only event witness
  and post-visible real `200` GET; no synthetic/CDP workaround is accepted.
- **Visible test Chromium can steal focus** → announce it before execution and
  ensure the dedicated browser/context is cleaned up even after failure.
- **A native AX workaround could select or terminate a user browser** → do not
  implement native AX in this scope; AppleScript/CUA/coordinates/user-browser
  paths remain prohibited until a separately reviewed infrastructure change.
- **The missing bridge could be mistaken for proof** → record lifecycle evidence
  as TE/manual-supporting only; manual witness is optional evidence only and
  never a passing lifecycle or production fallback.
- **An ID assertion could accidentally target the original invitation after a
  replacement** → retain safe metadata IDs and assert exact reissue/revoke
  paths and one-request counts for original versus replacement.

## Migration Plan

No data or deployment migration is required. If approved, the scoped frontend
correction rolls back as one component/CSS change and does not change persisted
state or feature-flag defaults. The existing partial CSS experiment is not a
deployment candidate until the expanded contract is GREEN.
