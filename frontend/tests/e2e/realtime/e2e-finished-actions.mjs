import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

async function request(path, body, room) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(room ? { 'X-Room-Owner-Token': room.ownerToken } : {}) }, body: JSON.stringify(body),
  });
  assert.ok(response.ok, `fixture ${path}: ${response.status}`);
  return response.json();
}

async function setup(browser) {
  const room = await request('/public/rooms', { title: 'UX finished controls', ownerDisplayName: 'UX review owner', language: 'nodejs' });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
  await context.addInitScript(room => {
    localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, 'UX review owner');
  }, room);
  const page = await context.newPage();
  const browserErrors = [], pendingAssets = new Set();
  page.on('request', request => { const path = new URL(request.url()).pathname; if (/\.(?:js|css)$/.test(path)) pendingAssets.add(path); });
  page.on('requestfinished', request => pendingAssets.delete(new URL(request.url()).pathname));
  page.on('requestfailed', request => pendingAssets.delete(new URL(request.url()).pathname));
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(`${web}/room/${room.inviteCode}`);
  try {
    await page.getByTestId('room-code-editor-host').locator('.cm-content').waitFor();
  } catch (error) {
    throw new Error(`Room did not hydrate: ${await page.locator('body').innerText()}\nBrowser errors: ${browserErrors.join('; ')}\nPending assets: ${Array.from(pendingAssets).join(', ')}\n${error.message}`);
  }
  return { page, room };
}

async function finish(page, room) {
  const result = await request(`/rooms/${room.inviteCode}/verdict`, { verdict: 'HIRE', verdictComment: 'UX regression result' }, room);
  await page.getByText(/Интервью завершено/).first().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return result;
}

async function waitForPersistedRoom(room, predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const persisted = await request(`/rooms/${room.inviteCode}`, undefined, room);
    if (predicate(persisted)) return persisted;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Expected finished manager changes were not persisted');
}

test('live finish keeps the owner task rename dialog and saves its draft', async () => {
  const browser = await chromium.launch();
  try {
    const { page, room } = await setup(browser);
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.getByTestId('room-task-rename-0').click();
    const dialog = page.getByRole('dialog', { name: 'Переименовать задачу', exact: true });
    await dialog.getByTestId('room-task-rename-input').fill('Черновик названия до завершения');
    await finish(page, room);
    assert.equal(await dialog.isVisible(), true, 'finishing must keep an owner rename dialog and its draft');
    assert.equal(await dialog.getByTestId('room-task-rename-input').inputValue(), 'Черновик названия до завершения');
    assert.equal(await dialog.getByTestId('room-task-rename-submit').isDisabled(), false);
    const saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes(`/rooms/${room.inviteCode}/tasks/`));
    await dialog.getByTestId('room-task-rename-submit').click();
    assert.ok((await saved).ok(), 'finished owner task rename must be accepted by the server');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByTestId('room-step-row-0').getByText('Черновик названия до завершения', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('room-task-rename-0').count(), 1);
    assert.equal(await page.getByTestId('room-task-delete-0').count(), 1);
    assert.equal(await page.getByRole('combobox', { name: 'Язык комнаты', exact: true }).isDisabled(), false);
    await page.reload();
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.getByTestId('room-step-row-0').getByText('Черновик названия до завершения', { exact: true }).waitFor();
  } finally { await browser.close(); }
});

test('finished owner can edit code and Markdown without restarting the interview', async () => {
  const browser = await chromium.launch();
  try {
    const { page, room } = await setup(browser);
    await page.evaluate(() => { window.__finishedOwnerEditor = document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView; });
    const finished = await finish(page, room);
    const codeInput = page.getByTestId('room-code-editor-host').locator('.cm-content');
    assert.equal(await codeInput.getAttribute('contenteditable'), 'true', 'finished owner must retain editing permissions');
    assert.equal(await page.evaluate(() => window.__finishedOwnerEditor === document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView), true, 'finish keeps the live document');
    const code = 'const finishedOwnerCanEdit = 42;';
    await codeInput.fill(code);
    await waitForPersistedRoom(room, persisted => persisted.code === code);
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    const markdown = '# Условие после завершения\n\nУправляющий продолжает работу.';
    const markdownInput = page.getByRole("region", {name:"Условие", exact:true}).getByTestId('room-markdown-editor').locator('.cm-content');
    assert.equal(await markdownInput.getAttribute('contenteditable'), 'true');
    const briefingSaved = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'briefing_markdown_update');
    await markdownInput.fill(markdown);
    assert.ok((await briefingSaved).ok(), 'finished manager Markdown must be accepted');
    const persisted = await waitForPersistedRoom(room, saved => saved.briefingMarkdown === markdown);
    assert.equal(persisted.status, 'finished', 'editing must not reopen a completed interview');
    assert.equal(persisted.finishedAt, finished.finishedAt, 'editing retains the first finish timestamp');
    await page.reload();
    await page.getByTestId('room-code-editor-host').locator('.cm-content').waitFor();
    assert.equal(await page.getByTestId('room-code-editor-host').evaluate(host => host.__roomEditorView.state.doc.toString()), code);
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await page.getByRole("region", {name:"Условие", exact:true}).getByTestId('room-markdown-preview').getByRole('heading', { name: 'Условие после завершения', exact: true }).waitFor();
    assert.equal(await page.getByRole("region", {name:"Условие", exact:true}).getByTestId('room-markdown-editor').locator('.cm-content').getAttribute('contenteditable'), 'true');
  } finally { await browser.close(); }
});

test('finished owner continues private notes and chat with confirmed history export', async () => {
  const browser = await chromium.launch();
  try {
    const { page, room } = await setup(browser);
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    await page.getByTestId('room-notes-input').fill('Сохранённое сообщение чата');
    const chatPersisted = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'note_message' && response.status() === 200);
    await page.getByTestId('room-notes-send').click();
    await chatPersisted;
    await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
    const privateInput = page.getByTestId('room-private-notes-input');
    await privateInput.fill('Сохранённая личная запись');
    const privatePersisted = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'private_note_entry');
    await page.getByTestId('room-private-notes-send').click();
    assert.equal((await privatePersisted).ok(), true, 'private note fixture must be persisted before finishing');
    await page.getByText('Сохранённая личная запись', { exact: true }).waitFor();
    await privateInput.fill('Несохранённый черновик заметки');
    await finish(page, room);
    assert.equal(await privateInput.getAttribute('readonly'), null, 'finished owner private composer remains writable');
    assert.equal(await page.getByTestId('room-private-notes-send').isDisabled(), false);
    const afterFinishSaved = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'private_note_entry');
    await privateInput.press('Enter');
    assert.ok((await afterFinishSaved).ok(), 'finished owner private note is stored');
    assert.equal(await privateInput.inputValue(), '');
    const noteHistory = page.locator('[data-room-context-surface="notes"] article');
    assert.equal(await noteHistory.filter({ hasText: 'Сохранённая личная запись' }).count(), 1, 'persisted history remains in the notes surface');
    assert.equal(await noteHistory.filter({ hasText: 'Несохранённый черновик заметки' }).count(), 1, 'note submitted after finish becomes confirmed history');
    assert.equal(await page.getByText('Сохранённая личная запись', { exact: true }).isVisible(), true);
    assert.equal(await page.getByTestId('room-private-notes-export').isDisabled(), false);
    await page.getByTestId('room-private-notes-export').click();
    const downloadPending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать .md', exact: true }).click();
    const download = await downloadPending;
    const markdown = await readFile(await download.path(), 'utf8');
    assert.ok(markdown.includes('Сохранённая личная запись'), 'export still includes persisted notes');
    assert.ok(markdown.includes('Несохранённый черновик заметки'), 'export includes the confirmed note sent after finish');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    assert.equal(await page.getByText('Сохранённое сообщение чата', { exact: true }).isVisible(), true);
    assert.equal(await page.getByTestId('room-notes-input').getAttribute('readonly'), null);
    await page.getByTestId('room-notes-input').fill('Сообщение после завершения');
    assert.equal(await page.getByTestId('room-notes-send').isDisabled(), false);
    const afterFinishChat = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'note_message');
    await page.getByTestId('room-notes-send').click();
    assert.ok((await afterFinishChat).ok(), 'finished owner chat is stored');
    await page.reload();
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    await page.getByText('Сообщение после завершения', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
    await page.getByText('Несохранённый черновик заметки', { exact: true }).waitFor();
  } finally { await browser.close(); }
});

test('finished owner can retry a chat message that failed while active', async () => {
  const browser = await chromium.launch();
  try {
    const { page, room } = await setup(browser);
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    let failChat = true;
    await page.route(`**/api/realtime/rooms/${room.inviteCode}/events`, async route => {
      if (route.request().postDataJSON()?.type === 'note_message' && failChat) {
        await route.fulfill({ status: 503, json: { error: 'UX temporary fixture failure' } });
      } else await route.continue();
    });
    await page.getByTestId('room-notes-input').fill('Сообщение для проверки повторной отправки');
    await page.getByTestId('room-notes-send').click();
    const retry = page.getByRole('button', { name: 'Повторить отправку', exact: true });
    await retry.waitFor();
    assert.equal(await retry.isDisabled(), false, 'retry is available while the room is active');
    await finish(page, room);
    assert.equal(await retry.isDisabled(), false, 'finished owner retains failed-message retry');
    failChat = false;
    const retried = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'note_message');
    await retry.click();
    assert.ok((await retried).ok(), 'finished chat retry must reach the server successfully');
    await retry.waitFor({ state: 'hidden' });
    await page.reload();
    await page.getByRole('tab', { name: 'Чат', exact: true }).click();
    assert.equal(await page.locator('article').filter({ hasText: 'Сообщение для проверки повторной отправки' }).count(), 1);
  } finally { await browser.close(); }
});
