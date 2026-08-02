import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://127.0.0.1:8080/api";
const timeoutMs = 15_000;
const invalidInviteObservationMs = 1_200;
const maximumInvalidInviteSseErrors = 10;

function assertCondition(condition, label) {
  if (!condition) throw new Error(label);
}

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Negative auth ${Date.now()}`,
      ownerDisplayName: "Negative auth owner",
      language: "nodejs",
    }),
  });

  let room;
  try {
    room = await response.json();
  } catch {
    throw new Error(`CREATE_NEGATIVE_AUTH_ROOM_INVALID_RESPONSE status=${response.status}`);
  }

  if (!response.ok || typeof room?.inviteCode !== "string" || typeof room?.ownerToken !== "string") {
    throw new Error(`CREATE_NEGATIVE_AUTH_ROOM_FAILED status=${response.status}`);
  }
  return room;
}

async function installSseCapture(context, captureEventTokens) {
  await context.addInitScript((shouldCaptureEventTokens) => {
    const NativeEventSource = window.EventSource;
    window.__negativeAuthSseTransport = {
      connectionCount: 0,
      openCount: 0,
      errorCount: 0,
      messages: [],
      stateSyncs: [],
    };

    window.EventSource = class NegativeAuthCaptureEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args);
        const transport = window.__negativeAuthSseTransport;
        const connectionIndex = transport.connectionCount;
        transport.connectionCount += 1;
        let sessionId = "";
        try {
          sessionId = new URL(String(args[0]), window.location.href).searchParams.get("sessionId") || "";
        } catch {
          // The application will surface a malformed transport URL itself.
        }

        this.addEventListener("open", () => {
          transport.openCount += 1;
        });
        this.addEventListener("error", () => {
          transport.errorCount += 1;
        });
        this.addEventListener("message", (event) => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            transport.messages.push({ connectionIndex, type: "__malformed__", sourceEventId: null });
            return;
          }

          const type = typeof message?.type === "string" ? message.type : "__unknown__";
          const sourceEventId =
            typeof message?.payload?.sourceEventId === "string" ? message.payload.sourceEventId : null;
          transport.messages.push({ connectionIndex, type, sourceEventId });

          if (type === "state_sync" && message?.payload && typeof message.payload === "object") {
            const hasEventToken =
              typeof message.payload.eventToken === "string" && message.payload.eventToken.trim().length > 0;
            const eventToken =
              shouldCaptureEventTokens && hasEventToken
                ? message.payload.eventToken.trim()
                : null;
            transport.stateSyncs.push({
              connectionIndex,
              sessionId,
              openCount: transport.openCount,
              hasEventToken,
              eventToken,
            });
          }
        });
      }
    };
  }, captureEventTokens);
}

async function seedGuestName(context, inviteCode, displayName) {
  await context.addInitScript(
    ({ roomInviteCode, roomDisplayName }) => {
      localStorage.setItem(`guest_display_name_${roomInviteCode}`, roomDisplayName);
    },
    { roomInviteCode: inviteCode, roomDisplayName: displayName },
  );
}

async function seedOwnerSession(context, inviteCode, ownerToken) {
  await context.addInitScript(
    ({ roomInviteCode, roomOwnerToken }) => {
      localStorage.setItem(`owner_token_${roomInviteCode}`, roomOwnerToken);
      localStorage.setItem("display_name", "Negative auth owner");
      localStorage.setItem(`guest_display_name_${roomInviteCode}`, "Negative auth owner");
    },
    { roomInviteCode: inviteCode, roomOwnerToken: ownerToken },
  );
}

async function runInvalidInviteScenario(browser) {
  const invalidInviteCode = `r-missing-${randomUUID()}`;
  const roomResponse = await fetch(`${apiBaseUrl}/rooms/${encodeURIComponent(invalidInviteCode)}`);
  assertCondition(roomResponse.status === 404, `INVALID_INVITE_API_STATUS expected=404 actual=${roomResponse.status}`);

  const context = await browser.newContext();
  try {
    await installSseCapture(context, false);
    await seedGuestName(context, invalidInviteCode, "Invalid invite candidate");
    const page = await context.newPage();

    await page.goto(`${webBaseUrl}/room/${invalidInviteCode}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (window.__negativeAuthSseTransport?.errorCount ?? 0) > 0,
      { timeout: timeoutMs },
    );
    await page.waitForTimeout(invalidInviteObservationMs);

    const editableWorkspaceVisible = await page
      .locator('[data-testid="room-code-editor-host"] .cm-editor')
      .isVisible()
      .catch(() => false);
    assertCondition(!editableWorkspaceVisible, "INVALID_INVITE_EDITABLE_WORKSPACE_VISIBLE");

    const usableRealtimeStateObserved = await page.evaluate(() => {
      return (window.__negativeAuthSseTransport?.stateSyncs ?? []).some(
        (stateSync) => stateSync?.hasEventToken === true,
      );
    });
    assertCondition(!usableRealtimeStateObserved, "INVALID_INVITE_USABLE_REALTIME_STATE_OBSERVED");
    const invalidInviteStateSyncCount = await page.evaluate(
      () => window.__negativeAuthSseTransport?.stateSyncs?.length ?? 0,
    );
    assertCondition(invalidInviteStateSyncCount === 0, `INVALID_INVITE_STATE_SYNC_OBSERVED count=${invalidInviteStateSyncCount}`);

    const invalidInviteErrorCount = await page.evaluate(() => window.__negativeAuthSseTransport?.errorCount ?? 0);
    assertCondition(
      invalidInviteErrorCount <= maximumInvalidInviteSseErrors,
      `INVALID_INVITE_RETRY_STORM errors=${invalidInviteErrorCount} limit=${maximumInvalidInviteSseErrors}`,
    );
  } finally {
    await context.close();
  }
}

async function runStaleEventTokenScenario(browser) {
  const room = await createGuestRoom();
  const ownerContext = await browser.newContext();
  const candidateContext = await browser.newContext();

  try {
    await installSseCapture(ownerContext, false);
    await seedOwnerSession(ownerContext, room.inviteCode, room.ownerToken);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await ownerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: timeoutMs });

    await installSseCapture(candidateContext, true);
    await seedGuestName(candidateContext, room.inviteCode, "Stale token candidate");
    const candidatePage = await candidateContext.newPage();
    await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: timeoutMs });

    await candidatePage.waitForFunction(
      () => {
        return (window.__negativeAuthSseTransport?.stateSyncs ?? []).some(
          (stateSync) =>
            typeof stateSync?.sessionId === "string" &&
            stateSync.sessionId.length > 0 &&
            typeof stateSync?.eventToken === "string" &&
            stateSync.eventToken.length > 0,
        );
      },
      { timeout: timeoutMs },
    );
    const initialSession = await candidatePage.evaluate(() => {
      const stateSync = (window.__negativeAuthSseTransport?.stateSyncs ?? []).find(
        (candidate) =>
          typeof candidate?.sessionId === "string" &&
          candidate.sessionId.length > 0 &&
          typeof candidate?.eventToken === "string" &&
          candidate.eventToken.length > 0,
      );
      return stateSync
        ? {
            sessionId: stateSync.sessionId,
            eventToken: stateSync.eventToken,
            openCount: window.__negativeAuthSseTransport?.openCount ?? 0,
            errorCount: window.__negativeAuthSseTransport?.errorCount ?? 0,
          }
        : null;
    });
    assertCondition(initialSession, "INITIAL_EVENT_TOKEN_OR_SESSION_MISSING");

    await candidateContext.setOffline(true);
    try {
      await candidatePage.waitForFunction(
        (previousErrorCount) => (window.__negativeAuthSseTransport?.errorCount ?? 0) > previousErrorCount,
        initialSession.errorCount,
        { timeout: timeoutMs },
      );
    } finally {
      await candidateContext.setOffline(false);
    }

    await candidatePage.waitForFunction(
      ({ sessionId, eventToken, openCount }) => {
        return (window.__negativeAuthSseTransport?.stateSyncs ?? []).some(
          (stateSync) =>
            stateSync?.sessionId === sessionId &&
            typeof stateSync?.eventToken === "string" &&
            stateSync.eventToken.length > 0 &&
            stateSync.eventToken !== eventToken &&
            (stateSync.openCount ?? 0) > openCount,
        );
      },
      initialSession,
      { timeout: timeoutMs },
    );
    const replacementSession = await candidatePage.evaluate(({ sessionId, eventToken, openCount }) => {
      return [...(window.__negativeAuthSseTransport?.stateSyncs ?? [])]
        .reverse()
        .find(
          (stateSync) =>
            stateSync?.sessionId === sessionId &&
            typeof stateSync?.eventToken === "string" &&
            stateSync.eventToken.length > 0 &&
            stateSync.eventToken !== eventToken &&
            (stateSync.openCount ?? 0) > openCount,
        );
    }, initialSession);
    assertCondition(replacementSession, "REPLACEMENT_EVENT_TOKEN_MISSING");
    assertCondition(
      replacementSession.sessionId === initialSession.sessionId &&
        replacementSession.eventToken !== initialSession.eventToken,
      "STALE_EVENT_TOKEN_REPLACEMENT_NOT_PROVEN",
    );

    // "Stale" here means superseded by the same session's reconnect, not a
    // wall-clock token-expiry claim.
    const rejectedSourceEventId = randomUUID();
    const managerMessageStart = await ownerPage.evaluate(() => window.__negativeAuthSseTransport?.messages?.length ?? 0);
    const staleTokenStatus = await candidatePage.evaluate(
      async ({ baseUrl, inviteCode, sessionId, eventToken, sourceEventId }) => {
        const response = await fetch(`${baseUrl}/realtime/rooms/${inviteCode}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            eventToken,
            type: "key_press",
            sourceEventId,
            key: "x",
            keyCode: "KeyX",
          }),
        });
        return response.status;
      },
      {
        baseUrl: apiBaseUrl,
        inviteCode: room.inviteCode,
        sessionId: initialSession.sessionId,
        eventToken: initialSession.eventToken,
        sourceEventId: rejectedSourceEventId,
      },
    );
    assertCondition(staleTokenStatus === 403, `STALE_EVENT_TOKEN_STATUS expected=403 actual=${staleTokenStatus}`);

    await ownerPage.waitForTimeout(500);
    const rejectedActionBroadcast = await ownerPage.evaluate(
      ({ messageStart, sourceEventId }) => {
        return (window.__negativeAuthSseTransport?.messages ?? [])
          .slice(messageStart)
          .some((message) => message?.type === "candidate_key" && message?.sourceEventId === sourceEventId);
      },
      { messageStart: managerMessageStart, sourceEventId: rejectedSourceEventId },
    );
    assertCondition(!rejectedActionBroadcast, "STALE_EVENT_TOKEN_ACTION_BROADCAST");

    const rawExport = await ownerPage.evaluate(
      async ({ baseUrl, inviteCode, sourceEventId }) => {
        const ownerToken = localStorage.getItem(`owner_token_${inviteCode}`);
        const response = await fetch(`${baseUrl}/rooms/${inviteCode}/keystroke-events?format=json`, {
          headers: ownerToken ? { "X-Room-Owner-Token": ownerToken } : {},
        });
        let records = [];
        try {
          records = await response.json();
        } catch {
          // The status assertion below provides a token-safe diagnostic.
        }
        return {
          status: response.status,
          containsRejectedSourceId:
            Array.isArray(records) && records.some((record) => record?.sourceEventId === sourceEventId),
        };
      },
      { baseUrl: apiBaseUrl, inviteCode: room.inviteCode, sourceEventId: rejectedSourceEventId },
    );
    assertCondition(rawExport.status === 200, `STALE_EVENT_TOKEN_RAW_EXPORT_STATUS expected=200 actual=${rawExport.status}`);
    assertCondition(!rawExport.containsRejectedSourceId, "STALE_EVENT_TOKEN_ACTION_ACCEPTED");
  } finally {
    await Promise.allSettled([candidateContext.close(), ownerContext.close()]);
  }
}

const browser = await chromium.launch({ headless: true });

try {
  const failures = [];
  for (const [label, scenario] of [
    ["INVALID_INVITE", () => runInvalidInviteScenario(browser)],
    ["STALE_EVENT_TOKEN", () => runStaleEventTokenScenario(browser)],
  ]) {
    try {
      await scenario();
    } catch (error) {
      failures.push(`${label}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  console.log("AUTH_INVITE_TOKEN_NEGATIVE_OK");
} catch (error) {
  console.error("AUTH_INVITE_TOKEN_NEGATIVE_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
