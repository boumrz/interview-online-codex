import { chromium } from "playwright";

const webBaseUrl = "http://localhost:5173";
const apiBaseUrl = "http://localhost:8080/api";

async function createRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Notes chat smoke ${Date.now()}`,
      ownerDisplayName: "Host QA",
      language: "nodejs"
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  if (await title.isVisible().catch(() => false)) {
    await page.getByLabel("Ваше имя").fill(name);
    await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
    await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }
}

async function waitForEditor(page) {
  await page.locator(".cm-editor").waitFor({ timeout: 20000 });
}

async function getEditorText(page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    const anyEditor = editor;
    const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
    return view?.state?.doc?.toString?.() ?? document.querySelector(".cm-content")?.textContent ?? "";
  });
}

const browser = await chromium.launch({ headless: true });
const room = await createRoom();
if (!room.ownerToken) {
  throw new Error("OWNER_TOKEN_MISSING");
}

const ownerContext1 = await browser.newContext();
const ownerContext2 = await browser.newContext();
const candidateContext = await browser.newContext();

const ownerPage1 = await ownerContext1.newPage();
const ownerPage2 = await ownerContext2.newPage();
const candidatePage = await candidateContext.newPage();

try {
  await ownerPage1.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage1.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Host QA 1");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host QA 1");
  }, { inviteCode: room.inviteCode, ownerToken: room.ownerToken });
  await ownerPage1.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await waitForEditor(ownerPage1);

  await ownerPage2.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage2.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Host QA 2");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host QA 2");
  }, { inviteCode: room.inviteCode, ownerToken: room.ownerToken });
  await ownerPage2.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await waitForEditor(ownerPage2);

  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Candidate QA");
  await waitForEditor(candidatePage);

  await ownerPage1.getByRole("tab", { name: "Заметки", exact: true }).click();
  await ownerPage2.getByRole("tab", { name: "Заметки", exact: true }).click();

  const ownerComposer1 = ownerPage1.locator('[data-testid="room-notes-input"]');
  const ownerSend1 = ownerPage1.locator('[data-testid="room-notes-send"]');
  const ownerComposer2 = ownerPage2.locator('[data-testid="room-notes-input"]');
  const ownerSend2 = ownerPage2.locator('[data-testid="room-notes-send"]');

  const initialHeight = await ownerComposer1.boundingBox().then((box) => box?.height ?? 0);
  const ownerMessage = [
    `owner smoke note ${Date.now()}`,
    "second line",
    "third line",
    "fourth line",
    "fifth line",
    "sixth line",
    "seventh line",
    "eighth line"
  ].join("\n");
  await ownerComposer1.fill(ownerMessage);
  await ownerPage1.waitForTimeout(250);
  const expandedHeight = await ownerComposer1.boundingBox().then((box) => box?.height ?? 0);
  if (!(expandedHeight > initialHeight + 20)) {
    throw new Error(`COMPOSER_DID_NOT_EXPAND initial=${initialHeight} expanded=${expandedHeight}`);
  }
  await ownerSend1.click();
  await ownerPage2.getByText(ownerMessage, { exact: false }).waitFor({ timeout: 12000 });

  const bubbleTime = await ownerPage2.locator("article", { hasText: "owner smoke note" }).locator("time").textContent();
  if (!bubbleTime || !/\d{2}:\d{2}/.test(bubbleTime)) {
    throw new Error(`TIME_NOT_VISIBLE:${bubbleTime}`);
  }

  const replyMessage = `owner reply ${Date.now()}`;
  await ownerComposer2.fill(replyMessage);
  await ownerSend2.click();
  await ownerPage1.getByText(replyMessage, { exact: false }).waitFor({ timeout: 12000 });

  const composer1Value = await ownerComposer1.inputValue();
  const composer2Value = await ownerComposer2.inputValue();
  if (composer1Value.trim() !== "" || composer2Value.trim() !== "") {
    throw new Error(`COMPOSER_NOT_CLEARED owner1=${composer1Value} owner2=${composer2Value}`);
  }

  const marker = `candidate-sync-${Date.now()}`;
  await ownerPage1.locator(".cm-content").click({ force: true });
  await ownerPage1.keyboard.press("End");
  await ownerPage1.keyboard.type(`\n${marker}\n`, { delay: 10 });
  await candidatePage.waitForTimeout(1500);
  const candidateDoc = await getEditorText(candidatePage);
  if (!candidateDoc.includes(marker)) {
    throw new Error(`THIRD_PARTICIPANT_DID_NOT_RECEIVE_CODE_SYNC marker=${marker} doc=${candidateDoc}`);
  }

  console.log("BROWSER_SMOKE_OK", room.inviteCode);
} catch (error) {
  console.error("BROWSER_SMOKE_FAIL", error);
  process.exitCode = 1;
} finally {
  await ownerContext1.close().catch(() => {});
  await ownerContext2.close().catch(() => {});
  await candidateContext.close().catch(() => {});
  await browser.close().catch(() => {});
}
