import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

async function request(path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}

async function fixture() {
  const auth = await request('/auth/register', null, {
    nickname: `header_${crypto.randomUUID().slice(0, 12)}`,
    displayName: 'Проверка селектора', password: 'test-password-123', isHr: true,
  });
  const { team } = await request('/teams', auth.token, { name: 'Команда проверки шапки' });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
  }, auth);
  return { auth, team, browser, page: await context.newPage() };
}

async function settle(page, path, mode = 'light') {
  await page.goto(`${web}${path}`);
  await page.locator('header').waitFor();
  await page.evaluate(mode => {
    localStorage.setItem('interview-online:ui-theme', mode);
    window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode }));
  }, mode);
  await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return page.locator('header');
}

async function style(control) {
  return control.evaluate(el => {
    el.getAnimations().forEach(animation => animation.finish());
    const style = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--app-neutral-hover)';
    document.body.appendChild(probe);
    const hoverBackground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { color: style.color, border: style.borderColor, borderWidth: parseFloat(style.borderTopWidth), background: style.backgroundColor, text: el.textContent, hoverBackground };
  });
}

test('all header actions use the same background hover without changing text, text color or borders', async () => {
  const { auth, team, browser, page } = await fixture();
  const room = await request('/rooms', auth.token, { title: 'Шапка комнаты', language: 'nodejs', taskIds: [] });
  const anonymousPage = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  try {
    for (const path of ['/', '/login', '/workspace/personal/interviews', `/workspace/teams/${team.id}/interviews`, `/room/${room.inviteCode}`]) {
      for (const mode of ['light', 'dark']) {
        const activePage = path === '/login' ? anonymousPage : page;
        const header = await settle(activePage, path, mode);
        const controls = header.locator('button, a');
        const matching = [];
        for (const control of await controls.all()) {
          if (!(await control.isVisible())) continue;
          const name = await control.getAttribute('aria-label') ?? (await control.textContent()).trim();
          if (name.includes('InterHub') || name === '') continue;
          matching.push(control);
        }
        assert.ok(matching.length > 0, `${path}: header actions present`);
        for (const control of matching) {
          await activePage.mouse.move(0, 0);
          const before = await style(control);
          await control.hover();
          const after = await style(control);
          assert.equal(after.color, before.color, `${path}/${mode}/${before.text}: text color stays stable`);
          assert.equal(after.text, before.text, `${path}/${mode}: text stays stable`);
          if (before.borderWidth > 0) assert.equal(after.border, before.border, `${path}/${mode}/${before.text}: border stays stable`);
          assert.equal(after.background, after.hoverBackground, `${path}/${mode}/${before.text}: navigation hover background`);
        }
      }
    }
  } finally { await browser.close(); }
});

test('workspace selector anchors to the trigger and keeps creation above the scrolling choices', async () => {
  const { team, browser, page } = await fixture();
  try {
    await page.route('**/api/me/workspaces', async route => {
      const response = await route.fetch();
      const current = await response.json();
      await route.fulfill({ response, json: [...current, ...Array.from({ length: 30 }, (_, index) => ({ id: `extra-${index}`, name: `Дополнительная команда ${index + 1}`, kind: 'TEAM', role: 'MEMBER' }))] });
    });
    await settle(page, '/workspace/personal/interviews');
    const trigger = page.getByRole('button', { name: /Команды:/ });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Выбор команды', exact: true });
    await menu.waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Выбор команды' }).count(), 0, 'switching has no modal');
    const create = menu.getByRole('menuitem', { name: 'Создать команду', exact: true });
    const personal = menu.getByRole('menuitemradio', { name: 'Личное', exact: true });
    assert.equal(await personal.getAttribute('aria-checked'), 'true');
    const [buttonBox, menuBox, createBox] = await Promise.all([trigger.boundingBox(), menu.boundingBox(), create.boundingBox()]);
    assert.ok(menuBox.y >= buttonBox.y + buttonBox.height && menuBox.y <= buttonBox.y + buttonBox.height + 24, 'menu opens beneath selector');
    assert.ok(Math.abs(menuBox.x - buttonBox.x) <= 16, 'menu aligns with selector');
    assert.ok(createBox.y < (await personal.boundingBox()).y, 'creation is first');
    await menu.getByRole('menuitemradio', { name: 'Дополнительная команда 30', exact: true }).scrollIntoViewIfNeeded();
    const after = await create.boundingBox();
    assert.ok(Math.abs(after.y - createBox.y) <= 1, 'creation stays fixed while workspace choices scroll');
    assert.equal(await create.isVisible(), true);
    await create.click();
    const modal = page.getByRole('dialog', { name: 'Создать команду', exact: true });
    await modal.waitFor();
    await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
    await trigger.click();
    await menu.waitFor();
    await menu.getByRole('menuitemradio', { name: team.name, exact: true }).click();
    await page.waitForURL(`**/workspace/teams/${team.id}/interviews`);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  } finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close(); }
});

test('workspace selector supports arrows, Escape with focus return, and outside dismissal', async () => {
  const { browser, page } = await fixture();
  try {
    await settle(page, '/workspace/personal/interviews');
    const trigger = page.getByRole('button', { name: /Команды:/ });
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Выбор команды', exact: true });
    await menu.waitFor({ timeout: 3000 });
    await page.waitForFunction(() => document.querySelector('[role="menu"][aria-label="Выбор команды"]')?.contains(document.activeElement));
    await page.keyboard.press('End');
    assert.equal(await menu.getByRole('menuitemradio').last().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Home');
    assert.equal(await menu.getByRole('menuitem', { name: 'Создать команду', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await menu.getByRole('menuitemradio', { name: 'Личное', exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await trigger.click();
    await menu.waitFor();
    await page.getByRole('heading', { name: 'Интервью', exact: true }).click();
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  } finally { await browser.close(); }
});
