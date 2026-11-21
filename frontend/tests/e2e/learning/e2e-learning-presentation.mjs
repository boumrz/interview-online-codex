import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;

async function post(path, body, token) {
  const response = await fetch(`${api}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response.json();
}

async function fixture(t, width) {
  const { token } = await post("/auth/register", { nickname: `tour${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    displayName: "Проверка подсказок", password: "lesson-test-password" });
  await post("/me/learning/onboarding", { commandId: randomUUID(), action: "offer_skip", source: "offer",
    expectedVersion: 2, expectedRevision: 0 }, token);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "dark" });
  await context.addInitScript((value) => localStorage.setItem("auth_token", value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  return { page, token };
}

async function assertHit(locator) {
  assert.equal(await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && element.contains(hit);
  }), true, "the actual control receives pointer hits");
}

async function assertBelowWithoutOverlap(page, anchor, popup, obstacles = []) {
  await page.waitForFunction(({ anchorSelector, popupSelector, obstacleSelectors }) => {
    const target = document.querySelector(anchorSelector)?.getBoundingClientRect();
    const card = document.querySelector(popupSelector)?.getBoundingClientRect();
    if (!target || !card || card.top < target.bottom || card.top - target.bottom > 22 ||
        card.left >= target.right || card.right <= target.left) return false;
    return obstacleSelectors.every((selector) => {
      const obstacle = document.querySelector(selector)?.getBoundingClientRect();
      return obstacle && (card.right <= obstacle.left || card.left >= obstacle.right ||
        card.bottom <= obstacle.top || card.top >= obstacle.bottom);
    });
  }, { anchorSelector: anchor, popupSelector: popup, obstacleSelectors: obstacles });
}

test("task authoring uses a neutral border and the finished cue leaves Create set clickable", async (t) => {
  const { page } = await fixture(t, 1440);
  await page.goto(`${web}/workspace/personal/library`);
  await page.getByRole("button", { name: "Помощь", exact: true }).click();
  await page.getByRole("heading", { name: "Создайте задачу", exact: true }).waitFor();
  await assertBelowWithoutOverlap(page, '[data-learning-anchor="library-create-task"]', '[data-learning-tour]',
    ['[data-learning-anchor="library-create-task"]']);
  await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
  const task = page.getByRole("dialog", { name: "Создать задачу", exact: true });
  const inline = task.locator("[data-learning-tour]");
  await inline.waitFor();
  const borders = await inline.evaluate((panel) => {
    const style = getComputedStyle(panel.parentElement);
    return [style.borderInlineStartWidth, style.borderInlineEndWidth, style.borderInlineStartColor, style.borderInlineEndColor];
  });
  assert.equal(borders[0], borders[1]);
  assert.equal(borders[2], borders[3]);
  await task.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
  await page.getByRole("button", { name: "Перейти к командам без набора", exact: true }).click();
  await page.getByRole("button", { name: "Остаться в личном разделе", exact: true }).click();
  await page.getByText("Подсказки всегда здесь", { exact: true }).waitFor();
  const createSet = page.getByRole("button", { name: "Создать набор", exact: true });
  await assertHit(createSet);
  await createSet.click();
  await page.getByRole("dialog", { name: "Создать набор", exact: true }).waitFor();
});

test("the room spotlight dims the background while keeping actual controls interactive", async (t) => {
  const { page, token } = await fixture(t, 768);
  const room = await post("/rooms", { title: "Проверка затемнения", taskIds: [] }, token);
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.getByRole("button", { name: "Помощь", exact: true }).first().click();
  await page.getByRole("heading", { name: "Личные заметки", exact: true }).waitFor();
  const highlight = page.locator("[data-learning-spotlight]");
  await highlight.waitFor();
  assert.equal(await highlight.evaluate((element) => getComputedStyle(element).pointerEvents), "none");
  assert.notEqual(await highlight.evaluate((element) => getComputedStyle(element).boxShadow), "none");
  const notes = page.getByRole("tab", { name: "Мои заметки", exact: true });
  await assertHit(notes);
  const mode = page.getByTestId("room-editor-mode-switch");
  const combobox = mode.getByRole("combobox");
  await assertHit(mode);
  await mode.click();
  const listbox = await combobox.getAttribute("aria-controls");
  const dropdownSelector = `.ant-select-dropdown:has([id=${JSON.stringify(listbox)}])`;
  const markdown = page.locator(dropdownSelector).getByText("Markdown", { exact: true });
  await markdown.waitFor();
  await markdown.click({ trial: true });
  await combobox.press("Escape");
  await markdown.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Личные заметки", exact: true }).waitFor();
  await page.getByRole("button", { name: "Перейти к задачам", exact: true }).click();
  await page.getByRole("tab", { name: "Шаги", exact: true }).click();
  await page.getByRole("heading", { name: "Добавьте первую задачу", exact: true }).waitFor();
  await page.getByRole("button", { name: "Продолжить без задач", exact: true }).click();
  await page.getByRole("heading", { name: "Режим комнаты", exact: true }).waitFor();
  await mode.click();
  await markdown.waitFor();
  await page.getByRole("heading", { name: "Режим комнаты", exact: true }).waitFor();
  await highlight.waitFor();
  await page.waitForFunction((selector) => {
    const menu = document.querySelector(selector)?.getBoundingClientRect();
    const mode = document.querySelector('[data-learning-anchor="room-mode"]')?.getBoundingClientRect();
    const card = document.querySelector('[data-learning-tour]')?.getBoundingClientRect();
    const hole = document.querySelector('[data-learning-spotlight]')?.getBoundingClientRect();
    if (!card || !hole || !menu || !mode) return false;
    const distance = (box) => Math.hypot(Math.max(card.left - box.right, box.left - card.right, 0),
      Math.max(card.top - box.bottom, box.top - card.bottom, 0));
    const menuGap = distance(menu);
    const modeGap = distance(mode);
    return menuGap > 0 && modeGap > 0 && Math.min(menuGap, modeGap) <= 22 &&
      hole.left <= menu.left && hole.top <= menu.top && hole.right >= menu.right && hole.bottom >= menu.bottom;
  }, dropdownSelector);
  await markdown.click({ trial: true });
  await combobox.press("Escape");
  await markdown.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Режим комнаты", exact: true }).waitFor();
  await mode.click();
  await markdown.click();
  const confirmation = page.getByRole("dialog", { name: "Изменить режим комнаты?", exact: true });
  await confirmation.waitFor();
  await highlight.waitFor({ state: "hidden" });
  await confirmation.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("heading", { name: "Режим комнаты", exact: true }).waitFor();
});
