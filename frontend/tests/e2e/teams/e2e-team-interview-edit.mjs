import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL ?? "http://localhost:15173";
const api = process.env.E2E_API_URL ?? "http://localhost:18080/api";
async function request(path, auth, body, method = body ? "POST" : "GET") {
  const response = await fetch(api + path, { method, headers: {
    "Content-Type": "application/json", "Idempotency-Key": randomUUID(),
    ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
async function fixture(create = false) {
  const auth = await request("/auth/register", null, { nickname: `team_edit_${randomUUID().slice(0, 12)}`, displayName: "Менеджер редактора", password: "test-password-123" });
  const { team } = await request("/teams", auth, { name: `Редактор ${randomUUID()}` });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 850 } });
  await context.addInitScript(({ token, user }) => { localStorage.setItem("auth_token", token); localStorage.setItem("auth_user", JSON.stringify(user)); }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(`${web}/workspace/teams/${team.id}/interviews${create ? "/new" : ""}`);
  return { auth, team, browser, page };
}

test("team creation saves candidate details atomically and retries a lost response without duplicating the interview", async () => {
  const f = await fixture(true);
  try {
    const dialog = f.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.getByLabel("Название интервью", { exact: true }).fill("Атомарное интервью");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("  Анна Создание  ");
    await dialog.getByLabel("Позиция", { exact: true }).fill("  Backend инженер  ");
    assert.equal(await dialog.getByRole("combobox", { name: "Нанимающие из команды", exact: true }).count(), 0);
    await dialog.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).waitFor();
    const submissions = [];
    f.page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === `/api/teams/${f.team.id}/interviews`) submissions.push({ body: r.postDataJSON(), key: r.headers()["idempotency-key"] }); });
    await f.page.route(`**/api/teams/${f.team.id}/interviews`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const committed = await route.fetch();
      assert.equal(committed.status(), 201);
      await route.fulfill({ status: 503, json: { error: "Ответ потерян после сохранения" } });
    }, { times: 1 });
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByLabel("Имя кандидата", { exact: true }).inputValue(), "  Анна Создание  ");
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await f.page.waitForURL("**/room/*");
    assert.equal(submissions.length, 2);
    assert.equal(submissions[0].key, submissions[1].key);
    assert.deepEqual(submissions[0].body, submissions[1].body);
    const { items } = await request(`/teams/${f.team.id}/interviews`, f.auth);
    assert.equal(items.length, 1);
    const details = await request(`/teams/${f.team.id}/interviews/${items[0].id}/details`, f.auth);
    assert.equal(details.candidateName, "Анна Создание");
    assert.equal(details.position, "Backend инженер");
    assert.equal(details.title, "Атомарное интервью");
  } finally { await f.browser.close(); }
});

test("numeric-looking candidate text with no date creates an interview and loads the team details route", async () => {
  const f = await fixture(true);
  try {
    const dialog = f.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.getByLabel("Название интервью", { exact: true }).fill("234");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("234");
    await dialog.getByLabel("Позиция", { exact: true }).fill("423");
    const submission = f.page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === `/api/teams/${f.team.id}/interviews`);
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const body = (await submission).postDataJSON();
    assert.equal(typeof body.title, "string");
    assert.equal(body.candidateName, "234");
    assert.equal(body.position, "423");
    assert.equal(Object.hasOwn(body, "scheduledAt"), false, "an empty optional date must be omitted from creation");
    await f.page.waitForURL("**/room/*");
    const { items } = await request(`/teams/${f.team.id}/interviews`, f.auth);
    assert.equal(items.length, 1);
    await f.page.goto(`${web}/workspace/teams/${f.team.id}/interviews`);
    await f.page.getByRole("button", { name: "Редактировать интервью 234", exact: true }).click();
    const edit = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await edit.getByLabel("Имя кандидата", { exact: true }).waitFor();
    assert.equal(await edit.getByLabel("Имя кандидата", { exact: true }).inputValue(), "234");
    assert.equal(await edit.getByLabel("Позиция", { exact: true }).inputValue(), "423");
    assert.equal(await edit.getByLabel("Дата и время интервью (МСК)", { exact: true }).inputValue(), "");
    await edit.getByLabel("Позиция", { exact: true }).fill("4230");
    await edit.getByRole("button", { name: "Сохранить", exact: true }).click();
    await f.page.getByText("Интервью сохранено", { exact: true }).waitFor();
    const details = await request(`/teams/${f.team.id}/interviews/${items[0].id}/details`, f.auth);
    assert.deepEqual([details.title, details.candidateName, details.position, details.scheduledAt], ["234", "234", "4230", null]);
  } finally { await f.browser.close(); }
});

test("one team edit action saves title and candidate details together, retains failed drafts and reloads conflicts", async () => {
  const f = await fixture();
  try {
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Исходное интервью", selectedTaskIds: [] });
    await f.page.reload();
    const card = f.page.getByRole("region", { name: "Командное интервью Исходное интервью", exact: true });
    const edit = card.getByRole("button", { name: "Редактировать интервью Исходное интервью", exact: true });
    await edit.waitFor();
    assert.equal((await edit.textContent()).trim(), "Редактировать");
    assert.equal(await card.getByRole("button", { name: /Переименовать|Редактировать сведения/ }).count(), 0);
    await edit.click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    const title = dialog.getByLabel("Название интервью", { exact: true });
    const name = dialog.getByLabel("Имя кандидата", { exact: true });
    await title.waitFor();
    await title.fill("Единое изменение"); await name.fill("Кандидат редактора");
    await dialog.getByLabel("Позиция", { exact: true }).fill("Kotlin инженер");
    await dialog.getByLabel("Дата и время интервью (МСК)", { exact: true }).fill("2030-10-12T14:30");
    await f.page.route(`**/api/teams/${f.team.id}/interviews/${interview.id}/details`, route => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Ошибка проверки" } }) : route.continue(), { times: 1 });
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await title.inputValue(), "Единое изменение"); assert.equal(await name.inputValue(), "Кандидат редактора");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await f.page.getByText("Интервью сохранено", { exact: true }).waitFor();
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    let details = await request(endpoint, f.auth);
    assert.deepEqual([details.title, details.candidateName, details.position, details.scheduledAt], ["Единое изменение", "Кандидат редактора", "Kotlin инженер", "2030-10-12T11:30:00Z"]);
    assert.ok(f.page.url().endsWith(`/workspace/teams/${f.team.id}/interviews`));
    await request(endpoint, f.auth, { ...details, title: "Другой менеджер", candidateName: "Другой кандидат" }, "PATCH");
    await title.fill("Черновик названия"); await name.fill("Черновик кандидата");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).waitFor();
    assert.equal(await title.inputValue(), "Черновик названия"); assert.equal(await name.inputValue(), "Черновик кандидата");
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).click();
    await f.page.waitForFunction(() => [...document.querySelectorAll("input")].some(el => el.value === "Другой менеджер"));
    assert.equal(await name.inputValue(), "Другой кандидат");
    const hr = await request("/auth/register", null, { nickname: `external_${randomUUID().slice(0,12)}`, displayName: "Внешний нанимающий редактора", password: "test-password-123", isHr: true });
    await dialog.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).fill(hr.user.id);
    await f.page.locator(".ant-select-item-option").filter({ hasText: hr.user.displayName }).click();
    const remove = dialog.getByRole("button", { name: `Снять роль нанимающего у ${hr.user.displayName}`, exact: true });
    await remove.waitFor(); await remove.click(); await remove.waitFor({ state: "hidden" });
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await f.page.reload();
    await f.page.getByRole("button", { name: "Редактировать интервью Другой менеджер", exact: true }).click();
    await f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true }).getByLabel("Имя кандидата", { exact: true }).waitFor();
    assert.equal(await name.inputValue(), "Другой кандидат");
  } finally { await f.browser.close(); }
});

test("expired authentication clears private editor fields and a late response cannot reopen the previous team", async () => {
  const f = await fixture();
  try {
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Сведения старой команды", selectedTaskIds: [] });
    await f.page.reload();
    const endpoint = `**/api/teams/${f.team.id}/interviews/${interview.id}/details`;
    await f.page.route(endpoint, route => route.fulfill({ status: route.request().method() === "PATCH" ? 401 : 200, json: route.request().method() === "PATCH" ? { error: "Авторизация истекла" } : { title: interview.title, candidateName: "Приватный кандидат старой команды", position: "Инженер", scheduledAt: null, revision: 0 } }));
    await f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Черновик до 401");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByLabel("Имя кандидата", { exact: true }).count(), 0, "401 must clear candidate metadata and drafts");
    assert.equal(await dialog.getByRole("button", { name: "Сохранить", exact: true }).isDisabled(), true);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await f.page.unroute(endpoint);
    const { team: nextTeam } = await request("/teams", f.auth, { name: "Другая команда редактора" });
    let entered, release;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const releasePromise = new Promise(resolve => { release = resolve; });
    await f.page.route(endpoint, async route => { entered(); await releasePromise; try { await route.fulfill({ status: 200, json: { title: interview.title, candidateName: "Поздний приватный кандидат", position: null, scheduledAt: null, revision: 0 } }); } catch { /* The canceled request may already have detached. */ } });
    await f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click(); await enteredPromise;
    await f.page.goto(`${web}/workspace/teams/${nextTeam.id}/interviews`); release();
    await f.page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
    assert.equal(await f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true }).count(), 0);
    assert.equal(await f.page.getByText("Поздний приватный кандидат", { exact: true }).count(), 0);
  } finally { await f.browser.close(); }
});

test("expired authentication clears the private team creation draft and its retry credentials", async () => {
  const f = await fixture(true);
  try {
    const dialog = f.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.getByLabel("Название интервью", { exact: true }).fill("До истечения авторизации");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Приватный черновик создания");
    await f.page.route(`**/api/teams/${f.team.id}/interviews`, route => route.request().method() === "POST" ? route.fulfill({ status: 401, json: { error: "Авторизация истекла" } }) : route.continue());
    const rejected = f.page.waitForResponse(response => response.request().method() === "POST" && response.status() === 401);
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await rejected;
    await f.page.waitForFunction(() => localStorage.getItem("auth_token") === null, { timeout: 3000 }).catch(() => {});
    assert.equal(await f.page.getByLabel("Имя кандидата", { exact: true }).count(), 0, "401 must hide the private creation draft");
    assert.equal(await f.page.evaluate(() => localStorage.getItem("auth_token")), null, "401 must clear invalid account credentials");
    const storage = await f.page.evaluate(() => Object.values(localStorage).join(" "));
    assert.ok(!storage.includes("Приватный черновик создания"));
  } finally { await f.browser.close(); }
});
