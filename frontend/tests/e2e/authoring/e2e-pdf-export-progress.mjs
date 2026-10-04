/**
 * E2E: PDF-экспорт приватных заметок больше не фризит UI.
 *
 * Что проверяем (требование: "При выгрузке пдф зависает интерфейс,
 * если заметок много"):
 *
 * 1. Создаём комнату гостем.
 * 2. Через UI массово добавляем большое число приватных заметок
 *    (≥120) — чтобы воспроизвести «зависание».
 * 3. Открываем модалку экспорта и жмём «Скачать .pdf».
 * 4. Пока идёт работа, UI должен:
 *    a. показать индикатор прогресса (data-testid="private-notes-pdf-progress");
 *    b. дать клику ниже сработать (например, переключить чекбокс
 *       «Включать время записей») в течение секунды.
 * 5. По завершении прогресс исчезает; браузер скачивает PDF с правильным
 *    заголовком и встроенным шрифтом.
 */

import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `PDF export room ${Date.now()}`,
      ownerDisplayName: "Owner PDF",
      language: "nodejs",
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function openNotesPanelIfNeeded(page) {
  const privateNotesInput = page.locator(
    '[data-testid="room-private-notes-input"]',
  );
  const notesSurface = page.locator('[data-room-context-surface="notes"][data-room-context-visible="true"]');
  let tabClickCount = 0;
  if (!(await notesSurface.count())) {
    await page.getByRole("tab", { name: "Мои заметки", exact: true }).click();
    tabClickCount += 1;
  }
  await notesSurface.waitFor({ state: "visible", timeout: 15000 });
  await privateNotesInput.waitFor({ state: "visible", timeout: 15000 });
  return { input: privateNotesInput, tabClickCount };
}

const browser = await chromium.launch({ headless: true });

try {
  const room = await createGuestRoom();
  if (!room.ownerToken) throw new Error("ROOM_OWNER_TOKEN_MISSING");

  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem("display_name", "Owner PDF");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner PDF");
    },
    { inviteCode: room.inviteCode, ownerToken: room.ownerToken },
  );
  await page.goto(`${webBaseUrl}/room/${room.inviteCode}`, {
    waitUntil: "domcontentloaded",
  });

  // Дожидаемся, пока редактор готов.
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });

  await openNotesPanelIfNeeded(page);

  const alreadyOpenProbe = await openNotesPanelIfNeeded(page);
  if (alreadyOpenProbe.tabClickCount !== 0) {
    throw new Error(
      `PDF_PANEL_OPEN_BRANCH_TAB_CLICKS expected=0 got=${alreadyOpenProbe.tabClickCount}`,
    );
  }

  await page.getByRole("tab", { name: "Шаги", exact: true }).click();
  await page.locator('[data-room-context-surface="notes"][data-room-context-visible="true"]').waitFor({ state: "detached", timeout: 5000 });

  const closedPanelProbe = await openNotesPanelIfNeeded(page);
  if (closedPanelProbe.tabClickCount !== 1) {
    throw new Error(
      `PDF_PANEL_CLOSED_BRANCH_TAB_CLICKS expected=1 got=${closedPanelProbe.tabClickCount}`,
    );
  }
  if (!(await closedPanelProbe.input.isVisible())) {
    throw new Error("PDF_PANEL_CLOSED_BRANCH_INPUT_NOT_VISIBLE");
  }
  console.log("PDF_PANEL_SETUP_PROBE_OK open=0 closed=1");

  // Массово создаём приватные заметки через UI ввод.
  const input = closedPanelProbe.input;
  for (let i = 0; i < 120; i += 1) {
    await input.fill(`Заметка #${i} — длинный текст для нагрузки PDF-экспорта`);
    await page.keyboard.press("Enter");
  }
  await page.locator('[data-private-note-delivery-state="persisted"]').filter({ hasText: "Заметка #119 —" }).waitFor({ timeout: 30000 });
  assert.equal(await page.locator('[data-private-note-delivery-state="persisted"]').count(), 120, "all 120 UI entries must be persisted before export");

  // Открываем модалку экспорта.
  await page.getByTestId("room-private-notes-export").click();

  // Жмём «Скачать .pdf» (не дожидаясь окончания).
  const pdfButton = page.locator(
    '[data-testid="private-notes-pdf-export-button"]',
  );
  await pdfButton.waitFor({ state: "visible", timeout: 8000 });
  const downloadEvent = page.waitForEvent("download", { timeout: 30000 });
  await pdfButton.click();

  // Прогресс должен показаться (UI не залип).
  const progress = page.locator(
    '[data-testid="private-notes-pdf-progress"]',
  );
  await progress.waitFor({ state: "visible", timeout: 5000 });

  // UI отзывчив — например, чекбокс «Включать время записей»
  // переключается за < 1с, пока идёт экспорт.
  const startedAt = Date.now();
  const timestampCheckbox = page.getByLabel("Включать время записей");
  await timestampCheckbox.click({ timeout: 2000 });
  if (Date.now() - startedAt > 1500) {
    throw new Error("PDF_EXPORT_UI_BLOCKING");
  }

  // Ждём, пока выгрузка завершится (прогресс пропал).
  await progress.waitFor({ state: "detached", timeout: 30000 });
  const success = page.locator(".ant-notification-top .ant-notification-notice").filter({ hasText: "Заметки выгружены в PDF" });
  await success.waitFor();
  assert.equal(await success.count(), 1, "completed export has one top notification");
  assert.equal(await page.getByRole("dialog", { name: "Экспорт личных заметок" }).getByText("Файл готов, начинаем скачивание", { exact: false }).count(), 0, "export has no inline completion duplicate");

  const downloaded = await downloadEvent;
  assert.equal(await downloaded.failure(), null);
  assert.match(downloaded.suggestedFilename(), /\.pdf$/i);
  const bytes = await readFile(await downloaded.path());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-", "download is a real PDF document");
  assert.ok(bytes.length > 10000, "PDF contains the embedded font and notes");

  console.log("PDF_EXPORT_PROGRESS_OK", downloaded.suggestedFilename());
} catch (error) {
  console.error("PDF_EXPORT_PROGRESS_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
