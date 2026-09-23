# TASK-5-15 — current release status

Completed evidence is recorded in green/task-5-12-14-remediation.md. Strict
OpenSpec validation and git diff check are GREEN.

The required P0 invitation and roster regression was also run on isolated
ports 18095 and 15195:

~~~sh
E2E_TEAM_INVITATIONS_PORT=18095 E2E_TEAM_INVITATIONS_WEB_PORT=15195 npm run e2e:team-invitations
~~~

It started and cleaned its disposable PostgreSQL 16 schema correctly. The
invitation acceptance suite passed 8 of 8 and the invitation management/roster
suite passed 11 of 13. Two existing short-viewport keyboard scenarios remain
RED:

- BUG-AC03-QA-001 at the desktop zoom-equivalent viewport;
- BUG-AC03-QA-002 at the tablet zoom-equivalent viewport.

This task deliberately remains unchecked until the dedicated
fix-invitation-management-short-viewport change resolves those two product
failures and the full P0 regression reruns GREEN. The user's local ports 5173
and 8080 were not touched.
