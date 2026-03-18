import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Создать комнату" }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });

  const nextStepButtonVisible = await page.getByRole("button", { name: "Следующий шаг" }).isVisible().catch(() => false);
  if (nextStepButtonVisible) {
    throw new Error("NEXT_STEP_BUTTON_SHOULD_NOT_EXIST");
  }

  await page.getByRole("button", { name: /2\./ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /1\./ }).first().click();

  await page.getByRole("button", { name: "Приглашения", exact: true }).click();
  await page.getByText("Скопировать ссылку кандидата", { exact: true }).waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");

  const noteValue = `smoke note ${Date.now()}`;
  const notesInput = page.locator('[data-testid="room-notes-input"]');
  await notesInput.fill(noteValue);
  await page.waitForTimeout(1000);
  const actualValue = await notesInput.inputValue();
  if (actualValue !== noteValue) {
    throw new Error(`ROOM_NOTES_NOT_SAVED:${actualValue}`);
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
