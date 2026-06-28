/**
 * E2E: Briefing «focus mode» + локальный fullscreen.
 *
 * Что проверяем (см. требования: "Сделать возможность делать маркдаун
 * во весь экран, и иметь возможность полностью заменять блок с кодом
 * на блок с этим маркдауном; если интервьюер это делает, у кандидата
 * тоже меняется блок с кодом"):
 *
 * 1. У интервьюера в тулбаре доступна кнопка focus-mode (replace
 *    code → markdown). Клик переключает состояние, и блок с
 *    редактором кода исчезает у самого интервьюера.
 * 2. Кандидат подключен в ту же комнату — у него тоже исчезает
 *    блок с CodeMirror-редактором (синхронизация через `briefingMarkdown`).
 * 3. Локальный fullscreen у интервьюера: кнопка expand разворачивает
 *    панель на весь viewport (data-expanded="on") и не влияет на
 *    раскладку у кандидата.
 *
 * Скрипт следует стилю остальных e2e: `playwright` (chromium headless),
 * `gotoWithRetry`, `enterNameIfPrompted`, `parseInviteCode` — без
 * внешних зависимостей.
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
  // Интервьюер открывает комнату.
  const interviewerContext = await browser.newContext();
  const interviewerPage = await interviewerContext.newPage();
  await gotoWithRetry(interviewerPage, webBaseUrl);
  await interviewerPage
    .getByRole("button", { name: "Создать комнату" })
    .click();
  await interviewerPage.waitForURL(/\/room\//, { timeout: 15000 });
  await interviewerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });
  const inviteCode = parseInviteCode(interviewerPage.url());
  if (!inviteCode)
    throw new Error(`INVITE_CODE_PARSE_FAILED url=${interviewerPage.url()}`);

  // Кандидат заходит по ссылке.
  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await gotoWithRetry(candidatePage, `${webBaseUrl}/room/${inviteCode}`);
  await enterNameIfPrompted(candidatePage, "Candidate Focus");
  await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });

  // Sanity: у обоих сейчас видим code-editor.
  if (!(await interviewerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').isVisible())) {
    throw new Error("FOCUS_MODE_PRECOND_INTERVIEWER_EDITOR_HIDDEN");
  }
  if (!(await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').isVisible())) {
    throw new Error("FOCUS_MODE_PRECOND_CANDIDATE_EDITOR_HIDDEN");
  }

  // (1) Включаем focus mode у интервьюера.
  const focusToggle = interviewerPage.locator(
    '[data-testid="briefing-focus-toggle"]',
  );
  await focusToggle.waitFor({ state: "visible", timeout: 8000 });
  await focusToggle.click();

  // У интервьюера блок с кодом должен скрыться.
  await interviewerPage
    .locator('[data-testid="room-code-editor-host"] .cm-editor')
    .waitFor({ state: "detached", timeout: 8000 });

  // (2) У кандидата блок с кодом тоже должен скрыться (synced).
  await candidatePage
    .locator('[data-testid="room-code-editor-host"] .cm-editor')
    .waitFor({ state: "detached", timeout: 8000 });

  // briefing-board должен быть в focus state у кандидата.
  const candidateBriefing = candidatePage.locator(
    '[data-testid="briefing-board-candidate"]',
  );
  await candidateBriefing.waitFor({ state: "visible", timeout: 5000 });
  const candidateFocus = await candidateBriefing.getAttribute("data-focus");
  if (candidateFocus !== "on") {
    throw new Error(
      `FOCUS_MODE_CANDIDATE_DATA_FOCUS_NOT_SET got=${candidateFocus}`,
    );
  }

  // (3) Выключаем focus mode и убеждаемся, что код вернулся обоим.
  await focusToggle.click();
  await interviewerPage
    .locator('[data-testid="room-code-editor-host"] .cm-editor')
    .waitFor({ state: "visible", timeout: 8000 });
  await candidatePage
    .locator('[data-testid="room-code-editor-host"] .cm-editor')
    .waitFor({ state: "visible", timeout: 8000 });

  // (4) Локальный fullscreen у интервьюера.
  const expandToggle = interviewerPage.locator(
    '[data-testid="briefing-expand-toggle"]',
  );
  await expandToggle.click();
  const ownerBriefing = interviewerPage.locator(
    '[data-testid="briefing-board-interviewer"]',
  );
  const expandedAttr = await ownerBriefing.getAttribute("data-expanded");
  if (expandedAttr !== "on") {
    throw new Error(
      `BRIEFING_EXPAND_NOT_APPLIED data-expanded=${expandedAttr}`,
    );
  }

  // У кандидата fullscreen НЕ должен включиться (это локальное состояние).
  const candidateExpand = await candidateBriefing.getAttribute(
    "data-expanded",
  );
  if (candidateExpand === "on") {
    throw new Error("BRIEFING_EXPAND_LEAKED_TO_CANDIDATE");
  }

  // ESC возвращает обратно.
  await interviewerPage.keyboard.press("Escape");
  const afterEscape = await ownerBriefing.getAttribute("data-expanded");
  if (afterEscape !== "off") {
    throw new Error(`BRIEFING_EXPAND_ESCAPE_FAILED data-expanded=${afterEscape}`);
  }

  console.log("BRIEFING_FOCUS_MODE_OK", inviteCode);

  await interviewerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("BRIEFING_FOCUS_MODE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
