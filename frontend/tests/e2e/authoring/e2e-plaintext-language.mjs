/**
 * E2E: Plain text как полноценный «язык» комнаты.
 *
 * Что проверяем (требование: "добавить plain text в качестве «языка»,
 * чтобы не было привязки к синтаксису"):
 *
 * 1. В селекте языков на лендинге и в шапке комнаты доступен пункт
 *    "Plain text".
 * 2. При выборе языка `plaintext` редактор продолжает работать —
 *    можно набрать произвольный текст, синтаксической подсветки нет.
 * 3. Состояние языка передаётся кандидату (через `merged.language`).
 */

import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }
  throw lastError;
}

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  const visible = await title
    .waitFor({ state: "visible", timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page
    .getByRole("button", { name: "Войти в комнату", exact: true })
    .click();
  await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

function parseInviteCode(url) {
  const match = url.match(/\/room\/([^/?#]+)/);
  return match ? match[1] : null;
}

const browser = await chromium.launch({ headless: true });

try {
  const interviewerContext = await browser.newContext();
  const interviewerPage = await interviewerContext.newPage();
  await gotoWithRetry(interviewerPage, webBaseUrl);

  // (1) В селекте лендинга появился пункт Plain text. Открываем его и
  //     проверяем, что значение доступно для выбора.
  const langSelect = interviewerPage.getByLabel("Язык", { exact: false }).first();
  await langSelect.click();
  await interviewerPage
    .getByRole("option", { name: "Plain text" })
    .waitFor({ state: "visible", timeout: 5000 });
  await interviewerPage
    .getByRole("option", { name: "Plain text" })
    .click();

  await interviewerPage
    .getByRole("button", { name: "Создать комнату" })
    .click();
  await interviewerPage.waitForURL(/\/room\//, { timeout: 15000 });
  await interviewerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });
  const inviteCode = parseInviteCode(interviewerPage.url());
  if (!inviteCode) throw new Error(`INVITE_PARSE_FAILED url=${interviewerPage.url()}`);

  // (2) В редакторе пишем «обычный» текст и убеждаемся, что
  //     CodeMirror принимает ввод без падения по синтаксису.
  const cm = interviewerPage.locator('[data-testid="room-code-editor-host"] .cm-content');
  await cm.click();
  await interviewerPage.keyboard.type(
    "Hello, plain text! Не язык — просто заметки.",
  );

  // (3) Селект языка в шапке комнаты тоже показывает Plain text.
  const headerSelect = interviewerPage.locator("#room-language-select");
  const headerSelectValue = await headerSelect.inputValue().catch(() => "");
  if (!/plain text/i.test(headerSelectValue)) {
    throw new Error(
      `PLAINTEXT_HEADER_SELECT_VALUE_MISMATCH got="${headerSelectValue}"`,
    );
  }

  // (4) Кандидат заходит в ту же комнату — должен видеть код-редактор,
  //     не падая на отсутствии grammar.
  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await gotoWithRetry(candidatePage, `${webBaseUrl}/room/${inviteCode}`);
  await enterNameIfPrompted(candidatePage, "Candidate Plain");
  await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });
  await candidatePage.getByText("plain text", { exact: false }).waitFor({
    timeout: 12000,
  });

  console.log("PLAINTEXT_LANGUAGE_OK", inviteCode);

  await interviewerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("PLAINTEXT_LANGUAGE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
