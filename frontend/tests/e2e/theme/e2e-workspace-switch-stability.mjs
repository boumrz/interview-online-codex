import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const user = { id: '00000000-0000-4000-8000-000000000001', nickname: 'stable', displayName: 'Участник', role: 'user', isHr: false };
const teams = ['A', 'B'].map((name, i) => ({ id: `00000000-0000-4000-8000-00000000001${i}`, name: `Команда ${name}`, role: 'OWNER', epoch: 1, revision: 1, capabilities: [] }));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function fixture(width, { longPersonal = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const pending = new Map();
  const requested = new Map();
  await context.addInitScript(() => localStorage.setItem('auth_token', 'stable-fixture'));
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200, body;
    const team = teams.find(team => path.startsWith(`/api/teams/${team.id}`));
    if (path === '/api/me/profile') body = user;
    else if (path === '/api/me/workspaces') body = [{ id: 'personal', name: 'Личное пространство', role: 'OWNER', epoch: 1, capabilities: [] }, ...teams];
    else if (team && path === `/api/teams/${team.id}`) {
      requested.set(team.id, (requested.get(team.id) ?? 0) + 1);
      const gate = pending.get(team.id);
      if (gate) { gate.started.resolve(); await gate.release.promise; status = gate.status; }
      body = status === 200 ? team : { error: 'Доступ запрещён' };
    }
    else if (path.endsWith('/tracks')) body = { items: [], counts: { activeTracks: 0, archivedTracks: 0, activeVacancies: 0, archivedVacancies: 0 } };
    else if (team && path.endsWith('/interviews')) body = { items: new URL(route.request().url()).searchParams.has('ownership') ? [] : [{ id: `interview-${team.name}`, teamId: team.id, roomId: `room-${team.id}`, inviteCode: 'example', title: `Закрытое интервью ${team.name}`, taskCount: 0, tasks: [], assignees: [], ownerUserId: user.id, createdByUserId: user.id, ownershipState: 'OWNED', status: 'active', createdAt: '2026-09-30T09:00:00Z', trackId: null, vacancyId: null }] };
    else if (path === '/api/me/rooms') body = [];
    else if (path === '/api/me/tasks') body = longPersonal ? [{ language: 'nodejs', tasks: Array.from({ length: 18 }, (_, index) => ({ id: `task-${index}`, title: `Личная задача ${index + 1}`, description: 'Условие задачи', starterCode: '', language: 'nodejs' })) }] : [];
    else if (path === '/api/me/presets') body = [];
    else if (team) body = { items: [] };
    else { status = 404; body = { error: path }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(`${web}/workspace/personal/interviews`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Интервью', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
  } catch (error) { await browser.close(); throw error; }
  function delay(team, status = 200) {
    const gate = { started: deferred(), release: deferred(), status };
    pending.set(team.id, gate);
    return { started: gate.started.promise, release() { pending.delete(team.id); gate.release.resolve(); } };
  }
  return { browser, context, page, delay, requested };
}

async function switchTo(page, name) {
  await page.getByRole('button', { name: /Команды:/ }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector); if (!el) return null; const { x, y, width, height } = el.getBoundingClientRect(); return { x, y, width, height }; };
    return { header: box('header'), trigger: box('button[aria-label^="Команды:"]'), profile: box('header a[aria-label^="Открыть профиль"]'), viewport: document.documentElement.clientWidth };
  });
}
function stable(before, after, message) {
  for (const part of ['header', 'trigger', 'profile']) {
    assert.ok(before[part] && after[part], `${message}: ${part} remains visible`);
    for (const value of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[part][value] - after[part][value]) <= 1, `${message}: ${part}.${value} (${before[part][value]} → ${after[part][value]})`);
  }
  assert.equal(before.viewport, after.viewport, `${message}: content viewport stays fixed`);
}

test('first lazy workspace navigation keeps the current shell visible while the destination chunk loads', async () => {
  const { browser, context, page } = await fixture(1366);
  const chunk = deferred(), started = deferred();
  try {
    await context.route('**/*TeamWorkspacePage*.chunk.js', async route => { started.resolve(); await chunk.promise; await route.continue(); });
    const before = await geometry(page);
    await switchTo(page, teams[0].name);
    await started.promise;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    stable(before, await geometry(page), 'lazy load');
    assert.equal(await page.getByText('Loading...', { exact: true }).count(), 0);
    chunk.resolve();
    await page.getByRole('region', { name: `Командное интервью Закрытое интервью ${teams[0].name}`, exact: true }).waitFor();
  } finally { chunk.resolve(); await browser.close(); }
});

for (const width of [1366, 1024, 768]) test(`workspace shell remains stable during access checks and repeated switches at ${width}px`, async () => {
  const { browser, page, delay, requested } = await fixture(width);
  let gate;
  try {
    const personal = await geometry(page);
    gate = delay(teams[0]);
    await switchTo(page, teams[0].name);
    await gate.started;
    await page.getByRole('status', { name: 'Проверяем доступ к команде', exact: true }).waitFor();
    const pending = await geometry(page);
    stable(personal, pending, 'personal → pending team');
    const title = await page.getByRole('heading', { name: 'Интервью', exact: true }).boundingBox();
    gate.release();
    await page.getByRole('region', { name: `Командное интервью Закрытое интервью ${teams[0].name}`, exact: true }).waitFor();
    stable(pending, await geometry(page), 'pending → authorized');
    assert.equal((await page.getByRole('heading', { name: 'Интервью', exact: true }).boundingBox()).y, title.y, 'heading stays in position');
    const aRequests = requested.get(teams[0].id);
    await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
    await page.getByRole('heading', { name: 'Библиотека', exact: true }).waitFor();
    stable(personal, await geometry(page), 'same-team section switch');
    assert.equal(requested.get(teams[0].id), aRequests, 'section switch does not recheck team access');
    gate = delay(teams[1]);
    await switchTo(page, teams[1].name);
    await gate.started;
    await page.getByRole('status', { name: 'Проверяем доступ к команде', exact: true }).waitFor();
    stable(personal, await geometry(page), 'team → pending other team');
    assert.equal(await page.getByText(`Закрытое интервью ${teams[0].name}`, { exact: true }).count(), 0, 'previous private data hidden');
    gate.release();
    await page.getByRole('region', { name: `Командное интервью Закрытое интервью ${teams[1].name}`, exact: true }).waitFor();
    stable(personal, await geometry(page), 'other team authorized');
    await switchTo(page, 'Личное');
    await page.waitForURL('**/workspace/personal/interviews');
    stable(personal, await geometry(page), 'return to personal');
    gate = delay(teams[0], 403);
    await switchTo(page, teams[0].name);
    await gate.started;
    gate.release();
    await page.getByRole('alert').filter({ hasText: 'Команда недоступна' }).waitFor();
    stable(personal, await geometry(page), 'denied access');
    assert.equal(await page.getByRole('region', { name: /Командное интервью/ }).count(), 0);
    assert.match(await page.getByRole('button', { name: /Команды:/ }).getAttribute('aria-label'), /^Команды: Команда\./);
  } finally { gate?.release(); await browser.close(); }
});

test('a delayed former team response cannot replace the current team after a rapid switch', async () => {
  const { browser, page, delay } = await fixture(1366);
  const a = delay(teams[0]), b = delay(teams[1]);
  try {
    const before = await geometry(page);
    await switchTo(page, teams[0].name);
    await a.started;
    await switchTo(page, teams[1].name);
    await b.started;
    stable(before, await geometry(page), 'rapid switch pending');
    b.release();
    await page.getByRole('region', { name: `Командное интервью Закрытое интервью ${teams[1].name}`, exact: true }).waitFor();
    a.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(new URL(page.url()).pathname, `/workspace/teams/${teams[1].id}/interviews`);
    assert.match(await page.getByRole('button', { name: /Команды:/ }).getAttribute('aria-label'), /Команда B/);
    assert.equal(await page.getByText(`Закрытое интервью ${teams[0].name}`, { exact: true }).count(), 0);
    stable(before, await geometry(page), 'late former response');
  } finally { a.release(); b.release(); await browser.close(); }
});

test('logout remains immediate and returns to the public landing page', async () => {
  const { browser, page } = await fixture(1366);
  try {
    await switchTo(page, teams[0].name);
    await page.getByRole('region', { name: `Командное интервью Закрытое интервью ${teams[0].name}`, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.waitForURL(`${web}/`);
    assert.equal(await page.evaluate(() => localStorage.getItem('auth_token')), null);
    assert.equal(await page.getByRole('region', { name: /Командное интервью/ }).count(), 0);
  } finally { await browser.close(); }
});

test('leaving a long library keeps the content width while the destination is short', async () => {
  const { browser, page } = await fixture(1366, { longPersonal: true });
  try {
    await page.getByRole('link', { name: 'Библиотека', exact: true }).click();
    await page.getByRole('heading', { name: 'Библиотека', exact: true }).waitFor();
    await page.getByText('Личная задача 18', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), true, 'source library requires scrolling');
    const before = await geometry(page);
    await switchTo(page, teams[0].name);
    await page.getByRole('region', { name: `Командное интервью Закрытое интервью ${teams[0].name}`, exact: true }).waitFor();
    stable(before, await geometry(page), 'long → short workspace');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter), 'stable');
  } finally { await browser.close(); }
});
