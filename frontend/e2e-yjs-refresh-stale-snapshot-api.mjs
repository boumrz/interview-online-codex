import { randomUUID } from "node:crypto";
import * as Y from "yjs";

const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function createDeterministicBootstrapUpdate(code) {
  const bootstrapDoc = new Y.Doc();
  bootstrapDoc.clientID = 1;
  const bootstrapText = bootstrapDoc.getText("room-code");
  if (code) {
    bootstrapText.insert(0, code);
  }
  return Y.encodeStateAsUpdate(bootstrapDoc);
}

function createDocFromState(stateSyncPayload) {
  const doc = new Y.Doc();
  const snapshot = stateSyncPayload?.yjsDocumentBase64?.trim() ?? "";
  if (snapshot) {
    const raw = base64ToBytes(snapshot);
    if (raw.length > 0) {
      Y.applyUpdate(doc, raw, "bootstrap");
    }
    return doc;
  }

  const lastYjsSequence = Number.isFinite(stateSyncPayload?.lastYjsSequence)
    ? Math.max(0, Math.floor(stateSyncPayload.lastYjsSequence))
    : 0;
  if (lastYjsSequence <= 0) {
    Y.applyUpdate(
      doc,
      createDeterministicBootstrapUpdate(stateSyncPayload?.code ?? ""),
      "bootstrap",
    );
  }
  return doc;
}

function countOccurrences(text, marker) {
  if (!marker) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const index = text.indexOf(marker, from);
    if (index < 0) return count;
    count += 1;
    from = index + marker.length;
  }
}

async function postRealtimeEvent(inviteCode, payload) {
  const response = await fetch(`${apiBaseUrl}/realtime/rooms/${inviteCode}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`REALTIME_EVENT_FAILED status=${response.status} body=${body}`);
}

class SseRoomClient {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.controller = new AbortController();
    this.reader = null;
    this.buffer = "";
    this.stateSyncEvents = [];
    this.waiters = [];
  }

  async connect() {
    const response = await fetch(this.url, {
      headers: { Accept: "text/event-stream" },
      signal: this.controller.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`SSE_CONNECT_FAILED ${this.label} status=${response.status} body=${text}`);
    }
    this.reader = response.body.getReader();
    void this.#pump();
  }

  async #pump() {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let splitIndex = this.buffer.indexOf("\n\n");
        while (splitIndex >= 0) {
          const rawEvent = this.buffer.slice(0, splitIndex);
          this.buffer = this.buffer.slice(splitIndex + 2);
          this.#handleEvent(rawEvent);
          splitIndex = this.buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (this.controller.signal.aborted || error?.name === "AbortError") {
        return;
      }
      const pending = this.waiters.splice(0, this.waiters.length);
      pending.forEach((waiter) => {
        clearTimeout(waiter.timeoutId);
        waiter.reject(error);
      });
    }
  }

  #handleEvent(rawEvent) {
    const lines = rawEvent.split("\n");
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) return;

    const rawData = dataLines.join("\n");
    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      return;
    }

    if (message?.type !== "state_sync" || !message.payload) {
      return;
    }

    const index = this.stateSyncEvents.length;
    this.stateSyncEvents.push(message.payload);

    const unresolved = [];
    for (const waiter of this.waiters) {
      if (index < waiter.startIndex) {
        unresolved.push(waiter);
        continue;
      }
      if (!waiter.predicate(message.payload)) {
        unresolved.push(waiter);
        continue;
      }
      clearTimeout(waiter.timeoutId);
      waiter.resolve(message.payload);
    }
    this.waiters = unresolved;
  }

  waitForStateSync(predicate, timeoutMs = 15_000, startIndex = 0) {
    for (let i = startIndex; i < this.stateSyncEvents.length; i += 1) {
      const candidate = this.stateSyncEvents[i];
      if (predicate(candidate)) {
        return Promise.resolve(candidate);
      }
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`SSE_TIMEOUT ${this.label}`));
      }, timeoutMs);

      const waiter = {
        predicate,
        resolve,
        reject,
        startIndex,
        timeoutId,
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    if (this.reader) {
      try {
        const cancelPromise = this.reader.cancel();
        if (cancelPromise && typeof cancelPromise.catch === "function") {
          cancelPromise.catch(() => {});
        }
      } catch {
        // noop
      }
    }
    try {
      this.controller.abort();
    } catch {
      // noop
    }
  }
}

function normalizedSequence(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function syncKeyFromState(state) {
  return `${state.inviteCode}:${state.currentStep}:${state.language}`;
}

async function createGuestRoom() {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Yjs stale snapshot guard ${Date.now()}`,
      ownerDisplayName: "Owner API",
      language: "nodejs",
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

const room = await createGuestRoom();
const inviteCode = room.inviteCode;
const ownerToken = room.ownerToken ?? "";
const sessionA = `s-api-a-${Date.now()}`;
const sessionB = `s-api-b-${Date.now()}`;

const streamA = new SseRoomClient(
  `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionA)}&displayNameEncoded=${encodeURIComponent("Owner API")}&ownerToken=${encodeURIComponent(ownerToken)}`,
  "owner",
);
const streamB = new SseRoomClient(
  `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionB)}&displayNameEncoded=${encodeURIComponent("Candidate API")}`,
  "candidate",
);

try {
  await streamA.connect();
  const stateA0 = await streamA.waitForStateSync(() => true);

  await streamB.connect();
  const stateB0 = await streamB.waitForStateSync(() => true);

  const initialSequence = normalizedSequence(stateA0.lastYjsSequence);
  const syncKey = syncKeyFromState(stateA0);

  const liveDoc = createDocFromState(stateA0);
  const liveText = liveDoc.getText("room-code");
  const marker = `__yjs_refresh_guard_${Date.now()}__`;
  const updates = [];
  liveDoc.on("update", (update, origin) => {
    if (origin === "bootstrap") return;
    updates.push(update);
  });
  liveText.insert(liveText.length, marker);

  const liveIncremental = updates.at(-1);
  if (!liveIncremental) {
    throw new Error("LIVE_INCREMENTAL_UPDATE_MISSING");
  }

  const liveOperationId = randomUUID();
  const liveCode = liveText.toString();
  const liveSnapshot = bytesToBase64(Y.encodeStateAsUpdate(liveDoc));

  const indexBeforeLive = streamA.stateSyncEvents.length;
  await postRealtimeEvent(inviteCode, {
    sessionId: sessionA,
    eventToken: stateA0.eventToken,
    type: "yjs_update",
    syncKey,
    yjsUpdate: bytesToBase64(liveIncremental),
    yjsDocumentBase64: liveSnapshot,
    code: liveCode,
    yjsClientSequence: 1,
    baseServerYjsSequence: initialSequence,
    operationId: liveOperationId,
  });

  const stateAfterLive = await streamA.waitForStateSync(
    (payload) => {
      const seq = normalizedSequence(payload.lastYjsSequence);
      return seq > initialSequence && String(payload.code ?? "").includes(marker);
    },
    15_000,
    indexBeforeLive,
  );
  const liveSequence = normalizedSequence(stateAfterLive.lastYjsSequence);

  const staleDoc = createDocFromState(stateA0);
  const staleSnapshot = bytesToBase64(Y.encodeStateAsUpdate(staleDoc));
  const staleCode = staleDoc.getText("room-code").toString();

  await postRealtimeEvent(inviteCode, {
    sessionId: sessionB,
    eventToken: stateB0.eventToken,
    type: "yjs_update",
    syncKey,
    yjsUpdate: "",
    yjsDocumentBase64: staleSnapshot,
    code: staleCode,
    yjsClientSequence: 1,
    baseServerYjsSequence: initialSequence,
    operationId: randomUUID(),
  });

  await postRealtimeEvent(inviteCode, {
    sessionId: sessionA,
    eventToken: stateA0.eventToken,
    type: "yjs_update",
    syncKey,
    yjsUpdate: bytesToBase64(liveIncremental),
    yjsDocumentBase64: liveSnapshot,
    code: liveCode,
    yjsClientSequence: 2,
    baseServerYjsSequence: initialSequence,
    operationId: liveOperationId,
  });

  const indexBeforeFinalSync = streamA.stateSyncEvents.length;
  await postRealtimeEvent(inviteCode, {
    sessionId: sessionA,
    type: "request_state_sync",
  });

  const finalState = await streamA.waitForStateSync(() => true, 15_000, indexBeforeFinalSync);
  const finalSequence = normalizedSequence(finalState.lastYjsSequence);
  const finalCode = String(finalState.code ?? "");

  if (finalSequence !== liveSequence) {
    throw new Error(`YJS_REFRESH_GUARD_FAILED_SEQUENCE expected=${liveSequence} actual=${finalSequence}`);
  }

  if (finalCode !== liveCode) {
    throw new Error(`YJS_REFRESH_GUARD_FAILED_CODE\nEXPECTED:\n${liveCode}\nACTUAL:\n${finalCode}`);
  }

  if (countOccurrences(finalCode, marker) !== 1) {
    throw new Error(`YJS_REFRESH_GUARD_DUPLICATE marker=${marker} count=${countOccurrences(finalCode, marker)} code=${finalCode}`);
  }

  const snapshot = finalState.yjsDocumentBase64?.trim() ?? "";
  if (snapshot) {
    const doc = new Y.Doc();
    const raw = base64ToBytes(snapshot);
    if (raw.length > 0) {
      Y.applyUpdate(doc, raw, "verify");
      const snapshotText = doc.getText("room-code").toString();
      if (snapshotText !== liveCode) {
        throw new Error(`YJS_REFRESH_GUARD_FAILED_SNAPSHOT\nEXPECTED:\n${liveCode}\nACTUAL:\n${snapshotText}`);
      }
      if (countOccurrences(snapshotText, marker) !== 1) {
        throw new Error(`YJS_REFRESH_GUARD_DUPLICATE_IN_SNAPSHOT marker=${marker} count=${countOccurrences(snapshotText, marker)} text=${snapshotText}`);
      }
    }
  }

  console.log("YJS_REFRESH_GUARD_OK", inviteCode);
} catch (error) {
  console.error("YJS_REFRESH_GUARD_FAIL", error);
  process.exitCode = 1;
} finally {
  streamA.close();
  streamB.close();
}
