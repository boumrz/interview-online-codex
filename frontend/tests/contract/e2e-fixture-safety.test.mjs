import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { installLearningVisitFixtureSql, setLearningVisitFixtureModeSql } from "../e2e/support/learning-visit-fixtures.mjs";

const frontendDir = new URL("../../", import.meta.url);

function importsFixtureGuardFirst(source) {
  const first = ts.createSourceFile("suite.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).statements[0];
  return Boolean(first && ts.isImportDeclaration(first) && !first.importClause &&
    ts.isStringLiteral(first.moduleSpecifier) && /(?:^|\/)require-isolated-api\.mjs$/.test(first.moduleSpecifier.text));
}

test("fixture source policy permits comments but requires a real guard import before executable statements", () => {
  assert.equal(importsFixtureGuardFirst('// suite prerequisites\n/* documentation */\nimport "../support/require-isolated-api.mjs";\nawait register();'), true);
  assert.equal(importsFixtureGuardFirst('// import "../support/require-isolated-api.mjs";\nawait register();'), false);
  assert.equal(importsFixtureGuardFirst('await register();\nimport "../support/require-isolated-api.mjs";'), false);
  assert.equal(importsFixtureGuardFirst('import "../support/not-require-isolated-api.mjs";'), false);
  assert.equal(importsFixtureGuardFirst('import { ignored } from "../support/require-isolated-api.mjs";'), false);
});

async function peer(handler) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function run(args, overrides) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("E2E_")));
  const child = spawn(process.execPath, args, {
    cwd: frontendDir,
    env: { ...env, ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  return { code, output };
}

test("a directly launched E2E cannot create fixtures in an unverified API", async () => {
  const api = await peer((_request, response) => {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "UNVERIFIED_API" }));
  });
  try {
    const result = await run(["tests/e2e/account/e2e-auth-navigation.mjs"], {
      E2E_API_URL: `${api.url}/api`,
      E2E_BASE_URL: api.url,
    });
    assert.notEqual(result.code, 0);
    assert.equal(api.requests.length, 0, "fixture guard must reject before any registration or API request");
    assert.match(result.output, /E2E_ISOLATED_RUN_REQUIRED/);
  } finally {
    await api.close();
  }
});

const runId = "a".repeat(32);
const schema = `interhub_e2e_${"b".repeat(32)}`;
const database = "interview_e2e_scratch";
const metadata = {
  E2E_ISOLATED_RUN_ID: runId,
  E2E_ISOLATED_SCHEMA: schema,
  E2E_ISOLATED_DATABASE: database,
};

test("learning visit fixtures accept only an owned-style schema and an explicit fixture mode", () => {
  for (const statement of [installLearningVisitFixtureSql, setLearningVisitFixtureModeSql]) {
    for (const unsafe of ["public", "interview_online", "interhub_e2e_user", `${schema}; SELECT 1`]) {
      assert.throws(() => statement(unsafe, true), /E2E_LEARNING_VISITS_REQUIRE_ISOLATED_SCHEMA/);
    }
    assert.throws(() => statement(schema, "false"), /E2E_LEARNING_VISITS_REQUIRE_ISOLATED_SCHEMA/);
  }
});

test("learning visit fixture switches modes while a transaction reads users", {
  skip: !process.env.TEAM_TEST_PG_DATABASE,
}, async () => {
  const database = process.env.TEAM_TEST_PG_DATABASE;
  const host = process.env.TEAM_TEST_PG_HOST || "127.0.0.1";
  const port = process.env.TEAM_TEST_PG_PORT || "5432";
  assert.match(database, /^[A-Za-z0-9_]+$/);
  assert.notEqual(database, "interview_online");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.match(port, /^[1-9][0-9]{0,4}$/);
  assert.ok(Number(port) <= 65535);
  const executable = process.env.PSQL_BIN || "psql";
  const args = ["-XqAt", "-h", host, "-p", port, "-d", database,
    "-U", process.env.TEAM_TEST_PG_USER || "interview", "-v", "ON_ERROR_STOP=1"];
  const env = { ...process.env, PGPASSWORD: process.env.TEAM_TEST_PG_PASSWORD || "interview", PGCONNECT_TIMEOUT: "3" };
  const schema = `visit_e2e_${randomUUID().replaceAll("-", "")}`;
  const users = `${schema}.users`;
  const progress = `${schema}.learning_progress_versions`;
  const sql = (statement) => execFileSync(executable, [...args, "-c", `SET lock_timeout TO '1s'; ${statement}`], {
    env, timeout: 5000, encoding: "utf8",
  }).trim();
  sql(`CREATE SCHEMA ${schema}; CREATE TABLE ${users} (id text PRIMARY KEY);
    CREATE TABLE ${progress} (user_id text REFERENCES ${users}, module text, version integer NOT NULL, state_json text NOT NULL,
    PRIMARY KEY (user_id, module, version));`);
  let holder;
  let exited;
  try {
    sql(installLearningVisitFixtureSql(schema, true));
    sql(`INSERT INTO ${users} VALUES ('visited');`);
    holder = spawn(executable, args, { env, stdio: ["pipe", "pipe", "inherit"] });
    exited = new Promise((resolve) => holder.once("close", resolve));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("E2E_LEARNING_VISITS_LOCK_NOT_READY")), 5000);
      let output = "";
      holder.stdout.on("data", (data) => {
        output += data;
        if (!output.includes("fixture_lock_ready")) return;
        clearTimeout(timeout);
        resolve();
      });
      holder.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      holder.stdin.write(`BEGIN; SELECT id FROM ${users}; SELECT 'fixture_lock_ready';\n`);
    });

    sql(setLearningVisitFixtureModeSql(schema, false));
    sql(`INSERT INTO ${users} VALUES ('fresh');`);
    sql(setLearningVisitFixtureModeSql(schema, true));
    sql(`INSERT INTO ${users} VALUES ('visited-again');`);
    assert.equal(sql(`SELECT id, count(progress.module) FROM ${users}
      LEFT JOIN ${progress} progress ON progress.user_id = ${users}.id GROUP BY id ORDER BY id;`),
      "fresh|0\nvisited|8\nvisited-again|8");
    assert.equal(sql(`SELECT module, state_json::jsonb->>'offerSeen', state_json::jsonb->>'skipped'
      FROM ${progress} WHERE user_id = 'visited' AND module IN ('onboarding', 'library') ORDER BY module;`),
      "library|true|false\nonboarding|true|true");
  } finally {
    if (holder) {
      holder.stdin.end();
      await exited;
    }
    sql(`DROP SCHEMA ${schema} CASCADE;`);
  }
});
const guardedRegistration = ["--input-type=module", "--eval", `
  const actualFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(input);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        || ["8080", "5173"].includes(url.port)) {
      throw new Error("CONTRACT_TEST_NETWORK_TARGET_BLOCKED");
    }
    return actualFetch(input, options);
  };
  await import("./tests/e2e/support/require-isolated-api.mjs");
  await fetch(process.env.E2E_API_URL + "/auth/register", { method: "POST" });
`];

function proofPeer(overrides = {}) {
  return peer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/test-fixtures/e2e-isolation") {
      if (request.headers["x-interhub-e2e-run"] !== runId) {
        response.writeHead(404);
        return response.end("{}");
      }
      return response.end(JSON.stringify({ runId, schema, database, ...overrides }));
    }
    response.end("{}");
  });
}

test("missing, development, remote and legacy override targets fail before any API request", async () => {
  const api = await proofPeer();
  try {
    for (const overrides of [
      { E2E_API_URL: undefined },
      { E2E_API_URL: "http://127.0.0.1:8080/api" },
      { E2E_BASE_URL: "http://localhost:5173" },
      { E2E_API_URL: "https://interview.vtools.tech/api" },
      { E2E_ISOLATED_RUN_ID: "true", E2E_ALLOW_MAIN_DB: "true" },
      { E2E_ISOLATED_DATABASE: "interview_online" },
      { E2E_ISOLATED_SCHEMA: "public" },
    ]) {
      const result = await run(guardedRegistration, {
        ...metadata, E2E_API_URL: `${api.url}/api`, E2E_BASE_URL: api.url, ...overrides,
      });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /E2E_(?:ISOLATED|E2E_)/);
      assert.equal(api.requests.length, 0);
    }
  } finally {
    await api.close();
  }
});

test("matching API and frontend proxy proof permits an isolated fixture", async () => {
  const api = await proofPeer();
  const proxy = await proofPeer();
  try {
    const result = await run(guardedRegistration, {
      ...metadata, E2E_API_URL: `${api.url}/api`, E2E_BASE_URL: proxy.url,
    });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(api.requests, [
      { method: "GET", path: "/api/test-fixtures/e2e-isolation" },
      { method: "POST", path: "/api/auth/register" },
    ]);
    assert.deepEqual(proxy.requests, [{ method: "GET", path: "/api/test-fixtures/e2e-isolation" }]);
  } finally {
    await api.close();
    await proxy.close();
  }
});

test("wrong proxy, mismatched API or absent backend proof prevents all fixture mutations", async () => {
  for (const mismatch of ["proxy", "api", "missing"]) {
    const api = mismatch === "missing"
      ? await peer((_request, response) => { response.writeHead(404); response.end(); })
      : await proofPeer(mismatch === "api" ? { schema: "public" } : {});
    const proxy = await proofPeer(mismatch === "proxy" ? { database: "interview_online" } : {});
    try {
      const result = await run(guardedRegistration, {
        ...metadata, E2E_API_URL: `${api.url}/api`, E2E_BASE_URL: proxy.url,
      });
      assert.notEqual(result.code, 0);
      assert.match(result.output, /E2E_ISOLATED_API_PROOF_(?:MISMATCH|REQUIRED)/);
      assert.equal([...api.requests, ...proxy.requests].filter((request) => request.method !== "GET").length, 0);
    } finally {
      await api.close();
      await proxy.close();
    }
  }
});

test("an optional second backend must prove the same temporary schema before mutations", async () => {
  const api = await proofPeer();
  const proxy = await proofPeer();
  const second = await proofPeer({ runId: "c".repeat(32) });
  try {
    const result = await run(guardedRegistration, {
      ...metadata, E2E_API_URL: `${api.url}/api`, E2E_BASE_URL: proxy.url,
      E2E_SECOND_API_URL: `${second.url}/api`,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /E2E_ISOLATED_API_PROOF_MISMATCH/);
    assert.equal([...api.requests, ...proxy.requests, ...second.requests].filter((request) => request.method !== "GET").length, 0);
  } finally {
    await api.close();
    await proxy.close();
    await second.close();
  }
});

test("every directly executable browser E2E imports the central fixture guard", async () => {
  async function collect(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const groups = await Promise.all(entries.map((entry) => entry.isDirectory()
      ? collect(new URL(`${entry.name}/`, directory))
      : /^e2e-.*\.mjs$/.test(entry.name) ? [new URL(entry.name, directory)] : []));
    return groups.flat();
  }
  const files = await collect(new URL("../e2e/", import.meta.url));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.equal(importsFixtureGuardFirst(await readFile(file, "utf8")), true,
      `${file.pathname} must reject unverified targets before test bodies execute`);
  }
});

test("package E2E entrypoints use the isolated runner rather than the development server", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith("e2e:") && !name.startsWith("chaos:")) continue;
    if (name === "e2e:team-invitations:native-ax") continue; // No application fixtures: native evidence utility.
    assert.match(command, /^node tests\/e2e\/(?:run-(?:isolated|all)\.mjs|teams\/run-team-[a-z-]+\.mjs)/,
      `${name} must create and tear down its own temporary PostgreSQL schema`);
  }
});

test("runner rejects legacy target overrides before creating a database schema or starting processes", async () => {
  for (const [name, value] of [
    ["E2E_API_URL", "http://127.0.0.1:8080/api"],
    ["E2E_BASE_URL", "http://localhost:5173"],
    ["E2E_SECOND_API_URL", "https://interview.vtools.tech/api"],
  ]) {
    const result = await run(["tests/e2e/run-isolated.mjs", "tests/e2e/platform/e2e-fixture-lifecycle.mjs"], {
      [name]: value, PSQL_BIN: "a-command-that-does-not-exist",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, new RegExp(`E2E_RUNNER_OWNS_${name}`));
    assert.doesNotMatch(result.output, /ENOENT|Starting InterviewOnlineApplication/);
  }
});

test("runner refuses remote PostgreSQL or malformed ports before any schema operation", async () => {
  for (const overrides of [
    { TEAM_TEST_PG_HOST: "postgres.example.test" },
    { TEAM_TEST_PG_PORT: "0" },
    { TEAM_TEST_PG_PORT: "70000" },
    { TEAM_TEST_PG_PORT: "5432?currentSchema=public" },
  ]) {
    const result = await run(["tests/e2e/run-isolated.mjs", "tests/e2e/platform/e2e-fixture-lifecycle.mjs"], {
      ...overrides, PSQL_BIN: "a-command-that-does-not-exist",
    });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /E2E_POSTGRES_LOOPBACK_TARGET_REQUIRED/);
    assert.doesNotMatch(result.output, /ENOENT|Starting InterviewOnlineApplication/);
  }
});

test("all browser suites use the canonical proved frontend URL", async () => {
  const theme = await readFile(new URL("../e2e/theme/e2e-theme-switch.mjs", import.meta.url), "utf8");
  assert.match(theme.split("\n").find((line) => line.startsWith("const baseUrl = ")) ?? "", /process\.env\.E2E_BASE_URL/);
  assert.doesNotMatch(theme, /process\.env\.BASE_URL/);
});
