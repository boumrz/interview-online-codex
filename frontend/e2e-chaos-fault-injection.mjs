import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const nickname = `chaos_${Date.now()}`;
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
    body: JSON.stringify({ title: "Chaos Room", language: "javascript", taskIds: [] })
  });
  const room = await createRoomResponse.json();
  if (!createRoomResponse.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(room)}`);
  }

  return { auth, room };
}

async function configureFaults(token, inviteCode, profile) {
  const response = await fetch(`${apiBaseUrl}/agent/realtime/faults/${inviteCode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(profile)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`FAULT_CONFIG_FAILED ${JSON.stringify(payload)}`);
  }
}

async function clearFaults(token, inviteCode) {
  await fetch(`${apiBaseUrl}/agent/realtime/faults/${inviteCode}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function appendCode(page, snippet) {
  await page.evaluate((chunk) => {
    const model = window.monaco?.editor?.getModels?.()[0];
    if (!model) throw new Error("MONACO_MODEL_NOT_FOUND");
    model.setValue(`${model.getValue()}${chunk}`);
  }, snippet);
}

async function waitForMarker(page, marker, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => {
      const model = window.monaco?.editor?.getModels?.()[0];
      if (model) return model.getValue();
      return document.querySelector(".view-lines")?.textContent || "";
    });
    if (text.includes(marker)) return;
    await page.waitForTimeout(120);
  }
  throw new Error(`MARKER_NOT_FOUND: ${marker}`);
}

const browser = await chromium.launch({ headless: true });

try {
  const { auth, room } = await registerAndCreateRoom();
  await configureFaults(auth.token, room.inviteCode, { latencyMs: 350, dropEveryNthMessage: 0 });

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem("display_name", "Chaos Owner");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Chaos Owner");
    },
    { inviteCode: room.inviteCode, ownerToken: room.ownerToken || "" }
  );
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "networkidle" });
  await ownerPage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "networkidle" });
  await candidatePage.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15000 });
  await candidatePage.getByLabel("Ваше имя").fill("Candidate Chaos");
  await candidatePage.getByRole("button", { name: "Войти в комнату" }).click();
  await candidatePage.locator(".monaco-editor").waitFor({ timeout: 15000 });

  const marker = `\n// fault-injection-${Date.now()}`;
  await appendCode(ownerPage, marker);
  await waitForMarker(candidatePage, marker, 15000);

  const ownerControlsVisible = await candidatePage
    .getByRole("button", { name: "Следующий шаг" })
    .isVisible()
    .catch(() => false);
  if (ownerControlsVisible) {
    throw new Error("OWNER_CONTROLS_VISIBLE");
  }

  await clearFaults(auth.token, room.inviteCode);
  console.log("CHAOS_FAULT_INJECTION_OK", room.inviteCode);

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("CHAOS_FAULT_INJECTION_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
