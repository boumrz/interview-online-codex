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

test("explicit canvas deployment persists both flags, preserves secrets and rebuilds before verifying assets", async () => {
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
  try {
    const result = await runDeployment(key, { enableCanvases: true, httpPort: server.address().port });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.persistedEnv, /^FEATURE_ROOM_DIAGRAMS_ENABLED=true$/m);
    assert.match(result.persistedEnv, /^FEATURE_ROOM_WHITEBOARD_ENABLED=true$/m);
    assert.ok(result.persistedEnv.includes(`TEAM_INVITATION_LINK_ENCRYPTION_KEY=${key}`));
    assert.equal(result.output.includes(key), false);
    assert.ok(result.commands.some(command => command.endsWith(" build")));
    assert.ok(result.commands.some(command => command.endsWith(" up -d")));
    assert.ok(requests.includes("/drawio/js/app.min.js"));
    assert.ok(requests.includes("/whiteboard-assets/subset/subset-worker.chunk.js"));
    assert.ok(requests.includes(`/whiteboard-assets/fonts/${fontPath}`));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

async function runDeployment(suppliedKey, { trace = false, composeConfigFails = false, activeKeyId = "primary", backendEnvironment = null, enableCanvases = false, httpPort = null, archiveMismatch = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-deploy-preflight-"));
  const commandsFile = path.join(directory, "commands");
  const envFile = path.join(directory, "deploy.env");
  const composeFile = path.join(directory, "compose.yml");
  await writeFile(envFile, [
    "DOMAIN=deployment-test.invalid",
    "NGINX_SSL=false",
    `TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID=${activeKeyId}`,
    ...(enableCanvases ? ["FEATURE_ROOM_DIAGRAMS_ENABLED=false", "FEATURE_ROOM_WHITEBOARD_ENABLED=false"] : []),
    ...(httpPort ? [`HTTP_PORT=${httpPort}`] : []),
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
    ...(enableCanvases ? { FEATURE_ROOM_DIAGRAMS_ENABLED: "true", FEATURE_ROOM_WHITEBOARD_ENABLED: "true" } : {}),
  } }, ...(enableCanvases ? { web: { build: { args: { FEATURE_ROOM_DIAGRAMS_ENABLED: "true", FEATURE_ROOM_WHITEBOARD_ENABLED: "true" } } } } : {}) } }));
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
    const child = spawn("/bin/bash", [...(trace ? ["-x"] : []), script, ...(enableCanvases ? ["--enable-canvases"] : [])], { env, stdio: ["ignore", "pipe", "pipe"] });
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
    await rm(directory, { recursive: true, force: true });
  }
}

test("canvas activation leaves the env and containers untouched after any preflight refusal", async () => {
  for (const [suppliedKey, options] of [
    [null, {}],
    [key, { composeConfigFails: true }],
    [key, { archiveMismatch: true }],
    [key, { backendEnvironment: {
      TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID: "primary",
      APP_TEAMINVITATIONLINKENCRYPTION_KEYS_PRIMARY: key,
      FEATURE_ROOM_DIAGRAMS_ENABLED: "false",
      FEATURE_ROOM_WHITEBOARD_ENABLED: "false",
    } }],
  ]) {
    const result = await runDeployment(suppliedKey, { ...options, enableCanvases: true });
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
