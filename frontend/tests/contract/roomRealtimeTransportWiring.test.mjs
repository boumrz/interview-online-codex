import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourcePath = new URL("../../src/features/room/useRoomSocket.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(
  sourcePath.pathname,
  source,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

function lineOf(node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

test("useRoomSocket imports and calls both credential-enforcing transport helpers", () => {
  const importedHelpers = new Set();
  const helperCallCounts = {
    createRoomEventSource: 0,
    roomRealtimeFetch: 0,
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "./roomRealtimeTransport") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) importedHelpers.add(element.name.text);
  }

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        Object.hasOwn(helperCallCounts, node.expression.text)) {
      helperCallCounts[node.expression.text] += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.deepEqual(
    [...importedHelpers].sort(),
    ["createRoomEventSource", "roomRealtimeFetch"],
    "the room hook must import only the two narrow realtime transport helpers from the seam",
  );
  assert.ok(helperCallCounts.createRoomEventSource > 0, "the SSE connection must call createRoomEventSource");
  assert.ok(helperCallCounts.roomRealtimeFetch > 0, "room POST/probe calls must call roomRealtimeFetch");
});

function directTransportLines() {
  const directEventSourceLines = [];
  const directFetchLines = [];

  function visit(node) {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "EventSource") {
      directEventSourceLines.push(lineOf(node));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
      directFetchLines.push(lineOf(node));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return { directEventSourceLines, directFetchLines };
}

test("useRoomSocket contains no direct EventSource construction", () => {
  const { directEventSourceLines } = directTransportLines();
  assert.deepEqual(directEventSourceLines, [], `direct room EventSource construction remains at lines ${directEventSourceLines.join(", ")}`);
});

test("useRoomSocket contains no ordinary fetch calls", () => {
  const { directFetchLines } = directTransportLines();
  assert.deepEqual(directFetchLines, [], `ordinary room fetch calls remain at lines ${directFetchLines.join(", ")}`);
});
