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
const exists = async file => access(file).then(() => true, () => false);
async function run(f, { environment = {}, release = f.release, denyOfflineRead = false } = {}) {
  const env = { ...process.env, DRAWIO_DOWNLOAD_TIMEOUT_MS: "200", DRAWIO_DOWNLOAD_ATTEMPTS: "2" };
  delete env.DRAWIO_ARCHIVE_PATH;
  Object.assign(env, environment);
  const invocation = [helper, "--release", release, "--cache-dir", f.cache];
  const child = spawn("python3", denyOfflineRead ? ["-c", `
import errno, os, runpy, sys
from pathlib import Path
original = Path.open
def deny_input(self, *args, **kwargs):
    if str(self) == os.environ['DRAWIO_ARCHIVE_PATH']:
        raise PermissionError(errno.EACCES, '${secret}')
    return original(self, *args, **kwargs)
Path.open = deny_input
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
`, ...invocation] : invocation, { env, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = []; child.stdout.on("data", x => chunks.push(x)); child.stderr.on("data", x => chunks.push(x));
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

test("ordinary deployment prepares the editor without feature arguments", () => fixture(async f => {
  const result = await run(f);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(await readFile(f.archive), bytes);
  assert.deepEqual(f.requests, ["/draw.war"]);
}));

test("an offline pinned WAR is copied into the Docker-context cache and the verified cache needs no network", () => fixture(async f => {
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.offline } });
  assert.equal(result.code, 0, result.output); assert.equal(await exists(f.archive), true, "offline release must be available inside the Docker build context");
  assert.deepEqual(await readFile(f.archive), bytes); assert.deepEqual(await readFile(f.offline), bytes); assert.deepEqual(f.requests, []);
  assert.equal((await run(f, { environment: { DRAWIO_ARCHIVE_PATH: "an-unused-missing-file" } })).code, 0);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(await readdir(path.dirname(f.archive)), ["draw.war"]);
}));

test("a missing offline input identifies the source and transfer remedy without HTTP or partial files", () => fixture(async f => {
  const missing = path.join(f.directory, "not-transferred.war");
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: missing } });
  assert.notEqual(result.code, 0); assert.match(result.output, /Missing offline archive/i);
  assert.ok(result.output.includes(missing)); assert.match(result.output, /copy.*server/i);
  assert.deepEqual(f.requests, []); assert.equal(await exists(f.archive), false);
  assert.equal(await exists(f.cache), false, "missing input must be diagnosed before cache preparation");
}));

test("a directory supplied as the offline input is identified as not a regular archive", () => fixture(async f => {
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.directory } });
  assert.notEqual(result.code, 0); assert.match(result.output, /Offline archive is not a regular file/i);
  assert.ok(result.output.includes(f.directory)); assert.deepEqual(f.requests, []);
  assert.equal(await exists(f.archive), false); assert.equal(await exists(f.cache), false);
}));

test("an unreadable offline input reports source read access instead of a cache permission failure", () => fixture(async f => {
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.offline }, denyOfflineRead: true });
  assert.notEqual(result.code, 0); assert.match(result.output, /Cannot read offline archive.*permission denied/i);
  assert.ok(result.output.includes(f.offline)); assert.deepEqual(f.requests, []);
  assert.equal(await exists(f.archive), false);
  if (await exists(path.dirname(f.archive))) assert.deepEqual(await readdir(path.dirname(f.archive)), []);
}));

test("a blocked cache directory identifies the cache write operation and preserves the input", () => fixture(async f => {
  await writeFile(f.cache, "existing non-directory");
  const result = await run(f, { environment: { DRAWIO_ARCHIVE_PATH: f.offline } });
  assert.notEqual(result.code, 0); assert.match(result.output, /Cannot prepare or write draw.io cache/i);
  assert.ok(result.output.includes(f.archive)); assert.deepEqual(f.requests, []);
  assert.deepEqual(await readFile(f.offline), bytes); assert.equal(await readFile(f.cache, "utf8"), "existing non-directory");
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
  const result = await run(f, { environment: { DRAWIO_DOWNLOAD_TIMEOUT_MS: "400", DRAWIO_DOWNLOAD_ATTEMPTS: "2" } });
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
