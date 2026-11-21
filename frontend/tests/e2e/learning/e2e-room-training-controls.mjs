import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;

async function expectSpotlightOpening(page, name) {
  await page.waitForFunction((anchor) => {
    const target = document.querySelector(`[data-learning-anchor="${anchor}"]`);
    const mask = document.querySelector("[data-learning-spotlight]");
    if (!target || !mask || !getComputedStyle(mask).clipPath.startsWith("path(")) return false;
    const box = target.getBoundingClientRect();
    const previous = mask.style.pointerEvents;
    mask.style.pointerEvents = "auto";
    try {
      const atTarget = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const dimmed = [[2, 2], [innerWidth - 2, 2], [2, innerHeight - 2], [innerWidth - 2, innerHeight - 2]]
        .some(([x, y]) => document.elementFromPoint(x, y) === mask);
      return atTarget !== null && atTarget !== mask && dimmed;
    } finally {
      mask.style.pointerEvents = previous;
    }
  }, name);
}

async function post(path, data, token) {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
}

async function roomFixture(t, taskNames = [], width = 1440) {
  const auth = await post("/auth/register", {
    nickname: `lesson${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    displayName: "Проверка тура", password: "learning-test-password",
  });
  const taskIds = [];
  for (const title of taskNames) {
    const task = await post("/me/tasks", { title, description: "**Условие задачи**", starterCode: "", language: "nodejs" }, auth.token);
    taskIds.push(task.id);
  }
  const room = await post("/rooms", { title: "Тренировка комнаты", taskIds }, auth.token);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  await context.addInitScript((token) => localStorage.setItem("auth_token", token), auth.token);
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const changes = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/events")) {
      const payload = request.postDataJSON();
      if (payload.type === "room_editor_mode_update") changes.push(payload.roomEditorMode);
    }
  });
  await page.goto(`${web}/room/${room.inviteCode}`);
  const welcome = page.locator("[data-learning-tour]").filter({
    has: page.getByRole("heading", { name: "Знакомство с InterHub", exact: true }),
  });
  await welcome.getByRole("button", { name: "Начать обучение", exact: true }).click();
  const tour = page.getByRole("dialog", { name: "Подсказки · Комната интервьюера", exact: true });
  const retry = tour.getByRole("button", { name: "Повторить", exact: true });
  const step = async (number) => {
    const heading = tour.locator(`[data-learning-step="${number}"]`);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await heading.or(retry).first().waitFor();
      if (!await retry.isVisible()) {
        assert.equal(await tour.getByRole("button", { name: /^(Назад|Далее)$/ }).count(), 0);
        return;
      }
      await retry.click();
      await retry.waitFor({ state: "hidden" });
    }
    await heading.waitFor();
    assert.equal(await retry.isVisible(), false);
  };
  const persisted = async () => {
    const response = await fetch(`${api}/rooms/${room.inviteCode}`, { headers: { Authorization: `Bearer ${auth.token}` } });
    assert.equal(response.ok, true);
    return response.json();
  };
  return { page, tour, step, changes, persisted };
}

test("room training follows real panel, mode and fullscreen actions without saving a result", async (t) => {
  const { page, tour, step, changes, persisted } = await roomFixture(t, ["Первая задача", "Локальная задача"]);
  const target = (name) => page.locator(`[data-learning-anchor="${name}"]`).filter({ visible: true }).first();
  const select = page.getByTestId("room-editor-mode-switch");
  const confirmMode = page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true });
  const choose = async (label) => {
    await select.click();
    const listbox = await select.getByRole("combobox").getAttribute("aria-controls");
    const dropdown = page.locator(".ant-select-dropdown").filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) });
    const option = dropdown.getByText(label, { exact: true });
    await option.waitFor();
    await tour.waitFor();
    await page.waitForFunction((id) => {
      const content = document.getElementById(id)?.closest(".ant-select-dropdown");
      const guide = document.querySelector("[data-learning-tour]");
      if (!content || !guide) return false;
      const menu = content.getBoundingClientRect();
      const card = guide.getBoundingClientRect();
      return menu.height > 0 && (card.right <= menu.left || card.left >= menu.right ||
        card.bottom <= menu.top || card.top >= menu.bottom);
    }, listbox);
    await option.click();
    await confirmMode.waitFor();
  };
  const approveMode = async () => {
    await confirmMode.getByRole("button", { name: "Изменить режим", exact: true }).click();
    await confirmMode.waitFor({ state: "hidden" });
  };
  const expandCanvas = async (canvas, number) => {
    await page.getByRole("button", { name: "На весь экран", exact: true }).click();
    await page.locator(`[data-${canvas}-expanded="true"]`).waitFor();
    await step(number);
  };
  const collapseCanvas = async (canvas) => {
    await page.getByRole("button", { name: "Вернуться в комнату", exact: true }).click();
    await page.locator(`[data-${canvas}-expanded="false"]`).filter({ visible: true }).first().waitFor();
  };

  await step(1);
  const notes = page.getByRole("tab", { name: "Мои заметки", exact: true });
  const focused = page.locator('[data-learning-focus="true"]');
  await notes.and(focused).waitFor();
  await tour.getByRole("heading", { name: "Личные заметки", exact: true }).waitFor();
  await tour.getByText(/записи видите только вы/i).waitFor();
  await notes.click();
  await step(1);
  assert.equal(await notes.getAttribute("aria-selected"), "true");
  const chat = page.getByRole("tab", { name: "Чат", exact: true });
  await chat.and(focused).waitFor();
  await tour.getByRole("heading", { name: "Чат интервьюеров", exact: true }).waitFor();
  await tour.getByText(/кандидат не видит этот чат/i).waitFor();
  assert.equal(await tour.getByText(/записи видите только вы/i).count(), 0);
  await chat.click();
  await step(1);
  assert.equal(await chat.getAttribute("aria-selected"), "true");
  const tasks = page.getByRole("tab", { name: "Шаги", exact: true });
  await tasks.and(focused).waitFor();
  await tour.getByRole("heading", { name: "Задачи интервью", exact: true }).waitFor();
  await tour.getByText(/«Шаги»/).waitFor();
  assert.equal(await tour.getByText(/кандидат не видит этот чат/i).count(), 0);
  await tasks.click();
  await step(2);
  await page.getByRole("button", { name: "2. Локальная задача", exact: true }).click();
  await step(3);
  assert.equal((await persisted()).currentStep, 0, "the guide selects a local task without publishing it");
  await choose("Markdown");
  assert.deepEqual(changes, [], "the real dialog precedes the mode command");
  await confirmMode.getByRole("button", { name: "Отмена", exact: true }).click();
  await confirmMode.waitFor({ state: "hidden" });
  await step(3);
  await choose("Markdown");
  await approveMode();
  assert.deepEqual(changes, ["markdown"]);
  await step(4);
  await target("room-markdown-expand").and(page.locator('[data-learning-focus="true"]')).waitFor();
  await target("room-markdown-expand").click();
  await page.locator('[data-expanded="on"]').filter({ has: target("room-markdown-collapse") }).waitFor();
  await target("room-markdown-collapse").and(page.locator('[data-learning-focus="true"]')).waitFor();
  await target("room-markdown-collapse").focus();
  await page.keyboard.press("Escape");
  await target("room-markdown-expand").waitFor();
  await step(4);
  await target("room-markdown-expand").click();
  await target("room-markdown-collapse").click();
  await target("room-markdown-expand").waitFor();
  await step(5);

  await choose("Доска");
  await approveMode();
  await tour.getByRole("heading", { name: "Инструменты доски", exact: true }).waitFor();
  await expectSpotlightOpening(page, "room-whiteboard-tools");
  const rectangle = page.getByRole("group", { name: "Инструменты доски", exact: true })
    .getByRole("radio", { name: "Прямоугольник", exact: true });
  await rectangle.click();
  await rectangle.and(page.locator(":checked")).waitFor();
  await tour.getByRole("heading", { name: "Доска на весь экран", exact: true }).waitFor();
  await target("room-whiteboard-expand").and(page.locator('[data-learning-focus="true"]')).waitFor();
  await expectSpotlightOpening(page, "room-whiteboard-tools");
  await expandCanvas("whiteboard", 5);
  await tour.getByRole("heading", { name: "Вернитесь к интервью", exact: true }).waitFor();
  await target("room-whiteboard-collapse").and(page.locator('[data-learning-focus="true"]')).waitFor();
  await expectSpotlightOpening(page, "room-whiteboard-tools");
  await collapseCanvas("whiteboard");
  await step(6);
  await choose("Редактор диаграмм");
  await approveMode();
  await page.getByTitle("Редактор схемы", { exact: true }).waitFor();
  await target("room-diagram-expand").and(page.locator('[data-learning-focus="true"]')).waitFor();
  await target("room-diagram-toolbar").getByRole("button", { name: /Закреплённый цвет/ }).click();
  await expandCanvas("diagram", 6);
  await collapseCanvas("diagram");
  await step(7);
  await page.getByRole("tab", { name: "Активность", exact: true }).click();
  await step(8);
  assert.equal(await page.getByRole("tab", { name: "Активность", exact: true }).getAttribute("aria-selected"), "true");
  const result = page.getByRole("dialog", { name: "Завершить интервью", exact: true });
  await page.getByRole("button", { name: "Завершить интервью", exact: true }).click();
  await result.waitFor();
  await tour.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await result.waitFor({ state: "hidden" });
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  assert.deepEqual(changes, ["markdown", "whiteboard", "diagram"]);
  assert.notEqual((await persisted()).status, "finished");
});

test("an empty interview can be explored without changing shared modes or completing the interview", async (t) => {
  const { page, tour, step, changes, persisted } = await roomFixture(t);
  const chooseAlternative = (name) => tour.getByRole("button", { name, exact: true }).click();
  await step(1);
  await chooseAlternative("Перейти к задачам");
  await step(2);
  await tour.getByRole("heading", { name: "Добавьте первую задачу", exact: true }).waitFor();
  await page.locator('[data-learning-anchor="room-task-panel"]').filter({ visible: true }).waitFor();
  await expectSpotlightOpening(page, "room-task-panel");
  assert.equal(await tour.getByText(/Переключить/).count(), 0);
  const addTask = page.getByRole("button", { name: "Задача", exact: true });
  await addTask.click();
  const taskPicker = page.getByRole("dialog", { name: /Добавить задачу/ });
  await taskPicker.waitFor();
  await page.keyboard.press("Escape");
  await taskPicker.waitFor({ state: "hidden" });
  await tour.getByRole("heading", { name: "Добавьте первую задачу", exact: true }).waitFor();
  await chooseAlternative("Продолжить без задач");
  await step(3);
  await chooseAlternative("Оставить текущий режим");
  await step(4);
  await chooseAlternative("Оставить текущий размер");
  await step(5);
  await chooseAlternative("Продолжить без доски");
  await step(6);
  await chooseAlternative("Продолжить без диаграммы");
  await step(7);
  await page.getByRole("tab", { name: "Активность", exact: true }).click();
  await step(8);
  await chooseAlternative("Закончить без изменения результата");
  await tour.waitFor({ state: "hidden" });
  assert.deepEqual(changes, []);
  assert.notEqual((await persisted()).status, "finished");
});

test("a room with one authored task explains how to add another without asking to switch", async (t) => {
  const { tour, step, changes } = await roomFixture(t, ["Единственная задача"]);
  await step(1);
  await tour.getByRole("button", { name: "Перейти к задачам", exact: true }).click();
  await step(2);
  await tour.getByRole("heading", { name: "Одна задача в комнате", exact: true }).waitFor();
  assert.equal(await tour.getByText(/Переключить/).count(), 0);
  await tour.getByRole("button", { name: "Оставить активную задачу", exact: true }).click();
  await step(3);
  assert.deepEqual(changes, []);
});

test("creating the first task changes the explanation in the existing lesson", async (t) => {
  const { page, tour, step, persisted } = await roomFixture(t);
  await tour.getByRole("button", { name: "Перейти к задачам", exact: true }).click();
  await step(2);
  await page.getByRole("button", { name: "Задача", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Добавить задачу в комнату", exact: true });
  await picker.getByText("Новая задача", { exact: true }).click();
  await picker.getByRole("textbox", { name: "Название", exact: true }).fill("Задача, созданная в комнате");
  await picker.getByRole("button", { name: "Добавить в комнату", exact: true }).click();
  await picker.waitFor({ state: "hidden" });
  await step(2);
  await tour.getByRole("heading", { name: "Одна задача в комнате", exact: true }).waitFor();
  assert.equal((await persisted()).tasks.length, 1);
});

test("the tablet guide returns from the steps panel to the selected Markdown editor", async (t) => {
  const { page, tour, step, changes } = await roomFixture(t, [], 768);
  await tour.getByRole("button", { name: "Перейти к задачам", exact: true }).click();
  await step(2);
  await page.getByRole("tab", { name: "Шаги", exact: true }).click();
  await tour.getByRole("button", { name: "Продолжить без задач", exact: true }).click();
  await step(3);
  const select = page.getByTestId("room-editor-mode-switch");
  const chooseMarkdown = async () => {
    await select.click();
    await page.locator(".ant-select-dropdown").filter({ visible: true }).getByText("Markdown", { exact: true }).click();
    return page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true });
  };
  const cancelled = await chooseMarkdown();
  await cancelled.getByRole("button", { name: "Отмена", exact: true }).click();
  await step(3);
  assert.deepEqual(changes, []);
  const confirm = await chooseMarkdown();
  await confirm.getByRole("button", { name: "Изменить режим", exact: true }).click();
  await step(4);
  await tour.getByRole("heading", { name: "Вернитесь к редактору", exact: true }).waitFor();
  await page.getByRole("button", { name: "Вернуться к редактору", exact: true }).click();
  await tour.getByRole("heading", { name: "Markdown на весь экран", exact: true }).waitFor();
  await page.locator('[data-learning-anchor="room-markdown-expand"][data-learning-focus="true"]').click();
  await page.locator('[data-learning-anchor="room-markdown-collapse"][data-learning-focus="true"]').click();
  await step(5);
  assert.deepEqual(changes, ["markdown"]);
});
