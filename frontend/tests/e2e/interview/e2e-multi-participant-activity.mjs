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
  const view = { context, label, auth, candidate, actions: new Map(), expectedFault: false, offline: false, documentGeneration: 0, startup: true };
  views.push(view);
  let lifecycleObservationOrder = 0;
  const observedCloses = new Map();
  const rejectedActivity = [], resourceConsoles = [], httpFailures = [];
  await context.exposeBinding('__multiExplicitClose', ({ page, frame }, value) => {
    if (page !== view.page || frame !== page.mainFrame() || !value ||
        typeof value.documentId !== 'string' || typeof value.sourceId !== 'string' ||
        !/^app-source-\d+$/.test(value.sourceId)) return;
    const key = `${value.documentId}/${value.sourceId}`;
    if (!observedCloses.has(key)) observedCloses.set(key, {
      documentId: value.documentId, sourceId: value.sourceId, order: ++lifecycleObservationOrder,
    });
  });
  await context.addInitScript(({ token, name, candidate, userId, observeInjectedDuplicate }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('display_name', name);
    const native = window.EventSource;
    // Full URLs stay inside this document's memory. The inspector returns only
    // source IDs, paths and lifecycle timestamps, never auth/capability values.
    const sourceAudits = [], auditBySource = new WeakMap(), documentId = crypto.randomUUID();
    const rejectedAttempts = [];
    const relayObservations = { keyPressRequestsAfterInjection: 0, matchingRelayRequests: 0,
      matchingSessionRequests: 0, matchingOldTokenRequests: 0,
      matchingHydratedRetryRequests: 0, matchingRejectedResponses: 0 };
    let duplicateAdmission = null;
    window.__multi = { connections: 0, state: null, errors: [], privateLeaks: [], candidateKeys: 0, longTasks: [], tabEvents: [] };
    window.__multi.inspectExplicitStartupClose = (requestUrl, failedAt, observedCloses = [], failedOrder = null) => {
      const matches = sourceAudits.filter(audit => audit.url === requestUrl);
      if (matches.length !== 1) return { proven: false, matchingSources: matches.length };
      const source = matches[0];
      const replacement = sourceAudits.find(audit => audit !== source &&
        source.closedAt !== null && audit.createdAt >= source.closedAt &&
        audit.identityUrl === source.identityUrl);
      const observedClose = observedCloses.find(observation => observation.documentId === documentId &&
        observation.sourceId === source.id && Number.isSafeInteger(observation.order) && observation.order > 0);
      const observedBeforeFailure = Number.isSafeInteger(failedOrder) &&
        observedClose?.order < failedOrder;
      return {
        proven: source.closedAt !== null && (source.closedAt < failedAt ||
          (source.closedAt === failedAt && observedBeforeFailure)) &&
          source.readyStateAtClose === 0 && source.openedAt === null && source.errorAt === null &&
          replacement?.openedAt !== null && replacement?.openedAt !== undefined &&
          replacement.stateSyncAt !== null && replacement.errorAt === null,
        documentId, sourceId: source.id, path: source.path, createdAt: source.createdAt,
        explicitCloseAt: source.closedAt, readyStateAtClose: source.readyStateAtClose,
        openedAt: source.openedAt, errorAt: source.errorAt,
        closeObservationOrder: observedClose?.order ?? null, failureObservationOrder: failedOrder,
        replacement: replacement ? { sourceId: replacement.id, createdAt: replacement.createdAt,
          openedAt: replacement.openedAt, stateSyncAt: replacement.stateSyncAt, errorAt: replacement.errorAt } : null,
      };
    };
    window.__multi.inspectInjectedTokenRejection = query => {
      const matches = rejectedAttempts.filter(attempt => attempt.url === query.requestUrl &&
        attempt.sessionId === query.sessionId && attempt.token === query.eventToken &&
        attempt.sourceEventId === query.sourceEventId);
      const attempt = matches.length === 1 ? matches[0] : null;
      const admission = attempt?.admission ?? duplicateAdmission;
      const current = auditBySource.get(window.__multi.source);
      const elapsed = (later, earlier) => later !== null && later !== undefined &&
        earlier !== null && earlier !== undefined ? later - earlier : null;
      const diagnostic = {
        matchingAttempts: matches.length, observedRejectedAttempts: rejectedAttempts.length,
        duplicateObserved: admission !== null, relayObservations: { ...relayObservations },
        gates: {
          uniqueRejectedAttempt: matches.length === 1,
          sameParticipant: admission?.sameParticipant === true,
          duplicateOpened: admission?.openedAt !== null && admission?.openedAt !== undefined,
          duplicateErrored: admission?.errorAt !== null && admission?.errorAt !== undefined,
          duplicateStateObserved: admission?.admittedAt !== null && admission?.admittedAt !== undefined,
          duplicateRotatedToken: typeof admission?.newToken === 'string' && admission.newToken !== admission.oldToken,
          responseBodyRead: attempt?.bodyInspectionCompleted === true && attempt?.bodyUnreadable === false,
          exactStaleReason: attempt?.exactStaleReason === true,
          retryAccepted: attempt?.retryAcceptedAt !== null && attempt?.retryAcceptedAt !== undefined,
          retryRotatedToken: typeof attempt?.retryToken === 'string' && attempt.retryToken !== admission?.oldToken,
          retryTokenIsCurrent: typeof attempt?.retryToken === 'string' && window.__multi.state?.eventToken === attempt.retryToken,
          currentSourceOpened: current?.openedAt !== null && current?.openedAt !== undefined,
          currentSourceHydrated: current?.stateSyncAt !== null && current?.stateSyncAt !== undefined,
        },
        relativeTiming: {
          duplicateOpenAfterInjectionMs: elapsed(admission?.openedAt, admission?.injectedAt),
          duplicateErrorAfterInjectionMs: elapsed(admission?.errorAt, admission?.injectedAt),
          duplicateStateAfterInjectionMs: elapsed(admission?.admittedAt, admission?.injectedAt),
          rejectionAfterInjectionMs: elapsed(attempt?.rejectedAt, admission?.injectedAt),
          retryAfterRejectionMs: elapsed(attempt?.retryAcceptedAt, attempt?.rejectedAt),
        },
      };
      if (matches.length !== 1) return { proven: false, matchingAttempts: matches.length, diagnostic };
      return {
        proven: admission.sameParticipant && admission.admittedAt !== null &&
          admission.newToken !== admission.oldToken && attempt.exactStaleReason &&
          attempt.retryAcceptedAt !== null && attempt.retryToken !== admission.oldToken &&
          window.__multi.state?.eventToken === attempt.retryToken &&
          current?.openedAt !== null && current?.openedAt !== undefined && current.stateSyncAt !== null,
        documentId, auditId: attempt.id, duplicateAuditId: admission.id,
        injectedAt: admission.injectedAt, admittedAt: admission.admittedAt,
        rejectedAt: attempt.rejectedAt, exactStaleReason: attempt.exactStaleReason,
        retryAcceptedAt: attempt.retryAcceptedAt, hydratedSourceId: current?.id ?? null,
        diagnostic,
      };
    };
    const nativeFetch = window.fetch.bind(window);
    if (observeInjectedDuplicate) window.fetch = (input, init) => {
      let body = null;
      try { if (typeof init?.body === 'string') body = JSON.parse(init.body); } catch {}
      const url = typeof input === 'string' ? new URL(input, location.href).href : input?.url;
      const admission = duplicateAdmission;
      const oldAttempt = admission && body?.type === 'key_press' && url === admission.relayUrl &&
        body.sessionId === admission.sessionId && body.eventToken === admission.oldToken;
      const hydratedRetry = admission && body?.type === 'key_press' && url === admission.relayUrl &&
        body.sessionId === admission.sessionId && body.eventToken !== admission.oldToken &&
        body.eventToken === window.__multi.state?.eventToken;
      if (admission && body?.type === 'key_press') {
        relayObservations.keyPressRequestsAfterInjection++;
        if (url === admission.relayUrl) relayObservations.matchingRelayRequests++;
        if (body.sessionId === admission.sessionId) relayObservations.matchingSessionRequests++;
        if (oldAttempt) relayObservations.matchingOldTokenRequests++;
        if (hydratedRetry) relayObservations.matchingHydratedRetryRequests++;
      }
      return nativeFetch(input, init).then(response => {
        if (oldAttempt && response.status === 403) {
          relayObservations.matchingRejectedResponses++;
          const attempt = { id: `injected-relay-${rejectedAttempts.length + 1}`, admission, url,
            sessionId: body.sessionId, token: body.eventToken, sourceEventId: body.sourceEventId,
            rejectedAt: Date.now(), exactStaleReason: false, bodyInspectionCompleted: false,
            bodyUnreadable: false, retryAcceptedAt: null, retryToken: null };
          rejectedAttempts.push(attempt);
          // Observe a clone only; the application receives the original response
          // immediately and unreadable/other error bodies cannot prove this case.
          void response.clone().json().then(data => {
            attempt.bodyInspectionCompleted = true;
            attempt.exactStaleReason = data?.error === 'Недействительный eventToken для этой сессии';
          }).catch(() => { attempt.bodyInspectionCompleted = true; attempt.bodyUnreadable = true; });
        } else if (hydratedRetry && response.ok) {
          for (const attempt of rejectedAttempts.filter(attempt => attempt.admission === admission &&
            attempt.sourceEventId === body.sourceEventId)) {
            attempt.retryAcceptedAt = Date.now(); attempt.retryToken = body.eventToken;
          }
        }
        return response;
      });
    };
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
      constructor(...args) {
        super(...args); window.__multi.source = this; window.__multi.connections++;
        const identity = new URL(this.url); identity.searchParams.delete('displayNameEncoded');
        const audit = { id: `app-source-${window.__multi.connections}`, url: this.url,
          identityUrl: identity.href, path: identity.pathname, createdAt: Date.now(),
          closedAt: null, readyStateAtClose: null, openedAt: null, errorAt: null, stateSyncAt: null };
        sourceAudits.push(audit); auditBySource.set(this, audit);
        this.addEventListener('open', () => { audit.openedAt ??= Date.now(); });
        this.addEventListener('error', () => { audit.errorAt ??= Date.now(); });
        this.addEventListener('message', event => {
          try { if (JSON.parse(event.data).type === 'state_sync') audit.stateSyncAt ??= Date.now(); } catch {}
        });
      }
      close() {
        const audit = auditBySource.get(this);
        if (audit && audit.closedAt === null) {
          audit.closedAt = Date.now(); audit.readyStateAtClose = this.readyState;
          // Record an independent order without awaiting or delaying native close.
          // Only the exact document/source IDs cross the browser binding.
          try { window.__multiExplicitClose?.({ documentId, sourceId: audit.id })?.catch(() => {}); } catch {}
        }
        super.close();
      }
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
      const url = new URL(window.__multi.source.url), sessionId = url.searchParams.get('sessionId');
      const participant = window.__multi.state?.participants?.find(participant => participant.sessionId === sessionId);
      const admission = { id: 'injected-duplicate-1', sessionId, oldToken: window.__multi.state?.eventToken,
        userId, sameParticipant: participant?.userId === userId, injectedAt: Date.now(),
        openedAt: null, errorAt: null, admittedAt: null, newToken: null,
        relayUrl: `${url.origin}${url.pathname.replace(/\/stream$/, '/events')}` };
      duplicateAdmission = admission;
      const replacement = new native(url.href);
      replacement.addEventListener('open', () => { admission.openedAt ??= Date.now(); });
      replacement.addEventListener('error', () => { admission.errorAt ??= Date.now(); });
      replacement.addEventListener('message', event => {
        try {
          const message = JSON.parse(event.data), payload = message.payload;
          if (message.type !== 'state_sync' || !payload?.eventToken) return;
          const participant = payload.participants?.find(participant => participant.sessionId === admission.sessionId);
          if (participant?.userId !== admission.userId) { admission.sameParticipant = false; return; }
          admission.admittedAt ??= Date.now(); admission.newToken ??= payload.eventToken;
        } catch {}
      });
      replacement.onerror = () => replacement.close();
    };
  }, { token: auth.token, name: auth.user.displayName, candidate, userId: auth.user.id, observeInjectedDuplicate: label === 'candidate-1' });
  const page = await context.newPage(); view.page = page; page.setDefaultTimeout(15000);
  const responseStatuses = new WeakMap();
  const requestGenerations = new WeakMap();
  const startupRequests = new WeakSet();
  const runtime = (kind, detail, eventType = null, responseStatus = null, sourceLifecycle = null, at = Date.now(), injectedFault = closing || view.expectedFault || view.offline) => {
    const networkFailure = /ERR_(INTERNET_DISCONNECTED|ABORTED|NETWORK_CHANGED|FAILED)|Failed to fetch/.test(detail);
    const supersededMutation = kind === 'requestfailed' && /ERR_ABORTED/.test(detail) && ['yjs_update', 'code_update'].includes(eventType);
    const acceptedResponseCancellation = kind === 'requestfailed' && /ERR_ABORTED/.test(detail) && responseStatus >= 200 && responseStatus < 300;
    const discardedDocumentInspection = kind === 'history-body-unavailable-after-navigation';
    const explicitStartupClose = sourceLifecycle?.proven === true;
    const expected = discardedDocumentInspection || acceptedResponseCancellation || supersededMutation || explicitStartupClose || (injectedFault && ['requestfailed', 'console'].includes(kind) && networkFailure);
    const entry = { label, kind, detail, eventType, responseStatus, expected, observationOrder: ++lifecycleObservationOrder, classification: discardedDocumentInspection ? 'discarded-document-inspection' : acceptedResponseCancellation ? 'body-cancel-after-success-headers' : supersededMutation ? 'superseded-mutation-request' : explicitStartupClose ? 'explicit-startup-stream-close' : expected ? 'injected-network-or-cleanup' : 'unexpected', ...(sourceLifecycle ? { sourceLifecycle } : {}), at };
    report.runtime.push(entry); return entry;
  };
  page.on('pageerror', error => runtime('pageerror', error.message));
  page.on('console', msg => { if (msg.type() === 'error') resourceConsoles.push({
    entry: runtime('console', msg.text()), url: msg.location().url, generation: view.documentGeneration,
  }); });
  page.on('requestfailed', req => {
    const path = new URL(req.url()).pathname, failure = req.failure()?.errorText;
    const detail = `${path}: ${failure}`, status = responseStatuses.get(req) ?? null, failedAt = Date.now();
    const failedOrder = ++lifecycleObservationOrder;
    const injectedFaultAtFailure = closing || view.expectedFault || view.offline;
    const eventType = req.method() === 'POST' && path.endsWith('/events') ? req.postDataJSON()?.type : null;
    if (startupRequests.has(req) && view.documentGeneration === 0 && requestGenerations.get(req) === 0 &&
        req.method() === 'GET' && path === `/api/realtime/rooms/${room.inviteCode}/stream` &&
        failure === 'net::ERR_ABORTED' && status === null) {
      const task = (async () => {
        const query = { requestUrl: req.url(), failedAt, observedCloses: [...observedCloses.values()], failedOrder };
        // Correlate this exact request with an explicit close before its failure.
        // A replacement must actually open and hydrate; errors, unclosed sources,
        // ambiguous same-URL instances and arbitrary aborts remain unexpected.
        await page.waitForFunction(({ requestUrl, failedAt, observedCloses, failedOrder }) =>
          window.__multi?.inspectExplicitStartupClose(requestUrl, failedAt, observedCloses, failedOrder)?.proven === true,
        query, { timeout: 1500 }).catch(() => {});
        const lifecycle = await page.evaluate(({ requestUrl, failedAt, observedCloses, failedOrder }) =>
          window.__multi?.inspectExplicitStartupClose(requestUrl, failedAt, observedCloses, failedOrder) ?? null, query).catch(() => null);
        runtime('requestfailed', detail, eventType, status, lifecycle, failedAt, injectedFaultAtFailure);
      })();
      pendingInspections.add(task); task.finally(() => pendingInspections.delete(task));
    } else runtime('requestfailed', detail, eventType, status, null, failedAt);
  });
  page.on('request', req => {
    requestGenerations.set(req, view.documentGeneration);
    if (view.startup) startupRequests.add(req);
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
    if (response.status() >= 400) {
      const entry = runtime('http', `${response.status()} ${path}`);
      httpFailures.push({ entry, url: req.url(), generation: requestGenerations.get(req) });
      const body = req.method() === 'POST' && path.endsWith('/events') ? req.postDataJSON() : null;
      if (label === 'candidate-1' && response.status() === 403 && body?.type === 'key_press') {
        rejectedActivity.push({ entry, generation: requestGenerations.get(req), query: {
          requestUrl: req.url(), sessionId: body.sessionId, eventToken: body.eventToken, sourceEventId: body.sourceEventId,
        } });
      }
    }
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
  view.startup = false;
  view.confirmInjectedTokenRejections = async durableSourceIds => {
    for (const rejected of rejectedActivity) {
      const action = view.actions.get(rejected.query.sourceEventId);
      const nodeGates = {
        originalDocument: rejected.generation === 0 && view.documentGeneration === 0,
        sameSourceDurable: durableSourceIds.has(rejected.query.sourceEventId),
        sameSourceAcknowledged: action?.acknowledged === true,
        sameSourceRetried: action?.attempts >= 2,
      };
      rejected.entry.injectedRelayDiagnostic = { nodeGates, sourceAttemptCount: action?.attempts ?? 0 };
      if (rejected.generation !== 0 || view.documentGeneration !== 0 ||
          !durableSourceIds.has(rejected.query.sourceEventId)) continue;
      if (!action?.acknowledged || action.attempts < 2) continue;
      const proof = await page.evaluate(query => window.__multi.inspectInjectedTokenRejection(query), rejected.query);
      rejected.entry.injectedRelayDiagnostic.browser = proof?.diagnostic ?? null;
      if (!proof?.proven) continue;
      rejected.entry.expected = true; rejected.entry.classification = 'injected-stale-event-token';
      rejected.entry.injectedRelayProof = { ...proof, sameSourceDurable: true };
      const consoles = resourceConsoles.filter(console => console.generation === rejected.generation &&
        console.url === rejected.query.requestUrl &&
        console.entry.detail === 'Failed to load resource: the server responded with a status of 403 (Forbidden)' &&
        console.entry.observationOrder > rejected.entry.observationOrder &&
        console.entry.at >= rejected.entry.at && console.entry.at - rejected.entry.at <= 500);
      if (consoles.length !== 1) continue;
      const console = consoles[0];
      const preceding = httpFailures.filter(failure => failure.generation === console.generation && failure.url === console.url &&
        failure.entry.observationOrder < console.entry.observationOrder &&
        console.entry.at >= failure.entry.at && console.entry.at - failure.entry.at <= 500);
      if (preceding.length !== 1 || preceding[0].entry !== rejected.entry) continue;
      console.entry.expected = true; console.entry.classification = 'injected-stale-event-token';
      console.entry.injectedRelayProof = { documentId: proof.documentId, auditId: proof.auditId, pairedResponseOrder: rejected.entry.observationOrder };
    }
  };
  return view;
}
async function logs(view) {
  const page = view.page;
  await page.getByRole('tab', { name: 'Активность', exact: true }).click();
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
    const button = view.page.getByRole('button', { name: `Скачать логи в ${format}`, exact: true });
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
  const hrParticipant = owner.page.locator('[data-testid^="participant-badge-"]').filter({ hasText: 'HR специалист' });
  const participantHelp = owner.page.getByTestId('participants-help-hint');
  assert.equal(await participantHelp.isVisible(), true, 'participant action informer is visible');
  await participantHelp.hover();
  const guidance = owner.page.getByRole('tooltip').filter({ hasText: /нажмите на участника.*открыть доступные действия/i });
  await guidance.waitFor({ state: 'visible' });
  assert.match(await guidance.innerText(), /нажмите на участника.*открыть доступные действия/i);
  await participantHelp.focus();
  await owner.page.keyboard.press('Shift+Tab');
  await owner.page.mouse.move(0, 0);
  await guidance.waitFor({ state: 'hidden' });
  await owner.page.keyboard.press('Tab');
  assert.equal(await participantHelp.evaluate(element => document.activeElement === element), true, 'Tab focuses the participant action informer');
  await guidance.waitFor({ state: 'visible', timeout: 6000 });
  assert.equal(await guidance.isVisible(), true, 'guidance is also available from keyboard focus');
  await participantHelp.blur();
  await owner.page.mouse.move(0, 0);
  await guidance.waitFor({ state: 'hidden' });
  assert.equal(await hrParticipant.getAttribute('aria-haspopup'), 'menu');
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'false');
  await hrParticipant.hover();
  await owner.page.waitForTimeout(350);
  assert.equal(await owner.page.getByRole('tooltip').count(), 0, 'hovering a participant does not reveal role commands');
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'false', 'hover does not open participant actions');
  await hrParticipant.click();
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'true', 'click opens participant actions');
  const assignHrAction = owner.page.getByRole('menuitem', { name: 'Назначить нанимающим', exact: true });
  await assignHrAction.waitFor({ state: 'visible' });
  await assignHrAction.hover();
  assert.equal(await assignHrAction.isVisible(), true, 'menu remains open while moving from trigger to an action');
  await owner.page.keyboard.press('Escape');
  await owner.page.waitForFunction(button => button.getAttribute('aria-expanded') === 'false', await hrParticipant.elementHandle());
  await hrParticipant.focus();
  await owner.page.keyboard.press('Enter');
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'true', 'Enter opens participant actions');
  await owner.page.keyboard.press('Escape');
  await owner.page.waitForFunction(button => button.getAttribute('aria-expanded') === 'false', await hrParticipant.elementHandle());
  await hrParticipant.click();
  await owner.page.getByRole('menuitem', { name: 'Назначить нанимающим', exact: true }).click();
  await hr.page.getByRole('button', { name: 'Кандидат и нанимающие', exact: true }).waitFor();
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
      await owner.page.getByRole('tab', { name: 'Активность', exact: true }).click();
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
  await Promise.all(views.map(view => view.confirmInjectedTokenRejections(new Set(sourceIds))));
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
    assert.equal(await candidate.page.getByRole('button', { name: 'Скачать логи в JSON', exact: true }).count(), 0);
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
    const [download] = await Promise.all([owner.page.waitForEvent('download'), owner.page.getByRole('button', { name: `Скачать логи в ${format}`, exact: true }).click()]);
    const path = `${out}/activity.${format.toLowerCase()}`; await download.saveAs(path);
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
  const [narrowDownload] = await Promise.all([hr.page.waitForEvent('download'), hr.page.getByRole('button', { name: 'Скачать логи в JSON', exact: true }).click()]);
  await narrowDownload.saveAs(`${out}/hr-narrow-activity.json`);
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
