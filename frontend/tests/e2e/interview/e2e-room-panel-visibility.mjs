import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;

async function createRoom() {
  const response = await fetch(`${api}/public/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Свободная рабочая область', ownerDisplayName: 'Интервьюер', language: 'nodejs' }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function openOwner(browser, room, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ inviteCode, ownerToken }) => {
    localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem('display_name', 'Интервьюер');
    localStorage.setItem(`guest_display_name_${inviteCode}`, 'Интервьюер');
  }, room);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  return { page, context };
}

async function settleLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function layoutStorage(page) {
  return page.evaluate(() => {
    // SSE/Yjs checkpoints can advance independently while layout is exercised.
    // All other entries, including any accidentally persisted layout, must stay.
    const entries = storage => Object.fromEntries(Object.entries(storage).filter(([key]) => !/^room_(event|yjs)_sequence_/.test(key)));
    return { local: entries(localStorage), session: entries(sessionStorage) };
  });
}

test('скрытие боковой панели расширяет редактор локально и сохраняет вкладку, размер и черновик', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await openOwner(browser, room);
    await page.setViewportSize({ width: 1280, height: 720 });
    await settleLayout(page);
    const { page: observer } = await openOwner(browser, room);
    const editor = page.getByRole('region', { name: 'Редактор', exact: true });
    const codeInput = editor.locator('[data-testid="room-code-editor-host"] .cm-content');
    const originalTabIndex = await codeInput.getAttribute('tabindex');
    const originalEditor = await page.locator('[data-testid="room-code-editor-host"] .cm-editor').elementHandle();
    const condition = page.getByRole('region', { name: 'Условие', exact: true });
    const originalConditionHeight = (await condition.boundingBox()).height;
    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    assert.equal((await condition.boundingBox()).height, originalConditionHeight, 'hiding the sidebar must not resize the independent condition');
    await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).click();
    assert.equal((await condition.boundingBox()).height, originalConditionHeight);
    await page.getByRole('button', { name: 'Свернуть условие', exact: true }).click();
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Сообщение в чат интервьюеров', exact: true });
    await input.fill('Несохранённое сообщение сохраняется при скрытии панели');
    const originalInput = await input.elementHandle();
    // Native iframe focus must also be blocked while its mounted surface is hidden.
    await input.evaluate(element => {
      const frame = document.createElement('iframe');
      frame.title = 'Проверка фокуса скрытой панели';
      frame.srcdoc = '<button>Внутреннее действие</button>';
      element.closest('[data-room-context-surface]').append(frame);
    });
    const divider = page.getByRole('separator', { name: 'Изменить ширину контекстной панели', exact: true });
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    const previousWidth = await divider.getAttribute('aria-valuenow');
    const previousEditorBox = await editor.boundingBox();
    const storageBefore = await layoutStorage(page);
    const mutations = [];
    page.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        const data = request.postData() ?? '';
        if (!/awareness|cursor|presence/.test(data)) mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    await settleLayout(page);
    const show = page.getByRole('button', { name: 'Показать боковую панель', exact: true });
    assert.equal(await show.getAttribute('aria-expanded'), 'false');
    const controlledRegions = (await show.getAttribute('aria-controls')).split(' ');
    assert.equal(controlledRegions.length, 4);
    for (const id of controlledRegions) assert.equal(await page.locator(`[id="${id}"]`).count(), 1);
    assert.equal(await page.getByRole('tab', { selected: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Чат', exact: true }).count(), 0);
    assert.equal(await divider.count(), 0);
    assert.ok((await editor.boundingBox()).width > previousEditorBox.width + 250, 'editor must take the freed sidebar width');
    assert.equal(await originalInput.evaluate(element => { element.focus(); return document.activeElement === element; }), false);
    assert.equal(await page.locator('iframe[title="Проверка фокуса скрытой панели"]').evaluate(element => { element.focus(); return document.activeElement === element; }), false);
    assert.equal(await codeInput.getAttribute('tabindex'), originalTabIndex, 'restore the editor’s original keyboard tab behavior');
    await show.focus();
    let keyboardReachedEditor = false;
    for (let tab = 0; tab < 60; tab += 1) {
      await page.keyboard.press('Tab');
      if (await codeInput.evaluate(element => document.activeElement === element)) {
        keyboardReachedEditor = true;
        break;
      }
    }
    assert.equal(keyboardReachedEditor, true, 'the expanded editor must remain reachable by keyboard');
    assert.equal(await observer.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).getAttribute('aria-expanded'), 'true');
    assert.equal(await observer.getByRole('tab', { name: 'Шаги', selected: true }).count(), 1);

    await show.focus();
    await page.keyboard.press('Enter');
    await settleLayout(page);
    assert.equal(await page.getByRole('tab', { name: 'Чат', selected: true }).count(), 1);
    assert.equal(await page.getByRole('tab', { name: 'Чат', selected: true }).evaluate(element => element === document.activeElement), true, 'opening returns focus to the selected sidebar tab');
    assert.equal(await divider.getAttribute('aria-valuenow'), previousWidth);
    assert.equal(await input.inputValue(), 'Несохранённое сообщение сохраняется при скрытии панели');
    assert.equal(await page.getByRole('button', { name: 'Развернуть условие', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await originalEditor.evaluate(element => element.isConnected), true);

    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).click();
    await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).getAttribute('aria-expanded'), 'true');
    assert.equal(await page.getByRole('tab', { name: 'Мои заметки', selected: true }).count(), 1);
    assert.deepEqual(await layoutStorage(page), storageBefore);
    assert.deepEqual(mutations, [], 'layout controls must not write room data');
  } finally {
    await browser.close();
  }
});

test('боковая панель остаётся управляемой в узком окне и сбрасывается после перезагрузки и смены комнаты', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await openOwner(browser, room, { width: 900, height: 850 });
    const editor = page.getByRole('region', { name: 'Редактор', exact: true });
    assert.equal(await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Шаги', selected: true }).count(), 1);
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    await page.getByRole('textbox', { name: 'Сообщение в чат интервьюеров', exact: true }).fill('Черновик в узкой комнате');
    await page.screenshot({ path: '/tmp/interhub-left-sidebar-narrow.png' });
    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    await editor.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Вернуться к редактору', exact: true }).count(), 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settleLayout(page);
    assert.equal(await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: 'Показать боковую панель', exact: true }).click();
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Сообщение в чат интервьюеров', exact: true }).inputValue(), 'Черновик в узкой комнате');
    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Шаги', selected: true }).count(), 1);
    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    const anotherRoom = await createRoom();
    await page.evaluate(({ inviteCode, ownerToken }) => {
      localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
      localStorage.setItem(`guest_display_name_${inviteCode}`, 'Интервьюер');
      history.pushState(null, '', `/room/${inviteCode}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, anotherRoom);
    await page.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Шаги', selected: true }).count(), 1);
  } finally {
    await browser.close();
  }
});

test('четыре вкладки остаются над рабочей областью и открывают скрытую левую панель', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await openOwner(browser, room);
    const sidebar = page.getByRole('complementary', { name: 'Рабочие области интервью', exact: true });
    await sidebar.waitFor();
    const editor = page.getByRole('region', { name: 'Редактор', exact: true });
    const tabs = page.getByRole('tablist', { name: 'Рабочие области комнаты', exact: true });
    const collapse = sidebar.getByRole('button', { name: 'Скрыть боковую панель', exact: true });
    const bounds = await sidebar.boundingBox();
    const editorBounds = await editor.boundingBox();
    assert.ok(bounds.x + bounds.width <= editorBounds.x + 1, 'the auxiliary panel is attached to the left of the editor');
    assert.ok(bounds.width >= 320 && bounds.width <= 362, `default sidebar width remains compact: ${bounds.width}`);
    assert.equal(await tabs.evaluate(element => element.closest('aside') === null), true, 'the original toolbar tabs stay outside the sidebar');
    const tabBounds = await tabs.boundingBox();
    const conditionBounds = await page.getByRole('region', { name: 'Условие', exact: true }).boundingBox();
    assert.ok(tabBounds.y + tabBounds.height <= conditionBounds.y, 'tabs remain above the condition and editor');
    assert.equal(await tabs.getByRole('tab').count(), 4);
    for (const tab of await tabs.getByRole('tab').all()) {
      const box = await tab.boundingBox();
      assert.equal(box.height, 36);
      assert.ok(box.x >= tabBounds.x && box.x + box.width <= tabBounds.x + tabBounds.width + 1);
    }
    assert.equal((await collapse.boundingBox()).height, 36);
    const separator = page.getByRole('separator', { name: 'Изменить ширину контекстной панели', exact: true });
    const before = Number(await separator.getAttribute('aria-valuenow'));
    const handle = await separator.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2);
    await page.mouse.up();
    assert.ok(Number(await separator.getAttribute('aria-valuenow')) > before, 'dragging the left divider right increases sidebar width');
    await page.screenshot({ path: '/tmp/interhub-left-sidebar-open.png' });
    await collapse.click();
    const open = page.getByRole('button', { name: 'Показать боковую панель', exact: true });
    assert.equal((await open.boundingBox()).height, 36);
    assert.equal((await open.boundingBox()).width, 36);
    const rail = page.getByTestId('room-context-sidebar-rail');
    assert.equal((await rail.boundingBox()).width, 48);
    assert.equal(await tabs.getByRole('tab').count(), 4, 'all four toolbar tabs remain available when the sidebar is collapsed');
    assert.equal(await tabs.getByRole('tab', { selected: true }).count(), 0);
    await page.screenshot({ path: '/tmp/interhub-left-sidebar-collapsed.png' });
    await tabs.getByRole('tab', { name: 'Чат', exact: true }).click();
    await sidebar.waitFor();
    assert.equal(await tabs.getByRole('tab', { name: 'Чат', selected: true }).count(), 1, 'a toolbar tab directly reopens the sidebar');
    await sidebar.getByRole('button', { name: 'Скрыть боковую панель', exact: true }).click();
    await open.click();
    assert.equal(await tabs.getByRole('tab', { name: 'Чат', exact: true }).evaluate(element => element === document.activeElement), true);
  } finally { await browser.close(); }
});
