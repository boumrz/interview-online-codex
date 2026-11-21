import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chromium } from "playwright";

const browser = await chromium.launch();
const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const personal = "/workspace/personal";

after(() => browser.close());

async function account(t, viewport = { width: 1440, height: 1000 }, isHr = false) {
  const response = await fetch(`${api}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: `manual${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      displayName: "Интервьюер",
      password: "manual-learning-test-password",
      isHr,
    }),
  });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  await context.addInitScript((value) => localStorage.setItem("auth_token", value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  return { page, token };
}

const guide = (page) => page.locator("[data-learning-tour]");
const help = (page) => page.getByRole("button", { name: "Помощь", exact: true });
const heading = (page, name) => guide(page).getByRole("heading", { name, exact: true });
const target = (page, name) => page.locator(`[data-learning-anchor="${name}"][data-learning-focus="true"]`);
const anchor = (page, name) => page.locator(`[data-learning-anchor="${name}"]`).filter({ visible: true });
const lessonButton = (page, name) => guide(page).getByRole("button", { name, exact: true });
const personalTeamTitle = "Создайте команду для совместной работы";

async function learningProgress(token, module, teamId) {
  const params = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const response = await fetch(`${api}/me/learning/${module}${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.ok, true, `read learning progress for ${module}: ${response.status}`);
  return response.json();
}

async function createTeam(token) {
  const response = await fetch(`${api}/teams`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ name: "Команда для обучения" }),
  });
  assert.equal(response.status, 201);
  const { team } = await response.json();
  return team.id;
}

async function followTeamSection(page, name) {
  const link = target(page, name);
  const menu = target(page, "team-sections-menu");
  await link.or(menu).first().waitFor();
  if (await menu.isVisible()) {
    await menu.click();
    await anchor(page, name).click();
  } else {
    await link.click();
  }
}

async function skipWelcome(page) {
  await page.goto(`${web}${personal}/interviews`);
  await heading(page, "Знакомство с InterHub").waitFor();
  await guide(page).getByRole("button", { name: "Пропустить обучение", exact: true }).click();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  await guide(page).waitFor({ state: "hidden" });
}

async function reachTeamChoice(page) {
  await skipWelcome(page);
  await help(page).click();
  await lessonButton(page, "Посмотреть создание интервью").click();
  await lessonButton(page, "Посмотреть вход в готовую комнату").click();
  await lessonButton(page, "Посмотреть командные пространства").click();
  await heading(page, personalTeamTitle).waitFor();
}

test("manual help carries the user from personal interviews into the highlighted library task", async (t) => {
  const { page, token } = await account(t);
  await skipWelcome(page);
  await help(page).click();
  await heading(page, "Создайте задачи в библиотеке").waitFor();
  await target(page, "personal-library-link").click();
  await page.waitForURL(`**${personal}/library`);
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-create-task").waitFor();
  assert.equal(await guide(page).count(), 1);
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 1);

  await page.reload();
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-create-task").click();
  const task = page.getByRole("dialog", { name: "Создать задачу", exact: true });
  await task.locator("[data-learning-form-guide-slot] [data-learning-tour]").waitFor();
  await task.getByRole("textbox", { name: "Название", exact: true }).fill("Задача из контекстного тура");
  await task.getByRole("button", { name: "Сохранить задачу", exact: true }).click();
  await task.waitFor({ state: "hidden" });
  await page.getByText("Задача из контекстного тура", { exact: true }).waitFor();
  await heading(page, "Откройте наборы задач").waitFor();
  await lessonButton(page, "Закрыть обучение").click();
  await guide(page).waitFor({ state: "hidden" });
  assert.equal((await learningProgress(token, "library")).completedSteps, 1);
  await page.reload();
  await help(page).waitFor();
  assert.equal(await guide(page).count(), 0);
  await help(page).click();
  await heading(page, "Откройте наборы задач").waitFor();
  await target(page, "library-sets").waitFor();
  await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
  await heading(page, "Создайте набор задач").waitFor();
  assert.equal((await learningProgress(token, "library")).completedSteps, 1);
  await target(page, "library-create-set").click();
  const setForm = page.getByRole("dialog", { name: "Создать набор", exact: true });
  await setForm.locator("[data-learning-form-guide-slot] [data-learning-tour]")
    .getByRole("heading", { name: "Создайте набор задач", exact: true }).waitFor();
  const setName = setForm.getByRole("textbox", { name: "Название набора", exact: true });
  const saveSet = setForm.getByRole("button", { name: "Создать", exact: true });
  await saveSet.click();
  await setForm.getByRole("alert").filter({ hasText: "Введите название набора" }).waitFor();
  assert.equal((await learningProgress(token, "library")).completedSteps, 1);
  await setName.fill("Набор из контекстного тура");
  await setForm.getByRole("combobox", { name: "Задачи", exact: true }).click();
  await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: "Задача из контекстного тура" }).click();
  await setName.click();
  await saveSet.click();
  await setForm.waitFor({ state: "hidden" });
  await page.getByText("Набор из контекстного тура", { exact: true }).waitFor();
  await heading(page, personalTeamTitle).waitFor();
  await target(page, "workspace-switcher").waitFor();
  assert.equal((await learningProgress(token, "library")).status, "in_progress");
  await lessonButton(page, "Остаться в личном разделе").click();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.equal((await learningProgress(token, "library")).status, "completed");
  assert.equal((await learningProgress(token, "onboarding")).skipped, true);
  assert.equal(await guide(page).count(), 0);

  await anchor(page, "personal-interviews-link").click();
  await page.waitForURL(`**${personal}/interviews`);
  await help(page).click();
  await heading(page, "Создайте интервью").waitFor();
  await target(page, "interview-create").click();
  await page.waitForURL(`**${personal}/interviews/new`);
  const interview = page.locator('[data-learning-onboarding-dialog="interview"]');
  const inlineGuide = interview.locator("[data-learning-form-guide-slot] [data-learning-tour]");
  const initialFormStep = inlineGuide.getByRole("heading", { name: "Укажите название", exact: true });
  await initialFormStep.waitFor();
  await page.reload();
  await initialFormStep.waitFor();
  const title = interview.getByRole("textbox", { name: "Название интервью", exact: true });
  await title.fill("Интервью из контекстного тура");
  await title.press("Tab");
  await heading(page, "Откройте выбор задач").waitFor();
  await lessonButton(page, "Оставить текущий набор задач").click();
  await heading(page, "Проверьте параметры").waitFor();
  await lessonButton(page, "Показать, где сохранить интервью").click();
  await heading(page, "Откройте комнату").waitFor();
  await guide(page).getByText(/«Личное».*«Создать команду»/).waitFor();
  await interview.getByRole("button", { name: "Создать интервью", exact: true }).click();
  await page.waitForURL(/\/room\/[^/?]+/);
  await heading(page, "Личные заметки").waitFor();
  assert.equal(await guide(page).count(), 1);
});

test("a lost response to the source checkpoint can be retried from the destination without duplicating progress", async (t) => {
  const { page, token } = await account(t);
  await skipWelcome(page);
  await help(page).click();
  await heading(page, "Создайте задачи в библиотеке").waitFor();

  let commandId;
  await page.route("**/api/me/learning/personal_interviews**", async (route) => {
    const command = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (command?.action !== "step") return route.continue();
    const accepted = await route.fetch();
    assert.equal(accepted.status(), 200);
    if (!commandId) {
      commandId = command.commandId;
      assert.equal((await accepted.json()).state.completedSteps, 1);
      return route.fulfill({ status: 503, json: { code: "DATABASE_UNAVAILABLE" } });
    }
    assert.equal(command.commandId, commandId);
    assert.deepEqual((await accepted.json()).events, []);
    return route.fulfill({ response: accepted });
  });

  await target(page, "personal-library-link").click();
  await page.waitForURL(`**${personal}/library`);
  const retry = page.getByRole("button", { name: "Повторить сохранение шага", exact: true });
  await retry.waitFor();
  const savedBeforeRetry = await learningProgress(token, "personal_interviews");
  const retryResponse = page.waitForResponse((response) => response.ok() &&
    new URL(response.url()).pathname === "/api/me/learning/personal_interviews" &&
    response.request().method() === "POST" && response.request().postDataJSON()?.commandId === commandId);
  await retry.click();
  await retryResponse;
  await retry.waitFor({ state: "hidden" });
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-create-task").waitFor();
  assert.deepEqual(await learningProgress(token, "personal_interviews"), savedBeforeRetry);
});

test("a parallel tab resuming the same guide does not lose an answered source checkpoint", async (t) => {
  const { page, token } = await account(t);
  await skipWelcome(page);
  await help(page).click();
  await heading(page, "Создайте задачи в библиотеке").waitFor();

  let original;
  let updatedRevision;
  await page.route("**/api/me/learning/personal_interviews**", async (route) => {
    const command = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    if (command?.action !== "step") return route.continue();
    if (!original) {
      original = command;
      const parallelResume = await fetch(`${api}/me/learning/personal_interviews`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, commandId: randomUUID(), action: "resume", step: undefined }),
      });
      assert.equal(parallelResume.status, 200);
      const { state } = await parallelResume.json();
      updatedRevision = state.revision;
      assert.equal(state.completedSteps, 0);
      const stale = await route.fetch();
      assert.equal(stale.status(), 409);
      return route.fulfill({ response: stale });
    }
    assert.equal(command.commandId, original.commandId);
    assert.equal(command.expectedRevision, updatedRevision);
    return route.continue();
  });

  const restoredCheckpoint = page.waitForResponse((response) => response.ok() &&
    new URL(response.url()).pathname === "/api/me/learning/personal_interviews" &&
    response.request().method() === "POST" && response.request().postDataJSON()?.action === "step");
  await target(page, "personal-library-link").click();
  await page.waitForURL(`**${personal}/library`);
  await restoredCheckpoint;
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-create-task").waitFor();
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 1);
});

test("the highlighted entrance to an existing interview opens the authorized room lesson", async (t) => {
  const { page, token } = await account(t);
  const createdRoom = await fetch(`${api}/public/rooms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Готовое интервью", ownerDisplayName: "Интервьюер", language: "nodejs" }),
  });
  assert.equal(createdRoom.status, 200);
  const { inviteCode } = await createdRoom.json();
  await skipWelcome(page);
  await help(page).click();
  await lessonButton(page, "Посмотреть создание интервью").click();
  await lessonButton(page, "Посмотреть вход в готовую комнату").click();
  await heading(page, "Войдите в комнату").waitFor();
  await target(page, "interview-enter").click();
  await page.waitForURL(`**/room/${inviteCode}`);
  await heading(page, "Личные заметки").waitFor();
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 3);
  const onboarding = await learningProgress(token, "onboarding");
  assert.equal(onboarding.skipped, true);
  assert.equal(onboarding.attempt, 0);
});

test("team help follows Library and Tracks from tablet navigation and records each source step", async (t) => {
  const { page, token } = await account(t, { width: 768, height: 1024 });
  const teamId = await createTeam(token);
  const workspace = `/workspace/teams/${teamId}`;
  await skipWelcome(page);
  await page.goto(`${web}${workspace}/interviews`);
  await help(page).click();
  await heading(page, "Откройте командную библиотеку").waitFor();
  await followTeamSection(page, "team-library-link");
  await page.waitForURL(`**${workspace}/library`);
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-create-task").waitFor();
  assert.equal((await learningProgress(token, "team_interviews", teamId)).completedSteps, 1);
  await lessonButton(page, "Закрыть обучение").click();
  await guide(page).waitFor({ state: "hidden" });

  await page.goto(`${web}${workspace}/interviews`);
  await help(page).click();
  await heading(page, "Найдите треки и вакансии").waitFor();
  await followTeamSection(page, "team-tracks-link");
  await page.waitForURL(`**${workspace}/tracks`);
  await heading(page, "Найти трек").waitFor();
  await guide(page).getByText(/объединяет вакансии одного направления/).waitFor();
  const search = target(page, "track-search");
  await search.fill("тест");
  await search.press("Tab");
  await heading(page, "Посмотреть программу").waitFor();
  await guide(page).getByText(/задачи появятся в активных карточках/).waitFor();
  const source = await learningProgress(token, "team_interviews", teamId);
  assert.equal(source.completedSteps, 2);
  await lessonButton(page, "Завершить обзор программы").click();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.equal((await learningProgress(token, "tracks", teamId)).status, "completed");
  assert.equal(await guide(page).count(), 0);
});

test("team track help shows the active vacancy tasks and explains how they reach a new interview", async (t) => {
  const { page, token } = await account(t);
  const teamId = await createTeam(token);
  const team = `/teams/${teamId}`;
  const create = async (path, body, method = "POST") => {
    const response = await fetch(`${api}${team}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.ok, true, `${method} ${path}: ${response.status}`);
    return response.json();
  };
  const { track } = await create("/tracks", { name: "Frontend" });
  await create(`/tracks/${track.id}/vacancies`, { title: "React разработчик" });
  const { task } = await create("/tasks", { title: "Архитектура компонентов", description: "", language: "nodejs" });
  const programme = `/tracks/${track.id}/programme`;
  const draft = await create(`${programme}/draft`, { taskIds: [task.id] }, "PATCH");
  await create(`${programme}/publish`, { revision: draft.programme.revision });

  await skipWelcome(page);
  await page.goto(`${web}/workspace${team}/tracks`);
  await help(page).click();
  await heading(page, "Найти трек").waitFor();
  const search = target(page, "track-search");
  await search.fill("React");
  await search.press("Tab");
  await heading(page, "Посмотреть программу").waitFor();
  const vacancy = page.getByRole("region", { name: "Вакансия React разработчик", exact: true });
  await vacancy.locator('[data-learning-anchor="track-vacancy-programme"][data-learning-focus="true"]').waitFor();
  await vacancy.getByText("Архитектура компонентов", { exact: true }).waitFor();
  await guide(page).getByText(/наследует задачи трека/).waitFor();
  await guide(page).getByText(/в новом интервью.*выбраны автоматически/).waitFor();
  await lessonButton(page, "Завершить обзор программы").click();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.equal((await learningProgress(token, "tracks", teamId)).status, "completed");
});

test("team library keeps the set lesson through the native create dialog on a tablet", async (t) => {
  const { page, token } = await account(t, { width: 768, height: 1024 });
  const teamId = await createTeam(token);
  const taskResponse = await fetch(`${api}/teams/${teamId}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Задача для командного набора", description: "", starterCode: "", language: "nodejs" }),
  });
  assert.equal(taskResponse.status, 201);
  await skipWelcome(page);
  await page.goto(`${web}/workspace/teams/${teamId}/library`);
  await help(page).click();
  await lessonButton(page, "Посмотреть наборы без создания задачи").click();
  await target(page, "library-sets").waitFor();
  await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
  await heading(page, "Создайте набор задач").waitFor();
  assert.equal((await learningProgress(token, "library", teamId)).completedSteps, 1);
  await target(page, "library-create-set").click();
  const setForm = page.getByRole("dialog", { name: "Новый командный набор", exact: true });
  const inlineGuide = setForm.locator("[data-learning-form-guide-slot] [data-learning-tour]");
  await inlineGuide.getByRole("heading", { name: "Создайте набор задач", exact: true }).waitFor();
  const setName = setForm.getByRole("textbox", { name: "Название набора", exact: true });
  const taskPicker = setForm.getByRole("combobox", { name: "Задачи набора", exact: true });
  const saveSet = setForm.getByRole("button", { name: "Создать набор", exact: true });
  const overlaps = await setForm.evaluate((dialog) => {
    const instruction = dialog.querySelector("[data-learning-tour]").getBoundingClientRect();
    return Array.from(dialog.querySelectorAll("input, .app-form-actions button")).filter((control) => {
      const bounds = control.getBoundingClientRect();
      return instruction.left < bounds.right && bounds.left < instruction.right &&
        instruction.top < bounds.bottom && bounds.top < instruction.bottom;
    }).map((control) => control.id || control.textContent);
  });
  assert.deepEqual(overlaps, [], "inline instructions leave the set controls unobstructed");
  await setName.fill("Командный набор из тура");
  await taskPicker.click();
  await page.locator(".ant-select-dropdown .ant-select-item-option").filter({ hasText: "Задача для командного набора" }).click();
  await setName.click();
  await saveSet.click();
  await setForm.waitFor({ state: "hidden" });
  await page.getByText("Командный набор из тура", { exact: true }).waitFor();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.equal((await learningProgress(token, "library", teamId)).status, "completed");
});

test("choosing an existing team hands off help only after workspace access is confirmed", async (t) => {
  const { page, token } = await account(t);
  const teamId = await createTeam(token);
  const openTeam = () => page.getByRole("menuitemradio", { name: "Команда для обучения", exact: true }).click();
  await reachTeamChoice(page);

  // Simulate cached menu membership becoming unavailable before the destination loads.
  const detailUrl = `**/api/teams/${teamId}`;
  await page.route(detailUrl, (route) => route.fulfill({ status: 403, json: { code: "TEAM_ACCESS_DENIED" } }));
  await target(page, "workspace-switcher").click();
  await openTeam();
  await page.waitForURL(`**/workspace/teams/${teamId}/interviews`);
  await page.getByText("Команда недоступна", { exact: true }).waitFor();
  await guide(page).waitFor({ state: "hidden" });
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 3);
  assert.equal((await learningProgress(token, "team_interviews", teamId)).attempt, 0);

  await page.unroute(detailUrl);
  await page.goBack();
  await page.waitForURL(`**${personal}/interviews`);
  await help(page).click();
  await heading(page, personalTeamTitle).waitFor();
  await target(page, "workspace-switcher").click();
  await openTeam();
  await page.waitForURL(`**/workspace/teams/${teamId}/interviews`);
  await heading(page, "Откройте командную библиотеку").waitFor();
  await target(page, "team-library-link").or(target(page, "team-sections-menu")).first().waitFor();
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 4);
  assert.equal((await learningProgress(token, "team_interviews", teamId)).attempt, 1);
});

test("creating a team keeps inline help through validation and follows the authorized new workspace", async (t) => {
  const { page, token } = await account(t);
  await reachTeamChoice(page);
  await target(page, "workspace-switcher").click();
  await page.getByRole("menuitem", { name: "Создать команду", exact: true }).click();

  const teamForm = page.getByRole("dialog", { name: "Создать команду", exact: true });
  const inlineGuide = teamForm.locator("[data-learning-form-guide-slot] [data-learning-tour]");
  await inlineGuide.getByRole("heading", { name: personalTeamTitle, exact: true }).waitFor();
  await teamForm.getByRole("button", { name: "Создать команду", exact: true }).click();
  await teamForm.getByRole("alert").getByText("Название команды обязательно", { exact: true }).waitFor();
  await inlineGuide.waitFor();
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 3);

  await teamForm.getByRole("textbox", { name: "Название команды", exact: true }).fill("Команда из контекстного тура");
  await teamForm.getByRole("button", { name: "Повторить", exact: true }).click();
  await page.waitForURL(/\/workspace\/teams\/[^/]+\/interviews$/);
  await heading(page, "Откройте командную библиотеку").waitFor();
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 4);
});

test("an unrelated profile visit and browser Back leave the contextual checkpoint available through help", async (t) => {
  const { page, token } = await account(t);
  await skipWelcome(page);
  await help(page).click();
  await heading(page, "Создайте задачи в библиотеке").waitFor();
  await page.getByRole("link", { name: /Открыть профиль/ }).click();
  await page.waitForURL("**/profile");
  await guide(page).waitFor({ state: "hidden" });
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 0);

  await page.goBack();
  await page.waitForURL(`**${personal}/interviews`);
  await guide(page).waitFor({ state: "hidden" });
  await help(page).click();
  await heading(page, "Создайте задачи в библиотеке").waitFor();
  await target(page, "personal-library-link").waitFor();
  assert.equal((await learningProgress(token, "personal_interviews")).completedSteps, 0);
});

test("help opened on existing task sets points back to Tasks before highlighting its Create action", async (t) => {
  const { page, token } = await account(t);
  await skipWelcome(page);
  await page.goto(`${web}${personal}/library?tab=sets`);
  await help(page).click();
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-tasks").waitFor();
  await page.getByRole("tab", { name: "Задачи", exact: true }).click();
  await page.waitForURL(`**${personal}/library`);
  await heading(page, "Создайте задачу").waitFor();
  await target(page, "library-create-task").waitFor();
  assert.equal((await learningProgress(token, "library")).completedSteps, 0);
});

test("first entry on personal task sets leads from the final help to team creation", async (t) => {
  const { page, token } = await account(t, { width: 768, height: 900 });
  await page.goto(`${web}${personal}/library?tab=sets`);
  await heading(page, "Знакомство с InterHub").waitFor();
  await lessonButton(page, "Начать обучение").click();
  await heading(page, "Создайте набор задач").waitFor();
  await lessonButton(page, "Перейти к командам без набора").click();
  await heading(page, personalTeamTitle).waitFor();
  const switcher = target(page, "workspace-switcher");
  await switcher.press("ArrowDown");
  const create = page.getByRole("menuitem", { name: "Создать команду", exact: true });
  await target(page, "workspace-create-team").waitFor();
  await create.press("Enter");
  const teamForm = page.getByRole("dialog", { name: "Создать команду", exact: true });
  await teamForm.locator("[data-learning-form-guide-slot] [data-learning-tour]").waitFor();
  await teamForm.getByRole("button", { name: "Отмена", exact: true }).click();
  await teamForm.waitFor({ state: "hidden" });
  await heading(page, personalTeamTitle).waitFor();
  assert.equal(new URL(page.url()).search, "?tab=sets");

  await switcher.click();
  await create.click();
  await teamForm.getByRole("textbox", { name: "Название команды", exact: true }).fill("Команда из личной библиотеки");
  await teamForm.getByRole("button", { name: "Создать команду", exact: true }).click();
  await page.waitForURL(/\/workspace\/teams\/[^/]+\/interviews$/);
  await heading(page, "Откройте командную библиотеку").waitFor();
  assert.equal((await learningProgress(token, "library")).status, "completed");
});

test("the final help on personal Candidates survives reloading and finishing without creating a team", async (t) => {
  const { page, token } = await account(t, undefined, true);
  await skipWelcome(page);
  await page.goto(`${web}${personal}/candidates`);
  await help(page).click();
  await heading(page, "Отфильтровать список").waitFor();
  await lessonButton(page, "Посмотреть выгрузку Excel").click();
  await heading(page, "Скачайте Excel по выборке").waitFor();
  await target(page, "candidates-export").waitFor();
  const [workbook] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: "Скачать Excel", exact: true }).click(),
  ]);
  assert.match(workbook.suggestedFilename(), /\.xlsx$/);
  await lessonButton(page, "Перейти к командам").click();
  await heading(page, personalTeamTitle).waitFor();
  await target(page, "workspace-switcher").waitFor();
  assert.equal((await learningProgress(token, "candidates")).status, "in_progress");
  await page.reload();
  await heading(page, personalTeamTitle).waitFor();
  await target(page, "workspace-switcher").waitFor();
  await lessonButton(page, "Остаться в личном разделе").click();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.equal((await learningProgress(token, "candidates")).status, "completed");
  assert.equal(new URL(page.url()).pathname, `${personal}/candidates`);
});

test("team help hands off to Candidates and explains the filtered Excel download", async (t) => {
  const { page, token } = await account(t, { width: 768, height: 1024 });
  const teamId = await createTeam(token);
  const workspace = `/workspace/teams/${teamId}`;
  await skipWelcome(page);
  await page.goto(`${web}${workspace}/interviews`);
  await help(page).click();
  for (const label of ["Посмотреть треки и вакансии", "Посмотреть создание интервью", "Посмотреть вход в готовую комнату",
    "Перейти к кандидатам без копирования ссылки"]) {
    await lessonButton(page, label).click();
  }
  await followTeamSection(page, "team-candidates-link");
  await page.waitForURL(`**${workspace}/candidates`);
  await heading(page, "Отфильтровать список").waitFor();
  await page.getByLabel("С", { exact: true }).fill("2026-01-01");
  await heading(page, "Отфильтровать список").waitFor();
  await page.getByLabel("По", { exact: true }).fill("2026-01-31");
  await page.getByRole("button", { name: "Применить период", exact: true }).click();
  await heading(page, "Скачайте Excel по выборке").waitFor();
  await guide(page).getByText(/по выбранным периоду, треку и вакансии/).waitFor();
  const exportRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/hr/rooms/export"));
  const [workbook, request] = await Promise.all([
    page.waitForEvent("download"), exportRequest, target(page, "candidates-export").click(),
  ]);
  assert.match(workbook.suggestedFilename(), /\.xlsx$/);
  const params = new URL(request.url()).searchParams;
  assert.equal(params.get("teamId"), teamId);
  assert.equal(params.get("from"), "2026-01-01");
  assert.equal(params.get("to"), "2026-01-31");
  await lessonButton(page, "Завершить обзор выгрузки").click();
  await guide(page).waitFor({ state: "hidden" });
  assert.equal((await learningProgress(token, "team_interviews", teamId)).status, "completed");
});
