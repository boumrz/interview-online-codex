import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const previewComponent = new URL("../../src/pages/dashboard/CreateRoomSection.tsx", import.meta.url);
const dashboardPage = new URL("../../src/pages/DashboardPage.tsx", import.meta.url);
const sharedPicker = new URL("../../src/features/hr/HiringManagerPicker.tsx", import.meta.url);

// Interaction, validation, recovery and authority are exercised by the HR E2E.
// This source audit guards delegation to that shared verified control, rather
// than requiring its labels and request logic to be duplicated by each parent.
test("room creation delegates verified identity selection to the shared hiring picker", async () => {
  const [component, dashboard, picker] = await Promise.all([
    readFile(previewComponent, "utf8"),
    readFile(dashboardPage, "utf8"),
    readFile(sharedPicker, "utf8"),
  ]);

  assert.match(component, /<HiringManagerPicker\b/);
  assert.match(component, /onPendingChange=\{onHiringLookupPendingChange\}/);
  assert.match(component, /selectedIds=\{hiringManagers\.map\(person => person\.normalizedId\)\}/);
  assert.match(component, /aria-label=\{`Удалить нанимающего \$\{[^}]+\.displayName\}`\}/);
  assert.match(component, /type="button"/);
  assert.match(component, /disabled=\{isSubmitting \|\| hiringLookupPending\}/);
  for (const copy of [
    "Нанимающий",
    "Введите ник нанимающего",
    "Проверяем нанимающего…",
    "Введите ник от 3 до 32 символов без пробелов",
    "Нанимающий уже добавлен",
    "Не удалось найти нанимающего. Повторите попытку.",
    "Нанимающий добавлен:",
  ]) {
    assert.match(picker, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(picker, /usePreviewHiringManagerMutation/);
  assert.match(picker, /label=\{label\}/);
  assert.match(picker, /placeholder="Введите ник нанимающего"/);
  assert.match(picker, /onInputKeyDown=/);
  assert.match(dashboard, /hiringManagerIds: roomHiringManagers\.map\(person => person\.normalizedId\)/);

  assert.doesNotMatch(
    component,
    /<Textarea\b|Будет добавлен:/,
  );
  assert.doesNotMatch(dashboard, /\.split\(\/\[\\s,;\]\+\//);
});
