import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
const web = process.env.E2E_BASE_URL || 'http://localhost:5173';
const api = process.env.E2E_API_URL || 'http://localhost:18080/api';
async function request(path, { token, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(api + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function account(name) {
  return request('/auth/register', { method: 'POST', body: { nickname: `history_${randomUUID().slice(0, 12)}`, displayName: name, password: 'test-password-123' } });
}
async function fixture() {
  const owner = await account('Интервьюер истории'), candidate = await account('Кандидат истории');
  const room = await request('/rooms', { token: owner.token, method: 'POST', body: { title: 'История всего интервью', taskIds: [] } });
  await request(`/rooms/${room.inviteCode}/tasks`, { token: owner.token, method: 'POST', body: { customTasks: [{ title: 'Задача', description: 'Проверка истории', starterCode: '// history\n', language: 'nodejs' }] } });
  return { owner, candidate, room };
}
async function open(browser, auth, room) {
  const context = await browser.newContext();
  await context.addInitScript(({ token, name }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('display_name', name);
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(...args) { super(...args); window.__activitySource = this; window.__activityConnections = (window.__activityConnections || 0) + 1; }
      set onmessage(handler) {
        window.__replayActivityState = (payload) => handler?.call(this, new MessageEvent('message', { data: JSON.stringify({ type: 'state_sync', payload }) }));
        super.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'state_sync') window.__activityState = message.payload;
          if (window.__dropActivity && message.type === 'candidate_key') return;
          if (window.__dropActivity && message.type === 'state_sync') {
            handler?.call(this, new MessageEvent('message', { data: JSON.stringify({ ...message, payload: { ...message.payload, candidateKeyHistory: [], lastCandidateKey: null } }) }));
            return;
          }
          handler?.call(this, event);
        };
      }
    };
  }, { token: auth.token, name: auth.user.displayName });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await page.waitForFunction(() => Boolean(window.__activityState?.eventToken));
  return { context, page };
}
async function openLogs(page) {
  await page.getByTestId('room-rail-tools').click();
  await page.getByRole('tab', { name: 'Логи', exact: true }).click();
}
async function seed(page, candidate, room, count) {
  const credentials = await page.evaluate(id => ({ sessionId: window.__activityState.participants.find(p => p.userId === id).sessionId, eventToken: window.__activityState.eventToken }), candidate.user.id);
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const sourceEventId = randomUUID(); ids.push(sourceEventId);
    await request(`/realtime/rooms/${room.inviteCode}/events`, { method: 'POST', status: 204, body: { ...credentials, type: 'key_press', sourceEventId, key: 'x', keyCode: 'KeyX', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } });
  }
  return ids;
}
async function waitIds(page, ids) {
  await page.waitForFunction(expected => {
    const visible = [...document.querySelectorAll('[data-testid="activity-timeline-source-id"]')].map(e => e.textContent);
    return expected.every(id => visible.includes(id)) && new Set(visible).size === visible.length;
  }, ids, { timeout: 18000 });
}
async function loadAll(page) {
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    await page.getByTestId('activity-history-status').waitFor();
    const older = page.getByRole('button', { name: 'Показать более ранние события', exact: true });
    if (await older.count() === 0) return;
    await older.click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent.includes('Показать более ранние события') && b.disabled));
  }
  assert.fail('History cursor did not exhaust');
}

test('whole activity history survives the 50-event tail, empty snapshots, missed broadcasts and reload', { timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  try {
    const { owner, candidate, room } = await fixture();
    const target = await open(browser, candidate, room);
    const ids = await seed(target.page, candidate, room, 451);
    const manager = await open(browser, owner, room);
    await openLogs(manager.page);
    await manager.page.getByRole('button', { name: 'Показать более ранние события', exact: true }).waitFor();
    const retained = await manager.page.getByTestId('activity-timeline-source-id').allTextContents();
    const historyEndpoint = `**/api/rooms/${room.inviteCode}/activity-history*`;
    await manager.page.route(historyEndpoint, route => new URL(route.request().url()).searchParams.has('beforeSequence')
      ? route.fulfill({ status: 503, body: '{}' }) : route.continue());
    await manager.page.getByRole('button', { name: 'Показать более ранние события', exact: true }).click();
    await manager.page.getByTestId('activity-history-error').waitFor(); await waitIds(manager.page, retained);
    const duringReadFailure = await seed(target.page, candidate, room, 1); ids.push(...duringReadFailure);
    await waitIds(manager.page, [...retained, ...duringReadFailure]);
    await manager.page.unroute(historyEndpoint);
    await manager.page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await manager.page.getByTestId('activity-history-error').waitFor({ state: 'hidden' });
    await loadAll(manager.page); await waitIds(manager.page, ids);
    await manager.page.getByRole('tab', { name: 'Чат', exact: true }).click();
    await manager.page.getByRole('tab', { name: 'Логи', exact: true }).click();
    await waitIds(manager.page, ids);
    await manager.page.evaluate(() => {
      window.__dropActivity = true;
      window.__replayActivityState({ ...window.__activityState, candidateKeyHistory: [], lastCandidateKey: null });
    });
    await waitIds(manager.page, ids);
    let seeded, received, releasePage;
    const seedComplete = new Promise(resolve => { seeded = resolve; });
    const responseReceived = new Promise(resolve => { received = resolve; });
    const pageReleased = new Promise(resolve => { releasePage = resolve; });
    let intercepted = false;
    await manager.page.route(historyEndpoint, async route => {
      if (intercepted || !new URL(route.request().url()).searchParams.has('afterSequence')) return route.continue();
      intercepted = true; await seedComplete;
      const response = await route.fetch(); received(); await pageReleased;
      try { await route.fulfill({ response }); } catch {}
    });
    const missed = await seed(target.page, candidate, room, 201); seeded();
    await responseReceived;
    await manager.page.evaluate(() => { window.__dropActivity = false; });
    const liveAhead = await seed(target.page, candidate, room, 1); missed.push(...liveAhead);
    releasePage();
    await waitIds(manager.page, [...ids, ...missed]);
    await manager.page.unroute(historyEndpoint);
    await manager.page.reload(); await manager.page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
    await openLogs(manager.page);
    await manager.page.getByRole('button', { name: 'Показать более ранние события', exact: true }).waitFor();
    await loadAll(manager.page); await waitIds(manager.page, [...ids, ...missed]);
    const raw = await request(`/rooms/${room.inviteCode}/keystroke-events`, { token: owner.token });
    assert.ok([...ids, ...missed].every(id => raw.some(e => e.sourceEventId === id)));
    const csv = await fetch(`${api}/rooms/${room.inviteCode}/keystroke-events?format=csv`, { headers: { Authorization: `Bearer ${owner.token}` } });
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    assert.ok([...ids, ...missed].every(id => csvText.includes(id)), 'CSV includes the complete interview');
    await request(`/rooms/${room.inviteCode}/activity-history`, { token: candidate.token, status: 403 });
  } finally { await browser.close(); }
});

for (const failure of ['three-server-errors', 'hung-request', 'rate-limit']) {
  test(`activity FIFO automatically recovers from ${failure} without losing source actions`, { timeout: 60000 }, async () => {
    const browser = await chromium.launch(); let release = () => {};
    try {
      const { owner, candidate, room } = await fixture();
      const target = await open(browser, candidate, room);
      const manager = await open(browser, owner, room); await openLogs(manager.page);
      const attempts = []; const delivered = [];
      let arrived;
      const first = new Promise(resolve => { arrived = resolve; });
      const held = new Promise(resolve => { release = resolve; });
      await target.page.route(`**/api/realtime/rooms/${room.inviteCode}/events`, async route => {
        const body = route.request().postDataJSON();
        if (body.type !== 'key_press' || !['a', 'b'].includes(body.key)) return route.continue();
        attempts.push({ id: body.sourceEventId, key: body.key, at: Date.now() }); arrived();
        if (body.key === 'a') {
          const count = attempts.filter(a => a.key === 'a').length;
          if (failure === 'three-server-errors' && count <= 3) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"raw-server-secret"}' });
          if (failure === 'rate-limit' && count === 1) return route.fulfill({ status: 429, body: '{}' });
          if (failure === 'hung-request' && count === 1) { await held; try { await route.abort(); } catch {} return; }
        }
        delivered.push(body.sourceEventId); await route.continue();
      });
      await target.page.locator('[data-testid="room-code-editor-host"] .cm-content').click();
      await target.page.keyboard.type('ab'); await first;
      await target.page.getByText(/Запись активности задерживается/).waitFor();
      if (failure === 'three-server-errors') {
        const connections = await target.page.evaluate(() => window.__activityConnections);
        await target.page.evaluate(() => window.__activitySource.onerror(new Event('error')));
        await target.page.waitForFunction(previous => window.__activityConnections > previous && window.__activitySource.readyState === 1, connections);
        await manager.page.waitForFunction(() => document.querySelector('[data-testid="room-code-editor-host"] .cm-content')?.textContent.includes('ab'));
      }
      const recoveryDeadline = Date.now() + 23000;
      let recovered = false;
      while (Date.now() < recoveryDeadline) {
        const events = await request(`/rooms/${room.inviteCode}/keystroke-events`, { token: owner.token });
        if (events.some(e => e.keyValue === 'a') && events.some(e => e.keyValue === 'b')) { recovered = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(recovered, true, `FIFO recovery missing; attempts=${JSON.stringify(attempts)}`);
      release();
      const a = attempts.filter(e => e.key === 'a'), b = attempts.filter(e => e.key === 'b');
      assert.equal(a.length, failure === 'three-server-errors' ? 4 : 2);
      assert.equal(new Set(a.map(e => e.id)).size, 1);
      assert.equal(b.length, 1);
      assert.deepEqual(delivered, [a[0].id, b[0].id]);
      assert.ok(a[1].at - a[0].at >= (failure === 'hung-request' ? 10000 : 900));
      if (failure === 'three-server-errors') {
        assert.ok(a[2].at - a[1].at >= 1900);
        assert.ok(a[3].at - a[2].at >= 3900);
      }
      await waitIds(manager.page, delivered);
      await target.page.getByText(/Запись активности задерживается/).waitFor({ state: 'hidden' });
      assert.equal(await target.page.getByText('raw-server-secret', { exact: false }).count(), 0);
      const raw = await request(`/rooms/${room.inviteCode}/keystroke-events`, { token: owner.token });
      for (const id of delivered) assert.equal(raw.filter(e => e.sourceEventId === id).length, 1);
    } finally { release(); await browser.close(); }
  });
}

test('activity history read failure preserves existing rows and revocation discards delayed private response', { timeout: 60000 }, async () => {
  const browser = await chromium.launch(); let release = () => {};
  try {
    const { owner, candidate, room } = await fixture();
    const interviewer = await account('Проверяющий истории');
    await request(`/rooms/${room.inviteCode}/participants/${interviewer.user.id}/role`, { token: owner.token, method: 'POST', body: { role: 'interviewer' } });
    const target = await open(browser, candidate, room);
    const ids = await seed(target.page, candidate, room, 55);
    const manager = await open(browser, interviewer, room); await openLogs(manager.page); await waitIds(manager.page, ids);
    const endpoint = `**/api/rooms/${room.inviteCode}/activity-history*`;
    await manager.page.route(endpoint, route => route.fulfill({ status: 503, body: '{}' }));
    await manager.page.getByTestId('activity-history-error').waitFor(); await waitIds(manager.page, ids);
    await manager.page.unroute(endpoint);
    let arrived, responseSettled;
    const pending = new Promise(resolve => { arrived = resolve; }); const held = new Promise(resolve => { release = resolve; });
    const settled = new Promise(resolve => { responseSettled = resolve; });
    await manager.page.route(endpoint, async route => {
      const response = await route.fetch(); arrived(); await held;
      try { await route.fulfill({ response }); } catch {} finally { responseSettled(); }
    });
    await manager.page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click(); await pending;
    await request(`/rooms/${room.inviteCode}/participants/${interviewer.user.id}/role`, { token: owner.token, method: 'POST', body: { role: 'candidate' } });
    await manager.page.waitForFunction(() => document.querySelectorAll('[data-testid="activity-timeline-source-id"]').length === 0);
    release(); await settled;
    await manager.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await request(`/rooms/${room.inviteCode}/activity-history`, { token: interviewer.token, status: 403 });
    assert.equal(await manager.page.getByTestId('activity-timeline-source-id').count(), 0);
  } finally { release(); await browser.close(); }
});

test('a rejected activity with an unfinished error body does not block later actions', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  try {
    const { owner, candidate, room } = await fixture();
    const target = await open(browser, candidate, room);
    await target.page.evaluate(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        if (String(input).includes('/realtime/rooms/') && body?.type === 'key_press' && body.key === 'a') {
          return Promise.resolve(new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode('{"error":"raw-server-secret"'));
          } }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
        }
        return original(input, init);
      };
    });
    await target.page.locator('[data-testid="room-code-editor-host"] .cm-content').click();
    await target.page.keyboard.type('ab');
    const deadline = Date.now() + 3000;
    let laterActionRecorded = false;
    while (Date.now() < deadline) {
      const events = await request(`/rooms/${room.inviteCode}/keystroke-events`, { token: owner.token });
      if (events.some(e => e.keyValue === 'b')) { laterActionRecorded = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(laterActionRecorded, true, 'An unfinished HTTP error body must not block the next source action');
    assert.equal(await target.page.getByText('raw-server-secret', { exact: false }).count(), 0);
  } finally { await browser.close(); }
});

// These two UI contract cases control only valid history API responses. The
// six end-to-end cases above separately prove real persistence and transport.
test('history UI contract distinguishes pending and empty, times out reads, and retries without losing rows', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  let releaseInitial = () => {}, releaseHung = () => {};
  try {
    const { owner, room } = await fixture();
    const manager = await open(browser, owner, room);
    const events = Array.from({ length: 3 }, (_, index) => ({
      sourceEventId: randomUUID(), acceptedSequence: index + 1,
      sessionId: 'history-ui-candidate', displayName: 'Кандидат истории',
      key: 'x', keyCode: 'KeyX', ctrlKey: false, altKey: false,
      shiftKey: false, metaKey: false, timestampEpochMs: 1000 + index,
    }));
    const calls = [];
    const initialHeld = new Promise(resolve => { releaseInitial = resolve; });
    const hungHeld = new Promise(resolve => { releaseHung = resolve; });
    let fourthDone;
    const automaticRetryFailed = new Promise(resolve => { fourthDone = resolve; });
    await manager.page.route(`**/api/rooms/${room.inviteCode}/activity-history*`, async route => {
      const call = { at: Date.now(), query: new URL(route.request().url()).searchParams };
      calls.push(call);
      const number = calls.length;
      if (number === 1) await initialHeld;
      if (number === 3) {
        await hungHeld;
        try { await route.abort(); } catch {}
        return;
      }
      if (number === 4) {
        await route.fulfill({ status: 503, body: '{"error":"raw-server-secret"}' });
        fourthDone();
        return;
      }
      const rows = number === 1 ? [] : number === 2 ? events.slice(0, 2) : events.slice(2);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        events: rows, hasMore: false, nextBeforeSequence: null, nextAfterSequence: null,
        throughSequence: number === 1 ? 0 : number === 2 ? 2 : 3,
      }) });
    });
    await openLogs(manager.page);
    await manager.page.getByTestId('activity-history-status').filter({ hasText: 'Загрузка истории…' }).waitFor();
    assert.equal(await manager.page.getByText('Активность не зафиксирована', { exact: true }).count(), 0,
      'Pending history must not claim confirmed empty');
    assert.equal(calls.length, 1, 'Only one latest read may run');
    releaseInitial();
    await manager.page.getByText('Активность не зафиксирована', { exact: true }).waitFor();
    await manager.page.getByTestId('activity-history-status').filter({ hasText: 'Вся история загружена' }).waitFor();
    await waitIds(manager.page, events.slice(0, 2).map(event => event.sourceEventId));
    assert.equal(calls[1].query.get('afterSequence'), '0');
    await manager.page.getByTestId('activity-history-status').filter({ hasText: 'Обновление истории…' }).waitFor();
    await manager.page.getByTestId('activity-history-error').waitFor({ timeout: 15000 });
    const timeoutObservedAt = Date.now();
    assert.equal(calls.length, 3, 'A stalled page must not overlap another history read');
    assert.ok(timeoutObservedAt - calls[2].at >= 9500 && timeoutObservedAt - calls[2].at < 13000,
      `History deadline must be approximately 10 seconds; observed ${timeoutObservedAt - calls[2].at} ms`);
    await waitIds(manager.page, events.slice(0, 2).map(event => event.sourceEventId));
    assert.equal(await manager.page.getByText('Активность не зафиксирована', { exact: true }).count(), 0);
    releaseHung();
    await automaticRetryFailed;
    assert.ok(calls[3].at - timeoutObservedAt >= 4500,
      'A failed read must retain the five-second polling cadence');
    await manager.page.getByTestId('activity-history-error').waitFor();
    assert.equal(await manager.page.getByText('raw-server-secret', { exact: false }).count(), 0);
    await manager.page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
    await waitIds(manager.page, events.map(event => event.sourceEventId));
    await manager.page.getByTestId('activity-history-error').waitFor({ state: 'hidden' });
    assert.equal(calls.length, 5, 'Explicit retry must send one page read');
    assert.equal(calls[4].query.get('afterSequence'), '2', 'Failures cannot advance the durable cursor');
  } finally { releaseInitial(); releaseHung(); await browser.close(); }
});

test('history UI contract recomputes one group across latest and older page boundaries', { timeout: 30000 }, async () => {
  const browser = await chromium.launch();
  let releaseOlder = () => {};
  try {
    const { owner, room } = await fixture();
    const manager = await open(browser, owner, room);
    const events = Array.from({ length: 401 }, (_, index) => ({
      sourceEventId: randomUUID(), acceptedSequence: index + 1,
      sessionId: 'paged-group-candidate', displayName: 'Кандидат границы',
      key: 'x', keyCode: 'KeyX', ctrlKey: false, altKey: false,
      shiftKey: false, metaKey: false, timestampEpochMs: 1000,
    }));
    const olderQueries = [];
    const firstOlderHeld = new Promise(resolve => { releaseOlder = resolve; });
    await manager.page.route(`**/api/rooms/${room.inviteCode}/activity-history*`, async route => {
      const query = new URL(route.request().url()).searchParams;
      const before = query.has('beforeSequence') ? Number(query.get('beforeSequence')) : null;
      let rows = events.slice(201), nextBeforeSequence = 202;
      if (before != null) {
        olderQueries.push({ before, through: query.get('throughSequence') });
        if (before === 202) { rows = events.slice(1, 201); nextBeforeSequence = 2; await firstOlderHeld; }
        else { rows = events.slice(0, 1); nextBeforeSequence = null; }
      } else if (query.has('afterSequence')) { rows = []; nextBeforeSequence = null; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        events: rows, hasMore: nextBeforeSequence != null, nextBeforeSequence,
        nextAfterSequence: null, throughSequence: 401,
      }) });
    });
    await openLogs(manager.page);
    await waitIds(manager.page, events.slice(201).map(event => event.sourceEventId));
    assert.equal(await manager.page.getByTestId('activity-timeline-entry').count(), 1);
    await manager.page.getByTestId('activity-history-status').filter({ hasText: 'Есть более ранние события' }).waitFor();
    const older = manager.page.getByRole('button', { name: 'Показать более ранние события', exact: true });
    await older.click();
    await manager.page.getByTestId('activity-history-status').filter({ hasText: 'Загрузка более ранних событий…' }).waitFor();
    assert.equal(await older.isDisabled(), true, 'Repeated clicks cannot overlap the older read');
    assert.equal(olderQueries.length, 1);
    releaseOlder();
    await waitIds(manager.page, events.slice(1).map(event => event.sourceEventId));
    assert.equal(await manager.page.getByTestId('activity-timeline-entry').count(), 1,
      'Events from both sides of a page boundary must be regrouped together');
    await loadAll(manager.page);
    await waitIds(manager.page, events.map(event => event.sourceEventId));
    assert.equal(await manager.page.getByTestId('activity-timeline-entry').count(), 1);
    const summary = await manager.page.getByTestId('activity-timeline-summary').innerText();
    assert.ok(summary.includes(`Набрано: «${'x'.repeat(401)}»`), 'Visible summary must include all 401 source actions');
    assert.deepEqual(olderQueries, [{ before: 202, through: '401' }, { before: 2, through: '401' }]);
    await manager.page.getByTestId('activity-history-status').filter({ hasText: 'Вся история загружена' }).waitFor();
    assert.equal(await older.count(), 0);
  } finally { releaseOlder(); await browser.close(); }
});
