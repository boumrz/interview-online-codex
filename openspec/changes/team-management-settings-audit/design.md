# Design

## Context

See [proposal.md](proposal.md) for motivation. The P0 invitation/roster baseline
has server-authoritative team membership: stored roles are `ADMIN|MEMBER`, and
effective `OWNER` is derived from `teams.owner_user_id` plus ACTIVE membership.
V11 already has `teams`, `team_memberships`, `team_audit_events`, their ordered
audit index, and 24-hour `command_receipts`.

This P1 change is restricted to team settings and audit. It preserves the fixed
React/RTK Query and Kotlin/Spring/PostgreSQL stack, existing team feature-gate
posture, and completed invitation/roster privacy contract. It never turns a
team-management role into a room or interview grant.

## Goals / Non-Goals

**Goals:**

- Make rename, stored `ADMIN↔MEMBER` update and team-owner transfer atomic,
  idempotent and server-authoritative.
- Give managers a minimal, private audit projection with a stable public action
  vocabulary.
- Render only current server-confirmed authority in an accessible UI, including
  keyboard, focus, conflict, retry and lost-response states.
- Require RED-first integration/E2E evidence before production changes.

**Non-Goals:**

- Membership state/epoch changes; suspension, removal, leave, rejoin or
  recovery.
- Room-owner transfer, interview/candidate access, grants, HIRING/INTERVIEWER
  sources, SSE, polling, realtime invalidation or new auth schemes.
- Audit export/search/filter/detail routes, retention/deletion rules, arbitrary
  audit payloads, before/after values or inactive-member identity history.
- Global feature enablement or changing accepted invitation-secret/roster work.

## Decisions

### D1. Team ownership remains derived and has narrow effects

`OWNER` remains effective, never a stored membership role. A transfer changes
only the single `teams.owner_user_id`; old and new owners are stored `ADMIN`.
This retains the existing source of truth and lets the former owner continue
ordinary manager work without retaining owner-only authority.

`teams.owner_user_id` is valid only while it names an `ACTIVE` membership in
the same team. Every P1 management command locks the team first and then
rechecks the current owner's membership as `ACTIVE`; it fails closed rather
than operating on a legacy-invalid team. A transfer also locks the old and
target memberships in ascending user-ID order and rechecks both after locking.
No P1 endpoint changes membership state. Any later writer that can move a
membership away from `ACTIVE` must take this same team-first lock and reject a
transition of the current owner; that lifecycle work is explicitly deferred,
not silently added here.

Transfer does not visit room rows or recalculate interview grants, candidate
access, membership state/epoch, `security_revision`, or HIRING/INTERVIEWER
sources. The server recomputes current authority for each management request;
the client refetches after confirmed success.

**Alternative rejected:** storing `OWNER` in memberships or propagating team
ownership into rooms. Both create multiple sources of truth and expand P1 into
the later room/grant lifecycle.

### D2. Endpoint-scoped CAS, receipts and one transaction per command

| Command | CAS / ordered locks | Receipt operation | Commit effects |
|---|---|---|---|
| rename | team revision; team lock; active manager recheck | `TEAM_RENAME` | name, team + merge revisions, one `TEAM_RENAMED` event |
| role update | target membership revision; team then target lock; current owner recheck | `TEAM_MEMBER_ROLE_UPDATE` | target stored role/revision, team + merge revisions, one `MEMBER_ROLE_UPDATED` event |
| transfer | team revision; team then old/target memberships ordered by user ID; current owner/target ACTIVE recheck | `TEAM_OWNERSHIP_TRANSFER` | owner ID, needed stored ADMIN roles/revisions, team + merge revisions, one `TEAM_OWNERSHIP_TRANSFERRED` event |

All lock waits are bounded and every authority/state/CAS condition is rechecked
after waiting. `CommandReceipt` is namespaced by authenticated actor, TEAM
scope/team ID, operation and UUID. It stores a canonical request hash, terminal
outcome/status and resource ID in the same transaction as the domain write and
audit event. It deliberately does **not** store a historical response body.
After current authentication and endpoint-authority rechecks, an exact
same-body/key replay returns the recorded terminal `outcome` with
`recovered=true` and a freshly read current safe `team`/`member` representation.
It proves exactly-once mutation, not byte-identical historical JSON. A changed
canonical body is `409 IDEMPOTENCY_KEY_REUSED`; an old owner cannot use an
owner-only receipt after becoming ADMIN.

`UNCHANGED` rename/role commands get terminal receipts but no revision or audit
event. A race produces one complete transaction or a defined conflict/busy
outcome; rollback cannot leave a partial receipt, audit, role or owner write.
`merge_revision` changes because future merge planning uses these inputs. This
slice does not increment epoch or `security_revision`.

**Alternative rejected:** last-write-wins UI state. It cannot prove a single
owner, correct lost-response replay, or distinguish a stale request from retry.

### D3. Keep authority, cache and error boundaries uniform

Controllers use the existing secure error shape and authorize before any
target-specific disclosure. Every protected success and failure is
`Cache-Control: private, no-store`.

| Condition | Result |
|---|---|
| no authenticated session | `401` |
| unknown team or caller without ACTIVE membership | `404 TEAM_NOT_FOUND` |
| active caller lacks required manager/owner authority | documented `403` code |
| malformed body/query/key | documented `400` before mutation/query |
| stale CAS or invalid transfer target | documented `409` |
| same key with changed canonical body | `409 IDEMPOTENCY_KEY_REUSED` |
| lock/serialization wait exhausted | `503 TEAM_MANAGEMENT_BUSY`, `Retry-After: 5` |

No response embeds a receipt, previous request, foreign state, invitation
secret or unpermitted audit item. The browser keeps drafts on CAS conflicts and
only explicitly retries retryable transport/429/5xx with the same intent.

### D4. Audit is an explicit public projection, not a table dump

A typed `TeamAuditAction` vocabulary is the only production write boundary for
new audit events; arbitrary strings cannot be passed by a writer. A historical
storage unknown is projected as
`LEGACY_UNCLASSIFIED`; its raw value cannot reach UI or user-facing logs.
Current `team_audit_events` is append-only input, not its DTO.

The projection checks current manager authority, returns the exact field
allowlist, and joins actor/target display data only for accounts currently
ACTIVE in that same team. A display name comes only from safely normalised
`User.displayName`; it never falls back to nickname/login/email. A blank,
Unicode CONTROL/FORMAT (including bidi/zero-width), or otherwise unusable name
becomes the neutral fixed label `Участник`. Other identities are `null`. An
invitation `entityId` is emitted only after the server resolves it as an
invitation ID in that same team; arbitrary opaque storage text is `null`. It
maps every storage outcome to the fixed public literal
`SUCCESS`; it never exposes a stored outcome. Pagination metadata is the only
permitted count-like data; business counts and detailed results are forbidden.
It uses
`createdAt DESC,id DESC`, the bounded `0<=page<=10000,1<=size<=100` offset
window (at most one million skipped rows), no search/filter/detail endpoint and
no SSE/polling. Only state-changing commits append one `SUCCESS` event;
replays and `UNCHANGED` commands append none.

**Alternative rejected:** storing request/response JSON or before/after values.
It would add private name/role/invitation material and retention scope without
being needed for P1 observability.

### D5. RTK Query is a view, never an authority cache

Queries are scoped by active account/team. Successful commands invalidate team,
roster, settings and audit queries, then render controls from fresh server
authority. This makes former-owner controls disappear without persisting a role
claim in browser storage.

The UI uses semantic controls, named status/alert regions and a labelled
ownership confirmation dialog. Mutation intents are scoped to
account/team/operation/target and remain only in mounted memory for recoverable
failure. This feature writes no audit data, idempotency key, draft or secret to
URL/history/localStorage/sessionStorage.

### D6. Do not create schema work unless V11 is demonstrably insufficient

V11 already contains audit columns and `(team_id,created_at,id)` index; listed
actions fit its 64-character action field. The default plan reuses it. The
executor must prove that against a disposable PostgreSQL-compatible migration
fixture. If a real compatibility gap exists, only a reviewed additive migration
is allowed; it cannot add audit payloads or alter historical semantics.

### D7. Test-first evidence stays isolated

Backend integration is proportionate for transaction/receipt/restart/PostgreSQL
race/DTO/cache assertions. Browser E2E is required for keyboard role matrix,
transfer confirmation, conflict/retry and absence of MEMBER surfaces. Its
launcher uses verified-free isolated ports and must not bind, restart or stop
the user's local `:5173`/`:8080` services. Evidence redacts identities and all
secret/token material.

## Risks / Trade-offs

- [Role/owner commands race] → Team-first deterministic locks, post-wait
  rechecks, CAS and one receipt/audit transaction; test competing transfer and
  role/transfer cases.
- [Receipt bypasses a revoked owner right] → Recheck current authentication,
  ACTIVE membership and endpoint authority before replay; test former-owner
  replay.
- [Audit becomes a directory or interview disclosure channel] → Exact DTO,
  current-ACTIVE-only identities, no details/filter/export/payloads and negative
  field assertions.
- [Stale tab keeps owner controls] → Invalidate/refetch after commit and retain
  direct server denial; E2E tests old/new owner states.
- [V11 audit shape differs in a deployed schema] → Verify it on PostgreSQL
  before implementation; stop for reviewed additive migration instead of
  altering historic records.

## Migration Plan

1. Run and record behavioural RED integration/E2E evidence on current schema.
2. Prove V11 audit schema/index on disposable PostgreSQL; add no migration when
   it satisfies D6.
3. Deploy backend contract before frontend controls; keep team feature rollout
   unchanged and never globally enable it in this change.
4. Run focused feature-on/off, typecheck/build, strict validation and required
   security/solution/QA/UX/product gates.
5. Roll back by disabling new settings/audit UI and mutations while preserving
   scope guards and rows. No team, membership, audit, receipt or migration data
   is deleted. A rollback to a binary lacking TEAM guards remains forbidden.

## Open Questions

- **P1-AUDIT-DETAILS-01 (Product Owner):** This P1 intentionally omits
  before/after names or roles, inactive identity history, filters, export and
  retention. Any of those values needs a separate privacy/retention change;
  it must not be inferred while implementing this list.
- **P2-LABEL-LOCALIZATION-01 (Product Owner):** Fixed Russian labels in the
  capability are the P1 browser contract. Extra locales or action codes require
  a later vocabulary decision and cannot become arbitrary stored strings.
