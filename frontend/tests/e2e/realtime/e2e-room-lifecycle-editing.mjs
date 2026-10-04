import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const api = process.env.E2E_API_URL ?? 'http://localhost:8080/api';
const web = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
// Optional diagnostics expose only this public regression fixture's text,
// sequence numbers and document identity. Credentials and raw request/SSE
// objects never enter the trace.
function lifecycleTrace(name, room) {
  if (process.env.E2E_LIFECYCLE_TRACE !== '1') return null;
  const rows = [];
  const add = (kind, value = {}) => rows.push({ at: Date.now(), kind, ...value });
  const projectEvent = payload => Object.fromEntries([
    'type', 'sessionId', 'clientEventSequence', 'yjsClientSequence',
    'baseServerYjsSequence', 'syncKey', 'code', 'language',
  ].filter(key => payload?.[key] !== undefined).map(key => [key, payload[key]]));
  return {
    add,
    async install(context, label) {
      await context.addInitScript(label => {
        const rows = window.__lifecycleTraceRows = [];
        const add = (kind, value) => rows.push({ at: Date.now(), kind, participant: label, ...value });
        const NativeEventSource = window.EventSource;
        window.EventSource = class extends NativeEventSource {
          set onmessage(handler) {
            super.onmessage = event => {
              try {
                const { type, payload = {} } = JSON.parse(event.data);
                if (['state_sync', 'yjs_update', 'verdict_set', 'error'].includes(type)) {
                  const safe = {};
                  for (const key of ['sessionId', 'lastYjsSequence', 'yjsSequence', 'currentStep', 'language', 'syncKey', 'status', 'role', 'canManageRoom', 'code', 'lastCodeUpdatedBySessionId', 'finishedAt', 'codeRevision']) {
                    if (payload[key] !== undefined) safe[key] = payload[key];
                  }
                  safe.yjsDocumentChars = typeof payload.yjsDocumentBase64 === 'string' ? payload.yjsDocumentBase64.length : 0;
                  safe.eventId = event.lastEventId || null;
                  add('sse', { type, ...safe });
                }
              } catch {}
              handler(event);
            };
          }
        };
        const identities = new WeakMap();
        let nextIdentity = 0, previous = '';
        window.setInterval(() => {
          const host = document.querySelector('[data-testid=room-code-editor-host]');
          const view = host?.__roomEditorView;
          if (view && !identities.has(view)) identities.set(view, ++nextIdentity);
          const state = {
            editorIdentity: view ? identities.get(view) : null,
            modelCode: view?.state.doc.toString() ?? null,
            domCode: host?.querySelector('.cm-content')?.textContent ?? null,
            editable: host?.querySelector('.cm-content')?.getAttribute('contenteditable') ?? null,
            modelReadOnly: view?.state.readOnly ?? null,
            language: document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent ?? null,
            lifecycle: document.querySelector('[data-testid=room-lifecycle-status]')?.textContent ?? null,
          };
          const serialized = JSON.stringify(state);
          if (serialized !== previous) { previous = serialized; add('editor', state); }
        }, 50);
      }, label);
    },
    attach(page, label) {
      page.on('request', req => {
        if (!req.url().endsWith('/events')) return;
        const payload = req.postDataJSON();
        add('post', { participant: label, ...projectEvent(payload), incremental: Boolean(payload?.yjsUpdate), yjsDocumentChars: payload?.yjsDocumentBase64?.length ?? 0 });
      });
      page.on('response', response => {
        if (!response.url().endsWith('/events')) return;
        add('response', { participant: label, status: response.status(), ...projectEvent(response.request().postDataJSON()) });
      });
      page.on('requestfailed', req => {
        if (!req.url().endsWith('/events')) return;
        add('post_failed', { participant: label, ...projectEvent(req.postDataJSON()), failure: req.failure()?.errorText });
      });
    },
    async dump(pages) {
      for (const page of pages.filter(Boolean)) {
        const browserRows = await page.evaluate(() => window.__lifecycleTraceRows ?? []).catch(() => []);
        rows.push(...browserRows);
      }
      rows.sort((a, b) => a.at - b.at);
      const directory = process.env.E2E_LIFECYCLE_TRACE_DIR ?? '/tmp/interhub-lifecycle-traces';
      mkdirSync(directory, { recursive: true });
      const path = join(directory, `${name}-${room.inviteCode}.json`);
      writeFileSync(path, `${JSON.stringify({ name, inviteCode: room.inviteCode, rows }, null, 2)}\n`);
      console.log(`lifecycle trace: ${path}`);
    },
  };
}
async function request(path, room, body) {
  const response = await fetch(`${api}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(room?.ownerToken ? { 'X-Room-Owner-Token': room.ownerToken } : {}), ...(room?.authToken ? { Authorization: `Bearer ${room.authToken}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `fixture ${path}: ${response.status}`); return response.json();
}
async function setup(browser, room, owner, trace = null) {
  const context = await browser.newContext();
  if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
  await context.addInitScript(({ room, owner }) => {
    if (owner && room.ownerToken) localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
    if (owner && room.authToken) {
      localStorage.setItem('auth_token', room.authToken);
      localStorage.setItem('auth_user', JSON.stringify(room.authUser));
    }
    localStorage.setItem(`guest_display_name_${room.inviteCode}`, owner ? 'Regression owner' : 'Regression candidate');
  }, { room, owner });
  await trace?.install(context, owner ? 'owner' : 'candidate');
  const page = await context.newPage(), events = [];
  trace?.attach(page, owner ? 'owner' : 'candidate');
  page.on('response', response => { if (response.url().endsWith('/events')) { const data = response.request().postDataJSON(); events.push({ type: data?.type, status: response.status() }); } });
  await page.goto(`${web}/room/${room.inviteCode}`);
  try { await page.getByTestId('room-code-editor-host').locator('.cm-content').waitFor(); } catch (error) {
    throw new Error(`Room did not hydrate: ${await page.locator('body').innerText()}\n${error.message}`);
  }
  return { page, events };
}
async function waitText(page, expected) {
  await page.waitForFunction(text => document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state.doc.toString() === text, expected, { timeout: 10000 });
}
async function chooseLanguage(page, label, parser) {
  await page.getByRole('combobox', { name: 'Язык комнаты', exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForFunction(({ label, parser }) => {
    if (!document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes(label)) return false;
    const state = document.querySelector('[data-testid="room-code-editor-host"]')?.__roomEditorView?.state;
    const languages = state ? Array.from(state.config.compartments.values()).filter(extension => extension?.language).map(extension => extension.language.name) : [];
    return parser ? languages.includes(parser) : languages.length === 0;
  }, { label, parser }, { timeout: 10000 });
}
const forbiddenMutations = new Set(['key_press', 'yjs_update', 'code_update', 'language_update', 'briefing_markdown_update', 'manager_workspace_open', 'manager_workspace_yjs_update', 'manager_workspace_language_update', 'manager_workspace_briefing_update', 'manager_workspace_focus_mode_update', 'set_step', 'next_step', 'task_rating_update']);
test('active room typing and language changes sync and persist for both participants', async () => {
  const room = await request('/public/rooms', null, { title: 'Regression active language', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  const browser = await chromium.launch();
  try {
    const owner = await setup(browser, room, true), candidate = await setup(browser, room, false);
    const code = `const saved = "language regression ${Date.now()}";`;
    await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(code); await waitText(candidate.page, code);
    for (const [label, parser] of [['Python', 'python'], ['Java', 'java'], ['Kotlin', 'java'], ['SQL', 'sql'], ['Plain text', null], ['Node JS', 'javascript']]) {
      await chooseLanguage(owner.page, label, parser); await waitText(owner.page, code); await waitText(candidate.page, code);
      await owner.page.waitForTimeout(300);
      assert.equal((await request(`/rooms/${room.inviteCode}`, room)).language, label === 'Node JS' ? 'nodejs' : label === 'Plain text' ? 'plaintext' : label.toLowerCase());
    }
    await owner.page.reload(); await waitText(owner.page, code); await candidate.page.reload(); await waitText(candidate.page, code);
    assert.deepEqual([...owner.events, ...candidate.events].filter(event => forbiddenMutations.has(event.type) && event.status >= 400), [], 'active mutations must be acknowledged');
  } finally { await browser.close(); }
});
for (const when of ['before entering', 'while connected']) test(`finished room managers keep editing and candidates only view: ${when}`, async () => {
  const room = await request('/public/rooms', null, { title: 'Finished role regression', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  const finish = () => request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE', verdictComment: 'Finished role regression' });
  const browser = await chromium.launch();
  try {
    if (when === 'before entering') await finish();
    const owner = await setup(browser, room, true), candidate = await setup(browser, room, false);
    if (when === 'while connected') {
      await owner.page.evaluate(() => { window.__lifecycleEditorView = document.querySelector('[data-testid=room-code-editor-host]').__roomEditorView; });
      await finish();
    }
    await owner.page.waitForFunction(() => document.querySelector('[data-testid=room-lifecycle-status], [data-testid=room-readonly-status]')?.textContent.includes('Интервью завершено'));
    assert.equal(await owner.page.getByRole('combobox', { name: 'Язык комнаты' }).isDisabled(), false, 'finished manager retains language editing');
    for (const { page } of [owner, candidate]) {
      await page.getByTestId('room-lifecycle-status').getByText('Интервью завершено', { exact: true }).waitFor({ timeout: 5000 });
    }
    assert.equal(await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'true');
    assert.equal(await owner.page.getByTestId('room-lifecycle-status').getByText('Только просмотр', { exact: true }).count(), 0);
    await candidate.page.getByTestId('room-lifecycle-status').getByText('Только просмотр', { exact: true }).waitFor();
    assert.equal(await candidate.page.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'false');
    const candidateLanguage = candidate.page.getByRole('combobox', { name: 'Язык комнаты' });
    assert.ok(await candidateLanguage.count() === 0 || await candidateLanguage.isDisabled());
    if (when === 'while connected') assert.equal(await owner.page.evaluate(() => window.__lifecycleEditorView === document.querySelector('[data-testid=room-code-editor-host]').__roomEditorView), true, 'finishing preserves the editor instance');
    const code = `const editedAfterFinish = ${Date.now()};`;
    await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(code); await waitText(candidate.page, code);
    await chooseLanguage(owner.page, 'Python', 'python');
    const finishedAt = (await request(`/rooms/${room.inviteCode}`, room)).finishedAt;
    await owner.page.reload(); await waitText(owner.page, code);
    await owner.page.waitForFunction(() => document.querySelector('#room-language-select')?.closest('.ant-select')?.textContent.includes('Python'));
    const persisted = await request(`/rooms/${room.inviteCode}`, room);
    assert.equal(persisted.status, 'finished'); assert.equal(persisted.finishedAt, finishedAt);
    candidate.events.length = 0;
    await candidate.page.getByTestId('room-code-editor-host').locator('.cm-content').click(); await candidate.page.keyboard.type('forbidden candidate input');
    await candidate.page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
    await waitText(candidate.page, code);
    await candidate.page.waitForTimeout(5500);
    assert.deepEqual(candidate.events.filter(event => forbiddenMutations.has(event.type)), [], 'finished viewer must not bootstrap, heartbeat or queue writes');
    assert.deepEqual(owner.events.filter(event => forbiddenMutations.has(event.type) && event.status >= 400), [], 'finished manager writes must be accepted');
  } finally { await browser.close(); }
});
test('finishing preserves manager queued document writes after an in-flight acknowledgement', async () => {
  const room = await request('/public/rooms', null, { title: 'Regression queued finish', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  const browser = await chromium.launch();
  const trace = lifecycleTrace('queued-finish', room);
  let owner, candidate;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    owner = await setup(browser, room, true, trace);
    candidate = await setup(browser, room, false, trace);
    const documentWrites = [];
    owner.page.on('request', req => {
      if (!req.url().endsWith('/events')) return;
      const payload = req.postDataJSON();
      if (payload?.type === 'yjs_update' && payload.yjsUpdate) documentWrites.push(payload);
    });
    let observeAcknowledgement;
    const acknowledgementHeld = new Promise(resolve => { observeAcknowledgement = resolve; });
    let gated = false;
    await owner.page.route('**/api/realtime/rooms/*/events', async route => {
      const event = route.request().postDataJSON();
      if (event?.type !== 'yjs_update' || !event.yjsUpdate || gated) return route.continue();
      gated = true;
      const response = await route.fetch();
      assert.ok(response.ok(), 'first manager update is accepted before finishing');
      trace?.add('first_ack_held', { status: response.status() });
      observeAcknowledgement();
      await gate;
      await route.fulfill({ response });
    });
    await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill('const acknowledged = 1;');
    await waitText(candidate.page, 'const acknowledged = 1;');
    await acknowledgementHeld;
    // This scenario tests delivery of existing queued editor transactions.
    // Native fill changes the DOM before CodeMirror's observer commits a model
    // transaction; a verdict snapshot must not race that fixture preparation.
    const pendingModel = await owner.page.evaluate(() => {
      const view = document.querySelector('[data-testid=room-code-editor-host]').__roomEditorView;
      for (let i = 0; i < 5; i++) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `const queued = ${i};` } });
      return view.state.doc.toString();
    });
    trace?.add('pending_model_before_finish', { code: pendingModel });
    assert.equal(pendingModel, 'const queued = 4;', 'final queued transaction exists before finishing');
    assert.equal(documentWrites.length, 1, 'manager edits remain queued while the first acknowledgement is held');
    await request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE' });
    trace?.add('verdict_committed');
    owner.events.length = 0;
    trace?.add('first_ack_released');
    release();
    await owner.page.getByTestId('room-lifecycle-status').getByText('Интервью завершено', { exact: true }).waitFor();
    await owner.page.waitForTimeout(5500);
    assert.equal(owner.events.filter(event => forbiddenMutations.has(event.type) && event.status >= 400).length, 0, 'queued manager edits must be accepted after finishing');
    assert.ok(owner.events.filter(event => event.type === 'yjs_update').length >= 2, 'accepted first response and pending manager edits both complete');
    assert.ok(documentWrites.some(payload => payload.yjsUpdate && payload.code === 'const queued = 4;'), 'final queued Yjs intent is dispatched after the acknowledgement');
    const persisted = await request(`/rooms/${room.inviteCode}`, room);
    trace?.add('persisted_after_finish', { code: persisted.code, language: persisted.language, status: persisted.status });
    assert.equal(persisted.code, 'const queued = 4;', 'finished manager retains the final queued solution');
    await waitText(candidate.page, 'const queued = 4;');
  } finally { release(); await trace?.dump([owner?.page, candidate?.page]); await browser.close(); }
});

test('server-reported frozen state disables writes and resume keeps the editor instance', async () => {
  const room = await request('/public/rooms', null, { title: 'Regression frozen hydration', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  const browser = await chromium.launch();
  const trace = lifecycleTrace('frozen-resume', room);
  let page;
  try {
    const context = await browser.newContext();
    if (process.env.E2E_ALLOW_DEV_WEBSOCKET !== '1') await context.routeWebSocket('**/ws', socket => socket.close());
    await context.addInitScript(room => {
      localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
      localStorage.setItem(`guest_display_name_${room.inviteCode}`, 'Regression owner');
      const NativeEventSource = window.EventSource;
      window.__frozenStatus = true;
      // Frontend hydration contract: real SSE, with only the lifecycle status
      // overridden. The actual server freeze/resume guards have integration tests.
      window.EventSource = class extends NativeEventSource {
        set onmessage(handler) {
          super.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.type === 'state_sync' && window.__frozenStatus) message.payload.status = 'frozen';
            handler(new MessageEvent('message', { data: JSON.stringify(message) }));
          };
        }
      };
    }, room);
    await trace?.install(context, 'owner');
    page = await context.newPage();
    const writes = [];
    trace?.attach(page, 'owner');
    page.on('request', req => { if (req.url().endsWith('/events') && forbiddenMutations.has(req.postDataJSON()?.type)) writes.push(req.postDataJSON().type); });
    await page.goto(`${web}/room/${room.inviteCode}`);
    await page.getByTestId('room-lifecycle-status').getByText('Изменения приостановлены', { exact: true }).waitFor();
    await page.getByTestId('room-code-editor-host').locator('.cm-content[contenteditable="false"]').waitFor();
    await page.evaluate(() => { window.__beforeResumeEditor = document.querySelector('[data-testid=room-code-editor-host]').__roomEditorView; });
    await page.waitForTimeout(3000);
    assert.deepEqual(writes, [], 'frozen hydration must not bootstrap or heartbeat mutations');
    await page.evaluate(() => { window.__frozenStatus = false; window.dispatchEvent(new Event('focus')); });
    await page.getByTestId('room-code-editor-host').locator('.cm-content[contenteditable="true"]').waitFor();
    assert.equal(await page.evaluate(() => window.__beforeResumeEditor === document.querySelector('[data-testid=room-code-editor-host]').__roomEditorView), true);
    trace?.add('resume_editable');
    await chooseLanguage(page, 'Python', 'python');
    trace?.add('python_parser_ready');
    await page.getByTestId('room-code-editor-host').locator('.cm-content').fill('resumed editor content');
    let persisted;
    for (let attempt = 0; attempt < 50; attempt++) {
      const state = await request(`/rooms/${room.inviteCode}`, room);
      persisted = state.code;
      trace?.add('persisted_resume_poll', { attempt, code: state.code, language: state.language, status: state.status });
      if (persisted === 'resumed editor content') break;
      await page.waitForTimeout(100);
    }
    assert.equal(persisted, 'resumed editor content');
  } finally { await trace?.dump([page]); await browser.close(); }
});

test('finishing stops pending candidate writes while retaining their accepted solution for managers', async () => {
  const room = await request('/public/rooms', null, { title: 'Pending candidate after finish', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  const browser = await chromium.launch();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const owner = await setup(browser, room, true), candidate = await setup(browser, room, false);
    let gated = false;
    await candidate.page.route('**/api/realtime/rooms/*/events', async route => {
      const event = route.request().postDataJSON();
      if (event?.type !== 'yjs_update' || !event.yjsUpdate || gated) return route.continue();
      gated = true;
      const response = await route.fetch();
      assert.ok(response.ok(), 'candidate update is accepted before finishing');
      await gate;
      await route.fulfill({ response });
    });
    const accepted = 'const acceptedCandidateSolution = 1;';
    await candidate.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(accepted);
    await waitText(owner.page, accepted);
    for (let i = 0; i < 4; i++) await candidate.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(`const unsentCandidateSolution = ${i};`);
    await request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE' });
    candidate.events.length = 0;
    release();
    await candidate.page.getByTestId('room-lifecycle-status').getByText('Только просмотр', { exact: true }).waitFor();
    assert.equal(await candidate.page.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'false');
    await waitText(candidate.page, accepted);
    const writes = [];
    candidate.page.on('request', req => {
      if (req.url().endsWith('/events') && forbiddenMutations.has(req.postDataJSON()?.type)) writes.push(req.postDataJSON().type);
    });
    await candidate.page.waitForTimeout(5500);
    assert.equal((await request(`/rooms/${room.inviteCode}`, room)).code, accepted, 'unaccepted candidate queue cannot change completed room');
    assert.equal(candidate.events.filter(event => forbiddenMutations.has(event.type)).length, 1, 'only the already accepted in-flight response completes');
    assert.deepEqual(writes, [], 'finished candidate cannot start new queued or heartbeat writes');
    await candidate.page.reload(); await waitText(candidate.page, accepted);
    const managerEdit = 'const managerAfterCandidateFinish = 2;';
    await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(managerEdit);
    await waitText(candidate.page, managerEdit);
  } finally { release(); await browser.close(); }
});

test('finished taskless owner can add the first task without inheriting its old editor document', async () => {
  const auth = await request('/auth/register', null, { nickname: `empty_finish_${crypto.randomUUID().slice(0, 10)}`, displayName: 'Regression owner', password: 'test-password-123' });
  const room = await request('/rooms', { authToken: auth.token }, { title: 'Finished empty context boundary', taskIds: [] });
  room.authToken = auth.token;
  room.authUser = auth.user;
  const browser = await chromium.launch();
  try {
    const owner = await setup(browser, room, true);
    assert.equal(await owner.page.getByTestId('room-viewer-role-badge').getAttribute('data-room-role'), 'owner', 'registered fixture enters as the authenticated owner');
    const previous = 'const tasklessSolution = 1;';
    const accepted = owner.page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'yjs_update' && response.request().postDataJSON()?.code === previous);
    await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(previous);
    assert.ok((await accepted).ok());
    await request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE' });
    await owner.page.getByTestId('room-lifecycle-status').getByText('Интервью завершено', { exact: true }).waitFor();
    const starter = '// First task after completion';
    await request(`/rooms/${room.inviteCode}/tasks`, room, { customTasks: [{ title: 'First added task', description: 'New document context', starterCode: starter, language: 'nodejs' }] });
    await waitText(owner.page, starter);
    const after = '// Edited first task after completion';
    const afterAccepted = owner.page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'yjs_update' && response.request().postDataJSON()?.code === after, { timeout: 10000 });
    void afterAccepted.catch(() => {});
    try {
      await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(after, { timeout: 5000 });
    } catch (error) {
      throw new Error(`New task editor cannot receive input: ${await owner.page.locator('body').innerText()}\n${error.message}`);
    }
    assert.ok((await afterAccepted).ok());
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await request(`/rooms/${room.inviteCode}`, room)).code === after) break;
      await owner.page.waitForTimeout(100);
    }
    await owner.page.reload(); await waitText(owner.page, after);
    assert.equal((await request(`/rooms/${room.inviteCode}`, room)).code, after);
    assert.deepEqual(owner.events.filter(event => forbiddenMutations.has(event.type) && event.status >= 400), [], 'new task remains writable with its fresh document context');
  } finally { await browser.close(); }
});

test('finished viewer navigation and focus do not write keyboard activity or revoke viewing access', async () => {
  const room = await request('/public/rooms', null, { title: 'Finished viewer activity boundary', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  await request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE' });
  const browser = await chromium.launch();
  try {
    const { page } = await setup(browser, room, false);
    await page.getByTestId('room-lifecycle-status').getByText('Только просмотр', { exact: true }).waitFor();
    const writes = [];
    page.on('request', req => {
      if (req.url().endsWith('/events') && forbiddenMutations.has(req.postDataJSON()?.type)) writes.push(req.postDataJSON().type);
    });
    await page.getByTestId('room-code-editor-host').locator('.cm-content').click();
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1200);
    assert.deepEqual(writes, [], 'viewing completed materials must not produce rejected activity writes');
    assert.equal(await page.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'false');
    assert.equal(await page.getByTestId('room-lifecycle-status').isVisible(), true, 'viewer retains their readable room');
  } finally { await browser.close(); }
});

test('a candidate activity request rejected after finishing retains their viewing connection', async () => {
  const room = await request('/public/rooms', null, { title: 'Pending finished activity', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  const browser = await chromium.launch();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const intercepted = new Promise(resolve => { entered = resolve; });
  try {
    const owner = await setup(browser, room, true);
    const { page } = await setup(browser, room, false);
    let held = false;
    await page.route('**/api/realtime/rooms/*/events', async route => {
      const event = route.request().postDataJSON();
      if (event?.type !== 'key_press' || held) return route.continue();
      held = true;
      entered();
      await gate;
      await route.continue();
    });
    await page.keyboard.press('ArrowDown'); await intercepted;
    await request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE' });
    await page.getByTestId('room-lifecycle-status').getByText('Только просмотр', { exact: true }).waitFor();
    const rejection = page.waitForResponse(response => response.url().endsWith('/events') && response.request().postDataJSON()?.type === 'key_press');
    release();
    assert.equal((await rejection).status(), 403, 'late candidate activity cannot write a finished room');
    const after = '// Managers can still update the finished viewer';
    await owner.page.getByTestId('room-code-editor-host').locator('.cm-content').fill(after);
    await waitText(page, after);
    assert.equal(await page.getByTestId('room-lifecycle-status').isVisible(), true);
    assert.equal(await page.getByTestId('room-code-editor-host').locator('.cm-content').getAttribute('contenteditable'), 'false');
    assert.equal(await page.getByTestId('room-explicit-connection-status').count(), 0, 'viewing stream stays connected');
  } finally { release(); await browser.close(); }
});


test('completed status remains highlighted and fully visible in both themes and desktop/tablet sizes', async () => {
  const room = await request('/public/rooms', null, { title: 'Completed status geometry', ownerDisplayName: 'Regression owner', language: 'nodejs' });
  await request(`/rooms/${room.inviteCode}/verdict`, room, { verdict: 'HIRE' });
  const browser = await chromium.launch();
  try {
    for (const owner of [true, false]) {
      const { page } = await setup(browser, room, owner);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { localStorage.setItem('interview-online:ui-theme', theme); window.dispatchEvent(new StorageEvent('storage', { key: 'interview-online:ui-theme', newValue: theme })); }, theme);
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        for (const [width, height] of [[1366, 768], [1024, 600], [768, 1024]]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
          const badge = page.getByTestId('room-lifecycle-status');
          await badge.waitFor();
          const geometry = await badge.getByText('Интервью завершено', { exact: true }).evaluate(element => {
            const badge = element.closest('[data-testid=room-lifecycle-status]');
            const box = element.getBoundingClientRect(), badgeBox = badge.getBoundingClientRect(), style = getComputedStyle(badge);
            const range = document.createRange(); range.selectNodeContents(element); const text = range.getBoundingClientRect();
            const tokens = document.createElement('span'); tokens.style.background = 'var(--app-info-bg)'; document.body.append(tokens); const expectedBackground = getComputedStyle(tokens).backgroundColor; tokens.remove();
            const atCenter = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return { font: parseFloat(style.fontSize), height: badgeBox.height, x: box.x, right: box.right, bottom: box.bottom, clipped: text.left < badgeBox.left || text.right > badgeBox.right, covered: !badge.contains(atCenter), background: style.backgroundColor, expectedBackground };
          });
          assert.ok(geometry.font >= 13 && geometry.height >= 28, JSON.stringify({ theme, width, height, geometry }));
          assert.ok(!geometry.clipped && !geometry.covered && geometry.x >= 0 && geometry.right <= width && geometry.bottom <= height, 'completed label must remain visible without clipping/overlap');
          assert.equal(geometry.background, geometry.expectedBackground, 'finished status uses the info theme surface');
          assert.equal(await badge.getByText('Только просмотр', { exact: true }).count(), owner ? 0 : 1);
        }
      }
      await page.context().close();
    }
  } finally { await browser.close(); }
});
