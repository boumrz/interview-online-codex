/**
 * E2E: При создании задачи язык в модалке = язык активного таба.
 *
 * Что проверяем (требование: "Баг при создании задачи: если выбран
 * язык не базовый, то при самом создании по умолчанию базовый язык —
 * должен быть тот, который выбран в табах"):
 *
 * 1. Регистрируем пользователя и заходим на dashboard/tasks.
 * 2. Переключаем активный таб языка на `python` (через query-param
 *    `?lang=python`, который уже использует приложение).
 * 3. Открываем модалку «Создать задачу» — у селекта `Язык` value
 *    должно быть `python`, а не `nodejs`.
 * 4. Дополнительно проверяем то же для `kotlin`.
 *
 * Скрипт не делает реальный submit задачи, чтобы не загрязнять БД и
 * не зависеть от прав/REST. Достаточно сравнить значение селекта.
 */

import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const nickname = `qa_lang_${Date.now()}`;

async function selectedLanguage() {
  const input = page.locator(
    '[data-testid="create-task-language-select"] input',
  );
  return input.first().inputValue();
}

try {
  await page.goto(`${webBaseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByText("Регистрация", { exact: true }).click();
  await page.getByLabel("Ник").fill(nickname);
  await page.getByLabel("Имя для комнаты").fill(nickname);
  await page.getByLabel("Пароль").fill("secret123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL(/\/dashboard\/rooms/, { timeout: 15000 });

  // Переходим в `Задачи` и сразу выставляем активный таб через URL.
  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=python`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-testid="open-create-task-modal"]')
    .waitFor({ state: "visible", timeout: 15000 });
  await page.locator('[data-testid="open-create-task-modal"]').click();
  let value = await selectedLanguage();
  if (value !== "Python") {
    throw new Error(`TASK_CREATE_DEFAULT_LANG_MISMATCH expected=Python got=${value}`);
  }

  // Закрываем модалку (ESC) и проверяем другой язык.
  await page.keyboard.press("Escape");
  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=kotlin`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-testid="open-create-task-modal"]')
    .waitFor({ state: "visible", timeout: 15000 });
  await page.locator('[data-testid="open-create-task-modal"]').click();
  value = await selectedLanguage();
  if (value !== "Kotlin") {
    throw new Error(
      `TASK_CREATE_DEFAULT_LANG_MISMATCH expected=Kotlin got=${value}`,
    );
  }

  // И финально — plain text как новый язык (см. e2e-plaintext-language).
  await page.keyboard.press("Escape");
  await page.goto(`${webBaseUrl}/dashboard/tasks?lang=plaintext`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-testid="open-create-task-modal"]')
    .waitFor({ state: "visible", timeout: 15000 });
  await page.locator('[data-testid="open-create-task-modal"]').click();
  value = await selectedLanguage();
  if (value !== "Plain text") {
    throw new Error(
      `TASK_CREATE_DEFAULT_LANG_MISMATCH expected="Plain text" got=${value}`,
    );
  }

  console.log("TASK_CREATE_LANGUAGE_DEFAULT_OK");
} catch (error) {
  console.error("TASK_CREATE_LANGUAGE_DEFAULT_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
