# TASK-5-01 — RED evidence: management audit read

## Command

Executed from `backend/` against an owned disposable PostgreSQL 16 scratch
database. The command used Temurin 17 because the repository Kotlin compiler
does not support the host's Java 25 runtime.

```text
JAVA_HOME=<temurin-17-home> PATH=<temurin-17-bin> TEAM_TEST_PG_DATABASE=<owned-postgres-scratch-db> \
  mvn -q -Dtest=TeamManagementAuditReadIntegrationTest,TeamSchemaMigrationIntegrationTest test
```

## Environment result

- PostgreSQL fixture started successfully and reported PostgreSQL 16.13.
- Flyway applied V1 through V15, including V11, successfully.
- The named run completed test execution: **15 tests, 5 failures, 0 errors, 0 skipped**.
- `TeamSchemaMigrationIntegrationTest` completed without a failure; the V11
  columns and ordered audit index remain available.
- No user-local application ports were bound or stopped.

## Assertion-level RED failures

All failures below are expected missing/incorrect behaviour in the current
application, rather than fixture, migration, compilation, network, or startup
errors. Test identities and database names are redacted.

1. `P1 audit rejects malformed out of range and overflowing query before a projection`
   expected invalid `page` values to return `400 INVALID_AUDIT_QUERY`; the
   first invalid request was accepted with `200`. The test also freezes the
   `10001`, overflow, non-numeric, invalid-size, and unknown-parameter cases,
   each with the exact safe error projection.
2. `P1 audit replaces a bidi display name with the neutral identity label`
   expected the bidi-control `displayName` to project as neutral `Участник`;
   the response exposed the unusable display name instead.
3. `P1 audit replaces a zero width display name with the neutral identity label`
   expected the zero-width FORMAT `displayName` to project as neutral
   `Участник`; the response exposed the unusable display name instead.
4. `P1 historical invitation action never exposes opaque url token envelope or unknown id`
   expected `entityId=null` for a historical invitation action with a raw
   opaque value; the response exposed that value as `entityId`.
5. `P1 production audit writer accepts typed actions and rejects an arbitrary new storage action`
   expected the production `TeamAuditAction` type at the audit writer boundary;
   no such type exists yet, so an arbitrary raw action is not prevented.

These failures freeze the remaining RED input for the later implementation:
Unicode-safe identity normalization, same-team invitation-ID resolution,
strict pre-projection query validation, and a typed audit-writer vocabulary.

## Additional frozen assertions

The same RED suite also now asserts that:

- a known action remains its known public code when its actor or target is
  currently `LEFT` or foreign, while both public identities become `null`;
- successful audit GET and the safe-projection GET leave the audit-row count
  unchanged;
- every documented audit `400`, `401`, `403` and `404` has exactly
  `{error,code}`, `Cache-Control: private, no-store`, and no page, item,
  identity, protected fixture, or private-domain fields.
- `page=10000,size=100` is accepted as the deepest permitted window, while an
  invalid query must fail before returning any page/list projection;
- Unicode CONTROL/FORMAT display names include independently seeded bidi and
  zero-width values, both required to emit the neutral label;
- known historical invitation actions retain their public action but expose
  `entityId=null` for raw URL, token, envelope, or non-existent opaque values;
  the raw values are forbidden from the response;
- the reflection boundary requires the production invitation writer to accept
  `TeamAuditAction`, with an arbitrary new raw code rejected.
