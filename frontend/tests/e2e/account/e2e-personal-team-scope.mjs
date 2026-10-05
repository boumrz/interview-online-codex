import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
let browser;

async function request(path, auth, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${api}${path}`, {
    method, headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

async function account(displayName = "Владелец личного интервью", isHr = false) {
  return request("/auth/register", null, { nickname: `scope_${randomUUID().replaceAll("-", "").slice(0, 18)}`, displayName, password: "test-password-123", isHr });
}

async function open(auth, path) {
  const context = await browser.newContext();
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem("auth_token", token); localStorage.setItem("auth_user", JSON.stringify(user)); localStorage.setItem("display_name", user.displayName);
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const teamFeatureRequests = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/\/hr-managers(?:\/|$)|\/hr-tracking$|\/hiring-manager-preview$|\/hiring-manager-options$|\/hr-users(?:\/|$)|\/tracks(?:\/|$)|\/vacancies(?:\/|$)/.test(path)) teamFeatureRequests.push(path);
  });
  await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded" });
  return { page, context, teamFeatureRequests };
}

async function noTeamFields(region) {
  assert.equal(await region.getByRole("combobox", { name: /трек|ваканси/i }).count(), 0, "Personal interview has no team-only context pickers");
  assert.equal(await region.getByText(/Внешние нанимающие|Без трека|Без вакансии/).count(), 0, "Personal interview has generic hiring and no team context badges");
}

const contextRequests = requests => requests.filter(path => /\/tracks(?:\/|$)|\/vacancies(?:\/|$)|\/hiring-manager-options$/.test(path));

before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test("personal card and combined editor omit team context and offer generic nickname hiring", { timeout: 45_000 }, async () => {
  const owner = await account();
  const room = await request("/rooms", owner, { title: "Личное без командных полей", taskIds: [] });
  const { page, context, teamFeatureRequests } = await open(owner, "/workspace/personal/interviews");
  try {
    const card = page.getByRole("region", { name: `Личное интервью ${room.title}`, exact: true });
    await card.waitFor();
    await noTeamFields(card);
    await card.getByRole("button", { name: `Редактировать интервью ${room.title}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    await dialog.getByLabel("Имя кандидата", { exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    await noTeamFields(dialog);
    await dialog.getByRole("combobox", { name: "Нанимающий", exact: true }).waitFor();
    assert.deepEqual(contextRequests(teamFeatureRequests), [], "Personal details never read TEAM context or a global hiring directory");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Новый личный кандидат");
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByText("Интервью сохранено", { exact: true }).waitFor();
    assert.equal((await request(`/me/rooms/${room.id}/details`, owner)).candidateName, "Новый личный кандидат");
  } finally { await context.close(); }
});

test("personal room treats an HR-enabled public guest as an ordinary guest interviewer and permits normal role revocation", { timeout: 60_000 }, async () => {
  const owner = await account();
  const guest = await account("Гость с включённым наймом", true);
  const room = await request("/rooms", owner, { title: "Обычный гостевой интервьюер", taskIds: [] });
  const host = await open(owner, `/room/${room.inviteCode}`);
  const visitor = await open(guest, `/room/${room.inviteCode}`);
  try {
    await host.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    await visitor.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    const guestActions = host.page.getByRole("button", { name: new RegExp(`^${guest.user.displayName},`) });
    await guestActions.click();
    assert.equal(await host.page.getByRole("menuitem", { name: /нанимающ/i }).count(), 0, "Personal participant menu never assigns external HR");
    await host.page.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).click();
    await guestActions.locator('[aria-label="Интервьюер"]').waitFor();
    assert.equal(await guestActions.locator('[aria-label="Нанимающий"]').count(), 0, "isHr does not turn a personal guest role into a hiring role");
    assert.equal((await request("/me/rooms", guest)).find(item => item.id === room.id)?.accessRole, "interviewer");
    await guestActions.click();
    assert.equal(await host.page.getByRole("menuitem", { name: /нанимающ/i }).count(), 0);
    await host.page.getByRole("menuitem", { name: "Снять роль интервьюера", exact: true }).click();
    await guestActions.locator('[aria-label="Интервьюер"]').waitFor({ state: "hidden" });
    assert.equal((await request("/me/rooms", guest)).some(item => item.id === room.id), false, "Normal personal role revocation removes durable manager membership");
    const denied = await fetch(`${api}/me/rooms/${room.id}/details`, { headers: { Authorization: `Bearer ${guest.token}` } });
    assert.ok([403, 404].includes(denied.status));
    assert.deepEqual(host.teamFeatureRequests, [], "Host room role actions never use hiring APIs");
    assert.deepEqual(visitor.teamFeatureRequests, [], "HR-enabled personal guest never sends hr-tracking");
  } finally { await Promise.all([host.context.close(), visitor.context.close()]); }
});

test("personal creation and room candidate panel offer generic hiring without TEAM context and preserve candidate editing", { timeout: 60_000 }, async () => {
  const owner = await account();
  const { page, context, teamFeatureRequests } = await open(owner, "/workspace/personal/interviews/new");
  try {
    const dialog = page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await dialog.getByLabel("Название интервью", { exact: true }).waitFor();
    await noTeamFields(dialog);
    await dialog.getByRole("combobox", { name: "Нанимающий", exact: true }).waitFor();
    await dialog.getByLabel("Название интервью", { exact: true }).fill("Личное создание без нанимающих");
    await dialog.getByLabel("Имя кандидата", { exact: true }).fill("Кандидат личного создания");
    const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/rooms");
    await dialog.getByRole("button", { name: "Создать интервью", exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 200);
    const sent = response.request().postDataJSON();
    assert.equal((sent.hiringManagerIds ?? []).length, 0, "An unused optional hiring field creates no assignment");
    assert.ok(!("trackId" in sent) && !("vacancyId" in sent), "Personal creation payload omits TEAM context");
    const room = await response.json();
    await page.waitForURL(`**/room/${room.inviteCode}`);
    await page.getByTestId("room-code-editor-host").locator(".cm-editor").waitFor();
    await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).click();
    const candidateDialog = page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await candidateDialog.getByLabel("Имя кандидата", { exact: true }).waitFor();
    await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    await noTeamFields(candidateDialog);
    await candidateDialog.getByRole("combobox", { name: "Нанимающий", exact: true }).waitFor();
    assert.deepEqual(contextRequests(teamFeatureRequests), [], "Personal creation and room view never request TEAM context or a global hiring directory");
  } finally { await context.close(); }
});

test("team creation retains track, vacancy and nickname hiring picker while edit still assigns external hiring managers", { timeout: 60_000 }, async () => {
  const owner = await account();
  const hiring = await account("Нанимающий команды", true);
  const { team } = await request("/teams", owner, { name: "Команда области интервью" });
  const { interview } = await request(`/teams/${team.id}/interviews`, owner, { title: "Командное интервью с HR", selectedTaskIds: [] });
  const { page, context } = await open(owner, `/workspace/teams/${team.id}/interviews/new`);
  try {
    const create = page.getByRole("dialog", { name: "Создать интервью", exact: true });
    await create.getByRole("combobox", { name: "Трек интервью", exact: true }).waitFor();
    await create.getByRole("combobox", { name: "Вакансия", exact: true }).waitFor();
    await create.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true }).waitFor();
    await create.getByRole("button", { name: "Отмена", exact: true }).click();
    const card = page.getByRole("region", { name: `Командное интервью ${interview.title}`, exact: true });
    await card.getByText("Без трека", { exact: true }).waitFor();
    await card.getByText("Без вакансии", { exact: true }).waitFor();
    await card.getByRole("button", { name: `Редактировать интервью ${interview.title}`, exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Редактировать интервью", exact: true });
    const picker = edit.getByRole("combobox", { name: "Внешний нанимающий (необязательно)", exact: true });
    await picker.fill(hiring.user.nickname);
    await page.locator(".ant-select-item-option").filter({ hasText: hiring.user.displayName }).click();
    await edit.getByRole("button", { name: `Снять роль нанимающего у ${hiring.user.displayName}`, exact: true }).waitFor();
    assert.ok((await request(`/rooms/${interview.inviteCode}/hr-managers`, owner)).some(manager => manager.userId === hiring.user.id));
  } finally { await context.close(); }
});

test("live TEAM hiring grant restores team controls without reload and a revoked late protected room response cannot restore authority", { timeout: 60_000 }, async () => {
  const owner = await account();
  const hiring = await account("Нанимающий с живым назначением", true);
  const { team } = await request("/teams", owner, { name: "Команда живых прав" });
  const { interview } = await request(`/teams/${team.id}/interviews`, owner, { title: "Живое назначение нанимающего", selectedTaskIds: [] });
  const candidateName = "Закрытые сведения живого назначения";
  await request(`/rooms/${interview.inviteCode}/interview-metadata`, owner, { candidateName, position: null, scheduledAt: null, revision: 0 }, "PUT");
  const view = await open(hiring, `/room/${interview.inviteCode}`);
  let releaseLate = () => {};
  try {
    await view.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    assert.equal((await request(`/rooms/${interview.inviteCode}`, hiring)).teamId, null, "Candidate room response does not reveal the private team scope");
    assert.equal(await view.page.getByRole("button", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).count(), 0);
    await view.page.route(`**/api/rooms/${interview.inviteCode}`, route => route.fulfill({ status: 503, json: { error: "Temporary authority refresh failure" } }), { times: 1 });
    await request(`/rooms/${interview.inviteCode}/hr-managers/${hiring.user.id}`, owner, undefined, "PUT");
    const refreshFailure = view.page.getByRole("alert").filter({ hasText: "Не удалось обновить сведения интервью" });
    await refreshFailure.waitFor();
    assert.equal(await view.page.getByRole("button", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).count(), 0, "Failed scope refresh does not expose a personal fallback editor for a team room");
    await refreshFailure.getByRole("button", { name: "Повторить", exact: true }).click();
    const trigger = view.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true });
    await trigger.click();
    const panel = view.page.getByRole("dialog", { name: "Кандидат и нанимающие", exact: true });
    await panel.getByRole("combobox", { name: "Нанимающий", exact: true }).waitFor();
    assert.equal(await panel.getByLabel("Имя кандидата", { exact: true }).inputValue(), candidateName);
    const backlink = view.page.getByRole("link", { name: "Вернуться к списку интервью", exact: true });
    await view.page.waitForFunction(() => document.querySelector('a[aria-label="Вернуться к списку интервью"]')?.getAttribute("href") === "/workspace/personal/candidates");
    await panel.getByRole("button", { name: "Закрыть", exact: true }).first().click();
    await backlink.click();
    await view.page.waitForURL("**/workspace/personal/candidates");
    await view.page.getByRole("heading", { name: "Кандидаты и интервью", exact: true }).waitFor();
    await view.page.goto(`${web}/room/${interview.inviteCode}`, { waitUntil: "domcontentloaded" });
    await trigger.waitFor();
    await request(`/rooms/${interview.inviteCode}/hr-managers/${hiring.user.id}`, owner, undefined, "DELETE");
    await panel.waitFor({ state: "hidden" });
    await trigger.waitFor({ state: "hidden" });

    let signalLate;
    const lateStarted = new Promise(resolve => { signalLate = resolve; });
    const lateGate = new Promise(resolve => { releaseLate = resolve; });
    let heldManagerResponse = false;
    await view.page.route(`**/api/rooms/${interview.inviteCode}`, async route => {
      const authorizedResponse = await route.fetch();
      assert.equal(authorizedResponse.status(), 200);
      const body = await authorizedResponse.json();
      if (!body.canManageRoom || heldManagerResponse) { await route.fulfill({ response: authorizedResponse, json: body }); return; }
      heldManagerResponse = true;
      assert.equal(body.canManageRoom, true, "Held response was authorized before revocation");
      assert.equal(body.teamId, team.id);
      signalLate();
      await lateGate;
      await route.fulfill({ response: authorizedResponse, json: body }).catch(() => {});
    });
    await request(`/rooms/${interview.inviteCode}/hr-managers/${hiring.user.id}`, owner, undefined, "PUT");
    let lateTimer;
    try {
      await Promise.race([lateStarted, new Promise((_, reject) => { lateTimer = setTimeout(() => reject(new Error("A live manager grant did not refresh the protected room response")), 8000); })]);
    } finally { clearTimeout(lateTimer); }
    await request(`/rooms/${interview.inviteCode}/hr-managers/${hiring.user.id}`, owner, undefined, "DELETE");
    await view.page.getByRole("button", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).waitFor({ state: "hidden" });
    releaseLate();
    await view.page.waitForTimeout(300);
    assert.equal(await view.page.getByRole("button", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).count(), 0, "A stale private HTTP response cannot undo a current SSE revocation");
    assert.equal(await view.page.getByRole("dialog", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).count(), 0);
    assert.equal(await view.page.locator(`input[value="${candidateName}"]`).count(), 0, "Revocation and a delayed manager response do not restore private candidate fields");
    const denied = await fetch(`${api}/rooms/${interview.inviteCode}/interview-metadata`, { headers: { Authorization: `Bearer ${hiring.token}` } });
    assert.ok([403, 404].includes(denied.status), "Revoked hiring access is denied directly by the API");
  } finally { releaseLate(); await view.context.close(); }
});

test("TEAM employee room backlink opens the current team interview list", { timeout: 45_000 }, async () => {
  const owner = await account();
  const employee = await account("Коллега команды");
  const { team } = await request("/teams", owner, { name: "Команда ссылки возврата" });
  const { interview } = await request(`/teams/${team.id}/interviews`, owner, { title: "Интервью коллеги", selectedTaskIds: [] });
  const { invitation } = await request(`/teams/${team.id}/invitations`, owner, {});
  const { url } = await request(`/teams/${team.id}/invitations/${invitation.id}/link`, owner);
  await request("/team-invitations/accept", employee, { token: new URL(url, web).hash.slice("#token=".length) });
  const view = await open(employee, `/room/${interview.inviteCode}`);
  try {
    await view.page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    const backlink = view.page.getByRole("link", { name: "Вернуться к списку интервью", exact: true });
    await view.page.waitForFunction(path => document.querySelector('a[aria-label="Вернуться к списку интервью"]')?.getAttribute("href") === path, `/workspace/teams/${team.id}/interviews`);
    await backlink.click();
    await view.page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
    await view.page.getByRole("region", { name: `Командное интервью ${interview.title}`, exact: true }).waitFor();
  } finally { await view.context.close(); }
});

for (const kind of ["PERSONAL", "TEAM"]) {
  test(`anonymous ${kind} live interviewer role preserves allowed surfaces and revoked scope proof denies private access`, { timeout: 60_000 }, async () => {
    const owner = await account();
    const guestName = `Гостевой интервьюер ${kind}`;
    let room, team;
    if (kind === "TEAM") {
      ({ team } = await request("/teams", owner, { name: "Команда гостевого интервьюера" }));
      ({ interview: room } = await request(`/teams/${team.id}/interviews`, owner, { title: "Командная гостевая роль", selectedTaskIds: [] }));
    } else room = await request("/rooms", owner, { title: "Личная гостевая роль", taskIds: [] });
    await request(`/rooms/${room.inviteCode}/tasks`, owner, { customTasks: [{ title: "Гостевой шаг", description: "Разрешённые действия интервьюера", starterCode: "// guest role", language: "nodejs" }] });
    const host = await open(owner, `/room/${room.inviteCode}`);
    const context = await browser.newContext();
    await context.addInitScript(({ code, name }) => localStorage.setItem(`guest_display_name_${code}`, name), { code: room.inviteCode, name: guestName });
    const guest = await context.newPage();
    guest.setDefaultTimeout(8000);
    let currentProof = "";
    const scopeResponses = [];
    guest.on("request", req => {
      if (new URL(req.url()).pathname === `/api/rooms/${room.inviteCode}` && req.method() === "GET") currentProof = req.headers()["x-room-event-token"] ?? currentProof;
    });
    guest.on("response", async response => {
      if (new URL(response.url()).pathname === `/api/rooms/${room.inviteCode}` && response.ok()) scopeResponses.push(await response.json().catch(() => null));
    });
    try {
      await guest.goto(`${web}/room/${room.inviteCode}`, { waitUntil: "domcontentloaded" });
      await guest.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
      await host.page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
      const participant = host.page.getByRole("button", { name: new RegExp(`^${guestName},`) });
      await participant.click();
      await host.page.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).click();
      const label = "Кандидат и нанимающие";
      let panel;
      if (kind === "PERSONAL") {
        await guest.getByRole("button", { name: label, exact: true }).click();
        panel = guest.getByRole("dialog", { name: label, exact: true });
        const candidate = panel.getByLabel("Имя кандидата", { exact: true });
        await candidate.waitFor();
        await noTeamFields(panel);
        assert.ok(currentProof, "Live anonymous scope refresh uses its current ephemeral SSE proof");
        assert.ok(scopeResponses.some(body => body?.canManageRoom && body.teamId === null), "Personal room GET recognizes the currently allowed anonymous metadata authority");
        await candidate.fill("Сведения гостя PERSONAL");
        await panel.getByRole("button", { name: "Сохранить сведения", exact: true }).click();
        await guest.getByText("Сведения сохранены", { exact: true }).waitFor();
        assert.equal((await request(`/rooms/${room.inviteCode}/interview-metadata`, owner)).candidateName, "Сведения гостя PERSONAL");
      } else {
        const notes = guest.getByRole("textbox", { name: "Заметка интервьюера", exact: true });
        const showNotes = async () => {
          const notesTab = guest.getByRole("tab", { name: "Мои заметки", exact: true });
          await notes.or(notesTab).first().waitFor();
          if (!await notes.isVisible()) await notesTab.click();
          await notes.waitFor();
        };
        await showNotes();
        await notes.fill("Гостевая заметка TEAM");
        await notes.press("Enter");
        await guest.locator('article[data-private-note-delivery-state="persisted"]').getByText("Гостевая заметка TEAM", { exact: true }).waitFor();
        assert.equal(await guest.getByRole("button", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).count(), 0, "TEAM anonymous realtime role does not imply HTTP metadata or hiring authority");
        assert.ok(currentProof, "Anonymous role refresh sends its ephemeral proof while keeping the TEAM HTTP boundary");
        const httpScope = await fetch(`${api}/rooms/${room.inviteCode}`, { headers: { "X-Room-Event-Token": currentProof } });
        const scopedRoom = await httpScope.json();
        assert.equal(scopedRoom.canManageRoom, false);
        assert.equal(scopedRoom.teamId, null);
        const unavailable = await fetch(`${api}/rooms/${room.inviteCode}/interview-metadata`, { headers: { "X-Room-Event-Token": currentProof } });
        assert.ok([403, 404].includes(unavailable.status));
        await participant.click();
        await host.page.getByRole("menuitem", { name: "Снять роль интервьюера", exact: true }).click();
        await notes.waitFor({ state: "hidden" });
        await participant.click();
        await host.page.getByRole("menuitem", { name: "Назначить интервьюером", exact: true }).click();
        await showNotes();
        await guest.locator('article[data-private-note-delivery-state="persisted"]').getByText("Гостевая заметка TEAM", { exact: true }).waitFor();
        assert.equal(await guest.getByRole("button", { name: /Кандидат и нанимающие|Сведения о кандидате/ }).count(), 0, "Repeated realtime grant does not widen the HTTP scope");
      }
      const formerManagerProof = currentProof;
      assert.equal(await guest.evaluate(proof => [localStorage, sessionStorage].some(storage => Object.values(storage).some(value => value.includes(proof))), formerManagerProof), false, "Ephemeral room proof is not written to browser recovery storage");
      await participant.click();
      await host.page.getByRole("menuitem", { name: "Снять роль интервьюера", exact: true }).click();
      if (panel) await panel.waitFor({ state: "hidden" });
      else await guest.getByRole("textbox", { name: "Заметка интервьюера", exact: true }).waitFor({ state: "hidden" });
      await guest.getByRole("button", { name: label, exact: true }).waitFor({ state: "hidden" });
      const staleScope = await fetch(`${api}/rooms/${room.inviteCode}`, { headers: { "X-Room-Event-Token": formerManagerProof } });
      assert.equal(staleScope.status, 200);
      const candidateScope = await staleScope.json();
      assert.equal(candidateScope.canManageRoom, false, "Former anonymous grant is checked against current server authority");
      assert.equal(candidateScope.teamId, null);
      const denied = await fetch(`${api}/rooms/${room.inviteCode}/interview-metadata`, { headers: { "X-Room-Event-Token": formerManagerProof } });
      assert.ok([403, 404].includes(denied.status), "The old anonymous proof cannot read private candidate details after demotion");
    } finally { await Promise.all([context.close(), host.context.close()]); }
  });
}

test("unknown room public 404 shows an unavailable state before guest name entry and never starts realtime", { timeout: 30_000 }, async () => {
  const inviteCode = `missing-${randomUUID()}`;
  assert.equal((await fetch(`${api}/rooms/${inviteCode}`)).status, 404);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const realtimeRequests = [];
  page.on("request", req => {
    if (new URL(req.url()).pathname.startsWith(`/api/realtime/rooms/${inviteCode}/`)) realtimeRequests.push(req.method());
  });
  try {
    await page.goto(`${web}/room/${inviteCode}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("room-realtime-unavailable").waitFor();
    await page.getByText("Комната недоступна", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Ваше имя", { exact: true }).count(), 0, "An unavailable invite does not ask for a guest name");
    assert.equal(await page.getByTestId("room-code-editor-host").count(), 0);
    assert.equal(await page.getByText("Загрузка комнаты...", { exact: true }).count(), 0, "A rejected HTTP lookup does not remain in a loading state");
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForTimeout(300);
    assert.deepEqual(realtimeRequests, [], "A public HTTP refusal stays terminal without stream admission or reconnect traffic");
  } finally { await context.close(); }
});
