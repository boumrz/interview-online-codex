import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://127.0.0.1:15173";
const userId = "00000000-0000-4000-8000-000000000001";
const memberId = "00000000-0000-4000-8000-000000000002";
const teamId = "00000000-0000-4000-8000-000000000010";
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function gate() {
  let release;
  let observe;
  const held = new Promise((resolve) => { release = resolve; });
  const seen = new Promise((resolve) => { observe = resolve; });
  return { release, seen, async hold() { observe(); await held; } };
}

function interview() {
  return {
    id: "interview-one", teamId, roomId: "room-one", inviteCode: "fixture-code", title: "Уведомления",
    taskCount: 0, tasks: [], taskScores: [], assignees: [], trackId: null, trackName: null,
    vacancyId: null, vacancyTitle: null, createdByUserId: memberId, ownerUserId: memberId,
    ownershipState: "OWNER_LEFT", programmeVersion: null, createdAt: "2026-09-28T09:00:00Z",
    finishedAt: null, status: "frozen", verdict: null, verdictComment: null, candidateName: "Кандидат",
    position: null, scheduledAt: null, archivedAt: null, interviewState: "active",
    effectiveAt: "2026-09-28T09:00:00Z", dateSource: "created",
  };
}

async function waitForNotificationSurface(page, section) {
  const settings = section === "settings";
  await page.getByRole("heading", { name: settings ? "Настройки команды" : "Интервью", exact: true }).waitFor();
  if (settings) await page.getByRole("table", { name: "Состав команды", exact: true }).waitFor();
  else await page.getByRole("button", { name: "Принять владение интервью Уведомления", exact: true }).waitFor();
}

async function fixture(section = "settings", { role = "OWNER", orphanStatus = "active" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const user = { id: userId, nickname: "notifications", displayName: "Владелец", role: "user", isHr: false };
    const state = {
      team: { id: teamId, name: "Команда уведомлений", role, epoch: 1, revision: 1, capabilities: [] },
      invitations: [], requests: [], beforeMutation: null,
      members: [
        { userId, nickname: user.nickname, displayName: user.displayName, role, state: "ACTIVE", revision: 1 },
        { userId: memberId, nickname: "teammate", displayName: "Участник", role: "MEMBER", state: "ACTIVE", revision: 1 },
      ],
    };
    const row = interview();
    const offer = { id: "offer-one", interviewId: row.id, interviewTitle: row.title, fromDisplayName: "Администратор", expiresAt: "2026-10-20T09:00:00Z" };
    await context.addInitScript(({ token, user }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      localStorage.setItem("display_name", user.displayName);
    }, { token: "team-notification-fixture", user });
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const root = `/api/teams/${teamId}`;
      state.requests.push({ path, method, key: request.headers()["idempotency-key"], body: request.postDataJSON() });
      if (method !== "GET") {
        const failure = await state.beforeMutation?.(request, url);
        if (failure) return route.fulfill({ status: failure, contentType: "application/json", body: JSON.stringify({ error: "INJECTED_FAILURE" }) });
      }
      let body;
      if (path === "/api/me/profile") body = user;
      else if (path === "/api/me/workspaces") body = [{ id: "personal", name: "Личное пространство", role: "OWNER", epoch: 1, capabilities: [] }, state.team];
      else if (path === root && method === "PATCH") {
        state.team = { ...state.team, name: request.postDataJSON().name, revision: state.team.revision + 1 };
        body = { outcome: "CHANGED", team: state.team };
      } else if (path === root) body = state.team;
      else if (path === `${root}/members/${memberId}` && method === "PATCH") {
        state.members[1] = { ...state.members[1], role: request.postDataJSON().role, revision: 2 };
        body = { outcome: "CHANGED", member: state.members[1] };
      } else if (path === `${root}/members/${memberId}` && method === "DELETE") {
        body = { recovered: false, member: state.members[1] };
        state.members = state.members.slice(0, 1);
      } else if (path === `${root}/ownership-transfer`) {
        state.team = { ...state.team, role: "ADMIN", revision: 2 };
        body = { team: state.team };
      } else if (path === `${root}/leave`) body = { recovered: false };
      else if (path === `${root}/members`) body = { items: state.members, page: 0, size: 100, totalElements: state.members.length, totalPages: 1 };
      else if (path === `${root}/tracks`) body = { items: [], counts: { activeTracks: 0, archivedTracks: 0, activeVacancies: 0, archivedVacancies: 0 } };
      else if (path === `${root}/invitations` && method === "POST") {
        const invitation = { id: "invitation-one", state: "PENDING", role: "MEMBER", expiresAt: "2026-10-20T09:00:00Z", revision: (state.invitations[0]?.revision ?? 0) + 1, canReveal: false, linkRecoverability: "RECOVERABLE" };
        state.invitations = [invitation];
        body = { invitation };
      } else if (path === `${root}/invitations/invitation-one/revoke`) {
        state.invitations = [{ ...state.invitations[0], state: "REVOKED", canReveal: false, linkRecoverability: "NOT_APPLICABLE" }];
        body = { invitation: state.invitations[0] };
      } else if (path === `${root}/invitations`) body = { items: state.invitations, page: 0, size: 20, totalElements: state.invitations.length, totalPages: state.invitations.length ? 1 : 0 };
      else if (path === `${root}/interview-owner-offers`) body = { items: [offer] };
      else if (path === `${root}/interviews` && method === "GET") body = { items: url.searchParams.get("ownership") === "orphaned" ? [{ ...row, status: orphanStatus }] : [row] };
      else if (path.startsWith(`${root}/interviews/`) && method === "POST") body = { interview: row, offer };
      else return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: `Unexpected fixture: ${method} ${path}` }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.goto(`${web}/workspace/teams/${teamId}/${section}`, { waitUntil: "domcontentloaded" });
    await waitForNotificationSurface(page, section);
    return { context, page, state };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function assertSuccess(page, message) {
  const status = page.getByRole("status").filter({ hasText: message });
  await status.waitFor();
  assert.equal(await status.count(), 1, "AC18_DUPLICATE_SUCCESS");
  assert.equal(await page.getByText(message, { exact: true }).count(), 1, "AC18_INLINE_SUCCESS_DUPLICATE");
  assert.equal(await status.evaluate((node) => node.closest("main") === null), true, "AC18_SUCCESS_STILL_INLINE");
  assert.equal(await status.evaluate((node) => Boolean(node.closest(".ant-notification-top"))), true, "AC18_SUCCESS_NOT_AT_TOP");
  assert.equal(await status.evaluate((node) => node.contains(document.activeElement)), false, "AC18_POPUP_STOLE_FOCUS");
  return status;
}

async function dismissSuccess(page) {
  await page.locator(".ant-notification-notice-close").click();
  await page.locator(".ant-notification-notice").waitFor({ state: "hidden" });
}

async function choose(page, label, option) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.locator("xpath=ancestor-or-self::div[contains(concat(' ',normalize-space(@class),' '),' ant-select ')][1]").locator(".ant-select-content").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: option }).first().click();
}

test("AC18 team invitations: confirmation gives one top success; pending, failure and reload stay quiet", async () => {
  const { context, page, state } = await fixture();
  const pending = gate();
  try {
    assert.equal(await page.locator(".ant-notification-notice").count(), 0);
    state.beforeMutation = async () => { await pending.hold(); return 503; };
    await page.getByRole("button", { name: "Выпустить ссылку", exact: true }).click();
    await pending.seen;
    assert.equal(await page.getByText("Ссылка выпущена", { exact: true }).count(), 0);
    pending.release();
    await page.getByRole("alert").filter({ hasText: "Не удалось создать приглашение" }).waitFor();
    assert.equal(await page.locator(".ant-notification-notice").count(), 0);
    state.beforeMutation = null;
    await page.getByRole("button", { name: "Повторить создание", exact: true }).click();
    await assertSuccess(page, "Ссылка выпущена");
    const attempts = state.requests.filter((request) => request.method === "POST");
    assert.equal(attempts[0].key, attempts[1].key, "AC18_INVITATION_RETRY_CHANGED_KEY");
    await dismissSuccess(page);
    await page.getByRole("button", { name: "Отозвать приглашение", exact: true }).click();
    await assertSuccess(page, "Приглашение отозвано");
    await page.getByText("Отозвано", { exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForNotificationSurface(page, "settings");
    assert.equal(await page.locator(".ant-notification-notice").count(), 0, "AC18_RELOAD_REPLAYED_SUCCESS");
  } finally { pending.release(); await context.close(); }
});

test("AC18 team settings: confirmed rename, role and removal use popups while failed rename keeps draft and retry", async () => {
  const { context, page, state } = await fixture();
  const pending = gate();
  try {
    const rename = page.getByRole("button", { name: "Переименовать команду", exact: true });
    await rename.click();
    const dialog = page.getByRole("dialog", { name: "Переименовать команду", exact: true });
    await dialog.getByLabel("Название команды", { exact: true }).fill("Сохранённое название");
    state.beforeMutation = async () => { await pending.hold(); return 503; };
    await dialog.getByRole("button", { name: "Сохранить название", exact: true }).click();
    await pending.seen;
    assert.equal(await page.getByText("Название команды сохранено", { exact: true }).count(), 0);
    pending.release();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByLabel("Название команды", { exact: true }).inputValue(), "Сохранённое название");
    assert.equal(await page.locator(".ant-notification-notice").count(), 0);
    state.beforeMutation = null;
    await dialog.getByRole("button", { name: "Повторить", exact: true }).click();
    await assertSuccess(page, "Название команды сохранено");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Переименовать команду" || document.activeElement?.textContent === "Настройки команды");
    const attempts = state.requests.filter((request) => request.method === "PATCH");
    assert.equal(attempts[0].key, attempts[1].key, "AC18_RENAME_RETRY_CHANGED_KEY");
    await dismissSuccess(page);
    await page.getByRole("button", { name: "Изменить роль участника", exact: true }).click();
    const role = page.getByRole("dialog", { name: "Изменить роль участника", exact: true });
    await choose(page, "Роль", "Администратор");
    await role.getByRole("button", { name: "Сохранить роль", exact: true }).click();
    await assertSuccess(page, "Роль участника изменена");
    await role.waitFor({ state: "hidden" });
    await dismissSuccess(page);
    await page.getByRole("button", { name: "Удалить участника", exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить участника из команды", exact: true }).getByRole("button", { name: "Удалить участника", exact: true }).click();
    await assertSuccess(page, "Участник удалён из команды");
  } finally { pending.release(); await context.close(); }
});

test("AC18 team transfer: the disappearing initiator returns focus to settings heading, never to success", async () => {
  const { context, page } = await fixture();
  try {
    await page.getByRole("button", { name: "Передать владение командой", exact: true }).click();
    await page.getByRole("dialog", { name: "Передать владение командой", exact: true }).getByRole("button", { name: "Подтвердить передачу", exact: true }).click();
    await assertSuccess(page, "Владение командой передано. Вы остаетесь администратором.");
    const heading = page.getByRole("heading", { name: "Настройки команды", exact: true });
    await page.waitForFunction((node) => document.activeElement === node, await heading.elementHandle());
    assert.equal(await page.getByRole("button", { name: "Передать владение командой", exact: true }).count(), 0);
  } finally { await context.close(); }
});

test("AC18 team leave: the server-confirmed result uses one top popup", async () => {
  const { context, page } = await fixture("settings", { role: "MEMBER" });
  try {
    await page.getByRole("button", { name: "Выйти из команды", exact: true }).click();
    await page.getByRole("dialog", { name: "Выйти из команды", exact: true }).getByRole("button", { name: "Выйти из команды", exact: true }).click();
    await assertSuccess(page, "Вы вышли из команды");
  } finally { await context.close(); }
});

const ownershipCases = [
  ["offer", "Предложить владение интервью Уведомления", "Предложение отправлено выбранному участнику."],
  ["accept", "Принять владение интервью Уведомления", "Вы приняли владение интервью."],
  ["decline", "Отклонить владение интервью Уведомления", "Вы отклонили предложение владения."],
  ["archive", "Архивировать интервью без преемника Уведомления", "Интервью архивировано без преемника."],
  ["freeze", "Заморозить интервью Уведомления", "Интервью заморожено для кандидата."],
  ["resume", "Возобновить интервью Уведомления", "Интервью возобновлено."],
];
for (const [operation, button, success] of ownershipCases) {
  test(`AC18 interview ownership ${operation}: only confirmed success becomes one top popup`, async () => {
    const { context, page, state } = await fixture("interviews");
    const pending = gate();
    try {
      assert.equal(await page.locator(".ant-notification-notice").count(), 0);
      if (operation === "offer") await choose(page, "Кому предложить владение", "Владелец");
      state.beforeMutation = async () => { await pending.hold(); return 503; };
      await page.getByRole("button", { name: button, exact: true }).click();
      await pending.seen;
      assert.equal(await page.getByText(success, { exact: true }).count(), 0);
      pending.release();
      await page.getByRole("status").filter({ hasText: "Не удалось" }).waitFor();
      assert.equal(await page.locator(".ant-notification-notice").count(), 0);
      state.beforeMutation = null;
      await page.getByRole("button", { name: button, exact: true }).click();
      await assertSuccess(page, success);
    } finally { pending.release(); await context.close(); }
  });
}

for (const action of ["rename", "invitation", "ownership"]) {
  test(`AC18 late ${action} confirmation cannot publish success after leaving its surface`, async () => {
    const { context, page, state } = await fixture(action === "ownership" ? "interviews" : "settings");
    const pending = gate();
    try {
      state.beforeMutation = () => pending.hold();
      if (action === "rename") {
        await page.getByRole("button", { name: "Переименовать команду", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Переименовать команду", exact: true });
        await dialog.getByLabel("Название команды", { exact: true }).fill("Позднее название");
        await dialog.getByRole("button", { name: "Сохранить название", exact: true }).click();
        await pending.seen;
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      } else {
        await page.getByRole("button", { name: action === "invitation" ? "Выпустить ссылку" : "Принять владение интервью Уведомления", exact: true }).click();
        await pending.seen;
      }
      const destination = action === "ownership" ? "Настройки команды" : "Интервью";
      if (action === "ownership") {
        await page.getByRole("link", { name: "Настройки команды", exact: true }).click();
      } else {
        const navigation = page.getByRole("navigation", { name: "Разделы команды", exact: true });
        const link = navigation.getByRole("link", { name: destination, exact: true });
        if (await link.count() > 0) await link.click();
        else {
          await navigation.getByRole("button", { name: /Меню разделов/ }).click();
          await page.getByRole("menuitem", { name: destination, exact: true }).click();
        }
      }
      await page.getByRole("heading", { name: action === "ownership" ? "Настройки команды" : "Интервью", exact: true }).waitFor();
      const response = page.waitForResponse((response) => response.request().method() !== "GET");
      pending.release();
      await response;
      await page.waitForTimeout(150);
      assert.equal(await page.locator(".ant-notification-notice").count(), 0, "AC18_LATE_CONTEXT_SUCCESS");
    } finally { pending.release(); await context.close(); }
  });
}

for (const action of ["rename", "invitation", "ownership"]) {
  test(`AC18 stored-token change fences held ${action} success before account rerender`, async () => {
    const { context, page, state } = await fixture(action === "ownership" ? "interviews" : "settings");
    const pending = gate();
    try {
      state.beforeMutation = () => pending.hold();
      if (action === "rename") {
        await page.getByRole("button", { name: "Переименовать команду", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Переименовать команду", exact: true });
        await dialog.getByLabel("Название команды", { exact: true }).fill("Ответ прежнего аккаунта");
        await dialog.getByRole("button", { name: "Сохранить название", exact: true }).click();
      } else {
        await page.getByRole("button", { name: action === "invitation" ? "Выпустить ссылку" : "Принять владение интервью Уведомления", exact: true }).click();
      }
      await pending.seen;
      await page.evaluate(() => localStorage.setItem("auth_token", "replacement-notification-fixture"));
      const response = page.waitForResponse((response) => response.request().method() !== "GET");
      pending.release();
      await response;
      await page.waitForTimeout(150);
      assert.equal(await page.locator(".ant-notification-notice").count(), 0, "AC18_REPLACED_ACCOUNT_SUCCESS");
    } finally { pending.release(); await context.close(); }
  });
}
