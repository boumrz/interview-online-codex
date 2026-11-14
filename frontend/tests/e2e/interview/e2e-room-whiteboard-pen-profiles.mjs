import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

// Capability profiles, NOT vendor firmware/driver emulators. Every drawing
// gesture below is trusted Chromium pen input, never Playwright mouse drawing.
const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const visible = scene => scene.elements.filter(element => !element.isDeleted);
const profiles = [{ name: '14-bit pressure pen', levels: 16384 }, { name: '13-bit pressure pen', levels: 8192 }];
const quantize = (force, levels) => Math.round(force * (levels - 1)) / (levels - 1);
function panel(page) { return page.getByRole('region', { name: 'Доска интервью', exact: true }); }
async function saved(page) { await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor(); }
async function tool(page, name) {
  await page.bringToFront();
  const radio = page.getByRole('group', { name: 'Инструменты доски' }).getByTestId(`toolbar-${name}`);
  await radio.locator('..').click();
  assert.equal(await radio.isChecked(), true);
}
async function pixelWidth(page, value) {
  await page.getByRole('button', { name: /^Толщина линии:/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Толщина линии', exact: true });
  const input = dialog.getByRole('spinbutton', { name: 'Толщина в пикселях', exact: true });
  await input.fill(String(value));
  await input.press('Tab');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
}
const nativeFreehandWidth = pixels => pixels / (4.25 * Math.SQRT2);
async function room() {
  const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Перо без mouse fallback', ownerDisplayName: 'Автор A', language: 'nodejs' }) });
  assert.equal(response.status, 200);
  return response.json();
}
async function participant(browser, room, owner) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(({ room, owner }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Автор A' : 'Автор B');
    localStorage.setItem('display_name', owner ? 'Автор A' : 'Автор B');
    localStorage.setItem('interview-online:ui-theme', 'light');
    window.__penProfileEvents = [];
    window.__penProfileSources = [];
    window.__penProfileGeneration = -1;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) {
        super(...args);
        window.__penProfileSources.push(this);
        this.addEventListener('message', event => {
          try { if (JSON.parse(event.data).type === 'state_sync') window.__penProfileGeneration = window.__penProfileSources.indexOf(this); } catch {}
        });
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(type, event => {
      if (!event.target?.matches?.('canvas.interactive')) return;
      window.__penProfileEvents.push({ type, pointerType: event.pointerType, pressure: event.pressure, buttons: event.buttons, trusted: event.isTrusted });
    }, true);
  }, { room, owner });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return { context, page, errors, cdp: await context.newCDPSession(page) };
}
async function board(page) {
  await page.bringToFront();
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const id = await control.getByRole('combobox').getAttribute('aria-controls');
  await page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(id)}]`) }).getByText('Доска', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
}
async function snapshot(room) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/whiteboard`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
  assert.equal(response.status, 200);
  return response.json();
}
async function waitScene(room, predicate) {
  const deadline = Date.now() + 20000;
  let scene;
  do {
    scene = await snapshot(room);
    if (predicate(scene)) return scene;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < deadline);
  assert.fail(`Pen profile scene not accepted; sequence=${scene?.sequence}, elements=${scene?.elements.length}`);
}
async function point(page, dx) {
  const bounds = await page.getByTestId('room-whiteboard-canvas').locator('canvas.interactive').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && viewport);
  const left = Math.max(0, bounds.x), right = Math.min(viewport.width, bounds.x + bounds.width);
  const top = Math.max(0, bounds.y), bottom = Math.min(viewport.height, bounds.y + bounds.height);
  const p = { x: Math.round(left + (right - left) * .65 + dx), y: Math.round(top + (bottom - top) * .67) };
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.matches('canvas.interactive'), p);
  return p;
}
async function pen(actor, profile, dx, selectedTool = 'freedraw', position) {
  const surface = actor.page.getByTestId('room-whiteboard-canvas').locator('canvas.interactive');
  const before = position ? await surface.boundingBox() : null;
  await tool(actor.page, selectedTool);
  const after = position ? await surface.boundingBox() : null;
  // The width picker is hidden for eraser, which can remove a toolbar row.
  // Reproject an earlier stroke's screen point into the resized canvas.
  const start = position ? { x: position.x + after.x - before.x, y: position.y + after.y - before.y } : await point(actor.page, dx);
  const low = quantize(.18, profile.levels), high = quantize(.86, profile.levels);
  await actor.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start, pointerType: 'pen', buttons: 0, force: 0 });
  if (selectedTool === 'freedraw') await actor.page.getByTestId('whiteboard-pen-hover').waitFor();
  await actor.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: low });
  for (let i = 1; i <= 14; i++) {
    await actor.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + i * 4, y: start.y + Math.round(Math.sin(i / 2) * 13), pointerType: 'pen', buttons: 1, force: i < 7 ? low : high });
    await actor.page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await actor.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + 56, y: start.y + 8, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  return start;
}
function fixedWidthStroke(element) {
  return element.type === 'freedraw' && !!element.lastCommittedPoint && element.simulatePressure === false &&
    element.pressures.length === element.points.length && element.pressures.every(p => p === .5);
}
async function assertPenOnly(page) {
  const events = await page.evaluate(() => window.__penProfileEvents);
  assert.ok(events.filter(event => event.type === 'pointerdown').length >= 1);
  assert.ok(events.every(event => event.trusted && event.pointerType === 'pen'), 'canvas drawing must contain trusted pen events, no mouse fallback');
  assert.ok(events.some(event => event.buttons === 1 && event.pressure < .3));
  assert.ok(events.some(event => event.buttons === 1 && event.pressure > .7));
}
async function exported(page, label) {
  await panel(page).getByRole('button', { name: 'Скачать', exact: true }).click();
  const pending = page.waitForEvent('download');
  await panel(page).getByRole('menuitem', { name: label, exact: true }).click();
  const chunks = [];
  for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('перо с разным нажимом рисует одинаковую толщину уже до отпускания', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const doc = await room();
    const { page, cdp } = await participant(browser, doc, true);
    await board(page);
    await saved(page);
    await page.bringToFront();
    await pixelWidth(page, 16);
    const color = await panel(page).getByTestId('room-drawing-color').getAttribute('data-color');
    const start = await point(page, -80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, pointerType: 'pen', force: .12 });
    for (let dx = 4; dx <= 128; dx += 4) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + dx, y: start.y, buttons: 1, pointerType: 'pen', force: dx < 64 ? .12 : .92 });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    const thicknesses = await page.evaluate(({ start, color }) => {
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      const canvases = [...document.querySelectorAll('[data-testid="room-whiteboard-canvas"] canvas')].filter(canvas => {
        const rect = canvas.getBoundingClientRect();
        return canvas.width && canvas.height && rect.width && rect.height;
      });
      return [32, 96].map(dx => Math.max(...canvases.map(canvas => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
        const x = Math.round((start.x + dx - rect.left) * scaleX);
        const y = Math.round((start.y - rect.top - 35) * scaleY);
        const pixels = canvas.getContext('2d').getImageData(x, y, 1, Math.round(70 * scaleY)).data;
        let matched = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 180 && rgb.every((channel, offset) => Math.abs(pixels[i + offset] - channel) < 20)) matched++;
        }
        return matched / scaleY;
      })));
    }, { start, color });
    assert.ok(thicknesses.every(width => width >= 14 && width <= 17), '16 px is rendered as an approximately 16 px stroke: ' + JSON.stringify(thicknesses));
    assert.ok(Math.abs(thicknesses[0] - thicknesses[1]) <= 1, JSON.stringify(thicknesses));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + 128, y: start.y, button: 'left', buttons: 0, pointerType: 'pen', force: 0 });
    await waitScene(doc, scene => visible(scene).length === 1 && fixedWidthStroke(visible(scene)[0]));
  } finally { await browser.close(); }
});

for (const profile of profiles) test(`PEN only ${profile.name}: hover, pressure, two authors, eraser/Undo, reconnect, reload and exports`, { timeout: 180000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const doc = await room();
    const owner = await participant(browser, doc, true);
    const candidate = await participant(browser, doc, false);
    await board(owner.page);
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    const ownerColor = await panel(owner.page).getByTestId('room-drawing-color').getAttribute('data-color');
    const candidateColor = await panel(candidate.page).getByTestId('room-drawing-color').getAttribute('data-color');
    assert.notEqual(ownerColor, candidateColor);
    await pixelWidth(owner.page, 16);
    const ownStart = await pen(owner, profile, -105);
    const first = await waitScene(doc, scene => visible(scene).length === 1 && fixedWidthStroke(visible(scene)[0]));
    const ownId = visible(first)[0].id;
    assert.equal(visible(first)[0].strokeColor.toUpperCase(), ownerColor);
    assert.ok(Math.abs(visible(first)[0].strokeWidth - nativeFreehandWidth(16)) < 1e-8);
    await pen(candidate, profile, 65);
    const both = await waitScene(doc, scene => visible(scene).length === 2 && visible(scene).every(fixedWidthStroke));
    const peerId = visible(both).find(element => element.id !== ownId).id;
    assert.ok(Math.abs(visible(both).find(element => element.id === peerId).strokeWidth - nativeFreehandWidth(4)) < 1e-8);
    assert.equal(visible(both).find(element => element.id === peerId).strokeColor.toUpperCase(), candidateColor);
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    await pen(owner, profile, 0, 'eraser', ownStart);
    await waitScene(doc, scene => visible(scene).length === 1 && visible(scene)[0].id === peerId);
    await saved(owner.page);
    await owner.page.getByTestId('button-undo').click();
    await waitScene(doc, scene => visible(scene).length === 2 && visible(scene).some(element => element.id === ownId));
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    await assertPenOnly(owner.page);
    await assertPenOnly(candidate.page);

    const generation = await candidate.page.evaluate(() => window.__penProfileGeneration);
    await candidate.context.setOffline(true);
    await candidate.page.evaluate(() => window.__penProfileSources.at(-1).dispatchEvent(new Event('error')));
    await candidate.page.waitForFunction(() => document.querySelector('[data-testid="room-connection-status"]')?.getAttribute('data-state') !== 'online');
    await pen(candidate, profile, -30);
    await candidate.context.setOffline(false);
    await candidate.page.waitForFunction(previous => window.__penProfileGeneration > previous && window.__penProfileGeneration === window.__penProfileSources.length - 1, generation);
    const recovered = await waitScene(doc, scene => visible(scene).length === 3 && visible(scene).every(fixedWidthStroke));
    await Promise.all([saved(owner.page), saved(candidate.page)]);
    await assertPenOnly(candidate.page);
    const newId = visible(recovered).find(element => element.id !== ownId && element.id !== peerId).id;
    assert.equal(visible(recovered).find(element => element.id === newId).strokeColor.toUpperCase(), candidateColor);
    await candidate.page.reload();
    await saved(candidate.page);
    assert.equal(await panel(candidate.page).getByTestId('room-drawing-color').getAttribute('data-color'), candidateColor);
    assert.deepEqual(visible(await snapshot(doc)).map(element => element.id).sort(), visible(recovered).map(element => element.id).sort());
    await owner.page.bringToFront();
    const json = JSON.parse((await exported(owner.page, '.excalidraw')).toString('utf8'));
    assert.deepEqual(visible(json).map(element => element.id).sort(), visible(recovered).map(element => element.id).sort());
    // Native restore/export clears lastCommittedPoint, a capture-only marker.
    // The accepted stroke's actual geometry and fixed pressure must survive.
    const geometry = scene => visible(scene).map(element => ({
      id: element.id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height, angle: element.angle,
      points: element.points, pressures: element.pressures, simulatePressure: element.simulatePressure,
      strokeWidth: element.strokeWidth, strokeColor: element.strokeColor,
    })).sort((left, right) => left.id.localeCompare(right.id));
    assert.deepEqual(geometry(json), geometry(recovered), 'native export retains the accepted fixed-width geometry');
    const png = await exported(owner.page, 'PNG');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const svg = (await exported(owner.page, 'SVG')).toString('utf8');
    assert.match(svg, /<svg/); assert.match(svg, /<path/);
    assert.deepEqual(owner.errors, []); assert.deepEqual(candidate.errors, []);
  } finally { await browser.close(); }
});
