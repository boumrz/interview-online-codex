import '../support/require-isolated-api.mjs';
import { assertCompactCanvasHeader, assertStableAutosave } from '../support/canvas-header.mjs';
import { expectLegacyCanvasBlocked, selectCanvasTask, waitForCanvasTask } from '../support/canvas-tasks.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
function diagramPanel(page) { return page.getByRole('region', { name: 'Схема интервью', exact: true }); }

async function downloadDiagram(page, format) {
  const panel = diagramPanel(page);
  await panel.getByRole('button', { name: 'Скачать', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await panel.getByRole('menuitem', { name: format, exact: true }).click();
  return downloading;
}

async function createRoom() {
  const response = await fetch(`${api}/public/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Совместная архитектура', ownerDisplayName: 'Интервьюер', language: 'nodejs' }),
  });
  assert.equal(response.status, 200);
  const room = await response.json();
  assert.equal(room.roomDiagramsEnabled, true, 'the isolated backend enables the feature explicitly');
  return room;
}

async function openParticipant(browser, room, owner = false, theme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  // Observe the real editor in this isolated test; production has no test hooks.
  await context.route('**/drawio/js/app.min.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + ';var __captureDiagram=EditorUi.prototype.initializeEmbedMode;EditorUi.prototype.initializeEmbedMode=function(){window.__interhubTestUi=this;return __captureDiagram.apply(this,arguments);};' });
  });
  await context.addInitScript(({ inviteCode, ownerToken, displayName, theme }) => {
    if (ownerToken) localStorage.setItem(`owner_token_${inviteCode}`, ownerToken);
    localStorage.setItem('display_name', displayName);
    localStorage.setItem(`guest_display_name_${inviteCode}`, displayName);
    localStorage.setItem('room_sync_log', '0');
    localStorage.setItem('interview-online:ui-theme', theme);
    window.__holdDiagramAuthority = false;
    window.__diagramHeldStates = [];
    window.__diagramSources = [];
    window.__diagramCurrentLeaseState = -1;
    window.__diagramTransportLease = -1;
    window.__diagramRequestsBeforeProof = [];
    const nativeFetch = window.fetch;
    window.fetch = (input, init) => {
      if (window.__holdDiagramAuthority && window.__diagramTransportLease > window.__diagramCurrentLeaseState
          && /\/diagram(?:\/changes)?\?/.test(String(input))) window.__diagramRequestsBeforeProof.push(init?.method ?? 'GET');
      return nativeFetch.call(window, input, init);
    };
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) { super(...args); window.__diagramSources.push(this); }
      set onopen(handler) {
        super.onopen = event => {
          window.__diagramTransportLease = window.__diagramSources.indexOf(this);
          handler?.call(this, event);
        };
      }
      get onopen() { return super.onopen; }
      set onmessage(handler) {
        super.onmessage = event => {
          const state = JSON.parse(event.data).type === 'state_sync';
          const deliver = () => {
            if (state) window.__diagramCurrentLeaseState = window.__diagramSources.indexOf(this);
            handler?.call(this, event);
          };
          if (window.__holdDiagramAuthority && state) window.__diagramHeldStates.push(deliver);
          else deliver();
        };
      }
      get onmessage() { return super.onmessage; }
    };
  }, { inviteCode: room.inviteCode, ownerToken: owner ? room.ownerToken : null, displayName: owner ? 'Интервьюер' : 'Кандидат', theme });
  const page = await context.newPage();
  page.on('response', async response => {
    if (response.status() < 400 || !new URL(response.url()).pathname.includes('/diagram')) return;
    const failure = await response.json().catch(() => ({}));
    console.info('DIAGRAM_TEST_FAILURE', { status: response.status(), code: failure.code, error: failure.error });
  });
  page.setDefaultTimeout(15000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return { page, context };
}

test('общий режим «Редактор диаграмм» доступен управляющему и отмена сохраняет Code', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await openParticipant(browser, room, true);
    await openModeOption(page, 'Редактор диаграмм');
    const dialog = page.getByRole('dialog', { name: 'Изменить режим комнаты?' });
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /кандидата и всех интервьюеров/);
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    assert.match(await page.getByTestId('room-editor-mode-switch').innerText(), /Code/);
    assert.equal(await page.locator('iframe[title="Редактор схемы"]').count(), 0);
  } finally {
    await browser.close();
  }
});

async function chooseMode(page, label) {
  await openModeOption(page, label);
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' })
    .getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.waitForFunction(label => document.querySelector('[data-testid="room-editor-mode-switch"]')?.textContent.includes(label), label);
}

async function openModeOption(page, label) {
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
  assert.ok(listbox);
  const dropdown = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) });
  await dropdown.getByText(label, { exact: true }).click();
}

async function editorFrame(page) {
  const panel = diagramPanel(page);
  await panel.getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
  const element = await panel.getByTitle('Редактор схемы', { exact: true }).elementHandle();
  assert.ok(element);
  const frame = await element.contentFrame();
  assert.ok(frame);
  await frame.waitForFunction(() => window.__interhubTestUi?.editor?.graph?.getDefaultParent());
  return frame;
}

test('клавиши внутри активного редактора диаграмм сохраняются по одному разу', async () => {
  const browser = await chromium.launch();
  try {
    const room = await createRoom();
    const owner = await openParticipant(browser, room, true);
    const candidate = await openParticipant(browser, room);
    await chooseMode(owner.page, 'Редактор диаграмм');
    const frame = await editorFrame(candidate.page);
    await frame.locator('.geDiagramContainer').click({ position: { x: 100, y: 85 } });
    const logged = candidate.page.waitForResponse(response => {
      if (response.request().method() !== 'POST' || !response.url().endsWith('/events')) return false;
      const payload = response.request().postDataJSON();
      return payload.type === 'key_press' && payload.key === 'F2';
    });
    await candidate.page.keyboard.press('F2');
    assert.equal((await logged).status(), 204);
    const raw = await fetch(`${api}/rooms/${room.inviteCode}/keystroke-events`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
    assert.equal(raw.status, 200);
    const keys = (await raw.json()).filter(row => row.keyValue === 'F2');
    assert.equal(keys.length, 1);
    assert.equal(keys[0].keyCode, 'F2');
  } finally { await browser.close(); }
});

async function assertDiagramToolbarAtTop(frame) {
  assert.equal(await frame.locator('.geMenubarContainer:visible').count(), 0, 'desktop menu row is hidden');
  const toolbar = frame.locator('.geToolbarContainer').filter({ has: frame.locator('.geToolbar') }).first();
  assert.equal(await toolbar.evaluate(el => el.getBoundingClientRect().top), 0, 'the menu leaves no empty row');
  assert.ok(await toolbar.locator('[title^="Отменить"]').isVisible(), 'Undo is available on the toolbar');
}

test('список масштаба прокручивается под панелью инструментов на низком холсте', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await openParticipant(browser, room, true);
    await chooseMode(page, 'Редактор диаграмм');
    const frame = await editorFrame(page);
    await diagramPanel(page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 340 });
    const zoom = frame.locator('.geToolbar .geZoomInput');
    await zoom.click();
    const popup = frame.locator('body > div.mxPopupMenu').filter({ hasText: '125%' });
    await popup.waitFor();
    const bounds = await popup.evaluate(async menu => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const toolbar = document.querySelector('.geToolbarContainer .geToolbar').parentElement;
      const { top, bottom } = menu.getBoundingClientRect();
      return { top, bottom, toolbarBottom: toolbar.getBoundingClientRect().bottom, height: innerHeight, scrollable: menu.scrollHeight > menu.clientHeight };
    });
    assert.ok(bounds.top >= bounds.toolbarBottom && bounds.bottom <= bounds.height, JSON.stringify(bounds));
    assert.ok(bounds.scrollable, 'all scale choices remain reachable');
    await popup.getByText('400%', { exact: true }).click();
    assert.equal(await zoom.inputValue(), '400%');
    const view = frame.locator('.geToolbar [title^="Вид"]').first();
    await view.press('Enter');
    const openedMenu = frame.locator('body > div.mxPopupMenu:visible');
    await openedMenu.waitFor();
    assert.ok(await openedMenu.evaluate(menu => menu.getBoundingClientRect().top) >= bounds.toolbarBottom);
    await page.keyboard.press('Escape');
    await openedMenu.waitFor({ state: 'hidden' });

    await frame.locator('.geDiagramContainer').click({ position: { x: 100, y: 85 }, button: 'right' });
    await openedMenu.waitFor();
    assert.ok(await openedMenu.evaluate(menu => menu.getBoundingClientRect().top) > bounds.toolbarBottom,
      'the canvas context menu opens at the pointer');
  } finally {
    await browser.close();
  }
});

async function insertBlock(frame, label, x = 60) {
  await frame.evaluate(({ label, x }) => {
    const graph = window.__interhubTestUi.editor.graph;
    graph.getModel().beginUpdate();
    try { graph.insertVertex(graph.getDefaultParent(), null, label, x, 80, 120, 60); }
    finally { graph.getModel().endUpdate(); }
  }, { label, x });
}

async function waitForBlocks(frame, labels) {
  try {
    await frame.waitForFunction(labels => {
      const children = window.__interhubTestUi.editor.graph.getDefaultParent().children ?? [];
      return JSON.stringify(children.map(cell => cell.value).sort()) === JSON.stringify(labels.slice().sort());
    }, labels, { timeout: 25000 });
  } catch (error) {
    const status = await frame.page().locator('[aria-label="Схема интервью"] [role="status"]').textContent().catch(() => 'unavailable');
    const actual = await frame.evaluate(() => window.__interhubTestUi.editor.graph.getDefaultParent().children?.map(cell => cell.value)).catch(() => 'detached');
    throw new Error(`DIAGRAM_TEST_SYNC: ${JSON.stringify({ expected: labels, actual, status })}`, { cause: error });
  }
}

async function confirmedDiagram(room) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/diagram`, {
    headers: { 'X-Room-Owner-Token': room.ownerToken },
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('при переключении задач схемы изолированы у интервьюера и кандидата', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const [first, second] = room.tasks;
    const owner = (await openParticipant(browser, room, true)).page;
    const candidate = (await openParticipant(browser, room)).page;
    await chooseMode(owner, 'Редактор диаграмм');
    await waitForCanvasTask(candidate, first.id);
    await insertBlock(await editorFrame(owner), 'Авторизация');
    const candidateFirst = await editorFrame(candidate);
    await waitForBlocks(candidateFirst, ['Авторизация']);
    const visibleLabel = (frame, label) => frame.locator('.geDiagramContainer').getByText(label, { exact: true });
    await visibleLabel(candidateFirst, 'Авторизация').first().waitFor();

    await selectCanvasTask(owner, second);
    const secondFrame = await editorFrame(owner);
    await waitForBlocks(secondFrame, []);
    assert.equal(await visibleLabel(secondFrame, 'Авторизация').count(), 0);
    await insertBlock(secondFrame, 'Уведомления');
    // Switch back immediately, before the new shape's save is acknowledged.
    await selectCanvasTask(owner, first);
    await waitForBlocks(await editorFrame(owner), ['Авторизация']);
    await waitForCanvasTask(candidate, first.id);
    await waitForBlocks(candidateFirst, ['Авторизация']);
    await selectCanvasTask(owner, second);
    const reopened = await editorFrame(owner);
    await waitForBlocks(reopened, ['Уведомления']);
    await visibleLabel(reopened, 'Уведомления').first().waitFor();
    assert.equal(await visibleLabel(reopened, 'Авторизация').count(), 0);

    await owner.getByTestId('room-publish-step').click();
    await waitForCanvasTask(candidate, second.id);
    await waitForBlocks(await editorFrame(candidate), ['Уведомления']);
    await candidate.reload();
    await waitForCanvasTask(candidate, second.id);
    await waitForBlocks(await editorFrame(candidate), ['Уведомления']);
    await selectCanvasTask(owner, first);
    await waitForBlocks(await editorFrame(owner), ['Авторизация']);
    await expectLegacyCanvasBlocked(owner, 'diagram', first, second);
  } finally { await browser.close(); }
});

test('два участника сохраняют общую схему, отменяют свои действия и возвращаются к ней после смены режима', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await openParticipant(browser, room, true);
    const candidate = await openParticipant(browser, room);
    await owner.page.getByTestId('room-code-editor-host').waitFor();
    await owner.page.evaluate(() => { window.__originalCodeView = document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView; });
    await chooseMode(owner.page, 'Редактор диаграмм');
    await candidate.page.getByText('Режим комнаты — Редактор диаграмм', { exact: true }).waitFor();
    const ownerFrame = await editorFrame(owner.page);
    const candidateFrame = await editorFrame(candidate.page);
    assert.equal(await ownerFrame.locator('.geTabContainer').isVisible(), false, 'unsupported native page actions stay hidden');
    await Promise.all([insertBlock(ownerFrame, 'API'), insertBlock(candidateFrame, 'Database', 250)]);
    await Promise.all([waitForBlocks(ownerFrame, ['API', 'Database']), waitForBlocks(candidateFrame, ['API', 'Database'])]);
    await owner.page.getByText('Сохранено', { exact: true }).waitFor();
    await candidate.page.getByText('Сохранено', { exact: true }).waitFor();
    assert.match((await confirmedDiagram(room)).xml, /Database/);
    await ownerFrame.evaluate(() => window.__interhubTestUi.actions.get('undo').funct());
    await Promise.all([waitForBlocks(ownerFrame, ['Database']), waitForBlocks(candidateFrame, ['Database'])]);
    await owner.page.getByText('Сохранено', { exact: true }).waitFor();
    await Promise.all([
      ownerFrame.evaluate(() => {
        const graph = window.__interhubTestUi.editor.graph;
        const cell = graph.getDefaultParent().children.find(cell => cell.value === 'Database');
        graph.getModel().setValue(cell, 'Storage');
      }),
      candidateFrame.evaluate(() => {
        const graph = window.__interhubTestUi.editor.graph;
        const cell = graph.getDefaultParent().children.find(cell => cell.value === 'Database');
        const geometry = cell.geometry.clone(); geometry.x = 500;
        graph.getModel().setGeometry(cell, geometry);
      }),
    ]);
    for (const frame of [ownerFrame, candidateFrame]) {
      await frame.waitForFunction(() => {
        const cell = window.__interhubTestUi.editor.graph.getDefaultParent().children.find(cell => cell.value === 'Storage');
        return cell?.geometry.x === 500;
      });
    }
    await owner.page.getByText('Сохранено', { exact: true }).waitFor();
    await ownerFrame.evaluate(() => window.__interhubTestUi.actions.get('undo').funct());
    await Promise.all([waitForBlocks(ownerFrame, ['Database']), waitForBlocks(candidateFrame, ['Database'])]);
    assert.equal(await ownerFrame.evaluate(() => window.__interhubTestUi.editor.graph.getDefaultParent().children[0].geometry.x), 500);

    await chooseMode(owner.page, 'Code');
    assert.equal(await owner.page.evaluate(() => document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView === window.__originalCodeView), true);
    await chooseMode(owner.page, 'Markdown');
    await chooseMode(owner.page, 'Редактор диаграмм');
    assert.equal(await editorFrame(owner.page), ownerFrame, 'mode switching keeps the canvas instance and its history');
    await waitForBlocks(ownerFrame, ['Database']);
    const late = await openParticipant(browser, room);
    await waitForBlocks(await editorFrame(late.page), ['Database']);

    const download = await downloadDiagram(owner.page, '.drawio');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.match(Buffer.concat(chunks).toString('utf8'), /Database/);
    assert.match(download.suggestedFilename(), /\.drawio$/);

    await candidate.context.setOffline(true);
    await insertBlock(candidateFrame, 'Cache', 420);
    await insertBlock(ownerFrame, 'Queue', 600);
    await owner.page.getByText('Сохранено', { exact: true }).waitFor();
    await candidate.page.evaluate(() => { window.__holdDiagramAuthority = true; });
    await candidate.context.setOffline(false);
    await candidate.page.waitForFunction(() => window.__diagramHeldStates.length > 0);
    assert.deepEqual(await candidate.page.evaluate(() => window.__diagramRequestsBeforeProof), [], 'opening transport does not start new diagram requests before current authority arrives');
    assert.equal(candidateFrame.isDetached(), false, 'unconfirmed renewed authority retains pending changes');
    await candidate.page.evaluate(() => {
      window.__holdDiagramAuthority = false;
      window.__diagramHeldStates.splice(0).forEach(deliver => deliver());
    });
    await Promise.all([waitForBlocks(ownerFrame, ['Database', 'Cache', 'Queue']), waitForBlocks(candidateFrame, ['Database', 'Cache', 'Queue'])]);
    await candidate.page.getByText('Сохранено', { exact: true }).waitFor();
    await owner.page.reload();
    await waitForBlocks(await editorFrame(owner.page), ['Database', 'Cache', 'Queue']);

    for (const format of ['SVG', 'PNG']) {
      const exported = await downloadDiagram(owner.page, format);
      const content = [];
      for await (const chunk of await exported.createReadStream()) content.push(chunk);
      const bytes = Buffer.concat(content);
      if (format === 'SVG') assert.match(bytes.toString('utf8'), /<svg\b/);
      else assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
    assert.equal(await owner.page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => /<mxfile|Database|<mxGraphModel/.test(value))), false, 'diagram content stays out of browser recovery storage');
    await owner.page.screenshot({ path: '/tmp/interhub-room-diagram.png' });
    await chooseMode(owner.page, 'Code');
    const finished = await fetch(`${api}/rooms/${room.inviteCode}/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Owner-Token': room.ownerToken },
      body: JSON.stringify({ verdict: 'HIRE' }),
    });
    assert.equal(finished.status, 200);
    await candidate.page.getByRole('button', { name: 'Посмотреть схему', exact: true }).click();
    await candidate.page.getByAltText('Сохранённая схема интервью', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await candidate.page.locator('iframe[title="Редактор схемы"]').isVisible(), false);
    await candidate.page.getByRole('button', { name: 'К материалам интервью', exact: true }).click();
    assert.equal(await candidate.page.getByTestId('room-code-editor-host').isVisible(), true);
  } finally {
    await browser.close();
  }
});

test('свободный рисунок и архитектурные связи сохраняются в одной общей схеме', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await openParticipant(browser, room, true, 'dark');
    const candidate = await openParticipant(browser, room);
    await chooseMode(owner.page, 'Редактор диаграмм');
    const frame = await editorFrame(owner.page);
    assert.equal(await owner.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    assert.equal(await frame.evaluate(() => Editor.isDarkMode()), true);
    const other = await editorFrame(candidate.page);
    const savedArchitecture = owner.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/diagram/changes') && response.status() === 200);
    await frame.evaluate(() => {
      const graph = window.__interhubTestUi.editor.graph;
      graph.model.beginUpdate();
      try {
        const service = graph.insertVertex(graph.getDefaultParent(), null, 'Service', 40, 50, 100, 60);
        const database = graph.insertVertex(graph.getDefaultParent(), null, 'Database', 210, 50, 100, 70, 'shape=cylinder3;');
        graph.insertEdge(graph.getDefaultParent(), null, 'query', service, database);
      } finally { graph.model.endUpdate(); }
    });
    await savedArchitecture;
    await owner.page.getByText('Сохранено', { exact: true }).waitFor();
    const location = await frame.evaluate(() => {
      const graph = window.__interhubTestUi.editor.graph;
      graph.freehand.setPerfectFreehandMode(false);
      graph.freehand.startDrawing();
      const bounds = graph.container.getBoundingClientRect();
      return { x: bounds.left + 90, y: bounds.top + 180 };
    });
    const host = owner.page.locator('iframe[title="Редактор схемы"]');
    await host.scrollIntoViewIfNeeded();
    const bounds = await host.boundingBox();
    const savedStroke = owner.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/diagram/changes') && response.status() === 200);
    await owner.page.mouse.move(bounds.x + location.x, bounds.y + location.y);
    await owner.page.mouse.down();
    await owner.page.mouse.move(bounds.x + location.x + 25, bounds.y + location.y + 20, { steps: 5 });
    await owner.page.mouse.move(bounds.x + location.x + 70, bounds.y + location.y - 15, { steps: 7 });
    await owner.page.mouse.up();
    await frame.evaluate(() => window.__interhubTestUi.editor.graph.freehand.stopDrawing());
    await savedStroke;
    await other.waitForFunction(() => window.__interhubTestUi.editor.graph.getDefaultParent().children.some(cell => cell.style?.includes('shape=stencil(')));
    const document = await confirmedDiagram(room);
    assert.match(document.xml, /shape=stencil\(/);
    assert.match(document.xml, /value="Service"/);
    if (process.env.E2E_SECOND_API_URL) {
      const response = await fetch(`${process.env.E2E_SECOND_API_URL}/rooms/${room.inviteCode}/diagram`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
      assert.equal(response.status, 200);
      const restartedReader = await response.json();
      assert.equal(restartedReader.xml, document.xml, 'a separate backend process reads the persisted canonical document');
      assert.equal(restartedReader.sequence, document.sequence);
    }
    await owner.page.reload();
    const restored = await editorFrame(owner.page);
    assert.equal(await restored.evaluate(() => {
      const cells = window.__interhubTestUi.editor.graph.getDefaultParent().children;
      return cells.filter(cell => cell.edge).length === 1 && cells.filter(cell => cell.vertex).length === 3 && cells.some(cell => cell.style?.includes('shape=stencil('));
    }), true);
    await owner.page.screenshot({ path: '/tmp/interhub-room-diagram-dark.png' });
  } finally {
    await browser.close();
  }
});

test('поздний отказ старого подключения не удаляет ожидающее изменение после переподключения', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await openParticipant(browser, room, true);
    const candidate = await openParticipant(browser, room);
    await chooseMode(owner.page, 'Редактор диаграмм');
    const first = await editorFrame(owner.page);
    const second = await editorFrame(candidate.page);
    let release;
    let captured;
    const capturedRequest = new Promise(resolve => { captured = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let held = false;
    let rejectedOldProof = false;
    candidate.page.on('response', response => {
      if (new URL(response.url()).pathname.endsWith('/diagram/changes') && response.status() === 403) rejectedOldProof = true;
    });
    await candidate.page.route('**/diagram/changes?*', async route => {
      if (!held) { held = true; captured(); await gate; }
      await route.continue();
    });
    await insertBlock(second, 'RetainedIntent');
    await capturedRequest;
    await candidate.page.evaluate(() => window.__diagramSources.at(-1).dispatchEvent(new Event('error')));
    await candidate.page.waitForFunction(() => window.__diagramSources.length >= 2 && window.__diagramCurrentLeaseState === window.__diagramSources.length - 1);
    release();
    await Promise.all([waitForBlocks(first, ['RetainedIntent']), waitForBlocks(second, ['RetainedIntent'])]);
    await candidate.page.getByText('Сохранено', { exact: true }).waitFor();
    assert.equal(rejectedOldProof, true, 'the held old-capability write is actually rejected by the server');
    assert.match((await confirmedDiagram(room)).xml, /RetainedIntent/);
  } finally {
    await browser.close();
  }
});

test('отклонённое изменение сохраняет черновик до явного возврата к сохранённой схеме', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const { page } = await openParticipant(browser, room, true);
    await chooseMode(page, 'Редактор диаграмм');
    const frame = await editorFrame(page);
    const persisted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/diagram/changes') && response.status() === 200);
    await insertBlock(frame, 'Confirmed');
    await persisted;
    await page.getByText('Сохранено', { exact: true }).waitFor();
    await diagramPanel(page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await page.route('**/diagram/changes?*', route => route.fulfill({
      status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'DIAGRAM_INVALID_DOCUMENT', error: 'Превышен лимит схемы' }),
    }));
    await insertBlock(frame, 'Unconfirmed', 260);
    const reset = page.getByRole('button', { name: 'Вернуться к сохранённой схеме', exact: true });
    await reset.waitFor();
    const errorStatus = diagramPanel(page).getByRole('status').filter({ hasText: /отклонено/i });
    const errorBox = await errorStatus.boundingBox();
    assert.ok(errorBox && errorBox.width > 1 && errorBox.height > 1, 'a rejected save displays its error');
    assert.doesNotMatch((await confirmedDiagram(room)).xml, /Unconfirmed/);
    await reset.click();
    let dialog = page.getByRole('dialog', { name: 'Удалить несохранённые изменения?' });
    assert.equal(await dialog.evaluate(element => element.closest('[inert]') === null), true, 'the recovery dialog stays interactive above the expanded canvas');
    await dialog.getByRole('button', { name: 'Оставить изменения', exact: true }).click();
    await waitForBlocks(frame, ['Confirmed', 'Unconfirmed']);
    await reset.click();
    dialog = page.getByRole('dialog', { name: 'Удалить несохранённые изменения?' });
    await page.unroute('**/diagram/changes?*');
    await dialog.getByRole('button', { name: 'Загрузить сохранённую', exact: true }).click();
    const recovered = await editorFrame(page);
    await waitForBlocks(recovered, ['Confirmed']);
    const nextSaved = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/diagram/changes') && response.status() === 200);
    await insertBlock(recovered, 'AfterRecovery', 420);
    await nextSaved;
    assert.match((await confirmedDiagram(room)).xml, /AfterRecovery/);
  } finally {
    await browser.close();
  }
});

test('схема разворачивается на всё окно локально, сохраняя редактор, историю и доступный возврат', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const room = await createRoom();
    const owner = await openParticipant(browser, room, true, 'dark');
    const candidate = await openParticipant(browser, room);
    await chooseMode(owner.page, 'Редактор диаграмм');
    const frame = await editorFrame(owner.page);
    const candidateFrame = await editorFrame(candidate.page);
    const panel = owner.page.getByRole('region', { name: 'Схема интервью', exact: true });
    const original = await panel.boundingBox();
    await assertCompactCanvasHeader(panel);
    await assertDiagramToolbarAtTop(frame);
    await frame.evaluate(() => { window.__originalDiagramEditor = window.__interhubTestUi; });
    await assertStableAutosave(panel, panel.getByTitle('Редактор схемы', { exact: true }), '**/diagram/changes?*',
      () => insertBlock(frame, 'Service'));
    await owner.page.getByRole('tab', { name: 'Чат', exact: true }).click();

    await diagramPanel(owner.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    const expanded = await panel.boundingBox();
    await assertCompactCanvasHeader(panel);
    assert.ok(expanded.width >= 1438 && expanded.height >= 998 && expanded.x <= 1 && expanded.y <= 1, `fills the viewport: ${JSON.stringify(expanded)}`);
    assert.ok(expanded.width * expanded.height > original.width * original.height * 2, 'expanded area is substantially larger');
    assert.equal(await candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).count(), 0, 'expansion is personal');
    assert.equal(await owner.page.getByTestId('room-editor-mode-switch').evaluate(element => element.closest('[inert]') !== null), true, 'background controls cannot receive keyboard focus');
    assert.notEqual(await owner.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).getAttribute('tabindex'), '-1', 'restore stays keyboard accessible after selecting an auxiliary tab');
    assert.equal(await owner.page.locator('iframe[title="Редактор схемы"]').getAttribute('tabindex'), '0');
    assert.equal(await editorFrame(owner.page), frame, 'the iframe is not remounted');
    await assertDiagramToolbarAtTop(frame);
    assert.equal(await frame.evaluate(() => window.__originalDiagramEditor === window.__interhubTestUi), true);
    await insertBlock(frame, 'Database', 300);
    await waitForBlocks(candidateFrame, ['Service', 'Database']);
    await owner.page.getByText('Сохранено', { exact: true }).waitFor();
    await frame.locator('.geToolbar [title^="Отменить"]').click();
    await Promise.all([waitForBlocks(frame, ['Service']), waitForBlocks(candidateFrame, ['Service'])]);
    await owner.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
    assert.deepEqual(await panel.boundingBox(), original, 'the prior room layout returns');
    assert.equal(await owner.page.getByRole('tab', { name: 'Чат', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await owner.page.getByTestId('room-editor-mode-switch').evaluate(element => element.closest('[inert]') === null), true);
    await diagramPanel(owner.page).getByRole('button', { name: 'На весь экран', exact: true }).focus();
    await owner.page.keyboard.press('Enter');
    await owner.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).waitFor();
    await owner.page.getByText('Режим комнаты изменён', { exact: true }).waitFor({ state: 'hidden' });
    await frame.evaluate(() => {
      const graph = window.__interhubTestUi.editor.graph;
      graph.scrollCellToVisible(graph.getDefaultParent().children[0], true);
    });
    await owner.page.screenshot({ path: '/tmp/interhub-room-diagram-expanded.png' });
    const chatSurface = owner.page.locator('#room-context-region-chat');
    for (const width of [900, 1440, 900]) {
      await owner.page.setViewportSize({ width, height: 1000 });
      await owner.page.waitForFunction(mode => document.querySelector('[data-room-context-mode]')?.dataset.roomContextMode === mode, width < 1000 ? 'focus' : 'work');
      assert.equal(await chatSurface.evaluate(element => element.closest('[inert]') !== null), true, 'breakpoint resizing cannot expose background controls while expanded');
    }
    await owner.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
    assert.notEqual(await chatSurface.getAttribute('inert'), null, 'exiting at a narrow width retains the hidden surface lock');
    await owner.page.setViewportSize({ width: 1440, height: 1000 });
    await owner.page.waitForFunction(() => document.querySelector('[data-room-context-mode]')?.dataset.roomContextMode === 'work');
    assert.equal(await chatSurface.getAttribute('inert'), null, 'visible sidebar becomes interactive after leaving the expanded canvas');

    await diagramPanel(candidate.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    await candidate.page.setViewportSize({ width: 340, height: 420 });
    await assertCompactCanvasHeader(diagramPanel(candidate.page), { narrow: true });
    const restore = candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true });
    const restoreBox = await restore.boundingBox();
    assert.ok(restoreBox.x >= 0 && restoreBox.y >= 0 && restoreBox.x + restoreBox.width <= 340 && restoreBox.y + restoreBox.height <= 420, 'restore remains on a short screen');
    await restore.click();
    await candidate.page.setViewportSize({ width: 1440, height: 1000 });
    await chooseMode(owner.page, 'Code');
    await chooseMode(owner.page, 'Редактор диаграмм');
    assert.equal(await candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).count(), 0);
    await diagramPanel(candidate.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    // A shared mode change must dismiss only the local presentation, not leave
    // an invisible overlay or disable the room's controls.
    await chooseMode(owner.page, 'Code');
    await candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await candidate.page.locator('[inert] iframe[title="Редактор схемы"]').count(), 0);
    await chooseMode(owner.page, 'Редактор диаграмм');
    assert.equal(await candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).count(), 0);
    const finished = await fetch(`${api}/rooms/${room.inviteCode}/verdict`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Owner-Token': room.ownerToken }, body: JSON.stringify({ verdict: 'HIRE' }),
    });
    assert.equal(finished.status, 200);
    await candidate.page.getByAltText('Сохранённая схема интервью', { exact: true }).waitFor();
    await diagramPanel(candidate.page).getByRole('button', { name: 'На весь экран', exact: true }).click();
    const readonlyBounds = await candidate.page.getByRole('region', { name: 'Схема интервью', exact: true }).boundingBox();
    assert.ok(readonlyBounds.width >= 1438 && readonlyBounds.height >= 998, 'candidate readonly also uses the whole viewport');
    const readerPanel = diagramPanel(candidate.page);
    assert.ok(await readerPanel.getByRole('button', { name: /Закреплённый цвет/ }).isDisabled());
    await assertCompactCanvasHeader(readerPanel);
    await readerPanel.getByRole('button', { name: 'Скачать', exact: true }).press('Enter');
    const formats = readerPanel.getByRole('menu', { name: 'Формат скачивания' });
    await formats.waitFor();
    assert.deepEqual((await formats.getByRole('menuitem').allTextContents()).sort(), ['.drawio', 'PNG', 'SVG']);
    assert.equal(await formats.evaluate(menu => !menu.closest('[inert]')), true);
    const download = candidate.page.waitForEvent('download');
    await formats.getByRole('menuitem', { name: '.drawio', exact: true }).click();
    assert.match((await download).suggestedFilename(), /\.drawio$/);
    await candidate.page.getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
  } finally {
    await browser.close();
  }
});
