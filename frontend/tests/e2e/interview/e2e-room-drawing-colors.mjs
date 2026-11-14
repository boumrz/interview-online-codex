import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
async function createRoom() {
  const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Цвета участников', ownerDisplayName: 'Интервьюер', language: 'nodejs' }) });
  assert.equal(response.status, 200);
  return response.json();
}
async function participant(browser, room, owner = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/drawio/js/app.min.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + ';var __captureDiagram=EditorUi.prototype.initializeEmbedMode;EditorUi.prototype.initializeEmbedMode=function(){window.__interhubTestUi=this;return __captureDiagram.apply(this,arguments);};' });
  });
  await context.addInitScript(({ room, owner }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('display_name', owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('interview-online:ui-theme', 'light');
  }, { room, owner });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => console.info('DRAWING_COLOR_PAGE_ERROR', error.message));
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return page;
}
async function mode(page, label) {
  await page.bringToFront();
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
  const dropdown = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) });
  await dropdown.getByText(label, { exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
}
function panel(page, label) { return page.getByRole('region', { name: label, exact: true }); }
async function ready(page, label) { await panel(page, label).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor(); }
async function color(page, label) {
  const swatch = panel(page, label).getByTestId('room-drawing-color');
  await swatch.waitFor();
  const result = await swatch.getAttribute('data-color');
  assert.match(result, /^#[0-9A-F]{6}$/);
  return result;
}
async function snapshot(room, document = 'whiteboard') {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/${document}`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
  assert.equal(response.status, 200);
  return response.json();
}
async function waitScene(room, count) {
  const deadline = Date.now() + 20000;
  do {
    const state = await snapshot(room);
    const elements = state.elements.filter(element => !element.isDeleted);
    if (elements.length === count) return elements;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`Expected ${count} saved objects`);
}
async function stroke(page, offset = 0) {
  await page.bringToFront();
  await page.getByRole('group', { name: 'Инструменты доски' }).getByTestId('toolbar-freedraw').locator('..').click();
  const canvas = page.getByTestId('room-whiteboard-canvas').locator('canvas.interactive');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  const x = bounds.x + bounds.width * .62 + offset, y = bounds.y + bounds.height * .65;
  await page.waitForFunction(({ x, y }) => document.elementFromPoint(x, y)?.matches('canvas.interactive'), { x, y });
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x + i * 5, y + Math.sin(i / 2) * 20);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
}
async function frame(page) {
  await ready(page, 'Схема интервью');
  const iframe = await page.locator('iframe[title="Редактор схемы"]').elementHandle();
  const result = await iframe.contentFrame();
  await result.waitForFunction(() => window.__interhubTestUi?.editor?.graph?.getDefaultParent());
  return result;
}
async function manualColor(page, value) {
  await page.bringToFront();
  await panel(page, 'Доска интервью').getByLabel('Цвет рисования', { exact: true }).fill(value.toLowerCase());
}
async function blockAndConnector(editor, expected) {
  await editor.evaluate(() => {
    const graph = window.__interhubTestUi.editor.graph;
    const capture = { ids: [], listener: (_sender, event) => { capture.ids.push(...event.getProperty('cells').filter(cell => graph.getModel().isVertex(cell)).map(cell => cell.id)); } };
    window.__nativeColorInsertion = capture;
    graph.addListener('cellsInserted', capture.listener);
  });
  await editor.locator('.geSidebar a.geItem').first().click();
  await editor.waitForFunction(() => window.__nativeColorInsertion.ids.length > 0);
  const created = await editor.evaluate(() => {
    const graph = window.__interhubTestUi.editor.graph;
    const captured = window.__nativeColorInsertion;
    graph.removeListener(captured.listener);
    const shape = graph.getModel().getCell(captured.ids[0]);
    delete window.__nativeColorInsertion;
    // This is the native command used by the connection arrow. It builds and
    // inserts its own styles; the test supplies no colors or cell style text.
    const connected = graph.connectVertex(shape, 'east', 160, new MouseEvent('mouseup'), true, true);
    const edge = connected.find(cell => graph.getModel().isEdge(cell));
    return { shapeId: shape.id, edgeId: edge?.id, shapeStyle: shape.style, edgeStyle: edge?.style,
      shapeColor: graph.getCellStyle(shape).strokeColor, edgeColor: edge && graph.getCellStyle(edge).strokeColor };
  });
  assert.equal(created.shapeColor.toUpperCase(), expected);
  assert.equal(created.edgeColor.toUpperCase(), expected);
  assert.ok(created.shapeStyle.toUpperCase().includes(`STROKECOLOR=${expected}`), 'new shape stores its author color explicitly');
  assert.ok(created.edgeStyle.toUpperCase().includes(`STROKECOLOR=${expected}`), 'new connector stores its author color explicitly');
  return created;
}
async function diagramFreehand(page, editor, expected) {
  await page.bringToFront();
  await editor.evaluate(() => {
    const ui = window.__interhubTestUi;
    const capture = { id: null, listener: (_sender, event) => { capture.id = event.getProperty('cell').id; } };
    window.__nativeColorFreehandInsertion = capture;
    ui.editor.graph.addListener('freehandInserted', capture.listener);
    ui.actions.get('insertFreehand').funct();
  });
  const offset = await page.locator('iframe[title="Редактор схемы"]').boundingBox();
  const point = await editor.evaluate(() => {
    const bounds = window.__interhubTestUi.editor.graph.container.getBoundingClientRect();
    return { x: bounds.x + bounds.width * .3, y: bounds.y + bounds.height * .72 };
  });
  const x = offset.x + point.x, y = offset.y + point.y;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x + i * 4, y + Math.sin(i / 2) * 14);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await editor.waitForFunction(() => window.__nativeColorFreehandInsertion.id !== null);
  const result = await editor.evaluate(() => {
    const ui = window.__interhubTestUi, graph = ui.editor.graph;
    const captured = window.__nativeColorFreehandInsertion;
    graph.removeListener(captured.listener);
    const cell = graph.getModel().getCell(captured.id);
    delete window.__nativeColorFreehandInsertion;
    ui.actions.get('insertFreehand').funct();
    return { id: cell.id, color: graph.getCellStyle(cell).strokeColor, style: cell.style };
  });
  assert.equal(result.color.toUpperCase(), expected, 'real draw.io freehand gesture uses author default');
  assert.ok(result.style.toUpperCase().includes(`STROKECOLOR=${expected}`));
  return result.id;
}

test('цвета новых native штрихов и схем уникальны, сохраняются между режимами и после reload', { timeout: 180000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await participant(browser, room, true);
    const candidate = await participant(browser, room);
    await mode(owner, 'Доска');
    await Promise.all([ready(owner, 'Доска интервью'), ready(candidate, 'Доска интервью')]);
    const ownerColor = await color(owner, 'Доска интервью'), candidateColor = await color(candidate, 'Доска интервью');
    assert.notEqual(ownerColor, candidateColor, 'participants have different assigned defaults');
    const roster = owner.getByTestId('participant-drawing-color');
    await roster.nth(1).waitFor();
    assert.deepEqual((await roster.evaluateAll(nodes => nodes.map(node => node.dataset.color))).sort(),
      [ownerColor, candidateColor].sort(), 'roster links both names to native drawing colors');
    await stroke(owner, -50); await waitScene(room, 1);
    await stroke(candidate, 30);
    const strokes = await waitScene(room, 2);
    assert.deepEqual(strokes.map(element => element.strokeColor.toUpperCase()).sort(), [ownerColor, candidateColor].sort(), 'real native gestures use assigned colors');
    const customColor = '#C036D8';
    await manualColor(owner, customColor);
    await stroke(owner, -130);
    const manual = await waitScene(room, 3);
    assert.equal(manual.find(element => !strokes.some(previous => previous.id === element.id)).strokeColor.toUpperCase(), customColor);
    await stroke(candidate, 80); await waitScene(room, 4);
    await owner.evaluate(() => { localStorage.setItem('interview-online:ui-theme', 'dark'); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: 'dark' })); });
    const unchanged = await waitScene(room, 4);
    await mode(owner, 'Редактор диаграмм');
    const ownerFrame = await frame(owner), candidateFrame = await frame(candidate);
    assert.equal(await color(owner, 'Схема интервью'), ownerColor);
    assert.equal(await color(candidate, 'Схема интервью'), candidateColor);
    // Model an old document cell that predates author defaults: no inline
    // color. This fixture intentionally bypasses the native insertion UI.
    const legacyId = await ownerFrame.evaluate(() => {
      const graph = window.__interhubTestUi.editor.graph;
      return graph.insertVertex(graph.getDefaultParent(), null, 'Ранее сохранённая фигура', 30, 30, 140, 60).id;
    });
    await candidateFrame.waitForFunction(id => Boolean(window.__interhubTestUi.editor.graph.getModel().getCell(id)), legacyId);
    const diagramObjects = [];
    for (const [page, editor, expected] of [[owner, ownerFrame, ownerColor], [candidate, candidateFrame, candidateColor]]) {
      const defaults = await editor.evaluate(() => {
        const graph = window.__interhubTestUi.editor.graph;
        return { vertex: graph.currentVertexStyle.strokeColor, edge: graph.currentEdgeStyle.strokeColor, routing: graph.currentEdgeStyle.edgeStyle };
      });
      assert.equal(defaults.vertex.toUpperCase(), expected);
      assert.equal(defaults.edge.toUpperCase(), expected);
      assert.equal(defaults.routing, 'orthogonalEdgeStyle');
      if (page === owner) {
        // Seed alternate local styles and an existing selection. The next
        // clicks and insertions use the real toolbar, palette and native pen.
        await editor.evaluate(({ id, customColor }) => {
          const graph = window.__interhubTestUi.editor.graph;
          graph.setSelectionCell(graph.getModel().getCell(id));
          for (const style of [graph.currentVertexStyle, graph.currentEdgeStyle]) {
            style.strokeColor = customColor;
            style.fontColor = customColor;
          }
          graph.freehand.setStrokeColor(customColor);
        }, { id: legacyId, customColor });
        await panel(owner, 'Схема интервью').getByRole('button', { name: /Закреплённый цвет/ }).press('Enter');
        assert.equal(await owner.getByRole('list', { name: 'Цвета участников' }).count(), 0);
        const restored = await editor.evaluate(() => {
          const graph = window.__interhubTestUi.editor.graph;
          return [graph.currentVertexStyle.fontColor, graph.currentEdgeStyle.fontColor].map(value => value.toUpperCase());
        });
        assert.deepEqual(restored, [expected, expected], 'keyboard action restores text defaults');
      }
      const block = await blockAndConnector(editor, expected);
      const freehandId = await diagramFreehand(page, editor, expected);
      diagramObjects.push({ ...block, freehandId, color: expected });
    }
    for (const editor of [ownerFrame, candidateFrame]) {
      const legacy = await editor.evaluate(id => {
        const graph = window.__interhubTestUi.editor.graph;
        return { color: graph.getCellStyle(graph.getModel().getCell(id)).strokeColor, foreground: graph.shapeForegroundColor };
      }, legacyId);
      assert.equal(legacy.color, legacy.foreground, 'legacy unstyled objects keep the native adaptive black/white foreground for every viewer');
      for (const object of diagramObjects) {
        await editor.waitForFunction(({ shapeId, edgeId, freehandId }) => {
          const model = window.__interhubTestUi.editor.graph.getModel();
          return Boolean(model.getCell(shapeId) && model.getCell(edgeId) && model.getCell(freehandId));
        }, object);
        const colors = await editor.evaluate(({ shapeId, edgeId, freehandId }) => {
          const graph = window.__interhubTestUi.editor.graph;
          return [shapeId, edgeId, freehandId].map(id => graph.getCellStyle(graph.getModel().getCell(id)).strokeColor.toUpperCase());
        }, object);
        assert.deepEqual(colors, [object.color, object.color, object.color], 'every viewer sees the original author colors');
      }
    }
    let diagram;
    const deadline = Date.now() + 15000;
    do {
      diagram = await snapshot(room, 'diagram');
      if (diagramObjects.every(object => [object.shapeId, object.edgeId, object.freehandId].every(id => diagram.xml.includes(`id="${id}"`)))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(diagramObjects.every(object => [object.shapeId, object.edgeId, object.freehandId].every(id => diagram.xml.includes(`id="${id}"`))), 'all native insertions are durably saved');
    await Promise.all([ready(owner, 'Схема интервью'), ready(candidate, 'Схема интервью')]);
    for (const expected of [ownerColor, candidateColor]) assert.ok(diagram.xml.toUpperCase().includes(`STROKECOLOR=${expected}`));
    // Remote additions and mode/theme changes must preserve original objects.
    await mode(owner, 'Доска'); await ready(owner, 'Доска интервью');
    assert.deepEqual((await waitScene(room, 4)).map(element => element.strokeColor), unchanged.map(element => element.strokeColor));
    await stroke(owner, -180);
    const afterMode = await waitScene(room, 5);
    assert.equal(afterMode.find(element => !unchanged.some(previous => previous.id === element.id)).strokeColor.toUpperCase(), customColor, 'remote updates, theme and modes preserve manual native choice');
    await owner.getByTestId('button-undo').click();
    const afterUndo = await waitScene(room, 4);
    assert.deepEqual(afterUndo.map(element => element.id), unchanged.map(element => element.id), 'own Undo preserves peer strokes and colors');
    await owner.reload(); await ready(owner, 'Доска интервью');
    assert.equal(await color(owner, 'Доска интервью'), ownerColor);
    await stroke(owner, -100);
    const afterReload = await waitScene(room, 5);
    assert.equal(afterReload.find(element => !unchanged.some(previous => previous.id === element.id)).strokeColor.toUpperCase(), ownerColor);
  } finally { await browser.close(); }
});
