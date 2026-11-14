import '../support/require-isolated-api.mjs';
import { assertCompactCanvasHeader, assertStableAutosave } from '../support/canvas-header.mjs';
import { expectLegacyCanvasBlocked, selectCanvasTask, waitForCanvasTask } from '../support/canvas-tasks.mjs';
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
function canvas(page) { return panel(page).getByTestId('room-whiteboard-canvas').locator('canvas.interactive'); }
function drawingTools(page) { return page.getByRole('group', { name: 'Инструменты доски', exact: true }); }
async function tool(page, name) {
  const input = drawingTools(page).getByTestId(`toolbar-${name}`);
  await input.locator('..').click();
  assert.equal(await input.isChecked(), true);
}
async function drawingPoint(page, offset = 0, vertical = .55) {
  const bounds = await canvas(page).boundingBox();
  const container = await panel(page).getByTestId('room-whiteboard-canvas').boundingBox();
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
  await panel(page).getByRole('button', { name: 'Скачать', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await panel(page).getByRole('menuitem', { name: label, exact: true }).click();
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

test('при переключении задач доски изолированы у интервьюера и кандидата', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const [first, second] = room.tasks;
    const owner = (await participant(browser, room, true)).page;
    const candidate = (await participant(browser, room)).page;
    async function boardTexts(page) {
      await saved(page);
      const file = await exported(page, '.excalidraw');
      return visibleElements(JSON.parse(file.bytes.toString('utf8'))).filter(element => element.type === 'text').map(element => element.text).sort();
    }
    async function expectRedInk(page, expected) {
      await saved(page);
      const surface = await panel(page).locator('canvas.static').elementHandle();
      assert.ok(surface);
      // The native scene can diverge from the accepted document used for export.
      // Inspect the actual pixels on the drawing layer displayed to the user.
      await page.waitForFunction(({ surface, expected }) => {
        const { width, height } = surface;
        if (!width || !height) return false;
        const { data } = surface.getContext('2d').getImageData(0, 0, width, height);
        let red = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 100) red++;
          if (red >= 8) return expected;
        }
        return !expected;
      }, { surface, expected });
    }
    await mode(owner, 'Доска');
    await waitForCanvasTask(candidate, first.id);
    await saved(owner);
    await drawingTools(owner).getByLabel('Цвет рисования').fill('#e00000');
    await stroke(owner);
    await expectRedInk(owner, true);
    await text(owner, 'Клиент');
    await waitScene(room, state => visibleElements(state).some(element => element.text === 'Клиент'));

    await selectCanvasTask(owner, second);
    assert.deepEqual(await boardTexts(owner), []);
    await expectRedInk(owner, false);
    await text(owner, 'Очередь');
    await selectCanvasTask(owner, first);
    assert.deepEqual(await boardTexts(owner), ['Клиент']);
    await expectRedInk(owner, true);
    await waitForCanvasTask(candidate, first.id);
    assert.deepEqual(await boardTexts(candidate), ['Клиент']);
    await selectCanvasTask(owner, second);
    assert.deepEqual(await boardTexts(owner), ['Очередь']);
    await expectRedInk(owner, false);

    await owner.getByTestId('room-publish-step').click();
    await waitForCanvasTask(candidate, second.id);
    assert.deepEqual(await boardTexts(candidate), ['Очередь']);
    await candidate.reload();
    await waitForCanvasTask(candidate, second.id);
    assert.deepEqual(await boardTexts(candidate), ['Очередь']);
    await selectCanvasTask(owner, first);
    assert.deepEqual(await boardTexts(owner), ['Клиент']);
    await expectLegacyCanvasBlocked(owner, 'whiteboard', first, second);
  } finally { await browser.close(); }
});

test('при переключении задач доска получает правку из интервала между загрузкой и подпиской', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const second = room.tasks[1];
    const reader = (await participant(browser, room, true)).page;
    const writer = (await participant(browser, room, true)).page;
    await mode(reader, 'Доска');
    await saved(reader);
    await selectCanvasTask(writer, second);
    await saved(writer);

    const events = '**/realtime/rooms/*/events';
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const openForSecond = request => request.method() === 'POST'
      && new URL(request.url()).pathname.endsWith('/events')
      && request.postDataJSON()?.type === 'manager_workspace_open'
      && request.postDataJSON().stepIndex === second.stepIndex;
    await reader.route(events, async route => {
      if (openForSecond(route.request())) await gate;
      await route.continue();
    });
    let catchup;
    try {
      await Promise.all([reader.waitForRequest(openForSecond), selectCanvasTask(reader, second)]);
      await saved(reader);
      const before = await exported(reader, '.excalidraw');
      assert.deepEqual(visibleElements(JSON.parse(before.bytes.toString('utf8'))), []);
      const response = writer.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/whiteboard/changes')
        && new URL(response.url()).searchParams.get('taskId') === second.id && response.ok());
      await Promise.all([response, text(writer, 'Правка до подписки')]);
      catchup = reader.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname.endsWith('/whiteboard')
        && new URL(response.url()).searchParams.get('taskId') === second.id && response.ok());
    } finally { release(); }

    await (await catchup).finished();
    const after = await exported(reader, '.excalidraw');
    assert.deepEqual(visibleElements(JSON.parse(after.bytes.toString('utf8'))).map(element => element.text), ['Правка до подписки']);
  } finally { await browser.close(); }
});

function widthTrigger(page) { return drawingTools(page).getByRole('button', { name: /^Толщина линии:/ }); }
function widthDialog(page) { return page.getByRole('dialog', { name: 'Толщина линии', exact: true }); }
async function openWidth(page) {
  await widthTrigger(page).click();
  await widthDialog(page).waitFor();
  return widthDialog(page);
}
async function setPixelWidth(page, value) {
  const dialog = await openWidth(page);
  const number = dialog.getByRole('spinbutton', { name: 'Толщина в пикселях', exact: true });
  await number.fill(String(value));
  await number.press('Tab');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
}
async function assertPixelWidth(page, value) {
  assert.equal(await widthTrigger(page).getAttribute('aria-label'), `Толщина линии: ${value} px`);
}
async function checkStrokeWidthSpacing(page) {
  const group = drawingTools(page);
  const board = group.locator('..');
  const widths = [240, 340, 375, 480, 481, 650, 651, 960];
  try {
    for (const width of widths) {
      await board.evaluate((el, width) => { el.style.inlineSize = width + 'px'; }, width);
      const layout = await group.evaluate(bar => {
        const button = bar.querySelector('button[aria-label^="Толщина линии:"]');
        const caption = [...bar.querySelectorAll('span')].find(el => el.textContent === 'Толщина линии');
        const field = button.getBoundingClientRect();
        const outer = bar.getBoundingClientRect();
        const peers = [...bar.children].filter(el => !el.contains(button)).map(el => el.getBoundingClientRect());
        const above = peers.filter(rect => rect.bottom <= field.top);
        return {
          caption: caption?.innerText ?? null,
          left: field.left - outer.left, right: outer.right - field.right,
          height: field.height,
          sampleHeight: button.querySelector('span[aria-hidden="true"] > span')?.getBoundingClientRect().height ?? 0,
          expectedSampleHeight: Math.min(32, Number(button.getAttribute('aria-label').match(/([0-9]+) px/)[1])),
          top: field.top - outer.top, bottom: outer.bottom - field.bottom,
          rowGap: above.length ? field.top - Math.max(...above.map(rect => rect.bottom)) : null,
          overflow: bar.scrollWidth - bar.clientWidth,
        };
      });
      const details = width + 'px ' + JSON.stringify(layout);
      assert.equal(layout.caption, null, 'the sample and pixel value need no duplicate visible caption: ' + details);
      assert.ok(layout.left >= 8 && layout.right >= 8, details);
      assert.ok(layout.height >= 36 && layout.height <= 40, details);
      assert.ok(Math.abs(layout.sampleHeight - layout.expectedSampleHeight) < .1, 'large custom widths keep a bounded preview: ' + details);
      assert.ok(layout.top >= 8 && layout.bottom >= 8 && (layout.rowGap === null || layout.rowGap >= 8), details);
      assert.ok(layout.overflow <= 1, details);
    }
  } finally {
    await board.evaluate(el => el.style.removeProperty('inline-size'));
  }
}

test('толщина задаётся отдельно до рисования карандашом, линией, прямоугольником и кругом', async () => {
  const browser = await chromium.launch();
  try {
    const room = await createRoom();
    const { page } = await participant(browser, room, true);
    const peer = (await participant(browser, room)).page;
    await mode(page, 'Доска');
    await Promise.all([saved(page), saved(peer)]);
    assert.equal(await widthTrigger(page).count(), 1, 'pixel width control is available before drawing');
    await assertPixelWidth(page, 4);
    await checkStrokeWidthSpacing(page);
    await stroke(page, -170);
    const original = await waitScene(room, state => visibleElements(state).length === 1 && !!visibleElements(state)[0].lastCommittedPoint);
    await saved(page);
    let originalStroke = visibleElements(original)[0];

    // Real keyboard input drives both representations, including exact limits.
    let dialog = await openWidth(page);
    const slider = dialog.getByRole('slider', { name: 'Толщина линии', exact: true });
    const number = dialog.getByRole('spinbutton', { name: 'Толщина в пикселях', exact: true });
    await number.fill('50');
    await number.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    await assertPixelWidth(page, 50);
    dialog = await openWidth(page);
    assert.equal(await number.inputValue(), '50', 'custom width survives reopening');
    assert.equal(await dialog.getByRole('button', { name: '32 px', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await dialog.getByRole('button', { pressed: true }).count(), 0, 'custom width does not select a quick preset');
    assert.equal(await slider.inputValue(), '32', 'the quick slider thumb is bounded without changing custom width');
    assert.equal(await number.getAttribute('min'), '1');
    assert.equal(await number.getAttribute('max'), '1000');
    await number.fill('');
    await assertPixelWidth(page, 50);
    await number.press('Tab');
    assert.equal(await number.inputValue(), '50', 'empty draft restores a custom width');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await assertPixelWidth(page, 50);
    await checkStrokeWidthSpacing(page);
    dialog = await openWidth(page);
    assert.equal(await number.inputValue(), '50', 'Escape and blur preserve custom width');
    assert.equal(await slider.getAttribute('min'), '4');
    assert.equal(await slider.getAttribute('max'), '32');
    assert.equal(await slider.getAttribute('step'), '1');
    await slider.press('End');
    await assertPixelWidth(page, 32);
    assert.equal(await number.inputValue(), '32', 'End selects the quick maximum even when a custom value already pins the thumb there');
    await number.fill('1');
    await slider.press('Home');
    await assertPixelWidth(page, 4);
    assert.equal(await number.inputValue(), '4', 'Home selects the quick minimum from a smaller custom value');
    await number.fill('1000');
    await number.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    await assertPixelWidth(page, 1000);
    dialog = await openWidth(page);
    assert.equal(await number.inputValue(), '1000', 'opening at the manual maximum does not silently clamp it');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await assertPixelWidth(page, 1000);
    dialog = await openWidth(page);
    await number.fill('64');
    await dialog.getByRole('button', { name: '4 px', exact: true }).click();
    assert.equal(await slider.inputValue(), '4', 'a quick preset replaces a custom numeric width');
    await number.fill('64');
    await slider.press('Home');
    assert.equal(await number.inputValue(), '4', 'moving the quick slider replaces a custom numeric width');
    await slider.press('End');
    assert.equal(await number.inputValue(), '32');
    await slider.press('ArrowLeft');
    assert.equal(await number.inputValue(), '31');
    await slider.press('Home');
    assert.equal(await number.inputValue(), '4');
    await number.fill('13');
    assert.equal(await slider.inputValue(), '13');
    await number.fill('');
    await assertPixelWidth(page, 13);
    await number.press('Tab');
    assert.equal(await number.inputValue(), '13', 'empty draft restores the current width');
    for (const [draft, expected] of [['1', 1], ['1000', 1000], ['0', 1], ['-7', 1], ['1001', 1000], ['2', 2], ['99', 99], ['12.6', 13]]) {
      await number.fill(draft);
      await number.press('Tab');
      assert.equal(await number.inputValue(), String(expected));
      assert.equal(await slider.inputValue(), String(Math.min(32, Math.max(4, expected))));
      await assertPixelWidth(page, expected);
    }
    for (const value of [4, 8, 16, 32]) {
      await dialog.getByRole('button', { name: `${value} px`, exact: true }).click();
      assert.equal(await number.inputValue(), String(value));
      assert.equal(await slider.inputValue(), String(value));
    }
    await number.fill('18.6');
    await number.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    await assertPixelWidth(page, 19);
    await widthTrigger(page).press('Enter');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await widthTrigger(page).evaluate(button => button === document.activeElement), 'Escape restores focus');
    dialog = await openWidth(page);
    await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    dialog = await openWidth(page);
    await tool(page, 'line');
    await dialog.waitFor({ state: 'hidden' });
    await assertPixelWidth(page, 4);
    const afterSettings = await snapshot(room);
    assert.equal(afterSettings.sequence, original.sequence, 'changing settings does not save a scene');
    assert.deepEqual(afterSettings.elements, original.elements, 'settings never alter an existing stroke');
    await page.getByTestId('button-undo').click();
    await waitScene(room, state => visibleElements(state).length === 0);
    await page.getByTestId('button-redo').click();
    originalStroke = visibleElements(await waitScene(room, state => visibleElements(state).length === 1))[0];
    await saved(page);

    const expected = { freedraw: 50, line: 50, rectangle: 8, ellipse: 1 };
    const native = value => value / (4.25 * Math.SQRT2);
    let count = 1;
    for (const [type, value] of Object.entries(expected)) {
      await tool(page, type);
      await setPixelWidth(page, value);
      const { x, y } = await drawingPoint(page, -100 + count * 55, .56);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 30, y + 24, { steps: 8 });
      await page.mouse.up();
      count++;
      const scene = await waitScene(room, state => visibleElements(state).length === count && visibleElements(state).some(e => e.type === type && e.id !== originalStroke.id));
      const element = visibleElements(scene).find(e => e.type === type && e.id !== originalStroke.id);
      assert.ok(Math.abs(element.strokeWidth - (type === 'freedraw' ? native(value) : value)) < 1e-8, `${type} stores honest pixel width`);
    }
    for (const type of ['selection', 'eraser', 'text']) {
      await tool(page, type);
      assert.equal(await widthTrigger(page).count(), 0);
    }
    for (const [type, value] of Object.entries(expected)) {
      await tool(page, type);
      await assertPixelWidth(page, value);
    }
    const scene = await snapshot(room);
    assert.deepEqual(scene.elements.find(e => e.id === originalStroke.id), originalStroke);
    const exportedScene = JSON.parse((await exported(page, '.excalidraw')).bytes.toString('utf8'));
    const widths = Object.fromEntries(visibleElements(exportedScene).filter(e => e.id !== originalStroke.id).map(e => [e.type, e.strokeWidth]));
    for (const [type, value] of Object.entries(expected)) assert.ok(Math.abs(widths[type] - (type === 'freedraw' ? native(value) : value)) < 1e-8);
    await peer.reload({ waitUntil: 'domcontentloaded' });
    await saved(peer);
    const reloaded = JSON.parse((await exported(peer, '.excalidraw')).bytes.toString('utf8'));
    assert.deepEqual(reloaded.elements, exportedScene.elements, 'peer reload/export retains all chosen widths');
    await assertPixelWidth(peer, 4, 'peer settings remain local');

    await setPixelWidth(page, 50);
    await panel(page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await page.setViewportSize({ width: 340, height: 420 });
    await assertPixelWidth(page, 50);
    await widthTrigger(page).press('Enter');
    dialog = widthDialog(page);
    await dialog.waitFor();
    const popup = await dialog.boundingBox();
    assert.ok(popup.x >= 0 && popup.x + popup.width <= 340 && popup.y >= 0 && popup.y + popup.height <= 420, JSON.stringify(popup));
    assert.equal(await dialog.getByRole('spinbutton', { name: 'Толщина в пикселях', exact: true }).inputValue(), '50');
    assert.equal(await dialog.getByRole('slider', { name: 'Толщина линии', exact: true }).inputValue(), '32');
    assert.equal(await dialog.getByRole('button', { name: '32 px', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Escape');
    await assertPixelWidth(page, 50);
    await page.screenshot({ path: '/tmp/interhub-whiteboard-pixel-width-narrow.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await panel(page).getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
    await openWidth(page);
    await page.screenshot({ path: '/tmp/interhub-whiteboard-pixel-width.png' });
  } finally { await browser.close(); }
});

test('простая доска открывается с карандашом и сохраняет выбранный инструмент для следующих фигур', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await participant(browser, room, true);
    await mode(page, 'Доска');
    await saved(page);
    const tools = drawingTools(page);
    const names = ['Выделение', 'Карандаш', 'Линия', 'Прямоугольник', 'Круг', 'Текст', 'Ластик'];
    await tools.waitFor();
    assert.equal(await tools.getByRole('radio').count(), names.length);
    assert.equal(await tools.getByRole('radio').first().getAttribute('aria-label'), 'Выделение', 'the hand selection tool is first');
    assert.equal(await panel(page).getByRole('button', { name: /^Закреплённый цвет/ }).count(), 1);
    for (const name of names) assert.ok(await tools.getByRole('radio', { name, exact: true }).isVisible(), name);
    assert.ok(await tools.getByRole('radio', { name: 'Карандаш', exact: true }).isChecked());

    async function drag(offset, vertical, dx, dy) {
      const { x, y } = await drawingPoint(page, offset, vertical);
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
    }
    // The first mark needs no tool click. A hidden SDK shortcut must not turn
    // the next real gesture into a diamond.
    await drag(-70, .30, 40, 20);
    await page.keyboard.press('3');
    await drag(35, .30, 40, 20);
    await waitScene(room, state => visibleElements(state).filter(e => e.type === 'freedraw').length === 2);

    await tool(page, 'rectangle');
    const ownColor = panel(page).getByTestId('room-drawing-color');
    const assignedColor = (await ownColor.getAttribute('data-color')).toLowerCase();
    const manualColor = assignedColor === '#db136a' ? '#835adb' : '#db136a';
    await tools.getByLabel('Цвет рисования').fill(manualColor);
    await drag(-70, .52, 50, 30);
    const firstBlocks = await waitScene(room, state => visibleElements(state).some(e => e.type === 'rectangle'));
    const firstBlock = visibleElements(firstBlocks).find(e => e.type === 'rectangle');
    assert.equal(firstBlock.strokeColor.toLowerCase(), manualColor);
    await ownColor.press('Enter');
    assert.equal(await tools.getByLabel('Цвет рисования').inputValue(), assignedColor);
    assert.ok(await tools.getByRole('radio', { name: 'Прямоугольник', exact: true }).isChecked());
    await drag(35, .52, 50, 30);
    const blocks = await waitScene(room, state => visibleElements(state).filter(e => e.type === 'rectangle').length === 2);
    for (const block of visibleElements(blocks).filter(e => e.type === 'rectangle')) {
      assert.equal(block.roughness, 0);
      assert.equal(block.backgroundColor, 'transparent');
      assert.equal(block.strokeColor.toLowerCase(), block.id === firstBlock.id ? manualColor : assignedColor);
    }
    assert.ok(await tools.getByRole('radio', { name: 'Прямоугольник', exact: true }).isChecked());
    await tool(page, 'line');
    await drag(-10, .52, 35, 0);
    await text(page, 'Связь');
    const scene = await waitScene(room, state => visibleElements(state).some(e => e.type === 'text' && e.text === 'Связь'));
    assert.deepEqual(visibleElements(scene).map(e => e.type).sort(), ['freedraw', 'freedraw', 'line', 'rectangle', 'rectangle', 'text']);

    await tool(page, 'selection');
    const point = await drawingPoint(page, -70, .52);
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    const sdk = panel(page).locator('.excalidraw');
    assert.equal(await sdk.locator('.App-toolbar-container:visible, .context-menu:visible, .selected-shape-actions:visible, .color-picker__button.properties-trigger:visible').count(), 0);

    const clipboardText = 'flowchart LR\n  A --> B';
    await sdk.evaluate((surface, value) => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      surface.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, clipboardText);
    const pasted = await waitScene(room, state => visibleElements(state).some(e => e.originalText === clipboardText));
    assert.equal(visibleElements(pasted).length, 7, 'paste adds a single label');
    await tool(page, 'rectangle');
    assert.ok(await sdk.evaluate(surface => surface === document.activeElement), 'pointer tool choice returns focus to the drawing');
    await sdk.evaluate(surface => {
      const mac = /mac/i.test(navigator.platform);
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'я', code: 'KeyZ', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
    });
    await waitScene(room, state => visibleElements(state).length === 6 && !visibleElements(state).some(e => e.originalText === clipboardText));
  } finally { await browser.close(); }
});

test('круг сохраняет равные стороны без Shift, очистка текущей доски отменяется одним Undo', async () => {
  const browser = await chromium.launch();
  try {
    const room = await createRoom();
    const owner = (await participant(browser, room, true)).page;
    const peer = (await participant(browser, room)).page;
    await mode(owner, 'Доска');
    await Promise.all([saved(owner), saved(peer)]);
    await selectCanvasTask(owner, room.tasks[1]);
    await saved(owner);
    await text(owner, 'Отдельная задача');
    await saved(owner);
    await selectCanvasTask(owner, room.tasks[0]);
    await saved(owner);
    await stroke(peer);
    const drawn = await waitScene(room, state => visibleElements(state).some(e => e.type === 'freedraw'));
    const strokeId = visibleElements(drawn)[0].id;
    await owner.bringToFront();
    await tool(owner, 'ellipse');
    for (const [offset, dx, dy] of [[-65, 50, 12], [55, 0, -30]]) {
      const { x, y } = await drawingPoint(owner, offset, .32);
      await owner.mouse.move(x, y); await owner.mouse.down();
      await owner.mouse.move(x + dx, y + dy, { steps: 6 }); await owner.mouse.up();
    }
    const populated = await waitScene(room, state => visibleElements(state).filter(e => e.type === 'ellipse').length === 2);
    const ids = visibleElements(populated).map(e => e.id).sort();
    for (const circle of visibleElements(populated).filter(e => e.type === 'ellipse')) {
      assert.ok(circle.width > 0 && circle.width === circle.height);
    }
    const clear = drawingTools(owner).getByRole('button', { name: 'Очистить всё', exact: true });
    await saved(owner);
    await clear.click();
    const blank = await waitScene(room, state => visibleElements(state).length === 0);
    assert.deepEqual(blank.elements.map(e => e.id).sort(), ids);
    await peer.waitForFunction(() => {
      const clear = document.querySelector('button[aria-label="Очистить всё"]');
      return clear?.disabled === true;
    });
    await panel(owner).getByTestId('button-undo').click();
    const restored = await waitScene(room, state => visibleElements(state).length === 3);
    assert.deepEqual(visibleElements(restored).map(e => e.id).sort(), ids);
    assert.ok(visibleElements(restored).some(e => e.id === strokeId));
    await selectCanvasTask(owner, room.tasks[1]);
    await saved(owner);
    const otherTask = await exported(owner, '.excalidraw');
    assert.deepEqual(visibleElements(JSON.parse(otherTask.bytes.toString('utf8'))).map(e => e.text), ['Отдельная задача']);
    await selectCanvasTask(owner, room.tasks[0]);
    await saved(owner);
    const original = await exported(owner, '.excalidraw');
    assert.deepEqual(visibleElements(JSON.parse(original.bytes.toString('utf8'))).map(e => e.id).sort(), ids);
  } finally { await browser.close(); }
});

test('два автора рисуют одновременно, своё Undo сохраняет чужой штрих, равномерный штрих пера и текст переживают reconnect и reload', async () => {
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
    const penScene = await waitScene(room, state => visibleElements(state).some(element => ![ownId, otherId].includes(element.id) && element.type === 'freedraw' && element.lastCommittedPoint));
    const pen = visibleElements(penScene).find(element => ![ownId, otherId].includes(element.id));
    assert.equal(pen.simulatePressure, false);
    assert.equal(pen.pressures.length, pen.points.length);
    assert.ok(pen.pressures.every(value => value === .5));
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
    const downloadButton = panel(candidate.page).getByRole('button', { name: 'Скачать', exact: true });
    await downloadButton.click();
    await panel(candidate.page).getByRole('menuitem', { name: 'PNG', exact: true }).waitFor();
    await candidate.context.setOffline(true);
    // Chromium's offline emulation may preserve an existing EventSource. Close
    // its lease through the same error event a broken network stream produces.
    await candidate.page.evaluate(() => window.__whiteboardTestSources.at(-1).dispatchEvent(new Event('error')));
    await candidate.page.waitForFunction(() => document.querySelector('[data-testid="room-connection-status"]')?.getAttribute('data-state') !== 'online');
    await panel(candidate.page).getByRole('menuitem', { name: 'PNG', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await downloadButton.isDisabled(), true);
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
    assert.ok(parsed.elements.some(element => element.id === pen.id && element.pressures.every(value => value === .5)));
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
    await assertStableAutosave(panel(owner.page), canvas(owner.page), '**/whiteboard/changes?*', () => stroke(owner.page));
    await waitScene(room, state => visibleElements(state).length === 1);
    const original = await canvas(owner.page).elementHandle();
    const code = await owner.page.locator('[data-testid="room-code-editor-host"]').elementHandle();
    const before = await panel(owner.page).boundingBox();
    await assertCompactCanvasHeader(panel(owner.page));
    await panel(owner.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    const expanded = await panel(owner.page).boundingBox();
    await assertCompactCanvasHeader(panel(owner.page));
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
    await candidate.page.setViewportSize({ width: 340, height: 420 });
    await assertCompactCanvasHeader(panel(candidate.page), { narrow: true });
    assert.ok(await panel(candidate.page).getByRole('button', { name: /Закреплённый цвет/ }).isDisabled());
    const restore = panel(candidate.page).getByRole('button', { name: 'Вернуться в комнату', exact: true });
    const restoreBox = await restore.boundingBox();
    assert.ok(restoreBox.y + restoreBox.height < 420 && restoreBox.x + restoreBox.width <= 340);
    const downloadButton = panel(candidate.page).getByRole('button', { name: 'Скачать', exact: true });
    await downloadButton.press('Enter');
    const formats = panel(candidate.page).getByRole('menu', { name: 'Формат скачивания' });
    await formats.waitFor();
    assert.deepEqual(await formats.getByRole('menuitem').allTextContents(), ['PNG', 'SVG', '.excalidraw']);
    assert.equal(await formats.evaluate(menu => !menu.closest('[inert]')), true);
    await candidate.page.keyboard.press('Escape');
    await formats.waitFor({ state: 'hidden' });
    assert.equal(await drawingTools(candidate.page).isVisible(), false, 'readonly has no drawing tools');
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
    const errorStatus = panel(owner.page).getByRole('status').filter({ hasText: /отклонено/i });
    const errorBox = await errorStatus.boundingBox();
    assert.ok(errorBox && errorBox.width > 1 && errorBox.height > 1, 'a rejected save displays its error');
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
