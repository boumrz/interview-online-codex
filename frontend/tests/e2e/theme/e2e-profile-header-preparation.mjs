import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
async function request(path, token, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${api}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${path}: HTTP${response.status}`);
  return response.json();
}
async function fixture() {
  return request('/auth/register', null, { nickname: `profile_${crypto.randomUUID().slice(0, 12)}`, displayName: 'Проверка профиля', password: 'test-password-123' });
}
async function open(auth) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => { localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); }, auth);
  return { browser, page: await context.newPage() };
}
test('profile capability changes directly, survives reload, and retries without changing identity', async () => {
  const auth = await fixture(); const { browser, page } = await open(auth);
  try {
    await page.goto(`${web}/profile`);
    const toggle = page.getByRole('switch', { name: 'Я участвую в найме', exact: true });
    await toggle.waitFor({ timeout: 5000 });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    const changed = page.waitForResponse(r => r.url().endsWith('/api/me/profile') && r.request().method() === 'PATCH');
    await toggle.click(); assert.ok((await changed).ok());
    await page.getByRole('link', { name: 'Кандидаты', exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.reload(); await toggle.waitFor(); assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await page.route('**/api/me/profile', route => route.fulfill({ status: 503, json: { error: 'temporary' } }), { times: 1 });
    await toggle.click(); await page.getByRole('alert').filter({ hasText: /Не удалось сохранить/ }).waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await page.getByRole('link', { name: 'Кандидаты', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Изменить настройки нанимающего', exact: true }).count(), 0);
    assert.ok((await page.locator('main').innerText()).includes(auth.user.id));
    await page.reload(); await toggle.waitFor(); assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  } finally { await browser.close(); }
});
test('personal and team headers keep context width, right navigation and theme at the end', async () => {
  const auth = await fixture(); const { team } = await request('/teams', auth.token, { name: 'Очень длинное название команды для проверки постоянной ширины' });
  const { browser, page } = await open(auth);
  try {
    for (const path of ['/workspace/personal/interviews', `/workspace/teams/${team.id}/interviews`]) {
      for (const width of [1366, 1024, 768]) for (const mode of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 1024 });
        await page.goto(`${web}${path}`);
        await page.evaluate(mode => { localStorage.setItem('interview-online:ui-theme', mode); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode })); }, mode);
        const header = page.locator('header');
        const selector = header.getByRole('button', { name: /Команды:/ });
        await selector.waitFor({ timeout: 5000 });
        await page.evaluate(() => document.fonts.ready);
        const theme = header.getByRole('button', { name: /^(Светлая|Тёмная) тема$/ });
        const profile = header.getByRole('link', { name: /Открыть профиль/ });
        const exit = header.getByRole('button', { name: 'Выйти', exact: true });
        const boxes = await Promise.all([selector, profile, exit, theme].map(x => x.boundingBox()));
        assert.ok(Math.abs(boxes[0].width - 240) <= 1, `${path}/${width}/${mode}: fixed selector`);
        assert.ok(boxes[3].x >= boxes[2].x + boxes[2].width, 'theme follows logout at far right');
        for (const box of boxes.slice(1)) assert.ok(Math.abs(box.y + box.height / 2 - boxes[0].y - boxes[0].height / 2) <= 2, 'one control axis');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const nav = header.locator('nav');
        assert.equal(await nav.evaluate(el => getComputedStyle(el).justifyContent), 'flex-end');
        assert.equal(await theme.evaluate(el => !el.parentElement.querySelector('button:last-child') || el.parentElement.querySelector('button:last-child') === el), true);
      }
    }
  } finally { await browser.close(); }
});
test('interview search includes candidate, and deletion uses a last icon with matching confirmation color', async () => {
  const auth = await fixture();
  const room = await request('/rooms', auth.token, { title: 'Название без цифр', taskIds: [] });
  await request(`/rooms/${room.inviteCode}/interview-metadata`, auth.token, { candidateName: 'Кандидат 234', position: null, scheduledAt: null, revision: 0 }, 'PUT');
  const { browser, page } = await open(auth);
  try {
    await page.goto(`${web}/workspace/personal/interviews`);
    const row = page.getByRole('row', { name: /Название без цифр/ });
    await row.getByText('Кандидат 234', { exact: true }).waitFor({ timeout: 5000 });
    const search = page.getByRole('textbox', { name: 'Поиск интервью', exact: true });
    for (const q of ['234', '  КАНДИДАТ  ', 'название']) {
      await search.fill(q); await row.waitFor({ timeout: 5000 });
    }
    const remove = row.getByRole('button', { name: 'Удалить Название без цифр', exact: true });
    assert.equal((await remove.innerText()).trim(), '', 'delete action is an icon');
    assert.equal(await remove.locator('svg').count(), 1);
    assert.equal(await remove.evaluate(el => el === [...el.parentElement.querySelectorAll('button')].at(-1)), true);
    for (const mode of ['light', 'dark']) {
      await page.evaluate(mode => { localStorage.setItem('interview-online:ui-theme', mode); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode })); }, mode);
      await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
      await page.mouse.move(0, 0);
      await remove.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
      await page.mouse.move(0, 0);
      const colors = await remove.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
      await remove.click();
      const dialog = page.getByRole('dialog', { name: 'Удалить интервью', exact: true });
      const confirm = dialog.getByRole('button', { name: 'Удалить', exact: true });
      assert.deepEqual(await confirm.evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })), colors);
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    }
    assert.ok((await request('/me/rooms', auth.token)).some(x => x.id === room.id), 'cancel does not delete');
  } finally { await browser.close(); }
});
