import assert from "node:assert/strict";
import { test } from "node:test";

async function loadTransport() {
  try {
    return await import("../../src/features/room/roomRealtimeTransport.ts");
  } catch (error) {
    assert.fail(`room realtime credential transport seam is missing: ${String(error)}`);
  }
}

test("room request deadlines distinguish a timeout from leaving the room", async () => {
  const { withRoomRequestDeadline } = await loadTransport();
  const waitForAbort = (signal: AbortSignal, timedOut: () => boolean) => new Promise<boolean>(resolve => {
    if (signal.aborted) resolve(timedOut());
    else signal.addEventListener("abort", () => resolve(timedOut()), { once: true });
  });
  assert.equal(await withRoomRequestDeadline(5, waitForAbort), true);

  const lifetime = new AbortController();
  const activeRequest = withRoomRequestDeadline(1000, waitForAbort, lifetime.signal);
  lifetime.abort();
  assert.equal(await activeRequest, false);
  assert.equal(await withRoomRequestDeadline(1000, waitForAbort, lifetime.signal), false);
});

test("createRoomEventSource forces credential delivery even when the caller tries to downgrade it", async () => {
  const { createRoomEventSource } = await loadTransport();
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  const calls: Array<{ url: string | URL; init?: EventSourceInit }> = [];

  class CapturingEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      calls.push({ url, init });
    }
  }

  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: CapturingEventSource,
  });

  try {
    const callerInit: EventSourceInit = {
      withCredentials: false,
    };
    const created = createRoomEventSource("/api/realtime/rooms/room-a/stream", callerInit);
    createRoomEventSource("/api/realtime/rooms/room-b/stream");

    assert.ok(created instanceof CapturingEventSource);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "/api/realtime/rooms/room-a/stream");
    assert.deepEqual(calls[0].init, { withCredentials: true });
    assert.equal(callerInit.withCredentials, false, "the helper must not mutate caller-owned init");
    assert.equal(calls[1].url, "/api/realtime/rooms/room-b/stream");
    assert.deepEqual(calls[1].init, { withCredentials: true }, "credentials are also required when init is omitted");
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "EventSource", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "EventSource");
    }
  }
});

test("roomRealtimeFetch preserves request init while forcing credentials include", async () => {
  const { roomRealtimeFetch } = await loadTransport();
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const response = { ok: true, status: 204 } as Response;
  const signal = new AbortController().signal;
  const headers = new Headers({ "Content-Type": "application/json", "X-Trace": "transport-test" });
  const body = JSON.stringify({ type: "presence_update" });
  const callerInit: RequestInit = {
    method: "POST",
    body,
    headers,
    signal,
    cache: "no-store",
    credentials: "omit",
  };

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return response;
    },
  });

  try {
    const result = await roomRealtimeFetch("/api/realtime/rooms/room-a/events", callerInit);
    await roomRealtimeFetch("/api/realtime/rooms/room-b/events");

    assert.strictEqual(result, response);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].input, "/api/realtime/rooms/room-a/events");
    assert.equal(calls[0].init?.method, "POST");
    assert.strictEqual(calls[0].init?.body, body);
    assert.strictEqual(calls[0].init?.headers, headers);
    assert.strictEqual(calls[0].init?.signal, signal);
    assert.equal(calls[0].init?.cache, "no-store");
    assert.equal(calls[0].init?.credentials, "include");
    assert.equal(callerInit.credentials, "omit", "the helper must not mutate caller-owned init");
    assert.equal(calls[1].input, "/api/realtime/rooms/room-b/events");
    assert.deepEqual(calls[1].init, { credentials: "include" }, "credentials are also required when init is omitted");
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "fetch", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }
  }
});
