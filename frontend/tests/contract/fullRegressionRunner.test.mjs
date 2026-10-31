import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const frontend = new URL("../../", import.meta.url);

async function fullCommand(overrides = {}) {
  const { scripts } = JSON.parse(await readFile(new URL("package.json", frontend), "utf8"));
  const [command, ...args] = scripts["e2e:all"].split(" ");
  assert.equal(command, "node");
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("E2E_")));
  const child = spawn(process.execPath, [...args, "--list"], {
    cwd: frontend, env: { ...env, PSQL_BIN: "regression-list-must-not-run-a-database-command", ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const code = await new Promise(resolve => child.once("exit", resolve));
  return { code, output };
}

async function suiteFiles(directory, prefix = "tests/e2e/") {
  const groups = await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory()
    ? suiteFiles(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
    : /^e2e-.*\.mjs$/.test(entry.name) ? [`${prefix}${entry.name}`] : []));
  return groups.flat().sort();
}

test("the complete E2E command lists every active suite in the required mode without starting fixtures", async () => {
  const result = await fullCommand();
  assert.equal(result.code, 0, `complete regression needs an inspectable plan: ${result.output}`);
  const plan = JSON.parse(result.output);
  const all = await suiteFiles(new URL("../e2e/", import.meta.url));
  assert.deepEqual([...plan.production, ...plan.development].sort(), all.filter(file => file !== "tests/e2e/account/e2e-social-login.mjs"));
  assert.deepEqual(plan.development, [
    "tests/e2e/platform/e2e-local-runtime-chunk-recovery.mjs",
    "tests/e2e/theme/e2e-workspace-burger-frames.mjs",
    "tests/e2e/theme/e2e-workspace-switch-stability.mjs",
  ]);
  assert.deepEqual(plan.excluded.map(item => item.file), ["tests/e2e/account/e2e-social-login.mjs"]);
  assert.match(plan.excluded[0].reason, /deferred|отлож/i);
  assert.equal(new Set([...plan.production, ...plan.development]).size, plan.production.length + plan.development.length);
});

test("complete E2E orchestration rejects unowned targets before starting any child runtime", async () => {
  for (const name of ["E2E_API_URL", "E2E_BASE_URL", "E2E_SECOND_API_URL"]) {
    const result = await fullCommand({ [name]: "https://interview.vtools.tech/api" });
    assert.notEqual(result.code, 0);
    assert.match(result.output, new RegExp(`E2E_RUNNER_OWNS_${name}`));
    assert.doesNotMatch(result.output, /ENOENT|Starting InterviewOnlineApplication/);
  }
});

test("a full regression cannot inherit hidden test-name filters", async () => {
  for (const [name, value] of [["E2E_TEST_NAME_PATTERN", "^never-run-any-test$"],
    ["E2E_SUITE_PATTERNS", JSON.stringify({ "tests/e2e/interview/e2e-smoke.mjs": "^never$" })]]) {
    const result = await fullCommand({ [name]: value });
    assert.notEqual(result.code, 0, `${name} must not narrow a complete regression`);
    assert.match(result.output, new RegExp(`E2E_FULL_PARTIAL_OVERRIDE_${name}`));
  }
});
