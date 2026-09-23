# TASK-5-12--14 — remediation RED evidence

## Commands and isolation

Working directory for the unit check: frontend/

~~~sh
node --experimental-strip-types --test tests/unit/teamManagementIntent.test.ts
~~~

Working directory for the browser check: frontend/

~~~sh
E2E_TEAM_MANAGEMENT_PORT=18096 E2E_TEAM_MANAGEMENT_WEB_PORT=15196 npm run e2e:team-management-settings
~~~

The browser launcher verified both loopback ports before it started, used a
disposable PostgreSQL 16 schema, and removed that schema during cleanup. It
did not bind, stop, or restart the user's local ports 5173 or 8080. No account
identifiers, tokens, invitation links, or request keys are recorded in this
evidence.

## Assertion-level RED results

The unit command reached the intended error-mapping assertion. Its TAP result
was pass 1, fail 1, exit 1:

| Scenario | Expected | Actual |
| --- | --- | --- |
| HTTP 429 management command | retryable | terminal |

The isolated browser application and fixture started successfully. The
expanded TAP suite reached all new assertions and completed with tests 9,
pass 5, fail 4, exit 1. The failures are product-behaviour assertions, not
port, startup, migration, fixture, or network failures:

| Scenario | Missing or incorrect behaviour |
| --- | --- |
| Lost-response / 429 retry | after the mocked 429, the explicit keyboard Повторить action is absent, so the same intent cannot be replayed |
| Explicit role target | P1_ROLE_TARGET_SELECT_MISSING: the role dialog has no labelled participant selector |
| Audit pagination | the manager never sees Страница 1 из 2 after a safe page response, so the paginated list cannot be navigated or refreshed |
| Fresh authority after role update | P1_ROLE_STALE_TRANSFER_STILL_ENABLED: a revision-bound transfer action remains enabled while the fresh team-detail read is deliberately delayed |

This evidence is the approved RED input for the scoped client remediation. The
tests retain the pre-existing privacy, fixed public-label, no-persistence and
keyboard assertions.

## Authority-reconciliation extension

After the first remediation, the independent review required the same
authority hold after every successful mutation, not only after a role change.
The expanded isolated browser command completed with tests 11, pass 9, fail 2,
exit 1:

| Scenario | Missing or incorrect behaviour |
| --- | --- |
| Fresh authority after rename | P1_RENAME_STALE_NAME_STILL_ENABLED: a successful rename leaves management controls available while the required detail read is delayed |
| Fresh authority after ownership transfer | P1_TRANSFER_STALE_NAME_STILL_ENABLED: a successful transfer leaves the remaining management controls available while the required detail read is delayed |

The role flow was additionally made to prove that the next rename sends the
fresh revision returned by that delayed read. It remained GREEN before the
production change, so the two failing cases isolate the missing success-path
reconciliation for rename and transfer.
