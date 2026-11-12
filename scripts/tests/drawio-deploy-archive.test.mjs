import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, access, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../../deploy/scripts/prepare_drawio_archive.py", import.meta.url));
const bytes = Buffer.from("a public pinned synthetic WAR fixture");
const sha = createHash("sha256").update(bytes).digest("hex");
const version = "32.6.10";
const secret = "signed-url-secret-must-not-appear";
const configuration = enabled => ({ services: { web: { build: { args: { FEATURE_ROOM_DIAGRAMS_ENABLED: enabled ? "true" : "false" } } } } });
const exists = async file => access(file).then(() => true, () => false);
async function run(f, { enabled = true, environment = {}, release = f.release } = {}) {
  const env = { ...process.env, DRAWIO_DOWNLOAD_TIMEOUT_MS: "200", DRAWIO_DOWNLOAD_ATTEMPTS: "2" };
  delete env.DRAWIO_ARCHIVE_PATH;
  Object.assign(env, environment);
  const child = spawn("python3", [helper, "--from-compose", "--release", release, "--cache-dir", f.cache], { env, stdio: ["pipe", "pipe", "pipe"] });
  const chunks = []; child.stdout.on("data", x => chunks.push(x)); child.stderr.on("data", x => chunks.push(x));
  child.stdin.end(JSON.stringify(configuration(enabled)));
  const [code] = await once(child, "close"); const output = Buffer.concat(chunks).toString();
  assert.equal(output.includes(secret), false); assert.equal(output.includes("Traceback"), false);
  return { code, output };
}
async function fixture(fn, handler = (req, res) => { res.end(bytes); }) {
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-drawio-prefetch-"));
  const requests = [];
  const server = createServer((req, res) => { requests.push(req.url); handler(req, res, requests.length); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const f = { directory, requests, cache: path.join(directory, "cache"), release: path.join(directory, "release.json"), offline: path.join(directory, "offline.war") };
  f.archive = path.join(f.cache, version, "draw.war");
  f.url = `http://127.0.0.1:${server.address().port}/draw.war`;
  f.metadata = { version, archiveUrl: f.url, archiveSha256: sha, maxArchiveBytes: 1024 };
  await writeFile(f.release, JSON.stringify(f.metadata)); await writeFile(f.offline, bytes);
  try { await fn(f); }
  finally { server.closeAllConnections(); server.close(); await once(server, "close"); await rm(directory, { recursive: true, force: true }); }
}

test("disabled diagrams do not read release/cache/settings or contact the network", () => fixture(async f => {
  const result = await run(f, { enabled: false, release: path.join(f.directory, "missing.json"), environment: { DRAWIO_DOWNLOAD_TIMEOUT_MS: "invalid", DRAWIO_ARCHIVE_PATH: "missing.war" } });
  assert.equal(result.code, 0, result.output); assert.equal(await exists(f.cache), false); assert.deepEqual(f.requests, []);
}));

test("an offline pinned WAR is copied into the Docker-context cache and the verified cache needs no network", () => fixture(async f => {
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.offline } });
  assert.equal(result.code, 0, result.output); assert.equal(await exists(f.archive), true, "offline release must be available inside the Docker build context");
  assert.deepEqual(await readFile(f.archive), bytes); assert.deepEqual(await readFile(f.offline), bytes); assert.deepEqual(f.requests, []);
  assert.equal((await run(f, { environment: { DRAWIO_ARCHIVE_PATH: "an-unused-missing-file" } })).code, 0);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(await readdir(path.dirname(f.archive)), ["draw.war"]);
}));

test("corrupt canonical caches fail closed and are never silently overwritten", () => fixture(async f => {
  await mkdir(path.dirname(f.archive), { recursive: true }); await writeFile(f.archive, "corrupt cache");
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.offline } });
  assert.notEqual(result.code, 0); assert.equal(await readFile(f.archive, "utf8"), "corrupt cache"); assert.deepEqual(f.requests, []);
  assert.match(result.output, /cache/i); assert.ok(result.output.includes(sha));
}));

test("invalid or oversized offline archives do not create or promote a cache", async () => {
  for (const invalid of [Buffer.from("wrong digest"), Buffer.alloc(1025)]) await fixture(async f => {
    await writeFile(f.offline, invalid);
    const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.offline } });
    assert.notEqual(result.code, 0); assert.equal(await exists(f.archive), false); assert.deepEqual(f.requests, []);
    assert.ok(result.output.includes(sha));
  });
});

test("a bounded transient HTTP failure is retried and only the verified download is promoted", () => fixture(async f => {
  const result = await run(f); assert.equal(result.code, 0, result.output);
  assert.equal(f.requests.length, 2); assert.deepEqual(await readFile(f.archive), bytes);
  assert.deepEqual(await readdir(path.dirname(f.archive)), ["draw.war"]);
}, (req, res, count) => { res.writeHead(count === 1 ? 503 : 200); res.end(count === 1 ? "temporarily unavailable" : bytes); }));

test("permanent HTTP failures are not retried and identify the cache and pinned offline remedy", () => fixture(async f => {
  const result = await run(f); assert.notEqual(result.code, 0); assert.equal(f.requests.length, 1);
  assert.equal(await exists(f.archive), false); assert.match(result.output, /404/); assert.match(result.output, /DRAWIO_ARCHIVE_PATH/);
  assert.ok(result.output.includes(sha) && result.output.includes(f.archive) && result.output.includes(f.url));
}, (req, res) => { res.writeHead(404); res.end("not found"); }));

test("a checksum mismatch is not retried and leaves no archive or partial download", () => fixture(async f => {
  const result = await run(f); assert.notEqual(result.code, 0); assert.equal(f.requests.length, 1);
  assert.equal(await exists(f.archive), false); assert.deepEqual(await readdir(path.dirname(f.archive)), []);
}, (req, res) => res.end("unpinned bytes")));

test("an oversized chunked download is not retried or promoted", () => fixture(async f => {
  const result = await run(f); assert.notEqual(result.code, 0); assert.equal(f.requests.length, 1);
  assert.equal(await exists(f.archive), false); assert.deepEqual(await readdir(path.dirname(f.archive)), []);
}, (req, res) => { res.writeHead(200, { "Transfer-Encoding": "chunked" }); res.end(Buffer.alloc(1025)); }));

test("timeouts stop after the configured attempts and clean temporary files with an actionable diagnostic", () => fixture(async f => {
  const result = await run(f, { environment: { DRAWIO_DOWNLOAD_TIMEOUT_MS: "40", DRAWIO_DOWNLOAD_ATTEMPTS: "2" } });
  assert.notEqual(result.code, 0); assert.equal(f.requests.length, 2); assert.match(result.output, /timeout/i);
  assert.match(result.output, /DRAWIO_ARCHIVE_PATH/); assert.ok(result.output.includes(sha));
  assert.equal(await exists(f.archive), false); assert.deepEqual(await readdir(path.dirname(f.archive)), []);
}, () => {}));

test("invalid timeout/attempt limits are rejected before any download", () => fixture(async f => {
  for (const environment of [{ DRAWIO_DOWNLOAD_TIMEOUT_MS: "0" }, { DRAWIO_DOWNLOAD_TIMEOUT_MS: "900001" }, { DRAWIO_DOWNLOAD_TIMEOUT_MS: "not-a-number" }, { DRAWIO_DOWNLOAD_ATTEMPTS: "0" }, { DRAWIO_DOWNLOAD_ATTEMPTS: "4" }]) {
    assert.notEqual((await run(f, { environment })).code, 0);
  }
  assert.deepEqual(f.requests, []); assert.equal(await exists(f.archive), false);
}));

test("invalid pinned release metadata cannot select a traversal path or unverified hash", () => fixture(async f => {
  for (const overrides of [{ version: "../escape" }, { archiveSha256: "unknown" }, { maxArchiveBytes: 0 }]) {
    await writeFile(f.release, JSON.stringify({ ...f.metadata, ...overrides }));
    assert.notEqual((await run(f)).code, 0);
  }
  assert.deepEqual(f.requests, []); assert.equal(await exists(f.cache), false);
}));

test("signed redirect URLs never enter diagnostics", () => fixture(async f => {
  const result = await run(f); assert.notEqual(result.code, 0); assert.ok(result.output.includes(f.url));
}, (req, res) => {
  if (req.url === "/draw.war") { res.writeHead(302, { Location: `/signed?token=${secret}` }); res.end(); }
  else { res.writeHead(403); res.end("denied"); }
}));
