import '../support/require-isolated-api.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL;
const api = process.env.E2E_API_URL;
const panel = page => page.getByRole('region', { name: 'Доска интервью', exact: true });
const images = scene => scene.elements.filter(element => element.type === 'image' && !element.isDeleted);
async function participant(browser, room, owner) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(({ room, owner }) => {
    if (owner) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Учитель' : 'Ученик');
    localStorage.setItem('display_name', owner ? 'Учитель' : 'Ученик');
  }, { room, owner });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-connection-status"][data-state="online"]').waitFor();
  return page;
}
async function mode(page, label) {
  const control = page.getByTestId('room-editor-mode-switch');
  await control.click();
  const listbox = await control.getByRole('combobox').getAttribute('aria-controls');
  await page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(listbox)}]`) }).getByText(label, { exact: true }).click();
  await page.getByRole('dialog', { name: 'Изменить режим комнаты?' }).getByRole('button', { name: 'Изменить режим', exact: true }).click();
  await page.locator('.ant-modal-wrap').filter({ has: page.getByText('Изменить режим комнаты?', { exact: true }) }).waitFor({ state: 'hidden' });
}
async function displayedImage(page) {
  const bounds = await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="room-whiteboard-canvas"] canvas.static');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      if (data[index] === 235 && data[index + 1] === 51 && data[index + 2] === 73 && data[index + 3] === 255) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (left >= right || top >= bottom) return;
    const rect = canvas.getBoundingClientRect(), ratio = rect.width / canvas.width;
    return { x: rect.x + left * ratio, y: rect.y + top * ratio, width: (right - left + 1) * ratio, height: (bottom - top + 1) * ratio };
  });
  return bounds.jsonValue();
}
async function saved(page) { await panel(page).getByRole('status').filter({ hasText: /^Сохранено$/ }).waitFor(); }
async function snapshot(room) {
  const response = await fetch(`${api}/rooms/${room.inviteCode}/whiteboard`, { headers: { 'X-Room-Owner-Token': room.ownerToken } });
  assert.equal(response.status, 200);
  return response.json();
}
async function waitScene(room, predicate) {
  const deadline = Date.now() + 15000;
  do {
    const scene = await snapshot(room);
    if (predicate(scene)) return scene;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < deadline);
  assert.fail('Доска не сохранила ожидаемые изображения');
}
async function exported(page, format) {
  await panel(page).getByRole('button', { name: 'Скачать', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await panel(page).getByRole('menuitem', { name: format, exact: true }).click();
  const chunks = [];
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function transferImage(page, source, dataURL, mimeType = 'image/png') {
  await panel(page).getByTestId('room-whiteboard-canvas').locator('canvas.interactive').evaluate((canvas, { source, dataURL, mimeType }) => {
    const bytes = Uint8Array.from(atob(dataURL.split(',')[1]), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'lesson.png', { type: mimeType }));
    const bounds = canvas.getBoundingClientRect();
    canvas.dispatchEvent(source === 'paste'
      ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
      : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 }));
  }, { source, dataURL, mimeType });
}

test('изображения добавляются файлом, из буфера и перетаскиванием, сохраняются для ученика и в экспорте', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const response = await fetch(`${api}/public/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Урок с картинками', ownerDisplayName: 'Учитель', language: 'nodejs' }) });
    assert.equal(response.status, 200);
    const room = await response.json();
    const owner = await participant(browser, room, true);
    const pupil = await participant(browser, room, false);
    await mode(owner, 'Доска');
    await Promise.all([saved(owner), saved(pupil)]);
    const dataURL = await owner.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 80;
      const context = canvas.getContext('2d'); context.fillStyle = '#eb3349'; context.fillRect(0, 0, 160, 80);
      context.fillStyle = '#ffffff'; context.fillRect(20, 20, 120, 40);
      return canvas.toDataURL('image/png');
    });
    const choosing = owner.waitForEvent('filechooser');
    await panel(owner).getByRole('button', { name: 'Добавить изображение', exact: true }).click();
    await (await choosing).setFiles({ name: 'lesson.png', mimeType: 'image/png', buffer: Buffer.from(dataURL.split(',')[1], 'base64') });
    const first = await waitScene(room, scene => images(scene).length === 1);
    const image = images(first)[0];
    assert.equal(image.width / image.height, 2, 'image keeps its proportions');
    assert.equal(first.files[image.fileId].dataURL, dataURL);
    assert.equal(first.files[image.fileId].mimeType, 'image/png');
    await saved(owner);
    await owner.keyboard.press('ArrowRight');
    await waitScene(room, scene => images(scene)[0]?.x > image.x);
    const visible = await displayedImage(owner);
    await owner.mouse.move(visible.x + visible.width, visible.y + visible.height);
    await owner.mouse.down();
    await owner.mouse.move(visible.x + visible.width + 40, visible.y + visible.height + 20, { steps: 8 });
    await owner.mouse.up();
    const resized = await waitScene(room, scene => images(scene)[0]?.width > image.width);
    assert.ok(Math.abs(images(resized)[0].width / images(resized)[0].height - 2) < .02, 'corner resize preserves image proportions');
    await saved(owner);
    await owner.keyboard.press('ControlOrMeta+z');
    await waitScene(room, scene => images(scene)[0]?.width === image.width);
    await saved(owner);
    await panel(owner).getByRole('radio', { name: 'Карандаш', exact: true }).check();
    await owner.mouse.move(visible.x + 40, visible.y + 30); await owner.mouse.down();
    await owner.mouse.move(visible.x + 100, visible.y + 50, { steps: 12 }); await owner.mouse.up();
    await waitScene(room, scene => images(scene).length === 1 && scene.elements.some(element => element.type === 'freedraw' && !element.isDeleted));
    await saved(owner);

    await transferImage(owner, 'paste', dataURL);
    await waitScene(room, scene => images(scene).length === 2);
    await transferImage(owner, 'drop', dataURL);
    const all = await waitScene(room, scene => images(scene).length === 3);
    await saved(owner);
    assert.ok(images(all).every(element => all.files[element.fileId]?.dataURL === dataURL));
    const objectPaste = { type: 'excalidraw/clipboard', elements: [images(all)[0]], files: { [image.fileId]: all.files[image.fileId] } };
    const shown = await displayedImage(owner);
    await owner.mouse.move(shown.x + shown.width / 2, shown.y + shown.height / 2);
    await panel(owner).locator('.excalidraw').focus();
    await panel(owner).getByTestId('room-whiteboard-canvas').locator('canvas.interactive').evaluate((canvas, payload) => {
      const data = new DataTransfer(); data.setData('text/plain', JSON.stringify(payload));
      canvas.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, objectPaste);
    const copied = await waitScene(room, scene => images(scene).length === 4);
    assert.equal(Object.keys(copied.files).length, 3, 'copying an image reuses its immutable asset');
    await saved(owner);
    const native = JSON.parse((await exported(owner, '.excalidraw')).toString('utf8'));
    assert.equal(images(native).length, 4);
    assert.ok(images(native).every(element => native.files[element.fileId]?.dataURL === dataURL));
    const svg = (await exported(owner, 'SVG')).toString('utf8');
    assert.match(svg, /<image\b/);
    assert.ok(svg.includes(dataURL.split(',')[1]), 'SVG embeds the image bytes');
    const png = await exported(owner, 'PNG');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    await pupil.reload({ waitUntil: 'domcontentloaded' });
    await saved(pupil);
    const peer = JSON.parse((await exported(pupil, '.excalidraw')).toString('utf8'));
    assert.equal(images(peer).length, 4);
    assert.ok(images(peer).every(element => peer.files[element.fileId]?.dataURL === dataURL));
    await owner.screenshot({ path: '/tmp/interhub-whiteboard-images.png' });

    let expectedImages = 4;
    for (const mimeType of ['image/jpeg', 'image/webp']) {
      const rasterURL = await owner.evaluate(mimeType => {
        const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 90;
        const context = canvas.getContext('2d'); context.fillStyle = '#3399dd'; context.fillRect(0, 0, 180, 90);
        return canvas.toDataURL(mimeType);
      }, mimeType);
      assert.ok(rasterURL.startsWith(`data:${mimeType};base64,`));
      await transferImage(owner, 'drop', rasterURL, mimeType);
      expectedImages++;
      const rasterScene = await waitScene(room, scene => images(scene).length === expectedImages);
      assert.ok(Object.values(rasterScene.files).some(file => file.mimeType === mimeType && file.dataURL === rasterURL));
    }
    await saved(owner);
    const rasterNative = JSON.parse((await exported(owner, '.excalidraw')).toString('utf8'));
    assert.equal(images(rasterNative).length, 6);
    assert.deepEqual([...new Set(Object.values(rasterNative.files).map(file => file.mimeType))].sort(), ['image/jpeg', 'image/png', 'image/webp']);

    await transferImage(owner, 'drop', 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), 'image/svg+xml');
    await panel(owner).getByRole('alert').waitFor();
    assert.equal(images(await snapshot(room)).length, 6, 'unsupported files leave board intact');
    await transferImage(owner, 'paste', 'data:image/png;base64,' + Buffer.from('not an image').toString('base64'));
    await panel(owner).getByRole('alert').waitFor();
    assert.equal(images(await snapshot(room)).length, 6, 'corrupt images leave board intact');
    assert.equal(await owner.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('data:image/png;base64,'))), false);

    const bomb = Buffer.from(dataURL.split(',')[1], 'base64');
    bomb.writeUInt32BE(50000, 16); bomb.writeUInt32BE(50000, 20);
    await owner.evaluate(() => {
      window.__imageDecodeCalls = 0;
      window.__originalImageDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () { window.__imageDecodeCalls++; return window.__originalImageDecode.call(this); };
    });
    await transferImage(owner, 'drop', 'data:image/png;base64,' + bomb.toString('base64'));
    await panel(owner).getByRole('alert').filter({ hasText: /Изображение слишком большое/ }).waitFor();
    assert.equal(await owner.evaluate(() => window.__imageDecodeCalls), 0, 'encoded dimensions are checked before allocating a bitmap');
    await owner.evaluate(() => { HTMLImageElement.prototype.decode = window.__originalImageDecode; });

    await owner.evaluate(() => {
      const read = FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL = function (blob) {
        FileReader.prototype.readAsDataURL = read;
        window.__releaseImageRead = () => read.call(this, blob);
      };
    });
    await transferImage(owner, 'drop', dataURL);
    await owner.waitForFunction(() => typeof window.__releaseImageRead === 'function');
    await mode(owner, 'Code');
    await owner.evaluate(() => window.__releaseImageRead());
    await mode(owner, 'Доска');
    await saved(owner);
    assert.equal(images(await snapshot(room)).length, 6, 'late import cannot reappear after switching away and back');

    const finish = await fetch(`${api}/rooms/${room.inviteCode}/verdict`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Owner-Token': room.ownerToken }, body: JSON.stringify({ verdict: 'HIRE' }) });
    assert.equal(finish.status, 200);
    await panel(pupil).getByRole('status').filter({ hasText: /Только просмотр/ }).waitFor();
    assert.equal(await panel(pupil).getByRole('button', { name: 'Добавить изображение', exact: true }).count(), 0);
    await transferImage(pupil, 'paste', dataURL);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(images(await snapshot(room)).length, 6);
  } finally { await browser.close(); }
});
