# TASK-5-02 — RED evidence: team-management commands

Date: 2026-09-20

## Isolated fixture

- PostgreSQL 16.13, selected through an owned disposable `TEAM_TEST_PG_DATABASE`
  (database name intentionally omitted).
- Each test class created and removed its own random schema through
  `Postgres16TestSupport`; no development schema and no user `:5173`/`:8080`
  process was used.
- The real-restart cases used only Spring's random `server.port=0` HTTP ports.
- The existing invitation-link encryption test key was supplied solely as test
  configuration so the Spring contexts could start; no secret or token is
  printed here.

## Command

Working directory: `backend/`.

```text
TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> \
  mvn -q -Dtest=TeamManagementCommandIntegrationTest,TeamManagementCommandRestartHttpIntegrationTest test
```

## Assertion-level RED result

The command completed test discovery, Flyway V1–V15 migration, PostgreSQL 16
verification, MockMvc fixture creation, and both random-port real HTTP startup
paths. It ran 10 tests with **0 errors** and **10 expected assertion failures**:

- Rename owner/admin command and canonical/CAS/replay contract: expected
  `200`, current `405` because `PATCH /api/teams/{teamId}` is not implemented.
- Rename held-team-lock contract: expected bounded exact-safe
  `{error, code}` `503 TEAM_MANAGEMENT_BUSY` with `Retry-After: 5`, current
  `405` for that missing command.
- Role-update owner/CAS/replay contract, including the owner’s
  `ADMIN -> MEMBER` success path and an `UNCHANGED` terminal receipt with
  same-key recovered replay: expected `200`, current `404` because
  `PATCH /api/teams/{teamId}/members/{userId}` is not implemented.
- Role-update held-team-lock contract: expected bounded
  `503 TEAM_MANAGEMENT_BUSY` with `Retry-After: 5` and no mutation or receipt,
  current `404` for that missing command.
- Direct ACTIVE MEMBER role-update denial: expected exact private/no-store
  `403 TEAM_OWNER_REQUIRED` with no baseline mutation, current `404` because
  that endpoint is not implemented.
- Unauthenticated role boundary: expected endpoint-owned `401`, current `404`
  because the route does not yet exist.
- Ownership transfer followed by the public former-owner-as-ADMIN contract:
  expected transfer and subsequent rename success, then owner-only role and
  transfer denials. The transfer route currently returns `404`, so those
  downstream assertions are intentionally frozen but unreachable in this RED
  run.
- Real HTTP restart replay for rename: expected `200`, current `405`.
- Real HTTP restart replay for role update: expected `200`, current `404`.

These are intentional RED assertions for the missing public command surface,
not compilation, migration, fixture, port, network, or database failures.
The tests already pin the future authority/header matrix; UUIDs, account IDs,
tokens, room data, and any command key are not recorded in this evidence.

## Frozen behavioural coverage

`TeamManagementCommandIntegrationTest.kt` expresses:

- owner/admin rename authority, stored-role owner-only update, former-owner as
  ADMIN (including public post-transfer rename versus owner-only role/transfer
  prohibitions), unauthenticated/foreign/ACTIVE-MEMBER/inactive/owner-target
  boundaries, and
  `private, no-store` on every result;
- exact safe success/error DTO shapes and denial envelopes (including no
  command/audit/security/room identity expansion), UUID idempotency
  required/invalid/reused cases, NFKC+trim canonical names, invalid roles,
  unchanged outcomes, and permitted `currentRevision` conflicts;
- one mutation/audit/receipt behaviour, current-resource replay after a later
  permitted mutation, both rename and role `UNCHANGED` receipt/replay paths,
  and exact no-expansion snapshots for member state/epoch,
  security revision, room owner/interview metadata, participants, grants and
  candidate access;
- PostgreSQL `SELECT … FOR UPDATE` rollback under a held team lock for both
  rename and role update, with no public or durable `COMMAND_PENDING` state;
  the rename busy assertion also pins the exact `{error, code}` no-store
  envelope and protected-field non-disclosure.

`TeamManagementCommandRestartHttpIntegrationTest.kt` separately requires real
restart replay for rename and role update: recorded outcome, `recovered=true`,
and the current safe resource rather than historical JSON.
