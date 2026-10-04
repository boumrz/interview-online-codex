import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://127.0.0.1:15173";
const teamId = "00000000-0000-4000-8000-000000000017";
const accountId = "00000000-0000-4000-8000-000000000001";

async function fixture(role = "OWNER", path = "settings", theme = "light") {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
    await context.addInitScript(({ theme }) => {
      localStorage.setItem("auth_token", "roster-ui-fixture");
      localStorage.setItem("interview-online:ui-theme", theme);
    }, { theme });
    const team = { id: teamId, name: "Команда интерфейса", role, revision: 7, epoch: 1, capabilities: [] };
    const user = { id: accountId, nickname: "viewer", displayName: "Текущий коллега", role: "user", isHr: false };
    const items = [{ userId: accountId, displayName: user.displayName, role, state: "ACTIVE", revision: 2 },
      ...Array.from({ length: 26 }, (_, index) => ({ userId: `colleague-${index}`, displayName: `Коллега ${String(index).padStart(2, "0")}`, role: index === 0 ? "ADMIN" : "MEMBER", state: "ACTIVE", revision: 3 }))];
    if (role !== "OWNER") items[1] = { ...items[1], role: "OWNER" };
    const commands = [];
    const memberQueries = [];
    await context.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      let body;
      if (url.pathname === "/api/me/profile") body = user;
      else if (url.pathname === "/api/me/workspaces") body = [{ id: "personal", name: "Личное пространство", role: "OWNER", epoch: 1, capabilities: [] }, team];
      else if (url.pathname === `/api/teams/${teamId}`) body = team;
      else if (url.pathname === `/api/teams/${teamId}/members`) {
        const page = Number(url.searchParams.get("page"));
        const size = Number(url.searchParams.get("size"));
        memberQueries.push(url.searchParams.toString());
        body = { items: items.slice(page * size, (page + 1) * size), page, size, totalElements: items.length, totalPages: Math.ceil(items.length / size) };
      } else if (url.pathname === `/api/teams/${teamId}/invitations`) body = { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
      else if (url.pathname === `/api/teams/${teamId}/interviews`) body = { items: [] };
      else if (url.pathname === `/api/teams/${teamId}/interview-owner-offers`) body = { items: [] };
      else if (url.pathname.startsWith(`/api/teams/${teamId}/members/`) && ["PATCH", "DELETE"].includes(request.method())) {
        const userId = url.pathname.split("/").at(-1);
        const incoming = request.postDataJSON();
        commands.push({ method: request.method(), userId, body: incoming, key: request.headers()["idempotency-key"] });
        const member = items.find(item => item.userId === userId);
        if (request.method() === "PATCH") member.role = incoming.role;
        else items.splice(items.indexOf(member), 1);
        body = { outcome: request.method() === "PATCH" ? "ROLE_UPDATED" : "MEMBER_REMOVED", recovered: false, member };
      } else if (url.pathname === `/api/teams/${teamId}/ownership-transfer`) {
        commands.push({ method: "POST", body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
        body = { outcome: "OWNERSHIP_TRANSFERRED", recovered: false, team: { ...team, role: "ADMIN", revision: 8 }, memberships: [] };
        team.role = "ADMIN";
      } else if (url.pathname === `/api/teams/${teamId}/leave`) {
        commands.push({ method: "POST", path: "leave", key: request.headers()["idempotency-key"] });
        body = { outcome: "MEMBER_LEFT", recovered: false, member: { ...items[0], state: "LEFT" } };
      } else {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Fixture route unavailable" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(`${web}/workspace/teams/${teamId}/${path}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: path === "settings" ? "Настройки команды" : "Интервью", exact: true }).waitFor();
    if (path === "settings") {
      await page.getByRole("table", { name: "Состав команды", exact: true }).getByRole("row").filter({ hasText: "Текущий коллега" }).waitFor();
    } else {
      await page.getByRole("link", { name: "Настройки команды", exact: true }).waitFor();
    }
    return { browser, page, commands, memberQueries, team };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

test("team settings gear sits beside Teams selector and replaces the navigation tab", async () => {
  const { browser, page } = await fixture("MEMBER", "interviews");
  try {
    const selector = page.getByRole("button", { name: /^Команды:/ });
    await selector.waitFor();
    const gear = page.getByRole("link", { name: "Настройки команды", exact: true });
    assert.equal(await gear.getAttribute("href"), `/workspace/teams/${teamId}/settings`);
    assert.equal(await page.getByRole("navigation").getByRole("link", { name: "Настройки команды", exact: true }).count(), 0);
    const positions = await Promise.all([selector.boundingBox(), gear.boundingBox()]);
    assert.ok(positions[1].x >= positions[0].x + positions[0].width, "gear belongs immediately after team selector");
    await gear.hover();
    await page.getByRole("tooltip", { name: "Настройки команды", exact: true }).waitFor();
    await gear.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Настройки команды", exact: true }).waitFor();
  } finally { await browser.close(); }
});

test("settings show invitations above one paged roster without IDs, search or access card", async () => {
  const { browser, page, memberQueries } = await fixture();
  try {
    await page.getByRole("table", { name: "Состав команды", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Поиск участников", exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator("main").innerText(), /ID команды|УПРАВЛЕНИЕ ДОСТУПОМ|Управление пространством/);
    const invitation = await page.getByRole("button", { name: "Выпустить ссылку", exact: true }).boundingBox();
    const roster = await page.getByRole("table", { name: "Состав команды", exact: true }).boundingBox();
    assert.ok(invitation.y < roster.y, "invitation action precedes the roster");
    assert.ok(memberQueries.every(query => !query.includes("q=") && !query.includes("size=100")), "one paged roster supplies row actions");
  } finally { await browser.close(); }
});

test("owner role action belongs to selected roster row on a later page", async () => {
  const { browser, page, commands } = await fixture();
  try {
    await page.getByRole("navigation", { name: "Пагинация участников", exact: true }).getByText("2", { exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: "Коллега 25" });
    await row.getByRole("button", { name: "Изменить роль участника", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Изменить роль участника", exact: true });
    await dialog.getByText("Коллега 25", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("combobox", { name: "Участник", exact: true }).count(), 0, "row is the fixed command target");
    await dialog.getByRole("button", { name: "Сохранить роль", exact: true }).click();
    await page.getByText("Роль участника изменена", { exact: true }).waitFor();
    assert.equal(commands[0].userId, "colleague-25");
    assert.deepEqual(commands[0].body, { role: "MEMBER", revision: 3 });
    assert.ok(commands[0].key);
  } finally { await browser.close(); }
});

for (const role of ["ADMIN", "MEMBER"]) {
  test(`${role} row controls retain permissions and expose self leave`, async () => {
    const { browser, page } = await fixture(role);
    try {
      const ownRow = page.getByRole("row").filter({ hasText: "Текущий коллега" });
      await ownRow.getByRole("button", { name: "Выйти из команды", exact: true }).waitFor();
      assert.equal(await ownRow.getByRole("button", { name: "Удалить участника", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: /Изменить роль участника|Передать владение командой/ }).count(), 0);
      const ownerRow = page.getByRole("row").filter({ hasText: "Коллега 00" });
      assert.equal(await ownerRow.getByRole("button").count(), 0, "owner cannot be removed");
      const memberRow = page.getByRole("row").filter({ hasText: "Коллега 01" });
      assert.equal(await memberRow.getByRole("button", { name: "Удалить участника", exact: true }).count(), role === "ADMIN" ? 1 : 0);
      assert.equal(await page.getByRole("button", { name: "Выпустить ссылку", exact: true }).count(), role === "ADMIN" ? 1 : 0);
    } finally { await browser.close(); }
  });
}

test("owner transfer confirmation names its row and returns focus after cancellation", async () => {
  const { browser, page, commands } = await fixture();
  try {
    const action = page.getByRole("row").filter({ hasText: "Коллега 01" }).getByRole("button", { name: "Передать владение командой", exact: true });
    await action.click();
    const dialog = page.getByRole("dialog", { name: "Передать владение командой", exact: true });
    await dialog.getByText("Коллега 01", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Передать владение командой");
    assert.equal(await action.evaluate(node => node === document.activeElement), true);
    await action.click();
    await page.getByRole("dialog", { name: "Передать владение командой", exact: true }).getByRole("button", { name: "Подтвердить передачу", exact: true }).click();
    await page.getByText("Владение командой передано. Вы остаетесь администратором.", { exact: true }).waitFor();
    assert.deepEqual(commands[0].body, { targetUserId: "colleague-1", revision: 7 });
  } finally { await browser.close(); }
});

for (const theme of ["light", "dark"]) {
  test(`tablet team gear and roster retain readable geometry in ${theme}`, async () => {
    const { browser, page } = await fixture("OWNER", "settings", theme);
    try {
      await page.setViewportSize({ width: 768, height: 900 });
      await page.getByRole("table", { name: "Состав команды", exact: true }).waitFor();
      const selector = page.getByRole("button", { name: /^Команды:/ });
      const gear = page.getByRole("link", { name: "Настройки команды", exact: true });
      const logout = page.getByRole("button", { name: "Выйти", exact: true });
      const boxes = await Promise.all([selector.boundingBox(), gear.boundingBox(), logout.boundingBox()]);
      assert.equal(boxes[0].width, 240);
      assert.ok(boxes[1].x >= boxes[0].x + boxes[0].width);
      assert.ok(boxes[2].x + boxes[2].width <= 752, "logout stays inside tablet side padding");
      await gear.hover();
      await page.getByRole("tooltip", { name: "Настройки команды", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    } finally { await browser.close(); }
  });
}

test("pending team authorization keeps a disabled gear and hides old team links", async () => {
  const { browser, page } = await fixture("MEMBER", "interviews");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.route(`**/api/teams/${teamId}`, async route => { await gate; await route.fallback(); });
    await page.reload({ waitUntil: "domcontentloaded" });
    const gear = page.getByRole("button", { name: "Настройки команды", exact: true });
    await gear.waitFor();
    assert.equal(await gear.isDisabled(), true);
    assert.equal(await page.getByRole("link", { name: "Настройки команды", exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator("header").innerText(), /Команда интерфейса/);
    release();
    await page.getByRole("link", { name: "Настройки команды", exact: true }).waitFor();
  } finally { release?.(); await browser.close(); }
});

for (const command of ["rename", "role", "transfer", "remove", "leave"]) {
  test(`late ${command} failure after token replacement cannot restore an old command error`, async () => {
    const { browser, page } = await fixture(command === "leave" ? "MEMBER" : "OWNER");
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let observe;
    const received = new Promise(resolve => { observe = resolve; });
    const suffix = command === "rename" ? "" : command === "transfer" ? "/ownership-transfer" : command === "leave" ? "/leave" : "/members/colleague-1";
    await page.route(`**/api/teams/${teamId}${suffix}`, async route => {
      if (route.request().method() === "GET") return route.continue();
      observe(); await gate;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "OLD_SESSION_FAILURE" }) });
    });
    try {
      await page.getByRole("table", { name: "Состав команды", exact: true }).waitFor();
      const targets = {
        rename: ["Переименовать команду", "Переименовать команду", "Сохранить название"],
        role: ["Изменить роль участника", "Изменить роль участника", "Сохранить роль"],
        transfer: ["Передать владение командой", "Передать владение командой", "Подтвердить передачу"],
        remove: ["Удалить участника", "Удалить участника из команды", "Удалить участника"],
        leave: ["Выйти из команды", "Выйти из команды", "Выйти из команды"],
      };
      const [actionName, dialogName, submitName] = targets[command];
      const scope = command === "rename" ? page : page.getByRole("row").filter({ hasText: command === "leave" ? "Текущий коллега" : "Коллега 01" });
      await scope.getByRole("button", { name: actionName, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
      if (command === "rename") await dialog.getByLabel("Название команды", { exact: true }).fill("Новое название");
      await dialog.getByRole("button", { name: submitName, exact: true }).click();
      await received;
      // The token changes before React's next auth hydration. This is precisely
      // the same mounted session boundary checked by successful callbacks.
      await page.evaluate(() => localStorage.setItem("auth_token", "replacement-roster-session"));
      const response = page.waitForResponse(res => res.request().method() !== "GET" && new URL(res.url()).pathname === `/api/teams/${teamId}${suffix}`);
      release(); await response;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await dialog.getByRole("alert").count(), 0, "old session failure must not enter the current command surface");
    } finally { release?.(); await browser.close(); }
  });
}
