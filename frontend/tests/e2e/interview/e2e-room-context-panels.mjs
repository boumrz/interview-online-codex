import * as decoding from "lib0/decoding";
import * as Y from "yjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const surfaceNames = ["Шаги", "Мои заметки", "Чат", "Активность"];
const surfaceRegionNames = {
  "Редактор": "Редактор",
  "Шаги": "Шаги",
  "Условие": "Условие",
  "Мои заметки": "Мои заметки",
  "Чат": "Чат интервьюеров",
  "Активность": "Активность кандидата",
};
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const lifecycleLinePattern = /^ROOM_REALTIME_LIFECYCLE_DIAG sequence=(\d+) reason=(normal-close|route-unmount|transport-error|replacement) registryConnections=(\d+) registryParticipants=(\d+) registryRoomMemberships=(\d+) hikariActive=(\d+) hikariIdle=(\d+)$/;

function isExactRelayUrl(value, inviteCode) {
  const actual = new URL(value);
  const apiUrl = new URL(api);
  const allowedOrigins = new Set([new URL(web).origin, apiUrl.origin]);
  return allowedOrigins.has(actual.origin) &&
    actual.pathname === `${apiUrl.pathname.replace(/\/$/, "")}/realtime/rooms/${inviteCode}/events` &&
    actual.search === "";
}

let browser;
let fixtures;

async function request(path, { token, method = "GET", body, expected = [200] } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.ok(expected.includes(response.status), `${method} ${path}: status=${response.status} body=${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

async function register(displayName) {
  return request("/auth/register", {
    method: "POST",
    body: {
      nickname: `ac11_${unique()}`.slice(0, 32),
      displayName,
      password: "test-password-123",
    },
  });
}

async function createTask(auth, ordinal) {
  const longRussian = "Очень длинное русское условие проверяет перенос текста и локальную прокрутку без расширения всей страницы. ";
  const taskSpecificCondition = ordinal === 1
    ? "Публичное условие первого шага: построить устойчивую очередь доставки. "
    : "Локальное условие второго шага: восстановить порядок событий после разрыва. ";
  return request("/me/tasks", {
    token: auth.token,
    method: "POST",
    body: {
      title: `${ordinal}. Устойчивый порядок элементов в распределённой системе ${unique()}`,
      description: `${taskSpecificCondition}${longRussian.repeat(18)}`,
      starterCode: Array.from(
        { length: 72 },
        (_, line) => `const значениеСтроки${line} = очередьОбработкиОченьДлинногоИмени[${line}] ?? "сохранить-локальный-контекст";`,
      ).join("\n"),
      language: "nodejs",
    },
  });
}

async function createAuthenticatedRoom(owner, taskIds) {
  return request("/rooms", {
    token: owner.token,
    method: "POST",
    body: {
      title: `Личное интервью с длинным русским названием ${unique()}`,
      taskIds,
    },
  });
}

async function createGuestRoom() {
  return request("/public/rooms", {
    method: "POST",
    body: {
      title: `Гостевое интервью ${unique()}`,
      ownerDisplayName: "Гостевой менеджер комнаты",
      language: "nodejs",
    },
  });
}

async function grantInterviewer(owner, room, interviewer) {
  await request(`/rooms/${room.inviteCode}/participants/${interviewer.user.id}/role`, {
    token: owner.token,
    method: "POST",
    body: { role: "interviewer" },
  });
}

async function waitForRoomStep(auth, room, expectedStep, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
    if (snapshot.currentStep === expectedStep) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const finalSnapshot = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
  assert.equal(finalSnapshot.currentStep, expectedStep, `${label}_PUBLISHED_STEP_NOT_PERSISTED`);
  return finalSnapshot;
}

async function waitForRoomScore(auth, room, stepIndex, expectedScore) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
    if (snapshot.tasks[stepIndex]?.score === expectedScore) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const finalSnapshot = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
  assert.equal(finalSnapshot.tasks[stepIndex]?.score, expectedScore, "AC11_SCORE_NOT_PERSISTED_IN_API");
  return finalSnapshot;
}

async function settleLayout(page) {
  await page.evaluate(async () => {
    let previous = "";
    let stableFrames = 0;
    for (let frame = 0; frame < 16 && stableFrames < 2; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const root = document.documentElement;
      const signature = `${root.clientWidth}:${root.clientHeight}:${root.scrollWidth}:${root.scrollHeight}`;
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
    }
  });
}

async function openRoom({ auth, room, ownerToken, displayName = "Участник AC-11", viewport = { width: 1280, height: 720 }, acceptDownloads = false }) {
  const context = await browser.newContext({ viewport, acceptDownloads });
  await context.addInitScript(() => {
    window.__ac11SseMessages = [];
    window.__ac11SseSources = [];
    window.__ac11SseTrace = [];
    window.__ac11HoldSseErrors = false;
    const NativeEventSource = window.EventSource;
    window.EventSource = new Proxy(NativeEventSource, {
      construct(Target, args) {
        const source = new Target(...args);
        const trace = (type) => window.__ac11SseTrace.push({ type, at: performance.now() });
        const nativeClose = source.close.bind(source);
        source.close = () => {
          trace("close");
          return nativeClose();
        };
        source.addEventListener("open", () => trace("open"));
        source.addEventListener("error", (event) => {
          trace("error");
          if (window.__ac11HoldSseErrors) event.stopImmediatePropagation();
        });
        source.addEventListener("message", (event) => {
          window.__ac11SseMessages.push({ at: performance.now(), data: event.data });
        });
        window.__ac11SseSources.push(source);
        return source;
      },
    });
  });
  await context.addInitScript(({ authValue, inviteCode, ownerTokenValue, displayNameValue }) => {
    if (authValue) {
      localStorage.setItem("auth_token", authValue.token);
      localStorage.setItem("auth_user", JSON.stringify(authValue.user));
    }
    if (ownerTokenValue) localStorage.setItem(`owner_token_${inviteCode}`, ownerTokenValue);
    localStorage.setItem("display_name", displayNameValue);
    localStorage.setItem(`guest_display_name_${inviteCode}`, displayNameValue);
  }, {
    authValue: auth ?? null,
    inviteCode: room.inviteCode,
    ownerTokenValue: ownerToken ?? null,
    displayNameValue: displayName,
  });
  const page = await openRoomPage(context, room, displayName);
  return { context, page };
}

async function openRoomPage(context, room, displayName) {
  const page = await context.newPage();
  const networkTrace = [];
  const consoleTrace = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/rooms/") || path.startsWith("/api/realtime/rooms/")) {
      networkTrace.push(`${response.status()} ${path}`);
    }
  });
  page.on("console", (entry) => {
    if (entry.type() === "error" || entry.text().includes("[room-sync]")) consoleTrace.push(entry.text().slice(0, 240));
  });
  page.setDefaultTimeout(8_000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  const nameInput = page.getByLabel("Ваше имя", { exact: true });
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill(displayName);
    await page.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  }
  try {
    await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ state: "attached", timeout: 15_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      pathname: location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      headings: Array.from(document.querySelectorAll("h1,h2,[role=alert]")).map((element) => element.textContent?.trim()).filter(Boolean),
      editorHosts: document.querySelectorAll('[data-testid="room-code-editor-host"]').length,
      editorPending: document.querySelectorAll('[data-testid="room-code-editor-pending"]').length,
      connectionState: document.querySelector('[data-testid="room-connection-status"]')?.getAttribute("data-state"),
      roomError: document.querySelector('[class*="RoomPage_error"]')?.textContent?.trim(),
      nameInputs: Array.from(document.querySelectorAll("input")).map((input) => input.getAttribute("aria-label")).filter(Boolean),
      bodyTail: document.body.innerText.slice(-1600),
      sseTrace: window.__ac11SseTrace?.slice(-12),
    }));
    throw new Error(`AC11_EDITOR_NOT_RENDERED:${JSON.stringify({ ...diagnostics, networkTrace: networkTrace.slice(-15), consoleTrace: consoleTrace.slice(-15) })}`, { cause: error });
  }
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ state: "attached", timeout: 15_000 });
  await settleLayout(page);
  return page;
}

async function closeRoomContext(context) {
  for (const page of context.pages()) {
    if (!page.isClosed() && page.url().includes("/room/")) {
      await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  await context.close();
}

async function lifecycleRecords() {
  const lifecycleLog = process.env.E2E_REALTIME_LIFECYCLE_LOG;
  assert.ok(lifecycleLog, "AC11_LIFECYCLE_LOG_NOT_CONFIGURED");
  const contents = await readFile(lifecycleLog, "utf8");
  const completeLines = contents.endsWith("\n")
    ? contents.split(/\r?\n/)
    : contents.split(/\r?\n/).slice(0, -1);
  const lines = completeLines
    .map((line) => line.slice(line.indexOf("ROOM_REALTIME_LIFECYCLE_DIAG")))
    .filter((line) => line.startsWith("ROOM_REALTIME_LIFECYCLE_DIAG"));
  return lines.map((line) => {
    const match = lifecycleLinePattern.exec(line);
    assert.ok(match, `AC11_LIFECYCLE_LINE_SCHEMA_INVALID:${line}`);
    return {
      line,
      sequence: Number(match[1]),
      reason: match[2],
      registryConnections: Number(match[3]),
      registryParticipants: Number(match[4]),
      registryRoomMemberships: Number(match[5]),
      hikariActive: Number(match[6]),
      hikariIdle: Number(match[7]),
    };
  });
}

async function lifecycleBaseline(label) {
  const records = await lifecycleRecords();
  const latest = records.at(-1);
  assert.ok(latest, `${label}_LIFECYCLE_BASELINE_MISSING`);
  return latest;
}

async function lifecycleCursor() {
  const records = await lifecycleRecords();
  return records.at(-1)?.sequence ?? 0;
}

async function waitForLifecycleReturn({ afterSequence, expectedReasons, baseline, label }) {
  const deadline = Date.now() + 12_000;
  const expectedSequence = afterSequence + 1;
  while (Date.now() < deadline) {
    const records = await lifecycleRecords();
    const next = records.find((record) => record.sequence === expectedSequence);
    const later = records.find((record) => record.sequence > expectedSequence);
    assert.equal(later, undefined, `${label}_DIRECT_NEXT_SEQUENCE_MISSING_EXPECTED_${expectedSequence}:${later?.line}`);
    if (next) {
      assert.ok(expectedReasons.includes(next.reason), `${label}_UNEXPECTED_REASON:${next.line}`);
      if (baseline) {
        assert.deepEqual(
          {
            registryConnections: next.registryConnections,
            registryParticipants: next.registryParticipants,
            registryRoomMemberships: next.registryRoomMemberships,
          },
          {
            registryConnections: baseline.registryConnections,
            registryParticipants: baseline.registryParticipants,
            registryRoomMemberships: baseline.registryRoomMemberships,
          },
          `${label}_DID_NOT_RETURN_TO_PRE_ADMISSION_BASELINE:${next.line}`,
        );
      }
      return next;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label}_LIFECYCLE_RETURN_TIMEOUT_EXPECTED_DIRECT_SEQUENCE_${expectedSequence}`);
}

async function assertNoLifecycleRecordAfter({ afterSequence, label }) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const records = await lifecycleRecords();
    const unexpected = records.find((record) => record.sequence > afterSequence);
    assert.equal(unexpected, undefined, `${label}_STALE_CLOSE_EMITTED:${unexpected?.line}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function eventTokenFor(page, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const token = await page.evaluate(() => {
      for (const message of [...window.__ac11SseMessages].reverse()) {
        try {
          const parsed = JSON.parse(message.data);
          const eventToken = parsed?.type === "state_sync" ? parsed.payload?.eventToken : null;
          if (typeof eventToken === "string" && eventToken.length > 0) return eventToken;
        } catch {
          // A heartbeat or malformed non-state message cannot establish relay authority.
        }
      }
      return null;
    });
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label}_EVENT_TOKEN_NOT_OBSERVED`);
}

async function sessionIdFor(page, inviteCode, label) {
  const sessionId = await page.evaluate((roomInviteCode) => sessionStorage.getItem(`room_ws_session_id_${roomInviteCode}`), inviteCode);
  assert.ok(sessionId, `${label}_SESSION_ID_NOT_OBSERVED`);
  return sessionId;
}

async function eventSourceCount(page) {
  return page.evaluate(() => window.__ac11SseSources.length);
}

async function waitForExactlyEventSourceCount(page, expectedCount, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const count = await eventSourceCount(page);
    assert.ok(count <= expectedCount, `${label}_TOO_MANY_EVENT_SOURCES:${count}`);
    if (count === expectedCount) {
      const stabilizationDeadline = Date.now() + 500;
      while (Date.now() < stabilizationDeadline) {
        assert.equal(
          await eventSourceCount(page),
          expectedCount,
          `${label}_EVENT_SOURCE_COUNT_UNSTABLE`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label}_EXACT_EVENT_SOURCE_RECONNECT_TIMEOUT`);
}

async function directSurfaceTabs(page) {
  const tablist = page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true });
  assert.equal(
    await tablist.count(),
    1,
    "AC11_DIRECT_SURFACE_NAV_MISSING: expected one always-available tablist named «Рабочие области комнаты»",
  );
  const tabs = tablist.getByRole("tab");
  assert.equal(await tabs.count(), 4, "AC11_AUXILIARY_SURFACE_COUNT_WRONG");
  const names = await tabs.evaluateAll((elements) => elements.map((element) =>
    (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " "),
  ));
  assert.deepEqual(names, surfaceNames, "AC11_DIRECT_SURFACE_ORDER_OR_NAMES_WRONG");
  return { tablist, tabs };
}

async function assertSurfaceContent(page, name, region, expectedTasks = fixtures.tasks) {
  const task = expectedTasks[0];
  assert.ok(task, `AC11_${name}_EXPECTED_TASK_FIXTURE_MISSING`);
  const heading = region.getByRole("heading", { name: surfaceRegionNames[name], exact: true });
  if (name !== "Условие") assert.equal(await heading.count(), 1, `AC11_SURFACE_HEADING_MISSING:${name}`);
  if (name === "Редактор") {
    assert.equal(await region.locator('[data-testid="room-code-editor-host"] .cm-editor').count(), 1, "AC11_EDITOR_CONTENT_MISSING");
  } else if (name === "Шаги") {
    assert.equal(await region.locator('[data-testid^="room-step-row-"]').count(), expectedTasks.length, "AC11_STEPS_CONTENT_MISSING");
    assert.ok((await region.textContent()).includes(task.title), "AC11_STEP_TITLE_MISSING");
  } else if (name === "Условие") {
    const content = (await region.textContent()) ?? "";
    assert.ok(content.includes(task.title), "AC11_CONDITION_TITLE_MISSING");
    assert.ok(content.includes(task.description.slice(0, 120)), "AC11_CONDITION_BODY_MISSING");
  } else if (name === "Мои заметки") {
    assert.equal(await region.locator('[data-testid="room-private-notes-input"]').count(), 1, "AC11_PRIVATE_NOTES_EDITOR_MISSING");
    await region.getByRole("button", { name: "Кто видит мои заметки", exact: true }).hover();
    await page.getByRole("tooltip").filter({ hasText: "Заметки видны только вам" }).waitFor();
    await page.mouse.move(0, 0);
  } else if (name === "Чат") {
    assert.equal(await region.locator('[data-testid="room-notes-input"]').count(), 1, "AC11_CHAT_COMPOSER_MISSING");
    assert.equal(await region.locator('[data-testid="room-notes-send"]').count(), 1, "AC11_CHAT_SEND_MISSING");
    assert.match((await region.textContent()) ?? "", /Виден интервьюерам этой комнаты\. Кандидат не видит чат\./, "AC11_CHAT_AUDIENCE_MISSING");
  } else if (name === "Активность") {
    assert.equal(await region.getByLabel("История активности кандидата", { exact: true }).count(), 1, "AC11_ACTIVITY_HISTORY_MISSING");
  }
}

async function selectedSurface(page) {
  const selected = page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true }).getByRole("tab", { selected: true });
  assert.equal(await selected.count(), 1, "AC11_SELECTED_SURFACE_COUNT_WRONG");
  return ((await selected.getAttribute("aria-label")) || (await selected.textContent()) || "").trim().replace(/\s+/g, " ");
}

async function assertSurfaceOpen(page, name, expectedTasks) {
  const { tablist } = await directSurfaceTabs(page);
  const tab = tablist.getByRole("tab", { name, exact: true });
  assert.equal(await tab.getAttribute("aria-selected"), "true", `AC11_SURFACE_NOT_SELECTED:${name}`);
  const controls = await tab.getAttribute("aria-controls");
  assert.ok(controls, `AC11_SURFACE_CONTROLS_MISSING:${name}`);
  const region = page.locator(`#${controls}`);
  await region.waitFor({ state: "visible" });
  const semantics = await region.evaluate((element) => ({
    tagName: element.tagName,
    role: element.getAttribute("role"),
    labelledBy: element.getAttribute("aria-labelledby"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));
  assert.ok(semantics.role === "region" || semantics.tagName === "SECTION", `AC11_SURFACE_NOT_REGION:${name}`);
  assert.ok(semantics.labelledBy, `AC11_SURFACE_LABEL_RELATION_MISSING:${name}`);
  assert.notEqual(semantics.ariaHidden, "true", `AC11_SURFACE_ARIA_HIDDEN:${name}`);
  await assertSurfaceContent(page, name, region, expectedTasks);
  return { tab, region };
}

async function surfaceRegion(page, name) {
  if (name === "Редактор" || name === "Условие") {
    return page.getByRole("region", { name, exact: true });
  }
  const { tablist } = await directSurfaceTabs(page);
  const controls = await tablist.getByRole("tab", { name, exact: true }).getAttribute("aria-controls");
  assert.ok(controls, `AC11_SURFACE_CONTROLS_MISSING:${name}`);
  return page.locator(`#${controls}`);
}

async function openSurface(page, name, expectedTasks) {
  if (name === "Условие") {
    const toggle = page.locator("#room-condition-toggle");
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    const region = page.getByRole("region", { name, exact: true });
    await region.waitFor({ state: "visible" });
    await assertSurfaceContent(page, name, region, expectedTasks);
    return { region };
  }
  const { tablist } = await directSurfaceTabs(page);
  const tab = tablist.getByRole("tab", { name, exact: true });
  await tab.click();
  await settleLayout(page);
  return assertSurfaceOpen(page, name, expectedTasks);
}

async function visibleSurfaceRegions(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('[data-testid="room-context-surface-grid"] [data-room-context-surface]')]
      .filter(visible)
      .map((element) => {
        const direct = element.getAttribute("aria-label");
        if (direct) return direct;
        const labelledBy = element.getAttribute("aria-labelledby");
        return labelledBy?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim() || null;
      })
      .map((name) => name?.startsWith("Чат интервьюеров") ? "Чат"
        : name?.startsWith("Активность кандидата") ? "Активность"
          : name)
      .filter((name) => ["Редактор", "Шаги", "Условие", "Мои заметки", "Чат", "Активность"].includes(name));
  });
}

function postPayload(browserRequest) {
  try {
    return browserRequest.postDataJSON();
  } catch {
    return null;
  }
}

function exactManagerHeartbeat(browserRequest, { inviteCode, sessionId, stepIndex, code }) {
  const payload = postPayload(browserRequest);
  const expectedUrl = `${new URL(api).pathname.replace(/\/$/, "")}/realtime/rooms/${inviteCode}/events`;
  const expectedKeys = [
    "baseServerYjsSequence",
    "clientEventSequence",
    "code",
    "eventToken",
    "operationId",
    "sessionId",
    "stepIndex",
    "type",
    "yjsDocumentBase64",
    "yjsUpdate",
  ];
  const actualKeys = payload && typeof payload === "object" ? Object.keys(payload).sort() : [];
  const valid = browserRequest.method() === "POST" && isExactRelayUrl(browserRequest.url(), inviteCode) &&
    JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) &&
    payload.sessionId === sessionId &&
    typeof payload.eventToken === "string" && payload.eventToken.length > 0 &&
    Number.isInteger(payload.clientEventSequence) && payload.clientEventSequence > 0 &&
    payload.type === "manager_workspace_yjs_update" &&
    payload.stepIndex === stepIndex &&
    payload.yjsUpdate === "" &&
    payload.code === code &&
    typeof payload.yjsDocumentBase64 === "string" && payload.yjsDocumentBase64.length > 0 &&
    Number.isInteger(payload.baseServerYjsSequence) && payload.baseServerYjsSequence >= 0 &&
    typeof payload.operationId === "string" && /^manager-yjs-op-[0-9a-f-]{36}$/i.test(payload.operationId);
  return { valid, payload, expectedUrl, expectedKeys, actualKeys };
}

function exactManagerAwareness(payload, sessionId, stepIndex, documentBase64, selection) {
  const keys = ["awarenessUpdate", "clientEventSequence", "eventToken", "sessionId", "stepIndex", "type"];
  if (!payload || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(keys) ||
      payload.type !== "manager_workspace_awareness_update" || payload.sessionId !== sessionId ||
      payload.stepIndex !== stepIndex || payload.clientEventSequence !== null ||
      typeof payload.eventToken !== "string" || !payload.eventToken) return false;
  try {
    const decoder = decoding.createDecoder(Buffer.from(payload.awarenessUpdate, "base64"));
    if (decoding.readVarUint(decoder) !== 1) return false;
    decoding.readVarUint(decoder); // Yjs client identity
    decoding.readVarUint(decoder); // Awareness clock
    const state = JSON.parse(decoding.readVarString(decoder));
    if (state?.user?.sessionId !== sessionId) return false;
    if (state.cursor == null) return true;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(documentBase64, "base64"));
      const anchor = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.anchor), doc);
      const head = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.head), doc);
      return anchor?.index === selection.anchor && head?.index === selection.head;
    } finally { doc.destroy(); }
  } catch { return false; }
}

function createCountBarrier(source, expectedCount, label, timeoutMs = 7_000) {
  if (source.length >= expectedCount) return { promise: Promise.resolve(), notify: () => {} };
  let timer;
  let resolveBarrier;
  let rejectBarrier;
  const promise = new Promise((resolve, reject) => {
    resolveBarrier = resolve;
    rejectBarrier = reject;
    timer = setTimeout(() => reject(new Error(`${label}_NETWORK_BARRIER_TIMEOUT:${source.length}/${expectedCount}`)), timeoutMs);
  });
  return {
    promise,
    notify: () => {
      if (source.length < expectedCount) return;
      clearTimeout(timer);
      resolveBarrier();
    },
    reject: () => {
      clearTimeout(timer);
      rejectBarrier(new Error(`${label}_NETWORK_BARRIER_CANCELLED`));
    },
  };
}

async function assertVisibleKeyboardFocus(locator, label) {
  const focus = await locator.evaluate(async (element) => {
    const measure = () => {
    const style = getComputedStyle(element);
    return {
      active: document.activeElement === element,
      visible: style.outlineStyle !== "none" || style.boxShadow !== "none" || (() => {
        if (!element.matches("textarea")) return false;
        const probe = document.createElement("span");
        probe.style.color = "var(--app-focus)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return parseFloat(style.borderWidth) > 0 && style.borderColor === color;
      })(),
    };
    };
    const deadline = performance.now() + 1000;
    let result = measure();
    while (result.active && !result.visible && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      result = measure();
    }
    return result;
  });
  assert.deepEqual(focus, { active: true, visible: true }, `${label}_KEYBOARD_FOCUS_NOT_VISIBLE`);
}

async function assertTargetGeometry(locator, label) {
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const surfaceRect = element.closest("[data-room-context-surface]")?.getBoundingClientRect();
    const rootRect = element.closest("[data-room-context-mode]")?.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x, y);
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      surfaceBottom: surfaceRect?.bottom,
      rootBottom: rootRect?.bottom,
      rootTop: rootRect?.top,
      scrollY: window.scrollY,
      insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
      unobscured: Boolean(top && (top === element || element.contains(top))),
    };
  });
  assert.ok(geometry.width >= 32 && geometry.height >= 32, `${label}_TARGET_UNDERSIZED:${JSON.stringify(geometry)}`);
  assert.equal(geometry.insideViewport, true, `${label}_TARGET_OUTSIDE_VIEWPORT:${JSON.stringify(geometry)}`);
  assert.equal(geometry.unobscured, true, `${label}_TARGET_OBSCURED:${JSON.stringify(geometry)}`);
}

async function focusByKeyboard(page, target, label, limit = 100) {
  const handle = await target.elementHandle();
  assert.ok(handle, `${label}_TARGET_MISSING`);
  const trace = [];
  for (let index = 0; index < limit; index += 1) {
    if (await handle.evaluate((element) => document.activeElement === element)) {
      await assertVisibleKeyboardFocus(target, label);
      return;
    }
    if (index < 12) trace.push(await page.evaluate(() => {
      const element = document.activeElement;
      return { tag: element?.tagName, id: element?.id, testId: element?.getAttribute("data-testid"), label: element?.getAttribute("aria-label"), editable: element?.getAttribute("contenteditable") };
    }));
    // CodeMirror uses Tab for indentation; Escape then Tab is its keyboard exit.
    if (await page.evaluate(() => document.activeElement?.classList.contains("cm-content"))) await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
  }
  assert.fail(`${label}_NOT_REACHABLE_BY_KEYBOARD:${JSON.stringify(trace)}`);
}

async function assertRovingSurfaceTabs(page, { focusedName, selectedName, label }) {
  const { tablist, tabs } = await directSurfaceTabs(page);
  const states = await tabs.evaluateAll((elements) => elements.map((element) => ({
    name: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " "),
    selected: element.getAttribute("aria-selected") === "true",
    tabIndex: element.tabIndex,
    focused: document.activeElement === element,
  })));
  assert.deepEqual(
    states.filter((state) => state.tabIndex === 0).map((state) => state.name),
    [focusedName],
    `${label}_ROVING_TAB_STOP_WRONG:${JSON.stringify(states)}`,
  );
  assert.ok(
    states.filter((state) => state.name !== focusedName).every((state) => state.tabIndex === -1),
    `${label}_NONFOCUSED_TAB_IN_TAB_ORDER:${JSON.stringify(states)}`,
  );
  assert.deepEqual(
    states.filter((state) => state.focused).map((state) => state.name),
    [focusedName],
    `${label}_ROVING_FOCUS_WRONG:${JSON.stringify(states)}`,
  );
  assert.deepEqual(
    states.filter((state) => state.selected).map((state) => state.name),
    selectedName ? [selectedName] : [],
    `${label}_ROVING_SELECTION_WRONG:${JSON.stringify(states)}`,
  );
  await assertVisibleKeyboardFocus(tablist.getByRole("tab", { name: focusedName, exact: true }), `${label}_${focusedName}`);
}

async function moveAndActivateSurface(page, { navigationKey, name, activationKey, expectedTasks, label }) {
  const selectedBefore = await selectedSurface(page);
  await page.keyboard.press(navigationKey);
  await assertRovingSurfaceTabs(page, {
    focusedName: name,
    selectedName: selectedBefore,
    label: `${label}_${navigationKey}`,
  });
  await page.keyboard.press(activationKey);
  await settleLayout(page);
  await assertRovingSurfaceTabs(page, {
    focusedName: name,
    selectedName: name,
    label: `${label}_${activationKey}`,
  });
  return assertSurfaceOpen(page, name, expectedTasks);
}

async function activateSurfaceByKeyboard(page, name, expectedTasks, activationKey = "Enter") {
  const { tablist } = await directSurfaceTabs(page);
  const selectedTab = tablist.getByRole("tab", { selected: true });
  const selectedName = await selectedTab.count() ? await selectedSurface(page) : "";
  const entryTab = selectedName ? selectedTab : tablist.locator('[role="tab"][tabindex="0"]');
  await focusByKeyboard(page, entryTab, `AC11_${name}_TABLIST_ENTRY`);
  await page.keyboard.press("Home");
  await assertRovingSurfaceTabs(page, {
    focusedName: surfaceNames[0],
    selectedName,
    label: `AC11_${name}_HOME`,
  });
  for (let index = 0; index < surfaceNames.indexOf(name); index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await assertRovingSurfaceTabs(page, {
    focusedName: name,
    selectedName,
    label: `AC11_${name}_ARROW_TARGET`,
  });
  await page.keyboard.press(activationKey);
  await settleLayout(page);
  await assertRovingSurfaceTabs(page, {
    focusedName: name,
    selectedName: name,
    label: `AC11_${name}_${activationKey}`,
  });
  return assertSurfaceOpen(page, name, expectedTasks);
}

async function assertNoPairwiseOverlap(locators, label) {
  const boxes = [];
  for (const [name, locator] of locators) {
    const box = await locator.boundingBox();
    assert.ok(box, `${label}_${name}_BOX_MISSING`);
    boxes.push([name, box]);
  }
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const [leftName, left] = boxes[leftIndex];
      const [rightName, right] = boxes[rightIndex];
      const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
      const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
      assert.equal(width * height, 0, `${label}_PANELS_OVERLAP:${leftName}:${rightName}:${width}x${height}`);
    }
  }
}

async function assertContainedBy(container, locators, label) {
  const containerBox = await container.boundingBox();
  assert.ok(containerBox, `${label}_CONTAINER_BOX_MISSING`);
  for (const [name, locator] of locators) {
    const box = await locator.boundingBox();
    assert.ok(box, `${label}_${name}_BOX_MISSING`);
    const overflow = {
      left: Math.max(0, containerBox.x - box.x),
      top: Math.max(0, containerBox.y - box.y),
      right: Math.max(0, box.x + box.width - (containerBox.x + containerBox.width)),
      bottom: Math.max(0, box.y + box.height - (containerBox.y + containerBox.height)),
    };
    assert.ok(
      Object.values(overflow).every((value) => value <= 1),
      `${label}_${name}_OUTSIDE_CONTAINER:${JSON.stringify({ containerBox, box, overflow })}`,
    );
  }
}

async function assertActiveMode(page, expectedMode, label) {
  const mode = { "Фокус": "focus", "Рабочий": "work", "Обзор": "overview" }[expectedMode];
  await page.waitForFunction(mode => document.querySelector("[data-room-context-mode]")?.getAttribute("data-room-context-mode") === mode, mode);
  assert.equal(await page.locator("[data-room-context-mode]").getAttribute("data-room-context-mode"), mode, `${label}_AUTOMATIC_MODE_WRONG`);
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  const owner = await register("Владелец личной комнаты AC-11");
  const interviewer = await register("Назначенный интервьюер AC-11");
  const tasks = [await createTask(owner, 1), await createTask(owner, 2)];
  const room = await createAuthenticatedRoom(owner, tasks.map((task) => task.id));
  const resetRoom = await createAuthenticatedRoom(owner, tasks.map((task) => task.id));
  await grantInterviewer(owner, room, interviewer);
  const guestRoom = await createGuestRoom();
  fixtures = { owner, interviewer, tasks, room, resetRoom, guestRoom };
});

after(async () => {
  await browser?.close();
});

test("infrastructure: live API and the established room/editor are ready", { timeout: 30_000 }, async () => {
  const room = await request(`/rooms/${fixtures.room.inviteCode}`, { token: fixtures.owner.token });
  assert.equal(room.id, fixtures.room.id, "AC11_ROOM_PREFLIGHT_WRONG_ROOM");
  assert.equal(room.tasks.length, 2, "AC11_ROOM_PREFLIGHT_TASKS_MISSING");

  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room });
  try {
    assert.equal(await page.locator('[data-testid="room-code-editor-host"] .cm-editor').count(), 1);
    assert.equal(await page.locator('[data-testid="room-rail-tasks"]').count(), 1, "ESTABLISHED_TASKS_PANEL_MISSING");
    assert.equal(await page.locator('[data-testid="room-rail-tools"]').count(), 1, "ESTABLISHED_CHAT_LOGS_PANEL_MISSING");
  } finally {
    await closeRoomContext(context);
  }
});

test("personal owner, assigned interviewer and guest manager receive four direct auxiliary surfaces and a persistent condition", { timeout: 45_000 }, async () => {
  for (const actor of [
    { label: "personal owner", auth: fixtures.owner, room: fixtures.room },
    { label: "assigned interviewer", auth: fixtures.interviewer, room: fixtures.room },
    { label: "guest manager", room: fixtures.guestRoom, ownerToken: fixtures.guestRoom.ownerToken },
  ]) {
    const { context, page } = await openRoom(actor);
    try {
      await directSurfaceTabs(page);
      assert.ok(Array.isArray(actor.room.tasks) && actor.room.tasks.length > 0, `${actor.label}_TASK_FIXTURE_MISSING`);
      for (const name of surfaceNames) await openSurface(page, name, actor.room.tasks);
      await openSurface(page, "Условие", actor.room.tasks);
    } finally {
      await closeRoomContext(context);
    }
  }

});

test("keyboard-only navigation activates all four direct auxiliary room surfaces", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room });
  try {
    const { tablist } = await directSurfaceTabs(page);
    const selectedName = await selectedSurface(page);
    const selectedTab = tablist.getByRole("tab", { selected: true });
    await focusByKeyboard(page, selectedTab, "AC11_TABLIST_INITIAL_ENTRY");
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await tablist.evaluate((element) => element.contains(document.activeElement)),
      false,
      "AC11_TABLIST_SHIFT_TAB_DID_NOT_LEAVE_SINGLE_TAB_STOP",
    );
    await page.keyboard.press("Tab");
    await assertRovingSurfaceTabs(page, {
      focusedName: selectedName,
      selectedName,
      label: "AC11_TABLIST_ONE_TAB_ENTRY",
    });

    await moveAndActivateSurface(page, { navigationKey: "Home", name: "Шаги", activationKey: "Space", label: "AC11_KEYBOARD_STEPS" });
    await moveAndActivateSurface(page, { navigationKey: "ArrowRight", name: "Мои заметки", activationKey: "Enter", label: "AC11_KEYBOARD_NOTES" });
    await moveAndActivateSurface(page, { navigationKey: "ArrowRight", name: "Чат", activationKey: "Space", label: "AC11_KEYBOARD_CHAT" });
    await moveAndActivateSurface(page, { navigationKey: "ArrowRight", name: "Активность", activationKey: "Enter", label: "AC11_KEYBOARD_ACTIVITY" });
    await moveAndActivateSurface(page, { navigationKey: "ArrowLeft", name: "Чат", activationKey: "Space", label: "AC11_KEYBOARD_ARROW_LEFT" });
    await moveAndActivateSurface(page, { navigationKey: "End", name: "Активность", activationKey: "Enter", label: "AC11_KEYBOARD_END" });
    await moveAndActivateSurface(page, { navigationKey: "Home", name: "Шаги", activationKey: "Space", label: "AC11_KEYBOARD_HOME" });

    await activateSurfaceByKeyboard(page, "Чат");
    const chatInput = page.locator('[data-testid="room-notes-input"]');
    const chatSend = page.locator('[data-testid="room-notes-send"]');
    await focusByKeyboard(page, chatInput, "AC11_KEYBOARD_CHAT_INNER_INPUT");
    await page.keyboard.type("доступный черновик");
    await focusByKeyboard(page, chatSend, "AC11_KEYBOARD_CHAT_INNER_SEND");
  } finally {
    await closeRoomContext(context);
  }
});

test("candidate receives no manager surfaces, personal notes or publish action", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({ room: fixtures.room, displayName: "Кандидат AC-11" });
  try {
    assert.equal(await page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true }).count(), 0);
    assert.equal(await page.locator('[data-testid="room-private-notes-input"], [data-testid="room-notes-input"], [data-testid="room-publish-step"]').count(), 0);
    assert.equal(await page.getByText(/Чат интервьюеров|Активность кандидата|Мои заметки/).count(), 0);
  } finally {
    await closeRoomContext(context);
  }
});

test("focus mode keeps auxiliary surfaces reachable without restoring the editor tab", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 768, height: 1024 },
  });
  try {
    await assertActiveMode(page, "Фокус", "AC11_FOCUS_AUX_REACHABLE_MODE");
    await directSurfaceTabs(page);
    assert.equal(await page.getByRole("tab", { name: "Редактор", exact: true }).count(), 0, "AC11_FOCUS_EDITOR_TAB_RETURNED");
    assert.equal(await page.locator('#room-context-region-editor').count(), 1, "AC11_FOCUS_EDITOR_MOUNTED_REGION_MISSING");
    assert.equal(await selectedSurface(page), "Шаги", "AC11_FOCUS_STEPS_DEFAULT_MISSING");
    assert.ok(await page.getByRole("region", { name: "Условие", exact: true }).isVisible());

    await openSurface(page, "Чат");
    assert.deepEqual(await visibleSurfaceRegions(page), ["Чат"], "AC11_FOCUS_CHAT_NOT_SINGLE_VISIBLE_SURFACE");
    const backToEditor = page.getByRole("button", { name: "Вернуться к редактору", exact: true });
    await backToEditor.click();
    await settleLayout(page);
    assert.deepEqual(await visibleSurfaceRegions(page), ["Редактор"], "AC11_FOCUS_EDITOR_RETURN_FAILED");
  } finally {
    await closeRoomContext(context);
  }
});

test("participant header keeps the role visible without a redundant connected badge", { timeout: 45_000 }, async () => {
  for (const actor of [
    { label: "OWNER", auth: fixtures.owner, room: fixtures.room, role: "Владелец", tone: "teal" },
    { label: "INTERVIEWER", auth: fixtures.interviewer, room: fixtures.room, role: "Интервьюер", tone: "blue" },
    { label: "CANDIDATE", room: fixtures.room, displayName: "Кандидат с явной ролью AC-11", role: "Кандидат", tone: "blue" },
  ]) {
    const { context, page } = await openRoom(actor);
    try {
      const statusRow = page.locator('[data-testid="room-persistent-status"]');
      assert.equal(await statusRow.count(), 1, `${actor.label}_PERSISTENT_STATUS_ROW_MISSING`);
      const roleBadge = statusRow.locator('[data-testid="room-viewer-role-badge"]');
      await roleBadge.waitFor({ state: "visible" });
      assert.equal((await roleBadge.textContent())?.trim(), actor.role, `${actor.label}_VISIBLE_TEXT_ROLE_WRONG`);
      assert.equal(await roleBadge.getAttribute("data-role-tone"), actor.tone, `${actor.label}_ROLE_TONE_WRONG`);
      assert.equal(await statusRow.getByText("Соединение: установлено", { exact: true }).count(), 0);
    } finally {
      await closeRoomContext(context);
    }
  }
});

test("manager status row keeps candidate state without redundant published or local-step labels", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room });
  try {
    await openSurface(page, "Шаги");
    await page.locator('[data-testid="room-step-row-1"]').click();
    await openSurface(page, "Чат");

    const statusRow = page.locator('[data-testid="room-persistent-status"]');
    const localStep = statusRow.locator('[data-testid="room-local-step-status"]');
    const publishedStep = statusRow.locator('[data-testid="room-published-step-status"]');
    const candidateStatus = statusRow.locator('[data-testid="room-candidate-presence-status"]');
    assert.equal(await localStep.count(), 0, "AC11_REDUNDANT_LOCAL_STEP_VISIBLE");
    assert.equal(await publishedStep.count(), 0, "UI2_REDUNDANT_PUBLISHED_STEP_VISIBLE");
    assert.equal(
      await statusRow.evaluate((element) => element.closest('[data-room-context-surface]') === null),
      true,
      "AC11_MANAGER_STATUS_NESTED_IN_SWITCHABLE_SURFACE",
    );
    assert.equal(await candidateStatus.count(), 1, "AC11_CANDIDATE_STATUS_MISSING");
    assert.match((await candidateStatus.textContent())?.trim() ?? "", /^Кандидат: (не подключен|в фокусе|подключен)$/, "AC11_CANDIDATE_STATUS_NOT_EXPLICIT");
    assert.equal(await candidateStatus.getAttribute("role"), "status", "AC11_CANDIDATE_STATUS_ROLE_MISSING");
    assert.equal(await candidateStatus.getAttribute("aria-live"), "polite", "AC11_CANDIDATE_STATUS_ARIA_LIVE_MISSING");
  } finally {
    await closeRoomContext(context);
  }
});

test("persistent room status stays fully visible at 200% desktop and tablet equivalents", { timeout: 45_000 }, async () => {
  for (const viewport of [
    { label: "1024x600@200", width: 512, height: 300 },
    { label: "768x1024@200", width: 384, height: 512 },
  ]) {
    const { context, page } = await openRoom({
      auth: fixtures.owner,
      room: fixtures.room,
      viewport: { width: viewport.width, height: viewport.height },
    });
    try {
      await settleLayout(page);
      await assertActiveMode(page, "Фокус", `AC11_NARROW_FOCUS_${viewport.label}`);
      await directSurfaceTabs(page);
      assert.equal(await page.getByRole("tab", { name: "Редактор", exact: true }).count(), 0, `AC11_NARROW_EDITOR_TAB_RETURNED_${viewport.label}`);
      const editor = page.getByRole("region", { name: "Редактор", exact: true, includeHidden: true });
      assert.equal(await editor.count(), 1, `AC11_NARROW_EDITOR_DIRECT_REGION_MISSING_${viewport.label}`);
      assert.equal(await selectedSurface(page), "Шаги", `AC11_NARROW_DEFAULT_STEPS_MISSING_${viewport.label}`);
      await page.getByRole("button", { name: "Вернуться к редактору", exact: true }).click();
      await editor.waitFor({ state: "visible" });

      const statusRow = page.locator('[data-testid="room-persistent-status"]');
      const statusItems = [
        ["ROLE", statusRow.locator('[data-testid="room-viewer-role-badge"]')],
        ["CANDIDATE", statusRow.locator('[data-testid="room-candidate-presence-status"]')],
      ];

      const rowGeometry = await statusRow.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      });
      assert.ok(
        rowGeometry.scrollWidth <= rowGeometry.clientWidth + 1,
        `AC11_STATUS_HORIZONTAL_SCROLL_REQUIRED_${viewport.label}:${JSON.stringify(rowGeometry)}`,
      );

      for (const [name, item] of statusItems) {
        assert.equal(await item.count(), 1, `AC11_STATUS_${name}_MISSING_${viewport.label}`);
        const geometry = await item.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            fullyInsideViewport: rect.left >= 0 && rect.top >= 0 &&
              rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
          };
        });
        assert.equal(
          geometry.fullyInsideViewport,
          true,
          `AC11_STATUS_${name}_CLIPPED_${viewport.label}:${JSON.stringify(geometry)}`,
        );
      }
    } finally {
      await closeRoomContext(context);
    }
  }
});

test("owner and assigned interviewer select locally and publish only through the explicit action", { timeout: 45_000 }, async () => {
  const initialAdmissionBaseline = await lifecycleBaseline("AC11_INITIAL_PRE_ADMISSION");
  assert.deepEqual(
    {
      registryConnections: initialAdmissionBaseline.registryConnections,
      registryParticipants: initialAdmissionBaseline.registryParticipants,
      registryRoomMemberships: initialAdmissionBaseline.registryRoomMemberships,
    },
    { registryConnections: 0, registryParticipants: 0, registryRoomMemberships: 0 },
    `AC11_INITIAL_PRE_ADMISSION_REGISTRY_NOT_QUIESCENT:${initialAdmissionBaseline.line}`,
  );
  let preAdmissionBaseline;
  for (const [label, auth, targetStep] of [
    ["OWNER", fixtures.owner, 1],
    ["INTERVIEWER", fixtures.interviewer, 0],
  ]) {
    const { context, page } = await openRoom({ auth, room: fixtures.room });
    let contextClosed = false;
    try {
      const before = await request(`/rooms/${fixtures.room.inviteCode}`, { token: auth.token });
      await openSurface(page, "Шаги");
      assert.notEqual(before.currentStep, targetStep, `${label}_FIXTURE_TARGET_ALREADY_PUBLISHED`);
      await page.locator(`[data-testid="room-step-row-${targetStep}"]`).click();
      await settleLayout(page);
      const after = await request(`/rooms/${fixtures.room.inviteCode}`, { token: auth.token });
      assert.equal(after.currentStep, before.currentStep, `${label}_LOCAL_SELECTION_PUBLISHED_STEP`);
      const publish = page.locator('[data-testid="room-publish-step"]');
      assert.equal(await publish.count(), 1, `${label}_EXPLICIT_PUBLISH_ACTION_MISSING`);
      assert.match(`${await publish.textContent()} ${await publish.getAttribute("aria-label")}`, /Переключить/);
      assert.equal(await publish.isDisabled(), false, `${label}_EXPLICIT_PUBLISH_ACTION_DISABLED`);
      await publish.click();
      const persisted = await waitForRoomStep(auth, fixtures.room, targetStep, label);
      assert.equal(persisted.tasks[targetStep].title, fixtures.tasks[targetStep].title, `${label}_PUBLISHED_WRONG_TASK`);

      // Authenticated profile hydration can replace an initial stream during
      // admission. The close assertion starts immediately before actual close.
      const preClose = await lifecycleBaseline(`AC11_${label}_PRE_CLOSE`);
      console.log("AC11_LIFECYCLE_WINDOW", JSON.stringify({
        actor: label,
        preAdmissionSequence: initialAdmissionBaseline.sequence,
        preCloseSequence: preClose.sequence,
        preCloseAt: Date.now(),
        observedEventSources: await eventSourceCount(page),
      }));
      if (label === "OWNER") {
        await context.close();
        contextClosed = true;
        preAdmissionBaseline = await waitForLifecycleReturn({
          afterSequence: preClose.sequence,
          expectedReasons: ["normal-close", "route-unmount", "transport-error"],
          baseline: initialAdmissionBaseline,
          label: "AC11_BROWSER_CONTEXT_CLOSE",
        });
        assert.deepEqual(
          {
            registryConnections: preAdmissionBaseline.registryConnections,
            registryParticipants: preAdmissionBaseline.registryParticipants,
            registryRoomMemberships: preAdmissionBaseline.registryRoomMemberships,
          },
          {
            registryConnections: 0,
            registryParticipants: 0,
            registryRoomMemberships: 0,
          },
          `AC11_FIRST_FORCED_CLOSE_REGISTRY_NOT_QUIESCENT:${preAdmissionBaseline.line}`,
        );
        assert.equal(
          preAdmissionBaseline.hikariActive,
          0,
          `AC11_FIRST_FORCED_CLOSE_HIKARI_NOT_QUIESCENT:${preAdmissionBaseline.line}`,
        );
      } else {
        await page.goto(`${web}/`, { waitUntil: "domcontentloaded" });
        await waitForLifecycleReturn({
          afterSequence: preClose.sequence,
          expectedReasons: ["route-unmount"],
          baseline: preAdmissionBaseline,
          label: "AC11_ROOM_ROUTE_UNMOUNT",
        });
        await closeRoomContext(context);
        contextClosed = true;
      }
    } finally {
      if (!contextClosed) await context.close();
    }
  }

  // Keep the display name stable during the controlled lease-replacement window.
  // A real authenticated display-name change legitimately restarts the stream
  // and is covered by the multi-participant startup transport checks.
  const lifecycleOwner = await register("Участник");
  const lifecycleRoom = await createAuthenticatedRoom(lifecycleOwner, []);
  const { context: lifecycleContext, page: oldLeasePage } = await openRoom({
    auth: lifecycleOwner,
    room: lifecycleRoom,
    displayName: "Участник",
  });
  let lifecycleContextClosed = false;
  try {
    await waitForExactlyEventSourceCount(oldLeasePage, 1, "AC11_LATER_ROOM_EDITOR_SSE_ADMISSION");
    const oldEventToken = await eventTokenFor(oldLeasePage, "AC11_OLD_LEASE");
    const sharedSessionId = await sessionIdFor(oldLeasePage, lifecycleRoom.inviteCode, "AC11_OLD_LEASE");
    await oldLeasePage.evaluate(() => {
      window.__ac11HoldSseErrors = true;
    });

    const replacementBaseline = {
      ...preAdmissionBaseline,
      registryConnections: preAdmissionBaseline.registryConnections + 1,
      registryParticipants: preAdmissionBaseline.registryParticipants + 1,
      registryRoomMemberships: preAdmissionBaseline.registryRoomMemberships + 1,
    };
    const replacementCursor = await lifecycleBaseline("AC11_REPLACEMENT_PRE_ADMISSION");
    await lifecycleContext.addInitScript(({ inviteCode, sessionId }) => {
      sessionStorage.setItem(`room_ws_session_id_${inviteCode}`, sessionId);
    }, { inviteCode: lifecycleRoom.inviteCode, sessionId: sharedSessionId });
    const replacementPage = await openRoomPage(lifecycleContext, lifecycleRoom, "Участник");
    assert.equal(
      await sessionIdFor(replacementPage, lifecycleRoom.inviteCode, "AC11_REPLACEMENT"),
      sharedSessionId,
      "AC11_REPLACEMENT_DID_NOT_REUSE_BROWSER_SESSION",
    );
    const replacementRecord = await waitForLifecycleReturn({
      afterSequence: replacementCursor.sequence,
      expectedReasons: ["replacement"],
      baseline: replacementBaseline,
      label: "AC11_SAME_SESSION_REPLACEMENT",
    });
    const replacementEventToken = await eventTokenFor(replacementPage, "AC11_REPLACEMENT");
    assert.notEqual(replacementEventToken, oldEventToken, "AC11_REPLACEMENT_REUSED_STALE_EVENT_TOKEN");
    await waitForExactlyEventSourceCount(replacementPage, 1, "AC11_SAME_SESSION_REPLACEMENT");

    await request(`/realtime/rooms/${lifecycleRoom.inviteCode}/events`, {
      token: lifecycleOwner.token,
      method: "POST",
      expected: [403],
      body: {
        sessionId: sharedSessionId,
        eventToken: oldEventToken,
        type: "key_press",
        key: "x",
        keyCode: "KeyX",
        sourceEventId: `ac11-stale-${unique()}`,
      },
    });
    await replacementPage.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ state: "attached" });

    await oldLeasePage.close();
    await assertNoLifecycleRecordAfter({
      afterSequence: replacementRecord.sequence,
      label: "AC11_OLD_REPLACED_PAGE_CLOSE",
    });
    await replacementPage.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ state: "attached" });

    const sourcesBeforeError = await eventSourceCount(replacementPage);
    const reconnectCursor = await lifecycleBaseline("AC11_SYNTHETIC_ONERROR_PRE_ADMISSION");
    await replacementPage.evaluate(() => {
      const current = window.__ac11SseSources.at(-1);
      if (!current) throw new Error("AC11_CURRENT_EVENT_SOURCE_MISSING");
      current.dispatchEvent(new Event("error"));
    });
    const reconnectRecord = await waitForLifecycleReturn({
      afterSequence: reconnectCursor.sequence,
      expectedReasons: ["normal-close", "transport-error", "replacement"],
      baseline: null,
      label: "AC11_SYNTHETIC_CURRENT_STREAM_ONERROR",
    });
    assert.equal(
      reconnectRecord.registryConnections,
      reconnectRecord.reason === "replacement" ? 1 : 0,
      `AC11_SYNTHETIC_ONERROR_REGISTRY_NOT_QUIESCENT:${reconnectRecord.line}`,
    );
    await waitForExactlyEventSourceCount(replacementPage, sourcesBeforeError + 1, "AC11_SYNTHETIC_ONERROR");
    await replacementPage.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ state: "attached" });
    assert.notEqual(
      await eventTokenFor(replacementPage, "AC11_SYNTHETIC_ONERROR_RECONNECT"),
      replacementEventToken,
      "AC11_SYNTHETIC_ONERROR_DID_NOT_MINT_A_NEW_LEASE",
    );
    const reconnectTrace = await replacementPage.evaluate(() => window.__ac11SseTrace.map((entry) => entry.type));
    assert.ok(reconnectTrace.includes("error") && reconnectTrace.includes("close"), "AC11_SYNTHETIC_ONERROR_OLD_LEASE_NOT_CLOSED");

    const finalCloseCursor = await lifecycleBaseline("AC11_FINAL_CONTEXT_CLOSE");
    await lifecycleContext.close();
    lifecycleContextClosed = true;
    await waitForLifecycleReturn({
      afterSequence: finalCloseCursor.sequence,
      expectedReasons: ["normal-close", "route-unmount", "transport-error"],
      baseline: preAdmissionBaseline,
      label: "AC11_RECONNECTED_CONTEXT_CLOSE",
    });
  } finally {
    if (!lifecycleContextClosed) await lifecycleContext.close();
  }
});

test("twenty panel/reflow transitions preserve one editor, room session, drafts, selection, scroll and focus without mutations", { timeout: 75_000 }, async () => {
  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room, viewport: { width: 1440, height: 900 } });
  try {
    await openSurface(page, "Шаги");
    await page.locator('[data-testid="room-step-row-1"]').click();
    await openSurface(page, "Условие", [fixtures.tasks[1]]);
    await page.waitForFunction((starterCode) => {
      const hydrated = window.__ac11SseMessages.some((entry) => {
        try {
          const message = JSON.parse(entry.data);
          return message.type === "manager_workspace_sync" && message.payload?.stepIndex === 1;
        } catch { return false; }
      });
      const host = document.querySelector('[data-testid="room-code-editor-host"]');
      return hydrated && host?.__roomEditorView?.state.doc.toString() === starterCode;
    }, fixtures.tasks[1].starterCode);

    const code = Array.from({ length: 84 }, (_, index) =>
      `const длинноеЗначение${index} = очередьСОченьДлиннымИменем[${index}] ?? "контекст редактора сохраняется";`,
    ).join("\n");
    const persisted = page.waitForResponse((response) => {
      const payload = postPayload(response.request());
      return isExactRelayUrl(response.url(), fixtures.room.inviteCode) &&
        payload?.type === "manager_workspace_yjs_update" && Boolean(payload.yjsUpdate) && response.ok();
    });
    const initialAwareness = page.waitForResponse((response) => {
      const payload = postPayload(response.request());
      return isExactRelayUrl(response.url(), fixtures.room.inviteCode) &&
        payload?.type === "manager_workspace_awareness_update" && response.ok();
    });
    await page.locator('[data-testid="room-code-editor-host"]').evaluate(async (host, nextCode) => {
      const view = host.__roomEditorView;
      if (!view) throw new Error("AC11_EDITOR_VIEW_NOT_READY");
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextCode },
        selection: { anchor: 37, head: 79 },
      });
      const scroller = host.querySelector(".cm-scroller");
      const scrolled = new Promise((resolve) => scroller.addEventListener("scroll", resolve, { once: true }));
      scroller.scrollTop = 173;
      scroller.scrollLeft = 91;
      await scrolled;
    }, code);
    const [initialYjsResponse, initialAwarenessResponse] = await Promise.all([persisted, initialAwareness]);
    const initialYjsPayload = postPayload(initialYjsResponse.request());
    const initialAwarenessPayload = postPayload(initialAwarenessResponse.request());
    assert.equal(initialYjsPayload.stepIndex, 1, "AC11_INITIAL_YJS_WRONG_LOCAL_STEP");
    assert.equal(initialAwarenessPayload.stepIndex, 1, "AC11_INITIAL_AWARENESS_WRONG_LOCAL_STEP");

    await openSurface(page, "Мои заметки");
    const notesDraft = "Личный черновик заметки остаётся в выбранном шаге после двадцати переходов.";
    await page.locator('[data-testid="room-private-notes-input"]').fill(notesDraft);
    await openSurface(page, "Чат");
    const chatDraft = "Черновик чата не отправляется при resize и не теряет фокус.";
    const chatInput = page.locator('[data-testid="room-notes-input"]');
    const chatSend = page.locator('[data-testid="room-notes-send"]');
    for (let index = 0; index < 16; index += 1) {
      const message = `Сообщение ${index + 1}: ${"длинный русский текст для проверки позиции чтения ".repeat(4)}`;
      const acknowledged = page.waitForResponse((response) => {
        const payload = postPayload(response.request());
        return response.url().includes(`/realtime/rooms/${fixtures.room.inviteCode}/events`) &&
          payload?.type === "note_message" && response.ok();
      });
      await chatInput.fill(message);
      await chatSend.click();
      await acknowledged;
      await page.getByText(message, { exact: true }).waitFor();
    }
    await chatInput.fill(chatDraft);
    // Commit the intentional user edit before the mutation-free reflow window;
    // hiding a still-focused textarea legitimately fires its trusted blur/change.
    await chatInput.blur();
    const chatLog = page.getByRole("log", { name: "История чата интервьюеров", exact: true });
    const chatReadPosition = await chatLog.evaluate((element) => {
      element.scrollTop = Math.min(53, Math.max(0, element.scrollHeight - element.clientHeight));
      return element.scrollTop;
    });
    assert.equal(chatReadPosition, 53, "AC11_CHAT_HISTORY_NOT_SCROLLABLE");

    const publishedBefore = (await request(`/rooms/${fixtures.room.inviteCode}`, { token: fixtures.owner.token })).currentStep;
    const baseline = await page.locator('[data-testid="room-code-editor-host"]').evaluate((host, inviteCode) => {
      const view = host.__roomEditorView;
      const scroller = host.querySelector(".cm-scroller");
      window.__ac11EditorHost = host;
      window.__ac11EditorNode = host.querySelector(".cm-editor");
      window.__ac11EditorView = view;
      return {
        sessionId: sessionStorage.getItem(`room_ws_session_id_${inviteCode}`),
        selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      };
    }, fixtures.room.inviteCode);
    assert.ok(baseline.sessionId, "AC11_ROOM_SESSION_ID_MISSING");
    assert.equal(initialYjsPayload.sessionId, baseline.sessionId, "AC11_INITIAL_YJS_SESSION_MISMATCH");
    assert.equal(initialAwarenessPayload.sessionId, baseline.sessionId, "AC11_INITIAL_AWARENESS_SESSION_MISMATCH");

    await page.evaluate(() => {
      window.__ac11DomEvents = { submit: 0, input: 0, change: 0, details: [] };
      for (const type of ["submit", "input", "change"]) {
        document.addEventListener(type, (event) => {
          window.__ac11DomEvents[type] += 1;
          const target = event.target;
          window.__ac11DomEvents.details.push({
            type,
            tag: target?.tagName ?? "",
            testId: target?.getAttribute?.("data-testid") ?? "",
            name: target?.getAttribute?.("name") ?? "",
            trusted: event.isTrusted,
          });
        }, true);
      }
    });

    const unexpectedMutations = [];
    const normalAwareness = [];
    const malformedEmptyYjs = [];
    const exactHeartbeats = [];
    const restartedStreams = [];
    let activeHeartbeatBarrier = null;
    const onRequest = (browserRequest) => {
      if (browserRequest.method() === "GET" && browserRequest.url().includes(`/realtime/rooms/${fixtures.room.inviteCode}/stream?`)) {
        restartedStreams.push(browserRequest.url());
      }
      if (!unsafeMethods.has(browserRequest.method())) return;
      const payload = postPayload(browserRequest);
      // Surface activation can blur CodeMirror. Only its same-session, same-step
      // unchanged cursor or cursor removal is allowed; document, note and layout writes stay forbidden.
      if (browserRequest.method() === "POST" && isExactRelayUrl(browserRequest.url(), fixtures.room.inviteCode) &&
          exactManagerAwareness(payload, baseline.sessionId, 1, initialYjsPayload.yjsDocumentBase64, baseline.selection)) {
        normalAwareness.push(payload.awarenessUpdate);
        return;
      }
      if (payload?.yjsUpdate === "") {
        const heartbeat = exactManagerHeartbeat(browserRequest, {
          inviteCode: fixtures.room.inviteCode,
          sessionId: baseline.sessionId,
          stepIndex: 1,
          code,
        });
        if (!heartbeat.valid) {
          malformedEmptyYjs.push({
            url: browserRequest.url(),
            method: browserRequest.method(),
            actualKeys: heartbeat.actualKeys,
            payload,
          });
          return;
        }
        exactHeartbeats.push({
          at: Date.now(),
          operationId: payload.operationId,
          clientEventSequence: payload.clientEventSequence,
          eventToken: payload.eventToken,
          sessionId: payload.sessionId,
          stepIndex: payload.stepIndex,
          document: payload.yjsDocumentBase64,
        });
        activeHeartbeatBarrier?.notify();
        return;
      }
      unexpectedMutations.push({ method: browserRequest.method(), url: browserRequest.url(), type: payload?.type ?? null });
    };
    page.on("request", onRequest);

    await page.evaluate(() => { window.__ac11SseMessages = []; });
    activeHeartbeatBarrier = createCountBarrier(exactHeartbeats, 2, "AC11_HEARTBEAT_BASELINE");
    await activeHeartbeatBarrier.promise;
    activeHeartbeatBarrier = null;
    await page.waitForFunction((expectedCode) => {
      const syncs = window.__ac11SseMessages.filter((entry) => {
        try {
          const message = JSON.parse(entry.data);
          return message?.type === "manager_workspace_sync" && message?.payload?.code === expectedCode;
        } catch {
          return false;
        }
      });
      return syncs.length >= 2;
    }, code);
    assert.deepEqual(malformedEmptyYjs, [], `AC11_MALFORMED_EMPTY_YJS:${JSON.stringify(malformedEmptyYjs)}`);
    const baselineHeartbeatCadenceMs = exactHeartbeats[1].at - exactHeartbeats[0].at;
    assert.ok(
      baselineHeartbeatCadenceMs >= 1_800 && baselineHeartbeatCadenceMs <= 3_500,
      `AC11_HEARTBEAT_BASELINE_CADENCE_WRONG:${baselineHeartbeatCadenceMs}`,
    );
    assert.equal(exactHeartbeats[0].document, exactHeartbeats[1].document, "AC11_IDLE_HEARTBEAT_DOCUMENT_CHANGED");
    const transitionHeartbeatOffset = exactHeartbeats.length;
    const lastBaselineHeartbeatAt = exactHeartbeats.at(-1).at;
    const transitionObservationStartedAt = Date.now();
    await page.evaluate(() => { window.__ac11SseMessages = []; });

    const transitionSizes = [
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 1024, height: 600 },
      { width: 768, height: 1024 },
    ];
    for (let index = 0; index < 20; index += 1) {
      const activeName = surfaceNames[index % surfaceNames.length];
      const expectedTasks = activeName === "Условие" ? [fixtures.tasks[1]] : undefined;
      await openSurface(page, activeName, expectedTasks);
      await page.setViewportSize(transitionSizes[index % transitionSizes.length]);
      await settleLayout(page);
      assert.equal(await selectedSurface(page), activeName, `AC11_REFLOW_LOST_ACTIVE_SURFACE_AT_TRANSITION_${index + 1}`);
      await assertSurfaceOpen(page, activeName, expectedTasks);
      const identity = await page.evaluate(() => ({
        editorCount: document.querySelectorAll('[data-testid="room-code-editor-host"] .cm-editor').length,
        sameHost: document.querySelector('[data-testid="room-code-editor-host"]') === window.__ac11EditorHost,
        sameEditor: document.querySelector('[data-testid="room-code-editor-host"] .cm-editor') === window.__ac11EditorNode,
        sameView: document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView === window.__ac11EditorView,
      }));
      assert.deepEqual(identity, { editorCount: 1, sameHost: true, sameEditor: true, sameView: true }, `AC11_EDITOR_REMOUNTED_AT_TRANSITION_${index + 1}`);
    }

    await openSurface(page, "Чат");
    await chatInput.focus();
    const focusedComposer = await chatInput.elementHandle();
    await page.setViewportSize({ width: 1024, height: 480 });
    await settleLayout(page);
    assert.equal(await focusedComposer.evaluate((element) => document.activeElement === element), true, "AC11_REFLOW_LOST_COMPOSER_FOCUS");

    const quiescenceHeartbeatTarget = exactHeartbeats.length + 1;
    activeHeartbeatBarrier = createCountBarrier(exactHeartbeats, quiescenceHeartbeatTarget, "AC11_REFLOW_QUIESCENCE");
    await activeHeartbeatBarrier.promise;
    activeHeartbeatBarrier = null;
    await settleLayout(page);
    const transitionObservationEndedAt = Date.now();
    const transitionSseMessages = await page.evaluate(() => window.__ac11SseMessages.map((entry) => ({ ...entry })));
    page.off("request", onRequest);

    // The separator receives keyboard focus while restoring the original
    // horizontal overflow; its normal awareness blur is outside the reflow window.
    await page.setViewportSize({ width: 1440, height: 900 });
    await settleLayout(page);
    const returnToEditor = page.getByRole("button", { name: "Вернуться к редактору", exact: true });
    if (await returnToEditor.count()) await returnToEditor.click();
    await page.getByRole("region", { name: "Редактор", exact: true }).waitFor();
    await page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true }).press("End");
    await settleLayout(page);

    const after = await page.locator('[data-testid="room-code-editor-host"]').evaluate((host, inviteCode) => {
      const view = host.__roomEditorView;
      const scroller = host.querySelector(".cm-scroller");
      return {
        code: view.state.doc.toString(),
        selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        sessionId: sessionStorage.getItem(`room_ws_session_id_${inviteCode}`),
        domEvents: window.__ac11DomEvents,
      };
    }, fixtures.room.inviteCode);
    assert.equal(after.code, code, "AC11_REFLOW_LOST_CODE");
    assert.deepEqual(after.selection, baseline.selection, "AC11_REFLOW_LOST_EDITOR_SELECTION");
    assert.equal(after.scrollTop, baseline.scrollTop, "AC11_REFLOW_LOST_EDITOR_VERTICAL_SCROLL");
    assert.ok(after.scrollWidth > after.clientWidth, `AC11_EDITOR_HORIZONTAL_OVERFLOW_MISSING:${JSON.stringify({ baseline, after: { scrollLeft: after.scrollLeft, scrollWidth: after.scrollWidth, clientWidth: after.clientWidth } })}`);
    assert.equal(after.scrollLeft, baseline.scrollLeft, `AC11_REFLOW_LOST_EDITOR_HORIZONTAL_SCROLL:${JSON.stringify({ baseline, after: { scrollLeft: after.scrollLeft, scrollWidth: after.scrollWidth, clientWidth: after.clientWidth } })}`);
    assert.equal(after.sessionId, baseline.sessionId, "AC11_REFLOW_RECREATED_ROOM_SESSION");
    assert.deepEqual(
      {
        submit: after.domEvents.submit,
        input: after.domEvents.input,
        change: after.domEvents.change,
      },
      { submit: 0, input: 0, change: 0 },
      `AC11_REFLOW_EMITTED_SYNTHETIC_FORM_EVENT:${JSON.stringify(after.domEvents.details)}`,
    );
    await openSurface(page, "Чат");
    assert.equal(await page.locator('[data-testid="room-private-notes-input"]').inputValue(), notesDraft, "AC11_REFLOW_LOST_NOTES_DRAFT");
    assert.equal(await chatInput.inputValue(), chatDraft, "AC11_REFLOW_LOST_CHAT_DRAFT");
    assert.equal(await chatLog.evaluate((element) => element.scrollTop), chatReadPosition, "AC11_REFLOW_LOST_CHAT_READ_POSITION");
    assert.equal(await page.locator('[data-testid="room-current-local-step-context"]').getAttribute("data-step-index"), "1", "AC11_REFLOW_LOST_LOCAL_STEP");
    assert.equal((await request(`/rooms/${fixtures.room.inviteCode}`, { token: fixtures.owner.token })).currentStep, publishedBefore, "AC11_REFLOW_PUBLISHED_STEP");
    assert.deepEqual(unexpectedMutations, [], `AC11_REFLOW_SENT_MUTATION:${JSON.stringify(unexpectedMutations)}`);
    assert.deepEqual(malformedEmptyYjs, [], `AC11_REFLOW_MALFORMED_EMPTY_YJS:${JSON.stringify(malformedEmptyYjs)}`);
    assert.deepEqual(restartedStreams, [], "AC11_REFLOW_RESTARTED_SSE_STREAM");
    const transitionHeartbeats = exactHeartbeats.slice(transitionHeartbeatOffset);
    for (let index = 1; index < exactHeartbeats.length; index += 1) {
      const interval = exactHeartbeats[index].at - exactHeartbeats[index - 1].at;
      assert.ok(
        interval >= Math.max(1_200, baselineHeartbeatCadenceMs * 0.65),
        `AC11_REFLOW_EMITTED_EXTRA_EMPTY_YJS:${interval}:${baselineHeartbeatCadenceMs}`,
      );
    }
    assert.ok(transitionHeartbeats.length >= 1, "AC11_REFLOW_QUIESCENCE_HEARTBEAT_MISSING");
    const observationDurationMs = transitionObservationEndedAt - transitionObservationStartedAt;
    const baselineExpectedDuringObservation = Math.floor(observationDurationMs / baselineHeartbeatCadenceMs);
    const heartbeatBoundaryTolerance = 1;
    assert.ok(
      transitionHeartbeats.length <= baselineExpectedDuringObservation + heartbeatBoundaryTolerance,
      `AC11_REFLOW_EMPTY_YJS_CARDINALITY_EXCEEDED:${transitionHeartbeats.length}/${baselineExpectedDuringObservation}+${heartbeatBoundaryTolerance}:${observationDurationMs}:${baselineHeartbeatCadenceMs}`,
    );
    const lastObservedHeartbeatAt = transitionHeartbeats.at(-1).at;
    const heartbeatWindowMs = lastObservedHeartbeatAt - lastBaselineHeartbeatAt;
    const baselineExpectedThroughLastHeartbeat = Math.floor(heartbeatWindowMs / baselineHeartbeatCadenceMs);
    assert.ok(
      transitionHeartbeats.length <= baselineExpectedThroughLastHeartbeat + heartbeatBoundaryTolerance,
      `AC11_REFLOW_CORRELATED_EMPTY_YJS_CARDINALITY_EXCEEDED:${transitionHeartbeats.length}/${baselineExpectedThroughLastHeartbeat}+${heartbeatBoundaryTolerance}:${heartbeatWindowMs}:${baselineHeartbeatCadenceMs}`,
    );
    assert.ok(
      transitionHeartbeats.every((heartbeat) => heartbeat.document === exactHeartbeats[0].document),
      "AC11_REFLOW_CHANGED_IDLE_YJS_DOCUMENT",
    );
    assert.equal(
      new Set(exactHeartbeats.map((heartbeat) => heartbeat.operationId)).size,
      exactHeartbeats.length,
      "AC11_REFLOW_EMPTY_YJS_OPERATION_ID_REUSED",
    );
    for (let index = 1; index < exactHeartbeats.length; index += 1) {
      assert.ok(
        exactHeartbeats[index].clientEventSequence > exactHeartbeats[index - 1].clientEventSequence,
        `AC11_REFLOW_EMPTY_YJS_CLIENT_SEQUENCE_NOT_INCREASING:${exactHeartbeats[index - 1].clientEventSequence}->${exactHeartbeats[index].clientEventSequence}`,
      );
    }
    assert.equal(
      new Set(exactHeartbeats.map((heartbeat) => heartbeat.eventToken)).size,
      1,
      "AC11_REFLOW_EMPTY_YJS_EVENT_TOKEN_CHANGED",
    );
    assert.ok(
      exactHeartbeats.every((heartbeat) => heartbeat.sessionId === baseline.sessionId && heartbeat.stepIndex === 1),
      `AC11_REFLOW_EMPTY_YJS_MANAGER_CONTEXT_CHANGED:${JSON.stringify(exactHeartbeats.map(({ sessionId, stepIndex }) => ({ sessionId, stepIndex })))}`,
    );
    const parsedTransitionSse = transitionSseMessages.map((entry) => {
      try {
        return { at: entry.at, message: JSON.parse(entry.data) };
      } catch {
        return { at: entry.at, message: null };
      }
    });
    const isExactTransportHeartbeat = (message) => {
      if (message === null || typeof message !== "object" || message.type !== "heartbeat") return false;
      const keys = Object.keys(message).sort();
      if (keys.length === 1 && keys[0] === "type") return true;
      return keys.length === 2 &&
        keys[0] === "payload" &&
        keys[1] === "type" &&
        message.payload !== null &&
        typeof message.payload === "object" &&
        Object.keys(message.payload).length === 1 &&
        Number.isFinite(message.payload.ts);
    };
    const transitionDomainSse = parsedTransitionSse.filter(
      ({ message }) => !isExactTransportHeartbeat(message) && !(
        message?.type === "manager_workspace_awareness_update" &&
        message.payload?.sessionId === baseline.sessionId && message.payload?.stepIndex === 1 &&
        normalAwareness.includes(message.payload?.awarenessUpdate)
      ),
    );
    const unexpectedSse = transitionDomainSse.filter(({ message }) =>
      message?.type !== "manager_workspace_sync" ||
      message?.payload?.stepIndex !== 1 ||
      message?.payload?.code !== code,
    );
    assert.deepEqual(unexpectedSse, [], `AC11_REFLOW_EMITTED_UNRELATED_SSE:${JSON.stringify(unexpectedSse)}`);
    assert.ok(
      transitionDomainSse.length <= transitionHeartbeats.length,
      `AC11_REFLOW_EMITTED_EXTRA_SSE:${transitionDomainSse.length}/${transitionHeartbeats.length}`,
    );
    const postLifecycleRequests = [];
    const recordPostLifecycle = (browserRequest) => {
      const payload = postPayload(browserRequest);
      if (isExactRelayUrl(browserRequest.url(), fixtures.room.inviteCode) &&
        ["manager_workspace_yjs_update", "manager_workspace_awareness_update"].includes(payload?.type)) {
        postLifecycleRequests.push(payload);
      }
    };
    page.on("request", recordPostLifecycle);
    const postYjs = page.waitForResponse((response) => {
      const payload = postPayload(response.request());
      return isExactRelayUrl(response.url(), fixtures.room.inviteCode) &&
        payload?.type === "manager_workspace_yjs_update" && Boolean(payload.yjsUpdate) && response.ok();
    });
    const postAwareness = page.waitForResponse((response) => {
      const payload = postPayload(response.request());
      return isExactRelayUrl(response.url(), fixtures.room.inviteCode) &&
        payload?.type === "manager_workspace_awareness_update" && response.ok();
    });
    const finalCode = `${code}\n// post-transition Yjs lifecycle remains attached`;
    await page.locator('[data-testid="room-code-editor-host"]').evaluate((host, nextCode) => {
      const view = host.__roomEditorView;
      view.dispatch({
        changes: { from: view.state.doc.length, insert: nextCode.slice(view.state.doc.length) },
        selection: { anchor: nextCode.length, head: nextCode.length },
      });
    }, finalCode);
    const [postYjsResponse, postAwarenessResponse] = await Promise.all([postYjs, postAwareness]);
    page.off("request", recordPostLifecycle);
    const postYjsPayload = postPayload(postYjsResponse.request());
    const postAwarenessPayload = postPayload(postAwarenessResponse.request());
    assert.equal(postYjsPayload.sessionId, baseline.sessionId, "AC11_POST_REFLOW_YJS_SESSION_CHANGED");
    assert.equal(postYjsPayload.stepIndex, 1, "AC11_POST_REFLOW_YJS_STEP_CHANGED");
    assert.notEqual(postYjsPayload.yjsDocumentBase64, initialYjsPayload.yjsDocumentBase64, "AC11_POST_REFLOW_YJS_DOCUMENT_DID_NOT_ADVANCE");
    assert.equal(postAwarenessPayload.sessionId, baseline.sessionId, "AC11_POST_REFLOW_AWARENESS_SESSION_CHANGED");
    assert.equal(postAwarenessPayload.stepIndex, 1, "AC11_POST_REFLOW_AWARENESS_STEP_CHANGED");
    assert.equal(postLifecycleRequests.filter((payload) => payload.type === "manager_workspace_yjs_update" && payload.yjsUpdate).length, 1, "AC11_POST_REFLOW_YJS_LIFECYCLE_DUPLICATED");
    assert.equal(postLifecycleRequests.filter((payload) => payload.type === "manager_workspace_awareness_update").length, 1, "AC11_POST_REFLOW_AWARENESS_LIFECYCLE_DUPLICATED");
    // Y.Doc and Awareness are module-private and cannot be constructor-proxied
    // from an initScript without changing production. The unchanged host,
    // EditorView/yCollab instance and room session, identical idle full-state
    // snapshots/cadence, and exactly-one post-reflow document + awareness
    // lifecycle prove the strongest observable identity seam available.
  } finally {
    await closeRoomContext(context);
  }
});

test("desktop/tablet viewport and zoom-equivalent matrix keeps honest automatic Focus/Work geometry", { timeout: 120_000 }, async () => {
  const viewports = [
    { width: 768, height: 1024 },
    { width: 1024, height: 600 },
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
  ];
  for (const baseViewport of viewports) {
    const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room, viewport: baseViewport });
    try {
      await directSurfaceTabs(page);
      for (const zoom of [100, 125, 150, 200]) {
        const scale = zoom / 100;
        const effective = {
          width: Math.max(320, Math.floor(baseViewport.width / scale)),
          height: Math.max(300, Math.floor(baseViewport.height / scale)),
        };
        await page.setViewportSize(effective);
        await settleLayout(page);
        const { tabs } = await directSurfaceTabs(page);
        for (let index = 0; index < surfaceNames.length; index += 1) {
          await assertTargetGeometry(tabs.nth(index), `AC11_MATRIX_${baseViewport.width}x${baseViewport.height}@${zoom}_${surfaceNames[index]}`);
        }
        const geometry = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          surfaceWidth: (() => {
            const grid = document.querySelector('[data-testid="room-context-surface-grid"]');
            if (!grid) return 0;
            const style = getComputedStyle(grid);
            return grid.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          })(),
        }));
        assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `AC11_GLOBAL_HORIZONTAL_OVERFLOW:${baseViewport.width}x${baseViewport.height}@${zoom}:${JSON.stringify(geometry)}`);
        const expectedFocus = geometry.innerWidth < 1000 || geometry.innerHeight < 440 || geometry.surfaceWidth < 830;
        await assertActiveMode(page, expectedFocus ? "Фокус" : "Рабочий", `AC11_MATRIX_${baseViewport.width}x${baseViewport.height}@${zoom}:${JSON.stringify(geometry)}`);
        if (zoom === 100) {
          const defaultRegions = await visibleSurfaceRegions(page);
          assert.deepEqual(
            defaultRegions.sort(),
            (expectedFocus ? ["Шаги"] : ["Редактор", "Шаги"]).sort(),
            `AC11_AUTOMATIC_DEFAULT_GEOMETRY:${baseViewport.width}x${baseViewport.height}:${defaultRegions.join(",")}`,
          );
          assert.ok(await page.getByRole("region", { name: "Условие", exact: true }).isVisible(), "AC11_PERSISTENT_CONDITION_MISSING");
          if (!expectedFocus) {
            await assertNoPairwiseOverlap(
              [["Редактор", await surfaceRegion(page, "Редактор")], ["Шаги", await surfaceRegion(page, "Шаги")]],
              `AC11_AUTOMATIC_DEFAULT_${baseViewport.width}x${baseViewport.height}`,
            );
          }
        }

        await activateSurfaceByKeyboard(page, "Чат");
        const chatInput = page.locator('[data-testid="room-notes-input"]');
        const chatSend = page.locator('[data-testid="room-notes-send"]');
        await focusByKeyboard(page, chatInput, `AC11_MATRIX_CHAT_INPUT_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await assertTargetGeometry(chatInput, `AC11_MATRIX_CHAT_INPUT_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await page.keyboard.type("я");
        await focusByKeyboard(page, chatSend, `AC11_MATRIX_CHAT_SEND_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await assertTargetGeometry(chatSend, `AC11_MATRIX_CHAT_SEND_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        const chatPanels = [["Чат", await surfaceRegion(page, "Чат")]];
        if (!expectedFocus) chatPanels.unshift(["Редактор", await surfaceRegion(page, "Редактор")]);
        await assertNoPairwiseOverlap(chatPanels, `AC11_MATRIX_CHAT_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        if (!expectedFocus) {
          const chatBox = await chatPanels.at(-1)[1].boundingBox();
          assert.ok(chatBox.width >= 320 && chatBox.height >= 320, `AC11_WORK_CHAT_MINIMUM:${JSON.stringify(chatBox)}`);
        }

        await activateSurfaceByKeyboard(page, "Мои заметки");
        const notesInput = page.locator('[data-testid="room-private-notes-input"]');
        const notesSend = page.locator('[data-testid="room-private-notes-send"]');
        const notesExport = page.locator('[data-testid="room-private-notes-export"]');
        await focusByKeyboard(page, notesInput, `AC11_MATRIX_NOTES_INPUT_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await assertTargetGeometry(notesInput, `AC11_MATRIX_NOTES_INPUT_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await page.keyboard.type("я");
        await focusByKeyboard(page, notesSend, `AC11_MATRIX_NOTES_SEND_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await assertTargetGeometry(notesSend, `AC11_MATRIX_NOTES_SEND_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await focusByKeyboard(page, notesExport, `AC11_MATRIX_NOTES_EXPORT_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await assertTargetGeometry(notesExport, `AC11_MATRIX_NOTES_EXPORT_${baseViewport.width}x${baseViewport.height}@${zoom}`);

        const back = page.getByRole("link", { name: "Вернуться к списку интервью", exact: true });
        await focusByKeyboard(page, back, `AC11_MATRIX_PERSONAL_RETURN_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        await assertTargetGeometry(back, `AC11_MATRIX_PERSONAL_RETURN_${baseViewport.width}x${baseViewport.height}@${zoom}`);

        const regions = await visibleSurfaceRegions(page);
        assert.deepEqual(
          regions.sort(),
          (expectedFocus ? ["Мои заметки"] : ["Редактор", "Мои заметки"]).sort(),
          `AC11_VISIBLE_SURFACE_GEOMETRY:${baseViewport.width}x${baseViewport.height}@${zoom}:${regions.join(",")}`,
        );
        const visiblePanels = [["Мои заметки", await surfaceRegion(page, "Мои заметки")]];
        if (!expectedFocus) visiblePanels.unshift(["Редактор", await surfaceRegion(page, "Редактор")]);
        await assertNoPairwiseOverlap(visiblePanels, `AC11_MATRIX_${baseViewport.width}x${baseViewport.height}@${zoom}`);
        const panelBoxes = Object.fromEntries(await Promise.all(visiblePanels.map(async ([name, locator]) => [name, await locator.boundingBox()])));
        if (!expectedFocus) {
          const editorCodeBox = await visiblePanels[0][1].locator('[data-testid="room-code-editor-host"] .cm-editor').boundingBox();
          const conditionGeometry = await page.locator('[data-condition-expanded]').boundingBox();
          assert.ok(editorCodeBox.width >= 480 && editorCodeBox.height >= 320, `AC11_WORK_EDITOR_MINIMUM:${baseViewport.width}x${baseViewport.height}@${zoom}:${JSON.stringify({editorCodeBox,conditionGeometry,geometry,panelBoxes})}`);
          assert.ok(panelBoxes["Мои заметки"].width >= 320 && panelBoxes["Мои заметки"].height >= 280, `AC11_WORK_NOTES_MINIMUM:${JSON.stringify(panelBoxes)}`);
        }
        const postInteractionGeometry = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        assert.ok(postInteractionGeometry.scrollWidth <= postInteractionGeometry.clientWidth + 1, `AC11_POST_INTERACTION_HORIZONTAL_OVERFLOW:${baseViewport.width}x${baseViewport.height}@${zoom}`);
      }
    } finally {
      await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => {});
      await closeRoomContext(context);
    }
  }
});

test("usable container geometry, automatic panels and focus transfer stay truthful", { timeout: 45_000 }, async () => {
  const { context, page } = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const root = page.locator("[data-room-context-mode]");
    await directSurfaceTabs(page);
    const constrainedStyle = await page.addStyleTag({
      content: '[data-room-context-mode]{width:900px!important;height:430px!important;flex:none!important}',
    });
    await settleLayout(page);
    await assertActiveMode(page, "Фокус", "AC11_USABLE_CONTAINER_FOCUS");

    const tabGrid = await page.locator('[role="tablist"][aria-label="Рабочие области комнаты"]').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        columns: style.gridTemplateColumns.split(" ").filter(Boolean).length,
        rows: style.gridTemplateRows.split(" ").filter(Boolean).length,
      };
    });
    assert.deepEqual(tabGrid, { columns: 4, rows: 1 }, `AC11_NARROW_TAB_GRID_NOT_4X1:${JSON.stringify(tabGrid)}`);

    await constrainedStyle.evaluate((element) => element.remove());
    await settleLayout(page);
    await assertActiveMode(page, "Рабочий", "AC11_CONTAINER_RECOVERY_TO_WORK");

    await openSurface(page, "Шаги");
    await page.locator('[data-testid="room-step-row-1"]').click();
    await openSurface(page, "Условие", [fixtures.tasks[1]]);
    await page.waitForFunction(description => document.querySelector("#room-context-region-condition")?.textContent?.includes(description), fixtures.tasks[1].description.slice(0, 120));
    const selectedConditionContent = (await (await surfaceRegion(page, "Условие")).textContent()) ?? "";
    assert.ok(
      selectedConditionContent.includes(fixtures.tasks[1].description.slice(0, 120)),
      "AC11_LOCAL_CONDITION_BODY_MISSING_AFTER_STEP_SELECTION",
    );
    assert.ok(
      !selectedConditionContent.includes(fixtures.tasks[0].description.slice(0, 120)),
      "AC11_OLD_PUBLIC_CONDITION_RETAINED_AFTER_LOCAL_SELECTION",
    );

    await openSurface(page, "Мои заметки");
    assert.equal(await selectedSurface(page), "Мои заметки", "AUTO_NOTES_NOT_SELECTED");
    assert.ok((await visibleSurfaceRegions(page)).includes("Мои заметки"), "AUTO_NOTES_SELECTED_BUT_HIDDEN");
    await openSurface(page, "Чат");
    assert.ok((await visibleSurfaceRegions(page)).includes("Чат"), "AUTO_CHAT_SELECTED_BUT_HIDDEN");
    await openSurface(page, "Условие", [fixtures.tasks[1]]);
    const editorContent = (await surfaceRegion(page, "Редактор")).locator('[data-testid="room-code-editor-host"] .cm-content');
    await editorContent.focus();
    await page.setViewportSize({ width: 768, height: 1024 });
    await settleLayout(page);
    await assertActiveMode(page, "Фокус", "AC11_HIDDEN_EDITOR_FOCUS_MODE");
    const focusState = await page.evaluate(() => {
      const hiddenEditor = document.querySelector('[data-room-context-surface="editor"]');
      const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
      return {
        editorVisible: hiddenEditor?.getAttribute("data-room-context-visible") === "true",
        insideEditor: hiddenEditor?.contains(document.activeElement) ?? false,
        selectedSurface: selectedTab?.textContent?.trim() ?? "",
      };
    });
    assert.deepEqual(
      focusState,
      { editorVisible: true, insideEditor: true, selectedSurface: "" },
      `AC11_LOGICAL_EDITOR_FOCUS_NOT_RETAINED:${JSON.stringify(focusState)}`,
    );
    assert.equal(await root.getAttribute("data-room-context-mode"), "focus");
  } finally {
    await closeRoomContext(context);
  }
});

test("1320x640 room root keeps automatic Work panels contained", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room, viewport: { width: 1440, height: 900 } });
  try {
    const root = page.locator("[data-room-context-mode]");
    await page.addStyleTag({ content: '[data-room-context-mode]{width:1320px!important;height:640px!important;flex:none!important}' });
    await settleLayout(page);
    const rootBox = await root.boundingBox();
    assert.ok(rootBox);
    assert.equal(Math.round(rootBox.width), 1320);
    assert.equal(Math.round(rootBox.height), 640);
    for (const name of ["Фокус", "Рабочий", "Обзор", "Показать оба"]) {
      assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0, `RETIRED_LAYOUT_CONTROL_RETURNED:${name}`);
    }
    await assertActiveMode(page, "Рабочий", "AUTO_WORK_BOUNDARY");
    await openSurface(page, "Условие", [fixtures.tasks[0]]);
    const panels = [["Редактор", await surfaceRegion(page, "Редактор")], ["Условие", await surfaceRegion(page, "Условие")]];
    await assertContainedBy(root, panels, "AUTO_WORK_BOUNDARY");
    await assertNoPairwiseOverlap(panels, "AUTO_WORK_BOUNDARY");
  } finally { await closeRoomContext(context); }
});

test("automatic Work Focus Work reflow preserves active chat and readable geometry", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room, viewport: { width: 1440, height: 900 } });
  try {
    await directSurfaceTabs(page);
    await openSurface(page, "Чат");
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      const narrow = viewport.width === 768;
      await assertActiveMode(page, narrow ? "Фокус" : "Рабочий", `AUTO_CHAT_REFLOW:${viewport.width}`);
      assert.equal(await selectedSurface(page), "Чат", "AUTO_REFLOW_LOST_ACTIVE_CHAT");
      assert.deepEqual((await visibleSurfaceRegions(page)).sort(), (narrow ? ["Чат"] : ["Редактор", "Чат"]).sort(), "AUTO_REFLOW_VISIBLE_REGIONS_WRONG");
      const panels = [["Чат", await surfaceRegion(page, "Чат")]];
      if (!narrow) panels.push(["Редактор", await surfaceRegion(page, "Редактор")]);
      await assertContainedBy(page.locator("[data-room-context-mode]"), panels, "AUTO_CHAT_REFLOW");
      await assertNoPairwiseOverlap(panels, "AUTO_CHAT_REFLOW");
      const composer = await page.locator('[data-testid="room-notes-input"]').boundingBox();
      const history = await page.getByRole("log", { name: "История чата интервьюеров", exact: true }).boundingBox();
      assert.ok(composer?.height > 0 && history?.height >= 120, "AUTO_CHAT_UNREADABLE");
    }
  } finally { await closeRoomContext(context); }
});

test("personal notes, score, notes export and direct return to personal interviews remain available", { timeout: 45_000 }, async () => {
  const { context, page } = await openRoom({ auth: fixtures.owner, room: fixtures.room, viewport: { width: 1024, height: 600 }, acceptDownloads: true });
  try {
    await openSurface(page, "Шаги");
    const score = page.getByLabel("Оценка активного для всех шага", { exact: true });
    assert.equal(await score.count(), 1, "AC11_SCORE_CONTROL_MISSING");
    const scoreAcknowledged = page.waitForResponse((response) => {
      const payload = postPayload(response.request());
      return isExactRelayUrl(response.url(), fixtures.room.inviteCode) &&
        payload?.type === "task_rating_update" && payload.stepIndex === 0 && payload.rating === 4 && response.ok();
    });
    await score.click();
    await page.getByRole("option", { name: "4", exact: true }).click();
    await scoreAcknowledged;
    const persistedScore = await waitForRoomScore(fixtures.owner, fixtures.room, 0, 4);
    assert.equal(persistedScore.tasks[0].title, fixtures.tasks[0].title, "AC11_SCORE_PERSISTED_FOR_WRONG_STEP");

    await openSurface(page, "Мои заметки");
    const noteText = `Личная заметка для экспорта ${unique()}`;
    const noteAcknowledged = page.waitForResponse((response) => {
      const payload = postPayload(response.request());
      return isExactRelayUrl(response.url(), fixtures.room.inviteCode) &&
        payload?.type === "private_note_entry" && payload.privateNoteText === noteText &&
        payload.privateNoteBlockStepIndex === 0 && response.ok();
    });
    await page.locator('[data-testid="room-private-notes-input"]').fill(noteText);
    await page.locator('[data-testid="room-private-notes-send"]').click();
    await noteAcknowledged;
    await page.getByText(noteText, { exact: false }).waitFor();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ state: "visible", timeout: 15_000 });
    await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ state: "attached", timeout: 15_000 });
    await openSurface(page, "Шаги");
    assert.equal(await page.getByLabel("Оценка активного для всех шага", { exact: true }).inputValue(), "4", "AC11_SCORE_NOT_RESTORED_IN_UI");
    await openSurface(page, "Мои заметки");
    await page.getByText(noteText, { exact: false }).waitFor();

    await page.getByRole("button", { name: /Экспорт (личных|моих)? ?заметок|Экспорт заметок/ }).click();
    const exportDialog = page.getByRole("dialog", { name: "Экспорт личных заметок", exact: true });
    await exportDialog.waitFor({ state: "visible" });
    const downloadPromise = page.waitForEvent("download");
    await exportDialog.getByRole("button", { name: "Скачать .md", exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.md$/);
    const stream = await download.createReadStream();
    assert.ok(stream, "AC11_NOTES_EXPORT_STREAM_MISSING");
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const markdown = Buffer.concat(chunks).toString("utf8");
    assert.ok(markdown.includes(fixtures.tasks[0].title), "AC11_NOTES_EXPORT_STEP_TITLE_MISSING");
    assert.ok(markdown.includes(noteText), "AC11_NOTES_EXPORT_NOTE_MISSING");
    assert.ok(markdown.includes("Оценка 4/5"), "AC11_NOTES_EXPORT_SCORE_MISSING");
    await page.getByRole("button", { name: "Close", exact: true }).click();

    const back = page.getByRole("link", { name: "Вернуться к списку интервью", exact: true });
    assert.equal(await back.count(), 1, "AC11_PERSONAL_RETURN_ACTION_MISSING");
    await page.locator("body").press("Home");
    await focusByKeyboard(page, back, "AC11_PERSONAL_RETURN");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/workspace/personal/interviews");
    assert.equal(new URL(page.url()).pathname, "/workspace/personal/interviews");
  } finally {
    await closeRoomContext(context);
  }
});

test("remediation: editor is a direct Focus region and local splitters resize without room side effects", { timeout: 45_000 }, async () => {
  const focus = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 768, height: 1024 },
  });
  try {
    await assertActiveMode(focus.page, "Фокус", "FOCUS_EDITOR_ONLY");
    await directSurfaceTabs(focus.page);
    assert.equal(await focus.page.getByRole("tab", { name: "Редактор", exact: true }).count(), 0, "FOCUS_EDITOR_TAB_RETURNED");
    const editor = focus.page.getByRole("region", { name: "Редактор", exact: true, includeHidden: true });
    assert.equal(await editor.count(), 1, "FOCUS_EDITOR_DIRECT_REGION_MISSING");
    assert.equal(await editor.getAttribute("aria-labelledby"), null, "FOCUS_EDITOR_ORPHAN_TAB_REFERENCE");
    assert.equal(await editor.locator('[data-testid="room-code-editor-host"] .cm-editor').count(), 1, "FOCUS_EDITOR_CODEMIRROR_UNMOUNTED");
    assert.equal(await selectedSurface(focus.page), "Шаги", "FOCUS_DEFAULT_STEPS_MISSING");
    await focus.page.getByRole("button", { name: "Вернуться к редактору", exact: true }).click();
    await editor.waitFor({ state: "visible" });
  } finally {
    await closeRoomContext(focus.context);
  }

  const { context, page } = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 1440, height: 900 },
  });
  const unexpectedResizeRequests = [];
  const resizeSse = [];
  page.on("request", (request) => {
    if (!unsafeMethods.has(request.method())) return;
    const parsedUrl = new URL(request.url());
    const payload = postPayload(request);
    if (parsedUrl.pathname.endsWith(`/realtime/rooms/${fixtures.room.inviteCode}/events`)) {
      if (/split|resize/i.test(JSON.stringify(payload ?? {}))) {
        unexpectedResizeRequests.push(`${request.method()} ${parsedUrl.pathname} ${JSON.stringify(payload)}`);
      }
      return;
    }
    unexpectedResizeRequests.push(`${request.method()} ${parsedUrl.pathname}`);
  });
  try {
    await openSurface(page, "Чат");
    const workDivider = page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true });
    assert.equal(await workDivider.count(), 1, "WORK_CONTEXT_WIDTH_SEPARATOR_MISSING");
    const beforeKeyboard = Number(await workDivider.getAttribute("aria-valuenow"));
    await workDivider.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(Number(await workDivider.getAttribute("aria-valuenow")), beforeKeyboard + 16, "WORK_CONTEXT_ARROW_STEP_NOT_16PX");
    await page.keyboard.press("Home");
    assert.equal(await workDivider.getAttribute("aria-valuenow"), await workDivider.getAttribute("aria-valuemin"), "WORK_CONTEXT_HOME_NOT_MINIMUM");
    await page.keyboard.press("End");
    assert.equal(await workDivider.getAttribute("aria-valuenow"), await workDivider.getAttribute("aria-valuemax"), "WORK_CONTEXT_END_NOT_MAXIMUM");
    const workBox = await workDivider.boundingBox();
    assert.ok(workBox, "WORK_CONTEXT_SEPARATOR_BOX_MISSING");
    await page.mouse.move(workBox.x + workBox.width / 2, workBox.y + workBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(workBox.x + 32, workBox.y + workBox.height / 2);
    await page.mouse.up();
    assert.ok(Number(await workDivider.getAttribute("aria-valuenow")) < Number(await workDivider.getAttribute("aria-valuemax")), "WORK_CONTEXT_POINTER_DRAG_NOT_APPLIED");

    await page.setViewportSize({ width: 1280, height: 720 });
    await settleLayout(page);
    await assertActiveMode(page, "Рабочий", "RESIZE_AUTO_WORK");
    assert.deepEqual(unexpectedResizeRequests, [], `RESIZE_SENT_ROOM_MUTATION:${JSON.stringify(unexpectedResizeRequests)}`);
    resizeSse.push(...await page.evaluate(() => window.__ac11SseMessages ?? []));
    assert.equal(resizeSse.some((event) => /split|resize/i.test(event.data)), false, "RESIZE_SENT_SSE_EVENT");

    await page.setViewportSize({ width: 1440, height: 900 });
    await settleLayout(page);
    await openSurface(page, "Чат");
    const changed = page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true });
    const changedValue = Number(await changed.getAttribute("aria-valuenow"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ state: "visible", timeout: 15_000 });
    await openSurface(page, "Чат");
    const reloaded = page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true });
    assert.notEqual(Number(await reloaded.getAttribute("aria-valuenow")), changedValue, "RESIZE_PERSISTED_AFTER_ROUTE_RELOAD");
  } finally {
    await closeRoomContext(context);
  }
});

test("remediation: Focus leaves no unresolved room surface ARIA references", { timeout: 30_000 }, async () => {
  const { context, page } = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 768, height: 1024 },
  });
  try {
    const unresolvedRoomReferences = () => page.evaluate(() => {
      const references = [
        ...document.querySelectorAll('[data-room-context-surface][aria-labelledby]'),
        ...document.querySelectorAll('[role="tab"][aria-controls]'),
      ];
      return references.flatMap((element) => {
        const attribute = element.hasAttribute("aria-labelledby") ? "aria-labelledby" : "aria-controls";
        return (element.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)
          .filter((id) => !document.getElementById(id))
          .map((id) => ({ attribute, id, surface: element.getAttribute("data-room-context-surface") }));
      });
    });
    await assertActiveMode(page, "Фокус", "FOCUS_ARIA_REFERENCE_MODE");
    const focusUnresolved = await unresolvedRoomReferences();
    assert.deepEqual(focusUnresolved, [], `FOCUS_ROOM_ARIA_REFERENCE_UNRESOLVED:${JSON.stringify(focusUnresolved)}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await settleLayout(page);
    await assertActiveMode(page, "Рабочий", "WORK_ARIA_REFERENCE_MODE");
    const workUnresolved = await unresolvedRoomReferences();
    assert.deepEqual(workUnresolved, [], `WORK_ROOM_ARIA_REFERENCE_UNRESOLVED:${JSON.stringify(workUnresolved)}`);
  } finally {
    await closeRoomContext(context);
  }
});

test("remediation: splitters follow pointer direction and remain inside content-box bounds", { timeout: 35_000 }, async () => {
  const { context, page } = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 1440, height: 900 },
  });
  try {
    await openSurface(page, "Чат");
    const work = page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true });
    await work.focus();
    await page.keyboard.press("Home");
    const workBeforeDrag = Number(await work.getAttribute("aria-valuenow"));
    const workChatBeforeDrag = await (await surfaceRegion(page, "Чат")).boundingBox();
    const workBox = await work.boundingBox();
    assert.ok(workBox, "WORK_POINTER_DIRECTION_SEPARATOR_BOX_MISSING");
    await page.mouse.move(workBox.x + workBox.width / 2, workBox.y + workBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(workBox.x - 32, workBox.y + workBox.height / 2);
    await page.mouse.up();
    const workChatAfterDrag = await (await surfaceRegion(page, "Чат")).boundingBox();
    assert.ok(Number(await work.getAttribute("aria-valuenow")) > workBeforeDrag, "WORK_CONTEXT_POINTER_DIRECTION_INVERTED");
    assert.ok(workChatBeforeDrag && workChatAfterDrag && workChatAfterDrag.width > workChatBeforeDrag.width, "WORK_CONTEXT_POINTER_DID_NOT_EXPAND_RIGHT_PANEL_LEFTWARD");

    await work.focus();
    await page.keyboard.press("End");
    const contentBounds = await page.locator('[data-room-context-surface="editor"]').locator("..").evaluate((grid) => {
      const gridBox = grid.getBoundingClientRect();
      const style = getComputedStyle(grid);
      const content = {
        left: gridBox.left + Number.parseFloat(style.paddingLeft),
        right: gridBox.right - Number.parseFloat(style.paddingRight),
        top: gridBox.top + Number.parseFloat(style.paddingTop),
        bottom: gridBox.bottom - Number.parseFloat(style.paddingBottom),
      };
      const panel = (name) => {
        const element = grid.querySelector(`[data-room-context-surface="${name}"]`);
        const box = element?.getBoundingClientRect();
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height } : null;
      };
      return {
        content,
        editor: panel("editor"),
        chat: panel("chat"),
        activity: panel("activity"),
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    for (const [name, panel] of Object.entries({ editor: contentBounds.editor, chat: contentBounds.chat })) {
      assert.ok(panel, `CONTENT_BOX_${name.toUpperCase()}_MISSING`);
      assert.ok(panel.left >= contentBounds.content.left - 1 && panel.right <= contentBounds.content.right + 1 && panel.top >= contentBounds.content.top - 1 && panel.bottom <= contentBounds.content.bottom + 1, `CONTENT_BOX_${name.toUpperCase()}_OVERFLOW:${JSON.stringify({ panel, content: contentBounds.content })}`);
    }
    assert.ok(contentBounds.editor.width >= 480, `CONTENT_BOX_EDITOR_MINIMUM_BROKEN:${JSON.stringify(contentBounds.editor)}`);
    assert.ok(contentBounds.chat.width >= 320 && contentBounds.chat.height >= 320, `CONTENT_BOX_CHAT_MINIMUM_BROKEN:${JSON.stringify(contentBounds.chat)}`);
    assert.ok(contentBounds.scrollWidth <= contentBounds.clientWidth + 1, `CONTENT_BOX_PAGE_HORIZONTAL_OVERFLOW:${JSON.stringify(contentBounds)}`);
  } finally {
    await closeRoomContext(context);
  }
});

test("remediation: room layout values reset when only the invite code changes", { timeout: 35_000 }, async () => {
  const { context, page } = await openRoom({
    auth: fixtures.owner,
    room: fixtures.room,
    viewport: { width: 1440, height: 900 },
  });
  try {
    await openSurface(page, "Чат");
    const firstDivider = page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true });
    await firstDivider.focus();
    await page.keyboard.press("End");
    const changedValue = Number(await firstDivider.getAttribute("aria-valuenow"));
    await page.evaluate((inviteCode) => {
      history.pushState({}, "", `/room/${inviteCode}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, fixtures.resetRoom.inviteCode);
    await page.waitForURL(`**/room/${fixtures.resetRoom.inviteCode}`);
    await settleLayout(page);
    await openSurface(page, "Чат");
    const secondDivider = page.getByRole("separator", { name: "Изменить ширину контекстной панели", exact: true });
    assert.notEqual(Number(await secondDivider.getAttribute("aria-valuenow")), changedValue, "ROOM_LAYOUT_PERSISTED_TO_DIFFERENT_INVITE_CODE");
  } finally {
    await closeRoomContext(context);
  }
});
