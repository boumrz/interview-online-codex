import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const web = process.env.E2E_BASE_URL || "http://localhost:5185";
const userId = "00000000-0000-4000-8000-000000000001";
const externalId = "00000000-0000-4000-8000-000000000099";
const teamId = "00000000-0000-4000-8000-000000000010";
const tracks = [
  { id: "frontend", name: "Frontend", status: "ACTIVE", revision: 1, programme: null, vacancies: [
    { id: "react", title: "React developer", status: "ACTIVE", revision: 1, programme: null },
    { id: "vue", title: "Vue developer", status: "ACTIVE", revision: 1, programme: null },
  ] },
  { id: "backend", name: "Backend", status: "ACTIVE", revision: 1, programme: null, vacancies: [
    { id: "kotlin", title: "Kotlin developer", status: "ACTIVE", revision: 1, programme: null },
  ] },
];
const archivedTracks = [
  { ...tracks[0], vacancies: [{ id: "old-react", title: "React legacy", status: "ARCHIVED", revision: 1, programme: null }] },
  { id: "qa", name: "QA", status: "ARCHIVED", revision: 1, programme: null, vacancies: [{ id: "old-qa", title: "QA engineer", status: "ARCHIVED", revision: 1, programme: null }] },
];

function interview(overrides = {}) {
  return {
    id: "interview-react", teamId, roomId: "room-react", inviteCode: "react-link", title: "React interview",
    taskCount: 0, tasks: [], taskScores: [], assignees: [],
    trackId: "frontend", trackName: "Frontend", vacancyId: "react", vacancyTitle: "React developer",
    createdByUserId: externalId, ownerUserId: externalId, ownershipState: "OWNED", programmeVersion: null,
    createdAt: "2026-09-28T09:00:00Z", finishedAt: null, status: "active", verdict: null, verdictComment: null,
    candidateName: "Ирина", position: "React developer", scheduledAt: null, archivedAt: null,
    interviewState: "active", effectiveAt: "2026-09-28T09:00:00Z", dateSource: "created",
    ...overrides,
  };
}

async function fixture(path, { role = "MEMBER", isHr = false } = {}) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const user = { id: userId, nickname: "teammate", displayName: "Участник команды", role: "user", isHr };
    const team = { id: teamId, name: "Команда разработки", role, epoch: 1, revision: 1, capabilities: [] };
    const requests = [];
    const rows = [interview(), interview({ id: "interview-vue", roomId: "room-vue", title: "Vue interview", candidateName: "Пётр", vacancyId: "vue", vacancyTitle: "Vue developer" }),
      interview({ id: "interview-kotlin", roomId: "room-kotlin", title: "Kotlin interview", candidateName: "Анна", trackId: "backend", trackName: "Backend", vacancyId: "kotlin", vacancyTitle: "Kotlin developer" }),
      interview({ id: "interview-legacy", roomId: "room-legacy", title: "React legacy interview", candidateName: "Дмитрий", vacancyId: "old-react", vacancyTitle: "React legacy" }),
      interview({ id: "interview-qa", roomId: "room-qa", title: "QA interview", candidateName: "Светлана", trackId: "qa", trackName: "QA", vacancyId: "old-qa", vacancyTitle: "QA engineer" })];
    await context.addInitScript(() => { localStorage.setItem("auth_token", "business-ui-fixture"); });
    await context.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ url, method: request.method(), body: request.postDataJSON() });
      let body;
      let status = 200;
      const scoped = rows.filter(row => (!url.searchParams.get("trackId") || row.trackId === url.searchParams.get("trackId"))
        && (!url.searchParams.get("vacancyId") || row.vacancyId === url.searchParams.get("vacancyId")));
      if (url.pathname === "/api/me/profile") body = user;
      else if (url.pathname === "/api/me/workspaces") body = [{ id: "personal", name: "Личное пространство", role: "OWNER", epoch: 1, capabilities: [] }, team];
      else if (url.pathname === `/api/teams/${teamId}`) body = team;
      else if (url.pathname === `/api/teams/${teamId}/tracks`) body = { items: url.searchParams.get("status") === "archived" ? archivedTracks : tracks, counts: { activeTracks: 2, archivedTracks: 1, activeVacancies: 3, archivedVacancies: 2 } };
      else if (url.pathname === `/api/teams/${teamId}/members`) body = { items: [{ userId, displayName: user.displayName, role, state: "ACTIVE", revision: 1 }], page: 0, size: Number(url.searchParams.get("size")), totalElements: 1, totalPages: 1 };
      else if (url.pathname === `/api/teams/${teamId}/interview-owner-offers`) body = { items: [] };
      else if (url.pathname === `/api/teams/${teamId}/interviews`) body = { items: url.searchParams.get("ownership") === "orphaned" ? [] : scoped };
      else if (url.pathname === `/api/teams/${teamId}/tasks`) body = { items: [{ id: "task-one", title: "Проверка массива", description: "Условие", starterCode: "", language: "nodejs", status: "ACTIVE", revision: 1, createdByUserId: userId }] };
      else if (url.pathname === `/api/teams/${teamId}/task-sets`) body = { items: [{ id: "set-one", name: "Базовый набор", revision: 1, createdByUserId: userId, items: [{ taskId: "task-one", title: "Проверка массива", position: 0 }] }] };
      else if (url.pathname === `/api/teams/${teamId}/invitations`) body = { items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
      else if (url.pathname === "/api/me/hiring-manager-options") body = [{ normalizedId: userId, displayName: user.displayName }];
      else if (url.pathname === "/api/me/hiring-manager-preview") {
        const incoming = request.postDataJSON();
        if (incoming.invitationId === userId && incoming.teamId === teamId) { status = 400; body = { error: "Участники команды уже имеют доступ ко всем кандидатам" }; }
        else body = { normalizedId: incoming.invitationId, displayName: incoming.invitationId === userId ? user.displayName : "Внешний нанимающий" };
      }
      else if (url.pathname === "/api/me/hr/rooms") body = { items: scoped, page: Number(url.searchParams.get("page")), size: 20, totalElements: scoped.length, totalPages: scoped.length ? 1 : 0, timezone: "Europe/Moscow", from: null, to: null };
      else if (url.pathname === "/api/me/hr/rooms/export") {
        await route.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "Content-Disposition": "attachment; filename=hr-interviews-fixture.xlsx", "X-Export-Count": String(scoped.length) }, body: Buffer.from("PK-test-workbook") });
        return;
      }
      else if (url.pathname.startsWith("/api/me/hr/rooms/")) body = rows.find(row => row.roomId === url.pathname.split("/").at(-1));
      else { status = 404; body = { error: `Unexpected fixture request ${url.pathname}` }; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${web}/workspace/teams/${teamId}/${path}`, { waitUntil: "domcontentloaded" });
    if (path === "interviews/new") {
      await page.getByRole("dialog", { name: "Создать интервью", exact: true }).getByRole("textbox", { name: "Название интервью", exact: true }).waitFor();
    } else if (path === "members") {
      await page.getByRole("heading", { name: "Настройки команды", exact: true }).waitFor();
      await page.getByRole("table", { name: "Состав команды", exact: true }).getByRole("row").filter({ hasText: "Участник команды" }).waitFor();
    } else if (path === "candidates") {
      await page.getByRole("heading", { name: "Кандидаты и интервью", exact: true }).waitFor();
      await page.getByRole("row").filter({ hasText: "Ирина" }).waitFor();
    } else if (path === "library") {
      await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
      await page.getByRole("region", { name: "Командная задача Проверка массива", exact: true }).waitFor();
    } else {
      await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
      await page.getByRole("region", { name: "Командное интервью React interview", exact: true }).waitFor();
    }
    return { browser, context, page, requests };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function selectOption(page, label, option) {
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.locator("xpath=ancestor-or-self::div[contains(concat(' ',normalize-space(@class),' '),' ant-select ')][1]").locator(".ant-select-content").click();
  await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: option }).first().click();
}

async function waitForModalGeometry(locator) {
  await locator.evaluate(async (node) => {
    const wrap = node.closest(".ant-modal-wrap");
    if (!wrap) return;
    const modal = node.closest(".ant-modal") ?? wrap.querySelector(".ant-modal");
    const deadline = performance.now() + 5_000;
    let stableFrames = 0;
    let previousBounds;
    while (performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // Visible fields can precede rc-motion PREPARE/START and the zoom entry.
      const inMotionPhase = [...(modal?.classList ?? [])].some((name) =>
        /-(appear|enter|leave)(?:-(prepare|start|active))?$/.test(name));
      const hasAnimation = wrap.getAnimations({ subtree: true }).some((animation) =>
        Number.isFinite(animation.effect?.getComputedTiming().endTime)
        && (animation.pending || animation.playState === "running" || animation.playState === "paused"));
      const rect = modal?.getBoundingClientRect();
      const bounds = rect && [rect.left, rect.top, rect.width, rect.height];
      const unchanged = bounds && previousBounds
        && bounds.every((value, index) => Math.abs(value - previousBounds[index]) < 0.1);
      stableFrames = !inMotionPhase && !hasAnimation && rect?.width > 0 && rect?.height > 0 && unchanged
        ? stableFrames + 1 : 0;
      previousBounds = bounds;
      if (stableFrames >= 2) return;
    }
    throw new Error("MODAL_ENTRY_GEOMETRY_DID_NOT_SETTLE");
  });
}

test("non-hiring team member can open candidates, results and Excel", async () => {
  const { browser, page, requests } = await fixture("candidates");
  try {
    await page.getByRole("heading", { name: "Кандидаты и интервью", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Кандидаты", exact: true }).count(), 1);
    await page.getByRole("row").filter({ hasText: "Ирина" }).getByRole("button", { name: "Результаты", exact: true }).click();
    await page.getByRole("dialog", { name: "Результаты интервью", exact: true }).getByRole("heading", { name: "Ирина", exact: true }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).last().click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    assert.equal(await (await download).failure(), null);
    assert.equal(requests.find(entry => entry.url.pathname === "/api/me/hr/rooms/export").url.searchParams.get("teamId"), teamId);
  } finally { await browser.close(); }
});

test("member directory and safe team settings open through the team gear, including old links", async () => {
  const { browser, page } = await fixture("members");
  try {
    await page.waitForURL(`**/workspace/teams/${teamId}/settings`);
    await page.getByRole("heading", { name: "Настройки команды", exact: true }).waitFor();
    await page.getByText("Состав команды", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Поиск участников", exact: true }).count(), 0);
    await page.getByRole("table", { name: "Состав команды", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Участники", exact: true }).count(), 0);
    assert.equal(await page.getByRole("navigation").getByRole("link", { name: "Настройки команды", exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "Настройки команды", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Переименовать команду", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Выпустить ссылку", exact: true }).count(), 0);
  } finally { await browser.close(); }
});

test("all team members can open and manage interview cards without an individual assignment", async () => {
  const { browser, page } = await fixture("interviews");
  try {
    const card = page.getByRole("region", { name: "Командное интервью React interview", exact: true });
    await card.getByRole("link", { name: "Открыть комнату React interview", exact: true }).waitFor();
    assert.equal(await card.getByRole("button", { name: "Редактировать интервью React interview", exact: true }).count(), 1);
    assert.equal(await card.getByRole("button", { name: "Удалить интервью React interview", exact: true }).count(), 1);
    assert.equal(await card.getByRole("button", { name: "Копировать ссылку для кандидата", exact: true }).count(), 1);
  } finally { await browser.close(); }
});

test("interview track and vacancy filters change server queries and reset the dependent vacancy", async () => {
  const { browser, page, requests } = await fixture("interviews");
  try {
    await selectOption(page, "Фильтр по треку", "Frontend");
    await page.getByRole("region", { name: "Командное интервью Kotlin interview", exact: true }).waitFor({ state: "hidden" });
    await selectOption(page, "Фильтр по вакансии", "React developer");
    await page.getByRole("region", { name: "Командное интервью Vue interview", exact: true }).waitFor({ state: "hidden" });
    assert.ok(requests.some(entry => entry.url.pathname === `/api/teams/${teamId}/interviews` && entry.url.searchParams.get("trackId") === "frontend" && entry.url.searchParams.get("vacancyId") === "react"));
    await selectOption(page, "Фильтр по треку", "Backend");
    await page.getByRole("region", { name: "Командное интервью Kotlin interview", exact: true }).waitFor();
    const last = requests.filter(entry => entry.url.pathname === `/api/teams/${teamId}/interviews` && !entry.url.searchParams.has("ownership")).at(-1);
    assert.equal(last.url.searchParams.get("trackId"), "backend");
    assert.equal(last.url.searchParams.has("vacancyId"), false);
  } finally { await browser.close(); }
});

test("candidate track and vacancy filters are carried into Excel export", async () => {
  const { browser, page, requests } = await fixture("candidates", { isHr: true });
  try {
    await selectOption(page, "Фильтр по треку", "Frontend");
    await selectOption(page, "Фильтр по вакансии", "React developer");
    await page.getByRole("row").filter({ hasText: "Анна" }).waitFor({ state: "hidden" });
    await page.getByRole("row").filter({ hasText: "Пётр" }).waitFor({ state: "hidden" });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    await download;
    const exported = requests.find(entry => entry.url.pathname === "/api/me/hr/rooms/export");
    assert.equal(exported.url.searchParams.get("trackId"), "frontend");
    assert.equal(exported.url.searchParams.get("vacancyId"), "react");
  } finally { await browser.close(); }
});

test("team interview hiring invitations use only external UUID and reject a team member", async () => {
  const { browser, page, requests } = await fixture("interviews/new", { isHr: true });
  try {
    const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("combobox", { name: "Нанимающие из команды", exact: true }).count(), 0);
    const idInput = dialog.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
    await idInput.fill(userId);

    await dialog.getByRole("alert").filter({ hasText: "Участники команды уже имеют доступ" }).waitFor();
    assert.equal(requests.filter(entry => entry.url.pathname === "/api/me/hiring-manager-options").length, 0);
    await idInput.fill(externalId);
    await page.locator(".ant-select-item-option").filter({ hasText: "Внешний нанимающий" }).click();
    await dialog.getByText("Внешний нанимающий", { exact: true }).waitFor();
    assert.equal(requests.filter(entry => entry.url.pathname === "/api/me/hiring-manager-preview").at(-1).body.teamId, teamId);
  } finally { await browser.close(); }
});

test("historical filters merge archived vacancies into an active track and include archived tracks", async () => {
  const { browser, page } = await fixture("interviews");
  try {
    await selectOption(page, "Фильтр по треку", "Frontend");
    await selectOption(page, "Фильтр по вакансии", "React legacy (в архиве)");
    await page.getByRole("region", { name: "Командное интервью React interview", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("region", { name: "Командное интервью React legacy interview", exact: true }).waitFor();
    await selectOption(page, "Фильтр по треку", "QA (в архиве)");
    await selectOption(page, "Фильтр по вакансии", "QA engineer (в архиве)");
    await page.getByRole("region", { name: "Командное интервью React legacy interview", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("region", { name: "Командное интервью QA interview", exact: true }).waitFor();
    await selectOption(page, "Фильтр по треку", "Все треки");
    await page.getByRole("region", { name: "Командное интервью React interview", exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "Фильтр по вакансии", exact: true }).isDisabled(), false);
  } finally { await browser.close(); }
});

test("changing candidate filters cancels an in-progress export and allows a fresh download", async () => {
  const { browser, page, requests } = await fixture("candidates");
  let release;
  let signalStarted;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signalStarted = resolve; });
  try {
    await page.route("**/api/me/hr/rooms/export*", async route => {
      signalStarted();
      await gate;
      try {
        await route.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "Content-Disposition": "attachment; filename=hr-interviews-old.xlsx" }, body: Buffer.from("PK-old-filter-workbook") });
      } catch (error) {
        if (!/already handled|aborted/i.test(String(error))) throw error;
      }
    }, { times: 1 });
    const downloads = [];
    page.on("download", download => downloads.push(download));
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    await started;
    await selectOption(page, "Фильтр по треку", "Backend");
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).waitFor();
    release();
    await page.waitForLoadState("networkidle");
    assert.equal(downloads.length, 0, "The old filter's workbook must not download after cancellation");
    const freshDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать Excel", exact: true }).click();
    await freshDownload;
    assert.equal(requests.filter(entry => entry.url.pathname === "/api/me/hr/rooms/export").at(-1).url.searchParams.get("trackId"), "backend");
  } finally { release(); await browser.close(); }
});

test("vacancies can filter all tracks independently and asynchronously", async () => {
  const { browser, page, requests } = await fixture("interviews");
  try {
    assert.equal(await page.getByRole("combobox", { name: "Фильтр по вакансии", exact: true }).isDisabled(), false);
    await selectOption(page, "Фильтр по вакансии", "Kotlin developer");
    await page.getByRole("region", { name: "Командное интервью Kotlin interview", exact: true }).waitFor();
    await page.getByRole("region", { name: "Командное интервью React interview", exact: true }).waitFor({ state: "hidden" });
    const request = requests.filter(item => item.url.pathname === `/api/teams/${teamId}/interviews` && !item.url.searchParams.has("ownership")).at(-1);
    assert.equal(request.url.searchParams.get("vacancyId"), "kotlin");
    assert.equal(request.url.searchParams.has("trackId"), false);
    await selectOption(page, "Фильтр по вакансии", "Все вакансии");
    await page.getByRole("region", { name: "Командное интервью React interview", exact: true }).waitFor();
  } finally { await browser.close(); }
});

test("team authoring uses selectors, readable labels and visible footer at tablet height", async () => {
  const { browser, page } = await fixture("interviews/new");
  try {
    await page.setViewportSize({ width: 1024, height: 768 });
    const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.getByRole("combobox", { name: "Другие интервьюеры (необязательно)", exact: true }).waitFor();
    await waitForModalGeometry(dialog);
    assert.equal(await dialog.getByRole("checkbox").count(), 0);
    const title = dialog.getByRole("textbox", { name: "Название интервью", exact: true });
    assert.ok(await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 15);
    const label = dialog.locator('label[for]').filter({ hasText: "Название интервью" });
    assert.ok(await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 15);
    const fields = dialog.locator(".app-authoring-fields");
    assert.ok(await fields.evaluate(el => el.scrollHeight > el.clientHeight), "long form has an independent scroll region");
    const footer = dialog.locator(".app-form-actions");
    const before = await footer.boundingBox();
    assert.ok(before.y + before.height <= 768 && before.y > 0, "footer visible before scrolling");
    await fields.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const after = await footer.boundingBox();
    assert.ok(Math.abs(before.y - after.y) < 2, "scrolling fields doesn't move footer");
    assert.equal(await dialog.getByText("Участники команды уже видят всех кандидатов.", { exact: false }).count(), 0);
  } finally { await browser.close(); }
});

test("team library has one explicit edit action and task set selectors", async () => {
  const { browser, page } = await fixture("library", { role: "OWNER" });
  try {
    const task = page.getByRole("region", { name: "Командная задача Проверка массива", exact: true });
    await task.waitFor();
    assert.equal(await task.getByRole("button", { name: "Переименовать задачу Проверка массива", exact: true }).count(), 0);
    assert.equal(await task.getByRole("button", { name: "Редактировать задачу Проверка массива", exact: true }).count(), 1);
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const set = page.getByRole("region", { name: "Командный набор Базовый набор", exact: true });
    assert.equal(await set.getByRole("button", { name: "Переименовать набор Базовый набор", exact: true }).count(), 0);
    await set.getByRole("button", { name: "Редактировать набор Базовый набор", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать набор", exact: true });
    await dialog.getByRole("combobox", { name: "Состав набора", exact: true }).waitFor();
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await mkdir(".run/ux-authoring-review", { recursive: true });
    await page.screenshot({ path: ".run/ux-authoring-review/team-set-edit.png" });
    assert.equal(await dialog.getByRole("checkbox").count(), 0);
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Создать набор", exact: true }).click();
    await page.getByRole("dialog", { name: "Новый командный набор", exact: true }).getByRole("combobox", { name: "Задачи набора", exact: true }).waitFor();
  } finally { await browser.close(); }
});

test("task set selectors use full catalog even when the task list search hides their tasks", async () => {
  const { browser, page } = await fixture("library", { role: "OWNER" });
  try {
    await page.route(`**/api/teams/${teamId}/tasks?*`, async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("q")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
      return route.fallback();
    });
    await page.getByRole("textbox", { name: "Поиск задач", exact: true }).fill("Не найдено");
    await page.getByRole("region", { name: "Командная задача Проверка массива", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await page.getByRole("button", { name: "Редактировать набор Базовый набор", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать набор", exact: true });
    await dialog.locator(".ant-select-selection-item").filter({ hasText: "Проверка массива" }).waitFor();
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Создать набор", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Новый командный набор", exact: true }).getByRole("combobox", { name: "Задачи набора", exact: true });
    assert.equal(await picker.isDisabled(), false);
    await picker.fill("Проверка массива");
    await page.locator(".ant-select-item-option").filter({ hasText: "Проверка массива" }).waitFor();
  } finally { await browser.close(); }
});

test("task set catalog failure keeps selected titles and allows a retry", async () => {
  const { browser, page } = await fixture("library", { role: "OWNER" });
  try {
    await page.route(`**/api/teams/${teamId}/tasks*`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) }), { times: 1 });
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await page.getByRole("button", { name: "Редактировать набор Базовый набор", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать набор", exact: true });
    await dialog.getByText("Не удалось загрузить задачи", { exact: true }).waitFor();
    await dialog.locator(".ant-select-selection-item").filter({ hasText: "Проверка массива" }).waitFor();
    await dialog.getByRole("textbox", { name: "Новое название набора", exact: true }).fill("Сохранённый черновик");
    await dialog.getByRole("button", { name: "Повторить загрузку задач", exact: true }).click();
    await dialog.getByText("Не удалось загрузить задачи", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await dialog.getByRole("textbox", { name: "Новое название набора", exact: true }).inputValue(), "Сохранённый черновик");
  } finally { await browser.close(); }
});
