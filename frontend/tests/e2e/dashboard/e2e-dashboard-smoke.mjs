import "../support/require-isolated-api.mjs";
import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const nickname = `qa_ui_${Date.now()}`;

try {
  await page.goto(`${webBaseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByText("Регистрация", { exact: true }).click();
  await page.getByLabel("Ник").fill(nickname);
  await page.getByLabel("Имя").fill(nickname);
  await page.getByLabel("Пароль", { exact: true }).fill("secret123");
  await page.getByLabel("Повторите пароль", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL(/\/workspace\/personal\/interviews$/, { timeout: 15000 });
  await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
  await page.waitForURL(/\/workspace\/personal\/interviews\/new/, { timeout: 15000 });
  await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
  await page.getByRole("dialog", { name: "Создать интервью", exact: true }).getByRole("button", { name: "Отмена", exact: true }).click();
  await page.getByRole("link", { name: /Библиотека/ }).click();
  await page.waitForURL(/\/workspace\/personal\/library/, { timeout: 15000 });
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return text.includes("Библиотека") && text.includes("Создать задачу");
      },
      null,
      { timeout: 15000 }
    );
  console.log("DASHBOARD_UI_OK");
} catch (error) {
  console.error("DASHBOARD_UI_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
