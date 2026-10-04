import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';

async function request(path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}

async function fixture() {
  const auth = await request('/auth/register', null, {
    nickname: `cursor_${crypto.randomUUID().slice(0, 12)}`, displayName: 'Проверка курсоров', password: 'test-password-123', isHr: true,
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
  }, auth);
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  return { auth, browser, context, page };
}

async function cursor(locator, expected, description) {
  await locator.waitFor({ state: 'visible' });
  assert.equal(await locator.evaluate(element => getComputedStyle(element).cursor), expected, description);
}

async function actionsUsePointer(page) {
  const mismatches = await page.evaluate(() => {
    const selectors = 'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], input[type="checkbox"], input[type="radio"], .ant-checkbox-wrapper, .ant-radio-wrapper, .ant-segmented-item, .ant-select-clear, .ant-select-content-item-remove';
    return [...document.querySelectorAll(selectors)].flatMap(element => {
      if (!element.getClientRects().length || element.closest('[inert]') || element.matches('[role="separator"]')) return [];
      const cursor = getComputedStyle(element).cursor;
      const disabled = element.matches(':disabled, [aria-disabled="true"], .ant-checkbox-wrapper-disabled, .ant-radio-wrapper-disabled, .ant-segmented-item-disabled');
      return (disabled ? cursor !== 'pointer' : cursor === 'pointer') ? [] : [{ tag: element.tagName, role: element.getAttribute('role'), name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 80), disabled, cursor }];
    });
  });
  assert.deepEqual(mismatches, [], 'enabled actions have a pointer and disabled actions do not');
}

test('native period and interview calendars have a pointer while ordinary typing fields stay text', async () => {
  const { auth, browser, page } = await fixture();
  const room = await request('/rooms', auth.token, { title: 'Проверка календаря', taskIds: [] });
  try {
    await page.goto(`${web}/workspace/personal/candidates`);
    const from = page.getByLabel('С', { exact: true });
    const to = page.getByLabel('По', { exact: true });
    await cursor(from, 'pointer', 'period start opens a calendar');
    await cursor(to, 'pointer', 'period end opens a calendar');
    const clearPeriod = page.getByRole('button', { name: 'За всё время', exact: true });
    assert.equal(await clearPeriod.isDisabled(), true);
    assert.notEqual(await clearPeriod.evaluate(element => getComputedStyle(element).cursor), 'pointer', 'disabled action has no enabled affordance');
    await from.fill('2030-10-12');
    await to.fill('2030-10-14');
    assert.equal(await from.inputValue(), '2030-10-12', 'native date remains keyboard editable');
    await actionsUsePointer(page);

    await page.goto(`${web}/workspace/personal/interviews`);
    await page.getByRole('button', { name: `Редактировать сведения интервью ${room.title}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Кандидат и нанимающие', exact: true });
    const scheduledAt = dialog.getByLabel('Дата и время интервью (МСК)', { exact: true });
    await cursor(scheduledAt, 'pointer', 'interview date-time opens a calendar');
    await scheduledAt.fill('2030-10-12T14:30');
    assert.equal(await scheduledAt.inputValue(), '2030-10-12T14:30');
    await cursor(dialog.getByLabel('Имя кандидата', { exact: true }), 'text', 'name field retains typing cursor');
    await cursor(dialog.getByLabel('Позиция', { exact: true }), 'text', 'position field retains typing cursor');
    await actionsUsePointer(page);
  } finally { await browser.close(); }
});

test('workspace menus, tabs, select options, selected-value removal and switches have a pointer', async () => {
  const { auth, browser, page } = await fixture();
  const { team } = await request('/teams', auth.token, { name: 'Курсоры команды' });
  await request('/me/tasks', auth.token, { title: 'Задача курсоров', description: 'Проверка выбора', starterCode: 'return 1;', language: 'nodejs' });
  await request(`/teams/${team.id}/tasks`, auth.token, { title: 'Командная задача курсоров', description: 'Проверка очистки', starterCode: 'return 2;', language: 'nodejs' });
  try {
    await page.goto(`${web}/workspace/personal/interviews`);
    await page.getByRole('button', { name: /Команды:/ }).click();
    await page.getByRole('menu', { name: 'Выбор команды', exact: true }).waitFor();
    await actionsUsePointer(page);
    await page.keyboard.press('Escape');

    await page.goto(`${web}/workspace/personal/library`);
    await page.getByRole('tab', { name: 'Наборы задач', exact: true }).click();
    await page.getByRole('button', { name: 'Создать набор', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const taskSelector = dialog.getByRole('combobox', { name: 'Задачи', exact: true });
    await taskSelector.click();
    const option = page.locator('.ant-select-item-option').filter({ hasText: 'Задача курсоров' });
    await cursor(option, 'pointer', 'select option has pointer');
    await option.click();
    await cursor(dialog.locator('.ant-select-content-item-remove, .ant-select-selection-item-remove').first(), 'pointer', 'selected task removal has pointer');
    await cursor(taskSelector, 'text', 'searchable select keeps text cursor in typing area');
    await actionsUsePointer(page);
    await page.keyboard.press('Escape');
    await page.goto(`${web}/profile`);
    await cursor(page.getByRole('switch', { name: 'Я участвую в найме', exact: true }), 'pointer', 'profile toggle has pointer');
    await actionsUsePointer(page);

    await page.goto(`${web}/workspace/teams/${team.id}/interviews`);
    await page.getByRole('combobox', { name: 'Фильтр по треку', exact: true }).waitFor();
    await actionsUsePointer(page);
    await page.goto(`${web}/workspace/teams/${team.id}/library`);
    await page.getByRole('button', { name: 'Создать задачу', exact: true }).click();
    await cursor(page.getByRole('dialog').getByRole('combobox', { name: 'Язык задачи', exact: true }), 'pointer', 'select without text search has pointer');
    await actionsUsePointer(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('tab', { name: 'Наборы задач', exact: true }).click();
    await page.getByRole('button', { name: 'Создать набор', exact: true }).click();
    const setDialog = page.getByRole('dialog');
    const teamTasks = setDialog.getByRole('combobox', { name: 'Задачи набора', exact: true });
    await teamTasks.click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'Командная задача курсоров' }).click();
    const selectControl = teamTasks.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]');
    await selectControl.hover();
    await cursor(setDialog.locator('.ant-select-clear'), 'pointer', 'clear-selection action has pointer');
    await actionsUsePointer(page);
  } finally { await browser.close(); }
});

test('room actions and decision radios use a pointer while panel separators keep resize cursors', async () => {
  const { auth, browser, page } = await fixture();
  const room = await request('/rooms', auth.token, { title: 'Курсоры комнаты', taskIds: [] });
  try {
    await page.goto(`${web}/room/${room.inviteCode}`);
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await actionsUsePointer(page);
    const separators = page.getByRole('separator').filter({ visible: true });
    assert.ok(await separators.count(), 'room exposes resize separators');
    for (const separator of await separators.all()) {
      const orientation = await separator.getAttribute('aria-orientation');
      await cursor(separator, orientation === 'horizontal' ? 'row-resize' : 'col-resize', 'resize handle keeps its directional cursor');
    }
    await page.getByRole('button', { name: 'Завершить интервью', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Завершить интервью', exact: true });
    for (const radio of await dialog.getByRole('radio').all()) await cursor(radio, 'pointer', 'decision radio has pointer');
    await cursor(dialog.getByLabel('Обоснование', { exact: true }), 'text', 'decision comment retains text cursor');
    await actionsUsePointer(page);
  } finally { await browser.close(); }
});

test('registration checkbox and mutually exclusive mode choices have a pointer', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${web}/login`);
    await page.getByText('Регистрация', { exact: true }).click();
    await cursor(page.getByRole('checkbox', { name: 'Я нанимающий', exact: true }), 'pointer', 'registration checkbox has pointer');
    await cursor(page.getByLabel(/^Ник(?:\s*\*)?$/), 'text', 'nickname retains text cursor');
    await actionsUsePointer(page);
  } finally { await browser.close(); }
});
