# Design

## Context

The active team-workspace design records only a one-way invitation-token hash:
it lets a recipient redeem a known link but cannot restore an issuer's URL.
It also defines a D6 active-member roster contract that the current API and
MEMBER route do not yet implement. See `proposal.md` and the delta specs for
the externally observable behavior.

This design is constrained to Kotlin/Spring Boot, PostgreSQL-compatible
persistence and H2 integration tests. Team workspaces remain feature-gated;
this change does not enable them globally.

## Goals / Non-Goals

**Goals:**

- Recover the exact active URL for its original issuer after copy or reload,
  without a browser secret vault or implicit per-link rotation.
- Retain multi-link invitation behavior while adding a safe, manager-only
  lifecycle list and precise non-disclosing errors.
- Let every active role load the approved D6 roster on page entry/focus/refresh.
- Make encryption, migration, expiry and lock behavior deterministic enough for
  direct integration race tests.

**Non-Goals:**

- Email sending, multi-recipient campaigns, polling or SSE roster push.
- Role lifecycle, ownership transfer, member removal, team settings or changes
  to room/interview grants.
- Restoring an old raw token that was never stored encrypted, browser key
  storage or plaintext database fallback.
- Editing the active design/short-viewport files in this change; only the
  explicitly superseded test assertions are reconciled in the pre-implementation
  test task below.

## Decisions

### 1. Exact supersession and reconciliation scope

This change supersedes only the issuer raw-secret-lifetime text in
`design-team-interview-journey/design.md` D4 paragraphs 141–149: the creator
URL limited to component memory, clear-on-successful-copy/dismiss/unmount and
nonrecoverability after a lost response. It also supersedes only the raw-`url`
parts of D6 invitation rows (`GET/POST T/invitations` and reissue response),
which currently return a URL in generic DTOs. It further supersedes only the
raw-link assertions in `fix-invitation-management-short-viewport` that demand
the issuer's link disappear after copy/dismiss/remount and cannot recover it.

The replacement is narrow: safe invitation metadata survives reload; only a
current authorised creator explicitly reveals a recoverable URL; normal
create/reissue/list responses remain URL-free. Recipient fragment/session
handling, one-time acceptance, feature-flag defaults, generic team-unavailable
behavior, keyboard operation, responsive geometry, focus/occlusion proof and
all role-denial evidence are not superseded. The pre-implementation test
reconciliation changes only those secret-lifetime assertions and preserves
short-viewport layout evidence verbatim, so the required isolated E2E suite
can become GREEN after the URL-free implementation.

### 2. Invitation metadata API is manager-only and intentionally URL-free

`GET /api/teams/{teamId}/invitations` is a manager-only common-paginated list.
It returns every persisted lifecycle state in `createdAt DESC, id DESC` order.
Its item schema is exactly:

```text
{ id, state, role, expiresAt, revision, canReveal, linkRecoverability }
state = PENDING | ACCEPTED | REVOKED | EXPIRED
linkRecoverability = RECOVERABLE | UNRECOVERABLE_LEGACY | NOT_APPLICABLE
```

No generic invitation DTO includes raw URL/token, encrypted envelope/key ID or
creator/foreign-user identifier. `canReveal` is calculated server-side and is
true only for the current ACTIVE OWNER/ADMIN who is that record's creator, while
the state is PENDING and its envelope is recoverable. The same safe metadata is
returned by create/reissue. Every normal/error list and mutation response is
`Cache-Control: private, no-store`.

Each unique valid create intent mints a separate link without changing another
pending record. Exact idempotency replay returns its original safe outcome.
Explicit reissue/revoke retain their existing manager authority per record;
reissue creates a replacement owned by the actor that performed it, but no
manager may reveal another creator's old URL.

### 3. Reveal is an explicit issuer-only endpoint with a normalised privacy matrix

`GET /api/teams/{teamId}/invitations/{invitationId}/link` is called only after
the issuer chooses «Показать ссылку». It returns `200 {url}` plus
`Cache-Control: private, no-store` and `Pragma: no-cache` solely to an ACTIVE
OWNER/ADMIN who is the invitation creator and whose record is PENDING and
recoverable. The client retains that URL only in current in-memory issuer view;
successful copy leaves it visible. Dismiss/account switch/team switch/logout
clears memory, and reload refetches safe metadata then needs another explicit
reveal.

All reveal responses, including errors, are private/no-store and omit secret,
URL and detailed failure reason. The endpoint has this exact mapping:

| Caller/condition | HTTP result |
|---|---|
| unauthenticated | `401` |
| unknown team or caller no longer ACTIVE | `404 TEAM_NOT_FOUND` |
| ACTIVE MEMBER | `403 INVITATION_MANAGEMENT_FORBIDDEN` |
| ACTIVE manager but noncreator; missing, accepted, revoked, expired or legacy-unrecoverable record | `410 INVITATION_LINK_UNAVAILABLE` |
| corrupt/unknown envelope key, AES-GCM decrypt failure or hash mismatch | `503 INVITATION_LINK_RECOVERY_UNAVAILABLE`, `Retry-After: 5` |
| team/invitation lock conflict or timeout | `503 INVITATION_BUSY`, `Retry-After: 5` |

This intentional normalization prevents a manager from learning whether another
manager created, revoked, accepted or failed to encrypt a particular link.

### 4. Dedicated versioned AES-GCM keyring and envelope migration

The protected runtime configuration is exactly:

```text
app.team-invitation-link-encryption.active-key-id
app.team-invitation-link-encryption.keys.<key-id>
```

Every key value is canonical **unpadded Base64URL** decoding to exactly 32
bytes for AES-256. Key IDs are unique and the active ID must name a configured
key. There are no production defaults. When the team-workspace feature is ON,
startup fails closed if the active key is absent, noncanonical, invalid or not
in the map; feature OFF does not require a key. A test-only keyring belongs
solely in test configuration. Feature OFF also preserves the existing D9
safety-reducing revoke exception unchanged: this encryption feature MUST NOT
silently tighten, remove or route around that baseline exception.

The migration adds nullable `recoverable_token_envelope VARCHAR(512)` and
`recovery_key_version VARCHAR(64)` with an all-or-none check constraint and
cleanup index `(state,expires_at,id)`. It MUST NOT alter the persisted
invitation-state check, which remains exactly `PENDING|ACCEPTED|REVOKED`. An
envelope contains a version,
96-bit random nonce and AES-GCM cipher/tag, encoded in canonical unpadded
Base64URL. Its authenticated data is
`team-invitation-recovery:v1:{invitationId}:{teamId}:{creatorUserId}`.

New create/reissue generate a 32-byte random bearer token, retain its existing
one-way hash and persist the encrypted envelope atomically. Reveal decrypts
with the stored version and constant-time compares a freshly computed hash with
the stored hash before returning a URL. Ciphertext copied to another invitation,
team or creator cannot validate. The existing chat HMAC, JWT key and any
client-delivered key are forbidden. Legacy PENDING rows retain null envelope
and key version: they remain redeemable by an invitee with the old address but
are `UNRECOVERABLE_LEGACY` to the issuer and require manual reissue.

### 5. Lifecycle concurrency and expiry are team-first and fail safely

Every mutating or reveal method uses the same lock sequence: resolve the team
from the path/token lookup, lock **team first**, then lock the invitation, then
recheck state, expiry, current authority and token hash before outcome. Create
locks team before allocating its new invitation. Accept resolves team ID from
the hash before taking team then invitation. Reissue, revoke and reveal already
have team ID and use the same ordering. Any lock conflict/timeout returns
`503 INVITATION_BUSY` with `Retry-After: 5`, no raw or partial data.

Accept, revoke and reissue atomically clear the old envelope/key version in the
same transaction as their state transition. Current access paths (list,
preview, accept, reveal, reissue and revoke) terminalize an expired PENDING
record under that lock by clearing its envelope/key version before returning.
They project this record as effective `EXPIRED` with
`linkRecoverability=NOT_APPLICABLE`, while keeping its persisted state PENDING.
A scheduled expiry worker also runs with `fixedDelay=60s`, selects at most 100
candidate invitation IDs per pass, and processes each in an independent
transaction: team lock → invitation `SKIP LOCKED` lock with a 5-second lock
timeout → state/expiry recheck → envelope/key-version clear. It never holds a
transaction across the whole batch. PostgreSQL executes the `SKIP LOCKED` path;
the non-HTTP `TeamInvitationExpiryCleanup` application component exposes
`cleanupOneCandidateForH2Test()` only to the test profile so H2 can verify the
same one-candidate transaction, recheck and cleanup semantics without requiring
unsupported PostgreSQL SQL. The scheduled adapter calls the same cleanup
command; the test seam is never mapped to HTTP or an externally reachable
operation. The H2 test profile deliberately uses create-drop/JPA schema and
does not run Flyway; it is not migration evidence. PostgreSQL-compatible
integration is the sole oracle for the Flyway all-or-none envelope constraint
and preserved three-state database constraint.

For deterministic lifecycle races, the test profile alone also supplies an
`InvitationLifecycleTestBarrier` hook immediately after the team lock and
before the invitation lock. It can coordinate cleanup/reveal and every pair of
accept, reissue and revoke so both transactions demonstrably reach the critical
phase before release. The hook has no non-test bean, HTTP mapping, persistence
side effect or production configuration; every scheduled and request path calls
the same no-op production port at that point.

Deterministic integration barriers cover cleanup-versus-reveal and the full
accept/reissue/revoke race matrix. Every outcome must be one terminal logical
result, no deadlock, no stale successful reveal and no partially cleared row.

### 6. Reuse the canonical D6 roster contract exactly

`GET /api/teams/{teamId}/members?page=<page>&size=<size>&q=<optional>` returns
the standard `{items,page,size,totalElements,totalPages}` response. Default is
`page=0,size=25`; page is a nonnegative integer; size is 1–100. `q` is trimmed
to 200 Unicode code points and filters normalized safe displayName only. Bad
page/size/q returns `400 INVALID_LIST_QUERY`. Totals are calculated after the
authorization predicate and active/name filter. Items are exactly
`{userId,displayName,role,state,revision}`, ordered OWNER → ADMIN → MEMBER then
normalized displayName/userId. Only ACTIVE rows are exposed; `state=ACTIVE`.

The service derives OWNER from team ownership, uses `Участник` for a missing
safe display name, and never shares DTOs with people pickers or interview data.
It responds `401` when unauthenticated and the same `404 TEAM_NOT_FOUND` for
unknown, foreign or non-active caller. Every normal/error response is
`Cache-Control: private, no-store`. Client «Вы» marker is locally derived from
the authenticated actor ID, not an extra DTO field.

The route queries on entry, focus and browser refresh. It shows roster to all
active roles, mounts invitation controls only for OWNER/ADMIN, and adds no
polling/SSE. A second account accepted by invitation therefore appears on the
owner's next allowed roster read.

### 7. Client and diagnostic boundaries

The client keeps URL state in component/query memory only while explicitly
revealed. It does not write raw material to local/session storage, IndexedDB,
route state, browser URL/history, analytics or persisted RTK state. All request
error handling, logs, traces, metrics, audit DTOs, screenshots and E2E reports
redact raw URL/token/envelope/key material. Test-only keys and URLs are never
printed in verification artifacts.

## Risks / Trade-offs

- [Several pending links exist] → Per-link creator-only reveal, manual
  rotation, persisted expiry and encrypted envelopes contain bearer exposure
  without breaking the approved multi-link workflow.
- [Legacy links cannot be recovered] → They remain usable for their recipient;
  the issuer sees only the manual-reissue path, never an automatic rotation.
- [Key loss/decrypt corruption blocks recovery] → 503 fail-closed behavior,
  retained versioned keyring and safe operational monitoring; no plaintext path.
- [Expiry worker competes with user action] → Team-first lock order, SKIP LOCKED,
  bounded batch, 5-second limit, retryable `503 INVITATION_BUSY` and barrier
  race tests.
- [An owner page is not push-updated] → Entry/focus/manual refresh is the
  accepted freshness boundary; realtime roster needs a separate change.

## Migration Plan

1. Add protected keyring configuration and verify feature-OFF startup remains
   independent of it, while feature-ON startup fails closed on invalid config.
2. Apply the additive envelope/key/index migration without changing the existing
   persisted invitation-state constraint. Do not backfill raw tokens; classify
   old PENDING rows as `UNRECOVERABLE_LEGACY`.
3. Deploy server endpoints, lifecycle locks and expiry worker before exposing
   matching UI. Preserve generic recipient preview/accept behavior.
4. Deploy client safe list/reveal/roster UI behind existing feature gates, then
   execute RED→GREEN evidence and independent review before broader enablement.
5. Verify the pre-implementation reconciliation remains limited to the named
   superseded secret-lifetime test assertions; retain all short-viewport layout
   evidence and unrelated acceptance criteria.

Database rollback is additive because new columns are nullable, but rollback
clients cannot reveal links issued with the new contract. Keep every key version
referenced by a live envelope until its invitation reaches a terminal state and
its envelope is cleared.
