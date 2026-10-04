import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Создать комнату", { timeout: 15000 });
  await page.click("button:has-text('Создать комнату')");
  const dialog = page.getByRole("dialog", { name: "Создать комнату", exact: true });
  await dialog.getByRole("textbox", { name: "Ваше имя", exact: true }).fill("Smoke owner");
  await dialog.getByRole("textbox", { name: "Название комнаты", exact: true }).fill(`Smoke ${Date.now()}`);
  await dialog.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });
  await page.waitForSelector('[data-testid="room-code-editor-host"] .cm-editor', { timeout: 15000 });
  // The connection state used to be a "Подключено" badge in the top bar;
  // it's now a quieter LED indicator with `data-state="online"` once the
  // socket is up. We assert on the data attribute so the smoke test stays
  // robust to copy/styling changes in the top bar.
  await page.waitForSelector(
    '[data-testid="room-connection-status"][data-state="online"]',
    { timeout: 15000 },
  );
  const url = page.url();
  console.log(`E2E_OK ${url}`);
} catch (error) {
  console.error("E2E_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
