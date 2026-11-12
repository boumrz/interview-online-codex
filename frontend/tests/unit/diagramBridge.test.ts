import assert from "node:assert/strict";
import test from "node:test";
import { createDrawioBridge } from "../../src/features/room/diagram/drawioBridge.ts";

test("receives only its exact iframe and origin and correlates the original request", async () => {
  const source = {};
  const sent: string[] = [];
  const events: string[] = [];
  const bridge = createDrawioBridge({ source, origin: "https://interhub.test", post: (message) => sent.push(message), onEvent: (event) => events.push(event.event), timeoutMs: 50 });
  const request = bridge.request("export", { format: "xml" });
  assert.equal(sent.length, 1, "editor receives the requested action");
  const original = JSON.parse(sent[0]!);
  bridge.receive({ source: {}, origin: "https://interhub.test", data: JSON.stringify({ event: "export", message: original, xml: "foreign" }) });
  bridge.receive({ source, origin: "https://foreign.test", data: JSON.stringify({ event: "export", message: original, xml: "foreign" }) });
  assert.deepEqual(events, []);
  bridge.receive({ source, origin: "https://interhub.test", data: JSON.stringify({ event: "export", message: original, xml: "<mxfile/>" }) });
  assert.equal((await request).xml, "<mxfile/>");
  assert.deepEqual(events, ["export"]);
  bridge.destroy();
});

test("times out missing editor replies and rejects waiting work after context cleanup", async () => {
  const bridge = createDrawioBridge({ source: {}, origin: "https://interhub.test", post: () => {}, onEvent: () => {}, timeoutMs: 5 });
  await assert.rejects(bridge.request("export"), /ответил/);
  const pending = bridge.request("load");
  bridge.destroy();
  await assert.rejects(pending, /закрыт/);
  await assert.rejects(bridge.request("export"), /закрыт/);
});

test("malformed and remote errors cannot become successful editor replies", async () => {
  const source = {}; const sent: string[] = [];
  const bridge = createDrawioBridge({ source, origin: "https://interhub.test", post: (message) => sent.push(message), onEvent: () => {}, timeoutMs: 50 });
  bridge.receive({ source, origin: "https://interhub.test", data: "not-json" });
  bridge.receive({ source, origin: "https://interhub.test", data: "[]" });
  const pending = bridge.request("patch");
  assert.equal(sent.length, 1, "patch is sent before waiting for a reply");
  bridge.receive({ source, origin: "https://interhub.test", data: JSON.stringify({ event: "patch", error: "unsafe raw content", message: JSON.parse(sent[0]!) }) });
  await assert.rejects(pending, /обработать/);
  bridge.destroy();
});

test("correlates serialized native load replies which omit the original request", async () => {
  const source = {};
  const bridge = createDrawioBridge({ source, origin: "https://interhub.test", post: () => {}, onEvent: () => {}, timeoutMs: 30 });
  const pending = bridge.request("load", { xml: "<mxfile/>" });
  bridge.receive({ source, origin: "https://interhub.test", data: JSON.stringify({ event: "load", xml: "<mxfile/>" }) });
  assert.equal((await pending).event, "load");
  bridge.destroy();
});

test("a checksum mismatch is a rejected editor operation requiring recovery", async () => {
  const source = {}; const sent: string[] = [];
  const bridge = createDrawioBridge({ source, origin: "https://interhub.test", post: (message) => sent.push(message), onEvent: () => {}, timeoutMs: 30 });
  const pending = bridge.request("patch", { patch: { u: {} }, checksum: "expected" });
  bridge.receive({ source, origin: "https://interhub.test", data: JSON.stringify({ event: "patch", checksumMismatch: true, checksum: "other", message: JSON.parse(sent[0]!) }) });
  await assert.rejects(pending, /согласовать/);
  bridge.destroy();
});
