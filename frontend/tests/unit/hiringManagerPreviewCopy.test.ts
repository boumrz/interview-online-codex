import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const previewComponent = new URL("../../src/pages/dashboard/CreateRoomSection.tsx", import.meta.url);
const dashboardPage = new URL("../../src/pages/DashboardPage.tsx", import.meta.url);

test("room creation exposes the explicit verified hiring picker contract", async () => {
  const [component, dashboard] = await Promise.all([
    readFile(previewComponent, "utf8"),
    readFile(dashboardPage, "utf8"),
  ]);

  for (const copy of [
    "Нанимающий",
    "Введите ник нанимающего",
    "Добавить",
    "Добавленные нанимающие",
    "Удалить",
  ]) {
    assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(component, /aria-label=\{`Удалить нанимающего \$\{[^}]+\.displayName\}`\}/);
  assert.match(component, /label="Нанимающий"/);
  assert.match(component, /placeholder="Введите ник нанимающего"/);
  assert.match(component, /type="button"/);
  assert.match(component, /onKeyDown=/);
  for (const copy of [
    "Проверяем нанимающего…",
    "Введите ник нанимающего",
    "Введите ник от 3 до 32 символов без пробелов",
    "Этот нанимающий уже добавлен",
    "Нанимающий не найден или недоступен",
    "Не удалось проверить нанимающего. Повторите попытку.",
    "Нанимающий добавлен:",
  ]) {
    assert.match(dashboard, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(dashboard, /hiringManagerSelections\.map\(\s*\(selection\) => selection\.normalizedId,?\s*\)/);

  assert.doesNotMatch(
    component,
    /<Textarea\b|Будет добавлен:/,
  );
  assert.doesNotMatch(dashboard, /\.split\(\/\[\\s,;\]\+\//);
});
