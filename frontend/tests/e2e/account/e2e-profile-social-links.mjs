// Real accounts and profile UI in an isolated database, with intercepted provider redirects.
// mocked external OAuth boundary; server ownership is covered by PostgreSQL tests.
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
const providerName = (provider) => provider === "google" ? "Google" : "GitHub";
const connection = (page, provider) => page.getByRole("group", { name: providerName(provider), exact: true });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function account(context) {
  const response = await context.request.post(`${api}/auth/register`, { data: {
    nickname: `profile${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    displayName: "Роман", password: "password123",
  } });
  assert.equal(response.status(), 200);
  return response.json();
}

async function fixture(t, initial = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const auth = await account(context);
  await page.goto(`${web}/login`);
  await page.evaluate((value) => localStorage.setItem("auth_token", value), auth.token);
  const states = {
    google: { linked: false, available: true, canUnlink: false },
    github: { linked: false, available: true, canUnlink: false },
    ...initial,
  };
  const read = () => ({ connections: Object.entries(states).map(([provider, value]) => ({ provider, ...value })) });
  await page.route("**/api/auth/social/connections", (route) => {
    assert.equal(route.request().headers().authorization, `Bearer ${auth.token}`);
    return json(route, read());
  });
  return { context, page, auth, states, read };
}

test("personal and team profiles show real connection states in both themes", async (t) => {
  const { context, page, auth } = await fixture(t, { google: { linked: true, available: false, canUnlink: true } });
  await page.goto(`${web}/profile`);
  await page.getByRole("heading", { name: "Способы входа", exact: true }).waitFor();
  await connection(page, "google").getByText("Привязан", { exact: true }).waitFor();
  assert.equal(await connection(page, "google").getByRole("button", { name: "Отвязать Google", exact: true }).isEnabled(), true);
  await connection(page, "google").getByText("Временно недоступен", { exact: true }).waitFor();
  await connection(page, "github").getByText("Не привязан", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Подключить GitHub", exact: true }).isEnabled(), true);
  await page.screenshot({ path: "/tmp/interhub-profile-connections-desktop.png", fullPage: true });
  const teamResponse = await context.request.post(`${api}/teams`, { headers: {
    Authorization: `Bearer ${auth.token}`, "Idempotency-Key": randomUUID(),
  }, data: { name: "Профиль команды" } });
  assert.equal(teamResponse.status(), 201);
  const team = await teamResponse.json();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(() => localStorage.setItem("interview-online:ui-theme", "dark"));
  await page.goto(`${web}/workspace/teams/${(team.team ?? team).id}/profile`);
  await page.getByRole("heading", { name: "Способы входа", exact: true }).waitFor();
  await connection(page, "google").getByText("Привязан", { exact: true }).waitFor();
  assert.equal(await connection(page, "google").getByRole("button", { name: "Отвязать Google", exact: true }).isEnabled(), true);
  await page.screenshot({ path: "/tmp/interhub-profile-connections-tablet-dark.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test("unlinking an unavailable provider requires confirmation and uses the returned statuses", async (t) => {
  const { page, auth, states, read } = await fixture(t, { google: { linked: true, available: false, canUnlink: true } });
  let requests = 0;
  const entered = deferred();
  const held = deferred();
  await page.route("**/api/auth/social/google/unlink", async (route) => {
    requests++;
    assert.equal(route.request().method(), "POST");
    assert.equal(route.request().headers().authorization, `Bearer ${auth.token}`);
    assert.equal(route.request().headers().origin, new URL(web).origin);
    assert.deepEqual(route.request().postDataJSON(), {});
    entered.resolve();
    await held.promise;
    states.google = { linked: false, available: false, canUnlink: false };
    states.github = { linked: true, available: true, canUnlink: true };
    return json(route, read());
  });
  await page.goto(`${web}/profile`);
  const unlink = connection(page, "google").getByRole("button", { name: "Отвязать Google", exact: true });
  const dialog = page.getByRole("dialog", { name: "Отвязать Google?", exact: true });
  await unlink.click();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Отвязать Google");
  assert.equal(requests, 0);
  await unlink.click();
  await dialog.getByRole("button", { name: "Отвязать", exact: true }).click();
  await entered.promise;
  assert.equal(await dialog.getByRole("button", { name: "Отмена", exact: true }).isDisabled(), true);
  held.resolve();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Способы входа");
  await connection(page, "google").getByText("Не привязан", { exact: true }).waitFor();
  await connection(page, "github").getByRole("button", { name: "Отвязать GitHub", exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "Google отвязан" }).waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
  await page.reload();
  await connection(page, "google").getByText("Не привязан", { exact: true }).waitFor();
});

test("unlink can retry a temporary failure and refreshes eligibility if the last method became protected", async (t) => {
  const { page, states } = await fixture(t, { google: { linked: true, available: true, canUnlink: true } });
  let requests = 0;
  await page.route("**/api/auth/social/google/unlink", (route) => {
    if (++requests === 1) return json(route, { error: "Недоступен" }, 503);
    states.google.canUnlink = false;
    return json(route, { code: "SOCIAL_LAST_SIGN_IN_METHOD", error: "Последний способ входа" }, 409);
  });
  await page.goto(`${web}/profile`);
  const google = connection(page, "google");
  const unlink = google.getByRole("button", { name: "Отвязать Google", exact: true });
  const dialog = page.getByRole("dialog", { name: "Отвязать Google?", exact: true });
  await unlink.click();
  const confirm = dialog.getByRole("button", { name: "Отвязать", exact: true });
  await confirm.click();
  await dialog.getByRole("alert").filter({ hasText: "Ошибка сервера" }).waitFor();
  await confirm.click().catch(async (error) => {
    const dialogs = await page.getByRole("dialog").allTextContents();
    throw new Error(`Confirmation after transient failure: requests=${requests}, dialogs=${JSON.stringify(dialogs)}`, { cause: error });
  });
  await dialog.waitFor({ state: "hidden" });
  await google.getByText("Привязан", { exact: true }).waitFor();
  await google.getByText(/Подключите другой способ входа/).waitFor();
  assert.equal(await unlink.count(), 0);
  assert.equal(requests, 2);
});

test("connection conflicts explain which profile must remove the existing link", async (t) => {
  const { page } = await fixture(t);
  await page.route("**/api/auth/social/profile-link/complete", (route) => json(route, {
    code: "SOCIAL_IDENTITY_CONFLICT", error: "Этот аккаунт провайдера уже привязан. Повторите вход",
  }, 409));
  await page.goto(`${web}/profile?social_link=ready`);
  await page.getByRole("alert").filter({ hasText: /другому профилю InterHub/ }).getByText(/отвяжите его в том профиле/i).waitFor();
  assert.equal(await page.getByRole("button", { name: "Повторить привязку", exact: true }).count(), 0);
});

test("a password already set in another session requires a new confirmation without password fields", async (t) => {
  const { page, states } = await fixture(t, { google: { linked: true, available: true, canUnlink: false, requiresPassword: true } });
  let requests = 0;
  await page.route("**/api/auth/social/google/unlink", async (route) => {
    if (++requests === 1) {
      assert.deepEqual(route.request().postDataJSON(), { newPassword: "Passphrase-123" });
      states.google = { linked: true, available: true, canUnlink: true, requiresPassword: false };
      return json(route, { code: "SOCIAL_PASSWORD_ALREADY_SET", error: "Пароль InterHub уже установлен" }, 409);
    }
    assert.deepEqual(route.request().postDataJSON(), {});
    states.google = { linked: false, available: true, canUnlink: false, requiresPassword: false };
    return json(route, { connections: Object.entries(states).map(([provider, state]) => ({ provider, ...state })) });
  });
  await page.goto(`${web}/profile`);
  const detach = connection(page, "google").getByRole("button", { name: "Отвязать Google", exact: true });
  const dialog = page.getByRole("dialog", { name: "Отвязать Google?", exact: true });
  await detach.click();
  await dialog.getByLabel("Новый пароль InterHub", { exact: true }).fill("Passphrase-123");
  await dialog.getByLabel("Повторите новый пароль", { exact: true }).fill("Passphrase-123");
  await dialog.getByRole("button", { name: "Задать пароль и отвязать", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("alert").filter({ hasText: "Пароль InterHub уже установлен" }).waitFor();
  await detach.click();
  assert.equal(await dialog.getByLabel("Новый пароль InterHub", { exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "Отвязать", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await connection(page, "google").getByText("Не привязан", { exact: true }).waitFor();
  assert.equal(requests, 2);
});

test("status loading and failures never claim the providers are unlinked", async (t) => {
  const { page, read } = await fixture(t);
  const held = deferred();
  let requests = 0;
  await page.unroute("**/api/auth/social/connections");
  await page.route("**/api/auth/social/connections", async (route) => {
    if (++requests === 1) { await held.promise; return json(route, { error: "Ошибка" }, 503); }
    return json(route, read());
  });
  await page.goto(`${web}/profile`);
  await page.getByText("Загружаем способы входа…", { exact: true }).waitFor();
  assert.equal(await page.getByText("Не привязан", { exact: true }).count(), 0);
  held.resolve();
  await page.getByRole("alert").filter({ hasText: "Ошибка сервера" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Подключить/ }).count(), 0);
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await page.getByRole("button", { name: "Подключить Google", exact: true }).waitFor();
});

test("both providers connect from profile while preserving the current account and session", async (t) => {
  const { page, auth, states } = await fixture(t);
  let selected;
  let completions = 0;
  for (const provider of ["google", "github"]) {
    const url = provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://github.com/login/oauth/authorize";
    await page.route(`**/api/auth/social/${provider}/profile-link/start`, (route) => {
      assert.equal(route.request().method(), "POST");
      assert.equal(route.request().headers().authorization, `Bearer ${auth.token}`);
      assert.equal(route.request().headers().origin, new URL(web).origin);
      selected = provider;
      return json(route, { authorizationUrl: `${url}?state=test-only-state` });
    });
    await page.route(`${url}?*`, (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body:
      `<a href="${web}/profile?social_link=ready">Подтвердить подключение</a>` }));
  }
  await page.route("**/api/auth/social/profile-link/complete", (route) => {
    assert.equal(route.request().headers().authorization, `Bearer ${auth.token}`);
    assert.equal(route.request().headers().origin, new URL(web).origin);
    completions++;
    states[selected].linked = true;
    return json(route, { provider: selected, linked: true });
  });
  await page.goto(`${web}/profile`);
  for (const provider of ["google", "github"]) {
    await page.getByRole("button", { name: `Подключить ${providerName(provider)}`, exact: true }).click();
    try {
      await page.getByRole("link", { name: "Подтвердить подключение" }).click();
    } catch (error) {
      await page.screenshot({ path: "/tmp/interhub-profile-provider-start-failure.png", fullPage: true });
      throw new Error(`Provider ${provider} did not open; pathname=${new URL(page.url()).pathname}; alerts=${await page.getByRole("alert").allTextContents()}`, { cause: error });
    }
    await connection(page, provider).getByText("Привязан", { exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: `${providerName(provider)} привязан` }).waitFor();
    assert.equal(new URL(page.url()).search, "");
    assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
    await page.reload();
    await connection(page, provider).getByText("Привязан", { exact: true }).waitFor();
  }
  assert.equal(completions, 2);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes("test-only-state")), false);
});

test("cancelled, failed and invented result markers do not report a successful connection", async (t) => {
  const { page, auth } = await fixture(t);
  let completions = 0;
  await page.route("**/api/auth/social/profile-link/complete", (route) => { completions++; return json(route, {}, 400); });
  for (const marker of ["cancelled", "failed", "success"]) {
    await page.goto(`${web}/profile?social_link=${marker}`);
    await page.getByRole("button", { name: "Подключить Google", exact: true }).waitFor();
    if (marker === "cancelled") await page.getByRole("status").filter({ hasText: "Подключение отменено" }).waitFor();
    if (marker === "failed") await page.getByRole("alert").filter({ hasText: "Не удалось подтвердить аккаунт" }).waitFor();
    assert.equal(new URL(page.url()).search, "");
    assert.equal(await page.getByText("Привязан", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
  }
  assert.equal(completions, 0);
});

test("failed completion can be retried without changing the local session", async (t) => {
  const { page, auth, states } = await fixture(t);
  let completions = 0;
  await page.route("**/api/auth/social/profile-link/complete", (route) => {
    if (++completions === 1) return json(route, { error: "Недоступен" }, 503);
    states.google.linked = true;
    return json(route, { provider: "google", linked: true });
  });
  await page.goto(`${web}/profile?social_link=ready`);
  await page.getByRole("alert").filter({ hasText: "Ошибка сервера" }).waitFor();
  await page.getByRole("button", { name: "Повторить привязку", exact: true }).click();
  await connection(page, "google").getByText("Привязан", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
  assert.equal(completions, 2);
});

test("account changes abort pending starts and ignore late completion and unlink replies", async (t) => {
  const { context, page, auth, states, read } = await fixture(t);
  const other = await account(context);
  for (const action of ["start", "complete", "unlink"]) {
    const held = deferred();
    const entered = deferred();
    const finished = deferred();
    const path = action === "start" ? "google/profile-link/start" : action === "complete" ? "profile-link/complete" : "google/unlink";
    if (action === "unlink") states.google = { linked: true, available: true, canUnlink: true };
    await page.route(`**/api/auth/social/${path}`, async (route) => {
      entered.resolve();
      await held.promise;
      if (action === "unlink") states.google = { linked: false, available: true, canUnlink: false };
      const response = action === "start" ? { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=late" }
        : action === "complete" ? { provider: "google", linked: true } : read();
      await json(route, response).catch(() => {});
      finished.resolve();
    });
    await page.evaluate((token) => localStorage.setItem("auth_token", token), auth.token);
    await page.goto(`${web}/profile${action === "complete" ? "?social_link=ready" : ""}`);
    if (action === "start") await page.getByRole("button", { name: "Подключить Google", exact: true }).click();
    if (action === "unlink") {
      await page.getByRole("button", { name: "Отвязать Google", exact: true }).click();
      await page.getByRole("dialog", { name: "Отвязать Google?", exact: true }).getByRole("button", { name: "Отвязать", exact: true }).click();
    }
    await entered.promise;
    await page.evaluate((token) => {
      const oldValue = localStorage.getItem("auth_token");
      localStorage.setItem("auth_token", token);
      dispatchEvent(new StorageEvent("storage", { key: "auth_token", oldValue, newValue: token }));
    }, other.token);
    held.resolve();
    await finished.promise;
    await page.getByRole("alert").filter({ hasText: "Сессия изменилась" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/profile");
    assert.equal(await page.getByText("Привязан", { exact: true }).count(), 0);
    assert.equal(await page.getByText(/Google отвязан/).count(), 0);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), other.token);
    await page.unroute(`**/api/auth/social/${path}`);
  }
});

test("logout while completion is pending cannot restore the previous session", async (t) => {
  const { page } = await fixture(t);
  const held = deferred();
  const entered = deferred();
  const finished = deferred();
  await page.route("**/api/auth/social/profile-link/complete", async (route) => {
    entered.resolve();
    await held.promise;
    await json(route, { provider: "google", linked: true }).catch(() => {});
    finished.resolve();
  });
  await page.goto(`${web}/profile?social_link=ready`);
  await entered.promise;
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(`${web}/`);
  held.resolve();
  await finished.promise;
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), null);
  assert.equal(await page.getByRole("heading", { name: "Способы входа", exact: true }).count(), 0);
  assert.equal(await page.getByText("Google привязан. Можно использовать его для входа.", { exact: true }).count(), 0);
});
