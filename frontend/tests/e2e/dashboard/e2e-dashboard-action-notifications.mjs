import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function account(isHr = false, displayName = "Проверка уведомлений") {
  const response = await fetch(`${api}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `notice_${unique()}`, displayName, password: "test-password-123", isHr }),
  });
  assert.equal(response.status, 200, "Synthetic account registration succeeds");
  return response.json();
}

async function openLegacy(browser, auth) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ token }) => localStorage.setItem("auth_token", token), auth);
  // Personal legacy routes redirect; the existing administrative route still
  // owns the dashboard. A controlled display-role fixture exposes that screen
  // for this UI check; profile saves use the real isolated account API.
  await context.route("**/api/me/profile", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), role: "admin" } });
  });
  await context.route("**/api/admin/users", route => route.fulfill({ json: [] }));
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${web}/dashboard/admin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).waitFor();
  await page.getByRole("button", { name: "Изменить имя", exact: true }).waitFor();
  assert.equal(await page.locator(".ant-notification-notice-success").count(), 0, "Loading a screen is not an action result");
  return { context, page };
}

async function assertSingleTopSuccess(page, text) {
  await page.getByText(text, { exact: true }).waitFor();
  const visibleResult = page.getByRole("status").filter({ hasText: text });
  assert.equal(await page.locator(".ant-notification-notice-success").count(), 1,
    "A completed action uses one existing Ant Design success popup");
  assert.equal(await page.locator(".ant-notification-top .ant-notification-notice-success").count(), 1,
    "The shared success popup is placed at the top");
  assert.equal(await visibleResult.count(), 1, "The result has one polite accessible announcement");
}

async function closeBrowser(browser) {
  for (const context of browser.contexts()) await context.unrouteAll({ behavior: "ignoreErrors" });
  await browser.close();
}

test("legacy profile save announces one top popup only after confirmation and returns focus", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const release = Promise.withResolvers();
  try {
    const auth = await account();
    const { page, context } = await openLegacy(browser, auth);
    const started = Promise.withResolvers();
    await page.route("**/api/me/profile", async route => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const response = await route.fetch();
      started.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    const trigger = page.getByRole("button", { name: "Изменить имя", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Изменить имя", exact: true });
    await dialog.getByLabel("Имя для отображения", { exact: true }).fill(`Сохранённое имя ${unique()}`);
    await dialog.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await started.promise;
    assert.equal(await page.getByText("Имя сохранено", { exact: true }).count(), 0,
      "A pending profile request cannot announce success");
    release.resolve();
    await assertSingleTopSuccess(page, "Имя сохранено");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Изменить имя");
    assert.equal(await page.locator(".ant-alert-success").count(), 0, "The custom dashboard success stack is absent");
  } finally {
    release.resolve();
    await closeBrowser(browser);
  }
});

test("legacy hiring capability callback has one popup and no saved label in the profile", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const auth = await account();
    const { page, context } = await openLegacy(browser, auth);
    await page.getByRole("switch", { name: "Я участвую в найме", exact: true }).click();
    await assertSingleTopSuccess(page, "Функции нанимающего включены");
    assert.equal(await page.getByText("Сохранено", { exact: true }).count(), 0,
      "The profile does not duplicate its caller's confirmed success");
  } finally {
    await closeBrowser(browser);
  }
});

test("a legacy profile response cannot announce success after navigation unmounts its owner", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const release = Promise.withResolvers();
  try {
    const auth = await account();
    const { page, context } = await openLegacy(browser, auth);
    const started = Promise.withResolvers();
    const finished = Promise.withResolvers();
    await page.route("**/api/me/profile", async route => {
      if (route.request().method() !== "PATCH") return route.fallback();
      const response = await route.fetch();
      started.resolve();
      await release.promise;
      await route.fulfill({ response });
      finished.resolve();
    });
    await page.getByRole("button", { name: "Изменить имя", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Изменить имя", exact: true });
    await dialog.getByLabel("Имя для отображения", { exact: true }).fill(`Позднее имя ${unique()}`);
    await dialog.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await started.promise;
    // A same-document navigation keeps the global notification context alive
    // while replacing the dashboard component that owns this request.
    await page.evaluate(() => {
      history.pushState({}, "", "/workspace/personal/interviews");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.getByRole("button", { name: "Создать интервью", exact: true }).waitFor();
    release.resolve();
    await finished.promise;
    await page.waitForTimeout(250);
    assert.equal(await page.getByText("Имя сохранено", { exact: true }).count(), 0,
      "A late response from an unmounted screen cannot revive its action notice");
  } finally {
    release.resolve();
    await closeBrowser(browser);
  }
});
