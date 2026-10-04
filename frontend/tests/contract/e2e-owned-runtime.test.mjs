import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createOwnedRuntime } from "../e2e/support/owned-runtime.mjs";

function listening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

test("runtime teardown closes owned descendants after their suite parent has exited", {
  skip: process.platform === "win32" ? "POSIX process-group lifecycle" : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "interhub-owned-process-test-"));
  const record = join(directory, "descendant.json");
  const owned = createOwnedRuntime();
  const descendantCode = `
    const { createServer } = require("node:net");
    const { writeFileSync } = require("node:fs");
    const server = createServer();
    server.listen(0, "127.0.0.1", () => writeFileSync(process.env.OWNED_RECORD,
      JSON.stringify({ pid: process.pid, port: server.address().port })));
  `;
  const parentCode = `
    const { spawn } = require("node:child_process");
    const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantCode)}], { stdio: "ignore" });
    descendant.unref();
  `;
  const parent = owned.start(process.execPath, ["-e", parentCode], {
    env: { ...process.env, OWNED_RECORD: record }, stdio: "ignore",
  });
  try {
    await new Promise((resolve) => parent.child.once("exit", resolve));
    let info;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { info = JSON.parse(await readFile(record, "utf8")); break; } catch { await delay(20); }
    }
    assert.ok(info, "the owned descendant must be alive after the parent exits");
    assert.equal(await listening(info.port), true);
    await owned.stop();
    let remains = true;
    for (let attempt = 0; attempt < 100 && remains; attempt += 1) {
      remains = await listening(info.port);
      if (remains) await delay(20);
    }
    assert.equal(remains, false, "teardown must terminate the whole owned group, including descendants of finished suites");
  } finally {
    try { process.kill(-parent.child.pid, "SIGKILL"); } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
