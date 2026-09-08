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
    "ID нанимающего",
    "UUID нанимающего",
    "Введите ID нанимающего и нажмите «Добавить».",
    "Добавить",
    "Добавленные нанимающие",
    "Удалить",
  ]) {
    assert.match(component, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(component, /aria-label=\{`Удалить нанимающего \$\{[^}]+\.displayName\}`\}/);
  assert.match(component, /label="ID нанимающего"\s+description="Введите ID нанимающего и нажмите «Добавить»\."/);
  assert.match(component, /type="button"/);
  assert.match(component, /onKeyDown=/);
  for (const copy of [
    "Проверяем нанимающего…",
    "Введите ID нанимающего",
    "Введите полный UUID нанимающего",
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
