import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
async function participant(browser, room, owner) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ room, owner }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('display_name', owner ? 'Интервьюер' : 'Кандидат');
    localStorage.setItem('room_sync_log', '0');
  }, { room, owner });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return page;
}
async function mode(page, label) {
  await page.bringToFront();
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const id = await control.getByRole('combobox').getAttribute('aria-controls');
  const dropdown = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(id)}]`) });
  const labels = await dropdown.locator('.ant-select-item-option-content').allTextContents();
  assert.deepEqual(labels, ['Code', 'Markdown', 'Редактор диаграмм', 'Доска'], 'the shared mode picker uses exact product names');
  await dropdown.getByText(label, { exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
  const labelFits = await control.getByText(label, { exact: true }).evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const control = element.closest('[data-testid="room-editor-mode-switch"]').getBoundingClientRect();
    return text.left >= control.left - 1 && text.right <= control.right - 28;
  });
  assert.equal(labelFits, true, 'the selected mode name is fully readable');
}

test('Редактор диаграмм и доска используют названия режима и одну кнопку «На весь экран»', { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Названия холстов', ownerDisplayName: 'Интервьюер', language: 'nodejs' }) });
    assert.equal(response.status, 200);
    const room = await response.json();
    const owner = await participant(browser, room, true);
    const candidate = await participant(browser, room, false);
    for (const [label, region] of [['Редактор диаграмм', 'Схема интервью'], ['Доска', 'Доска интервью']]) {
      await mode(owner, label);
      await candidate.getByText(`Режим комнаты — ${label}`, { exact: true }).waitFor();
      for (const page of [owner, candidate]) {
        const panel = page.getByRole('region', { name: region, exact: true });
        await panel.getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor();
        const expand = panel.getByRole('button', { name: 'На весь экран', exact: true });
        await expand.click();
        await panel.getByRole('button', { name: 'Вернуться в комнату', exact: true }).waitFor();
        const bounds = await panel.boundingBox();
        assert.ok(bounds && bounds.width >= 1438 && bounds.height >= 998, 'the renamed action still expands the canvas');
        await panel.getByRole('button', { name: 'Вернуться в комнату', exact: true }).click();
        await expand.waitFor();
      }
    }
  } finally { await browser.close(); }
});
