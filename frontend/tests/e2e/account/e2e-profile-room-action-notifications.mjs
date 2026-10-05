import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
let browser;

async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      "Idempotency-Key": randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}

async function account(isHr = false) {
  return request("/auth/register", {
    method: "POST",
    body: {
      nickname: `action_notice_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      displayName: `Проверка уведомлений ${randomUUID().slice(0, 8)}`,
      password: "test-password-123",
      isHr,
    },
  });
}

async function openAccount(auth, path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((authValue) => {
    if (localStorage.getItem("action_notice_seeded")) return;
    localStorage.setItem("auth_token", authValue.token);
    localStorage.setItem("auth_user", JSON.stringify(authValue.user));
    localStorage.setItem("display_name", authValue.user.displayName);
    localStorage.setItem("action_notice_seeded", "true");
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  return { context, page };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// The real API processes the request, while its confirmed response remains
// withheld from the UI. This distinguishes pending UI from server success.
async function holdConfirmedResponse(page, pattern, method) {
  const started = deferred();
  const release = deferred();
  const delivered = deferred();
  let held = false;
  const handler = async (route) => {
    if (route.request().method() !== method) return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200, "Held action must succeed on the real API");
    held = true;
    started.resolve();
    await release.promise;
    try { await route.fulfill({ response }); } finally { delivered.resolve(); }
  };
  await page.route(pattern, handler);
  return {
    started: started.promise,
    async release() { release.resolve(); await delivered.promise; await page.unroute(pattern, handler); },
    async close() { release.resolve(); if (held) await delivered.promise; await page.unroute(pattern, handler); },
  };
}

async function rejectAction(page, pattern, method) {
  const handler = (route) => route.request().method() === method
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временная ошибка проверки" }) })
    : route.continue();
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function noSuccess(page, message) {
  await settle(page);
  assert.equal(await page.getByText(message, { exact: true }).count(), 0, "Pending, error and read-only loads must not announce success");
}

async function topSuccess(page, message, inlineScope) {
  const notice = page.locator(".ant-notification-notice").filter({ has: page.getByText(message, { exact: true }) });
  await notice.waitFor();
  assert.equal(await notice.count(), 1, "One confirmed action must produce exactly one popup");
  assert.equal(await page.getByText(message, { exact: true }).count(), 1, "Success must have no duplicate elsewhere on the page");
  assert.equal(await page.getByRole("status").filter({ hasText: message }).count(), 1, "Success uses a polite status announcement");
  assert.equal(await inlineScope.getByText(message, { exact: true }).count(), 0, "Inline result must be removed");
  const bounds = await notice.boundingBox();
  assert.ok(bounds && bounds.y < 130, `Success notification must be at the top: ${JSON.stringify(bounds)}`);
  assert.equal(await notice.evaluate((element) => element.contains(document.activeElement)), false, "Popup must not steal focus");
}

async function dismissSuccess(page, message) {
  const notice = page.locator(".ant-notification-notice").filter({ has: page.getByText(message, { exact: true }) });
  await notice.locator(".ant-notification-notice-close").click();
  await notice.waitFor({ state: "hidden" });
}

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test("AC-18 team room metadata and hiring assignment show one top result only after confirmation; failed save preserves draft and retry", { timeout: 90_000 }, async () => {
  const owner = await account();
  const hiring = await account(true);
  const { team } = await request("/teams", { token: owner.token, method: "POST", body: { name: "Команда результатов действий" } });
  const { interview: room } = await request(`/teams/${team.id}/interviews`, { token: owner.token, method: "POST", body: { title: "Проверка результатов действий", selectedTaskIds: [] } });
  const { context, page } = await openAccount(owner, `/room/${room.inviteCode}`);
  let gate;
  try {
    await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ timeout: 20_000 });
    const trigger = page.getByRole("button", { name: "Кандидат и нанимающие", exact: true });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    const name = panel.getByLabel("Имя кандидата", { exact: true });
    await name.waitFor();
    await noSuccess(page, "Сведения сохранены");
    const candidateName = `Сохранённый кандидат ${randomUUID().slice(0, 8)}`;
    await name.fill(candidateName);
    gate = await holdConfirmedResponse(page, `**/api/rooms/${room.inviteCode}/interview-metadata`, "PUT");
    await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
    await gate.started;
    assert.equal(await panel.getByRole("button", { name: "Сохраняем…", exact: true }).isDisabled(), true);
    await noSuccess(page, "Сведения сохранены");
    await gate.release(); gate = null;
    await topSuccess(page, "Сведения сохранены", panel);
    assert.equal((await request(`/rooms/${room.inviteCode}/interview-metadata`, { token: owner.token })).candidateName, candidateName);
    await dismissSuccess(page, "Сведения сохранены");

    const removeRejection = await rejectAction(page, `**/api/rooms/${room.inviteCode}/interview-metadata`, "PUT");
    const retryName = `Черновик повторной попытки ${randomUUID().slice(0, 8)}`;
    await name.fill(retryName);
    await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: "Ошибка сервера. Повторите попытку позже." }).waitFor();
    assert.equal(await name.inputValue(), retryName);
    await noSuccess(page, "Сведения сохранены");
    await removeRejection();
    await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
    await topSuccess(page, "Сведения сохранены", panel);
    await dismissSuccess(page, "Сведения сохранены");

    const picker = panel.getByRole("combobox", { name: "Нанимающий", exact: true });
    await picker.fill(hiring.user.nickname);
    await page.getByRole("option", { name: hiring.user.displayName, exact: true }).waitFor({ state: "attached" });
    gate = await holdConfirmedResponse(page, `**/api/rooms/${room.inviteCode}/hr-managers/${hiring.user.id}`, "PUT");
    await picker.press("ArrowDown"); await picker.press("Enter");
    await gate.started;
    await noSuccess(page, "Нанимающий добавлен");
    await gate.release(); gate = null;
    await topSuccess(page, "Нанимающий добавлен", panel);
    assert.ok((await request(`/rooms/${room.inviteCode}/hr-managers`, { token: owner.token })).some((person) => person.userId === hiring.user.id));
    await panel.getByRole("button", { name: "Закрыть", exact: true }).filter({ hasText: "Закрыть" }).click();
    await panel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Кандидат и нанимающие");
    await page.reload({ waitUntil: "domcontentloaded" });
    await trigger.waitFor();
    await noSuccess(page, "Сведения сохранены");
    await noSuccess(page, "Нанимающий добавлен");
  } finally { await gate?.close(); await context.close(); }
});

test("AC-18 profile name and hiring capability confirm once at the top while pending and retry stay local", { timeout: 90_000 }, async () => {
  const auth = await account();
  const { context, page } = await openAccount(auth, "/profile");
  let gate;
  try {
    const trigger = page.getByRole("button", { name: "Изменить имя", exact: true });
    await trigger.click();
    const modal = page.getByRole("dialog", { name: "Изменить имя", exact: true });
    const changedName = `Новое имя ${randomUUID().slice(0, 8)}`;
    await modal.getByLabel("Имя для отображения", { exact: true }).fill(changedName);
    gate = await holdConfirmedResponse(page, "**/api/me/profile", "PATCH");
    await modal.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await gate.started;
    assert.equal(await modal.getByLabel("Имя для отображения", { exact: true }).isDisabled(), true);
    await noSuccess(page, "Имя сохранено");
    await gate.release(); gate = null;
    await modal.waitFor({ state: "hidden" });
    await topSuccess(page, "Имя сохранено", page.getByRole("main"));
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Изменить имя");
    await dismissSuccess(page, "Имя сохранено");
    assert.equal((await request("/me/profile", { token: auth.token })).displayName, changedName);

    const capability = page.getByRole("switch", { name: "Я участвую в найме", exact: true });
    const removeRejection = await rejectAction(page, "**/api/me/profile", "PATCH");
    await capability.click();
    await page.getByRole("alert").filter({ hasText: /Не удалось сохранить/ }).waitFor();
    assert.equal(await capability.isChecked(), false);
    await noSuccess(page, "Сохранено");
    await removeRejection();
    gate = await holdConfirmedResponse(page, "**/api/me/profile", "PATCH");
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await gate.started;
    await page.getByRole("status").filter({ hasText: "Сохраняем…" }).waitFor();
    assert.equal(await capability.isDisabled(), true);
    await noSuccess(page, "Сохранено");
    await gate.release(); gate = null;
    await topSuccess(page, "Сохранено", page.getByRole("main"));
    assert.equal(await capability.isChecked(), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await capability.waitFor();
    await noSuccess(page, "Сохранено");
    await noSuccess(page, "Имя сохранено");
  } finally { await gate?.close(); await context.close(); }
});

test("AC-18 a confirmed profile response for a replaced account never creates a global success popup", { timeout: 60_000 }, async () => {
  const auth = await account();
  const replacement = await account();
  const { context, page } = await openAccount(auth, "/profile");
  let gate;
  try {
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Изменить имя", exact: true });
    await modal.getByLabel("Имя для отображения", { exact: true }).fill("Позднее имя другого аккаунта");
    gate = await holdConfirmedResponse(page, "**/api/me/profile", "PATCH");
    await modal.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await gate.started;
    await page.evaluate((token) => localStorage.setItem("auth_token", token), replacement.token);
    await gate.release(); gate = null;
    await modal.getByRole("button", { name: "Сохранить имя", exact: true }).waitFor();
    await noSuccess(page, "Имя сохранено");
    assert.equal(await modal.isVisible(), true);
  } finally { await gate?.close(); await context.close(); }
});

test("AC-18 leaving profile expires a late same-account name save and its global success", { timeout: 60_000 }, async () => {
  const auth = await account();
  const { context, page } = await openAccount(auth, "/workspace/personal/interviews");
  let gate;
  try {
    await page.getByRole("link", { name: `Открыть профиль @${auth.user.nickname}`, exact: true }).click();
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Изменить имя", exact: true });
    await modal.getByLabel("Имя для отображения", { exact: true }).fill(`Позднее имя ${randomUUID().slice(0, 8)}`);
    gate = await holdConfirmedResponse(page, "**/api/me/profile", "PATCH");
    await modal.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await gate.started;
    await page.goBack();
    await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
    assert.equal(await modal.count(), 0, "Browser back must unmount the profile surface");
    await gate.release(); gate = null;
    await noSuccess(page, "Имя сохранено");
  } finally { await gate?.close(); await context.close(); }
});

test("AC-18 explicit task import preserves failed draft then confirms once after the real API response", { timeout: 90_000 }, async () => {
  const auth = await account();
  const { context, page } = await openAccount(auth, "/workspace/personal/library");
  let gate;
  try {
    await page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Импортировать задачу", exact: true });
    const draft = JSON.stringify({ format: "interview-online-library", version: 1, kind: "task", task: {
      title: `Импорт ${randomUUID().slice(0, 8)}`, description: "Проверка результата импорта", starterCode: "return 42", language: "nodejs",
    } });
    const field = modal.getByRole("textbox");
    await field.fill(draft);
    const removeRejection = await rejectAction(page, "**/api/me/tasks", "POST");
    await modal.getByRole("button", { name: "Импортировать задачу", exact: true }).click();
    await modal.getByText("Не удалось импортировать задачу. Проверьте данные и доступ к библиотеке.", { exact: true }).waitFor();
    assert.equal(await field.inputValue(), draft);
    await noSuccess(page, "Задача импортирована");
    await removeRejection();
    gate = await holdConfirmedResponse(page, "**/api/me/tasks", "POST");
    await modal.getByRole("button", { name: "Импортировать задачу", exact: true }).click();
    await gate.started;
    assert.match(await modal.getByRole("button", { name: "Импортировать задачу", exact: true }).getAttribute("class"), /ant-btn-loading/);
    await noSuccess(page, "Задача импортирована");
    await gate.release(); gate = null;
    await modal.waitFor({ state: "hidden" });
    await topSuccess(page, "Задача импортирована", page.getByRole("main"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Импортировать", exact: true }).waitFor();
    await noSuccess(page, "Задача импортирована");
  } finally { await gate?.close(); await context.close(); }
});

test("AC-18 leaving the task import screen expires its late global success", { timeout: 60_000 }, async () => {
  const auth = await account();
  const { context, page } = await openAccount(auth, "/profile");
  let gate;
  try {
    await page.getByRole("button", { name: "Изменить имя", exact: true }).waitFor();
    await page.getByRole("link", { name: "Библиотека", exact: true }).click();
    await page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Импортировать задачу", exact: true });
    await modal.getByRole("textbox").fill(JSON.stringify({ format: "interview-online-library", version: 1, kind: "task", task: {
      title: `Поздний импорт ${randomUUID().slice(0, 8)}`, description: "Запрос переживает уход со страницы", starterCode: "return 1", language: "nodejs",
    } }));
    gate = await holdConfirmedResponse(page, "**/api/me/tasks", "POST");
    await modal.getByRole("button", { name: "Импортировать задачу", exact: true }).click();
    await gate.started;
    await page.goBack();
    await page.getByRole("button", { name: "Изменить имя", exact: true }).waitFor();
    await gate.release(); gate = null;
    await noSuccess(page, "Задача импортирована");
  } finally { await gate?.close(); await context.close(); }
});

test("AC-18 real Excel download keeps pending and retry local and reports one top success", { timeout: 90_000 }, async () => {
  const auth = await account(true);
  const { context, page } = await openAccount(auth, "/workspace/personal/candidates");
  let gate;
  try {
    const button = page.getByRole("button", { name: "Скачать Excel", exact: true });
    await button.waitFor();
    await noSuccess(page, "Excel скачан: интервью нет");
    const removeRejection = await rejectAction(page, "**/api/me/hr/rooms/export", "GET");
    await button.click();
    await page.getByRole("alert").filter({ hasText: "Не удалось скачать Excel" }).waitFor();
    await noSuccess(page, "Excel скачан: интервью нет");
    await removeRejection();
    gate = await holdConfirmedResponse(page, "**/api/me/hr/rooms/export", "GET");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Повторить скачивание", exact: true }).click();
    await gate.started;
    assert.equal(await page.getByRole("button", { name: "Готовим Excel…", exact: true }).isDisabled(), true);
    await noSuccess(page, "Excel скачан: интервью нет");
    await gate.release(); gate = null;
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.xlsx$/);
    assert.equal(await download.failure(), null);
    await topSuccess(page, "Excel скачан: интервью нет", page.getByRole("main"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await button.waitFor();
    await noSuccess(page, "Excel скачан: интервью нет");
  } finally { await gate?.close(); await context.close(); }
});
