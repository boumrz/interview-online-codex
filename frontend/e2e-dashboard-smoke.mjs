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
  await page.getByLabel("Имя для комнаты").fill(nickname);
  await page.getByLabel("Пароль").fill("secret123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL(/\/dashboard\/rooms/, { timeout: 15000 });
  await page.getByText("Комнаты", { exact: true }).waitFor();
  await page.getByText("Задачи", { exact: true }).first().click();
  await page.waitForURL(/\/dashboard\/tasks/, { timeout: 15000 });
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        return text.includes("Задачи для комнаты") || text.includes("Создать задачу");
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
