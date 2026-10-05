// Prepared integration suite: run with FEATURE_SOCIAL_AUTH_ENABLED=true.
// The default dormant UI has its own e2e-social-login-disabled.mjs suite.
import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const browser = await chromium.launch({ headless: true });
after(() => browser.close());
const json = (route, data, status = 200) => route.fulfill({ status, json: data });
async function fixture(t, providers = ["google", "vk"]) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.route("**/api/auth/social/providers", (route) => json(route, { providers }));
  return { context, page };
}
async function account(context) {
  const response = await context.request.post(`${api}/auth/register`, { data: {
    nickname: `social${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    displayName: "Пользователь", password: "password123",
  } });
  assert.equal(response.status(), 200);
  return response.json();
}
async function pending(page, extra = {}) {
  await page.route("**/api/auth/social/pending", (route) => json(route, {
    provider: "google", displayName: "Анна", accountExists: false, ...extra,
  }));
}

test("configured Google/VK buttons coexist with local login; disabled providers are absent", async (t) => {
  const { page } = await fixture(t);
  await page.goto(`${web}/login`);
  await page.getByRole("button", { name: "Войти через Google", exact: true }).waitFor();
  await page.getByRole("button", { name: "Войти через VK ID", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Ник", { exact: true }).isEditable(), true);
  assert.equal(await page.getByLabel("Пароль", { exact: true }).isEditable(), true);
  await page.unroute("**/api/auth/social/providers");
  await page.route("**/api/auth/social/providers", (route) => json(route, { providers: [] }));
  await page.reload();
  await page.getByLabel("Ник", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Войти через/ }).count(), 0);
});

test("start network failure is readable and retry redirects to selected provider", async (t) => {
  const { page } = await fixture(t);
  const requests = [];
  await page.route("**/api/auth/social/google/start", async (route) => {
    requests.push(route.request());
    if (requests.length === 1) return route.abort("internetdisconnected");
    return json(route, { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=fake-state" });
  });
  await page.route("https://accounts.google.com/o/oauth2/v2/auth?*", (route) => route.fulfill({
    contentType: "text/html", body: "<p>Google mock sign in</p>",
  }));
  await page.goto(`${web}/login`);
  await page.getByRole("button", { name: "Войти через Google" }).click();
  await page.getByRole("alert").filter({ hasText: "Ошибка сети. Проверьте подключение и повторите попытку." }).waitFor();
  await page.getByRole("button", { name: "Войти через Google" }).click();
  await page.waitForURL("https://accounts.google.com/**");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers().origin, new URL(web).origin);
  assert.equal(requests[1].headers().authorization, undefined);
});

test("unexpected provider redirect cannot navigate away", async (t) => {
  const { page } = await fixture(t);
  await page.route("**/api/auth/social/vk/start", (route) => json(route, {
    authorizationUrl: "https://id.vk.ru.evil.example/authorize?access_token=secret",
  }));
  await page.goto(`${web}/login`);
  await page.getByRole("button", { name: "Войти через VK ID" }).click();
  await page.getByRole("alert").filter({ hasText: "Не удалось начать вход. Попробуйте ещё раз." }).waitFor();
  assert.equal(page.url(), `${web}/login`);
});

test("leaving a pending provider start cancels it and restores the form on return", async (t) => {
  const { page } = await fixture(t);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/auth/social/google/start", async (route) => {
    await held;
    await json(route, { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=stale" }).catch(() => {});
  });
  await page.goto(`${web}/login`);
  const requested = page.waitForRequest("**/api/auth/social/google/start");
  await page.getByRole("button", { name: "Войти через Google" }).click();
  await requested;
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  release();
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Войти в кабинет"]')?.disabled);
  assert.equal(await page.getByRole("button", { name: "Войти через Google" }).isEnabled(), true);
  assert.equal(page.url(), `${web}/login`);
});

test("first social registration validates nickname, preserves conflict draft and hydrates real profile", async (t) => {
  const { page, context } = await fixture(t);
  const auth = await account(context);
  const completions = [];
  await pending(page);
  await page.route("**/api/auth/social/complete", async (route) => {
    completions.push(route.request().postDataJSON());
    return completions.length === 1
      ? json(route, { error: "Ник уже занят", code: "NICKNAME_TAKEN" }, 409)
      : json(route, auth);
  });
  await page.goto(`${web}/login/social`);
  await page.getByLabel("Ник", { exact: true }).fill("кириллица");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Ник может содержать только латинские буквы, цифры и символы" }).waitFor();
  assert.equal(completions.length, 0);
  await page.getByLabel("Ник", { exact: true }).fill(auth.user.nickname);
  await page.getByLabel("Имя", { exact: true }).fill("Анна Иванова");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Ник уже занят" }).waitFor();
  assert.equal(await page.getByLabel("Имя", { exact: true }).inputValue(), "Анна Иванова");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.waitForURL(/\/workspace\/personal\/interviews$/);
  assert.deepEqual(completions[1], { nickname: auth.user.nickname, displayName: "Анна Иванова", isHr: false });
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("auth_user")).id), auth.user.id);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("fake-state")), false);
});

test("explicit existing account link checks password and retains form for correction", async (t) => {
  const { page, context } = await fixture(t);
  const auth = await account(context);
  const links = [];
  await pending(page, { provider: "vk" });
  await page.route("**/api/auth/social/link", (route) => {
    links.push(route.request().postDataJSON());
    return links.length === 1 ? json(route, { error: "Неверный ник или пароль" }, 401) : json(route, auth);
  });
  await page.goto(`${web}/login/social`);
  await page.getByRole("button", { name: "У меня есть аккаунт", exact: true }).click();
  await page.getByLabel("Ник", { exact: true }).fill(auth.user.nickname);
  await page.getByLabel("Пароль", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Привязать и войти", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Неверный ник или пароль" }).waitFor();
  assert.equal(await page.getByLabel("Ник", { exact: true }).inputValue(), auth.user.nickname);
  await page.getByLabel("Пароль", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Привязать и войти", exact: true }).click();
  await page.waitForURL(/\/workspace\/personal\/interviews$/);
  assert.deepEqual(links[1], { nickname: auth.user.nickname, password: "password123" });
  assert.equal(await page.evaluate(() => JSON.stringify(sessionStorage).includes("password123")), false);
});

test("known identity hydrates before storing token; retry does not repeat completion", async (t) => {
  const { page, context } = await fixture(t);
  const auth = await account(context);
  let completed = 0;
  let profiles = 0;
  await pending(page, { accountExists: true });
  await page.route("**/api/auth/social/complete", (route) => {
    completed++;
    return json(route, auth);
  });
  await page.route("**/api/me/profile", async (route) => {
    profiles++;
    if (profiles === 1) return route.abort("internetdisconnected");
    return route.continue();
  });
  await page.goto(`${web}/login/social`);
  await page.getByRole("alert").filter({ hasText: "Ошибка сети. Проверьте подключение и повторите попытку." }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), null);
  assert.equal(await page.evaluate((token) => JSON.stringify(sessionStorage).includes(token), auth.token), false);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.waitForURL(/\/workspace\/personal\/interviews$/);
  assert.equal(completed, 1);
  assert.ok(profiles >= 2);
});

test("profile retry losing its session restarts login without repeating a consumed completion", async (t) => {
  const { page, context } = await fixture(t);
  const auth = await account(context);
  let completed = 0;
  let profiles = 0;
  await pending(page, { accountExists: true });
  await page.route("**/api/auth/social/complete", (route) => { completed++; return json(route, auth); });
  await page.route("**/api/me/profile", (route) => {
    profiles++;
    return profiles === 1 ? route.abort("internetdisconnected") : json(route, { error: "Недействительный токен авторизации" }, 401);
  });
  await page.goto(`${web}/login/social`);
  await page.getByRole("button", { name: "Повторить", exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Ошибка сети" }).waitFor();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Сессия недействительна. Начните вход заново." }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Повторить", exact: true }).count(), 0);
  assert.equal(completed, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), null);
  await page.getByRole("link", { name: "Начать вход заново", exact: true }).click();
  await page.getByLabel("Ник", { exact: true }).waitFor();
});

test("cancellation and expired attempt offer a clean return to login", async (t) => {
  const { page } = await fixture(t);
  let requests = 0;
  await page.route("**/api/auth/social/pending", (route) => {
    requests++;
    return json(route, { error: "Время входа истекло. Начните вход заново.", code: "SOCIAL_AUTH_EXPIRED" }, 401);
  });
  await page.goto(`${web}/login/social?result=cancelled`);
  await page.getByRole("alert").filter({ hasText: "Вход отменён" }).waitFor();
  assert.equal(requests, 0);
  await page.getByRole("link", { name: "Начать вход заново", exact: true }).click();
  await page.getByLabel("Ник", { exact: true }).waitFor();
  await page.goto(`${web}/login/social`);
  await page.getByRole("alert").filter({ hasText: "Время входа истекло" }).waitFor();
  await page.getByRole("link", { name: "Начать вход заново", exact: true }).waitFor();
});

test("a delayed completion cannot replace an account selected in another tab", async (t) => {
  const { page, context } = await fixture(t);
  const stale = await account(context);
  const fresh = await account(context);
  await pending(page);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/auth/social/complete", async (route) => {
    await held;
    return json(route, stale);
  });
  await page.goto(`${web}/login/social`);
  await page.getByLabel("Ник", { exact: true }).fill(stale.user.nickname);
  const requested = page.waitForRequest("**/api/auth/social/complete");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await requested;
  await page.evaluate((token) => localStorage.setItem("auth_token", token), fresh.token);
  release();
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), fresh.token);
  assert.equal(page.url(), `${web}/login/social`);
});

test("interrupted completion restores a usable restart and never stores its late session", async (t) => {
  const { page, context } = await fixture(t);
  const auth = await account(context);
  await pending(page);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/auth/social/complete", async (route) => {
    await held;
    await json(route, auth).catch(() => {});
  });
  await page.goto(`${web}/login/social`);
  await page.getByLabel("Ник", { exact: true }).fill(auth.user.nickname);
  const requested = page.waitForRequest("**/api/auth/social/complete");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await requested;
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  release();
  await page.getByRole("alert").filter({ hasText: "Вход прерван. Начните вход заново." }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), null);
  await page.getByRole("link", { name: "Начать вход заново", exact: true }).click();
  await page.getByLabel("Ник", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Войти в кабинет", exact: true }).isEnabled(), true);
});

test("a hidden pending identity request cannot start authentication after its cancellation", async (t) => {
  const { page } = await fixture(t);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let completions = 0;
  await page.route("**/api/auth/social/pending", async (route) => {
    await held;
    await json(route, { provider: "google", displayName: "Анна", accountExists: true }).catch(() => {});
  });
  await page.route("**/api/auth/social/complete", (route) => { completions++; return route.abort(); });
  const requested = page.waitForRequest("**/api/auth/social/pending");
  await page.goto(`${web}/login/social`);
  await requested;
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  release();
  await page.getByRole("alert").filter({ hasText: "Вход прерван. Начните вход заново." }).waitFor();
  assert.equal(completions, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), null);
});
