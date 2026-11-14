import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const panel = page => page.getByRole('region', { name: 'Доска интервью', exact: true });
const visible = scene => scene.elements.filter(element => !element.isDeleted);
async function saved(page) { await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor(); }
async function snapshot(room) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/whiteboard`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
  assert.equal(response.status, 200); return response.json();
}
async function waitScene(room, predicate) {
  const deadline = Date.now() + 15000;
  do {
    const scene = await snapshot(room);
    if (predicate(scene)) return scene;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < deadline);
  assert.fail('Board did not save the expected colored stroke');
}
async function mode(page) {
  const control = page.getByTestId('room-editor-mode-switch'); await control.click();
  const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
  await page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) }).getByText('Доска', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
}
async function canvasPoint(page, offset = 0) {
  const bounds = await panel(page).getByTestId('room-whiteboard-canvas').locator('canvas.interactive').boundingBox();
  const viewport = page.viewportSize();
  const left = Math.max(bounds.x, 0), right = Math.min(bounds.x + bounds.width, viewport.width);
  const top = Math.max(bounds.y, 0), bottom = Math.min(bounds.y + bounds.height, viewport.height);
  return { x: Math.round(left + (right - left) * .40), y: Math.round(top + (bottom - top) * .55 + offset) };
}
async function drawLine(page, offset) {
  const point = await canvasPoint(page, offset);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y, { steps: 8 }); await page.mouse.up();
  return { x: point.x + 40, y: point.y };
}
async function paintedImagePoint(page, color) {
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  const result = await page.waitForFunction(rgb => {
    const canvas = document.querySelector('[data-testid="room-whiteboard-canvas"] canvas.static');
    if (!canvas?.width || !canvas.height) return;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset + 3] === 255 && rgb.every((channel, index) => pixels[offset + index] === channel)) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right <= left || bottom <= top) return;
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.round(bounds.x + (left + right) / 2 * bounds.width / canvas.width), y: Math.round(bounds.y + (top + bottom) / 2 * bounds.height / canvas.height) };
  }, rgb);
  return result.jsonValue();
}
async function assertCompositedPixel(page, point, color, message) {
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  // Wait for real native paint, then inspect the composited browser screenshot.
  // Reading canvas pixels alone cannot detect a CSS filter on the canvas.
  await page.waitForFunction(({ point, rgb }) => [...document.querySelectorAll('[data-testid="room-whiteboard-canvas"] canvas')].some(canvas => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !canvas.width || !canvas.height) return false;
    const x = Math.round((point.x - rect.x) * canvas.width / rect.width), y = Math.round((point.y - rect.y) * canvas.height / rect.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
    const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return pixel[3] === 255 && rgb.every((channel, index) => pixel[index] === channel);
  }), { point, rgb });
  const screenshot = await page.screenshot({ clip: { ...point, width: 1, height: 1 } });
  const actual = await page.evaluate(async encoded => {
    const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, screenshot.toString('base64'));
  assert.deepEqual(actual.slice(0, 3), rgb, message);
}

test('выбранный HEX-цвет отображается без подмены в тёмной и светлой теме', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Точные цвета доски', ownerDisplayName: 'Автор', language: 'nodejs' }) });
    assert.equal(response.status, 200); const room = await response.json();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await context.addInitScript(room => {
      localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
      localStorage.setItem(`guest_display_name_${room.inviteCode}`, 'Автор');
      localStorage.setItem('display_name', 'Автор');
      localStorage.setItem('interview-online:ui-theme', 'dark');
    }, room);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
    await mode(page); await saved(page);
    const tools = panel(page).getByRole('group', { name: 'Инструменты доски' });
    const imageColor = '#34c759';
    await panel(page).getByTestId('room-whiteboard-canvas').locator('canvas.interactive').evaluate(canvas => {
      const raster = document.createElement('canvas'); raster.width = 72; raster.height = 48;
      const context = raster.getContext('2d'); context.fillStyle = '#34c759'; context.fillRect(0, 0, raster.width, raster.height);
      const bytes = Uint8Array.from(atob(raster.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'original-colors.png', { type: 'image/png' }));
      const bounds = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer,
        clientX: bounds.x + bounds.width * .75, clientY: bounds.y + bounds.height * .25 }));
    });
    await waitScene(room, scene => visible(scene).some(element => element.type === 'image')); await saved(page);
    await tools.getByRole('radio', { name: 'Линия', exact: true }).locator('..').click();
    const imagePoint = await paintedImagePoint(page, imageColor);
    await assertCompositedPixel(page, imagePoint, imageColor, 'raster colors are rendered literally in the dark theme');
    await tools.getByRole('button', { name: /^Толщина линии:/ }).click();
    const width = page.getByRole('dialog', { name: 'Толщина линии', exact: true });
    await width.getByRole('spinbutton', { name: 'Толщина в пикселях' }).fill('16');
    await width.getByRole('spinbutton', { name: 'Толщина в пикселях' }).press('Enter');
    await width.waitFor({ state: 'hidden' });
    await tools.getByLabel('Цвет рисования', { exact: true }).fill('#ff0000');
    const redPoint = await drawLine(page, 0);
    const red = await waitScene(room, scene => visible(scene).length === 2 && visible(scene).some(element => element.type === 'line' && element.width === 80));
    assert.equal(visible(red).find(element => element.type === 'line').strokeColor.toLowerCase(), '#ff0000'); await saved(page);
    await assertCompositedPixel(page, redPoint, '#ff0000', 'chosen red must remain red in the dark theme');

    const assigned = panel(page).getByRole('button', { name: /^Закреплённый цвет/ });
    const assignedColor = (await assigned.getAttribute('data-color')).toLowerCase();
    assert.ok((await assigned.getAttribute('title')).includes('при входе в комнату'));
    assert.ok((await assigned.getAttribute('title')).includes('новым объектам'));
    await assigned.click();
    assert.equal(await tools.getByLabel('Цвет рисования', { exact: true }).inputValue(), assignedColor);
    assert.equal((await assigned.getAttribute('data-color')).toLowerCase(), assignedColor);
    const assignedPoint = await drawLine(page, 42);
    await waitScene(room, scene => visible(scene).length === 3 && visible(scene).filter(element => element.type === 'line').every(element => element.width === 80));
    await saved(page);
    const both = await snapshot(room);
    assert.equal(visible(both).find(element => element.type === 'line').strokeColor.toLowerCase(), '#ff0000', 'reapplying an assigned color does not recolor prior strokes');
    await assertCompositedPixel(page, assignedPoint, assignedColor, 'assigned color is rendered literally in the dark theme');
    const charcoal = '#202020';
    await tools.getByLabel('Цвет рисования', { exact: true }).fill(charcoal);
    const charcoalPoint = await drawLine(page, 84);
    await waitScene(room, scene => visible(scene).length === 4 && visible(scene).filter(element => element.type === 'line').every(element => element.width === 80));
    await saved(page);
    const beforeTheme = await snapshot(room);
    assert.equal(visible(beforeTheme).filter(element => element.type === 'line').at(-1).strokeColor.toLowerCase(), charcoal);
    await assertCompositedPixel(page, charcoalPoint, charcoal, 'chosen dark charcoal must not be brightened by the dark theme');
    const theme = page.getByRole('button', { name: 'Тёмная тема', exact: true });
    for (const next of ['light', 'dark']) {
      await theme.click();
      await page.waitForFunction(next => document.documentElement.dataset.theme === next, next);
      await assertCompositedPixel(page, redPoint, '#ff0000', `red is unchanged after switching to ${next}`);
      await assertCompositedPixel(page, assignedPoint, assignedColor, `assigned color is unchanged after switching to ${next}`);
      await assertCompositedPixel(page, imagePoint, imageColor, `raster color is unchanged after switching to ${next}`);
      await assertCompositedPixel(page, charcoalPoint, charcoal, `dark charcoal remains literal after switching to ${next}`);
      assert.equal(await tools.getByLabel('Цвет рисования', { exact: true }).inputValue(), charcoal);
      assert.equal((await assigned.getAttribute('data-color')).toLowerCase(), assignedColor, 'assigned color stays fixed while the current palette changes');
      assert.deepEqual((await snapshot(room)).elements, beforeTheme.elements, 'theme changes do not rewrite the document');
    }
    for (const [index, next] of ['dark', 'light'].entries()) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== next) await theme.click();
      await tools.getByRole('radio', { name: 'Текст', exact: true }).locator('..').click();
      await tools.getByLabel('Цвет рисования', { exact: true }).fill('#ff0000');
      const point = await canvasPoint(page, -110 + index * 60);
      await page.mouse.click(point.x, point.y);
      const editor = page.locator('textarea.excalidraw-wysiwyg'); await editor.waitFor();
      const label = `Точный красный — ${next}`;
      await editor.fill(label);
      const style = await editor.evaluate(element => ({ color: getComputedStyle(element).color, filter: getComputedStyle(element).filter }));
      assert.equal(style.color, 'rgb(255, 0, 0)', `editing text uses the selected color in ${next}`);
      assert.equal(style.filter, 'none', `editing text has no color filter in ${next}`);
      await editor.press('Escape');
      await waitScene(room, scene => visible(scene).some(element => element.type === 'text' && element.text === label));
      await saved(page);
    }
    await page.screenshot({ path: '/tmp/interhub-whiteboard-exact-colors.png' });
  } finally { await browser.close(); }
});
