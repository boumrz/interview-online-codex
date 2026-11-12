import assert from "node:assert/strict";
import test from "node:test";
import { classifyDiagramResponse } from "../../src/features/room/diagram/diagramRequestPolicy.ts";

test("a stale lease refusal preserves pending work until the fresh authority arrives", () => {
  assert.equal(classifyDiagramResponse(403, "POST", "old", "fresh", true), "recover-proof");
  assert.equal(classifyDiagramResponse(403, "POST", "old", null, false), "recover-proof");
  assert.equal(classifyDiagramResponse(403, "GET", "old", "fresh", true), "recover-proof");
});

test("a current confirmed refusal distinguishes readable state from fully denied access", () => {
  assert.equal(classifyDiagramResponse(403, "POST", "current", "current", true), "deny-write");
  assert.equal(classifyDiagramResponse(403, "GET", "current", "current", true), "deny-read");
  assert.equal(classifyDiagramResponse(410, "GET", "current", "current", true), "deny-read");
});

test("permanent invalid mutations require an explicit discard choice; server failures retain retry", () => {
  for (const status of [400, 413, 422]) assert.equal(classifyDiagramResponse(status, "POST", "current", "current", true), "reset-document");
  assert.equal(classifyDiagramResponse(400, "GET", "current", "current", true), "retry");
  assert.equal(classifyDiagramResponse(503, "POST", "current", "current", true), "retry");
  assert.equal(classifyDiagramResponse(409, "POST", "current", "current", true), "conflict");
  assert.equal(classifyDiagramResponse(200, "POST", "current", "current", true), "accepted");
});
