import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createOwnedRuntime } from "./support/owned-runtime.mjs";

const root = new URL("../../../", import.meta.url);
const backendDir = new URL("backend/", root);
const frontendDir = new URL("frontend/", root);
const javaHome = process.env.JAVA_HOME || "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home";
const nodeEnv = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}` };
const frontendEnv = { ...nodeEnv, VITE_API_BASE_URL: "/api" };
const psql = process.env.PSQL_BIN || "psql";
const pgHost = process.env.TEAM_TEST_PG_HOST || "127.0.0.1";
const pgPort = process.env.TEAM_TEST_PG_PORT || "5432";
const pgUser = process.env.TEAM_TEST_PG_USER || "interview";
const pgPassword = process.env.TEAM_TEST_PG_PASSWORD || "interview";
if (!["localhost", "127.0.0.1", "::1"].includes(pgHost)
    || !/^[1-9][0-9]{0,4}$/.test(pgPort) || Number(pgPort) > 65535) {
  throw new Error("E2E_POSTGRES_LOOPBACK_TARGET_REQUIRED");
}
const runId = randomUUID().replaceAll("-", "");
const schema = `interhub_e2e_${randomUUID().replaceAll("-", "")}`;
const publicFixtureKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const owned = createOwnedRuntime();
const { start } = owned;
let cancelled = false;
let productionDir;
let runtimeDir;
let scratchDatabase;
let schemaCreated = false;

function runPsql(database, sql) {
  return execFileSync(psql, ["-h", pgHost, "-p", pgPort, "-U", pgUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", sql], {
    encoding: "utf8", env: { ...process.env, PGPASSWORD: pgPassword }, stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

async function freePort(value, name) {
  if (value !== undefined) {
    if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) < 1024 || Number(value) > 65535
        || ["5173", "8080"].includes(value)) throw new Error(`E2E_${name}_UNSAFE_PORT`);
  }
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error(`E2E_${name}_PORT_OCCUPIED`)));
    server.listen(value === undefined ? 0 : Number(value), "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url, state, name) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (cancelled) throw new Error("E2E_RUN_CANCELLED");
    if (state.finished) throw new Error(`E2E_${name}_EXITED_BEFORE_READY`, { cause: state.error });
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "error" });
      if (response.ok || response.status === 401) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`E2E_${name}_DID_NOT_START`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cancelled = true;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    owned.interrupt();
  });
}

// The runner owns both targets. An old against-running override cannot silently
// redirect fixtures into a developer or deployed database.
for (const name of ["E2E_API_URL", "E2E_BASE_URL", "E2E_SECOND_API_URL"]) {
  if (process.env[name] !== undefined) throw new Error(`E2E_RUNNER_OWNS_${name}: remove this override`);
}
const suites = process.argv.slice(2);
if (!suites.length && process.env.E2E_TEAM_WORKSPACES_SUITE) suites.push(process.env.E2E_TEAM_WORKSPACES_SUITE);
if (!suites.length) throw new Error("E2E_SUITE_REQUIRED");
for (const suite of suites) {
  if (!/^tests\/e2e\/[a-z0-9/-]+\.mjs$/.test(suite)) throw new Error("E2E_SUITE_INVALID");
}
const suitePatterns = process.env.E2E_SUITE_PATTERNS ? JSON.parse(process.env.E2E_SUITE_PATTERNS) : {};
if (!suitePatterns || Array.isArray(suitePatterns) || typeof suitePatterns !== "object"
    || Object.entries(suitePatterns).some(([file, pattern]) => !suites.includes(file) || typeof pattern !== "string")) {
  throw new Error("E2E_SUITE_PATTERNS_INVALID");
}
const backendPort = await freePort(process.env.E2E_BACKEND_PORT ?? process.env.E2E_TEAM_WORKSPACES_PORT, "BACKEND");
const frontendPort = await freePort(process.env.E2E_WEB_PORT ?? process.env.E2E_TEAM_WORKSPACES_WEB_PORT, "WEB");
const secondBackendPort = process.env.E2E_SECOND_BACKEND_PORT === undefined
  ? null : await freePort(process.env.E2E_SECOND_BACKEND_PORT, "SECOND_BACKEND");
if (new Set([backendPort, frontendPort, ...(secondBackendPort === null ? [] : [secondBackendPort])]).size
    !== (secondBackendPort === null ? 2 : 3)) throw new Error("E2E_PORTS_MUST_DIFFER");
const apiUrl = `http://127.0.0.1:${backendPort}/api`;
const webUrl = `http://127.0.0.1:${frontendPort}`;

try {
  scratchDatabase = process.env.TEAM_TEST_PG_DATABASE || runPsql("postgres",
    "SELECT datname FROM pg_database WHERE datallowconn AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND datname <> 'interview_online' AND datname LIKE 'interview_%' ORDER BY datname LIMIT 1");
  if (!scratchDatabase || scratchDatabase === "interview_online" || !/^[A-Za-z0-9_]+$/.test(scratchDatabase)) {
    throw new Error("E2E_SAFE_POSTGRES_SCRATCH_DATABASE_REQUIRED");
  }
  const postgresVersion = Number(runPsql(scratchDatabase, "SHOW server_version_num"));
  if (postgresVersion < 160000 || postgresVersion >= 170000) throw new Error("E2E_POSTGRES_16_REQUIRED");

  // Build outside the checkout: the user's application and parallel test runs
  // never share mutable class files. Add only explicitly selected HTTP fixtures,
  // rather than exposing every test configuration on the runtime classpath.
  runtimeDir = mkdtempSync(join(tmpdir(), "interhub-e2e-runtime-"));
  const isolatedBackend = join(runtimeDir, "backend");
  cpSync(fileURLToPath(backendDir), isolatedBackend, {
    recursive: true,
    filter: (source) => !relative(fileURLToPath(backendDir), source).split(/[\\/]/)
      .some((part) => ["target", ".run", ".git"].includes(part)),
  });
  execFileSync("mvn", ["-q", "-DskipTests", "test-compile", "dependency:build-classpath", "-Dmdep.outputFile=target/e2e-runtime-classpath.txt"], {
    cwd: isolatedBackend, env: { ...nodeEnv, JAVA_HOME: javaHome }, stdio: "inherit",
  });
  const fixtureDir = join(runtimeDir, "fixtures", "com", "interviewonline", "controller");
  const fixtureNames = ["E2eIsolationFixtureController", "E2eIsolationProof", "TeamInvitationE2eFixtureController",
    "TeamInvitationE2eFixtureClockConfig", "ExpiredInvitationFixtureRequest", "ManagementInvitationFixtureRequest",
    "ManagementInvitationFixtureResponse", "FixtureActor"];
  const testControllerDir = join(isolatedBackend, "target", "test-classes", "com", "interviewonline", "controller");
  for (const entry of readdirSync(testControllerDir)) {
    if (fixtureNames.some((name) => entry === `${name}.class` || entry.startsWith(`${name}$`))) {
      cpSync(join(testControllerDir, entry), join(fixtureDir, entry));
    }
  }
  const classpath = [join(isolatedBackend, "target", "classes"), join(runtimeDir, "fixtures"),
    readFileSync(join(isolatedBackend, "target", "e2e-runtime-classpath.txt"), "utf8").trim()].join(delimiter);

  execFileSync(process.execPath, ["--experimental-strip-types", "scripts/generate-theme-css.mjs"], { cwd: frontendDir, env: frontendEnv, stdio: "inherit" });
  if (process.env.E2E_PRODUCTION === "true" || process.env.E2E_TEAM_WORKSPACES_PRODUCTION === "true") {
    productionDir = mkdtempSync(join(fileURLToPath(frontendDir), ".team-availability-"));
    execFileSync(process.execPath, [fileURLToPath(new URL("node_modules/@rspack/cli/bin/rspack.js", frontendDir)),
      "build", "--config", "rspack.config.mjs", "--output-path", productionDir], { cwd: frontendDir, env: frontendEnv, stdio: "inherit" });
    const publicDir = fileURLToPath(new URL("public/", frontendDir));
    for (const entry of readdirSync(publicDir)) {
      if (entry !== "index.html") cpSync(join(publicDir, entry), join(productionDir, entry), { recursive: true });
    }
  }
  runPsql(scratchDatabase, `CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  const jdbcUrl = `jdbc:postgresql://${pgHost === "::1" ? "[::1]" : pgHost}:${pgPort}/${scratchDatabase}?currentSchema=${schema}`;
  const isolatedBackendEnv = Object.fromEntries(Object.entries(nodeEnv).filter(([name]) =>
    !name.startsWith("SPRING_") && !name.startsWith("DB_")
    && !["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"].includes(name)));
  const backendEnv = {
    ...isolatedBackendEnv, SPRING_PROFILES_ACTIVE: "test", TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
    CHAT_RECEIPT_HMAC_SECRET: publicFixtureKey,
    SPRING_APPLICATION_JSON: JSON.stringify({ app: {
      "team-invitation-link-encryption": { "active-key-id": "e2e-v1", keys: { "e2e-v1": publicFixtureKey } },
      "e2e-isolation": { "run-id": runId, schema },
    } }),
    APP_CORS_ALLOWED_ORIGINS: webUrl, SPRING_DATASOURCE_URL: jdbcUrl,
    SPRING_DATASOURCE_USERNAME: pgUser, SPRING_DATASOURCE_PASSWORD: pgPassword,
    SPRING_DATASOURCE_DRIVER_CLASS_NAME: "org.postgresql.Driver", SPRING_DATASOURCE_HIKARI_SCHEMA: schema,
    SPRING_FLYWAY_ENABLED: "true", SPRING_FLYWAY_SCHEMAS: schema, SPRING_FLYWAY_DEFAULT_SCHEMA: schema,
    SPRING_JPA_HIBERNATE_DDL_AUTO: "validate", SPRING_JPA_PROPERTIES_HIBERNATE_DEFAULT_SCHEMA: schema,
  };
  function backend(port, merge) {
    return start(join(javaHome, "bin", "java"), ["-cp", classpath, "com.interviewonline.InterviewOnlineApplicationKt",
      `--server.port=${port}`, `--app.features.team-merge-commit-enabled=${merge}`,
      `--spring.datasource.url=${jdbcUrl}`, `--spring.datasource.hikari.schema=${schema}`,
      `--spring.flyway.schemas=${schema}`, `--spring.flyway.default-schema=${schema}`,
      `--spring.jpa.properties.hibernate.default_schema=${schema}`,
      "--app.http.trusted-proxy-cidrs=127.0.0.1/32,::1/128"], { cwd: isolatedBackend, env: backendEnv });
  }
  const firstBackend = backend(backendPort, process.env.FEATURE_TEAM_MERGE_COMMIT === "true");
  const frontend = start(process.execPath, [fileURLToPath(new URL("node_modules/@rspack/cli/bin/rspack.js", frontendDir)),
    ...(productionDir ? ["preview", relative(fileURLToPath(frontendDir), productionDir)] : ["serve"]),
    "--config", "rspack.config.mjs", "--host", "127.0.0.1", "--port", String(frontendPort)], {
    cwd: frontendDir, env: { ...frontendEnv, DEV_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}` },
  });
  await Promise.all([waitFor(`${apiUrl}/me/workspaces`, firstBackend, "BACKEND"), waitFor(webUrl, frontend, "WEB")]);
  if (secondBackendPort !== null) {
    const second = backend(secondBackendPort, true);
    await waitFor(`http://127.0.0.1:${secondBackendPort}/api/me/workspaces`, second, "SECOND_BACKEND");
  }
  const suiteEnv = {
    ...nodeEnv, E2E_API_URL: apiUrl, E2E_BASE_URL: webUrl, E2E_ISOLATED_RUN_ID: runId,
    E2E_ISOLATED_SCHEMA: schema, E2E_ISOLATED_DATABASE: scratchDatabase,
    ...(secondBackendPort === null ? {} : { E2E_SECOND_API_URL: `http://127.0.0.1:${secondBackendPort}/api` }),
  };
  for (const suiteFile of suites) {
    if (cancelled) throw new Error("E2E_RUN_CANCELLED");
    const args = ["--test"];
    const pattern = process.env.E2E_TEST_NAME_PATTERN ?? suitePatterns[suiteFile];
    if (pattern !== undefined) args.push("--test-name-pattern", pattern);
    args.push(suiteFile);
    const suite = start(process.execPath, args, { cwd: frontendDir, env: suiteEnv });
    const code = await new Promise((resolve) => {
      suite.child.once("exit", (value) => resolve(value ?? 1));
      suite.child.once("error", () => resolve(1));
    });
    if (code !== 0) { if (!cancelled) process.exitCode = code; break; }
  }
} finally {
  try { await owned.stop(); }
  finally {
    try { if (schemaCreated) runPsql(scratchDatabase, `DROP SCHEMA ${schema} CASCADE`); }
    finally {
      if (productionDir) rmSync(productionDir, { recursive: true, force: true });
      if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true });
    }
  }
}
