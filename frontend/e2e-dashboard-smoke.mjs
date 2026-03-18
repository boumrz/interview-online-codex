import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const nickname = `qa_ui_${Date.now()}`;

try {
  await page.goto("http://localhost:5173/login", { waitUntil: "networkidle" });
  await page.getByText("Регистрация", { exact: true }).click();
  await page.getByLabel("Ник").fill(nickname);
  await page.getByLabel("Пароль").fill("secret123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL(/\/dashboard\/rooms/, { timeout: 15000 });
  await page.getByRole("button", { name: "Комнаты", exact: true }).waitFor();
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page.waitForURL(/\/dashboard\/tasks/, { timeout: 15000 });
  await page.getByText("Создать задачу", { exact: true }).waitFor();
  console.log("DASHBOARD_UI_OK");
} catch (error) {
  console.error("DASHBOARD_UI_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
