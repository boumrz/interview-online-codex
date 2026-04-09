import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const nickname = `chaos_${Math.random().toString(36).slice(2, 8)}`;
const password = "secret123";

async function registerAndCreateRoom() {
  const registerResponse = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, displayName: nickname, password })
  });
  const auth = await registerResponse.json();
  if (!registerResponse.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(auth)}`);
  }

  const seedTaskResponse = await fetch(`${apiBaseUrl}/me/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({
      title: `Seed ${nickname}`,
      description: "Chaos seed task",
      starterCode: "function solve() {\n  return null;\n}\n",
      language: "nodejs"
    })
  });
  const seedTask = await seedTaskResponse.json();
  if (!seedTaskResponse.ok) {
    throw new Error(`SEED_TASK_FAILED ${JSON.stringify(seedTask)}`);
  }

  const createRoomResponse = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: JSON.stringify({ title: "Chaos Room", language: "nodejs", taskIds: [seedTask.id] })
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
  await page.locator(".cm-content").click({ force: true });
  await page.keyboard.press("End");
  await page.keyboard.type(snippet, { delay: 6 });
}

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  const visible = await title.isVisible().catch(() => false);
  if (!visible) return;
  await page.getByLabel("Ваше имя").fill(name);
  await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await title.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

async function waitForMarker(page, marker, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => {
      const editor = document.querySelector(".cm-editor");
      const anyEditor = editor;
      const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
      if (view?.state?.doc?.toString) return view.state.doc.toString();
      return document.querySelector(".cm-content")?.textContent ?? "";
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
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await enterNameIfPrompted(candidatePage, "Candidate Chaos");
  await candidatePage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const marker = `fault-injection-${Date.now()}`;
  await appendCode(ownerPage, ` ${marker}`);
  await waitForMarker(candidatePage, marker, 30000);

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
