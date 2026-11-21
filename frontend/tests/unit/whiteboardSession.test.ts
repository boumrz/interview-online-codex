import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import type { WhiteboardConnection, WhiteboardState } from "../../src/features/room/whiteboard/whiteboardSession.ts";
import { parseSnapshot, type WhiteboardChange, type WhiteboardElement, type WhiteboardSnapshot } from "../../src/features/room/whiteboard/whiteboardProtocol.ts";

// The application uses bundler resolution; resolve its relative TypeScript
// imports for the native Node test runner without rewriting production code.
register(`data:text/javascript,${encodeURIComponent(`export function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes('/frontend/src/') && specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
}`)}`, import.meta.url);
const { createWhiteboardSession } = await import("../../src/features/room/whiteboard/whiteboardSession.ts");

function element(id = "stroke", version = 1, overrides: Record<string, unknown> = {}): WhiteboardElement {
  return { id, type: "freedraw", x: 0, y: 0, width: 20, height: 30, version, versionNonce: 100, isDeleted: false, points: [[0, 0], [20, 30]], ...overrides };
}
function snapshot(elements: ReadonlyArray<WhiteboardElement> = [], sequence = 0, canEdit = true, files = {}): WhiteboardSnapshot { return parseSnapshot({ boardId: "board", sequence, elements, canEdit, files }); }
async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 1500;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 3));
  assert.equal(condition(), true, label);
}
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
type Request = { method: string; taskId: string | null; knownFileIds?: string[]; headers: Headers; body?: WhiteboardChange; rawBody?: string; signal?: AbortSignal | null };

function harness(options: { throttleMs?: number; taskId?: string | null } = {}) {
  let connection: WhiteboardConnection = { inviteCode: "room", taskId: options.taskId ?? null, sessionId: "session", ownerToken: "owner", authToken: "auth", eventToken: "proof", connected: true, readOnly: false };
  const taskId = options.taskId ?? null;
  let saved = snapshot();
  const requests: Request[] = [];
  const states: WhiteboardState[] = [];
  const scenes: Array<{ snapshot: WhiteboardSnapshot; force: boolean }> = [];
  const receipts = new Map<string, object>();
  let intercept: ((request: Request) => Promise<Response> | Response | undefined) | undefined;
  const accept = (request: Request) => {
    const body = request.body!;
    const previous = receipts.get(body.operationId);
    if (previous) return Response.json(previous);
    const elements = new Map(saved.elements.map(element => [element.id, element]));
    for (const item of body.elements) elements.set(item.id, item);
    saved = snapshot([...elements.values()], saved.sequence + 1, saved.canEdit, { ...saved.files, ...body.files });
    const receipt = { boardId: saved.boardId, taskId, sequence: saved.sequence, operationId: body.operationId };
    receipts.set(body.operationId, receipt);
    return Response.json(receipt);
  };
  const fetcher: typeof fetch = async (url, init) => {
    const requestedTask = new URL(String(url), "http://localhost").searchParams.get("taskId");
    const knownFileIds = new URL(String(url), "http://localhost").searchParams.get("knownFileIds")?.split(",").filter(Boolean) ?? [];
    const request: Request = { method: init?.method ?? "GET", taskId: requestedTask, knownFileIds, headers: new Headers(init?.headers), signal: init?.signal };
    if (typeof init?.body === "string") { request.rawBody = init.body; request.body = JSON.parse(init.body) as WhiteboardChange; }
    requests.push(request);
    const intercepted = intercept?.(request);
    if (intercepted) return intercepted;
    return request.method === "POST" ? accept(request) : Response.json({ ...saved, taskId, files: Object.fromEntries(Object.entries(saved.files).filter(([id]) => !knownFileIds.includes(id))) });
  };
  const session = createWhiteboardSession({ current: () => connection, onState: state => states.push(state), onScene: (snapshot, force) => scenes.push({ snapshot, force }), fetch: fetcher, throttleMs: options.throttleMs ?? 0 });
  return {
    session, requests, states, scenes, accept,
    get state() { return states.at(-1)!; },
    get posts() { return requests.filter(request => request.method === "POST"); },
    get saved() { return saved; }, set saved(value: WhiteboardSnapshot) { saved = value; },
    get connection() { return connection; }, set connection(value: WhiteboardConnection) { connection = value; },
    set intercept(value: typeof intercept) { intercept = value; },
    async load() { session.refresh(); await until(() => states.at(-1)?.loaded === true, "initial canonical snapshot loads"); },
    async settled() { await until(() => states.at(-1)?.pending === 0 && states.at(-1)?.message === "Сохранено", "pending changes become durably saved"); },
  };
}

test("the board loads, retries and saves without newer AbortSignal methods", async () => {
  const any = Object.getOwnPropertyDescriptor(AbortSignal, "any")!;
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!;
  // Make the methods absent, as in older embedded browsers.
  Object.defineProperty(AbortSignal, "any", { value: undefined, configurable: true });
  Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true });
  const h = harness();
  try {
    h.intercept = () => { throw new TypeError("private request details"); };
    h.session.refresh();
    await until(() => h.state.error, "a failed request is shown");
    assert.equal(h.requests.length, 1, "the browser actually sent a request");
    assert.match(h.state.message, /соединение/i);
    h.intercept = undefined;
    h.session.retry();
    await until(() => h.state.loaded && h.state.editable, "retry loads the board");
    h.session.observe([element("after-retry")]);
    await h.settled();
    assert.equal(h.saved.elements[0]?.id, "after-retry");
  } finally {
    h.session.destroy();
    Object.defineProperty(AbortSignal, "any", any);
    Object.defineProperty(AbortSignal, "timeout", timeout);
  }
});

test("HTTP, invalid JSON and invalid snapshots show distinct safe failures and allow retry", async () => {
  const h = harness();
  try {
    for (const [response, message] of [
      [new Response("private proxy body", { status: 503 }), /HTTP 503/],
      [new Response("private non-json body"), /прочитать ответ/i],
      [Response.json({ taskId: null, elements: ["private board text"] }), /некорректн.+снимок/i],
    ] as const) {
      h.intercept = () => response;
      h.session.retry();
      await until(() => h.state.error, "failure is reported");
      assert.match(h.state.message, message);
      assert.equal(h.state.loaded, false);
      assert.equal(h.state.message.includes("private"), false);
    }
    h.intercept = undefined;
    h.session.retry();
    await until(() => h.state.loaded, "retry recovers from the invalid response");
  } finally { h.session.destroy(); }
});

test("an outgoing task session drains only to its original task, including an explicit taskless board", async () => {
  for (const taskId of ["dcb8b846-ce76-4763-948d-6c1170cd3612", null]) {
    const h = harness({ taskId });
    try {
      await h.load();
      h.connection = { ...h.connection, connected: false };
      h.session.observe([element("unfinished")]);
      assert.equal(h.session.hasUnsavedChanges(), true);
      h.connection = { ...h.connection, taskId: "eb77b94e-2cc5-457e-9457-f8783548d7d4", connected: true };
      h.session.refresh();
      await h.settled();
      assert.equal(h.posts.length, 1);
      assert.equal(h.session.hasUnsavedChanges(), false);
      assert.deepEqual([...new Set(h.requests.map(request => request.taskId))], [taskId ?? ""]);
    } finally { h.session.destroy(); }
  }
});

const rasterFile = () => ({ id: "picture", mimeType: "image/png", dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1SAAAAAASUVORK5CYII=", created: 1 });
const rasterElement = (version = 1) => element("photo", version, { type: "image", fileId: "picture", status: "saved", scale: [1, 1] });

test("image data travels atomically with its element and is omitted from later moves", async () => {
  const h = harness();
  try {
    await h.load();
    h.session.observe([rasterElement()], { picture: rasterFile() });
    await h.settled();
    assert.equal(h.saved.files.picture?.dataURL, rasterFile().dataURL);
    assert.equal(h.posts[0]?.body?.files?.picture?.dataURL, rasterFile().dataURL);
    h.session.observe([rasterElement(2)], { picture: rasterFile() });
    await until(() => h.posts.length === 2 && h.state.message === "Сохранено", "move saves");
    assert.equal(Object.keys(h.posts[1]?.body?.files ?? {}).length, 0);
  } finally { h.session.destroy(); }
});

test("a disconnected image is retained in memory and retries its original bytes after reconnect", async () => {
  const h = harness();
  try {
    await h.load();
    h.connection = { ...h.connection, connected: false };
    h.session.observe([rasterElement()], { picture: rasterFile() });
    assert.equal(h.session.hasUnsavedChanges(), true);
    h.connection = { ...h.connection, connected: true, eventToken: "new-proof" };
    h.session.refresh();
    await h.settled();
    assert.equal(h.saved.files.picture?.dataURL, rasterFile().dataURL);
    assert.equal(h.saved.elements[0]?.id, "photo");
  } finally { h.session.destroy(); }
});

test("an image with missing file data blocks locally without posting a broken document", async () => {
  const h = harness();
  try {
    await h.load();
    h.session.observe([rasterElement()]);
    await pause();
    assert.equal(h.state.canDiscard, true);
    assert.equal(h.posts.length, 0);
  } finally { h.session.destroy(); }
});

test("lost image acknowledgements retry the identical operation and file bytes", async () => {
  const h = harness();
  try {
    await h.load();
    let lost = false;
    h.intercept = request => {
      if (request.method === "POST" && !lost) { lost = true; h.accept(request); throw new TypeError("connection lost"); }
      return undefined;
    };
    h.session.observe([rasterElement()], { picture: rasterFile() });
    await until(() => h.state.error, "lost response visible");
    h.session.retry();
    await h.settled();
    assert.equal(h.posts.length, 2);
    assert.equal(h.posts[0]?.rawBody, h.posts[1]?.rawBody);
    assert.equal(h.saved.sequence, 1);
    assert.equal(Object.keys(h.saved.files).length, 1);
  } finally { h.session.destroy(); }
});

test("large image additions split into bounded atomic requests without resending existing assets", async () => {
  const h = harness();
  try {
    await h.load();
    const dataURL = "data:image/png;base64," + Buffer.alloc(3_500_000).toString("base64");
    const files = { picture: { ...rasterFile(), dataURL }, second: { ...rasterFile(), id: "second", dataURL } };
    h.session.observe([rasterElement(), { ...rasterElement(), id: "photo-2", fileId: "second" }], files);
    await h.settled();
    assert.equal(h.posts.length, 2);
    for (const post of h.posts) {
      assert.ok(Buffer.byteLength(post.rawBody!) <= 8 * 1024 * 1024);
      assert.equal(post.body?.elements.length, 1);
      assert.equal(Object.keys(post.body?.files ?? {}).length, 1);
    }
    assert.equal(Object.keys(h.saved.files).length, 2);
  } finally { h.session.destroy(); }
});

test("refreshes reuse known raster bytes and fetch only newly shared assets", async () => {
  const h = harness();
  try {
    h.saved = snapshot([rasterElement()], 1, true, { picture: rasterFile() });
    await h.load();
    h.session.observe([rasterElement(2)], { picture: rasterFile() });
    await h.settled();
    assert.deepEqual(h.requests.filter(request => request.method === "GET").at(-1)?.knownFileIds, ["picture"]);
    assert.equal(h.session.getSnapshot()?.files.picture?.dataURL, rasterFile().dataURL);
    const second = { ...rasterFile(), id: "second" };
    h.saved = snapshot([rasterElement(2), { ...rasterElement(), id: "photo-2", fileId: "second" }], 3, true, { picture: rasterFile(), second });
    h.session.refresh();
    await until(() => h.session.getSnapshot()?.sequence === 3, "new peer image loaded");
    assert.deepEqual(Object.keys(h.session.getSnapshot()!.files).sort(), ["picture", "second"]);
    assert.equal(h.session.getSnapshot()?.files.second?.dataURL, second.dataURL);
  } finally { h.session.destroy(); }
});

test("an editor replaces the initial SDK scene with only the selected task's saved elements", async () => {
  const h = harness({ taskId: "task-b" });
  try {
    await h.load();
    assert.equal(h.scenes[0]?.force, true);
    assert.deepEqual(h.scenes[0]?.snapshot.elements, []);
  } finally { h.session.destroy(); }
});

test("a room-wide or wrong-task response cannot enter the board or enable writes", async () => {
  for (const scope of [{}, { taskId: "task-a" }, { taskId: null }]) {
    const h = harness({ taskId: "task-b" });
    try {
      h.intercept = request => request.method === "GET" ? Response.json({ ...snapshot([element("from-A")]), ...scope }) : undefined;
      h.session.refresh();
      await until(() => h.state.error || h.state.loaded, "first response settled");
      assert.equal(h.state.loaded, false);
      assert.match(h.state.message, /задач/);
      assert.equal(h.scenes.length, 0);
      h.session.observe([element("mine")]); await pause();
      assert.equal(h.posts.length, 0);
      h.intercept = undefined; h.session.retry();
      await until(() => h.state.loaded && h.state.editable, "verified board becomes editable");
    } finally { h.session.destroy(); }
  }
});

test("a room without tasks still requires an explicitly taskless board", async () => {
  const h = harness();
  try {
    h.intercept = request => request.method === "GET" ? Response.json(snapshot([element("legacy")])) : undefined;
    h.session.refresh();
    await until(() => h.state.error, "unscoped response refused");
    assert.equal(h.scenes.length, 0);
    h.intercept = undefined; await h.load();
    assert.equal(h.state.editable, true);
  } finally { h.session.destroy(); }
});

test("a receipt for another task pauses writes and preserves the unacknowledged edit", async () => {
  const h = harness({ taskId: "task-b" });
  try {
    await h.load();
    h.intercept = request => request.method === "POST" ? Response.json({
      boardId: request.body!.boardId, operationId: request.body!.operationId, sequence: 1, taskId: "task-a",
    }) : undefined;
    h.session.observe([element("mine")]);
    await until(() => h.state.error, "foreign receipt rejected");
    assert.equal(h.state.editable, false);
    assert.equal(h.state.pending, 1);
    h.intercept = undefined; h.session.retry(); await h.settled();
    assert.equal(h.posts.length, 2);
    assert.equal(h.posts[0]!.rawBody, h.posts[1]!.rawBody);
  } finally { h.session.destroy(); }
});

test("loads canonical state and does not echo native view changes or remote elements", async () => {
  const h = harness();
  try {
    h.saved = snapshot([element()]);
    await h.load();
    h.session.observe(h.saved.elements);
    h.session.observe(h.saved.elements.map(item => ({ ...item })));
    await pause();
    assert.equal(h.posts.length, 0);
    assert.equal(h.state.editable, true);
    assert.equal(h.scenes.at(-1)?.snapshot.sequence, 0);
  } finally { h.session.destroy(); }
});

test("coalesces offline native versions and sends changed elements only with fresh authority", async () => {
  const h = harness();
  try {
    h.saved = snapshot([element("unchanged")]);
    await h.load();
    h.connection = { ...h.connection, connected: false, eventToken: null };
    h.session.observe([element("unchanged"), element("a")]);
    h.session.observe([element("unchanged"), element("a", 2), element("b")]);
    await pause();
    assert.equal(h.posts.length, 0);
    assert.equal(h.state.pending, 2);
    h.connection = { ...h.connection, connected: true, eventToken: null };
    h.session.refresh(); await pause();
    assert.equal(h.posts.length, 0, "transport alone cannot write");
    h.connection = { ...h.connection, eventToken: "fresh-proof" };
    h.session.refresh(); await h.settled();
    assert.deepEqual(h.posts[0]?.body?.elements.map(item => [item.id, item.version]), [["a", 2], ["b", 1]]);
    assert.equal(h.posts[0]?.headers.get("X-Room-Event-Token"), "fresh-proof");
    assert.equal(h.posts[0]?.headers.get("Authorization"), "Bearer auth");
    assert.equal(h.posts[0]?.headers.get("X-Room-Owner-Token"), "owner");
    assert.doesNotMatch(h.posts[0]?.rawBody ?? "", /appState|proof|owner|auth/);
  } finally { h.session.destroy(); }
});

test("lost POST response retries the identical immutable operation after a canonical refresh", async () => {
  const h = harness();
  try {
    await h.load();
    let lost = false;
    h.intercept = request => {
      if (request.method === "POST" && !lost) { lost = true; h.accept(request); throw new Error("response lost"); }
    };
    const points = [[0, 0], [20, 30]];
    h.session.observe([element("a", 1, { points })]);
    points[1]![0] = 999;
    await until(() => h.state.error, "lost response leaves the pending operation available for retry");
    h.connection = { ...h.connection, eventToken: "new-proof" };
    h.session.refresh(); await h.settled();
    assert.equal(h.posts.length, 2);
    assert.equal(h.posts[0]?.rawBody, h.posts[1]?.rawBody);
    assert.deepEqual(h.posts[0]?.body?.elements[0]?.points, [[0, 0], [20, 30]]);
    assert.equal(h.saved.sequence, 1, "receipt replay does not create another accepted operation");
  } finally { h.session.destroy(); }
});

test("an ACK removes only the attempted version and retains a newer local stroke", async () => {
  const h = harness();
  try {
    await h.load();
    let release: (() => void) | undefined;
    h.intercept = request => {
      if (request.method === "POST" && !release) {
        const accepted = h.accept(request);
        return new Promise(resolve => { release = () => resolve(accepted); });
      }
    };
    h.session.observe([element("a")]);
    await until(() => release !== undefined, "first native version is in flight");
    h.session.observe([element("a", 2)]);
    release!();
    await h.settled();
    assert.deepEqual(h.posts.map(request => request.body?.elements[0]?.version), [1, 2]);
    assert.equal(h.saved.elements[0]?.version, 2);
  } finally { h.session.destroy(); }
});

test("canonical newer elements and deletion tombstones prune obsolete pending changes", async () => {
  const h = harness();
  try {
    await h.load();
    h.connection = { ...h.connection, connected: false };
    h.session.observe([element("a", 2)]);
    h.saved = snapshot([element("a", 3, { isDeleted: true })], 2);
    h.connection = { ...h.connection, connected: true };
    h.session.refresh(); await h.settled();
    assert.equal(h.posts.length, 0);
    assert.equal(h.session.getSnapshot()?.elements[0]?.isDeleted, true);
  } finally { h.session.destroy(); }
});

test("stale GET snapshots cannot replace canonical state or erase newer pending changes", async () => {
  const h = harness();
  try {
    h.saved = snapshot([element("a")], 10);
    await h.load();
    h.connection = { ...h.connection, connected: false };
    h.session.observe([element("a", 2)]);
    h.saved = snapshot([element("a", 5)], 9);
    h.connection = { ...h.connection, connected: true };
    h.session.refresh();
    await until(() => h.state.error, "old read produces a recoverable error");
    assert.equal(h.session.getSnapshot()?.sequence, 10);
    assert.equal(h.state.pending, 1);
    assert.equal(h.posts.length, 0);
  } finally { h.session.destroy(); }
});

test("late HTTP denial or validation errors preserve pending changes and retry using the new proof", async () => {
  for (const status of [403, 404, 410, 422]) {
    const h = harness();
    try {
      await h.load();
      let release: (() => void) | undefined;
      h.intercept = request => {
        if (request.method === "POST" && !release) return new Promise(resolve => { release = () => resolve(new Response(null, { status })); });
      };
      h.session.observe([element()]);
      await until(() => release !== undefined, `old proof request is pending before HTTP ${status}`);
      h.connection = { ...h.connection, eventToken: "renewed-proof" };
      release!();
      await h.settled();
      assert.equal(h.posts.length, 2);
      assert.equal(h.posts[0]?.rawBody, h.posts[1]?.rawBody);
      assert.equal(h.posts[1]?.headers.get("X-Room-Event-Token"), "renewed-proof");
      assert.equal(h.state.accessDenied, false);
    } finally { h.session.destroy(); }
  }
});

test("a fresh write denial clears local changes and replaces the scene with canonical readonly state", async () => {
  const h = harness();
  try {
    h.saved = snapshot([element("saved")]);
    await h.load();
    h.intercept = request => { if (request.method === "POST") { h.saved = snapshot(h.saved.elements, 0, false); return new Response(null, { status: 403 }); } };
    h.session.observe([element("saved"), element("unsaved")]);
    await until(() => !h.state.editable && h.state.pending === 0, "fresh denial revokes edits");
    assert.deepEqual(h.scenes.at(-1)?.snapshot.elements.map(item => item.id), ["saved"]);
    assert.equal(h.scenes.at(-1)?.force, true);
  } finally { h.session.destroy(); }
});

test("readonly transition clears pending history and read revocation clears the protected snapshot", async () => {
  const h = harness();
  try {
    h.saved = snapshot([element("saved")]);
    await h.load();
    h.connection = { ...h.connection, connected: false };
    h.session.observe([element("draft")]);
    h.connection = { ...h.connection, readOnly: true };
    h.session.permissionsChanged();
    assert.equal(h.state.pending, 0);
    assert.equal(h.scenes.at(-1)?.force, true);
    h.connection = { ...h.connection, connected: true };
    h.intercept = request => request.method === "GET" ? new Response(null, { status: 403 }) : undefined;
    h.session.refresh();
    await until(() => h.state.accessDenied, "fresh read denial clears protected context");
    assert.equal(h.session.getSnapshot(), undefined);
    assert.deepEqual(h.scenes.at(-1)?.snapshot.elements, []);
  } finally { h.session.destroy(); }
});

test("permanent validation refusal retains the draft until explicit reset", async () => {
  const h = harness();
  try {
    await h.load();
    h.intercept = request => request.method === "POST" ? new Response(null, { status: 400 }) : undefined;
    h.session.observe([element("draft")]);
    await until(() => h.state.canDiscard, "invalid draft becomes recoverable by explicit discard");
    assert.equal(h.state.pending, 1);
    h.session.retry(); await pause();
    assert.equal(h.posts.length, 1, "retry does not resubmit a known rejected draft");
    h.intercept = undefined;
    h.session.reset(); await h.settled();
    assert.deepEqual(h.scenes.at(-1)?.snapshot.elements, []);
    assert.equal(h.scenes.at(-1)?.force, true);
    h.session.observe([element("after-reset")]); await h.settled();
    assert.equal(h.saved.elements[0]?.id, "after-reset");
  } finally { h.session.destroy(); }
});

test("future-base conflict refreshes once and retries without a busy loop", async () => {
  const h = harness();
  try {
    await h.load();
    let conflicted = false;
    h.intercept = request => { if (request.method === "POST" && !conflicted) { conflicted = true; h.saved = snapshot([], 1); return new Response(null, { status: 409 }); } };
    h.session.observe([element()]); await h.settled();
    assert.equal(h.posts.length, 2);
    assert.equal(h.state.error, false);
  } finally { h.session.destroy(); }
});

test("batches fit the UTF-8 request budget and a single oversized element retains its draft", async () => {
  const h = harness();
  try {
    await h.load();
    h.session.observe(Array.from({ length: 700 }, (_, index) => element(String(index), 1, { text: "я".repeat(400) })));
    await h.settled();
    assert.ok(h.posts.length >= 2);
    for (const request of h.posts) assert.ok(new TextEncoder().encode(request.rawBody).byteLength <= 480 * 1024);
    assert.equal(h.saved.elements.length, 700);
    const before = h.posts.length;
    h.session.observe([element("too-large", 1, { text: "x".repeat(500 * 1024) })]);
    await until(() => h.state.canDiscard, "oversized element is retained rather than silently truncated");
    assert.equal(h.state.pending, 1);
    assert.equal(h.posts.length, before);
  } finally { h.session.destroy(); }
});

test("destroy aborts outstanding requests and ignores all late callbacks", async () => {
  const h = harness();
  let release: (() => void) | undefined;
  h.intercept = request => request.method === "GET" ? new Promise(resolve => { release = () => resolve(Response.json({ ...snapshot(), taskId: null })); }) : undefined;
  h.session.refresh();
  await until(() => release !== undefined, "GET begins");
  h.session.destroy();
  const states = h.states.length;
  release!(); await pause();
  assert.equal(h.requests[0]?.signal?.aborted, true);
  assert.equal(h.states.length, states);
  assert.equal(h.scenes.length, 0);
});

test("failed attempts obey the same throttle budget when explicitly retried", async () => {
  const h = harness({ throttleMs: 200 });
  try {
    await h.load();
    const times: number[] = [];
    h.intercept = request => {
      if (request.method !== "POST") return;
      times.push(Date.now());
      if (times.length === 1) return new Response(null, { status: 503 });
    };
    h.session.observe([element()]);
    await until(() => h.state.error, "temporary write failure is visible");
    h.session.retry(); await h.settled();
    assert.equal(times.length, 2);
    assert.ok(times[1]! - times[0]! >= 180, "retrying a failed write still respects the 200ms relay budget");
  } finally { h.session.destroy(); }
});

test("a response body completed after a permission epoch change cannot publish its stale scene", async () => {
  const h = harness();
  try {
    await h.load();
    let release: (() => void) | undefined;
    h.intercept = request => {
      if (request.method !== "GET" || release) return;
      const response = Response.json({ ...snapshot(), taskId: null });
      response.json = () => new Promise(resolve => { release = () => resolve({ ...snapshot(), taskId: null }); });
      return response;
    };
    h.session.refresh();
    await until(() => release !== undefined, "the read body is pending");
    const before = h.scenes.length;
    h.connection = { ...h.connection, readOnly: true };
    h.saved = snapshot([element("current")], 1, false);
    h.session.permissionsChanged();
    release!();
    await until(() => h.session.getSnapshot()?.sequence === 1, "fresh readonly snapshot arrives");
    assert.equal(h.scenes.slice(before).some(scene => scene.snapshot.canEdit), false, "old body never restores a formerly editable scene");
  } finally { h.session.destroy(); }
});

test("repeated conflicts stop after one refresh and retain the pending draft", async () => {
  const h = harness();
  try {
    await h.load();
    h.intercept = request => request.method === "POST" ? new Response(null, { status: 409 }) : undefined;
    h.session.observe([element()]);
    await until(() => h.state.error, "unresolved conflict asks for explicit retry");
    await pause();
    assert.equal(h.posts.length, 2);
    assert.equal(h.state.pending, 1);
  } finally { h.session.destroy(); }
});

test("a late readonly GET from the old capability cannot discard the renewed session draft", async () => {
  const h = harness();
  try {
    await h.load();
    h.connection = { ...h.connection, connected: false };
    h.session.observe([element("draft")]);
    let release: (() => void) | undefined;
    h.intercept = request => {
      if (request.method === "GET" && !release) return new Promise(resolve => { release = () => resolve(Response.json({ ...snapshot([], 0, false), taskId: null })); });
    };
    h.connection = { ...h.connection, connected: true };
    h.session.refresh();
    await until(() => release !== undefined, "old capability read is pending");
    h.connection = { ...h.connection, eventToken: "renewed-proof" };
    h.session.refresh();
    release!();
    await h.settled();
    assert.deepEqual(h.saved.elements.map(item => item.id), ["draft"]);
    assert.equal(h.posts.length, 1);
  } finally { h.session.destroy(); }
});

test("server-stale capability before browser reconnect preserves the attempt and stops same-proof retries", async () => {
  const h = harness();
  try {
    await h.load();
    let stale = true;
    h.intercept = () => stale ? Response.json({ code: "ROOM_EVENT_CAPABILITY_STALE" }, { status: 403 }) : undefined;
    h.session.observe([element("draft")]);
    await until(() => h.posts.length === 1, "server rejects the capability before the browser sees a disconnect");
    await pause();
    assert.equal(h.state.pending, 1);
    assert.equal(h.state.accessDenied, false);
    const before = h.requests.length;
    h.session.retry(); h.session.refresh();
    await pause();
    assert.equal(h.requests.length, before, "the known stale proof is never polled or retried");
    stale = false;
    h.connection = { ...h.connection, eventToken: "confirmed-new-proof" };
    h.session.refresh(); await h.settled();
    assert.deepEqual(h.saved.elements.map(item => item.id), ["draft"]);
    assert.equal(h.posts[0]?.rawBody, h.posts[1]?.rawBody);
  } finally { h.session.destroy(); }
});

test("reset ignores a delayed native change while its canonical GET is pending", async () => {
  const h = harness();
  try {
    await h.load();
    h.intercept = request => request.method === "POST" ? new Response(null, { status: 400 }) : undefined;
    const rejected = element("discarded-draft");
    h.session.observe([rejected]);
    await until(() => h.state.canDiscard, "draft was rejected");
    let release: (() => void) | undefined;
    h.intercept = request => request.method === "GET" && !release
      ? new Promise(resolve => { release = () => resolve(Response.json({ ...snapshot(), taskId: null })); }) : undefined;
    h.session.reset();
    await until(() => release !== undefined, "reset snapshot read is pending");
    h.session.observe([rejected]);
    release!();
    await h.settled(); await pause();
    assert.equal(h.posts.length, 1, "discarded scene cannot be re-enqueued by a delayed native callback");
    assert.deepEqual(h.saved.elements, []);
    assert.equal(h.state.pending, 0);
  } finally { h.session.destroy(); }
});

test("unchanged native callbacks and refresh statuses do not republish identical UI state", async () => {
  const h = harness();
  try {
    h.saved = snapshot([element("existing")]);
    await h.load();
    const before = h.states.length;
    for (let index = 0; index < 30; index++) h.session.observe(h.saved.elements);
    for (let index = 0; index < 5; index++) h.session.refresh();
    await pause();
    assert.equal(h.states.length, before, "camera/render echoes cannot cause a parent React render loop");
    const scenes = h.scenes.length;
    h.saved = snapshot([element("existing", 2)], 1);
    h.session.refresh();
    await until(() => h.scenes.length > scenes, "new remote contents still reach the native scene");
    assert.equal(h.scenes.at(-1)?.snapshot.elements[0]?.version, 2);
    assert.equal(h.states.length, before, "scene-only changes do not republish an unchanged status");
  } finally { h.session.destroy(); }
});

test("coalescing a newer pending version preserves its data without redundant same-count UI publications", async () => {
  const h = harness();
  try {
    await h.load();
    h.connection = { ...h.connection, connected: false };
    h.session.observe([element("draft")]);
    const before = h.states.length;
    h.session.observe([element("draft", 2)]);
    h.session.observe([element("draft", 3)]);
    assert.equal(h.states.length, before);
    assert.equal(h.state.pending, 1);
    h.connection = { ...h.connection, connected: true };
    h.session.refresh(); await h.settled();
    assert.equal(h.posts[0]?.body?.elements[0]?.version, 3);
  } finally { h.session.destroy(); }
});
