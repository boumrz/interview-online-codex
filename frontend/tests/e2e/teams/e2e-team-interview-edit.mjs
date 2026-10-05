import "../support/require-isolated-api.mjs";
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

async function choose(page, dialog, label, option) {
  await dialog.getByRole("combobox", { name: label, exact: true }).click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: option }).click();
}

async function account(displayName, isHr = false) {
  return request("/auth/register", null, { nickname: `edit_person_${randomUUID().slice(0, 12)}`, displayName, password: "test-password-123", isHr });
}

async function teamMember(owner, team, person) {
  const { invitation } = await request(`/teams/${team.id}/invitations`, owner, {});
  const { url } = await request(`/teams/${team.id}/invitations/${invitation.id}/link`, owner);
  const token = new URL(url, web).hash.slice("#token=".length);
  assert.ok(token, "owned fixture invitation has its delivery token");
  await request("/team-invitations/accept", person, { token });
}

async function toggleInterviewer(page, dialog, displayName) {
  await dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").getByTitle(displayName, { exact: true }).click();
  await page.keyboard.press("Escape");
}

function interviewerField(dialog) {
  return dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true })
    .locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-select ')][1]");
}

async function saveEdit(page, dialog, endpoint) {
  const response = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(endpoint));
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  assert.equal((await response).status(), 200);
}

async function hiringSectionHasDivider(dialog, picker) {
  const section = picker.locator("xpath=ancestor::section[1]");
  assert.equal(await section.count(), 1, "hiring field has one visually separated section");
  const border = await section.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.borderTopStyle, width: parseFloat(style.borderTopWidth) };
  });
  assert.notEqual(border.style, "none", "section keeps the subtle separator");
  assert.ok(border.width > 0, "separator is visible");
}

test("team creation and edit share a Participants heading and both interviewer and external hiring fields", async () => {
  const f = await fixture(true);
  try {
    const creation = f.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await creation.getByRole("heading", { name: "Участники", exact: true }).waitFor();
    await creation.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).waitFor();
    await creation.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).waitFor();
    assert.equal(await creation.getByRole("heading", { name: /нанимающ/i }).count(), 0, "one hiring field does not have a duplicate heading");
    await hiringSectionHasDivider(creation, creation.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }));
    await creation.getByRole("button", { name: "Отмена", exact: true }).click();
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Единые участники", selectedTaskIds: [] });
    await f.page.reload();
    await f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const edit = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await edit.getByLabel("Название интервью", { exact: true }).waitFor();
    assert.equal(await edit.getByRole("heading", { name: "Участники", exact: true }).count(), 1, "team editor has the same Participants heading as creation");
    assert.equal(await edit.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).count(), 1, "team editor can select other interviewers");
    await edit.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).waitFor();
    assert.equal(await edit.getByRole("heading", { name: /нанимающ/i }).count(), 0, "external hiring is a labeled field rather than its own duplicate heading");
    await hiringSectionHasDivider(edit, edit.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }));
  } finally { await f.browser.close(); }
});

test("personal creation and edit keep generic hiring as a single labeled field with a divider and no duplicate heading", async () => {
  const f = await fixture();
  try {
    await f.page.goto(`${web}/workspace/personal/interviews/new`);
    const creation = f.page.getByRole("dialog", { name: "Создать интервью", exact: true });
    const createPicker = creation.getByRole("combobox", { name: "Нанимающий", exact: true });
    await createPicker.waitFor();
    assert.equal(await creation.getByRole("heading", { name: /нанимающ|Участники/i }).count(), 0);
    await hiringSectionHasDivider(creation, createPicker);
    await creation.getByRole("button", { name: "Отмена", exact: true }).click();
    await request("/rooms", f.auth, { title: "Личное поле нанимающего", language: "nodejs", taskIds: [] });
    await f.page.reload();
    await f.page.getByRole("button", { name: "Редактировать интервью Личное поле нанимающего", exact: true }).click();
    const edit = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    const editPicker = edit.getByRole("combobox", { name: "Нанимающий", exact: true });
    await editPicker.waitFor();
    assert.equal(await edit.getByRole("heading", { name: /нанимающ|Участники/i }).count(), 0, "personal hiring does not repeat its label as a heading");
    assert.equal(await edit.getByRole("combobox", { name: /внешн|Другие интервьюеры|Трек|Вакансия/i }).count(), 0, "personal form retains its current scope");
    await hiringSectionHasDivider(edit, editPicker);
  } finally { await f.browser.close(); }
});

test("team editor adds replaces and clears other interviewers on save and reload without losing hiring tasks or context", { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const first = await account("Первый интервьюер редактора");
    const second = await account("Второй интервьюер редактора");
    const hiring = await account("Сохранённый внешний нанимающий", true);
    await teamMember(f.auth, f.team, first);
    await teamMember(f.auth, f.team, second);
    const { task } = await request(`/teams/${f.team.id}/tasks`, f.auth, { title: "Задача сохраняемого интервью", description: "Условие", starterCode: "return 1", language: "nodejs" });
    const { track } = await request(`/teams/${f.team.id}/tracks`, f.auth, { name: "Трек с участниками" });
    const { vacancy } = await request(`/teams/${f.team.id}/tracks/${track.id}/vacancies`, f.auth, { title: "Вакансия с участниками" });
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Редактор участников", selectedTaskIds: [task.id], hiringManagerIds: [hiring.user.id] });
    const original = (await request(`/teams/${f.team.id}/interviews`, f.auth)).items.find(item => item.id === interview.id);
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    await f.page.reload();
    await f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).waitFor();
    await toggleInterviewer(f.page, dialog, first.user.displayName);
    await dialog.getByLabel("Название интервью", { exact: true }).fill("Сохранённые участники");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Кандидат с участниками");
    await choose(f.page, dialog, "Трек интервью", track.name);
    await choose(f.page, dialog, "Вакансия", vacancy.title);
    assert.deepEqual((await request(endpoint, f.auth)).interviewerIds, [], "selection remains a draft before Save");
    await saveEdit(f.page, dialog, endpoint);
    let details = await request(endpoint, f.auth);
    assert.deepEqual(details.interviewerIds, [first.user.id]);
    assert.deepEqual([details.title, details.candidateName, details.trackId, details.vacancyId], ["Сохранённые участники", "Кандидат с участниками", track.id, vacancy.id]);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await f.page.reload();
    await f.page.getByRole("button", { name: "Редактировать интервью Сохранённые участники", exact: true }).click();
    await interviewerField(dialog).getByText(first.user.displayName, { exact: true }).waitFor();
    await toggleInterviewer(f.page, dialog, first.user.displayName);
    await toggleInterviewer(f.page, dialog, second.user.displayName);
    await saveEdit(f.page, dialog, endpoint);
    assert.deepEqual((await request(endpoint, f.auth)).interviewerIds, [second.user.id]);
    await toggleInterviewer(f.page, dialog, second.user.displayName);
    await saveEdit(f.page, dialog, endpoint);
    details = await request(endpoint, f.auth);
    assert.deepEqual(details.interviewerIds, []);
    const current = (await request(`/teams/${f.team.id}/interviews`, f.auth)).items.find(item => item.id === interview.id);
    assert.deepEqual(current.tasks, original.tasks, "participant edits preserve existing tasks and their snapshot");
    assert.deepEqual(current.assignees.filter(person => person.role === "owner").map(person => person.userId), [f.auth.user.id], "other interviewers cannot replace the owner");
    assert.deepEqual((await request(`/rooms/${interview.inviteCode}/hr-managers`, f.auth)).map(person => person.userId), [hiring.user.id], "ordinary interviewer edits preserve external hiring access");
    assert.deepEqual([details.trackId, details.vacancyId], [track.id, vacancy.id]);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await f.page.reload();
    const card = f.page.getByRole("region", { name: "Командное интервью Сохранённые участники", exact: true });
    const participants = card.getByText(/^Интервьюеры:/);
    await participants.waitFor();
    const names = await participants.textContent();
    assert.ok(names.includes(f.auth.user.displayName), "room owner remains visible");
    assert.ok(names.includes(hiring.user.displayName), "external hiring access remains visible in the existing participant projection");
    assert.ok(!names.includes(first.user.displayName) && !names.includes(second.user.displayName), "cleared ordinary interviewers are absent after reload");
  } finally { await f.browser.close(); }
});

test("team interviewer drafts cancel safely survive network errors and reload conflicting assignments", { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const first = await account("Отменяемый интервьюер");
    const second = await account("Интервьюер другого редактора");
    await teamMember(f.auth, f.team, first);
    await teamMember(f.auth, f.team, second);
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Черновик участников", selectedTaskIds: [] });
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    await f.page.reload();
    const trigger = f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true });
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await trigger.click();
    await toggleInterviewer(f.page, dialog, first.user.displayName);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.deepEqual((await request(endpoint, f.auth)).interviewerIds, [], "Cancel does not submit interviewer changes");
    await trigger.click();
    await dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).waitFor();
    assert.equal(await interviewerField(dialog).getByText(first.user.displayName, { exact: true }).count(), 0, "canceled selection is not restored");
    await toggleInterviewer(f.page, dialog, first.user.displayName);
    await f.page.route(`**/api${endpoint}`, route => route.request().method() === "PATCH" ? route.abort("failed") : route.continue(), { times: 1 });
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByText("Ошибка сети. Проверьте подключение и повторите попытку.", { exact: true }).waitFor();
    await interviewerField(dialog).getByText(first.user.displayName, { exact: true }).waitFor();
    assert.deepEqual((await request(endpoint, f.auth)).interviewerIds, []);
    const snapshot = await request(endpoint, f.auth);
    await request(endpoint, f.auth, { title: snapshot.title, candidateName: snapshot.candidateName, position: snapshot.position, scheduledAt: snapshot.scheduledAt, revision: snapshot.revision, interviewerIds: [second.user.id] }, "PATCH");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).waitFor();
    await interviewerField(dialog).getByText(first.user.displayName, { exact: true }).waitFor();
    assert.deepEqual((await request(endpoint, f.auth)).interviewerIds, [second.user.id], "stale Save never overwrites the other editor's assignment");
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).click();
    await interviewerField(dialog).getByText(second.user.displayName, { exact: true }).waitFor();
    assert.equal(await interviewerField(dialog).getByText(first.user.displayName, { exact: true }).count(), 0);
    await toggleInterviewer(f.page, dialog, second.user.displayName);
    await toggleInterviewer(f.page, dialog, first.user.displayName);
    await saveEdit(f.page, dialog, endpoint);
    assert.deepEqual((await request(endpoint, f.auth)).interviewerIds, [first.user.id]);
  } finally { await f.browser.close(); }
});

test("team member editor retains its own interviewer assignment and excludes the current room owner", { timeout: 60_000 }, async () => {
  const f = await fixture();
  let memberContext;
  try {
    const member = await account("Назначенный участник редактора");
    await teamMember(f.auth, f.team, member);
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Назначение текущего редактора", selectedTaskIds: [], interviewerIds: [member.user.id] });
    memberContext = await f.browser.newContext({ viewport: { width: 1366, height: 850 } });
    await memberContext.addInitScript(({ token, user }) => { localStorage.setItem("auth_token", token); localStorage.setItem("auth_user", JSON.stringify(user)); }, member);
    const page = await memberContext.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(`${web}/workspace/teams/${f.team.id}/interviews`);
    await page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await interviewerField(dialog).getByText(member.user.displayName, { exact: true }).waitFor();
    await dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).click();
    const options = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
    await options.filter({ hasText: member.user.displayName }).waitFor();
    assert.equal(await options.filter({ hasText: f.auth.user.displayName }).count(), 0, "selector excludes the actual room owner, not the member who is editing");
    await page.keyboard.press("Escape");
    await dialog.getByLabel("Позиция", { exact: true }).fill("Сведения активного участника");
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    await saveEdit(page, dialog, endpoint);
    const details = await request(endpoint, member);
    assert.deepEqual(details.interviewerIds, [member.user.id]);
    assert.equal(details.ownerUserId, f.auth.user.id);
    assert.equal(details.position, "Сведения активного участника");
  } finally { await memberContext?.close(); await f.browser.close(); }
});

test("team editor resolves a selected interviewer on a later catalog page by name and retains it on metadata save", { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const member = await account("Интервьюер второй страницы");
    await teamMember(f.auth, f.team, member);
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Все страницы интервьюеров", selectedTaskIds: [], interviewerIds: [member.user.id] });
    const catalog = await request(`/teams/${f.team.id}/members?page=0&size=100&state=ACTIVE`, f.auth);
    const ownerItem = catalog.items.find(item => item.userId === f.auth.user.id);
    const memberItem = catalog.items.find(item => item.userId === member.user.id);
    assert.ok(ownerItem && memberItem, "real memberships seed both virtual catalog pages");
    await f.page.route(`**/api/teams/${f.team.id}/members?*`, route => {
      const page = Number(new URL(route.request().url()).searchParams.get("page"));
      return route.fulfill({ status: 200, json: { ...catalog, items: page === 0 ? [ownerItem] : [memberItem], page, size: 100, totalElements: 2, totalPages: 2 } });
    });
    await f.page.reload();
    await f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await interviewerField(dialog).getByText(member.user.displayName, { exact: true }).waitFor();
    assert.equal(await dialog.getByText(member.user.id, { exact: true }).count(), 0, "selected interviewer is displayed by name, never raw UUID");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Кандидат второго каталога");
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    await saveEdit(f.page, dialog, endpoint);
    const details = await request(endpoint, f.auth);
    assert.deepEqual(details.interviewerIds, [member.user.id], "saving metadata does not drop later-page selections");
    assert.equal(details.candidateName, "Кандидат второго каталога");
  } finally { await f.browser.close(); }
});

test("unavailable interviewer validation preserves editable metadata and participant drafts for correction", { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const valid = await account("Доступный интервьюер черновика");
    const unavailable = await account("Недоступный интервьюер черновика");
    await teamMember(f.auth, f.team, valid);
    await teamMember(f.auth, f.team, unavailable);
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Исправляемые участники", selectedTaskIds: [] });
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    await f.page.reload();
    await f.page.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await toggleInterviewer(f.page, dialog, valid.user.displayName);
    await toggleInterviewer(f.page, dialog, unavailable.user.displayName);
    await dialog.getByLabel("Название интервью", { exact: true }).fill("Исправляемый черновик названия");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Исправляемый черновик кандидата");
    await f.page.route(`**/api${endpoint}`, route => route.request().method() === "PATCH"
      ? route.fulfill({ status: 404, json: { code: "TEAM_MEMBER_NOT_FOUND", message: "Участник команды не найден" } })
      : route.continue(), { times: 1 });
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByLabel("Название интервью", { exact: true }).count(), 1, "missing selected member is a correctable selection error, not loss of interview access");
    assert.equal(await dialog.getByLabel("Название интервью", { exact: true }).inputValue(), "Исправляемый черновик названия");
    assert.equal(await dialog.getByLabel("Имя кандидата", { exact: true }).inputValue(), "Исправляемый черновик кандидата");
    await interviewerField(dialog).getByText(valid.user.displayName, { exact: true }).waitFor();
    await interviewerField(dialog).getByText(unavailable.user.displayName, { exact: true }).waitFor();
    const catalog = await request(`/teams/${f.team.id}/members?page=0&size=100&state=ACTIVE`, f.auth);
    const staleMember = catalog.items.find(item => item.userId === unavailable.user.id);
    assert.ok(staleMember, "selected member is currently in the team before its removal");
    await request(`/teams/${f.team.id}/members/${unavailable.user.id}`, f.auth, { revision: staleMember.revision }, "DELETE");
    const rejected = f.page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(endpoint));
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    const response = await rejected;
    assert.equal(response.status(), 404, "server rejects a member removed after catalog loading");
    assert.equal((await response.json()).code, "TEAM_MEMBER_NOT_FOUND");
    assert.equal(await dialog.getByLabel("Название интервью", { exact: true }).inputValue(), "Исправляемый черновик названия");
    await interviewerField(dialog).getByText(valid.user.displayName, { exact: true }).waitFor();
    await toggleInterviewer(f.page, dialog, unavailable.user.displayName);
    await saveEdit(f.page, dialog, endpoint);
    const details = await request(endpoint, f.auth);
    assert.deepEqual(details.interviewerIds, [valid.user.id]);
    assert.deepEqual([details.title, details.candidateName], ["Исправляемый черновик названия", "Исправляемый черновик кандидата"]);
  } finally { await f.browser.close(); }
});

test("team editor adds changes and clears track and vacancy, retaining the context draft through network errors and conflicts", async () => {
  const f = await fixture();
  try {
    const { track } = await request(`/teams/${f.team.id}/tracks`, f.auth, { name: "Backend редактора" });
    const { vacancy } = await request(`/teams/${f.team.id}/tracks/${track.id}/vacancies`, f.auth, { title: "Kotlin редактора" });
    const { track: otherTrack } = await request(`/teams/${f.team.id}/tracks`, f.auth, { name: "Frontend редактора" });
    const { vacancy: otherVacancy } = await request(`/teams/${f.team.id}/tracks/${otherTrack.id}/vacancies`, f.auth, { title: "React редактора" });
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Редактирование контекста", selectedTaskIds: [] });
    await f.page.reload();
    await f.page.getByRole("button", { name: "Редактировать интервью Редактирование контекста", exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await choose(f.page, dialog, "Трек интервью", track.name);
    await choose(f.page, dialog, "Вакансия", vacancy.title);
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    await f.page.route(`**/api${endpoint}`, route => route.request().method() === "PATCH" ? route.abort("failed") : route.continue(), { times: 1 });
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByText("Ошибка сети. Проверьте подключение и повторите попытку.", { exact: true }).waitFor();
    assert.match(await dialog.textContent(), new RegExp(vacancy.title));
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await f.page.getByText("Интервью сохранено", { exact: true }).waitFor();
    let details = await request(endpoint, f.auth);
    assert.deepEqual([details.trackId, details.vacancyId], [track.id, vacancy.id]);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await f.page.reload();
    await f.page.getByRole("button", { name: "Редактировать интервью Редактирование контекста", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Трек интервью", exact: true }).waitFor();
    assert.match(await dialog.textContent(), new RegExp(vacancy.title));
    await choose(f.page, dialog, "Трек интервью", otherTrack.name);
    assert.ok((await dialog.textContent()).includes("Без вакансии"), "changing track resets the previous vacancy");
    await choose(f.page, dialog, "Вакансия", otherVacancy.title);
    await request(endpoint, f.auth, { title: details.title, candidateName: "Другой менеджер", position: details.position, scheduledAt: details.scheduledAt, revision: details.revision }, "PATCH");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).waitFor();
    assert.match(await dialog.textContent(), new RegExp(otherVacancy.title));
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).click();
    await f.page.waitForFunction(name => [...document.querySelectorAll("input")].some(input => input.value === name), "Другой менеджер");
    assert.match(await dialog.textContent(), new RegExp(vacancy.title));
    await choose(f.page, dialog, "Трек интервью", otherTrack.name);
    await choose(f.page, dialog, "Вакансия", otherVacancy.title);
    const changedResponse = f.page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(endpoint));
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    const changed = await changedResponse;
    assert.equal(changed.status(), 200);
    details = await request(endpoint, f.auth);
    assert.deepEqual([details.trackId, details.vacancyId], [otherTrack.id, otherVacancy.id]);
    await choose(f.page, dialog, "Трек интервью", "Без трека");
    const saved = f.page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(endpoint));
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    assert.equal((await saved).status(), 200);
    details = await request(endpoint, f.auth);
    assert.deepEqual([details.trackId, details.vacancyId], [null, null]);
    const { items } = await request(`/teams/${f.team.id}/interviews`, f.auth);
    assert.equal(items[0].tasks.length, 0, "context editing does not import a programme or replace interview tasks");
  } finally { await f.browser.close(); }
});

test("team editor retains historical archived context and retries a failed track catalog without losing metadata", async () => {
  const f = await fixture();
  try {
    const { track } = await request(`/teams/${f.team.id}/tracks`, f.auth, { name: "Исторический трек" });
    const { vacancy } = await request(`/teams/${f.team.id}/tracks/${track.id}/vacancies`, f.auth, { title: "Историческая вакансия" });
    const { interview } = await request(`/teams/${f.team.id}/interviews`, f.auth, { title: "Историческое интервью", trackId: track.id, vacancyId: vacancy.id, selectedTaskIds: [] });
    await request(`/teams/${f.team.id}/tracks/${track.id}/archive`, f.auth, {}, "POST");
    await f.page.reload();
    const catalogRoute = `**/api/teams/${f.team.id}/tracks**`;
    await f.page.route(catalogRoute, route => route.fulfill({ status: 503, json: { message: "temporary unavailable" } }));
    await f.page.getByRole("button", { name: "Редактировать интервью Историческое интервью", exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await dialog.getByRole("button", { name: "Повторить", exact: true }).waitFor();
    await f.page.unroute(catalogRoute);
    await dialog.getByRole("button", { name: "Повторить", exact: true }).click();
    await dialog.getByLabel("Имя кандидата", { exact: true }).waitFor();
    assert.ok((await dialog.textContent()).includes("Исторический трек (архив)"));
    assert.ok((await dialog.textContent()).includes("Историческая вакансия (архив)"));
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Исторический кандидат");
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    const saved = f.page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(endpoint));
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    assert.equal((await saved).status(), 200);
    const details = await request(endpoint, f.auth);
    assert.deepEqual([details.trackId, details.vacancyId, details.candidateName], [track.id, vacancy.id, "Исторический кандидат"]);
  } finally { await f.browser.close(); }
});

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
      await route.abort("failed");
    }, { times: 1 });
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    await dialog.getByText("Ошибка сети. Проверьте подключение и повторите попытку.", { exact: true }).waitFor();
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
    await f.page.route(`**/api/teams/${f.team.id}/interviews/${interview.id}/details`, route => route.request().method() === "PATCH" ? route.abort("failed") : route.continue(), { times: 1 });
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    await dialog.getByText("Ошибка сети. Проверьте подключение и повторите попытку.", { exact: true }).waitFor();
    assert.equal(await title.inputValue(), "Единое изменение"); assert.equal(await name.inputValue(), "Кандидат редактора");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await f.page.getByText("Интервью сохранено", { exact: true }).waitFor();
    const endpoint = `/teams/${f.team.id}/interviews/${interview.id}/details`;
    let details = await request(endpoint, f.auth);
    assert.deepEqual([details.title, details.candidateName, details.position, details.scheduledAt], ["Единое изменение", "Кандидат редактора", "Kotlin инженер", "2030-10-12T11:30:00Z"]);
    assert.ok(f.page.url().endsWith(`/workspace/teams/${f.team.id}/interviews`));
    await request(endpoint, f.auth, { title: "Другой менеджер", candidateName: "Другой кандидат", position: details.position, scheduledAt: details.scheduledAt, revision: details.revision }, "PATCH");
    await title.fill("Черновик названия"); await name.fill("Черновик кандидата");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).waitFor();
    assert.equal(await title.inputValue(), "Черновик названия"); assert.equal(await name.inputValue(), "Черновик кандидата");
    await dialog.getByRole("button", { name: "Загрузить актуальные сведения", exact: true }).click();
    await f.page.waitForFunction(() => [...document.querySelectorAll("input")].some(el => el.value === "Другой менеджер"));
    assert.equal(await name.inputValue(), "Другой кандидат");
    const hr = await request("/auth/register", null, { nickname: `external_${randomUUID().slice(0,12)}`, displayName: "Внешний нанимающий редактора", password: "test-password-123", isHr: true });
    await dialog.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).fill(hr.user.nickname);
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
    assert.equal(await dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).count(), 0, "401 must clear participant editing too");
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
