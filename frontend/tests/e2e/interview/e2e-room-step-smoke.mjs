import "../support/require-isolated-api.mjs";
import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Создать комнату" }).click();
  await page.getByRole("dialog", { name: "Создать комнату" }).getByRole("button", { name: "Создать комнату", exact: true }).click();
  await page.waitForURL(/\/room\//, { timeout: 15000 });

  const returnLink = page.getByRole("link", { name: "Вернуться к списку интервью", exact: true });
  const homeLink = page.getByRole("link", { name: "Главная", exact: true });
  for (const [label, link] of [["RETURN", returnLink], ["HOME", homeLink]]) {
    const appearance = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderStyle: style.borderTopStyle, borderWidth: Number.parseFloat(style.borderTopWidth), height: element.getBoundingClientRect().height };
    });
    if (appearance.background === "rgba(0, 0, 0, 0)" || appearance.borderStyle === "none" || appearance.borderWidth < 1 || appearance.height < 32) {
      throw new Error(`ROOM_${label}_NAVIGATION_MUST_LOOK_LIKE_A_BUTTON:${JSON.stringify(appearance)}`);
    }
  }

  const candidateManagersAction = page.getByRole("button", { name: "Кандидат и нанимающие", exact: true });
  const candidateActionAppearance = await candidateManagersAction.evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, background: style.backgroundColor, borderWidth: Number.parseFloat(style.borderTopWidth) };
  });
  if (candidateActionAppearance.height < 32 || candidateActionAppearance.background === "rgba(0, 0, 0, 0)" || candidateActionAppearance.borderWidth < 1) {
    throw new Error(`ROOM_CANDIDATE_ACTION_MUST_LOOK_LIKE_A_CONTROL:${JSON.stringify(candidateActionAppearance)}`);
  }

  const editorMode = page.getByTestId("room-editor-mode-switch");
  await editorMode.waitFor();
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ timeout: 15_000 });
  if (!(await editorMode.textContent()).includes("Режим комнаты — Code")) {
    throw new Error("ROOM_EDITOR_MODE_MUST_SHOW_CURRENT_CODE_SELECTION");
  }
  const modeBox = await editorMode.boundingBox();
  if (!modeBox || modeBox.width < 100 || modeBox.x < 0 || modeBox.x + modeBox.width > page.viewportSize().width + 1) {
    throw new Error(`ROOM_EDITOR_MODE_GEOMETRY_INVALID:${JSON.stringify(modeBox)}`);
  }
  await editorMode.click();
  const choices = page.locator(".ant-select-dropdown:visible .ant-select-item-option");
  await choices.first().waitFor();
  const labels = await choices.allTextContents();
  if (labels.length !== 2 || !labels.includes("Code") || !labels.includes("Markdown")) {
    throw new Error(`ROOM_EDITOR_MODE_MUST_OFFER_CODE_AND_MARKDOWN:${JSON.stringify(labels)}`);
  }
  await choices.getByText("Markdown", { exact: true }).click();
  const modeConfirmation = page.getByRole("dialog", { name: "Изменить режим комнаты?" });
  await modeConfirmation.getByText("Изменится редактор кандидата и всех интервьюеров.", { exact: true }).waitFor();
  if (!(await editorMode.textContent()).includes("Режим комнаты — Code")) {
    throw new Error("ROOM_EDITOR_MODE_CHANGED_BEFORE_CONFIRMATION");
  }
  await modeConfirmation.getByRole("button", { name: "Изменить режим", exact: true }).click();
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ state: "hidden", timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Режим комнаты — Markdown"));
  await editorMode.click();
  await page.locator(".ant-select-dropdown:visible").getByText("Code", { exact: true }).click();
  await modeConfirmation.getByRole("button", { name: "Изменить режим", exact: true }).click();
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ state: "visible", timeout: 8000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes("Режим комнаты — Code"));

  const nextStepButtonVisible = await page.getByRole("button", { name: "Следующий шаг" }).isVisible().catch(() => false);
  if (nextStepButtonVisible) {
    throw new Error("NEXT_STEP_BUTTON_SHOULD_NOT_EXIST");
  }

  await page.getByRole("tab", { name: "Шаги", exact: true }).click();
  await page.getByRole("button", { name: /2\./ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /1\./ }).first().click();

  // Notes are now an interviewer chat: sending should append a bubble with timestamp.
  // The left-rail "Чат" button (was "Открыть панель чата и логов" before
  // we added a caption + new aria-label). Selected by data-testid for
  // stability across copy/iconography changes.
  const roomToolsButton = page.locator('[data-testid="room-rail-tools"]');
  if (await roomToolsButton.isVisible().catch(() => false)) {
    await roomToolsButton.click();
  }
  await page.getByRole("tab", { name: /^(Заметки|Чат)$/ }).click();
  await page.locator('[data-testid="room-notes-input"]').waitFor({ timeout: 5000 });

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
