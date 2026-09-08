import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL || 'http://localhost:5173';
const api = process.env.E2E_API_URL || 'http://localhost:18080/api';
const out = fileURLToPath(new URL(`../../../../output/yjs-delivery-fix/boundaries-${Date.now()}/`, import.meta.url));
await mkdir(out, { recursive: true });
const report = { checks: [], pageErrors: [] };
async function request(path, token, body) {
  const response = await fetch(api + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert.ok(response.ok, `${path}: ${response.status} ${text.slice(0, 100)}`);
  return text ? JSON.parse(text) : null;
}
const account = name => request('/auth/register', null, { nickname: `boundary_${randomUUID().slice(0, 10)}`, displayName: name, password: 'test-password-123' });
const browser = await chromium.launch({ headless: true });
const views = [];
async function open(auth, room) {
  const context = await browser.newContext();
  await context.addInitScript(({ token, name }) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('display_name', name);
    const originalFetch = window.fetch.bind(window), nativeSource = window.EventSource;
    window.__boundary = { state: null, held: null, armed: false };
    window.EventSource = class extends nativeSource {
      set onmessage(handler) { super.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'state_sync') window.__boundary.state = message.payload;
        handler?.call(this, event);
      }; }
    };
    window.fetch = async (input, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      if (window.__boundary.armed && body?.type === 'yjs_update' && body.yjsUpdate) {
        window.__boundary.armed = false;
        window.__boundary.held = { syncKey: body.syncKey, operationId: body.operationId };
        await new Promise((resolve, reject) => {
          const signal = init.signal;
          const aborted = () => reject(new DOMException('Connection interrupted', 'AbortError'));
          if (signal?.aborted) return aborted();
          signal?.addEventListener('abort', aborted, { once: true });
          window.__boundary.release = () => { signal?.removeEventListener('abort', aborted); resolve(); };
        });
      }
      return originalFetch(input, init);
    };
  }, { token: auth.token, name: auth.user.displayName });
  const page = await context.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await page.waitForFunction(() => Boolean(window.__boundary.state?.eventToken));
  const view = { context, page }; views.push(view); return view;
}
const model = page => page.evaluate(() => document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView.state.doc.toString());
async function type(view, text) {
  await view.page.locator('[data-testid="room-code-editor-host"] .cm-content').focus();
  await view.page.keyboard.type(text, { delay: 10 });
}
try {
  const owner = await account('Boundary owner'), candidateAuth = await account('Boundary candidate'), watcherAuth = await account('Boundary watcher');
  const room = await request('/rooms', owner.token, { title: 'Pending editor task boundary', taskIds: [] }); report.room = room.inviteCode;
  await request(`/rooms/${room.inviteCode}/tasks`, owner.token, { customTasks: [
    { title: 'First task', description: 'Old workspace', starterCode: '// FIRST_TASK\n', language: 'nodejs' },
    { title: 'Second task', description: 'New workspace', starterCode: '// SECOND_TASK\n', language: 'nodejs' },
  ] });
  const candidate = await open(candidateAuth, room), watcher = await open(watcherAuth, room);
  await candidate.page.evaluate(() => { window.__boundary.armed = true; });
  await type(candidate, 'xxxxxxxxxx');
  await candidate.page.waitForFunction(() => Boolean(window.__boundary.held));
  assert.equal((await model(candidate.page)).split('x').length - 1, 10);
  assert.equal((await model(watcher.page)).includes('x'), false);
  await candidate.context.setOffline(true);
  await request(`/rooms/${room.inviteCode}/next-step`, owner.token, {});
  await watcher.page.waitForFunction(() => window.__boundary.state.currentStep === 1);
  await candidate.context.setOffline(false);
  await candidate.page.waitForFunction(() => window.__boundary.state.currentStep === 1 && Boolean(window.__boundary.state.eventToken), null, { timeout: 20000 });
  await candidate.page.evaluate(() => window.__boundary.release());
  await candidate.page.waitForFunction(() => document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView.state.doc.toString() === '// SECOND_TASK\n');
  await type(candidate, 'zzzzzzzzzz');
  await watcher.page.waitForFunction(() => document.querySelector('[data-testid="room-code-editor-host"]').__roomEditorView.state.doc.toString().split('z').length - 1 === 10, null, { timeout: 20000 });
  const nextCode = await model(candidate.page);
  assert.equal(await model(watcher.page), nextCode);
  assert.equal(nextCode.includes('x'), false);
  assert.ok(nextCode.includes('// SECOND_TASK'));
  report.checks.push('Old queued task deltas cannot corrupt the replacement task or block subsequent editing');

  let rejected = 0;
  await candidate.page.route(/\/api\/realtime\/rooms\/[^/]+\/events$/, async route => {
    if (route.request().postDataJSON()?.type !== 'yjs_update') return route.continue();
    rejected++;
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Injected access rejection' }) });
  });
  await type(candidate, 'pending');
  await candidate.page.getByTestId('room-realtime-access-error').waitFor({ timeout: 20000 });
  await candidate.page.waitForTimeout(1000);
  assert.equal(rejected, 2, 'One recovery only; terminal rejection must stop queued delivery');
  assert.equal(await candidate.page.locator('[data-testid="room-code-editor-host"]').count(), 0);
  report.rejectedRequests = rejected;
  report.checks.push('Repeated 403 stops the pending Yjs queue and removes the editable workspace');
  assert.deepEqual(report.pageErrors, []);
  report.result = 'PASS'; console.log('YJS_QUEUE_BOUNDARIES_OK');
} catch (error) {
  report.result = 'FAIL'; report.error = error.stack; process.exitCode = 1; console.error(error);
  for (let i = 0; i < views.length; i++) await views[i].page.screenshot({ path: `${out}/failure-${i}.png` }).catch(() => {});
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(`ARTIFACTS ${out}`); await browser.close();
}
