import "../support/require-isolated-api.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const api = process.env.E2E_API_URL ?? "http://localhost:8080/api";
const web = process.env.E2E_BASE_URL ?? "http://localhost:5173";
let browser;

async function request(path, { token, method = "GET", body, status = 200, headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "GET" ? {} : { "Idempotency-Key": randomUUID() }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

async function account(displayName) {
  return request("/auth/register", {
    method: "POST",
    body: { nickname: `qa_link_${randomUUID().replaceAll("-", "").slice(0, 16)}`, displayName, password: "test-password-123", isHr: false },
  });
}

async function fixture({ member = false } = {}) {
  const owner = await account("Создатель проверки ссылки");
  const actor = await account("Участник проверки ссылки");
  const { team } = await request("/teams", { token: owner.token, method: "POST", status: 201, body: { name: `Команда ссылки ${randomUUID().slice(0, 8)}` } });
  if (member) {
    const { invitation } = await request(`/teams/${team.id}/invitations`, { token: owner.token, method: "POST", status: 201, body: {} });
    const { url } = await request(`/teams/${team.id}/invitations/${invitation.id}/link`, { token: owner.token });
    const invitationToken = new URLSearchParams(new URL(url, web).hash.slice(1)).get("token");
    assert.ok(invitationToken, "Own team invitation must contain its acceptance token");
    await request("/team-invitations/accept", { token: actor.token, method: "POST", body: { token: invitationToken } });
  }
  const { task } = await request(`/teams/${team.id}/tasks`, {
    token: owner.token, method: "POST", status: 201,
    body: { title: "Публичная задача", description: "Решите задачу", starterCode: "const answer = 1;", language: "nodejs" },
  });
  const { interview: room } = await request(`/teams/${team.id}/interviews`, {
    token: owner.token, method: "POST", status: 201,
    body: { title: "Проверка доступа по ссылке", selectedTaskIds: [task.id] },
  });
  return { owner, actor, team, room };
}

async function openRoom(room, auth) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ auth, code }) => {
    if (auth) {
      localStorage.setItem("auth_token", auth.token);
      localStorage.setItem("auth_user", JSON.stringify(auth.user));
      localStorage.setItem("display_name", auth.user.displayName);
    } else localStorage.setItem(`guest_display_name_${code}`, "Гость проверки ссылки");
  }, { auth, code: room.inviteCode });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${web}/room/${room.inviteCode}`);
  await connected(page);
  return { context, page };
}

async function connected(page) {
  await page.getByTestId("room-code-editor-host").waitFor();
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  assert.equal(await page.getByText("Комната недоступна", { exact: true }).count(), 0);
}

function candidateSnapshot(snapshot) {
  assert.equal(snapshot.role, "candidate");
  assert.equal(snapshot.canManageRoom, false);
  assert.equal(snapshot.canGrantAccess, false);
  assert.equal(snapshot.notes, "", "Public candidate snapshot must not contain interviewer notes");
  assert.deepEqual(snapshot.notesMessages ?? [], []);
  assert.equal(snapshot.ownerToken ?? null, null);
  assert.equal(snapshot.interviewerToken ?? null, null);
}

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("anonymous and unrelated signed-in candidates enter a team room and reload its realtime stream", { timeout: 90000 }, async () => {
  const { actor, room } = await fixture();
  for (const auth of [null, actor]) {
    candidateSnapshot(await request(`/rooms/${room.inviteCode}`, { token: auth?.token }));
    const { context, page } = await openRoom(room, auth);
    try {
      assert.equal(await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
      await page.reload();
      await connected(page);
      assert.equal(await page.getByRole("region", { name: "Мои заметки", exact: true }).count(), 0);
      await request(`/rooms/${room.inviteCode}/interview-metadata`, { token: auth?.token, status: 403 });
    } finally { await context.close(); }
  }
});

test("an unassigned active team member manages an interview and sees candidates without the hiring flag", { timeout: 90000 }, async () => {
  const { actor, team, room } = await fixture({ member: true });
  const snapshot = await request(`/rooms/${room.inviteCode}`, { token: actor.token });
  assert.equal(snapshot.role, "interviewer");
  assert.equal(snapshot.canManageRoom, true);
  const candidates = await request(`/me/hr/rooms?teamId=${team.id}`, { token: actor.token });
  assert.ok(candidates.items.some(item => item.roomId === room.id));
  const { context, page } = await openRoom(room, actor);
  try {
    await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
    await page.reload();
    await connected(page);
    await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).waitFor();
  } finally { await context.close(); }
});

test("a former team member retains public candidate access to a finished room with no private authority", { timeout: 90000 }, async () => {
  const { owner, actor, team, room } = await fixture({ member: true });
  await request(`/teams/${team.id}/leave`, { token: actor.token, method: "POST" });
  await request(`/rooms/${room.inviteCode}/verdict`, { token: owner.token, method: "POST", body: { verdict: "HIRE" } });
  candidateSnapshot(await request(`/rooms/${room.inviteCode}`, {
    token: actor.token, headers: { "X-Room-Owner-Token": "stale-personal-credential" },
  }));
  await request(`/me/hr/rooms?teamId=${team.id}`, { token: actor.token, status: 404 });
  const { context, page } = await openRoom(room, actor);
  try {
    await page.locator('[data-testid="room-lifecycle-status"][data-room-status="finished"]').waitFor();
    await page.getByTestId("room-code-editor-host").locator('.cm-content[contenteditable="false"]').waitFor();
    assert.equal(await page.getByRole("button", { name: "Кандидат и нанимающие", exact: true }).count(), 0);
    await page.reload();
    await connected(page);
  } finally { await context.close(); }
});
