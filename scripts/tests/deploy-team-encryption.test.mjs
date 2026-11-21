import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(root, "deploy/scripts/deploy_docker.sh");
// Public deterministic fixture; no production or local key material is used.
const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

async function startAssets() {
  const manifest = await readFile(path.join(root, "frontend/scripts/whiteboard-font-licenses/manifest.json"));
  const fontPath = Object.keys(Object.values(JSON.parse(manifest).families)[0].fontFiles)[0];
  const font = await readFile(path.join(root, "frontend/node_modules/@excalidraw/excalidraw/dist/prod/fonts", fontPath));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url.endsWith("manifest.json")) {
      response.writeHead(200, { "Content-Type": "application/json" }); response.end(manifest);
    } else if (request.url === `/whiteboard-assets/fonts/${fontPath}`) {
      response.writeHead(200, { "Content-Type": "font/woff2" }); response.end(font);
    } else {
      response.writeHead(200, { "Content-Type": "application/javascript" }); response.end("var EditorUi = function() {};\n");
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, requests, fontPath };
}

test("ordinary deployment verifies both canvas assets and ignores obsolete false values without rewriting the env", async () => {
  const { server, requests, fontPath } = await startAssets();
  try {
    const result = await runDeployment(key, { legacyValues: true, httpPort: server.address().port });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.persistedEnv, /^FEATURE_ROOM_DIAGRAMS_ENABLED=false$/m);
    assert.match(result.persistedEnv, /^FEATURE_ROOM_WHITEBOARD_ENABLED=false$/m);
    assert.ok(result.persistedEnv.includes(`TEAM_INVITATION_LINK_ENCRYPTION_KEY=${key}`));
    assert.equal(result.output.includes(key), false);
    assert.ok(result.commands.some(command => command.endsWith(" build")));
    assert.ok(result.commands.some(command => command.endsWith(" up -d")));
    assert.ok(requests.includes("/drawio/js/app.min.js"));
    assert.ok(requests.includes("/whiteboard-assets/subset/subset-worker.chunk.js"));
    assert.ok(requests.includes(`/whiteboard-assets/fonts/${fontPath}`));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

async function runDeployment(suppliedKey, { trace = false, composeConfigFails = false, activeKeyId = "primary", backendEnvironment = null, legacyValues = false, httpPort = null, archiveMismatch = false } = {}) {
  const ownedAssets = httpPort === null ? (await startAssets()).server : null;
  const assetPort = httpPort ?? ownedAssets.address().port;
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-deploy-preflight-"));
  const commandsFile = path.join(directory, "commands");
  const envFile = path.join(directory, "deploy.env");
  const composeFile = path.join(directory, "compose.yml");
  await writeFile(envFile, [
    "DOMAIN=deployment-test.invalid",
    "NGINX_SSL=false",
    `TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID=${activeKeyId}`,
    ...(legacyValues ? ["FEATURE_ROOM_DIAGRAMS_ENABLED=false", "FEATURE_ROOM_WHITEBOARD_ENABLED=false"] : []),
    `HTTP_PORT=${assetPort}`,
    ...(suppliedKey === null ? [] : [`TEAM_INVITATION_LINK_ENCRYPTION_KEY=${suppliedKey}`]),
  ].join("\n"));
  await writeFile(composeFile, "services: {}\n");
  const archive = Buffer.from("public synthetic pinned archive fixture");
  const archiveFile = path.join(directory, "offline.war");
  await writeFile(archiveFile, archiveMismatch ? "invalid archive fixture" : archive);
  await mkdir(path.join(directory, "frontend/scripts"), { recursive: true });
  await writeFile(path.join(directory, "frontend/scripts/drawio-release.json"), JSON.stringify({ version: "1.0.0", archiveUrl: "https://download-test.invalid/draw.war", archiveSha256: createHash("sha256").update(archive).digest("hex"), maxArchiveBytes: 1024 }));
  await writeFile(commandsFile, "");
  const resolvedConfigFile = path.join(directory, "resolved-compose.json");
  await writeFile(resolvedConfigFile, JSON.stringify({ services: { backend: { environment: backendEnvironment ?? {
    TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID: activeKeyId,
    APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY: suppliedKey,
  } }, web: { build: {} } } }));
  await writeFile(path.join(directory, "docker"), [
    "#!/bin/bash",
    'printf \'%s\\n\' "$*" >> "$DEPLOY_TEST_COMMANDS"',
    'if [[ "$*" == *"config --quiet"* && "$DEPLOY_TEST_CONFIG_FAILS" == true ]]; then exit 1; fi',
    'if [[ "$*" == *"config --format json"* ]]; then cat "$DEPLOY_TEST_RESOLVED_CONFIG"; fi',
    "exit 0",
    "",
  ].join("\n"), { mode: 0o700 });
  await writeFile(path.join(directory, "curl"), "#!/bin/bash\nexit 0\n", { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    ENV_FILE: envFile,
    REPO_DIR: directory,
    DRAWIO_ARCHIVE_PATH: archiveFile,
    COMPOSE_FILE: composeFile,
    DEPLOY_TEST_COMMANDS: commandsFile,
    DEPLOY_TEST_CONFIG_FAILS: String(composeConfigFails),
    DEPLOY_TEST_RESOLVED_CONFIG: resolvedConfigFile,
  };
  delete env.COMPOSE_FILES;
  delete env.TEAM_INVITATION_LINK_ENCRYPTION_KEY;
  try {
    const child = spawn("/bin/bash", [...(trace ? ["-x"] : []), script], { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const [exitCode] = await once(child, "close");
    return {
      exitCode,
      output: Buffer.concat([...stdout, ...stderr]).toString(),
      commands: (await readFile(commandsFile, "utf8")).trim().split("\n"),
      persistedEnv: await readFile(envFile, "utf8"),
    };
  } finally {
    if (ownedAssets) await new Promise(resolve => ownedAssets.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("deployment leaves the env and containers untouched after preflight refusal", async () => {
  for (const [suppliedKey, options] of [
    [null, {}],
    [key, { composeConfigFails: true }],
    [key, { archiveMismatch: true }],
  ]) {
    const result = await runDeployment(suppliedKey, { ...options, legacyValues: true });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.persistedEnv, /^FEATURE_ROOM_DIAGRAMS_ENABLED=false$/m);
    assert.match(result.persistedEnv, /^FEATURE_ROOM_WHITEBOARD_ENABLED=false$/m);
    assert.equal(result.commands.some(command => /\b(build|up)\b/.test(command)), false);
    assert.equal(result.output.includes(key), false);
  }
});

test("deployment requires a stable invitation key before building or changing containers", async () => {
  for (const suppliedKey of [null, "", "replace-with-stable-32-byte-base64url-secret"]) {
    const result = await runDeployment(suppliedKey);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /TEAM_INVITATION_LINK_ENCRYPTION_KEY/);
    assert.equal(result.commands.some((command) => /\b(build|up)\b/.test(command)), false);
  }
});

test("deployment rejects malformed or noncanonical 32-byte Base64URL invitation keys", async () => {
  for (const suppliedKey of ["A".repeat(42), "A".repeat(44), `${key}=`, `${key.slice(0, -1)}9`, `${key.slice(0, -1)}+`]) {
    const result = await runDeployment(suppliedKey);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.output, /TEAM_INVITATION_LINK_ENCRYPTION_KEY/);
    assert.equal(result.commands.some((command) => /\b(build|up)\b/.test(command)), false);
    assert.equal(result.output.includes(suppliedKey), false);
  }
});

test("deployment validates Compose before building and keeps the configured key out of trace output", async () => {
  const result = await runDeployment(key, { trace: true });
  assert.equal(result.exitCode, 0, result.output);
  const validation = result.commands.findIndex((command) => command.endsWith("config --quiet"));
  const build = result.commands.findIndex((command) => command.endsWith(" build"));
  const up = result.commands.findIndex((command) => command.endsWith(" up -d"));
  assert.ok(validation >= 0 && validation < build && build < up, result.commands.join("\n"));
  assert.equal(result.output.includes(key), false);
});

test("deployment leaves the running stack untouched when Compose validation fails", async () => {
  const result = await runDeployment(key, { composeConfigFails: true });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.commands.some((command) => /\b(build|up)\b/.test(command)), false);
  assert.equal(result.output.includes(key), false);
});

test("deployment rejects an active key absent from the effective backend keyring before building", async () => {
  const result = await runDeployment(key, { activeKeyId: "missing" });
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.commands.some(command => /\b(build|up)\b/.test(command)), false);
  assert.equal(result.output.includes(key), false);
});

test("deployment validates effective overrides including Spring JSON keyring precedence", async () => {
  const configuredKeyring = {
    "app": { "team-invitation-link-encryption": { "active-key-id": "recovery-v2", "keys": { "recovery-v2": key } } },
  };
  const supported = await runDeployment(key, { backendEnvironment: {
    TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID: "missing",
    APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY: key,
    SPRING_APPLICATION_JSON: JSON.stringify(configuredKeyring),
  } });
  assert.equal(supported.exitCode, 0, supported.output);
  assert.equal(supported.output.includes(key), false);

  for (const invalidJson of ["malformed-json", JSON.stringify({app: {"team-invitation-link-encryption": {"active-key-id": "missing"}}}), JSON.stringify({app: {"team-invitation-link-encryption": {keys: {primary: "malformed-key"}}}})]) {
    const rejected = await runDeployment(key, { backendEnvironment: {
      TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID: "primary",
      APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY: key,
      SPRING_APPLICATION_JSON: invalidJson,
    } });
    assert.notEqual(rejected.exitCode, 0);
    assert.equal(rejected.commands.some(command => /\b(build|up)\b/.test(command)), false);
    assert.equal(rejected.output.includes(key), false);
  }
});

const githubRelease = {
  TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID: "primary",
  APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY: key,
  PUBLIC_BASE_URL: "https://deployment-test.invalid",
  SOCIAL_AUTH_FLOW_SECRET: key,
  GITHUB_CLIENT_ID: "github-fixture-client",
  GITHUB_CLIENT_SECRET: "github-fixture-secret",
};


test("production preflight validates the origin and flow secret whenever credentials are configured", async () => {
  for (const [overrides, rejectedSetting] of [
    [{ SOCIAL_AUTH_FLOW_SECRET: "invalid-flow-secret" }, "SOCIAL_AUTH_FLOW_SECRET"],
    [{ PUBLIC_BASE_URL: "https://deployment-test.invalid/login" }, "PUBLIC_BASE_URL"],
    [{ PUBLIC_BASE_URL: "https://deployment_test.invalid" }, "PUBLIC_BASE_URL"],
    [{ PUBLIC_BASE_URL: "https://[::1]suffix" }, "PUBLIC_BASE_URL"],
  ]) {
    const result = await runDeployment(key, { trace: true, backendEnvironment: { ...githubRelease, ...overrides } });
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.output.includes(rejectedSetting), result.output);
    assert.equal(result.commands.some(command => /\b(build|up)\b/.test(command)), false);
    for (const secret of [key, githubRelease.GITHUB_CLIENT_SECRET, "invalid-flow-secret"]) {
      assert.equal(result.output.includes(secret), false);
    }
  }
});

test("preflight accepts GitHub credentials independently of stale Google settings and legacy toggles", async () => {
  for (const origin of ["https://deployment-test.invalid", "http://[::1]:5173"]) {
    const backendEnvironment = { ...githubRelease, PUBLIC_BASE_URL: origin,
      GOOGLE_CLIENT_ID: "google-fixture-client",
      FEATURE_SOCIAL_AUTH_ENABLED: "false", GOOGLE_AUTH_ENABLED: "false", GITHUB_AUTH_ENABLED: "false" };
    const result = await runDeployment(key, { trace: true, backendEnvironment });
    assert.equal(result.exitCode, 0, result.output);
    assert.doesNotMatch(result.output, /GOOGLE_CLIENT_SECRET|google-fixture-client/);
    assert.ok(result.commands.some(command => command.endsWith(" up -d")));
    assert.equal(result.output.includes(githubRelease.GITHUB_CLIENT_SECRET), false);
  }
});

test("preflight warns about incomplete GitHub credentials and ignores a stale Google pair", async () => {
  const backendEnvironment = {
    ...githubRelease,
    PUBLIC_BASE_URL: "invalid-origin",
    SOCIAL_AUTH_FLOW_SECRET: "invalid-flow-secret",
    GITHUB_CLIENT_SECRET: "",
    GOOGLE_CLIENT_ID: "google-fixture-client",
    GOOGLE_CLIENT_SECRET: "google-fixture-secret",
  };
  const result = await runDeployment(key, { trace: true, backendEnvironment });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /GITHUB_CLIENT_SECRET is missing/);
  assert.doesNotMatch(result.output, /GOOGLE_CLIENT_|google-fixture-(client|secret)|invalid-flow-secret/);
  assert.ok(result.commands.some(command => command.endsWith(" up -d")));
});
