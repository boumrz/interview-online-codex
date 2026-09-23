import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";

const web = process.env.E2E_BASE_URL || "http://localhost:5173";
const api = process.env.E2E_API_URL || "http://localhost:8080/api";
const browserApi = `${web}/api`;
const password = "test-password-123";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
const isApiResponse = (response, path) => new URL(response.url()).pathname === `/api${path}`;

let browser;
let preflightAccount;
let personalRoom;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function rawRequest(path, { token, method = "GET", body, key } = {}) {
  return fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function request(path, { expectedStatus = 200, ...options } = {}) {
  const response = await rawRequest(path, options);
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${options.method || "GET"} ${path}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function account(prefix = "ac02", isHr = false) {
  const suffix = unique();
  return request("/auth/register", {
    method: "POST",
    body: {
      nickname: `${prefix.slice(0, 31 - suffix.length)}_${suffix}`,
      displayName: `${prefix} ${suffix}`,
      password,
      isHr,
    },
  });
}

async function createTeamApi(auth, name) {
  const response = await rawRequest("/teams", {
    token: auth.token,
    method: "POST",
    key: randomUUID(),
    body: { name },
  });
  const text = await response.text();
  assert.equal(response.status, 201, `POST /teams must provision AC-02 fixture: ${text.slice(0, 500)}`);
  const result = JSON.parse(text);
  return result.team ?? result;
}

function tokenFromInvitationUrl(url) {
  const parsed = new URL(url, web);
  return new URLSearchParams(parsed.hash.slice(1)).get("token");
}

async function addTeamMemberViaInvitation(ownerAuth, team, inviteeAuth) {
  const created = await request(`/teams/${team.id}/invitations`, {
    token: ownerAuth.token,
    method: "POST",
    expectedStatus: 201,
    key: randomUUID(),
    body: {},
  });
  const link = await request(`/teams/${team.id}/invitations/${created.invitation.id}/link`, {
    token: ownerAuth.token,
  });
  const token = tokenFromInvitationUrl(link.url);
  assert.ok(token, `Invitation link must expose a token: ${link.url}`);
  await request("/team-invitations/accept", {
    token: inviteeAuth.token,
    method: "POST",
    key: randomUUID(),
    body: { token },
  });
}

async function addTeamMembers(ownerAuth, team, firstMemberAuth, secondMemberAuth) {
  const fixtureResponse = await rawRequest("/test-fixtures/team-invitations/management", {
    token: ownerAuth.token,
    method: "POST",
    body: {
      teamId: team.id,
      adminUserId: firstMemberAuth.user.id,
      memberUserId: secondMemberAuth.user.id,
    },
  });
  if (fixtureResponse.status === 201) {
    const fixture = await fixtureResponse.json();
    assert.deepEqual([fixture.admin.userId, fixture.member.userId], [firstMemberAuth.user.id, secondMemberAuth.user.id]);
    return;
  }
  if (fixtureResponse.status !== 404) {
    const text = await fixtureResponse.text();
    assert.fail(`POST /test-fixtures/team-invitations/management: ${text.slice(0, 500)}`);
  }
  await addTeamMemberViaInvitation(ownerAuth, team, firstMemberAuth);
  await addTeamMemberViaInvitation(ownerAuth, team, secondMemberAuth);
}

async function createPersonalRoom(auth, title) {
  return request("/rooms", {
    token: auth.token,
    method: "POST",
    body: { title, language: "nodejs", taskIds: [] },
  });
}

async function createPersonalTask(auth, { title, description = "Personal task", starterCode = "// personal", language = "nodejs" }) {
  return request("/me/tasks", {
    token: auth.token,
    method: "POST",
    body: { title, description, starterCode, language },
  });
}

async function createPersonalPreset(auth, { name, taskIds }) {
  return request("/me/presets", {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { name, taskTemplateIds: taskIds },
  });
}

async function createTeamTask(auth, team, { title, description, starterCode, language = "nodejs" }) {
  const result = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { title, description, starterCode, language },
  });
  return result.task;
}

async function createTeamTrack(auth, team, { name }) {
  const result = await request(`/teams/${team.id}/tracks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { name },
  });
  return result.track;
}

async function createTeamVacancy(auth, team, track, { title }) {
  const result = await request(`/teams/${team.id}/tracks/${track.id}/vacancies`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { title },
  });
  return result.vacancy;
}

async function saveTrackProgrammeDraft(auth, team, track, { taskIds, revision = null }) {
  const result = await request(`/teams/${team.id}/tracks/${track.id}/programme/draft`, {
    token: auth.token,
    method: "PATCH",
    body: {
      taskIds,
      ...(revision === null ? {} : { revision }),
    },
  });
  return result.programme;
}

async function publishTrackProgramme(auth, team, track, { revision }) {
  const result = await request(`/teams/${team.id}/tracks/${track.id}/programme/publish`, {
    token: auth.token,
    method: "POST",
    body: { revision },
  });
  return result.programme;
}

async function saveVacancyProgrammeDraft(auth, team, track, vacancy, { taskIds, revision = null }) {
  const result = await request(`/teams/${team.id}/tracks/${track.id}/vacancies/${vacancy.id}/programme/draft`, {
    token: auth.token,
    method: "PATCH",
    body: {
      taskIds,
      ...(revision === null ? {} : { revision }),
    },
  });
  return result.programme;
}

async function publishVacancyProgramme(auth, team, track, vacancy, { revision }) {
  const result = await request(`/teams/${team.id}/tracks/${track.id}/vacancies/${vacancy.id}/programme/publish`, {
    token: auth.token,
    method: "POST",
    body: { revision },
  });
  return result.programme;
}

async function createTeamTaskSet(auth, team, { name, taskIds }) {
  const result = await request(`/teams/${team.id}/task-sets`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { name, taskIds },
  });
  return result.taskSet;
}

async function createTeamInterview(auth, team, body) {
  const result = await request(`/teams/${team.id}/interviews`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    key: randomUUID(),
    body,
  });
  return result.interview;
}

async function openAccount(auth, path = "/workspace/personal/interviews", { viewport = { width: 1280, height: 720 } } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", user.displayName);
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached" });
  return { context, page };
}

async function openRoomAccount(auth, inviteCode, { viewport = { width: 1280, height: 720 }, onContext } = {}) {
  const context = await browser.newContext({ viewport });
  if (onContext) await onContext(context);
  await context.addInitScript(({ token, user, roomInviteCode }) => {
    const displayName = user.displayName || user.nickname;
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    localStorage.setItem("display_name", displayName);
    localStorage.setItem(`guest_display_name_${roomInviteCode}`, displayName);
  }, { ...auth, roomInviteCode: inviteCode });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${web}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "attached" });
  await page.locator("[data-testid='room-code-editor-host'] .cm-editor").waitFor({ timeout: 15_000 });
  const status = page.locator("[data-testid='room-connection-status']");
  await page.waitForFunction(
    (element) => element.getAttribute("data-state") === "online",
    await status.elementHandle(),
    { timeout: 10_000 },
  );
  return { context, page };
}

const switcher = (page) => page.getByRole("button", { name: /^Рабочее пространство:/ });

async function openWorkspaceDialog(page) {
  await switcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Выбор рабочего пространства", exact: true });
  await dialog.waitFor();
  return dialog;
}

async function selectWorkspace(page, { name, id, path = "interviews" }) {
  const dialog = await openWorkspaceDialog(page);
  const shortId = id.slice(0, 8);
  await dialog.getByRole("button", { name: new RegExp(`${name}.*${shortId}`, "i") }).click();
  await page.waitForURL(`**/workspace/teams/${id}/${path}*`);
}

async function createTeamThroughUi(page, name) {
  const workspaceDialog = await openWorkspaceDialog(page);
  await workspaceDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "Создать команду", exact: true });
  await createDialog.getByLabel("Название команды", { exact: true }).fill(name);
  const requestPromise = page.waitForRequest((candidate) =>
    candidate.url() === `${browserApi}/teams` && candidate.method() === "POST");
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.url() === `${browserApi}/teams` && candidate.request().method() === "POST" && candidate.status() === 201);
  await createDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
  const [teamRequest, response] = await Promise.all([requestPromise, responsePromise]);
  const body = await response.json();
  const team = body.team ?? body;
  assert.match(await teamRequest.headerValue("Idempotency-Key"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(teamRequest.postDataJSON(), { name });
  await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
  await switcher(page).filter({ hasText: team.name }).waitFor();
  assert.match(await switcher(page).innerText(), new RegExp(team.id.slice(0, 8), "i"));
  return team;
}

async function loginInSamePage(page, auth) {
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(`${web}/`);
  await page.getByRole("link", { name: "Личный кабинет", exact: true }).click();
  await page.waitForURL("**/login");
  await page.getByLabel(/^Ник(?:\s*\*)?$/).fill(auth.user.nickname);
  await page.getByLabel(/^Пароль(?:\s*\*)?$/).fill(password);
  await page.getByRole("button", { name: "Войти в кабинет", exact: true }).click();
  await page.waitForURL("**/workspace/personal/**");
  await page.getByText(`@${auth.user.nickname}`, { exact: true }).waitFor();
}

async function settleRender(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function getTeamRoomWorkspace(auth, inviteCode, stepIndex) {
  return request(`/rooms/${inviteCode}/tasks/${stepIndex}/workspace`, {
    token: auth.token,
  });
}

async function waitForWorkspaceMarker(auth, inviteCode, stepIndex, marker) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const workspace = await getTeamRoomWorkspace(auth, inviteCode, stepIndex);
    if (workspace.code.includes(marker)) return workspace;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const workspace = await getTeamRoomWorkspace(auth, inviteCode, stepIndex);
  assert.fail(`TEAM_ROOM_WORKSPACE_MARKER_TIMEOUT expected=${marker} actual=${workspace.code}`);
}

async function waitForManagerWorkspaceEditor(page, stepIndex) {
  await page.getByRole("tab", { name: "Шаги", exact: true }).click();
  await page.waitForFunction(
    (expectedStepIndex) => {
      const context = document.querySelector("[data-testid='room-current-local-step-context']");
      const host = document.querySelector("[data-testid='room-code-editor-host']");
      return (
        context?.getAttribute("data-step-index") === String(expectedStepIndex) &&
        Boolean(host?.__roomEditorView?.state?.doc)
      );
    },
    stepIndex,
    { timeout: 10_000 },
  );
}

async function appendEditorMarker(page, marker) {
  await page.evaluate((nextMarker) => {
    const host = document.querySelector("[data-testid='room-code-editor-host']");
    const view = host?.__roomEditorView;
    if (!view?.state?.doc) throw new Error("ROOM_EDITOR_VIEW_NOT_AVAILABLE");
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, to: at, insert: `\n${nextMarker}\n` },
      selection: { anchor: at + nextMarker.length + 2 },
    });
  }, marker);
}

async function editorIncludes(page, marker) {
  return page.evaluate((expectedMarker) =>
    document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker) ?? false,
  marker);
}

async function waitForEditorMarker(page, marker, label) {
  await page.waitForFunction(
    (expectedMarker) => document.querySelector("[data-testid='room-code-editor-host']")?.__roomEditorView?.state?.doc?.toString?.().includes(expectedMarker),
    marker,
    { timeout: 10_000 },
  );
  assert.equal(await editorIncludes(page, marker), true, `${label}_MARKER_MISSING`);
}

async function waitForPublishedStep(page, title, label) {
  const currentTitle = page.locator("[data-testid='room-current-published-step-title']");
  await currentTitle.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    (expectedTitle) => document.querySelector("[data-testid='room-current-published-step-title']")?.textContent?.includes(expectedTitle),
    title,
    { timeout: 10_000 },
  );
  assert.match(await currentTitle.textContent(), new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label}_PUBLISHED_STEP_MISSING`);
}

async function assertNoTeamDisclosure(page, teamName, marker) {
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, new RegExp(teamName, "i"), `${marker}: stale team name disclosed`);
  assert.doesNotMatch(body, /\bOWNER\b/, `${marker}: stale team role disclosed`);
  assert.doesNotMatch(body, /Доступных командных интервью|Черновик нового интервью|Командная подготовка/, `${marker}: protected team surface disclosed`);
  assert.equal(await page.getByLabel("Название интервью", { exact: true }).count(), 0, `${marker}: stale team draft surface disclosed`);
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  preflightAccount = await account("preflight");
  personalRoom = await createPersonalRoom(preflightAccount, `PERSONAL only ${unique()}`);
});

after(async () => {
  await browser?.close();
});

test("AC-02 infrastructure: live API and authenticated personal workspace are ready", async () => {
  const rooms = await request("/me/rooms", { token: preflightAccount.token });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].id, personalRoom.id);
  const { context, page } = await openAccount(preflightAccount);
  try {
    await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/workspace/personal/interviews");
  } finally {
    await context.close();
  }
});

test("remediation: workspace trigger states the change action, exposes selection and restores keyboard focus", { timeout: 30_000 }, async () => {
  const auth = await account("switcher_affordance");
  const team = await createTeamApi(auth, `Очень длинная команда ${unique()}`);
  const { context, page } = await openAccount(auth);
  try {
    const trigger = switcher(page);
    await trigger.focus();
    assert.match(
      await trigger.getAttribute("aria-label"),
      /^Рабочее пространство: Личное пространство\. Сменить рабочее пространство$/,
      "SWITCHER_ACTION_CUE_OR_FULL_NAME_MISSING",
    );
    assert.equal(await trigger.getAttribute("aria-expanded"), "false", "SWITCHER_CLOSED_STATE_MISSING");
    assert.ok(await trigger.getAttribute("aria-controls"), "SWITCHER_DIALOG_RELATION_MISSING");
    const closedCue = trigger.locator("[data-workspace-switcher-cue]");
    assert.equal(await closedCue.count(), 1, "SWITCHER_VISUAL_OPEN_CUE_MISSING");
    assert.equal((await closedCue.textContent())?.trim(), "Сменить", "SWITCHER_CLOSED_VISUAL_CUE_WRONG");
    const triggerBox = await trigger.boundingBox();
    assert.ok(triggerBox && triggerBox.width >= 44 && triggerBox.height >= 44, `SWITCHER_TARGET_UNDERSIZED:${JSON.stringify(triggerBox)}`);

    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Выбор рабочего пространства", exact: true });
    await dialog.waitFor();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true", "SWITCHER_OPEN_STATE_MISSING");
    assert.equal((await closedCue.textContent())?.trim(), "Свернуть", "SWITCHER_OPEN_VISUAL_CUE_DID_NOT_CHANGE");
    const personalChoice = dialog.getByRole("button", { name: "Личное пространство", exact: true });
    const teamChoice = dialog.getByRole("button", { name: new RegExp(team.name) });
    assert.equal(
      await personalChoice.getAttribute("aria-current"),
      "true",
      "SWITCHER_SELECTED_PERSONAL_STATE_MISSING",
    );
    assert.equal(
      await teamChoice.getAttribute("aria-current"),
      null,
      "SWITCHER_UNSELECTED_TEAM_MARKED_CURRENT",
    );
    const [selectedBackground, unselectedBackground] = await Promise.all([
      personalChoice.evaluate((element) => getComputedStyle(element).backgroundColor),
      teamChoice.evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    assert.notEqual(selectedBackground, unselectedBackground, "SWITCHER_SELECTED_SPACE_NOT_VISUALLY_DISTINCT");
    for (const [label, choice] of [["PERSONAL", personalChoice], ["TEAM", teamChoice]]) {
      const borderWidth = await choice.evaluate((element) => getComputedStyle(element).borderTopWidth);
      assert.equal(borderWidth, "0px", `SWITCHER_${label}_DECORATIVE_BORDER_REMAINS`);
      const choiceBox = await choice.boundingBox();
      assert.ok(choiceBox && choiceBox.width >= 44 && choiceBox.height >= 44, `SWITCHER_${label}_CHOICE_TARGET_UNDERSIZED:${JSON.stringify(choiceBox)}`);
    }

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, "SWITCHER_ESCAPE_FOCUS_NOT_RETURNED");
  } finally {
    await context.close();
  }
});

test("team navigation stays mounted while switching sections", async () => {
  const auth = await account("steady_navigation");
  const team = await createTeamApi(auth, `Навигация ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews`);
  try {
    const navigation = page.getByRole("navigation", { name: "Разделы командного пространства" });
    await navigation.waitFor();
    const detailRequests = [];
    page.on("request", (requestCandidate) => {
      if (new URL(requestCandidate.url()).pathname === `/api/teams/${team.id}`) detailRequests.push(requestCandidate.url());
    });
    await page.evaluate(() => {
      window.__teamNavRemoved = 0;
      new MutationObserver(() => {
        if (!document.querySelector('nav[aria-label="Разделы командного пространства"]')) window.__teamNavRemoved += 1;
      }).observe(document.querySelector("header"), { childList: true, subtree: true });
    });
    await navigation.getByRole("link", { name: "Библиотека", exact: true }).click();
    await page.waitForURL(`**/workspace/teams/${team.id}/library`);
    await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__teamNavRemoved), 0, "TEAM_NAVIGATION_DISAPPEARED_DURING_SECTION_CHANGE");
    assert.equal(detailRequests.length, 0, "TEAM_DETAIL_REFETCHED_ON_SECTION_CHANGE");
  } finally {
    await context.close();
  }
});

test("team header keeps its navigation space while access loads after refresh", { timeout: 45_000 }, async () => {
  const auth = await account("steady_refresh");
  const team = await createTeamApi(auth, `Обновление ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews`, {
    viewport: { width: 1280, height: 800 },
  });
  const detailRequested = deferred();
  const releaseDetail = deferred();
  try {
    await page.route(`**/api/teams/${team.id}`, async (route) => {
      detailRequested.resolve();
      await releaseDetail.promise;
      await route.continue();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await detailRequested.promise;
    const switcher = page.getByRole("button", { name: /^Рабочее пространство:/ });
    await switcher.waitFor();
    const before = await switcher.boundingBox();
    assert.ok(before);
    assert.equal(await page.getByTestId("team-navigation-placeholder").count(), 1);

    releaseDetail.resolve();
    await page.getByRole("navigation", { name: "Разделы командного пространства" }).waitFor();
    const after = await switcher.boundingBox();
    assert.ok(after);
    assert.ok(Math.abs(before.x - after.x) <= 1, `WORKSPACE_SWITCHER_SHIFTED_AFTER_REFRESH:${before.x}->${after.x}`);
    assert.equal(await page.getByTestId("team-navigation-placeholder").count(), 0);
  } finally {
    releaseDetail.resolve();
    await context.close();
  }
});

test("team interview creation needs no set, candidate picker or self assignment", { timeout: 45_000 }, async () => {
  const auth = await account("flexible_interview");
  const externalCandidate = await account("link_candidate");
  const team = await createTeamApi(auth, `Интервью ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Создать интервью", exact: true }).count(), 1);
    assert.equal(await page.getByText("Кандидаты", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("checkbox", { name: auth.user.displayName, exact: true }).count(), 0);
    await page.getByLabel("Название интервью", { exact: true }).fill("Интервью без задач");
    const createRequest = page.waitForRequest((requestCandidate) =>
      new URL(requestCandidate.url()).pathname === `/api/teams/${team.id}/interviews` && requestCandidate.method() === "POST");
    const createResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/teams/${team.id}/interviews` && response.status() === 201);
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const sent = await createRequest;
    assert.equal(sent.postDataJSON().taskSetId ?? null, null);
    assert.deepEqual(sent.postDataJSON().taskIds ?? [], []);
    assert.deepEqual(sent.postDataJSON().candidateIds ?? [], []);
    await page.getByRole("region", { name: "Созданное командное интервью Интервью без задач" }).waitFor();
    const created = (await (await createResponse).json()).interview;
    assert.equal(created.taskSetId, null);
    assert.deepEqual(created.tasks, []);
    assert.ok(created.assignees.some((assignee) => assignee.userId === auth.user.id && assignee.role === "owner"));
    const candidateRoom = await openRoomAccount(externalCandidate, created.inviteCode);
    await candidateRoom.context.close();
  } finally {
    await context.close();
  }
});

test("team interview creation accepts an individual task without a set", { timeout: 45_000 }, async () => {
  const auth = await account("individual_interview_task");
  const team = await createTeamApi(auth, `Отдельная задача ${unique()}`);
  const task = await createTeamTask(auth, team, {
    title: `Задача ${unique()}`,
    description: "Условие отдельной задачи",
    starterCode: "// start",
  });
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByLabel("Название интервью", { exact: true }).fill("Интервью с отдельной задачей");
    await page.getByRole("textbox", { name: "Отдельные задачи (необязательно)" }).click();
    await page.getByRole("option", { name: new RegExp(task.title) }).click();
    const createRequest = page.waitForRequest((candidate) =>
      new URL(candidate.url()).pathname === `/api/teams/${team.id}/interviews` && candidate.method() === "POST");
    const createResponse = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === `/api/teams/${team.id}/interviews` && candidate.status() === 201);
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const [sent, response] = await Promise.all([createRequest, createResponse]);
    assert.deepEqual(sent.postDataJSON(), { title: "Интервью с отдельной задачей", taskIds: [task.id] });
    const created = (await response.json()).interview;
    assert.deepEqual(created.tasks.map((item) => item.title), [task.title]);
    assert.equal(created.taskSetId, null);
  } finally {
    await context.close();
  }
});

test("team interview does not auto-add itself to the personal hiring cabinet", { timeout: 45_000 }, async () => {
  const hiringOwner = await account("team_hiring_owner", true);
  const team = await createTeamApi(hiringOwner, `Команда нанимающего ${unique()}`);
  const interview = await createTeamInterview(hiringOwner, team, { title: "Командное интервью нанимающего" });
  let trackingPosts = 0;
  const room = await openRoomAccount(hiringOwner, interview.inviteCode, {
    onContext: (context) => context.route("**/hr-tracking", (route) => {
      trackingPosts += 1;
      return route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
    }),
  });
  try {
    await room.page.waitForTimeout(500);
    assert.equal(trackingPosts, 0, "TEAM_ROOM_SENT_PERSONAL_HR_TRACKING_REQUEST");
    assert.equal(await room.page.getByText("Не удалось добавить интервью в кабинет нанимающего").count(), 0);
    await room.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const panel = room.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await panel.getByText(hiringOwner.user.displayName, { exact: true }).waitFor();
    assert.equal(await panel.getByText("Нанимающие пока не добавлены", { exact: true }).count(), 0);
    assert.equal(await panel.getByLabel("ID нанимающего").count(), 0);
  } finally {
    await room.context.close();
  }
});

test("remediation: long Russian team header keeps every navigation section reachable at 768px and zoom equivalents", { timeout: 45_000 }, async () => {
  const auth = await account("team_header_long_name");
  const teamName = "Очень длинное русское название команды для проверки доступной навигации без второй строки";
  const team = await createTeamApi(auth, teamName);
  const { context, page } = await openAccount(
    auth,
    `/workspace/teams/${team.id}/interviews`,
    { viewport: { width: 768, height: 1024 } },
  );
  try {
    const expectedSections = ["Интервью", "Библиотека", "Треки и вакансии", "Участники", "Настройки команды"];
    const trigger = switcher(page);
    await page.getByRole("navigation", { name: "Разделы командного пространства", exact: true }).waitFor();
    assert.match(await trigger.getAttribute("aria-label"), new RegExp(teamName), "TEAM_HEADER_TRUNCATED_ACCESSIBLE_NAME");

    for (const zoom of [100, 125, 150, 200]) {
      const scale = zoom / 100;
      await page.setViewportSize({ width: Math.floor(768 / scale), height: Math.floor(1024 / scale) });
      await settleRender(page);
      const nav = page.getByRole("navigation", { name: "Разделы командного пространства", exact: true });
      const overflow = nav.getByRole("button", { name: "Меню разделов", exact: true });
      await overflow.waitFor();
      const rows = await nav.locator("a,button").evaluateAll((elements) => [...new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top)))]);
      assert.equal(rows.length, 1, `TEAM_HEADER_NAV_WRAPPED:${zoom}:${JSON.stringify(rows)}`);
      const geometry = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `TEAM_HEADER_PAGE_HORIZONTAL_OVERFLOW:${zoom}:${JSON.stringify(geometry)}`);

      const label = trigger.locator("[data-workspace-switcher-label]");
      assert.equal(await label.count(), 1, `TEAM_HEADER_SWITCHER_LABEL_MISSING:${zoom}`);
      const labelState = await label.evaluate((element) => {
        const style = getComputedStyle(element);
        return { overflow: style.overflow, textOverflow: style.textOverflow, clipped: element.scrollWidth > element.clientWidth };
      });
      assert.deepEqual(labelState, { overflow: "hidden", textOverflow: "ellipsis", clipped: true }, `TEAM_HEADER_LONG_LABEL_NOT_TRUNCATED:${zoom}:${JSON.stringify(labelState)}`);

      await overflow.click();
      const menu = page.locator('[role="menu"][aria-label="Дополнительные разделы"]');
      await menu.waitFor({ state: "visible" });
      const direct = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.textContent?.trim()));
      const indirect = await menu.getByRole("menuitem").evaluateAll((items) => items.map((item) => item.textContent?.trim()));
      assert.deepEqual([...direct, ...indirect].sort(), expectedSections.sort(), `TEAM_HEADER_NAVIGATION_UNREACHABLE:${zoom}`);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
    }
  } finally {
    await context.close();
  }
});

test("P1.2: team tracks surface creates a track and vacancy instead of showing staged placeholder", { timeout: 45_000 }, async () => {
  const auth = await account("team_tracks");
  const team = await createTeamApi(auth, `Команда треков ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/tracks`);
  try {
    await page.getByRole("heading", { name: "Треки и вакансии", exact: true }).waitFor();
    const trackTabBox = await page.getByRole("tab", { name: "Активные", exact: true }).boundingBox();
    const trackSearchBox = await page.getByLabel("Поиск треков и вакансий", { exact: true }).boundingBox();
    assert.ok(trackTabBox && trackSearchBox && Math.abs(trackTabBox.y - trackSearchBox.y) < 20, "TRACK_SEARCH_NOT_ALIGNED_WITH_TABS");
    assert.equal(await page.getByText("Раздел готовится", { exact: true }).count(), 0, "TEAM_TRACKS_STAGED_PLACEHOLDER_VISIBLE");
    await page.getByText("Треков пока нет", { exact: true }).waitFor();

    const createTrackResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/tracks`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Создать трек", exact: true }).click();
    const trackDialog = page.getByRole("dialog", { name: "Новый трек", exact: true });
    await trackDialog.getByLabel("Название трека", { exact: true }).fill("Backend");
    await trackDialog.getByRole("button", { name: "Создать трек", exact: true }).click();
    await createTrackResponse;

    const trackCard = page.getByRole("region", { name: "Трек Backend", exact: true });
    await trackCard.waitFor();
    await trackCard.getByText("В этом треке пока нет вакансий", { exact: true }).waitFor();

    const createVacancyResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.url().endsWith("/vacancies") &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Создать вакансию", exact: true }).click();
    const vacancyDialog = page.getByRole("dialog", { name: "Новая вакансия", exact: true });
    await vacancyDialog.getByLabel("Трек вакансии", { exact: true }).click();
    await page.getByRole("option", { name: "Backend", exact: true }).click();
    await vacancyDialog.getByLabel("Название вакансии", { exact: true }).fill("Kotlin разработчик");
    await vacancyDialog.getByRole("button", { name: "Создать вакансию", exact: true }).click();
    await createVacancyResponse;

    await trackCard.getByText("Kotlin разработчик", { exact: true }).waitFor();
    assert.equal(await trackCard.getByText("В этом треке пока нет вакансий", { exact: true }).count(), 0, "TEAM_TRACKS_VACANCY_EMPTY_STATE_STUCK");
    await trackCard.getByText("Вакансии трека", { exact: true }).waitFor();
    await trackCard.getByText("Вакансия · активна", { exact: true }).waitFor();
    const deleteVacancyResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      /\/vacancies\/[^/]+$/.test(response.url()) &&
      response.request().method() === "DELETE" && response.status() === 204);
    await trackCard.getByRole("button", { name: "Удалить вакансию Kotlin разработчик", exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить вакансию Kotlin разработчик?" }).getByRole("button", { name: "Удалить", exact: true }).click();
    await deleteVacancyResponse;
    await trackCard.getByText("В этом треке пока нет вакансий", { exact: true }).waitFor();
    const deleteTrackResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) && response.request().method() === "DELETE" && response.status() === 204);
    await trackCard.getByRole("button", { name: "Удалить трек Backend", exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить трек Backend?" }).getByRole("button", { name: "Удалить", exact: true }).click();
    await deleteTrackResponse;
    await page.getByText("Треков пока нет", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("team library can permanently delete an unused set and task", { timeout: 45_000 }, async () => {
  const auth = await account("library_delete");
  const team = await createTeamApi(auth, `Команда удаления ${unique()}`);
  const task = await createTeamTask(auth, team, { title: "Disposable task", description: "", starterCode: "" });
  const set = await createTeamTaskSet(auth, team, { name: "Disposable set", taskIds: [task.id] });
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/library`);
  try {
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const setCard = page.getByRole("region", { name: "Командный набор Disposable set" });
    await setCard.getByRole("button", { name: "Удалить набор Disposable set" }).click();
    const deletedSet = page.waitForResponse((response) => response.url().endsWith(`/api/teams/${team.id}/task-sets/${set.id}`) && response.request().method() === "DELETE" && response.status() === 204);
    await page.getByRole("dialog", { name: "Удалить набор Disposable set?" }).getByRole("button", { name: "Удалить", exact: true }).click();
    await deletedSet;
    await setCard.waitFor({ state: "detached" });
    await page.getByRole("tab", { name: "Задачи", exact: true }).click();
    const taskCard = page.getByRole("region", { name: "Командная задача Disposable task" });
    await taskCard.getByRole("button", { name: "Удалить задачу Disposable task" }).click();
    const deletedTask = page.waitForResponse((response) => response.url().endsWith(`/api/teams/${team.id}/tasks/${task.id}`) && response.request().method() === "DELETE" && response.status() === 204);
    await page.getByRole("dialog", { name: "Удалить задачу Disposable task?" }).getByRole("button", { name: "Удалить", exact: true }).click();
    await deletedTask;
    await taskCard.waitFor({ state: "detached" });
  } finally {
    await context.close();
  }
});

test("room return goes to the interview list of its team", { timeout: 45_000 }, async () => {
  const auth = await account("team_room_return");
  const team = await createTeamApi(auth, `Команда возврата ${unique()}`);
  const task = await createTeamTask(auth, team, { title: "Return task", description: "Brief", starterCode: "// start" });
  const taskSet = await createTeamTaskSet(auth, team, { name: "Return set", taskIds: [task.id] });
  const interview = await createTeamInterview(auth, team, { title: "Return interview", taskSetId: taskSet.id });
  const { context, page } = await openRoomAccount(auth, interview.inviteCode);
  try {
    const returnLink = page.getByRole("link", { name: "Вернуться к списку интервью", exact: true });
    await returnLink.waitFor();
    assert.equal(await returnLink.getAttribute("href"), `/workspace/teams/${team.id}/interviews`);
    await returnLink.click();
    await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
  } finally {
    await context.close();
  }
});

test("P1.2: team track managers rename archive and restore tracks and vacancies from the team surface", { timeout: 60_000 }, async () => {
  const auth = await account("team_tracks_manage");
  const team = await createTeamApi(auth, `Команда управления треками ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/tracks`);
  try {
    await page.getByRole("heading", { name: "Треки и вакансии", exact: true }).waitFor();

    await page.getByRole("button", { name: "Создать трек", exact: true }).click();
    const trackDialog = page.getByRole("dialog", { name: "Новый трек", exact: true });
    await trackDialog.getByLabel("Название трека", { exact: true }).fill("Backend");
    await trackDialog.getByRole("button", { name: "Создать трек", exact: true }).click();
    let trackCard = page.getByRole("region", { name: "Трек Backend", exact: true });
    await trackCard.waitFor();
    await page.getByRole("button", { name: "Создать вакансию", exact: true }).click();
    const vacancyDialog = page.getByRole("dialog", { name: "Новая вакансия", exact: true });
    await vacancyDialog.getByLabel("Трек вакансии", { exact: true }).click();
    await page.getByRole("option", { name: "Backend", exact: true }).click();
    await vacancyDialog.getByLabel("Название вакансии", { exact: true }).fill("Kotlin разработчик");
    await vacancyDialog.getByRole("button", { name: "Создать вакансию", exact: true }).click();
    await trackCard.getByText("Kotlin разработчик", { exact: true }).waitFor();

    const trackRenameResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.request().method() === "PATCH" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Переименовать трек Backend", exact: true }).click();
    await trackCard.getByLabel("Новое название трека", { exact: true }).fill("Platform");
    await trackCard.getByRole("button", { name: "Сохранить трек", exact: true }).click();
    await trackRenameResponse;
    trackCard = page.getByRole("region", { name: "Трек Platform", exact: true });
    await trackCard.waitFor();

    const vacancyRenameResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.url().includes("/vacancies/") &&
      response.request().method() === "PATCH" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Переименовать вакансию Kotlin разработчик", exact: true }).click();
    await trackCard.getByLabel("Новое название вакансии", { exact: true }).fill("Platform Engineer");
    await trackCard.getByRole("button", { name: "Сохранить вакансию", exact: true }).click();
    await vacancyRenameResponse;
    await trackCard.getByText("Platform Engineer", { exact: true }).waitFor();

    const archiveVacancyResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.url().endsWith("/archive") &&
      response.url().includes("/vacancies/") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Архивировать вакансию Platform Engineer", exact: true }).click();
    await archiveVacancyResponse;
    await trackCard.getByText("В этом треке пока нет вакансий", { exact: true }).waitFor();

    await page.getByRole("tab", { name: "Архив", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "Трек Platform", exact: true }).count(), 0);
    const archivedVacancy = page.getByRole("region", { name: "Архивная вакансия Platform Engineer", exact: true });
    await archivedVacancy.waitFor();
    await archivedVacancy.getByText("Трек: Platform", { exact: true }).waitFor();
    const restoreVacancyResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.url().endsWith("/restore") &&
      response.url().includes("/vacancies/") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await archivedVacancy.getByRole("button", { name: "Восстановить вакансию Platform Engineer", exact: true }).click();
    await restoreVacancyResponse;

    await page.getByRole("tab", { name: "Активные", exact: true }).click();
    trackCard = page.getByRole("region", { name: "Трек Platform", exact: true });
    await trackCard.getByText("Platform Engineer", { exact: true }).waitFor();

    const archiveTrackResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.url().endsWith("/archive") &&
      !response.url().includes("/vacancies/") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Архивировать трек Platform", exact: true }).click();
    await archiveTrackResponse;
    await page.getByText("Треков пока нет", { exact: true }).waitFor();

    await page.getByRole("tab", { name: "Архив", exact: true }).click();
    trackCard = page.getByRole("region", { name: "Архивный трек Platform", exact: true });
    await trackCard.waitFor();
    const restoreTrackResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/`) &&
      response.url().endsWith("/restore") &&
      !response.url().includes("/vacancies/") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Восстановить трек Platform", exact: true }).click();
    await restoreTrackResponse;
    await page.getByRole("tab", { name: "Активные", exact: true }).click();
    await page.getByRole("region", { name: "Трек Platform", exact: true }).waitFor();

    await page.getByLabel("Поиск треков и вакансий", { exact: true }).fill("Engineer");
    await page.getByRole("region", { name: "Трек Platform", exact: true }).waitFor();
    await page.getByLabel("Поиск треков и вакансий", { exact: true }).fill("Golang");
    await page.getByText("Ничего не найдено", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P5.1: interview list has no duplicate process panel while member directory keeps process views", { timeout: 60_000 }, async () => {
  const owner = await account("process_ui_owner");
  const assigned = await account("process_ui_assigned");
  const team = await createTeamApi(owner, `Процессы ${unique()}`);
  await addTeamMemberViaInvitation(owner, team, assigned);
  const task = await createTeamTask(owner, team, { title: "Process task", description: "Brief", starterCode: "// task" });
  const set = await createTeamTaskSet(owner, team, { name: "Process set", taskIds: [task.id] });
  const track = await createTeamTrack(owner, team, { name: "Backend" });
  const vacancy = await createTeamVacancy(owner, team, track, { title: "Kotlin engineer" });
  await createTeamInterview(owner, team, {
    title: "Visible process interview", taskSetId: set.id, trackId: track.id, vacancyId: vacancy.id,
    interviewerIds: [assigned.user.id], candidateIds: [],
  });
  await createTeamInterview(owner, team, {
    title: "Private process interview", taskSetId: set.id, trackId: track.id, vacancyId: vacancy.id,
    interviewerIds: [owner.user.id], candidateIds: [],
  });

  const memberView = await openAccount(assigned, `/workspace/teams/${team.id}/interviews`);
  try {
    const interviews = memberView.page.getByRole("list", { name: "Командные интервью", exact: true });
    await interviews.getByRole("region", { name: "Командное интервью Visible process interview", exact: true }).waitFor();
    await interviews.getByRole("region", { name: "Командное интервью Private process interview", exact: true }).waitFor();
    assert.equal(await memberView.page.getByRole("region", { name: "Мои процессы", exact: true }).count(), 0);
    assert.equal(await memberView.page.getByRole("region", { name: "Командное интервью Visible process interview", exact: true }).count(), 1);
  } finally {
    await memberView.context.close();
  }

  const directoryView = await openAccount(owner, `/workspace/teams/${team.id}/members`);
  try {
    const label = directoryView.page.getByLabel(`Процессы участника ${assigned.user.displayName}`, { exact: true });
    await label.getByText("Backend · Kotlin engineer", { exact: true }).waitFor();
    assert.equal(await label.getByText("Visible process interview", { exact: true }).count(), 0);
  } finally {
    await directoryView.context.close();
  }
});

test("team interviews switch shows all by default and only interviews created by the viewer when enabled", { timeout: 60_000 }, async () => {
  const owner = await account("mine_filter_owner");
  const member = await account("mine_filter_member");
  const team = await createTeamApi(owner, `Фильтр интервью ${unique()}`);
  await addTeamMemberViaInvitation(owner, team, member);
  await createTeamInterview(owner, team, { title: "Интервью владельца" });
  await createTeamInterview(member, team, { title: "Интервью участника" });

  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/interviews`);
  try {
    const interviews = page.getByRole("list", { name: "Командные интервью", exact: true });
    const ownerCard = interviews.getByRole("region", { name: "Командное интервью Интервью владельца", exact: true });
    const memberCard = interviews.getByRole("region", { name: "Командное интервью Интервью участника", exact: true });
    await ownerCard.waitFor();
    await memberCard.waitFor();
    const mineSwitch = page.getByRole("switch", { name: "Мои интервью", exact: true });
    assert.equal(await mineSwitch.isChecked(), false);
    await mineSwitch.check();
    await ownerCard.waitFor();
    await memberCard.waitFor({ state: "hidden" });
    await page.getByLabel("Поиск интервью", { exact: true }).fill("участника");
    await page.getByText("Интервью по этому поиску не найдены", { exact: true }).waitFor();
    await page.getByLabel("Поиск интервью", { exact: true }).fill("");
    await ownerCard.waitFor();
    await mineSwitch.uncheck();
    await memberCard.waitFor();
    assert.equal(await ownerCard.count(), 1);
    assert.equal(await memberCard.count(), 1);
  } finally {
    await context.close();
  }
});

test("P6: invitation, programme, interview, result and export work as one journey", { timeout: 120_000 }, async () => {
  const sourceOwner = await account("p6_source", true);
  const invited = await account("p6_invited");
  const source = await createTeamApi(sourceOwner, `P6 source ${unique()}`);
  await addTeamMemberViaInvitation(sourceOwner, source, invited);

  const task = await createTeamTask(sourceOwner, source, {
    title: "P6 Kotlin task", description: "Synthetic interview task", starterCode: "// start", language: "kotlin",
  });
  const taskSet = await createTeamTaskSet(sourceOwner, source, { name: "P6 task set", taskIds: [task.id] });
  const track = await createTeamTrack(sourceOwner, source, { name: "P6 backend" });
  const vacancy = await createTeamVacancy(sourceOwner, source, track, { title: "P6 engineer" });
  const draft = await saveVacancyProgrammeDraft(sourceOwner, source, track, vacancy, { taskIds: [task.id] });
  const programme = await publishVacancyProgramme(sourceOwner, source, track, vacancy, { revision: draft.revision });
  const interview = await createTeamInterview(sourceOwner, source, {
    title: "P6 synthetic interview",
    taskSetId: taskSet.id,
    trackId: track.id,
    vacancyId: vacancy.id,
    programmeId: programme.id,
    programmeVersion: programme.version,
    interviewerIds: [sourceOwner.user.id],
    candidateIds: [],
  });
  assert.equal(interview.programmeId, programme.id);
  const roomView = await openAccount(sourceOwner, `/room/${interview.inviteCode}`);
  try {
    await roomView.page.getByText("P6 synthetic interview", { exact: true }).first().waitFor();
  } finally {
    await roomView.context.close();
  }

  await request(`/rooms/${interview.inviteCode}/verdict`, {
    token: sourceOwner.token,
    method: "POST",
    body: { verdict: "HIRE", verdictComment: "Synthetic P6 result" },
  });
  const workbook = await rawRequest("/me/hr/rooms/export", { token: sourceOwner.token });
  assert.equal(workbook.status, 200);
  assert.match(workbook.headers.get("content-type") || "", /spreadsheetml/);
  assert.ok((await workbook.arrayBuffer()).byteLength > 0);

  assert.equal((await rawRequest(`/rooms/${interview.inviteCode}`, { token: sourceOwner.token })).status, 200);
});

test("P4.1: team tracks show programme origin version and mandatory steps", { timeout: 45_000 }, async () => {
  const auth = await account("team_programmes_ui");
  const team = await createTeamApi(auth, `Команда программ ${unique()}`);
  const baseTask = await createTeamTask(auth, team, {
    title: "Base systems",
    description: "Base programme task",
    starterCode: "// base",
    language: "kotlin",
  });
  const vacancyTask = await createTeamTask(auth, team, {
    title: "Vacancy focus",
    description: "Vacancy programme task",
    starterCode: "// vacancy",
    language: "nodejs",
  });
  const track = await createTeamTrack(auth, team, { name: "Backend" });
  const vacancy = await createTeamVacancy(auth, team, track, { title: "Kotlin разработчик" });
  const draft = await saveTrackProgrammeDraft(auth, team, track, { taskIds: [baseTask.id] });
  assert.equal(draft.revision, 0);
  await publishTrackProgramme(auth, team, track, { revision: draft.revision });

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/tracks`);
  try {
    const trackCard = page.getByRole("region", { name: "Трек Backend", exact: true });
    await trackCard.waitFor();
    await trackCard.getByText("Задачи трека · версия 1 · обязательные", { exact: true }).first().waitFor();
    await trackCard.getByText("Base systems", { exact: true }).first().waitFor();
    await trackCard.getByText("из трека", { exact: true }).waitFor();

    const vacancyDraft = await saveVacancyProgrammeDraft(auth, team, track, vacancy, { taskIds: [vacancyTask.id] });
    assert.equal(vacancyDraft.revision, 0);
    await publishVacancyProgramme(auth, team, track, vacancy, { revision: vacancyDraft.revision });
    await page.getByRole("button", { name: "Обновить", exact: true }).click();

    await trackCard.getByText("Задачи вакансии · версия 1 · обязательные", { exact: true }).waitFor();
    await trackCard.getByText("Vacancy focus", { exact: true }).waitFor();
    assert.equal(await trackCard.getByText("из трека", { exact: true }).count(), 0, "VACANCY_PROGRAMME_INHERITANCE_BADGE_STUCK");
  } finally {
    await context.close();
  }
});

test("P4.2: interview creation keeps the draft when its programme version changes", { timeout: 75_000 }, async () => {
  const auth = await account("team_programme_create");
  const team = await createTeamApi(auth, `Команда программы интервью ${unique()}`);
  const foundation = await createTeamTask(auth, team, { title: "Foundation", description: "Base", starterCode: "// base" });
  const nextFoundation = await createTeamTask(auth, team, { title: "Updated foundation", description: "Updated", starterCode: "// updated" });
  const extra = await createTeamTask(auth, team, { title: "Extra", description: "Extra", starterCode: "// extra" });
  const set = await createTeamTaskSet(auth, team, { name: "Extras", taskIds: [extra.id] });
  const track = await createTeamTrack(auth, team, { name: "Platform" });
  const vacancy = await createTeamVacancy(auth, team, track, { title: "Developer" });
  const draft = await saveVacancyProgrammeDraft(auth, team, track, vacancy, { taskIds: [foundation.id] });
  const programme = await publishVacancyProgramme(auth, team, track, vacancy, { revision: draft.revision });

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
    await page.getByLabel("Название интервью", { exact: true }).fill("Interview with programme");
    await page.getByLabel("Трек интервью", { exact: true }).selectOption(track.id);
    await page.getByLabel("Вакансия", { exact: true }).selectOption(vacancy.id);
    await page.getByLabel("Командный набор задач", { exact: true }).selectOption(set.id);
    const preview = page.getByRole("region", { name: "Задачи по умолчанию для интервью", exact: true });
    await preview.getByText("Задачи вакансии · версия 1", { exact: true }).waitFor();
    await preview.getByText("Foundation", { exact: true }).waitFor();

    const changed = await saveVacancyProgrammeDraft(auth, team, track, vacancy, {
      taskIds: [nextFoundation.id], revision: programme.revision,
    });
    await publishVacancyProgramme(auth, team, track, vacancy, { revision: changed.revision });

    const staleResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/interviews`) && response.status() === 409);
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    assert.equal((await (await staleResponse).json()).code, "TEAM_PROGRAMME_VERSION_CONFLICT");
    await page.getByRole("alert").filter({ hasText: "Задачи трека или вакансии изменились. Проверьте новую версию перед созданием интервью." }).waitFor();
    assert.equal(await page.getByLabel("Название интервью", { exact: true }).inputValue(), "Interview with programme");

    await page.getByRole("button", { name: "Проверить обновлённые задачи", exact: true }).click();
    await preview.getByText("Задачи вакансии · версия 2", { exact: true }).waitFor();
    await preview.getByText("Updated foundation", { exact: true }).waitFor();
    const createResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/interviews`) && response.status() === 201);
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const created = (await (await createResponse).json()).interview;
    assert.equal(created.programmeId, programme.id);
    assert.equal(created.programmeVersion, 2);
    assert.deepEqual(created.tasks.map((task) => [task.title, task.mandatory]), [
      ["Updated foundation", true], ["Extra", false],
    ]);
    const result = page.getByRole("region", { name: "Созданное командное интервью Interview with programme", exact: true });
    await result.getByText("Обязательная основа: Updated foundation", { exact: true }).waitFor();

    const room = await openRoomAccount(auth, created.inviteCode);
    try {
      await room.page.getByRole("tab", { name: "Шаги", exact: true }).click();
      await room.page.getByText("Обязательная", { exact: true }).first().waitFor();
      assert.equal(await room.page.getByTestId("room-task-actions-0").count(), 0);
      assert.equal(await room.page.getByTestId("room-task-actions-1").count(), 1);
      await room.page.getByRole("tab", { name: "Условие", exact: true }).click();
      assert.equal(await room.page.getByRole("button", { name: "Жирный текст", exact: true }).count(), 0);
    } finally {
      await room.context.close();
    }
  } finally {
    await context.close();
  }
});

test("P4.1: team track managers draft publish archive and restore programmes from the team surface", { timeout: 60_000 }, async () => {
  const auth = await account("team_programmes_manage");
  const team = await createTeamApi(auth, `Команда управления программами ${unique()}`);
  await createTeamTask(auth, team, {
    title: "Graph warmup",
    description: "Graph programme task",
    starterCode: "// graph",
    language: "kotlin",
  });
  await createTeamTask(auth, team, {
    title: "Queue deep dive",
    description: "Queue programme task",
    starterCode: "// queue",
    language: "nodejs",
  });
  await createTeamTask(auth, team, {
    title: "Vacancy focus",
    description: "Vacancy programme task",
    starterCode: "// vacancy",
    language: "nodejs",
  });
  const track = await createTeamTrack(auth, team, { name: "Backend" });
  await createTeamVacancy(auth, team, track, { title: "Kotlin разработчик" });

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/tracks`);
  try {
    const trackCard = page.getByRole("region", { name: "Трек Backend", exact: true });
    await trackCard.waitFor();

    await trackCard.getByRole("button", { name: "Настроить задачи трека Backend", exact: true }).click();
    await trackCard.getByLabel("Задача для интервью: Graph warmup", { exact: true }).check();
    await trackCard.getByLabel("Задача для интервью: Queue deep dive", { exact: true }).check();
    const saveTrackDraft = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/tracks/${track.id}/programme/draft`) &&
      response.request().method() === "PATCH" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Сохранить задачи", exact: true }).click();
    await saveTrackDraft;
    await trackCard.getByText("Задачи трека · версия 0 · обязательные", { exact: true }).first().waitFor();

    const publishTrackProgrammeResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/tracks/${track.id}/programme/publish`) &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Применить задачи трека Backend", exact: true }).click();
    await publishTrackProgrammeResponse;
    await trackCard.getByText("Задачи трека · версия 1 · обязательные", { exact: true }).first().waitFor();

    const archiveTrackProgrammeResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/tracks/${track.id}/programme/archive`) &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Архивировать задачи трека Backend", exact: true }).click();
    await archiveTrackProgrammeResponse;
    await trackCard.getByText("В архиве", { exact: true }).first().waitFor();

    const restoreTrackProgrammeResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/tracks/${track.id}/programme/restore`) &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Восстановить задачи трека Backend", exact: true }).click();
    await restoreTrackProgrammeResponse;
    await trackCard.getByText("Применены", { exact: true }).first().waitFor();

    await trackCard.getByRole("button", { name: "Настроить задачи вакансии Kotlin разработчик", exact: true }).click();
    await trackCard.getByLabel("Задача для интервью: Vacancy focus", { exact: true }).check();
    const saveVacancyDraft = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/${track.id}/vacancies/`) &&
      response.url().endsWith("/programme/draft") &&
      response.request().method() === "PATCH" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Сохранить задачи", exact: true }).click();
    await saveVacancyDraft;
    await trackCard.getByText("Задачи вакансии · версия 0 · обязательные", { exact: true }).waitFor();

    const publishVacancyProgrammeResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tracks/${track.id}/vacancies/`) &&
      response.url().endsWith("/programme/publish") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await trackCard.getByRole("button", { name: "Применить задачи вакансии Kotlin разработчик", exact: true }).click();
    await publishVacancyProgrammeResponse;
    await trackCard.getByText("Задачи вакансии · версия 1 · обязательные", { exact: true }).waitFor();
    await trackCard.getByText("Vacancy focus", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P0.1: issued link appears immediately, reissues, copies and revokes", { timeout: 45_000 }, async () => {
  const auth = await account("team_link_visible");
  const team = await createTeamApi(auth, `Команда приглашений ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/members`);
  try {
    await page.getByRole("heading", { name: "Приглашения", exact: true }).waitFor();
    await page.getByRole("button", { name: "Выпустить ссылку", exact: true }).click();
    const field = page.getByLabel("Ссылка для приглашения", { exact: true });
    await field.waitFor();
    const invitationCard = page.getByRole("article", { name: /Приглашение / }).first();
    const copyWidth = await page.getByRole("button", { name: "Копировать ссылку", exact: true }).boundingBox();
    const cardWidth = await invitationCard.boundingBox();
    assert.ok(copyWidth && cardWidth && copyWidth.width < cardWidth.width * 0.65, "INVITATION_COPY_BUTTON_STRETCHED");
    const first = await field.inputValue();
    assert.equal(new URL(first).origin, new URL(web).origin);
    assert.equal(new URL(first).pathname, "/join/team");
    assert.match(new URL(first).hash, /^#token=/);
    assert.equal(await page.getByRole("button", { name: "Показать ссылку", exact: true }).count(), 0);

    await page.getByRole("button", { name: "Перевыпустить ссылку", exact: true }).first().click();
    await page.waitForFunction((previous) => {
      return [...document.querySelectorAll("input")].some((field) =>
        field.value.includes("/join/team#token=") && field.value !== previous);
    }, first);
    const second = await field.inputValue();
    assert.notEqual(second, first);
    await page.reload({ waitUntil: "domcontentloaded" });
    await field.waitFor();
    assert.equal(await field.inputValue(), second);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Копировать ссылку", exact: true }).click();
    await page.getByRole("status").getByText("Ссылка скопирована", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), second);
    await page.getByRole("button", { name: "Отозвать приглашение", exact: true }).click();
    await field.waitFor({ state: "detached" });
  } finally {
    await context.close();
  }
});

test("P0.1: lost issue response recovers the same visible link", { timeout: 45_000 }, async () => {
  const auth = await account("team_link_recover");
  const team = await createTeamApi(auth, `Команда восстановления ${unique()}`);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/members`);
  try {
    let intercepted = false;
    await page.route(`**/api/teams/${team.id}/invitations`, async (route) => {
      if (route.request().method() !== "POST" || intercepted) return route.continue();
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    });
    await page.getByRole("heading", { name: "Приглашения", exact: true }).waitFor();
    await page.getByRole("button", { name: "Выпустить ссылку", exact: true }).click();
    const field = page.getByLabel("Ссылка для приглашения", { exact: true });
    await field.waitFor();
    const url = await field.inputValue();
    assert.equal(new URL(url).origin, new URL(web).origin);
    assert.equal(intercepted, true);
    const list = await request(`/teams/${team.id}/invitations`, { token: auth.token });
    assert.equal(list.items.filter((item) => item.state === "PENDING").length, 1);
  } finally {
    await context.close();
  }
});

test("P1.3: team library creates a real team task instead of showing staged placeholder", { timeout: 60_000 }, async () => {
  const auth = await account("team_library");
  const team = await createTeamApi(auth, `Команда библиотеки ${unique()}`);
  const personalTask = await request("/me/tasks", {
    token: auth.token,
    method: "POST",
    body: {
      title: "Personal-only task",
      description: "Personal description",
      starterCode: "// personal",
      language: "nodejs",
    },
  });
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/library`);
  try {
    await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
    const activeTab = page.getByRole("tab", { name: "Задачи", exact: true });
    const searchField = page.getByLabel("Поиск задач", { exact: true });
    const tabBox = await activeTab.boundingBox();
    const searchBox = await searchField.boundingBox();
    assert.ok(tabBox && searchBox && Math.abs(tabBox.y - searchBox.y) < 20, "TEAM_LIBRARY_SEARCH_NOT_ALIGNED_WITH_TABS");
    const activeColor = await activeTab.evaluate((node) => getComputedStyle(node).backgroundColor);
    await activeTab.hover();
    const hoverColor = await activeTab.evaluate((node) => getComputedStyle(node).backgroundColor);
    assert.notEqual(hoverColor, activeColor, "TEAM_LIBRARY_ACTIVE_TAB_HOVER_UNCHANGED");
    assert.equal(await page.getByText("Раздел готовится", { exact: true }).count(), 0, "TEAM_LIBRARY_STAGED_PLACEHOLDER_VISIBLE");
    await page.getByText("В библиотеке команды пока нет задач", { exact: true }).waitFor();

    const createResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/tasks`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Создать задачу", exact: true }).click();
    const createTaskDialog = page.getByRole("dialog", { name: "Новая командная задача", exact: true });
    await createTaskDialog.getByLabel("Название задачи", { exact: true }).fill("Binary tree traversal");
    await createTaskDialog.getByLabel("Описание задачи", { exact: true }).fill("Check recursion and queues");
    await createTaskDialog.getByLabel("Стартовый код", { exact: true }).fill("// TODO");
    await createTaskDialog.getByRole("button", { name: "Создать задачу", exact: true }).click();
    await createResponse;

    const taskCard = page.getByRole("region", { name: "Командная задача Binary tree traversal", exact: true });
    await taskCard.waitFor();
    await taskCard.getByText("Check recursion and queues", { exact: true }).waitFor();
    assert.equal(await page.getByText("В библиотеке команды пока нет задач", { exact: true }).count(), 0, "TEAM_LIBRARY_EMPTY_STATE_STUCK");

    const updateResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tasks/`) &&
      response.request().method() === "PATCH" &&
      response.status() === 200);
    await taskCard.getByRole("button", { name: "Переименовать задачу Binary tree traversal", exact: true }).click();
    await taskCard.getByLabel("Новое название задачи", { exact: true }).fill("Graph traversal");
    await taskCard.getByLabel("Новое описание задачи", { exact: true }).fill("Check graph queues");
    await taskCard.getByRole("button", { name: "Сохранить задачу", exact: true }).click();
    await updateResponse;
    const renamedTaskCard = page.getByRole("region", { name: "Командная задача Graph traversal", exact: true });
    await renamedTaskCard.waitFor();

    const archiveResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tasks/`) &&
      response.url().endsWith("/archive") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await renamedTaskCard.getByRole("button", { name: "Архивировать задачу Graph traversal", exact: true }).click();
    await archiveResponse;
    await page.getByText("В библиотеке команды пока нет задач", { exact: true }).waitFor();

    await page.getByRole("tab", { name: "Архив", exact: true }).click();
    const archivedTaskCard = page.getByRole("region", { name: "Командная задача Graph traversal", exact: true });
    await archivedTaskCard.waitFor();
    assert.equal(await archivedTaskCard.getByRole("button", { name: /Скопировать задачу/ }).count(), 0);
    const restoreResponse = page.waitForResponse((response) =>
      response.url().includes(`/teams/${team.id}/tasks/`) &&
      response.url().endsWith("/restore") &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await archivedTaskCard.getByRole("button", { name: "Восстановить задачу Graph traversal", exact: true }).click();
    await restoreResponse;
    await page.getByRole("tab", { name: "Активные", exact: true }).click();
    await renamedTaskCard.waitFor();

    const importResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/tasks/import-personal`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const importTaskDialog = page.getByRole("dialog", { name: "Импортировать задачу", exact: true });
    await importTaskDialog.getByLabel("Данные задачи или ID личной задачи", { exact: true }).fill(personalTask.id);
    await importTaskDialog.getByRole("button", { name: "Импортировать задачу", exact: true }).click();
    await importResponse;
    await page.getByRole("region", { name: "Командная задача Personal-only task", exact: true }).waitFor();

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await renamedTaskCard.getByRole("button", { name: "Скопировать задачу Graph traversal", exact: true }).click();
    const copiedTask = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copiedTask, /Graph traversal/);
    assert.equal(JSON.parse(copiedTask).task.starterCode, "// TODO");
    assert.equal(await page.getByRole("region", { name: "Командная задача Graph traversal (копия)", exact: true }).count(), 0);
    await renamedTaskCard.waitFor();

    await page.getByLabel("Поиск задач", { exact: true }).fill("queues");
    await renamedTaskCard.waitFor();
    await page.getByLabel("Поиск задач", { exact: true }).fill("golang");
    await page.getByText("Ничего не найдено", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.4: team library copies sets to clipboard, archives and restores them", { timeout: 60_000 }, async () => {
  const auth = await account("team_sets");
  const team = await createTeamApi(auth, `Команда наборов ${unique()}`);
  const firstTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Graph warmup",
      description: "Graph task",
      starterCode: "// graph",
      language: "kotlin",
    },
  });
  const secondTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Queue warmup",
      description: "Queue task",
      starterCode: "// queue",
      language: "nodejs",
    },
  });
  assert.ok(firstTask.task.id);
  assert.ok(secondTask.task.id);
  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/library`);
  try {
    await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await page.getByText("Наборов пока нет", { exact: true }).waitFor();

    const setName = `Backend screening ${unique()}`;
    const createSetResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/task-sets`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Создать набор", exact: true }).click();
    const createSetDialog = page.getByRole("dialog", { name: "Новый командный набор", exact: true });
    await createSetDialog.getByLabel("Название набора", { exact: true }).fill(setName);
    await createSetDialog.getByLabel("Graph warmup", { exact: true }).check();
    await createSetDialog.getByLabel("Queue warmup", { exact: true }).check();
    await createSetDialog.getByRole("button", { name: "Создать набор", exact: true }).click();
    const createdSet = (await (await createSetResponse).json()).taskSet;

    const setCard = page.getByRole("region", { name: `Командный набор ${setName}`, exact: true });
    await setCard.waitFor();
    await setCard.getByText("Graph warmup → Queue warmup", { exact: true }).waitFor();
    await setCard.getByText(/· v0$/).waitFor();

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await setCard.getByRole("button", { name: `Скопировать набор ${setName}`, exact: true }).click();
    await page.waitForFunction(async () => (await navigator.clipboard.readText()).includes('"kind": "task-set"'));
    const copiedSet = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copiedSet, /Graph warmup/);
    assert.match(copiedSet, /Queue warmup/);
    assert.equal(await page.getByRole("region", { name: `Командный набор ${setName} (копия)`, exact: true }).count(), 0);

    const archiveSetResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/task-sets/${createdSet.id}/archive`) &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await setCard.getByRole("button", { name: `Архивировать набор ${setName}`, exact: true }).click();
    await archiveSetResponse;
    await setCard.waitFor({ state: "detached" });

    await page.getByRole("tab", { name: "Архив", exact: true }).click();
    const archivedCard = page.getByRole("region", { name: `Командный набор ${setName}`, exact: true });
    await archivedCard.waitFor();
    assert.equal(await archivedCard.getByRole("button", { name: /Скопировать набор/ }).count(), 0);
    await archivedCard.getByText(/· v1$/).waitFor();
    const restoreSetResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/task-sets/${createdSet.id}/restore`) &&
      response.request().method() === "POST" &&
      response.status() === 200);
    await archivedCard.getByRole("button", { name: `Восстановить набор ${setName}`, exact: true }).click();
    await restoreSetResponse;

    await page.getByRole("tab", { name: "Активные", exact: true }).click();
    const restoredCard = page.getByRole("region", { name: `Командный набор ${setName}`, exact: true });
    await restoredCard.waitFor();
    await restoredCard.getByText(/v2/).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.4: team library edits and reorders team task sets", { timeout: 60_000 }, async () => {
  const auth = await account("team_sets_edit");
  const team = await createTeamApi(auth, `Команда редактирования наборов ${unique()}`);
  const firstTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Graph warmup",
      description: "Graph task",
      starterCode: "// graph",
      language: "kotlin",
    },
  });
  const secondTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Queue warmup",
      description: "Queue task",
      starterCode: "// queue",
      language: "nodejs",
    },
  });
  const setName = `Backend screening ${unique()}`;
  const createdSet = (await request(`/teams/${team.id}/task-sets`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      name: setName,
      taskIds: [firstTask.task.id, secondTask.task.id],
    },
  })).taskSet;

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/library`);
  try {
    await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    const setCard = page.getByRole("region", { name: `Командный набор ${setName}`, exact: true });
    await setCard.waitFor();
    await setCard.getByText("Graph warmup → Queue warmup", { exact: true }).waitFor();

    const updatedName = `${setName} updated`;
    await setCard.getByRole("button", { name: `Редактировать набор ${setName}`, exact: true }).click();
    await setCard.getByLabel("Новое название набора", { exact: true }).fill(updatedName);
    await setCard.getByRole("button", {
      name: `Поднять задачу Queue warmup в наборе ${setName}`,
      exact: true,
    }).click();

    const updateRequest = page.waitForRequest((requestCandidate) =>
      requestCandidate.url() === `${browserApi}/teams/${team.id}/task-sets/${createdSet.id}` &&
      requestCandidate.method() === "PATCH");
    const updateResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/task-sets/${createdSet.id}`) &&
      response.request().method() === "PATCH" &&
      response.status() === 200);
    await setCard.getByRole("button", { name: "Сохранить набор", exact: true }).click();
    const [requestCandidate] = await Promise.all([updateRequest, updateResponse]);
    assert.deepEqual(requestCandidate.postDataJSON(), {
      name: updatedName,
      taskIds: [secondTask.task.id, firstTask.task.id],
      revision: createdSet.revision,
    });

    const updatedCard = page.getByRole("region", { name: `Командный набор ${updatedName}`, exact: true });
    await updatedCard.waitFor();
    await updatedCard.getByText("Queue warmup → Graph warmup", { exact: true }).waitFor();
    await updatedCard.getByText(/v1/).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.4: team library imports a personal task set into team library", { timeout: 60_000 }, async () => {
  const auth = await account("team_set_import");
  const team = await createTeamApi(auth, `Команда импорта набора ${unique()}`);
  const firstTask = await createPersonalTask(auth, {
    title: "Graph personal",
    description: "Graph personal task",
    starterCode: "// graph personal",
    language: "kotlin",
  });
  const secondTask = await createPersonalTask(auth, {
    title: "Queue personal",
    description: "Queue personal task",
    starterCode: "// queue personal",
    language: "nodejs",
  });
  const presetName = `Personal import ${unique()}`;
  const preset = await createPersonalPreset(auth, {
    name: presetName,
    taskIds: [secondTask.id, firstTask.id],
  });

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/library`);
  try {
    await page.getByRole("heading", { name: "Библиотека", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Наборы задач", exact: true }).click();
    await page.getByRole("button", { name: "Импортировать", exact: true }).click();
    const importSetDialog = page.getByRole("dialog", { name: "Импортировать набор", exact: true });
    await importSetDialog.getByLabel("Данные набора или ID личного набора", { exact: true }).fill(preset.id);
    const importRequest = page.waitForRequest((requestCandidate) =>
      requestCandidate.url() === `${browserApi}/teams/${team.id}/task-sets/import-personal` &&
      requestCandidate.method() === "POST");
    const importResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/task-sets/import-personal`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await importSetDialog.getByRole("button", { name: "Импортировать набор", exact: true }).click();
    const [requestCandidate] = await Promise.all([importRequest, importResponse]);
    assert.deepEqual(requestCandidate.postDataJSON(), { sourcePresetId: preset.id });

    const importedCard = page.getByRole("region", { name: `Командный набор ${presetName}`, exact: true });
    await importedCard.waitFor();
    await importedCard.getByText("Queue personal → Graph personal", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Задачи", exact: true }).click();
    await page.getByRole("region", { name: "Командная задача Queue personal", exact: true }).waitFor();
    await page.getByRole("region", { name: "Командная задача Graph personal", exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.4: team interview preparation expands a selected team task set", { timeout: 60_000 }, async () => {
  const auth = await account("team_set_pick");
  const team = await createTeamApi(auth, `Команда выбора набора ${unique()}`);
  const firstTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Graph interview",
      description: "Graph task",
      starterCode: "// graph",
      language: "kotlin",
    },
  });
  const secondTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Queue interview",
      description: "Queue task",
      starterCode: "// queue",
      language: "nodejs",
    },
  });
  const setName = `Interview pack ${unique()}`;
  const taskSet = (await request(`/teams/${team.id}/task-sets`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      name: setName,
      taskIds: [secondTask.task.id, firstTask.task.id],
    },
  })).taskSet;

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
    await page.getByLabel("Командный набор задач", { exact: true }).selectOption(taskSet.id);
    const selectedSet = page.getByRole("region", { name: `Выбранный командный набор ${setName}`, exact: true });
    await selectedSet.waitFor();
    await selectedSet.getByText("Queue interview → Graph interview", { exact: true }).waitFor();
    await selectedSet.getByText("2 задач", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.5: team interview preparation selects track and vacancy context", { timeout: 60_000 }, async () => {
  const auth = await account("team_ctx_pick");
  const team = await createTeamApi(auth, `Команда контекста интервью ${unique()}`);
  const track = (await request(`/teams/${team.id}/tracks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { name: "Backend track" },
  })).track;
  const vacancy = (await request(`/teams/${team.id}/tracks/${track.id}/vacancies`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { title: "Kotlin engineer" },
  })).vacancy;

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
    await page.getByLabel("Трек интервью", { exact: true }).selectOption(track.id);
    await page.getByLabel("Вакансия", { exact: true }).selectOption(vacancy.id);
    const selectedTrack = page.getByRole("region", { name: "Выбранный трек Backend track", exact: true });
    await selectedTrack.waitFor();
    await selectedTrack.getByText("Вакансия: Kotlin engineer", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.5: team interview preparation creates a team interview from selected context", { timeout: 60_000 }, async () => {
  const auth = await account("team_interview_create");
  const team = await createTeamApi(auth, `Команда создания интервью ${unique()}`);
  const firstTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Graph interview",
      description: "Graph task",
      starterCode: "// graph",
      language: "kotlin",
    },
  });
  const secondTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Queue interview",
      description: "Queue task",
      starterCode: "// queue",
      language: "nodejs",
    },
  });
  const setName = `Interview pack ${unique()}`;
  const taskSet = (await request(`/teams/${team.id}/task-sets`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      name: setName,
      taskIds: [secondTask.task.id, firstTask.task.id],
    },
  })).taskSet;
  const track = (await request(`/teams/${team.id}/tracks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { name: "Backend track" },
  })).track;
  const vacancy = (await request(`/teams/${team.id}/tracks/${track.id}/vacancies`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { title: "Kotlin engineer" },
  })).vacancy;

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
    await page.getByLabel("Название интервью", { exact: true }).fill("Backend pair interview");
    await page.getByLabel("Трек интервью", { exact: true }).selectOption(track.id);
    await page.getByLabel("Вакансия", { exact: true }).selectOption(vacancy.id);
    await page.getByLabel("Командный набор задач", { exact: true }).selectOption(taskSet.id);

    const createRequest = page.waitForRequest((requestCandidate) =>
      requestCandidate.url() === `${browserApi}/teams/${team.id}/interviews` &&
      requestCandidate.method() === "POST");
    const createResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/interviews`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const [requestCandidate, response] = await Promise.all([createRequest, createResponse]);
    assert.match(await requestCandidate.headerValue("Idempotency-Key"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.deepEqual(requestCandidate.postDataJSON(), {
      title: "Backend pair interview",
      taskSetId: taskSet.id,
      trackId: track.id,
      vacancyId: vacancy.id,
    });
    const created = (await response.json()).interview;
    assert.ok(created.id);

    const result = page.getByRole("region", { name: "Созданное командное интервью Backend pair interview", exact: true });
    await result.waitFor();
    await result.getByText(`ID: ${created.id}`, { exact: true }).waitFor();
    await result.getByText("Queue interview → Graph interview", { exact: true }).waitFor();
    await result.getByText("Трек: Backend track", { exact: true }).waitFor();
    await result.getByText("Вакансия: Kotlin engineer", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.5: team interview preparation assigns team employees by role", { timeout: 60_000 }, async () => {
  const owner = await account("team_role_owner");
  const interviewer = await account("team_role_interviewer");
  const candidate = await account("team_role_candidate");
  const team = await createTeamApi(owner, `Команда назначений ${unique()}`);
  await addTeamMembers(owner, team, interviewer, candidate);
  const firstTask = await request(`/teams/${team.id}/tasks`, {
    token: owner.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Graph role interview",
      description: "Graph role task",
      starterCode: "// graph role",
      language: "kotlin",
    },
  });
  const secondTask = await request(`/teams/${team.id}/tasks`, {
    token: owner.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Queue role interview",
      description: "Queue role task",
      starterCode: "// queue role",
      language: "nodejs",
    },
  });
  const taskSet = (await request(`/teams/${team.id}/task-sets`, {
    token: owner.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      name: `Role interview pack ${unique()}`,
      taskIds: [secondTask.task.id, firstTask.task.id],
    },
  })).taskSet;

  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/interviews/new`);
  try {
    await page.getByRole("heading", { name: "Создать интервью", exact: true }).waitFor();
    await page.getByLabel("Название интервью", { exact: true }).fill("Role based interview");
    await page.getByLabel("Командный набор задач", { exact: true }).selectOption(taskSet.id);

    const interviewerGroup = page.getByRole("group", { name: "Другие интервьюеры (необязательно)", exact: true });
    await interviewerGroup.getByRole("checkbox", { name: interviewer.user.displayName, exact: true }).check();
    assert.equal(await page.getByRole("checkbox", { name: owner.user.displayName, exact: true }).count(), 0);
    assert.equal(await page.getByRole("group", { name: "Кандидаты", exact: true }).count(), 0);

    const createRequest = page.waitForRequest((requestCandidate) =>
      requestCandidate.url() === `${browserApi}/teams/${team.id}/interviews` &&
      requestCandidate.method() === "POST");
    const createResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${team.id}/interviews`) &&
      response.request().method() === "POST" &&
      response.status() === 201);
    await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const [requestCandidate, response] = await Promise.all([createRequest, createResponse]);
    assert.deepEqual(requestCandidate.postDataJSON(), {
      title: "Role based interview",
      taskSetId: taskSet.id,
      interviewerIds: [interviewer.user.id],
    });
    const created = (await response.json()).interview;
    assert.ok(created.id);

    const result = page.getByRole("region", { name: "Созданное командное интервью Role based interview", exact: true });
    await result.waitFor();
    await result.getByText(new RegExp(`Интервьюеры: .*${interviewer.user.displayName}`)).waitFor();
    assert.equal(await result.getByText(`Кандидаты: ${candidate.user.displayName}`, { exact: true }).count(), 0);
    await result.getByRole("button", { name: "Копировать ссылку для кандидата", exact: true }).waitFor();

    await page.goto(`${web}/workspace/teams/${team.id}/interviews`, { waitUntil: "domcontentloaded" });
    const card = page.getByRole("region", { name: "Командное интервью Role based interview", exact: true });
    await card.waitFor();
    await card.getByText(new RegExp(`Интервьюеры: .*${interviewer.user.displayName}`)).waitFor();
    await card.getByRole("button", { name: "Копировать ссылку для кандидата", exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P1.5: team interview list shows created team interviews", { timeout: 60_000 }, async () => {
  const auth = await account("team_interview_list");
  const team = await createTeamApi(auth, `Команда списка интервью ${unique()}`);
  const firstTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Graph interview",
      description: "Graph task",
      starterCode: "// graph",
      language: "kotlin",
    },
  });
  const secondTask = await request(`/teams/${team.id}/tasks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      title: "Queue interview",
      description: "Queue task",
      starterCode: "// queue",
      language: "nodejs",
    },
  });
  const taskSet = (await request(`/teams/${team.id}/task-sets`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: {
      name: `Interview pack ${unique()}`,
      taskIds: [secondTask.task.id, firstTask.task.id],
    },
  })).taskSet;
  const track = (await request(`/teams/${team.id}/tracks`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { name: "Backend track" },
  })).track;
  const vacancy = (await request(`/teams/${team.id}/tracks/${track.id}/vacancies`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    body: { title: "Kotlin engineer" },
  })).vacancy;

  const screen = (await request(`/teams/${team.id}/interviews`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    key: randomUUID(),
    body: {
      title: "Backend screen",
      taskSetId: taskSet.id,
    },
  })).interview;
  const onsite = (await request(`/teams/${team.id}/interviews`, {
    token: auth.token,
    method: "POST",
    expectedStatus: 201,
    key: randomUUID(),
    body: {
      title: "Platform onsite",
      taskSetId: taskSet.id,
      trackId: track.id,
      vacancyId: vacancy.id,
      interviewerIds: [auth.user.id],
    },
  })).interview;

  const { context, page } = await openAccount(auth, `/workspace/teams/${team.id}/interviews`);
  try {
    await page.getByRole("heading", { name: "Интервью", exact: true }).waitFor();
    const onsiteCard = page.getByRole("list", { name: "Командные интервью", exact: true })
      .getByRole("region", { name: "Командное интервью Platform onsite", exact: true });
    await onsiteCard.waitFor();
    assert.equal(await onsiteCard.getByText(`ID: ${onsite.id}`, { exact: true }).count(), 0);
    await onsiteCard.getByText("2 задачи", { exact: true }).waitFor();
    await onsiteCard.getByText("Трек: Backend track", { exact: true }).waitFor();
    await onsiteCard.getByText("Вакансия: Kotlin engineer", { exact: true }).waitFor();
    await onsiteCard.getByText("Queue interview → Graph interview", { exact: true }).waitFor();
    const openRoomLink = onsiteCard.getByRole("link", { name: "Открыть комнату Platform onsite", exact: true });
    await openRoomLink.waitFor();
    await onsiteCard.getByText("Войти в комнату", { exact: true }).waitFor();
    assert.equal(await openRoomLink.getAttribute("href"), `/room/${onsite.inviteCode}`);

    const screenCard = page.getByRole("region", { name: "Командное интервью Backend screen", exact: true });
    await screenCard.waitFor();
    assert.equal(await screenCard.getByText(`ID: ${screen.id}`, { exact: true }).count(), 0);
    await screenCard.getByText("Без трека", { exact: true }).waitFor();

    const deleteInterviewResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/api/teams/${team.id}/interviews/${screen.id}`) &&
      response.request().method() === "DELETE" && response.status() === 204);
    await screenCard.getByRole("button", { name: "Удалить интервью Backend screen", exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить интервью Backend screen?" }).getByRole("button", { name: "Удалить", exact: true }).click();
    await deleteInterviewResponse;

    await page.getByLabel("Поиск интервью", { exact: true }).fill("screen");
    await screenCard.waitFor();
    await onsiteCard.waitFor({ state: "hidden" });
    assert.equal(await onsiteCard.count(), 0, "team interview search must hide non-matching cards");
  } finally {
    await context.close();
  }
});

test("team interview owner can rename a room from the team list", { timeout: 60_000 }, async () => {
  const owner = await account("rename_ui_owner");
  const member = await account("rename_ui_member");
  const team = await createTeamApi(owner, `Переименование интервью ${unique()}`);
  await addTeamMemberViaInvitation(owner, team, member);
  await createTeamInterview(owner, team, { title: "Комната до переименования" });

  const memberView = await openAccount(member, `/workspace/teams/${team.id}/interviews`);
  try {
    const foreignCard = memberView.page.getByRole("region", { name: "Командное интервью Комната до переименования", exact: true });
    await foreignCard.waitFor();
    assert.equal(await foreignCard.getByRole("button", { name: "Переименовать интервью Комната до переименования" }).count(), 0);
  } finally {
    await memberView.context.close();
  }

  const { context, page } = await openAccount(owner, `/workspace/teams/${team.id}/interviews`);
  try {
    const originalCard = page.getByRole("region", { name: "Командное интервью Комната до переименования", exact: true });
    await originalCard.getByRole("button", { name: "Переименовать интервью Комната до переименования", exact: true }).click();
    await originalCard.getByRole("textbox", { name: "Новое название интервью", exact: true }).fill("Комната после переименования");
    await originalCard.getByRole("button", { name: "Сохранить название", exact: true }).click();
    const renamedCard = page.getByRole("region", { name: "Командное интервью Комната после переименования", exact: true });
    await renamedCard.waitFor();
    assert.equal(await originalCard.count(), 0);
    await page.reload();
    await renamedCard.waitFor();
    await renamedCard.getByRole("link", { name: "Открыть комнату Комната после переименования", exact: true }).click();
    await page.waitForURL("**/room/**");
    await page.getByText("Комната после переименования", { exact: true }).waitFor();
  } finally {
    await context.close();
  }
});

test("P3.1: rejoined member does not regain an old team interview assignment in the browser", { timeout: 75_000 }, async () => {
  const owner = await account("team_rejoin_owner");
  const interviewer = await account("team_rejoin_interviewer");
  const team = await createTeamApi(owner, `Команда повторного входа ${unique()}`);
  await addTeamMemberViaInvitation(owner, team, interviewer);
  const task = await createTeamTask(owner, team, {
    title: `Rejoin browser task ${unique()}`,
    description: "Browser regression task",
    starterCode: "// browser rejoin\n",
    language: "nodejs",
  });
  const taskSet = await createTeamTaskSet(owner, team, {
    name: `Rejoin browser set ${unique()}`,
    taskIds: [task.id],
  });
  const interview = await createTeamInterview(owner, team, {
    title: `Rejoin browser interview ${unique()}`,
    taskSetId: taskSet.id,
    interviewerIds: [interviewer.user.id],
    candidateIds: [],
  });

  const beforeRemoval = await openAccount(interviewer, `/workspace/teams/${team.id}/interviews`);
  try {
    const assignedCard = beforeRemoval.page.getByRole("region", { name: `Командное интервью ${interview.title}`, exact: true });
    await assignedCard.waitFor();
    await assignedCard.getByRole("link", { name: `Открыть комнату ${interview.title}`, exact: true }).waitFor();
  } finally {
    await beforeRemoval.context.close();
  }

  const removed = await rawRequest(`/teams/${team.id}/members/${interviewer.user.id}`, {
    token: owner.token,
    method: "DELETE",
    key: randomUUID(),
  });
  assert.equal(removed.status, 200, `owner must remove old assignee before rejoin: ${await removed.text()}`);
  await addTeamMemberViaInvitation(owner, team, interviewer);

  const afterRejoin = await openAccount(interviewer, `/workspace/teams/${team.id}/interviews`);
  try {
    const rejoinedCard = afterRejoin.page.getByRole("region", { name: `Командное интервью ${interview.title}`, exact: true });
    await rejoinedCard.waitFor();
    assert.equal(
      await rejoinedCard.getByRole("link", { name: `Открыть комнату ${interview.title}`, exact: true }).count(),
      0,
      "REJOINED_MEMBER_OLD_INTERVIEW_OPEN_LINK_VISIBLE",
    );
    await rejoinedCard.getByText("Для управления комнатой требуется назначение интервьюером.", { exact: true }).waitFor();
  } finally {
    await afterRejoin.context.close();
  }

  const directRoom = await openAccount(interviewer, `/room/${interview.inviteCode}`);
  try {
    await directRoom.page.getByTestId("room-realtime-unavailable").waitFor();
    assert.equal(
      await directRoom.page.locator("[data-testid='room-code-editor-host']").count(),
      0,
      "REJOINED_MEMBER_OLD_ROOM_EDITOR_RENDERED",
    );
  } finally {
    await directRoom.context.close();
  }
});

test("P3.1: removing an active team room member closes protected browser context", { timeout: 75_000 }, async () => {
  const owner = await account("team_room_lifecycle_owner");
  const interviewer = await account("team_room_lifecycle_interviewer");
  const team = await createTeamApi(owner, `Команда live cleanup ${unique()}`);
  await addTeamMemberViaInvitation(owner, team, interviewer);
  const task = await createTeamTask(owner, team, {
    title: `Live cleanup task ${unique()}`,
    description: "Active room cleanup task",
    starterCode: "// live cleanup\n",
    language: "nodejs",
  });
  const taskSet = await createTeamTaskSet(owner, team, {
    name: `Live cleanup set ${unique()}`,
    taskIds: [task.id],
  });
  const interview = await createTeamInterview(owner, team, {
    title: `Live cleanup interview ${unique()}`,
    taskSetId: taskSet.id,
    interviewerIds: [interviewer.user.id],
    candidateIds: [],
  });
  const activeRoom = await openRoomAccount(interviewer, interview.inviteCode);
  try {
    await activeRoom.page.locator("[data-testid='room-code-editor-host'] .cm-editor").waitFor();
    const removed = await rawRequest(`/teams/${team.id}/members/${interviewer.user.id}`, {
      token: owner.token,
      method: "DELETE",
      key: randomUUID(),
    });
    assert.equal(removed.status, 200, `owner must remove active room member: ${await removed.text()}`);
    await activeRoom.page.getByTestId("room-realtime-unavailable").waitFor({ timeout: 20_000 });
    assert.equal(
      await activeRoom.page.locator("[data-testid='room-code-editor-host']").count(),
      0,
      "REMOVED_TEAM_MEMBER_ACTIVE_ROOM_EDITOR_STILL_RENDERED",
    );
    assert.equal(
      await activeRoom.page.getByRole("tablist", { name: "Рабочие области комнаты", exact: true }).count(),
      0,
      "REMOVED_TEAM_MEMBER_MANAGER_SURFACES_STILL_RENDERED",
    );
  } finally {
    await activeRoom.context.close();
  }
});

test("P1.5: team room manager workspace stays private until browser publication", { timeout: 90_000 }, async () => {
  const owner = await account("team_room_owner");
  const interviewer = await account("team_room_interviewer");
  const candidate = await account("team_room_candidate");
  const team = await createTeamApi(owner, `Комната командного интервью ${unique()}`);
  await addTeamMembers(owner, team, interviewer, candidate);
  const firstTask = await createTeamTask(owner, team, {
    title: `Intro graph ${unique()}`,
    description: "Initial public team task",
    starterCode: "// team public step\n",
    language: "nodejs",
  });
  const secondTask = await createTeamTask(owner, team, {
    title: `Deep queue ${unique()}`,
    description: "Private preparation task",
    starterCode: "// team private draft\n",
    language: "kotlin",
  });
  const taskSet = await createTeamTaskSet(owner, team, {
    name: `Team room pack ${unique()}`,
    taskIds: [firstTask.id, secondTask.id],
  });
  const interview = await createTeamInterview(owner, team, {
    title: `Team room ${unique()}`,
    taskSetId: taskSet.id,
    interviewerIds: [owner.user.id, interviewer.user.id],
    candidateIds: [candidate.user.id],
  });

  const observerSession = await openRoomAccount(owner, interview.inviteCode);
  const managerSession = await openRoomAccount(interviewer, interview.inviteCode);
  const candidateSession = await openRoomAccount(candidate, interview.inviteCode);
  try {
    const observerPage = observerSession.page;
    const managerPage = managerSession.page;
    const candidatePage = candidateSession.page;
    await waitForPublishedStep(candidatePage, firstTask.title, "CANDIDATE_INITIAL_PUBLIC_STEP");

    await Promise.all([
      observerPage.getByRole("tab", { name: "Шаги", exact: true }).click(),
      managerPage.getByRole("tab", { name: "Шаги", exact: true }).click(),
    ]);
    await Promise.all([
      observerPage.locator("[data-testid='room-step-row-1']").click(),
      managerPage.locator("[data-testid='room-step-row-1']").click(),
    ]);
    await Promise.all([
      waitForManagerWorkspaceEditor(observerPage, 1),
      waitForManagerWorkspaceEditor(managerPage, 1),
    ]);
    const marker = `TEAM_MANAGER_PRIVATE_DRAFT_${unique()}`;
    await appendEditorMarker(managerPage, marker);
    await waitForEditorMarker(observerPage, marker, "SECOND_MANAGER_TEAM_WORKSPACE_SYNC");
    const savedWorkspace = await waitForWorkspaceMarker(interviewer, interview.inviteCode, 1, marker);
    assert.equal(savedWorkspace.stepIndex, 1);

    await candidatePage.waitForTimeout(750);
    assert.equal(
      await editorIncludes(candidatePage, marker),
      false,
      "CANDIDATE_SAW_TEAM_MANAGER_WORKSPACE_BEFORE_PUBLICATION",
    );
    assert.equal(
      await candidatePage.locator("[data-testid='room-publish-step']").count(),
      0,
      "CANDIDATE_CAN_PUBLISH_TEAM_MANAGER_WORKSPACE",
    );

    await managerPage.locator("[data-testid='room-publish-step']").click();
    await waitForPublishedStep(candidatePage, secondTask.title, "CANDIDATE_AFTER_TEAM_PUBLICATION");
    await waitForEditorMarker(candidatePage, marker, "CANDIDATE_AFTER_TEAM_PUBLICATION");
  } finally {
    await Promise.all([
      observerSession.context.close().catch(() => {}),
      managerSession.context.close().catch(() => {}),
      candidateSession.context.close().catch(() => {}),
    ]);
  }
});

test("AC-02: creates Atlas and Orbit once per intent and keeps same-named teams distinct", { timeout: 60000 }, async () => {
  const auth = await account("journey");
  const personal = await createPersonalRoom(auth, `PERSONAL row ${unique()}`);
  const { context, page } = await openAccount(auth);
  const posts = [];
  page.on("request", (candidate) => {
    if (candidate.url() === `${browserApi}/teams` && candidate.method() === "POST") posts.push(candidate);
  });
  try {
    await switcher(page).waitFor();
    assert.match(await switcher(page).innerText(), /Личное пространство/);
    const atlas = await createTeamThroughUi(page, "Atlas");
    assert.equal(posts.length, 1, "Atlas intent must issue one POST")
    const orbit = await createTeamThroughUi(page, "Orbit");
    assert.equal(posts.length, 2, "Orbit intent must issue one POST")
    const secondAtlas = await createTeamThroughUi(page, "Atlas");
    assert.equal(posts.length, 3, "second same-name intent must issue one POST")
    assert.notEqual(atlas.id, secondAtlas.id)

    const choices = await openWorkspaceDialog(page);
    assert.equal(await choices.getByRole("button", { name: /Atlas/ }).count(), 2);
    assert.equal(await choices.getByText(atlas.id.slice(0, 8), { exact: false }).count(), 1);
    assert.equal(await choices.getByText(secondAtlas.id.slice(0, 8), { exact: false }).count(), 1);
    await page.keyboard.press("Escape");

    await selectWorkspace(page, atlas);
    assert.equal(await page.getByText(personal.title, { exact: true }).count(), 0, "team shell must not render PERSONAL rows");
    await page.goto(`${web}/workspace/teams/${atlas.id}/interviews?q=atlas-only`);
    await page.getByLabel("Поиск интервью", { exact: true }).fill("локальный фильтр Atlas");
    await selectWorkspace(page, orbit);
    assert.equal(new URL(page.url()).search, "", "workspace switch must reset another workspace query")
    assert.equal(await page.getByLabel("Поиск интервью", { exact: true }).inputValue(), "");

    await page.goto(`${web}/workspace/teams/${atlas.id}/interviews/new`);
    await page.getByLabel("Название интервью", { exact: true }).fill("Черновик только Atlas");
    await selectWorkspace(page, orbit);
    await page.goto(`${web}/workspace/teams/${orbit.id}/interviews/new`);
    assert.equal(await page.getByLabel("Название интервью", { exact: true }).inputValue(), "");
    assert.equal(await page.getByText("Черновик только Atlas", { exact: true }).count(), 0);
  } finally {
    await context.close();
  }
});

test("AC-02: retry reuses the key until canonical name changes", { timeout: 60000 }, async () => {
  const auth = await account("retry")
  const { context, page } = await openAccount(auth);
  const attempts = [];
  let committedAtlas;
  await page.route(`${browserApi}/teams`, async (route) => {
    const request = route.request();
    attempts.push({
      key: await request.headerValue("Idempotency-Key"),
      body: request.postDataJSON(),
    });
    if (attempts.length === 1) {
      const upstream = await route.fetch();
      assert.equal(upstream.status(), 201, "lost-response fixture must commit at the real server");
      committedAtlas = {
        body: await upstream.body(),
        location: upstream.headers().location,
      };
      await route.abort("failed");
    } else if (attempts.length === 3) await route.abort("failed");
    else await route.continue();
  });
  try {
    const workspaceDialog = await openWorkspaceDialog(page);
    await workspaceDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    let createDialog = page.getByRole("dialog", { name: "Создать команду", exact: true });
    await createDialog.getByLabel("Название команды", { exact: true }).fill("　Ａtlas　");
    await createDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    await createDialog.getByRole("alert").waitFor();
    const atlasResponse = page.waitForResponse((response) => isApiResponse(response, `/teams`) && response.status() === 201);
    await createDialog.getByRole("button", { name: "Повторить", exact: true }).click();
    const atlasReplay = await atlasResponse;
    assert.equal(attempts[0].key, attempts[1].key, "same canonical intent must reuse its UUID key")
    assert.deepEqual(attempts[0].body, { name: "　Ａtlas　" });
    assert.deepEqual(attempts[1].body, { name: "　Ａtlas　" });
    assert.deepEqual((await atlasReplay.body()).toJSON(), committedAtlas.body.toJSON(), "retry must replay exact committed bytes");
    assert.equal(atlasReplay.headers().location, committedAtlas.location, "retry must replay exact Location");
    const atlasPayload = await atlasReplay.json();
    const atlas = atlasPayload.team ?? atlasPayload;
    const afterLostResponse = await request("/me/workspaces", { token: auth.token });
    const afterLostItems = Array.isArray(afterLostResponse) ? afterLostResponse : afterLostResponse.items;
    assert.equal(afterLostItems.filter((item) => item.id === atlas.id).length, 1, "lost response retry must leave exactly one Atlas team");

    const nextWorkspaceDialog = await openWorkspaceDialog(page);
    await nextWorkspaceDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    createDialog = page.getByRole("dialog", { name: "Создать команду", exact: true });
    await createDialog.getByLabel("Название команды", { exact: true }).fill("Atlas draft");
    await createDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    await createDialog.getByRole("alert").waitFor();
    await createDialog.getByLabel("Название команды", { exact: true }).fill("Orbit");
    const orbitResponse = page.waitForResponse((response) => isApiResponse(response, `/teams`) && response.status() === 201);
    await createDialog.getByRole("button", { name: "Повторить", exact: true }).click();
    const orbitPayload = await (await orbitResponse).json();
    const orbit = orbitPayload.team ?? orbitPayload;
    assert.deepEqual(attempts[2].body, { name: "Atlas draft" });
    assert.deepEqual(attempts[3].body, { name: "Orbit" });
    assert.notEqual(attempts[2].key, attempts[3].key, "changed canonical body must mint a new UUID key")
    assert.equal(orbit.name, "Orbit");
    await page.waitForURL(`**/workspace/teams/${orbit.id}/interviews`);
    assert.match(await switcher(page).innerText(), /Orbit/);
    assert.match(await switcher(page).innerText(), new RegExp(orbit.id.slice(0, 8), "i"));
    const finalWorkspaces = await request("/me/workspaces", { token: auth.token });
    const finalItems = Array.isArray(finalWorkspaces) ? finalWorkspaces : finalWorkspaces.items;
    assert.equal(finalItems.filter((item) => item.id === orbit.id && item.name === "Orbit").length, 1);
    attempts.forEach(({ key }) => assert.match(key, /^[0-9a-f-]{36}$/i));
  } finally {
    await page.unroute(`${browserApi}/teams`);
    await context.close();
  }
});

test("AC-02: delayed Atlas detail cannot overwrite selected Orbit", { timeout: 60000 }, async () => {
  const auth = await account("late")
  const atlas = await createTeamApi(auth, "Atlas")
  const orbit = await createTeamApi(auth, "Orbit")
  const atlasDetail = await request(`/teams/${atlas.id}`, { token: auth.token })
  const requested = deferred();
  const release = deferred();
  const completed = deferred();
  const { context, page } = await openAccount(auth);
  await page.route(`${browserApi}/teams/${atlas.id}`, async (route) => {
    requested.resolve();
    await release.promise;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasDetail) });
    completed.resolve();
  });
  try {
    const atlasSelection = selectWorkspace(page, atlas);
    await requested.promise;
    await selectWorkspace(page, orbit);
    release.resolve();
    await completed.promise;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(new URL(page.url()).pathname, `/workspace/teams/${orbit.id}/interviews`);
    assert.match(await switcher(page).innerText(), /Orbit/);
    assert.doesNotMatch(await switcher(page).innerText(), /Atlas/);
    await atlasSelection.catch(() => undefined);
  } finally {
    release.resolve();
    await context.close();
  }
});

test("AC-02: browser back and forward revalidate each workspace detail", { timeout: 60000 }, async () => {
  const auth = await account("history")
  const atlas = await createTeamApi(auth, "Atlas")
  const orbit = await createTeamApi(auth, "Orbit")
  const { context, page } = await openAccount(auth);
  try {
    await selectWorkspace(page, atlas);
    await selectWorkspace(page, orbit);
    const atlasRefresh = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${atlas.id}`) && response.status() === 200);
    await page.goBack();
    await atlasRefresh;
    await page.waitForURL(`**/workspace/teams/${atlas.id}/interviews`);
    await switcher(page).getByText("Atlas", { exact: false }).waitFor();
    assert.match(await switcher(page).innerText(), /Atlas/);
    const orbitRefresh = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${orbit.id}`) && response.status() === 200);
    await page.goForward();
    await orbitRefresh;
    await page.waitForURL(`**/workspace/teams/${orbit.id}/interviews`);
    await switcher(page).getByText("Orbit", { exact: false }).waitFor();
    assert.match(await switcher(page).innerText(), /Orbit/);
  } finally {
    await context.close();
  }
});

test("AC-02: same-browser second account rejects late first-account team data", { timeout: 60000 }, async () => {
  const first = await account("identity_a")
  const second = await account("identity_b")
  const atlas = await createTeamApi(first, "Atlas")
  await createTeamApi(first, "Orbit")
  const atlasDetail = await request(`/teams/${atlas.id}`, { token: first.token })
  const requested = deferred();
  const release = deferred();
  const completed = deferred();
  const { context, page } = await openAccount(first);
  await page.route(`${browserApi}/teams/${atlas.id}`, async (route) => {
    requested.resolve();
    await release.promise;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(atlasDetail) });
    completed.resolve();
  });
  try {
    selectWorkspace(page, atlas).catch(() => undefined);
    await requested.promise;
    await loginInSamePage(page, second);
    assert.doesNotMatch(await page.locator("body").innerText(), /Atlas|Orbit/);
    release.resolve();
    await completed.promise;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(new URL(page.url()).pathname, /^\/workspace\/personal\//);
    assert.doesNotMatch(await page.locator("body").innerText(), /Atlas|Orbit/);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("auth_user")));
    assert.equal(stored.id, second.user.id);
  } finally {
    release.resolve();
    await context.close();
  }
});

test("AC-02 security: history and focus revalidation never expose stale team authority", { timeout: 60000 }, async (t) => {
  await t.test("same-account history entry hides a revoked team before its detail denial", async () => {
    const auth = await account("history_same_account");
    const revokedName = `Atlas revoked history ${unique()}`;
    const revoked = await createTeamApi(auth, revokedName);
    const retained = await createTeamApi(auth, `Orbit retained ${unique()}`);
    const { context, page } = await openAccount(auth);
    const requested = deferred();
    let detailReads = 0;
    try {
      await selectWorkspace(page, revoked);
      await switcher(page).filter({ hasText: revokedName }).waitFor();
      await selectWorkspace(page, retained);
      await page.keyboard.press("Escape");
      await page.route(`${browserApi}/teams/${revoked.id}`, async (route) => {
        detailReads += 1;
        requested.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({ error: "TEAM_NOT_FOUND" }),
        });
      });

      const deniedResponse = page.waitForResponse((response) =>
        isApiResponse(response, `/teams/${revoked.id}`) && response.status() === 404);
      await page.evaluate(() => history.back());
      await page.waitForURL(`**/workspace/teams/${revoked.id}/interviews`);
      await requested.promise;
      await settleRender(page);
      let pendingDisclosureError = null;
      try {
        assert.equal(detailReads, 1, "SAME_ACCOUNT_HISTORY_DETAIL_REVALIDATION_MISSING");
        assert.doesNotMatch(
          await switcher(page).innerText(),
          new RegExp(`${revokedName}|${revoked.id.slice(0, 8)}`, "i"),
          "SAME_ACCOUNT_HISTORY_PENDING_REVEALED_TEAM_LABEL",
        );
        assert.equal(await page.getByRole("navigation", { name: "Разделы командного пространства" }).count(), 0);
        assert.equal(await page.getByLabel("Название интервью", { exact: true }).count(), 0);
      } catch (error) {
        pendingDisclosureError = error;
      }

      await deniedResponse;
      if (pendingDisclosureError) throw pendingDisclosureError;
      await page.getByRole("alert", { name: "Команда недоступна" }).waitFor();
      assert.doesNotMatch(await switcher(page).innerText(), new RegExp(revokedName, "i"));
    } finally {
      await context.close();
    }
  });

  await t.test("account B history entry stays neutral before and after the denied detail", async () => {
    const first = await account("history_auth_a");
    const second = await account("history_auth_b");
    const atlasName = `Atlas private ${unique()}`;
    const atlas = await createTeamApi(first, atlasName);
    const { context, page } = await openAccount(first);
    const requested = deferred();
    const release = deferred();
    let historyAuthorization = null;
    try {
      await selectWorkspace(page, atlas);
      await switcher(page).filter({ hasText: atlasName }).waitFor();
      const atlasHistoryIndex = await page.evaluate(() => history.state?.idx);
      assert.equal(Number.isInteger(atlasHistoryIndex), true, "ATLAS_HISTORY_INDEX_MISSING");
      await loginInSamePage(page, second);
      const secondSessionToken = await page.evaluate(() => localStorage.getItem("auth_token"));
      assert.ok(secondSessionToken && secondSessionToken !== first.token, "ACCOUNT_B_SESSION_TOKEN_NOT_ROTATED");
      await page.route(`${browserApi}/teams/${atlas.id}`, async (route) => {
        historyAuthorization = await route.request().headerValue("Authorization");
        requested.resolve();
        await release.promise;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({ error: "TEAM_NOT_FOUND" }),
        });
      });
      const currentHistoryIndex = await page.evaluate(() => history.state?.idx);
      const historyDelta = atlasHistoryIndex - currentHistoryIndex;
      assert.ok(historyDelta < 0, `ATLAS_HISTORY_ENTRY_NOT_BEHIND_CURRENT delta=${historyDelta}`);
      await page.evaluate((delta) => history.go(delta), historyDelta);
      await settleRender(page);
      assert.equal(
        new URL(page.url()).pathname,
        `/workspace/teams/${atlas.id}/interviews`,
        `ATLAS_HISTORY_BACK_WRONG_ENTRY delta=${historyDelta}`,
      );
      await requested.promise;
      assert.equal(historyAuthorization, `Bearer ${secondSessionToken}`, "HISTORY_BACK_USED_ACCOUNT_A_CREDENTIAL");
      await assertNoTeamDisclosure(page, atlasName, "ACCOUNT_B_HISTORY_PENDING");
      const deniedResponse = page.waitForResponse((response) =>
        isApiResponse(response, `/teams/${atlas.id}`) && response.status() === 404);
      release.resolve();
      await deniedResponse;
      await page.getByRole("alert", { name: "Команда недоступна" }).waitFor();
      await assertNoTeamDisclosure(page, atlasName, "ACCOUNT_B_HISTORY_DENIED");
    } finally {
      release.resolve();
      await context.close();
    }
  });

  await t.test("focus revalidation clears a previously authorized team and its draft", async () => {
    const auth = await account("focus_revoke");
    const atlasName = `Atlas revoked ${unique()}`;
    const atlas = await createTeamApi(auth, atlasName);
    const { context, page } = await openAccount(auth);
    const release = deferred();
    let focusRequests = 0;
    try {
      await selectWorkspace(page, atlas);
      await switcher(page).filter({ hasText: atlasName }).waitFor();
      await page.getByRole("button", { name: "Создать интервью", exact: true }).click();
      await page.waitForURL(`**/workspace/teams/${atlas.id}/interviews/new`);
      const secretDraft = `Закрытый черновик ${unique()}`;
      await page.getByLabel("Название интервью", { exact: true }).fill(secretDraft);
      await page.route(`${browserApi}/teams/${atlas.id}`, async (route) => {
        focusRequests += 1;
        await release.promise;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify({ error: "TEAM_NOT_FOUND" }),
        });
      });
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("focus"));
      });
      await settleRender(page);
      assert.equal(focusRequests, 1, "TEAM_DETAIL_FOCUS_REVALIDATION_MISSING");
      await assertNoTeamDisclosure(page, atlasName, "FOCUS_REVALIDATION_PENDING");
      assert.equal(await page.getByText(secretDraft, { exact: true }).count(), 0, "FOCUS_REVALIDATION_STALE_DRAFT_TEXT");
      const deniedResponse = page.waitForResponse((response) =>
        isApiResponse(response, `/teams/${atlas.id}`) && response.status() === 404);
      release.resolve();
      await deniedResponse;
      await page.getByRole("alert", { name: "Команда недоступна" }).waitFor();
      await assertNoTeamDisclosure(page, atlasName, "FOCUS_REVALIDATION_DENIED");
    } finally {
      release.resolve();
      await context.close();
    }
  });
});

test("AC-02 security: delayed team creation cannot escape its workspace or account context", { timeout: 60000 }, async (t) => {
  async function startDelayedCreate(page, lateName) {
    const requested = deferred();
    const release = deferred();
    const settled = deferred();
    let firstKey = null;
    await page.route(`${browserApi}/teams`, async (route) => {
      firstKey = await route.request().headerValue("Idempotency-Key");
      requested.resolve();
      await release.promise;
      try {
        const teamId = randomUUID();
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { Location: `/api/teams/${teamId}` },
          body: JSON.stringify({
            team: { id: teamId, name: lateName },
            membership: { role: "ADMIN", state: "ACTIVE", epoch: 1 },
            capabilities: [],
          }),
        });
        settled.resolve("fulfilled");
      } catch {
        settled.resolve("aborted");
      }
    });
    const workspaceDialog = await openWorkspaceDialog(page);
    await workspaceDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "Создать команду", exact: true });
    await createDialog.getByLabel("Название команды", { exact: true }).fill(lateName);
    await createDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    await requested.promise;
    return { release, settled, key: () => firstKey };
  }

  await t.test("closing the modal and selecting TEAM-B ignores TEAM-A completion", async () => {
    const auth = await account("late_context");
    const teamA = await createTeamApi(auth, "TEAM-A");
    const teamB = await createTeamApi(auth, "TEAM-B");
    const { context, page } = await openAccount(auth);
    const lateName = `Late TEAM-A ${unique()}`;
    try {
      await selectWorkspace(page, teamA);
      await switcher(page).filter({ hasText: "TEAM-A" }).waitFor();
      const delayed = await startDelayedCreate(page, lateName);
      assert.match(delayed.key(), /^[0-9a-f-]{36}$/i);
      await page.keyboard.press("Escape");
      await selectWorkspace(page, teamB);
      await switcher(page).filter({ hasText: "TEAM-B" }).waitFor();
      delayed.release.resolve();
      await delayed.settled.promise;
      await settleRender(page);
      assert.equal(new URL(page.url()).pathname, `/workspace/teams/${teamB.id}/interviews`, "LATE_CREATE_NAVIGATED_OUT_OF_TEAM_B");
      assert.doesNotMatch(await page.locator("body").innerText(), new RegExp(lateName), "LATE_CREATE_DISCLOSED_IN_TEAM_B");
      const workspaceDialog = await openWorkspaceDialog(page);
      await workspaceDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
      assert.equal(await page.getByLabel("Название команды", { exact: true }).inputValue(), "", "TEAM_CONTEXT_CHANGE_DID_NOT_CLEAR_CREATE_DRAFT");
    } finally {
      await context.close();
    }
  });

  await t.test("logout aborts a delayed TEAM-A creation and cannot navigate the personal session", async () => {
    const auth = await account("late_logout");
    const teamA = await createTeamApi(auth, "TEAM-A logout");
    const { context, page } = await openAccount(auth);
    const lateName = `Late logout ${unique()}`;
    try {
      await selectWorkspace(page, teamA);
      await switcher(page).filter({ hasText: "TEAM-A logout" }).waitFor();
      const delayed = await startDelayedCreate(page, lateName);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Выйти", exact: true }).click();
      await page.waitForURL(`${web}/`);
      delayed.release.resolve();
      await delayed.settled.promise;
      await settleRender(page);
      assert.equal(new URL(page.url()).pathname, "/", "LATE_CREATE_NAVIGATED_AFTER_LOGOUT");
      assert.doesNotMatch(await page.locator("body").innerText(), new RegExp(lateName), "LATE_CREATE_DISCLOSED_AFTER_LOGOUT");
    } finally {
      await context.close();
    }
  });
});

test("AC-02 security: late account-A mutation completion cannot refetch account-B workspaces", { timeout: 60000 }, async () => {
  const first = await account("invalidation_a");
  const second = await account("invalidation_b");
  const teamA = await createTeamApi(first, "Account A pending team");
  const { context, page } = await openAccount(first);
  const requested = deferred();
  const release = deferred();
  const settled = deferred();
  let workspaceReads = 0;
  await page.route(`${browserApi}/teams`, async (route) => {
    requested.resolve();
    await release.promise;
    try {
      const teamId = randomUUID();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { Location: `/api/teams/${teamId}` },
        body: JSON.stringify({
          team: { id: teamId, name: "Late account A team" },
          membership: { role: "ADMIN", state: "ACTIVE", epoch: 1 },
          capabilities: [],
        }),
      });
      settled.resolve("fulfilled");
    } catch {
      settled.resolve("aborted");
    }
  });
  try {
    await selectWorkspace(page, teamA);
    await switcher(page).filter({ hasText: "Account A pending team" }).waitFor();
    const workspaceDialogA = await openWorkspaceDialog(page);
    await workspaceDialogA.getByRole("button", { name: "Создать команду", exact: true }).click();
    const createDialog = page.getByRole("dialog", { name: "Создать команду", exact: true });
    await createDialog.getByLabel("Название команды", { exact: true }).fill("Late account A team");
    await createDialog.getByRole("button", { name: "Создать команду", exact: true }).click();
    await requested.promise;
    await page.keyboard.press("Escape");
    await loginInSamePage(page, second);
    const workspaceDialogB = await openWorkspaceDialog(page);
    await workspaceDialogB.getByRole("button", { name: "Личное пространство", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    page.on("request", (candidate) => {
      if (candidate.url() === `${browserApi}/me/workspaces` && candidate.method() === "GET") workspaceReads += 1;
    });
    release.resolve();
    await settled.promise;
    await settleRender(page);
    assert.equal(workspaceReads, 0, "LATE_ACCOUNT_A_MUTATION_REFETCHED_ACCOUNT_B_WORKSPACES");
  } finally {
    release.resolve();
    await context.close();
  }
});

test("AC-02 security: focus and hidden-visible revalidation purge revoked workspace choices", { timeout: 60000 }, async () => {
  const auth = await account("workspace_revoke");
  const revokedName = `Revoked Atlas ${unique()}`;
  const revoked = await createTeamApi(auth, revokedName);
  const initialWorkspaces = await request("/me/workspaces", { token: auth.token });
  const personal = initialWorkspaces.find((workspace) => workspace.id === "personal");
  assert.ok(personal, "PERSONAL_WORKSPACE_FIXTURE_MISSING");
  const { context, page } = await openAccount(auth);
  const release = deferred();
  let workspaceReads = 0;
  let detailReads = 0;
  try {
    await selectWorkspace(page, revoked);
    await switcher(page).filter({ hasText: revokedName }).waitFor();
    const initialDialog = await openWorkspaceDialog(page);
    assert.equal(await initialDialog.getByText(revokedName, { exact: true }).count(), 1, "AUTHORIZED_TEAM_OPTION_MISSING");
    await page.keyboard.press("Escape");

    await page.route(`${browserApi}/me/workspaces`, async (route) => {
      workspaceReads += 1;
      await release.promise;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify([personal]),
      });
    });
    await page.route(`${browserApi}/teams/${revoked.id}`, async (route) => {
      detailReads += 1;
      await release.promise;
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "TEAM_NOT_FOUND" }),
      });
    });

    // Headless Chromium does not change visibilityState when bringToFront switches pages.
    // Drive the public lifecycle contract directly; no React/Redux/private browser seam is used.
    await page.evaluate(() => {
      let lifecycleState = "hidden";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => lifecycleState,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      lifecycleState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settleRender(page);

    await assertNoTeamDisclosure(page, revokedName, "VISIBILITY_REVALIDATION_PENDING");
    assert.equal(
      await page.getByText(revoked.id.slice(0, 8), { exact: false }).count(),
      0,
      "REVOKED_TEAM_ID_VISIBLE_IN_HEADER_DURING_VISIBILITY_REVALIDATION",
    );
    assert.equal(
      await page.getByRole("navigation", { name: "Разделы командного пространства" }).count(),
      0,
      "REVOKED_TEAM_NAV_VISIBLE_DURING_VISIBILITY_REVALIDATION",
    );
    assert.equal(detailReads, 1, "TEAM_DETAIL_VISIBILITY_REVALIDATION_MISSING");
    assert.equal(workspaceReads, 1, "WORKSPACE_LIST_VISIBILITY_REVALIDATION_MISSING");

    const pendingDialog = await openWorkspaceDialog(page);
    assert.equal(
      await pendingDialog.getByText(revokedName, { exact: true }).count(),
      0,
      "REVOKED_TEAM_NAME_VISIBLE_DURING_WORKSPACE_REVALIDATION",
    );
    assert.equal(
      await pendingDialog.getByText(revoked.id.slice(0, 8), { exact: false }).count(),
      0,
      "REVOKED_TEAM_ID_VISIBLE_DURING_WORKSPACE_REVALIDATION",
    );
    assert.equal(await pendingDialog.getByRole("button", { name: "Личное пространство", exact: true }).count(), 1, "PERSONAL_OPTION_CLEARED_DURING_REVALIDATION");
    await page.keyboard.press("Escape");

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await settleRender(page);
    await assertNoTeamDisclosure(page, revokedName, "FOCUS_WHILE_VISIBILITY_REVALIDATION_PENDING");
    assert.equal(detailReads, 1, "TEAM_DETAIL_LIFECYCLE_REVALIDATION_DUPLICATED");
    assert.equal(workspaceReads, 1, "WORKSPACE_LIST_LIFECYCLE_REVALIDATION_DUPLICATED");
    const focusDialog = await openWorkspaceDialog(page);
    assert.equal(await focusDialog.getByText(revokedName, { exact: true }).count(), 0, "REVOKED_TEAM_NAME_REVEALED_AFTER_FOCUS");
    assert.equal(await focusDialog.getByText(revoked.id.slice(0, 8), { exact: false }).count(), 0, "REVOKED_TEAM_ID_REVEALED_AFTER_FOCUS");
    assert.equal(await focusDialog.getByRole("button", { name: "Личное пространство", exact: true }).count(), 1, "PERSONAL_OPTION_CLEARED_AFTER_FOCUS");
    await page.keyboard.press("Escape");

    const listResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/me/workspaces`) && response.status() === 200);
    const deniedResponse = page.waitForResponse((response) =>
      isApiResponse(response, `/teams/${revoked.id}`) && response.status() === 404);
    release.resolve();
    await Promise.all([listResponse, deniedResponse]);
    await page.getByRole("alert", { name: "Команда недоступна" }).waitFor();
    await assertNoTeamDisclosure(page, revokedName, "VISIBILITY_REVALIDATION_DENIED");
    const deniedDialog = await openWorkspaceDialog(page);
    assert.equal(await deniedDialog.getByText(revokedName, { exact: true }).count(), 0, "REVOKED_TEAM_NAME_VISIBLE_AFTER_DENIAL");
    assert.equal(await deniedDialog.getByText(revoked.id.slice(0, 8), { exact: false }).count(), 0, "REVOKED_TEAM_ID_VISIBLE_AFTER_DENIAL");
    assert.equal(await deniedDialog.getByRole("button", { name: "Личное пространство", exact: true }).count(), 1, "PERSONAL_OPTION_MISSING_AFTER_DENIAL");
  } finally {
    release.resolve();
    await context.close();
  }
});
