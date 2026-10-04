import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const evidence = process.env.EVIDENCE_DIR ?? '.run/workspace-burger-frames';
const user = { id: '00000000-0000-4000-8000-000000000101', nickname: 'burger_frames', displayName: 'Проверка шапки', role: 'user', isHr: true };
const teams = ['Альфа', 'Бета'].map((name, index) => ({ id: `00000000-0000-4000-8000-00000000011${index}`, name: `Команда ${name}`, role: 'OWNER', epoch: 1, revision: 1, capabilities: [] }));
const burgerSelector = 'header button[aria-label^="Меню разделов"]';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(width, theme) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const gates = new Map();
  await context.addInitScript(({ user, theme }) => {
    localStorage.setItem('auth_token', 'burger-frames-fixture');
    localStorage.setItem('auth_user', JSON.stringify(user));
    localStorage.setItem('interview-online:ui-theme', theme);
  }, { user, theme });
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const team = teams.find(item => path.startsWith(`/api/teams/${item.id}`));
    let status = 200;
    let body;
    if (path === '/api/me/profile') body = user;
    else if (path === '/api/me/workspaces') body = [{ id: 'personal', name: 'Личное пространство', role: 'OWNER', epoch: 1, capabilities: [] }, ...teams];
    else if (team && path === `/api/teams/${team.id}`) {
      const gate = gates.get(team.id);
      if (gate) { gate.started.resolve(); await gate.release.promise; status = gate.status; }
      body = status === 200 ? team : { error: 'Доступ запрещён' };
    } else if (path.endsWith('/tracks')) body = { items: [], counts: { activeTracks: 0, archivedTracks: 0, activeVacancies: 0, archivedVacancies: 0 } };
    else if (team && path.endsWith('/interviews')) body = { items: new URL(route.request().url()).searchParams.has('ownership') ? [] : [{ id: `interview-${team.id}`, teamId: team.id, roomId: `room-${team.id}`, inviteCode: 'example', title: `Интервью ${team.name}`, taskCount: 0, tasks: [], assignees: [], ownerUserId: user.id, createdByUserId: user.id, ownershipState: 'OWNED', status: 'active', createdAt: '2026-09-30T09:00:00Z', trackId: null, vacancyId: null }] };
    else if (path === '/api/me/rooms' || path === '/api/me/tasks' || path === '/api/me/presets') body = [];
    else if (team) body = { items: [] };
    else { status = 404; body = { error: path }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(`${web}/workspace/personal/interviews`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Интервью', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const delay = (team, status = 200) => {
    const gate = { started: deferred(), release: deferred(), status };
    gates.set(team.id, gate);
    return { started: gate.started.promise, release() { gates.delete(team.id); gate.release.resolve(); } };
  };
  return { browser, context, page, delay };
}

async function frames(page, count) {
  await page.evaluate(count => new Promise(resolve => {
    const next = () => --count <= 0 ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }), count);
}

async function startRecording(page) {
  await page.mouse.move(0, 899);
  await page.evaluate(selector => {
    window.__burgerFrames = [];
    window.__recordBurgerFrames = true;
    const sample = () => {
      if (!window.__recordBurgerFrames) return;
      const button = document.querySelector(selector);
      const rect = button?.getBoundingClientRect();
      const style = button ? getComputedStyle(button) : null;
      const header = document.querySelector('header')?.getBoundingClientRect();
      const nav = document.querySelector('header nav[aria-label^="Разделы"]');
      const navRect = nav?.getBoundingClientRect();
      window.__burgerFrames.push({
        time: performance.now(), path: location.pathname, fontStatus: document.fonts.status,
        pending: !!document.querySelector('[role="status"][aria-label="Проверяем доступ к команде"]'),
        denied: [...document.querySelectorAll('[role="alert"]')].some(element => element.textContent?.includes('Команда недоступна')),
        protectedAnchors: nav?.querySelectorAll('a[href]').length ?? 0,
        protectedMenuVisible: [...document.querySelectorAll('[role="menu"][aria-label="Дополнительные разделы"]')].some(element => element.getClientRects().length && getComputedStyle(element.closest('.ant-dropdown') ?? element).visibility !== 'hidden'),
        placeholder: !!document.querySelector('[data-testid="team-navigation-placeholder"]'),
        header: header ? { x: header.x, y: header.y, width: header.width, height: header.height } : null,
        nav: nav ? { x: navRect.x, y: navRect.y, width: navRect.width, height: navRect.height,
          entries: [...nav.children].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map(element => element.getAttribute('aria-label') ?? element.textContent?.trim()) } : null,
        button: button ? {
          label: button.getAttribute('aria-label'), active: button.getAttribute('data-active-section'),
          expanded: button.getAttribute('aria-expanded'), hovered: button.matches(':hover'),
          focused: document.activeElement === button, focusVisible: button.matches(':focus-visible'),
          disabled: button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true',
          background: style.backgroundColor, color: style.color, boxShadow: style.boxShadow,
          outline: style.outlineStyle, outlineWidth: style.outlineWidth,
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        } : null,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, burgerSelector);
  await frames(page, 3);
}

async function stopRecording(page, name) {
  const samples = await page.evaluate(() => { window.__recordBurgerFrames = false; return window.__burgerFrames; });
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/${name}.json`, JSON.stringify(samples, null, 2));
  return samples;
}

async function switchTo(page, name) {
  await page.getByRole('button', { name: /Команды:/ }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await page.mouse.move(0, 899);
}

function uninterruptedNormalBurger(samples, reference, name) {
  const violations = samples.flatMap((sample, index) => {
    const button = sample.button;
    if (!button || button.hovered || button.focusVisible || button.expanded === 'true') return [];
    if (!reference) return [{ frame: index, path: sample.path, unexpected: 'overflow trigger appears when every section fits', button }];
    const transparent = value => /^rgba\([^)]*,\s*0\)$/.test(value);
    const differences = ['background', 'color', 'boxShadow', 'x', 'y', 'width', 'height'].filter(key => {
      if (typeof button[key] === 'number') return Math.abs(button[key] - reference[key]) > 1;
      return button[key] !== reference[key] && !(key === 'background' && transparent(button[key]) && transparent(reference[key]));
    });
    if (button.active === 'true') differences.push('unexpected active overflow section');
    return differences.length ? [{ frame: index, path: sample.path, pending: sample.pending, fontStatus: sample.fontStatus, differences, button }] : [];
  });
  assert.deepEqual(violations.slice(0, 3), [], `${name}: pointer-away burger stays neutral on every painted frame (${violations.length} unstable frames)`);
}

for (const width of [1366, 1024, 768]) for (const theme of ['light', 'dark']) {
  test(`burger has no transient highlight during workspace switches (${width}px, ${theme})`, async () => {
    const { browser, page, delay } = await fixture(width, theme);
    const traces = [];
    let gate;
    try {
      await startRecording(page);
      gate = delay(teams[0]);
      await switchTo(page, teams[0].name);
      await gate.started;
      await page.getByRole('status', { name: 'Проверяем доступ к команде', exact: true }).waitFor();
      await frames(page, 12);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/personal-team-pending-${width}-${theme}.png` });
      gate.release();
      await page.getByRole('region', { name: `Командное интервью Интервью ${teams[0].name}`, exact: true }).waitFor();
      await frames(page, 24);
      traces.push({ name: 'personal-team', samples: await stopRecording(page, `personal-team-${width}-${theme}`) });
      const settledTeam = traces[0].samples.at(-1);
      const reference = settledTeam.button;

      await startRecording(page);
      gate = delay(teams[1]);
      await switchTo(page, teams[1].name);
      await gate.started;
      await frames(page, 12);
      gate.release();
      await page.getByRole('region', { name: `Командное интервью Интервью ${teams[1].name}`, exact: true }).waitFor();
      await frames(page, 24);
      traces.push({ name: 'team-team', samples: await stopRecording(page, `team-team-${width}-${theme}`) });

      await startRecording(page);
      gate = delay(teams[0]);
      await switchTo(page, teams[0].name);
      await gate.started;
      await frames(page, 12);
      gate.release();
      await page.getByRole('region', { name: `Командное интервью Интервью ${teams[0].name}`, exact: true }).waitFor();
      await frames(page, 24);
      traces.push({ name: 'team-team-return', samples: await stopRecording(page, `team-team-return-${width}-${theme}`) });

      await startRecording(page);
      await switchTo(page, 'Личное');
      await page.waitForURL('**/workspace/personal/interviews');
      await frames(page, 24);
      traces.push({ name: 'team-personal', samples: await stopRecording(page, `team-personal-${width}-${theme}`) });

      await startRecording(page);
      gate = delay(teams[0], 403);
      await switchTo(page, teams[0].name);
      await gate.started;
      await frames(page, 12);
      gate.release();
      await page.getByRole('alert').filter({ hasText: 'Команда недоступна' }).waitFor();
      await frames(page, 24);
      traces.push({ name: 'team-denied', samples: await stopRecording(page, `team-denied-${width}-${theme}`) });

      for (const trace of traces) {
        uninterruptedNormalBurger(trace.samples, reference, trace.name);
        const initial = trace.samples[0].header;
        assert.equal(trace.samples.filter(sample => !sample.header || ['x', 'y', 'width', 'height'].some(key => Math.abs(sample.header[key] - initial[key]) > 1)).length, 0, `${trace.name}: header geometry is stable on every painted frame`);
      }
      const pendingTeamFrames = traces.filter(trace => trace.name !== 'team-personal').flatMap(trace => trace.samples.filter(sample => sample.pending));
      assert.ok(pendingTeamFrames.length, 'pending authorization painted frames were captured');
      assert.equal(pendingTeamFrames.filter(sample => Boolean(sample.button) !== Boolean(reference)).length, 0, 'overflow trigger keeps the final visibility during team authorization');
      assert.equal(pendingTeamFrames.filter(sample => !sample.nav).length, 0, 'navigation keeps its visible shape while checking team authorization');
      assert.equal(pendingTeamFrames.filter(sample => ['x', 'y', 'width', 'height'].some(key => Math.abs(sample.nav[key] - settledTeam.nav[key]) > 1)).length, 0, 'navigation geometry stays stable between pending and loaded team');
      const restricted = traces.flatMap(trace => trace.samples.filter(sample => sample.pending || sample.denied));
      assert.ok(restricted.some(sample => sample.denied), 'denied authorization frames were captured');
      assert.equal(restricted.filter(sample => sample.protectedAnchors || sample.protectedMenuVisible || sample.button && !sample.button.disabled).length, 0, 'pending and denied shells expose no protected links, menu or enabled overflow trigger');
    } finally { gate?.release(); await browser.close(); }
  });
}

for (const theme of ['light', 'dark']) test(`burger keeps intentional hover, keyboard focus and active overflow indication (${theme})`, async () => {
  const { browser, page } = await fixture(1024, theme);
  try {
    await switchTo(page, teams[0].name);
    await page.getByRole('region', { name: `Командное интервью Интервью ${teams[0].name}`, exact: true }).waitFor();
    await frames(page, 24);
    const burger = page.locator(burgerSelector);
    const color = await burger.evaluate(element => getComputedStyle(element).color);
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('span');
      document.body.append(probe);
      const resolve = token => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
      const result = { hover: resolve('--app-neutral-hover'), selected: resolve('--app-selected-bg'), selectedText: resolve('--app-selected-text') };
      probe.remove();
      return result;
    });
    await burger.hover();
    await frames(page, 24);
    assert.equal(await burger.evaluate(element => getComputedStyle(element).backgroundColor), tokens.hover, 'intentional hover has the common header background');
    assert.equal(await burger.evaluate(element => getComputedStyle(element).color), color, 'intentional hover keeps icon color');
    await page.mouse.move(0, 899);
    await burger.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await burger.evaluate(element => element.matches(':focus-visible')), true, 'keyboard navigation gives the burger a visible focus indicator');
    assert.equal(await burger.evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Дополнительные разделы', exact: true });
    await menu.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="menu"][aria-label="Дополнительные разделы"]')?.contains(document.activeElement), null, { timeout: 1500 });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), burgerSelector, { timeout: 1500 });
    assert.equal(await burger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to overflow trigger');
    await burger.press('Enter');
    await menu.getByRole('menuitem', { name: 'Треки и вакансии', exact: true }).click();
    await page.waitForURL(`**/workspace/teams/${teams[0].id}/tracks`);
    await page.mouse.move(0, 899);
    await page.getByRole('heading', { name: 'Треки и вакансии', exact: true }).waitFor();
    await frames(page, 24);
    assert.equal(await burger.getAttribute('data-active-section'), 'true', 'an overflow section is intentionally marked active');
    assert.match(await burger.getAttribute('aria-label'), /Треки и вакансии/);
    assert.equal(await burger.evaluate(element => getComputedStyle(element).backgroundColor), tokens.selected);
    assert.equal(await burger.evaluate(element => getComputedStyle(element).color), tokens.selectedText);
  } finally { await browser.close(); }
});

test('first lazy team chunk preserves the visible source header until the destination can render', async () => {
  const { browser, context, page } = await fixture(1366, 'dark');
  const chunk = deferred();
  const chunkStarted = deferred();
  let samples;
  try {
    await context.route('**/*TeamWorkspacePage*.chunk.js', async route => { chunkStarted.resolve(); await chunk.promise; await route.continue(); });
    await startRecording(page);
    await switchTo(page, teams[0].name);
    await chunkStarted.promise;
    await frames(page, 18);
    samples = await stopRecording(page, 'first-team-chunk-1366-dark');
    assert.equal(samples.filter(sample => !sample.header).length, 0, 'source header never disappears during first chunk loading');
    const source = samples[0].header;
    assert.equal(samples.filter(sample => Object.keys(source).some(key => Math.abs(sample.header[key] - source[key]) > 1)).length, 0, 'source header keeps its geometry during first chunk loading');
    chunk.resolve();
    await page.getByRole('region', { name: `Командное интервью Интервью ${teams[0].name}`, exact: true }).waitFor();
  } finally { chunk.resolve(); await browser.close(); }
});
