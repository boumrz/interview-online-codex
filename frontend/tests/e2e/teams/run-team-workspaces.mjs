// Compatibility entrypoint: every fixture suite shares the isolated runtime.
if (!process.argv.slice(2).length) {
  process.argv.push(process.env.E2E_TEAM_WORKSPACES_SUITE || "tests/e2e/teams/e2e-team-workspaces.mjs");
}
await import("../run-isolated.mjs");
