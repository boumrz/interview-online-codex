import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const interviews = "/workspace/personal/interviews";
const library = "/workspace/personal/library";
const browser = await chromium.launch();
after(() => browser.close());

async function post(path, data, token, headers = {}) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(data),
  });
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
}

async function fixture(t, width = 1440) {
  const { token } = await post("/auth/register", {
    nickname: `recovery${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    displayName: "Проверка восстановления обучения",
    password: "learning-test-password",
  });
  const { id, inviteCode } = await post("/rooms", { title: "Интервью для продолжения обучения" }, token);
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  t.after(() => context.close());
  await context.addInitScript((value) => localStorage.setItem("auth_token", value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const tour = page.locator("[data-learning-tour]");
  const action = (name) => tour.getByRole("button", { name, exact: true });
  const help = page.getByRole("button", { name: "Помощь", exact: true });
  const anchor = (name) => page.locator(`[data-learning-anchor="${name}"]:visible`).first();
  const state = async () => {
    const response = await fetch(`${api}/me/learning/onboarding`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.ok, true);
    return response.json();
  };
  const deleteRoom = async () => {
    const response = await fetch(`${api}/me/rooms/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.ok, true);
  };
  const teamTracks = async () => {
    const { team } = await post("/teams", { name: "Команда для восстановления обучения" }, token, {
      "Idempotency-Key": randomUUID(),
    });
    return `/workspace/teams/${team.id}/tracks`;
  };
  return { page, tour, action, help, anchor, state, deleteRoom, teamTracks, room: `/room/${inviteCode}` };
}

async function step(flow, number, heading) {
  await flow.tour.getByRole("heading", { name: heading, exact: true })
    .and(flow.page.locator(`[data-learning-step="${number}"]`)).waitFor();
  assert.equal(await flow.tour.count(), 1, "there is only one current guide");
}

async function startAtLibrary(flow) {
  await flow.page.goto(`${web}${interviews}`);
  await flow.action("Начать обучение").click();
  await step(flow, 1, "Откройте библиотеку");
  const libraryLink = flow.anchor("personal-library-link");
  if (!await libraryLink.isVisible()) {
    await flow.anchor("personal-sections-menu").click();
  }
  await libraryLink.click();
  await flow.page.waitForURL(`**${library}`);
  await step(flow, 2, "Создайте задачу");
  const saved = await flow.state();
  assert.equal(saved.status, "in_progress");
  assert.equal(saved.completedSteps, 1);
  return saved;
}

async function resumeInLibrary(flow, saved) {
  await flow.action("Продолжить первый маршрут").click();
  await flow.page.waitForURL(`**${library}`);
  await step(flow, 2, "Создайте задачу");
  await flow.anchor("library-create-task").and(flow.page.locator('[data-learning-focus="true"]')).waitFor();
  const resumed = await flow.state();
  assert.equal(resumed.status, "in_progress");
  assert.equal(resumed.attempt, saved.attempt);
  assert.equal(resumed.firstStartedAt, saved.firstStartedAt);
  assert.equal(resumed.completedSteps, saved.completedSteps);
}

async function enterRoomWithoutTeam(flow) {
  await flow.action("Перейти к командам без задачи").click();
  await step(flow, 3, "Выберите рабочее пространство");
  await flow.action("Продолжить без команды").click();
  await step(flow, 4, "Посмотрите, как работает команда");
  await flow.anchor("personal-interviews-link").click();
  await step(flow, 6, "Войдите в комнату интервью");
  await flow.anchor("interview-enter").click();
  await flow.page.waitForURL(`**${flow.room}`);
  await step(flow, 7, "Личные заметки");
}

test("an unfinished route can return to its checkpoint after browser Back and a reload", async (t) => {
  const flow = await fixture(t);
  const saved = await startAtLibrary(flow);
  await flow.page.goBack();
  await flow.page.waitForURL(`**${interviews}`);
  await flow.page.reload();
  await flow.help.waitFor();
  await flow.tour.waitFor({ state: "hidden" });
  assert.equal((await flow.state()).completedSteps, saved.completedSteps);
  await flow.help.click();
  await flow.tour.getByRole("heading", { name: /Создайте задачи в библиотеке|Откройте библиотеку/ }).waitFor();
  assert.equal(new URL(flow.page.url()).pathname, interviews, "opening help stays on the current page");

  await resumeInLibrary(flow, saved);
  await enterRoomWithoutTeam(flow);
  await flow.action("Перейти к задачам").click();
  await step(flow, 8, "Добавьте первую задачу");
  await flow.action("Продолжить без задач").click();
  for (const [number, alternative] of [
    [9, "Оставить текущий режим"],
    [10, "Оставить текущий размер"],
    [11, "Продолжить без доски"],
    [12, "Продолжить без диаграммы"],
  ]) {
    await flow.tour.locator(`[data-learning-step="${number}"]`).waitFor();
    await flow.action(alternative).click();
  }
  await flow.tour.locator('[data-learning-step="13"]').waitFor();
  await flow.page.getByRole("tab", { name: "Активность", exact: true }).click();
  await flow.tour.locator('[data-learning-step="14"]').waitFor();
  await flow.action("Закончить без изменения результата").click();
  await flow.page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  const completed = await flow.state();
  assert.equal(completed.status, "completed");
  assert.equal(completed.attempt, saved.attempt);
  assert.equal(completed.completedSteps, 14);
});

test("room help on a narrow screen can recover a workspace checkpoint and resume after Escape", async (t) => {
  const flow = await fixture(t, 768);
  const saved = await startAtLibrary(flow);
  await flow.page.goto(`${web}${flow.room}`);
  await flow.help.waitFor();
  await flow.tour.waitFor({ state: "hidden" });
  await flow.help.click();
  await flow.tour.getByRole("heading", { name: "Личные заметки", exact: true }).waitFor();
  assert.equal(new URL(flow.page.url()).pathname, flow.room, "room help starts in room context");
  await resumeInLibrary(flow, saved);
  await flow.page.keyboard.press("Escape");
  await flow.page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  await flow.page.reload();
  await step(flow, 2, "Создайте задачу");
  assert.equal((await flow.state()).completedSteps, saved.completedSteps);
});

test("team tracks keep their own help while offering recovery to a personal checkpoint", async (t) => {
  const flow = await fixture(t);
  const saved = await startAtLibrary(flow);
  const tracks = await flow.teamTracks();
  await flow.page.goto(`${web}${tracks}`);
  await flow.help.click();
  await flow.tour.getByRole("heading", { name: "Найти трек", exact: true }).waitFor();
  assert.equal(new URL(flow.page.url()).pathname, tracks, "help starts in the team's current context");
  await resumeInLibrary(flow, saved);
});

test("a room checkpoint survives losing the original room and can resume in a new room", async (t) => {
  const flow = await fixture(t);
  await startAtLibrary(flow);
  await enterRoomWithoutTeam(flow);
  await flow.action("Перейти к задачам").click();
  await step(flow, 8, "Добавьте первую задачу");
  const saved = await flow.state();
  assert.equal(saved.completedSteps, 7);
  await flow.page.goto(`${web}${library}`);
  await flow.deleteRoom();
  await flow.help.click();
  await flow.tour.getByRole("heading", { name: "Создайте задачу", exact: true }).waitFor();
  await flow.action("Продолжить первый маршрут").click();
  await flow.page.waitForURL(`**${interviews}`);
  await flow.tour.getByText("Откройте комнату, чтобы продолжить", { exact: true }).waitFor();
  const waiting = await flow.state();
  assert.equal(waiting.attempt, saved.attempt);
  assert.equal(waiting.completedSteps, saved.completedSteps);

  await flow.anchor("interview-create").click();
  await flow.page.waitForURL("**/interviews/new");
  await flow.page.getByRole("textbox", { name: /название интервью/i }).fill("Новая комната");
  await flow.anchor("interview-submit").click();
  await flow.page.waitForURL(/\/room\/[^/?]+/);
  assert.notEqual(new URL(flow.page.url()).pathname, flow.room);
  await step(flow, 8, "Добавьте первую задачу");
  const resumed = await flow.state();
  assert.equal(resumed.attempt, saved.attempt);
  assert.equal(resumed.completedSteps, saved.completedSteps);
});
