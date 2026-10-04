if (process.env.E2E_TEAM_INVITATIONS_PORT !== undefined) process.env.E2E_BACKEND_PORT ??= process.env.E2E_TEAM_INVITATIONS_PORT;
if (process.env.E2E_TEAM_INVITATIONS_WEB_PORT !== undefined) process.env.E2E_WEB_PORT ??= process.env.E2E_TEAM_INVITATIONS_WEB_PORT;
process.argv.splice(2, process.argv.length,
  "tests/e2e/teams/e2e-team-membership.mjs", "tests/e2e/teams/e2e-team-workspaces.mjs");
// Keep the established P0.1 subset for the workspace suite.
process.env.E2E_SUITE_PATTERNS = JSON.stringify({ "tests/e2e/teams/e2e-team-workspaces.mjs": "P0.1:" });
await import("../run-isolated.mjs");
