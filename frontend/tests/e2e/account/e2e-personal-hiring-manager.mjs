import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
let browser;

async function request(path, auth, body, method = body === undefined ? "GET" : "POST", expected) {
  const response = await fetch(`${api}${path}`, {
    method, headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (expected !== undefined) {
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: expected ${expected}, got ${response.status}`);
    return response;
  }
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

const account = (name = "Владелец личного найма", isHr = false) => request("/auth/register", null, {
  nickname: `personal_${randomUUID().replaceAll("-", "").slice(0, 18)}`, displayName: name, password: "test-password-123", isHr,
});

async function open(auth, path) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token); localStorage.setItem("auth_user", JSON.stringify(user)); localStorage.setItem("display_name", user.displayName);
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const requests = [];
  page.on("request", req => requests.push({ path: new URL(req.url()).pathname, method: req.method(), body: req.postData() ? req.postDataJSON() : null }));
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  return { context, page, requests };
}

const picker = region => region.getByRole("combobox", { name: "Нанимающий", exact: true });
async function choose(page, region, hiring) {
  await picker(region).fill(hiring.user.nickname);
  const option = page.locator(".ant-select-item-option").filter({ hasText: hiring.user.displayName });
  await option.waitFor();
  assert.equal(await option.getByText(hiring.user.id, { exact: true }).count(), 0, "A verified person is shown by name without technical identifiers");
  await option.click();
}
async function personalOnly(region) {
  assert.equal(await region.getByRole("combobox", { name: /трек|ваканси/i }).count(), 0);
  assert.equal(await region.getByText(/внешн|Без трека|Без вакансии|UUID|ID нанимающего/i).count(), 0, "PERSONAL hiring has generic names and no TEAM context");
}
function noTeamRequests(requests) {
  assert.deepEqual(requests.filter(req => /\/tracks(?:\/|$)|\/vacancies(?:\/|$)|\/hiring-manager-options$/.test(req.path)), [], "PERSONAL uses exact nickname lookup without TEAM reference APIs or a global directory");
}

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test("personal creation assigns a registered hiring manager by nickname and persists permitted access without TEAM context", { timeout: 60_000 }, async () => {
  const owner = await account();
  const hiring = await account("Нанимающий личного создания", true);
  const other = await account("Посторонний нанимающий", true);
  const view = await open(owner, "/workspace/personal/interviews/new");
  try {
    const dialog = view.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await picker(dialog).waitFor();
    await personalOnly(dialog);
    await dialog.getByLabel("Название интервью", { exact: true }).fill("Личное интервью с нанимающим");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Личный кандидат назначения");
    await choose(view.page, dialog, hiring);
    await dialog.getByRole("button", { name: `Удалить нанимающего ${hiring.user.displayName}`, exact: true }).waitFor();
    const creation = view.page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms");
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const response = await creation;
    assert.equal(response.status(), 200);
    const sent = response.request().postDataJSON();
    assert.deepEqual(sent.hiringManagerIds, [hiring.user.id]);
    assert.ok(!Object.hasOwn(sent, "trackId") && !Object.hasOwn(sent, "vacancyId"));
    const room = await response.json();
    await view.page.waitForURL(`**/room/${room.inviteCode}`);
    const managers = await request(`/rooms/${room.inviteCode}/hr-managers`, owner);
    assert.ok(managers.some(manager => manager.userId === hiring.user.id));
    assert.equal((await request(`/rooms/${room.inviteCode}/interview-metadata`, hiring)).candidateName, "Личный кандидат назначения");
    assert.ok((await request("/me/hr/rooms", hiring)).items.some(item => item.roomId === room.id));
    await request(`/rooms/${room.inviteCode}/interview-metadata`, other, undefined, "GET", [403, 404]);
    await view.page.goto(`${web}/workspace/personal/interviews`, { waitUntil: "domcontentloaded" });
    const card = view.page.getByRole("region", { name: `Личное интервью ${room.title}`, exact: true });
    await card.waitFor();
    await personalOnly(card);
    noTeamRequests(view.requests);
    const previews = view.requests.filter(req => req.path.endsWith("/hiring-manager-preview"));
    assert.ok(previews.length > 0);
    assert.equal(previews[0].body.nickname, hiring.user.nickname);
    assert.equal(Object.hasOwn(previews[0].body, "teamId"), false);
  } finally { await view.context.close(); }
});

test("personal list editor adds and removes nickname hiring assignments independently of metadata drafts", { timeout: 60_000 }, async () => {
  const owner = await account();
  const hiring = await account("Нанимающий личного редактора", true);
  const room = await request("/rooms", owner, { title: "Личный редактор назначения", taskIds: [] });
  const view = await open(owner, "/workspace/personal/interviews");
  try {
    const card = view.page.getByRole("region", { name: `Личное интервью ${room.title}`, exact: true });
    const edit = view.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await card.getByRole("button", { name: `Редактировать интервью ${room.title}`, exact: true }).click();
    await picker(edit).waitFor();
    await personalOnly(edit);
    await edit.getByLabel("Имя кандидата", { exact: true }).fill("Сохранённый личный кандидат");
    await choose(view.page, edit, hiring);
    const remove = edit.getByRole("button", { name: `Снять роль нанимающего у ${hiring.user.displayName}`, exact: true });
    await remove.waitFor();
    assert.ok((await request(`/rooms/${room.inviteCode}/hr-managers`, owner)).some(item => item.userId === hiring.user.id));
    await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
    await view.page.getByText("Интервью сохранено", { exact: true }).waitFor();
    await edit.getByRole("button", { name: "Отмена", exact: true }).click();
    await view.page.reload({ waitUntil: "domcontentloaded" });
    await card.getByRole("button", { name: `Редактировать интервью ${room.title}`, exact: true }).click();
    await remove.waitFor();
    assert.equal(await edit.getByLabel("Имя кандидата", { exact: true }).inputValue(), "Сохранённый личный кандидат");
    await remove.click();
    await view.page.getByText("Роль нанимающего снята", { exact: true }).waitFor();
    await remove.waitFor({ state: "hidden" });
    assert.equal((await request(`/rooms/${room.inviteCode}/hr-managers`, owner)).some(item => item.userId === hiring.user.id), false);
    await request(`/rooms/${room.inviteCode}/interview-metadata`, hiring, undefined, "GET", [403, 404]);
    assert.equal((await request("/me/hr/rooms", hiring)).items.some(item => item.roomId === room.id), false);
    noTeamRequests(view.requests);
  } finally { await view.context.close(); }
});

test("personal hiring nickname lookup rejects unknown and ineligible accounts, releases submit and permits a corrected selection", { timeout: 45_000 }, async () => {
  const owner = await account();
  const ineligible = await account("Обычный зарегистрированный участник");
  const hiring = await account("Нанимающий после исправления", true);
  const view = await open(owner, "/workspace/personal/interviews/new");
  try {
    const dialog = view.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    const input = picker(dialog);
    await input.waitFor();
    await dialog.getByLabel("Название интервью", { exact: true }).fill("Исправленный личный поиск");
    const missing = `missing_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await input.fill(missing);
    await dialog.getByRole("alert").filter({ hasText: /не найден|недоступен/ }).waitFor({ timeout: 8000 });
    assert.equal(await dialog.getByRole("button", { name: "Создать интервью", exact: true }).isDisabled(), false);
    assert.equal(await view.page.locator(".ant-select-item-option").count(), 0);
    await input.fill(ineligible.user.nickname);
    await dialog.getByRole("alert").filter({ hasText: /нанимающ|не найден|недоступен/ }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Создать интервью", exact: true }).isDisabled(), false);
    assert.equal(await view.page.locator(".ant-select-item-option").count(), 0);
    await choose(view.page, dialog, hiring);
    await dialog.getByRole("button", { name: `Удалить нанимающего ${hiring.user.displayName}`, exact: true }).waitFor();
    await input.fill(hiring.user.nickname);
    await dialog.getByRole("alert").filter({ hasText: "Нанимающий уже добавлен" }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: `Удалить нанимающего ${hiring.user.displayName}`, exact: true }).count(), 1);
    noTeamRequests(view.requests);
  } finally { await view.context.close(); }
});

test("personal room nickname hiring grant updates an open candidate session and revocation prevents late private restoration", { timeout: 75_000 }, async () => {
  const owner = await account();
  const hiring = await account("Нанимающий живой личной комнаты", true);
  const room = await request("/rooms", owner, { title: "Личная комната назначения", taskIds: [] });
  const candidateName = "Закрытый личный кандидат";
  await request(`/rooms/${room.inviteCode}/interview-metadata`, owner, { candidateName, position: null, scheduledAt: null, revision: 0 }, "PUT");
  const host = await open(owner, `/room/${room.inviteCode}`);
  const guest = await open(hiring, `/room/${room.inviteCode}`);
  let releaseLate = () => {};
  try {
    await host.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    await guest.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    const trigger = guest.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true });
    const currentRole = guest.page.getByTestId(/^participant-badge-/).filter({ hasText: hiring.user.displayName }).locator('[aria-label="Интервьюер"]');
    assert.equal(await trigger.count(), 0);
    await host.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const hostPanel = host.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await picker(hostPanel).waitFor();
    await personalOnly(hostPanel);
    await choose(host.page, hostPanel, hiring);
    await hostPanel.getByRole("button", { name: `Снять роль нанимающего у ${hiring.user.displayName}`, exact: true }).waitFor();
    await trigger.click();
    const guestPanel = guest.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await guestPanel.getByLabel("Имя кандидата", { exact: true }).waitFor();
    assert.equal(await guestPanel.getByLabel("Имя кандидата", { exact: true }).inputValue(), candidateName);
    await personalOnly(guestPanel);
    await guest.page.reload({ waitUntil: "domcontentloaded" });
    await trigger.waitFor();
    await hostPanel.getByRole("button", { name: `Снять роль нанимающего у ${hiring.user.displayName}`, exact: true }).click();
    await trigger.waitFor({ state: "hidden" });

    let signalLate;
    const started = new Promise(resolve => { signalLate = resolve; });
    const gate = new Promise(resolve => { releaseLate = resolve; });
    let held = false;
    await guest.page.route(`**/api/rooms/${room.inviteCode}`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (!body.canManageRoom || held) return route.fulfill({ response, json: body });
      held = true; signalLate();
      await gate;
      await route.fulfill({ response, json: body }).catch(() => {});
    });
    await choose(host.page, hostPanel, hiring);
    let timer;
    try { await Promise.race([started, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("PERSONAL live assignment did not refresh the protected room DTO")), 8000); })]); }
    finally { clearTimeout(timer); }
    await currentRole.waitFor();
    await hostPanel.getByRole("button", { name: `Снять роль нанимающего у ${hiring.user.displayName}`, exact: true }).click();
    await currentRole.waitFor({ state: "hidden" });
    await trigger.waitFor({ state: "hidden" });
    releaseLate();
    await guest.page.waitForTimeout(300);
    assert.equal(await trigger.count(), 0);
    assert.equal(await guest.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
    assert.equal(await guest.page.locator(`input[value="${candidateName}"]`).count(), 0);
    await request(`/rooms/${room.inviteCode}/interview-metadata`, hiring, undefined, "GET", [403, 404]);
    noTeamRequests(host.requests);
    noTeamRequests(guest.requests);
  } finally { releaseLate(); await Promise.all([host.context.close(), guest.context.close()]); }
});
