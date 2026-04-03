import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Создать комнату" }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });

  const nextStepButtonVisible = await page.getByRole("button", { name: "Следующий шаг" }).isVisible().catch(() => false);
  if (nextStepButtonVisible) {
    throw new Error("NEXT_STEP_BUTTON_SHOULD_NOT_EXIST");
  }

  await page.getByRole("button", { name: /2\./ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /1\./ }).first().click();

  // Notes are now an interviewer chat: sending should append a bubble with timestamp.
  const roomToolsButton = page.getByRole("button", { name: "Открыть панель чата и логов" });
  if (await roomToolsButton.isVisible().catch(() => false)) {
    await roomToolsButton.click();
  }
  await page.getByRole("tab", { name: /^(Заметки|Чат)$/ }).click();
  await page.getByRole("tabpanel", { name: "Чат заметок" }).waitFor({ timeout: 5000 });

  const messageValue = `smoke message ${Date.now()}`;
  const notesInput = page.locator('[data-testid="room-notes-input"]');
  const sendButton = page.locator('[data-testid="room-notes-send"]');
  await notesInput.fill(messageValue);
  await sendButton.click();

  // Bubble should appear (optimistic or server-confirmed).
  await page.getByText(messageValue, { exact: true }).waitFor({ timeout: 8000 });
  // Composer should clear after sending.
  const actualValue = await notesInput.inputValue();
  if (actualValue.trim() !== "") {
    throw new Error(`ROOM_NOTES_COMPOSER_NOT_CLEARED:${actualValue}`);
  }

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
