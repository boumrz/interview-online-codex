import assert from "node:assert/strict";
import test from "node:test";
import { compareElementVersions, elementFingerprint, parseAck, parseSnapshot } from "../../src/features/room/whiteboard/whiteboardProtocol.ts";

const element = (overrides: Record<string, unknown> = {}) => ({ id: "stroke", type: "freedraw", x: 2, y: 3, width: 20, height: 30, version: 1, versionNonce: 100, isDeleted: false, points: [[0, 0], [20, 30]], pressures: [0.2, 0.8], simulatePressure: false, ...overrides });
const snapshot = (overrides: Record<string, unknown> = {}) => ({ boardId: "board", sequence: 0, elements: [element()], canEdit: true, ...overrides });

test("defensively parses a native snapshot with pressure and retained deletion tombstones", () => {
  const parsed = parseSnapshot(snapshot({ elements: [element(), element({ id: "deleted", isDeleted: true, versionNonce: 0 })] }));
  assert.equal(parsed.boardId, "board");
  assert.deepEqual(parsed.elements[0]?.pressures, [0.2, 0.8]);
  assert.equal(parsed.elements[1]?.isDeleted, true);
  assert.deepEqual(parseAck({ boardId: "board", sequence: 2, operationId: "operation" }), { boardId: "board", sequence: 2, operationId: "operation" });
});

test("malformed snapshots, unsafe numbers and non-drawing elements fail before entering the editor", () => {
  for (const input of [null, snapshot({ sequence: -1 }), snapshot({ sequence: 2 ** 54 }), snapshot({ canEdit: "true" }), snapshot({ boardId: "" }), snapshot({ elements: [element(), element()] }), snapshot({ elements: [element({ type: "image" })] }), snapshot({ elements: [element({ link: "javascript:alert(1)" })] }), snapshot({ elements: [element({ x: Infinity })] }), snapshot({ elements: [element({ version: 1.1 })] }), snapshot({ elements: [element({ versionNonce: -1 })] }), snapshot({ elements: [element({ isDeleted: "false" })] }), snapshot({ elements: [element({ points: [[NaN, 0]] })] })]) {
    assert.throws(() => parseSnapshot(input));
  }
  for (const input of [{}, { boardId: "board", sequence: -1, operationId: "x" }, { boardId: "board", sequence: 1, operationId: "" }]) assert.throws(() => parseAck(input));
});

test("native conflict order prefers higher version then lower versionNonce", () => {
  const old = parseSnapshot(snapshot()).elements[0]!;
  const newer = parseSnapshot(snapshot({ elements: [element({ version: 2, versionNonce: 900 })] })).elements[0]!;
  const tieWinner = parseSnapshot(snapshot({ elements: [element({ versionNonce: 20 })] })).elements[0]!;
  assert.equal(compareElementVersions(newer, old), 1);
  assert.equal(compareElementVersions(old, newer), -1);
  assert.equal(compareElementVersions(tieWinner, old), 1);
  assert.equal(compareElementVersions(old, tieWinner), -1);
  assert.equal(compareElementVersions(old, old), 0);
  assert.notEqual(elementFingerprint(old), elementFingerprint(newer));
});

test("parsed snapshots own immutable JSON data rather than caller-owned mutable point arrays", () => {
  const original = snapshot();
  const parsed = parseSnapshot(original);
  original.elements[0]!.points[0]![0] = 999;
  assert.deepEqual(parsed.elements[0]?.points, [[0, 0], [20, 30]]);
  assert.equal(Object.isFrozen(parsed.elements[0]), true);
});
