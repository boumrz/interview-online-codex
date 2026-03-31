import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const nickname = `sync_${Date.now()}`;
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
    body: JSON.stringify({ title: "Sync Regression Room", language: "nodejs", taskIds: [] })
  });
  const room = await createRoomResponse.json();
  if (!createRoomResponse.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(room)}`);
  }

  return { auth, room };
}

async function modelValue(page) {
  return page.evaluate(() => window.monaco?.editor?.getModels?.()[0]?.getValue() ?? "");
}

const appendedText = "function solve(a, b) {\n  return a + b;\n}\nalpha\nbeta\ngamma\ndelta\nepsilon";
const splitAt = 18;

const browser = await chromium.launch({ headless: true });

try {
  const { room } = await registerAndCreateRoom();

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem("display_name", "Owner QA");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Owner QA");
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
  await candidatePage.getByLabel("Ваше имя").fill("Candidate QA");
  await candidatePage.getByRole("button", { name: "Войти в комнату" }).click();
  await candidatePage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const initialValue = await modelValue(ownerPage);
  const expectedValue = `${initialValue}${appendedText}`;
  const firstHalf = appendedText.slice(0, splitAt);
  const secondHalf = appendedText.slice(splitAt);

  await ownerPage.bringToFront();
  await ownerPage.evaluate((chunk) => {
    const model = window.monaco?.editor?.getModels?.()[0];
    if (!model) return;
    model.setValue(`${model.getValue()}${chunk}`);
  }, firstHalf);

  await ownerPage.waitForTimeout(250);

  await ownerPage.bringToFront();
  await ownerPage.evaluate((chunk) => {
    const model = window.monaco?.editor?.getModels?.()[0];
    if (!model) return;
    model.setValue(`${model.getValue()}${chunk}`);
  }, secondHalf);

  await ownerPage.waitForTimeout(2500);

  const ownerValue = await modelValue(ownerPage);
  const candidateValue = await modelValue(candidatePage);

  if (ownerValue !== expectedValue || candidateValue !== expectedValue) {
    throw new Error(
      `CODE_SYNC_REGRESSION_FAILED\nEXPECTED:\n${expectedValue}\n\nOWNER:\n${ownerValue}\n\nCANDIDATE:\n${candidateValue}`
    );
  }

  console.log("CODE_SYNC_REGRESSION_OK", room.inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} finally {
  await browser.close();
}
