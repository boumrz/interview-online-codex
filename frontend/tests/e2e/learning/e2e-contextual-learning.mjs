import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const browser = await chromium.launch({ headless: true });
const welcomeGuide = (page) => page.locator('[data-learning-tour="true"]').filter({
  has: page.getByRole("heading", { name: "Знакомство с InterHub", exact: true }),
});
async function post(path, body, token, headers = {}) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
}
async function account(prefix) {
  return post("/auth/register", {
    nickname: `${prefix}${Date.now()}`,
    displayName: prefix,
    password: "learning-test-password",
  });
}
async function contextFor(auth) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  if (auth)
    await context.addInitScript(
      (token) => localStorage.setItem("auth_token", token),
      auth.token,
    );
  return context;
}
const roomAnchors = [
  ["room-workspaces-tab", "room-workspaces", "room-editor"],
  ["room-task-add", "room-task-panel", "room-step-select", "room-steps", "room-workspaces", "room-editor"],
  ["room-mode", "room-editor"],
  ["room-markdown-expand", "room-markdown-collapse", "room-mode", "room-editor"],
  ["room-whiteboard-tool", "room-whiteboard-view", "room-mode", "room-editor"],
  ["room-diagram-tool", "room-diagram-view", "room-mode", "room-editor"],
  ["room-activity", "room-workspaces", "room-editor"],
  ["room-result", "room-mode", "room-editor"],
];
async function expectTourStep(page, tour, step, anchors = roomAnchors[step - 1]) {
  const heading = tour.locator(`[data-learning-step="${step}"]`);
  await heading.waitFor({ timeout: 10000 });
  assert.equal(await tour.getByRole("button", { name: /^(Назад|Далее)$/ }).count(), 0);
  await page.waitForFunction((expectedAnchors) => Array.from(
    document.querySelectorAll('[data-learning-focus="true"]')
  ).some((element) => expectedAnchors.includes(element.dataset.learningAnchor)), anchors);
}
try {
  const guestContext = await contextFor();
  const guest = await guestContext.newPage();
  await guest.goto(web);
  const create = guest.getByRole("button", {
    name: "Создать комнату",
    exact: true,
  });
  await create.waitFor();
  assert.equal(await create.count(), 1);
  assert.equal(
    await guest.getByRole("button", { name: "Помощь", exact: true }).count(),
    0,
  );
  await guest
    .getByRole("textbox", { name: "Ваше имя", exact: true })
    .fill("Candidate name");
  await create.click();
  const createDialog = guest.getByRole("dialog", {
    name: "Новая комната",
    exact: true,
  });
  await createDialog
    .getByRole("textbox", { name: "Ваше имя", exact: true })
    .fill("Interviewer name");
  await createDialog
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await createDialog.waitFor({ state: "hidden" });
  assert.equal(
    await guest
      .getByRole("textbox", { name: "Ваше имя", exact: true })
      .inputValue(),
    "Candidate name",
  );
  await guest.screenshot({
    path: "/tmp/interhub-learning-landing.png",
    fullPage: true,
  });
  await guest.setViewportSize({ width: 768, height: 1024 });
  await guest.getByRole("button", { name: "Тёмная тема", exact: true }).click();
  assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await guest.screenshot({ path: "/tmp/interhub-learning-landing-tablet-dark.png", fullPage: true });
  await create.click();
  await createDialog.waitFor();
  await guest.waitForTimeout(250);
  await guest.screenshot({ path: "/tmp/interhub-learning-create-tablet-dark.png", fullPage: true });
  await createDialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await createDialog.waitFor({ state: "hidden" });
  assert.equal(await create.evaluate(node => document.activeElement === node), true);
  await guestContext.close();

  const owner = await account("learnowner");
  const candidate = await account("learncandidate");
  const room = await post(
    "/public/rooms",
    {
      title: "Learning room",
      ownerDisplayName: "Learning owner",
      language: "nodejs",
    },
    owner.token,
  );
  const ownerContext = await contextFor(owner);
  const page = await ownerContext.newPage();
  let latestLearningState;
  page.on("response", async (response) => {
    if (response.ok() && response.url().includes("/me/learning/room")) {
      const payload = await response.json().catch(() => null);
      latestLearningState = payload?.state ?? payload;
    }
  });
  const help = page.getByRole("button", { name: "Помощь", exact: true });
  const tour = page.getByRole("dialog", { name: "Подсказки · Комната интервьюера", exact: true });
  const progressRead = page.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/room") && response.request().method() === "GET");
  await page.goto(`${web}/room/${room.inviteCode}`);
  const roomProgress = await (await progressRead).json();
  assert.equal(roomProgress.attempt, 0);
  assert.equal(roomProgress.offerSeen, false);
  await help.waitFor();
  await welcomeGuide(page).getByRole("button", { name: "Закрыть обучение", exact: true }).click();
  await welcomeGuide(page).waitFor({ state: "hidden" });
  const roomUrl = page.url();
  await page
    .locator('[data-testid="room-code-editor-host"]')
    .evaluate((node) => (node.dataset.learningPreserved = "yes"));
  const interrupted = new Map([["start", null], ["step_2", null], ["finish", null]]);
  const retried = new Set();
  let busyCommandId;
  let roomBusyRetried = false;
  const roomWrites = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/rooms\//.test(request.url())) {
      roomWrites.push(request.url());
    }
  });
  await page.route("**/api/me/learning/room**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const command = route.request().postDataJSON();
    const action = command.action === "step" ? `step_${command.step}` : command.action;
    if (action === "manual_open" && !roomBusyRetried) {
      if (!busyCommandId) {
        busyCommandId = command.commandId;
        return route.fulfill({ status: 503, json: { code: "DATABASE_UNAVAILABLE" } });
      }
      assert.equal(command.commandId, busyCommandId);
      roomBusyRetried = true;
    }
    if (!interrupted.has(action)) return route.continue();
    const response = await route.fetch();
    if (response.status() === 503) return route.fulfill({ response });
    assert.equal(response.ok(), true);
    const originalId = interrupted.get(action);
    if (originalId === null) {
      interrupted.set(action, command.commandId);
      await route.fulfill({ status: 503 });
    } else {
      assert.equal(command.commandId, originalId);
      assert.deepEqual((await response.json()).events, []);
      retried.add(action);
      await route.fulfill({ response });
    }
  });
  const retry = () => tour.getByRole("button", { name: "Повторить", exact: true }).click({ timeout: 5000 });
  const choose = (name) => tour.getByRole("button", { name, exact: true }).click();
  await help.click();
  await retry();
  await expectTourStep(page, tour, 1);
  await choose("Перейти к задачам");
  await expectTourStep(page, tour, 2);
  await choose("Оставить активную задачу");
  await retry();
  await expectTourStep(page, tour, 3);
  assert.equal(latestLearningState?.completedSteps, 2);
  await page.keyboard.press("Escape");
  await tour.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.matches('[data-learning-help="true"]'));

  await help.click();
  await expectTourStep(page, tour, 3);
  assert.equal(latestLearningState?.completedSteps, 2);
  for (const [step, alternative] of [
    [4, "Оставить текущий режим"],
    [5, "Оставить текущий размер"],
    [6, "Продолжить без доски"],
    [7, "Продолжить без диаграммы"],
    [8, "Не открывать журнал"],
  ]) {
    await choose(alternative);
    await expectTourStep(page, tour, step);
  }
  await choose("Закончить без изменения результата");
  await retry();
  await tour.waitFor({ state: "hidden" });
  assert.deepEqual([...retried], ["start", "step_2", "finish"]);
  assert.equal(roomBusyRetried, true);
  await page.unroute("**/api/me/learning/room**");
  assert.equal(page.url(), roomUrl);
  assert.equal(await page.locator('[data-testid="room-code-editor-host"]').getAttribute("data-learning-preserved"), "yes");
  assert.deepEqual(roomWrites, []);
  assert.equal(latestLearningState?.completions, 1);
  const actual = await (
    await fetch(`${api}/rooms/${room.inviteCode}`, { headers: { Authorization: `Bearer ${owner.token}` } })
  ).json();
  assert.notEqual(actual.status, "finished");
  assert.equal(actual.roomEditorMode, "code");

  await page.reload();
  await help.waitFor();
  await welcomeGuide(page).getByRole("button", { name: "Закрыть обучение", exact: true }).click();
  await welcomeGuide(page).waitFor({ state: "hidden" });
  await help.click();
  await expectTourStep(page, tour, 1);
  await page.screenshot({ path: "/tmp/interhub-learning-room.png", fullPage: true });
  await page.keyboard.press("Escape");
  await tour.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "Тёмная тема", exact: true }).click();
  await help.click();
  await expectTourStep(page, tour, 1);
  await page.screenshot({ path: "/tmp/interhub-learning-room-tablet-dark.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press("Escape");
  const welcomeRead = page.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/onboarding") && response.request().method() === "GET");
  await page.goto(`${web}/workspace/personal/interviews`);
  const journey = page.getByRole("dialog", { name: "Подсказки · Первый маршрут", exact: true });
  await journey.getByRole("heading", { name: "Знакомство с InterHub", exact: true }).waitFor();
  const welcome = await (await welcomeRead).json();
  assert.equal(welcome.version, 2);
  assert.equal(welcome.attempt, 0);
  assert.equal(welcome.offerSeen, true, "the room's initial offer already recorded its first view");
  const savedSkip = page.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/onboarding") && response.request().method() === "POST" &&
    response.request().postDataJSON()?.action === "offer_skip");
  await journey.getByRole("button", { name: "Пропустить обучение", exact: true }).click();
  await journey.waitFor({ state: "hidden" });
  const skipped = (await (await savedSkip).json()).state;
  assert.equal(skipped.completedSteps, 0);
  assert.equal(skipped.skipped, true);
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.equal(await help.getAttribute("data-learning-help-cue"), "true");
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  const restoredProgress = page.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/onboarding") && response.request().method() === "GET");
  await page.reload();
  assert.equal((await (await restoredProgress).json()).skipped, true);
  await help.waitFor();
  assert.equal(await journey.count(), 0);

  // A response from the prior account cannot reopen help or emit its delayed analytics.
  const staleEvents = [];
  page.on("console", async (message) => {
    for (const argument of message.args()) {
      const value = await argument.jsonValue().catch(() => null);
      if (value?.event === "learn_personal_interviews_manual_open_v1")
        staleEvents.push(value.event);
    }
  });
  let releaseResponse;
  let requestCaptured;
  const heldResponse = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const capturedRequest = new Promise((resolve) => {
    requestCaptured = resolve;
  });
  await page.route(
    "**/api/me/learning/personal_interviews**",
    async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().postDataJSON()?.action === "manual_open"
      ) {
        const response = await route.fetch();
        requestCaptured();
        await heldResponse;
        await route.fulfill({ response });
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Помощь", exact: true }).click();
  await capturedRequest;
  const otherTab = await ownerContext.newPage();
  await otherTab.goto(web);
  await otherTab.evaluate(
    (token) => localStorage.setItem("auth_token", token),
    candidate.token,
  );
  await page
    .getByRole("dialog", { name: "Подсказки · Личное пространство", exact: true })
    .waitFor({ state: "hidden" });
  releaseResponse();
  await page.waitForTimeout(300);
  assert.deepEqual(staleEvents, []);
  await otherTab.close();
  const candidateRoom = await post(
    "/public/rooms",
    {
      title: "Candidate room",
      ownerDisplayName: "Another owner",
      language: "nodejs",
    },
    candidate.token,
  );
  const ownerCandidateRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/me/learning/room"))
      ownerCandidateRequests.push(request.url());
  });
  await page.goto(`${web}/room/${candidateRoom.inviteCode}`);
  await page.getByText("Candidate room", { exact: true }).first().waitFor();
  await page.waitForTimeout(700);
  assert.equal(
    await page.getByRole("button", { name: "Помощь", exact: true }).count(),
    0,
  );
  assert.equal(ownerCandidateRequests.length, 0);
  await ownerContext.close();

  const relogin = await post("/auth/login", { nickname: owner.user.nickname, password: "learning-test-password" });
  const restoredContext = await contextFor(relogin);
  const restoredPage = await restoredContext.newPage();
  await restoredPage.goto(`${web}/room/${room.inviteCode}`);
  await restoredPage.getByRole("button", { name: "Помощь", exact: true }).waitFor();
  assert.equal(await restoredPage.locator('[data-learning-tour="true"]').count(), 0);
  await restoredPage.getByRole("button", { name: "Помощь", exact: true }).click();
  await expectTourStep(restoredPage, restoredPage.getByRole("dialog", {
    name: "Подсказки · Комната интервьюера", exact: true,
  }), 1);
  await restoredContext.close();

  const candidateContext = await contextFor(candidate);
  const candidatePage = await candidateContext.newPage();
  const learningRequests = [];
  candidatePage.on("request", (request) => {
    if (request.url().includes("/me/learning/"))
      learningRequests.push(request.url());
  });
  await candidatePage.goto(`${web}/room/${room.inviteCode}`);
  await candidatePage
    .getByText("Learning room", { exact: true })
    .first()
    .waitFor();
  await candidatePage.waitForTimeout(1000);
  assert.equal(
    await candidatePage
      .getByRole("button", { name: "Помощь", exact: true })
      .count(),
    0,
  );
  assert.equal(learningRequests.length, 0);
  await candidateContext.close();

  const navigator = await account("learnnavigator");
  const { team } = await post("/teams", { name: "Команда обучения" }, navigator.token, {
    "Idempotency-Key": randomUUID(),
  });
  const navigationContext = await contextFor(navigator);
  const navigationPage = await navigationContext.newPage();
  const teamProgress = navigationPage.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/team_interviews") && response.request().method() === "GET");
  await navigationPage.goto(`${web}/workspace/teams/${team.id}/interviews`);
  assert.equal((await (await teamProgress).json()).attempt, 0);
  const teamHelp = navigationPage.getByRole("button", { name: "Помощь", exact: true });
  await teamHelp.waitFor();
  await welcomeGuide(navigationPage).getByRole("button", { name: "Пропустить обучение", exact: true }).click();
  await welcomeGuide(navigationPage).waitFor({ state: "hidden" });
  await teamHelp.click();
  const teamTour = navigationPage.getByRole("dialog", {
    name: "Подсказки · Командное пространство", exact: true,
  });
  await expectTourStep(navigationPage, teamTour, 1, ["team-library-link", "team-sections-menu"]);
  assert.equal(await teamTour.getByRole("button", { name: "Пройти весь маршрут", exact: true }).count(), 1);

  await navigationPage.goto(`${web}/workspace/teams/${team.id}/interviews/new`);
  const interviewForm = navigationPage.locator('[data-learning-onboarding-dialog="interview"]');
  const formHelp = interviewForm.getByRole("button", { name: "Помощь", exact: true });
  await formHelp.click();
  const formTour = interviewForm.locator("[data-learning-form-guide-slot] [data-learning-tour]");
  await formTour.getByRole("heading", { name: "Укажите название", exact: true }).waitFor();
  const titleInput = interviewForm.locator('[data-learning-anchor="interview-title"]');
  await titleInput.fill("Черновик интервью");
  await titleInput.press("Tab");
  await formTour.getByRole("heading", { name: "Откройте выбор задач", exact: true }).waitFor();
  const taskPicker = interviewForm.getByRole("combobox", { name: "Задачи интервью", exact: true });
  await taskPicker.press("ArrowDown");
  await formTour.getByRole("heading", { name: "Проверьте параметры", exact: true }).waitFor();
  await titleInput.click();
  await formTour.getByRole("button", { name: "Закрыть обучение", exact: true }).click();
  await formTour.waitFor({ state: "hidden" });
  assert.equal(await titleInput.inputValue(), "Черновик интервью");
  await navigationContext.close();
  console.log("CONTEXTUAL_LEARNING_OK");
} finally {
  await browser.close();
}
