import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function shortId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(path, options, label) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status} body=${raw}`);
  }
  if (!response.ok) throw new Error(`${label}_FAILED status=${response.status} body=${JSON.stringify(payload)}`);
  return payload;
}

async function registerUser(prefix) {
  const nickname = `${prefix}_${shortId()}`;
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

async function createTask(token, topology, index) {
  return requestJson(
    "/me/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: `${topology} task ${index} ${shortId()}`,
        description: `INTEGRITY_TASK_${index}`,
        starterCode: `// INTEGRITY_TASK_${index}\n`,
        language: "nodejs",
      }),
    },
    "CREATE_TASK",
  );
}

async function createFixture(topology, taskCount = 3) {
  const userPrefix = topology === "integrity_hydration" ? "ih" : "ir";
  const owner = await registerUser(`${userPrefix}_o`);
  const interviewer = await registerUser(`${userPrefix}_i`);
  const tasks = [];
  for (let index = 0; index < taskCount; index += 1) tasks.push(await createTask(owner.token, topology, index));
  const room = await requestJson(
    "/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ title: `${topology} ${shortId()}`, taskIds: tasks.map((task) => task.id) }),
    },
    "CREATE_ROOM",
  );
  await requestJson(
    `/rooms/${room.inviteCode}/participants/${interviewer.user.id}/role`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}` },
      body: JSON.stringify({ role: "interviewer" }),
    },
    "GRANT_INTERVIEWER",
  );
  return { owner, interviewer, room, tasks };
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

async function waitForWorkspaceMarker(token, inviteCode, stepIndex, marker) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const workspace = await getWorkspace(token, inviteCode, stepIndex);
    if (workspace.code.includes(marker)) return workspace;
    await sleep(120);
  }
  const workspace = await getWorkspace(token, inviteCode, stepIndex);
  throw new Error(`WORKSPACE_MARKER_TIMEOUT expected=${marker} actual=${workspace.code}`);
}

async function configureBrowserApiTransport(context) {
  const apiOrigin = process.env.E2E_BROWSER_API_ORIGIN?.trim();
  if (!apiOrigin) return;
  await context.addInitScript(({ apiOrigin: directApiOrigin }) => {
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
  }, { apiOrigin });
}

async function delayManagerWorkspaceHydration(context, delayMs) {
  await context.addInitScript((delay) => {
    const NativeEventSource = window.EventSource;
    class DelayedManagerWorkspaceEventSource extends NativeEventSource {
      set onmessage(handler) {
        super.onmessage = typeof handler !== "function"
          ? handler
          : function delayedMessage(event) {
              try {
                if (JSON.parse(event.data)?.type === "manager_workspace_sync") {
                  window.setTimeout(() => handler.call(this, event), delay);
                  return;
                }
              } catch {}
              handler.call(this, event);
            };
      }

      get onmessage() {
        return super.onmessage;
      }
    }
    window.EventSource = DelayedManagerWorkspaceEventSource;
  }, delayMs);
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
  await page.locator("[data-testid='room-code-editor-host'] .cm-editor").waitFor({ timeout: 15_000 });
  const status = page.locator("[data-testid='room-connection-status']");
  await page.waitForFunction((element) => element.getAttribute("data-state") === "online", await status.elementHandle(), { timeout: 10_000 });
  await page.waitForTimeout(250);
}

async function bootstrapCandidate(page, inviteCode) {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((roomInviteCode) => {
    localStorage.setItem("display_name", "Former public task candidate");
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, "Former public task candidate");
  }, inviteCode);
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-testid='room-code-editor-host'] .cm-editor").waitFor({ timeout: 15_000 });
  const status = page.locator("[data-testid='room-connection-status']");
  await page.waitForFunction((element) => element.getAttribute("data-state") === "online", await status.elementHandle(), { timeout: 10_000 });
  await page.waitForTimeout(250);
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
}

async function waitForManagerWorkspaceEditor(page, stepIndex) {
  await page.waitForFunction(
    (expectedStepIndex) => {
      const context = document.querySelector("[data-testid='room-current-local-step-context']");
      const host = document.querySelector("[data-testid='room-code-editor-host']");
      return (
        context?.getAttribute("data-step-index") === String(expectedStepIndex) &&
        Boolean(host?.__roomEditorView?.state?.doc)
      );
    },
    stepIndex,
    { timeout: 10_000 },
  );
}

async function waitForEditorMarker(page, marker, label) {
  await page.waitForFunction(
    (expectedMarker) => document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker),
    marker,
    { timeout: 10_000 },
  );
  assertCondition(
    await page.evaluate((expectedMarker) =>
      document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker) ?? false,
    marker),
    `${label}_MARKER_MISSING ${marker}`,
  );
}

async function waitForEditorMarkerRemoval(page, marker, label) {
  await page.waitForFunction(
    (expectedMarker) => !document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker),
    marker,
    { timeout: 10_000 },
  );
  assertCondition(
    !(await page.evaluate((expectedMarker) =>
      document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker) ?? false,
    marker)),
    `${label}_MARKER_NOT_REMOVED ${marker}`,
  );
}

async function removeMarker(page, marker) {
  await page.evaluate((targetMarker) => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    const view = host?.__roomEditorView;
    const source = view?.state?.doc?.toString?.() ?? "";
    const from = source.indexOf(targetMarker);
    if (from < 0) throw new Error(`MARKER_NOT_PRESENT ${targetMarker}`);
    const to = from + targetMarker.length;
    view.dispatch({ changes: { from, to, insert: "" } });
  }, marker);
}

async function waitForPublishedStep(page, title, label) {
  const currentTitle = page.locator("[data-testid='room-current-published-step-title']");
  await currentTitle.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    (expectedTitle) => document.querySelector("[data-testid='room-current-published-step-title']")?.textContent?.includes(expectedTitle),
    title,
    { timeout: 10_000 },
  );
  assertCondition(((await currentTitle.textContent()) ?? "").includes(title), `${label}_PUBLISHED_STEP_MISSING`);
}

async function runDelayedHydrationRegression(browser) {
  const fixture = await createFixture("integrity_hydration");
  const ownerContext = await browser.newContext();
  const delayedContext = await browser.newContext();
  try {
    await configureBrowserApiTransport(ownerContext);
    await configureBrowserApiTransport(delayedContext);
    await delayManagerWorkspaceHydration(delayedContext, 1_500);
    await delayedContext.route(`**/api/rooms/${fixture.room.inviteCode}/tasks/1/workspace`, async (route) => {
      await sleep(1_500);
      await route.continue();
    });
    const delayedPage = await delayedContext.newPage();
    const savedMarker = `AUTHORITATIVE_DRAFT_${shortId()}`;
    await updateWorkspace(
      fixture.owner.token,
      fixture.room.inviteCode,
      1,
      `// AUTHORITATIVE_MANAGER_WORKSPACE\n${savedMarker}\n`,
      0,
    );
    await waitForWorkspaceMarker(fixture.owner.token, fixture.room.inviteCode, 1, savedMarker);

    await bootstrapManager(delayedPage, fixture.interviewer, fixture.room.inviteCode);
    await delayedPage.locator("[data-testid='room-step-row-1']").click();
    await sleep(900);
    const duringDelayedHydration = await getWorkspace(fixture.owner.token, fixture.room.inviteCode, 1);
    assertCondition(
      duringDelayedHydration.code.includes(savedMarker),
      `FALLBACK_SNAPSHOT_OVERWROTE_AUTHORITATIVE_DRAFT actual=${duringDelayedHydration.code}`,
    );
    await delayedPage.waitForFunction(
      (expectedMarker) => document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker),
      savedMarker,
      { timeout: 10_000 },
    );
  } finally {
    await ownerContext.close().catch(() => {});
    await delayedContext.close().catch(() => {});
  }
}

async function runTaskReindexRegression(browser) {
  const fixture = await createFixture("integrity_reindex", 4);
  const ownerContext = await browser.newContext();
  const interviewerContext = await browser.newContext();
  try {
    await Promise.all([configureBrowserApiTransport(ownerContext), configureBrowserApiTransport(interviewerContext)]);
    const ownerPage = await ownerContext.newPage();
    const interviewerPage = await interviewerContext.newPage();
    await bootstrapManager(ownerPage, fixture.owner, fixture.room.inviteCode);
    await bootstrapManager(interviewerPage, fixture.interviewer, fixture.room.inviteCode);
    await interviewerPage.locator("[data-testid='room-step-row-2']").click();
    await waitForManagerWorkspaceEditor(interviewerPage, 2);
    const protectedMarker = `ORIGINAL_TASK_C_${shortId()}`;
    await appendMarker(interviewerPage, protectedMarker);
    await waitForWorkspaceMarker(fixture.owner.token, fixture.room.inviteCode, 2, protectedMarker);

    await requestJson(
      `/rooms/${fixture.room.inviteCode}/tasks/1`,
      { method: "DELETE", headers: { Authorization: `Bearer ${fixture.owner.token}` } },
      "DELETE_EARLIER_TASK",
    );
    await sleep(3_100);
    const shiftedSlot = await getWorkspace(fixture.owner.token, fixture.room.inviteCode, 2);
    assertCondition(
      !shiftedSlot.code.includes(protectedMarker),
      `STALE_WORKSPACE_WAS_PERSISTED_TO_SHIFTED_TASK actual=${shiftedSlot.code}`,
    );
    assertCondition(
      shiftedSlot.code.includes("INTEGRITY_TASK_3"),
      `SHIFTED_TASK_CONTENT_CHANGED_UNEXPECTEDLY actual=${shiftedSlot.code}`,
    );
  } finally {
    await ownerContext.close().catch(() => {});
    await interviewerContext.close().catch(() => {});
  }
}

async function runFormerPublicTaskConvergenceRegression(browser) {
  const fixture = await createFixture("integrity_former_public", 2);
  const ownerContext = await browser.newContext();
  const interviewerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  try {
    await Promise.all([
      configureBrowserApiTransport(ownerContext),
      configureBrowserApiTransport(interviewerContext),
      configureBrowserApiTransport(candidateContext),
    ]);
    const ownerPage = await ownerContext.newPage();
    const interviewerPage = await interviewerContext.newPage();
    const candidatePage = await candidateContext.newPage();
    await bootstrapManager(ownerPage, fixture.owner, fixture.room.inviteCode);
    await bootstrapManager(interviewerPage, fixture.interviewer, fixture.room.inviteCode);
    await bootstrapCandidate(candidatePage, fixture.room.inviteCode);

    await ownerPage.locator("[data-testid='room-step-row-1']").click();
    await waitForManagerWorkspaceEditor(ownerPage, 1);
    await ownerPage.locator("[data-testid='room-publish-step']").click();
    await waitForPublishedStep(candidatePage, fixture.tasks[1].title, "CANDIDATE_AFTER_PUBLICATION");

    await ownerPage.locator("[data-testid='room-step-row-0']").click();
    await interviewerPage.locator("[data-testid='room-step-row-0']").click();
    await Promise.all([
      waitForManagerWorkspaceEditor(ownerPage, 0),
      waitForManagerWorkspaceEditor(interviewerPage, 0),
    ]);

    const ownerMarker = `FORMER_PUBLIC_OWNER_${shortId()}`;
    const interviewerMarker = `FORMER_PUBLIC_INTERVIEWER_${shortId()}`;
    await Promise.all([
      appendMarker(ownerPage, ownerMarker),
      appendMarker(interviewerPage, interviewerMarker),
    ]);
    await Promise.all([
      waitForEditorMarker(ownerPage, ownerMarker, "OWNER_LOCAL_CONCURRENT_EDIT"),
      waitForEditorMarker(ownerPage, interviewerMarker, "OWNER_RECEIVES_CONCURRENT_INTERVIEWER_EDIT"),
      waitForEditorMarker(interviewerPage, ownerMarker, "INTERVIEWER_RECEIVES_CONCURRENT_OWNER_EDIT"),
      waitForEditorMarker(interviewerPage, interviewerMarker, "INTERVIEWER_LOCAL_CONCURRENT_EDIT"),
    ]);

    await removeMarker(interviewerPage, ownerMarker);
    await Promise.all([
      waitForEditorMarkerRemoval(ownerPage, ownerMarker, "OWNER_RECEIVES_FORMER_PUBLIC_DELETE"),
      waitForEditorMarkerRemoval(interviewerPage, ownerMarker, "INTERVIEWER_LOCAL_DELETE"),
    ]);
    const formerWorkspace = await getWorkspace(fixture.owner.token, fixture.room.inviteCode, 0);
    assertCondition(
      !formerWorkspace.code.includes(ownerMarker),
      `FORMER_PUBLIC_DELETE_NOT_DURABLE actual=${formerWorkspace.code}`,
    );
    await waitForEditorMarker(candidatePage, "INTEGRITY_TASK_1", "CANDIDATE_STAYS_ON_CURRENT_PUBLIC_TASK");
    await Promise.all([
      waitForEditorMarkerRemoval(candidatePage, ownerMarker, "CANDIDATE_DOES_NOT_SEE_OWNER_FORMER_PUBLIC_WORKSPACE"),
      waitForEditorMarkerRemoval(candidatePage, interviewerMarker, "CANDIDATE_DOES_NOT_SEE_INTERVIEWER_FORMER_PUBLIC_WORKSPACE"),
    ]);
  } finally {
    await Promise.all([ownerContext.close(), interviewerContext.close(), candidateContext.close()].map((promise) => promise.catch(() => {})));
  }
}

const browser = await chromium.launch({ headless: true });

try {
  await runDelayedHydrationRegression(browser);
  await runTaskReindexRegression(browser);
  await runFormerPublicTaskConvergenceRegression(browser);
  console.log("MANAGER_WORKSPACE_INTEGRITY_OK");
} catch (error) {
  console.error("MANAGER_WORKSPACE_INTEGRITY_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
