import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as Y from 'yjs';

const web = process.env.E2E_BASE_URL || 'http://localhost:5173';
const api = process.env.E2E_API_URL || 'http://localhost:18080/api';
const out = fileURLToPath(new URL(`../../../../output/playwright/yjs-delivery/${Date.now()}/`, import.meta.url));
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), web, api, scenarios: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(label, check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(150); }
  throw new Error(`TIMEOUT: ${label}`);
}
async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return response.json();
}
const account = displayName => request('/auth/register', { method: 'POST', body: { nickname: `delivery_${randomUUID().slice(0, 12)}`, displayName, password: 'test-password-123' } });
const browser = await chromium.launch({ headless: true });

async function participant(auth, room, label) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(({ token, name }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('display_name', name);
    const probe = window.__delivery = { mode: null, gate: false, attempts: [], bootstrap: null, deltas: [], stateSyncs: 0, opens: 0, heartbeatTicks: 0, keys: [], errors: [], lostAccepted: false };
    window.addEventListener('keydown', event => { if (/^[AB]$/.test(event.key)) probe.keys.push(event.key); }, true);
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = (callback, milliseconds, ...args) => nativeInterval(milliseconds === 2500 ? (...values) => { probe.heartbeatTicks++; callback(...values); } : callback, milliseconds, ...args);
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(...args) { super(...args); probe.source = this; this.addEventListener('open', () => probe.opens++); }
      set onmessage(handler) { super.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'state_sync') { probe.stateSyncs++; probe.bootstrap ??= message.payload; }
          if (message.type === 'yjs_update' && message.payload?.yjsUpdate) probe.deltas.push(message.payload.yjsUpdate);
        } catch (error) { probe.errors.push(String(error)); }
        handler?.call(this, event);
      }; }
    };
    probe.interruptStream = () => {
      const replacement = new NativeEventSource(probe.source.url);
      replacement.onopen = () => replacement.close();
      replacement.onerror = () => replacement.close();
    };
    const nativeFetch = window.fetch.bind(window);
    let releaseGate;
    probe.arm = mode => { probe.mode = mode; probe.gate = mode === 'hold' || mode === 'hold-then-lose'; probe.firstIdentity = null; probe.lostIdentity = null; probe.lostAccepted = false; };
    probe.release = () => { probe.gate = false; releaseGate?.(); releaseGate = null; };
    window.fetch = async (input, init) => {
      let body;
      try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch {}
      if (body?.type !== 'yjs_update') return nativeFetch(input, init);
      const envelope = JSON.stringify({ ...body, eventToken: undefined, sessionId: undefined });
      const record = { envelope, delta: body.yjsUpdate, operationId: body.operationId, clientEventSequence: body.clientEventSequence, yjsClientSequence: body.yjsClientSequence, syncKey: body.syncKey, incremental: Boolean(body.yjsUpdate), at: Date.now(), aborted: false, status: null };
      probe.attempts.push(record);
      if (probe.mode && record.incremental && !probe.firstIdentity) probe.firstIdentity = { envelope: record.envelope, operationId: record.operationId, clientEventSequence: record.clientEventSequence, yjsClientSequence: record.yjsClientSequence, syncKey: record.syncKey };
      const abort = () => { record.aborted = true; };
      init?.signal?.addEventListener('abort', abort, { once: true });
      try {
        // Hold real requests before their network dispatch. Cancellation remains
        // observable and rejects exactly as fetch would; no update is fabricated.
        if (probe.gate && probe.firstIdentity) await new Promise((resolve, reject) => {
          const signal = init?.signal;
          const aborted = () => { signal?.removeEventListener('abort', aborted); reject(new DOMException('Test delivery gate aborted', 'AbortError')); };
          releaseGate = () => { signal?.removeEventListener('abort', aborted); resolve(); };
          if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
        });
        const response = await nativeFetch(input, init); record.status = response.status;
        if (((probe.mode === 'lose' && record.operationId === probe.firstIdentity?.operationId) ||
          (probe.mode === 'hold-then-lose' && record.incremental && record.operationId !== probe.firstIdentity?.operationId)) && !probe.lostAccepted && response.ok) {
          probe.lostIdentity = { envelope: record.envelope, operationId: record.operationId, clientEventSequence: record.clientEventSequence, yjsClientSequence: record.yjsClientSequence, syncKey: record.syncKey };
          // The actual server accepted this update; only its response is lost.
          probe.lostAccepted = true; record.responseLost = true; throw new TypeError('Injected accepted response loss');
        }
        return response;
      } finally { init?.signal?.removeEventListener('abort', abort); }
    };
  }, { token: auth.token, name: auth.user.displayName });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await page.waitForFunction(() => window.__delivery.bootstrap?.eventToken && window.__delivery.source.readyState === 1);
  return { context, page, label, errors };
}
async function type(view, character, count, delay = 10) {
  await view.page.locator('[data-testid="room-code-editor-host"] .cm-content').focus();
  await view.page.keyboard.type(character.repeat(count), { delay });
}
function reconstruct(bootstrap, deltas) {
  const doc = new Y.Doc();
  if (bootstrap.yjsDocumentBase64) Y.applyUpdate(doc, new Uint8Array(Buffer.from(bootstrap.yjsDocumentBase64, 'base64')));
  else {
    const initial = new Y.Doc(); initial.clientID = 1;
    initial.getText('room-code').insert(0, bootstrap.code || '');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(initial)); initial.destroy();
  }
  // Deliberately ignore every later state_sync/full snapshot. Receiving all
  // snapshots must not disguise a silently evicted causal incremental update.
  for (const delta of deltas) Y.applyUpdate(doc, new Uint8Array(Buffer.from(delta, 'base64')));
  const value = doc.getText('room-code').toString(); doc.destroy(); return value;
}
async function snapshots(views) {
  return Promise.all(views.map(async view => ({ label: view.label, ...await view.page.evaluate(() => ({ value: document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString(), probe: { bootstrap: window.__delivery.bootstrap, deltas: window.__delivery.deltas, attempts: window.__delivery.attempts, firstIdentity: window.__delivery.firstIdentity, keys: window.__delivery.keys, opens: window.__delivery.opens, stateSyncs: window.__delivery.stateSyncs, heartbeatTicks: window.__delivery.heartbeatTicks, errors: window.__delivery.errors, lostAccepted: window.__delivery.lostAccepted } })) })));
}
async function converge(views, result, aCount, bCount) {
  await eventually('every editor and independent SSE-only Y.Doc contain all typed characters', async () => {
    const state = await snapshots(views), independent = reconstruct(state[0].probe.bootstrap, state[0].probe.deltas);
    result.documents = state.map(({ label, value }) => ({ label, length: value?.length, aCount: value?.split('A').length - 1, bCount: value?.split('B').length - 1, equalsOwner: value === state[0].value }));
    result.independent = { length: independent.length, aCount: independent.split('A').length - 1, bCount: independent.split('B').length - 1, incrementalMessages: state[0].probe.deltas.length };
    return state.every(s => typeof s.value === 'string' && s.value === independent) && independent.split('A').length - 1 === aCount && independent.split('B').length - 1 === bCount;
  });
}
function assertRetry(probe) {
  assert.ok(probe.firstIdentity, 'Fault must target an actual incremental request');
  const attempts = probe.attempts.filter(a => a.operationId === probe.firstIdentity.operationId);
  assert.ok(attempts.length >= 2, 'Unacknowledged original mutation must be retried after recovery');
  for (const attempt of attempts) for (const key of ['envelope', 'operationId', 'clientEventSequence', 'yjsClientSequence', 'syncKey']) assert.equal(attempt[key], probe.firstIdentity[key], `Retry changed ${key}`);
  assert.ok(attempts.some(a => a.status >= 200 && a.status < 300), 'Retried mutation must have reached the server');
}
async function scenario(name, run) {
  if (process.env.E2E_SCENARIO && process.env.E2E_SCENARIO !== name) return;
  const result = { name, startedAt: new Date().toISOString() }; report.scenarios.push(result);
  const views = [];
  console.log(`SCENARIO ${name}`);
  try {
    const auth = await Promise.all(['Owner', 'Candidate A', 'Candidate B'].map(account));
    const room = await request('/rooms', { token: auth[0].token, method: 'POST', body: { title: `Yjs delivery: ${name}`, taskIds: [] } }); result.room = room.inviteCode;
    await request(`/rooms/${room.inviteCode}/tasks`, { token: auth[0].token, method: 'POST', body: { customTasks: [{ title: 'Shared typing', description: 'Delivery acceptance', starterCode: '// shared\n', language: 'nodejs' }] } });
    for (let i = 0; i < auth.length; i++) views.push(await participant(auth[i], room, ['owner', 'candidate-a', 'candidate-b'][i]));
    await Promise.all(views.map(v => v.page.waitForFunction(() => window.__delivery.bootstrap.participants.length >= 1 && window.__delivery.source.readyState === 1)));
    await run(views, result);
    for (const view of views) {
      assert.deepEqual(view.errors, [], `${view.label}: page exceptions`);
      assert.deepEqual(await view.page.evaluate(() => window.__delivery.errors), [], `${view.label}: stream parse errors`);
    }
    result.result = 'PASS'; console.log(`PASS ${name}`);
  } catch (error) {
    result.result = 'FAIL'; result.error = error.stack || String(error); console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    result.finishedAt = new Date().toISOString();
    result.probes = await snapshots(views).then(state => state.map(({ label, probe }) => {
      // Never serialize eventToken/session credentials from the SSE bootstrap.
      const { bootstrap, deltas, ...safe } = probe; return { label, ...safe, incrementalMessages: deltas.length };
    })).catch(error => ({ unavailable: error.message }));
    await Promise.all(views.map(v => v.context.close()));
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  }
}
try {
  await scenario('heartbeat-and-350-update-backlog', async (views, result) => {
    const a = views[1], b = views[2];
    const ticks = await a.page.evaluate(() => { window.__delivery.arm('hold'); return window.__delivery.heartbeatTicks; });
    const heldAt = Date.now();
    await Promise.all([type(a, 'A', 350, 10), type(b, 'B', 100, 20)]);
    await a.page.waitForFunction(before => window.__delivery.heartbeatTicks > before && window.__delivery.firstIdentity, ticks);
    result.heldMs = Date.now() - heldAt;
    const held = await a.page.evaluate(() => ({ keys: window.__delivery.keys, first: window.__delivery.firstIdentity, attempts: window.__delivery.attempts }));
    assert.equal(held.keys.filter(k => k === 'A').length, 350, 'Backlog must originate in 350 real keyboard edits');
    assert.ok(result.heldMs > 2500, 'Delivery must overlap the real 2.5-second heartbeat');
    result.firstIncrementAborted = held.attempts.find(a => a.operationId === held.first.operationId)?.aborted;
    await a.page.evaluate(() => window.__delivery.release());
    await converge(views, result, 350, 100);
    assert.equal(result.firstIncrementAborted, false, 'Heartbeat must not cancel the held incremental update');
  });
  await scenario('pending-edits-through-sse-recovery', async (views, result) => {
    const a = views[1], b = views[2];
    await a.page.evaluate(() => window.__delivery.arm('hold'));
    await type(a, 'A', 40);
    await a.page.waitForFunction(() => window.__delivery.firstIdentity);
    const before = await a.page.evaluate(() => window.__delivery.stateSyncs);
    // Chromium offline emulation alone may leave an established SSE stream
    // open. Supersede it at the real server, then deny new stream connections
    // during the gap, without fabricating any room state or relay messages.
    let streamRequests = 0;
    const streamPattern = /\/api\/realtime\/rooms\/[^/]+\/stream\?/;
    await a.context.route(streamPattern, route => ++streamRequests === 1 ? route.continue() : route.abort('internetdisconnected'));
    await a.page.evaluate(() => window.__delivery.interruptStream());
    await a.page.waitForFunction(() => window.__delivery.source.readyState !== 1);
    await type(b, 'B', 60);
    result.remoteEditsDuringGap = 60;
    await a.context.unroute(streamPattern);
    await a.page.waitForFunction(before => window.__delivery.stateSyncs > before && window.__delivery.source.readyState === 1, before, { timeout: 45000 });
    await a.page.evaluate(() => window.__delivery.release());
    await type(a, 'A', 10);
    await converge(views, result, 50, 60);
    assertRetry(await a.page.evaluate(() => window.__delivery));
  });
  await scenario('accepted-update-with-lost-response', async (views, result) => {
    const a = views[1], b = views[2];
    await a.page.evaluate(() => window.__delivery.arm('lose'));
    await type(a, 'A', 1);
    await a.page.waitForFunction(() => window.__delivery.lostAccepted);
    await Promise.all([type(a, 'A', 49), type(b, 'B', 50)]);
    await converge(views, result, 50, 50);
    await eventually('original accepted mutation retried with preserved identity', async () => {
      const probe = await a.page.evaluate(() => ({ firstIdentity: window.__delivery.firstIdentity, attempts: window.__delivery.attempts }));
      return probe.attempts.filter(a => a.operationId === probe.firstIdentity.operationId).length >= 2;
    });
    assertRetry(await a.page.evaluate(() => window.__delivery));
    result.acceptedResponseLost = true;
  });
  await scenario('accepted-merged-batch-with-lost-response', async (views, result) => {
    const a = views[1], b = views[2];
    await a.page.evaluate(() => window.__delivery.arm('hold-then-lose'));
    await type(a, 'A', 50);
    await a.page.waitForFunction(() => window.__delivery.firstIdentity);
    await a.page.evaluate(() => window.__delivery.release());
    await a.page.waitForFunction(() => window.__delivery.lostAccepted);
    await Promise.all([type(a, 'A', 10), type(b, 'B', 50)]);
    await converge(views, result, 60, 50);
    await eventually('accepted batch retried unchanged while later edits are queued', async () => {
      const probe = await a.page.evaluate(() => window.__delivery);
      return probe.attempts.filter(attempt => attempt.operationId === probe.lostIdentity.operationId).length >= 2;
    });
    const probe = await a.page.evaluate(() => window.__delivery);
    assertRetry({ ...probe, firstIdentity: probe.lostIdentity });
    const lostIndex = probe.attempts.findIndex(attempt => attempt.responseLost);
    const before = probe.attempts.slice(0, lostIndex).filter(attempt => attempt.incremental).map(attempt => attempt.delta);
    const beforeValue = reconstruct(probe.bootstrap, before);
    const afterValue = reconstruct(probe.bootstrap, [...before, probe.attempts[lostIndex].delta]);
    result.charactersInRetriedBatch = afterValue.split('A').length - beforeValue.split('A').length;
    assert.ok(result.charactersInRetriedBatch > 1, 'Lost response must belong to a delivery containing multiple actual keyboard edits');
    result.acceptedResponseLost = true;
  });
  assert.ok(report.scenarios.length > 0, 'E2E_SCENARIO must select an existing scenario');
  report.result = report.scenarios.every(s => s.result === 'PASS') ? 'PASS' : 'FAIL';
  if (report.result === 'FAIL') process.exitCode = 1;
  else console.log('YJS_DELIVERY_RELIABILITY_OK');
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(`ARTIFACTS ${out}`);
  await browser.close();
}
