import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const headed = process.env.E2E_CANVAS_HEADED === 'true';

async function participant(browser, room, name, owner = false, theme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/drawio/js/app.min.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + ';var __captureCursorUi=EditorUi.prototype.initializeEmbedMode;EditorUi.prototype.initializeEmbedMode=function(){window.__cursorUi=this;return __captureCursorUi.apply(this,arguments);};' });
  });
  await context.addInitScript(({ room, name, owner, theme }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, name);
    localStorage.setItem('display_name', name);
    localStorage.setItem('interview-online:ui-theme', theme);
  }, { room, name, owner, theme });
  const page = await context.newPage();
  if (headed) {
    // Playwright enables focus emulation for every page by default. Disable
    // that automation shortcut so the actual OS window focus drives presence.
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  }
  page.setDefaultTimeout(20000);
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return page;
}
async function mode(page, label) {
  if (headed) await page.bringToFront();
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
  await page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) }).getByText(label, { exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).waitFor({ state: 'hidden' });
}
function cursor(page, name) { return page.locator('[data-testid="canvas-cursors"]').filter({ visible: true }).getByText(name, { exact: true }); }
async function moveOn(page, locator, x = .5, y = .5) {
  if (headed) await page.bringToFront();
  const box = await locator.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
}
async function snapshot(room, canvas) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/${canvas}`);
  assert.equal(response.status, 200);
  return response.json();
}
async function diagramFrame(page) {
  const element = await page.getByTitle('Редактор схемы', { exact: true }).elementHandle();
  const frame = await element.contentFrame();
  await frame.waitForFunction(() => window.__cursorUi?.editor.graph);
  return frame;
}

test('именные курсоры видны другим участникам на обоих холстах и при readonly просмотре', async () => {
  const browser = await chromium.launch({ headless: !headed });
  try {
    const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Курсоры', ownerDisplayName: 'Интервьюер', language: 'nodejs' }) });
    assert.equal(response.status, 200);
    const room = await response.json();
    const owner = await participant(browser, room, 'Интервьюер', true, 'dark');
    const candidate = await participant(browser, room, 'Кандидат');
    const guest = await participant(browser, room, 'Гость', false, 'dark');
    const recentPresence = new Map();
    if (headed) for (const [name, page] of [['owner', owner], ['candidate', candidate], ['guest', guest]]) page.on('request', request => {
      if (request.method() !== 'POST' || !request.url().endsWith('/events')) return;
      const data = request.postDataJSON();
      if (data?.type !== 'canvas_cursor_update') return;
      const recent = recentPresence.get(name) ?? [];
      recent.push({ canvas: data.canvasType, active: data.canvasActive, subscribed: data.canvasSubscribed, visible: data.canvasVisible, x: data.canvasX, y: data.canvasY });
      recentPresence.set(name, recent.slice(-8));
    });
    let receiverPresenceUpdates = 0;
    candidate.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/events') && request.postDataJSON()?.type === 'canvas_cursor_update') receiverPresenceUpdates += 1;
    });
    await mode(owner, 'Доска');
    for (const page of [owner, candidate, guest]) await page.getByRole('region', { name: 'Доска интервью', exact: true }).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
    const before = await snapshot(room, 'whiteboard');
    const board = owner.getByTestId('room-whiteboard-canvas').locator('canvas.excalidraw__canvas.interactive');
    await moveOn(owner, board);
    if (headed) {
      assert.equal(await owner.evaluate(() => document.hasFocus()), true, 'sender window has real focus');
      assert.deepEqual(await candidate.evaluate(() => ({ focused: document.hasFocus(), hidden: document.hidden })),
        { focused: false, hidden: false }, 'visible receiver window remains unfocused without a focus override');
    }
    await Promise.all([cursor(candidate, 'Интервьюер').waitFor(), cursor(guest, 'Интервьюер').waitFor()]);
    if (headed) {
      await candidate.screenshot({ path: '/tmp/interhub-canvas-unfocused-whiteboard.png' });
      await guest.screenshot({ path: '/tmp/interhub-canvas-dark-whiteboard.png' });
    }
    assert.equal(await cursor(owner, 'Интервьюер').count(), 0);
    const receiverUpdatesBeforeHeartbeat = receiverPresenceUpdates;
    await owner.waitForTimeout(5500);
    assert.equal(await cursor(candidate, 'Интервьюер').isVisible(), true, 'stationary pointer is renewed');
    if (headed) assert.ok(receiverPresenceUpdates > receiverUpdatesBeforeHeartbeat, 'visible unfocused receiver renews its authorized canvas scope');
    assert.equal((await snapshot(room, 'whiteboard')).sequence, before.sequence);
    await owner.mouse.move(2, 2);
    await cursor(candidate, 'Интервьюер').waitFor({ state: 'hidden' });
    await mode(owner, 'Редактор диаграмм');
    for (const page of [owner, candidate, guest]) await page.getByRole('region', { name: 'Схема интервью', exact: true }).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
    const frame = await diagramFrame(owner);
    await frame.evaluate(() => {
      const graph = window.__cursorUi.editor.graph;
      const cell = graph.insertVertex(graph.getDefaultParent(), null, 'Объект', 100, 100, 160, 70);
      graph.scrollCellToVisible(cell);
    });
    await owner.getByRole('region', { name: 'Схема интервью', exact: true }).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
    const candidateFrame = await diagramFrame(candidate);
    await candidateFrame.evaluate(() => { const graph = window.__cursorUi.editor.graph; graph.view.scaleAndTranslate(.75, 40, 30); });
    const modelPoint = await frame.evaluate(() => {
      const graph = window.__cursorUi.editor.graph, rect = graph.container.getBoundingClientRect();
      return { x: rect.left + (180 + graph.view.translate.x) * graph.view.scale - graph.container.scrollLeft,
        y: rect.top + (135 + graph.view.translate.y) * graph.view.scale - graph.container.scrollTop,
        bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
    });
    assert.ok(modelPoint.x > modelPoint.bounds.left && modelPoint.x < modelPoint.bounds.right &&
      modelPoint.y > modelPoint.bounds.top && modelPoint.y < modelPoint.bounds.bottom, `fixture object must be inside the actual graph viewport: ${JSON.stringify(modelPoint)}`);
    const frameBox = await owner.getByTitle('Редактор схемы', { exact: true }).boundingBox();
    if (headed) {
      await owner.bringToFront();
      assert.equal(await owner.evaluate(() => document.hasFocus()), true, 'diagram sender window has real focus');
    }
    await owner.mouse.move(frameBox.x + modelPoint.x, frameBox.y + modelPoint.y);
    await Promise.all([cursor(candidate, 'Интервьюер').waitFor(), cursor(guest, 'Интервьюер').waitFor()]).catch(async error => {
      console.info('CANVAS_PRESENCE', Object.fromEntries(recentPresence));
      console.info('CANVAS_FOCUS', await Promise.all([owner, candidate, guest].map(page => page.evaluate(() => ({ focus: document.hasFocus(), hidden: document.hidden, active: document.activeElement?.tagName })))));
      console.info('CANVAS_POINT', modelPoint, frameBox, await frame.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.outerHTML?.slice(0, 300), modelPoint));
      await owner.screenshot({ path: '/tmp/interhub-canvas-owner-debug.png' });
      await candidate.screenshot({ path: '/tmp/interhub-canvas-candidate-debug.png' });
      throw error;
    });
    if (headed) {
      await candidate.screenshot({ path: '/tmp/interhub-canvas-unfocused-diagram.png' });
      await guest.screenshot({ path: '/tmp/interhub-canvas-dark-diagram.png' });
    }
    const expectedPoint = await candidateFrame.evaluate(() => {
      const graph = window.__cursorUi.editor.graph, rect = graph.container.getBoundingClientRect();
      return { x: rect.left + (180 + graph.view.translate.x) * graph.view.scale - graph.container.scrollLeft,
        y: rect.top + (135 + graph.view.translate.y) * graph.view.scale - graph.container.scrollTop };
    });
    const candidateFrameBox = await candidate.getByTitle('Редактор схемы', { exact: true }).boundingBox();
    const marker = await cursor(candidate, 'Интервьюер').locator('..').boundingBox();
    assert.ok(Math.abs(marker.x - candidateFrameBox.x - expectedPoint.x) < 2, 'cursor stays on the same model x at another zoom');
    assert.ok(Math.abs(marker.y - candidateFrameBox.y - expectedPoint.y) < 2, 'cursor stays on the same model y at another zoom');
    await candidateFrame.evaluate(() => {
      const graph = window.__cursorUi.editor.graph;
      graph.container.scrollLeft = graph.container.scrollWidth;
      graph.container.scrollTop = graph.container.scrollHeight;
    });
    await candidate.locator('[data-testid="canvas-cursors"] [data-offscreen="true"]').waitFor().catch(async error => {
      console.info('CURSOR_VIEW', await candidateFrame.evaluate(() => { const g = window.__cursorUi.editor.graph; return { scale: g.view.scale, translate: g.view.translate, scroll: [g.container.scrollLeft, g.container.scrollTop], size: [g.container.clientWidth, g.container.clientHeight] }; }));
      console.info('CURSOR_MARKERS', await candidate.locator('[data-testid="canvas-cursors"]').allTextContents());
      await candidate.screenshot({ path: '/tmp/interhub-cursor-edge-debug.png' });
      throw error;
    });
    await candidateFrame.evaluate(() => window.__cursorUi.editor.graph.view.scaleAndTranslate(.75, 40, 30));
    const finished = await fetch(`${api}/rooms/${room.inviteCode}/verdict`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Owner-Token': room.ownerToken }, body: JSON.stringify({ verdict: 'HIRE' }) });
    assert.equal(finished.status, 200);
    const preview = candidate.getByAltText('Сохранённая схема интервью', { exact: true });
    await preview.waitFor({ state: 'visible' });
    await moveOn(candidate, preview);
    await cursor(owner, 'Кандидат').waitFor();
    await candidate.screenshot({ path: '/tmp/interhub-canvas-cursors-readonly.png' });
  } finally { await browser.close(); }
});
