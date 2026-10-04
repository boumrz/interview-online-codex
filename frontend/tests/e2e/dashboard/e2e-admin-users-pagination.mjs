import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
for (const [name, value, userPort] of [["WEB", web, "5173"], ["API", api, "8080"]]) {
  const url = value ? new URL(value) : null;
  if (!url || url.hostname !== "127.0.0.1" || !url.port || url.port === userPort) {
    throw new Error(`ADMIN_PAGINATION_ISOLATED_${name}_REQUIRED`);
  }
}
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture() {
  const response = await fetch(`${api}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: `admin_page_${randomUUID().slice(0, 12)}`, displayName: "Проверка страниц", password: "test-password-123" }),
  });
  assert.equal(response.status, 200);
  const auth = await response.json();
  const own = { ...auth.user, role: "admin", createdAt: "2026-01-01T12:00:00Z", isSystemAdmin: false };
  const users = Array.from({ length: 9000 }, (_, index) => index === 0 ? own : {
    id: `synthetic-admin-user-${index}`,
    nickname: `admin_fixture_${String(index).padStart(5, "0")}`,
    role: index === 2 ? "admin" : "user",
    createdAt: "2026-01-01T12:00:00Z", isSystemAdmin: index === 2,
  });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
  }, { token: auth.token, user: own });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const renderErrors = [];
  page.on("pageerror", (error) => renderErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Maximum update depth|Too many re-renders/.test(message.text())) renderErrors.push(message.text());
  });
  let unrelatedRequests = 0;
  await page.route("**/api/me/profile", (route) => route.fulfill({ json: own }));
  await page.route("**/api/me/rooms", (route) => { unrelatedRequests += 1; return route.fulfill({ json: [] }); });
  await page.route("**/api/me/tasks", (route) => { unrelatedRequests += 1; return route.fulfill({ json: [] }); });
  return { context, page, own, users, renderErrors, unrelatedRequests: () => unrelatedRequests };
}

async function assertResponsive(page) {
  const timeout = delay(3_000).then(() => { throw new Error("ADMIN_BROWSER_FRAME_DID_NOT_RESPOND"); });
  assert.equal(await Promise.race([page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true)))), timeout]), true);
}

test("9000 users keep rendered controls bounded while all pages, role drafts, deletion and search work", { timeout: 60_000 }, async () => {
  const view = await fixture();
  let users = view.users;
  let savedRole;
  let deletedUserId;
  await view.page.route("**/api/admin/users", (route) => route.fulfill({ json: users }));
  await view.page.route("**/api/admin/users/*/role", async (route) => {
    const userId = new URL(route.request().url()).pathname.split("/").at(-2);
    savedRole = { userId, ...route.request().postDataJSON() };
    users = users.map((user) => user.id === userId ? { ...user, role: savedRole.role } : user);
    await route.fulfill({ json: users.find((user) => user.id === userId) });
  });
  await view.page.route("**/api/admin/users/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deletedUserId = new URL(route.request().url()).pathname.split("/").at(-1);
    users = users.filter((user) => user.id !== deletedUserId);
    await route.fulfill({ json: { status: "ok" } });
  });
  try {
    const loaded = view.page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/users");
    await view.page.goto(`${web}/dashboard/admin`, { waitUntil: "domcontentloaded" });
    await loaded;
    await view.page.getByRole("heading", { name: "Админка пользователей", exact: true }).waitFor();
    const controls = view.page.getByRole("combobox", { name: "Роль", exact: true });
    await controls.first().waitFor();
    const count = await controls.count();
    assert.ok(count > 0 && count <= 25, `ADMIN_RENDERED_ROLE_CONTROLS_MUST_BE_BOUNDED: ${count}`);
    await assertResponsive(view.page);
    assert.equal(view.unrelatedRequests(), 0, "ADMIN_ROUTE_MUST_NOT_LOAD_UNRELATED_INTERVIEWS_OR_TASKS");
    assert.equal(await view.page.getByRole("button", { name: `Удалить пользователя @${view.own.nickname}`, exact: true }).isDisabled(), true);
    assert.equal(await view.page.getByRole("button", { name: "Удалить пользователя @admin_fixture_00002", exact: true }).isDisabled(), true);
    const firstEditable = view.page.getByRole("region", { name: "Пользователь @admin_fixture_00001", exact: true });
    await firstEditable.getByRole("combobox", { name: "Роль", exact: true }).locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").click();
    await view.page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: "Администратор" }).first().click();
    const search = view.page.getByRole("textbox", { name: "Поиск пользователей", exact: true });
    await search.fill("admin_fixture_00025");
    await view.page.getByRole("region", { name: "Пользователь @admin_fixture_00025", exact: true }).waitFor();
    await search.fill("admin_fixture_00001");
    await firstEditable.waitFor();
    assert.equal(await firstEditable.getByRole("button", { name: "Сохранить роль", exact: true }).isEnabled(), true, "ROLE_DRAFT_MUST_SURVIVE_SEARCH_CHANGES");
    await search.clear();
    const pagination = view.page.getByRole("navigation", { name: "Пагинация пользователей", exact: true });
    await pagination.getByTitle("2", { exact: true }).click();
    await view.page.getByRole("region", { name: "Пользователь @admin_fixture_00025", exact: true }).waitFor();
    await pagination.getByTitle("1", { exact: true }).click();
    assert.equal(await firstEditable.getByRole("button", { name: "Сохранить роль", exact: true }).isEnabled(), true, "ROLE_DRAFT_MUST_SURVIVE_PAGE_CHANGES");
    const saved = view.page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/role") && response.request().method() === "PATCH");
    await firstEditable.getByRole("button", { name: "Сохранить роль", exact: true }).click();
    await saved;
    await firstEditable.getByText("Администратор", { exact: true }).first().waitFor();
    assert.deepEqual(savedRole, { userId: "synthetic-admin-user-1", role: "admin" });
    await pagination.getByTitle("360", { exact: true }).click();
    const lastUser = view.page.getByRole("region", { name: "Пользователь @admin_fixture_08999", exact: true });
    await lastUser.waitFor();
    await lastUser.getByRole("button", { name: "Удалить пользователя @admin_fixture_08999", exact: true }).click();
    await view.page.getByRole("dialog", { name: "Удалить пользователя?", exact: true }).getByRole("button", { name: "Удалить", exact: true }).click();
    await lastUser.waitFor({ state: "hidden" });
    assert.equal(deletedUserId, "synthetic-admin-user-8999");
    assert.ok(await controls.count() <= 25);
    await search.fill("ADMIN_FIXTURE_08998");
    await view.page.getByRole("region", { name: "Пользователь @admin_fixture_08998", exact: true }).waitFor();
    assert.equal(await controls.count(), 1);
    await search.fill("missing-synthetic-user");
    await view.page.getByText("По этому никнейму пользователи не найдены", { exact: true }).waitFor();
    assert.equal(await controls.count(), 0);
    await search.clear();
    await pagination.getByTitle("360", { exact: true }).click();
    users = [view.own];
    await view.page.getByRole("button", { name: "Обновить", exact: true }).click();
    await view.page.getByRole("button", { name: `Удалить пользователя @${view.own.nickname}`, exact: true }).waitFor();
    assert.equal(await controls.count(), 1, "SHRUNK_LIST_MUST_CLAMP_TO_A_NONEMPTY_PAGE");
    users = [];
    await view.page.getByRole("button", { name: "Обновить", exact: true }).click();
    await view.page.getByText("Пользователи пока не найдены", { exact: true }).waitFor();
    assert.equal(await controls.count(), 0);
    assert.equal(await view.page.getByRole("alert").count(), 0, "SUCCESSFUL_EMPTY_LIST_MUST_NOT_BE_A_FAILURE");
    await assertResponsive(view.page);
    assert.deepEqual(view.renderErrors, []);
  } finally { await view.context.close(); }
});

test("delayed and failed admin users load keeps the browser responsive and offers retry", { timeout: 45_000 }, async () => {
  const view = await fixture();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let releaseRetry;
  const heldRetry = new Promise((resolve) => { releaseRetry = resolve; });
  let fail = true;
  await view.page.route("**/api/admin/users", async (route) => {
    if (fail) { await held; return route.fulfill({ status: 503, json: { error: "Synthetic failure" } }); }
    await heldRetry;
    return route.fulfill({ json: view.users });
  });
  try {
    await view.page.goto(`${web}/dashboard/admin`, { waitUntil: "domcontentloaded" });
    await view.page.getByRole("status", { name: "Загружаем пользователей", exact: true }).waitFor();
    assert.equal(await view.page.getByText("Пользователи пока не найдены", { exact: true }).count(), 0);
    await assertResponsive(view.page);
    await delay(250);
    assert.deepEqual(view.renderErrors, [], "PENDING_DATA_MUST_NOT_CAUSE_A_RENDER_LOOP");
    release();
    await view.page.getByRole("alert").filter({ hasText: "Не удалось загрузить пользователей" }).waitFor();
    await assertResponsive(view.page);
    fail = false;
    await view.page.getByRole("button", { name: "Повторить", exact: true }).click();
    await view.page.getByText("Обновляем пользователей…", { exact: true }).waitFor();
    assert.equal(await view.page.getByText("Пользователи пока не найдены", { exact: true }).count(), 0, "PENDING_RETRY_MUST_NOT_CLAIM_THE_LIST_IS_EMPTY");
    await assertResponsive(view.page);
    releaseRetry();
    await view.page.getByRole("region", { name: `Пользователь @${view.own.nickname}`, exact: true }).waitFor();
    assert.equal(await view.page.getByRole("combobox", { name: "Роль", exact: true }).count(), 25);
    assert.deepEqual(view.renderErrors, []);
  } finally { release(); releaseRetry(); await view.context.close(); }
});

test("admin uses the workspace header and compact responsive rows in both themes", { timeout: 60_000 }, async () => {
  const view = await fixture();
  await view.page.route("**/api/admin/users", (route) => route.fulfill({ json: view.users }));
  await view.page.route("**/api/me/workspaces*", (route) => route.fulfill({ json: [] }));
  try {
    await view.page.goto(`${web}/dashboard/admin`, { waitUntil: "domcontentloaded" });
    await view.page.getByRole("heading", { name: "Админка пользователей", exact: true }).waitFor();
    const header = view.page.getByRole("banner");
    await header.getByRole("button", { name: "Команды: Личное. Сменить команду", exact: true }).waitFor();
    await header.getByRole("link", { name: `Открыть профиль @${view.own.nickname}`, exact: true }).waitFor();
    assert.equal(await header.getByRole("button", { name: "Выйти", exact: true }).isVisible(), true);
    const main = view.page.getByRole("main", { name: "Администрирование пользователей", exact: true });
    await main.waitFor();
    await mkdir("/tmp/interhub-admin-modern-screenshots", { recursive: true });
    for (const width of [1366, 390]) {
      await view.page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        const toggle = header.getByRole("button", { name: "Тёмная тема", exact: true });
        if ((await toggle.getAttribute("aria-pressed")) !== String(theme === "dark")) await toggle.click();
        await view.page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
        await assertResponsive(view.page);
        const rows = main.getByRole("region", { name: /^Пользователь @/ });
        assert.equal(await rows.count(), 25);
        const bounds = await rows.first().boundingBox();
        assert.ok(bounds.height <= (width > 640 ? 90 : 170), `USER_ROW_MUST_BE_COMPACT: ${width}px / ${bounds.height}px`);
        const overflow = await view.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        assert.equal(overflow, false, `${width}/${theme}: no horizontal overflow`);
        const controls = rows.first().getByRole("combobox", { name: "Роль", exact: true });
        assert.equal(await controls.isVisible(), true);
        for (const control of [header.getByRole("button", { name: "Команды: Личное. Сменить команду", exact: true }), header.getByRole("button", { name: "Выйти", exact: true }), toggle]) {
          const box = await control.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${width}/${theme}: header controls stay within the viewport`);
        }
        assert.equal(await header.getByRole("link", { name: "Админка", exact: true }).getAttribute("aria-current"), "page");
        await view.page.evaluate(() => window.scrollTo(0, 500));
        assert.equal((await header.boundingBox()).y, 0, "Workspace header stays visible while scrolling the user directory");
        await view.page.evaluate(() => window.scrollTo(0, 0));
        await view.page.mouse.move(0, 0);
        await view.page.screenshot({ path: `/tmp/interhub-admin-modern-screenshots/admin-${width}-${theme}.png`, animations: "disabled" });
      }
    }
    await view.page.setViewportSize({ width: 1366, height: 900 });
    await header.getByRole("link", { name: "Интервью", exact: true }).click();
    await view.page.waitForURL("**/workspace/personal/interviews");
    await header.getByRole("button", { name: "Команды: Личное. Сменить команду", exact: true }).waitFor();
    await header.getByRole("link", { name: "Админка", exact: true }).click();
    await view.page.waitForURL("**/dashboard/admin");
    await main.waitFor();
    await header.getByRole("link", { name: `Открыть профиль @${view.own.nickname}`, exact: true }).click();
    await view.page.waitForURL("**/profile");
    assert.deepEqual(view.renderErrors, []);
  } finally { await view.context.close(); }
});
