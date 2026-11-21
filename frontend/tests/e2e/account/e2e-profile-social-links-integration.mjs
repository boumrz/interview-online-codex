import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { chromium } from "playwright";

if (process.env.E2E_PROFILE_LINK_REAL_PROVIDER !== "true") throw new Error("Use account/run-profile-social-links.mjs for the isolated HTTP provider fixture");
const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;

function showGitHubConfirmation(page, code, roomCode) {
  return page.route("https://github.com/login/oauth/authorize?*", (route) => {
    const request = new URL(route.request().url());
    const callback = new URL(request.searchParams.get("redirect_uri"));
    assert.equal(callback.origin, web);
    assert.equal(callback.pathname, "/api/auth/social/github/callback");
    assert.ok(request.searchParams.get("state"));
    assert.ok(request.searchParams.get("code_challenge"));
    if (roomCode) assert.equal(route.request().url().includes(roomCode), false);
    callback.searchParams.set("state", request.searchParams.get("state"));
    callback.searchParams.set("code", code);
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<a href="${callback.href.replaceAll("&", "&amp;")}">Подтвердить GitHub</a>` });
  });
}

test("real profile APIs bind and unlink GitHub without replacing the current session", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const registration = await context.request.post(`${api}/auth/register`, { data: {
    nickname: `realprofile${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    displayName: "Прежний профиль", password: "password123",
  } });
  assert.equal(registration.status(), 200);
  const auth = await registration.json();
  await page.goto(`${web}/login`);
  await page.evaluate((token) => localStorage.setItem("auth_token", token), auth.token);
  // Only the provider's authorization page is substituted. InterHub start,
  // proof cookie, state, callback, completion and status reads are real HTTP.
  await showGitHubConfirmation(page, "profile-test-code");
  await page.goto(`${web}/profile`);
  await page.getByRole("group", { name: "GitHub", exact: true }).getByText("Не привязан", { exact: true }).waitFor();
  const completed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/social/profile-link/complete").catch((error) => error);
  await page.getByRole("button", { name: "Подключить GitHub", exact: true }).click();
  await page.getByRole("link", { name: "Подтвердить GitHub" }).click();
  const completion = await completed;
  if (completion instanceof Error) {
    await page.screenshot({ path: "/tmp/interhub-profile-real-github-failure.png", fullPage: true });
    throw new Error(`Completion absent; pathname=${new URL(page.url()).pathname}; alerts=${await page.getByRole("alert").allTextContents()}`, { cause: completion });
  }
  assert.equal(completion.status(), 200);
  assert.deepEqual(await completion.json(), { provider: "github", linked: true });
  await page.getByRole("group", { name: "GitHub", exact: true }).getByText("Привязан", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, "");
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
  await page.reload();
  await page.getByRole("group", { name: "GitHub", exact: true }).getByText("Привязан", { exact: true }).waitFor();
  const profile = await context.request.get(`${api}/me/profile`, { headers: { Authorization: `Bearer ${auth.token}` } });
  assert.equal(profile.status(), 200);
  assert.equal((await profile.json()).id, auth.user.id);
  await page.screenshot({ path: "/tmp/interhub-profile-real-github-linked.png", fullPage: true });

  await page.getByRole("button", { name: "Отвязать GitHub", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Отвязать GitHub?", exact: true });
  const unlinked = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/social/github/unlink");
  await confirmation.getByRole("button", { name: "Отвязать", exact: true }).click();
  const unlinkResponse = await unlinked;
  assert.equal(unlinkResponse.status(), 200);
  assert.deepEqual((await unlinkResponse.json()).connections.find(({ provider }) => provider === "github"), {
    provider: "github", linked: false, available: true, canUnlink: false, requiresPassword: false,
  });
  await confirmation.waitFor({ state: "hidden" });
  await page.getByRole("group", { name: "GitHub", exact: true }).getByText("Не привязан", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), auth.token);
  await page.reload();
  await page.getByRole("button", { name: "Подключить GitHub", exact: true }).waitFor();
  const current = await context.request.get(`${api}/me/profile`, { headers: { Authorization: `Bearer ${auth.token}` } });
  assert.equal(current.status(), 200);
  assert.equal((await current.json()).id, auth.user.id);
});

test("a GitHub-only profile can set its first password and unlink without losing the account", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const nickname = `firstpassword${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  await showGitHubConfirmation(page, "unlink-password-test-code");
  await page.goto(`${web}/login`);
  await page.getByRole("button", { name: "Войти через GitHub", exact: true }).click();
  await page.getByRole("link", { name: "Подтвердить GitHub" }).click();
  await page.getByLabel("Ник", { exact: true }).fill(nickname);
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.waitForURL(`${web}/workspace/personal/interviews`);
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const profile = await context.request.get(`${api}/me/profile`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(profile.status(), 200);
  const accountId = (await profile.json()).id;

  await page.goto(`${web}/profile`);
  const detach = page.getByRole("button", { name: "Отвязать GitHub", exact: true });
  await detach.click();
  const dialog = page.getByRole("dialog", { name: "Отвязать GitHub?", exact: true });
  const password = dialog.getByLabel("Новый пароль InterHub", { exact: true });
  const confirmation = dialog.getByLabel("Повторите новый пароль", { exact: true });
  const confirm = dialog.getByRole("button", { name: "Задать пароль и отвязать", exact: true });
  await password.fill("Cancel-this-password-123");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await detach.click();
  assert.equal(await password.inputValue(), "");
  const chosen = "My-InterHub-password-123";
  await password.fill(chosen);
  await confirmation.fill("different-password");
  await confirm.click();
  await dialog.getByText("Пароли не совпадают", { exact: true }).waitFor();
  const provider = page.getByRole("group", { name: "GitHub", exact: true });
  await provider.getByText("Привязан", { exact: true }).waitFor();
  await confirmation.fill(chosen);
  const response = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/auth/social/github/unlink");
  await confirm.click();
  assert.equal((await response).status(), 200);
  await dialog.waitFor({ state: "hidden" });
  await provider.getByText("Не привязан", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("auth_token")), token);
  await page.reload();
  await page.getByRole("button", { name: "Подключить GitHub", exact: true }).waitFor();
  const login = await context.request.post(`${api}/auth/login`, { data: { nickname, password: chosen } });
  assert.equal(login.status(), 200);
  assert.equal((await login.json()).user.id, accountId);
});

test("GitHub login from the anonymous name prompt returns to the same room as a candidate", async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const response = await context.request.post(`${api}/public/rooms`, { data: {
    displayName: "Интервьюер", title: "Возврат до ввода имени", language: "nodejs",
  } });
  assert.equal(response.status(), 200);
  const room = await response.json();
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await showGitHubConfirmation(page, "room-test-code", room.inviteCode);
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.getByRole("button", { name: "Войти через аккаунт", exact: true }).click();
  await page.getByRole("button", { name: "Войти через GitHub", exact: true }).click();
  await page.getByRole("link", { name: "Подтвердить GitHub" }).click();
  await page.getByLabel("Ник", { exact: true }).fill(`room${randomUUID().replaceAll("-", "").slice(0, 12)}`);
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.waitForURL(`${web}/room/${room.inviteCode}`, { timeout: 15_000 });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  assert.equal(await page.getByRole("button", { name: "Посмотреть шаги", exact: true }).count(), 0);
  const token = await page.evaluate(() => localStorage.getItem("auth_token"));
  const currentRoom = await context.request.get(`${api}/rooms/${room.inviteCode}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(currentRoom.status(), 200);
  assert.equal((await currentRoom.json()).role, "candidate");
});
