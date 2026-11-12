import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, readdir, stat, rm, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../../deploy/scripts/configure_room_canvases.py", import.meta.url));
const secret = "synthetic-secret-must-never-be-printed";
const diagramKey = "FEATURE_ROOM_DIAGRAMS_ENABLED";
const boardKey = "FEATURE_ROOM_WHITEBOARD_ENABLED";
const fontPath = "/whiteboard-assets/fonts/Excalifont/Regular.woff2";
const fontBytes = Buffer.from("wOF2public-test-font-bytes");
const fontHash = createHash("sha256").update(fontBytes).digest("hex");
const flags = (diagrams = "true", whiteboard = "true") => ({ [diagramKey]: diagrams, [boardKey]: whiteboard });
function compose(backend = flags(), frontend = flags(), extra = {}) {
  return { services: { backend: { environment: { ...backend, ...extra, DB_PASSWORD: secret } }, web: { build: { args: frontend } } } };
}
async function run(args, input, { denyCreate = false, denyReplace = false } = {}) {
  const operation = denyCreate ? "os.open" : "os.replace";
  const prelude = `import sys,runpy\nfrom unittest.mock import patch\nsys.argv=sys.argv[1:]\nwith patch('${operation}',side_effect=PermissionError('fixture denied file operation')):\n runpy.run_path(sys.argv[0],run_name='__main__')`;
  const child = spawn("python3", denyCreate || denyReplace ? ["-c", prelude, helper, ...args] : [helper, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", c => chunks.push(c)); child.stderr.on("data", c => chunks.push(c));
  child.stdin.end(input === undefined ? "" : typeof input === "string" ? input : JSON.stringify(input));
  const [code] = await once(child, "close");
  const output = Buffer.concat(chunks).toString();
  assert.equal(output.includes(secret), false, "credentials are never included in helper diagnostics");
  assert.equal(output.includes("Traceback"), false, "failures must have a concise safe diagnostic");
  return { code, output };
}
async function fixture(fn) {
  const directory = await mkdtemp(path.join(tmpdir(), "interhub-canvas-deploy-"));
  try { return await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const backups = async directory => (await readdir(directory)).filter(name => name.includes("before-canvases"));

test("enable creates a private original backup and preserves all unrelated bytes, owner and permissions", () => fixture(async directory => {
  const file = path.join(directory, ".env");
  const original = `# конфигурация\r\nDB_PASSWORD='${secret}'\r\nUNCHANGED='$(do_not_execute)'\r\nFEATURE_SOCIAL_AUTH_ENABLED=false\r\n`;
  await writeFile(file, original, { mode: 0o640 });
  const previous = await stat(file);
  const result = await run(["--enable-env", file]);
  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(file, "utf8"), `${original}${diagramKey}=true\r\n${boardKey}=true\r\n`);
  const names = await backups(directory); assert.equal(names.length, 1);
  const backup = path.join(directory, names[0]);
  assert.equal(await readFile(backup, "utf8"), original);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  const current = await stat(file);
  assert.equal(current.mode & 0o777, previous.mode & 0o777);
  assert.equal(current.uid, previous.uid); assert.equal(current.gid, previous.gid);
}));

test("enable normalizes duplicate/export flag assignments only and a repeated enable is a no-op", () => fixture(async directory => {
  const file = path.join(directory, ".env");
  await writeFile(file, `DB_PASSWORD=${secret}\nexport ${diagramKey}=false\n${boardKey}=false # old value\nKEEP=verbatim\n${diagramKey}=false\n`, { mode: 0o600 });
  assert.equal((await run(["--enable-env", file])).code, 0);
  const expected = `DB_PASSWORD=${secret}\n${diagramKey}=true\n${boardKey}=true\nKEEP=verbatim\n`;
  assert.equal(await readFile(file, "utf8"), expected);
  const firstBackups = await backups(directory);
  assert.equal((await run(["--enable-env", file])).code, 0);
  assert.equal(await readFile(file, "utf8"), expected);
  assert.deepEqual(await backups(directory), firstBackups);
}));

test("flag-looking lines inside multiline secrets and escaped continuations are not edited", () => fixture(async directory => {
  const file = path.join(directory, ".env");
  const original = `PRIVATE_BLOB='${secret}\n${diagramKey}=inside-secret\nend'\nCONTINUED=literal\\\n${boardKey}=inside-value\nUNCHANGED=kept\n`;
  await writeFile(file, original, { mode: 0o600 });
  const result = await run(["--enable-env", file]); assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(file, "utf8"), `${original}${diagramKey}=true\n${boardKey}=true\n`);
}));

test("automatic edits reject dynamic shell expressions and multiline flag assignments before creating a backup", () => fixture(async directory => {
  const file = path.join(directory, ".env");
  for (const original of [`PRIVATE=$(do_not_execute)\nDB_PASSWORD=${secret}\n`, `${diagramKey}='false\nstill-value'\nDB_PASSWORD=${secret}\n`]) {
    await writeFile(file, original, { mode: 0o600 });
    assert.notEqual((await run(["--enable-env", file])).code, 0);
    assert.equal(await readFile(file, "utf8"), original); assert.deepEqual(await backups(directory), []);
  }
}));

test("backup creation failure leaves the existing env untouched", () => fixture(async directory => {
  const file = path.join(directory, ".env"); const original = `DB_PASSWORD=${secret}\n`;
  await writeFile(file, original, { mode: 0o600 });
  const result = await run(["--enable-env", file], undefined, { denyCreate: true });
  assert.notEqual(result.code, 0); assert.equal(await readFile(file, "utf8"), original);
  assert.deepEqual(await backups(directory), []);
}));

test("atomic replacement failure retains the original env and its private backup, without temporary files", () => fixture(async directory => {
  const file = path.join(directory, ".env"); const original = `DB_PASSWORD=${secret}\n`;
  await writeFile(file, original, { mode: 0o600 });
  const result = await run(["--enable-env", file], undefined, { denyReplace: true });
  assert.notEqual(result.code, 0); assert.equal(await readFile(file, "utf8"), original);
  const saved = await backups(directory); assert.equal(saved.length, 1);
  assert.equal(await readFile(path.join(directory, saved[0]), "utf8"), original);
  assert.equal((await stat(path.join(directory, saved[0]))).mode & 0o777, 0o600);
  assert.equal((await readdir(directory)).length, 2);
}));

test("enable rejects missing, directory and symbolic-link paths without changing their targets", () => fixture(async directory => {
  const file = path.join(directory, ".env"); await writeFile(file, `DB_PASSWORD=${secret}\n`);
  const link = path.join(directory, "linked.env"); await symlink(file, link);
  for (const name of [path.join(directory, "missing.env"), directory, link]) assert.notEqual((await run(["--enable-env", name])).code, 0);
  assert.equal(await readFile(file, "utf8"), `DB_PASSWORD=${secret}\n`); assert.deepEqual(await backups(directory), []);
}));

test("resolved Compose accepts consistent enabled and legacy missing/off configurations", async () => {
  for (const config of [compose(), compose({}, {}), compose(flags("false", "false"), flags("false", "false"))]) {
    const result = await run(["--check-compose"], config); assert.equal(result.code, 0, result.output);
  }
  assert.equal((await run(["--check-compose", "--require-enabled"], compose())).code, 0);
  assert.notEqual((await run(["--check-compose", "--require-enabled"], compose({}, {}))).code, 0);
});

test("resolved Compose rejects inconsistent and nonliteral flags without disclosing configuration", async () => {
  for (const config of [compose(flags(), flags("false", "true")), compose(flags("true", "false"), flags()), compose(flags("yes"), flags()), compose(flags(1), flags())]) {
    assert.notEqual((await run(["--check-compose"], config)).code, 0);
  }
  assert.notEqual((await run(["--check-compose"], "invalid-json")).code, 0);
});

test("Spring JSON feature overrides have backend precedence for nested and flat properties", async () => {
  for (const properties of [{ app: { features: { "room-diagrams-enabled": true, "room-whiteboard-enabled": true } } }, { "app.features.room-diagrams-enabled": "true", "app.features.room-whiteboard-enabled": "true" }, { app: { features: { roomDiagramsEnabled: true, roomWhiteboardEnabled: true } } }]) {
    const result = await run(["--check-compose"], compose(flags("false", "false"), flags(), { SPRING_APPLICATION_JSON: JSON.stringify(properties) }));
    assert.equal(result.code, 0, result.output);
  }
  for (const value of ["malformed", JSON.stringify({ app: { features: { "room-diagrams-enabled": false } } })]) {
    assert.notEqual((await run(["--check-compose"], compose(flags(), flags(), { SPRING_APPLICATION_JSON: value }))).code, 0);
  }
});

test("Spring JSON environment-style keys do not override canonical dotted application properties", async () => {
  const json = JSON.stringify({ APP_FEATURES_ROOM_DIAGRAMS_ENABLED: true, APP_FEATURES_ROOM_WHITEBOARD_ENABLED: true });
  assert.notEqual((await run(["--check-compose", "--require-enabled"], compose(flags("false", "false"), flags(), { SPRING_APPLICATION_JSON: json }))).code, 0);
});

test("direct canonical Spring environment aliases override application placeholder flags", async () => {
  for (const enabled of [
    { APP_FEATURES_ROOM_DIAGRAMS_ENABLED: "true", APP_FEATURES_ROOM_WHITEBOARD_ENABLED: "true" },
    { APP_FEATURES_ROOMDIAGRAMSENABLED: "true", APP_FEATURES_ROOMWHITEBOARDENABLED: "true" },
    { "app.features.roomDiagramsEnabled": "true", "app.features.roomWhiteboardEnabled": "true" },
  ]) assert.equal((await run(["--check-compose"], compose(flags("false", "false"), flags(), enabled))).code, 0);
  assert.notEqual((await run(["--check-compose"], compose(flags(), flags(), { APP_FEATURES_ROOM_DIAGRAMS_ENABLED: "false" }))).code, 0);
});

test("lumped environment keys cannot be mistaken for a canonical Spring namespace", async () => {
  const lumped = { APPFEATURESROOMDIAGRAMSENABLED: "true", APPFEATURESROOMWHITEBOARDENABLED: "true" };
  assert.notEqual((await run(["--check-compose", "--require-enabled"], compose(flags("false", "false"), flags(), lumped))).code, 0);
});

test("raw placeholder flags inside Spring JSON require canonical application properties", async () => {
  for (const key of [diagramKey, boardKey]) {
    const json = JSON.stringify({ [key]: false });
    assert.notEqual((await run(["--check-compose"], compose(flags(), flags(), { SPRING_APPLICATION_JSON: json }))).code, 0);
  }
});

test("conflicting application aliases within one source tier fail closed independently of insertion order", async () => {
  for (const reverse of [false, true]) {
    const environment = Object.fromEntries((reverse ? [["APP_FEATURES_ROOMDIAGRAMSENABLED", "true"], ["APP_FEATURES_ROOM_DIAGRAMS_ENABLED", "false"]] : [["APP_FEATURES_ROOM_DIAGRAMS_ENABLED", "false"], ["APP_FEATURES_ROOMDIAGRAMSENABLED", "true"]]));
    assert.notEqual((await run(["--check-compose"], compose(flags(), flags(), environment))).code, 0);
    const properties = Object.fromEntries((reverse ? [["app.features.roomDiagramsEnabled", true], ["app.features.room-diagrams-enabled", false]] : [["app.features.room-diagrams-enabled", false], ["app.features.roomDiagramsEnabled", true]]));
    assert.notEqual((await run(["--check-compose"], compose(flags(), flags(), { SPRING_APPLICATION_JSON: JSON.stringify(properties) }))).code, 0);
  }
});

async function assets(fn, overrides = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, host: request.headers.host });
    const defaultResult = request.url === fontPath ? [200, "font/woff2", fontBytes] : request.url.endsWith("manifest.json")
      ? [200, "application/json", JSON.stringify({ package: "@excalidraw/excalidraw", version: "0.18.1", families: { Excalifont: { fontFiles: { "Excalifont/Regular.woff2": fontHash } } } })]
      : [200, "text/javascript; charset=utf-8", "/* local editor asset */\nconst editor = true;"];
    const [status, type, body] = overrides[request.url] ?? defaultResult;
    response.writeHead(status, { "Content-Type": type }); response.end(body);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await fn(`http://127.0.0.1:${server.address().port}/`, requests); }
  finally { server.close(); await once(server, "close"); }
}

test("enabled asset smoke checks actual local JavaScript and font-manifest bodies using the requested Host", () => assets(async (base, requests) => {
  const result = await run(["--verify-assets", base, "deployment-test.invalid"], compose());
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(requests.map(x => x.url).sort(), ["/drawio/js/app.min.js", "/whiteboard-assets/subset/subset-worker.chunk.js", "/whiteboard-assets/font-licenses/manifest.json", fontPath].sort());
  assert.ok(requests.every(x => x.host === "deployment-test.invalid"));
}));

test("HTTP 200 SPA fallback is rejected for both editor JavaScript paths", async () => {
  for (const resource of ["/drawio/js/app.min.js", "/whiteboard-assets/subset/subset-worker.chunk.js"]) {
    for (const type of ["text/html", "application/javascript"]) await assets(async base => {
      const result = await run(["--verify-assets", base, "deployment-test.invalid"], compose()); assert.notEqual(result.code, 0);
    }, { [resource]: [200, type, "  <!doctype html><html><body>SPA index</body></html>"] });
  }
});

test("asset smoke rejects empty/missing resources and malformed or unrelated manifests", async () => {
  for (const bad of [[200, "text/javascript", ""], [404, "text/html", secret]]) await assets(async base => {
    assert.notEqual((await run(["--verify-assets", base, "deployment-test.invalid"], compose())).code, 0);
  }, { "/drawio/js/app.min.js": bad });
  for (const body of ["<html>index</html>", "{}", JSON.stringify({ package: "wrong-package", version: "0.18.1", families: {} })]) await assets(async base => {
    assert.notEqual((await run(["--verify-assets", base, "deployment-test.invalid"], compose())).code, 0);
  }, { "/whiteboard-assets/font-licenses/manifest.json": [200, "application/json", body] });
});

test("disabled asset smoke makes no HTTP requests", () => assets(async (base, requests) => {
  const result = await run(["--verify-assets", base, "deployment-test.invalid"], compose({}, {}));
  assert.equal(result.code, 0, result.output); assert.deepEqual(requests, []);
}));

test("a representative font must exist and have WOFF2 bytes matching its declared SHA-256", async () => {
  for (const response of [[404, "text/html", "not found"], [200, "font/woff2", "<!doctype html>index"], [200, "font/woff2", "wrong magic"], [200, "font/woff2", Buffer.from("wOF2changed-bytes")]]) await assets(async base => {
    assert.notEqual((await run(["--verify-assets", base, "deployment-test.invalid"], compose())).code, 0);
  }, { [fontPath]: response });
});

test("asset smoke rejects credentials and query data in a base URL before making requests", () => assets(async (base, requests) => {
  for (const unsafe of [base.replace("http://", `http://${secret}@`), `${base}?token=${secret}`, `${base}#${secret}`]) assert.notEqual((await run(["--verify-assets", unsafe, "deployment-test.invalid"], compose())).code, 0);
  assert.deepEqual(requests, []);
}));
