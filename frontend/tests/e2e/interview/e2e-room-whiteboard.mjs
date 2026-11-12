import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;

async function createRoom() {
  const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Доска для объяснения', ownerDisplayName: 'Интервьюер', language: 'nodejs' }) });
  assert.equal(response.status, 200);
  return response.json();
}
async function participant(browser, room, owner = false, theme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const external = [];
  const assetRequests = [], workers = [], workerFailures = [];
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/whiteboard-assets/')) assetRequests.push(url.origin + url.pathname);
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(web).origin && url.origin !== new URL(api).origin) { external.push(url.origin + url.pathname); return route.abort(); }
    return route.continue();
  });
  await context.addInitScript(({ room, owner, theme }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('display_name', owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('interview-online:ui-theme', theme);
    window.__whiteboardTestPointers = [];
    window.__whiteboardTestSources = [];
    window.__whiteboardTestSyncedGeneration = -1;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) {
        super(...args);
        window.__whiteboardTestSources.push(this);
        this.addEventListener('message', event => {
          try { if (JSON.parse(event.data).type === 'state_sync') window.__whiteboardTestSyncedGeneration = window.__whiteboardTestSources.indexOf(this); }
          catch {}
        });
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(type, event => {
      if (!event.target?.closest?.('[data-testid="room-whiteboard-canvas"]')) return;
      window.__whiteboardTestPointers.push({ type, buttons: event.buttons, pointerType: event.pointerType, pressure: event.pressure, x: event.clientX, y: event.clientY });
      if (window.__whiteboardTestPointers.length > 50) window.__whiteboardTestPointers.shift();
    }, true);
  }, { room, owner, theme });
  const page = await context.newPage();
  page.on('worker', worker => workers.push(worker.url()));
  page.on('pageerror', error => console.info('WHITEBOARD_PAGE_ERROR', error.message));
  page.on('console', message => {
    if (/Failed to use workers for subsetting|falling back to the main thread|Failed to construct 'Worker'/.test(message.text())) workerFailures.push(message.text().slice(0, 300));
    if (message.type() === 'error') console.info('WHITEBOARD_CONSOLE_ERROR', message.text().slice(0, 1800).replace(/([?&](?:eventToken|token|capability|sessionId)=)[^&\s]+/gi, '$1<redacted>'));
  });
  page.on('response', async response => {
    if (response.status() >= 400 && /\/whiteboard(?:\/changes)?$/.test(new URL(response.url()).pathname)) {
      const body = await response.json().catch(() => ({}));
      console.info('WHITEBOARD_HTTP_FAILURE', { status: response.status(), code: body.code });
    }
  });
  page.setDefaultTimeout(15000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return { context, page, external, assetRequests, workers, workerFailures };
}
async function modeOption(page, label) {
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
  const menu = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) });
  await menu.getByText(label, { exact: true }).click();
}
async function mode(page, label) {
  await modeOption(page, label);
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.waitForFunction(label => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes(label), label);
  // Raw trusted pointer gestures do not receive Locator.click's overlay wait.
  // Let the actual mode-confirmation wrapper finish its normal leave motion.
  await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
}
function panel(page) { return page.getByRole('region', { name: 'Доска интервью', exact: true }); }
async function saved(page) {
  try { await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor(); }
  catch (error) {
    console.info('WHITEBOARD_READINESS', await panel(page).innerText().catch(() => 'panel unavailable'));
    console.info('WHITEBOARD_CANVASES', await page.getByTestId('room-whiteboard-canvas').locator('canvas').count());
    await page.screenshot({ path: '/tmp/interhub-whiteboard-browser-failure.png' }).catch(() => {});
    throw error;
  }
}
async function snapshot(room) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/whiteboard`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
  assert.equal(response.status, 200);
  return response.json();
}
async function waitScene(room, predicate) {
  const deadline = Date.now() + 20000;
  let state;
  do { state = await snapshot(room); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  assert.fail(`whiteboard did not reach expected state; sequence=${state?.sequence}, count=${state?.elements.length}`);
}
function canvas(page) { return page.getByTestId('room-whiteboard-canvas').locator('canvas.interactive'); }
async function tool(page, name) {
  const input = page.getByTestId(`toolbar-${name}`);
  await input.locator('..').click();
  assert.equal(await input.isChecked(), true);
}
async function drawingPoint(page, offset = 0, vertical = .55) {
  const bounds = await canvas(page).boundingBox();
  const container = await page.getByTestId('room-whiteboard-canvas').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && container && viewport);
  const left = Math.max(bounds.x, container.x, 0), top = Math.max(bounds.y, container.y, 0);
  const right = Math.min(bounds.x + bounds.width, container.x + container.width, viewport.width);
  const bottom = Math.min(bounds.y + bounds.height, container.y + container.height, viewport.height);
  const point = { x: left + (right - left) * .58 + offset, y: top + (bottom - top) * vertical };
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.matches('canvas.interactive'), point, { timeout: 5000 }).catch(() => {});
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return { canvas: target?.matches('canvas.interactive') ?? false, tag: target?.tagName, className: target?.className };
  }, point);
  assert.equal(hit.canvas, true, `gesture must start on the visible canvas: ${JSON.stringify({ hit, point, bounds, container, viewport })}`);
  return point;
}
async function stroke(page, offset = 0) {
  await page.bringToFront();
  await tool(page, 'freedraw');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { x, y } = await drawingPoint(page, offset);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x + i * 6, y + Math.sin(i / 2) * 20);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  return { x: x + 36, y: y + Math.sin(3) * 20 };
}

const visibleElements = state => state.elements.filter(element => !element.isDeleted);
async function penStroke(page) {
  await page.bringToFront();
  await tool(page, 'freedraw');
  const cdp = await page.context().newCDPSession(page);
  const point = await drawingPoint(page, 0, .7), x = Math.round(point.x), y = Math.round(point.y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .2 });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 6, y: y + Math.round(Math.sin(i / 2) * 15), buttons: 1, pointerType: 'pen', force: i < 5 ? .2 : .8 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 72, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  await cdp.detach();
}
async function text(page, value, pause = 0) {
  await page.bringToFront();
  await tool(page, 'text');
  const point = await drawingPoint(page, 0, .75);
  await page.mouse.click(point.x, point.y);
  const editor = page.locator('textarea.excalidraw-wysiwyg');
  await editor.waitFor();
  if (pause) await page.waitForTimeout(pause);
  await editor.fill(value);
  await editor.press('Escape');
}
async function touchGesture(page) {
  await page.bringToFront();
  const cdp = await page.context().newCDPSession(page);
  const point = await drawingPoint(page, 70, .45), x = Math.round(point.x), y = Math.round(point.y);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 12, radiusY: 12, force: .5 }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 8, y: y + i * 3, radiusX: 12, radiusY: 12, force: .5 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.detach();
}
async function holdFirstWrite(page, actor) {
  let first = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  let capture;
  const change = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Native ${actor} stroke did not emit an editable scene within 12s`)), 12000);
    timeout.unref();
    capture = value => { clearTimeout(timeout); resolve(value); };
  });
  void change.catch(() => {}); // A prior gesture assertion can abort before awaiting this gate.
  await page.route('**/whiteboard/changes?*', async route => {
    if (first) {
      first = false; capture(route.request().postDataJSON());
      await gate;
    }
    await route.continue();
  });
  return { change, release: () => release() };
}
async function exported(page, label) {
  const downloading = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: label, exact: true }).click();
  const download = await downloading;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return { bytes: Buffer.concat(chunks), filename: download.suggestedFilename() };
}

test('Доска — отдельный четвёртый общий режим; отмена не меняет Code и не загружает редактор', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await participant(browser, room, true);
    await modeOption(owner.page, 'Доска');
    const dialog = owner.page.getByRole('dialog', { name: 'Изменить режим комнаты?' });
    assert.match(await dialog.innerText(), /кандидата и всех интервьюеров/);
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.match(await owner.page.getByTestId('room-editor-mode-switch').innerText(), /Code/);
    assert.equal(await owner.page.getByTestId('room-whiteboard-canvas').count(), 0);
    await mode(owner.page, 'Доска');
    await saved(owner.page);
    await canvas(owner.page).waitFor();
    assert.deepEqual(owner.external, [], 'all editor resources are local');
    assert.equal((await snapshot(room)).elements.length, 0);
  } finally { await browser.close(); }
});

test('два автора рисуют одновременно, своё Undo сохраняет чужой штрих, pen давление и текст переживают reconnect и reload', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await participant(browser, room, true, 'dark');
    const candidate = await participant(browser, room);
    await mode(owner.page, 'Доска');
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    const ownerIds = new Set(), candidateIds = new Set();
    for (const [person, ids] of [[owner, ownerIds], [candidate, candidateIds]]) {
      person.page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/whiteboard/changes')) {
          for (const element of request.postDataJSON().elements) if (element.type === 'freedraw') {
            ids.add(element.id);
          }
        }
      });
    }
    const ownerWrite = await holdFirstWrite(owner.page, 'owner'), candidateWrite = await holdFirstWrite(candidate.page, 'candidate');
    // One Chromium process has one focused pointer. Keep both documents
    // unacknowledged, draw each real gesture, then release concurrent writes.
    await stroke(owner.page, -100);
    await stroke(candidate.page, 100);
    let ownerInitial, candidateInitial;
    try { [ownerInitial, candidateInitial] = await Promise.all([ownerWrite.change, candidateWrite.change]); }
    catch (error) {
      console.info('WHITEBOARD_GESTURE_STATUS', { owner: await panel(owner.page).innerText(), candidate: await panel(candidate.page).innerText() });
      console.info('WHITEBOARD_GESTURE_POINTERS', { owner: await owner.page.evaluate(() => window.__whiteboardTestPointers), candidate: await candidate.page.evaluate(() => window.__whiteboardTestPointers) });
      await owner.page.screenshot({ path: '/tmp/interhub-whiteboard-owner-stroke.png' });
      await candidate.page.screenshot({ path: '/tmp/interhub-whiteboard-candidate-stroke.png' });
      ownerWrite.release(); candidateWrite.release(); throw error;
    }
    const ownId = ownerInitial.elements.find(element => element.type === 'freedraw').id;
    const otherId = candidateInitial.elements.find(element => element.type === 'freedraw').id;
    assert.notEqual(ownId, otherId);
    ownerWrite.release(); candidateWrite.release();
    const concurrent = await waitScene(room, state => visibleElements(state).length === 2);
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    assert.equal(ownerInitial.elements.filter(element => element.type === 'freedraw').length, 1);
    assert.equal(candidateInitial.elements.filter(element => element.type === 'freedraw').length, 1);
    assert.ok(ownerIds.has(ownId)); assert.ok(candidateIds.has(otherId));
    await owner.page.bringToFront();
    await owner.page.getByTestId('button-undo').click();
    await waitScene(room, state => visibleElements(state).length === 1 && visibleElements(state)[0].id === otherId);
    await saved(owner.page);
    await penStroke(owner.page);
    const pressure = await waitScene(room, state => visibleElements(state).some(element => element.type === 'freedraw' && element.simulatePressure === false && element.pressures?.some(value => value < .3) && element.pressures?.some(value => value > .7)));
    const pen = visibleElements(pressure).find(element => element.type === 'freedraw' && element.simulatePressure === false);
    assert.equal(pen.pressures.length, pen.points.length);
    await saved(owner.page);
    const beforeTouch = await snapshot(room);
    await touchGesture(owner.page);
    await owner.page.waitForTimeout(500);
    assert.equal((await snapshot(room)).sequence, beforeTouch.sequence, 'touch gestures in pen mode must not add a stroke');
    const beforeText = await snapshot(room);
    const peerTextDeletes = [];
    candidate.page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/whiteboard/changes')) {
        peerTextDeletes.push(...request.postDataJSON().elements.filter(element => element.type === 'text' && element.isDeleted).map(element => element.id));
      }
    });
    await text(owner.page, 'Рукописное объяснение алгоритма', 600);
    await waitScene(room, state => visibleElements(state).some(element => element.type === 'text' && element.text === 'Рукописное объяснение алгоритма'));
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    assert.equal(visibleElements(await snapshot(room)).length, visibleElements(beforeText).length + 1, 'pausing before text input must not create a peer tombstone');
    assert.deepEqual(peerTextDeletes, [], 'a peer must not normalize an unfinished text object into a published deletion');

    const oldGeneration = await candidate.page.evaluate(() => window.__whiteboardTestSyncedGeneration);
    await candidate.context.setOffline(true);
    // Chromium's offline emulation may preserve an existing EventSource. Close
    // its lease through the same error event a broken network stream produces.
    await candidate.page.evaluate(() => window.__whiteboardTestSources.at(-1).dispatchEvent(new Event('error')));
    await candidate.page.waitForFunction(() => document.querySelector('[data-testid="room-connection-status"]')?.getAttribute('data-state') !== 'online');
    const offlineIds = new Set(candidateIds);
    await stroke(candidate.page, -130);
    await stroke(owner.page, 120);
    await saved(owner.page);
    await candidate.context.setOffline(false);
    await candidate.page.waitForFunction(previous => window.__whiteboardTestSyncedGeneration > previous && window.__whiteboardTestSyncedGeneration === window.__whiteboardTestSources.length - 1, oldGeneration);
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    const recovered = await waitScene(room, state => visibleElements(state).filter(element => element.type === 'freedraw').length === 4);
    assert.ok(visibleElements(recovered).some(element => !offlineIds.has(element.id) && candidateIds.has(element.id)), 'offline candidate stroke is durable');
    await owner.page.reload();
    await saved(owner.page);
    const late = await participant(browser, room);
    await saved(late.page);
    assert.equal(visibleElements(await snapshot(room)).length, visibleElements(recovered).length);

    const json = await exported(owner.page, '.excalidraw');
    const parsed = JSON.parse(json.bytes.toString('utf8'));
    assert.match(json.filename, /\.excalidraw$/);
    assert.ok(parsed.elements.some(element => element.id === pen.id && element.pressures.some(value => value > .7)));
    const svg = await exported(owner.page, 'SVG'); assert.match(svg.bytes.toString('utf8'), /<svg\b/);
    const png = await exported(owner.page, 'PNG'); assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const workerUrl = `${new URL(web).origin}/whiteboard-assets/subset/subset-worker.chunk.js`;
    assert.ok(owner.workers.includes(workerUrl), 'SVG export must start the local native font-subsetting Worker');
    assert.ok(owner.assetRequests.includes(workerUrl), 'the Worker script is served over the application HTTP origin');
    assert.deepEqual(owner.workerFailures, [], 'normal export must not fall back from an inaccessible file:// Worker');
    assert.equal(await owner.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => /Рукописное объяснение|"pressures"|"freedraw"/.test(value))), false, 'scene content is not recovery storage');
    assert.deepEqual([...owner.external, ...candidate.external, ...late.external], [], 'fonts and exports remain local');
    assert.ok(concurrent.sequence > 0);
    // A late join fits the small test scene to the embedded canvas. Show the
    // same real document at a readable user-selected 100% for review captures.
    await owner.page.getByTestId('room-whiteboard-canvas').locator('.reset-zoom-button').click();
    await owner.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await owner.page.screenshot({ path: '/tmp/interhub-whiteboard-collaboration.png' });
    await panel(owner.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await owner.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await owner.page.screenshot({ path: '/tmp/interhub-whiteboard-expanded.png' });
  } finally { await browser.close(); }
});

test('доска сохраняет native canvas между четырьмя режимами, полноэкранным видом, темой и finished просмотром', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await participant(browser, room, true);
    const candidate = await participant(browser, room);
    await mode(owner.page, 'Доска'); await Promise.all([saved(owner.page), saved(candidate.page)]);
    await stroke(owner.page); await waitScene(room, state => visibleElements(state).length === 1); await saved(owner.page);
    const original = await canvas(owner.page).elementHandle();
    const code = await owner.page.locator('[data-testid="room-code-editor-host"]').elementHandle();
    const before = await panel(owner.page).boundingBox();
    await panel(owner.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    const expanded = await panel(owner.page).boundingBox();
    assert.ok(expanded.width >= 1438 && expanded.height >= 998 && expanded.x <= 1 && expanded.y <= 1);
    assert.equal(await candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).count(), 0);
    assert.equal(await original.evaluate(element => element.isConnected), true);
    await owner.page.screenshot({ path: '/tmp/interhub-whiteboard-mode-expanded.png' });
    await panel(owner.page).getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
    assert.deepEqual(await panel(owner.page).boundingBox(), before);
    for (const label of ['Code', 'Markdown', 'Редактор диаграмм', 'Доска']) {
      await mode(owner.page, label);
      if (label === 'Редактор диаграмм') await owner.page.getByRole('region', { name: 'Схема интервью', exact: true }).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
    }
    await saved(owner.page);
    assert.equal(await original.evaluate(element => element.isConnected && element === document.querySelector('[data-testid="room-whiteboard-canvas"] canvas.interactive')), true);
    assert.equal(await code.evaluate(element => element.isConnected), true);
    assert.equal(visibleElements(await snapshot(room)).length, 1);
    await owner.page.evaluate(() => { localStorage.setItem('interview-online:ui-theme', 'dark'); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: 'dark' })); });
    assert.equal(await original.evaluate(element => element.isConnected), true);
    await mode(owner.page, 'Markdown');
    const finish = await fetch(`${api}/rooms/${room.inviteCode}/verdict`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Owner-Token': room.ownerToken }, body: JSON.stringify({ verdict: 'HIRE' }) });
    assert.equal(finish.status, 200);
    await candidate.page.getByRole('button', { name: 'Посмотреть доску', exact: true }).click();
    await panel(candidate.page).getByRole('status').filter({ hasText: /Только просмотр/ }).waitFor();
    await canvas(candidate.page).waitFor();
    await panel(candidate.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await candidate.page.setViewportSize({ width: 800, height: 420 });
    const restore = panel(candidate.page).getByRole('button', { name: 'Вернуться в комнату', exact: true });
    const restoreBox = await restore.boundingBox();
    assert.ok(restoreBox.y + restoreBox.height < 420 && restoreBox.x + restoreBox.width <= 800);
    assert.equal(await candidate.page.getByTestId('toolbar-freedraw').isVisible(), false, 'readonly has no drawing tools');
    await restore.click();
    await candidate.page.setViewportSize({ width: 1440, height: 1000 });
    await candidate.page.getByRole('button', { name: 'К материалам интервью', exact: true }).click();
    await mode(owner.page, 'Code');
    await candidate.page.getByText('Режим комнаты — Code', { exact: true }).waitFor();
    await candidate.page.getByRole('button', { name: 'Посмотреть доску', exact: true }).click();
    await panel(candidate.page).getByRole('status').filter({ hasText: /Только просмотр/ }).waitFor();
    assert.equal(await candidate.page.getByText('Режим комнаты — Code', { exact: true }).isVisible(), true, 'local readonly opening must not change the shared Code mode');
    assert.equal(visibleElements(await snapshot(room)).length, 1);
    assert.deepEqual([...owner.external, ...candidate.external], []);
  } finally { await browser.close(); }
});

test('постоянный отказ доски сохраняет ввод до явного подтверждения восстановления', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await participant(browser, room, true);
    await mode(owner.page, 'Доска'); await saved(owner.page);
    await stroke(owner.page); await waitScene(room, state => visibleElements(state).length === 1); await saved(owner.page);
    const canonical = await snapshot(room);
    const original = await canvas(owner.page).elementHandle();
    await owner.page.route('**/whiteboard/changes?*', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'WHITEBOARD_INVALID_DOCUMENT' }) }));
    await stroke(owner.page, 130);
    const reset = panel(owner.page).getByRole('button', { name: 'Вернуться к сохранённой доске', exact: true });
    await reset.waitFor();
    assert.equal((await snapshot(room)).sequence, canonical.sequence);
    await panel(owner.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await reset.click();
    let dialog = owner.page.getByRole('dialog', { name: 'Удалить несохранённые изменения доски?' });
    assert.equal(await dialog.evaluate(element => element.closest('[inert]') === null), true);
    await dialog.getByRole('button', { name: 'Оставить изменения', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await original.evaluate(element => element.isConnected), true);
    await reset.waitFor();
    await reset.click();
    dialog = owner.page.getByRole('dialog', { name: 'Удалить несохранённые изменения доски?' });
    await owner.page.unroute('**/whiteboard/changes?*');
    await dialog.getByRole('button', { name: 'Загрузить сохранённую', exact: true }).click();
    await saved(owner.page);
    assert.equal(await original.evaluate(element => element.isConnected), true);
    const eraserTarget = await stroke(owner.page, -100); await saved(owner.page);
    await waitScene(room, state => visibleElements(state).length === 2);
    await tool(owner.page, 'eraser');
    await owner.page.mouse.move(eraserTarget.x, eraserTarget.y); await owner.page.mouse.down();
    await owner.page.mouse.move(eraserTarget.x + 8, eraserTarget.y); await owner.page.mouse.up();
    const erased = await waitScene(room, state => visibleElements(state).length === 1);
    assert.ok(erased.elements.some(element => element.isDeleted), 'eraser persists a tombstone');
  } finally { await browser.close(); }
});

test('локальный отказ загрузки шрифтов сохраняет рисование и текст без обращения к внешнему CDN', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await participant(browser, room, true);
    let failedFonts = 0;
    await owner.context.route('**/whiteboard-assets/fonts/**', route => {
      failedFonts++;
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Font intentionally unavailable in this isolated test' });
    });
    await mode(owner.page, 'Доска'); await saved(owner.page);
    await stroke(owner.page); await waitScene(room, state => visibleElements(state).length === 1); await saved(owner.page);
    await text(owner.page, 'Текст остаётся на доске без внешних шрифтов', 300);
    await waitScene(room, state => visibleElements(state).some(element => element.type === 'text' && element.text === 'Текст остаётся на доске без внешних шрифтов'));
    await saved(owner.page);
    assert.ok(failedFonts > 0, 'the local-font failure route must actually be exercised');
    assert.deepEqual(owner.external, [], 'font failure must not trigger an esm.sh or other external fallback');
    assert.equal(visibleElements(await snapshot(room)).length, 2);
    await owner.page.screenshot({ path: '/tmp/interhub-whiteboard-local-font-failure.png' });
  } finally { await browser.close(); }
});
