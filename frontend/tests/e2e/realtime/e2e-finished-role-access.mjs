import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright';

const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const liveWrites = new Set(['yjs_update', 'code_update', 'language_update', 'briefing_markdown_update', 'manager_workspace_yjs_update', 'manager_workspace_language_update']);

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `own fixture ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

async function account(displayName, isHr = false) {
  return request('/auth/register', {
    method: 'POST',
    body: { nickname: `qa_role_${randomUUID().slice(0, 12).replaceAll('-', '')}`, displayName, isHr, password: 'test-password-123' },
  });
}

async function createRoom(owner) {
  const room = await request('/rooms', { token: owner.token, method: 'POST', body: { title: 'Finished role access QA', taskIds: [] } });
  await request(`/rooms/${room.inviteCode}/tasks`, {
    token: owner.token, method: 'POST',
    body: { customTasks: [{ title: 'Задача проверки ролей', description: 'Сохраните ответ.', starterCode: 'const answer = 1;', language: 'nodejs' }] },
  });
  return room;
}

async function openRoom(browser, room, auth, guestName = 'Гость проверки доступа') {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
  await context.addInitScript(({ auth, inviteCode, guestName }) => {
    if (auth) {
      localStorage.setItem('auth_token', auth.token);
      localStorage.setItem('auth_user', JSON.stringify(auth.user));
      localStorage.setItem('display_name', auth.user.displayName);
    } else localStorage.setItem(`guest_display_name_${inviteCode}`, guestName);
  }, { auth, inviteCode: room.inviteCode, guestName });
  const page = await context.newPage();
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.getByTestId('room-code-editor-host').locator('.cm-content').waitFor();
  return page;
}

async function changeInterviewer(ownerPage, actor, grant) {
  const label = grant ? 'Назначить интервьюером' : 'Снять роль интервьюера';
  await ownerPage.getByRole('button', { name: new RegExp(`${actor.user.displayName},.*Открыть доступные действия участника`) }).click();
  const response = ownerPage.waitForResponse(result => result.url().endsWith('/events')
    && result.request().postDataJSON()?.type === (grant ? 'grant_interviewer_access' : 'revoke_interviewer_access'));
  await ownerPage.getByRole('menuitem', { name: label, exact: true }).click();
  assert.ok((await response).ok(), `${label} must be authorized for the owner`);
}

async function finishedStatus(page, readonly) {
  const status = page.getByTestId('room-lifecycle-status');
  await status.waitFor();
  assert.equal(await status.getAttribute('data-room-status'), 'finished');
  assert.match(await status.innerText(), /Интервью завершено/);
  assert.equal((await status.innerText()).includes('Только просмотр'), readonly);
}

async function editorText(page) {
  return page.getByTestId('room-code-editor-host').evaluate(host => host.__roomEditorView.state.doc.toString());
}

for (const role of ['interviewer', 'assigned HR']) {
  test(`finished ${role} edits and syncs while an unassigned HR and guest only view`, async () => {
    const owner = await account('Владелец проверки');
    const actor = await account(role === 'assigned HR' ? 'Назначенный нанимающий' : 'Назначенный интервьюер', role === 'assigned HR');
    const unassignedHr = await account('Неназначенный нанимающий', true);
    const room = await createRoom(owner);
    if (role === 'assigned HR') await request(`/rooms/${room.inviteCode}/hr-managers/${actor.user.id}`, { token: owner.token, method: 'PUT' });
    const browser = await chromium.launch();
    try {
      const ownerPage = await openRoom(browser, room, owner);
      const managerPage = await openRoom(browser, room, actor);
      const unassignedPage = await openRoom(browser, room, unassignedHr);
      const guestPage = await openRoom(browser, room, null);
      if (role === 'interviewer') await changeInterviewer(ownerPage, actor, true);
      await managerPage.getByRole('button', { name: 'Кандидат и нанимающие', exact: true }).waitFor();
      assert.equal((await request(`/rooms/${room.inviteCode}`, { token: actor.token })).role, 'interviewer', 'assignment confers the existing room role');
      await request(`/rooms/${room.inviteCode}/verdict`, { token: owner.token, method: 'POST', body: { verdict: 'HIRE' } });
      for (const manager of [ownerPage, managerPage]) {
        await finishedStatus(manager, false);
        assert.equal(await manager.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'true');
      }
      for (const viewer of [unassignedPage, guestPage]) {
        await finishedStatus(viewer, true);
        assert.equal(await viewer.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'false');
        const language = viewer.getByRole('combobox', { name: 'Язык комнаты', exact: true });
        assert.ok(await language.count() === 0 || await language.isDisabled(), 'viewer cannot change the room language');
        assert.equal(await viewer.getByRole('button', { name: 'Кандидат и нанимающие', exact: true }).count(), 0);
      }
      assert.equal((await request(`/rooms/${room.inviteCode}`, { token: unassignedHr.token })).role, 'candidate', 'global HR capability does not confer room management');
      const text = `const finishedRole = '${role}';`;
      const accepted = managerPage.waitForResponse(response => response.url().endsWith('/events')
        && response.request().postDataJSON()?.type === 'yjs_update'
        && response.request().postDataJSON()?.code === text);
      await managerPage.getByTestId('room-code-editor-host').locator('.cm-content').fill(text);
      assert.ok((await accepted).ok(), `finished ${role} update must be accepted`);
      for (const peer of [ownerPage, unassignedPage, guestPage]) {
        await peer.waitForFunction(text => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === text, text);
      }
      await managerPage.reload();
      await finishedStatus(managerPage, false);
      await managerPage.getByTestId('room-code-editor-host').locator('.cm-content').waitFor();
      assert.equal(await editorText(managerPage), text, 'finished manager change survives reload');
    } finally { await browser.close(); }
  });
}

test('owner revokes a finished interviewer without reload and retains owner editing', async () => {
  const owner = await account('Владелец отзыва доступа');
  const actor = await account('Интервьюер для отзыва');
  const room = await createRoom(owner);
  const browser = await chromium.launch();
  try {
    const ownerPage = await openRoom(browser, room, owner);
    const actorPage = await openRoom(browser, room, actor);
    await changeInterviewer(ownerPage, actor, true);
    await actorPage.getByRole('button', { name: 'Кандидат и нанимающие', exact: true }).waitFor();
    await request(`/rooms/${room.inviteCode}/verdict`, { token: owner.token, method: 'POST', body: { verdict: 'HIRE' } });
    await finishedStatus(actorPage, false);
    await changeInterviewer(ownerPage, actor, false);
    await actorPage.getByTestId('room-code-editor-host').locator('.cm-content[contenteditable="false"]').waitFor();
    await finishedStatus(actorPage, true);
    assert.equal((await request(`/rooms/${room.inviteCode}`, { token: actor.token })).role, 'candidate');
    assert.equal(await actorPage.getByRole('button', { name: 'Кандидат и нанимающие', exact: true }).count(), 0);
    assert.equal(await ownerPage.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'true');
    assert.equal(await ownerPage.getByRole('combobox', { name: 'Язык комнаты', exact: true }).isDisabled(), false);
    const before = await editorText(actorPage);
    const writes = [];
    actorPage.on('request', req => {
      if (req.url().endsWith('/events') && liveWrites.has(req.postDataJSON()?.type)) writes.push(req.postDataJSON().type);
    });
    await actorPage.getByTestId('room-code-editor-host').locator('.cm-content').click();
    await actorPage.keyboard.type('must not be written');
    await actorPage.waitForTimeout(5500);
    assert.equal(await editorText(actorPage), before, 'revoked participant cannot type into the finished document');
    assert.deepEqual(writes, [], 'revoked participant stops local and heartbeat writes');
  } finally { await browser.close(); }
});
