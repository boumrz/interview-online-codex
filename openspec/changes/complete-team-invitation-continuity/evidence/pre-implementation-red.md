# Pre-implementation RED evidence

This evidence was collected before any production implementation for this
change. It intentionally contains no invitation URL, bearer token, envelope or
key material.

Collected: 2026-09-20 (Europe/Moscow).

## Browser acceptance suite

```text
cd frontend && E2E_TEAM_INVITATIONS_PORT=18094 E2E_TEAM_INVITATIONS_WEB_PORT=15194 npm run e2e:team-invitations
```

- The selected ports were verified free before the run; the launcher started
  and cleaned up only its isolated backend and frontend processes.
- Observed exit result: `1` (behavioural RED).
- Named failing behaviour: the current generic create response exposes a raw
  `url`, reported by the redacted assertions
  `AC03_LOST_CREATE_RESPONSE_LEAKED_RAW_URL` and
  `INVITATION_CREATE_RESPONSE_LEAKED_RAW_URL`.
- The user's running `:5173` and `:8080` processes were neither stopped nor
  bound by this run.

## Backend integration suite

```text
cd backend && env JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home mvn -q -Dtest=TeamInvitationLinkRecoveryIntegrationTest,TeamMemberDirectoryIntegrationTest,TeamSchemaMigrationIntegrationTest test
```

- Observed exit result: `1`, with 25 behavioural failures, 0 errors and 0
  skipped tests at the time of collection.
- Named missing behaviour: generic invitation DTOs contain a raw URL; the
  issuer reveal endpoint and manager invitation list are absent; the D6 member
  directory, test-profile cleanup seam and V15 recovery migration are absent;
  and a feature-on context accepts missing or invalid recovery-key
  configuration.
- MockMvc diagnostics and assertion messages are configured not to emit a
  bearer URL or token.

The tests remain intentionally RED until the production tasks in this change
are implemented. Any later test expansion must refresh this evidence with the
same secret-redaction rule.
