import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status} body=${text}`);
  }
}

async function requestJson(path, options, label) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const payload = await readJson(response, label);
  if (!response.ok) throw new Error(`${label}_FAILED ${JSON.stringify(payload)}`);
  return payload;
}

async function registerUser(prefix) {
  const suffix = Math.random().toString(36).slice(2, 9);
  const nickname = `${prefix}_${suffix}`;
  return requestJson(
    "/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, displayName: nickname, password: "pass12345" }),
    },
    "REGISTER",
  );
}

async function createTask(token, stepNumber) {
  const marker = `${Date.now()}_${stepNumber}`;
  return requestJson(
    "/me/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: `Independent step ${stepNumber} ${marker}`,
        description: `Description for independent step ${stepNumber}`,
        starterCode: `// STEP_CONTEXT_${stepNumber - 1}\n`,
        language: "nodejs",
      }),
    },
    "CREATE_TASK",
  );
}

async function createRoom(token, taskIds) {
  return requestJson(
    "/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: `Independent navigation ${Date.now()}`, taskIds }),
    },
    "CREATE_ROOM",
  );
}

async function grantInterviewer(ownerToken, inviteCode, userId) {
  return requestJson(
    `/rooms/${inviteCode}/participants/${userId}/role`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ role: "interviewer" }),
    },
    "GRANT_INTERVIEWER",
  );
}

async function getRoom(ownerToken, inviteCode) {
  return requestJson(
    `/rooms/${inviteCode}`,
    { headers: { Authorization: `Bearer ${ownerToken}` } },
    "GET_ROOM",
  );
}

async function connectCandidateRealtime(inviteCode) {
  const sessionId = `candidate_step_publication_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionId)}&displayNameEncoded=${encodeURIComponent("Candidate direct assertion")}`,
      { headers: { Accept: "text/event-stream" }, signal: controller.signal },
    );
    if (!response.ok || !response.body) {
      throw new Error(`CANDIDATE_SSE_CONNECT_FAILED status=${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const messages = [];
    let buffer = "";
    const drainEvents = () => {
      const received = [];
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary < 0) return received;
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          const message = JSON.parse(data);
          messages.push(message);
          received.push(message);
        } catch {}
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const received = drainEvents();
      const message = received.find((item) => item?.type === "state_sync" && item.payload?.eventToken);
      if (!message) continue;
      const collectRemainingEvents = async () => {
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) return;
            buffer += decoder.decode(next.value, { stream: true });
            drainEvents();
          }
        } catch {}
      };
      void collectRemainingEvents();
      return {
        sessionId,
        eventToken: message.payload.eventToken,
        messages,
        waitForNoManagerWorkspaceLeak: async (privateMarker) => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const leaked = messages.find((item) => {
            const serialized = JSON.stringify(item);
            return item?.type?.startsWith("manager_workspace_") || serialized.includes(privateMarker);
          });
          assertCondition(!leaked, `CANDIDATE_SSE_MANAGER_WORKSPACE_LEAK ${JSON.stringify(leaked)}`);
        },
        close: () => {
          reader.cancel().catch(() => {});
          controller.abort();
        },
      };
    }
    throw new Error("CANDIDATE_SSE_ENDED_WITHOUT_STATE_SYNC");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function connectManagerRealtime(inviteCode, authToken) {
  const sessionId = `manager_step_publication_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionId)}&displayNameEncoded=${encodeURIComponent("Manager direct assertion")}`,
      { headers: { Accept: "text/event-stream", Authorization: `Bearer ${authToken}` }, signal: controller.signal },
    );
    if (!response.ok || !response.body) {
      throw new Error(`MANAGER_SSE_CONNECT_FAILED status=${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.indexOf("\n\n");
      if (boundary < 0) continue;
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const message = JSON.parse(data);
        if (message?.type === "state_sync" && message.payload?.eventToken) {
          return {
            sessionId,
            eventToken: message.payload.eventToken,
            close: () => {
              reader.cancel().catch(() => {});
              controller.abort();
            },
          };
        }
      } catch {}
    }
    throw new Error("MANAGER_SSE_ENDED_WITHOUT_STATE_SYNC");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function expectCandidatePublishedStep(page, title, label) {
  const locator = page.locator('[data-testid="room-current-published-step-title"]');
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  const text = (await locator.textContent())?.trim() ?? "";
  assertCondition(text.includes(title), `${label}_PUBLISHED_STEP_EXPECTED title=${title} actual=${text}`);
}

async function expectManagerWorkspace(page, stepIndex, codeSentinel, label) {
  const workspace = page.locator('[data-testid="room-current-local-step-context"]');
  await workspace.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ stepIndex }) =>
      document
        .querySelector('[data-testid="room-current-local-step-context"]')
        ?.getAttribute("data-step-index") === String(stepIndex),
    { stepIndex },
    { timeout: 10_000 },
  );
  assertCondition(
    (await workspace.getAttribute("data-step-index")) === String(stepIndex),
    `${label}_WORKSPACE_STEP_MISMATCH`,
  );
  await page.waitForFunction(
    ({ codeSentinel }) =>
      document
        .querySelector('[data-testid="room-current-local-step-context"]')
        ?.textContent?.includes(codeSentinel),
    { codeSentinel },
    { timeout: 10_000 },
  );
  const text = (await workspace.textContent()) ?? "";
  assertCondition(text.includes(codeSentinel), `${label}_WORKSPACE_CODE_MISSING actual=${text}`);
}

async function expectPublishedEditorCode(page, codeSentinel, label) {
  const content = page.locator('[data-testid="room-code-editor-host"] .cm-content');
  await content.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ selector, codeSentinel }) => document.querySelector(selector)?.textContent?.includes(codeSentinel),
    { selector: '[data-testid="room-code-editor-host"] .cm-content', codeSentinel },
    { timeout: 10_000 },
  );
  assertCondition(
    ((await content.textContent()) ?? "").includes(codeSentinel),
    `${label}_PUBLISHED_EDITOR_CODE_MISSING`,
  );
}

async function expectEditableManagerWorkspace(page, label) {
  const codeEditor = page.locator('[data-testid="room-code-editor-host"] .cm-editor');
  const briefingEditor = page.locator('[data-testid="briefing-board-interviewer"] [data-testid="room-markdown-editor"] .cm-editor');
  const focusToggle = page.locator('[data-testid="briefing-focus-toggle"]');

  await Promise.all([
    codeEditor.waitFor({ state: "visible", timeout: 10_000 }),
    briefingEditor.waitFor({ state: "visible", timeout: 10_000 }),
    focusToggle.waitFor({ state: "visible", timeout: 10_000 }),
  ]);

  assertCondition(
    await codeEditor.locator('.cm-content').getAttribute('contenteditable') === 'true',
    `${label}_MANAGER_WORKSPACE_CODE_MUST_BE_EDITABLE`,
  );
  assertCondition(
    await briefingEditor.locator('.cm-content').getAttribute('contenteditable') === 'true',
    `${label}_MANAGER_WORKSPACE_BRIEFING_MUST_BE_EDITABLE`,
  );
}

async function expectWorkspaceFocusMode(page, expectedState, label) {
  const toggle = page.locator('[data-testid="briefing-focus-toggle"]');
  await toggle.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ expectedState }) =>
      document.querySelector('[data-testid="briefing-focus-toggle"]')?.getAttribute("data-state") === expectedState,
    { expectedState },
    { timeout: 10_000 },
  );
  assertCondition(
    (await toggle.getAttribute("data-state")) === expectedState,
    `${label}_FOCUS_MODE_MISMATCH`,
  );
}

async function waitForRoomStep(ownerToken, inviteCode, expectedStep) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const room = await getRoom(ownerToken, inviteCode);
    if (room.currentStep === expectedStep) return room;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const finalRoom = await getRoom(ownerToken, inviteCode);
  throw new Error(`ROOM_STEP_TIMEOUT expected=${expectedStep} actual=${finalRoom.currentStep}`);
}

async function waitForRoomCode(ownerToken, inviteCode, expectedSnippet) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const room = await getRoom(ownerToken, inviteCode);
    if (room.code?.includes(expectedSnippet)) return room;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const finalRoom = await getRoom(ownerToken, inviteCode);
  throw new Error(
    `ROOM_CODE_TIMEOUT expected=${expectedSnippet} actual=${finalRoom.code}`,
  );
}

async function replaceSharedEditorCode(page, nextCode, label, expectedMarker = "PREVIEW_FRESHNESS") {
  const content = page.locator('[data-testid="room-code-editor-host"] .cm-content');
  await content.waitFor({ state: "visible", timeout: 10_000 });
  await page.evaluate((replacement) => {
    const host = document.querySelector('[data-testid="room-code-editor-host"]');
    const view = host?.__roomEditorView;
    if (!view?.state?.doc) {
      throw new Error("ROOM_EDITOR_VIEW_NOT_AVAILABLE");
    }
    const length = view.state.doc.length;
    view.dispatch({
      changes: { from: 0, to: length, insert: replacement },
      selection: { anchor: replacement.length, head: replacement.length },
    });
  }, nextCode);
  await page.waitForFunction(
    ({ marker }) => {
      const host = document.querySelector('[data-testid="room-code-editor-host"]');
      return host?.__roomEditorView?.state?.doc?.toString?.().includes(marker);
    },
    { marker: expectedMarker },
    { timeout: 10_000 },
  );
  assertCondition(
    await page.evaluate((expectedMarker) => {
      const host = document.querySelector('[data-testid="room-code-editor-host"]');
      return host?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker) ?? false;
    }, expectedMarker),
    `${label}_SHARED_EDITOR_CODE_NOT_REPLACED`,
  );
}

async function replaceBriefingMarkdown(page, nextMarkdown, label) {
  const content = page.locator('[data-testid="room-markdown-editor"] .cm-content');
  await content.waitFor({ state: "visible", timeout: 10_000 });
  await content.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(nextMarkdown);
  await page.waitForFunction(
    ({ nextMarkdown }) =>
      document
        .querySelector('[data-testid="room-markdown-editor"] .cm-content')
        ?.textContent?.includes(nextMarkdown),
    { nextMarkdown },
    { timeout: 10_000 },
  );
  assertCondition(
    ((await content.textContent()) ?? "").includes(nextMarkdown),
    `${label}_BRIEFING_MARKDOWN_NOT_REPLACED`,
  );
}

async function expectBriefingMarkdown(page, marker, label) {
  const content = page.locator('[data-testid="room-markdown-editor"] .cm-content');
  await content.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ marker }) =>
      document
        .querySelector('[data-testid="room-markdown-editor"] .cm-content')
        ?.textContent?.includes(marker),
    { marker },
    { timeout: 10_000 },
  );
  assertCondition(
    ((await content.textContent()) ?? "").includes(marker),
    `${label}_BRIEFING_MARKDOWN_MISSING`,
  );
}

async function selectWorkspaceLanguage(page, optionLabel, expectedValue, label) {
  const input = page.locator('#room-language-select');
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await page.waitForFunction(
    ({ expectedValue }) =>
      document.querySelector('#room-language-select')?.value === expectedValue,
    { expectedValue },
    { timeout: 10_000 },
  );
  assertCondition(
    (await input.inputValue()) === expectedValue,
    `${label}_WORKSPACE_LANGUAGE_MISMATCH`,
  );
}

async function expectWorkspaceLanguage(page, expectedValue, label) {
  const input = page.locator('#room-language-select');
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ expectedValue }) =>
      document.querySelector('#room-language-select')?.value === expectedValue,
    { expectedValue },
    { timeout: 10_000 },
  );
  assertCondition(
    (await input.inputValue()) === expectedValue,
    `${label}_WORKSPACE_LANGUAGE_MISMATCH`,
  );
}

async function bootstrapAuthenticatedPage(page, auth, inviteCode) {
  const displayName = auth.user.displayName || auth.user.nickname;
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user, displayName: savedName, roomInviteCode }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", savedName);
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, savedName);
  }, { token: auth.token, user: auth.user, displayName, roomInviteCode: inviteCode });
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15_000 });
}

async function configureBrowserApiTransport(context) {
  const apiOrigin = process.env.E2E_BROWSER_API_ORIGIN?.trim();
  if (!apiOrigin) return;
  await context.addInitScript(({ apiOrigin }) => {
    const toDirectApiUrl = (value) => {
      const rawUrl = value instanceof Request ? value.url : String(value);
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/")) {
        return value;
      }
      return `${apiOrigin}${parsed.pathname}${parsed.search}`;
    };

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const directInput = toDirectApiUrl(input);
      if (input instanceof Request && directInput !== input) {
        return nativeFetch(new Request(directInput, input), init);
      }
      return nativeFetch(directInput, init);
    };

    const NativeEventSource = window.EventSource;
    window.EventSource = function EventSourceWithDirectApi(url, init) {
      return new NativeEventSource(toDirectApiUrl(url), init);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }, { apiOrigin });
}

async function bootstrapCandidatePage(page, inviteCode) {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((roomInviteCode) => {
    localStorage.setItem("display_name", "Independent candidate");
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, "Independent candidate");
  }, inviteCode);
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 15_000 });
}

async function waitForRealtimeReady(page, label) {
  const status = page.locator('[data-testid="room-connection-status"]');
  await status.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    (element) => element.getAttribute("data-state") === "online",
    await status.elementHandle(),
    { timeout: 10_000 },
  );
  // The EventSource `open` event may precede the initial state_sync that carries
  // the event token. A short deterministic settle avoids clicking publish while
  // the client still has nothing it can safely send to the server.
  await page.waitForTimeout(250);
  assertCondition(
    (await status.getAttribute("data-state")) === "online",
    `${label}_REALTIME_NOT_READY`,
  );
}

async function expectGlobalMarker(page, stepIndex, label) {
  const marker = page.locator(`[data-testid="room-global-active-step-${stepIndex}"]`);
  await marker.waitFor({ state: "visible", timeout: 10_000 });
  assertCondition((await marker.textContent())?.trim() === "Активен", `${label}_GLOBAL_MARKER_LABEL_MISMATCH`);
  const allMarkers = page.locator('[data-testid^="room-global-active-step-"]');
  assertCondition(await allMarkers.count() === 1, `${label}_EXPECTED_EXACTLY_ONE_GLOBAL_MARKER`);
}

async function expectGlobalMarkerAccessibleName(page, stepIndex, taskTitle, label) {
  const marker = page.locator(`[data-testid="room-global-active-step-${stepIndex}"]`);
  await marker.waitFor({ state: "visible", timeout: 10_000 });
  assertCondition(
    (await marker.getAttribute("aria-label"))?.includes(taskTitle),
    `${label}_GLOBAL_MARKER_ACCESSIBLE_TITLE_MISSING`,
  );
}

async function expectLocalSelection(page, stepIndex, title, label) {
  const row = page.locator(`[data-testid="room-step-row-${stepIndex}"]`);
  await row.waitFor({ state: "visible", timeout: 10_000 });
  assertCondition((await row.getAttribute("data-local-selected")) === "true", `${label}_LOCAL_SELECTION_MARKER_MISSING`);
  assertCondition(
    (await row.getAttribute("aria-label"))?.includes(title),
    `${label}_LOCAL_SELECTION_TITLE_MISSING`,
  );
  const borderTopWidth = await row.locator("..").evaluate((element) => getComputedStyle(element).borderTopWidth);
  assertCondition(
    borderTopWidth === "0px",
    `${label}_LOCAL_SELECTION_MUST_NOT_ADD_BORDER actual=${borderTopWidth}`,
  );
}

async function expectManagerStepChangeNotification(page, taskTitle, label) {
  const notification = page.locator('[data-testid="room-step-change-notification"]');
  await notification.waitFor({ state: "visible", timeout: 10_000 });
  const text = (await notification.textContent())?.trim() ?? "";
  assertCondition(text.includes("Активный шаг изменён"), `${label}_NOTIFICATION_TITLE_MISSING actual=${text}`);
  assertCondition(text.includes(taskTitle), `${label}_NOTIFICATION_TASK_TITLE_MISSING actual=${text}`);
}

async function expectCompactManagerControls(page, label) {
  assertCondition(
    await page.locator('[data-testid="room-current-local-step-title"]').count() === 0,
    `${label}_LOCAL_PREVIEW_TITLE_MUST_BE_REMOVED`,
  );
  assertCondition(
    await page.getByText("Ваш локальный выбор", { exact: true }).count() === 0,
    `${label}_LOCAL_PREVIEW_LABEL_MUST_BE_REMOVED`,
  );
  assertCondition(
    await page.getByRole("button", { name: "Показать этот шаг всем", exact: true }).count() === 0,
    `${label}_VERBOSE_PUBLISH_LABEL_MUST_BE_REMOVED`,
  );
}

async function expectPublishAction(page, taskTitle, label) {
  const publishButton = page.locator('[data-testid="room-publish-step"]');
  await publishButton.waitFor({ state: "visible", timeout: 10_000 });
  assertCondition((await publishButton.textContent())?.trim() === "Переключить", `${label}_PUBLISH_LABEL_MISMATCH`);
  assertCondition(
    (await publishButton.getAttribute("aria-label"))?.includes(taskTitle),
    `${label}_PUBLISH_TARGET_TITLE_MISSING`,
  );
  const style = await publishButton.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      backgroundColor: computed.backgroundColor,
      borderRadius: computed.borderRadius,
      color: computed.color,
    };
  });
  const rgbaMatch = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/);
  const rgbaParts = rgbaMatch?.[1].split(",").map((part) => Number(part.trim())) ?? [];
  const alpha = rgbaParts.length === 4 ? rgbaParts[3] : 1;
  assertCondition(style.borderRadius === "999px", `${label}_PUBLISH_TAG_RADIUS_MISMATCH actual=${style.borderRadius}`);
  assertCondition(alpha <= 0.3, `${label}_PUBLISH_TAG_MUST_BE_TRANSPARENT actual=${style.backgroundColor}`);
  assertCondition(
    rgbaParts[2] > rgbaParts[0] && rgbaParts[2] > rgbaParts[1],
    `${label}_PUBLISH_TAG_MUST_BE_BLUE actual=${style.backgroundColor}`,
  );
}

const browser = await chromium.launch({ headless: true });

try {
  const owner = await registerUser("step_owner");
  const interviewer = await registerUser("step_interviewer");
  // Create sequentially: each new user needs one language category, and this
  // setup must not manufacture duplicate categories through a three-request race.
  const tasks = [];
  for (const step of [1, 2, 3]) {
    tasks.push(await createTask(owner.token, step));
  }
  const room = await createRoom(owner.token, tasks.map((task) => task.id));
  await grantInterviewer(owner.token, room.inviteCode, interviewer.user.id);

  const ownerContext = await browser.newContext();
  const interviewerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  await Promise.all([
    configureBrowserApiTransport(ownerContext),
    configureBrowserApiTransport(interviewerContext),
    configureBrowserApiTransport(candidateContext),
  ]);
  const ownerPage = await ownerContext.newPage();
  const interviewerPage = await interviewerContext.newPage();
  const candidatePage = await candidateContext.newPage();

  await bootstrapAuthenticatedPage(ownerPage, owner, room.inviteCode);
  await bootstrapAuthenticatedPage(interviewerPage, interviewer, room.inviteCode);
  await bootstrapCandidatePage(candidatePage, room.inviteCode);
  await Promise.all([
    waitForRealtimeReady(ownerPage, "OWNER"),
    waitForRealtimeReady(interviewerPage, "INTERVIEWER"),
    waitForRealtimeReady(candidatePage, "CANDIDATE"),
  ]);

  await expectGlobalMarker(ownerPage, 0, "OWNER_INITIAL");
  await expectGlobalMarker(interviewerPage, 0, "INTERVIEWER_INITIAL");
  await expectLocalSelection(ownerPage, 0, tasks[0].title, "OWNER_INITIAL");
  await expectLocalSelection(interviewerPage, 0, tasks[0].title, "INTERVIEWER_INITIAL");
  await expectCompactManagerControls(ownerPage, "OWNER_INITIAL");
  await expectCompactManagerControls(interviewerPage, "INTERVIEWER_INITIAL");
  await expectCandidatePublishedStep(candidatePage, tasks[0].title, "CANDIDATE_INITIAL");
  await expectManagerWorkspace(ownerPage, 0, "STEP_CONTEXT_0", "OWNER_INITIAL");
  await expectManagerWorkspace(interviewerPage, 0, "STEP_CONTEXT_0", "INTERVIEWER_INITIAL");
  await expectPublishedEditorCode(candidatePage, "STEP_CONTEXT_0", "CANDIDATE_INITIAL");

  const ownerSnapshot = await fetch(`${apiBaseUrl}/rooms/${room.inviteCode}/tasks/1/workspace`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assertCondition(ownerSnapshot.ok, `OWNER_WORKSPACE_SNAPSHOT_FAILED status=${ownerSnapshot.status}`);
  const ownerSnapshotPayload = await readJson(ownerSnapshot, "OWNER_WORKSPACE_SNAPSHOT");
  assertCondition(ownerSnapshotPayload.code.includes("STEP_CONTEXT_1"), "OWNER_WORKSPACE_SNAPSHOT_CODE_MISSING");

  const candidateSnapshot = await fetch(`${apiBaseUrl}/rooms/${room.inviteCode}/tasks/1/workspace`);
  assertCondition(candidateSnapshot.status === 403, `CANDIDATE_WORKSPACE_SNAPSHOT_MUST_BE_FORBIDDEN actual=${candidateSnapshot.status}`);

  await ownerPage.locator('[data-testid="room-step-row-1"]').click();
  await expectLocalSelection(ownerPage, 1, tasks[1].title, "OWNER_AFTER_LOCAL_SELECT");
  await expectManagerWorkspace(ownerPage, 1, "STEP_CONTEXT_1", "OWNER_AFTER_LOCAL_SELECT");
  await expectEditableManagerWorkspace(ownerPage, "OWNER_AFTER_LOCAL_SELECT");
  await expectPublishAction(ownerPage, tasks[1].title, "OWNER_AFTER_LOCAL_SELECT");
  await expectLocalSelection(interviewerPage, 0, tasks[0].title, "INTERVIEWER_AFTER_OWNER_SELECT");
  await expectManagerWorkspace(interviewerPage, 0, "STEP_CONTEXT_0", "INTERVIEWER_AFTER_OWNER_SELECT");
  await expectGlobalMarker(ownerPage, 0, "OWNER_GLOBAL_STAYS_FIRST");
  await expectCandidatePublishedStep(candidatePage, tasks[0].title, "CANDIDATE_AFTER_OWNER_LOCAL_SELECT");
  await expectPublishedEditorCode(candidatePage, "STEP_CONTEXT_0", "CANDIDATE_AFTER_OWNER_LOCAL_SELECT");
  assertCondition((await getRoom(owner.token, room.inviteCode)).currentStep === 0, "OWNER_LOCAL_SELECT_CHANGED_ROOM_STEP");

  // A selected inactive task is a shared manager workspace, not a static
  // preview. Its edits must travel to a second manager but never to the
  // published candidate workspace.
  const managerOnlyCode = "// STEP_CONTEXT_1\n// MANAGER_ONLY_CODE\n";
  const managerOnlyBriefing = "## MANAGER_ONLY_BRIEFING";
  await replaceSharedEditorCode(
    ownerPage,
    managerOnlyCode,
    "OWNER_MANAGER_WORKSPACE_CODE",
    "MANAGER_ONLY_CODE",
  );
  await replaceBriefingMarkdown(
    ownerPage,
    managerOnlyBriefing,
    "OWNER_MANAGER_WORKSPACE_BRIEFING",
  );
  await selectWorkspaceLanguage(
    ownerPage,
    "Python",
    "Python",
    "OWNER_MANAGER_WORKSPACE_LANGUAGE",
  );

  await interviewerPage.locator('[data-testid="room-step-row-1"]').click();
  await expectLocalSelection(interviewerPage, 1, tasks[1].title, "INTERVIEWER_OPENS_SHARED_MANAGER_WORKSPACE");
  await expectEditableManagerWorkspace(interviewerPage, "INTERVIEWER_OPENS_SHARED_MANAGER_WORKSPACE");
  await expectPublishedEditorCode(interviewerPage, "MANAGER_ONLY_CODE", "INTERVIEWER_RECEIVES_MANAGER_CODE");
  await expectBriefingMarkdown(interviewerPage, "MANAGER_ONLY_BRIEFING", "INTERVIEWER_RECEIVES_MANAGER_BRIEFING");
  await expectWorkspaceLanguage(interviewerPage, "Python", "INTERVIEWER_RECEIVES_MANAGER_LANGUAGE");

  await ownerPage.locator('[data-testid="briefing-focus-toggle"]').click();
  await expectWorkspaceFocusMode(ownerPage, "on", "OWNER_ENABLES_MANAGER_FOCUS_MODE");
  await expectWorkspaceFocusMode(interviewerPage, "on", "INTERVIEWER_RECEIVES_MANAGER_FOCUS_MODE");
  assertCondition(
    (await candidatePage.locator('[data-testid="briefing-board-candidate"]').getAttribute("data-focus")) === "off",
    "CANDIDATE_MUST_NOT_RECEIVE_UNPUBLISHED_MANAGER_FOCUS_MODE",
  );
  await ownerPage.locator('[data-testid="briefing-focus-toggle"]').click();
  await expectWorkspaceFocusMode(ownerPage, "off", "OWNER_DISABLES_MANAGER_FOCUS_MODE");
  await expectWorkspaceFocusMode(interviewerPage, "off", "INTERVIEWER_RECEIVES_MANAGER_FOCUS_MODE_RESET");

  // The scoped workspace must recover after a manager reloads, including the
  // saved local selection and the current shared task state.
  await interviewerPage.reload({ waitUntil: "domcontentloaded" });
  await waitForRealtimeReady(interviewerPage, "INTERVIEWER_RECONNECT");
  await expectLocalSelection(interviewerPage, 1, tasks[1].title, "INTERVIEWER_RECONNECT");
  await expectPublishedEditorCode(interviewerPage, "MANAGER_ONLY_CODE", "INTERVIEWER_RECONNECTS_TO_MANAGER_CODE");
  await expectBriefingMarkdown(interviewerPage, "MANAGER_ONLY_BRIEFING", "INTERVIEWER_RECONNECTS_TO_MANAGER_BRIEFING");
  await expectWorkspaceLanguage(interviewerPage, "Python", "INTERVIEWER_RECONNECTS_TO_MANAGER_LANGUAGE");

  // A second manager's accepted updates are the source of truth when either
  // manager publishes this inactive task. Publication must not roll this
  // workspace back to the first manager's earlier local snapshot.
  const interviewerFinalCode = "// STEP_CONTEXT_1\n// MANAGER_ONLY_CODE\n// INTERVIEWER_LAST_SHARED_CODE\n";
  await replaceSharedEditorCode(
    interviewerPage,
    interviewerFinalCode,
    "INTERVIEWER_LAST_SHARED_CODE",
    "INTERVIEWER_LAST_SHARED_CODE",
  );
  await expectPublishedEditorCode(ownerPage, "INTERVIEWER_LAST_SHARED_CODE", "OWNER_RECEIVES_LAST_SHARED_CODE");

  const unpublishedRoom = await getRoom(owner.token, room.inviteCode);
  assertCondition(unpublishedRoom.currentStep === 0, "MANAGER_WORKSPACE_EDIT_CHANGED_ROOM_STEP");
  assertCondition(!unpublishedRoom.code.includes("MANAGER_ONLY_CODE"), "MANAGER_WORKSPACE_EDIT_LEAKED_INTO_PUBLISHED_CODE");
  assertCondition(!unpublishedRoom.briefingMarkdown.includes("MANAGER_ONLY_BRIEFING"), "MANAGER_WORKSPACE_EDIT_LEAKED_INTO_PUBLISHED_BRIEFING");
  assertCondition(unpublishedRoom.language === "nodejs", "MANAGER_WORKSPACE_EDIT_CHANGED_PUBLISHED_LANGUAGE");
  await expectCandidatePublishedStep(candidatePage, tasks[0].title, "CANDIDATE_STAYS_ON_PUBLISHED_STEP_DURING_MANAGER_EDIT");
  await expectPublishedEditorCode(candidatePage, "STEP_CONTEXT_0", "CANDIDATE_CODE_STAYS_PUBLISHED_DURING_MANAGER_EDIT");
  assertCondition(
    await candidatePage.getByText("MANAGER_ONLY_CODE", { exact: false }).count() === 0,
    "CANDIDATE_MUST_NOT_RENDER_UNPUBLISHED_MANAGER_CODE",
  );
  assertCondition(
    await candidatePage.getByText("MANAGER_ONLY_BRIEFING", { exact: false }).count() === 0,
    "CANDIDATE_MUST_NOT_RENDER_UNPUBLISHED_MANAGER_BRIEFING",
  );

  // Documents for different inactive steps must not merge, and returning to
  // the first task must recover the manager-shared document.
  await ownerPage.locator('[data-testid="room-step-row-2"]').click();
  await expectEditableManagerWorkspace(ownerPage, "OWNER_SWITCHES_TO_OTHER_MANAGER_WORKSPACE");
  await expectPublishedEditorCode(ownerPage, "STEP_CONTEXT_2", "OWNER_OTHER_MANAGER_WORKSPACE_ISOLATED");
  assertCondition(
    await ownerPage.getByText("MANAGER_ONLY_CODE", { exact: false }).count() === 0,
    "MANAGER_WORKSPACE_DOCUMENTS_MUST_NOT_MERGE",
  );
  await ownerPage.locator('[data-testid="room-step-row-1"]').click();
  await expectPublishedEditorCode(ownerPage, "MANAGER_ONLY_CODE", "OWNER_RECOVERS_FIRST_MANAGER_WORKSPACE");
  await expectBriefingMarkdown(ownerPage, "MANAGER_ONLY_BRIEFING", "OWNER_RECOVERS_FIRST_MANAGER_BRIEFING");

  const candidateCanPublish = await candidatePage.locator('[data-testid="room-publish-step"]').isVisible().catch(() => false);
  const candidateCanSelect = await candidatePage.locator('[data-testid="room-step-row-0"]').isVisible().catch(() => false);
  assertCondition(!candidateCanPublish && !candidateCanSelect, "CANDIDATE_MUST_NOT_HAVE_STEP_MANAGEMENT_CONTROLS");

  const candidateRealtime = await connectCandidateRealtime(room.inviteCode);
  try {
    const candidatePublishResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: candidateRealtime.sessionId,
        eventToken: candidateRealtime.eventToken,
        clientEventSequence: 1,
        type: "set_step",
        stepIndex: 2,
      }),
    });
    assertCondition(candidatePublishResponse.status === 403, `CANDIDATE_PUBLISH_MUST_BE_FORBIDDEN actual=${candidatePublishResponse.status}`);
    assertCondition((await getRoom(owner.token, room.inviteCode)).currentStep === 0, "CANDIDATE_PUBLISH_CHANGED_ROOM_STEP");

    const candidateManagerWorkspaceResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: candidateRealtime.sessionId,
        eventToken: candidateRealtime.eventToken,
        clientEventSequence: 2,
        type: "manager_workspace_open",
        stepIndex: 1,
      }),
    });
    assertCondition(
      candidateManagerWorkspaceResponse.status === 403,
      `CANDIDATE_MANAGER_WORKSPACE_SUBSCRIBE_MUST_BE_FORBIDDEN actual=${candidateManagerWorkspaceResponse.status}`,
    );

    const candidateManagerYjsResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: candidateRealtime.sessionId,
        eventToken: candidateRealtime.eventToken,
        clientEventSequence: 3,
        type: "manager_workspace_yjs_update",
        stepIndex: 1,
        yjsUpdate: "AQID",
        baseServerYjsSequence: 0,
        operationId: `candidate-forbidden-${Date.now()}`,
      }),
    });
    assertCondition(
      candidateManagerYjsResponse.status === 403,
      `CANDIDATE_MANAGER_WORKSPACE_YJS_MUST_BE_FORBIDDEN actual=${candidateManagerYjsResponse.status}`,
    );

    const candidateManagerAwarenessResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: candidateRealtime.sessionId,
        eventToken: candidateRealtime.eventToken,
        clientEventSequence: 4,
        type: "manager_workspace_awareness_update",
        stepIndex: 1,
        awarenessUpdate: "AQID",
      }),
    });
    assertCondition(
      candidateManagerAwarenessResponse.status === 403,
      `CANDIDATE_MANAGER_WORKSPACE_AWARENESS_MUST_BE_FORBIDDEN actual=${candidateManagerAwarenessResponse.status}`,
    );

    await replaceSharedEditorCode(
      ownerPage,
      "// STEP_CONTEXT_1\n// MANAGER_ONLY_CODE\n// INTERVIEWER_LAST_SHARED_CODE\n// SSE_PRIVATE_MARKER\n",
      "OWNER_MANAGER_WORKSPACE_SSE_ISOLATION",
      "SSE_PRIVATE_MARKER",
    );
    await expectPublishedEditorCode(interviewerPage, "SSE_PRIVATE_MARKER", "INTERVIEWER_RECEIVES_SCOPED_SSE_UPDATE");
    await candidateRealtime.waitForNoManagerWorkspaceLeak("SSE_PRIVATE_MARKER");
  } finally {
    candidateRealtime.close();
  }

  const ownerPublishButton = ownerPage.locator('[data-testid="room-publish-step"]');
  await ownerPublishButton.waitFor({ state: "visible", timeout: 10_000 });
  await ownerPublishButton.click();
  await waitForRoomStep(owner.token, room.inviteCode, 1);
  await expectGlobalMarker(ownerPage, 1, "OWNER_AFTER_OWN_PUBLICATION");
  await expectGlobalMarker(interviewerPage, 1, "INTERVIEWER_AFTER_OWNER_PUBLICATION");
  await expectManagerWorkspace(ownerPage, 1, "MANAGER_ONLY_CODE", "OWNER_SHARED_WORKSPACE_AFTER_OWN_PUBLICATION");
  await expectPublishedEditorCode(ownerPage, "INTERVIEWER_LAST_SHARED_CODE", "OWNER_RECEIVES_LAST_SHARED_CODE_AFTER_PUBLICATION");
  await expectPublishedEditorCode(interviewerPage, "INTERVIEWER_LAST_SHARED_CODE", "INTERVIEWER_RECEIVES_LAST_SHARED_CODE_AFTER_PUBLICATION");
  await expectCandidatePublishedStep(candidatePage, tasks[1].title, "CANDIDATE_AFTER_OWNER_PUBLICATION");
  const publishedPreparedRoom = await getRoom(owner.token, room.inviteCode);
  assertCondition(
    publishedPreparedRoom.code?.includes("INTERVIEWER_LAST_SHARED_CODE"),
    `PUBLISHED_LAST_SHARED_CODE_MISSING actual=${publishedPreparedRoom.code}`,
  );
  await expectPublishedEditorCode(candidatePage, "MANAGER_ONLY_CODE", "CANDIDATE_AFTER_OWNER_PUBLICATION");
  await expectPublishedEditorCode(candidatePage, "INTERVIEWER_LAST_SHARED_CODE", "CANDIDATE_RECEIVES_LAST_SHARED_CODE_AFTER_PUBLICATION");
  const managerRealtime = await connectManagerRealtime(room.inviteCode, owner.token);
  try {
    const latePublishedWorkspaceOpenResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: managerRealtime.sessionId,
        eventToken: managerRealtime.eventToken,
        clientEventSequence: 1,
        type: "manager_workspace_open",
        stepIndex: 1,
      }),
    });
    const latePublishedWorkspaceYjsResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: managerRealtime.sessionId,
        eventToken: managerRealtime.eventToken,
        clientEventSequence: 2,
        type: "manager_workspace_yjs_update",
        stepIndex: 1,
        yjsUpdate: "AQID",
        baseServerYjsSequence: 0,
        operationId: `late-published-manager-update-${Date.now()}`,
      }),
    });
    assertCondition(
      latePublishedWorkspaceOpenResponse.status === 204,
      `MANAGER_LATE_PUBLISHED_WORKSPACE_OPEN_MUST_BE_IGNORED actual=${latePublishedWorkspaceOpenResponse.status}`,
    );
    assertCondition(
      latePublishedWorkspaceYjsResponse.status === 204,
      `MANAGER_LATE_PUBLISHED_WORKSPACE_YJS_MUST_BE_IGNORED actual=${latePublishedWorkspaceYjsResponse.status}`,
    );
  } finally {
    managerRealtime.close();
  }
  assertCondition(publishedPreparedRoom.language === "python", "PUBLISHED_MANAGER_LANGUAGE_MISSING");
  assertCondition(
    publishedPreparedRoom.briefingMarkdown.includes("MANAGER_ONLY_BRIEFING"),
    "PUBLISHED_MANAGER_BRIEFING_MISSING",
  );

  const freshPreviewCode = "// STEP_CONTEXT_1\n// PREVIEW_FRESHNESS\n";
  await replaceSharedEditorCode(ownerPage, freshPreviewCode, "OWNER_SHARED_EDIT");
  await waitForRoomCode(owner.token, room.inviteCode, "PREVIEW_FRESHNESS");

  await interviewerPage.locator('[data-testid="room-step-row-2"]').click();
  await expectLocalSelection(interviewerPage, 2, tasks[2].title, "INTERVIEWER_AFTER_LOCAL_SELECT");
  await expectManagerWorkspace(interviewerPage, 2, "STEP_CONTEXT_2", "INTERVIEWER_AFTER_LOCAL_SELECT");
  await expectEditableManagerWorkspace(interviewerPage, "INTERVIEWER_AFTER_LOCAL_SELECT");
  await expectPublishAction(interviewerPage, tasks[2].title, "INTERVIEWER_AFTER_LOCAL_SELECT");
  await expectLocalSelection(ownerPage, 1, tasks[1].title, "OWNER_SELECTION_AFTER_SHARED_EDIT");
  await expectManagerWorkspace(ownerPage, 1, "PREVIEW_FRESHNESS", "OWNER_SHARED_EDIT_VISIBLE");
  await expectCandidatePublishedStep(candidatePage, tasks[1].title, "CANDIDATE_AFTER_INTERVIEWER_LOCAL_SELECT");
  assertCondition((await getRoom(owner.token, room.inviteCode)).currentStep === 1, "INTERVIEWER_LOCAL_SELECT_CHANGED_ROOM_STEP");

  const publishButton = interviewerPage.locator('[data-testid="room-publish-step"]');
  await publishButton.waitFor({ state: "visible", timeout: 10_000 });
  assertCondition(!(await publishButton.isDisabled()), "INTERVIEWER_PUBLISH_BUTTON_IS_DISABLED");
  await publishButton.click();
  await waitForRoomStep(owner.token, room.inviteCode, 2);
  await expectGlobalMarker(ownerPage, 2, "OWNER_AFTER_PUBLICATION");
  await expectGlobalMarker(interviewerPage, 2, "INTERVIEWER_AFTER_PUBLICATION");
  await expectLocalSelection(ownerPage, 1, tasks[1].title, "OWNER_SELECTION_REMAINS_LOCAL_AFTER_OTHER_PUBLISHES");
  await expectLocalSelection(interviewerPage, 2, tasks[2].title, "INTERVIEWER_SELECTION_AFTER_PUBLICATION");
  await expectManagerStepChangeNotification(ownerPage, tasks[2].title, "OWNER_NOTIFIED_ABOUT_OTHER_INTERVIEWER_PUBLICATION");
  assertCondition(
    await interviewerPage.locator('[data-testid="room-step-change-notification"]').count() === 0,
    "PUBLISHING_INTERVIEWER_MUST_NOT_BE_NOTIFIED_ABOUT_OWN_ACTIVE_STEP",
  );
  assertCondition(
    await candidatePage.locator('[data-testid="room-step-change-notification"]').count() === 0,
    "CANDIDATE_MUST_NOT_RECEIVE_MANAGER_STEP_CHANGE_NOTIFICATION",
  );
  await expectManagerWorkspace(ownerPage, 1, "PREVIEW_FRESHNESS", "OWNER_PREVIEW_REFRESHES_AFTER_OTHER_PUBLICATION");
  await expectManagerWorkspace(interviewerPage, 2, "STEP_CONTEXT_2", "INTERVIEWER_SHARED_WORKSPACE_AFTER_PUBLICATION");
  assertCondition(
    await interviewerPage.locator('[data-testid="room-publish-step"]').count() === 0,
    "PUBLISH_ACTION_MUST_HIDE_FOR_ACTIVE_SELECTED_STEP",
  );

  await expectCandidatePublishedStep(candidatePage, tasks[2].title, "CANDIDATE_AFTER_PUBLICATION");
  await expectPublishedEditorCode(candidatePage, "STEP_CONTEXT_2", "CANDIDATE_AFTER_PUBLICATION");
  await expectGlobalMarkerAccessibleName(ownerPage, 2, tasks[2].title, "OWNER_AFTER_PUBLICATION");

  // The owner keeps the notification about task 3 while working on task 2.
  // Another interviewer now makes that already selected task 2 active. The
  // old task-3 notification must disappear instead of offering a redirect
  // back to an obsolete room step.
  await interviewerPage.locator('[data-testid="room-step-row-1"]').click();
  const interviewerReturnsToOwnerStepButton = interviewerPage.locator('[data-testid="room-publish-step"]');
  await interviewerReturnsToOwnerStepButton.waitFor({ state: "visible", timeout: 10_000 });
  await interviewerReturnsToOwnerStepButton.click();
  await waitForRoomStep(owner.token, room.inviteCode, 1);
  await expectGlobalMarker(ownerPage, 1, "OWNER_AFTER_OTHER_INTERVIEWER_PUBLISHES_OWN_SELECTED_STEP");
  assertCondition(
    await ownerPage.locator('[data-testid="room-step-change-notification"]').count() === 0,
    "OWNER_STALE_NOTIFICATION_MUST_CLEAR_AFTER_OTHER_INTERVIEWER_PUBLISHES_OWN_SELECTED_STEP",
  );
  await expectCandidatePublishedStep(candidatePage, tasks[1].title, "CANDIDATE_AFTER_INTERVIEWER_RETURNS_TO_OWNER_STEP");

  // Recreate a notification and verify the complementary case: publication
  // initiated by the notified manager also clears the stale notification.
  await interviewerPage.locator('[data-testid="room-step-row-2"]').click();
  const interviewerRepublishesThirdStepButton = interviewerPage.locator('[data-testid="room-publish-step"]');
  await interviewerRepublishesThirdStepButton.waitFor({ state: "visible", timeout: 10_000 });
  await interviewerRepublishesThirdStepButton.click();
  await waitForRoomStep(owner.token, room.inviteCode, 2);
  await expectManagerStepChangeNotification(ownerPage, tasks[2].title, "OWNER_NOTIFIED_AGAIN_ABOUT_OTHER_PUBLICATION");

  const ownerRepublishButton = ownerPage.locator('[data-testid="room-publish-step"]');
  await ownerRepublishButton.waitFor({ state: "visible", timeout: 10_000 });
  await ownerRepublishButton.click();
  await waitForRoomStep(owner.token, room.inviteCode, 1);
  assertCondition(
    await ownerPage.locator('[data-testid="room-step-change-notification"]').count() === 0,
    "OWNER_STALE_NOTIFICATION_MUST_CLEAR_AFTER_SELF_PUBLICATION",
  );

  console.log("INTERVIEWER_STEP_PUBLICATION_OK");
  await ownerContext.close();
  await interviewerContext.close();
  await candidateContext.close();
} catch (error) {
  console.error("INTERVIEWER_STEP_PUBLICATION_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
