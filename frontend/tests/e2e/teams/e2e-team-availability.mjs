import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
for (const [name, value, userPort] of [["WEB", web, "5173"], ["API", api, "8080"]]) {
  const url = value ? new URL(value) : null;
  if (!url || url.hostname !== "127.0.0.1" || !url.port || url.port === userPort) {
    throw new Error(`TEAM_AVAILABILITY_ISOLATED_${name}_REQUIRED`);
  }
}
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function request(path, { token, method = "GET", body, expectedStatus = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expectedStatus, `${method} ${path} unexpected status`);
  return response.json();
}

async function account(nickname = `avail_${randomUUID().replaceAll("-", "").slice(0, 20)}`) {
  return request("/auth/register", {
    method: "POST",
    body: { nickname, displayName: "Проверка доступности", password: "test-password-123" },
  });
}

async function createTeam(auth) {
  const result = await request("/teams", {
    token: auth.token, method: "POST", expectedStatus: 201,
    body: { name: `Команда ${randomUUID().slice(0, 8)}` },
  });
  return result.team;
}

async function openAccount(auth, path, { viewport, beforeOpen } = {}) {
  const context = await browser.newContext({ viewport: viewport ?? { width: 1440, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
  }, auth);
  if (beforeOpen) await beforeOpen(context);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  return { context, page };
}

test("teams are available in a normal production build: select and create from personal", async () => {
  const auth = await account();
  const { context, page } = await openAccount(auth, "/workspace/personal/interviews");
  try {
    await page.getByRole("button", { name: "Команды: Личное. Сменить команду", exact: true }).click();
    await page.getByRole("menuitem", { name: "Создать команду", exact: true }).click();
    const name = `Создана из меню ${randomUUID().slice(0, 8)}`;
    await page.getByRole("textbox", { name: "Название команды", exact: true }).fill(name);
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/teams" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Создать команду", exact: true }).click();
    assert.equal((await created).status(), 201);
    await page.getByRole("button", { name: `Команды: ${name}. Сменить команду`, exact: true }).waitFor();
    assert.match(new URL(page.url()).pathname, /^\/workspace\/teams\/[^/]+\/interviews$/);
  } finally { await context.close(); }
});

test("teams are available in a normal production build: direct route survives reload", async () => {
  const auth = await account();
  const team = await createTeam(auth);
  const path = `/workspace/teams/${team.id}/interviews`;
  const { context, page } = await openAccount(auth, path);
  try {
    await page.getByRole("button", { name: `Команды: ${team.name}. Сменить команду`, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, path);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: `Команды: ${team.name}. Сменить команду`, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, path);
  } finally { await context.close(); }
});

test("teams are available in a normal production build: invitation preview and acceptance", async () => {
  const owner = await account();
  const team = await createTeam(owner);
  const invitee = await account();
  const created = await request(`/teams/${team.id}/invitations`, {
    token: owner.token, method: "POST", body: {}, expectedStatus: 201,
  });
  const link = await request(`/teams/${team.id}/invitations/${created.invitation.id}/link`, { token: owner.token });
  const url = new URL(link.url, web);
  const { context, page } = await openAccount(invitee, `${url.pathname}${url.hash}`);
  try {
    await page.getByRole("heading", { name: team.name, exact: true }).waitFor();
    await page.getByRole("button", { name: "Принять приглашение", exact: true }).click();
    await page.getByRole("button", { name: `Команды: ${team.name}. Сменить команду`, exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/workspace/teams/${team.id}/interviews`);
  } finally { await context.close(); }
});

async function openAdminLink(page) {
  const direct = page.getByRole("link", { name: "Админка", exact: true });
  if (await direct.isVisible()) return direct;
  const menu = page.getByRole("button", { name: /^Меню разделов/ });
  assert.ok(await menu.isVisible(), "ADMIN_NAVIGATION_LINK_MISSING");
  await menu.click();
  await page.getByRole("menuitem", { name: "Админка", exact: true }).waitFor();
  return direct;
}

test("global admin can reach existing user administration from personal and team navigation", async () => {
  const admin = await account("boumrz");
  assert.equal(admin.user.role, "admin");
  const team = await createTeam(admin);
  for (const [path, width] of [
    ["/workspace/personal/interviews", 1440], ["/workspace/personal/interviews", 390],
    [`/workspace/teams/${team.id}/interviews`, 1440], [`/workspace/teams/${team.id}/interviews`, 390],
  ]) {
    const { context, page } = await openAccount(admin, path, { viewport: { width, height: 900 } });
    try {
      // The fresh server profile must be published before the admin item exists.
      await page.getByRole("link", { name: `Открыть профиль @${admin.user.nickname}`, exact: true }).waitFor();
      const link = await openAdminLink(page);
      await link.waitFor();
      assert.equal(await link.getAttribute("href"), "/dashboard/admin");
      await link.click();
      await page.getByRole("heading", { name: "Админка пользователей", exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/dashboard/admin");
    } finally { await context.close(); }
  }
});

test("cached admin role and team ownership do not grant global admin navigation or access", async () => {
  const auth = await account();
  const team = await createTeam(auth);
  let releaseProfile;
  let profileStarted;
  const started = new Promise((resolve) => { profileStarted = resolve; });
  const held = new Promise((resolve) => { releaseProfile = resolve; });
  const { context, page } = await openAccount({ ...auth, user: { ...auth.user, role: "admin" } }, `/workspace/teams/${team.id}/interviews`, {
    beforeOpen: async (context) => context.route("**/api/me/profile", async (route) => {
      profileStarted();
      await held;
      await route.continue();
    }),
  });
  try {
    await started;
    assert.equal(await page.getByRole("link", { name: "Админка", exact: true }).count(), 0);
    assert.equal(await page.getByRole("menuitem", { name: "Админка", exact: true }).count(), 0);
    releaseProfile();
    await page.getByRole("link", { name: `Открыть профиль @${auth.user.nickname}`, exact: true }).waitFor();
    const menu = page.getByRole("button", { name: /^Меню разделов/ });
    if (await menu.isVisible()) await menu.click();
    assert.equal(await page.getByRole("link", { name: "Админка", exact: true }).count(), 0);
    assert.equal(await page.getByRole("menuitem", { name: "Админка", exact: true }).count(), 0);
    const denied = await fetch(`${api}/admin/users`, { headers: { Authorization: `Bearer ${auth.token}` } });
    assert.equal(denied.status, 403);
    await page.goto(`${web}/dashboard/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${web}/workspace/personal/interviews`);
    assert.equal(await page.getByRole("link", { name: "Админка", exact: true }).count(), 0);
  } finally { releaseProfile(); await context.close(); }
});
