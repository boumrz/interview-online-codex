import { chromium } from "playwright";

const webBaseUrl = process.env.E2E_BASE_URL || "http://localhost:5173";
const apiBaseUrl = process.env.E2E_API_URL || "http://localhost:8080/api";
const perRecipientDeadlineMs = Number(process.env.E2E_MAX_DELIVERY_MS || 5_000);
const p95DeadlineMs = Number(process.env.E2E_P95_DELIVERY_MS || 2_500);
const repetitions = Number(process.env.E2E_COLLAB_REPETITIONS || 1);

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function percentile(values, ratio) {
  assertCondition(values.length > 0, "PERCENTILE_REQUIRES_SAMPLES");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function summarize(samples) {
  const values = samples.map((sample) => sample.latencyMs);
  return {
    count: values.length,
    p50Ms: Number(percentile(values, 0.5).toFixed(1)),
    p95Ms: Number(percentile(values, 0.95).toFixed(1)),
    maxMs: Number(Math.max(...values).toFixed(1)),
  };
}

async function readJson(response, label) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${label}_INVALID_JSON status=${response.status} body=${text}`);
  }
  if (!response.ok) throw new Error(`${label}_FAILED status=${response.status} body=${JSON.stringify(payload)}`);
  return payload;
}

async function requestJson(path, options, label) {
  return readJson(await fetch(`${apiBaseUrl}${path}`, options), label);
}

async function registerUser(prefix) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const nickname = `${prefix}_${suffix}`;
  return requestJson(
    "/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, displayName: nickname, password: "pass12345" }),
    },
    "REGISTER_USER",
  );
}

async function createTask(token, topologyName, taskNumber) {
  const marker = uniqueSuffix();
  return requestJson(
    "/me/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: `${topologyName} task ${taskNumber} ${marker}`,
        description: `Task ${taskNumber} for five-participant collaboration verification`,
        starterCode: `// ${topologyName}_TASK_${taskNumber}\n`,
        language: "nodejs",
      }),
    },
    "CREATE_TASK",
  );
}

async function createRoom(token, topologyName, taskIds) {
  return requestJson(
    "/rooms",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: `Five participant ${topologyName} ${uniqueSuffix()}`, taskIds }),
    },
    "CREATE_ROOM",
  );
}

async function grantInterviewer(ownerToken, inviteCode, userId) {
  return requestJson(
    `/rooms/${inviteCode}/participants/${userId}/role`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ role: "interviewer" }),
    },
    "GRANT_INTERVIEWER",
  );
}

async function getRoom(ownerToken, inviteCode) {
  return requestJson(`/rooms/${inviteCode}`, { headers: { Authorization: `Bearer ${ownerToken}` } }, "GET_ROOM");
}

async function waitForRoomStep(ownerToken, inviteCode, expectedStep) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const room = await getRoom(ownerToken, inviteCode);
    if (room.currentStep === expectedStep) return room;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const room = await getRoom(ownerToken, inviteCode);
  throw new Error(`ROOM_STEP_TIMEOUT expected=${expectedStep} actual=${room.currentStep}`);
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

async function bootstrapManagerPage(page, auth, inviteCode) {
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
}

async function bootstrapCandidatePage(page, inviteCode, displayName) {
  await page.goto(webBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ roomInviteCode, savedName }) => {
    localStorage.setItem("display_name", savedName);
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, savedName);
  }, { roomInviteCode: inviteCode, savedName: displayName });
  await page.goto(`${webBaseUrl}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-testid='room-code-editor-host'] .cm-editor").waitFor({ timeout: 15_000 });
}

async function waitForRealtimeReady(page, label) {
  const status = page.locator("[data-testid='room-connection-status']");
  await status.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    (element) => element.getAttribute("data-state") === "online",
    await status.elementHandle(),
    { timeout: 10_000 },
  );
  await page.waitForTimeout(250);
  assertCondition((await status.getAttribute("data-state")) === "online", `${label}_REALTIME_NOT_READY`);
}

async function editorText(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    if (host?.__roomEditorView?.state?.doc?.toString) return host.__roomEditorView.state.doc.toString();
    return document.querySelector("[data-testid='room-code-editor-host'] .cm-content")?.textContent ?? "";
  });
}

async function appendEditorMarker(page, marker) {
  await page.evaluate((nextMarker) => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    const view = host?.__roomEditorView;
    if (!view?.state?.doc) throw new Error("ROOM_EDITOR_VIEW_NOT_AVAILABLE");
    const from = view.state.doc.length;
    const insertion = `\n${nextMarker}\n`;
    view.dispatch({
      changes: { from, to: from, insert: insertion },
      selection: { anchor: from + insertion.length, head: from + insertion.length },
    });
  }, marker);
}

async function waitForEditorMarker(page, marker, startedAt) {
  await page.waitForFunction(
    (expectedMarker) => {
      const host = document.querySelector("[data-testid='room-code-editor-host']");
      const value = host?.__roomEditorView?.state?.doc?.toString?.() ??
        document.querySelector("[data-testid='room-code-editor-host'] .cm-content")?.textContent ?? "";
      return value.includes(expectedMarker);
    },
    marker,
    { timeout: perRecipientDeadlineMs },
  );
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function occurrences(value, marker) {
  return value.split(marker).length - 1;
}

async function assertMarkerExactlyOnce(participants, marker, label) {
  const values = await Promise.all(participants.map((participant) => editorText(participant.page)));
  values.forEach((value, index) => {
    const count = occurrences(value, marker);
    assertCondition(count === 1, `${label}_MARKER_COUNT participant=${participants[index].label} marker=${marker} count=${count}`);
  });
}

async function measurePropagation({ topology, channel, writer, recipients, participants, marker, samples }) {
  const startedAt = process.hrtime.bigint();
  await appendEditorMarker(writer.page, marker);
  const latencies = await Promise.all(recipients.map(async (recipient) => ({
    recipient,
    latencyMs: await waitForEditorMarker(recipient.page, marker, startedAt),
  })));
  for (const { recipient, latencyMs } of latencies) {
    samples.push({ topology, channel, writer: writer.label, recipient: recipient.label, marker, latencyMs: Number(latencyMs.toFixed(1)) });
  }
  await assertMarkerExactlyOnce(participants, marker, `${topology}_${channel}`);
}

async function assertCandidateIsolation(candidate) {
  assertCondition(await candidate.page.locator("[data-testid^='room-step-row-']").count() === 0, `${candidate.label}_CANDIDATE_STEP_CONTROLS_VISIBLE`);
  assertCondition(await candidate.page.locator("[data-testid='room-publish-step']").count() === 0, `${candidate.label}_CANDIDATE_PUBLISH_CONTROL_VISIBLE`);
}

async function assertManagerControls(manager) {
  assertCondition(await manager.page.locator("[data-testid^='room-step-row-']").count() >= 3, `${manager.label}_MANAGER_STEP_CONTROLS_MISSING`);
}

async function assertOnline(participants, label) {
  await Promise.all(participants.map((participant) => waitForRealtimeReady(participant.page, `${label}_${participant.label}`)));
}

async function createTopology(browser, { name, managerCount, candidateCount }) {
  const managerAuth = [];
  const userPrefix = name.startsWith("four_") ? "five_4m1c" : "five_3m2c";
  for (let index = 0; index < managerCount; index += 1) {
    managerAuth.push(await registerUser(`${userPrefix}_m${index + 1}`));
  }
  const owner = managerAuth[0];
  const tasks = [];
  for (let taskNumber = 1; taskNumber <= 3; taskNumber += 1) {
    tasks.push(await createTask(owner.token, name, taskNumber));
  }
  const room = await createRoom(owner.token, name, tasks.map((task) => task.id));
  for (const manager of managerAuth.slice(1)) {
    await grantInterviewer(owner.token, room.inviteCode, manager.user.id);
  }

  const participants = [];
  const managers = [];
  const candidates = [];
  for (let index = 0; index < managerAuth.length; index += 1) {
    const context = await browser.newContext();
    await configureBrowserApiTransport(context);
    const page = await context.newPage();
    const participant = { label: `manager_${index + 1}`, role: "manager", auth: managerAuth[index], context, page };
    await bootstrapManagerPage(page, managerAuth[index], room.inviteCode);
    managers.push(participant);
    participants.push(participant);
  }
  for (let index = 0; index < candidateCount; index += 1) {
    const context = await browser.newContext();
    await configureBrowserApiTransport(context);
    const page = await context.newPage();
    const participant = { label: `candidate_${index + 1}`, role: "candidate", context, page };
    await bootstrapCandidatePage(page, room.inviteCode, `${name} Candidate ${index + 1}`);
    candidates.push(participant);
    participants.push(participant);
  }
  await assertOnline(participants, name);
  return { name, room, owner, tasks, participants, managers, candidates };
}

async function closeTopology(topology) {
  await Promise.all(topology.participants.map((participant) => participant.context.close().catch(() => {})));
}

async function runFourManagersOneCandidate(browser, runNumber, samples) {
  const topology = await createTopology(browser, { name: `four_managers_one_candidate_run_${runNumber}`, managerCount: 4, candidateCount: 1 });
  try {
    const { name, managers, candidates, participants, tasks, room, owner } = topology;
    await Promise.all(managers.map(assertManagerControls));
    await assertCandidateIsolation(candidates[0]);

    const publicWriters = [managers[0], managers[1], managers[2], managers[3], candidates[0]];
    for (const [index, writer] of publicWriters.entries()) {
      const marker = `${name}_PUBLIC_${index + 1}_${writer.label}_${uniqueSuffix()}`;
      await measurePropagation({
        topology: name,
        channel: "published_yjs",
        writer,
        recipients: participants.filter((participant) => participant !== writer),
        participants,
        marker,
        samples,
      });
    }

    await Promise.all([
      managers[0].page.locator("[data-testid='room-step-row-1']").click(),
      managers[1].page.locator("[data-testid='room-step-row-1']").click(),
      managers[2].page.locator("[data-testid='room-step-row-1']").click(),
    ]);
    await managers[3].page.locator("[data-testid='room-step-row-2']").click();
    await managers[0].page.locator("[data-testid='room-publish-step']").waitFor({ state: "visible", timeout: 10_000 });
    await managers[1].page.locator("[data-testid='room-publish-step']").waitFor({ state: "visible", timeout: 10_000 });
    const privateObservers = [managers[0], managers[1], managers[2]];
    for (const [index, writer] of privateObservers.entries()) {
      const marker = `${name}_PRIVATE_${index + 1}_${writer.label}_${uniqueSuffix()}`;
      await measurePropagation({
        topology: name,
        channel: "manager_workspace_yjs",
        writer,
        recipients: privateObservers.filter((participant) => participant !== writer),
        participants: privateObservers,
        marker,
        samples,
      });
      const candidateText = await editorText(candidates[0].page);
      assertCondition(!candidateText.includes(marker), `${name}_CANDIDATE_RECEIVED_UNPUBLISHED_MARKER`);
    }

    await managers[1].page.locator("[data-testid='room-publish-step']").click();
    await waitForRoomStep(owner.token, room.inviteCode, 1);
    await candidates[0].page.locator("[data-testid='room-current-published-step-title']").waitFor({ state: "visible", timeout: 10_000 });
    const candidateTitle = (await candidates[0].page.locator("[data-testid='room-current-published-step-title']").textContent()) ?? "";
    assertCondition(candidateTitle.includes(tasks[1].title), `${name}_CANDIDATE_DID_NOT_FOLLOW_PUBLISHED_STEP`);
    const privateMarkers = samples.filter((sample) => sample.topology === name && sample.channel === "manager_workspace_yjs").map((sample) => sample.marker);
    for (const marker of new Set(privateMarkers)) {
      await candidates[0].page.waitForFunction(
        (expectedMarker) => document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker),
        marker,
        { timeout: 10_000 },
      );
    }
    const notification = managers[3].page.locator("[data-testid='room-step-change-notification']");
    await notification.waitFor({ state: "visible", timeout: 10_000 });
    assertCondition(((await notification.textContent()) ?? "").includes(tasks[1].title), `${name}_MANAGER_NOTIFICATION_TITLE_MISSING`);
    assertCondition((await managers[3].page.locator("[data-testid='room-step-row-2']").getAttribute("data-local-selected")) === "true", `${name}_MANAGER_LOCAL_SELECTION_CHANGED_AFTER_PUBLICATION`);
    assertCondition(await managers[1].page.locator("[data-testid='room-step-change-notification']").count() === 0, `${name}_PUBLISHER_RECEIVED_NOTIFICATION`);
    await assertOnline(participants, `${name}_FINAL`);
  } finally {
    await closeTopology(topology);
  }
}

async function runThreeManagersTwoCandidates(browser, runNumber, samples) {
  const topology = await createTopology(browser, { name: `three_managers_two_candidates_run_${runNumber}`, managerCount: 3, candidateCount: 2 });
  try {
    const { name, managers, candidates, participants } = topology;
    await Promise.all(managers.map(assertManagerControls));
    await Promise.all(candidates.map(assertCandidateIsolation));

    const publicWriters = [managers[0], managers[1], managers[2], candidates[0], candidates[1]];
    for (const [index, writer] of publicWriters.entries()) {
      const marker = `${name}_PUBLIC_${index + 1}_${writer.label}_${uniqueSuffix()}`;
      await measurePropagation({
        topology: name,
        channel: "published_yjs",
        writer,
        recipients: participants.filter((participant) => participant !== writer),
        participants,
        marker,
        samples,
      });
    }

    const concurrentWrites = [
      { writer: managers[1], marker: `${name}_CONCURRENT_manager_${uniqueSuffix()}` },
      { writer: candidates[1], marker: `${name}_CONCURRENT_candidate_${uniqueSuffix()}` },
    ];
    const startedAt = process.hrtime.bigint();
    await Promise.all([
      ...concurrentWrites.map(({ writer, marker }) => appendEditorMarker(writer.page, marker)),
    ]);
    for (const { writer, marker } of concurrentWrites) {
      const recipients = participants.filter((participant) => participant !== writer);
      const latencies = await Promise.all(recipients.map(async (recipient) => ({ recipient, latencyMs: await waitForEditorMarker(recipient.page, marker, startedAt) })));
      latencies.forEach(({ recipient, latencyMs }) => samples.push({
        topology: name,
        channel: "published_yjs_concurrent",
        writer: writer.label,
        recipient: recipient.label,
        marker,
        latencyMs: Number(latencyMs.toFixed(1)),
      }));
      await assertMarkerExactlyOnce(participants, marker, `${name}_CONCURRENT`);
    }
    await assertOnline(participants, `${name}_FINAL`);
  } finally {
    await closeTopology(topology);
  }
}

const browser = await chromium.launch({ headless: true });
const allSamples = [];

try {
  assertCondition(Number.isInteger(repetitions) && repetitions >= 1, `INVALID_E2E_COLLAB_REPETITIONS ${repetitions}`);
  for (let runNumber = 1; runNumber <= repetitions; runNumber += 1) {
    await runFourManagersOneCandidate(browser, runNumber, allSamples);
    await runThreeManagersTwoCandidates(browser, runNumber, allSamples);
  }
  const publishedSamples = allSamples.filter((sample) => sample.channel.startsWith("published_yjs"));
  const managerWorkspaceSamples = allSamples.filter((sample) => sample.channel === "manager_workspace_yjs");
  const report = {
    repetitions,
    participantsPerTopology: 5,
    thresholdsMs: { perRecipientDeadlineMs, p95DeadlineMs, maxMs: perRecipientDeadlineMs },
    published: summarize(publishedSamples),
    managerWorkspace: summarize(managerWorkspaceSamples),
    samples: allSamples,
  };
  assertCondition(report.published.p95Ms <= p95DeadlineMs, `PUBLISHED_PROPAGATION_P95_TOO_HIGH actual=${report.published.p95Ms} threshold=${p95DeadlineMs}`);
  assertCondition(report.published.maxMs <= perRecipientDeadlineMs, `PUBLISHED_PROPAGATION_MAX_TOO_HIGH actual=${report.published.maxMs} threshold=${perRecipientDeadlineMs}`);
  assertCondition(report.managerWorkspace.p95Ms <= p95DeadlineMs, `MANAGER_WORKSPACE_PROPAGATION_P95_TOO_HIGH actual=${report.managerWorkspace.p95Ms} threshold=${p95DeadlineMs}`);
  assertCondition(report.managerWorkspace.maxMs <= perRecipientDeadlineMs, `MANAGER_WORKSPACE_PROPAGATION_MAX_TOO_HIGH actual=${report.managerWorkspace.maxMs} threshold=${perRecipientDeadlineMs}`);
  console.log("FIVE_PARTICIPANT_COLLABORATION_METRICS", JSON.stringify({
    repetitions: report.repetitions,
    participantsPerTopology: report.participantsPerTopology,
    thresholdsMs: report.thresholdsMs,
    published: report.published,
    managerWorkspace: report.managerWorkspace,
  }));
  if (process.env.E2E_PRINT_COLLAB_SAMPLES === "true") {
    console.log("FIVE_PARTICIPANT_COLLABORATION_SAMPLES", JSON.stringify(report.samples));
  }
  console.log("FIVE_PARTICIPANT_COLLABORATION_OK");
} catch (error) {
  console.error("FIVE_PARTICIPANT_COLLABORATION_FAIL", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
