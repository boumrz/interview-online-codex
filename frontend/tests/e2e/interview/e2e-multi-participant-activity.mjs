import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL || 'http://localhost:5173';
const api = process.env.E2E_API_URL || 'http://localhost:18080/api';
const rounds = 3, keysPerRound = 100;
const out = fileURLToPath(new URL(`../../../../output/playwright/multi-activity/${Date.now()}/`, import.meta.url));
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), web, api, participants: 10, candidates: 7, rounds: [], interactions: [], screenshots: [], phases: [], runtime: [], historyPages: [], viewports: [] };
const phase = name => { report.phases.push({ name, at: Date.now() }); console.log(name); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(label, check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(200); }
  throw new Error(`TIMEOUT: ${label}`);
}
async function request(path, { token, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const account = (name, isHr = false) => request('/auth/register', { method: 'POST', body: { nickname: `multi_${randomUUID().slice(0, 12)}`, displayName: name, isHr, password: 'test-password-123' } });
function csvRows(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if (c === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift().map(h => h.replace(/^\uFEFF/, ''));
  return rows.map(cells => Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
}
function equalIds(actual, expected, label) {
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate source identity`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label}: missing or unexpected source identities`);
}
const browser = await chromium.launch({ headless: true });
const tabBrowser = process.env.E2E_HEADED_CANDIDATE === '1' ? await chromium.launch({ headless: false }) : browser;
report.browserMode = tabBrowser === browser ? '10 headless contexts' : '9 headless contexts and 1 headed candidate context for real tab visibility';
report.limitations = [];
report.failures = [];
const views = [];
const pendingInspections = new Set();
let closing = false;
async function open(auth, room, label, candidate = false) {
  const context = await (label === 'candidate-1' ? tabBrowser : browser).newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const view = { context, label, auth, candidate, actions: new Map(), expectedFault: false, offline: false, documentGeneration: 0 };
  views.push(view);
  await context.addInitScript(({ token, name, candidate }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('display_name', name);
    const native = window.EventSource;
    window.__multi = { connections: 0, state: null, errors: [], privateLeaks: [], candidateKeys: 0, longTasks: [], tabEvents: [] };
    for (const name of ['focus', 'blur', 'visibilitychange']) window.addEventListener(name, () => window.__multi.tabEvents.push({ name, visibility: document.visibilityState, at: Date.now() }), true);
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__multi.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
    const forbidden = new Set(['candidateKeyHistory', 'lastCandidateKey', 'sourceEventId', 'acceptedSequence', 'pastePreview']);
    const inspect = (value, path = '$') => {
      if (Array.isArray(value)) { value.forEach((x, i) => inspect(x, `${path}[${i}]`)); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (forbidden.has(key)) window.__multi.privateLeaks.push(`${path}.${key}`);
        inspect(item, `${path}.${key}`);
      }
    };
    window.EventSource = class extends native {
      constructor(...args) { super(...args); window.__multi.source = this; window.__multi.connections++; }
      set onmessage(handler) { super.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (candidate) { inspect(message); if (message.type === 'candidate_key') window.__multi.privateLeaks.push('candidate_key'); }
          if (message.type === 'state_sync') window.__multi.state = message.payload;
          if (message.type === 'candidate_key') window.__multi.candidateKeys++;
        } catch (error) { window.__multi.errors.push(String(error)); }
        handler?.call(this, event);
      }; }
    };
    // A real second connection for the same session causes the server to close
    // the first transport; the app then reconnects using its normal handlers.
    window.__multi.reconnect = () => {
      const replacement = new native(window.__multi.source.url);
      replacement.onerror = () => replacement.close();
    };
  }, { token: auth.token, name: auth.user.displayName, candidate });
  const page = await context.newPage(); view.page = page; page.setDefaultTimeout(15000);
  const responseStatuses = new WeakMap();
  const requestGenerations = new WeakMap();
  const runtime = (kind, detail, eventType = null, responseStatus = null) => {
    const networkFailure = /ERR_(INTERNET_DISCONNECTED|ABORTED|NETWORK_CHANGED|FAILED)|Failed to fetch/.test(detail);
    const supersededMutation = kind === 'requestfailed' && /ERR_ABORTED/.test(detail) && ['yjs_update', 'code_update'].includes(eventType);
    const acceptedResponseCancellation = kind === 'requestfailed' && /ERR_ABORTED/.test(detail) && responseStatus >= 200 && responseStatus < 300;
    const discardedDocumentInspection = kind === 'history-body-unavailable-after-navigation';
    const expected = discardedDocumentInspection || acceptedResponseCancellation || supersededMutation || ((closing || view.expectedFault || view.offline) && ['requestfailed', 'console'].includes(kind) && networkFailure);
    report.runtime.push({ label, kind, detail, eventType, responseStatus, expected, classification: discardedDocumentInspection ? 'discarded-document-inspection' : acceptedResponseCancellation ? 'body-cancel-after-success-headers' : supersededMutation ? 'superseded-mutation-request' : expected ? 'injected-network-or-cleanup' : 'unexpected', at: Date.now() });
  };
  page.on('pageerror', error => runtime('pageerror', error.message));
  page.on('console', msg => { if (msg.type() === 'error') runtime('console', msg.text()); });
  page.on('requestfailed', req => runtime('requestfailed', `${new URL(req.url()).pathname}: ${req.failure()?.errorText}`, req.method() === 'POST' && req.url().includes('/events') ? req.postDataJSON()?.type : null, responseStatuses.get(req) ?? null));
  page.on('request', req => {
    requestGenerations.set(req, view.documentGeneration);
    if (req.method() !== 'POST' || !req.url().includes(`/realtime/rooms/${room.inviteCode}/events`)) return;
    const body = req.postDataJSON();
    if (body?.type !== 'key_press') return;
    const action = view.actions.get(body.sourceEventId) || { sourceEventId: body.sourceEventId, key: body.key, kind: body.eventKind || 'keydown', sessionId: body.sessionId, attempts: 0, acknowledged: false };
    action.attempts++; view.actions.set(action.sourceEventId, action);
  });
  page.on('response', response => {
    const req = response.request(), path = new URL(req.url()).pathname;
    responseStatuses.set(req, response.status());
    if (req.method() === 'POST' && path.endsWith('/events')) {
      const body = req.postDataJSON();
      if (body?.type === 'key_press' && response.ok()) {
        const action = view.actions.get(body.sourceEventId); if (action) action.acknowledged = true;
      }
    }
    if (response.status() >= 400) runtime('http', `${response.status()} ${path}`);
    if (req.method() === 'GET' && path.endsWith('/activity-history') && response.ok()) {
      const task = response.json().then(body => {
        assert.ok(body.events.length <= 200, 'History page must remain bounded');
        report.historyPages.push({ label, count: body.events.length, through: body.throughSequence });
      }).catch(error => {
        // Chromium can discard an old document's response body during reload.
        // Only this exact inspector failure, proven to belong to an earlier
        // document, is expected; malformed JSON and current-page failures fail.
        const lostOldDocument = requestGenerations.get(req) < view.documentGeneration && error.message === 'response.json: Protocol error (Network.getResponseBody): No data found for resource with given identifier';
        runtime(lostOldDocument ? 'history-body-unavailable-after-navigation' : 'history-inspection', error.message);
      });
      pendingInspections.add(task); task.finally(() => pendingInspections.delete(task));
    }
    if (candidate && req.method() === 'GET' && path === `/api/rooms/${room.inviteCode}` && response.ok()) {
      const task = response.json().then(body => {
        const text = JSON.stringify(body);
        assert.ok(!/"(candidateKeyHistory|lastCandidateKey|sourceEventId|acceptedSequence)"/.test(text), 'Candidate HTTP room leaked history');
      }).catch(error => runtime('privacy-inspection', error.message));
      pendingInspections.add(task); task.finally(() => pendingInspections.delete(task));
    }
  });
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await page.waitForFunction(() => Boolean(window.__multi.state?.eventToken));
  return view;
}
async function logs(view) {
  const page = view.page;
  if (await page.getByRole('tab', { name: 'Team', exact: true }).count()) await page.getByRole('tab', { name: 'Team', exact: true }).click();
  else {
    const rail = page.getByTestId('room-rail-tools');
    if (await rail.getAttribute('aria-pressed') !== 'true') await rail.click();
  }
  await page.getByRole('tab', { name: 'Логи', exact: true }).click();
  await page.getByTestId('activity-history-status').waitFor();
}
async function hasIds(view, ids) {
  await view.page.waitForFunction(expected => {
    const actual = [...document.querySelectorAll('[data-testid="activity-timeline-source-id"]')].map(n => n.textContent);
    const set = new Set(actual); return set.size === actual.length && expected.every(id => set.has(id));
  }, ids, { timeout: 45000, polling: 250 });
}
async function loadAll(view) {
  for (let i = 0; i < 100; i++) {
    await view.page.waitForFunction(() => !document.querySelector('[data-testid="activity-history-status"]')?.textContent.includes('Загрузка истории…'));
    const older = view.page.getByRole('button', { name: 'Показать более ранние события', exact: true });
    if (!await older.count()) return;
    await older.click();
    await view.page.waitForFunction(() => ![...document.querySelectorAll('button')].some(b => b.textContent.includes('Показать более ранние события') && b.disabled));
  }
  throw new Error('History pagination did not exhaust');
}
async function measure(label, action) {
  const started = performance.now(); await action();
  report.interactions.push({ label, durationMs: Math.round(performance.now() - started) });
}
async function screenshot(view, name) {
  const path = `${out}/${name}.png`; await view.page.screenshot({ path, fullPage: true }); report.screenshots.push(path);
}
async function layout(view, name) {
  await logs(view);
  const metrics = await view.page.evaluate(() => {
    const selectors = ['[data-testid="activity-history-status"]', '[aria-label="Участники комнаты"]'];
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      controls: selectors.map(selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return { selector, x: r?.x, y: r?.y, width: r?.width, height: r?.height, right: r?.right, bottom: r?.bottom }; }) };
  });
  assert.ok(metrics.scrollWidth <= metrics.width + 2, `${name}: horizontal page overflow`);
  for (const control of metrics.controls) assert.ok(control.width > 0 && control.height > 0 && control.x >= 0 && control.right <= metrics.width + 2 && control.y >= 0 && control.bottom <= metrics.height, `${name}: clipped control ${JSON.stringify(control)}`);
  for (const format of ['JSON', 'CSV']) {
    const button = view.page.getByRole('button', { name: format, exact: true });
    assert.equal(await button.isVisible(), true); assert.equal(await button.isEnabled(), true);
  }
  const strip = view.page.getByLabel('Участники комнаты', { exact: true });
  assert.equal(await strip.locator('[data-testid^="participant-badge-"]').count(), 10);
  await strip.locator('[data-testid^="participant-badge-"]').last().scrollIntoViewIfNeeded();
  await screenshot(view, `${name}-participants-end`);
  await strip.evaluate(element => { element.scrollLeft = 0; });
  await screenshot(view, name); report.viewports.push({ name, ...metrics });
}
try {
  report.browser = browser.version(); phase('setup: ten authenticated room participants');
  const ownerAuth = await account('Владелец интервью'), interviewerAuth = await account('Интервьюер'), hrAuth = await account('HR специалист', true);
  const candidateAuth = await Promise.all(Array.from({ length: 7 }, (_, i) => account(`Кандидат ${i + 1}`)));
  const room = await request('/rooms', { token: ownerAuth.token, method: 'POST', body: { title: '10 участников · параллельная запись логов', taskIds: [] } }); report.room = room.inviteCode;
  await request(`/rooms/${room.inviteCode}/tasks`, { token: ownerAuth.token, method: 'POST', body: { customTasks: [{ title: 'Совместный ввод', description: 'Семь кандидатов печатают одновременно', starterCode: '// activity\n', language: 'nodejs' }] } });
  await request(`/rooms/${room.inviteCode}/participants/${interviewerAuth.user.id}/role`, { token: ownerAuth.token, method: 'POST', body: { role: 'interviewer' } });
  const owner = await open(ownerAuth, room, 'owner'), interviewer = await open(interviewerAuth, room, 'interviewer'), hr = await open(hrAuth, room, 'hr');
  await owner.page.locator('[data-testid^="participant-badge-"]').filter({ hasText: 'HR специалист' }).click();
  await owner.page.getByRole('menuitem', { name: 'Назначить HR', exact: true }).click();
  await hr.page.getByRole('button', { name: 'Кандидат и HR', exact: true }).waitFor();
  assert.equal((await request(`/rooms/${room.inviteCode}`, { token: hrAuth.token })).role, 'interviewer');
  const candidates = [];
  for (let i = 0; i < 7; i++) candidates.push(await open(candidateAuth[i], room, `candidate-${i + 1}`, true));
  const managers = [owner, interviewer, hr];
  await Promise.all(views.map(view => view.page.waitForFunction(() => window.__multi.state.participants.length === 10)));
  await Promise.all(managers.map(logs));
  const raw = () => request(`/rooms/${room.inviteCode}/keystroke-events`, { token: ownerAuth.token });
  const actions = () => views.flatMap(view => [...view.actions.values()]);
  const expectedIds = () => actions().map(action => action.sourceEventId);
  async function settle() {
    await eventually('all captured sources acknowledged and durable', async () => {
      if (actions().some(a => !a.acknowledged)) return false;
      const rows = await raw(), ids = new Set(rows.map(e => e.sourceEventId)); return expectedIds().every(id => ids.has(id));
    });
  }
  for (let round = 1; round <= rounds; round++) {
    phase(`typing round ${round}: seven simultaneous real keyboards`);
    let gapBefore = null;
    if (round === 2) {
      gapBefore = (await raw()).length;
      owner.offline = true; owner.expectedFault = true; await owner.context.setOffline(true);
      candidates[0].expectedFault = true;
      const before = await candidates[0].page.evaluate(() => window.__multi.connections);
      await candidates[0].page.evaluate(() => window.__multi.reconnect());
      report.candidateReconnectBefore = before;
    }
    const typing = Promise.all(candidates.map(async (view, i) => {
      const start = Date.now();
      await view.page.locator('[data-testid="room-code-editor-host"] .cm-content').focus();
      await view.page.keyboard.type(String(i + 1).repeat(keysPerRound), { delay: 15 });
      return { participant: view.label, start, end: Date.now(), keys: keysPerRound };
    }));
    if (round !== 2) await measure(`round-${round}-chat-logs`, async () => {
      await owner.page.getByRole('tab', { name: 'Чат', exact: true }).click();
      await owner.page.getByRole('tab', { name: 'Логи', exact: true }).click();
      await owner.page.getByTestId('activity-history-status').waitFor();
    });
    const intervals = await typing;
    assert.ok(Math.max(...intervals.map(i => i.start)) < Math.min(...intervals.map(i => i.end)), 'Seven typing intervals must overlap');
    report.rounds.push({ round, intervals });
    await settle();
    if (round === 2) {
      const gap = (await raw()).length - gapBefore; assert.ok(gap >= 201); report.managerAcceptedGap = gap;
      await owner.context.setOffline(false); owner.offline = false;
      await owner.page.waitForFunction(() => window.__multi.source.readyState === 1);
      await candidates[0].page.waitForFunction(before => window.__multi.connections > before && window.__multi.source.readyState === 1, report.candidateReconnectBefore);
    }
    await Promise.all(managers.map(view => hasIds(view, expectedIds())));
    phase(`round ${round} complete: ${actions().length} distinct activity sources visible`);
    if (round === 1) await screenshot(owner, 'owner-live-round-one');
    if (round === 2) {
      owner.expectedFault = false; candidates[0].expectedFault = false;
      candidates[0].expectedFault = true;
      await candidates[0].page.bringToFront();
      const tabBefore = await candidates[0].page.evaluate(() => window.__multi.tabEvents.length);
      const otherTab = await candidates[0].context.newPage(); await otherTab.goto('about:blank'); await otherTab.bringToFront();
      try {
        await candidates[0].page.waitForFunction(before => window.__multi.tabEvents.slice(before).some(e => e.name === 'visibilitychange' && e.visibility === 'hidden'), tabBefore, { timeout: 3000 });
      } catch { report.limitations.push('Browser did not expose hidden visibility after real tab activation; leave/return visibility coverage remains unverified.'); }
      await candidates[0].page.bringToFront();
      if (!report.limitations.length) await candidates[0].page.waitForFunction(before => window.__multi.tabEvents.slice(before).some(e => e.name === 'visibilitychange' && e.visibility === 'visible'), tabBefore);
      await otherTab.close();
      report.tabTransition = await candidates[0].page.evaluate(before => window.__multi.tabEvents.slice(before), tabBefore);
      candidates[0].expectedFault = false;
    }
  }
  phase('verification: exact source identities, candidate isolation and converged editor');
  await settle();
  const sourceRows = await raw(), sourceIds = sourceRows.map(row => row.sourceEventId);
  equalIds(sourceIds, expectedIds(), 'durable raw versus observed actions');
  assert.equal(new Set(sourceRows.map(row => row.acceptedSequence)).size, sourceRows.length);
  report.sources = views.map(view => ({ participant: view.label, all: view.actions.size, keyboard: [...view.actions.values()].filter(a => a.kind === 'keydown').length, retries: [...view.actions.values()].reduce((sum, a) => sum + a.attempts - 1, 0) }));
  for (let i = 0; i < candidates.length; i++) assert.equal([...candidates[i].actions.values()].filter(a => a.kind === 'keydown' && a.key === String(i + 1)).length, rounds * keysPerRound);
  report.totalSources = sourceRows.length;
  try { await eventually('all ten Yjs models converge with every typed digit', async () => {
    const values = await Promise.all(views.map(view => view.page.evaluate(() => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString())));
    report.editorModels = values.map((value, i) => ({ participant: views[i].label, available: typeof value === 'string', length: value?.length, digits: candidates.map((_, digit) => typeof value === 'string' ? value.split(String(digit + 1)).length - 1 : null), equalsOwner: value === values[0] }));
    return values.every(v => typeof v === 'string' && v === values[0]) && candidates.every((_, i) => values[0].split(String(i + 1)).length - 1 === rounds * keysPerRound);
  });
  } catch (error) { report.failures.push(error.message); report.editorConverged = false; }
  if (report.editorConverged !== false) report.editorConverged = true;
  const expectedEditorCode = report.editorConverged ? await owner.page.evaluate(() => document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView.state.doc.toString()) : null;
  const verifyReloadedEditor = async view => {
    if (expectedEditorCode === null) return;
    await view.page.waitForFunction(expected => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === expected, expectedEditorCode, { timeout: 45000 });
    (report.convergedAfterReload ??= []).push(view.label);
  };
  for (const candidate of candidates) {
    const state = await candidate.page.evaluate(() => ({ errors: window.__multi.errors, leaks: window.__multi.privateLeaks, connections: window.__multi.connections, tabEvents: window.__multi.tabEvents }));
    assert.deepEqual(state.errors, []); assert.deepEqual(state.leaks, []);
    assert.equal(await candidate.page.getByTestId('activity-timeline-entry').count(), 0);
    assert.equal(await candidate.page.getByRole('button', { name: 'JSON', exact: true }).count(), 0);
    report[`${candidate.label}-state`] = state;
    for (const path of ['activity-history', 'keystroke-events?format=json', 'keystroke-events?format=csv']) {
      const response = await fetch(`${api}/rooms/${room.inviteCode}/${path}`, { headers: { Authorization: `Bearer ${candidate.auth.token}` } });
      const body = await response.text(); assert.equal(response.status, 403); assert.ok(!sourceIds.some(id => body.includes(id)));
    }
  }
  phase('verification: manager reload, partial-history UI exports and older pages');
  await Promise.all(pendingInspections);
  owner.documentGeneration++; owner.expectedFault = true; await owner.page.reload({ waitUntil: 'domcontentloaded' });
  await owner.page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor(); await logs(owner);
  await owner.page.getByRole('button', { name: 'Показать более ранние события', exact: true }).waitFor(); owner.expectedFault = false;
  await verifyReloadedEditor(owner);
  for (const format of ['JSON', 'CSV']) {
    const downloadPromise = owner.page.waitForEvent('download');
    await owner.page.getByRole('button', { name: format, exact: true }).click();
    const download = await downloadPromise, path = `${out}/activity.${format.toLowerCase()}`; await download.saveAs(path);
    const text = await readFile(path, 'utf8'), rows = format === 'JSON' ? JSON.parse(text) : csvRows(text);
    equalIds(rows.map(row => row.sourceEventId ?? row.source_event_id), sourceIds, `${format} complete export from partial history`);
    const sequenceById = new Map(sourceRows.map(row => [row.sourceEventId, row.acceptedSequence]));
    for (const row of rows) assert.equal(Number(row.acceptedSequence ?? row.accepted_sequence), sequenceById.get(row.sourceEventId ?? row.source_event_id));
    assert.equal(new Set(rows.map(row => Number(row.acceptedSequence ?? row.accepted_sequence))).size, rows.length);
    for (let i = 1; i < rows.length; i++) {
      const earlier = rows[i - 1], later = rows[i];
      const timeA = Number(earlier.timestampEpochMs ?? earlier.timestamp_epoch_ms), timeB = Number(later.timestampEpochMs ?? later.timestamp_epoch_ms);
      const sequenceA = Number(earlier.acceptedSequence ?? earlier.accepted_sequence), sequenceB = Number(later.acceptedSequence ?? later.accepted_sequence);
      assert.ok(timeA < timeB || (timeA === timeB && sequenceA < sequenceB), `${format}: noncanonical export order`);
    }
  }
  await measure('load-all-older-pages', () => loadAll(owner));
  await hasIds(owner, sourceIds);
  equalIds(await owner.page.getByTestId('activity-timeline-source-id').allTextContents(), sourceIds, 'full rendered source projection');
  await measure('loaded-chat-logs', async () => {
    await owner.page.getByRole('tab', { name: 'Чат', exact: true }).click(); await logs(owner); await hasIds(owner, sourceIds);
  });
  await layout(owner, 'owner-desktop-complete');
  phase('verification: desktop exports/paging passed; narrow HR controls and download');
  await hr.page.setViewportSize({ width: 900, height: 900 });
  await Promise.all(pendingInspections);
  hr.documentGeneration++; hr.expectedFault = true; await hr.page.reload({ waitUntil: 'domcontentloaded' });
  await hr.page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await measure('narrow-hr-open-logs', () => logs(hr));
  await hr.page.getByRole('button', { name: 'Показать более ранние события', exact: true }).waitFor(); hr.expectedFault = false;
  await verifyReloadedEditor(hr);
  const narrowDownloadPending = hr.page.waitForEvent('download'); await hr.page.getByRole('button', { name: 'JSON', exact: true }).click();
  const narrowDownload = await narrowDownloadPending; await narrowDownload.saveAs(`${out}/hr-narrow-activity.json`);
  equalIds(JSON.parse(await readFile(`${out}/hr-narrow-activity.json`, 'utf8')).map(row => row.sourceEventId), sourceIds, 'narrow HR complete export');
  await loadAll(hr); await layout(hr, 'hr-narrow-complete');
  await hasIds(hr, sourceIds); await screenshot(candidates[0], 'candidate-no-private-logs');
  phase('verification: activity, exports, privacy and both layouts completed');
  await Promise.all(pendingInspections);
  report.performance = await Promise.all(views.map(async view => ({ participant: view.label, ...await view.page.evaluate(() => ({ longTasks: window.__multi.longTasks.length, longestTaskMs: Math.max(0, ...window.__multi.longTasks) })) })));
  const unexpected = report.runtime.filter(item => !item.expected);
  report.unexpectedRuntimeCount = unexpected.length;
  if (unexpected.length) report.failures.push(`Unexpected runtime errors: ${unexpected.length}; inspect report.runtime`);
  assert.deepEqual(report.failures, [], 'Product verification failures');
  report.result = 'PASS'; phase('MULTI_PARTICIPANT_ACTIVITY_OK');
} catch (error) {
  report.result = 'FAIL'; report.error = error.stack || String(error); console.error(error); process.exitCode = 1;
  for (const view of views.filter(v => !v.candidate)) await screenshot(view, `failure-${view.label}`).catch(() => {});
} finally {
  report.observedTabEvents = await Promise.all(views.map(async view => ({ participant: view.label, ...await view.page.evaluate(() => ({ events: window.__multi?.tabEvents, parseErrors: window.__multi?.errors, privateLeaks: window.__multi?.privateLeaks })).catch(() => ({ unavailable: true })) })));
  closing = true; report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(`ARTIFACTS ${out}`);
  await Promise.all([...new Set([browser, tabBrowser])].map(instance => instance.close()));
}
