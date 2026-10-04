import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
async function post(path, body, token) {
  const response = await fetch(`${api}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
}
async function openRoom(browser, empty = false) {
  const auth = empty ? await post('/auth/register', { nickname: `notes_${Date.now().toString(36)}`, displayName: 'Notes reviewer', password: 'test-password-123' }) : null;
  const room = empty ? await post('/rooms', { title: 'Empty room notes regression', language: 'nodejs', taskIds: [] }, auth.token) : await post('/public/rooms', { title: 'Room interaction regression', ownerDisplayName: 'Reviewer', language: 'nodejs' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ room, auth }) => {
    if (auth) { localStorage.setItem('auth_token', auth.token); localStorage.setItem('auth_user', JSON.stringify(auth.user)); }
    if (room.ownerToken) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, 'Reviewer');
  }, { room, auth });
  const page = await context.newPage();
  await page.goto(`${web}/room/${room.inviteCode}`);
  await page.getByTestId('room-code-editor-host').locator('.cm-editor').waitFor();
  return { page, context };
}

test('custom note block survives in a room with no tasks and notes persist in that block', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await openRoom(browser, true);
    await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
    const input = page.getByTestId('room-private-notes-input');
    await input.fill('/block asdda');
    await input.press('Enter');
    await page.getByText('Блок: asdda', { exact: false }).waitFor({ timeout: 3000 });
    const note = `Custom block text ${Date.now()}`;
    await input.fill(note);
    await input.press('Enter');
    await page.getByText(note, { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
    await page.getByText(note, { exact: true }).waitFor();
    const entry = page.getByText(note, { exact: true }).locator('..');
    assert.ok((await entry.innerText()).includes('asdda'), 'saved note retains its custom block');
  } finally { await browser.close(); }
});

test('step hover area selects the step while action buttons remain separate', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await openRoom(browser);
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    const button = page.getByTestId('room-step-row-1');
    const row = button.locator('..').locator('..');
    const box = await row.boundingBox();
    // The row background includes blank space outside the label/button and sibling metadata.
    await page.mouse.click(box.x + box.width - 4, box.y + 3);
    await page.waitForFunction(() => document.querySelector('[data-testid="room-step-row-1"]')?.getAttribute('aria-current') === 'step', null, { timeout: 3000 });
    await page.getByTestId('room-task-rename-1').click();
    await page.getByRole('dialog', { name: /Переименовать/ }).waitFor();
    assert.equal(await page.getByTestId('room-step-row-1').getAttribute('aria-current'), 'step');
  } finally { await browser.close(); }
});

test('notes command rows do not overlap and chat focus uses one border in both themes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await openRoom(browser);
    for (const mode of ['dark', 'light']) {
      await page.evaluate(mode => window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode })), mode);
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
      await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
      await page.getByTestId('room-private-notes-input').fill('/');
      const command = page.getByTestId('room-private-notes-command-menu').getByRole('button', { name: /Открыть блок заметок/ });
      const geometry = await command.evaluate(button => {
        const label = button.querySelector('span');
        const hint = label.nextElementSibling;
        const a = label.getBoundingClientRect(), b = hint.getBoundingClientRect(), c = button.getBoundingClientRect();
        return { bottom: b.bottom, parentBottom: c.bottom, labelBottom: a.bottom, hintTop: b.top };
      });
      assert.ok(geometry.bottom <= geometry.parentBottom + 1 && geometry.hintTop >= geometry.labelBottom - 1, `${mode}: command text stays inside its row`);
      if (process.env.EVIDENCE_DIR) {
        await mkdir(process.env.EVIDENCE_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.EVIDENCE_DIR, `notes-${mode}.png`) });
      }
      await page.getByRole('tab', { name: 'Чат', exact: true }).click();
      const input = page.getByTestId('room-notes-input');
      await input.focus();
      const focus = await input.evaluate(input => { const s = getComputedStyle(input); return { outline: s.outlineStyle, shadow: s.boxShadow, border: parseFloat(s.borderTopWidth) }; });
      assert.equal(focus.outline, 'none', `${mode}: no second outer focus outline`);
      assert.equal(focus.shadow, 'none', `${mode}: no second focus shadow`);
      assert.ok(focus.border > 0, `${mode}: visible focused border remains`);
    }
  } finally { await browser.close(); }
});

test('compact chat and notes keep multiline drafts scrollable and controls visible', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await openRoom(browser);
    await page.setViewportSize({ width: 384, height: 512 });
    const draft = Array.from({ length: 12 }, (_, index) => `Строка ${index + 1}: полный черновик`).join('\n');
    for (const [tab, testId] of [['Чат', 'room-notes-input'], ['Мои заметки', 'room-private-notes-input']]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const input = page.getByTestId(testId);
      await input.fill(draft);
      await input.press('End');
      await page.waitForFunction(testId => {
        const field = document.querySelector(`[data-testid="${testId}"]`);
        const box = field?.getBoundingClientRect();
        return box && box.top >= 0 && box.bottom <= innerHeight + 1;
      }, testId);
      const geometry = await input.evaluate(field => {
        const style = getComputedStyle(field);
        return { height: field.getBoundingClientRect().height, scrollHeight: field.scrollHeight, clientHeight: field.clientHeight, overflow: style.overflowY };
      });
      assert.equal(await input.inputValue(), draft, `${tab}: full draft remains`);
      assert.ok(geometry.height >= 32, `${tab}: accessible control height`);
      assert.ok(geometry.scrollHeight > geometry.clientHeight, `${tab}: multiline content scrolls`);
      assert.equal(geometry.overflow, 'auto', `${tab}: draft is not clipped`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [tab, testId] of [['Чат', 'room-notes-input'], ['Мои заметки', 'room-private-notes-input']]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      assert.equal(await page.getByTestId(testId).inputValue(), draft, `${tab}: resize preserves all lines`);
    }
  } finally { await browser.close(); }
});
