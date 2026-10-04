import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
async function request(path, token, body) {
  const result = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(result.ok, `fixture ${path}: ${result.status}`);
  return result.json();
}
for (const fixture of ['empty', 'steps']) test(`room language persists and keeps code, tabs and hover stable: ${fixture}`, async () => {
  const auth = await request('/auth/register', null, { nickname: `ui2_lang_${Date.now()}`, displayName: 'UI2 владелец', password: 'ui2-password-123' });
  const room = fixture === 'empty'
    ? await request('/rooms', auth.token, { title: 'UI2 язык без задач', taskTemplateIds: [] })
    : await request('/public/rooms', null, { title: 'UI2 язык шагов', ownerDisplayName: 'UI2 владелец', language: 'nodejs' });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
    await context.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }, auth);
    await context.addInitScript(({ inviteCode, ownerToken }) => { localStorage.setItem(`owner_token_${inviteCode}`, ownerToken); localStorage.setItem(`guest_display_name_${inviteCode}`, 'UI2 владелец'); }, room);
    const page = await context.newPage();
    await page.goto(`${web}/room/${room.inviteCode}`);
    const host = page.getByTestId('room-code-editor-host');
    await host.locator('.cm-content').waitFor();
    const original = await host.locator('.cm-content').innerText();
    for (const [value, label] of [['python', 'Python'], ['java', 'Java'], ['nodejs', 'Node JS']]) {
      await page.getByRole('combobox', { name: 'Язык комнаты' }).click();
      await page.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^${label}$`) }).click();
      await page.waitForFunction(label => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes(label), label, { timeout: 5000 });
      await page.waitForFunction(value => { const state = document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView.state; return Array.from(state.config.compartments.values()).some(extension => extension?.language?.name === value); }, value === 'nodejs' ? 'javascript' : value, { timeout: 5000 });
      assert.equal(await host.locator('.cm-content').innerText(), original);
    }
    if (fixture === 'steps') {
      await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
      await page.getByTestId('room-step-row-1').click();
      await page.getByRole('combobox', { name: 'Язык комнаты' }).click();
      await page.locator('.ant-select-item-option').filter({ hasText: /^SQL$/ }).click();
      await page.waitForFunction(() => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes('SQL'));
      await page.waitForFunction(() => { const state = document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView.state; return Array.from(state.config.compartments.values()).some(extension => extension?.language?.name === 'sql'); });
      await page.getByTestId('room-step-row-0').click();
      await page.waitForFunction(() => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes('Node JS'));
      await page.getByTestId('room-step-row-1').click();
      await page.waitForFunction(() => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes('SQL'));
      await page.getByTestId('room-step-row-0').click();
    }
    await page.getByRole('combobox', { name: 'Язык комнаты' }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: /^Python$/ }).click();
    await page.waitForFunction(() => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes('Python'));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes('Python'));
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => { localStorage.setItem('interview-online:ui-theme', mode); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode })); }, mode);
      await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
      const tab = page.getByRole('tab', { name: 'Мои заметки', exact: true });
      await page.mouse.move(0, 0);
      const before = await tab.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
      await tab.hover();
      assert.deepEqual(await tab.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })), before);
      await page.getByRole('button', { name: 'Кто видит мои заметки', exact: true }).waitFor();
    }
  } finally { await browser.close(); }
});
test('background access check retains unsaved team form and genuine revocation removes it', async () => {
  const auth = await request('/auth/register', null, { nickname: `ui2_focus_${Date.now()}`, displayName: 'UI2 focus', password: 'ui2-password-123' });
  const { team } = await request('/teams', auth.token, { name: 'UI2 focus team' });
  await request(`/teams/${team.id}/tasks`, auth.token, { title: 'UI2 черновик', description: '', starterCode: '', language: 'nodejs' });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
    await context.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }, auth);
    const page = await context.newPage();
    await page.goto(`${web}/workspace/teams/${team.id}/library`);
    try {
      await page.getByRole('button', { name: 'Редактировать задачу UI2 черновик', exact: true }).click();
    } catch (error) {
      throw new Error(`Library did not hydrate: ${await page.locator('body').innerText()}\n${error.message}`);
    }
    const dialog = page.getByRole('dialog', { name: 'Редактировать задачу', exact: true });
    const field = dialog.getByLabel('Новое название задачи', { exact: true });
    await field.fill('Несохранённое название');
    let enteredRequest, releaseRequest;
    const entered = new Promise(resolve => { enteredRequest = resolve; });
    const release = new Promise(resolve => { releaseRequest = resolve; });
    await page.route(`**/api/teams/${team.id}`, async route => { enteredRequest(); await release; await route.continue(); }, { times: 1 });
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await entered;
    assert.equal(await dialog.isVisible(), true, 'background refresh must retain dialog');
    assert.equal(await field.inputValue(), 'Несохранённое название');
    const refreshed = page.waitForResponse(response => response.url().endsWith(`/api/teams/${team.id}`) && response.status() === 200);
    releaseRequest();
    await refreshed;
    assert.equal(await field.inputValue(), 'Несохранённое название');
    await page.route(`**/api/teams/${team.id}`, route => route.fulfill({ status: 503, json: { message: 'temporary' } }), { times: 1 });
    const failedRefresh = page.waitForResponse(response => response.url().endsWith(`/api/teams/${team.id}`) && response.status() === 503);
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await failedRefresh;
    await page.getByText('Не удалось обновить доступ к команде', { exact: true }).waitFor();
    assert.equal(await dialog.isVisible(), true, 'transient server failures keep draft');
    assert.equal(await field.inputValue(), 'Несохранённое название');
    await page.route(`**/api/teams/${team.id}`, route => route.fulfill({ status: 403, json: { message: 'revoked' } }), { times: 1 });
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await dialog.waitFor({ state: 'hidden' });
  } finally { await browser.close(); }
});
test('room step renaming opens from a pencil next to its title', async () => {
  const room = await request('/public/rooms', null, { title: 'UI2 карандаш', ownerDisplayName: 'UI2 владелец', language: 'nodejs' });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
    await context.addInitScript(({ inviteCode, ownerToken }) => { localStorage.setItem(`owner_token_${inviteCode}`, ownerToken); localStorage.setItem(`guest_display_name_${inviteCode}`, 'UI2 владелец'); }, room);
    const page = await context.newPage();
    await page.goto(`${web}/room/${room.inviteCode}`);
    await page.getByTestId('room-code-editor-host').waitFor();
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    const pencil = page.getByTestId('room-task-rename-0');
    assert.equal(await pencil.count(), 1, 'step has a direct pencil instead of menu-only rename');
    assert.equal(await pencil.getAttribute('type'), 'button');
    const row = page.getByTestId('room-step-row-0');
    const [titleBox, pencilBox] = await Promise.all([row.locator(':scope > span').nth(1).boundingBox(), pencil.boundingBox()]);
    assert.ok(pencilBox.x >= titleBox.x + titleBox.width && pencilBox.x - titleBox.x - titleBox.width <= 16);
    await pencil.click();
    const dialog = page.getByRole('dialog', { name: 'Переименовать задачу', exact: true });
    await dialog.getByTestId('room-task-rename-input').fill('Новый шаг UI2');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByTestId('room-step-row-0').filter({ hasText: 'Новый шаг UI2' }).waitFor();
  } finally { await browser.close(); }
});
