import { readdir, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOwnedRuntime } from "./support/owned-runtime.mjs";

const frontend = new URL("../../", import.meta.url);
const developmentSuites = new Set([
  "tests/e2e/platform/e2e-local-runtime-chunk-recovery.mjs",
  "tests/e2e/theme/e2e-workspace-burger-frames.mjs",
  "tests/e2e/theme/e2e-workspace-switch-stability.mjs",
]);
const deferredSuite = "tests/e2e/account/e2e-social-login.mjs";

async function collect(directory, prefix = "tests/e2e/") {
  const groups = await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory()
    ? collect(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
    : /^e2e-.*\.mjs$/.test(entry.name) ? [`${prefix}${entry.name}`] : []));
  return groups.flat().sort();
}

async function main() {
  // The orchestrator has the same admission boundary as each child runner.
  for (const name of ["E2E_API_URL", "E2E_BASE_URL", "E2E_SECOND_API_URL"]) {
    if (process.env[name] !== undefined) throw new Error(`E2E_RUNNER_OWNS_${name}: remove this override`);
  }
  for (const name of ["E2E_TEST_NAME_PATTERN", "E2E_SUITE_PATTERNS"]) {
    if (process.env[name] !== undefined) throw new Error(`E2E_FULL_PARTIAL_OVERRIDE_${name}: use the focused runner instead`);
  }
  if (process.argv.slice(2).some(arg => arg !== "--list")) throw new Error("E2E_FULL_UNKNOWN_ARGUMENT");
  const files = await collect(new URL("./", import.meta.url));
  const plan = {
    production: files.filter(file => file !== deferredSuite && !developmentSuites.has(file)),
    development: files.filter(file => developmentSuites.has(file)),
    excluded: [{ file: deferredSuite, reason: "Google/VK integration is deferred by the user; FEATURE_SOCIAL_AUTH_ENABLED remains false" }],
  };
  if (process.argv.includes("--list")) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  const reportDir = process.env.E2E_REPORT_DIR ?? await mkdtemp(join(tmpdir(), "interhub-full-regression-"));
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const owned = createOwnedRuntime();
  let interrupted = false;
  const interrupt = () => { interrupted = true; owned.interrupt(); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const results = [];
  try {
    for (const mode of ["production", "development"]) {
      if (interrupted) break;
      const log = createWriteStream(join(reportDir, `${mode}.log`));
      const startedAt = new Date().toISOString();
      const run = owned.start(process.execPath, ["tests/e2e/run-isolated.mjs", ...plan[mode]], {
        cwd: frontend,
        env: { ...process.env, FEATURE_SOCIAL_AUTH_ENABLED: "false", E2E_PRODUCTION: String(mode === "production"),
          E2E_TEAM_WORKSPACES_PRODUCTION: String(mode === "production"),
          E2E_CONTINUE_ON_FAILURE: "true", E2E_RESULTS_FILE: join(reportDir, `${mode}-results.jsonl`) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      run.child.stdout.on("data", data => { log.write(data); process.stdout.write(data); });
      run.child.stderr.on("data", data => { log.write(data); process.stderr.write(data); });
      const code = await new Promise(done => {
        run.child.once("close", value => done(value ?? 1));
        run.child.once("error", () => done(1));
      });
      await new Promise(done => log.end(done));
      results.push({ mode, exitCode: code, startedAt, finishedAt: new Date().toISOString() });
    }
  } finally {
    await owned.stop();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  const suites = [];
  for (const mode of ["production", "development"]) {
    const text = await readFile(join(reportDir, `${mode}-results.jsonl`), "utf8").catch(error => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    suites.push(...text.trim().split("\n").filter(Boolean).map(line => ({ mode, ...JSON.parse(line) })));
  }
  const passed = suites.length === plan.production.length + plan.development.length &&
    results.length === 2 && results.every(result => result.exitCode === 0) && suites.every(suite => suite.exitCode === 0);
  const summary = { plan, results, suites, interrupted, passed, reportDir };
  await writeFile(join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`E2E_FULL_REGRESSION_RESULT ${JSON.stringify({ passed, reportDir, suites: suites.length })}\n`);
  process.exitCode = interrupted ? 130 : passed ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
