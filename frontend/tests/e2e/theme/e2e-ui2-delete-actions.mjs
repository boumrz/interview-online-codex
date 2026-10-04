import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
async function request(path, token, body, method = 'POST') {
  const response = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function fixture(role) {
  const auth = await request('/auth/register', null, { nickname: `ui2_del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, displayName: 'Проверка удаления', password: 'ui2-password-123' });
  if (role) auth.user = { ...auth.user, role };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  return { auth, browser, page };
}
async function assertDeleteControl(button) {
  await button.waitFor();
  assert.equal((await button.textContent()).trim(), '', 'row deletion must be an icon without a text label');
  assert.ok(await button.getAttribute('title'), 'icon deletion must have a tooltip');
  assert.equal(await button.locator('svg').count(), 1);
  assert.equal(await button.evaluate(el => [...el.parentElement.querySelectorAll('button')].at(-1) === el), true, 'deletion is last in its action group');
}
async function assertConfirmation(page, button, name, confirmName = 'Удалить') {
  await button.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.waitFor();
  const confirm = dialog.getByRole('button', { name: confirmName, exact: true });
  assert.equal(await confirm.locator('svg').count(), 1, 'confirmation retains the trash icon beside the action text');
  assert.equal(await confirm.evaluate(el => [...el.parentElement.querySelectorAll('button')].at(-1) === el), true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { localStorage.setItem('interview-online:ui-theme', value); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: value })); }, theme);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    await page.waitForTimeout(550);
    const colors = async locator => locator.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    assert.deepEqual(await colors(confirm), await colors(button), `${theme}: trigger and confirmation use the same danger surface`);
  }
  return { dialog, confirm };
}

test('admin deletion preserves protected users, cancellation, pending and failed confirmation', async () => {
  const { auth, browser, page } = await fixture('admin');
  try {
    const own = { ...auth.user, role: 'admin', isSystemAdmin: false, createdAt: new Date().toISOString() };
    const target = { ...own, id: randomUUID(), nickname: 'ui2_delete_target', role: 'user' };
    const protectedUser = { ...own, id: randomUUID(), nickname: 'ui2_protected', isSystemAdmin: true };
    let users = [own, target, protectedUser];
    await page.route('**/api/me/profile', route => route.fulfill({ json: own }));
    await page.route('**/api/admin/users', route => route.fulfill({ json: users }));
    await page.goto(`${web}/dashboard/admin`, { waitUntil: 'networkidle' });
    const button = page.getByRole('button', { name: `Удалить пользователя @${target.nickname}`, exact: true });
    await assertDeleteControl(button);
    assert.equal(await page.getByRole('button', { name: `Удалить пользователя @${own.nickname}`, exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: `Удалить пользователя @${protectedUser.nickname}`, exact: true }).isDisabled(), true);
    let { dialog } = await assertConfirmation(page, button, 'Удалить пользователя?');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, `Удалить пользователя @${target.nickname}`);
    const route = `**/api/admin/users/${target.id}`;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(route, async route => { await gate; await route.fulfill({ status: 500, json: { error: 'delete fixture failure' } }); });
    ({ dialog } = await assertConfirmation(page, button, 'Удалить пользователя?'));
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.waitForFunction(button => button.disabled, await dialog.getByRole('button', { name: 'Отмена', exact: true }).elementHandle());
    assert.equal(await dialog.getByRole('button', { name: 'Отмена', exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name: 'Удалить', exact: true }).isDisabled(), true);
    release();
    await dialog.getByRole('alert').waitFor();
    await page.unroute(route);
    await page.route(route, async route => { users = users.filter(user => user.id !== target.id); await route.fulfill({ json: { status: 'ok' } }); });
    await dialog.getByRole('button', { name: 'Удалить', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await button.waitFor({ state: 'hidden' });
  } finally { await browser.close(); }
});

test('direct admin route waits for the current profile and refuses a non-admin profile', async () => {
  const { auth, browser, page } = await fixture('admin');
  try {
    // A cached identity must not grant admin access while the server profile resolves.
    let releaseProfile;
    const gate = new Promise(resolve => { releaseProfile = resolve; });
    let adminRequests = 0;
    await page.route('**/api/me/profile', async route => {
      await gate;
      await route.fulfill({ json: { ...auth.user, role: 'user' } });
    });
    await page.route('**/api/admin/users', route => { adminRequests++; return route.fulfill({ json: [] }); });
    await page.goto(`${web}/dashboard/admin`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Загрузка профиля...', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/dashboard/admin', 'pending profile retains the requested route');
    assert.equal(await page.getByText('Админка пользователей', { exact: true }).count(), 0);
    assert.equal(adminRequests, 0, 'admin data is not requested before fresh profile authority');
    releaseProfile();
    await page.waitForURL('**/workspace/personal/interviews');
    assert.equal(await page.getByText('Админка пользователей', { exact: true }).count(), 0);
    assert.equal(adminRequests, 0, 'a non-admin profile cannot request admin data');
  } finally { await browser.close(); }
});

test('task set deletion keeps an icon trigger and matching modal danger action', async () => {
  const { auth, browser, page } = await fixture();
  try {
    const preset = await request('/me/presets', auth.token, { name: 'Удаление набора UI.2', taskTemplateIds: [] });
    await page.goto(`${web}/workspace/personal/library?tab=sets`, { waitUntil: 'networkidle' });
    const button = page.getByRole('button', { name: `Удалить набор ${preset.name}`, exact: true });
    await assertDeleteControl(button);
    const { dialog, confirm } = await assertConfirmation(page, button, 'Удалить набор?');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await button.click();
    await confirm.click();
    await dialog.waitFor({ state: 'hidden' });
    await button.waitFor({ state: 'hidden' });
  } finally { await browser.close(); }
});

test('room step deletion uses a direct trash icon and retains the last-task guard', async () => {
  const { auth, browser, page } = await fixture();
  try {
    const tasks = [];
    for (const title of ['Первый шаг UI.2', 'Второй шаг UI.2']) tasks.push(await request('/me/tasks', auth.token, { title, language: 'nodejs' }));
    const room = await request('/rooms', auth.token, { title: 'Удаление шага UI.2', taskIds: tasks.map(task => task.id) });
    await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('room-code-editor-host').locator('.cm-editor').waitFor();
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    const button = page.getByRole('button', { name: 'Удалить задачу Второй шаг UI.2', exact: true }).filter({ visible: true });
    await assertDeleteControl(button);
    const { dialog, confirm } = await assertConfirmation(page, button, 'Удалить задачу?');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await button.click();
    await confirm.click();
    await dialog.waitFor({ state: 'hidden' });
    await button.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Удалить задачу Первый шаг UI.2', exact: true }).filter({ visible: true }).isDisabled(), true);
  } finally { await browser.close(); }
});

test('team member deletion is last in management actions and requires explicit modal confirmation', async () => {
  const { auth, browser, page } = await fixture();
  try {
    const result = await request('/teams', auth.token, { name: 'Удаление участника UI.2' });
    const team = result.team ?? result;
    const targetId = randomUUID();
    await page.route(`**/api/teams/${team.id}/members?*`, route => route.fulfill({ json: { items: [
      { userId: auth.user.id, displayName: auth.user.displayName, role: 'OWNER', state: 'ACTIVE', revision: 1 },
      { userId: targetId, displayName: 'Участник для проверки', role: 'MEMBER', state: 'ACTIVE', revision: 1 },
    ], total: 2, page: 0, size: 100 } }));
    await page.goto(`${web}/workspace/teams/${team.id}/settings`, { waitUntil: 'networkidle' });
    const button = page.getByRole('button', { name: 'Удалить участника', exact: true }).and(page.getByTitle('Удалить участника', { exact: true }));
    await assertDeleteControl(button);
    const { dialog } = await assertConfirmation(page, button, 'Удалить участника из команды', 'Удалить участника');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await button.waitFor();
  } finally { await browser.close(); }
});
