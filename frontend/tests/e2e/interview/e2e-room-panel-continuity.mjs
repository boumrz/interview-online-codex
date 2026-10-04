import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";

let browser;

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
  assert.ok(
    expected.includes(response.status),
    `${method} ${path}: status=${response.status} body=${text.slice(0, 600)}`,
  );
  return text ? JSON.parse(text) : null;
}

async function register(label) {
  return request("/auth/register", {
    method: "POST",
    body: {
      nickname: `ac12_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      displayName: label,
      password: "test-password-123",
    },
  });
}

async function createTask(owner, ordinal) {
  return request("/me/tasks", {
    token: owner.token,
    method: "POST",
    body: {
      title: `${ordinal}. Непрерывность общения ${randomUUID().slice(0, 8)}`,
      description: `Условие шага ${ordinal}: сохранить локальное чтение и доставку сообщения.`,
      starterCode: `function step${ordinal}() {\n  return ${ordinal};\n}\n`,
      language: "nodejs",
    },
  });
}

async function createFixture(label, taskCount = 2) {
  const owner = await register(`Владелец ${label}`);
  const interviewer = await register(`Интервьюер ${label}`);
  const tasks = [];
  for (let ordinal = 1; ordinal <= taskCount; ordinal += 1) {
    tasks.push(await createTask(owner, ordinal));
  }
  const room = await request("/rooms", {
    token: owner.token,
    method: "POST",
    body: { title: `Комната ${label}`, taskIds: tasks.map((task) => task.id) },
  });
  await request(`/rooms/${room.inviteCode}/participants/${interviewer.user.id}/role`, {
    token: owner.token,
    method: "POST",
    body: { role: "interviewer" },
  });
  return { owner, interviewer, tasks, room };
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function openRoom(auth, room, viewport = { width: 1280, height: 720 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ authValue }) => {
    if (localStorage.getItem("ac12_auth_seeded") !== "true") {
      localStorage.setItem("auth_token", authValue.token);
      localStorage.setItem("auth_user", JSON.stringify(authValue.user));
      localStorage.setItem("display_name", authValue.user.displayName);
      localStorage.setItem("ac12_auth_seeded", "true");
    }
    window.__ac12SseConnections = 0;
    const NativeEventSource = window.EventSource;
    window.EventSource = class TrackingEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args);
        window.__ac12SseConnections += 1;
        window.__ac12EventSource = this;
      }
    };
  }, { authValue: auth });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ state: "attached", timeout: 20_000 });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ timeout: 20_000 });
  await settle(page);
  assert.equal(await page.getByRole("tab", { name: "Шаги", exact: true }).getAttribute("aria-selected"), "true", "AC12_ROOM_STARTS_WITH_STEPS");
  return { context, page };
}

async function openSurface(page, name) {
  const tab = page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true })
    .getByRole("tab", { name, exact: true });
  await tab.click();
  await settle(page);
  assert.equal(await tab.getAttribute("aria-selected"), "true", `AC12_SURFACE_NOT_SELECTED:${name}`);
}

async function sendChat(page, text) {
  const input = page.locator('[data-testid="room-notes-input"]');
  await input.fill(text);
  await page.locator('[data-testid="room-notes-send"]').click();
}

async function waitForChatMessage(page, text) {
  await page.getByRole("log", { name: "История чата интервьюеров", exact: true })
    .getByText(text, { exact: true })
    .waitFor({ timeout: 15_000 });
}

function relayPattern(inviteCode) {
  return `**/api/realtime/rooms/${inviteCode}/events`;
}

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

test("AC-12 preserves draft, panel and read position through local step changes and reconnect; new chat never steals attention", { timeout: 90_000 }, async () => {
  const fixture = await createFixture("контроль внимания");
  const ownerView = await openRoom(fixture.owner, fixture.room);
  const colleagueView = await openRoom(fixture.interviewer, fixture.room);
  try {
    await openSurface(ownerView.page, "Чат");
    await openSurface(colleagueView.page, "Чат");

    const longLine = " Подробность нужна, чтобы история гарантированно имела собственную прокрутку.";
    let historyOverflow = false;
    for (let index = 1; index <= 16 && !historyOverflow; index += 1) {
      const text = `Историческое сообщение ${index}.${longLine.repeat(3)}`;
      await sendChat(colleagueView.page, text);
      await waitForChatMessage(ownerView.page, text);
      historyOverflow = await ownerView.page.getByRole("log", { name: "История чата интервьюеров", exact: true })
        .evaluate((element) => element.scrollHeight > element.clientHeight + 8);
    }
    assert.equal(historyOverflow, true, "AC12_CHAT_FIXTURE_DID_NOT_OVERFLOW");

    const history = ownerView.page.getByRole("log", { name: "История чата интервьюеров", exact: true });
    await history.evaluate((element) => { element.scrollTop = 0; });
    const draft = "Незавершённый черновик остаётся только в текущей комнате";
    await ownerView.page.locator('[data-testid="room-notes-input"]').fill(draft);

    await openSurface(ownerView.page, "Шаги");
    await ownerView.page.locator('[data-testid="room-step-row-1"]').click();
    await openSurface(ownerView.page, "Чат");
    assert.equal(await ownerView.page.locator('[data-testid="room-notes-input"]').inputValue(), draft);
    assert.ok(await history.evaluate((element) => element.scrollTop <= 2), "AC12_LOCAL_STEP_CHANGE_LOST_READ_POSITION");

    const previousConnections = await ownerView.page.evaluate(() => window.__ac12SseConnections);
    await ownerView.page.evaluate(() => {
      const source = window.__ac12EventSource;
      source?.onerror?.(new Event("error"));
    });
    await ownerView.page.waitForFunction(
      (previous) => window.__ac12SseConnections > previous,
      previousConnections,
      { timeout: 15_000 },
    );
    await ownerView.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor({ timeout: 15_000 });
    assert.equal(await ownerView.page.locator('[data-testid="room-notes-input"]').inputValue(), draft);
    assert.ok(await history.evaluate((element) => element.scrollTop <= 2), "AC12_RECONNECT_LOST_READ_POSITION");

    const editor = ownerView.page.locator('[data-testid="room-code-editor-host"] .cm-content');
    await editor.focus();
    const scrollBefore = await history.evaluate((element) => element.scrollTop);
    const freshText = `Новое сообщение коллеги ${randomUUID()}`;
    await sendChat(colleagueView.page, freshText);
    await waitForChatMessage(ownerView.page, freshText);
    await settle(ownerView.page);

    assert.equal(
      await ownerView.page.locator('[data-testid="room-code-editor-host"] .cm-editor')
        .evaluate((element) => element.contains(document.activeElement)),
      true,
      "AC12_NEW_MESSAGE_STOLE_EDITOR_FOCUS",
    );
    assert.ok(
      Math.abs((await history.evaluate((element) => element.scrollTop)) - scrollBefore) <= 2,
      "AC12_NEW_MESSAGE_STOLE_READING_POSITION",
    );
    const unread = ownerView.page.locator('[data-testid="room-chat-unread-count"]');
    await unread.waitFor({ state: "visible" });
    assert.equal((await unread.textContent())?.trim(), "1", "AC12_UNREAD_COUNT_WRONG");

    await openSurface(ownerView.page, "Шаги");
    await ownerView.page.getByRole("button", { name: "Свернуть условие", exact: true }).click();
    await ownerView.page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    assert.equal(await ownerView.page.getByRole("tab", { name: "Шаги", exact: true }).getAttribute("aria-selected"), "true", "AC12_CONDITION_CHANGED_AUXILIARY_PANEL");
    assert.equal((await unread.textContent())?.trim(), "1", "AC12_UNREAD_CLEARED_WITHOUT_READING_CHAT");
    await openSurface(ownerView.page, "Чат");
    await ownerView.page.getByRole("button", { name: "Перейти к новым сообщениям", exact: true }).click();
    await settle(ownerView.page);
    assert.ok(
      await history.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop <= 2),
      "AC12_JUMP_TO_NEW_DID_NOT_REACH_MESSAGES",
    );
    assert.equal(await unread.count(), 0, "AC12_UNREAD_NOT_CLEARED_AFTER_ACTUAL_READ");
  } finally {
    await ownerView.context.close();
    await colleagueView.context.close();
  }
});

test("AC-12 polls durable activity only while visible and performs one serialized catch-up on reopen", { timeout: 45_000 }, async () => {
  const fixture = await createFixture("видимая история", 1);
  const view = await openRoom(fixture.owner, fixture.room, { width: 768, height: 1024 });
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  try {
    await view.page.route(`**/api/rooms/${fixture.room.inviteCode}/activity-history*`, async (route) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(new URL(route.request().url()).search);
      try {
        const response = await route.fetch();
        await route.fulfill({ response });
      } finally {
        inFlight -= 1;
      }
    });

    await openSurface(view.page, "Чат");
    const hiddenBaseline = calls.length;
    await view.page.waitForTimeout(5_600);
    assert.equal(
      calls.length,
      hiddenBaseline,
      `AC12_HIDDEN_ACTIVITY_CONTINUOUSLY_POLLED:${JSON.stringify(calls)}`,
    );

    await openSurface(view.page, "Активность");
    await view.page.waitForFunction(
      ({ baseline, inviteCode }) => performance.getEntriesByType("resource")
        .some((entry) => entry.name.includes(`/rooms/${inviteCode}/activity-history`) && entry.startTime > baseline),
      { baseline: performance.now() - 500, inviteCode: fixture.room.inviteCode },
      { timeout: 12_000 },
    ).catch(async () => {
      const deadline = Date.now() + 12_000;
      while (calls.length === hiddenBaseline && Date.now() < deadline) await view.page.waitForTimeout(100);
    });
    assert.ok(calls.length > hiddenBaseline, "AC12_VISIBLE_ACTIVITY_DID_NOT_CATCH_UP");

    await openSurface(view.page, "Чат");
    const closedAt = calls.length;
    await view.page.waitForTimeout(5_600);
    assert.equal(calls.length, closedAt, "AC12_HIDDEN_ACTIVITY_POLL_RESTARTED");
    await openSurface(view.page, "Активность");
    const deadline = Date.now() + 12_000;
    while (calls.length === closedAt && Date.now() < deadline) await view.page.waitForTimeout(100);
    assert.ok(calls.length > closedAt, "AC12_ACTIVITY_REOPEN_DID_NOT_CATCH_UP");
    assert.equal(maxInFlight, 1, "AC12_ACTIVITY_CATCH_UP_OVERLAPPED");
  } finally {
    await view.page.unrouteAll({ behavior: "wait" });
    await view.context.close();
  }
});

test("AC-12 exposes recoverable retry after a lost response and reuses the exact message intent", { timeout: 45_000 }, async () => {
  const fixture = await createFixture("потерянное подтверждение", 1);
  const view = await openRoom(fixture.owner, fixture.room);
  const attempts = [];
  let acknowledgeRetry = false;
  try {
    await openSurface(view.page, "Чат");
    await view.page.route(relayPattern(fixture.room.inviteCode), async (route) => {
      const body = route.request().postDataJSON();
      if (body?.type !== "note_message") return route.continue();
      attempts.push(body);
      if (!acknowledgeRetry) return route.abort("failed");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "private, no-store" },
        body: JSON.stringify({
          type: "note_message_ack",
          status: "persisted",
          clientMessageId: body.clientMessageId,
          messageId: "server-message-after-retry",
          persistedAtEpochMs: Date.now(),
        }),
      });
    });

    const text = "Сообщение с потерянным первым подтверждением";
    await sendChat(view.page, text);
    const retry = view.page.getByRole("button", { name: "Повторить отправку", exact: true });
    await retry.waitFor({ state: "visible", timeout: 12_000 });
    assert.equal(await view.page.locator('[data-testid="room-notes-input"]').inputValue(), text, "AC12_RETRY_LOST_TEXT");
    assert.equal(attempts.length, 1, "AC12_TRANSIENT_FAILURE_RETRIED_WITHOUT_USER_ACTION");
    assert.match(attempts[0].clientMessageId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(attempts[0].noteText, text);
    const original = {
      clientMessageId: attempts[0].clientMessageId,
      noteText: attempts[0].noteText,
      noteTimestampEpochMs: attempts[0].noteTimestampEpochMs,
      clientEventSequence: attempts[0].clientEventSequence,
    };

    acknowledgeRetry = true;
    await retry.click();
    const deadline = Date.now() + 12_000;
    while (attempts.length < 2 && Date.now() < deadline) await view.page.waitForTimeout(100);
    assert.equal(attempts.length, 2, "AC12_EXPLICIT_RETRY_NOT_SENT");
    assert.deepEqual(
      {
        clientMessageId: attempts[1].clientMessageId,
        noteText: attempts[1].noteText,
        noteTimestampEpochMs: attempts[1].noteTimestampEpochMs,
        clientEventSequence: attempts[1].clientEventSequence,
      },
      original,
      "AC12_RETRY_CHANGED_IMMUTABLE_INTENT",
    );
    await view.page.locator('[data-chat-delivery-state="persisted"]').filter({ hasText: text }).waitFor({ timeout: 12_000 });
    assert.equal(
      await view.page.getByRole("log", { name: "История чата интервьюеров", exact: true }).getByText(text, { exact: true }).count(),
      1,
      "AC12_RETRY_RENDERED_DUPLICATE",
    );
  } finally {
    await view.context.close();
  }
});

test("AC-12 clears chat state on room/account changes and terminal revoke; a late ACK cannot restore it", { timeout: 70_000 }, async () => {
  const first = await createFixture("очистка контекста A", 1);
  const secondRoom = await request("/rooms", {
    token: first.owner.token,
    method: "POST",
    body: { title: "Вторая комната того же аккаунта", taskIds: [] },
  });
  const other = await createFixture("очистка контекста B", 1);
  const ownerView = await openRoom(first.owner, first.room, { width: 1024, height: 768 });
  let revokedView;
  try {
    await openSurface(ownerView.page, "Чат");
    await ownerView.page.locator('[data-testid="room-notes-input"]').fill("Секрет первой комнаты");
    await ownerView.page.goto(`${web}/room/${secondRoom.inviteCode}`, { waitUntil: "domcontentloaded" });
    await ownerView.page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 20_000 });
    await openSurface(ownerView.page, "Чат");
    assert.equal(await ownerView.page.locator('[data-testid="room-notes-input"]').inputValue(), "", "AC12_ROOM_CHANGE_LEAKED_DRAFT");
    assert.equal(await ownerView.page.getByText("Секрет первой комнаты", { exact: true }).count(), 0, "AC12_ROOM_CHANGE_LEAKED_CHAT");

    await ownerView.page.locator('[data-testid="room-notes-input"]').fill("Секрет первого аккаунта");
    await ownerView.page.evaluate(({ auth }) => {
      localStorage.setItem("auth_token", auth.token);
      localStorage.setItem("auth_user", JSON.stringify(auth.user));
      localStorage.setItem("display_name", auth.user.displayName);
    }, { auth: other.owner });
    await ownerView.page.goto(`${web}/room/${other.room.inviteCode}`, { waitUntil: "domcontentloaded" });
    await ownerView.page.locator('[data-testid="room-code-editor-host"] .cm-editor').waitFor({ timeout: 20_000 });
    await openSurface(ownerView.page, "Чат");
    assert.equal(await ownerView.page.locator('[data-testid="room-notes-input"]').inputValue(), "", "AC12_ACCOUNT_CHANGE_LEAKED_DRAFT");
    assert.equal(await ownerView.page.getByText("Секрет первого аккаунта", { exact: true }).count(), 0, "AC12_ACCOUNT_CHANGE_LEAKED_CHAT");

    revokedView = await openRoom(first.interviewer, first.room, { width: 1024, height: 768 });
    await openSurface(revokedView.page, "Чат");
    let releaseLateResponse;
    let requestArrived;
    const held = new Promise((resolve) => { releaseLateResponse = resolve; });
    const arrived = new Promise((resolve) => { requestArrived = resolve; });
    await revokedView.page.route(relayPattern(first.room.inviteCode), async (route) => {
      const body = route.request().postDataJSON();
      if (body?.type !== "note_message") return route.continue();
      requestArrived();
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          type: "note_message_ack",
          status: "persisted",
          clientMessageId: body.clientMessageId,
          messageId: "late-message-after-revoke",
          persistedAtEpochMs: Date.now(),
        }),
      }).catch(() => {});
    });
    const revokedSecret = "Черновик и pending окончательно отозванного интервьюера";
    await sendChat(revokedView.page, revokedSecret);
    await arrived;
    await request(`/rooms/${first.room.inviteCode}/participants/${first.interviewer.user.id}/role`, {
      token: first.owner.token,
      method: "POST",
      body: { role: "candidate" },
    });
    await revokedView.page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true })
      .waitFor({ state: "detached", timeout: 15_000 });
    releaseLateResponse();
    await revokedView.page.waitForTimeout(500);
    assert.equal(await revokedView.page.getByText(revokedSecret, { exact: true }).count(), 0, "AC12_REVOKE_RETAINED_PROTECTED_CHAT");

    await request(`/rooms/${first.room.inviteCode}/participants/${first.interviewer.user.id}/role`, {
      token: first.owner.token,
      method: "POST",
      body: { role: "interviewer" },
    });
    await revokedView.page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true }).waitFor({ timeout: 15_000 });
    await openSurface(revokedView.page, "Чат");
    assert.equal(await revokedView.page.locator('[data-testid="room-notes-input"]').inputValue(), "", "AC12_REGRANT_RESTORED_REVOKED_DRAFT");
    assert.equal(await revokedView.page.getByText(revokedSecret, { exact: true }).count(), 0, "AC12_LATE_ACK_RESTORED_REVOKED_MESSAGE");
  } finally {
    await ownerView.context.close();
    await revokedView?.context.close();
  }
});
