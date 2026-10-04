import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const web = process.env.E2E_BASE_URL || 'http://localhost:5173';
const api = process.env.E2E_API_URL || 'http://localhost:8080/api';
const output = new URL(`../../../../output/playwright/markdown-delivery/${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const report = { scenarios: [] };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  const raw = await response.text();
  return raw ? JSON.parse(raw) : null;
}
async function eventually(label, check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(100); }
  throw new Error(`TIMEOUT: ${label}`);
}
const browser = await chromium.launch({ headless: true });
async function fixture({ interviewer = false } = {}) {
  const auth = await request('/auth/register', { method: 'POST', body: { nickname: `md_${randomUUID().slice(0, 12)}`, displayName: 'Markdown owner', password: 'test-password-123' } });
  const room = await request('/rooms', { token: auth.token, method: 'POST', body: { title: 'Markdown delivery regression', taskIds: [] } });
  await request(`/rooms/${room.inviteCode}/tasks`, { token: auth.token, method: 'POST', body: { customTasks: [0, 1].map(index => ({ title: `Markdown task ${index}`, description: 'BASE\n', starterCode: '// base\n', language: 'nodejs' })) } });
  const viewer = interviewer ? await request('/auth/register', { method: 'POST', body: { nickname: `mdi_${randomUUID().slice(0, 12)}`, displayName: 'Markdown interviewer', password: 'test-password-123' } }) : auth;
  if (interviewer) await request(`/rooms/${room.inviteCode}/participants/${viewer.user.id}/role`, { token: auth.token, method: 'POST', body: { role: 'interviewer' } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ token, user, directApi }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('auth_user', JSON.stringify(user)); localStorage.setItem('display_name', user.displayName);
    const probe = window.__markdownDelivery = { attempts: [], syncs: 0, managerDeliveries: 0, gate: false, hang: false, aborted: false };
    const toUrl = input => {
      const parsed = new URL(input instanceof Request ? input.url : String(input), location.origin);
      return parsed.pathname.startsWith('/api/') && directApi ? directApi + parsed.pathname + parsed.search : input;
    };
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url, init) { super(toUrl(url), init); probe.source = this; }
      set onmessage(handler) { super.onmessage = event => { const message = JSON.parse(event.data); if (message.type === 'state_sync') { probe.syncs++; probe.latestState = message.payload; } const deliver = () => { if (message.type === 'manager_workspace_sync') probe.managerDeliveries++; handler?.call(this, event); }; if (message.type === 'manager_workspace_sync' && probe.delayManagerSync) window.setTimeout(deliver, 1200); else deliver(); }; }
    };
    const nativeFetch = window.fetch.bind(window);
    probe.release = () => { probe.gate = false; probe.releaseGate?.(); };
    window.fetch = async (input, init) => {
      let body; try { body = JSON.parse(init?.body); } catch {}
      if (!['briefing_markdown_update', 'manager_workspace_briefing_update'].includes(body?.type)) return nativeFetch(toUrl(input), init);
      const record = { type: body.type, text: body.briefingMarkdown, taskId: body.taskId, revision: body.revision, status: null, at: Date.now() }; probe.attempts.push(record);
      if (probe.gate || probe.hang) {
        await new Promise((resolve, reject) => {
          probe.releaseGate = resolve;
          init?.signal?.addEventListener('abort', () => { probe.aborted = true; record.aborted = true; reject(new DOMException('Injected stuck request aborted', 'AbortError')); }, { once: true });
        });
      }
      const response = await nativeFetch(toUrl(input), init); record.status = response.status; return response;
    };
  }, { token: viewer.token, user: viewer.user, directApi: process.env.E2E_BROWSER_API_ORIGIN || '' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().waitFor();
  await page.waitForFunction(() => window.__markdownDelivery.source?.readyState === 1 && window.__markdownDelivery.syncs > 0);
  await page.waitForFunction(() => {
    const editor = document.querySelector('[data-testid="room-markdown-editor"] .cm-content');
    const state = window.__markdownDelivery.latestState;
    return state?.canManageRoom && editor?.getAttribute('contenteditable') === 'true' &&
      editor.innerText.trimEnd() === (state.briefingMarkdown ?? '').trimEnd();
  });
  return { auth, viewer, room, context, page, errors };
}
async function text(page) {
  return page.locator('[data-testid="room-markdown-editor"] .cm-content').first().innerText();
}
async function typeAtEnd(page, value, delay = 10) {
  await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
  await page.keyboard.type(value, { delay });
}
async function scenario(name, run) {
  if (process.env.E2E_SCENARIO && process.env.E2E_SCENARIO !== name) return;
  const result = { name }; report.scenarios.push(result); const view = await fixture({ interviewer: name.includes('demotion') });
  try { await run(view, result); assert.deepEqual(view.errors, []); result.result = 'PASS'; console.log(`PASS ${name}`); }
  catch (error) { result.result = 'FAIL'; result.error = error.stack; console.error(`FAIL ${name}: ${error.message}`); }
  finally { result.attempts = await view.page.evaluate(() => window.__markdownDelivery.attempts); await view.context.close(); await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2)); }
}
try {
  await scenario('active-markdown-continuous-typing-saves-before-pause', async ({ page, room, auth }) => {
    await typeAtEnd(page, 'typing'.repeat(80), 8);
    const attempts = await page.evaluate(() => window.__markdownDelivery.attempts);
    assert.ok(attempts.some(attempt => attempt.text.includes('typing')), 'Continuous typing must be saved while the user is still typing');
    const expected = await text(page);
    await eventually('active Markdown persisted completely', async () => (await request(`/rooms/${room.inviteCode}`, { token: auth.token })).briefingMarkdown === expected);
    await page.reload();
    await eventually('active Markdown survives refresh', async () => await text(page) === expected);
  });
  await scenario('active-markdown-stuck-post-recovers-and-keeps-draft', async ({ page, room, auth }) => {
    await page.evaluate(() => { window.__markdownDelivery.hang = true; });
    await typeAtEnd(page, 'UNSAVED_MARKDOWN');
    await page.waitForFunction(() => window.__markdownDelivery.attempts.length > 0);
    await typeAtEnd(page, '_LATEST');
    const expected = await text(page);
    await eventually('stuck relay is cancelled by its request deadline', async () => page.evaluate(() => window.__markdownDelivery.aborted), 15000);
    assert.equal(await text(page), expected, 'Reconnect must retain the unacknowledged Markdown draft');
    await page.evaluate(() => { window.__markdownDelivery.hang = false; window.__markdownDelivery.release(); });
    await eventually('recovered active Markdown persisted', async () => (await request(`/rooms/${room.inviteCode}`, { token: auth.token })).briefingMarkdown === expected);
  });
  await scenario('active-markdown-undo-to-canonical-keeps-latest-draft-before-ack', async ({ page, room, auth }) => {
    const baseline = await text(page);
    await page.evaluate(() => { window.__markdownDelivery.gate = true; });
    await typeAtEnd(page, 'HELD_OLD_EDIT', 1);
    const previousDraft = await text(page);
    await page.waitForFunction(() => window.__markdownDelivery.attempts.length === 1);
    await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText(baseline);
    assert.equal(await text(page), baseline);
    // Release only the previous draft. Hold the following undo request so its
    // acknowledgement cannot hide an intermediate rollback from the old SSE.
    await page.evaluate(() => { window.__markdownDelivery.release(); window.__markdownDelivery.gate = true; });
    await page.waitForFunction(old => window.__markdownDelivery.latestState?.briefingMarkdown === old && window.__markdownDelivery.attempts.length === 2, previousDraft);
    assert.equal(await text(page), baseline, 'An older save acknowledgement must not replace the newer undo before its own acknowledgement');
    await page.evaluate(() => window.__markdownDelivery.release());
    await eventually('latest undo persists after old acknowledgement', async () => (await request(`/rooms/${room.inviteCode}`, { token: auth.token })).briefingMarkdown === baseline);
  });
  await scenario('manager-markdown-concurrent-revision-preserves-local-and-remote', async ({ page, context, room, auth }) => {
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.locator('[data-testid="room-step-row-1"]').click();
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().waitFor();
    await page.evaluate(() => { window.__markdownDelivery.gate = true; });
    await typeAtEnd(page, 'LOCAL_' + 'abc'.repeat(80), 2);
    await page.waitForFunction(() => window.__markdownDelivery.attempts.some(attempt => attempt.type === 'manager_workspace_briefing_update'));
    const before = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
    await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token, method: 'PUT', body: { briefingMarkdown: 'REMOTE\n' + before.briefingMarkdown, revision: before.revision } });
    await page.evaluate(() => window.__markdownDelivery.release());
    await eventually('both manager Markdown edits reach persistence', async () => {
      const state = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
      return state.briefingMarkdown.includes('REMOTE') && state.briefingMarkdown.includes('LOCAL_' + 'abc'.repeat(80));
    });
    const persisted = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
    assert.equal(await text(page), persisted.briefingMarkdown);
    assert.equal(persisted.briefingMarkdown.split('LOCAL_').length - 1, 1, 'Retry must not duplicate local input');
    await page.reload();
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await eventually('manager Markdown survives refresh', async () => await text(page) === persisted.briefingMarkdown);
  });
  await scenario('manager-markdown-early-conflict-late-snapshot-still-saves', async ({ page, room, auth }) => {
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.locator('[data-testid="room-step-row-1"]').click();
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().waitFor();
    await page.evaluate(() => { window.__markdownDelivery.gate = true; window.__markdownDelivery.delayManagerSync = true; });
    await typeAtEnd(page, 'LOCAL');
    // A different mutation queued behind the held Markdown CAS must keep its
    // original sequence even when the rejected Markdown intent is rebased.
    await page.getByRole('tab', { name: 'Мои заметки', exact: true }).click();
    const noteComposer = page.getByTestId('room-private-notes-input');
    await noteComposer.fill('NOTE_BEHIND_CONFLICT');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.waitForFunction(() => window.__markdownDelivery.attempts.some(attempt => attempt.type === 'manager_workspace_briefing_update'));
    const before = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
    await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token, method: 'PUT', body: { briefingMarkdown: 'REMOTE\n' + before.briefingMarkdown, revision: before.revision } });
    await page.evaluate(() => window.__markdownDelivery.release());
    await eventually('late canonical snapshot resumes rejected Markdown intent without more typing', async () => {
      const state = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
      return state.briefingMarkdown.includes('REMOTE') && state.briefingMarkdown.includes('LOCAL');
    });
    assert.ok(await page.evaluate(() => window.__markdownDelivery.attempts.some(attempt => attempt.status === 409)), 'The real server must reject the old revision before its delayed SSE snapshot arrives');
    // Private notes are read through their owner realtime payload, rather than
    // exposing them via the room REST response.
    await page.waitForFunction(() => window.__markdownDelivery.latestState?.personalNotes?.some(note => note.text === 'NOTE_BEHIND_CONFLICT'));
  });
  await scenario('active-markdown-publication-keeps-draft-in-original-task', async ({ page, room, auth }) => {
    const credentials = await page.evaluate(() => {
      const state = window.__markdownDelivery.latestState;
      return { sessionId: state.participants.find(participant => participant.role === 'owner').sessionId, eventToken: state.eventToken, taskId: state.tasks.find(task => task.stepIndex === state.currentStep)?.id };
    });
    assert.ok(credentials.taskId, 'This task-identity regression requires the freshly compiled API');
    await page.evaluate(() => { window.__markdownDelivery.gate = true; });
    await typeAtEnd(page, 'OLD_STEP_PENDING_' + 'xyz'.repeat(50), 3);
    await page.waitForFunction(() => window.__markdownDelivery.attempts.some(attempt => attempt.type === 'briefing_markdown_update'));
    await request(`/realtime/rooms/${room.inviteCode}/events`, { method: 'POST', body: { sessionId: credentials.sessionId, eventToken: credentials.eventToken, type: 'set_step', stepIndex: 1 } });
    await page.waitForFunction(() => window.__markdownDelivery.latestState?.currentStep === 1);
    await page.evaluate(() => window.__markdownDelivery.release());
    await eventually('original task retains its queued Markdown after publication', async () => (await request(`/rooms/${room.inviteCode}/tasks/0/workspace`, { token: auth.token })).briefingMarkdown.includes('OLD_STEP_PENDING_' + 'xyz'.repeat(50)));
    const current = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
    assert.equal(current.currentStep, 1);
    assert.ok(!current.briefingMarkdown.includes('OLD_STEP_PENDING_'), 'Newly published task must not receive the old task draft');
  });
  await scenario('manager-markdown-demotion-clears-pending-private-draft', async ({ page, room, auth, viewer }) => {
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.locator('[data-testid="room-step-row-1"]').click();
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().waitFor();
    await page.evaluate(() => { window.__markdownDelivery.gate = true; });
    await typeAtEnd(page, 'STALE_PRIVATE_DRAFT');
    await page.waitForFunction(() => window.__markdownDelivery.attempts.some(attempt => attempt.type === 'manager_workspace_briefing_update'));
    await request(`/rooms/${room.inviteCode}/participants/${viewer.user.id}/role`, { token: auth.token, method: 'POST', body: { role: 'candidate' } });
    await page.waitForFunction(() => window.__markdownDelivery.latestState?.role === 'candidate');
    await page.waitForFunction(() => window.__markdownDelivery.aborted);
    const before = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
    await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token, method: 'PUT', body: { briefingMarkdown: 'FRESH_AFTER_GRANT', revision: before.revision } });
    await page.evaluate(() => window.__markdownDelivery.release());
    await request(`/rooms/${room.inviteCode}/participants/${viewer.user.id}/role`, { token: auth.token, method: 'POST', body: { role: 'interviewer' } });
    await page.waitForFunction(() => window.__markdownDelivery.latestState?.role === 'interviewer');
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.locator('[data-testid="room-step-row-1"]').click();
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await eventually('new grant hydrates fresh workspace without old draft', async () => await text(page) === 'FRESH_AFTER_GRANT');
    await pause(400);
    const saved = await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token });
    assert.equal(saved.briefingMarkdown, 'FRESH_AFTER_GRANT', 'Demotion must discard old private writes before a later new grant');
  });
  await scenario('active-markdown-demotion-cancels-unsent-debounce', async ({ page, room, auth, viewer }) => {
    const before = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
    await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().focus();
    await page.keyboard.insertText('PUBLIC_TIMER_DRAFT');
    await request(`/rooms/${room.inviteCode}/participants/${viewer.user.id}/role`, { token: auth.token, method: 'POST', body: { role: 'candidate' } });
    await page.waitForFunction(() => window.__markdownDelivery.latestState?.role === 'candidate');
    await request(`/rooms/${room.inviteCode}/participants/${viewer.user.id}/role`, { token: auth.token, method: 'POST', body: { role: 'interviewer' } });
    await page.waitForFunction(() => window.__markdownDelivery.latestState?.role === 'interviewer');
    await pause(1100);
    const after = await request(`/rooms/${room.inviteCode}`, { token: auth.token });
    assert.equal(after.briefingMarkdown, before.briefingMarkdown, 'A new grant must not resurrect a cancelled public Markdown debounce');
    assert.equal(await text(page), before.briefingMarkdown);
  });
  await scenario('manager-first-edit-before-private-snapshot-keeps-base-and-task', async ({ page, room, auth }) => {
    await page.getByRole('tab', { name: 'Шаги', exact: true }).click();
    await page.evaluate(() => { window.__markdownDelivery.delayManagerSync = true; });
    await page.locator('[data-testid="room-step-row-1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="room-current-local-step-context"]')?.getAttribute('data-step-index') === '1');
    if (await page.getByRole("button", { name: "Развернуть условие", exact: true }).count()) await page.getByRole("button", { name: "Развернуть условие", exact: true }).click();
    await page.locator('[data-testid="room-markdown-editor"] .cm-content').first().waitFor();
    assert.equal(await page.evaluate(() => window.__markdownDelivery.managerDeliveries), 0, 'Edit must precede its first private SSE snapshot');
    const baseline = await text(page);
    await typeAtEnd(page, 'FIRST_PRIVATE_EDIT', 1);
    await eventually('first private edit persists without duplicating its REST-hydrated base', async () => (await request(`/rooms/${room.inviteCode}/tasks/1/workspace`, { token: auth.token })).briefingMarkdown === baseline + 'FIRST_PRIVATE_EDIT');
    await eventually('first private SSE confirms the unchanged local text', async () => await text(page) === baseline + 'FIRST_PRIVATE_EDIT');
    assert.ok(await page.evaluate(() => window.__markdownDelivery.attempts.find(attempt => attempt.type === 'manager_workspace_briefing_update')?.taskId), 'First private edit must already have the task UUID from public state');
  });
  assert.ok(report.scenarios.length > 0);
  if (report.scenarios.some(result => result.result !== 'PASS')) process.exitCode = 1;
} finally { await browser.close(); console.log(`ARTIFACTS ${output.pathname}`); }
