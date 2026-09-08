import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const rawExportTimeoutMs = 12_000;

function fail(failures, label, error) {
  failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
}

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Activity timeline ${Date.now()}`,
      ownerDisplayName: "Activity manager",
      language: "nodejs",
    }),
  });
  const room = await response.json();
  if (!response.ok || !room.inviteCode || !room.ownerToken) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(room)}`);
  }
  return room;
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status}`);
  }
}

async function requestJson(path, options, label) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const payload = await readJsonResponse(response, label);
  if (!response.ok) {
    throw new Error(`${label}_FAILED status=${response.status}`);
  }
  return payload;
}

async function registerActivityUser(prefix) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const nickname = `${prefix}_${suffix}`.slice(0, 32);
  return requestJson(
    "/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, displayName: nickname, password: "pass12345" }),
    },
    "REGISTER_ACTIVITY_USER",
  );
}

async function createNonOwnerAuthorizationFixture() {
  const owner = await registerActivityUser("activity_owner");
  const interviewer = await registerActivityUser("activity_interviewer");
  const task = await requestJson(
    "/me/tasks",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        title: `Activity export coverage ${Date.now()}`,
        description: "Authorization and CSV coverage fixture",
        starterCode: "// activity export coverage\n",
        language: "nodejs",
      }),
    },
    "CREATE_ACTIVITY_EXPORT_TASK",
  );
  const room = await requestJson(
    "/rooms",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        title: `Activity export authorization ${Date.now()}`,
        taskIds: [task.id],
      }),
    },
    "CREATE_ACTIVITY_EXPORT_ROOM",
  );
  await requestJson(
    `/rooms/${room.inviteCode}/participants/${interviewer.user.id}/role`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({ role: "interviewer" }),
    },
    "GRANT_PERSISTED_ACTIVITY_INTERVIEWER",
  );
  return { owner, interviewer, room };
}

async function bootstrapAuthenticatedRoomPage(page, auth, inviteCode) {
  const displayName = auth.user.displayName || auth.user.nickname;
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ token, user, savedName, roomInviteCode }) => {
      localStorage.setItem("auth_token", token);
      localStorage.setItem("auth_user", JSON.stringify(user));
      localStorage.setItem("display_name", savedName);
      localStorage.setItem(`guest_display_name_${roomInviteCode}`, savedName);
      // These contexts deliberately do not receive an owner token. Non-owner
      // export coverage must prove its own Bearer authorization boundary.
      localStorage.removeItem(`owner_token_${roomInviteCode}`);
    },
    { token: auth.token, user: auth.user, savedName: displayName, roomInviteCode: inviteCode },
  );
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  // `.cm-editor` is mounted before CodeMirror has finished creating its editable
  // surface. Wait for the element that receives the real keyboard action so a
  // retry-regression cannot accidentally race the lazy editor mount.
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor({ timeout: 15_000 });
}

async function installRoleCoverageSseCapture(context) {
  await context.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.__roleCoverageSse = { openCount: 0, errorCount: 0, messages: [] };
    window.EventSource = class RoleCoverageEventSource extends NativeEventSource {
      set onopen(handler) {
        super.onopen = (event) => {
          window.__roleCoverageSse.openCount += 1;
          handler?.call(this, event);
        };
      }

      set onmessage(handler) {
        super.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message && typeof message === "object") {
              // This is test-only transport metadata. It lets the revocation
              // assertion distinguish a fresh post-offline state_sync from a
              // candidate state broadcast received on the old connection.
              message.__roleCoverageTransportOpenCount = window.__roleCoverageSse.openCount;
            }
            window.__roleCoverageSse.messages.push(message);
          } catch {
            window.__roleCoverageSse.messages.push({
              type: "__malformed__",
              __roleCoverageTransportOpenCount: window.__roleCoverageSse.openCount,
            });
          }
          handler?.call(this, event);
        };
      }

      set onerror(handler) {
        super.onerror = (event) => {
          window.__roleCoverageSse.errorCount += 1;
          handler?.call(this, event);
        };
      }
    };
  });
}

async function waitForRoleCoverageStateSync(page, expected, label) {
  try {
    await page.waitForFunction(
      ({ role, isOwner, canManageRoom, sourceEventId, minOpenCount, minTransportOpenCount, messageStart }) => {
        return (window.__roleCoverageSse?.messages ?? []).some(
          (message, index) => {
            const payload = message?.payload;
            if (!payload || message?.type !== "state_sync") return false;
            if (index < messageStart) return false;
            if (message.__roleCoverageTransportOpenCount < minTransportOpenCount) return false;
            if (typeof role === "string" && payload.role !== role) return false;
            if (typeof isOwner === "boolean" && payload.isOwner !== isOwner) return false;
            if (typeof canManageRoom === "boolean" && payload.canManageRoom !== canManageRoom) return false;
            if (
              typeof sourceEventId === "string" &&
              !Array.isArray(payload.candidateKeyHistory)
            ) {
              return false;
            }
            if (
              typeof sourceEventId === "string" &&
              !payload.candidateKeyHistory.some((event) => event?.sourceEventId === sourceEventId)
            ) {
              return false;
            }
            return (window.__roleCoverageSse?.openCount ?? 0) >= minOpenCount;
          },
        );
      },
      {
        role: expected.role ?? null,
        isOwner: expected.isOwner ?? null,
        canManageRoom: expected.canManageRoom ?? null,
        sourceEventId: expected.sourceEventId ?? null,
        minOpenCount: expected.minOpenCount ?? 1,
        minTransportOpenCount: expected.minTransportOpenCount ?? 0,
        messageStart: expected.messageStart ?? 0,
      },
      { timeout: rawExportTimeoutMs },
    );
  } catch {
    const diagnostic = await page.evaluate(() => {
      const transport = window.__roleCoverageSse;
      const stateSyncs = (transport?.messages ?? [])
        .filter((message) => message?.type === "state_sync")
        .slice(-4)
        .map((message) => ({
          role: message.payload?.role ?? null,
          isOwner: message.payload?.isOwner ?? null,
          canManageRoom: message.payload?.canManageRoom ?? null,
          hasEventToken: typeof message.payload?.eventToken === "string" && message.payload.eventToken.trim().length > 0,
          transportOpenCount: message.__roleCoverageTransportOpenCount ?? null,
        }));
      return {
        openCount: transport?.openCount ?? 0,
        errorCount: transport?.errorCount ?? 0,
        messageCount: transport?.messages?.length ?? 0,
        stateSyncs,
      };
    });
    throw new Error(`${label} diagnostic=${JSON.stringify(diagnostic)}`);
  }
}

function parseRfc4180Csv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(value);
      value = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += character;
  }

  if (quoted) throw new Error("CSV_UNTERMINATED_QUOTE");
  if (row.length > 0 || value.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

async function readDownloadText(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("CSV_DOWNLOAD_STREAM_UNAVAILABLE");
  let text = "";
  for await (const chunk of stream) {
    text += chunk.toString();
  }
  return text;
}

async function enterCandidate(page, displayName) {
  await page.getByText("Представьтесь перед входом в комнату", { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByLabel("Ваше имя").fill(displayName);
  await page.getByRole("button", { name: "Войти в комнату" }).click();
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15_000 });
}

async function openActivityTimeline(page) {
  await page.getByTestId("room-rail-tools").click();
  await page.getByRole("tab", { name: "Логи", exact: true }).click();
}

async function fetchRawEvents(inviteCode, ownerToken) {
  const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}/keystroke-events?format=json`, {
    headers: { "X-Room-Owner-Token": ownerToken },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`RAW_EXPORT_FAILED status=${response.status} payload=${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForRawEvents(inviteCode, ownerToken) {
  const deadline = Date.now() + rawExportTimeoutMs;
  let lastEvents = [];
  while (Date.now() < deadline) {
    lastEvents = await fetchRawEvents(inviteCode, ownerToken);
    if (lastEvents.length > 0) return lastEvents;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return lastEvents;
}

function hasRawAction(events, predicate) {
  return events.some(predicate);
}

function assertRawCapture(events, pasteLength) {
  const expected = [
    ["printable a", (event) => event.keyValue === "a"],
    ["printable b", (event) => event.keyValue === "b"],
    ["printable c", (event) => event.keyValue === "c"],
    ["Ctrl+Z shortcut", (event) => event.keyValue?.toLowerCase() === "z" && event.ctrlKey === true],
    ["paste length", (event) => event.eventKind === "paste" && event.pasteLength === pasteLength],
    ["focus/tab signal", (event) => ["window_blur", "tab_hidden", "tab_visible"].includes(event.eventKind)],
    ["queued reconnect marker", (event) => event.keyValue === "q"],
    ["late-delivery source", (event) => event.keyValue === "l"],
    ["later source", (event) => event.keyValue === "t"],
  ];
  const invalidCounts = expected
    .map(([label, predicate]) => [label, events.filter(predicate).length])
    .filter(([, count]) => count !== 1)
    .map(([label, count]) => `${label}=${count}`);
  if (invalidCounts.length > 0) {
    throw new Error(`RAW_ACTIVITY_COUNT_MISMATCH ${invalidCounts.join(", ")} export=${JSON.stringify(events)}`);
  }
}

function assertExactlyOneRawRecordPerSource(events, activityPosts) {
  const sourceIds = new Set(activityPosts.map((payload) => payload.sourceEventId).filter(Boolean));
  const invalid = [...sourceIds]
    .map((sourceEventId) => [sourceEventId, events.filter((event) => event.sourceEventId === sourceEventId).length])
    .filter(([, count]) => count !== 1);
  if (invalid.length > 0) {
    throw new Error(`RAW_SOURCE_ID_COUNT_MISMATCH ${JSON.stringify(invalid)}`);
  }
}

function canonicalEvents(events) {
  const finite = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return [...events].sort(
    (left, right) =>
      finite(left.timestampEpochMs) - finite(right.timestampEpochMs) ||
      finite(left.acceptedSequence) - finite(right.acceptedSequence) ||
      String(left.sourceEventId ?? "").localeCompare(String(right.sourceEventId ?? "")),
  );
}

function canonicalSourceIds(events) {
  return canonicalEvents(events).map((event) => event.sourceEventId);
}

const candidateHiddenActivityFields = new Set([
  "lastCandidateKey",
  "candidateKeyHistory",
  "sourceEventId",
  "acceptedSequence",
  "pastePreview",
]);

function findCandidateHiddenActivityFields(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findCandidateHiddenActivityFields(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const nestedPath = `${path}.${key}`;
    return [
      ...(candidateHiddenActivityFields.has(key) ? [nestedPath] : []),
      ...findCandidateHiddenActivityFields(nestedValue, nestedPath),
    ];
  });
}

async function waitForCondition(label, predicate, timeoutMs = rawExportTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(label);
}

async function waitForRawEventsContainingSourceIds(inviteCode, ownerToken, sourceIds) {
  const deadline = Date.now() + rawExportTimeoutMs;
  let lastEvents = [];
  while (Date.now() < deadline) {
    lastEvents = await fetchRawEvents(inviteCode, ownerToken);
    if (sourceIds.every((sourceEventId) => lastEvents.some((event) => event.sourceEventId === sourceEventId))) {
      return lastEvents;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return lastEvents;
}

const recordingUnavailableNotice =
  "\u0417\u0430\u043f\u0438\u0441\u044c \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430. \u0412\u044b \u043c\u043e\u0436\u0435\u0442\u0435 \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0442\u044c \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435; \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u043a\u043e\u043c\u043d\u0430\u0442\u0443, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c.";

async function installActivitySseCapture(context, captureKey) {
  await context.addInitScript((key) => {
    const NativeEventSource = window.EventSource;
    window[key] = {
      createdCount: 0,
      openCount: 0,
      errorCount: 0,
      candidateKeySourceIds: [],
      sources: [],
      openEvents: [],
      stateSyncs: [],
      forcedReconnects: [],
    };

    window.EventSource = class ActivitySseCaptureEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args);
        const sourceUrl = typeof this.url === "string" ? this.url : String(args[0] ?? "");
        let sessionId = null;
        try {
          sessionId = new URL(sourceUrl, window.location.href).searchParams.get("sessionId");
        } catch {
          // Keep the application transport usable even if a browser exposes no URL.
        }
        const source = {
          sourceUrl,
          sessionId,
          createdAt: Date.now(),
          openedCount: 0,
        };
        this.__activitySseCaptureSource = source;
        window[key].sources.push(source);
        window[key].createdCount += 1;
      }

      set onopen(handler) {
        super.onopen = (event) => {
          const capture = window[key];
          capture.openCount += 1;
          const source = this.__activitySseCaptureSource;
          if (source) {
            source.openedCount += 1;
            source.lastOpenedAt = Date.now();
          }
          capture.openEvents.push({
            at: Date.now(),
            sourceUrl: source?.sourceUrl ?? null,
            sessionId: source?.sessionId ?? null,
            openCount: capture.openCount,
            createdCount: capture.createdCount,
          });
          handler?.call(this, event);
        };
      }

      set onerror(handler) {
        super.onerror = (event) => {
          window[key].errorCount += 1;
          handler?.call(this, event);
        };
      }

      set onmessage(handler) {
        super.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message?.type === "state_sync") {
              const capture = window[key];
              const source = this.__activitySseCaptureSource;
              capture.stateSyncs.push({
                at: Date.now(),
                sourceUrl: source?.sourceUrl ?? null,
                sessionId: source?.sessionId ?? null,
                openCount: capture.openCount,
                createdCount: capture.createdCount,
              });
            }
            if (message?.type === "candidate_key" && typeof message.payload?.sourceEventId === "string") {
              window[key].candidateKeySourceIds.push(message.payload.sourceEventId);
            }
          } catch {
            // The application receives malformed messages through its normal path.
          }
          handler?.call(this, event);
        };
      }
    };

    // The test opens one short-lived native EventSource with the current public
    // URL/session. The server closes the prior room transport for that same
    // session, so the application performs a genuine, unrelated room-stream
    // reconnect without synthesizing a browser focus/reload event.
    window[key].forceUnrelatedReconnect = () => {
      const capture = window[key];
      const source = [...capture.sources]
        .reverse()
        .find(
          (candidate) =>
            typeof candidate?.sourceUrl === "string" &&
            candidate.sourceUrl.length > 0 &&
            typeof candidate?.sessionId === "string" &&
            candidate.sessionId.length > 0,
        );
      if (!source) return null;
      const forcedReconnect = {
        sourceUrl: source.sourceUrl,
        sessionId: source.sessionId,
        requestedAt: Date.now(),
        openedAt: null,
        erroredAt: null,
      };
      capture.forcedReconnects.push(forcedReconnect);
      const forcingSource = new NativeEventSource(source.sourceUrl);
      forcingSource.onopen = () => {
        forcedReconnect.openedAt = Date.now();
      };
      forcingSource.onerror = () => {
        forcedReconnect.erroredAt = Date.now();
        forcingSource.close();
      };
      return { sourceUrl: source.sourceUrl, sessionId: source.sessionId, requestedAt: forcedReconnect.requestedAt };
    };
  }, captureKey);
}

function summarizePersistent5xxAttempts(attempts) {
  const normalized = attempts.map((attempt) => ({
    sourceEventId: attempt.sourceEventId,
    at: attempt.at,
    respondedAt: attempt.respondedAt,
  }));
  return {
    count: normalized.length,
    first: normalized.slice(0, 3),
    last: normalized.slice(-2),
  };
}

function persistent5xxAttemptLedger(attempts) {
  return attempts.map((attempt) => ({
    sourceEventId: attempt.sourceEventId,
    at: attempt.at,
    respondedAt: attempt.respondedAt,
  }));
}

function hasSamePersistent5xxAttemptLedger(actual, expected) {
  return JSON.stringify(persistent5xxAttemptLedger(actual)) === JSON.stringify(expected);
}

function summarizePersistent5xxTransport(capture) {
  return {
    createdCount: capture?.createdCount ?? 0,
    openCount: capture?.openCount ?? 0,
    errorCount: capture?.errorCount ?? 0,
    sourceCount: capture?.sources?.length ?? 0,
    stateSyncCount: capture?.stateSyncs?.length ?? 0,
    forcedReconnectCount: capture?.forcedReconnects?.length ?? 0,
  };
}

function recordPersistent5xxViolation(violations, label, details = "") {
  const suffix = typeof details === "string" ? details : JSON.stringify(details);
  violations.push(`${label}${suffix ? ` ${suffix}` : ""}`);
}

async function forcePersistent5xxStateSync(page, inviteCode, captureKey, label) {
  const request = await page.evaluate(async ({ roomInviteCode, key }) => {
    const capture = window[key];
    const sessionId = sessionStorage.getItem(`room_ws_session_id_${roomInviteCode}`);
    const stateSyncCountBefore = capture?.stateSyncs?.length ?? 0;
    const requestedAt = Date.now();
    if (!sessionId) {
      return { sessionId: null, stateSyncCountBefore, requestedAt, respondedAt: Date.now(), status: null };
    }
    try {
      const response = await fetch(`/api/realtime/rooms/${roomInviteCode}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, type: "request_state_sync" }),
      });
      return {
        sessionId,
        stateSyncCountBefore,
        requestedAt,
        respondedAt: Date.now(),
        status: response.status,
      };
    } catch (error) {
      return {
        sessionId,
        stateSyncCountBefore,
        requestedAt,
        respondedAt: Date.now(),
        status: null,
        requestError: error instanceof Error ? error.message : String(error),
      };
    }
  }, { roomInviteCode: inviteCode, key: captureKey });

  if (!request.sessionId || request.status == null || request.status < 200 || request.status >= 300) {
    throw new Error(`${label}_REQUEST_FAILED request=${JSON.stringify(request)}`);
  }

  await page.waitForFunction(
    ({ key, sessionId, stateSyncCountBefore, requestedAt }) => {
      const stateSyncs = window[key]?.stateSyncs ?? [];
      return stateSyncs.some(
        (stateSync, index) =>
          index >= stateSyncCountBefore &&
          stateSync?.sessionId === sessionId &&
          typeof stateSync?.sourceUrl === "string" &&
          stateSync.sourceUrl.length > 0 &&
          stateSync.at >= requestedAt,
      );
    },
    {
      key: captureKey,
      sessionId: request.sessionId,
      stateSyncCountBefore: request.stateSyncCountBefore,
      requestedAt: request.requestedAt,
    },
    { timeout: rawExportTimeoutMs },
  );

  const observed = await page.evaluate(({ key, sessionId, stateSyncCountBefore, requestedAt }) => {
    const stateSyncs = window[key]?.stateSyncs ?? [];
    return (
      stateSyncs
        .slice(stateSyncCountBefore)
        .filter(
          (stateSync) =>
            stateSync?.sessionId === sessionId &&
            typeof stateSync?.sourceUrl === "string" &&
            stateSync.sourceUrl.length > 0 &&
            stateSync.at >= requestedAt,
        )
        .at(-1) ?? null
    );
  }, {
    key: captureKey,
    sessionId: request.sessionId,
    stateSyncCountBefore: request.stateSyncCountBefore,
    requestedAt: request.requestedAt,
  });
  if (!observed) throw new Error(`${label}_STATE_SYNC_NOT_CAPTURED`);
  return { ...request, stateSync: observed };
}

async function forcePersistent5xxEventSourceReconnect(page, captureKey, label) {
  const request = await page.evaluate((key) => {
    const capture = window[key];
    const before = {
      openCount: capture?.openCount ?? 0,
      errorCount: capture?.errorCount ?? 0,
      stateSyncCount: capture?.stateSyncs?.length ?? 0,
    };
    const forced = capture?.forceUnrelatedReconnect?.() ?? null;
    return { before, forced };
  }, captureKey);
  if (!request.forced?.sessionId || !request.forced?.sourceUrl) {
    throw new Error(`${label}_FORCED_TRANSPORT_NOT_CREATED`);
  }

  await page.waitForFunction(
    ({ key, requestedAt, sessionId }) =>
      (window[key]?.forcedReconnects ?? []).some(
        (forced) =>
          forced?.requestedAt === requestedAt && forced?.sessionId === sessionId && typeof forced?.openedAt === "number",
      ),
    {
      key: captureKey,
      requestedAt: request.forced.requestedAt,
      sessionId: request.forced.sessionId,
    },
    { timeout: rawExportTimeoutMs },
  );

  await page.waitForFunction(
    ({ key, openCount, sessionId }) =>
      (window[key]?.openEvents ?? []).some(
        (event) =>
          event?.openCount > openCount &&
          typeof event?.sourceUrl === "string" &&
          event.sourceUrl.length > 0 &&
          event?.sessionId === sessionId,
      ),
    { key: captureKey, openCount: request.before.openCount, sessionId: request.forced.sessionId },
    { timeout: rawExportTimeoutMs },
  );

  const reconnect = await page.evaluate(({ key, openCount, sessionId }) => {
    const openEvents = window[key]?.openEvents ?? [];
    return (
      openEvents
        .filter(
          (event) =>
            event?.openCount > openCount &&
            typeof event?.sourceUrl === "string" &&
            event.sourceUrl.length > 0 &&
            event?.sessionId === sessionId,
        )
        .at(-1) ?? null
    );
  }, { key: captureKey, openCount: request.before.openCount, sessionId: request.forced.sessionId });
  if (!reconnect) throw new Error(`${label}_OPEN_NOT_CAPTURED`);

  // A reopened EventSource alone is not ready for protected mutations: the
  // application needs the fresh state_sync carrying its replacement event
  // token. Waiting for that observable boundary prevents the test from
  // deliberately sending Yjs with an already-revoked token.
  await page.waitForFunction(
    ({ key, stateSyncCount, openCount, sessionId, requestedAt }) =>
      (window[key]?.stateSyncs ?? []).some(
        (stateSync, index) =>
          index >= stateSyncCount &&
          stateSync?.sessionId === sessionId &&
          stateSync?.openCount > openCount &&
          stateSync?.at >= requestedAt,
      ),
    {
      key: captureKey,
      stateSyncCount: request.before.stateSyncCount,
      openCount: request.before.openCount,
      sessionId: request.forced.sessionId,
      requestedAt: request.forced.requestedAt,
    },
    { timeout: rawExportTimeoutMs },
  );

  const stateSync = await page.evaluate(({ key, stateSyncCount, openCount, sessionId, requestedAt }) => {
    const stateSyncs = window[key]?.stateSyncs ?? [];
    return (
      stateSyncs
        .slice(stateSyncCount)
        .filter(
          (entry) =>
            entry?.sessionId === sessionId &&
            entry?.openCount > openCount &&
            entry?.at >= requestedAt,
        )
        .at(-1) ?? null
    );
  }, {
    key: captureKey,
    stateSyncCount: request.before.stateSyncCount,
    openCount: request.before.openCount,
    sessionId: request.forced.sessionId,
    requestedAt: request.forced.requestedAt,
  });
  if (!stateSync) throw new Error(`${label}_STATE_SYNC_NOT_CAPTURED`);
  return { before: request.before, reconnect, stateSync };
}

async function installPersistent5xxRawErrorObserver(page, rawErrorSentinel, rawStatusDetail) {
  await page.evaluate(({ sentinel, statusDetail }) => {
    const observed = [];
    const record = (value, source) => {
      if (typeof value !== "string") return;
      if (value.includes(sentinel)) observed.push({ kind: "sentinel", source, at: Date.now() });
      if (value.includes(statusDetail)) observed.push({ kind: "status-detail", source, at: Date.now() });
    };
    const inspectNode = (node, source) => {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        record(node.textContent ?? "", source);
        return;
      }
      record(node.textContent ?? "", source);
    };
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        inspectNode(record.target, "mutation-target");
        record.addedNodes.forEach((node) => inspectNode(node, "mutation-added-node"));
      });
    });
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
    inspectNode(document.documentElement, "initial-document");
    window.__persistent5xxRawErrorObserver = { observed, observer, sentinel, statusDetail };
  }, { sentinel: rawErrorSentinel, statusDetail: rawStatusDetail });
}

async function readPersistent5xxRawErrorObserver(page) {
  return page.evaluate(() => {
    const tracker = window.__persistent5xxRawErrorObserver;
    tracker?.observer?.disconnect();
    if (!tracker) return { observed: [], currentText: "" };
    const currentText = document.documentElement?.textContent ?? "";
    if (currentText.includes(tracker.sentinel)) {
      tracker.observed.push({ kind: "sentinel", source: "final-document", at: Date.now() });
    }
    if (currentText.includes(tracker.statusDetail)) {
      tracker.observed.push({ kind: "status-detail", source: "final-document", at: Date.now() });
    }
    return { observed: tracker.observed };
  });
}

function summarizePersistent5xxRawErrorObservation(observation) {
  const observed = observation?.observed ?? [];
  return {
    count: observed.length,
    kinds: [...new Set(observed.map((entry) => entry.kind))],
    first: observed.slice(0, 4),
  };
}

async function appendYjsMarker(page, marker) {
  await page.evaluate((nextMarker) => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    const view = host?.__roomEditorView;
    if (!view?.state?.doc) throw new Error("ROOM_EDITOR_VIEW_NOT_AVAILABLE");
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, to: at, insert: `\n${nextMarker}\n` },
      selection: { anchor: at + nextMarker.length + 2 },
    });
  }, marker);
}

async function waitForEditorMarker(page, marker, label) {
  try {
    await page.waitForFunction(
      (expectedMarker) =>
        document
          .querySelector("[data-testid='room-code-editor-host']")
          ?.__roomEditorView?.state?.doc?.toString?.()
          .includes(expectedMarker) ?? false,
      marker,
      { timeout: rawExportTimeoutMs },
    );
  } catch {
    throw new Error(`${label}_EDITOR_MARKER_MISSING marker=${marker}`);
  }
}

async function createPersistedTwoStepActivityFixture() {
  const owner = await registerActivityUser("activity_step_owner");
  const createTask = async (step) =>
    requestJson(
      "/me/tasks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${owner.token}`,
        },
        body: JSON.stringify({
          title: `Activity persisted step ${step} ${Date.now()}`,
          description: "Persisted room activity transition regression",
          starterCode: `// ACTIVITY_PERSISTED_STEP_${step}\n`,
          language: "nodejs",
        }),
      },
      `CREATE_ACTIVITY_PERSISTED_STEP_${step}`,
    );
  const firstTask = await createTask(0);
  const secondTask = await createTask(1);
  const room = await requestJson(
    "/rooms",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${owner.token}`,
      },
      body: JSON.stringify({
        title: `Activity persisted room ${Date.now()}`,
        taskIds: [firstTask.id, secondTask.id],
      }),
    },
    "CREATE_ACTIVITY_PERSISTED_ROOM",
  );
  return { owner, room, tasks: [firstTask, secondTask] };
}

async function waitForPublishedRoomStep(ownerToken, inviteCode, expectedStep) {
  const deadline = Date.now() + rawExportTimeoutMs;
  let lastRoom = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    lastRoom = await response.json().catch(() => null);
    if (response.ok && lastRoom?.currentStep === expectedStep) return lastRoom;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`PERSISTED_ROOM_STEP_TIMEOUT expected=${expectedStep} actual=${lastRoom?.currentStep ?? null}`);
}

async function runPostStepActivityPersistenceRegression(browser) {
  const fixture = await createPersistedTwoStepActivityFixture();
  const ownerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  try {
    await Promise.all([
      installActivitySseCapture(ownerContext, "__postStepOwnerSseCapture"),
      installActivitySseCapture(candidateContext, "__postStepCandidateSseCapture"),
    ]);
    const ownerPage = await ownerContext.newPage();
    const candidatePage = await candidateContext.newPage();
    const routedActivityPosts = [];
    await candidatePage.route(`**/api/realtime/rooms/${fixture.room.inviteCode}/events`, async (route) => {
      let payload = null;
      try {
        payload = JSON.parse(route.request().postData() || "{}");
      } catch {
        // The actual relay receives malformed non-activity test traffic normally.
      }
      if (payload?.type !== "key_press") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      routedActivityPosts.push({ payload, status: response.status() });
      await route.fulfill({ response });
    });

    await bootstrapAuthenticatedRoomPage(ownerPage, fixture.owner, fixture.room.inviteCode);
    await candidatePage.goto(`${webBaseUrl}/room/${fixture.room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await enterCandidate(candidatePage, "Persisted step candidate");
    await candidatePage.waitForTimeout(350);

    await ownerPage.getByTestId("room-step-row-1").click();
    const publishStep = ownerPage.getByTestId("room-publish-step");
    await publishStep.waitFor({ state: "visible", timeout: rawExportTimeoutMs });
    await publishStep.click();
    await waitForPublishedRoomStep(fixture.owner.token, fixture.room.inviteCode, 1);
    await candidatePage.waitForFunction(
      (title) =>
        document.querySelector("[data-testid='room-current-published-step-title']")?.textContent?.includes(title) ?? false,
      fixture.tasks[1].title,
      { timeout: rawExportTimeoutMs },
    );

    await candidatePage.locator("[data-testid='room-code-editor-host'] .cm-content").click({ force: true });
    await candidatePage.keyboard.press("ArrowRight");
    await waitForCondition(
      `POST_STEP_ACTIVITY_RELAY_NOT_OBSERVED posts=${JSON.stringify(routedActivityPosts)}`,
      () => routedActivityPosts.length >= 1,
    );
    const trackedPost = routedActivityPosts.find((entry) => entry.payload?.key === "ArrowRight");
    const sourceEventId = trackedPost?.payload?.sourceEventId;
    if (
      !sourceEventId ||
      trackedPost.status < 200 ||
      trackedPost.status >= 300 ||
      routedActivityPosts.filter((entry) => entry.payload?.sourceEventId === sourceEventId).length !== 1
    ) {
      throw new Error(`POST_STEP_ACTIVITY_RELAY_INVALID posts=${JSON.stringify(routedActivityPosts)}`);
    }

    const exported = await ownerPage.evaluate(async ({ inviteCode, ownerToken }) => {
      const response = await fetch(`/api/rooms/${inviteCode}/keystroke-events?format=json`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      return {
        status: response.status,
        events: await response.json().catch(() => null),
      };
    }, { inviteCode: fixture.room.inviteCode, ownerToken: fixture.owner.token });
    const matchingEvents = Array.isArray(exported.events)
      ? exported.events.filter((event) => event?.sourceEventId === sourceEventId)
      : [];
    if (exported.status !== 200 || matchingEvents.length !== 1) {
      throw new Error(
        `POST_STEP_ACTIVITY_RAW_EXPORT_INVALID status=${exported.status} sourceEventId=${sourceEventId} events=${JSON.stringify(exported.events)}`,
      );
    }

    await candidatePage.waitForTimeout(500);
    const ownerCapture = await ownerPage.evaluate(() => window.__postStepOwnerSseCapture);
    const managerBroadcastCount = ownerCapture?.candidateKeySourceIds?.filter((id) => id === sourceEventId).length ?? 0;
    if (managerBroadcastCount > 1) {
      throw new Error(`POST_STEP_ACTIVITY_MANAGER_BROADCAST_DUPLICATE count=${managerBroadcastCount}`);
    }
  } finally {
    await Promise.all([ownerContext.close(), candidateContext.close()].map((promise) => promise.catch(() => {})));
  }
}

async function runPersistentActivity5xxRegression() {
  // The old three-failure queue-drop contract is superseded by recoverable,
  // deadline-bounded delivery. Reuse the focused real-browser acceptance cases.
  execFileSync(process.execPath, [
    "--test", "--test-name-pattern=activity FIFO",
    new URL("./e2e-activity-history-recovery.mjs", import.meta.url).pathname,
  ], { env: process.env, timeout: 150000, stdio: "pipe" });
}

const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  try {
    await runPostStepActivityPersistenceRegression(browser);
  } catch (error) {
    fail(failures, "published-step candidate activity remains durable", error);
  }

  try {
    await runPersistentActivity5xxRegression(browser);
  } catch (error) {
    fail(failures, "persistent activity 5xx remains bounded without disrupting collaboration", error);
  }

  const room = await createGuestRoom();
  const ownerContext = await browser.newContext();
  await ownerContext.addInitScript(
    ({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem("display_name", "Activity manager");
      localStorage.setItem(`guest_display_name_${inviteCode}`, "Activity manager");
    },
    { inviteCode: room.inviteCode, ownerToken: room.ownerToken },
  );
  await ownerContext.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.__holdCandidateKeyDelivery = false;
    window.__heldCandidateKeyDeliveries = [];
    window.__activityTimelineStateSyncPayloads = [];
    window.__activityTimelineSseTransport = {
      createdCount: 0,
      openCount: 0,
      errorCount: 0,
      stateSyncs: [],
    };
    window.__releaseCandidateKeyDeliveries = () => {
      const deliveries = window.__heldCandidateKeyDeliveries.splice(0);
      deliveries.forEach((deliver) => deliver());
    };

    window.EventSource = class DelayedCandidateKeyEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args);
        window.__activityTimelineSseTransport.createdCount += 1;
      }

      set onopen(handler) {
        super.onopen = (event) => {
          window.__activityTimelineSseTransport.openCount += 1;
          handler?.call(this, event);
        };
      }

      set onerror(handler) {
        super.onerror = (event) => {
          window.__activityTimelineSseTransport.errorCount += 1;
          handler?.call(this, event);
        };
      }

      set onmessage(handler) {
        super.onmessage = (event) => {
          let message = null;
          try {
            message = JSON.parse(event.data);
          } catch {
            // The application will handle malformed room messages normally.
          }
          if (message?.type === "state_sync" && message.payload) {
            window.__activityTimelineStateSyncPayloads.push(message.payload);
            window.__activityTimelineSseTransport.stateSyncs.push({
              transportOpenCount: window.__activityTimelineSseTransport.openCount,
              payload: message.payload,
            });
          }
          const isCandidateKey = message?.type === "candidate_key";
          if (window.__holdCandidateKeyDelivery && isCandidateKey) {
            window.__heldCandidateKeyDeliveries.push(() => handler?.call(this, event));
            return;
          }
          handler?.call(this, event);
        };
      }
    };
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await ownerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15_000 });
  await openActivityTimeline(ownerPage);

  const candidateContext = await browser.newContext();
  await candidateContext.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: webBaseUrl,
  });
  await candidateContext.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    window.__candidateActivitySseTransport = {
      createdCount: 0,
      openCount: 0,
      messages: [],
    };

    window.EventSource = class CandidateActivityCaptureEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args);
        window.__candidateActivitySseTransport.createdCount += 1;
      }

      set onopen(handler) {
        super.onopen = (event) => {
          window.__candidateActivitySseTransport.openCount += 1;
          handler?.call(this, event);
        };
      }

      set onmessage(handler) {
        super.onmessage = (event) => {
          window.__candidateActivitySseTransport.messages.push({
            transportOpenCount: window.__candidateActivitySseTransport.openCount,
            data: event.data,
          });
          handler?.call(this, event);
        };
      }
    };
  });
  const candidatePage = await candidateContext.newPage();
  const activityPosts = [];
  let lostResponseSourceId = null;
  let delayedSourceEventId = null;
  let physicalSpaceRelayPayload = null;
  let captureTruncationActivityPosts = false;
  const truncationActivityPosts = [];
  let authorization403ScenarioEnabled = false;
  let authorization403TerminalResponseIssued = false;
  const authorization403RouteRecords = [];
  const authorization403PostTerminalPosts = [];
  let fifoBurstCaptureEnabled = false;
  let fifoBurstSynthetic5xxIssued = false;
  let fifoBurstFirstAttemptSourceId = null;
  let fifoBurstActivityRequestsInFlight = 0;
  let fifoBurstMaxActivityRequestsInFlight = 0;
  const fifoBurstRouteRecords = [];
  const fifoBurstForwardedSourceIds = [];
  let releaseFifoBurstSynthetic5xx = null;
  let releaseFifoBurstRecovery = null;
  const fifoBurstSynthetic5xxGate = new Promise((resolve) => {
    releaseFifoBurstSynthetic5xx = resolve;
  });
  const fifoBurstRecoveryGate = new Promise((resolve) => {
    releaseFifoBurstRecovery = resolve;
  });

  await candidatePage.route("**/api/realtime/rooms/*/events", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.type !== "key_press") {
      await route.continue();
      return;
    }

    activityPosts.push(payload);
    if (captureTruncationActivityPosts) {
      truncationActivityPosts.push(payload);
    }
    if (payload.key === " " && payload.keyCode === "Space" && physicalSpaceRelayPayload === null) {
      physicalSpaceRelayPayload = payload;
    }
    if (fifoBurstCaptureEnabled) {
      const routeRecord = {
        sourceEventId: payload.sourceEventId ?? null,
        key: payload.key,
        handling: null,
      };
      fifoBurstRouteRecords.push(routeRecord);
      fifoBurstActivityRequestsInFlight += 1;
      fifoBurstMaxActivityRequestsInFlight = Math.max(
        fifoBurstMaxActivityRequestsInFlight,
        fifoBurstActivityRequestsInFlight,
      );
      try {
        if (!fifoBurstSynthetic5xxIssued) {
          fifoBurstSynthetic5xxIssued = true;
          fifoBurstFirstAttemptSourceId = routeRecord.sourceEventId;
          routeRecord.handling = "synthetic-503";
          // Keep the first request open while the rest of the browser burst is
          // captured. This exposes an accidental fire-and-forget lane as
          // concurrent routed requests before this synthetic response is sent.
          await fifoBurstSynthetic5xxGate;
          // Deliberately do not use route.fetch() or route.continue() here: the
          // first activity attempt must never reach the server.
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "synthetic activity retry test failure" }),
          });
          return;
        }

        routeRecord.handling = "recovery-forward";
        // Hold the retry until the test has proved that the first synthetic
        // failure created no raw server record. Once released, every recovery
        // request takes the normal browser-to-server path.
        await fifoBurstRecoveryGate;
        fifoBurstForwardedSourceIds.push(routeRecord.sourceEventId);
        const response = await route.fetch();
        await route.fulfill({ response });
      } finally {
        fifoBurstActivityRequestsInFlight -= 1;
      }
      return;
    }
    if (payload.key === "r" && lostResponseSourceId === null) {
      lostResponseSourceId = payload.sourceEventId ?? null;
      await route.fetch();
      await route.abort("failed");
      return;
    }
    if (payload.key === "l" && delayedSourceEventId === null) {
      delayedSourceEventId = payload.sourceEventId ?? null;
    }
    if (authorization403ScenarioEnabled && authorization403TerminalResponseIssued) {
      // A post-terminal activity request is a test failure, but keep it local so
      // a broken client cannot create a real raw record while the assertion is
      // being collected.
      authorization403PostTerminalPosts.push(payload);
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "activity access rejected for test" }),
      });
      return;
    }
    if (authorization403ScenarioEnabled && payload.key === "u") {
      authorization403RouteRecords.push(payload);
      if (authorization403RouteRecords.length === 2) {
        authorization403TerminalResponseIssued = true;
      }
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "activity access rejected for test" }),
      });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await candidatePage.goto(`${webBaseUrl}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await enterCandidate(candidatePage, "Activity candidate");
  await candidatePage.waitForTimeout(1_000);

  const editor = candidatePage.locator('[data-testid="room-code-editor-host"] .cm-content');
  await editor.click({ force: true });
  // 60 ms is deliberately below the current 120 ms client throttle. Each key is
  // nevertheless an individual source action in the required behavior.
  await candidatePage.keyboard.type("abc", { delay: 60 });
  // `press("Space")` creates a physical DOM key action; it must stay typed
  // whitespace across the relay, raw export, and manager-visible projection.
  await candidatePage.keyboard.press("Space");
  await candidatePage.waitForTimeout(180);
  await candidatePage.keyboard.press("Control+Z");
  await candidatePage.waitForTimeout(180);
  const pasteText = "paste-without-preview";
  await candidatePage.evaluate((text) => navigator.clipboard.writeText(text), pasteText);
  await candidatePage.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await candidatePage.waitForTimeout(180);
  await candidatePage.evaluate(() => window.dispatchEvent(new Event("blur")));
  await candidatePage.waitForTimeout(180);

  // The server accepts this source event, but the browser loses its response.
  // A reconnect must retry the same sourceEventId rather than silently losing it.
  await candidatePage.keyboard.press("r");
  // This marker is captured after recovery starts but before the fresh state
  // sync. It must stay queued instead of being discarded during reconnect.
  await candidatePage.waitForTimeout(100);
  await candidatePage.keyboard.press("q");
  await candidateContext.setOffline(true);
  await candidatePage.waitForTimeout(250);
  await candidateContext.setOffline(false);
  await candidatePage.waitForTimeout(2_000);

  // Delay only the manager's SSE `candidate_key` delivery for L. T is accepted
  // and delivered normally first; releasing L later verifies that the manager
  // reorders/reprojects by server acceptance order rather than transport order.
  await ownerPage.evaluate(() => {
    window.__holdCandidateKeyDelivery = true;
  });
  await candidatePage.keyboard.press("l");
  await candidatePage.waitForTimeout(180);
  await ownerPage.evaluate(() => {
    window.__holdCandidateKeyDelivery = false;
  });
  await candidatePage.keyboard.press("t");
  await candidatePage.waitForTimeout(500);
  await ownerPage.evaluate(() => window.__releaseCandidateKeyDeliveries());
  await candidatePage.waitForTimeout(1_000);

  const rawEvents = await waitForRawEvents(room.inviteCode, room.ownerToken);
  try {
    assertRawCapture(rawEvents, pasteText.length);
    assertExactlyOneRawRecordPerSource(rawEvents, activityPosts);
  } catch (error) {
    fail(failures, "raw source capture", error);
  }

  try {
    if (!physicalSpaceRelayPayload?.sourceEventId) {
      throw new Error(`PHYSICAL_SPACE_RELAY_NOT_CAPTURED posts=${JSON.stringify(activityPosts)}`);
    }
    if (physicalSpaceRelayPayload.key !== " " || physicalSpaceRelayPayload.keyCode !== "Space") {
      throw new Error(`PHYSICAL_SPACE_RELAY_WIRE_MISMATCH payload=${JSON.stringify(physicalSpaceRelayPayload)}`);
    }

    const exportedSpaceEvent = rawEvents.find(
      (event) => event.sourceEventId === physicalSpaceRelayPayload.sourceEventId,
    );
    if (!exportedSpaceEvent) {
      throw new Error(
        `PHYSICAL_SPACE_EXPORT_SOURCE_ID_MISSING sourceEventId=${physicalSpaceRelayPayload.sourceEventId} export=${JSON.stringify(rawEvents)}`,
      );
    }
    if (exportedSpaceEvent.keyValue !== " " || exportedSpaceEvent.keyCode !== "Space") {
      throw new Error(
        `PHYSICAL_SPACE_EXPORT_WIRE_MISMATCH sourceEventId=${physicalSpaceRelayPayload.sourceEventId} event=${JSON.stringify(exportedSpaceEvent)}`,
      );
    }

    const groupedSummaries = await ownerPage.locator('[data-testid="activity-timeline-summary"]').allTextContents();
    if (!groupedSummaries.some((summary) => summary.includes("abc "))) {
      throw new Error(`PHYSICAL_SPACE_GROUPED_WHITESPACE_MISSING summaries=${JSON.stringify(groupedSummaries)}`);
    }
    if (groupedSummaries.some((summary) => summary.includes("Space"))) {
      throw new Error(`PHYSICAL_SPACE_GROUPED_LITERAL_WORD summaries=${JSON.stringify(groupedSummaries)}`);
    }
  } catch (error) {
    fail(failures, "physical Space wire, raw export, and grouped whitespace", error);
  }

  try {
    const candidateExportStatus = await candidatePage.evaluate(async ({ apiBaseUrl, inviteCode }) => {
      const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}/keystroke-events?format=json`);
      return response.status;
    }, { apiBaseUrl, inviteCode: room.inviteCode });
    if (candidateExportStatus !== 403) {
      throw new Error(`CANDIDATE_RAW_EXPORT_STATUS ${candidateExportStatus}`);
    }
  } catch (error) {
    fail(failures, "candidate isolation", error);
  }

  try {
    if (!lostResponseSourceId) {
      throw new Error(`SOURCE_EVENT_ID_MISSING_ON_LOST_RESPONSE posts=${JSON.stringify(activityPosts)}`);
    }
    const retryPosts = activityPosts.filter((payload) => payload.sourceEventId === lostResponseSourceId);
    if (retryPosts.length !== 2) {
      throw new Error(`RETRY_COUNT expected=2 actual=${retryPosts.length} posts=${JSON.stringify(activityPosts)}`);
    }
    if (rawEvents.filter((event) => event.sourceEventId === lostResponseSourceId).length !== 1) {
      throw new Error(`RAW_IDEMPOTENCY_FAILED id=${lostResponseSourceId} export=${JSON.stringify(rawEvents)}`);
    }
  } catch (error) {
    fail(failures, "retry source identity and raw idempotency", error);
  }

  // Intentionally red until the grouped presentation implementation (section 4).
  // It is deliberately independent from the raw-source assertions above.
  try {
    const entries = ownerPage.locator('[data-testid="activity-timeline-entry"]');
    const entryCount = await entries.count();
    if (entryCount !== 1) {
      throw new Error(`GROUPED_ENTRY_COUNT expected=1 actual=${entryCount}`);
    }
    const summary = await ownerPage.locator('[data-testid="activity-timeline-summary"]').innerText();
    for (const token of ["Набрано: «abc »", "Ctrl+Z", `Вставка: ${pasteText.length} симв.`]) {
      if (!summary.includes(token)) {
        throw new Error(`GROUPED_SUMMARY_MISSING ${token}: ${summary}`);
      }
    }
    const renderedSourceIds = await ownerPage.locator('[data-testid="activity-timeline-source-id"]').allTextContents();
    const expectedSourceIds = canonicalSourceIds(rawEvents);
    if (new Set(renderedSourceIds).size !== renderedSourceIds.length) {
      throw new Error(`DUPLICATE_RENDERED_SOURCE_IDS ${JSON.stringify(renderedSourceIds)}`);
    }
    if (JSON.stringify(renderedSourceIds) !== JSON.stringify(expectedSourceIds)) {
      throw new Error(
        `CANONICAL_RECONCILIATION_FAILED expected=${JSON.stringify(expectedSourceIds)} actual=${JSON.stringify(renderedSourceIds)}`,
      );
    }
    if (!delayedSourceEventId || !renderedSourceIds.includes(delayedSourceEventId)) {
      throw new Error(`LATE_SOURCE_NOT_RENDERED_ONCE sourceEventId=${delayedSourceEventId}`);
    }
  } catch (error) {
    fail(failures, "grouped presentation and manager reconnect reconciliation", error);
  }

  // 7.2: source-event retention is a live-history boundary only. Produce more
  // than 50 individual browser actions, then make the manager reconnect via a
  // real page reload so the assertions use an authoritative state_sync rather
  // than the manager's pre-reload incremental event cache.
  try {
    captureTruncationActivityPosts = true;
    try {
      await candidatePage.keyboard.type("x".repeat(51));
      await waitForCondition(
        `TRUNCATION_ACTIVITY_POSTS_NOT_OBSERVED actual=${truncationActivityPosts.length}`,
        () => truncationActivityPosts.length >= 51,
      );
    } finally {
      captureTruncationActivityPosts = false;
    }

    if (truncationActivityPosts.length !== 51) {
      throw new Error(`TRUNCATION_ACTIVITY_POST_COUNT expected=51 actual=${truncationActivityPosts.length}`);
    }
    const truncationSourceIds = truncationActivityPosts.map((payload) => payload.sourceEventId);
    if (truncationSourceIds.some((sourceEventId) => typeof sourceEventId !== "string" || !sourceEventId.trim())) {
      throw new Error(`TRUNCATION_SOURCE_ID_MISSING posts=${JSON.stringify(truncationActivityPosts)}`);
    }
    if (new Set(truncationSourceIds).size !== 51) {
      throw new Error(`TRUNCATION_SOURCE_IDS_NOT_UNIQUE ids=${JSON.stringify(truncationSourceIds)}`);
    }

    const acceptedSourceIds = [...new Set(activityPosts.map((payload) => payload.sourceEventId).filter(Boolean))];
    const allRawEvents = await waitForRawEventsContainingSourceIds(
      room.inviteCode,
      room.ownerToken,
      acceptedSourceIds,
    );
    assertExactlyOneRawRecordPerSource(allRawEvents, activityPosts);

    const truncationRawEvents = allRawEvents.filter((event) => truncationSourceIds.includes(event.sourceEventId));
    if (truncationRawEvents.length !== 51) {
      throw new Error(
        `TRUNCATION_RAW_EXPORT_COUNT expected=51 actual=${truncationRawEvents.length} export=${JSON.stringify(allRawEvents)}`,
      );
    }
    const truncationAcceptedSequences = truncationRawEvents.map((event) => event.acceptedSequence);
    if (
      truncationAcceptedSequences.some((sequence) => typeof sequence !== "number") ||
      new Set(truncationAcceptedSequences).size !== 51
    ) {
      throw new Error(`TRUNCATION_ACCEPTED_SEQUENCE_INVALID events=${JSON.stringify(truncationRawEvents)}`);
    }

    const canonicalExportEvents = canonicalEvents(allRawEvents);
    const expectedLiveEvents = canonicalExportEvents.slice(-50);
    const expectedLiveSourceIds = expectedLiveEvents.map((event) => event.sourceEventId);
    const expectedTimelineSourceIds = canonicalExportEvents.map((event) => event.sourceEventId);
    if (expectedLiveSourceIds.length !== 50 || new Set(expectedLiveSourceIds).size !== 50) {
      throw new Error(`LIVE_HISTORY_EXPECTATION_INVALID ids=${JSON.stringify(expectedLiveSourceIds)}`);
    }
    const oldestTruncationEvent = canonicalEvents(truncationRawEvents)[0];
    if (!oldestTruncationEvent?.sourceEventId || expectedLiveSourceIds.includes(oldestTruncationEvent.sourceEventId)) {
      throw new Error(
        `OLDEST_TRUNCATION_EVENT_NOT_EVICTED oldest=${JSON.stringify(oldestTruncationEvent)} live=${JSON.stringify(expectedLiveSourceIds)}`,
      );
    }
    if (!allRawEvents.some((event) => event.sourceEventId === oldestTruncationEvent.sourceEventId)) {
      throw new Error(`EVICTED_OLDEST_EVENT_MISSING_FROM_RAW_EXPORT id=${oldestTruncationEvent.sourceEventId}`);
    }

    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    await ownerPage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15_000 });
    await openActivityTimeline(ownerPage);
    await ownerPage.waitForFunction(
      (expectedCount) =>
        Array.isArray(window.__activityTimelineStateSyncPayloads) &&
        window.__activityTimelineStateSyncPayloads.some(
          (payload) => Array.isArray(payload?.candidateKeyHistory) && payload.candidateKeyHistory.length === expectedCount,
        ),
      expectedLiveSourceIds.length,
      { timeout: 15_000 },
    );
    await ownerPage.waitForFunction(
      (expectedCount) => document.querySelectorAll('[data-testid="activity-timeline-source-id"]').length === expectedCount,
      expectedTimelineSourceIds.length,
      { timeout: 15_000 },
    );

    const reconnectedStateHistory = await ownerPage.evaluate(() => {
      const payloads = window.__activityTimelineStateSyncPayloads ?? [];
      const payload = [...payloads]
        .reverse()
        .find((candidate) => Array.isArray(candidate?.candidateKeyHistory) && candidate.candidateKeyHistory.length === 50);
      return payload?.candidateKeyHistory ?? null;
    });
    if (!reconnectedStateHistory) {
      throw new Error("RECONNECTED_MANAGER_STATE_SYNC_MISSING");
    }
    const reconnectedStateSourceIds = reconnectedStateHistory.map((event) => event.sourceEventId);
    if (JSON.stringify(reconnectedStateSourceIds) !== JSON.stringify(expectedLiveSourceIds)) {
      throw new Error(
        `RECONNECTED_MANAGER_STATE_HISTORY_MISMATCH expected=${JSON.stringify(expectedLiveSourceIds)} actual=${JSON.stringify(reconnectedStateSourceIds)}`,
      );
    }

    const renderedLiveSourceIds = await ownerPage.locator('[data-testid="activity-timeline-source-id"]').allTextContents();
    if (renderedLiveSourceIds.length !== expectedTimelineSourceIds.length || new Set(renderedLiveSourceIds).size !== expectedTimelineSourceIds.length) {
      throw new Error(`RECONNECTED_MANAGER_TIMELINE_COUNT_MISMATCH ids=${JSON.stringify(renderedLiveSourceIds)}`);
    }
    if (!renderedLiveSourceIds.includes(oldestTruncationEvent.sourceEventId)) {
      throw new Error(`OLDEST_EVENT_MISSING_FROM_DURABLE_TIMELINE id=${oldestTruncationEvent.sourceEventId}`);
    }
    const rawEventsBySourceId = new Map(allRawEvents.map((event) => [event.sourceEventId, event]));
    const renderedLiveEvents = renderedLiveSourceIds.map((sourceEventId) => rawEventsBySourceId.get(sourceEventId));
    if (renderedLiveEvents.some((event) => !event)) {
      throw new Error(`RECONNECTED_MANAGER_TIMELINE_UNKNOWN_SOURCE ids=${JSON.stringify(renderedLiveSourceIds)}`);
    }
    if (JSON.stringify(canonicalSourceIds(renderedLiveEvents)) !== JSON.stringify(expectedTimelineSourceIds)) {
      throw new Error(
        `RECONNECTED_MANAGER_TIMELINE_HISTORY_MISMATCH expected=${JSON.stringify(expectedTimelineSourceIds)} actual=${JSON.stringify(canonicalSourceIds(renderedLiveEvents))}`,
      );
    }
  } catch (error) {
    fail(failures, "SSE stays bounded at 50 while durable timeline and export preserve all source events", error);
  }

  // 7.3: disconnect the manager's live EventSource transport without reloading
  // the page, accept activity while that transport is down, then verify that the
  // next authoritative state_sync replaces the stale local live history. A
  // candidate reload is separately observed through its own real EventSource.
  try {
    const managerSourceIdsBeforeDisconnect = await ownerPage
      .locator('[data-testid="activity-timeline-source-id"]')
      .allTextContents();
    if (
      managerSourceIdsBeforeDisconnect.length < 51 ||
      new Set(managerSourceIdsBeforeDisconnect).size !== managerSourceIdsBeforeDisconnect.length
    ) {
      throw new Error(`MANAGER_PRE_DISCONNECT_HISTORY_INVALID ids=${JSON.stringify(managerSourceIdsBeforeDisconnect)}`);
    }

    const managerTransportBeforeDisconnect = await ownerPage.evaluate(() => ({
      createdCount: window.__activityTimelineSseTransport?.createdCount ?? 0,
      openCount: window.__activityTimelineSseTransport?.openCount ?? 0,
      errorCount: window.__activityTimelineSseTransport?.errorCount ?? 0,
    }));
    if (
      managerTransportBeforeDisconnect.createdCount < 1 ||
      managerTransportBeforeDisconnect.openCount < 1
    ) {
      throw new Error(`MANAGER_EVENTSOURCE_NOT_CONNECTED state=${JSON.stringify(managerTransportBeforeDisconnect)}`);
    }

    const activityPostCountBeforeDisconnect = activityPosts.length;
    let managerTransportOffline = false;
    let managerMissedActivityPayload = null;
    let managerReconnectRawEvents = [];
    try {
      await ownerContext.setOffline(true);
      managerTransportOffline = true;
      await ownerPage.waitForFunction(
        (errorCount) => (window.__activityTimelineSseTransport?.errorCount ?? 0) > errorCount,
        managerTransportBeforeDisconnect.errorCount,
        { timeout: 15_000 },
      );

      await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-content').click({ force: true });
      await candidatePage.keyboard.press("m");
      await waitForCondition(
        `MANAGER_MISSED_ACTIVITY_POST_NOT_OBSERVED before=${activityPostCountBeforeDisconnect} actual=${activityPosts.length}`,
        () => activityPosts.length > activityPostCountBeforeDisconnect,
      );
      managerMissedActivityPayload = activityPosts.at(-1) ?? null;
      if (managerMissedActivityPayload?.key !== "m" || !managerMissedActivityPayload?.sourceEventId) {
        throw new Error(`MANAGER_MISSED_ACTIVITY_SOURCE_ID_MISSING payload=${JSON.stringify(managerMissedActivityPayload)}`);
      }
      managerReconnectRawEvents = await waitForRawEventsContainingSourceIds(
        room.inviteCode,
        room.ownerToken,
        [managerMissedActivityPayload.sourceEventId],
      );
    } finally {
      if (managerTransportOffline) {
        await ownerContext.setOffline(false);
      }
    }

    if (
      !managerMissedActivityPayload?.sourceEventId ||
      !managerReconnectRawEvents.some((event) => event.sourceEventId === managerMissedActivityPayload.sourceEventId)
    ) {
      throw new Error(
        `MANAGER_MISSED_ACTIVITY_NOT_EXPORTED sourceEventId=${managerMissedActivityPayload?.sourceEventId ?? ""}`,
      );
    }

    const expectedManagerTimelineIds = canonicalSourceIds(managerReconnectRawEvents);
    const expectedManagerReconnectSourceIds = expectedManagerTimelineIds.slice(-50);
    if (
      expectedManagerReconnectSourceIds.length !== 50 ||
      new Set(expectedManagerReconnectSourceIds).size !== expectedManagerReconnectSourceIds.length ||
      !expectedManagerReconnectSourceIds.includes(managerMissedActivityPayload.sourceEventId)
    ) {
      throw new Error(
        `MANAGER_RECONNECT_EXPECTATION_INVALID ids=${JSON.stringify(expectedManagerReconnectSourceIds)}`,
      );
    }
    if (managerSourceIdsBeforeDisconnect.includes(managerMissedActivityPayload.sourceEventId)) {
      throw new Error(`MANAGER_MISSED_ACTIVITY_ALREADY_RENDERED id=${managerMissedActivityPayload.sourceEventId}`);
    }
    if (!managerSourceIdsBeforeDisconnect.some((sourceEventId) => !expectedManagerReconnectSourceIds.includes(sourceEventId))) {
      throw new Error(
        `MANAGER_STALE_HISTORY_REPLACEMENT_NOT_PROVEN before=${JSON.stringify(managerSourceIdsBeforeDisconnect)} expected=${JSON.stringify(expectedManagerReconnectSourceIds)}`,
      );
    }

    await ownerPage.waitForFunction(
      ({ previousOpenCount, expectedSourceId }) => {
        const transport = window.__activityTimelineSseTransport;
        return (
          (transport?.openCount ?? 0) > previousOpenCount &&
          (transport?.stateSyncs ?? []).some(
            (stateSync) =>
              stateSync.transportOpenCount > previousOpenCount &&
              Array.isArray(stateSync.payload?.candidateKeyHistory) &&
              stateSync.payload.candidateKeyHistory.some((event) => event?.sourceEventId === expectedSourceId),
          )
        );
      },
      {
        previousOpenCount: managerTransportBeforeDisconnect.openCount,
        expectedSourceId: managerMissedActivityPayload.sourceEventId,
      },
      { timeout: 15_000 },
    );

    const postReconnectManagerHistory = await ownerPage.evaluate((previousOpenCount) => {
      const stateSync = [...(window.__activityTimelineSseTransport?.stateSyncs ?? [])]
        .reverse()
        .find(
          (candidate) =>
            candidate.transportOpenCount > previousOpenCount && Array.isArray(candidate.payload?.candidateKeyHistory),
        );
      return stateSync?.payload?.candidateKeyHistory ?? null;
    }, managerTransportBeforeDisconnect.openCount);
    if (!postReconnectManagerHistory) {
      throw new Error("MANAGER_POST_RECONNECT_STATE_SYNC_MISSING");
    }
    const postReconnectManagerSourceIds = postReconnectManagerHistory.map((event) => event.sourceEventId);
    if (
      postReconnectManagerSourceIds.length !== 50 ||
      new Set(postReconnectManagerSourceIds).size !== postReconnectManagerSourceIds.length ||
      JSON.stringify(postReconnectManagerSourceIds) !== JSON.stringify(expectedManagerReconnectSourceIds)
    ) {
      throw new Error(
        `MANAGER_POST_RECONNECT_STATE_HISTORY_MISMATCH expected=${JSON.stringify(expectedManagerReconnectSourceIds)} actual=${JSON.stringify(postReconnectManagerSourceIds)}`,
      );
    }

    await ownerPage.waitForFunction(
      (expectedSourceIds) => {
        const rendered = [...document.querySelectorAll('[data-testid="activity-timeline-source-id"]')].map(
          (element) => element.textContent ?? "",
        );
        return (
          rendered.length === expectedSourceIds.length &&
          new Set(rendered).size === rendered.length &&
          rendered.every((sourceEventId) => expectedSourceIds.includes(sourceEventId))
        );
      },
      expectedManagerTimelineIds,
      { timeout: 15_000 },
    );
    const renderedManagerSourceIdsAfterReconnect = await ownerPage
      .locator('[data-testid="activity-timeline-source-id"]')
      .allTextContents();
    const rawEventsBySourceId = new Map(managerReconnectRawEvents.map((event) => [event.sourceEventId, event]));
    const renderedManagerEventsAfterReconnect = renderedManagerSourceIdsAfterReconnect.map((sourceEventId) =>
      rawEventsBySourceId.get(sourceEventId),
    );
    if (
      renderedManagerEventsAfterReconnect.some((event) => !event) ||
      JSON.stringify(canonicalSourceIds(renderedManagerEventsAfterReconnect)) !==
        JSON.stringify(expectedManagerTimelineIds)
    ) {
      throw new Error(
        `MANAGER_POST_RECONNECT_TIMELINE_MISMATCH expected=${JSON.stringify(expectedManagerTimelineIds)} actual=${JSON.stringify(renderedManagerSourceIdsAfterReconnect)}`,
      );
    }

    await candidatePage.reload({ waitUntil: "domcontentloaded" });
    await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15_000 });
    await candidatePage.waitForFunction(
      () => {
        const transport = window.__candidateActivitySseTransport;
        return (
          (transport?.createdCount ?? 0) >= 1 &&
          (transport?.openCount ?? 0) >= 1 &&
          (transport?.messages ?? []).some((captured) => {
            try {
              const message = JSON.parse(captured.data);
              return message?.type === "state_sync" && typeof message.payload?.eventToken === "string" && message.payload.eventToken.trim();
            } catch {
              return false;
            }
          })
        );
      },
      { timeout: 15_000 },
    );
    const candidateReconnectTransport = await candidatePage.evaluate(() => window.__candidateActivitySseTransport ?? null);
    if (
      !candidateReconnectTransport ||
      candidateReconnectTransport.createdCount < 1 ||
      candidateReconnectTransport.openCount < 1 ||
      !Array.isArray(candidateReconnectTransport.messages) ||
      candidateReconnectTransport.messages.length === 0
    ) {
      throw new Error(`CANDIDATE_EVENTSOURCE_RECONNECT_NOT_OBSERVED state=${JSON.stringify(candidateReconnectTransport)}`);
    }

    const candidateReconnectMessages = candidateReconnectTransport.messages.map((captured, index) => {
      try {
        return JSON.parse(captured.data);
      } catch (error) {
        throw new Error(
          `CANDIDATE_RECONNECT_PAYLOAD_PARSE_FAILED index=${index} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    const candidateCurrentStateSync = [...candidateReconnectMessages]
      .reverse()
      .find((message) => message?.type === "state_sync" && message?.payload);
    const candidateEventToken = candidateCurrentStateSync?.payload?.eventToken?.trim();
    if (!candidateEventToken) {
      throw new Error("CANDIDATE_RECONNECT_EVENT_TOKEN_MISSING");
    }
    const candidateSensitivePaths = candidateReconnectMessages.flatMap((message) => findCandidateHiddenActivityFields(message));
    if (candidateSensitivePaths.length > 0) {
      throw new Error(`CANDIDATE_RECONNECT_ACTIVITY_FIELDS_LEAKED paths=${JSON.stringify(candidateSensitivePaths)}`);
    }

    const candidateRawExport = await candidatePage.evaluate(
      async ({ apiBaseUrl, inviteCode, eventToken }) => {
        const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}/keystroke-events?format=json`, {
          headers: { "X-Room-Event-Token": eventToken },
        });
        return { status: response.status, body: await response.text() };
      },
      { apiBaseUrl, inviteCode: room.inviteCode, eventToken: candidateEventToken },
    );
    if (candidateRawExport.status !== 403) {
      throw new Error(`CANDIDATE_VALID_TOKEN_RAW_EXPORT_STATUS ${candidateRawExport.status}`);
    }

    // 7.3a: the initial candidate state-sync check above proves only that a
    // reconnect payload is private. Keep the same live EventSource observed,
    // accept one new candidate action, and use a manager Yjs edit as a causal
    // liveness fence. This makes an absence assertion on the incremental lane
    // meaningful instead of passing merely because the candidate stream is idle.
    const candidatePostReconnectCapture = await candidatePage.evaluate(() => {
      const transport = window.__candidateActivitySseTransport;
      const expectedOpenCount = transport?.openCount ?? 0;
      const messages = transport?.messages ?? [];
      let stateSyncIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const captured = messages[index];
        if (captured?.transportOpenCount !== expectedOpenCount) continue;
        try {
          const message = JSON.parse(captured.data);
          if (message?.type === "state_sync" && typeof message.payload?.eventToken === "string" && message.payload.eventToken.trim()) {
            stateSyncIndex = index;
            break;
          }
        } catch {
          // The assertion below reports a distinct parse failure for the full
          // bounded window. Do not let an unreadable payload become liveness.
        }
      }
      return { expectedOpenCount, stateSyncIndex, messageCount: messages.length };
    });
    if (
      candidatePostReconnectCapture.expectedOpenCount < 1 ||
      candidatePostReconnectCapture.stateSyncIndex < 0
    ) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_CAPTURE_FENCE_MISSING state=${JSON.stringify(candidatePostReconnectCapture)}`,
      );
    }

    const activityPostsBeforeCandidateLiveness = activityPosts.length;
    await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-content').click({ force: true });
    // Arrow movement is a real candidate key action but does not mutate the Yjs
    // document, so every Yjs update after the marker boundary is manager-originated.
    await candidatePage.keyboard.press("ArrowLeft");
    await waitForCondition(
      `CANDIDATE_POST_RECONNECT_ACTIVITY_NOT_OBSERVED before=${activityPostsBeforeCandidateLiveness} actual=${activityPosts.length}`,
      () => activityPosts.length > activityPostsBeforeCandidateLiveness,
    );
    const candidatePostReconnectActivity = activityPosts
      .slice(activityPostsBeforeCandidateLiveness)
      .find((payload) => payload.key === "ArrowLeft" && payload.sourceEventId);
    if (!candidatePostReconnectActivity?.sourceEventId) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_ACTIVITY_SOURCE_ID_MISSING payloads=${JSON.stringify(activityPosts.slice(activityPostsBeforeCandidateLiveness))}`,
      );
    }
    const candidatePostReconnectRawEvents = await waitForRawEventsContainingSourceIds(
      room.inviteCode,
      room.ownerToken,
      [candidatePostReconnectActivity.sourceEventId],
    );
    if (!candidatePostReconnectRawEvents.some((event) => event.sourceEventId === candidatePostReconnectActivity.sourceEventId)) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_ACTIVITY_NOT_ACCEPTED sourceEventId=${candidatePostReconnectActivity.sourceEventId}`,
      );
    }

    const candidateLivenessMarkerStart = await candidatePage.evaluate((expectedOpenCount) => {
      const transport = window.__candidateActivitySseTransport;
      if ((transport?.openCount ?? 0) !== expectedOpenCount) return null;
      return { messageIndex: transport?.messages?.length ?? 0, openCount: transport?.openCount ?? 0 };
    }, candidatePostReconnectCapture.expectedOpenCount);
    if (!candidateLivenessMarkerStart) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_CONNECTION_CHANGED_BEFORE_LIVENESS expectedOpenCount=${candidatePostReconnectCapture.expectedOpenCount}`,
      );
    }

    const candidateLivenessMarker = `candidate-sse-liveness-${Date.now()}`;
    await ownerPage.locator('[data-testid="room-code-editor-host"] .cm-content').click({ force: true });
    await ownerPage.keyboard.press("End");
    await ownerPage.keyboard.type(`\n${candidateLivenessMarker}`, { delay: 4 });
    const candidateLivenessWaitArguments = {
      expectedOpenCount: candidatePostReconnectCapture.expectedOpenCount,
      markerStartIndex: candidateLivenessMarkerStart.messageIndex,
      marker: candidateLivenessMarker,
    };
    try {
      await candidatePage.waitForFunction(
        ({ expectedOpenCount, markerStartIndex, marker }) => {
          const transport = window.__candidateActivitySseTransport;
          if ((transport?.openCount ?? 0) !== expectedOpenCount) return false;
          const markerReached =
            document.querySelector('[data-testid="room-code-editor-host"] .cm-content')?.textContent?.includes(marker) ?? false;
          const observedYjsAfterMarker = (transport?.messages ?? []).slice(markerStartIndex).some((captured) => {
            if (captured?.transportOpenCount !== expectedOpenCount) return false;
            try {
              return JSON.parse(captured.data)?.type === "yjs_update";
            } catch {
              return false;
            }
          });
          return markerReached && observedYjsAfterMarker;
        },
        candidateLivenessWaitArguments,
        { timeout: 15_000 },
      );
    } catch {
      // A generic Playwright timeout would hide the cause of a failed absence
      // assertion. Re-read the actual candidate transport and report the one
      // condition that made the causal liveness fence incomplete.
      const candidateLivenessFailure = await candidatePage.evaluate(
        ({ expectedOpenCount, markerStartIndex, marker }) => {
          const transport = window.__candidateActivitySseTransport;
          const actualOpenCount = transport?.openCount ?? 0;
          const markerReached =
            document.querySelector('[data-testid="room-code-editor-host"] .cm-content')?.textContent?.includes(marker) ?? false;
          let malformedMessageIndex = -1;
          let observedYjsAfterMarker = false;
          for (const [offset, captured] of (transport?.messages ?? []).slice(markerStartIndex).entries()) {
            if (captured?.transportOpenCount !== expectedOpenCount) continue;
            try {
              observedYjsAfterMarker ||= JSON.parse(captured.data)?.type === "yjs_update";
            } catch {
              malformedMessageIndex = markerStartIndex + offset;
              break;
            }
          }
          return { actualOpenCount, markerReached, malformedMessageIndex, observedYjsAfterMarker };
        },
        candidateLivenessWaitArguments,
      );
      if (candidateLivenessFailure.actualOpenCount !== candidateLivenessWaitArguments.expectedOpenCount) {
        throw new Error(
          `CANDIDATE_POST_RECONNECT_CONNECTION_CHANGED_DURING_LIVENESS expected=${candidateLivenessWaitArguments.expectedOpenCount} actual=${candidateLivenessFailure.actualOpenCount}`,
        );
      }
      if (candidateLivenessFailure.malformedMessageIndex >= 0) {
        throw new Error(
          `CANDIDATE_POST_RECONNECT_LIVENESS_PAYLOAD_PARSE_FAILED index=${candidateLivenessFailure.malformedMessageIndex}`,
        );
      }
      if (!candidateLivenessFailure.markerReached) {
        throw new Error("CANDIDATE_POST_RECONNECT_LIVENESS_MARKER_NOT_RENDERED");
      }
      if (!candidateLivenessFailure.observedYjsAfterMarker) {
        throw new Error("CANDIDATE_POST_RECONNECT_LIVENESS_YJS_UPDATE_MISSING");
      }
      throw new Error("CANDIDATE_POST_RECONNECT_LIVENESS_WAIT_UNCLASSIFIED");
    }

    const candidatePostReconnectWindow = await candidatePage.evaluate(
      ({ expectedOpenCount, stateSyncIndex, markerStartIndex }) => {
        const transport = window.__candidateActivitySseTransport;
        if ((transport?.openCount ?? 0) !== expectedOpenCount) {
          return { connectionChanged: true, captures: [], livenessIndex: -1 };
        }
        const messages = transport?.messages ?? [];
        let livenessIndex = -1;
        for (let index = markerStartIndex; index < messages.length; index += 1) {
          const captured = messages[index];
          if (captured?.transportOpenCount !== expectedOpenCount) continue;
          try {
            if (JSON.parse(captured.data)?.type === "yjs_update") {
              livenessIndex = index;
              break;
            }
          } catch {
            // The full bounded window is parsed outside the browser context so
            // failures have a direct diagnostic.
          }
        }
        return {
          connectionChanged: false,
          captures: livenessIndex >= 0 ? messages.slice(stateSyncIndex, livenessIndex + 1) : [],
          livenessIndex,
        };
      },
      {
        expectedOpenCount: candidatePostReconnectCapture.expectedOpenCount,
        stateSyncIndex: candidatePostReconnectCapture.stateSyncIndex,
        markerStartIndex: candidateLivenessMarkerStart.messageIndex,
      },
    );
    if (candidatePostReconnectWindow.connectionChanged) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_CONNECTION_CHANGED_DURING_LIVENESS expectedOpenCount=${candidatePostReconnectCapture.expectedOpenCount}`,
      );
    }
    if (candidatePostReconnectWindow.livenessIndex < candidateLivenessMarkerStart.messageIndex) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_LIVENESS_MARKER_MISSING start=${candidateLivenessMarkerStart.messageIndex}`,
      );
    }
    const candidatePostReconnectMessages = candidatePostReconnectWindow.captures.map((captured, index) => {
      try {
        return JSON.parse(captured.data);
      } catch (error) {
        throw new Error(
          `CANDIDATE_POST_RECONNECT_LIVENESS_PAYLOAD_PARSE_FAILED index=${index} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    if (candidatePostReconnectMessages.some((message) => message?.type === "candidate_key")) {
      throw new Error("CANDIDATE_POST_RECONNECT_INCREMENTAL_ACTIVITY_LEAKED");
    }
    const candidatePostReconnectSensitivePaths = candidatePostReconnectMessages.flatMap((message) =>
      findCandidateHiddenActivityFields(message),
    );
    if (candidatePostReconnectSensitivePaths.length > 0) {
      throw new Error(
        `CANDIDATE_POST_RECONNECT_LIVENESS_FIELDS_LEAKED paths=${JSON.stringify(candidatePostReconnectSensitivePaths)}`,
      );
    }
  } catch (error) {
    fail(failures, "manager EventSource reconnect preserves activity history and candidate reconnect stays private", error);
  }

  // 7.4: keep the first activity request unresolved while the browser produces a
  // burst. A correct activity FIFO leaves the remaining source actions queued,
  // then retries the unchanged head after the synthetic server failure.
  try {
    const fifoBurstKeys = ["f", "i", "f", "o"];
    fifoBurstCaptureEnabled = true;
    await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-content').click({ force: true });
    await candidatePage.keyboard.press(fifoBurstKeys[0]);
    await waitForCondition(
      `FIFO_FIRST_ACTIVITY_POST_NOT_OBSERVED records=${JSON.stringify(fifoBurstRouteRecords)}`,
      () => fifoBurstRouteRecords.length === 1,
    );

    await candidatePage.keyboard.type(fifoBurstKeys.slice(1).join(""));
    await candidatePage.waitForTimeout(250);
    if (fifoBurstRouteRecords.length !== 1) {
      throw new Error(`FIFO_BURST_CONCURRENT_POSTS records=${JSON.stringify(fifoBurstRouteRecords)}`);
    }
    if (fifoBurstMaxActivityRequestsInFlight !== 1) {
      throw new Error(
        `FIFO_MAX_IN_FLIGHT_BEFORE_SYNTHETIC_5XX expected=1 actual=${fifoBurstMaxActivityRequestsInFlight}`,
      );
    }
    if (!fifoBurstFirstAttemptSourceId) {
      throw new Error(`FIFO_HEAD_SOURCE_ID_MISSING records=${JSON.stringify(fifoBurstRouteRecords)}`);
    }
    if (
      fifoBurstRouteRecords[0]?.sourceEventId !== fifoBurstFirstAttemptSourceId ||
      fifoBurstRouteRecords[0]?.handling !== "synthetic-503" ||
      fifoBurstForwardedSourceIds.length !== 0
    ) {
      throw new Error(
        `FIFO_FIRST_5XX_FORWARDING_GUARD_FAILED first=${JSON.stringify(fifoBurstRouteRecords[0])} forwarded=${JSON.stringify(fifoBurstForwardedSourceIds)}`,
      );
    }

    releaseFifoBurstSynthetic5xx?.();
    await waitForCondition(
      `FIFO_HEAD_RETRY_NOT_OBSERVED records=${JSON.stringify(fifoBurstRouteRecords)}`,
      () => fifoBurstRouteRecords.length >= 2,
    );
    if (
      fifoBurstRouteRecords.length !== 2 ||
      fifoBurstRouteRecords[1]?.sourceEventId !== fifoBurstFirstAttemptSourceId ||
      fifoBurstMaxActivityRequestsInFlight !== 1
    ) {
      throw new Error(
        `FIFO_RETRY_OR_CONCURRENCY_INVALID records=${JSON.stringify(fifoBurstRouteRecords)} maxInFlight=${fifoBurstMaxActivityRequestsInFlight}`,
      );
    }

    const rawEventsBeforeFifoRecovery = await fetchRawEvents(room.inviteCode, room.ownerToken);
    if (rawEventsBeforeFifoRecovery.some((event) => event.sourceEventId === fifoBurstFirstAttemptSourceId)) {
      throw new Error(
        `FIFO_SYNTHETIC_5XX_REACHED_SERVER sourceEventId=${fifoBurstFirstAttemptSourceId} export=${JSON.stringify(rawEventsBeforeFifoRecovery)}`,
      );
    }

    releaseFifoBurstRecovery?.();
    const expectedFifoBurstAttemptCount = fifoBurstKeys.length + 1;
    await waitForCondition(
      `FIFO_RECOVERY_POSTS_NOT_OBSERVED expected=${expectedFifoBurstAttemptCount} actual=${fifoBurstRouteRecords.length}`,
      () => fifoBurstRouteRecords.length >= expectedFifoBurstAttemptCount,
    );
    await candidatePage.waitForTimeout(250);

    const fifoBurstAttemptSourceIds = fifoBurstRouteRecords.map((record) => record.sourceEventId);
    if (fifoBurstAttemptSourceIds.some((sourceEventId) => typeof sourceEventId !== "string" || !sourceEventId.trim())) {
      throw new Error(`FIFO_SOURCE_ID_MISSING records=${JSON.stringify(fifoBurstRouteRecords)}`);
    }
    const fifoBurstSourceIds = [...new Set(fifoBurstAttemptSourceIds)];
    const fifoBurstKeysInSourceOrder = [];
    const seenFifoBurstSourceIds = new Set();
    for (const record of fifoBurstRouteRecords) {
      if (!seenFifoBurstSourceIds.has(record.sourceEventId)) {
        seenFifoBurstSourceIds.add(record.sourceEventId);
        fifoBurstKeysInSourceOrder.push(record.key);
      }
    }
    const expectedFifoBurstAttemptSourceIds = [fifoBurstFirstAttemptSourceId, ...fifoBurstSourceIds];
    if (
      fifoBurstRouteRecords.length !== expectedFifoBurstAttemptCount ||
      fifoBurstSourceIds.length !== fifoBurstKeys.length ||
      JSON.stringify(fifoBurstKeysInSourceOrder) !== JSON.stringify(fifoBurstKeys) ||
      JSON.stringify(fifoBurstAttemptSourceIds) !== JSON.stringify(expectedFifoBurstAttemptSourceIds) ||
      JSON.stringify(fifoBurstForwardedSourceIds) !== JSON.stringify(fifoBurstSourceIds) ||
      fifoBurstMaxActivityRequestsInFlight !== 1
    ) {
      throw new Error(
        `FIFO_ORDER_OR_CONCURRENCY_INVALID attempts=${JSON.stringify(fifoBurstAttemptSourceIds)} forwarded=${JSON.stringify(fifoBurstForwardedSourceIds)} sourceKeys=${JSON.stringify(fifoBurstKeysInSourceOrder)} maxInFlight=${fifoBurstMaxActivityRequestsInFlight}`,
      );
    }

    const rawEventsAfterFifoRecovery = await waitForRawEventsContainingSourceIds(
      room.inviteCode,
      room.ownerToken,
      fifoBurstSourceIds,
    );
    const fifoBurstRawEvents = rawEventsAfterFifoRecovery.filter((event) => fifoBurstSourceIds.includes(event.sourceEventId));
    assertExactlyOneRawRecordPerSource(rawEventsAfterFifoRecovery, fifoBurstRouteRecords);
    if (
      fifoBurstRawEvents.length !== fifoBurstSourceIds.length ||
      JSON.stringify(canonicalSourceIds(fifoBurstRawEvents)) !== JSON.stringify(fifoBurstSourceIds)
    ) {
      throw new Error(
        `FIFO_RAW_EXPORT_ORDER_OR_COUNT_INVALID expected=${JSON.stringify(fifoBurstSourceIds)} actual=${JSON.stringify(canonicalSourceIds(fifoBurstRawEvents))}`,
      );
    }
  } catch (error) {
    fail(failures, "activity FIFO synthetic-5xx burst recovery", error);
  } finally {
    fifoBurstCaptureEnabled = false;
    releaseFifoBurstSynthetic5xx?.();
    releaseFifoBurstRecovery?.();
  }

  // 7.5: The ordinary activity relay is server-authoritative for 403. The
  // first routed 403 permits exactly one recovery of the same queued source ID;
  // the next routed 403 is terminal and stops all later activity transmission.
  // Both responses are local so rejected actions can never become raw records.
  try {
    await candidatePage.locator('[data-testid="room-code-editor-host"] .cm-content').click({ force: true });
    authorization403ScenarioEnabled = true;
    await candidatePage.keyboard.press("u");
    await waitForCondition(
      `ACTIVITY_403_RECOVERY_COUNT expected=2 actual=${authorization403RouteRecords.length}`,
      () => authorization403RouteRecords.length >= 2,
    );

    if (authorization403RouteRecords.length !== 2) {
      throw new Error(
        `ACTIVITY_403_RECOVERY_COUNT expected=2 actual=${authorization403RouteRecords.length} records=${JSON.stringify(authorization403RouteRecords)}`,
      );
    }
    const rejectedSourceId = authorization403RouteRecords[0]?.sourceEventId;
    if (
      typeof rejectedSourceId !== "string" ||
      !rejectedSourceId.trim() ||
      authorization403RouteRecords[1]?.sourceEventId !== rejectedSourceId
    ) {
      throw new Error(`ACTIVITY_403_RETRY_ID_CHANGED ${JSON.stringify(authorization403RouteRecords)}`);
    }
    if (!authorization403TerminalResponseIssued) {
      throw new Error(`ACTIVITY_403_TERMINAL_RESPONSE_NOT_ISSUED ${JSON.stringify(authorization403RouteRecords)}`);
    }

    await candidatePage.getByTestId("room-realtime-access-error").waitFor({ timeout: 15_000 });

    const rawEventsAfterTerminal403 = await fetchRawEvents(room.inviteCode, room.ownerToken);
    if (rawEventsAfterTerminal403.some((event) => event.sourceEventId === rejectedSourceId)) {
      throw new Error(
        `ACTIVITY_403_REJECTED_RAW_RECORD sourceEventId=${rejectedSourceId} export=${JSON.stringify(rawEventsAfterTerminal403)}`,
      );
    }

    const activityPostCountAtTerminal = activityPosts.length;
    await candidatePage.keyboard.press("w");
    await candidatePage.waitForTimeout(700);
    if (
      authorization403RouteRecords.length !== 2 ||
      authorization403PostTerminalPosts.length !== 0 ||
      activityPosts.length !== activityPostCountAtTerminal
    ) {
      throw new Error(
        `ACTIVITY_403_POST_TERMINAL_POST records=${JSON.stringify(authorization403RouteRecords)} postTerminal=${JSON.stringify(authorization403PostTerminalPosts)} totalBefore=${activityPostCountAtTerminal} totalAfter=${activityPosts.length}`,
      );
    }
  } catch (error) {
    fail(failures, "activity authorization 403 recovery is bounded and terminal", error);
  } finally {
    authorization403ScenarioEnabled = false;
  }

  // 7.8 / 7.9: use a fresh authenticated room so the asserted authorization
  // identities cannot inherit the guest owner's credentials from the earlier
  // activity scenarios. Every positive activity signal below goes through the
  // actual browser relay and real SSE, rather than a synthetic state payload.
  let authorizationOwnerContext = null;
  let authorizationInterviewerContext = null;
  let authorizationGuestContext = null;
  try {
    const fixture = await createNonOwnerAuthorizationFixture();
    authorizationOwnerContext = await browser.newContext();
    authorizationInterviewerContext = await browser.newContext();
    authorizationGuestContext = await browser.newContext();
    await authorizationGuestContext.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: webBaseUrl,
    });
    await Promise.all([
      installRoleCoverageSseCapture(authorizationOwnerContext),
      installRoleCoverageSseCapture(authorizationInterviewerContext),
      installRoleCoverageSseCapture(authorizationGuestContext),
    ]);

    const authorizationOwnerPage = await authorizationOwnerContext.newPage();
    const authorizationInterviewerPage = await authorizationInterviewerContext.newPage();
    const authorizationGuestPage = await authorizationGuestContext.newPage();
    await bootstrapAuthenticatedRoomPage(authorizationOwnerPage, fixture.owner, fixture.room.inviteCode);
    await bootstrapAuthenticatedRoomPage(authorizationInterviewerPage, fixture.interviewer, fixture.room.inviteCode);
    await authorizationGuestPage.goto(`${webBaseUrl}/room/${fixture.room.inviteCode}`, {
      waitUntil: "domcontentloaded",
    });
    await enterCandidate(authorizationGuestPage, "Activity export guest");

    const guestActivityPosts = [];
    await authorizationGuestPage.route("**/api/realtime/rooms/*/events", async (route) => {
      const payload = route.request().postDataJSON();
      if (payload?.type === "key_press") {
        guestActivityPosts.push(payload);
      }
      await route.continue();
    });

    const guestEditor = authorizationGuestPage.locator('[data-testid="room-code-editor-host"] .cm-content');
    await guestEditor.click({ force: true });
    await authorizationGuestPage.keyboard.press("g");
    await waitForCondition(
      "NON_OWNER_FIRST_ACTIVITY_NOT_OBSERVED",
      () => guestActivityPosts.some((payload) => payload?.key === "g" && payload?.sourceEventId),
    );
    const firstTrackedSourceId = guestActivityPosts.find(
      (payload) => payload?.key === "g" && typeof payload.sourceEventId === "string" && payload.sourceEventId,
    )?.sourceEventId;
    if (!firstTrackedSourceId) {
      throw new Error("NON_OWNER_FIRST_ACTIVITY_SOURCE_ID_MISSING");
    }

    // The initial incremental delivery establishes that the first browser action
    // was server-accepted before the interviewer reload requests an authoritative
    // post-acceptance state_sync containing it in retained manager history.
    await authorizationInterviewerPage.waitForFunction(
      (sourceEventId) =>
        (window.__roleCoverageSse?.messages ?? []).some(
          (message) => message?.type === "candidate_key" && message.payload?.sourceEventId === sourceEventId,
        ),
      firstTrackedSourceId,
      { timeout: rawExportTimeoutMs },
    );
    await authorizationInterviewerPage.reload({ waitUntil: "domcontentloaded" });
    await authorizationInterviewerPage
      .locator('[data-testid="room-code-editor-host"] .cm-editor')
      .waitFor({ timeout: 15_000 });
    await waitForRoleCoverageStateSync(
      authorizationInterviewerPage,
      {
        role: "interviewer",
        isOwner: false,
        canManageRoom: true,
        sourceEventId: firstTrackedSourceId,
        // A browser reload replaces the page realm, so the test-owned in-page
        // EventSource capture starts from one again. The source ID in the new
        // state_sync proves this is the real post-acceptance connection.
        minOpenCount: 1,
      },
      "NON_OWNER_INTERVIEWER_POST_ACCEPTANCE_STATE_SYNC_MISSING",
    );
    const interviewerStateSummary = await authorizationInterviewerPage.evaluate(() => {
      const states = (window.__roleCoverageSse?.messages ?? [])
        .filter((message) => message?.type === "state_sync")
        .map((message) => message.payload)
        .filter(Boolean);
      const state = states.at(-1);
      return {
        role: state?.role ?? null,
        isOwner: state?.isOwner ?? null,
        canManageRoom: state?.canManageRoom ?? null,
        hasEventToken: typeof state?.eventToken === "string" && state.eventToken.trim().length > 0,
      };
    });
    if (
      interviewerStateSummary.role !== "interviewer" ||
      interviewerStateSummary.isOwner !== false ||
      interviewerStateSummary.canManageRoom !== true ||
      !interviewerStateSummary.hasEventToken
    ) {
      throw new Error(`NON_OWNER_INTERVIEWER_STATE_INVALID ${JSON.stringify(interviewerStateSummary)}`);
    }
    const interviewerStoredCredentials = await authorizationInterviewerPage.evaluate((inviteCode) => ({
      hasOwnerToken: Boolean(localStorage.getItem(`owner_token_${inviteCode}`)),
    }), fixture.room.inviteCode);
    if (interviewerStoredCredentials.hasOwnerToken) {
      throw new Error("NON_OWNER_INTERVIEWER_CONTEXT_HAS_OWNER_TOKEN");
    }

    await authorizationGuestPage.keyboard.press("h");
    await waitForCondition(
      "NON_OWNER_LATER_ACTIVITY_NOT_OBSERVED",
      () => guestActivityPosts.some((payload) => payload?.key === "h" && payload?.sourceEventId),
    );
    const laterTrackedSourceId = guestActivityPosts.find(
      (payload) => payload?.key === "h" && typeof payload.sourceEventId === "string" && payload.sourceEventId,
    )?.sourceEventId;
    if (!laterTrackedSourceId) throw new Error("NON_OWNER_LATER_ACTIVITY_SOURCE_ID_MISSING");
    await authorizationInterviewerPage.waitForFunction(
      (sourceEventId) =>
        (window.__roleCoverageSse?.messages ?? []).some(
          (message) => message?.type === "candidate_key" && message.payload?.sourceEventId === sourceEventId,
        ),
      laterTrackedSourceId,
      { timeout: rawExportTimeoutMs },
    );
    await authorizationGuestPage.waitForTimeout(180);

    await authorizationGuestPage.keyboard.press("Space");
    await waitForCondition(
      "NON_OWNER_PHYSICAL_SPACE_NOT_OBSERVED",
      () =>
        guestActivityPosts.some(
          (payload) => payload?.key === " " && payload?.keyCode === "Space" && payload?.sourceEventId,
        ),
    );
    const spaceTrackedSourceId = guestActivityPosts.find(
      (payload) => payload?.key === " " && payload?.keyCode === "Space" && typeof payload.sourceEventId === "string",
    )?.sourceEventId;
    if (!spaceTrackedSourceId) throw new Error("NON_OWNER_PHYSICAL_SPACE_SOURCE_ID_MISSING");
    await authorizationGuestPage.waitForTimeout(180);

    const csvPasteText = "paste-export-coverage";
    await guestEditor.click({ force: true });
    await authorizationGuestPage.evaluate((text) => navigator.clipboard.writeText(text), csvPasteText);
    await authorizationGuestPage.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    await waitForCondition(
      "NON_OWNER_PASTE_NOT_OBSERVED",
      () =>
        guestActivityPosts.some(
          (payload) => payload?.eventKind === "paste" && payload?.pasteLength === csvPasteText.length && payload?.sourceEventId,
        ),
    );
    const pasteTrackedSourceId = guestActivityPosts.find(
      (payload) =>
        payload?.eventKind === "paste" &&
        payload?.pasteLength === csvPasteText.length &&
        typeof payload.sourceEventId === "string",
    )?.sourceEventId;
    if (!pasteTrackedSourceId) throw new Error("NON_OWNER_PASTE_SOURCE_ID_MISSING");
    const trackedSourceIds = [firstTrackedSourceId, laterTrackedSourceId, spaceTrackedSourceId, pasteTrackedSourceId];
    if (new Set(trackedSourceIds).size !== trackedSourceIds.length) {
      throw new Error("NON_OWNER_TRACKED_SOURCE_IDS_NOT_UNIQUE");
    }

    await openActivityTimeline(authorizationInterviewerPage);
    await authorizationInterviewerPage.waitForFunction(
      (sourceEventIds) => {
        const rendered = [...document.querySelectorAll('[data-testid="activity-timeline-source-id"]')].map(
          (node) => node.textContent,
        );
        return sourceEventIds.every((sourceEventId) => rendered.filter((id) => id === sourceEventId).length === 1);
      },
      trackedSourceIds,
      { timeout: rawExportTimeoutMs },
    );

    const interviewerJsonExport = await authorizationInterviewerPage.evaluate(async ({ inviteCode, token, sourceEventIds }) => {
      const response = await fetch(`/api/rooms/${inviteCode}/keystroke-events?format=json`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const events = await response.json().catch(() => null);
      return {
        status: response.status,
        events: Array.isArray(events) ? events : null,
        trackedSourceIds: Array.isArray(events)
          ? sourceEventIds.filter((sourceEventId) => events.filter((event) => event?.sourceEventId === sourceEventId).length === 1)
          : [],
      };
    }, { inviteCode: fixture.room.inviteCode, token: fixture.interviewer.token, sourceEventIds: trackedSourceIds });
    if (
      interviewerJsonExport.status !== 200 ||
      !Array.isArray(interviewerJsonExport.events) ||
      JSON.stringify(interviewerJsonExport.trackedSourceIds) !== JSON.stringify(trackedSourceIds)
    ) {
      throw new Error(
        `NON_OWNER_BEARER_JSON_EXPORT_INVALID status=${interviewerJsonExport.status} tracked=${JSON.stringify(interviewerJsonExport.trackedSourceIds)}`,
      );
    }

    // Promote and then revoke the connected guest using the actual realtime room
    // event endpoint. The owner credential is confined to these prerequisite role
    // mutations; no export assertion receives it.
    const guestRealtimeIdentity = await authorizationGuestPage.evaluate((inviteCode) => ({
      sessionId: sessionStorage.getItem(`room_ws_session_id_${inviteCode}`),
      openCount: window.__roleCoverageSse?.openCount ?? 0,
    }), fixture.room.inviteCode);
    if (!guestRealtimeIdentity.sessionId) throw new Error("PROMOTED_GUEST_SESSION_ID_MISSING");
    const sendOwnerRealtimeRoleChange = async (type) =>
      authorizationOwnerPage.evaluate(async ({ inviteCode, targetSessionId, type }) => {
        const state = [...(window.__roleCoverageSse?.messages ?? [])]
          .reverse()
          .find((message) => message?.type === "state_sync")?.payload;
        const sessionId = sessionStorage.getItem(`room_ws_session_id_${inviteCode}`);
        if (!sessionId || typeof state?.eventToken !== "string" || !state.eventToken.trim()) {
          return { status: null, ready: false };
        }
        const response = await fetch(`/api/realtime/rooms/${inviteCode}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            eventToken: state.eventToken,
            type,
            targetSessionId,
          }),
        });
        return { status: response.status, ready: true };
      }, { inviteCode: fixture.room.inviteCode, targetSessionId: guestRealtimeIdentity.sessionId, type });

    const grantGuestResult = await sendOwnerRealtimeRoleChange("grant_interviewer_access");
    if (!grantGuestResult.ready || typeof grantGuestResult.status !== "number" || grantGuestResult.status < 200 || grantGuestResult.status >= 300) {
      throw new Error(`PROMOTE_GUEST_REALTIME_FAILED status=${grantGuestResult.status}`);
    }
    await waitForRoleCoverageStateSync(
      authorizationGuestPage,
      { role: "interviewer", canManageRoom: true, minOpenCount: guestRealtimeIdentity.openCount },
      "PROMOTED_GUEST_MANAGER_STATE_SYNC_MISSING",
    );
    const guestStoredCredentials = await authorizationGuestPage.evaluate((inviteCode) => ({
      hasAuthToken: Boolean(localStorage.getItem("auth_token")),
      hasOwnerToken: Boolean(localStorage.getItem(`owner_token_${inviteCode}`)),
    }), fixture.room.inviteCode);
    if (guestStoredCredentials.hasAuthToken || guestStoredCredentials.hasOwnerToken) {
      throw new Error("PROMOTED_GUEST_CONTEXT_HAS_STATIC_CREDENTIAL");
    }
    const promotedGuestJsonExport = await authorizationGuestPage.evaluate(async ({ inviteCode, sourceEventIds }) => {
      const state = [...(window.__roleCoverageSse?.messages ?? [])]
        .reverse()
        .find(
          (message) =>
            message?.type === "state_sync" &&
            message.payload?.role === "interviewer" &&
            message.payload?.canManageRoom === true,
        )?.payload;
      const eventToken = state?.eventToken;
      if (typeof eventToken !== "string" || !eventToken.trim()) {
        return { status: null, hasCurrentEventToken: false, trackedSourceIds: [] };
      }
      const response = await fetch(`/api/rooms/${inviteCode}/keystroke-events?format=json`, {
        headers: { "X-Room-Event-Token": eventToken },
      });
      const events = await response.json().catch(() => null);
      return {
        status: response.status,
        hasCurrentEventToken: true,
        trackedSourceIds: Array.isArray(events)
          ? sourceEventIds.filter((sourceEventId) => events.filter((event) => event?.sourceEventId === sourceEventId).length === 1)
          : [],
      };
    }, { inviteCode: fixture.room.inviteCode, sourceEventIds: trackedSourceIds });
    if (
      promotedGuestJsonExport.status !== 200 ||
      !promotedGuestJsonExport.hasCurrentEventToken ||
      JSON.stringify(promotedGuestJsonExport.trackedSourceIds) !== JSON.stringify(trackedSourceIds)
    ) {
      throw new Error(
        `PROMOTED_GUEST_TOKEN_ONLY_JSON_EXPORT_INVALID status=${promotedGuestJsonExport.status} tracked=${JSON.stringify(promotedGuestJsonExport.trackedSourceIds)}`,
      );
    }

    // 7.9 positive path is intentionally initiated only through the Timeline UI.
    const csvResponsePromise = authorizationInterviewerPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith(`/api/rooms/${fixture.room.inviteCode}/keystroke-events`) &&
        url.searchParams.get("format") === "csv"
      );
    });
    const csvDownloadPromise = authorizationInterviewerPage.waitForEvent("download");
    await authorizationInterviewerPage.getByRole("button", { name: "CSV", exact: true }).click();
    const [csvResponse, csvDownload] = await Promise.all([csvResponsePromise, csvDownloadPromise]);
    const csvDownloadText = await readDownloadText(csvDownload);
    const csvRequestHeaders = csvResponse.request().headers();
    if (
      csvResponse.status() !== 200 ||
      !csvResponse.headers()["content-type"]?.includes("text/csv") ||
      csvRequestHeaders["x-room-owner-token"] ||
      !csvRequestHeaders.authorization ||
      csvDownload.suggestedFilename() !== `keystrokes-${fixture.room.inviteCode}.csv`
    ) {
      const downloadFailure = await csvDownload.failure();
      throw new Error(
        `CSV_UI_DOWNLOAD_TRANSPORT_INVALID status=${csvResponse.status()} hasOwnerHeader=${Boolean(csvRequestHeaders["x-room-owner-token"])} filename=${csvDownload.suggestedFilename()} downloadLength=${csvDownloadText.length} downloadFailure=${downloadFailure ?? "none"}`,
      );
    }
    const csvRows = parseRfc4180Csv(csvDownloadText);
    const csvHeaders = csvRows.shift();
    if (!csvHeaders?.includes("source_event_id") || !csvHeaders.includes("accepted_sequence")) {
      throw new Error(`CSV_HEADERS_MISSING headers=${JSON.stringify(csvHeaders ?? [])}`);
    }
    const csvDataRows = csvRows.map((row) => {
      if (row.length !== csvHeaders.length) {
        throw new Error(`CSV_ROW_COLUMN_COUNT_INVALID expected=${csvHeaders.length} actual=${row.length}`);
      }
      return Object.fromEntries(csvHeaders.map((header, index) => [header, row[index]]));
    });
    const expectedJsonEvents = canonicalEvents(interviewerJsonExport.events);
    const csvSourceIds = csvDataRows.map((row) => row.source_event_id);
    const expectedSourceIds = expectedJsonEvents.map((event) => event.sourceEventId ?? "");
    if (
      csvDataRows.length !== expectedJsonEvents.length ||
      new Set(csvSourceIds).size !== csvSourceIds.length ||
      JSON.stringify(csvSourceIds) !== JSON.stringify(expectedSourceIds)
    ) {
      throw new Error(
        `CSV_RAW_ROW_SET_OR_ORDER_INVALID csvCount=${csvDataRows.length} jsonCount=${expectedJsonEvents.length}`,
      );
    }
    for (const event of expectedJsonEvents) {
      const row = csvDataRows.find((item) => item.source_event_id === event.sourceEventId);
      if (!row || row.accepted_sequence !== String(event.acceptedSequence ?? "")) {
        throw new Error(`CSV_ACCEPTED_SEQUENCE_MISMATCH sourceEventId=${event.sourceEventId ?? ""}`);
      }
    }
    for (const sourceEventId of trackedSourceIds) {
      if (csvSourceIds.filter((candidate) => candidate === sourceEventId).length !== 1) {
        throw new Error(`CSV_TRACKED_SOURCE_COUNT_INVALID sourceEventId=${sourceEventId}`);
      }
    }
    const csvSpaceRow = csvDataRows.find((row) => row.source_event_id === spaceTrackedSourceId);
    const csvPasteRow = csvDataRows.find((row) => row.source_event_id === pasteTrackedSourceId);
    if (
      csvSpaceRow?.key_value !== " " ||
      csvSpaceRow.key_code !== "Space" ||
      csvPasteRow?.paste_length !== String(csvPasteText.length)
    ) {
      throw new Error("CSV_SPACE_OR_PASTE_PRESERVATION_INVALID");
    }

    const guestTransportBeforeRevoke = await authorizationGuestPage.evaluate(() => ({
      openCount: window.__roleCoverageSse?.openCount ?? 0,
      errorCount: window.__roleCoverageSse?.errorCount ?? 0,
    }));
    const revokeGuestResult = await sendOwnerRealtimeRoleChange("revoke_interviewer_access");
    if (!revokeGuestResult.ready || typeof revokeGuestResult.status !== "number" || revokeGuestResult.status < 200 || revokeGuestResult.status >= 300) {
      throw new Error(`REVOKE_GUEST_REALTIME_FAILED status=${revokeGuestResult.status}`);
    }
    // A role-change state_sync can race in on the old connection. Establish the
    // boundary immediately before offline transport loss and require the later
    // state-sync to carry a new connection-cycle tag.
    const guestPostReconnectMessageStart = await authorizationGuestPage.evaluate(
      () => window.__roleCoverageSse?.messages?.length ?? 0,
    );
    await authorizationGuestContext.setOffline(true);
    try {
      await authorizationGuestPage.waitForFunction(
        (errorCount) => (window.__roleCoverageSse?.errorCount ?? 0) > errorCount,
        guestTransportBeforeRevoke.errorCount,
        { timeout: 15_000 },
      );
    } catch {
      throw new Error("REVOKED_GUEST_SSE_DISCONNECT_NOT_OBSERVED");
    }
    await authorizationGuestContext.setOffline(false);
    await waitForRoleCoverageStateSync(
      authorizationGuestPage,
      {
        role: "candidate",
        canManageRoom: false,
        minOpenCount: guestTransportBeforeRevoke.openCount + 1,
        minTransportOpenCount: guestTransportBeforeRevoke.openCount + 1,
        messageStart: guestPostReconnectMessageStart,
      },
      "REVOKED_GUEST_POST_RECONNECT_CANDIDATE_STATE_SYNC_MISSING",
    );
    const revokedGuestPrivacy = await authorizationGuestPage.evaluate(({ messageStart, minTransportOpenCount }) => {
      const forbidden = new Set([
        "lastCandidateKey",
        "candidateKeyHistory",
        "sourceEventId",
        "acceptedSequence",
        "pastePreview",
      ]);
      const findForbiddenPaths = (value, path = "$") => {
        if (Array.isArray(value)) {
          return value.flatMap((item, index) => findForbiddenPaths(item, `${path}[${index}]`));
        }
        if (!value || typeof value !== "object") return [];
        return Object.entries(value).flatMap(([key, nestedValue]) => [
          ...(forbidden.has(key) ? [`${path}.${key}`] : []),
          ...findForbiddenPaths(nestedValue, `${path}.${key}`),
        ]);
      };
      const messages = (window.__roleCoverageSse?.messages ?? []).slice(messageStart);
      const currentCandidateState = [...messages]
        .reverse()
        .find(
          (message) =>
            message?.type === "state_sync" &&
            message.__roleCoverageTransportOpenCount >= minTransportOpenCount &&
            message.payload?.role === "candidate" &&
            message.payload?.canManageRoom === false,
        )?.payload;
      return {
        hasCurrentCandidateState: Boolean(currentCandidateState),
        hasCurrentEventToken:
          typeof currentCandidateState?.eventToken === "string" && currentCandidateState.eventToken.trim().length > 0,
        malformedPayloadCount: messages.filter((message) => message?.type === "__malformed__").length,
        forbiddenPaths: messages.flatMap((message) => findForbiddenPaths(message)),
      };
    }, {
      messageStart: guestPostReconnectMessageStart,
      minTransportOpenCount: guestTransportBeforeRevoke.openCount + 1,
    });
    if (
      !revokedGuestPrivacy.hasCurrentCandidateState ||
      !revokedGuestPrivacy.hasCurrentEventToken ||
      revokedGuestPrivacy.malformedPayloadCount > 0 ||
      revokedGuestPrivacy.forbiddenPaths.length > 0
    ) {
      throw new Error(
        `REVOKED_GUEST_PRIVACY_INVALID hasState=${revokedGuestPrivacy.hasCurrentCandidateState} hasToken=${revokedGuestPrivacy.hasCurrentEventToken} malformed=${revokedGuestPrivacy.malformedPayloadCount} paths=${JSON.stringify(revokedGuestPrivacy.forbiddenPaths)}`,
      );
    }
    const revokedGuestExportStatuses = await authorizationGuestPage.evaluate(async ({
      inviteCode,
      minTransportOpenCount,
      sourceEventIds,
    }) => {
      const state = [...(window.__roleCoverageSse?.messages ?? [])]
        .reverse()
        .find(
          (message) =>
            message?.type === "state_sync" &&
            message.__roleCoverageTransportOpenCount >= minTransportOpenCount &&
            message.payload?.role === "candidate" &&
            message.payload?.canManageRoom === false,
        )?.payload;
      const eventToken = state?.eventToken;
      if (typeof eventToken !== "string" || !eventToken.trim()) {
        return { hasCurrentEventToken: false, jsonStatus: null, csvStatus: null, csvHasRawRows: false };
      }
      const headers = { "X-Room-Event-Token": eventToken };
      const [jsonResponse, csvResponse] = await Promise.all([
        fetch(`/api/rooms/${inviteCode}/keystroke-events?format=json`, { headers }),
        fetch(`/api/rooms/${inviteCode}/keystroke-events?format=csv`, { headers }),
      ]);
      const csvBody = await csvResponse.text();
      return {
        hasCurrentEventToken: true,
        jsonStatus: jsonResponse.status,
        csvStatus: csvResponse.status,
        csvHasRawRows:
          csvResponse.headers.get("content-type")?.includes("text/csv") ||
          csvBody.includes("source_event_id") ||
          sourceEventIds.some((sourceEventId) => csvBody.includes(sourceEventId)),
      };
    }, {
      inviteCode: fixture.room.inviteCode,
      minTransportOpenCount: guestTransportBeforeRevoke.openCount + 1,
      sourceEventIds: trackedSourceIds,
    });
    if (
      !revokedGuestExportStatuses.hasCurrentEventToken ||
      revokedGuestExportStatuses.jsonStatus !== 403 ||
      revokedGuestExportStatuses.csvStatus !== 403 ||
      revokedGuestExportStatuses.csvHasRawRows
    ) {
      throw new Error(
        `REVOKED_GUEST_TOKEN_ONLY_EXPORT_NOT_DENIED json=${revokedGuestExportStatuses.jsonStatus} csv=${revokedGuestExportStatuses.csvStatus} csvHasRawRows=${revokedGuestExportStatuses.csvHasRawRows}`,
      );
    }
  } catch (error) {
    fail(failures, "non-owner activity authorization, revocation, and CSV export", error);
  } finally {
    await authorizationOwnerContext?.close();
    await authorizationInterviewerContext?.close();
    await authorizationGuestContext?.close();
  }

  await ownerContext.close();
  await candidateContext.close();
} catch (error) {
  fail(failures, "test setup", error);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  throw new Error(`ACTIVITY_TIMELINE_RED\n${failures.join("\n")}`);
}

console.log("ACTIVITY_TIMELINE_GROUPING_OK");
