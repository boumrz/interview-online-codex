import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8090/api";

// Two regression scenarios that cover the two root causes of watcher not seeing
// candidate's edits under slow network conditions:
//
// SCENARIO 1 — Heartbeat mutual abort (server-side latency via fault injection):
//   Before fix: heartbeat₂ aborted in-flight heartbeat₁; server never received
//   anything when RTT > 2500ms heartbeat interval. Watchers starved indefinitely.
//   Fix: queuePayload guards against aborting an in-flight heartbeat with another.
//
// SCENARIO 2 — key_press / cursor_update / awareness_update queue blocker (CDP 3G):
//   Before fix: telemetry events (key_press, cursor_update, awareness_update) shared
//   the main serial send queue with Yjs updates. 40 chars × 800ms RTT = 32s before
//   the first Yjs heartbeat could get through.
//   Fix: telemetry events are fire-and-forget (parallel fetch, not queued).

const nickname = `slowsync_${Math.random().toString(36).slice(2, 8)}`;
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
      title: `Slow Sync ${nickname}`,
      description: "Slow network sync seed task",
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
    body: JSON.stringify({
      title: "Slow Network Sync Room",
      language: "nodejs",
      taskIds: [seedTask.id]
    })
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

async function enterNameIfPrompted(page, name) {
  const title = page.getByText("Представьтесь перед входом в комнату");
  const joinButton = page.getByRole("button", { name: "Войти в комнату", exact: true });
  const nameInput = page.getByLabel("Ваше имя");

  const shouldHandleModal = await Promise.race([
    title.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false),
    joinButton.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false),
    nameInput.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false),
  ]);
  if (!shouldHandleModal) return;

  await nameInput.fill(name);
  await joinButton.click();
  await title.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
}

async function waitForEditor(page, timeoutMs = 15000) {
  const editor = page.locator(".cm-editor");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await editor.isVisible().catch(() => false);
    if (visible) return;
    await page.waitForTimeout(150);
  }
  await editor.waitFor({ timeout: 2000 });
}

async function ensureJoinedAndEditorReady(page, candidateName) {
  await enterNameIfPrompted(page, candidateName);
  await waitForEditor(page, 15000);

  const stillAskingName = await page
    .getByText("Представьтесь перед входом в комнату")
    .isVisible()
    .catch(() => false);
  if (stillAskingName) {
    await enterNameIfPrompted(page, candidateName);
    await waitForEditor(page, 15000);
  }
}

async function modelValue(page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    const anyEditor = editor;
    const view = anyEditor?.cmView?.view ?? anyEditor?.cmView?.rootView?.view ?? null;
    if (view?.state?.doc?.toString) return view.state.doc.toString();
    return document.querySelector(".cm-content")?.textContent ?? "";
  });
}

async function appendCode(page, snippet) {
  await page.locator(".cm-content").click({ force: true });
  await page.keyboard.press("End");
  await page.keyboard.type(snippet, { delay: 8 });
}

async function checkForErrorToasts(page) {
  const errorIndicators = ["Ошибка", "Error", "disconnected", "соединение потеряно"];
  for (const indicator of errorIndicators) {
    const found = await page
      .getByText(indicator, { exact: false })
      .isVisible()
      .catch(() => false);
    if (found) {
      return indicator;
    }
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
let activeFaultToken = null;
let activeFaultInviteCode = null;

try {
  const { auth, room } = await registerAndCreateRoom();
  activeFaultToken = auth.token;
  activeFaultInviteCode = room.inviteCode;

  // Configure slow network: 3000ms latency on realtime events
  // This exceeds heartbeat interval (2500ms) and will trigger mutual heartbeat
  // cancellation if the fix is not in place.
  await configureFaults(auth.token, room.inviteCode, { latencyMs: 3000, dropEveryNthMessage: 0 });

  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem("display_name", "Slow Sync Owner");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Slow Sync Owner");
    },
    { inviteCode: room.inviteCode, ownerToken: room.ownerToken || "" }
  );
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator(".cm-editor").waitFor({ timeout: 15000 });

  const candidateContext = await browser.newContext();
  const candidatePage = await candidateContext.newPage();
  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ensureJoinedAndEditorReady(candidatePage, "Candidate Slow");

  const watcherContext = await browser.newContext();
  const watcherPage = await watcherContext.newPage();
  await watcherPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ensureJoinedAndEditorReady(watcherPage, "Watcher Slow");

  // Verify all connected before the slow test
  await ownerPage.waitForSelector(
    '[data-testid="room-connection-status"][data-state="online"]',
    { timeout: 10000 }
  );
  await candidatePage.waitForSelector(
    '[data-testid="room-connection-status"][data-state="online"]',
    { timeout: 10000 }
  );
  await watcherPage.waitForSelector(
    '[data-testid="room-connection-status"][data-state="online"]',
    { timeout: 10000 }
  );

  // SCENARIO 1: Candidate types text with slow server (3000ms latency on broadcasts)
  console.log("=== Scenario 1: heartbeat mutual-abort regression ===");
  const testMarker = `SLOWTEST_CANARY_${Date.now()}`;
  await appendCode(candidatePage, ` ${testMarker}`);

  // Wait a bit for the edit to be queued
  await candidatePage.waitForTimeout(800);

  // Check for error toasts on candidate page (there should be none)
  const candidateError = await checkForErrorToasts(candidatePage);
  if (candidateError) {
    throw new Error(`CANDIDATE_ERROR_TOAST_FOUND: ${candidateError}`);
  }

  // Wait up to 30 seconds for watcher to see the text
  // With 3000ms latency per heartbeat, we need extra time for:
  // - Candidate's edit to be queued
  // - Heartbeat to go out (delayed 3000ms by latency)
  // - Watcher to receive SSE update
  const watcherStartTime = Date.now();
  const watcherTimeoutMs = 30000;
  let watcherSawText = false;
  let pollCount = 0;

  while (Date.now() - watcherStartTime < watcherTimeoutMs) {
    try {
      const watcherContent = await modelValue(watcherPage);
      pollCount++;
      if (watcherContent.includes(testMarker)) {
        watcherSawText = true;
        console.log(`Watcher saw text after ${Math.round((Date.now() - watcherStartTime) / 1000)}s (${pollCount} polls)`);
        break;
      }
    } catch (e) {
      // Editor view not ready yet, continue polling
    }
    await watcherPage.waitForTimeout(500);
  }

  if (!watcherSawText) {
    const watcherContent = await modelValue(watcherPage);
    const candidateContent = await modelValue(candidatePage);
    throw new Error(
      `SLOW_NETWORK_SYNC_FAILED: Watcher never saw text after ${Math.round((Date.now() - watcherStartTime) / 1000)}s\nCandidate content:\n${candidateContent}\n\nWatcher content:\n${watcherContent}`
    );
  }

  // Verify owner also sees the text
  const ownerContent = await modelValue(ownerPage);
  if (!ownerContent.includes(testMarker)) {
    throw new Error(
      `SLOW_NETWORK_SYNC_FAILED: Owner never saw text\nOwner content:\n${ownerContent}`
    );
  }

  // Verify no error toasts on watcher page
  const watcherError = await checkForErrorToasts(watcherPage);
  if (watcherError) {
    throw new Error(`WATCHER_ERROR_TOAST_FOUND: ${watcherError}`);
  }

  // Verify no error toasts on owner page
  const ownerError = await checkForErrorToasts(ownerPage);
  if (ownerError) {
    throw new Error(`OWNER_ERROR_TOAST_FOUND: ${ownerError}`);
  }

  console.log("Scenario 1 OK:", room.inviteCode);

  // SCENARIO 2: key_press / cursor_update / awareness_update queue blocker (CDP 3G)
  // Without the fire-and-forget fix, ~35 telemetry events × 800ms RTT = 28s before
  // the first Yjs update reaches the watcher. With the fix, it takes ~3s.
  // Strict 15s timeout catches a regression while giving the fix plenty of margin.
  console.log("\n=== Scenario 2: telemetry queue-blocker regression (CDP 3G) ===");

  // Clear server-side fault injection so only the client-side 3G throttle applies.
  await clearFaults(auth.token, room.inviteCode);
  activeFaultToken = null; // prevent double-clear in finally

  const cdpSession = await candidateContext.newCDPSession(candidatePage);
  await cdpSession.send("Network.enable");
  await cdpSession.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (750 * 1024) / 8,
    uploadThroughput: (250 * 1024) / 8,
    latency: 800,
  });
  console.log("[candidate] CDP 3G active (800ms latency, 250kbps up)");

  // pressSequentially generates real keydown/keyup events → key_press + cursor_update
  // messages. With delay:80 and ~35 chars, typing takes ~2800ms.
  const kpMarker = `KEYPRESS_CANARY_${Date.now()}`;
  await candidatePage.locator(".cm-content").click({ force: true });
  const tType = Date.now();
  await candidatePage.locator(".cm-content").pressSequentially(` ${kpMarker}`, { delay: 80 });
  console.log(`[candidate] Typed ${kpMarker.length + 1} chars in ${Date.now() - tType}ms`);

  const KP_TIMEOUT = 15_000;
  const tKP = Date.now();
  let kpSeen = false;
  while (Date.now() - tKP < KP_TIMEOUT) {
    const content = await modelValue(watcherPage).catch(() => "");
    if (content.includes(kpMarker)) {
      kpSeen = true;
      console.log(`[watcher] Saw Scenario 2 marker after ${Date.now() - tKP}ms`);
      break;
    }
    await watcherPage.waitForTimeout(400);
  }
  if (!kpSeen) {
    const wContent = await modelValue(watcherPage).catch(() => "");
    throw new Error(
      `KEY_PRESS_BLOCKER_REGRESSION: watcher did not see marker within ${KP_TIMEOUT}ms\n` +
      `(regression: key_press/cursor_update/awareness_update may be blocking Yjs in the queue)\n` +
      `Watcher has: "${wContent.slice(0, 100)}"`
    );
  }
  console.log("Scenario 2 OK");
  console.log("SLOW_NETWORK_SYNC_OK", room.inviteCode);

  await ownerContext.close();
  await candidateContext.close();
  await watcherContext.close();
} catch (error) {
  console.error("SLOW_NETWORK_SYNC_FAIL", error);
  process.exitCode = 1;
} finally {
  if (activeFaultToken && activeFaultInviteCode) {
    await clearFaults(activeFaultToken, activeFaultInviteCode).catch(() => {});
  }
  await browser.close();
}
