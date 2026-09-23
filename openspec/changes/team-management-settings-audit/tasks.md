# Tasks

## Shared RED-test inputs and evidence rules

All RED work below uses `proposal.md`, `design.md`, the capability spec, V11,
the existing P0 invitation/roster regression fixtures, and the current
team-workspaces feature-gate setup. Backend tasks use the existing
`Postgres16TestSupport` with an owned disposable PostgreSQL 16 scratch database
selected through `TEAM_TEST_PG_DATABASE`; they do not use H2 as substitute.
Run backend commands from `backend/`:

`TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> mvn -q -Dtest=<named-tests> test`

Browser work adds `frontend/tests/e2e/teams/run-team-management-settings.mjs`
and `npm run e2e:team-management-settings`. Its isolated runner accepts only
verified-free `E2E_TEAM_MANAGEMENT_PORT` and
`E2E_TEAM_MANAGEMENT_WEB_PORT`, fails before startup if either is occupied,
and never binds, stops or restarts the user's `:5173`/`:8080` runtime. The
authoritative browser command runs from `frontend/`:

`E2E_TEAM_MANAGEMENT_PORT=18096 E2E_TEAM_MANAGEMENT_WEB_PORT=15196 npm run e2e:team-management-settings`

Each pre-implementation task records a redacted transcript in the named
`evidence/red/` file. Valid RED means an existing, cleanly started PostgreSQL
fixture or isolated browser app reaches an assertion that fails because the
specified endpoint/UI behaviour is absent or wrong. Compilation, migration,
fixture, port, startup or network errors are infrastructure failures, never
RED evidence. Tests become immutable input to production tasks after
TASK-5-05 accepts their evidence; any later test change requires the same
auditor/test-reviewer gate again.

## 1. Freeze the P1 contract and prove missing behaviour first

- [x] 1.1 **TASK-5-00 — Product Owner + Architect.** Confirm the manager-only
  audit boundary and its explicit deferrals. Product approval and architectural
  re-review are recorded in this change's handoff record: replay returns its
  recorded outcome plus current safe resource, there is no durable
  `COMMAND_PENDING`, audit output is allowlisted, and an effective owner must
  be ACTIVE. Verification: strict OpenSpec validation remains GREEN.

- [x] 1.2 **TASK-5-01 — Developer-agent (test code only), depends on
  TASK-5-00; reviewer: test-reviewer-agent.** Add
  `backend/src/test/kotlin/com/interviewonline/controller/TeamManagementAuditReadIntegrationTest.kt`.
  On PostgreSQL 16, its named RED cases must assert: (a)
  `GET /api/teams/{teamId}` is protected, private/no-store and adds only the
  documented `revision` to the backwards-compatible safe detail shape; (b)
  manager audit has exact page/item keysets, DESC `createdAt,id`, allowed
  pagination, invalid-query `400 INVALID_AUDIT_QUERY`, 401/403/404 boundaries
  and private/no-store headers; (c) each known action is public, unknown
  storage action becomes `LEGACY_UNCLASSIFIED`, and every public `outcome` is
  literal `SUCCESS`; (d) actor/target use only current ACTIVE same-team
  `User.displayName`, with blank/unsafe value mapped to `Участник`, never
  nickname/login/email; (e) V11 has the required columns and
  `(team_id,created_at,id)` index. Known public actions with LEFT or foreign
  actor/target must retain their public action but expose null identities; a
  before/after `team_audit_events` snapshot must prove audit GET appends no
  event. Every audit 400/401/403/404 denial must use exact `{error,code}` with
  no page/item/resource/identity/receipt/invitation fields. Add typed-writer
  vocabulary coverage and reject a historical invitation event containing raw
  URL/token/envelope as `entityId`; add bidi/zero-width displayName and
  `page=10000`/`page=10001` boundary cases. Run
  `TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> mvn -q -Dtest=TeamManagementAuditReadIntegrationTest,TeamSchemaMigrationIntegrationTest test`
  from `backend/`; record assertion-only RED evidence in
  `evidence/red/task-5-01-audit-read.md`.

- [x] 1.3 **TASK-5-02 — Developer-agent (test code only), depends on
  TASK-5-00; reviewer: test-reviewer-agent.** Add
  `backend/src/test/kotlin/com/interviewonline/controller/TeamManagementCommandIntegrationTest.kt`
  and, where a real restart is needed,
  `TeamManagementCommandRestartHttpIntegrationTest.kt`. Named RED cases cover:
  the complete rename and role authority/header matrix: unauthenticated,
  foreign/nonmember, ACTIVE MEMBER, former OWNER now ADMIN, invalid/inactive
  target and permitted caller each receive the specified status/code, and every
  normal/error response is `Cache-Control: private, no-store`; owner-only
  `ADMIN↔MEMBER`; exact safe rename/role response keysets; required/invalid/
  reused idempotency keys; stale team/member CAS with permitted
  `currentRevision`; canonical name and invalid role; `UNCHANGED`; one
  audit/receipt/domain mutation; and no change to membership state/epoch,
  security revision, room owner, room/interview grant or candidate access. For
  rename and role separately, prove restart and
  lost-response replay after a later permitted mutation: recorded outcome plus
  `recovered=true` but current safe resource, not historical JSON. Prove a
  lock contender never receives `COMMAND_PENDING`: it waits for a terminal
  result or returns only `503 TEAM_MANAGEMENT_BUSY` with `Retry-After: 5`.
  Repeat the bounded team-lock proof independently for role update. Add an
  allowed ADMIN→MEMBER downgrade and both rename/role `UNCHANGED` terminal
  receipt plus same-key recovered replay cases: zero audit/revision changes
  beyond receipt creation. After a successful public ownership transfer,
  original owner must rename with a fresh key/revision as effective ADMIN but
  remain forbidden from role/transfer. Every command denial has exact
  `{error,code}` (CAS only `{error,code,currentRevision}`), private/no-store,
  and no protected foreign field.
  A held PostgreSQL `SELECT ... FOR UPDATE` team lock is the controlled rollback
  trigger; after the 503 every recorded baseline row (name, team/merge/member
  revisions, role/state/epoch, security revision, room/grant/interview/candidate
  rows, audit and receipt) is unchanged, with no production-only failure seam.
  Run
  `TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> mvn -q -Dtest=TeamManagementCommandIntegrationTest,TeamManagementCommandRestartHttpIntegrationTest test`
  from `backend/`; record assertion-only RED evidence in
  `evidence/red/task-5-02-commands.md`.

- [x] 1.4 **TASK-5-03 — Developer-agent (test code only), depends on
  TASK-5-00; reviewer: test-reviewer-agent.** Add
  `backend/src/test/kotlin/com/interviewonline/controller/TeamOwnershipTransferIntegrationTest.kt`.
  Its named RED cases use a baseline with ACTIVE owner/admin/member plus room,
  room/interview grant and candidate-access rows. Assert: only current owner
  can transfer; target is another ACTIVE member; after success exactly one
  effective owner exists, old/new stored roles are ADMIN and only required
  revisions advance; exact success keyset
  `{outcome,recovered,team,affectedMembers}` with documented safe nested
  keysets and `[previousOwner,newOwner]` order; and private/no-store on every
  success/error response. Concurrent transfers give exactly one `200` winner;
  the loser is a defined `409` or `503`, creates neither receipt nor audit nor
  domain partial state. The role-update-versus-transfer race is asserted in two
  controlled serialisations using the same original owner: (1) role owns the
  team lock and commits first, so role succeeds and transfer with the prior team
  revision is `409 TEAM_REVISION_CONFLICT`, with only the role receipt/audit;
  (2) transfer commits first, so old owner role update is
  `403 TEAM_OWNER_REQUIRED`, with only the transfer receipt/audit. Both leave
  exactly one ACTIVE effective owner, prescribed stored roles/revisions and all
  non-expansion baseline rows byte-for-byte unchanged. Directly seed an inactive current-owner membership and prove
  fail-closed with no receipt/audit/domain write. Transfer has a deliberately
  different replay case: because the original caller loses OWNER authority, an
  exact retry is `403 TEAM_OWNER_REQUIRED` before outcome disclosure; current-
  resource replay is therefore tested for rename/role in TASK-5-02 and is not
  falsely asserted for transfer. Independently hold the team lock for transfer
  and assert bounded `503 TEAM_MANAGEMENT_BUSY`, `Retry-After: 5`,
  private/no-store, no durable pending receipt and unchanged full snapshot.
  Every transfer 400/401/403/404/409/503 denial must have exact safe error
  shape (`{error,code,currentRevision}` only for CAS) and no target, receipt,
  audit, identity or invitation disclosure. Run
  `TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> mvn -q -Dtest=TeamOwnershipTransferIntegrationTest test`
  from `backend/`; record assertion-only RED evidence in
  `evidence/red/task-5-03-ownership.md`.

- [x] 1.5 **TASK-5-04 — Developer-agent (test code only), depends on
  TASK-5-00; reviewer: test-reviewer-agent.** Add
  `frontend/tests/e2e/teams/e2e-team-management-settings.mjs`, its isolated
  `run-team-management-settings.mjs` launcher and named package script. Before
  production changes, keyboard-only RED cases must cover OWNER, ADMIN and
  MEMBER settings matrices; visible focus and 44px controls; labelled transfer
  confirmation plus focus restoration; no optimistic owner claim; post-success
  server refresh where former owner loses and new owner gains controls; same-key
  lost-response retry; CAS draft preservation; manager safe audit labels/error
  retry; and MEMBER's absence of audit/mutation requests and browser
  persistence. The named audit privacy case asserts `LEGACY_UNCLASSIFIED` is
  rendered only as its neutral public label and an audit error clears/withholds
  prior items; UI and network never render raw unknown action, identity
  fallback, receipt or prohibited audit fields. Snapshot URL/history,
  localStorage and sessionStorage before/after every mutation flow and prove no
  settings/audit/role/revision/target/draft/idempotency state is persisted;
  after successful transfer focus moves to the terminal status or defined
  successor. Feed every public audit action and assert only its fixed Russian
  label, never raw code. Run the shared browser command above and record selected ports plus assertion-only RED evidence in
  `evidence/red/task-5-04-e2e.md`.

- [x] 1.6 **TASK-5-05 — Prompt-task-auditor-agent (accountable) then
  test-reviewer-agent, depends on TASK-5-01, TASK-5-02, TASK-5-03 and
  TASK-5-04.** Inspect the immutable tests and four redacted evidence files.
  Reject implementation if any command was not run, RED is infrastructure-only,
  ports are unsafe, assertions omit exact authority/CAS/replay/race/cache/
  privacy/DTO/non-expansion conditions, or E2E is replaced by unit tests.
  Verification: a written `ready` verdict names all paths and commands.

## 2. Server-side audit, rename, roles and ownership

- [x] 2.1 **TASK-5-06 — Developer-agent, depends on TASK-5-05.** Implement
  typed audit vocabulary and manager-only paginated projection, plus the
  backwards-compatible revision-bearing protected team-detail read required by
  TASK-5-01. Reuse V11 only after TASK-5-01 PostgreSQL evidence passes; add no
  payload columns. Enforce typed writers, invitation entity validation,
  Unicode-safe display normalisation and the explicit page window. Turn the
  revised frozen audit/read assertions GREEN.

- [x] 2.2 **TASK-5-07 — Developer-agent, depends on TASK-5-05.** Implement
  the common secure management command boundary: authenticated TEAM receipt
  namespace, canonical hashing, current-authority replay with current safe
  reconstruction, no durable pending state, secure errors, no-store, bounded
  lock handling and rollback. Turn the frozen command assertions GREEN.

- [x] 2.3 **TASK-5-08 — Developer-agent, depends on TASK-5-06 and TASK-5-07.**
  Implement OWNER/ADMIN rename with existing canonicalisation, team CAS,
  `RENAMED|UNCHANGED`, receipt/audit atomicity and no expansion. Turn frozen
  rename assertions GREEN.

- [x] 2.4 **TASK-5-09 — Developer-agent, depends on TASK-5-06 and TASK-5-07.**
  Implement current-owner-only stored `ADMIN|MEMBER` updates with target CAS,
  owner-target immutability and atomic audit/receipt. Turn frozen role
  assertions GREEN.

- [x] 2.5 **TASK-5-10 — Developer-agent, depends on TASK-5-06, TASK-5-07 and
  TASK-5-09.** Implement atomic ownership transfer using team-first ordered
  locks and commit-time active-owner/target rechecks. Preserve room/interview/
  grant/epoch/security-revision data and turn frozen transfer/race assertions
  GREEN.

- [x] 2.6 **TASK-5-11 — Developer-agent, depends on TASK-5-08, TASK-5-09 and
  TASK-5-10.** Complete only the exact safe management mutation DTOs/routes;
  the protected team-detail revision read was delivered in TASK-5-06. Do not
  add unauthorised detail/search/export endpoints. Run all three backend RED
  suites plus invitation/roster and migration regressions on PostgreSQL 16.

## 3. Role-aware accessible client surface

- [x] 3.1 **TASK-5-12 — Developer-agent, depends on TASK-5-11.** Add typed
  scoped RTK Query contracts for revision-bearing settings read, exact safe
  mutations and audit pages. Test pure key retention/error mapping without
  replacing E2E.

- [x] 3.2 **TASK-5-13 — Developer-agent, depends on TASK-5-12.** Implement
  accessible settings: all ACTIVE roles see safe identity; OWNER/ADMIN rename;
  OWNER-only roles and transfer confirmation; loading/alert/focus/44px/CAS
  draft/retry; invalidate/refetch current authority. Turn frozen settings E2E
  assertions GREEN without browser persistence.

- [x] 3.3 **TASK-5-14 — Developer-agent, depends on TASK-5-12.** Implement
  manager-only audit list with fixed labels, neutral legacy item, pagination,
  retry and no stale disclosure. MEMBER neither renders nor requests it. Turn
  frozen audit E2E and direct server denial assertions GREEN.

## 4. Reconciliation, release gates and next-plan handoff

- [ ] 4.1 **TASK-5-15 — Developer-agent, depends on TASK-5-13 and TASK-5-14.**
  Run isolated management E2E, all targeted PostgreSQL suites, typecheck/build
  with team feature on/off, P0 invitation/roster regressions, strict validation
  and `git diff --check`. Record commands, ports and redacted GREEN evidence;
  only actually run tests count.

- [ ] 4.2 **TASK-5-16 — Solution-reviewer-agent, security-reliability-agent,
  QA-agent, test-reviewer-agent, UX-critic-agent and Product Owner, depends on
  TASK-5-15.** Review final source/evidence for server authority, CAS/
  idempotency/replay/races, receipt/audit privacy/cache, exact non-expansion,
  keyboard/focus role clarity and P1 scope. A blocking security finding stops
  release. On approval, Team Lead prepares the next employee-lifecycle slice;
  no global feature enablement is implied.
