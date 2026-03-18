import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function enterNameIfPrompted(page, name) {
  const promptVisible = await page.getByText("Представьтесь перед входом в комнату").isVisible().catch(() => false);
  if (!promptVisible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
}

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Role lock room ${Date.now()}`,
      ownerDisplayName: "Host QA",
      language: "javascript"
    })
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
  if (!room.ownerToken || !room.interviewerToken) {
    throw new Error("ROOM_TOKENS_MISSING");
  }

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Host QA");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Host QA");
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken
  });

  const interviewerContext = await browser.newContext();

  const ownerPage = await ownerContext.newPage();
  const interviewerPage = await interviewerContext.newPage();

  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "networkidle" });
  await ownerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });
  await ownerPage.getByRole("button", { name: "Приглашения", exact: true }).waitFor({ timeout: 10000 });

  await interviewerPage.goto(`${webBaseUrl}/room/${room.inviteCode}?interviewerToken=${encodeURIComponent(room.interviewerToken)}`, {
    waitUntil: "networkidle"
  });
  await enterNameIfPrompted(interviewerPage, "Interviewer QA");
  await interviewerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });
  await interviewerPage.getByRole("button", { name: "Приглашения", exact: true }).waitFor({ timeout: 10000 });

  await interviewerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "networkidle" });
  await interviewerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });
  const invitationsVisibleInCandidateMode = await interviewerPage
    .getByRole("button", { name: "Приглашения", exact: true })
    .isVisible()
    .catch(() => false);
  if (invitationsVisibleInCandidateMode) {
    throw new Error("CANDIDATE_LINK_SHOULD_NOT_HAVE_INTERVIEWER_ACCESS");
  }

  await interviewerPage.goto(`${webBaseUrl}/room/${room.inviteCode}?interviewerToken=${encodeURIComponent(room.interviewerToken)}`, {
    waitUntil: "networkidle"
  });
  await enterNameIfPrompted(interviewerPage, "Interviewer QA");
  await interviewerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });
  await interviewerPage.getByRole("button", { name: "Приглашения", exact: true }).waitFor({ timeout: 10000 });

  await interviewerPage.getByRole("button", { name: /^2\./ }).first().click();
  await ownerPage.getByText(/шаг 2\//i).waitFor({ timeout: 8000 });

  const ownerNotes = ownerPage.locator('[data-testid="room-notes-input"]');
  const interviewerNotes = interviewerPage.locator('[data-testid="room-notes-input"]');

  await ownerNotes.fill(`owner lock note ${Date.now()}`);
  await interviewerPage.getByText(/Пишет /i).waitFor({ timeout: 8000 });

  const interviewerDisabledDuringLock = await interviewerNotes.isDisabled();
  if (!interviewerDisabledDuringLock) {
    throw new Error("INTERVIEWER_NOTES_SHOULD_BE_LOCKED");
  }

  await interviewerPage.waitForTimeout(3300);

  const interviewerStillDisabled = await interviewerNotes.isDisabled();
  if (interviewerStillDisabled) {
    throw new Error("INTERVIEWER_NOTES_SHOULD_BE_UNLOCKED_AFTER_3S");
  }

  console.log("INTERVIEWER_ROLE_NOTES_LOCK_OK");

  await ownerContext.close();
  await interviewerContext.close();
} catch (error) {
  console.error("INTERVIEWER_ROLE_NOTES_LOCK_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
