const apiBaseUrl = process.env.E2E_API_URL || "http://127.0.0.1:8080/api";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status} body=${text}`);
  }
}

async function requestJson(path, options, label) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const payload = await readJson(response, label);
  if (!response.ok) throw new Error(`${label}_FAILED ${JSON.stringify(payload)}`);
  return payload;
}

async function registerUser() {
  const suffix = Math.random().toString(36).slice(2, 9);
  return requestJson(
    "/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: `late_manager_event_${suffix}`,
        displayName: "Late manager event",
        password: "pass12345",
      }),
    },
    "REGISTER_MANAGER",
  );
}

async function createTask(token, title) {
  return requestJson(
    "/me/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, description: title, starterCode: "// active task", language: "nodejs" }),
    },
    "CREATE_TASK",
  );
}

async function createRoom(token, taskIds) {
  return requestJson(
    "/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: "Late manager workspace event", taskIds }),
    },
    "CREATE_ROOM",
  );
}

async function connectRealtime(inviteCode, { authToken = null, prefix }) {
  const sessionId = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${apiBaseUrl}/realtime/rooms/${inviteCode}/stream?sessionId=${encodeURIComponent(sessionId)}&displayNameEncoded=${encodeURIComponent(prefix)}`,
      {
        headers: {
          Accept: "text/event-stream",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        signal: controller.signal,
      },
    );
    if (!response.ok || !response.body) {
      throw new Error(`${prefix}_SSE_CONNECT_FAILED status=${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.indexOf("\n\n");
      if (boundary < 0) continue;
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const message = JSON.parse(data);
        if (message?.type === "state_sync" && message.payload?.eventToken) {
          return {
            sessionId,
            eventToken: message.payload.eventToken,
            close: () => {
              reader.cancel().catch(() => {});
              controller.abort();
            },
          };
        }
      } catch {}
    }
    throw new Error(`${prefix}_SSE_ENDED_WITHOUT_STATE_SYNC`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postEvent(inviteCode, payload) {
  return fetch(`${apiBaseUrl}/realtime/rooms/${inviteCode}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const manager = await registerUser();
const activeTask = await createTask(manager.token, `Active task ${Date.now()}`);
const inactiveTask = await createTask(manager.token, `Inactive task ${Date.now()}`);
const room = await createRoom(manager.token, [activeTask.id, inactiveTask.id]);
const managerRealtime = await connectRealtime(room.inviteCode, { authToken: manager.token, prefix: "manager_late_event" });
const candidateRealtime = await connectRealtime(room.inviteCode, { prefix: "candidate_late_event" });

try {
  const managerOpen = await postEvent(room.inviteCode, {
    sessionId: managerRealtime.sessionId,
    eventToken: managerRealtime.eventToken,
    clientEventSequence: 1,
    type: "manager_workspace_open",
    stepIndex: 0,
  });
  const managerYjs = await postEvent(room.inviteCode, {
    sessionId: managerRealtime.sessionId,
    eventToken: managerRealtime.eventToken,
    clientEventSequence: 2,
    type: "manager_workspace_yjs_update",
    stepIndex: 0,
    yjsUpdate: "AQID",
    baseServerYjsSequence: 0,
    operationId: `late-active-manager-update-${Date.now()}`,
  });
  const candidateOpen = await postEvent(room.inviteCode, {
    sessionId: candidateRealtime.sessionId,
    eventToken: candidateRealtime.eventToken,
    clientEventSequence: 1,
    type: "manager_workspace_open",
    stepIndex: 0,
  });

  assert(managerOpen.status === 204, `LATE_ACTIVE_MANAGER_OPEN_EXPECTED_204 actual=${managerOpen.status}`);
  assert(managerYjs.status === 204, `LATE_ACTIVE_MANAGER_YJS_EXPECTED_204 actual=${managerYjs.status}`);
  assert(candidateOpen.status === 403, `CANDIDATE_ACTIVE_MANAGER_OPEN_EXPECTED_403 actual=${candidateOpen.status}`);
  console.log("LATE_PUBLISHED_MANAGER_WORKSPACE_EVENT_OK");
} catch (error) {
  console.error("LATE_PUBLISHED_MANAGER_WORKSPACE_EVENT_FAIL", error);
  process.exitCode = 1;
} finally {
  managerRealtime.close();
  candidateRealtime.close();
}
