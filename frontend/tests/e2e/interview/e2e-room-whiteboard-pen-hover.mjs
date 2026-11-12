import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const visibleElements = scene => scene.elements.filter(element => !element.isDeleted);

async function setup(browser, existingRoom, owner = true) {
  let room = existingRoom;
  if (!room) {
    const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Наведение и давление пера', ownerDisplayName: 'Интервьюер', language: 'nodejs' }) });
    assert.equal(response.status, 200);
    room = await response.json();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ room, owner }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('display_name', owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('interview-online:ui-theme', 'light');
    window.__hoverPointers = [];
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
      if (!event.target?.matches?.('canvas.interactive')) return;
      window.__hoverPointers.push({ type, pointerType: event.pointerType, buttons: event.buttons, pressure: event.pressure, trusted: event.isTrusted });
      if (window.__hoverPointers.length > 60) window.__hoverPointers.shift();
    }, true);
  }, { room, owner });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/whiteboard/changes')) writes++; });
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  if (!existingRoom) {
    const control = page.getByTestId('room-editor-mode-switch');
    await control.click();
    const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
    await page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) }).getByText('Доска', { exact: true }).click();
    await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
    await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
  }
  await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
  await tool(page, 'freedraw');
  return { context, page, room, errors, writes: () => writes };
}
function panel(page) { return page.getByRole('region', { name: 'Доска интервью', exact: true }); }
function preview(page) { return page.getByTestId('whiteboard-pen-hover'); }
async function tool(page, name) {
  const input = page.getByTestId(`toolbar-${name}`);
  await input.locator('..').click();
  assert.equal(await input.isChecked(), true);
}
async function point(page, dx = 0) {
  const bounds = await page.getByTestId('room-whiteboard-canvas').locator('canvas.interactive').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && viewport);
  const left = Math.max(0, bounds.x), right = Math.min(viewport.width, bounds.x + bounds.width);
  const top = Math.max(0, bounds.y), bottom = Math.min(viewport.height, bounds.y + bounds.height);
  const result = { x: Math.round(left + (right - left) * .62 + dx), y: Math.round(top + (bottom - top) * .68) };
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.matches('canvas.interactive'), result);
  return result;
}
async function snapshot(room) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/whiteboard`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
  assert.equal(response.status, 200);
  return response.json();
}
async function waitScene(room, predicate) {
  const deadline = Date.now() + 15000;
  let result;
  do {
    result = await snapshot(room);
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`Expected pen scene was not persisted: sequence=${result?.sequence}`);
}
async function hover(cdp, position, force = 0) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position, pointerType: 'pen', buttons: 0, force });
}
async function alignedPreview(page, position) {
  await preview(page).waitFor({ state: 'visible' });
  await page.waitForFunction(({ x, y }) => {
    const element = document.querySelector('[data-testid="whiteboard-pen-hover"]');
    const bounds = element?.getBoundingClientRect();
    return element && !element.hidden && bounds && Math.abs(bounds.x + bounds.width / 2 - x) <= 2 && Math.abs(bounds.y + bounds.height / 2 - y) <= 2;
  }, position);
  const bounds = await preview(page).boundingBox();
  assert.ok(bounds && bounds.width >= 12 && bounds.height >= 12, 'pen hover has a visible outline');
  assert.ok(Math.abs(bounds.x + bounds.width / 2 - position.x) <= 2, `hover center X should follow pen (${bounds.x + bounds.width / 2} != ${position.x})`);
  assert.ok(Math.abs(bounds.y + bounds.height / 2 - position.y) <= 2, `hover center Y should follow pen (${bounds.y + bounds.height / 2} != ${position.y})`);
  const style = await preview(page).evaluate(element => ({ border: getComputedStyle(element).borderTopStyle, pointerEvents: getComputedStyle(element).pointerEvents }));
  assert.match(style.border, /dashed|dotted/);
  assert.equal(style.pointerEvents, 'none', 'hover preview must not intercept native drawing');
  assert.equal(await preview(page).getAttribute('aria-hidden'), 'true');
}

test('перо: наведение без штриха, давление, выход, мышь/touch и геометрия холста', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, room, errors, writes } = await setup(browser);
    const cdp = await context.newCDPSession(page);
    await page.bringToFront();
    const before = await snapshot(room), beforeWrites = writes();
    let location = await point(page);
    await hover(cdp, location);
    await alignedPreview(page, location);
    await hover(cdp, { x: location.x + 27, y: location.y - 16 });
    await alignedPreview(page, { x: location.x + 27, y: location.y - 16 });
    assert.equal((await snapshot(room)).sequence, before.sequence);
    assert.equal(writes(), beforeWrites, 'hover never sends a drawing change');
    assert.ok(await page.evaluate(() => window.__hoverPointers.some(event => event.trusted && event.type === 'pointermove' && event.pointerType === 'pen' && event.buttons === 0 && event.pressure === 0)), 'browser dispatches trusted pen hover');

    await hover(cdp, location);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...location, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .2 });
    await preview(page).waitFor({ state: 'hidden' });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: location.x + i * 5, y: location.y + Math.round(Math.sin(i / 2) * 18), buttons: 1, pointerType: 'pen', force: i <= 5 ? .2 : .8 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const end = { x: location.x + 60, y: location.y };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
    await hover(cdp, end);
    await alignedPreview(page, end);
    await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
    const drawn = await waitScene(room, scene => visibleElements(scene).length === 1 && visibleElements(scene)[0].pressures?.some(value => value < .3) && visibleElements(scene)[0].pressures?.some(value => value > .7));
    const stroke = visibleElements(drawn)[0];
    assert.equal(stroke.type, 'freedraw');
    assert.equal(stroke.simulatePressure, false);
    assert.ok(stroke.pressures.some(value => value < .3) && stroke.pressures.some(value => value > .7));
    assert.equal(stroke.pressures.length, stroke.points.length);
    assert.equal(JSON.stringify(drawn).includes('whiteboard-pen-hover'), false);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8, pointerType: 'pen', buttons: 0, force: 0 });
    await preview(page).waitFor({ state: 'hidden' });
    await hover(cdp, location);
    await alignedPreview(page, location);
    await page.mouse.move(location.x + 10, location.y + 10);
    await preview(page).waitFor({ state: 'hidden' });
    await hover(cdp, location);
    await alignedPreview(page, location);
    // Headless Chromium does not consistently background another test tab.
    // Dispatch the browser lifecycle event explicitly; pen input stays trusted CDP.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await preview(page).waitFor({ state: 'hidden' });
    await hover(cdp, location);
    await alignedPreview(page, location);
    await page.evaluate(() => document.querySelector('canvas.interactive').dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'pen', bubbles: true })));
    await preview(page).waitFor({ state: 'hidden' });
    await hover(cdp, location);
    await alignedPreview(page, location);
    await tool(page, 'selection');
    await preview(page).waitFor({ state: 'hidden' });
    await tool(page, 'freedraw');

    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...location, radiusX: 12, radiusY: 12, force: .5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: location.x + 15, y: location.y + 10, radiusX: 12, radiusY: 12, force: .5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await preview(page).waitFor({ state: 'hidden' });
    assert.equal((await snapshot(room)).sequence, drawn.sequence, 'touch in detected pen mode does not create ink');

    await panel(page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    location = await point(page, -30);
    await hover(cdp, location);
    await alignedPreview(page, location);
    await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
    location = await point(page, -20);
    await hover(cdp, location);
    await alignedPreview(page, location);
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    await page.setViewportSize({ width: 1280, height: 800 });
    location = await point(page, -20);
    await hover(cdp, location);
    await alignedPreview(page, location);
    await page.screenshot({ path: '/tmp/interhub-whiteboard-pen-hover.png' });
    await panel(page).getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
    location = await point(page, -10);
    await hover(cdp, location);
    await alignedPreview(page, location);
    assert.equal((await snapshot(room)).sequence, drawn.sequence, 'hover and layout never change the saved scene');
    assert.deepEqual(errors, []);
    await cdp.detach();
  } finally { await browser.close(); }
});

test('перо без hover и переменного давления: контакт первым событием и native стандартный штрих', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page, room, errors } = await setup(browser);
    await page.bringToFront();
    const cdp = await context.newCDPSession(page);
    const location = await point(page);
    await preview(page).waitFor({ state: 'hidden' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...location, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .5 });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: location.x + i * 5, y: location.y + Math.round(Math.sin(i / 2) * 15), buttons: 1, pointerType: 'pen', force: .5 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: location.x + 50, y: location.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
    await preview(page).waitFor({ state: 'hidden' });
    await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
    const scene = await waitScene(room, state => visibleElements(state).length === 1 && visibleElements(state)[0].points.length >= 10);
    const stroke = visibleElements(scene)[0];
    assert.equal(stroke.type, 'freedraw');
    assert.equal(stroke.simulatePressure, true, 'constant .5 is the standard no-pressure signal');
    assert.deepEqual(stroke.pressures, []);
    assert.deepEqual(errors, []);
    await cdp.detach();
  } finally { await browser.close(); }
});

test('перо: finished кандидат не видит активный индикатор и не создаёт штрихи', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const owner = await setup(browser);
    const candidate = await setup(browser, owner.room, false);
    const cdp = await candidate.context.newCDPSession(candidate.page);
    await candidate.page.bringToFront();
    const location = await point(candidate.page);
    await hover(cdp, location);
    await alignedPreview(candidate.page, location);
    const before = await snapshot(owner.room);
    const finish = await fetch(`${api}/rooms/${owner.room.inviteCode}/verdict`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Owner-Token': owner.room.ownerToken }, body: JSON.stringify({ verdict: 'HIRE' }) });
    assert.equal(finish.status, 200);
    await panel(candidate.page).getByRole('status').filter({ hasText: /Только просмотр/ }).waitFor();
    await preview(candidate.page).waitFor({ state: 'hidden' });
    await hover(cdp, location);
    await preview(candidate.page).waitFor({ state: 'hidden' });
    assert.equal((await snapshot(owner.room)).sequence, before.sequence);
    assert.equal(candidate.writes(), 0);
    assert.deepEqual(candidate.errors, []);
    await cdp.detach();
  } finally { await browser.close(); }
});
