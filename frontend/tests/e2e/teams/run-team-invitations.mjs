import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const root = new URL("../../../../", import.meta.url);
const backendDir = new URL("backend/", root);
const frontendDir = new URL("frontend/", root);
const port = process.env.E2E_TEAM_INVITATIONS_PORT || "18080";
const apiUrl = "http://127.0.0.1:" + port + "/api";
const webPort = process.env.E2E_TEAM_INVITATIONS_WEB_PORT || "15173";
const webUrl = "http://127.0.0.1:" + webPort;
const javaHome = process.env.JAVA_HOME || "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home";
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
const psql = process.env.PSQL_BIN || "psql";
const pgHost = process.env.TEAM_TEST_PG_HOST || "127.0.0.1";
const pgPort = process.env.TEAM_TEST_PG_PORT || "5432";
const pgUser = process.env.TEAM_TEST_PG_USER || "interview";
const pgPassword = process.env.TEAM_TEST_PG_PASSWORD || "interview";
let backendExitCode;
let frontendExitCode;

function runPsql(database, sql) {
  return execFileSync(
    psql,
    ["-h", pgHost, "-p", pgPort, "-U", pgUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", sql],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: pgPassword },
      stdio: ["ignore", "pipe", "inherit"],
    },
  ).trim();
}

const scratchDatabase = process.env.TEAM_TEST_PG_DATABASE || runPsql(
  "postgres",
  "SELECT datname FROM pg_database " +
    "WHERE datallowconn AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) " +
    "AND datname <> 'interview_online' AND datname LIKE 'interview_%' " +
    "ORDER BY datname LIMIT 1",
);
if (!scratchDatabase || scratchDatabase === "interview_online" || !/^[A-Za-z0-9_]+$/.test(scratchDatabase)) {
  throw new Error("AC03_SAFE_POSTGRES_SCRATCH_DATABASE_REQUIRED");
}
const postgresVersion = Number(runPsql(scratchDatabase, "SHOW server_version_num"));
if (postgresVersion < 160000 || postgresVersion >= 170000) {
  throw new Error("AC03_POSTGRES_16_REQUIRED_" + postgresVersion);
}
const schema = "team_invitations_e2e_" + randomUUID().replaceAll("-", "");
runPsql(scratchDatabase, "CREATE SCHEMA " + schema);
const jdbcUrl = "jdbc:postgresql://" + pgHost + ":" + pgPort + "/" + scratchDatabase + "?currentSchema=" + schema;

// spring-boot:test-run uses src/test classes/resources: the expired-link
// fixture is profile-gated there and cannot appear in a production artifact.
const child = spawn(
  "mvn",
  [
    "-q",
    "-Dspring-boot.run.profiles=test",
    "-Dspring-boot.run.arguments=" +
      "--server.port=" + port +
      " --app.features.team-workspaces-enabled=true" +
      " --app.http.trusted-proxy-cidrs=127.0.0.1/32,::1/128",
    "spring-boot:test-run",
  ],
  {
    cwd: backendDir,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      SPRING_PROFILES_ACTIVE: "test",
      FEATURE_TEAM_WORKSPACES: "true",
      // Production treats forwarded identity as untrusted by default. Only
      // this loopback-isolated test server trusts its direct browser proxy.
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
  },
);
child.once("exit", (code) => { backendExitCode = code ?? 1; });

// The management suite intentionally intercepts a lost create response and
// calls route.fetch(). That nested fetch bypasses the context-level API URL
// rewrite, so the launcher owns an isolated web server whose proxy targets the
// isolated backend instead of any user server that may be running on :8080.
const frontend = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", webPort],
  {
    cwd: frontendDir,
    env: {
      ...process.env,
      FEATURE_TEAM_WORKSPACES: "true",
      DEV_API_PROXY_TARGET: "http://127.0.0.1:" + port,
      VITE_API_BASE_URL: "/api",
    },
    stdio: "inherit",
    detached: process.platform !== "win32",
  },
);
frontend.once("exit", (code) => { frontendExitCode = code ?? 1; });

async function waitForBackend() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (backendExitCode !== undefined) throw new Error("AC03_TEST_BACKEND_EXITED_" + backendExitCode);
    try {
      const response = await fetch(apiUrl + "/me/workspaces");
      // 401 proves the servlet is accepting HTTP without requiring a health route.
      if (response.status === 401 || response.status === 200) return;
    } catch {}
    await delay(300);
  }
  throw new Error("AC03_TEST_BACKEND_DID_NOT_START");
}

async function waitForFrontend() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (frontendExitCode !== undefined) throw new Error("AC03_TEST_FRONTEND_EXITED_" + frontendExitCode);
    try {
      const response = await fetch(webUrl);
      if (response.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error("AC03_TEST_FRONTEND_DID_NOT_START");
}

try {
  await Promise.all([waitForBackend(), waitForFrontend()]);
  const suites = [
    ["tests/e2e/teams/e2e-team-membership.mjs"],
    // Current management UI shows one link automatically; the older multi-link suite is historical.
    ["--test-name-pattern=P0.1:", "tests/e2e/teams/e2e-team-workspaces.mjs"],
  ];
  let failed = false;
  for (const args of suites) {
    const suite = spawn(process.execPath, ["--test", ...args], {
      cwd: new URL("../../../", import.meta.url),
      env: { ...process.env, E2E_API_URL: apiUrl, E2E_BASE_URL: webUrl },
      stdio: "inherit",
    });
    const exitCode = await new Promise((resolve) => suite.once("exit", (code) => resolve(code ?? 1)));
    failed ||= exitCode !== 0;
  }
  process.exitCode = failed ? 1 : 0;
} finally {
  try {
    const stopProcess = (processHandle, signal) => {
      if (processHandle.killed) return;
      try {
        if (process.platform !== "win32") process.kill(-processHandle.pid, signal);
        else processHandle.kill(signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    };
    stopProcess(frontend, "SIGTERM");
    stopProcess(child, "SIGTERM");
    await Promise.race([
      Promise.all([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => frontend.once("exit", resolve)),
      ]),
      delay(5_000).then(() => {
        stopProcess(frontend, "SIGKILL");
        stopProcess(child, "SIGKILL");
      }),
    ]);
  } finally {
    runPsql(scratchDatabase, "DROP SCHEMA " + schema + " CASCADE");
  }
}
