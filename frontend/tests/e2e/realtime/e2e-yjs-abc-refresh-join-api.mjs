import { randomUUID } from "node:crypto";
import * as Y from "yjs";

const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

const OLD_SNAPSHOT_CODE = "abc";
const LIVE_CODE = "abc123";
const DUPLICATED_CODE = "abc123abc";

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

function replaceDocText(yText, value) {
  const current = yText.toString();
  if (current.length > 0) {
    yText.delete(0, current.length);
  }
  if (value.length > 0) {
    yText.insert(0, value);
  }
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
      title: `Yjs abc refresh join ${Date.now()}`,
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
const sessionC = `s-api-c-${Date.now()}`;

const streamA = new SseRoomClient(
  `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionA)}&displayNameEncoded=${encodeURIComponent("Owner API")}&ownerToken=${encodeURIComponent(ownerToken)}`,
  "owner",
);
const streamB = new SseRoomClient(
  `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionB)}&displayNameEncoded=${encodeURIComponent("Candidate Refresh")}`,
  "candidate-refresh",
);
const streamC = new SseRoomClient(
  `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionC)}&displayNameEncoded=${encodeURIComponent("Candidate Join")}`,
  "candidate-join",
);

try {
  await streamA.connect();
  const stateA0 = await streamA.waitForStateSync(() => true);

  await streamB.connect();
  const stateB0 = await streamB.waitForStateSync(() => true);

  const initialSequence = normalizedSequence(stateA0.lastYjsSequence);
  const syncKey = syncKeyFromState(stateA0);

  // Build live canonical document: abc123
  const liveDoc = createDocFromState(stateA0);
  const liveText = liveDoc.getText("room-code");
  const updates = [];
  liveDoc.on("update", (update, origin) => {
    if (origin === "bootstrap") return;
    updates.push(update);
  });
  replaceDocText(liveText, LIVE_CODE);
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
      return seq > initialSequence && String(payload.code ?? "") === LIVE_CODE;
    },
    15_000,
    indexBeforeLive,
  );
  const liveSequence = normalizedSequence(stateAfterLive.lastYjsSequence);

  // Stale bootstrap snapshot: abc (as if refreshed client restored outdated state)
  const staleDoc = createDocFromState(stateA0);
  const staleText = staleDoc.getText("room-code");
  replaceDocText(staleText, OLD_SNAPSHOT_CODE);
  const staleSnapshot = bytesToBase64(Y.encodeStateAsUpdate(staleDoc));

  await postRealtimeEvent(inviteCode, {
    sessionId: sessionB,
    eventToken: stateB0.eventToken,
    type: "yjs_update",
    syncKey,
    yjsUpdate: "",
    yjsDocumentBase64: staleSnapshot,
    code: staleText.toString(),
    yjsClientSequence: 1,
    baseServerYjsSequence: initialSequence,
    operationId: randomUUID(),
  });

  // New participant joins after stale bootstrap attempt.
  await streamC.connect();
  const joinState = await streamC.waitForStateSync(() => true);
  const joinCode = String(joinState.code ?? "");
  if (joinCode === DUPLICATED_CODE) {
    throw new Error(`YJS_ABC_REFRESH_JOIN_DUPLICATE_ON_JOIN code=${joinCode}`);
  }

  const indexBeforeOwnerResync = streamA.stateSyncEvents.length;
  await postRealtimeEvent(inviteCode, {
    sessionId: sessionA,
    type: "request_state_sync",
  });
  const finalStateOwner = await streamA.waitForStateSync(
    () => true,
    15_000,
    indexBeforeOwnerResync,
  );

  const indexBeforeJoinerResync = streamC.stateSyncEvents.length;
  await postRealtimeEvent(inviteCode, {
    sessionId: sessionC,
    type: "request_state_sync",
  });
  const finalStateJoiner = await streamC.waitForStateSync(
    () => true,
    15_000,
    indexBeforeJoinerResync,
  );

  const finalOwnerSeq = normalizedSequence(finalStateOwner.lastYjsSequence);
  const finalOwnerCode = String(finalStateOwner.code ?? "");
  const finalJoinerCode = String(finalStateJoiner.code ?? "");

  if (finalOwnerSeq !== liveSequence) {
    throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_SEQUENCE expected=${liveSequence} actual=${finalOwnerSeq}`);
  }
  if (finalOwnerCode !== LIVE_CODE) {
    throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_OWNER_CODE expected=${LIVE_CODE} actual=${finalOwnerCode}`);
  }
  if (finalJoinerCode !== LIVE_CODE) {
    throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_JOINER_CODE expected=${LIVE_CODE} actual=${finalJoinerCode}`);
  }
  if (finalOwnerCode === DUPLICATED_CODE || finalJoinerCode === DUPLICATED_CODE) {
    throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_DUPLICATE owner=${finalOwnerCode} joiner=${finalJoinerCode}`);
  }
  if (countOccurrences(finalOwnerCode, OLD_SNAPSHOT_CODE) !== 1) {
    throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_OLD_COUNT ownerCount=${countOccurrences(finalOwnerCode, OLD_SNAPSHOT_CODE)} code=${finalOwnerCode}`);
  }

  const finalSnapshot = finalStateOwner.yjsDocumentBase64?.trim() ?? "";
  if (finalSnapshot) {
    const verifyDoc = new Y.Doc();
    const raw = base64ToBytes(finalSnapshot);
    if (raw.length > 0) {
      Y.applyUpdate(verifyDoc, raw, "verify");
      const snapshotCode = verifyDoc.getText("room-code").toString();
      if (snapshotCode !== LIVE_CODE) {
        throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_SNAPSHOT expected=${LIVE_CODE} actual=${snapshotCode}`);
      }
      if (snapshotCode === DUPLICATED_CODE) {
        throw new Error(`YJS_ABC_REFRESH_JOIN_FAILED_SNAPSHOT_DUPLICATE snapshot=${snapshotCode}`);
      }
    }
  }

  console.log("YJS_ABC_REFRESH_JOIN_OK", inviteCode);
} catch (error) {
  console.error("YJS_ABC_REFRESH_JOIN_FAIL", error);
  process.exitCode = 1;
} finally {
  streamA.close();
  streamB.close();
  streamC.close();
}
