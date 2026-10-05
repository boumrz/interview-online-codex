import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const password = "hydration-password-123";
let browser;

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function account() {
  const nickname = `hydrate_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const response = await fetch(`${api}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, displayName: nickname, password }),
  });
  assert.equal(response.status, 200, "account fixture registration succeeds");
  const auth = await response.json();
  assert.ok(auth.token && auth.user?.id, "account fixture has a session and identity");
  return { nickname, password, auth };
}

async function view() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const counters = { login: 0, register: 0 };
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.endsWith("/auth/login")) counters.login += 1;
    if (request.method() === "POST" && path.endsWith("/auth/register")) counters.register += 1;
  });
  return { context, page, counters };
}

async function fill(page, credentials, mode = "login") {
  await page.goto(`${web}/login?next=/workspace/personal/library`);
  if (mode === "register") {
    await page.getByText("Регистрация", { exact: true }).click();
    await page.getByRole("textbox", { name: "Имя", exact: true }).fill(credentials.nickname);
  }
  await page.getByRole("textbox", { name: "Ник", exact: true }).fill(credentials.nickname);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  if (mode === "register") await page.getByLabel("Повторите пароль", { exact: true }).fill(credentials.password);
}

function holdFirstProfile(page, { status = 200, expectedId, freshDisplayName } = {}) {
  let release;
  let reached;
  let finished;
  let failure;
  let held = false;
  let finishedFlag = false;
  const released = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { reached = resolve; });
  const done = new Promise(resolve => { finished = resolve; });
  const handler = async route => {
    if (held) return route.continue();
    held = true;
    try {
      // The upstream response is real, authenticated, and complete before the UI barrier.
      const authorization = route.request().headers().authorization;
      assert.ok(authorization?.startsWith("Bearer "), "profile uses the issued authorization");
      if (freshDisplayName) {
        const updated = await fetch(`${api}/me/profile`, {
          method: "PATCH", headers: { Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: freshDisplayName }),
        });
        assert.equal(updated.status, 200, "profile changes on the server after the credentials response");
      }
      const response = await route.fetch();
      assert.equal(response.status(), 200, "held profile has a real successful upstream response");
      const profile = await response.json();
      if (expectedId) assert.ok(profile.id === expectedId, "held profile belongs to the expected account");
      reached();
      await released;
      await route.fulfill(status === 200
        ? { response }
        : { status, contentType: "application/json", body: JSON.stringify({ error: "Профиль временно недоступен. Повторите вход." }) });
    } catch (error) {
      failure = error;
      reached();
    } finally {
      finishedFlag = true;
      finished();
    }
  };
  const installed = page.route("**/api/me/profile", handler);
  return {
    ready: async () => {
      await installed;
      let timer;
      try {
        await Promise.race([ready, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("fresh profile request did not reach the real-response barrier")), 10000);
        })]);
        if (failure) throw failure;
      } finally { clearTimeout(timer); }
    },
    release: async () => { release(); await done; if (failure) throw failure; },
    close: async () => { release(); if (held && !finishedFlag) await done; await page.unrouteAll({ behavior: "wait" }); },
  };
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertUnpublished(page) {
  const state = await page.evaluate(() => ({
    pathname: location.pathname,
    hasToken: Boolean(localStorage.getItem("auth_token")),
    hasUser: Boolean(localStorage.getItem("auth_user")),
  }));
  assert.deepEqual(state, { pathname: "/login", hasToken: false, hasUser: false }, "profile-confirmation barrier prevents navigation and session publication");
}

async function assertSession(page, expectedId, expectedDisplayName) {
  await page.waitForURL(/\/workspace\/personal\/library$/, { timeout: 15000 });
  await page.locator('[data-testid="task-bank-panel"]').waitFor({ timeout: 15000 });
  assert.ok(await page.evaluate(id => JSON.parse(localStorage.getItem("auth_user") || "null")?.id === id, expectedId), "published profile is the confirmed account");
  if (expectedDisplayName) {
    assert.ok(await page.evaluate(name => JSON.parse(localStorage.getItem("auth_user") || "null")?.displayName === name, expectedDisplayName), "published fields come from the fresh GET, not the stale credentials response");
    await page.getByRole("link", { name: /^Открыть профиль @/ }).click();
    await page.getByText(expectedDisplayName, { exact: true }).first().waitFor();
    await page.goBack();
    await page.locator('[data-testid="task-bank-panel"]').waitFor();
  }
  await page.reload();
  await page.locator('[data-testid="task-bank-panel"]').waitFor({ timeout: 15000 });
  assert.ok(await page.evaluate(id => Boolean(localStorage.getItem("auth_token")) && JSON.parse(localStorage.getItem("auth_user") || "null")?.id === id, expectedId), "reload retains the confirmed session");
}

for (const mode of ["login", "register"]) {
  test(`${mode}: held fresh profile withholds navigation and publication, blocks duplicate native submits, then survives reload`, async () => {
    const credentials = await account();
    if (mode === "register") credentials.nickname = `new_${credentials.nickname}`.slice(0, 32);
    const { context, page, counters } = await view();
    let gate;
    let issuedId;
    let credentialsDisplayName;
    const freshDisplayName = `Fresh confirmed ${mode}`;
    page.on("response", async response => {
      if (new URL(response.url()).pathname.endsWith(`/auth/${mode}`) && response.status() === 200) {
        const payload = await response.json();
        issuedId = payload.user.id;
        credentialsDisplayName = payload.user.displayName;
      }
    });
    try {
      await fill(page, credentials, mode);
      gate = holdFirstProfile(page, { expectedId: mode === "login" ? credentials.auth.user.id : undefined, freshDisplayName });
      await page.getByLabel("Пароль", { exact: true }).press("Enter");
      await gate.ready();
      await settle(page);
      await assertUnpublished(page);
      const submit = page.locator('form button[type="submit"]');
      assert.equal(await submit.isDisabled(), true, "full authentication pipeline remains disabled");
      assert.equal(await submit.getAttribute("aria-busy"), "true", "profile hydration remains visibly busy");
      assert.equal(await page.getByRole("textbox", { name: "Ник", exact: true }).isDisabled(), true);
      assert.equal(await page.getByLabel("Пароль", { exact: true }).isDisabled(), true);
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await settle(page);
      assert.equal(counters[mode], 1, "repeated native submits cannot start another credentials request");
      await gate.release();
      assert.ok(issuedId, "successful credentials response provided an account identity");
      assert.ok(credentialsDisplayName !== freshDisplayName, "the credentials response contains the older server profile");
      await assertSession(page, issuedId, freshDisplayName);
    } finally { await gate?.close(); await context.close(); }
  });
}

for (const [mode, status] of [["login", 401], ["login", 503], ["register", 503]]) {
  test(`${mode}: profile ${status} preserves draft and permits an explicit fresh-profile retry`, async () => {
    const credentials = await account();
    if (mode === "register") credentials.nickname = `retry_${credentials.nickname}`.slice(0, 32);
    const { context, page, counters } = await view();
    let gate;
    let issuedId;
    page.on("response", async response => {
      if (new URL(response.url()).pathname.endsWith(`/auth/${mode}`) && response.status() === 200) issuedId = (await response.json()).user.id;
    });
    try {
      await fill(page, credentials, mode);
      gate = holdFirstProfile(page, { status });
      await page.getByLabel("Пароль", { exact: true }).press("Enter");
      await gate.ready();
      await gate.release();
      await page.getByRole("alert").filter({ hasText: status >= 500 ? "Ошибка сервера" : "Профиль временно недоступен" }).waitFor();
      await assertUnpublished(page);
      assert.equal(await page.getByRole("textbox", { name: "Ник", exact: true }).inputValue(), credentials.nickname);
      assert.ok(await page.getByLabel("Пароль", { exact: true }).inputValue() === credentials.password, "password draft remains in the form");
      await page.getByRole("button", { name: "Повторить", exact: true }).click();
      await assertSession(page, issuedId);
      assert.equal(counters[mode], 1, "profile retry reuses the issued session without duplicating credentials or registration");
    } finally { await gate?.close(); await context.close(); }
  });
}

test("internal unmount invalidates a held login attempt; late profile cannot restore it", async () => {
  const credentials = await account();
  const { context, page } = await view();
  let gate;
  try {
    await fill(page, credentials);
    gate = holdFirstProfile(page, { expectedId: credentials.auth.user.id });
    await page.getByLabel("Пароль", { exact: true }).press("Enter");
    await gate.ready();
    await page.getByRole("link", { name: "На главную страницу", exact: true }).click();
    await page.waitForURL(`${web}/`);
    await gate.release();
    await settle(page);
    assert.equal(new URL(page.url()).pathname, "/", "late result cannot navigate back into a workspace");
    assert.equal(await page.evaluate(() => Boolean(localStorage.getItem("auth_token"))), false, "late result cannot publish the cancelled session");
  } finally { await gate?.close(); await context.close(); }
});

for (const status of [200, 503]) {
  test(`late profile ${status} cannot replace or clear another account stored in the current document`, async () => {
    const accountA = await account();
    const accountB = await account();
    const { context, page } = await view();
    let gate;
    try {
      await fill(page, accountA);
      gate = holdFirstProfile(page, { status, expectedId: accountA.auth.user.id });
      await page.getByLabel("Пароль", { exact: true }).press("Enter");
      await gate.ready();
      await page.evaluate(auth => {
        localStorage.setItem("auth_token", auth.token);
        localStorage.setItem("auth_user", JSON.stringify(auth.user));
      }, accountB.auth);
      await gate.release();
      await settle(page);
      assert.ok(await page.evaluate(auth => localStorage.getItem("auth_token") === auth.token && JSON.parse(localStorage.getItem("auth_user") || "null")?.id === auth.user.id, accountB.auth), "late result leaves the newer account intact");
      await page.goto(`${web}/workspace/personal/library`);
      await assertSession(page, accountB.auth.user.id);
    } finally { await gate?.close(); await context.close(); }
  });
}

test("pagehide and reload invalidate a held old login without clearing the new document's account", async () => {
  const accountA = await account();
  const accountB = await account();
  const { context, page } = await view();
  let gate;
  try {
    await fill(page, accountA);
    gate = holdFirstProfile(page, { expectedId: accountA.auth.user.id });
    await page.getByLabel("Пароль", { exact: true }).press("Enter");
    await gate.ready();
    await page.evaluate(auth => {
      localStorage.setItem("auth_token", auth.token);
      localStorage.setItem("auth_user", JSON.stringify(auth.user));
    }, accountB.auth);
    await page.goto(`${web}/workspace/personal/library`);
    await gate.release();
    await assertSession(page, accountB.auth.user.id);
  } finally { await gate?.close(); await context.close(); }
});

test("a newer real SPA login replaces the old attempt; its late failure cannot clear Redux or stored account B", async () => {
  const accountA = await account();
  const accountB = await account();
  const { context, page, counters } = await view();
  let gate;
  try {
    await fill(page, accountA);
    gate = holdFirstProfile(page, { status: 503, expectedId: accountA.auth.user.id });
    await page.getByLabel("Пароль", { exact: true }).press("Enter");
    await gate.ready();
    await page.getByRole("link", { name: "На главную страницу", exact: true }).click();
    await page.waitForURL(`${web}/`);
    await page.getByRole("link", { name: "Личный кабинет", exact: true }).click();
    await page.getByRole("textbox", { name: "Ник", exact: true }).fill(accountB.nickname);
    await page.getByLabel("Пароль", { exact: true }).fill(accountB.password);
    await page.getByLabel("Пароль", { exact: true }).press("Enter");
    await page.waitForURL(/\/workspace\/personal\/interviews$/);
    const identityLink = page.getByRole("link", { name: `Открыть профиль @${accountB.nickname}`, exact: true });
    await identityLink.waitFor();
    await gate.release();
    await settle(page);
    assert.equal(counters.login, 2, "two deliberate login attempts were made");
    assert.equal(new URL(page.url()).pathname, "/workspace/personal/interviews", "late account A cannot navigate the confirmed account B away");
    assert.ok(await page.evaluate(id => Boolean(localStorage.getItem("auth_token")) && JSON.parse(localStorage.getItem("auth_user") || "null")?.id === id, accountB.auth.user.id), "late A cannot clear account B's stored session");
    await identityLink.waitFor();
    await page.reload();
    await identityLink.waitFor();
    assert.equal(new URL(page.url()).pathname, "/workspace/personal/interviews", "Redux-backed protected route and reload retain B");
  } finally { await gate?.close(); await context.close(); }
});
