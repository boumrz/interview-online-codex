# TASK-5-12--14 — remediation GREEN evidence

All commands below use the repository state after the approved remediation.
No token, user, invitation link, request key, or database name is recorded.

| Verification | Result |
| --- | --- |
| node --experimental-strip-types --test tests/unit/teamManagementIntent.test.ts | GREEN: 2 passed, 0 failed |
| E2E_TEAM_MANAGEMENT_PORT=18096 E2E_TEAM_MANAGEMENT_WEB_PORT=15196 npm run e2e:team-management-settings | GREEN: 11 passed, 0 failed |
| npm run typecheck | GREEN |
| FEATURE_TEAM_WORKSPACES=true npm run build | GREEN, with pre-existing asset-size warnings only |
| FEATURE_TEAM_WORKSPACES=false npm run build | GREEN, with pre-existing asset-size warnings only |
| Java 17 targeted PostgreSQL management, invitation/roster and migration suites | GREEN, exit 0 |

The browser launcher verified the free isolated ports 18096 and 15196, used a
disposable PostgreSQL 16 schema and cleaned it afterward. The user's local
ports 5173 and 8080 were not bound, stopped, or restarted.

The browser suite covers explicit retry with the same intent after a lost
response and HTTP 429, keyboard selection of an ACTIVE non-owner role target,
audit page navigation, ID deduplication and refresh, and withholding
revision-bound commands after each successful rename, role update and
ownership transfer until a fresh team read completes. The role scenario also
proves that the next rename sends the revision from that fresh read.

The targeted PostgreSQL command was run from backend/ with Java 17:

~~~sh
JAVA_HOME=<java-17-home> TEAM_TEST_PG_DATABASE=<owned-postgres16-scratch-db> \
  mvn -q -Dtest=TeamManagementAuditReadIntegrationTest,TeamManagementCommandIntegrationTest,TeamManagementCommandRestartHttpIntegrationTest,TeamOwnershipTransferIntegrationTest,TeamInvitationLinkRecoveryIntegrationTest,TeamMemberDirectoryIntegrationTest,TeamSchemaMigrationIntegrationTest test
~~~

Expected lock-timeout diagnostics from the controlled lock-contention cases
were observed; Maven exited successfully.
