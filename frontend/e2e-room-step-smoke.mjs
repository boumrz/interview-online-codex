import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Создать комнату" }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });
  await page.getByRole("button", { name: /2\./ }).first().click();
  await page.getByRole("button", { name: "Следующий шаг" }).click();
  await page.getByRole("button", { name: "Следующий шаг" }).click();
  await page.waitForTimeout(500);
  const errorVisible = await page.getByText("Некорректный формат WebSocket сообщения").isVisible().catch(() => false);
  if (errorVisible) {
    throw new Error("WS_FORMAT_ERROR_VISIBLE");
  }
  console.log("ROOM_STEP_OK");
} catch (error) {
  console.error("ROOM_STEP_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
