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
 * 5. По завершении прогресс исчезает, файл `*.pdf` действительно
 *    скачивается (по `window.__roomLastDownload`).
 */

import { chromium } from "playwright";

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

  // Открыть таб заметок (мобильный layout) — для CI достаточно.
  const tasksRailButton = page.locator('[data-testid="room-rail-tasks"]');
  if (await tasksRailButton.isVisible().catch(() => false)) {
    await tasksRailButton.click();
  }

  // Массово создаём приватные заметки через UI ввод.
  const input = page.locator('[data-testid="room-private-notes-input"]');
  await input.waitFor({ state: "visible", timeout: 15000 });
  for (let i = 0; i < 120; i += 1) {
    await input.fill(`Заметка #${i} — длинный текст для нагрузки PDF-экспорта`);
    await page.keyboard.press("Enter");
  }

  // Открываем модалку экспорта.
  const openExport = page.locator('[data-testid="open-export-private-notes"]');
  if (await openExport.isVisible().catch(() => false)) {
    await openExport.click();
  } else {
    // Фолбэк по тексту, если data-testid в этой версии не выставлен.
    await page.getByRole("button", { name: "Экспорт", exact: false }).click();
  }

  // Жмём «Скачать .pdf» (не дожидаясь окончания).
  const pdfButton = page.locator(
    '[data-testid="private-notes-pdf-export-button"]',
  );
  await pdfButton.waitFor({ state: "visible", timeout: 8000 });
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

  // Проверяем факт скачивания через дебаг-крючок.
  const downloaded = await page.evaluate(() => window.__roomLastDownload || null);
  if (!downloaded || !/\.pdf$/i.test(downloaded.fileName)) {
    throw new Error(
      `PDF_EXPORT_DOWNLOAD_NOT_RECORDED ${JSON.stringify(downloaded)}`,
    );
  }

  console.log("PDF_EXPORT_PROGRESS_OK", downloaded.fileName);
} catch (error) {
  console.error("PDF_EXPORT_PROGRESS_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
