import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";

async function request(path, token, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function fixture(path = "/workspace/personal/library") {
  const auth = await request("/auth/register", null, {
    nickname: `authoring_${crypto.randomUUID().slice(0, 10)}`,
    displayName: "Проверка форм",
    password: "authoring-password-123",
  });
  const task = await request("/me/tasks", auth.token, { title: "Задача для формы", language: "nodejs", description: "Условие", starterCode: "// solution" });
  const preset = await request("/me/presets", auth.token, { name: "Набор для формы", taskTemplateIds: [task.id] });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("interview-online:ui-theme", "dark");
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${web}${path}`, { waitUntil: "networkidle" });
  return {
    auth, task, preset, page,
    async close() {
      await browser.close();
      await request(`/me/presets/${preset.id}`, auth.token, null, "DELETE").catch(() => {});
      await request(`/me/tasks/${task.id}`, auth.token, null, "DELETE").catch(() => {});
    },
  };
}

async function visibleFooter(dialog, name, height) {
  await dialog.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const box = await dialog.getByRole("button", { name, exact: true }).boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= height, `${name} remains visible in a short viewport`);
}

test("personal tasks and sets expose one explicit edit action and save the complete draft", async () => {
  const f = await fixture();
  try {
    const card = f.page.getByRole("region", { name: `Личная задача ${f.task.title}`, exact: true });
    await card.waitFor();
    assert.equal(await card.getByRole("button", { name: /^Переименовать задачу/ }).count(), 0, "task titles do not duplicate the edit action");
    const edit = card.getByRole("button", { name: `Редактировать задачу ${f.task.title}`, exact: true });
    assert.equal((await edit.textContent()).trim(), "Редактировать");
    await edit.click();
    const taskDialog = f.page.getByRole("dialog", { name: "Редактировать задачу", exact: true });
    await taskDialog.getByRole("textbox", { name: "Название задачи", exact: true }).fill("Изменённая задача");
    await taskDialog.getByRole("textbox", { name: "Описание задачи", exact: true }).fill("Новое условие");
    await taskDialog.getByRole("button", { name: "Сохранить задачу", exact: true }).click();
    await taskDialog.waitFor({ state: "hidden" });
    await f.page.getByRole("region", { name: "Личная задача Изменённая задача", exact: true }).waitFor();
    await f.page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const setCard = f.page.getByTestId(`preset-card-${f.preset.id}`);
    await setCard.waitFor();
    const setEdit = setCard.getByRole("button", { name: `Редактировать набор ${f.preset.name}`, exact: true });
    assert.equal((await setEdit.textContent()).trim(), "Редактировать", "set editing uses a labelled action");
    assert.equal(await setCard.getByRole("button", { name: /Редактировать/ }).count(), 1);
    await setEdit.click();
    const setDialog = f.page.getByRole("dialog", { name: "Редактировать набор", exact: true });
    const name = setDialog.getByRole("textbox", { name: "Название набора", exact: true });
    await name.fill("Изменённый набор");
    assert.equal(await setDialog.getByRole("combobox", { name: "Задачи", exact: true }).count(), 1);
    await f.page.setViewportSize({ width: 768, height: 600 });
    await visibleFooter(setDialog, "Сохранить", 600);
    await f.page.screenshot({ path: ".run/personal-set-edit-dark-768.png" });
    await setDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await setDialog.waitFor({ state: "hidden" });
    await setCard.getByText("Изменённый набор", { exact: true }).waitFor();
    await f.page.getByRole("button", { name: "Создать набор", exact: true }).click();
    const createDialog = f.page.getByRole("dialog", { name: "Создать набор", exact: true });
    await createDialog.getByRole("textbox", { name: "Название набора", exact: true }).fill("Новый набор");
    const createTasks = createDialog.getByRole("combobox", { name: "Задачи", exact: true });
    await createTasks.fill("Изменённая задача");
    await createTasks.press("Enter");
    await createDialog.getByRole("textbox", { name: "Название набора", exact: true }).click();
    await f.page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
    await visibleFooter(createDialog, "Создать", 600);
    await f.page.screenshot({ path: ".run/personal-set-create-dark-768.png" });
    await createDialog.getByRole("button", { name: "Отмена", exact: true }).click();
  } finally { await f.close(); }
});

test("personal task forms keep readable field gaps and visible actions in both themes on a short tablet", async () => {
  const f = await fixture();
  try {
    await f.page.setViewportSize({ width: 768, height: 600 });
    await f.page.getByRole("region", { name: `Личная задача ${f.task.title}`, exact: true }).getByRole("button", { name: `Редактировать задачу ${f.task.title}`, exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать задачу", exact: true });
    for (const theme of ["light", "dark"]) {
      await f.page.evaluate(value => {
        localStorage.setItem("interview-online:ui-theme", value);
        window.dispatchEvent(new StorageEvent("storage", { key: "interview-online:ui-theme", newValue: value }));
      }, theme);
      await visibleFooter(dialog, "Сохранить задачу", 600);
      const metrics = await dialog.evaluate(node => {
        const fields = Array.from(node.querySelectorAll(".ant-form-item"));
        return fields.map(field => {
          const label = field.querySelector("label").getBoundingClientRect();
          const control = (field.querySelector(".ant-select") ?? field.querySelector("input, textarea")).getBoundingClientRect();
          return { gap: control.top - label.bottom, labelFont: parseFloat(getComputedStyle(field.querySelector("label")).fontSize) };
        });
      });
      assert.ok(metrics.every(metric => metric.gap >= 7 && metric.labelFont >= 14), `labels have at least an 8px gap and readable font size: ${JSON.stringify(metrics)}`);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await f.page.screenshot({ path: `.run/personal-task-authoring-${theme}-768.png` });
    }
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  } finally { await f.close(); }
});

test("personal interview authoring starts with identity, groups tasks and keeps submit visible", async () => {
  const f = await fixture("/workspace/personal/interviews/new");
  try {
    const dialog = f.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.waitFor();
    const title = dialog.getByRole("textbox", { name: "Название интервью", exact: true });
    const tasks = dialog.getByRole("combobox", { name: "Задачи для интервью", exact: true });
    assert.ok((await title.boundingBox()).y < (await tasks.boundingBox()).y, "interview identity precedes task selection");
    await title.fill("Интервью из формы");
    await tasks.fill("Задача для формы");
    await tasks.press("Enter");
    await tasks.press("Escape");
    await title.click();
    await f.page.locator(".ant-select-dropdown:visible").waitFor({ state: "hidden" });
    await f.page.setViewportSize({ width: 768, height: 600 });
    await visibleFooter(dialog, "Создать интервью", 600);
    await f.page.screenshot({ path: ".run/personal-interview-authoring-dark-768.png" });
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await f.page.waitForURL(/\/room\//);
    const rooms = await request("/me/rooms", f.auth.token);
    const created = rooms.find(room => room.title === "Интервью из формы");
    assert.ok(created);
    await request(`/me/rooms/${created.id}`, f.auth.token, null, "DELETE");
  } finally { await f.close(); }
});
