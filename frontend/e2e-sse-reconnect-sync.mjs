import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const nickname = `sr_${Date.now().toString(36).slice(-8)}`;
const password = "secret123";

async function registerAndCreateRoom() {
  const registerResponse = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, password })
  });
  const auth = await registerResponse.json();
  if (!registerResponse.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(auth)}`);
  }

  const createRoomResponse = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({ title: "SSE Reconnect Sync Room", language: "nodejs", taskIds: [] })
  });
  const room = await createRoomResponse.json();
  if (!createRoomResponse.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(room)}`);
  }

  return { room };
}

async function modelValue(page) {
  return page.evaluate(() => window.monaco?.editor?.getModels?.()[0]?.getValue() ?? "");
}

const appendedText = "\nfocus-reconnect-alpha\nfocus-reconnect-beta\nfocus-reconnect-gamma";

const browser = await chromium.launch({ headless: true });

try {
  const { room } = await registerAndCreateRoom();

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem("display_name", "Owner SSE");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner SSE");
    },
    { inviteCode: room.inviteCode, ownerToken: room.ownerToken || "" }
  );
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await candidatePage.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15000 });
  await candidatePage.getByLabel("Ваше имя").fill("Candidate SSE");
  await candidatePage.getByRole("button", { name: "Войти в комнату" }).click();
  await candidatePage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const initialValue = await modelValue(ownerPage);
  const expectedValue = `${initialValue}${appendedText}`;

  // Emulate background connection loss while another participant continues typing.
  await candidateContext.setOffline(true);

  await ownerPage.bringToFront();
  await ownerPage.evaluate((suffix) => {
    const model = window.monaco?.editor?.getModels?.()[0];
    if (!model) return;
    model.setValue(`${model.getValue()}${suffix}`);
  }, appendedText);
  await ownerPage.waitForTimeout(1200);

  await candidateContext.setOffline(false);
  await candidatePage.bringToFront();
  await candidatePage.waitForTimeout(7000);

  const ownerValue = await modelValue(ownerPage);
  const candidateValue = await modelValue(candidatePage);

  if (ownerValue !== expectedValue || candidateValue !== expectedValue) {
    throw new Error(
      `SSE_RECONNECT_SYNC_FAILED\nEXPECTED:\n${expectedValue}\n\nOWNER:\n${ownerValue}\n\nCANDIDATE:\n${candidateValue}`
    );
  }

  console.log("SSE_RECONNECT_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} finally {
  await browser.close();
}
