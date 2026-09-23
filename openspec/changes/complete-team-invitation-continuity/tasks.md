# Tasks

## 1. Pre-implementation RED evidence and audit gate

- [x] 1.1 **Developer-agent — E2E, test code only.** Extend the named browser
  acceptance coverage in
  `frontend/tests/e2e/teams/e2e-team-invitation-management.mjs`; use only its
  isolated launcher `frontend/tests/e2e/teams/run-team-invitations.mjs`. Add
  the narrow test-only reconciliation in that same file **before production
  code**: replace only assertions superseded by this change that expect a raw
  URL from generic create/reissue responses or expect copy/dismiss/remount to
  make issuer-authorized recovery impossible. Retain all viewport, keyboard,
  focus, feature-flag, team-unavailable and authority-denial assertions.
  Then add
  independent named assertions that: successful copy leaves the issuer's
  current revealed link visible; reload restores only safe metadata and requires
  explicit creator reveal of the same URL; a second independent link remains
  valid after manual reissue of the first; account/team/logout clears raw
  in-memory state; manager list DTOs are URL-free; MEMBER sees roster but no
  invite controls; and browser persistence/history/route do not retain secret.
  Redact URLs from errors, trace and report output. Before production edits run
  `cd frontend && E2E_TEAM_INVITATIONS_PORT=<verified-free> E2E_TEAM_INVITATIONS_WEB_PORT=<verified-free> npm run e2e:team-invitations`
  and record a deterministic behavioural RED without binding/stopping the
  user's `:5173`/`:8080` runtime in `evidence/pre-implementation-red.md`,
  with exit result, named redacted assertion and verified-free ports.

- [x] 1.2 **Developer-agent — E2E, test code only.** In the same named suite,
  add the two-account flow: creator reveals/copies an invitation, another
  existing account accepts it, OWNER refreshes/returns focus to «Участники» and
  sees the new member, and the new MEMBER sees self/roster rather than «Раздел
  готовится». Assert the visible roster pagination/search loading/error state
  and that MEMBER never sends invitation mutation. Run the exact isolated
  command from task 1.1 and record the expected RED.

- [x] 1.3 **Developer-agent — backend integration exception, test code only.**
  Create `TeamInvitationLinkRecoveryIntegrationTest`. Before production code,
  make it fail against the current behavior while covering: feature-on keyring
  validation, feature-off requiring no encryption key while retaining the D9
  safety-reducing revoke exception; canonical unpadded Base64URL 32-byte AES
  keys; safe
  paginated metadata list with exact field allowlist/all lifecycle states/sort;
  complete reveal status and cache-header matrix; creator-only recovery;
  independent create and per-link reissue; post-copy/reload semantics;
  envelope clear on accept/revoke/reissue/EXPIRED; legacy rows; corrupt key,
  decrypt and hash mismatch; and deterministic barriers for cleanup-versus-
  reveal plus accept/reissue/revoke races through the test-profile-only
  `InvitationLifecycleTestBarrier` after team-lock/before invitation-lock and
  `INVITATION_BUSY`. For each released race, assert its permitted terminal
  winner: accept creates exactly one ACTIVE membership and no replacement;
  reissue creates exactly one creator-recoverable replacement and revokes its
  original; revoke creates no replacement; all branches make stale reveal
  unavailable and keep the envelope/key pair atomic. Run this class
  alone and record its RED with no secret in output; task 1.4 runs the required
  combined command after both named classes exist.

- [x] 1.4 **Developer-agent — backend integration exception, test code only.**
  Create `TeamMemberDirectoryIntegrationTest`. Make it fail before production
  edits while covering exact D6 `page=0,size=25,q`, nonnegative page, 1–100
  size, trimmed 200-code-point normalized-displayName-only query, filtered
  totals, OWNER→ADMIN→MEMBER/name/id ordering, exact item fields, neutral name
  fallback, 400 `INVALID_LIST_QUERY`, 401, 404 `TEAM_NOT_FOUND`, private
  no-store headers, active-only visibility, and accept-by-second-account roster
  reads. Then run
  `cd backend && mvn -q -Dtest=TeamInvitationLinkRecoveryIntegrationTest,TeamMemberDirectoryIntegrationTest,TeamSchemaMigrationIntegrationTest test`
  and retain both classes' RED evidence without secrets.
  Append its exit result, named redacted behavioural failures and zero
  infrastructure-error/skip evidence to `evidence/pre-implementation-red.md`.

- [x] 1.4a **Developer-agent — migration and H2-cleanup RED, test code only.**
  Extend the existing PostgreSQL-backed `TeamSchemaMigrationIntegrationTest` to
  assert Flyway V15's exact nullable `VARCHAR(512)` envelope and `VARCHAR(64)`
  key columns, all-or-none constraint, unchanged persisted
  `PENDING|ACCEPTED|REVOKED` state constraint, and cleanup index
  `(state,expires_at,id)` in that order. The H2 `test` profile proves only the
  one-candidate cleanup/recheck seam: use two selected expired rows and an
  expiry-change hook to prove one candidate is cleaned while a rechecked future
  candidate retains its pair. It must assert the cleanup bean is test-profile
  only and has no HTTP mapping. Add it to the combined backend command and
  append a redacted observed RED result to the evidence file.

- [x] 1.5 **Prompt-task-auditor-agent and test-reviewer-agent.** Review the
  frozen RED tests before implementation. Reject absent exact test paths or
  commands, non-isolated ports, unredacted secret evidence, missing
  post-copy/reload/manual-reveal behavior, missing surviving second link,
  unreconciled superseded raw-link assertions, lifecycle/error/cache/race gaps,
  incomplete D6 q/boundary tests, or any
  skipped/infrastructure result labelled RED. Approve production work only on
  deterministic behavioural RED evidence.

## 2. Server-side encrypted invitation continuity

- [x] 2.1 **Developer-agent — migration and protected configuration.** Add a
  Flyway migration with `recoverable_token_envelope VARCHAR(512)`,
  `recovery_key_version VARCHAR(64)`, all-or-none constraint and
  `(state,expires_at,id)` cleanup index without changing the persisted
  `PENDING|ACCEPTED|REVOKED` state constraint. Add exactly
  `app.team-invitation-link-encryption.active-key-id` and protected map
  `app.team-invitation-link-encryption.keys.<key-id>`; no production default,
  canonical unpadded Base64URL/32-byte AES validation, unique IDs, feature-ON
  startup fail-closed and feature-OFF no-key/D9 safety-reducing-revoke-exception
  behavior. Preserve old PENDING links as null-envelope unrecoverable legacy
  rows. Verify configuration in `TeamInvitationLinkRecoveryIntegrationTest`,
  exact migration invariants in `TeamSchemaMigrationIntegrationTest` on
  PostgreSQL-compatible integration, and the H2 cleanup seam separately. H2
  create-drop is limited to cleanup semantics and is not migration evidence.

- [x] 2.2 **Developer-agent — safe invitation API and crypto.** Implement the
  manager-only common-paginated list with exact metadata fields/states/sort and
  private no-store headers; retain independent create semantics; keep generic
  create/reissue/list DTOs URL-free; and implement explicit creator-only
  `GET .../link` with the exact 401/403/404/410/503/409 mapping, retry headers
  and success `Pragma: no-cache`. Encrypt a 32-byte bearer token in a versioned
  AES-GCM envelope bound to invitation/team/creator AAD, then constant-time
  hash-verify after decrypt. Verify every relevant RED test in task 1.3 turns
  GREEN without raw secret in any DTO, log, receipt, audit, metric or trace.

- [x] 2.3 **Developer-agent — lifecycle locking, expiry and race hardening.**
  Make every mutating/reveal operation lock team then invitation, then recheck
  state/expiry/authority/hash. Atomically clear old envelope on accept/revoke/
  reissue; terminalize expiry in each current-access path. Add `fixedDelay=60s`
  cleanup that handles at most 100 IDs per pass; each candidate transaction
  locks team then invitation using PostgreSQL `SKIP LOCKED` and a 5-second lock
  timeout, rechecks state and clears only envelope/key version. Keep database
  state PENDING and project effective `EXPIRED`; provide an explicit
  H2-compatible scheduler test path through the non-HTTP test-profile
  `TeamInvitationExpiryCleanup.cleanupOneCandidateForH2Test()` seam for the
  same single-candidate semantics. Its H2 harness MUST activate the `test`
  profile, assert the seam has no non-test-profile or HTTP exposure, and keep
  Flyway disabled there. Map conflicts to
  Map conflicts to `503 INVITATION_BUSY`/`Retry-After: 5`. Verify all
  deterministic barrier races in task 1.3 turn GREEN without deadlock or
  partial state.

## 3. Server-side and client D6 participant directory

- [x] 3.1 **Developer-agent — backend roster contract.** Implement
  `GET /api/teams/{teamId}/members` as the exact D6 common list:
  `{items,page,size,totalElements,totalPages}` and only
  `{userId,displayName,role,state,revision}` items. Enforce all q/default/
  bounds/errors/cache/active-only/sort/privacy behavior from task 1.4; derive
  OWNER, use neutral display fallback, and keep no room/interview grant surface.
  Verify `TeamMemberDirectoryIntegrationTest` turns GREEN.

- [x] 3.2 **Developer-agent — invitation client contract.** Update client
  types/queries and management UI to render the safe manager list, each
  invitation's recoverability and reveal permission, and a raw URL only after
  explicit issuer action. Keep raw data transient; copy leaves current display
  visible; reload requires explicit reveal; account/team/logout clears memory;
  create another link does not rotate existing links. Implement the specified
  per-invitation `role="article"` and safe accessible-name/control contract so
  actions bind to their opaque invitation ID rather than DOM position. Verify
  task 1.1 E2E turns GREEN with no browser-persistent secret data.

- [x] 3.3 **Developer-agent — participants UI and authority separation.**
  Replace the MEMBER «Раздел готовится» branch with D6 roster loading/empty/
  invalid-query/unavailable states and pagination/search controls. Refetch on
  entry, focus and ordinary page refresh; do not add polling/SSE. Render roster
  for every active role; mount invitation controls only for OWNER/ADMIN and
  retain direct server denial for MEMBER mutations. Implement the specified
  accessible loading, alert/retry, empty and pagination names. Verify task 1.2
  E2E turns GREEN.

## 4. Reconciliation, verification and roadmap handoff

- [x] 4.1 **Developer-agent — reconciled secret-lifetime regression verification.**
  After tasks 1–3 are GREEN, verify the narrow pre-implementation test
  reconciliation from task 1.1 remains limited to the issuer-secret statements
  in `design-team-interview-journey/design.md` D4 paragraphs 141–149 and raw-URL
  D6 invitation rows. Confirm its assertions require post-copy visible link,
  reload safe metadata plus explicit reveal, and URL-free generic DTOs, while
  keyboard, geometry, viewport, focus/remount, feature-flag, MEMBER-denial,
  unavailable-team and layout evidence remain unchanged. Do not edit production
  or unrelated documentation; verify the full suite is a secret-redacted pass
  under the isolated frontend command in task 1.1.

- [x] 4.2 **Developer-agent.** Run the exact isolated frontend E2E command from
  task 1.1 and combined backend command from task 1.4; then run frontend typecheck/build,
  relevant workspace navigation regressions,
  `npx --yes @fission-ai/openspec@latest validate complete-team-invitation-continuity --strict`
  and `git diff --check`. Record verified-free ports, commands and secret-
  redacted evidence; do not bind, stop or restart the user's `:5173`/`:8080`
  processes.

- [x] 4.3 **Solution-reviewer-agent and security-reliability-agent.** Review
  final evidence for exact supersession scope, key namespace/key validation,
  AES-GCM envelope/AAD/hash verification, derived effective EXPIRED without
  persisted-state expansion, cleanup worker
  bounds/locks/races, full reveal error/cache matrix, URL-free metadata, D6
  roster contract, privacy and no interview privilege expansion. A blocking
  security finding stops release.

- [x] 4.4 **QA-agent and test-reviewer-agent.** Verify E2E and integration
  coverage for every delta scenario and all named error/cache/race/default/q
  conditions. Do not classify an unrun or infrastructure-failed test GREEN.

- [x] 4.5 **Product-owner-agent.** Confirm creator-only explicit recovery,
  per-link manual rotation, multi-link continuity, roster freshness and
  manager-only invitation controls meet the requested P0 slice. On acceptance,
  update the P0-first roadmap ordering without globally enabling team workspaces.

- [x] 4.6 **Team-lead-agent.** After 4.3–4.5 approve, decompose the remaining
  section-5 role lifecycle, ownership-transfer, settings and audit work without
  duplicating this invitation/roster slice. Every executable follow-up begins
  with its stated E2E or documented integration RED test.
