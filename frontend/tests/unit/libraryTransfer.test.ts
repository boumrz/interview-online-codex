import assert from "node:assert/strict";
import test from "node:test";
import { parseLibraryTransfer, serializeTask, serializeTaskSet } from "../../src/features/workspace/libraryTransfer.ts";

const task = {
  title: "Сумма двух чисел",
  description: "Найдите **сумму**.",
  starterCode: "function sum(a, b) {\n  return a + b;\n}",
  language: "nodejs",
};

test("скопированную задачу можно восстановить без потери описания и кода", () => {
  const transferred = parseLibraryTransfer(serializeTask({ ...task, id: "private-id", createdByUserId: "user-id" }), "task");
  assert.deepEqual(transferred, { kind: "task", task });
});

test("набор переносит полные задачи в исходном порядке без внутренних ID", () => {
  const text = serializeTaskSet("Подготовка", [task, { ...task, title: "Вторая", language: "python" }]);
  assert.deepEqual(parseLibraryTransfer(text, "task-set"), {
    kind: "task-set",
    name: "Подготовка",
    tasks: [task, { ...task, title: "Вторая", language: "python" }],
  });
  assert.equal(text.includes("taskId"), false);
});

test("читаемый текст, неверный тип и неполные данные нельзя импортировать", () => {
  assert.throws(() => parseLibraryTransfer("123 1. CodeRun · Two Sum", "task-set"), /скопированные данные/i);
  assert.throws(() => parseLibraryTransfer(serializeTask(task), "task-set"), /набор/i);
  assert.throws(() => parseLibraryTransfer(JSON.stringify({ format: "interview-online-library", version: 1, kind: "task", task: { title: "X" } }), "task"), /данные/i);
});
