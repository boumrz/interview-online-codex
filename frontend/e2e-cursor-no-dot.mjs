import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  const visible = await title.isVisible().catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

function parseInviteCode(url) {
  const match = url.match(/\/room\/([^/?#]+)/);
  return match ? match[1] : null;
}

const browser = await chromium.launch({ headless: true });

try {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.getByRole("button", { name: "Создать комнату" }).click();
  await ownerPage.waitForURL(/\/room\//, { timeout: 15000 });
  await ownerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').first().waitFor({ timeout: 15000 });

  const inviteCode = parseInviteCode(ownerPage.url());
  if (!inviteCode) throw new Error(`INVITE_CODE_PARSE_FAILED url=${ownerPage.url()}`);

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  const roomUrl = `${webBaseUrl}/room/${inviteCode}`;
  await candidatePage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Cursor Candidate");
  await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').first().waitFor({ timeout: 15000 });

  // Move candidate caret in the code editor to emit awareness updates.
  await candidatePage.bringToFront();
  await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-content').first().click({ force: true });
  await candidatePage.keyboard.press("End");
  await candidatePage.keyboard.type("x", { delay: 12 });
  await candidatePage.keyboard.press("ArrowLeft");

  // Wait until owner sees both participants in the top bar.
  await ownerPage.bringToFront();
  await ownerPage.waitForFunction(
    () => document.querySelectorAll('[data-testid^="participant-badge-"]').length >= 2,
    { timeout: 25_000 }
  );

  // Cursor must be a "stick" only: dot/bubble may exist in DOM but must not be visible.
  const cursorAdornmentState = await ownerPage.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.opacity === "0.0"
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const dots = Array.from(document.querySelectorAll(".cm-ySelectionCaretDot"));
    const bubbles = Array.from(document.querySelectorAll(".cm-ySelectionInfo"));
    return {
      dotsTotal: dots.length,
      dotsVisible: dots.filter(isVisible).length,
      bubblesTotal: bubbles.length,
      bubblesVisible: bubbles.filter(isVisible).length
    };
  });
  if (cursorAdornmentState.dotsVisible > 0 || cursorAdornmentState.bubblesVisible > 0) {
    throw new Error(
      `REMOTE_CURSOR_ADORNMENTS_SHOULD_BE_HIDDEN ${JSON.stringify(cursorAdornmentState)}`
    );
  }

  console.log("CURSOR_NO_DOT_OK", inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("CURSOR_NO_DOT_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
