import "../support/require-isolated-api.mjs";
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
    nickname: `WWWWWWWWWWWWWWWWWWWW${crypto.randomUUID().slice(0, 12)}`,
    displayName: 'Независимая проверка шапки', password: 'test-password-123', isHr: true,
  });
  const { team } = await request('/teams', auth.token, { name: 'Очень длинное название команды для проверки ширины селектора и обрезки текста' });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
  await context.addInitScript(({ token, user }) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
  }, auth);
  return { auth, team, browser, page: await context.newPage() };
}

async function settledHeader(page, path, width, mode = 'light') {
  await page.setViewportSize({ width, height: 1024 });
  await page.goto(`${web}${path}`);
  const header = page.locator('header');
  await header.getByRole('button', { name: /Команды:/ }).waitFor();
  await page.evaluate(mode => {
    localStorage.setItem('interview-online:ui-theme', mode);
    window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: mode }));
  }, mode);
  await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return header;
}

test('headers preserve readable controls and an ellipsized 32-character nickname at all supported widths', async () => {
  const { team, browser, page } = await fixture();
  try {
    for (const path of ['/workspace/personal/interviews', `/workspace/teams/${team.id}/interviews`]) {
      for (const width of [1366, 1024, 768]) for (const mode of ['light', 'dark']) {
        const header = await settledHeader(page, path, width, mode);
        const profile = header.getByRole('link', { name: /Открыть профиль/ });
        const measured = await profile.evaluate(el => {
          const text = el.querySelector(':scope > span:not(.anticon)');
          const icon = el.querySelector('svg');
          const rect = el.getBoundingClientRect();
          return { width: rect.width, textWidth: text.clientWidth, textContentWidth: text.scrollWidth, overflow: getComputedStyle(text).textOverflow, iconWidth: icon.getBoundingClientRect().width, name: el.getAttribute('aria-label') };
        });
        assert.equal(measured.overflow, 'ellipsis');
        assert.ok(measured.textContentWidth > measured.textWidth, `${width}: long nickname is truncated inside its own text span: ${JSON.stringify(measured)}`);
        assert.ok(measured.iconWidth >= 15, 'profile icon remains visible');
        assert.ok(measured.width >= 70, 'profile remains a usable control');
        assert.ok(measured.name.length > 32, 'full nickname remains in accessible name');
        const controls = await header.locator('a,button').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== 'hidden').map(el => {
          const r = el.getBoundingClientRect(); return { text: el.getAttribute('aria-label') ?? el.textContent, x: r.x, y: r.y, width: r.width, height: r.height };
        }));
        for (let a = 0; a < controls.length; a++) for (let b = a + 1; b < controls.length; b++) {
          const first = controls[a], second = controls[b];
          assert.ok(first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1 || first.y + first.height <= second.y + 1 || second.y + second.height <= first.y + 1, `${width}/${mode}: controls overlap: ${first.text} / ${second.text}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
  } finally { await browser.close(); }
});

test('overflow section menu exposes expanded and collapsed state', async () => {
  const { team, browser, page } = await fixture();
  try {
    const header = await settledHeader(page, `/workspace/teams/${team.id}/interviews`, 1024);
    const trigger = header.getByRole('button', { name: 'Меню разделов', exact: true });
    await trigger.waitFor();
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', 'collapsed state is announced');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Дополнительные разделы' });
    await menu.waitFor({ timeout: 3000 });
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true', 'expanded state is announced');
  } finally { await browser.close(); }
});

test('overflow supports keyboard opening, Escape, and focus return', async () => {
  const { team, browser, page } = await fixture();
  try {
    const header = await settledHeader(page, `/workspace/teams/${team.id}/interviews`, 1024);
    const trigger = header.getByRole('button', { name: /Меню разделов/ });
    await trigger.waitFor();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Дополнительные разделы' });
    await menu.waitFor({ timeout: 3000 });
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('[role="menu"][aria-label="Дополнительные разделы"]')?.contains(document.activeElement), null, { timeout: 1000 });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden', timeout: 2000 });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('Меню разделов'), null, { timeout: 1000 });
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true, 'focus returns to trigger');
  } finally { await browser.close(); }
});

test('a current section hidden in overflow remains discoverable without opening the menu', async () => {
  const { team, browser, page } = await fixture();
  try {
    const header = await settledHeader(page, `/workspace/teams/${team.id}/candidates`, 1024);
    const trigger = header.getByRole('button', { name: /Меню разделов/ });
    await trigger.waitFor();
    assert.equal(await header.locator('nav a[aria-current="page"]').count(), 0, 'candidates is in overflow at this width');
    const state = await trigger.evaluate(el => ({ name: el.getAttribute('aria-label'), current: el.getAttribute('aria-current'), selected: el.getAttribute('data-active-section'), text: el.textContent }));
    assert.ok(state.name.includes('Кандидаты') || state.text.includes('Кандидаты') || state.current === 'page' || state.selected === 'true', 'closed overflow identifies the current hidden section');
  } finally { await browser.close(); }
});

test('Escape from inside the overflow closes it and returns focus to its trigger', async () => {
  const { team, browser, page } = await fixture();
  try {
    const header = await settledHeader(page, `/workspace/teams/${team.id}/interviews`, 1024);
    const trigger = header.getByRole('button', { name: /Меню разделов/ });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Дополнительные разделы' });
    await menu.waitFor({ timeout: 3000 });
    await menu.getByRole('menuitem').first().focus();
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden', timeout: 2000 });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('Меню разделов'), null, { timeout: 1000 });
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true, 'focus returns to trigger');
  } finally { await browser.close(); }
});

test('a current section in overflow uses the theme selected background', async () => {
  const { team, browser, page } = await fixture();
  try {
    for (const mode of ['light', 'dark']) {
      const header = await settledHeader(page, `/workspace/teams/${team.id}/candidates`, 1024, mode);
      const trigger = header.getByRole('button', { name: /Меню разделов.*Кандидаты/ });
      await trigger.waitFor();
      await trigger.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
      const colors = await trigger.evaluate(el => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--app-selected-bg)';
        document.body.appendChild(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { actual: getComputedStyle(el).backgroundColor, expected };
      });
      assert.equal(colors.actual, colors.expected, `${mode}: selected section background`);
    }
  } finally { await browser.close(); }
});

test('the profile copy icon aligns directly with the personal ID', async () => {
  const { auth, browser, page } = await fixture();
  try {
    for (const width of [1366, 768]) for (const mode of ['light', 'dark']) {
      await settledHeader(page, '/profile', width, mode);
      const main = page.locator('main');
      const id = main.getByText(auth.user.id, { exact: true });
      await id.waitFor();
      const copy = main.getByRole('button', { name: 'Скопировать личный ID', exact: true });
      const [a, b] = await Promise.all([id.boundingBox(), copy.boundingBox()]);
      assert.ok(Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 2, `${width}/${mode}: copy shares ID axis`);
      assert.ok(b.x - a.x - a.width >= 0 && b.x - a.x - a.width <= 16, 'copy is adjacent to ID');
    }
  } finally { await browser.close(); }
});

test('the hiring capability blocks overlapping profile edits while saving and unlocks after confirmation', async () => {
  const { browser, page } = await fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const pending = new Promise(resolve => { entered = resolve; });
  let patchCount = 0;
  try {
    await settledHeader(page, '/profile', 1366);
    const toggle = page.getByRole('switch', { name: 'Я участвую в найме', exact: true });
    const pencil = page.getByRole('button', { name: 'Изменить имя', exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await page.route('**/api/me/profile', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patchCount += 1;
      entered();
      await gate;
      await route.continue();
    });
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/me/profile') && response.request().method() === 'PATCH');
    await toggle.click();
    await pending;
    assert.equal(await toggle.isDisabled(), true, 'overlapping capability changes are blocked');
    assert.equal(await pencil.isDisabled(), true, 'name edit cannot race capability persistence');
    await page.getByRole('status').filter({ hasText: 'Сохраняем…' }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(patchCount, 1);
    release();
    assert.ok((await accepted).ok());
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Я участвую в найме"]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await pencil.isEnabled(), true);
    await pencil.click();
    const modal = page.getByRole('dialog', { name: 'Изменить имя', exact: true });
    await modal.waitFor();
    assert.equal(await toggle.isDisabled(), true, 'capability edit is blocked during name editing');
    await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(await toggle.isEnabled(), true);
  } finally { release(); await browser.close(); }
});
