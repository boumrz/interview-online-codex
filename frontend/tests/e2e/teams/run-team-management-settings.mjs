if (process.env.E2E_TEAM_MANAGEMENT_SETTINGS_PORT !== undefined) process.env.E2E_BACKEND_PORT ??= process.env.E2E_TEAM_MANAGEMENT_SETTINGS_PORT;
if (process.env.E2E_TEAM_MANAGEMENT_SETTINGS_WEB_PORT !== undefined) process.env.E2E_WEB_PORT ??= process.env.E2E_TEAM_MANAGEMENT_SETTINGS_WEB_PORT;
process.argv.splice(2, process.argv.length, "tests/e2e/teams/e2e-team-management-settings.mjs");
await import("../run-isolated.mjs");
