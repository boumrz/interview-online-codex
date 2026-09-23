# Final verification

All results below are secret-redacted. The browser suite used disposable services and a disposable PostgreSQL schema; it did not bind, stop or restart the developer's local `:5173` or `:8080` processes.

## Backend integration

```text
cd backend
env JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home PATH=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin:$PATH mvn -q -Dtest=TeamInvitationLinkRecoveryIntegrationTest,TeamMemberDirectoryIntegrationTest,TeamSchemaMigrationIntegrationTest test
```

Result: PASS, 34/34 with zero failures, errors or skips. This includes Flyway V15 validation, encrypted-link lifecycle, creator-only reveal, roster access, AAD transplant denial, creator-right loss, cleanup/recheck, batch progression/bound and cleanup after the team becomes `MERGED`.

```text
cd backend
env JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home PATH=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin:$PATH mvn -q -DskipTests package
```

Result: PASS.

Focused mutation evidence: manually restoring the pre-fix candidate query made the PostgreSQL and H2 cleanup-progression assertions fail. Restoring the old ACTIVE-team cleanup guard made the inactive-team cleanup assertion fail. The correct implementation was restored before the commands above.

## Isolated browser acceptance

```text
cd frontend
E2E_TEAM_INVITATIONS_PORT=18095 E2E_TEAM_INVITATIONS_WEB_PORT=15195 npm run e2e:team-invitations
```

Result: PASS, 21/21. This includes the participant-directory invalid-query alert and retry state. The runner cleaned both isolated ports and its disposable database schema after completion.

## Client and specification checks

```text
cd frontend && npm run typecheck
cd frontend && npm run build
npx --yes @fission-ai/openspec@latest validate complete-team-invitation-continuity --strict
git diff --check
```

Result: PASS. The frontend build retains the repository's existing asset-size warnings only; no compilation failure occurred.
