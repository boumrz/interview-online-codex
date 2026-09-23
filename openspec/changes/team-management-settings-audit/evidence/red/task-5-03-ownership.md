# TASK-5-03 — RED evidence: ownership transfer

Date: 2026-09-20

## Command

Run from `backend/` against an owned disposable PostgreSQL 16 database; the
test support creates and removes its own random schema:

```text
JAVA_HOME=<temurin-17-home> TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> \
  mvn -q -Dtest=TeamOwnershipTransferIntegrationTest test
```

## Result

The fixture migrated successfully through V15, started the application with
the team-workspaces feature enabled, and executed all eleven cases.

```text
Tests run: 11, Failures: 11, Errors: 0, Skipped: 0
```

Each failure is an assertion-level RED result caused by missing P1 public
commands, not a fixture, migration, startup, port, or network failure:

- expected `200` ownership transfer, received `404`;
- expected owner-only role update used to establish the first controlled race
  ordering, received `404`;
- two same-revision transfer contenders produced zero `200` winners because
  the transfer command is absent;
- missing and malformed idempotency-key assertions expected their distinct
  `400` envelopes, received `404` because the route is absent;
- stale team-revision and canonical changed-body/same-key assertions expected
  their distinct `409` envelopes, received `404` because the route is absent;
- a real PostgreSQL `SELECT … FOR UPDATE` held-team-lock contender expected
  bounded `503 TEAM_MANAGEMENT_BUSY` with `Retry-After: 5`, received `404`
  because the route is absent;
- unauthenticated and malformed legacy-owner assertions cannot receive the
  specified secure transfer envelope while the route is absent;
- former-owner replay cannot establish its required committed transfer fixture
  while the transfer command is absent.

## Frozen behavioural coverage

`TeamOwnershipTransferIntegrationTest.kt` requires the implementation to
provide all of the following before it can turn GREEN:

- current ACTIVE owner-only authority; invalid, same-owner, unknown and
  inactive targets; private/no-store success and denial envelopes;
- exact transfer/team/member response allowlists, fixed
  `[previousOwner,newOwner]` order, one effective ACTIVE owner, stored ADMIN
  roles and the precise revision/security-revision invariants;
- exactly one `200` contender for a same-revision concurrent transfer, with a
  loser limited to the documented conflict/busy outcomes and no loser
  receipt/audit/partial write;
- deterministic role-then-transfer and transfer-then-role serialisations,
  including former-owner authority loss;
- fail-closed legacy inactive current owner and denied exact replay before any
  receipt outcome or target disclosure;
- missing/invalid idempotency-key denials, changed same-key canonical request
  conflict, and standalone stale team-revision conflict with the exact allowed
  `currentRevision`, each with no receipt/audit/domain write;
- exact allowlisted error keysets and negative protected-field/identity checks
  for every transfer `400`, `401`, `403`, `404`, `409` and `503` envelope;
- an independently held PostgreSQL team lock whose contender must return
  bounded `503`/`Retry-After: 5`, leave the complete snapshot untouched and
  create neither a terminal nor `COMMAND_PENDING` receipt;
- byte-for-byte preservation of room ownership/metadata, candidate-access and
  interview-grant rows for every successful or denied transfer path;
- a real protected invitation lifecycle row in every fixture, preserving its
  state, revision, acceptance, token-hash and encrypted-link protection fields
  byte-for-byte across successful transfer, both races and every denial.

No account identifiers, tokens, invitation links, room codes, candidate data,
or database/schema names are recorded here. No user `:5173`/`:8080` process
was bound, stopped or restarted.
