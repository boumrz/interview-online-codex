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
    body: JSON.stringify({ nickname, password })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createUserRoom(token) {
  const response = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      title: `Unified room ${Date.now()}`,
      language: "nodejs",
      taskIds: []
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_USER_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function bootstrapAuthStorage(page, token, user, inviteCode) {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ authToken, authUser, displayName, roomInviteCode }) => {
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("auth_user", JSON.stringify(authUser));
    localStorage.setItem("display_name", displayName);
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, displayName);
  }, {
    authToken: token,
    authUser: user,
    displayName: user.nickname,
    roomInviteCode: inviteCode
  });
}

async function enterGuestNameIfPrompted(page, value) {
  const modalTitle = page.getByText("Представьтесь перед входом в комнату");
  const visible = await modalTitle.isVisible().catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(value);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await modalTitle.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const browser = await chromium.launch({ headless: true });

try {
  const ownerAuth = await registerAccount("owner");
  const interviewerAuth = await registerAccount("interviewer");
  const room = await createUserRoom(ownerAuth.token);

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

  const interviewerCanManageBeforeGrant = await interviewerPage
    .locator('[data-testid="room-notes-input"]')
    .isVisible()
    .catch(() => false);
  if (interviewerCanManageBeforeGrant) {
    throw new Error("INTERVIEWER_SHOULD_NOT_HAVE_MANAGE_ACCESS_BEFORE_GRANT");
  }

  await ownerPage.bringToFront();
  const interviewerChip = ownerPage.getByRole("button", {
    name: new RegExp(escapeRegExp(interviewerAuth.user.nickname), "i")
  });
  await interviewerChip.waitFor({ timeout: 15000 });
  await interviewerChip.click();
  await ownerPage.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).click();

  // Requirement: a refresh should be enough to see newly granted room rights.
  await interviewerPage.reload({ waitUntil: "domcontentloaded" });
  await interviewerPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  await interviewerPage.locator('[data-testid="room-notes-input"]').waitFor({ timeout: 15000 });

  // Plain link should still join as candidate for unauthenticated users.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl, { waitUntil: "domcontentloaded" });
  await enterGuestNameIfPrompted(guestPage, "Guest Candidate");
  await guestPage.locator(".cm-editor").waitFor({ timeout: 15000 });
  const guestCanManage = await guestPage
    .locator('[data-testid="room-notes-input"]')
    .isVisible()
    .catch(() => false);
  if (guestCanManage) {
    throw new Error("PLAIN_LINK_GUEST_SHOULD_JOIN_AS_CANDIDATE");
  }

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
