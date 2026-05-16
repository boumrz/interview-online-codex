import { randomUUID } from "node:crypto";

const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";

function normalizeLanguage(language) {
  const normalized = String(language ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "javascript" || normalized === "typescript" || normalized === "nodejs") return "nodejs";
  if (normalized === "python") return "python";
  if (normalized === "kotlin") return "kotlin";
  if (normalized === "java") return "java";
  if (normalized === "sql") return "sql";
  return "nodejs";
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertLanguage(actual, expected, context) {
  const normalizedActual = normalizeLanguage(actual);
  const normalizedExpected = normalizeLanguage(expected);
  if (normalizedActual !== normalizedExpected) {
    throw new Error(
      `LANGUAGE_ASSERT_FAILED context=${context} expected=${normalizedExpected} actual=${normalizedActual}`,
    );
  }
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status} body=${text}`);
  }
}

async function registerUser(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const nickname = `${prefix}_${randomPart}`;
  const password = "pass12345";
  const response = await fetch(`${apiBaseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, displayName: nickname, password }),
  });
  const payload = await readJson(response, "REGISTER");
  if (!response.ok) {
    throw new Error(`REGISTER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createTask(token, language, marker) {
  const response = await fetch(`${apiBaseUrl}/me/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: `Lang Task ${language} ${marker}`,
      description: `Task language ${language}`,
      starterCode: `// ${language} ${marker}\n`,
      language,
    }),
  });
  const payload = await readJson(response, "CREATE_TASK");
  if (!response.ok) {
    throw new Error(`CREATE_TASK_FAILED ${language} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createRoom(token, title, taskIds) {
  const response = await fetch(`${apiBaseUrl}/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title, taskIds }),
  });
  const payload = await readJson(response, "CREATE_ROOM");
  if (!response.ok) {
    throw new Error(`CREATE_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function addRoomTasks(token, inviteCode, taskIds) {
  const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ taskIds }),
  });
  const payload = await readJson(response, "ADD_ROOM_TASKS");
  if (!response.ok) {
    throw new Error(`ADD_ROOM_TASKS_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function getRoomByAuth(token, inviteCode) {
  const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await readJson(response, "GET_ROOM_AUTH");
  if (!response.ok) {
    throw new Error(`GET_ROOM_AUTH_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function createGuestRoom(language, marker) {
  const response = await fetch(`${apiBaseUrl}/public/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: `Guest room ${marker}`,
      ownerDisplayName: "Guest Owner",
      language,
    }),
  });
  const payload = await readJson(response, "CREATE_GUEST_ROOM");
  if (!response.ok) {
    throw new Error(`CREATE_GUEST_ROOM_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function getRoomByOwnerToken(inviteCode, ownerToken) {
  const response = await fetch(`${apiBaseUrl}/rooms/${inviteCode}`, {
    headers: { "X-Room-Owner-Token": ownerToken },
  });
  const payload = await readJson(response, "GET_ROOM_OWNER");
  if (!response.ok) {
    throw new Error(`GET_ROOM_OWNER_FAILED ${JSON.stringify(payload)}`);
  }
  return payload;
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

    if (message?.type !== "state_sync" || !message.payload) return;
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

async function connectAuthStream(inviteCode, token, sessionId, label) {
  const stream = new SseRoomClient(
    `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionId)}&displayNameEncoded=${encodeURIComponent(label)}&authToken=${encodeURIComponent(token)}`,
    label,
  );
  await stream.connect();
  const initialState = await stream.waitForStateSync(() => true);
  return { stream, initialState };
}

async function connectOwnerTokenStream(inviteCode, ownerToken, sessionId, label) {
  const stream = new SseRoomClient(
    `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionId)}&displayNameEncoded=${encodeURIComponent(label)}&ownerToken=${encodeURIComponent(ownerToken)}`,
    label,
  );
  await stream.connect();
  const initialState = await stream.waitForStateSync(() => true);
  return { stream, initialState };
}

async function runMixedTasksAndManualLanguageScenario() {
  const marker = `${Date.now()}_mixed`;
  const auth = await registerUser("langmix");
  const taskJava = await createTask(auth.token, "java", `${marker}_java`);
  const taskSql = await createTask(auth.token, "sql", `${marker}_sql`);
  const room = await createRoom(auth.token, `Room mixed ${marker}`, [taskJava.id, taskSql.id]);

  assertCondition(room.tasks.length >= 2, `MIXED_ROOM_TASKS_INVALID ${room.tasks.length}`);
  assertLanguage(room.language, "java", "mixed-room-initial-language");
  assertLanguage(room.tasks[0].language, "java", "mixed-room-step0-language");
  assertLanguage(room.tasks[1].language, "sql", "mixed-room-step1-language");

  const sessionId = `sess_${marker}`;
  const { stream, initialState } = await connectAuthStream(room.inviteCode, auth.token, sessionId, "Lang Mix Owner");
  assertLanguage(initialState.language, "java", "mixed-stream-initial-language");
  assertCondition(initialState.currentStep === 0, `MIXED_INITIAL_STEP_INVALID ${initialState.currentStep}`);
  const eventToken = initialState.eventToken;
  assertCondition(Boolean(eventToken), "MIXED_EVENT_TOKEN_MISSING");

  let clientEventSequence = 1;
  const sendAndWait = async (type, extraPayload, predicate) => {
    const startIndex = stream.stateSyncEvents.length;
    await postRealtimeEvent(room.inviteCode, {
      sessionId,
      eventToken,
      clientEventSequence,
      operationId: randomUUID(),
      type,
      ...extraPayload,
    });
    clientEventSequence += 1;
    return stream.waitForStateSync(predicate, 15_000, startIndex);
  };

  await sendAndWait(
    "set_step",
    { stepIndex: 1 },
    (state) => state.currentStep === 1 && normalizeLanguage(state.language) === "sql",
  );

  await sendAndWait(
    "language_update",
    { language: "python" },
    (state) => state.currentStep === 1 && normalizeLanguage(state.language) === "python",
  );

  const afterManualSwitch = await getRoomByAuth(auth.token, room.inviteCode);
  assertLanguage(afterManualSwitch.language, "python", "mixed-after-manual-language");
  assertCondition(afterManualSwitch.currentStep === 1, `MIXED_STEP_AFTER_MANUAL_INVALID ${afterManualSwitch.currentStep}`);

  await sendAndWait(
    "set_step",
    { stepIndex: 0 },
    (state) => state.currentStep === 0 && normalizeLanguage(state.language) === "java",
  );

  await sendAndWait(
    "set_step",
    { stepIndex: 1 },
    (state) => state.currentStep === 1 && normalizeLanguage(state.language) === "python",
  );

  const afterReturn = await getRoomByAuth(auth.token, room.inviteCode);
  assertLanguage(afterReturn.language, "python", "mixed-after-return-language");
  assertCondition(afterReturn.currentStep === 1, `MIXED_STEP_AFTER_RETURN_INVALID ${afterReturn.currentStep}`);

  stream.close();
}

async function runAddTasksWithDifferentLanguagesScenario() {
  const marker = `${Date.now()}_add`;
  const auth = await registerUser("langadd");
  const taskNode = await createTask(auth.token, "nodejs", `${marker}_node`);
  const taskKotlin = await createTask(auth.token, "kotlin", `${marker}_kotlin`);
  const taskSql = await createTask(auth.token, "sql", `${marker}_sql`);

  const room = await createRoom(auth.token, `Room add ${marker}`, [taskNode.id]);
  assertLanguage(room.language, "nodejs", "add-room-initial-language");

  const updatedRoom = await addRoomTasks(auth.token, room.inviteCode, [taskKotlin.id, taskSql.id]);
  assertCondition(updatedRoom.tasks.length >= 3, `ADD_TASKS_LENGTH_INVALID ${updatedRoom.tasks.length}`);

  const byStep = [...updatedRoom.tasks].sort((left, right) => left.stepIndex - right.stepIndex);
  assertLanguage(byStep[0]?.language, "nodejs", "add-step0-language");
  assertLanguage(byStep[1]?.language, "kotlin", "add-step1-language");
  assertLanguage(byStep[2]?.language, "sql", "add-step2-language");

  const sessionId = `sess_${marker}`;
  const { stream, initialState } = await connectAuthStream(room.inviteCode, auth.token, sessionId, "Lang Add Owner");
  assertLanguage(initialState.language, "nodejs", "add-stream-initial-language");
  const eventToken = initialState.eventToken;
  assertCondition(Boolean(eventToken), "ADD_EVENT_TOKEN_MISSING");

  let clientEventSequence = 1;
  const sendAndWait = async (stepIndex, expectedLanguage) => {
    const startIndex = stream.stateSyncEvents.length;
    await postRealtimeEvent(room.inviteCode, {
      sessionId,
      eventToken,
      clientEventSequence,
      operationId: randomUUID(),
      type: "set_step",
      stepIndex,
    });
    clientEventSequence += 1;
    return stream.waitForStateSync(
      (state) =>
        state.currentStep === stepIndex &&
        normalizeLanguage(state.language) === normalizeLanguage(expectedLanguage),
      15_000,
      startIndex,
    );
  };

  await sendAndWait(1, "kotlin");
  await sendAndWait(2, "sql");
  await sendAndWait(0, "nodejs");

  stream.close();
}

async function runGuestLanguageSelectionScenario() {
  const marker = `${Date.now()}_guest`;
  const room = await createGuestRoom("kotlin", marker);
  assertLanguage(room.language, "kotlin", "guest-create-language");
  assertCondition(Boolean(room.ownerToken), "GUEST_OWNER_TOKEN_MISSING");
  assertCondition(Array.isArray(room.tasks) && room.tasks.length > 0, "GUEST_TASKS_MISSING");
  room.tasks.forEach((task, index) => {
    assertLanguage(task.language, "kotlin", `guest-task-language-${index}`);
  });

  const roomViaOwnerToken = await getRoomByOwnerToken(room.inviteCode, room.ownerToken);
  assertLanguage(roomViaOwnerToken.language, "kotlin", "guest-read-language");

  const sessionId = `sess_${marker}`;
  const { stream, initialState } = await connectOwnerTokenStream(
    room.inviteCode,
    room.ownerToken,
    sessionId,
    "Guest Owner",
  );
  assertLanguage(initialState.language, "kotlin", "guest-stream-language");
  stream.close();
}

try {
  await runMixedTasksAndManualLanguageScenario();
  await runAddTasksWithDifferentLanguagesScenario();
  await runGuestLanguageSelectionScenario();
  console.log("ROOM_LANGUAGE_BEHAVIOR_OK");
} catch (error) {
  console.error("ROOM_LANGUAGE_BEHAVIOR_FAIL", error);
  process.exitCode = 1;
}
