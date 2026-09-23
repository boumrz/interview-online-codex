import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const root = new URL("../../../../", import.meta.url);
const backendDir = new URL("backend/", root);
const frontendDir = new URL("frontend/", root);
const javaHome = process.env.JAVA_HOME || "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home";
const backendPort = requiredPort("E2E_TEAM_WORKSPACES_PORT");
const frontendPort = requiredPort("E2E_TEAM_WORKSPACES_WEB_PORT");
const secondBackendPort = process.env.E2E_SECOND_BACKEND_PORT ? requiredPort("E2E_SECOND_BACKEND_PORT") : null;
if (backendPort === frontendPort) throw new Error("P1_E2E_TEAM_WORKSPACES_PORTS_MUST_DIFFER");
if (secondBackendPort !== null && [backendPort, frontendPort].includes(secondBackendPort)) {
  throw new Error("P6_E2E_SECOND_BACKEND_PORT_MUST_DIFFER");
}
const apiUrl = `http://127.0.0.1:${backendPort}/api`;
const webUrl = `http://127.0.0.1:${frontendPort}`;
const psql = process.env.PSQL_BIN || "psql";
const pgHost = process.env.TEAM_TEST_PG_HOST || "127.0.0.1";
const pgPort = process.env.TEAM_TEST_PG_PORT || "5432";
const pgUser = process.env.TEAM_TEST_PG_USER || "interview";
const pgPassword = process.env.TEAM_TEST_PG_PASSWORD || "interview";
const chatReceiptHmacSecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const invitationLinkRecoveryKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const testInvitationEncryptionConfig = JSON.stringify({
  app: {
    "team-invitation-link-encryption": {
      "active-key-id": "e2e-v1",
      keys: { "e2e-v1": invitationLinkRecoveryKey },
    },
  },
});
let backendExitCode;
let frontendExitCode;
let secondBackendExitCode;
let secondBackend;

function requiredPort(name) {
  const value = process.env[name];
  if (!value || !/^[1-9][0-9]{0,4}$/.test(value)) throw new Error(`P1_${name}_REQUIRED`);
  const numeric = Number(value);
  if (numeric < 1024 || numeric > 65535 || numeric === 5173 || numeric === 8080) {
    throw new Error(`P1_${name}_UNSAFE_PORT`);
  }
  return numeric;
}

async function assertFree(port, name) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error(`P1_${name}_PORT_OCCUPIED_${port}`)));
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function runPsql(database, sql) {
  return execFileSync(psql, ["-h", pgHost, "-p", pgPort, "-U", pgUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", sql], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: pgPassword },
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function stopProcess(processHandle, signal) {
  if (!processHandle || processHandle.killed) return;
  try {
    if (process.platform !== "win32") process.kill(-processHandle.pid, signal);
    else processHandle.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitFor(url, processName, exitCode) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exitCode() !== undefined) throw new Error(`P1_${processName}_EXITED_${exitCode()}`);
    try {
      const response = await fetch(url);
      if (response.status === 401 || response.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`P1_${processName}_DID_NOT_START`);
}

await assertFree(backendPort, "BACKEND");
await assertFree(frontendPort, "FRONTEND");
if (secondBackendPort !== null) await assertFree(secondBackendPort, "SECOND_BACKEND");

const scratchDatabase = process.env.TEAM_TEST_PG_DATABASE || runPsql(
  "postgres",
  "SELECT datname FROM pg_database WHERE datallowconn AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND datname <> 'interview_online' AND datname LIKE 'interview_%' ORDER BY datname LIMIT 1",
);
if (!scratchDatabase || scratchDatabase === "interview_online" || !/^[A-Za-z0-9_]+$/.test(scratchDatabase)) {
  throw new Error("P1_SAFE_POSTGRES_SCRATCH_DATABASE_REQUIRED");
}
const postgresVersion = Number(runPsql(scratchDatabase, "SHOW server_version_num"));
if (postgresVersion < 160000 || postgresVersion >= 170000) throw new Error(`P1_POSTGRES_16_REQUIRED_${postgresVersion}`);
const schema = `team_workspaces_e2e_${randomUUID().replaceAll("-", "")}`;
runPsql(scratchDatabase, `CREATE SCHEMA ${schema}`);
const jdbcUrl = `jdbc:postgresql://${pgHost}:${pgPort}/${scratchDatabase}?currentSchema=${schema}`;

const backend = spawn("mvn", [
  "-q",
  "-Dspring-boot.run.profiles=test",
  `-Dspring-boot.run.arguments=--server.port=${backendPort} --app.features.team-workspaces-enabled=true --app.features.team-merge-commit-enabled=${process.env.FEATURE_TEAM_MERGE_COMMIT === "true"} --app.http.trusted-proxy-cidrs=127.0.0.1/32,::1/128`,
  "spring-boot:test-run",
], {
  cwd: backendDir,
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    SPRING_PROFILES_ACTIVE: "test",
    FEATURE_TEAM_WORKSPACES: "true",
    TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
    CHAT_RECEIPT_HMAC_SECRET: chatReceiptHmacSecret,
    SPRING_APPLICATION_JSON: testInvitationEncryptionConfig,
    APP_CORS_ALLOWED_ORIGINS: webUrl,
    SPRING_DATASOURCE_URL: jdbcUrl,
    SPRING_DATASOURCE_USERNAME: pgUser,
    SPRING_DATASOURCE_PASSWORD: pgPassword,
    SPRING_DATASOURCE_DRIVER_CLASS_NAME: "org.postgresql.Driver",
    SPRING_DATASOURCE_HIKARI_SCHEMA: schema,
    SPRING_FLYWAY_ENABLED: "true",
    SPRING_FLYWAY_SCHEMAS: schema,
    SPRING_FLYWAY_DEFAULT_SCHEMA: schema,
    SPRING_JPA_HIBERNATE_DDL_AUTO: "validate",
    SPRING_JPA_PROPERTIES_HIBERNATE_DEFAULT_SCHEMA: schema,
  },
  stdio: "inherit",
  detached: process.platform !== "win32",
});
backend.once("exit", (code) => { backendExitCode = code ?? 1; });

const frontend = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendPort)], {
  cwd: frontendDir,
  env: {
    ...process.env,
    FEATURE_TEAM_WORKSPACES: "true",
    DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
    VITE_API_BASE_URL: "/api",
  },
  stdio: "inherit",
  detached: process.platform !== "win32",
});
frontend.once("exit", (code) => { frontendExitCode = code ?? 1; });

try {
  await Promise.all([
    waitFor(`${apiUrl}/me/workspaces`, "BACKEND", () => backendExitCode),
    waitFor(webUrl, "FRONTEND", () => frontendExitCode),
  ]);
  if (secondBackendPort !== null) {
    secondBackend = spawn("mvn", [
      "-q",
      "-Dspring-boot.run.profiles=test",
      `-Dspring-boot.run.arguments=--server.port=${secondBackendPort} --app.features.team-workspaces-enabled=true --app.features.team-merge-commit-enabled=true --app.http.trusted-proxy-cidrs=127.0.0.1/32,::1/128`,
      "spring-boot:test-run",
    ], {
      cwd: backendDir,
      env: {
        ...process.env,
        JAVA_HOME: javaHome,
        SPRING_PROFILES_ACTIVE: "test",
        FEATURE_TEAM_WORKSPACES: "true",
        FEATURE_TEAM_MERGE_COMMIT: "true",
        TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
        CHAT_RECEIPT_HMAC_SECRET: chatReceiptHmacSecret,
        SPRING_APPLICATION_JSON: testInvitationEncryptionConfig,
        APP_CORS_ALLOWED_ORIGINS: webUrl,
        SPRING_DATASOURCE_URL: jdbcUrl,
        SPRING_DATASOURCE_USERNAME: pgUser,
        SPRING_DATASOURCE_PASSWORD: pgPassword,
        SPRING_DATASOURCE_DRIVER_CLASS_NAME: "org.postgresql.Driver",
        SPRING_DATASOURCE_HIKARI_SCHEMA: schema,
        SPRING_FLYWAY_ENABLED: "true",
        SPRING_FLYWAY_SCHEMAS: schema,
        SPRING_FLYWAY_DEFAULT_SCHEMA: schema,
        SPRING_JPA_HIBERNATE_DDL_AUTO: "validate",
        SPRING_JPA_PROPERTIES_HIBERNATE_DEFAULT_SCHEMA: schema,
      },
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    secondBackend.once("exit", (code) => { secondBackendExitCode = code ?? 1; });
    await waitFor(`http://127.0.0.1:${secondBackendPort}/api/me/workspaces`, "SECOND_BACKEND", () => secondBackendExitCode);
  }
  const suiteArgs = ["--test"];
  if (process.env.E2E_TEST_NAME_PATTERN) {
    suiteArgs.push("--test-name-pattern", process.env.E2E_TEST_NAME_PATTERN);
  }
  const suiteFile = process.env.E2E_TEAM_WORKSPACES_SUITE || "tests/e2e/teams/e2e-team-workspaces.mjs";
  if (!/^tests\/e2e\/[a-z0-9/-]+\.mjs$/.test(suiteFile)) {
    throw new Error("E2E_TEAM_WORKSPACES_SUITE_INVALID");
  }
  suiteArgs.push(suiteFile);
  const suite = spawn(process.execPath, suiteArgs, {
    cwd: frontendDir,
    env: {
      ...process.env,
      E2E_API_URL: apiUrl,
      E2E_BASE_URL: webUrl,
      ...(secondBackendPort === null ? {} : { E2E_SECOND_API_URL: `http://127.0.0.1:${secondBackendPort}/api` }),
    },
    stdio: "inherit",
  });
  process.exitCode = await new Promise((resolve) => suite.once("exit", (code) => resolve(code ?? 1)));
} finally {
  try {
    stopProcess(frontend, "SIGTERM");
    stopProcess(backend, "SIGTERM");
    stopProcess(secondBackend, "SIGTERM");
    await Promise.race([
      Promise.all([
        new Promise((resolve) => backend.once("exit", resolve)),
        new Promise((resolve) => frontend.once("exit", resolve)),
        ...(secondBackend ? [new Promise((resolve) => secondBackend.once("exit", resolve))] : []),
      ]),
      delay(5_000).then(() => {
        stopProcess(frontend, "SIGKILL");
        stopProcess(backend, "SIGKILL");
        stopProcess(secondBackend, "SIGKILL");
      }),
    ]);
  } finally {
    runPsql(scratchDatabase, `DROP SCHEMA ${schema} CASCADE`);
  }
}
