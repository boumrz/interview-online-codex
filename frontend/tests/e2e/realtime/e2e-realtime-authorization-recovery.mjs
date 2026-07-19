import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Realtime authorization ${Date.now()}`,
      ownerDisplayName: "Realtime owner",
      language: "nodejs"
    })
  });
  const room = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_GUEST_ROOM_FAILED ${JSON.stringify(room)}`);
  }
  return room;
}

async function createCandidateContext(browser, inviteCode, displayName) {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ roomInviteCode, roomDisplayName }) => {
      localStorage.setItem(`guest_display_name_${roomInviteCode}`, roomDisplayName);
    },
    { roomInviteCode: inviteCode, roomDisplayName: displayName }
  );
  return context;
}

const browser = await chromium.launch({ headless: true });

try {
  const room = await createGuestRoom();

  const candidateContext = await createCandidateContext(browser, room.inviteCode, "Anonymous candidate");
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15000 });
  const addTaskControlVisible = await candidatePage.getByText("+ Задача", { exact: true }).isVisible().catch(() => false);
  if (addTaskControlVisible) {
    throw new Error("ANONYMOUS_CANDIDATE_RECEIVED_INTERVIEWER_CONTROLS");
  }
  await candidateContext.close();

  let rejectedEventRequests = 0;
  const rejectedContext = await createCandidateContext(browser, room.inviteCode, "Rejected candidate");
  const rejectedPage = await rejectedContext.newPage();
  await rejectedPage.route(/\/api\/realtime\/rooms\/[^/]+\/events$/, async (route) => {
    rejectedEventRequests += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "realtime access rejected" })
    });
  });

  await rejectedPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await rejectedPage.getByTestId("room-realtime-access-error").waitFor({ timeout: 6000 });
  await rejectedPage.waitForTimeout(800);

  if (rejectedEventRequests > 2) {
    throw new Error(`REALTIME_403_RETRY_STORM requests=${rejectedEventRequests}`);
  }
  const editorVisibleAfterRejection = await rejectedPage
    .locator('[data-testid="room-code-editor-host"] .cm-editor')
    .isVisible()
    .catch(() => false);
  if (editorVisibleAfterRejection) {
    throw new Error("EDITABLE_WORKSPACE_VISIBLE_AFTER_REALTIME_AUTHORIZATION_FAILURE");
  }

  console.log("REALTIME_AUTHORIZATION_RECOVERY_OK", room.inviteCode, { rejectedEventRequests });
  await rejectedContext.close();
} catch (error) {
  console.error("REALTIME_AUTHORIZATION_RECOVERY_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
