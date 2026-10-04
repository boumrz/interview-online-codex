import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const browser = await chromium.launch({ headless: true });

try {
  const response = await fetch(`${api}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: `Заметки хоста ${Date.now()}`, ownerDisplayName: "Host notes QA", language: "nodejs" }),
  });
  assert.equal(response.status, 200);
  const room = await response.json();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(web, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host notes QA");
    localStorage.setItem("display_name", "Host notes QA");
  }, room);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor();
  const openNotes = async () => {
    await page.getByRole("tab", { name: "Мои заметки", exact: true }).click();
    await page.locator('[data-testid="room-private-notes-input"]').waitFor({ state: "visible" });
  };
  await openNotes();
  const note = "Сохранённая заметка хоста: проверены сложность, подход и коммуникация";
  await page.locator('[data-testid="room-private-notes-input"]').fill(note);
  await page.locator('[data-testid="room-private-notes-send"]').click();
  await page.locator('[data-private-note-delivery-state="persisted"]').filter({ hasText: note }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor();
  await openNotes();
  await page.getByText(note, { exact: true }).waitFor();
  await page.locator('[data-testid="room-private-notes-export"]').click();
  const dialog = page.getByRole("dialog", { name: "Экспорт личных заметок" });
  await dialog.waitFor();

  await page.route("**/fonts/Arial*.ttf", (route) => route.fulfill({ status: 503, body: "font unavailable" }));
  await dialog.getByRole("button", { name: "Скачать .pdf" }).click();
  await dialog.getByRole("alert").filter({ hasText: "Не удалось" }).waitFor({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Скачать .pdf" }).waitFor({ state: "visible" });
  assert.equal(await dialog.getByRole("button", { name: "Скачать .pdf" }).isEnabled(), true, "failed export must allow a retry");
  await page.unroute("**/fonts/Arial*.ttf");

  const mdEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Скачать .md" }).click();
  const md = await mdEvent;
  assert.equal(await md.failure(), null);
  assert.equal(md.suggestedFilename(), `${room.title}.md`);
  const markdown = await readFile(await md.path(), "utf8");
  assert.equal(markdown.startsWith(`# ${room.title}\n`), true);
  assert.equal(markdown.includes(note), true);
  assert.equal(markdown.includes(room.ownerToken), false);
  await dialog.getByRole("button", { name: "Скачать .pdf" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="private-notes-pdf-export-button"]')?.disabled);

  const pdfEvent = page.waitForEvent("download", { timeout: 30_000 });
  await dialog.getByRole("button", { name: "Скачать .pdf" }).click();
  const pdf = await pdfEvent;
  assert.equal(await pdf.failure(), null);
  assert.equal(pdf.suggestedFilename(), `${room.title}.pdf`);
  const bytes = await readFile(await pdf.path());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(bytes.length > 10_000, true, "PDF must contain the embedded Cyrillic font and notes");
  console.log("ROOM_NOTES_DOWNLOAD_OK: visible PDF failure, retry, persisted Markdown and real PDF downloads");
  await context.close();
} finally {
  await browser.close();
}
