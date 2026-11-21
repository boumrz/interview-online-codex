import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  return { page, requests };
}

test("ordinary builds discover configured providers from the API", async (t) => {
  const { page } = await fixture(t);
  await page.route("**/api/auth/social/providers", (route) =>
    route.fulfill({ json: { providers: ["google", "github", "vk"] } }));
  await page.goto(`${web}/login`);
  await page.getByRole("button", { name: "Войти через Google", exact: true }).waitFor();
  await page.getByRole("button", { name: "Войти через GitHub", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Войти через VK", exact: true }).count(), 0);
});

test("without OAuth credentials ordinary password sign-in and sign-up remain available", async (t) => {
  const { page, requests } = await fixture(t);
  await page.goto(`${web}/login`);
  await page.getByLabel("Ник", { exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByRole("button", { name: /Войти через (Google|GitHub|VK)/ }).count(), 0);
  assert.deepEqual(requests.filter((request) => request.startsWith("/api/")), ["/api/auth/social/providers"]);
  assert.equal(requests.some((request) => request.endsWith(".woff2") || request.endsWith(".png")), false);
  assert.equal(await page.getByLabel("Пароль", { exact: true }).isEditable(), true);
  assert.equal(await page.getByRole("button", { name: "Войти в кабинет", exact: true }).isEnabled(), true);
  await page.getByText("Регистрация", { exact: true }).click();
  await page.getByLabel("Повторите пароль", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Имя", exact: true }).getAttribute("placeholder"), null);
});

test("a failed OAuth callback keeps ordinary sign-in reachable", async (t) => {
  const { page } = await fixture(t);
  await page.goto(`${web}/login/social?result=failed`);
  await page.getByText("Не удалось выполнить вход. Попробуйте ещё раз.", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Начать вход заново", exact: true }).click();
  await page.getByLabel("Ник", { exact: true }).waitFor();
});

test("a password account without configured providers has no empty profile card", async (t) => {
  const { page, requests } = await fixture(t);
  const response = await page.request.post(`${process.env.E2E_API_URL}/auth/register`, { data: {
    nickname: `disabled${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    displayName: "Профиль", password: "password123",
  } });
  assert.equal(response.status(), 200);
  const auth = await response.json();
  await page.goto(`${web}/login`);
  await page.evaluate((token) => localStorage.setItem("auth_token", token), auth.token);
  await page.goto(`${web}/profile`);
  await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByRole("heading", { name: "Способы входа", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^Подключить (Google|GitHub)$/ }).count(), 0);
  assert.ok(requests.includes("/api/auth/social/connections"));
  assert.equal(requests.includes("/api/auth/social/profile-link/complete"), false);
});
