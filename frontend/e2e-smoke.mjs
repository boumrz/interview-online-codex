import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Создать комнату", { timeout: 15000 });
  await page.click("button:has-text('Создать комнату')");
  await page.waitForURL(/\/room\//, { timeout: 15000 });
  await page.waitForSelector(".monaco-editor", { timeout: 15000 });
  await page.waitForSelector("text=Подключено", { timeout: 15000 });
  const url = page.url();
  console.log(`E2E_OK ${url}`);
} catch (error) {
  console.error("E2E_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
