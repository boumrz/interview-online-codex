import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function registerAccount() {
  const nickname = `owner_${Date.now()}`;
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
  return { ...payload, nickname };
}

async function createUserRoom(token) {
  const response = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      title: `Bound room ${Date.now()}`,
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

const browser = await chromium.launch({ headless: true });

try {
  const auth = await registerAccount();
  const room = await createUserRoom(auth.token);

  if (!room.ownerToken || !room.interviewerToken) {
    throw new Error("ROOM_TOKENS_MISSING");
  }

  const plainRoomLink = `${webBaseUrl}/room/${room.inviteCode}`;
  const interviewerRoomLink = `${plainRoomLink}?interviewerToken=${encodeURIComponent(room.interviewerToken)}`;

  const context = await browser.newContext();
  let page = await context.newPage();
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ inviteCode, ownerToken, authToken, user, displayName }) => {
    localStorage.setItem("auth_token", authToken);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", displayName);
    localStorage.setItem(`guest_display_name_${inviteCode}`, displayName);
  }, {
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken,
    authToken: auth.token,
    user: auth.user,
    displayName: auth.user.nickname
  });

  const traffic = {
    apiAuthorization: null,
    wsUrl: null,
    roomRequests: []
  };
  let captureUnauthorizedPhase = false;
  const attachTrafficListener = (targetPage) => {
    targetPage.on("request", (request) => {
      if (!captureUnauthorizedPhase) return;
      const url = request.url();
      if (url.includes(`/api/rooms/${room.inviteCode}`)) {
        const authorization = request.headers().authorization ?? null;
        traffic.apiAuthorization = authorization;
        traffic.roomRequests.push({
          url,
          authorization
        });
      }
      if (url.includes(`/ws/rooms/${room.inviteCode}`)) {
        traffic.wsUrl = url;
      }
    });
  };
  attachTrafficListener(page);

  await page.goto(interviewerRoomLink, { waitUntil: "networkidle" });
  await page.locator(".monaco-editor").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Приглашения", exact: true }).waitFor({ timeout: 8000 });

  await page.goto(`${webBaseUrl}/dashboard/rooms`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(`${webBaseUrl}/`, { timeout: 10000 });
  const storageAfterLogout = await page.evaluate((inviteCode) => {
    return {
      authToken: localStorage.getItem("auth_token"),
      authUser: localStorage.getItem("auth_user"),
      ownerToken: localStorage.getItem(`owner_token_${inviteCode}`),
      interviewerGuestName: localStorage.getItem(`guest_interviewer_display_name_${inviteCode}`)
    };
  }, room.inviteCode);
  if (storageAfterLogout.authToken || storageAfterLogout.authUser) {
    throw new Error("AUTH_NOT_CLEARED_ON_LOGOUT");
  }
  if (storageAfterLogout.ownerToken) {
    throw new Error("OWNER_TOKEN_NOT_CLEARED_ON_LOGOUT");
  }

  await page.close();
  page = await context.newPage();
  attachTrafficListener(page);

  traffic.apiAuthorization = null;
  traffic.wsUrl = null;
  traffic.roomRequests = [];
  captureUnauthorizedPhase = true;

  await page.goto(plainRoomLink, { waitUntil: "networkidle" });
  const plainModalVisible = await page
    .getByText("Представьтесь перед входом в комнату")
    .isVisible()
    .catch(() => false);

  if (plainModalVisible) {
    await page.getByLabel("Ваше имя").fill("Кандидат без токена");
    await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  }

  await page.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const invitationsVisibleAsCandidate = await page
    .getByRole("button", { name: "Приглашения", exact: true })
    .isVisible()
    .catch(() => false);
  if (invitationsVisibleAsCandidate) {
    throw new Error("PLAIN_LINK_SHOULD_NOT_GRANT_INTERVIEWER_ACCESS");
  }

  await page.goto(interviewerRoomLink, { waitUntil: "networkidle" });
  const interviewerModalVisible = await page
    .getByText("Представьтесь перед входом в комнату")
    .isVisible()
    .catch(() => false);

  if (interviewerModalVisible) {
    const canLoginFromModal = await page
      .getByRole("button", { name: "Войти через аккаунт (по желанию)", exact: true })
      .isVisible()
      .catch(() => false);
    if (!canLoginFromModal) {
      throw new Error("LOGIN_OPTION_MISSING_FOR_UNAUTHORIZED_USER");
    }

    await page.getByLabel("Ваше имя").fill("Интервьюер без аккаунта");
    await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  }

  await page.locator(".monaco-editor").waitFor({ timeout: 15000 });

  if (traffic.apiAuthorization) {
    throw new Error(`UNAUTHORIZED_VISIT_SENT_AUTH_HEADER ${JSON.stringify(traffic.roomRequests)}`);
  }
  if (traffic.wsUrl && traffic.wsUrl.includes("authToken=")) {
    throw new Error("UNAUTHORIZED_VISIT_SENT_WS_AUTH_TOKEN");
  }

  const invitationsVisible = await page
    .getByRole("button", { name: "Приглашения", exact: true })
    .isVisible()
    .catch(() => false);
  if (!invitationsVisible) {
    throw new Error("INTERVIEWER_LINK_SHOULD_GRANT_INTERVIEWER_ACCESS_WITHOUT_AUTH");
  }

  console.log("ACCOUNT_ROOM_BINDING_OK");
  await context.close();
} catch (error) {
  console.error("ACCOUNT_ROOM_BINDING_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
