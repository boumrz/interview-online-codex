import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function registerAccount(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const nickname = `${prefix}_${randomPart}`.slice(0, 24);
  const password = "pass12345";
  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, displayName: nickname, password })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createUserRoom(token, taskIds = []) {
  const response = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      title: `Unified room ${Date.now()}`,
      language: "nodejs",
      taskIds
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_USER_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function seedTaskBank(token, marker = "task") {
  const entropy = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await fetch(`${apiBaseUrl}/me/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      title: `Binding task ${marker} ${entropy}`,
      description: `Seed task ${marker} for room binding coverage.`,
      starterCode: `function solve${marker.toUpperCase()}() {\n  return null;\n}\n`,
      language: "nodejs"
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`SEED_TASK_BANK_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function switchToNextStepAsUser(inviteCode, token) {
  const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}/next-step`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`NEXT_STEP_AS_USER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function bootstrapAuthStorage(page, token, user, inviteCode) {
  const visibleName = user.displayName || user.nickname;
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ authToken, authUser, displayName, roomInviteCode }) => {
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
    localStorage.setItem("display_name", displayName);
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, displayName);
  }, {
    authToken: token,
    authUser: user,
    displayName: visibleName,
    roomInviteCode: inviteCode
  });
}

async function enterGuestNameIfPrompted(page, value) {
  const modalTitle = page.getByText("Представьтесь перед входом в комнату");
  const joinButton = page.getByRole("button", { name: "Войти в комнату", exact: true });
  const nameInput = page.getByLabel("Ваше имя");

  const shouldHandleModal = await Promise.race([
    modalTitle.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false),
    joinButton.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false),
    nameInput.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)
  ]);
  if (!shouldHandleModal) return;

  await nameInput.fill(value);
  await joinButton.click();
  await modalTitle.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openRoomToolsPanelIfAvailable(page) {
  const roomToolsButton = page.getByRole("button", { name: "Открыть панель чата и логов" });
  const isVisible = await roomToolsButton.isVisible().catch(() => false);
  if (!isVisible) return;
  await roomToolsButton.click();
}

const browser = await chromium.launch({ headless: true });

try {
  const ownerAuth = await registerAccount("owner");
  const interviewerAuth = await registerAccount("interviewer");
  const firstTask = await seedTaskBank(ownerAuth.token, "a");
  const secondTask = await seedTaskBank(ownerAuth.token, "b");
  const room = await createUserRoom(ownerAuth.token, [firstTask.id, secondTask.id].filter(Boolean));

  const roomUrl = `${webBaseUrl}/room/${room.inviteCode}`;
  if (roomUrl.includes("interviewerToken=")) {
    throw new Error(`UNIFIED_LINK_EXPECTED ${roomUrl}`);
  }

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await bootstrapAuthStorage(ownerPage, ownerAuth.token, ownerAuth.user, room.inviteCode);
  await ownerPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const legacyInvitesVisible = await ownerPage
    .getByRole("button", { name: "Приглашения", exact: true })
    .isVisible()
    .catch(() => false);
  if (legacyInvitesVisible) {
    throw new Error("LEGACY_INVITES_UI_SHOULD_BE_REMOVED");
  }

  const interviewerContext = await browser.newContext();
  const interviewerPage = await interviewerContext.newPage();
  await bootstrapAuthStorage(interviewerPage, interviewerAuth.token, interviewerAuth.user, room.inviteCode);
  await interviewerPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await interviewerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfAvailable(interviewerPage);

  const interviewerCanManageBeforeGrant = await interviewerPage
    .locator('[data-testid="room-notes-input"]')
    .isVisible()
    .catch(() => false);
  if (interviewerCanManageBeforeGrant) {
    throw new Error("INTERVIEWER_SHOULD_NOT_HAVE_MANAGE_ACCESS_BEFORE_GRANT");
  }

  await ownerPage.bringToFront();
  const interviewerVisibleName = interviewerAuth.user.displayName || interviewerAuth.user.nickname;
  const interviewerChip = ownerPage.getByRole("button", {
    name: new RegExp(escapeRegExp(interviewerVisibleName), "i")
  });
  await interviewerChip.waitFor({ timeout: 15000 });
  await interviewerChip.click();
  await ownerPage.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).click();

  // Requirement: a refresh should be enough to see newly granted room rights.
  await interviewerPage.reload({ waitUntil: "domcontentloaded" });
  await interviewerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfAvailable(interviewerPage);
  await interviewerPage.locator('[data-testid="room-notes-input"]').waitFor({ timeout: 15000 });

  // Интервьюер меняет шаг и после refresh должен остаться интервьюером.
  await switchToNextStepAsUser(room.inviteCode, interviewerAuth.token);
  await interviewerPage.reload({ waitUntil: "domcontentloaded" });
  await interviewerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfAvailable(interviewerPage);
  await interviewerPage.locator('[data-testid="room-notes-input"]').waitFor({ timeout: 15000 });

  // Plain link should still join as candidate for unauthenticated users.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterGuestNameIfPrompted(guestPage, "Guest Candidate");
  await guestPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfAvailable(guestPage);
  const guestCanManage = await guestPage
    .locator('[data-testid="room-notes-input"]')
    .isVisible()
    .catch(() => false);
  if (guestCanManage) {
    throw new Error("PLAIN_LINK_GUEST_SHOULD_JOIN_AS_CANDIDATE");
  }

  // Owner grants interviewer access to an unauthenticated guest.
  await ownerPage.bringToFront();
  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  const participantsHost = ownerPage.locator('[aria-label="Участники комнаты"]').first();
  await participantsHost.waitFor({ timeout: 15000 });
  const participantButtons = participantsHost.getByRole("button");
  const participantButtonCount = await participantButtons.count();
  let guestGranted = false;
  for (let i = 0; i < participantButtonCount; i += 1) {
    const button = participantButtons.nth(i);
    await button.click();
    const grantMenuItem = ownerPage.getByRole("menuitem", { name: "Назначить интервьюером", exact: true });
    const canGrantThisParticipant = await grantMenuItem.waitFor({ state: "visible", timeout: 1200 }).then(() => true).catch(() => false);
    if (!canGrantThisParticipant) {
      await ownerPage.keyboard.press("Escape").catch(() => {});
      continue;
    }
    await grantMenuItem.click();
    guestGranted = true;
    break;
  }
  if (!guestGranted) {
    throw new Error("GUEST_INTERVIEWER_GRANT_ACTION_NOT_FOUND");
  }

  // Guest should receive rights after refresh.
  await guestPage.reload({ waitUntil: "domcontentloaded" });
  await enterGuestNameIfPrompted(guestPage, "Guest Candidate");
  await guestPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfAvailable(guestPage);
  await guestPage.locator('[data-testid="room-notes-input"]').waitFor({ timeout: 15000 });

  // Owner switches task; guest role should stay interviewer after refresh.
  await ownerPage.bringToFront();
  await ownerPage.getByRole("button", { name: /2\./ }).first().click();
  await ownerPage.waitForTimeout(250);
  await guestPage.reload({ waitUntil: "domcontentloaded" });
  await enterGuestNameIfPrompted(guestPage, "Guest Candidate");
  await guestPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await openRoomToolsPanelIfAvailable(guestPage);
  await guestPage.locator('[data-testid="room-notes-input"]').waitFor({ timeout: 15000 });

  console.log("ACCOUNT_ROOM_BINDING_OK");

  await ownerContext.close();
  await interviewerContext.close();
  await guestContext.close();
} catch (error) {
  console.error("ACCOUNT_ROOM_BINDING_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
