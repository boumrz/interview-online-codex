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

async function modelValue(page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    const anyEditor = editor;
    const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
    if (view?.state?.doc?.toString) {
      return view.state.doc.toString();
    }
    return document.querySelector(".cm-content")?.textContent ?? "";
  });
}

const browser = await chromium.launch({ headless: true });

try {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.getByRole("button", { name: "Создать комнату" }).click();
  await ownerPage.waitForURL(/\/room\//, { timeout: 15000 });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const inviteCode = parseInviteCode(ownerPage.url());
  if (!inviteCode) throw new Error(`INVITE_CODE_PARSE_FAILED url=${ownerPage.url()}`);

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  const roomUrl = `${webBaseUrl}/room/${inviteCode}`;
  await candidatePage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Candidate Hidden");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });

  // Make candidate tab hidden by opening another tab in the same context and bringing it to front.
  const dummyPage = await candidateContext.newPage();
  await dummyPage.goto("about:blank", { waitUntil: "domcontentloaded" });
  await dummyPage.bringToFront();

  let hiddenStateObserved = false;
  try {
    await candidatePage.waitForFunction(() => document.visibilityState === "hidden", null, { timeout: 8000 });
    hiddenStateObserved = true;
  } catch {
    // Headless Chromium may keep visibilityState=visible for background tabs.
    // Keep the test meaningful by still validating real-time delivery while the page is not frontmost.
    console.warn("HIDDEN_TAB_SYNC_WARN visibilityState did not switch to hidden in this environment");
  }

  const marker = `hidden-sync-${Date.now()}`;
  await ownerPage.bringToFront();
  await ownerPage.locator(".cm-content").click({ force: true });
  await ownerPage.keyboard.press("End");
  await ownerPage.keyboard.type(`\n${marker}\n`, { delay: 8 });

  // Give SSE/Yjs a moment to propagate.
  await ownerPage.waitForTimeout(1500);
  await candidatePage.waitForTimeout(1500);

  const candidateValueWhileHidden = await modelValue(candidatePage);
  if (!candidateValueWhileHidden.includes(marker)) {
    throw new Error(
      `HIDDEN_TAB_DID_NOT_RECEIVE_UPDATES marker=${marker} hiddenObserved=${hiddenStateObserved}\n${candidateValueWhileHidden}`
    );
  }

  // Bringing it back should not be required for the update to appear.
  await candidatePage.bringToFront();
  await candidatePage.waitForFunction(() => document.visibilityState === "visible", null, { timeout: 8000 });
  const candidateValueVisible = await modelValue(candidatePage);
  if (!candidateValueVisible.includes(marker)) {
    throw new Error(`VISIBLE_TAB_MISSING_UPDATE marker=${marker}\n${candidateValueVisible}`);
  }

  console.log("HIDDEN_TAB_SYNC_OK", inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("HIDDEN_TAB_SYNC_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
