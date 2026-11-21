import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../../deploy/scripts/verify_room_canvas_assets.py", import.meta.url));
const secret = "synthetic-secret-must-never-be-printed";
const fontPath = "/whiteboard-assets/fonts/Excalifont/Regular.woff2";
const fontBytes = Buffer.from("wOF2public-test-font-bytes");
const fontHash = createHash("sha256").update(fontBytes).digest("hex");

async function run(args) {
  const child = spawn("python3", [helper, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", c => chunks.push(c)); child.stderr.on("data", c => chunks.push(c));
  const [code] = await once(child, "close");
  const output = Buffer.concat(chunks).toString();
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("Traceback"), false);
  return { code, output };
}

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

test("default asset smoke checks actual local JavaScript and font-manifest bodies using the requested Host", () => assets(async (base, requests) => {
  const result = await run([base, "deployment-test.invalid"]);
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(requests.map(x => x.url).sort(), ["/drawio/js/app.min.js", "/whiteboard-assets/subset/subset-worker.chunk.js", "/whiteboard-assets/font-licenses/manifest.json", fontPath].sort());
  assert.ok(requests.every(x => x.host === "deployment-test.invalid"));
}));

test("HTTP 200 SPA fallback is rejected for both editor JavaScript paths", async () => {
  for (const resource of ["/drawio/js/app.min.js", "/whiteboard-assets/subset/subset-worker.chunk.js"]) {
    for (const type of ["text/html", "application/javascript"]) await assets(async base => {
      const result = await run([base, "deployment-test.invalid"]); assert.notEqual(result.code, 0);
    }, { [resource]: [200, type, "  <!doctype html><html><body>SPA index</body></html>"] });
  }
});

test("asset smoke rejects empty/missing resources and malformed or unrelated manifests", async () => {
  for (const bad of [[200, "text/javascript", ""], [404, "text/html", secret]]) await assets(async base => {
    assert.notEqual((await run([base, "deployment-test.invalid"])).code, 0);
  }, { "/drawio/js/app.min.js": bad });
  for (const body of ["<html>index</html>", "{}", JSON.stringify({ package: "wrong-package", version: "0.18.1", families: {} })]) await assets(async base => {
    assert.notEqual((await run([base, "deployment-test.invalid"])).code, 0);
  }, { "/whiteboard-assets/font-licenses/manifest.json": [200, "application/json", body] });
});

test("a representative font must exist and have WOFF2 bytes matching its declared SHA-256", async () => {
  for (const response of [[404, "text/html", "not found"], [200, "font/woff2", "<!doctype html>index"], [200, "font/woff2", "wrong magic"], [200, "font/woff2", Buffer.from("wOF2changed-bytes")]]) await assets(async base => {
    assert.notEqual((await run([base, "deployment-test.invalid"])).code, 0);
  }, { [fontPath]: response });
});

test("asset smoke rejects credentials and query data in a base URL before making requests", () => assets(async (base, requests) => {
  for (const unsafe of [base.replace("http://", `http://${secret}@`), `${base}?token=${secret}`, `${base}#${secret}`]) assert.notEqual((await run([unsafe, "deployment-test.invalid"])).code, 0);
  assert.deepEqual(requests, []);
}));
