import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chromium } from "playwright";

const browser = await chromium.launch();
const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const personalInterviews = "/workspace/personal/interviews";

after(() => browser.close());

async function account(t) {
  const response = await fetch(`${api}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: `guide${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      displayName: "Участник обучения",
      password: "onboarding-test-password",
    }),
  });
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  await context.addInitScript((value) => localStorage.setItem("auth_token", value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  return { page, token };
}

const tour = (page) => page.locator("[data-learning-tour]");
const anchor = (page, name) => page.locator(`[data-learning-anchor="${name}"]`).filter({ visible: true }).first();
const help = (page) => page.locator('[data-learning-help="true"]').filter({ visible: true }).first();
const action = (page, name) => tour(page).getByRole("button", { name, exact: true });

async function followTeamSection(page, name) {
  const link = anchor(page, name);
  const menu = page.locator('[data-learning-anchor="team-sections-menu"][data-learning-focus="true"]');
  await link.or(menu).first().waitFor();
  if (!await link.isVisible()) await menu.click();
  await link.click();
}

async function welcome(page, token, fresh = true) {
  await tour(page).getByRole("heading", { name: "Знакомство с InterHub", exact: true }).waitFor();
  for (const topic of [/технических собеседований/i, /подготовить встречу/i, /общем редакторе/i, /зафиксировать результат/i]) {
    await tour(page).getByText(topic).first().waitFor();
  }
  assert.equal(await tour(page).locator("[data-learning-step]").count(), 0);
  if (fresh) assert.equal((await journeyState(token)).attempt, 0);
  await action(page, "Начать обучение").click();
}

async function journeyState(token) {
  const response = await fetch(`${api}/me/learning/onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.version, 2);
  return state;
}

async function step(page, number) {
  await tour(page).locator(`[data-learning-step="${number}"]`).waitFor();
  assert.equal(await tour(page).count(), 1, "the scene must show one active tour");
  assert.equal(await tour(page).getByRole("button", { name: /^(Назад|Далее)$/ }).count(), 0);
}

async function reminder(page) {
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  await page.locator('button[data-learning-help="true"][data-learning-help-cue="true"]').waitFor();
  assert.equal(await tour(page).count(), 0, "a help hint must not reopen the tour");
}

test("the real task, team and interview actions keep one journey through to the room", { timeout: 120_000 }, async (t) => {
  const { page, token } = await account(t);
  await page.goto(`${web}${personalInterviews}`);
  await welcome(page, token);
  await step(page, 1);
  await anchor(page, "personal-library-link").click();
  await page.waitForURL("**/workspace/personal/library");
  await step(page, 2);
  await page.goBack();
  await page.waitForURL(`**${personalInterviews}`);
  await tour(page).waitFor({ state: "hidden" });
  assert.equal((await journeyState(token)).completedSteps, 1);
  await page.goForward();
  await step(page, 2);
  await page.reload();
  await step(page, 2);
  assert.equal(new URL(page.url()).pathname, "/workspace/personal/library");
  await page.keyboard.press("Escape");
  await reminder(page);
  await help(page).click();
  await step(page, 1);
  await action(page, "Продолжить первый маршрут").click();
  await step(page, 2);
  assert.equal((await journeyState(token)).attempt, 1);

  await anchor(page, "library-create-task").click();
  const taskTitle = page.getByTestId("create-task-title-input");
  await taskTitle.fill("Задача из маршрута");
  await step(page, 2);
  const taskForm = page.getByRole("dialog", { name: "Создать задачу", exact: true });
  const description = taskForm.locator("textarea").first();
  await description.fill("Условие учебной задачи");
  const [guideBox, inputBox] = await Promise.all([tour(page).boundingBox(), description.boundingBox()]);
  assert.ok(guideBox && inputBox && (guideBox.y + guideBox.height <= inputBox.y || inputBox.y + inputBox.height <= guideBox.y),
    "inline guidance and the description field occupy distinct rows");
  await anchor(page, "library-task-save").click();
  await step(page, 3);
  await anchor(page, "workspace-switcher").click();
  await anchor(page, "workspace-create-team").click();
  await page.getByRole("textbox", { name: /название команды/i }).fill("Команда из маршрута");
  await step(page, 3);
  await anchor(page, "workspace-team-submit").click();
  await page.waitForURL(/\/workspace\/teams\/[^/?]+\//);
  await step(page, 4);

  await anchor(page, "team-settings-link").click();
  await anchor(page, "team-settings-members").waitFor();
  assert.equal(await page.locator("[data-learning-tour]").count(), 1);
  await step(page, 5);
  await tour(page).getByRole("heading", { name: "Откройте треки и вакансии", exact: true }).waitFor();
  await followTeamSection(page, "team-tracks-link");
  await page.waitForURL("**/tracks");
  await step(page, 5);
  await tour(page).getByRole("heading", { name: "Откройте кандидатов команды", exact: true }).waitFor();
  await followTeamSection(page, "team-candidates-link");
  await page.waitForURL("**/candidates");
  await step(page, 5);
  await tour(page).getByText(/включая записи с других страниц/).waitFor();
  await page.getByRole("button", { name: "Скачать Excel", exact: true }).and(page.locator('[data-learning-focus="true"]')).waitFor();
  await page.reload();
  await step(page, 5);
  await tour(page).getByRole("heading", { name: "Скачайте Excel по выборке", exact: true }).waitFor();
  let exports = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/hr/rooms/export")) exports++; });
  await action(page, "К списку интервью").click();
  await step(page, 6);
  assert.equal(exports, 0);
  await anchor(page, "interview-create").click();
  await page.waitForURL("**/interviews/new");
  await step(page, 6);
  await page.getByRole("textbox", { name: /название интервью/i }).fill("Интервью из маршрута");
  await anchor(page, "interview-submit").click();
  await page.waitForURL(/\/room\/[^/?]+/);

  await step(page, 7);
  const highlighted = page.locator('[data-learning-focus="true"]');
  await tour(page).getByRole("heading", { name: "Личные заметки", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Мои заметки", exact: true }).and(highlighted).click();
  await tour(page).getByRole("heading", { name: "Чат интервьюеров", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Чат", exact: true }).and(highlighted).click();
  await step(page, 7);
  await tour(page).getByRole("heading", { name: "Задачи интервью", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Шаги", exact: true }).and(highlighted).click();
  await step(page, 8);
  await action(page, "Продолжить без задач").click();
  for (const [number, alternative] of [
    [9, "Оставить текущий режим"],
    [10, "Оставить текущий размер"],
    [11, "Продолжить без доски"],
    [12, "Продолжить без диаграммы"],
  ]) {
    await step(page, number);
    await action(page, alternative).click();
  }
  await step(page, 13);
  await page.getByRole("tab", { name: "Активность", exact: true }).click();
  await step(page, 14);
  await action(page, "Закончить без изменения результата").click();
  await reminder(page);
  assert.equal((await journeyState(token)).status, "completed");
  await help(page).click();
  await step(page, 1);
  await tour(page).getByRole("heading", { name: /заметк|рабоч/i }).waitFor();
  assert.match(new URL(page.url()).pathname, /^\/room\//);
  await page.goto(`${web}${personalInterviews}`);
  await help(page).waitFor();
  assert.equal(await tour(page).count(), 0, "a completed journey does not offer the welcome again");
});

test("the welcome returns after viewing or closing it until the user explicitly skips", async (t) => {
  const { page, token } = await account(t);
  const exposure = page.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/onboarding") && response.request().method() === "POST" &&
    response.request().postDataJSON()?.action === "offer_seen");
  await page.goto(`${web}${personalInterviews}`);
  const start = action(page, "Начать обучение");
  await start.waitFor();
  const { state: viewed } = await (await exposure).json();
  assert.equal(viewed.offerSeen, true);
  assert.equal(viewed.status, "new");
  assert.equal(viewed.attempt, 0);
  assert.equal(viewed.skipped, false);

  await page.reload();
  await start.waitFor();
  assert.deepEqual(await journeyState(token), viewed, "a reload preserves the recorded first view and the new attempt state");
  await action(page, "Закрыть обучение").click();
  await reminder(page);
  assert.deepEqual(await journeyState(token), viewed, "closing is a pause rather than a skip");
  await page.reload();
  await start.waitFor();

  await action(page, "Пропустить обучение").click();
  await reminder(page);
  assert.equal((await journeyState(token)).skipped, true);
  await page.reload();
  await help(page).waitFor();
  assert.equal(await tour(page).count(), 0);
});

test("the welcome recovers when another tab records the first view", async (t) => {
  const { page, token } = await account(t);
  await page.route((url) => url.pathname === "/api/me/learning/onboarding", async (route) => {
    const request = route.request();
    const command = request.method() === "POST" ? request.postDataJSON() : null;
    if (command?.action === "offer_seen") {
      const competingView = await fetch(`${api}/me/learning/onboarding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, commandId: randomUUID() }),
      });
      assert.equal(competingView.status, 200);
    }
    await route.continue();
  });
  const exposure = page.waitForResponse((response) => response.url().includes("/me/learning/onboarding") &&
    response.request().method() === "POST" && response.request().postDataJSON()?.action === "offer_seen");
  await page.goto(`${web}${personalInterviews}`);
  const staleView = await exposure;
  assert.equal(staleView.status(), 409, "another session already recorded the view");
  await action(page, "Начать обучение").click();
  await step(page, 1);
  const started = await journeyState(token);
  assert.equal(started.status, "in_progress");
  assert.equal(started.attempt, 1);
  assert.equal(started.revision, 2, "one recorded view and one start");
});

test("skipping the whole journey points to current help and survives a reload", async (t) => {
  const { page, token } = await account(t);
  await page.goto(`${web}${personalInterviews}`);
  await welcome(page, token);
  await step(page, 1);
  await anchor(page, "personal-library-link").click();
  await step(page, 2);
  const skip = tour(page).getByRole("button", { name: "Пропустить обучение", exact: true });
  await skip.click();
  await reminder(page);
  const skipped = await journeyState(token);
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.completedSteps, 1);
  await page.reload();
  await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
  assert.equal(await tour(page).count(), 0);

  await help(page).click();
  await step(page, 1);
  await tour(page).getByRole("heading", { name: "Создайте задачу", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/workspace/personal/library");

  await tour(page).getByRole("button", { name: "Пройти весь маршрут", exact: true }).click();
  await page.waitForURL(`**${personalInterviews}`);
  await welcome(page, token, false);
  await step(page, 1);
  await anchor(page, "personal-library-link").click();
  await step(page, 2);
  await page.reload();
  await step(page, 2);
  await tour(page).getByRole("button", { name: "Пропустить обучение", exact: true }).click();
  await reminder(page);
  assert.equal((await journeyState(token)).status, "cancelled");
});


test("browser history pauses the journey and keeps help contextual", async (t) => {
  const { page, token } = await account(t);
  const commands = [];
  page.on("response", (response) => {
    if (response.url().includes("/me/learning/onboarding")) {
      commands.push([response.request().method(), response.request().postDataJSON()?.action ?? "", response.status()]);
    }
  });
  await page.goto(`${web}/workspace/personal/library`);
  await tour(page).getByRole("heading", { name: "Знакомство с InterHub", exact: true }).waitFor();
  await action(page, "Закрыть обучение").click();
  await anchor(page, "personal-interviews-link").click();
  await page.reload();
  await welcome(page, token).catch(async (error) => {
    const dom = await tour(page).evaluate((card) => {
      const button = Array.from(card.querySelectorAll("button")).find((node) => node.textContent?.trim() === "Начать обучение");
      return {
        markup: button?.outerHTML,
        a11yHidden: button?.closest('[aria-hidden="true"],[inert]')?.outerHTML.slice(0, 350),
        visibility: button && getComputedStyle(button).visibility,
        active: document.activeElement?.outerHTML.slice(0, 200),
      };
    }).catch(() => undefined);
    t.diagnostic(JSON.stringify({ commands, url: new URL(page.url()).pathname, dom, aria: await tour(page).ariaSnapshot() }));
    throw error;
  });
  await step(page, 1);
  await page.goBack();
  await page.waitForURL("**/workspace/personal/library");
  await tour(page).waitFor({ state: "hidden" });
  assert.equal((await journeyState(token)).completedSteps, 0);
  await help(page).click();
  await tour(page).getByRole("heading", { name: "Создайте задачу", exact: true }).waitFor();
  await action(page, "Посмотреть наборы без создания задачи").click();
  await tour(page).getByRole("heading", { name: "Откройте наборы задач", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Задачи", exact: true }).press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.querySelector('[data-learning-anchor="library-sets"]'));
  await page.keyboard.press("Enter");
  await page.waitForURL("**/workspace/personal/library?tab=sets");
  await tour(page).getByRole("heading", { name: "Создайте набор задач", exact: true }).waitFor();
  await tour(page).getByText(/сначала добавьте задачу на вкладке «Задачи»/i).waitFor();
  const libraryFinished = page.waitForResponse((response) => response.ok() &&
    response.url().includes("/me/learning/library") && response.request().method() === "POST" &&
    response.request().postDataJSON()?.action === "finish");
  await action(page, "Перейти к командам без набора").click();
  await tour(page).getByRole("heading", { name: "Создайте команду для совместной работы", exact: true }).waitFor();
  await action(page, "Остаться в личном разделе").click();
  assert.equal((await (await libraryFinished).json()).state.status, "completed");
  await reminder(page);
  assert.equal((await journeyState(token)).completedSteps, 0);

  const roomResponse = await fetch(`${api}/public/rooms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Ранний вход в комнату", ownerDisplayName: "Интервьюер", language: "nodejs" }),
  });
  assert.equal(roomResponse.status, 200);
  const { inviteCode } = await roomResponse.json();
  await page.goto(`${web}/room/${inviteCode}`);
  await help(page).waitFor();
  assert.equal(await tour(page).count(), 0);
  await help(page).click();
  await tour(page).getByRole("heading", { name: "Личные заметки", exact: true }).waitFor();
  assert.equal((await journeyState(token)).completedSteps, 0);
});

test("an account can discover teams and continue with personal interviews", async (t) => {
  const { page, token } = await account(t);
  await page.goto(`${web}${personalInterviews}`);
  await welcome(page, token);
  await step(page, 1);
  await anchor(page, "personal-library-link").click();
  await step(page, 2);
  await action(page, "Перейти к командам без задачи").click();
  await step(page, 3);
  await tour(page).getByRole("button", { name: "Продолжить без команды", exact: true }).click();
  await step(page, 4);
  await tour(page).getByText(/совместно готовить задачи/i).waitFor();
  await anchor(page, "personal-interviews-link").click();
  await step(page, 6);
  await page.waitForURL(`**${personalInterviews}`);
});
