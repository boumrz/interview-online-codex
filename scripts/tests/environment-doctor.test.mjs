import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const script = path.join(repositoryRoot, "backend/scripts/environment_doctor.sh");
const token = "usr_environment_doctor_synthetic_fixture";

async function withDoctorService({ body, httpStatus = 200 }, check) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
    });
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: "UNAUTHORIZED" }));
      return;
    }
    response.writeHead(httpStatus, { "Content-Type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await check({ baseUrl, requests });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function runDoctor(baseUrl, { suppliedToken = token, env = {}, trace = false } = {}) {
  const environment = { ...process.env, ...env };
  delete environment.INTERHUB_AUTH_TOKEN;
  if (suppliedToken !== null) environment.INTERHUB_AUTH_TOKEN = suppliedToken;
  const child = spawn("/bin/bash", [...(trace ? ["-x"] : []), script, baseUrl], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const [exitCode] = await once(child, "close");
  return { exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

function assertCredentialNotExposed(result) {
  assert.equal(`${result.stdout}${result.stderr}`.includes(token), false, "bearer token must not be printed");
}

test("doctor requires an environment token before contacting the protected API", async () => {
  for (const suppliedToken of [null, ""]) {
    await withDoctorService({ body: { status: "PASS" } }, async ({ baseUrl, requests }) => {
      const result = await runDoctor(baseUrl, { suppliedToken });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /INTERHUB_AUTH_TOKEN/);
      assert.equal(requests.length, 0, "missing token must not send an unauthenticated request");
    });
  }
});

test("doctor sends one exact authenticated GET and keeps the bearer token out of curl arguments and output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-doctor-test-"));
  const argumentCapture = path.join(directory, "curl-arguments.txt");
  await writeFile(path.join(directory, "curl"), [
    "#!/bin/bash",
    'printf \'%s\\n\' "$@" > "$DOCTOR_TEST_CURL_CAPTURE"',
    'exec /usr/bin/curl "$@"',
    "",
  ].join("\n"), { mode: 0o700 });
  try {
    await withDoctorService({ body: { status: "PASS", checks: [{ key: "node", status: "PASS" }] } }, async ({ baseUrl, requests }) => {
      const result = await runDoctor(baseUrl, {
        env: { PATH: `${directory}:${process.env.PATH}`, DOCTOR_TEST_CURL_CAPTURE: argumentCapture },
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(requests, [{ method: "GET", path: "/api/agent/environment/doctor", authorization: `Bearer ${token}` }]);
      assert.match(result.stdout, /Environment Doctor status: PASS/);
      assertCredentialNotExposed(result);
      const argumentsText = await readFile(argumentCapture, "utf8");
      assert.equal(argumentsText.includes(token), false, "bearer token must not be exposed in curl process arguments");
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor reports WARN distinctly without turning an optional-tool warning into PASS", async () => {
  await withDoctorService({ body: { status: "WARN", checks: [{ key: "playwright", status: "WARN" }] } }, async ({ baseUrl }) => {
    const result = await runDoctor(baseUrl);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /Environment Doctor status: WARN/);
    assert.doesNotMatch(result.stdout, /Environment Doctor status: PASS/);
    assertCredentialNotExposed(result);
  });
});

test("doctor fails on HTTP authentication and availability errors without printing the response body", async () => {
  for (const httpStatus of [401, 503]) {
    await withDoctorService({ httpStatus, body: { error: `private response ${token}` } }, async ({ baseUrl, requests }) => {
      const result = await runDoctor(baseUrl);
      assert.notEqual(result.exitCode, 0, `HTTP ${httpStatus} cannot pass`);
      assert.equal(requests[0].authorization, `Bearer ${token}`);
      assert.doesNotMatch(result.stdout, /Environment Doctor status: (PASS|UNKNOWN)/);
      assertCredentialNotExposed(result);
    });
  }
});

test("doctor returns a failing gate when the authenticated report says FAIL", async () => {
  await withDoctorService({ body: { status: "FAIL", checks: [{ key: "java", status: "FAIL" }] } }, async ({ baseUrl }) => {
    const result = await runDoctor(baseUrl);
    assert.equal(result.exitCode, 2);
    assert.match(`${result.stdout}${result.stderr}`, /Environment Doctor reported FAIL/);
    assertCredentialNotExposed(result);
  });
});

test("doctor rejects malformed, missing and unknown report status instead of claiming success", async () => {
  for (const body of ["not-json", '{"status":"PASS"}{}', '{"status":"PASS"}{"status":"PASS"}', {}, { status: "UNKNOWN" }, { status: null }]) {
    await withDoctorService({ body }, async ({ baseUrl }) => {
      const result = await runDoctor(baseUrl);
      assert.equal(result.exitCode, 2, `invalid report ${JSON.stringify(body)} cannot pass`);
      assert.doesNotMatch(result.stdout, /Environment Doctor status:/);
      assertCredentialNotExposed(result);
    });
  }
});

test("doctor protects the bearer token even when its caller enables shell tracing", async () => {
  await withDoctorService({ body: { status: "PASS" } }, async ({ baseUrl }) => {
    const result = await runDoctor(baseUrl, { trace: true });
    assert.equal(result.exitCode, 0, result.stderr);
    assertCredentialNotExposed(result);
  });
});

test("doctor protects the bearer token when the user's curl configuration enables verbose output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-doctor-curl-config-"));
  await writeFile(path.join(directory, ".curlrc"), "verbose\n");
  try {
    await withDoctorService({ body: { status: "PASS" } }, async ({ baseUrl }) => {
      const result = await runDoctor(baseUrl, { env: { CURL_HOME: directory } });
      assert.equal(result.exitCode, 0, result.stderr);
      assertCredentialNotExposed(result);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor rejects line breaks in the token before they can inject another request header", async () => {
  for (const suppliedToken of [`${token}\nX-Injected: true`, `${token}\rX-Injected: true`]) {
    await withDoctorService({ body: { status: "PASS" } }, async ({ baseUrl, requests }) => {
      const result = await runDoctor(baseUrl, { suppliedToken, trace: true });
      assert.equal(result.exitCode, 1);
      assert.equal(requests.length, 0);
      assertCredentialNotExposed(result);
    });
  }
});

test("doctor validates report JSON with the project's Node runtime when jq is unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-doctor-no-jq-"));
  await symlink("/usr/bin/curl", path.join(directory, "curl"));
  await symlink(process.execPath, path.join(directory, "node"));
  try {
    for (const [body, exitCode, status] of [
      [{ status: "PASS" }, 0, "PASS"],
      [{ status: "WARN" }, 0, "WARN"],
      [{ status: "FAIL" }, 2, undefined],
      ["malformed-json", 2, undefined],
      [{ status: "UNKNOWN" }, 2, undefined],
    ]) {
      await withDoctorService({ body }, async ({ baseUrl }) => {
        const result = await runDoctor(baseUrl, { env: { PATH: directory } });
        assert.equal(result.exitCode, exitCode, result.stderr);
        if (status) assert.match(result.stdout, new RegExp(`Environment Doctor status: ${status}`));
        else assert.doesNotMatch(result.stdout, /Environment Doctor status:/);
        assertCredentialNotExposed(result);
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
