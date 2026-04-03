import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function enterNameIfPrompted(page, name) {
  const promptTitle = page.getByText("Представьтесь перед входом в комнату");
  const nameInput = page.getByLabel("Ваше имя");

  const promptVisibleNow = await promptTitle.isVisible().catch(() => false);
  if (!promptVisibleNow) {
    await nameInput.waitFor({ state: "visible", timeout: 1200 }).catch(() => {});
  }

  const promptVisible = await promptTitle.isVisible().catch(() => false);
  if (!promptVisible) return;

  await nameInput.fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await promptTitle.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Role lock room ${Date.now()}`,
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

async function openRoomToolsPanelIfNeeded(page) {
  const chatTab = page.getByRole("tab", { name: /^(Заметки|Чат)$/ }).first();
  const hasChatTab = await chatTab.isVisible().catch(() => false);
  if (hasChatTab) return;

  const roomToolsButton = page.getByRole("button", { name: "Открыть панель чата и логов" });
  const hasRoomToolsButton = await roomToolsButton.isVisible().catch(() => false);
  if (!hasRoomToolsButton) return;
  await roomToolsButton.click();
}

const browser = await chromium.launch({ headless: true });

try {
  const room = await createGuestRoom();
  if (!room.ownerToken) {
    throw new Error("ROOM_TOKENS_MISSING");
  }

  const ownerContext1 = await browser.newContext();
  const ownerContext2 = await browser.newContext();
  const candidateContext = await browser.newContext();

  const ownerPage1 = await ownerContext1.newPage();
  const ownerPage2 = await ownerContext2.newPage();
  const candidatePage = await candidateContext.newPage();

  await ownerPage1.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage1.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Host QA 1");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host QA 1");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken
  });
  await ownerPage1.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage1.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfNeeded(ownerPage1);
  await ownerPage1.getByRole("tab", { name: /^(Заметки|Чат)$/ }).waitFor({ timeout: 10000 });

  await ownerPage2.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await ownerPage2.evaluate(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Host QA 2");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host QA 2");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken
  });
  await ownerPage2.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage2.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfNeeded(ownerPage2);
  await ownerPage2.getByRole("tab", { name: /^(Заметки|Чат)$/ }).waitFor({ timeout: 10000 });

  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Candidate QA");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });
  const candidateHasChatComposer = await candidatePage.locator('[data-testid="room-notes-input"]').isVisible().catch(() => false);
  if (candidateHasChatComposer) {
    throw new Error("CANDIDATE_SHOULD_NOT_HAVE_INTERVIEWER_CHAT");
  }

  await ownerPage1.getByRole("tab", { name: /^(Заметки|Чат)$/ }).click();
  await ownerPage2.getByRole("tab", { name: /^(Заметки|Чат)$/ }).click();

  const ownerNotes1 = ownerPage1.locator('[data-testid="room-notes-input"]');
  const ownerNotes2 = ownerPage2.locator('[data-testid="room-notes-input"]');
  const ownerSend1 = ownerPage1.locator('[data-testid="room-notes-send"]');
  const ownerSend2 = ownerPage2.locator('[data-testid="room-notes-send"]');

  const ownerMessage = `owner chat note ${Date.now()}`;
  const collaboratorMessage = `collaborator chat note ${Date.now()}`;

  await ownerNotes1.fill(ownerMessage);
  await ownerSend1.click();
  await ownerPage2.getByText(ownerMessage, { exact: false }).waitFor({ timeout: 8000 });

  await ownerNotes2.fill(collaboratorMessage);
  await ownerSend2.click();
  await ownerPage1.getByText(collaboratorMessage, { exact: false }).waitFor({ timeout: 8000 });

  const ownerComposerValue = await ownerNotes1.inputValue();
  const collaboratorComposerValue = await ownerNotes2.inputValue();
  if (ownerComposerValue.trim() !== "" || collaboratorComposerValue.trim() !== "") {
    throw new Error("ROOM_NOTES_COMPOSER_SHOULD_CLEAR_AFTER_SEND");
  }

  console.log("INTERVIEWER_ROLE_NOTES_CHAT_OK");

  await ownerContext1.close();
  await ownerContext2.close();
  await candidateContext.close();
} catch (error) {
  console.error("INTERVIEWER_ROLE_NOTES_CHAT_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
