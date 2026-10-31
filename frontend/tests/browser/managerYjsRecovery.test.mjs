import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { chromium } from "playwright";
import * as Y from "yjs";
import config from "../../rspack.config.mjs";

// Real RoomPage, transport hook and CodeMirror/Yjs editor; only the remote
// HTTP/SSE boundary is synthetic. The loopback server and build are test-owned.
const frontend = fileURLToPath(new URL("../../", import.meta.url));
const inviteCode = "manager-recovery-fixture";
const user = { id: "recovery-owner", nickname: "recovery-owner", displayName: "Recovery owner", role: "user", isHr: false };
const largeCode = Array.from({ length: 1_250 }, (_, index) => `const row${index} = ${index};`).join("\n");
let scratch, server, browser, origin;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "interhub-manager-yjs-"));
  const entry = join(scratch, "fixture.tsx");
  const output = join(scratch, "build");
  await writeFile(entry, `
import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { store } from ${JSON.stringify(join(frontend, "src/app/store.ts"))};
import { setCurrentUser } from ${JSON.stringify(join(frontend, "src/features/auth/authSlice.ts"))};
import { ThemeProvider } from ${JSON.stringify(join(frontend, "src/features/theme/ThemeProvider.tsx"))};
import { RoomPage } from ${JSON.stringify(join(frontend, "src/pages/RoomPage.tsx"))};
import "antd/dist/reset.css";
import ${JSON.stringify(join(frontend, "public/theme-tokens.css"))};
import ${JSON.stringify(join(frontend, "src/styles/global.css"))};
store.dispatch(setCurrentUser(JSON.parse(localStorage.getItem("auth_user"))));
createRoot(document.getElementById("root")).render(<Provider store={store}><ThemeProvider><BrowserRouter useTransitions={false}><Routes><Route path="/room/:inviteCode" element={<RoomPage />} /></Routes></BrowserRouter></ThemeProvider></Provider>);
`);
  const compiler = rspack({ ...config, context: frontend, mode: "development", devtool: false,
    entry: { fixture: entry }, resolve: { ...config.resolve, alias: { components: join(frontend, "src/components") }, modules: [join(frontend, "node_modules"), "node_modules"] },
    output: { ...config.output, path: output, filename: "[name].js", chunkFilename: "[name].[contenthash:8].js" },
    optimization: { minimize: false, splitChunks: { chunks: "all" }, runtimeChunk: "single" },
    plugins: config.plugins.filter(plugin => !["CopyRspackPlugin", "HtmlRspackPlugin"].includes(plugin.constructor.name)),
  });
  let stats;
  try {
    stats = await new Promise((done, reject) => compiler.run((error, result) => error ? reject(error) : done(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
  } finally { await new Promise(done => compiler.close(done)); }
  const assets = stats.toJson({ all: false, entrypoints: true }).entrypoints.fixture.assets.map(asset => asset.name);
  const html = `<!doctype html><html><head>${assets.filter(name => name.endsWith(".css")).map(name => `<link rel="stylesheet" href="/${name}">`).join("")}</head><body><div id="root"></div>${assets.filter(name => name.endsWith(".js")).map(name => `<script defer src="/${name}"></script>`).join("")}</body></html>`;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname.startsWith("/room/")) { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
    const path = resolve(output, `.${pathname}`);
    if (!path.startsWith(`${output}/`)) { response.writeHead(403).end(); return; }
    try { response.setHeader("Content-Type", extname(path) === ".js" ? "application/javascript" : "text/css"); response.end(await readFile(path)); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
}, { timeout: 120_000 });

after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

function gate() {
  let release;
  return { promise: new Promise(done => { release = done; }), release: () => release() };
}
const encode = doc => Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
const decode = encoded => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(encoded, "base64"));
  return doc;
};

async function closeFixture(context) {
  // A heartbeat may already be inside a route callback when the assertion
  // completes. Retire those handlers before destroying their browser page.
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
}

async function openFixture({ loseFirstChatAcknowledgement = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let document = new Y.Doc();
  document.getText("room-code").insert(0, largeCode);
  let sequence = 0;
  let armed = false;
  let holdCanonical = false;
  let forcedConflict = null;
  let forcedFailure = null;
  let eventWatermark = 0;
  let privateTaskId = "task-1";
  let oldTaskDocument = null;
  const noteReceipts = new Map();
  const requests = [];
  const publications = [];
  const errors = [];
  const tasks = [0, 1].map(stepIndex => ({ id: `task-${stepIndex}`, stepIndex, title: `Task ${stepIndex}`, description: "", starterCode: stepIndex ? largeCode : "// public", language: "nodejs", score: null, categoryName: null }));
  const room = { id: "recovery-room", inviteCode, title: "Recovery room", language: "nodejs", code: "// public", currentStep: 0,
    tasks, status: "active", notes: "", notesMessages: [], personalNotes: [], briefingMarkdown: "", roomEditorMode: "code", roomEditorModeRevision: 0,
    role: "owner", isOwner: true, canManageRoom: true, canGrantAccess: true, eventToken: "fixture-event", participants: [], taskScores: {},
    lastCodeUpdatedBySessionId: null, notesLockedBySessionId: null, notesLockedByDisplayName: null, notesLockedUntilEpochMs: null,
    cursors: [], lastCandidateKey: null, candidateKeyHistory: [], lastYjsSequence: 0, yjsDocumentBase64: null, accessMembers: [] };
  const snapshot = recovery => ({ taskId: privateTaskId, stepIndex: 1, title: tasks[1].title, language: "nodejs", code: document.getText("room-code").toString(),
    briefingMarkdown: "", revision: 0, yjsDocumentBase64: encode(document), yjsSequence: sequence, focusMode: false, recovery });
  await context.addInitScript(({ user, room }) => {
    localStorage.setItem("auth_token", "fixture-auth");
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
    localStorage.setItem("room_sync_log", "0");
    window.fixtureStreams = [];
    window.fixtureEmit = message => window.fixtureStreams.filter(stream => stream.readyState === 1).forEach(stream => stream.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
    window.EventSource = class extends EventTarget {
      static OPEN = 1;
      static CLOSED = 2;
      readyState = 0;
      constructor() {
        super();
        window.fixtureStreams.push(this);
        setTimeout(() => { if (this.readyState === 2) return; this.readyState = 1; this.onopen?.(new Event("open")); this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "state_sync", payload: room }) })); }, 20);
      }
      close() { this.readyState = 2; }
    };
  }, { user, room });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(String(error)));
  const emit = message => page.evaluate(value => window.fixtureEmit(value), message);
  const emitCanonical = async (recovery = false) => { if (!holdCanonical || recovery) await emit({ type: "manager_workspace_sync", payload: snapshot(recovery) }); };
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const payload = request.postDataJSON();
    let body, status = 200;
    if (path.endsWith("/events")) {
      const record = { ...payload, status: null };
      requests.push(record);
      if (payload.type === "note_message" && loseFirstChatAcknowledgement) {
        // Chat receipt idempotency is checked before the generic sequence
        // watermark, as in the real server. Simulate an accepted write whose
        // HTTP acknowledgement was lost between server and client.
        const existing = noteReceipts.get(payload.clientMessageId);
        if (existing) {
          record.status = 200;
          await route.fulfill({ status: 200, json: existing });
          return;
        }
        eventWatermark = Math.max(eventWatermark, payload.clientEventSequence ?? 0);
        noteReceipts.set(payload.clientMessageId, { type: "note_message_ack", status: "persisted", clientMessageId: payload.clientMessageId,
          messageId: "persisted-fixture-message", persistedAtEpochMs: payload.noteTimestampEpochMs });
        record.status = 0;
        await route.abort("connectionfailed");
        return;
      }
      if (payload.clientEventSequence != null && !["request_state_sync", "presence_update"].includes(payload.type)) {
        if (payload.clientEventSequence <= eventWatermark) {
          record.status = 409;
          await route.fulfill({ status: 409, json: { code: "CONFLICT", error: "Устаревшая последовательность события для сессии" } });
          return;
        }
        // The real relay consumes the global session sequence even if the
        // later workspace CAS rejects this event.
        eventWatermark = payload.clientEventSequence;
      }
      if (payload.type === "manager_workspace_open") { await emitCanonical(); status = 204; }
      else if (payload.type === "request_state_sync") { await emit({ type: "state_sync", payload: room }); status = 204; }
      else if (payload.type === "manager_workspace_yjs_update") {
        if (armed && !forcedConflict) {
          forcedConflict = { response: gate(), recovery: gate(), order: "http-first", obsoleteConnection: false };
          await forcedConflict.response.promise;
          if (forcedConflict.order === "sse-first") await emitCanonical(true);
          status = forcedFailure?.status ?? 409;
          body = forcedFailure ?? { code: "CONFLICT", error: "Manager workspace Yjs snapshot requires resynchronisation" };
          record.status = status;
          await route.fulfill({ status, json: body });
          if (!forcedFailure && forcedConflict.order === "http-first") { await forcedConflict.recovery.promise; if (!forcedConflict.obsoleteConnection) await emitCanonical(true); }
          return;
        }
        if (forcedFailure?.status === 400) {
          status = forcedFailure.status;
          body = forcedFailure;
        } else if (payload.baseServerYjsSequence !== sequence) {
          status = 409;
          body = { code: "CONFLICT", error: "Manager workspace Yjs snapshot requires resynchronisation" };
          if (!holdCanonical) await emitCanonical(true);
        } else {
          if (payload.yjsDocumentBase64) document = decode(payload.yjsDocumentBase64);
          sequence++;
          status = 204;
          await emitCanonical();
        }
      } else if (payload.type === "set_step") {
        publications.push({ code: document.getText("room-code").toString(), sequence, requestIndex: requests.length - 1 });
        room.currentStep = payload.stepIndex; room.code = document.getText("room-code").toString(); room.yjsDocumentBase64 = encode(document); room.lastYjsSequence = sequence;
        await emit({ type: "state_sync", payload: room }); status = 204;
      } else status = 204;
      record.status = status;
    } else if (path === `/api/rooms/${inviteCode}`) body = room;
    else if (path.endsWith("/tasks/1/workspace")) body = snapshot(false);
    else if (path.endsWith("/workspaces")) body = [{ id: "personal", name: "Личное", role: "OWNER", epoch: 1, revision: 1, capabilities: [] }];
    else if (path.endsWith("/tasks")) body = [];
    else if (path.endsWith("/interview-metadata")) body = { candidateName: null, position: null, scheduledAt: null, revision: 0 };
    else if (path.endsWith("/hr-managers")) body = [];
    else if (path.endsWith("/activity")) body = { events: [], hasMore: false };
    else if (path.endsWith("/stream-status")) body = { status: "available" };
    else { status = 404; body = { error: `Unknown isolated fixture: ${path}` }; }
    if (status === 204) await route.fulfill({ status }); else await route.fulfill({ status, json: body });
  });
  await page.goto(`${origin}/room/${inviteCode}`);
  await page.getByTestId("room-code-editor-host").locator(".cm-editor").waitFor();
  await page.getByRole("tab", { name: "Шаги", exact: true }).click();
  await page.getByTestId("room-step-row-1").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state.doc.toString().includes("row1249"));
  await page.waitForTimeout(600);
  return { context, page, requests, publications, errors, emit, getCode: () => document.getText("room-code").toString(),
    arm: () => { armed = true; holdCanonical = true; document.getText("room-code").insert(document.getText("room-code").length, "\nREMOTE_CONCURRENT_MARKER\n"); sequence++; },
    rejectNextSnapshot: (status, code) => { armed = true; holdCanonical = true; forcedFailure = { status, code, error: status === 400 ? "Private snapshot is invalid" : "Исходная задача изменилась" }; },
    replaceTask: async () => {
      oldTaskDocument = decode(encode(document));
      privateTaskId = "replacement-task-1";
      document = new Y.Doc(); document.getText("room-code").insert(0, "// REPLACEMENT_TASK_DOCUMENT\n"); sequence = 0;
      tasks[1] = { ...tasks[1], id: privateTaskId, title: "Replacement Task 1", starterCode: document.getText("room-code").toString() };
      await emit({ type: "state_sync", payload: room });
      await emit({ type: "manager_workspace_sync", payload: snapshot(false) });
    },
    emitLateOldTaskUpdate: async () => {
      oldTaskDocument.getText("room-code").insert(oldTaskDocument.getText("room-code").length, "\nOLD_TASK_LATE_DELTA\n");
      await emit({ type: "manager_workspace_yjs_update", payload: { taskId: "task-1", stepIndex: 1, sessionId: "old-task-peer", yjsUpdate: encode(oldTaskDocument), yjsSequence: sequence + 1 } });
    },
    corruptCanonical: async () => {
      sequence++;
      await emit({ type: "manager_workspace_sync", payload: { ...snapshot(false), yjsDocumentBase64: Buffer.from("invalid-yjs-document").toString("base64") } });
    },
    releaseConflict: async order => {
      assert.ok(forcedConflict, "an actual editor write reached the synthetic relay");
      forcedConflict.order = order;
      forcedConflict.response.release();
    },
    releaseRecovery: () => { holdCanonical = false; forcedConflict.recovery.release(); },
    reconnect: async () => {
      holdCanonical = false;
      forcedConflict.obsoleteConnection = true;
      forcedConflict.recovery.release();
      await page.evaluate(() => window.fixtureStreams.find(stream => stream.readyState === 1)?.onerror?.(new Event("error")));
    },
    revoke: async () => {
      room.canManageRoom = false; room.canGrantAccess = false; room.isOwner = false; room.role = "candidate";
      await emit({ type: "state_sync", payload: room });
    },
  };
}

test("idle large private editor does not repeatedly submit an unchanged canonical snapshot", { timeout: 30_000 }, async () => {
  const fixture = await openFixture();
  try {
    const before = fixture.requests.filter(item => item.type === "manager_workspace_yjs_update").length;
    await fixture.page.waitForTimeout(2_750);
    assert.equal(fixture.requests.filter(item => item.type === "manager_workspace_yjs_update").length, before, "unchanged 2.5-second heartbeats are local no-ops after canonical confirmation");
  } finally { await closeFixture(fixture.context); }
});

test("manual chat retry preserves its original delivery identity after a lost acknowledgement", { timeout: 30_000 }, async () => {
  const fixture = await openFixture({ loseFirstChatAcknowledgement: true });
  try {
    await fixture.page.getByRole("tab", { name: "Чат", exact: true }).click();
    await fixture.page.getByPlaceholder("Напишите сообщение для интервьюеров").fill("CHAT_RETRY_ORIGINAL_IDENTITY");
    await fixture.page.getByTestId("room-notes-send").click();
    await fixture.page.getByRole("button", { name: "Повторить отправку", exact: true }).click();
    const deadline = Date.now() + 5_000;
    while (fixture.requests.filter(item => item.type === "note_message").length < 2 && Date.now() < deadline) await fixture.page.waitForTimeout(20);
    const attempts = fixture.requests.filter(item => item.type === "note_message");
    assert.equal(attempts.length, 2, "one explicit retry follows the original failed delivery");
    for (const key of ["clientEventSequence", "clientMessageId", "noteText", "noteTimestampEpochMs", "sessionId"]) assert.equal(attempts[1][key], attempts[0][key], `manual retry preserves original ${key}`);
    assert.equal(attempts[0].status, 0);
    assert.equal(attempts[1].status, 200);
    await fixture.page.locator("[data-chat-delivery-state='persisted']").filter({ hasText: "CHAT_RETRY_ORIGINAL_IDENTITY" }).waitFor();
    assert.equal(await fixture.page.getByRole("button", { name: "Повторить отправку", exact: true }).count(), 0, "the duplicate receipt settles the original chat intent");
    assert.deepEqual(fixture.errors, []);
  } finally { await closeFixture(fixture.context); }
});

test("reconnect while private recovery SSE is missing reopens the workspace and saves before publication", { timeout: 30_000 }, async () => {
  const fixture = await openFixture();
  try {
    fixture.arm();
    await append(fixture.page, "LOCAL_BEFORE_RECONNECT");
    await fixture.page.getByTestId("room-publish-step").click();
    await fixture.releaseConflict("http-first");
    await fixture.page.waitForTimeout(100);
    await fixture.reconnect();
    const deadline = Date.now() + 10_000;
    while (!fixture.publications.length && Date.now() < deadline) await fixture.page.waitForTimeout(20);
    assert.equal(fixture.publications.length, 1, `publication resumes after reconnect without an old-connection recovery event: ${JSON.stringify(fixture.requests.map(({ type, status, clientEventSequence, baseServerYjsSequence }) => ({ type, status, clientEventSequence, baseServerYjsSequence })))}`);
    for (const marker of ["row1249", "REMOTE_CONCURRENT_MARKER", "LOCAL_BEFORE_RECONNECT"]) assert.ok(fixture.publications[0].code.includes(marker), `reconnected publication preserves ${marker}`);
    assert.ok(fixture.requests.filter(item => item.type === "manager_workspace_open").length >= 2, "workspace subscription is restored on a fresh stream");
    assert.ok(fixture.requests.filter(item => item.status === 409).length <= 2, "recovery does not violate the global session event sequence");
    assert.deepEqual(fixture.errors, []);
  } finally { await closeFixture(fixture.context); }
});

test("manager access revocation cancels private recovery and queued publication", { timeout: 30_000 }, async () => {
  const fixture = await openFixture();
  try {
    fixture.arm();
    await append(fixture.page, "LOCAL_BEFORE_REVOCATION");
    await fixture.page.getByTestId("room-publish-step").click();
    await fixture.releaseConflict("http-first");
    await fixture.page.waitForTimeout(100);
    await fixture.revoke();
    const before = fixture.requests.filter(item => item.type.startsWith("manager_workspace_")).length;
    fixture.releaseRecovery();
    await fixture.page.waitForTimeout(2_750);
    assert.equal(fixture.requests.filter(item => item.type.startsWith("manager_workspace_")).length, before, "a delayed canonical recovery cannot restart manager writes after demotion");
    assert.equal(fixture.publications.length, 0, "an unpublished manager command is cancelled on access loss");
    assert.deepEqual(fixture.errors, []);
  } finally { await closeFixture(fixture.context); }
});

for (const rejection of [{ status: 400, code: "BAD_REQUEST" }, { status: 409, code: "WORKSPACE_TASK_CHANGED" }]) {
  test(`permanent private snapshot rejection ${rejection.code} cancels publication without losing or rebinding the draft`, { timeout: 30_000 }, async () => {
    const fixture = await openFixture();
    try {
      fixture.rejectNextSnapshot(rejection.status, rejection.code);
      const writesBeforeFailure = fixture.requests.filter(item => item.type === "manager_workspace_yjs_update").length;
      await append(fixture.page, "LOCAL_UNSAVED_AFTER_REJECTION");
      await fixture.page.getByTestId("room-publish-step").click();
      await fixture.releaseConflict("http-first");
      await fixture.page.waitForTimeout(250);
      if (rejection.code === "WORKSPACE_TASK_CHANGED") { await fixture.replaceTask(); await fixture.emitLateOldTaskUpdate(); }
      await fixture.page.waitForTimeout(2_750);
      assert.equal(fixture.publications.length, 0, "a failed document save cannot be followed by publication of stale or replacement task content");
      if (rejection.status === 400) {
        const localText = await fixture.page.getByTestId("room-code-editor-host").evaluate(host => host.__roomEditorView.state.doc.toString());
        assert.ok(localText.includes("LOCAL_UNSAVED_AFTER_REJECTION"), "the unsaved local document remains available after a permanent rejection");
      } else {
        assert.ok(fixture.requests.filter(item => item.taskId === "replacement-task-1").every(item => !item.code?.includes("LOCAL_UNSAVED_AFTER_REJECTION")), "old task text is never rebound to a new task UUID at the same index");
        const replacementText = await fixture.page.getByTestId("room-code-editor-host").evaluate(host => host.__roomEditorView.state.doc.toString());
        assert.ok(!replacementText.includes("OLD_TASK_LATE_DELTA"), "a delayed incremental event from the old task UUID cannot enter the replacement editor");
      }
      assert.ok(fixture.requests.filter(item => item.type === "manager_workspace_yjs_update").length <= writesBeforeFailure + 2, `a permanent rejection cannot create a heartbeat retry flood: ${JSON.stringify(fixture.requests.filter(item => item.type === "manager_workspace_yjs_update").map(({ status, clientEventSequence, baseServerYjsSequence }) => ({ status, clientEventSequence, baseServerYjsSequence })))}`);
      assert.ok(!fixture.getCode().includes("LOCAL_UNSAVED_AFTER_REJECTION"), "rejected local text must not silently overwrite canonical task content");
      assert.ok(!fixture.getCode().includes("OLD_TASK_LATE_DELTA"), "old-task deltas cannot be persisted into a replacement workspace");
      assert.deepEqual(fixture.errors, []);
    } finally { await closeFixture(fixture.context); }
  });
}

test("malformed canonical private snapshot keeps local text and cancels publication without a retry loop", { timeout: 30_000 }, async () => {
  const fixture = await openFixture();
  try {
    fixture.rejectNextSnapshot(409, "WORKSPACE_YJS_RESYNC_REQUIRED");
    await append(fixture.page, "LOCAL_BEFORE_MALFORMED_SNAPSHOT");
    await fixture.corruptCanonical();
    await fixture.page.getByTestId("room-publish-step").click();
    await fixture.releaseConflict("http-first");
    await fixture.page.waitForTimeout(2_750);
    assert.equal(fixture.publications.length, 0, "a malformed recovery document never releases dependent publication");
    const localText = await fixture.page.getByTestId("room-code-editor-host").evaluate(host => host.__roomEditorView.state.doc.toString());
    assert.ok(localText.includes("LOCAL_BEFORE_MALFORMED_SNAPSHOT"), "the original editable document survives malformed recovery data");
    assert.ok(fixture.requests.filter(item => item.type === "manager_workspace_yjs_update").length <= 2, "malformed canonical data cannot trigger repeated private writes");
    assert.deepEqual(fixture.errors, [], "malformed server data is handled without uncaught errors or a microtask exception loop");
    await fixture.page.getByText(/Не удалось подготовить|Не удалось сохранить|Не удалось синхронизировать|Не удалось восстановить/).first().waitFor();
  } finally { await closeFixture(fixture.context); }
});

test("publishing an idle editor with a malformed canonical snapshot never bypasses a synchronous save failure", { timeout: 30_000 }, async () => {
  const fixture = await openFixture();
  try {
    await append(fixture.page, "LOCAL_BEFORE_IDLE_MALFORMED");
    const deadline = Date.now() + 5_000;
    while (!fixture.getCode().includes("LOCAL_BEFORE_IDLE_MALFORMED") && Date.now() < deadline) await fixture.page.waitForTimeout(20);
    assert.ok(fixture.getCode().includes("LOCAL_BEFORE_IDLE_MALFORMED"), "the editor is idle after its preceding write was accepted");
    await fixture.corruptCanonical();
    await fixture.page.getByTestId("room-publish-step").click();
    await fixture.page.waitForTimeout(250);
    assert.equal(fixture.publications.length, 0, "a synchronously rejected snapshot blocks the publication command enqueued immediately afterwards");
    const localText = await fixture.page.getByTestId("room-code-editor-host").evaluate(host => host.__roomEditorView.state.doc.toString());
    assert.ok(localText.includes("LOCAL_BEFORE_IDLE_MALFORMED"));
    assert.deepEqual(fixture.errors, []);
  } finally { await closeFixture(fixture.context); }
});

test("a hundred rapid edits to a large private document recover in bounded requests before publication", { timeout: 30_000 }, async () => {
  const fixture = await openFixture();
  try {
    fixture.arm();
    await append(fixture.page, "BURST_FIRST_HELD_EDIT");
    await fixture.page.evaluate(() => {
      const view = document.querySelector("[data-testid='room-code-editor-host']").__roomEditorView;
      for (let index = 0; index < 100; index++) view.dispatch({ changes: { from: view.state.doc.length, insert: `\nBURST_MARKER_${index}_END\n` } });
    });
    await fixture.page.getByTestId("room-publish-step").click();
    await fixture.releaseConflict("sse-first");
    fixture.releaseRecovery();
    const deadline = Date.now() + 10_000;
    while (!fixture.publications.length && Date.now() < deadline) await fixture.page.waitForTimeout(20);
    assert.equal(fixture.publications.length, 1, "publication finishes after the held conflicting request");
    const published = fixture.publications[0].code;
    for (const marker of ["row1249", "REMOTE_CONCURRENT_MARKER", "BURST_FIRST_HELD_EDIT", ...Array.from({ length: 100 }, (_, index) => `BURST_MARKER_${index}_END`)]) assert.ok(published.includes(marker), `batched publication preserves ${marker}`);
    const acceptedWrites = fixture.requests.filter(item => item.type === "manager_workspace_yjs_update" && item.status === 204);
    assert.ok(acceptedWrites.length <= 4, `rapid input is batched instead of transmitting every full 1250-line snapshot (${acceptedWrites.length} accepted writes)`);
    assert.ok(fixture.requests.filter(item => item.type === "manager_workspace_yjs_update" && item.status === 409).length <= 2, "the batch does not replay stale sequence envelopes");
    assert.deepEqual(fixture.errors, []);
  } finally { await closeFixture(fixture.context); }
});

async function append(page, marker) {
  await page.evaluate(text => {
    const view = document.querySelector("[data-testid='room-code-editor-host']").__roomEditorView;
    view.dispatch({ changes: { from: view.state.doc.length, insert: `\n${text}\n` } });
  }, marker);
}

for (const order of ["http-first", "sse-first"]) {
  test(`large manager document recovers ${order} conflict before publishing local and remote edits`, { timeout: 30_000 }, async () => {
    const fixture = await openFixture();
    const { context, page, requests, publications } = fixture;
    try {
      fixture.arm();
      await append(page, "LOCAL_PENDING_ONE");
      await append(page, "LOCAL_PENDING_TWO");
      await page.getByTestId("room-publish-step").click();
      await append(page, "LOCAL_TYPED_DURING_PUBLICATION");
      await fixture.releaseConflict(order);
      if (order === "http-first") {
        // Hold the canonical channel beyond the real editor heartbeat period.
        // A recovery loop must not dispatch the same stale document every tick.
        await page.waitForTimeout(2_750);
        assert.equal(publications.length, 0, "publication must wait for the rejected private document to merge and save, even when HTTP arrives before canonical SSE");
        assert.ok(requests.filter(item => item.type === "manager_workspace_yjs_update" && item.status === 409).length <= 2, "waiting for canonical SSE must not flood stale private snapshots");
        await append(page, "LOCAL_TYPED_DURING_RECOVERY");
      }
      fixture.releaseRecovery();
      const deadline = Date.now() + 10_000;
      while (!publications.length && Date.now() < deadline) await page.waitForTimeout(20);
      assert.equal(publications.length, 1, `publication completes after recovery: ${JSON.stringify(requests.map(({ type, status, baseServerYjsSequence }) => ({ type, status, baseServerYjsSequence })))}`);
      const markers = ["row1249", "REMOTE_CONCURRENT_MARKER", "LOCAL_PENDING_ONE", "LOCAL_PENDING_TWO", "LOCAL_TYPED_DURING_PUBLICATION"];
      if (order === "http-first") markers.push("LOCAL_TYPED_DURING_RECOVERY");
      for (const marker of markers) assert.ok(publications[0].code.includes(marker), `published document preserves ${marker}`);
      assert.ok(requests.filter(item => item.type === "manager_workspace_yjs_update" && item.status === 409).length <= 2, "recovery is bounded instead of replaying every stale full snapshot");
      assert.deepEqual(fixture.errors, []);
    } finally { await closeFixture(context); }
  });
}
