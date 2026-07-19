import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function requestJson(path, options, label) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status} body=${raw}`);
  }
  if (!response.ok) throw new Error(`${label}_FAILED status=${response.status} body=${raw}`);
  return payload;
}

async function registerUser(prefix) {
  const nickname = `${prefix}_${uniqueId()}`.slice(0, 32);
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

async function createTask(token, index) {
  return requestJson(
    "/me/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: `Publication preservation ${index} ${uniqueId()}`,
        description: `PUBLIC_PUBLICATION_STEP_${index}`,
        starterCode: `// PUBLIC_PUBLICATION_STEP_${index}\n`,
        language: "nodejs",
      }),
    },
    "CREATE_TASK",
  );
}

async function createFixture() {
  const owner = await registerUser("publication_owner");
  const publisher = await registerUser("publication_publisher");
  const firstTask = await createTask(owner.token, 0);
  const secondTask = await createTask(owner.token, 1);
  const room = await requestJson(
    "/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ title: `Public transition ${uniqueId()}`, taskIds: [firstTask.id, secondTask.id] }),
    },
    "CREATE_ROOM",
  );
  await requestJson(
    `/rooms/${room.inviteCode}/participants/${publisher.user.id}/role`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ role: "interviewer" }),
    },
    "GRANT_INTERVIEWER",
  );
  return { owner, publisher, room, tasks: [firstTask, secondTask] };
}

async function getRoom(token, inviteCode) {
  return requestJson(
    `/rooms/${inviteCode}`,
    { headers: { Authorization: `Bearer ${token}` } },
    "GET_ROOM",
  );
}

async function getWorkspace(token, inviteCode, stepIndex) {
  return requestJson(
    `/rooms/${inviteCode}/tasks/${stepIndex}/workspace`,
    { headers: { Authorization: `Bearer ${token}` } },
    "GET_WORKSPACE",
  );
}

async function updateWorkspace(token, inviteCode, stepIndex, code, revision) {
  return requestJson(
    `/rooms/${inviteCode}/tasks/${stepIndex}/workspace`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, revision }),
    },
    "UPDATE_WORKSPACE",
  );
}

async function configureBrowserApiTransport(context) {
  const apiOrigin = process.env.E2E_BROWSER_API_ORIGIN?.trim();
  if (!apiOrigin) return;
  await context.addInitScript(({ directApiOrigin }) => {
    const toDirectApiUrl = (value) => {
      const rawUrl = value instanceof Request ? value.url : String(value);
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/")) return value;
      return `${directApiOrigin}${parsed.pathname}${parsed.search}`;
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const directInput = toDirectApiUrl(input);
      if (input instanceof Request && directInput !== input) return nativeFetch(new Request(directInput, input), init);
      return nativeFetch(directInput, init);
    };
    const NativeEventSource = window.EventSource;
    window.EventSource = function EventSourceWithDirectApi(url, init) {
      return new NativeEventSource(toDirectApiUrl(url), init);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }, { directApiOrigin: apiOrigin });
}

async function bootstrapManager(page, auth, inviteCode) {
  const displayName = auth.user.displayName || auth.user.nickname;
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, user, savedName, roomInviteCode }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", savedName);
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, savedName);
  }, { token: auth.token, user: auth.user, savedName: displayName, roomInviteCode: inviteCode });
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await waitForRealtimeReady(page, "MANAGER");
}

async function bootstrapCandidate(page, inviteCode) {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((roomInviteCode) => {
    localStorage.setItem("display_name", "Publication candidate");
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, "Publication candidate");
  }, inviteCode);
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await waitForRealtimeReady(page, "CANDIDATE");
}

async function waitForRealtimeReady(page, label) {
  await page.locator("[data-testid='room-code-editor-host'] .cm-editor").waitFor({ timeout: 15_000 });
  const status = page.locator("[data-testid='room-connection-status']");
  await status.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction((element) => element.getAttribute("data-state") === "online", await status.elementHandle(), { timeout: 10_000 });
  await page.waitForTimeout(250);
  assertCondition((await status.getAttribute("data-state")) === "online", `${label}_REALTIME_NOT_READY`);
}

async function appendMarker(page, marker) {
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
  await waitForEditorMarker(page, marker, "WRITER");
}

async function waitForEditorMarker(page, marker, label) {
  await page.waitForFunction(
    (expectedMarker) => document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker),
    marker,
    { timeout: 10_000 },
  );
  const hasMarker = await page.evaluate((expectedMarker) =>
    document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker) ?? false,
  marker);
  assertCondition(hasMarker, `${label}_EDITOR_MARKER_MISSING ${marker}`);
}

async function waitForPublishedStep(page, taskTitle, label) {
  const title = page.locator("[data-testid='room-current-published-step-title']");
  await title.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ expectedTitle }) => document.querySelector("[data-testid='room-current-published-step-title']")?.textContent?.includes(expectedTitle),
    { expectedTitle: taskTitle },
    { timeout: 10_000 },
  );
  assertCondition(((await title.textContent()) ?? "").includes(taskTitle), `${label}_PUBLISHED_TITLE_MISSING`);
}

async function waitForRoomStep(token, inviteCode, expectedStep) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const room = await getRoom(token, inviteCode);
    if (room.currentStep === expectedStep) return room;
    await sleep(100);
  }
  const room = await getRoom(token, inviteCode);
  throw new Error(`PUBLISHED_STEP_TIMEOUT expected=${expectedStep} actual=${room.currentStep}`);
}

async function runPublicationPreservationRegression(browser, publicationMethod) {
  const fixture = await createFixture();
  const ownerContext = await browser.newContext();
  const publisherContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  try {
    await Promise.all([
      configureBrowserApiTransport(ownerContext),
      configureBrowserApiTransport(publisherContext),
      configureBrowserApiTransport(candidateContext),
    ]);
    let candidateEventAuth = null;
    await candidateContext.route(`**/api/realtime/rooms/${fixture.room.inviteCode}/events`, async (route) => {
      try {
        const payload = JSON.parse(route.request().postData() || "{}");
        if (!candidateEventAuth && payload.sessionId && payload.eventToken) {
          candidateEventAuth = {
            sessionId: payload.sessionId,
            eventToken: payload.eventToken,
          };
        }
      } catch {}
      await route.continue();
    });
    const ownerPage = await ownerContext.newPage();
    const publisherPage = await publisherContext.newPage();
    const candidatePage = await candidateContext.newPage();

    const preparedTarget = `// PREPARED_TARGET_${uniqueId()}\n`;
    await updateWorkspace(fixture.owner.token, fixture.room.inviteCode, 1, preparedTarget, 0);

    await bootstrapManager(ownerPage, fixture.owner, fixture.room.inviteCode);
    await bootstrapManager(publisherPage, fixture.publisher, fixture.room.inviteCode);
    await bootstrapCandidate(candidatePage, fixture.room.inviteCode);

    // Both edits are observed by another browser first: they have entered the
    // server's public realtime state, but the former 750 ms durable save window
    // is still open when the other interviewer publishes task 2.
    const ownerMarker = `OWNER_ACCEPTED_${uniqueId()}`;
    const candidateMarker = `CANDIDATE_ACCEPTED_${uniqueId()}`;
    await appendMarker(ownerPage, ownerMarker);
    await waitForEditorMarker(candidatePage, ownerMarker, "CANDIDATE_RECEIVES_OWNER");
    await appendMarker(candidatePage, candidateMarker);
    await waitForEditorMarker(ownerPage, candidateMarker, "OWNER_RECEIVES_CANDIDATE");

    if (publicationMethod === "realtime") {
      await publisherPage.locator("[data-testid='room-step-row-1']").click();
      await waitForEditorMarker(publisherPage, "PREPARED_TARGET_", "PUBLISHER_PREPARES_TARGET");
      const publish = publisherPage.locator("[data-testid='room-publish-step']");
      await publish.waitFor({ state: "visible", timeout: 10_000 });
      await publish.click();
    } else if (publicationMethod === "legacy-rest") {
      await requestJson(
        `/rooms/${fixture.room.inviteCode}/next-step`,
        { method: "POST", headers: { Authorization: `Bearer ${fixture.publisher.token}` } },
        "PUBLISH_VIA_LEGACY_REST",
      );
    } else {
      throw new Error(`UNKNOWN_PUBLICATION_METHOD ${publicationMethod}`);
    }

    await waitForRoomStep(fixture.owner.token, fixture.room.inviteCode, 1);
    await waitForPublishedStep(candidatePage, fixture.tasks[1].title, "CANDIDATE");
    await waitForEditorMarker(candidatePage, "PREPARED_TARGET_", "CANDIDATE_TARGET_CODE");

    // Simulate the arrival of a real old-scope event after the transition. It
    // must be ignored rather than applied to the new task's document.
    assertCondition(candidateEventAuth, "CANDIDATE_EVENT_AUTH_NOT_CAPTURED");
    const delayedOldScopeResponse = await fetch(`${apiBaseUrl}/realtime/rooms/${fixture.room.inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: candidateEventAuth.sessionId,
        eventToken: candidateEventAuth.eventToken,
        clientEventSequence: Number.MAX_SAFE_INTEGER - 1,
        type: "yjs_update",
        yjsUpdate: "AQID",
        syncKey: `${fixture.room.inviteCode}:0:nodejs`,
        code: `LATE_OLD_SCOPE_${uniqueId()}`,
        yjsClientSequence: Number.MAX_SAFE_INTEGER - 1,
        baseServerYjsSequence: 0,
      }),
    });
    assertCondition(delayedOldScopeResponse.ok, `DELAYED_OLD_SCOPE_EVENT_FAILED status=${delayedOldScopeResponse.status}`);

    // A debounced write for the old public step used to look up room.currentStep
    // here and overwrite the newly published task for everybody.
    await sleep(1_100);
    const publishedRoom = await getRoom(fixture.owner.token, fixture.room.inviteCode);
    assertCondition(publishedRoom.code.includes("PREPARED_TARGET_"), `TARGET_CODE_LOST_AFTER_PUBLICATION actual=${publishedRoom.code}`);
    assertCondition(!publishedRoom.code.includes(ownerMarker), `OLD_OWNER_CODE_OVERWROTE_TARGET actual=${publishedRoom.code}`);
    assertCondition(!publishedRoom.code.includes(candidateMarker), `OLD_CANDIDATE_CODE_OVERWROTE_TARGET actual=${publishedRoom.code}`);

    // The owner's independent local choice becomes manager workspace 1 after
    // publication and must retain every edit the server had accepted.
    const previousWorkspace = await getWorkspace(fixture.owner.token, fixture.room.inviteCode, 0);
    assertCondition(previousWorkspace.code.includes(ownerMarker), `OWNER_EDIT_LOST_FROM_PREVIOUS_STEP actual=${previousWorkspace.code}`);
    assertCondition(previousWorkspace.code.includes(candidateMarker), `CANDIDATE_EDIT_LOST_FROM_PREVIOUS_STEP actual=${previousWorkspace.code}`);
    await waitForEditorMarker(ownerPage, ownerMarker, "OWNER_REOPENS_PREVIOUS_STEP");
    await waitForEditorMarker(ownerPage, candidateMarker, "OWNER_REOPENS_PREVIOUS_STEP");

    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    await waitForRealtimeReady(ownerPage, "OWNER_RELOAD");
    await waitForEditorMarker(ownerPage, ownerMarker, "OWNER_RELOAD_PREVIOUS_STEP");
    await waitForEditorMarker(ownerPage, candidateMarker, "OWNER_RELOAD_PREVIOUS_STEP");
  } finally {
    await Promise.all([ownerContext.close(), publisherContext.close(), candidateContext.close()].map((promise) => promise.catch(() => {})));
  }
}

const browser = await chromium.launch({ headless: true });

try {
  await runPublicationPreservationRegression(browser, "realtime");
  await runPublicationPreservationRegression(browser, "legacy-rest");
  console.log("PUBLIC_STEP_PUBLICATION_PRESERVATION_OK");
} catch (error) {
  console.error("PUBLIC_STEP_PUBLICATION_PRESERVATION_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
