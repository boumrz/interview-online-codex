import assert from "node:assert/strict";
import test from "node:test";
import { createDiagramQueue, parseDiagramDocument, parseDiagramOperation, buildDiagramOrderPatch, readDrawioChecksum } from "../../src/features/room/diagram/diagramProtocol.ts";

const diagramId = "7f8284e9-77f0-4e27-b3b7-3e0bea9f282c";
const operationId = "cc4eb4e9-fcc9-4975-8a24-4ea0394f8375";
const document = () => ({ diagramId, sequence: 2, xml: "<mxfile/>", canEdit: true, editor: "drawio", schemaVersion: 1, operations: [{ operationId, sequence: 2, sessionId: "candidate", xml: "<mxfile/>", patch: { u: { page: {} } } }], requiresSnapshot: false });

test("accepts the current server document and its ordered operations", () => {
  const result = parseDiagramDocument(document());
  assert.equal(result.diagramId, diagramId);
  assert.equal(result.sequence, 2);
  assert.equal(result.operations[0]?.operationId, operationId);
});

test("rejects malformed server boundaries and unsupported formats", () => {
  for (const input of [null, [], {}, { ...document(), sequence: -1 }, { ...document(), sequence: 1.5 }, { ...document(), canEdit: "true" }, { ...document(), editor: "external" }, { ...document(), schemaVersion: 9 }, { ...document(), operations: [{ operationId, sequence: 3, sessionId: "candidate", xml: "x" }] }, { ...document(), operations: [{ operationId, sequence: 1, sessionId: "candidate", xml: "x" }, { operationId, sequence: 1, sessionId: "candidate", xml: "x" }] }]) {
    assert.throws(() => parseDiagramDocument(input), /Некорректный/);
  }
});

test("acknowledgement removes only the accepted head and preserves the next local edit", () => {
  const queue = createDiagramQueue();
  queue.enqueue({ operationId: "first", patch: { u: { first: {} } } });
  queue.enqueue({ operationId: "second", patch: { u: { second: {} } } });
  assert.equal(queue.acknowledge("late-or-foreign"), false);
  assert.equal(queue.peek()?.operationId, "first");
  assert.equal(queue.acknowledge("first"), true);
  assert.equal(queue.peek()?.operationId, "second");
  assert.equal(queue.size, 1);
});

test("duplicate local identity is retained once and revocation clears and fences the queue", () => {
  const queue = createDiagramQueue();
  const operation = { operationId: "same", patch: { u: { first: {} } } };
  queue.enqueue(operation); queue.enqueue(operation);
  assert.equal(queue.size, 1);
  queue.revoke();
  assert.equal(queue.peek(), undefined);
  assert.equal(queue.acknowledge("same"), false);
  assert.equal(queue.enqueue(operation), false);
  assert.equal(queue.size, 0);
});

test("canonical sibling order is expressed without dropping unknown pending local cells", () => {
  assert.deepEqual(buildDiagramOrderPatch([{ id: "stable-page", cells: [{ id: "0", parent: null }, { id: "1", parent: "0" }, { id: "client", parent: "1" }, { id: "db", parent: "1" }, { id: "nested", parent: "client" }] }]), { u: { "stable-page": { cells: { u: { "1": { parent: "0", previous: "" }, client: { parent: "1", previous: "" }, db: { parent: "1", previous: "client" }, nested: { parent: "client", previous: "" } } } } } });
});

test("document supplied IDs cannot change the prototype of canonical order records", () => {
  const result = buildDiagramOrderPatch([{ id: "__proto__", cells: [{ id: "__proto__", parent: "layer" }] }]);
  const encoded = JSON.stringify(result);
  assert.ok(encoded.includes('"__proto__"'), "unusual IDs remain an own serialized field");
  assert.deepEqual(JSON.parse(encoded), { u: JSON.parse('{"__proto__":{"cells":{"u":{"__proto__":{"parent":"layer","previous":""}}}}}') });
});

test("accepts a compacted duplicate receipt without treating it as an empty document", () => {
  const receipt = parseDiagramOperation({ operationId, sequence: 1, sessionId: "candidate", xml: null });
  assert.equal(receipt.xml, null);
  assert.equal(receipt.operationId, operationId);
  assert.throws(() => parseDiagramDocument({ ...document(), operations: [receipt] }), /Некорректный/);
  const omittedXml = parseDiagramOperation({ operationId, sequence: 1, sessionId: "candidate" });
  assert.equal(omittedXml.xml, null);
});

test("normalizes actual native signed integer checksums including zero", () => {
  for (const checksum of [277012328, -1161370145, 0]) assert.equal(readDrawioChecksum(checksum), String(checksum));
  assert.equal(readDrawioChecksum("-1161370145"), "-1161370145");
  for (const invalid of [null, undefined, false, NaN, Infinity, 1.25, {}, ""]) assert.throws(() => readDrawioChecksum(invalid), /согласованность/);
});
