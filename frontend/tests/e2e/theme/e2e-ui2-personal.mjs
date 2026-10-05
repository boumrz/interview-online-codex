import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';

test('guest creation is modal and login fields explain expected input', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Запускайте интервью за 30 секунд.' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Название комнаты' }).count(), 0, 'creation fields must not be inline');
    await page.getByRole('button', { name: 'Создать комнату', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Создать комнату' });
    await dialog.waitFor();
    assert.ok(await dialog.getByRole('textbox', { name: 'Название комнаты' }).getAttribute('placeholder'));
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    for (const name of ['Ник', 'Пароль']) assert.ok(await page.getByLabel(name, { exact: true }).getAttribute('placeholder'), `${name} needs a useful placeholder`);
    await page.getByText('Регистрация', { exact: true }).click();
    assert.equal(await page.getByLabel('Имя', { exact: true }).getAttribute('placeholder'), null);
    assert.match(await page.getByLabel('Пароль', { exact: true }).getAttribute('placeholder'), /6/);
  } finally { await browser.close(); }
});

test('personal unified edit uses a modal, preserves failed draft and saves via Enter', async () => {
  const register = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `ui2_${Date.now()}`, displayName: 'Проверка UI.2', password: 'ui2-password-123' }) });
  assert.equal(register.status, 200);
  const auth = await register.json();
  const roomResponse = await fetch(`${api}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ title: 'UI.2 личное интервью', taskTemplateIds: [] }) });
  assert.ok(roomResponse.ok, await roomResponse.text().then(text => roomResponse.ok ? '' : text));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }, auth);
    const page = await context.newPage();
    await page.goto(`${base}/workspace/personal/interviews`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Редактировать интервью UI.2 личное интервью' }).click();
    const dialog = page.getByRole('dialog', { name: 'Редактировать интервью', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Название интервью', { exact: true }).count(), 1);
    const input = dialog.getByRole('textbox', { name: 'Название интервью' });
    assert.ok(await input.getAttribute('placeholder'));
    const route = '**/api/me/rooms/*/details';
    await page.route(route, request => request.request().method() === 'PATCH' ? request.fulfill({ status: 500, json: { error: 'test failure' } }) : request.continue());
    await input.fill('UI.2 новое название');
    await input.press('Enter');
    await dialog.getByRole('alert').waitFor();
    assert.equal(await input.inputValue(), 'UI.2 новое название');
    await page.unroute(route);
    await input.press('Enter');
    await page.getByText('Интервью сохранено', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('UI.2 новое название', { exact: true }).waitFor();
    await page.goto(`${base}/profile`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('textbox').count(), 0, 'profile fields must be modal');
    await page.getByRole('button', { name: 'Изменить имя', exact: true }).click();
    const profileDialog = page.getByRole('dialog', { name: 'Изменить имя' });
    await profileDialog.waitFor();
    await profileDialog.getByRole('button', { name: 'Отмена' }).click();
  } finally { await browser.close(); }
});

test('personal library modals show retryable errors and preserve drafts', async () => {
  const register = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `ui2_library_${Date.now()}`, displayName: 'Библиотека UI.2', password: 'ui2-password-123' }) });
  assert.equal(register.status, 200);
  const auth = await register.json();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }, auth);
    const page = await context.newPage();
    await page.goto(`${base}/workspace/personal/library`, { waitUntil: 'networkidle' });
    await page.getByTestId('open-create-task-modal').click();
    const dialog = page.getByRole('dialog', { name: 'Создать задачу', exact: true });
    const title = dialog.getByRole('textbox', { name: 'Название', exact: true });
    await title.fill('Не терять черновик UI.2');
    const route = '**/api/me/tasks';
    await page.route(route, route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: 'test failure' } }) : route.continue());
    await dialog.getByTestId('create-task-submit-button').click();
    await dialog.getByRole('alert').waitFor({ timeout: 5000 });
    assert.equal(await title.inputValue(), 'Не терять черновик UI.2');
    await page.unroute(route);
    await dialog.getByTestId('create-task-submit-button').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Наборы задач', exact: true }).click();
    await page.getByRole('button', { name: 'Создать набор', exact: true }).click();
    const set = page.getByRole('dialog', { name: 'Создать набор', exact: true });
    await set.getByRole('button', { name: 'Создать', exact: true }).click();
    await set.getByRole('alert').waitFor({ timeout: 5000 });
    await set.getByRole('button', { name: 'Отмена', exact: true }).click();
    await set.waitFor({ state: 'hidden' });
  } finally { await browser.close(); }
});
