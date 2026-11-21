// Owns a loopback-only GitHub HTTP fixture and delegates all app/database setup
// to the standard isolated runner. No real provider credentials are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createOwnedRuntime } from "../support/owned-runtime.mjs";

const profileSuite = "tests/e2e/account/e2e-profile-social-links-integration.mjs";
const suites = process.argv.length > 2 ? process.argv.slice(2) : [profileSuite];
assert.ok(suites.includes(profileSuite), "the profile OAuth fixture requires its integration suite");
const owned = createOwnedRuntime();
const requests = { token: 0, user: 0 };
const identityByCode = new Map([["profile-test-code", 917001], ["room-test-code", 917002], ["unlink-password-test-code", 917003]]);
const provider = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/token" && request.method === "POST") {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const form = new URLSearchParams(Buffer.concat(body).toString());
    const identity = identityByCode.get(form.get("code"));
    if (!identity || !form.get("code_verifier")) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_grant" }));
      return;
    }
    requests.token++;
    response.end(JSON.stringify({ access_token: `fixture-access-${identity}`, token_type: "bearer", scope: "" }));
    return;
  }
  const identity = [...identityByCode.values()].find((id) => request.headers.authorization === `Bearer fixture-access-${id}`);
  if (request.url === "/user" && identity) {
    requests.user++;
    response.end(JSON.stringify({ id: identity, login: "fixture", name: "Тестовый GitHub" }));
    return;
  }
  response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
});
const portReservation = createServer();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { process.exitCode = 1; owned.interrupt(); });
try {
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  portReservation.listen(0, "127.0.0.1");
  await once(portReservation, "listening");
  const webPort = portReservation.address().port;
  await new Promise((resolve) => portReservation.close(resolve));
  const fixtureOrigin = `http://127.0.0.1:${provider.address().port}`;
  const run = owned.start(process.execPath, ["tests/e2e/run-isolated.mjs", ...suites], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, E2E_PRODUCTION: "true", E2E_WEB_PORT: String(webPort),
      E2E_GITHUB_FIXTURE_ORIGIN: fixtureOrigin,
      E2E_PROFILE_LINK_REAL_PROVIDER: "true",
    },
  });
  const [code] = await once(run.child, "exit");
  process.exitCode = code ?? 1;
  process.stdout.write(`Profile OAuth fixture calls: token=${requests.token}, user=${requests.user}\n`);
  if (code === 0) {
    assert.equal(requests.token, identityByCode.size, "the real backend must exchange one provider code in each scenario");
    assert.equal(requests.user, identityByCode.size, "the real backend must fetch the authenticated identity in each scenario");
  }
} finally {
  await owned.stop();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
  if (portReservation.listening) await new Promise((resolve) => portReservation.close(resolve));
}
