import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

async function createGuestRoom(label) {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Missing room SSE ${label} ${Date.now()}`,
      ownerDisplayName: "Missing room owner",
      language: "nodejs",
    }),
  });
  const room = await response.json();
  if (!response.ok) throw new Error(`CREATE_GUEST_ROOM_FAILED ${JSON.stringify(room)}`);
  return room;
}

async function installSseCapture(context, inviteCode, displayName, key) {
  await context.addInitScript(
    ({ roomInviteCode, roomDisplayName, captureKey }) => {
      localStorage.setItem(`guest_display_name_${roomInviteCode}`, roomDisplayName);
      const NativeEventSource = window.EventSource;
      window[captureKey] = { created: 0, opened: 0, errors: 0, stateSyncs: 0, sourceUrl: null };
      window.EventSource = class MissingRoomCaptureEventSource extends NativeEventSource {
        constructor(...args) {
          super(...args);
          const capture = window[captureKey];
          capture.created += 1;
          capture.sourceUrl = typeof this.url === "string" ? this.url : String(args[0] || "");
        }

        set onopen(handler) {
          super.onopen = (event) => {
            window[captureKey].opened += 1;
            handler?.call(this, event);
          };
        }

        set onerror(handler) {
          super.onerror = (event) => {
            window[captureKey].errors += 1;
            handler?.call(this, event);
          };
          window[captureKey].forceCurrentError = () => {
            window[captureKey].errors += 1;
            handler?.call(this, new Event("error"));
          };
        }

        set onmessage(handler) {
          super.onmessage = (event) => {
            try {
              if (JSON.parse(event.data)?.type === "state_sync") window[captureKey].stateSyncs += 1;
            } catch {
              // The application is responsible for handling malformed messages.
            }
            handler?.call(this, event);
          };
        }
      };

      window[captureKey].replaceCurrentStream = () => {
        const sourceUrl = window[captureKey].sourceUrl;
        if (!sourceUrl) throw new Error("STREAM_URL_NOT_CAPTURED");
        const replacement = new NativeEventSource(sourceUrl);
        replacement.onopen = () => window.setTimeout(() => replacement.close(), 40);
      };
    },
    { roomInviteCode: inviteCode, roomDisplayName: displayName, captureKey: key },
  );
}

async function runDelayedStatusProbe(browser) {
  const room = await createGuestRoom("delayed-status-probe");
  const context = await browser.newContext();
  const captureKey = "__missingRoomDelayedProbe";
  try {
    await installSseCapture(context, room.inviteCode, "Delayed probe candidate", captureKey);
    const page = await context.newPage();
    const ledger = createTrafficLedger(page, room.inviteCode);
    let markProbeStarted;
    const probeStarted = new Promise((resolve) => { markProbeStarted = resolve; });
    let statusRequests = 0;
    await page.route(`**/api/realtime/rooms/${room.inviteCode}/stream-status*`, async (route) => {
      statusRequests += 1;
      if (statusRequests !== 1) {
        await route.continue();
        return;
      }
      markProbeStarted();
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.fulfill({ status: 204 }).catch(() => {});
    });
    await page.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await waitForSynchronizedEditor(page, captureKey);
    const baselineStateSyncs = await page.evaluate((key) => window[key]?.stateSyncs ?? 0, captureKey);
    await page.evaluate((key) => window[key].forceCurrentError(), captureKey);
    await probeStarted;
    const eventsBeforeFocus = ledger.events;
    await page.bringToFront();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(450);
    if (ledger.events !== eventsBeforeFocus) {
      throw new Error(`DELAYED_STATUS_PROBE_CONTROL_TRAFFIC ${JSON.stringify({ before: eventsBeforeFocus, after: ledger.events })}`);
    }
    await page.waitForFunction(
      ({ key, before }) => window[key]?.opened >= 2 && window[key]?.stateSyncs > before,
      { key: captureKey, before: baselineStateSyncs },
      { timeout: 8_000 },
    );
    const unavailableVisible = await page.getByTestId("room-realtime-unavailable").isVisible().catch(() => false);
    if (unavailableVisible) throw new Error("DELAYED_STATUS_PROBE_FALSE_TERMINAL");
  } finally {
    await context.close();
  }
}

async function waitForSynchronizedEditor(page, captureKey) {
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor({ timeout: 15_000 });
  await page.waitForFunction((key) => window[key]?.stateSyncs > 0, captureKey, { timeout: 15_000 });
}

function createTrafficLedger(page, inviteCode) {
  const ledger = { stream: 0, events: 0, status: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes(`/api/realtime/rooms/${inviteCode}/`)) return;
    if (url.includes("/stream-status")) ledger.status += 1;
    else if (url.includes("/stream")) ledger.stream += 1;
    else if (url.includes("/events")) ledger.events += 1;
  });
  return ledger;
}

async function expectTerminalUnavailable(page, ledger, label) {
  await page.getByTestId("room-realtime-unavailable").waitFor({ timeout: 12_000 });
  const editorVisible = await page
    .locator('[data-testid="room-code-editor-host"] .cm-editor')
    .isVisible()
    .catch(() => false);
  if (editorVisible) throw new Error(`${label}_EDITOR_VISIBLE_AFTER_TERMINAL_UNAVAILABLE`);

  const body = await page.locator("body").innerText();
  if (body.includes("404") || body.includes("missing-room-test-sentinel")) {
    throw new Error(`${label}_RAW_BACKEND_DETAIL_EXPOSED`);
  }

  const baseline = { ...ledger };
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(750);
  if (JSON.stringify(ledger) !== JSON.stringify(baseline)) {
    throw new Error(`${label}_TRAFFIC_RESUMED_AFTER_TERMINAL ${JSON.stringify({ baseline, actual: ledger })}`);
  }
}

async function runMissingRoomAfterLiveSync(browser) {
  const room = await createGuestRoom("live-sync");
  const context = await browser.newContext();
  const captureKey = "__missingRoomLiveSync";
  try {
    await installSseCapture(context, room.inviteCode, "Missing room candidate", captureKey);
    const page = await context.newPage();
    const ledger = createTrafficLedger(page, room.inviteCode);
    let classifyAsMissing = false;
    await page.route(`**/api/realtime/rooms/${room.inviteCode}/stream-status*`, async (route) => {
      if (!classifyAsMissing) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "missing-room-test-sentinel" }),
      });
    });
    await page.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await waitForSynchronizedEditor(page, captureKey);
    classifyAsMissing = true;
    await page.evaluate((key) => window[key].replaceCurrentStream(), captureKey);
    await expectTerminalUnavailable(page, ledger, "MISSING_ROOM_AFTER_LIVE_SYNC");
    if (ledger.status !== 1) throw new Error(`MISSING_ROOM_STATUS_PROBE_COUNT ${ledger.status}`);
  } finally {
    await context.close();
  }
}

async function runInitiallyMissingRoom(browser) {
  const inviteCode = `initially-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const context = await browser.newContext();
  const captureKey = "__initiallyMissingRoom";
  try {
    await installSseCapture(context, inviteCode, "Initially missing candidate", captureKey);
    const page = await context.newPage();
    const ledger = createTrafficLedger(page, inviteCode);
    await page.route(`**/api/realtime/rooms/${inviteCode}/stream-status*`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "missing-room-test-sentinel" }),
      });
    });
    await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
    try {
      await expectTerminalUnavailable(page, ledger, "INITIALLY_MISSING_ROOM");
    } catch (error) {
      const diagnostic = await page.evaluate((key) => ({
        capture: window[key],
        text: document.body?.innerText?.slice(0, 500) ?? "",
      }), captureKey);
      throw new Error(`${error instanceof Error ? error.message : String(error)} INITIAL_MISSING_DIAGNOSTIC=${JSON.stringify({ ledger, diagnostic })}`);
    }
    const stateSyncs = await page.evaluate((key) => window[key]?.stateSyncs ?? 0, captureKey);
    if (stateSyncs !== 0) throw new Error(`INITIALLY_MISSING_ROOM_STATE_SYNC_COUNT ${stateSyncs}`);
    if (ledger.status !== 1) throw new Error(`INITIALLY_MISSING_ROOM_STATUS_PROBE_COUNT ${ledger.status}`);
  } finally {
    await context.close();
  }
}

async function runStaleTokenRace(browser) {
  const room = await createGuestRoom("stale-token-race");
  const context = await browser.newContext();
  const captureKey = "__missingRoomStaleToken";
  try {
    await installSseCapture(context, room.inviteCode, "Stale token candidate", captureKey);
    const page = await context.newPage();
    const ledger = createTrafficLedger(page, room.inviteCode);
    let rejectNextYjs = false;
    let returnMissingFromStatusProbe = false;
    let rejectedYjs = 0;

    await page.route(`**/api/realtime/rooms/${room.inviteCode}/events`, async (route) => {
      const payload = route.request().postDataJSON();
      if (rejectNextYjs && payload?.type === "yjs_update") {
        rejectNextYjs = false;
        // Make the real SSE connection fail in the same turn as its stale
        // event response. The status endpoint is deliberately the only
        // authority that classifies this as a missing room.
        returnMissingFromStatusProbe = true;
        rejectedYjs += 1;
        await page.evaluate((key) => window[key].forceCurrentError(), captureKey);
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "stale token" }) });
        return;
      }
      await route.continue();
    });
    await page.route(`**/api/realtime/rooms/${room.inviteCode}/stream-status*`, async (route) => {
      if (!returnMissingFromStatusProbe) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "missing-room-test-sentinel" }) });
    });

    await page.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await waitForSynchronizedEditor(page, captureKey);
    rejectNextYjs = true;
    await page.locator('[data-testid="room-code-editor-host"] .cm-content').click({ force: true });
    await page.keyboard.type(`stale-token-${Date.now()}`);
    try {
      await expectTerminalUnavailable(page, ledger, "STALE_TOKEN_MISSING_ROOM_RACE");
    } catch (error) {
      const diagnostic = await page.evaluate((key) => ({
        capture: window[key],
        text: document.body?.innerText?.slice(0, 800) ?? "",
      }), captureKey);
      throw new Error(`${error instanceof Error ? error.message : String(error)} STALE_TOKEN_DIAGNOSTIC=${JSON.stringify({ ledger, rejectedYjs, returnMissingFromStatusProbe, diagnostic })}`);
    }
    if (rejectedYjs !== 1) throw new Error(`STALE_TOKEN_YJS_403_COUNT ${rejectedYjs}`);
    if (ledger.status !== 1) throw new Error(`STALE_TOKEN_STATUS_PROBE_COUNT ${ledger.status}`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const scenario = process.env.MISSING_ROOM_SCENARIO || "all";
  if (scenario === "all" || scenario === "initial") await runInitiallyMissingRoom(browser);
  if (scenario === "all" || scenario === "live") await runMissingRoomAfterLiveSync(browser);
  if (scenario === "all" || scenario === "race") await runStaleTokenRace(browser);
  if (scenario === "all" || scenario === "delayed") await runDelayedStatusProbe(browser);
  console.log("MISSING_ROOM_SSE_RECOVERY_OK");
} catch (error) {
  console.error("MISSING_ROOM_SSE_RECOVERY_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
