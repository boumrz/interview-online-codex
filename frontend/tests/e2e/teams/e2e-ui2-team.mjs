import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
const evidence = process.env.EVIDENCE_DIR ?? ".run/ui2-team";
await mkdir(evidence, { recursive: true });
async function request(path, token, body) {
  const response = await fetch(`${api}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${await response.clone().text()}`);
  return response.json();
}
const auth = await request("/auth/register", null, { nickname: `ui2team_${Date.now().toString(36)}`, displayName: "Проверка UX команды", password: "test-password-123" });
const { team } = await request("/teams", auth.token, { name: `UX команда ${Date.now()}` });
const { task } = await request(`/teams/${team.id}/tasks`, auth.token, { title: "Исходная задача", description: "Описание", starterCode: "function solve() {}", language: "nodejs" });
const { task: secondTask } = await request(`/teams/${team.id}/tasks`, auth.token, { title: "Вторая задача набора", description: "Проверка порядка", starterCode: "function solve() {}", language: "nodejs" });
const { taskSet } = await request(`/teams/${team.id}/task-sets`, auth.token, { name: "Исходный набор", taskIds: [task.id, secondTask.id] });
const { track } = await request(`/teams/${team.id}/tracks`, auth.token, { name: "Исходный трек" });
await request(`/teams/${team.id}/tracks/${track.id}/vacancies`, auth.token, { title: "Исходная вакансия" });
await request(`/teams/${team.id}/interviews`, auth.token, { title: "Исходное интервью", selectedTaskIds: [task.id], interviewerIds: [auth.user.id] });
const browser = await chromium.launch();
const failures = [];
const releasePendingRequests = [];
async function waitForControlledRequest(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 10000); }),
    ]);
  } finally { clearTimeout(timer); }
}
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  // Freeze this browser's dev bundle while other agents edit unrelated screens.
  await context.routeWebSocket("**/ws", (socket) => socket.close());
  await context.addInitScript(({ token, user }) => { localStorage.setItem("auth_token", token); localStorage.setItem("auth_user", JSON.stringify(user)); localStorage.setItem("display_name", user.displayName); localStorage.setItem("interview-online:ui-theme", "dark"); }, auth);
  const page = await context.newPage();
  const scenarios = [
    { route: "library", trigger: "Редактировать задачу Исходная задача", title: "Редактировать задачу", field: "Новое название задачи", submit: "Сохранить задачу", replacement: "Исправленная задача" },
    { route: "library", tab: "Наборы задач", trigger: "Редактировать набор Исходный набор", title: "Редактировать набор", field: "Новое название набора", submit: "Сохранить набор", replacement: "Исправленный набор" },
    { route: "tracks", trigger: "Переименовать трек Исходный трек", title: "Переименовать трек", field: "Новое название трека", submit: "Сохранить трек", replacement: "Исправленный трек" },
    { route: "tracks", trigger: "Переименовать вакансию Исходная вакансия", title: "Переименовать вакансию", field: "Новое название вакансии", submit: "Сохранить вакансию", replacement: "Исправленная вакансия" },
    { route: "interviews", trigger: "Редактировать интервью Исходное интервью", title: "Редактировать интервью", field: "Название интервью", submit: "Сохранить", replacement: "Исправленное интервью" },
  ];
  for (const scenario of scenarios) {
    let releaseStaleLibraryRead;
    let successfulLibraryUpdate;
    await page.goto(`${web}/workspace/teams/${team.id}/${scenario.route}`);
    if (scenario.tab) {
      await page.getByRole("tab", { name: scenario.tab, exact: true }).click();
      const [titleBox, descriptionBox] = await Promise.all([
        page.getByText("Наборы задач", { exact: true }).last().boundingBox(),
        page.getByText("Переиспользуемые подборки командных задач для будущих интервью.", { exact: true }).boundingBox(),
      ]);
      if (!(descriptionBox.y >= titleBox.y + titleBox.height + 2)) failures.push("task set heading and description must occupy separate aligned lines");
    }
    await page.getByRole("button", { name: scenario.trigger, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: scenario.title, exact: true });
    if (!(await dialog.isVisible())) { failures.push(`${scenario.trigger} must open a modal while retaining the card`); continue; }
    const field = dialog.getByLabel(scenario.field, { exact: true });
    await field.waitFor();
    await page.waitForFunction((id) => document.activeElement?.id === id, await field.getAttribute("id"));
    assert.ok(await field.getAttribute("placeholder"), `${scenario.field} has a meaningful input hint`);
    await field.fill("Отменённый черновик");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label, scenario.trigger, { timeout: 1500 });
    await page.getByRole("button", { name: scenario.trigger, exact: true }).click();
    await page.waitForFunction((id) => document.activeElement?.id === id, await field.getAttribute("id"));
    assert.notEqual(await field.inputValue(), "Отменённый черновик", "cancel does not persist draft");
    await field.fill(scenario.replacement);
    if (scenario.route === "tracks") {
      const vacancyEdit = scenario.field === "Новое название вакансии";
      const message = vacancyEdit ? "Не удалось сохранить вакансию. Проверьте название или обновите страницу." : "Не удалось сохранить трек. Проверьте название или обновите страницу.";
      let releaseRequest;
      let enteredRequest;
      const release = new Promise((resolve) => { releaseRequest = resolve; });
      const entered = new Promise((resolve) => { enteredRequest = resolve; });
      await page.route(vacancyEdit ? `**/api/teams/${team.id}/tracks/*/vacancies/*` : `**/api/teams/${team.id}/tracks/*`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        enteredRequest();
        await release;
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "REVISION_CONFLICT" }) });
      }, { times: 1 });
      await dialog.getByRole("button", { name: scenario.submit, exact: true }).click();
      await entered;
      assert.equal(await dialog.getByRole("button", { name: "Отмена", exact: true }).isDisabled(), true, "pending edit cannot be dismissed through the footer");
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), true, "pending edit cannot be dismissed through Escape");
      releaseRequest();
      await dialog.getByText(message, { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: scenario.trigger, exact: true }).click();
      assert.equal(await dialog.getByText(message, { exact: true }).count(), 0, "cancel clears the stale error before editing again");
      await field.fill(scenario.replacement);
    }
    if (scenario.route === "library") {
      const editingTask = !scenario.tab;
      const entity = editingTask ? task : taskSet;
      const entityKind = editingTask ? "tasks" : "task-sets";
      if (!editingTask) {
        await dialog.getByRole("button", { name: `Поднять задачу ${secondTask.title} в наборе ${taskSet.name}`, exact: true }).click();
      }
      let capturedStaleRead;
      const captured = new Promise((resolve) => { capturedStaleRead = resolve; });
      const release = new Promise((resolve) => { releaseStaleLibraryRead = resolve; });
      releasePendingRequests.push(releaseStaleLibraryRead);
      const libraryPath = `/api/teams/${team.id}/${entityKind}`;
      // Hold the conflict refresh at revision 0 until the retry commits revision 1.
      await page.route((url) => url.pathname === libraryPath, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const response = await route.fetch();
        const snapshot = await response.json();
        assert.equal(response.status(), 200, "the held refresh is a successful library read");
        assert.equal(snapshot.items.find((item) => item.id === entity.id)?.revision, entity.revision);
        capturedStaleRead();
        await release;
        await route.fulfill({ response, json: snapshot });
      }, { times: 1 });
      await page.route(`**/api/teams/${team.id}/${entityKind}/${entity.id}`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: editingTask ? "TEAM_TASK_REVISION_CONFLICT" : "TEAM_TASK_SET_REVISION_CONFLICT" }) });
      }, { times: 1 });
      await dialog.getByRole("button", { name: scenario.submit, exact: true }).click();
      await dialog.getByText(editingTask ? "Не удалось сохранить задачу. Обновите список и попробуйте ещё раз." : "Не удалось сохранить набор. Обновите список и попробуйте ещё раз.", { exact: true }).waitFor();
      const errorIsVisibleAsError = await dialog.locator(".ant-form-item-explain-error").evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--app-error)";
        element.append(probe);
        const result = getComputedStyle(element).color === getComputedStyle(probe).color;
        probe.remove();
        return result;
      });
      if (!errorIsVisibleAsError) failures.push("failed form save must use the semantic error text color");
      await waitForControlledRequest(captured, "the conflict must trigger a library refresh");
      assert.equal(await field.inputValue(), scenario.replacement, "a failed save keeps the draft in the open dialog");
      if (!editingTask) {
        const order = dialog.getByRole("list", { name: `Порядок задач набора ${taskSet.name}`, exact: true }).getByRole("listitem");
        assert.equal(await order.count(), 2, "a conflict preserves the task-set membership draft");
        await order.nth(0).getByText(`1. ${secondTask.title}`, { exact: true }).waitFor();
        await order.nth(1).getByText("2. Исправленная задача", { exact: true }).waitFor();
      }
      successfulLibraryUpdate = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `${libraryPath}/${entity.id}` &&
        response.request().method() === "PATCH" && response.status() === 200,
      );
    }
    await page.screenshot({ path: `${evidence}/before-${scenario.submit}.png` });
    await dialog.getByRole("button", { name: scenario.submit, exact: true }).click();
    if (scenario.route === "interviews") {
      await page.getByText("Интервью сохранено", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    }
    await dialog.waitFor({ state: "hidden" });
    if (successfulLibraryUpdate) {
      const editingTask = !scenario.tab;
      const entity = editingTask ? task : taskSet;
      const response = await successfulLibraryUpdate;
      const body = await response.json();
      const savedEntity = editingTask ? body.task : body.taskSet;
      assert.equal(editingTask ? savedEntity.title : savedEntity.name, scenario.replacement, "retry persists the current title draft");
      assert.equal(savedEntity.revision, entity.revision + 1, "retry commits a new library revision");
      if (!editingTask) assert.deepEqual(savedEntity.items.map((item) => item.taskId), [secondTask.id, task.id], "retry persists task-set membership and order");
      const freshLibraryRead = page.waitForResponse(async (read) => {
        if (new URL(read.url()).pathname !== `/api/teams/${team.id}/${editingTask ? "tasks" : "task-sets"}` || read.request().method() !== "GET" || read.status() !== 200) return false;
        const snapshot = await read.json();
        const refreshedEntity = snapshot.items.find((item) => item.id === entity.id);
        return refreshedEntity?.revision === savedEntity.revision && (editingTask ? refreshedEntity.title : refreshedEntity.name) === scenario.replacement;
      });
      releaseStaleLibraryRead();
      await freshLibraryRead;
    }
    await page.getByText(scenario.replacement, { exact: true }).first().waitFor();
    if (successfulLibraryUpdate) {
      assert.equal(await page.getByText(scenario.tab ? taskSet.name : task.title, { exact: true }).count(), 0, "an older pending refresh cannot restore the previous title");
      await page.reload();
      if (scenario.tab) await page.getByRole("tab", { name: scenario.tab, exact: true }).click();
      await page.getByText(scenario.replacement, { exact: true }).first().waitFor();
      if (scenario.tab) {
        await page.getByRole("region", { name: `Командный набор ${scenario.replacement}`, exact: true }).getByText(`${secondTask.title} → Исправленная задача`, { exact: true }).waitFor();
      }
    }
    assert.equal(await page.getByText(/Набор rev\./).count(), 0, "internal revisions are absent from interview cards");
    await page.screenshot({ path: `${evidence}/${scenario.route}-${scenario.submit}.png` });
  }
  await page.goto(`${web}/workspace/teams/${team.id}/tracks`);
  for (const [trigger, title] of [["Настроить задачи трека", "Задачи трека"], ["Настроить задачи вакансии", "Задачи вакансии"]]) {
    await page.getByRole("button", { name: new RegExp(`^${trigger} `) }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(`^${title} `) });
    if (!(await dialog.isVisible())) { failures.push(`${trigger} must open a modal`); continue; }
    const selector = dialog.getByRole("combobox", { name: "Задачи для интервью", exact: true });
    await selector.fill("Исправленная задача");
    await page.locator(".ant-select-item-option").filter({ hasText: "Исправленная задача" }).click();
    await selector.press("Escape");
    await dialog.locator(".ant-select-clear").click();
    assert.equal(await dialog.locator(".ant-select-selection-item").count(), 0);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  await context.close();
} finally { releasePendingRequests.forEach((release) => release()); await browser.close(); }
assert.deepEqual(failures, [], "UI.2 team entity editing belongs in modals");
console.log("UI.2 team modal edit/cancel/save and programme selection passed");
