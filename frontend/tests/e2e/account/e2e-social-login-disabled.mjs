import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const browser = await chromium.launch({ headless: true });
after(() => browser.close());

async function fixture(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const requests = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/auth/social/") || path.startsWith("/auth/")) requests.push(path);
  });
  // Even an available/configured API must not expose the postponed UI.
  await page.route("**/api/auth/social/providers", (route) => route.fulfill({ json: { providers: ["google", "vk"] } }));
  return { page, requests };
}

test("postponed integration adds no buttons, provider requests or assets to existing login", async (t) => {
  const { page, requests } = await fixture(t);
  await page.goto(`${web}/login`);
  await page.getByLabel("Ник", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByRole("button", { name: /Войти через (Google|VK)/ }).count(), 0);
  assert.deepEqual(requests, []);
  assert.equal(await page.getByLabel("Пароль", { exact: true }).isEditable(), true);
  assert.equal(await page.getByRole("button", { name: "Войти в кабинет", exact: true }).isEnabled(), true);
  await page.getByText("Регистрация", { exact: true }).click();
  await page.getByLabel("Повторите пароль", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Имя", exact: true }).getAttribute("placeholder"), null);
});

test("postponed social return opens ordinary login without social requests or errors", async (t) => {
  const { page, requests } = await fixture(t);
  await page.goto(`${web}/login/social?result=failed`);
  await page.waitForURL(`${web}/login`);
  await page.getByLabel("Ник", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.deepEqual(requests, []);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await page.getByText("Завершить регистрацию", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Войти в кабинет", exact: true }).isEnabled(), true);
});
