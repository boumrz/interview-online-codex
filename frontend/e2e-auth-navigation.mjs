import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const nickname = `nav${Date.now().toString().slice(-8)}`;
const password = "secret123";

async function register() {
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

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Navigation room ${Date.now()}`,
      ownerDisplayName: "Navigation Owner",
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
  const auth = await register();
  const room = await createGuestRoom();

  const context = await browser.newContext();
  await context.addInitScript(({ token, user, inviteCode, ownerToken }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem("display_name", "Navigation Owner");
    localStorage.setItem(`guest_display_name_${inviteCode}`, "Navigation Owner");
  }, {
    token: auth.token,
    user: auth.user,
    inviteCode: room.inviteCode,
    ownerToken: room.ownerToken
  });

  const page = await context.newPage();

  await page.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "networkidle" });
  await page.getByText(room.title, { exact: true }).waitFor({ timeout: 15000 });
  await page.locator('a[href="/"]').first().click();
  await page.waitForURL(`${webBaseUrl}/`, { timeout: 15000 });

  await page.locator('a[href="/dashboard/rooms"]').first().click();
  await page.waitForURL(/\/dashboard\/rooms/, { timeout: 15000 });

  await page.goto(`${webBaseUrl}/login`, { waitUntil: "networkidle" });
  await page.waitForURL(/\/dashboard\/rooms/, { timeout: 15000 });

  console.log("AUTH_NAVIGATION_OK");
  await context.close();
} catch (error) {
  console.error("AUTH_NAVIGATION_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
