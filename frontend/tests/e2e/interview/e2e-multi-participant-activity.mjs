import "../support/require-isolated-api.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { runObservedProtocolCommand, withProtocolDeadline } from '../support/observed-protocol-command.mjs';

const web = process.env.E2E_BASE_URL || 'http://localhost:5173';
const api = process.env.E2E_API_URL || 'http://localhost:18080/api';
const requestTraceHeader = 'x-interhub-test-request-id';
const historyBodyLookupFailures = [
  'response.json: Protocol error (Network.getResponseBody): No data found for resource with given identifier',
  'response.json: Protocol error (Network.getResponseBody): No resource with given identifier found',
];
const forceHistoryBodyLookupLoss = process.env.E2E_FORCE_HISTORY_BODY_LOOKUP_LOSS === 'true';
let forcedHistoryInspections = 0;
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
  const fetchCancellations = new Map();
  const cancellationFor = traceId => {
    let entry = fetchCancellations.get(traceId);
    if (!entry) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      entry = { promise, resolve }; fetchCancellations.set(traceId, entry);
    }
    return entry;
  };
  await context.exposeBinding('__multiFetchCanceled', ({ page, frame }, value) => {
    if (page !== view.page || frame !== page.mainFrame() || typeof value?.traceId !== 'string' ||
        typeof value?.documentId !== 'string') return;
    cancellationFor(value.traceId).resolve(value);
  });
  await context.exposeBinding('__multiExplicitClose', ({ page, frame }, value) => {
    if (page !== view.page || frame !== page.mainFrame() || !value ||
        typeof value.documentId !== 'string' || typeof value.sourceId !== 'string' ||
        !/^app-source-\d+$/.test(value.sourceId)) return;
    const key = `${value.documentId}/${value.sourceId}`;
    if (!observedCloses.has(key)) observedCloses.set(key, {
      documentId: value.documentId, sourceId: value.sourceId, order: ++lifecycleObservationOrder,
    });
  });
  await context.addInitScript(({ token, name, candidate, userId, observeInjectedDuplicate, requestTraceHeader, roomPath, relayPath, historyPath }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('display_name', name);
    const native = window.EventSource;
    // Full URLs stay inside this document's memory. The inspector returns only
    // source IDs, paths and lifecycle timestamps, never auth/capability values.
    const sourceAudits = [], auditBySource = new WeakMap(), documentId = crypto.randomUUID();
    const rejectedAttempts = [], fetchAudits = new Map();
    const relayObservations = { keyPressRequestsAfterInjection: 0, matchingRelayRequests: 0,
      matchingSessionRequests: 0, matchingOldTokenRequests: 0,
      matchingHydratedRetryRequests: 0, matchingRejectedResponses: 0 };
    let duplicateAdmission = null;
    window.__multi = { documentId, connections: 0, state: null, errors: [], privateLeaks: [], candidateKeys: 0, longTasks: [], tabEvents: [] };
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
      const matches = rejectedAttempts.filter(attempt => attempt.id === query.traceId && attempt.url === query.requestUrl &&
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
          responseBodyRead: query.originalResponseProven === true || (attempt?.bodyInspectionCompleted === true && attempt?.bodyUnreadable === false),
          exactStaleReason: query.originalResponseProven === true || attempt?.exactStaleReason === true,
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
          admission.newToken !== admission.oldToken && query.originalResponseProven === true &&
          attempt.retryAcceptedAt !== null && attempt.retryToken !== admission.oldToken &&
          window.__multi.state?.eventToken === attempt.retryToken &&
          current?.openedAt !== null && current?.openedAt !== undefined && current.stateSyncAt !== null,
        documentId, auditId: attempt.id, duplicateAuditId: admission.id,
        injectedAt: admission.injectedAt, admittedAt: admission.admittedAt,
        rejectedAt: query.rejectedAt, exactStaleReason: query.originalResponseProven === true,
        retryAcceptedAt: attempt.retryAcceptedAt, hydratedSourceId: current?.id ?? null,
        diagnostic,
      };
    };
    window.__multi.inspectStartupSyncCancellation = ({ traceId, failedAt, observedCloses, failedOrder }) => {
      const fetch = fetchAudits.get(traceId), source = sourceAudits.find(source => source.id === fetch?.sourceId);
      const close = observedCloses.find(close => close.documentId === documentId && close.sourceId === source?.id);
      const closedBeforeFailure = source?.closedAt < failedAt || (source?.closedAt === failedAt && close?.order < failedOrder);
      const replacement = sourceAudits.find(next => next !== source && next.identityUrl === source?.identityUrl &&
        next.createdAt >= source.closedAt && next.openedAt !== null && next.stateSyncAt !== null && next.errorAt === null);
      return {
        proven: fetch?.eventType === 'request_state_sync' && fetch.method === 'POST' && fetch.path === relayPath &&
          fetch.responseStatus === null && fetch.abortAt !== null && fetch.abortAt <= failedAt &&
          fetch.rejectionName === 'AbortError' && source?.closedAt !== null && closedBeforeFailure &&
          [0, 1].includes(source.readyStateAtClose) && source.errorAt === null && Boolean(replacement),
        classification: 'explicit-startup-sync-cancellation', documentId, traceId,
        sourceId: source?.id ?? null, abortAt: fetch?.abortAt ?? null,
        rejectionName: fetch?.rejectionName ?? null, explicitCloseAt: source?.closedAt ?? null,
        readyStateAtClose: source?.readyStateAtClose ?? null, replacementSourceId: replacement?.id ?? null,
      };
    };
    window.__multi.inspectHistoryResponse = traceId => {
      const audit = fetchAudits.get(traceId);
      return audit ? { documentId, traceId, method: audit.method, path: audit.path,
        responseStatus: audit.responseStatus, ...audit.history } : null;
    };
    window.__multi.inspectCandidateResponse = traceId => {
      const audit = fetchAudits.get(traceId);
      return audit ? { documentId, traceId, method: audit.method, path: audit.path,
        responseStatus: audit.responseStatus, ...audit.privacy } : null;
    };
    window.__multi.inspectFetchCancellation = traceId => {
      const audit = fetchAudits.get(traceId);
      return { proven: audit?.responseStatus === null && audit.abortAt !== null && audit.rejectionName === 'AbortError',
        documentId, traceId, method: audit?.method ?? null, path: audit?.path ?? null,
        abortAt: audit?.abortAt ?? null, rejectionName: audit?.rejectionName ?? null };
    };
    window.__multi.inspectStartupRoomCancellation = ({ traceId, failedAt }) => {
      const audit = fetchAudits.get(traceId), current = auditBySource.get(window.__multi.source);
      const state = window.__multi.state, stream = current ? new URL(current.url) : null;
      const participant = state?.participants?.find(participant => participant.sessionId === stream?.searchParams.get('sessionId'));
      // Full authoritative SSE hydration may supersede a startup REST read; the
      // application does not promise another REST request after its cancellation.
      // Compare auth/capabilities only in memory and export redacted proof gates.
      const gates = {
        exactRead: audit?.method === 'GET' && audit.path === roomPath,
        headerlessAbort: audit?.responseStatus === null && audit.abortAt !== null && audit.abortAt <= failedAt && audit.rejectionName === 'AbortError',
        currentStreamOpen: window.__multi.source?.readyState === 1 && current?.openedAt !== null && current?.openedAt !== undefined && current.errorAt === null,
        canonicalHydration: current?.stateSyncAt !== null && current?.stateSyncAt !== undefined && current.stateSyncAt >= audit?.startedAt &&
          state?.inviteCode === roomPath.split('/').at(-1) && typeof state?.code === 'string' && Array.isArray(state?.tasks) &&
          Number.isSafeInteger(state?.currentStep) && typeof state?.eventToken === 'string' && state.eventToken.length > 0,
        sameRoomAndParticipant: stream?.pathname === relayPath.replace(/\/events$/, '/stream') && participant?.userId === userId,
        sameAuthorization: audit?.authorization === `Bearer ${stream?.searchParams.get('authToken')}`,
        sameCapabilities: (audit?.ownerToken ?? '') === (stream?.searchParams.get('ownerToken') ?? '') && !audit?.interviewerToken &&
          (!audit?.eventToken || audit.eventToken === state?.eventToken),
      };
      return {
        proven: Object.values(gates).every(Boolean), gates,
        classification: 'explicit-startup-room-read-sse-supersession', documentId, traceId,
        abortAt: audit?.abortAt ?? null, rejectionName: audit?.rejectionName ?? null,
        hydratedSourceId: current?.id ?? null, hydratedAt: current?.stateSyncAt ?? null,
      };
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      let body = null;
      try { if (typeof init?.body === 'string') body = JSON.parse(init.body); } catch {}
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
      const observe = url.origin === location.origin && ((method === 'POST' && url.pathname === relayPath) ||
        (method === 'GET' && [roomPath, historyPath].includes(url.pathname)));
      if (!observe) return nativeFetch(input, init);
      const traceId = `${documentId}:${crypto.randomUUID()}`, headers = new Headers(init?.headers ?? input?.headers);
      headers.set(requestTraceHeader, traceId);
      const signal = init?.signal ?? input?.signal;
      const audit = { method, path: url.pathname, eventType: body?.type ?? null,
        startedAt: Date.now(), authorization: headers.get('authorization') ?? '',
        ownerToken: headers.get('x-room-owner-token'), interviewerToken: headers.get('x-room-interviewer-token'), eventToken: headers.get('x-room-event-token'),
        sourceId: auditBySource.get(window.__multi.source)?.id ?? null,
        responseStatus: null, abortAt: signal?.aborted ? Date.now() : null, rejectionName: null, privacy: null, history: null, body: null };
      signal?.addEventListener('abort', () => { audit.abortAt ??= Date.now(); }, { once: true });
      fetchAudits.set(traceId, audit);
      const admission = duplicateAdmission;
      const oldAttempt = observeInjectedDuplicate && admission && body?.type === 'key_press' && url.href === admission.relayUrl &&
        body.sessionId === admission.sessionId && body.eventToken === admission.oldToken;
      const hydratedRetry = admission && body?.type === 'key_press' && url.href === admission.relayUrl &&
        body.sessionId === admission.sessionId && body.eventToken !== admission.oldToken &&
        body.eventToken === window.__multi.state?.eventToken;
      if (admission && body?.type === 'key_press') {
        relayObservations.keyPressRequestsAfterInjection++;
        if (url.href === admission.relayUrl) relayObservations.matchingRelayRequests++;
        if (body.sessionId === admission.sessionId) relayObservations.matchingSessionRequests++;
        if (oldAttempt) relayObservations.matchingOldTokenRequests++;
        if (hydratedRetry) relayObservations.matchingHydratedRetryRequests++;
      }
      const attempt = oldAttempt ? { id: traceId, admission, url: url.href,
        sessionId: body.sessionId, token: body.eventToken, sourceEventId: body.sourceEventId,
        rejectedAt: null, exactStaleReason: false, bodyInspectionCompleted: false,
        bodyUnreadable: false, retryAcceptedAt: null, retryToken: null } : null;
      if (attempt) rejectedAttempts.push(attempt);
      return nativeFetch(input, { ...init, headers }).then(response => {
        audit.responseStatus = response.status;
        if (method === 'GET' && url.pathname === historyPath && response.ok) {
          audit.history = { completed: false, valid: false };
          // Inspect a clone of this exact original response before the app reads
          // it. Only redacted page metadata survives; no replay request is sent.
          void response.clone().json().then(value => {
            const valid = value !== null && typeof value === 'object' && Array.isArray(value.events) &&
              value.events.length <= 200 && Number.isSafeInteger(value.throughSequence) && value.throughSequence >= 0;
            audit.history = { completed: true, valid, count: Array.isArray(value?.events) ? value.events.length : null,
              through: Number.isSafeInteger(value?.throughSequence) ? value.throughSequence : null };
          }).catch(error => { audit.history = { completed: true, valid: false, errorName: error.name }; });
        }
        if (method === 'GET' && url.pathname === roomPath && response.ok) {
          audit.body = { completed: false, valid: false };
          if (candidate) audit.privacy = { completed: false, passed: false };
          void response.clone().json().then(value => {
            const valid = value !== null && typeof value === 'object' && !Array.isArray(value) && value.inviteCode === roomPath.split('/').at(-1);
            audit.body = { completed: true, valid };
            if (candidate) audit.privacy = { completed: true, passed: valid &&
              !/"(candidateKeyHistory|lastCandidateKey|sourceEventId|acceptedSequence|pastePreview)"/.test(JSON.stringify(value)) };
          }).catch(error => {
            audit.body = { completed: true, valid: false, errorName: error.name };
            if (candidate) audit.privacy = { completed: true, passed: false, errorName: error.name };
          });
        }
        if (oldAttempt && response.status === 403) {
          relayObservations.matchingRejectedResponses++;
          attempt.rejectedAt = Date.now();
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
      }).catch(error => {
        audit.rejectionName = error.name;
        if (audit.abortAt !== null && error.name === 'AbortError') {
          try { window.__multiFetchCanceled?.({ documentId, traceId })?.catch(() => {}); } catch {}
        }
        throw error;
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
  }, { token: auth.token, name: auth.user.displayName, candidate, userId: auth.user.id, observeInjectedDuplicate: label === 'candidate-1',
    requestTraceHeader, roomPath: `/api/rooms/${room.inviteCode}`, historyPath: `/api/rooms/${room.inviteCode}/activity-history`, relayPath: `/api/realtime/rooms/${room.inviteCode}/events` });
  const page = await context.newPage(); view.page = page; page.setDefaultTimeout(15000);
  const responseStatuses = new WeakMap();
  const requestGenerations = new WeakMap();
  const startupRequests = new WeakSet();
  const interceptedResponses = new Map();
  const interceptedCandidateResponses = new Map();
  const runtime = (kind, detail, eventType = null, responseStatus = null, sourceLifecycle = null, at = Date.now(), injectedFault = closing || view.expectedFault || view.offline) => {
    const networkFailure = /ERR_(INTERNET_DISCONNECTED|ABORTED|NETWORK_CHANGED|FAILED)|Failed to fetch/.test(detail);
    const supersededMutation = kind === 'requestfailed' && /ERR_ABORTED/.test(detail) && ['yjs_update', 'code_update'].includes(eventType);
    const acceptedResponseCancellation = kind === 'requestfailed' && /ERR_ABORTED/.test(detail) && responseStatus >= 200 && responseStatus < 300;
    const discardedDocumentInspection = kind === 'history-body-unavailable-after-navigation';
    const explicitStartupClose = sourceLifecycle?.proven === true;
    const expected = discardedDocumentInspection || acceptedResponseCancellation || supersededMutation || explicitStartupClose || (injectedFault && ['requestfailed', 'console'].includes(kind) && networkFailure);
    const entry = { label, kind, detail, eventType, responseStatus, expected, observationOrder: ++lifecycleObservationOrder, classification: discardedDocumentInspection ? 'discarded-document-inspection' : acceptedResponseCancellation ? 'body-cancel-after-success-headers' : supersededMutation ? 'superseded-mutation-request' : explicitStartupClose ? sourceLifecycle.classification ?? 'explicit-startup-stream-close' : expected ? 'injected-network-or-cleanup' : 'unexpected', ...(sourceLifecycle ? { sourceLifecycle } : {}), at };
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
    } else if (startupRequests.has(req) && view.documentGeneration === 0 && requestGenerations.get(req) === 0 &&
        req.method() === 'POST' && path === `/api/realtime/rooms/${room.inviteCode}/events` &&
        eventType === 'request_state_sync' && failure === 'net::ERR_ABORTED' && status === null &&
        req.headers()[requestTraceHeader]) {
      const task = (async () => {
        const query = { traceId: req.headers()[requestTraceHeader], failedAt, observedCloses: [...observedCloses.values()], failedOrder };
        await page.waitForFunction(query => window.__multi?.inspectStartupSyncCancellation(query)?.proven === true,
          query, { timeout: 1500 }).catch(() => {});
        const proof = await page.evaluate(query => window.__multi?.inspectStartupSyncCancellation(query) ?? null, query).catch(() => null);
        runtime('requestfailed', detail, eventType, status, proof, failedAt, false);
      })();
      pendingInspections.add(task); task.finally(() => pendingInspections.delete(task));
    } else if (startupRequests.has(req) && view.documentGeneration === 0 && requestGenerations.get(req) === 0 &&
        req.method() === 'GET' && path === `/api/rooms/${room.inviteCode}` &&
        failure === 'net::ERR_ABORTED' && status === null && req.headers()[requestTraceHeader]) {
      const task = (async () => {
        const query = { traceId: req.headers()[requestTraceHeader], failedAt };
        await page.waitForFunction(query => window.__multi?.inspectStartupRoomCancellation(query)?.proven === true,
          query, { timeout: 1500 }).catch(() => {});
        const proof = await page.evaluate(query => window.__multi?.inspectStartupRoomCancellation(query) ?? null, query).catch(() => null);
        runtime('requestfailed', detail, eventType, status, proof, failedAt, false);
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
        const traceId = req.headers()[requestTraceHeader];
        const bodyInspection = response.json().then(value => ({ traceId, responseStatus: response.status(),
          exactStaleReason: value?.error === 'Недействительный eventToken для этой сессии', readable: true })).catch(() => null);
        rejectedActivity.push({ entry, traceId, bodyInspection, generation: requestGenerations.get(req), query: {
          traceId,
          requestUrl: req.url(), sessionId: body.sessionId, eventToken: body.eventToken, sourceEventId: body.sourceEventId,
        } });
      }
    }
    if (req.method() === 'GET' && path.endsWith('/activity-history') && response.ok()) {
      const inspection = forceHistoryBodyLookupLoss
        ? Promise.reject(new Error(historyBodyLookupFailures[forcedHistoryInspections++ % historyBodyLookupFailures.length])) : response.json();
      const task = inspection.then(body => {
        assert.ok(Array.isArray(body?.events) && body.events.length <= 200, 'History page must remain bounded');
        assert.ok(Number.isSafeInteger(body.throughSequence) && body.throughSequence >= 0, 'History page must have a valid boundary');
        report.historyPages.push({ label, count: body.events.length, through: body.throughSequence });
      }).catch(async error => {
        const requestGeneration = requestGenerations.get(req), traceId = req.headers()[requestTraceHeader];
        const lookupFailure = historyBodyLookupFailures.includes(error.message);
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        const traceParts = traceId?.split(':');
        const requestDocumentId = traceParts?.length === 2 && traceParts.every(part => uuid.test(part)) ? traceParts[0] : null;
        const originalRequestProven = requestDocumentId !== null && Number.isSafeInteger(requestGeneration) &&
          path === `/api/rooms/${room.inviteCode}/activity-history` && response.status() === 200;
        let snapshot = null, observedInvalidBody = false;
        const readSnapshot = async () => {
          const next = await withProtocolDeadline(() => page.evaluate(({ traceId, roomPath }) => ({
            documentId: window.__multi?.documentId ?? null, roomMatches: location.pathname === roomPath,
            body: window.__multi?.inspectHistoryResponse(traceId) ?? null,
          }), { traceId, roomPath: `/room/${room.inviteCode}` }), 'verify-original-history-response').catch(() => null);
          const body = next?.body;
          if (body?.documentId === requestDocumentId && body.traceId === traceId && body.completed === true && body.valid === false &&
              (!body.errorName || body.errorName === 'SyntaxError')) observedInvalidBody = true;
          return next;
        };
        if (lookupFailure && originalRequestProven) {
          snapshot = await readSnapshot();
          if (!uuid.test(snapshot?.documentId ?? '')) {
            await page.waitForFunction(() => typeof window.__multi?.documentId === 'string', null, { timeout: 1500 }).catch(() => {});
            snapshot = await readSnapshot();
          }
          if (snapshot?.documentId === requestDocumentId && snapshot.body?.completed !== true) {
            await page.waitForFunction(({ id, documentId }) => window.__multi?.documentId !== documentId ||
              window.__multi?.inspectHistoryResponse(id)?.completed === true,
            { id: traceId, documentId: requestDocumentId }, { timeout: 1500 }).catch(() => {});
            snapshot = await readSnapshot();
          }
          const inspectedBody = snapshot?.body;
          if (snapshot?.roomMatches === true && snapshot.documentId === requestDocumentId &&
              inspectedBody?.documentId === requestDocumentId && inspectedBody.traceId === traceId &&
              inspectedBody.method === 'GET' && inspectedBody.path === path && inspectedBody.responseStatus === response.status() &&
              inspectedBody.completed === true && inspectedBody.valid === true &&
              Number.isSafeInteger(inspectedBody.count) && inspectedBody.count >= 0 && inspectedBody.count <= 200 &&
              Number.isSafeInteger(inspectedBody.through) && inspectedBody.through >= 0) {
            report.historyPages.push({ label, count: inspectedBody.count, through: inspectedBody.through });
            const entry = runtime('history-inspection', 'Original history JSON validated after exact browser body lookup loss', null, null,
              { proven: true, classification: 'same-response-history-inspected', ...inspectedBody });
            entry.historyInspectionDiagnostic = { requestGeneration, currentGeneration: view.documentGeneration,
              requestDocumentId, currentDocumentId: snapshot.documentId };
            return;
          }
        }
        // The nonce is created in the fetch's actual document, before native
        // fetch. Late request events cannot relabel an old document as current.
        // Unknown nonces and any invalid original proof we observed still fail.
        const lostOldDocument = lookupFailure && originalRequestProven && snapshot?.roomMatches === true &&
          uuid.test(snapshot.documentId ?? '') && requestDocumentId !== snapshot.documentId && !observedInvalidBody;
        const entry = runtime(lostOldDocument ? 'history-body-unavailable-after-navigation' : 'history-inspection',
          lookupFailure ? error.message : `History response inspection failed (${error.name})`);
        entry.historyInspectionDiagnostic = { requestGeneration: requestGeneration ?? null,
          currentGeneration: view.documentGeneration, requestDocumentId, currentDocumentId: snapshot?.documentId ?? null,
          responseStatus: response.status(), traceObserved: Boolean(traceId), inspectedBody: snapshot?.body ?? null, observedInvalidBody };
      });
      pendingInspections.add(task); task.finally(() => pendingInspections.delete(task));
    }
    if (candidate && req.method() === 'GET' && path === `/api/rooms/${room.inviteCode}` && response.ok()) {
      const task = response.json().then(body => {
        const text = JSON.stringify(body);
        assert.ok(!/"(candidateKeyHistory|lastCandidateKey|sourceEventId|acceptedSequence|pastePreview)"/.test(text), 'Candidate HTTP room leaked history');
      }).catch(async error => {
        const inspectionDetail = historyBodyLookupFailures.includes(error.message)
          ? error.message : `Candidate response inspection failed (${error.name})`;
        const traceId = req.headers()[requestTraceHeader];
        const sameDocument = requestGenerations.get(req) === view.documentGeneration;
        let inspectedBody = null;
        if (sameDocument && traceId && historyBodyLookupFailures.includes(error.message)) {
          await page.waitForFunction(id => window.__multi?.inspectCandidateResponse(id)?.completed === true,
            traceId, { timeout: 1500 }).catch(() => {});
          const proof = await page.evaluate(id => window.__multi?.inspectCandidateResponse(id) ?? null, traceId).catch(() => null);
          const originalResponse = interceptedCandidateResponses.get(traceId);
          inspectedBody = { browser: proof, originalResponse: originalResponse ?? null };
          const verified = proof?.passed === true ? proof : originalResponse;
          const inspectedViolation = proof?.completed === true && proof.passed === false && !proof.errorName;
          if (!inspectedViolation && verified?.traceId === traceId && verified.method === 'GET' && verified.path === path &&
              verified.responseStatus === response.status() && verified.completed === true && verified.passed === true) {
            const entry = runtime('privacy-inspection', inspectionDetail);
            entry.expected = true; entry.classification = 'same-response-privacy-inspected'; entry.privacyProof = verified;
            return;
          }
        }
        const entry = runtime('privacy-inspection', inspectionDetail);
        entry.privacyInspectionDiagnostic = { traceObserved: Boolean(traceId), sameDocument, inspectedBody };
      });
      pendingInspections.add(task); task.finally(() => pendingInspections.delete(task));
    }
  });
  if (candidate) {
    const cdp = await withProtocolDeadline(() => context.newCDPSession(page), 'create-diagnostic-session'), paused = new Set();
    const send = (method, params) => withProtocolDeadline(() => cdp.send(method, params), method);
    const cancellationProof = async (traceId, path, method) => {
      const notification = await cancellationFor(traceId).promise;
      const proof = await withProtocolDeadline(() => page.evaluate(traceId => window.__multi?.inspectFetchCancellation(traceId) ?? null, traceId),
        'verify-original-fetch-cancellation');
      return proof?.proven === true && proof.documentId === notification.documentId && proof.traceId === traceId &&
        proof.path === path && proof.method === method ? { ...proof, classification: 'explicit-aborted-response-diagnostic' } : { proven: false };
    };
    let observing = false, observingPrivacy = true;
    const configure = () => send('Fetch.enable', { patterns: [
      ...(observingPrivacy ? [{ urlPattern: `*/api/rooms/${room.inviteCode}`, requestStage: 'Response' }] : []),
      ...(observing ? [{ urlPattern: `*/api/realtime/rooms/${room.inviteCode}/events`, requestStage: 'Response' }] : []),
    ] });
    cdp.on('Fetch.requestPaused', event => {
      const path = new URL(event.request.url).pathname;
      const traceId = Object.entries(event.request.headers).find(([name]) => name.toLowerCase() === requestTraceHeader)?.[1];
      const task = (async () => {
        let responseReadPending = false;
        try {
          const roomRead = observingPrivacy && event.responseStatusCode === 200 && event.request.method === 'GET' && path === `/api/rooms/${room.inviteCode}`;
          const body = event.request.method === 'POST' ? JSON.parse(event.request.postData ?? '{}') : null;
          const rejectedActivity = observing && event.responseStatusCode === 403 && body?.type === 'key_press';
          if ((!roomRead && !rejectedActivity) || !traceId) return;
          responseReadPending = true;
          const observed = await runObservedProtocolCommand({
            command: () => cdp.send('Fetch.getResponseBody', { requestId: event.requestId }),
            cancellation: cancellationProof(traceId, path, event.request.method), description: 'Fetch.getResponseBody',
          });
          if (observed.kind === 'cancelled') {
            runtime('original-response-canceled', 'Original diagnostic body read canceled by its exact fetch', null, null, observed.proof);
            return;
          }
          const original = observed.value;
          responseReadPending = false;
          const value = JSON.parse(Buffer.from(original.body, original.base64Encoded ? 'base64' : 'utf8').toString('utf8'));
          if (roomRead) {
            const proof = { traceId, responseStatus: 200, method: 'GET', path,
              completed: true, passed: value !== null && typeof value === 'object' && !Array.isArray(value) && value.inviteCode === room.inviteCode &&
                !/"(candidateKeyHistory|lastCandidateKey|sourceEventId|acceptedSequence|pastePreview)"/.test(JSON.stringify(value)) };
            interceptedCandidateResponses.set(traceId, proof);
            if (!proof.passed) runtime('privacy-inspection', 'Original candidate room JSON failed exact-room/private-field checks');
          }
          else interceptedResponses.set(traceId, { traceId, responseStatus: 403, readable: true,
            path, sourceEventId: body.sourceEventId, exactStaleReason: value?.error === 'Недействительный eventToken для этой сессии' });
        } catch (error) {
          let cancellation = null;
          const invalidCanceledInterception = responseReadPending && traceId &&
            error.message === 'cdpSession.send: Protocol error (Fetch.getResponseBody): Invalid InterceptionId.';
          if (invalidCanceledInterception) {
            const proof = await withProtocolDeadline(() => cancellationProof(traceId, path, event.request.method),
              'verify-invalid-interception-cancellation').catch(() => null);
            if (proof?.proven === true) cancellation = proof;
          }
          const entry = runtime('original-response-inspection', `Original response capture failed (${error.name})`, null, null, cancellation);
          entry.responseInspectionDiagnostic = { responseStatus: event.responseStatusCode ?? null,
            method: event.request.method, path, responseReadPending, invalidCanceledInterception: Boolean(invalidCanceledInterception) };
        }
        finally { await send('Fetch.continueResponse', { requestId: event.requestId }).catch(async error => {
          if (!observing && !observingPrivacy) return;
          // Chromium invalidates an intercepted response when the application
          // aborts that exact fetch. The request's own failure is still audited
          // separately; only this diagnostic resume race can be accounted for.
          let cancellation = null;
          if (traceId && error.message === 'cdpSession.send: Protocol error (Fetch.continueResponse): Invalid InterceptionId.') {
            const proof = await withProtocolDeadline(() => cancellationProof(traceId, path, event.request.method),
              'verify-invalid-interception-cancellation').catch(() => null);
            if (proof?.proven === true) cancellation = proof;
          }
          runtime('original-response-resume', `Original response resume failed (${error.name})`, null, null, cancellation);
        }); }
      })();
      paused.add(task); task.finally(() => paused.delete(task));
    });
    view.startInjectedResponseObserver = async () => {
      observing = true;
      await configure();
    };
    const drain = () => withProtocolDeadline(() => Promise.all([...paused]), 'observer-drain');
    view.stopInjectedResponseObserver = async () => {
      try { await drain(); }
      finally { if (observing) { observing = false; if (observingPrivacy) await configure(); else await send('Fetch.disable'); } }
    };
    view.stopStartupResponseObserver = async () => {
      try { await drain(); }
      finally { if (observingPrivacy) { observingPrivacy = false; if (observing) await configure(); else await send('Fetch.disable'); } }
    };
    view.closeDiagnostics = async () => {
      try { await drain(); }
      finally {
        observing = false; observingPrivacy = false;
        try { await send('Fetch.disable'); }
        finally { await withProtocolDeadline(() => cdp.detach(), 'detach'); }
      }
    };
    await configure();
  }
  await page.goto(`${web}/room/${room.inviteCode}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await page.waitForFunction(() => Boolean(window.__multi.state?.eventToken));
  view.startup = false;
  await view.stopStartupResponseObserver?.();
  view.confirmInjectedTokenRejections = async durableSourceIds => {
    for (const rejected of rejectedActivity) {
      const action = view.actions.get(rejected.query.sourceEventId);
      const nativeBody = await rejected.bodyInspection;
      const pausedBody = interceptedResponses.get(rejected.traceId);
      const originalBody = nativeBody?.readable ? nativeBody : pausedBody;
      const originalResponseProven = typeof rejected.traceId === 'string' && originalBody?.traceId === rejected.traceId &&
        originalBody.responseStatus === 403 && originalBody.readable === true && originalBody.exactStaleReason === true &&
        (!pausedBody || (pausedBody.sourceEventId === rejected.query.sourceEventId && pausedBody.path === `/api/realtime/rooms/${room.inviteCode}/events`));
      const nodeGates = {
        originalDocument: rejected.generation === 0 && view.documentGeneration === 0,
        sameSourceDurable: durableSourceIds.has(rejected.query.sourceEventId),
        sameSourceAcknowledged: action?.acknowledged === true,
        sameSourceRetried: action?.attempts >= 2,
        exactOriginalResponseReason: originalResponseProven,
      };
      rejected.entry.injectedRelayDiagnostic = { nodeGates, sourceAttemptCount: action?.attempts ?? 0 };
      if (rejected.generation !== 0 || view.documentGeneration !== 0 ||
          !durableSourceIds.has(rejected.query.sourceEventId)) continue;
      if (!action?.acknowledged || action.attempts < 2) continue;
      const proof = await page.evaluate(query => window.__multi.inspectInjectedTokenRejection(query), {
        ...rejected.query, originalResponseProven, rejectedAt: rejected.entry.at,
      });
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
  const ownerAuth = await account('Владелец интервью'), interviewerAuth = await account('Интервьюер'), hrAuth = await account('Гостевой интервьюер', true);
  const candidateAuth = await Promise.all(Array.from({ length: 7 }, (_, i) => account(`Кандидат ${i + 1}`)));
  const room = await request('/rooms', { token: ownerAuth.token, method: 'POST', body: { title: '10 участников · параллельная запись логов', taskIds: [] } }); report.room = room.inviteCode;
  await request(`/rooms/${room.inviteCode}/tasks`, { token: ownerAuth.token, method: 'POST', body: { customTasks: [{ title: 'Совместный ввод', description: 'Семь кандидатов печатают одновременно', starterCode: '// activity\n', language: 'nodejs' }] } });
  await request(`/rooms/${room.inviteCode}/participants/${interviewerAuth.user.id}/role`, { token: ownerAuth.token, method: 'POST', body: { role: 'interviewer' } });
  const owner = await open(ownerAuth, room, 'owner'), interviewer = await open(interviewerAuth, room, 'interviewer'), hr = await open(hrAuth, room, 'hr');
  const hrParticipant = owner.page.locator('[data-testid^="participant-badge-"]').filter({ hasText: 'Гостевой интервьюер' });
  assert.equal(await hrParticipant.getAttribute('aria-haspopup'), 'menu');
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'false');
  await hrParticipant.hover();
  await owner.page.waitForTimeout(350);
  assert.equal(await owner.page.getByRole('tooltip').count(), 0, 'hovering a participant does not reveal role commands');
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'false', 'hover does not open participant actions');
  await hrParticipant.click();
  assert.equal(await hrParticipant.getAttribute('aria-expanded'), 'true', 'click opens participant actions');
  const assignHrAction = owner.page.getByRole('menuitem', { name: 'Назначить интервьюером', exact: true });
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
  await owner.page.getByRole('menuitem', { name: 'Назначить интервьюером', exact: true }).click();
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
      await candidates[0].startInjectedResponseObserver();
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
      await candidates[0].stopInjectedResponseObserver();
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
  await withProtocolDeadline(() => Promise.all(pendingInspections), 'response-inspection-drain');
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
  phase('verification: desktop exports/paging passed; narrow guest interviewer controls and download');
  await hr.page.setViewportSize({ width: 900, height: 900 });
  await withProtocolDeadline(() => Promise.all(pendingInspections), 'response-inspection-drain');
  hr.documentGeneration++; hr.expectedFault = true; await hr.page.reload({ waitUntil: 'domcontentloaded' });
  await hr.page.locator('[data-testid="room-code-editor-host"] .cm-content').waitFor();
  await measure('narrow-hr-open-logs', () => logs(hr));
  await hr.page.getByRole('button', { name: 'Показать более ранние события', exact: true }).waitFor(); hr.expectedFault = false;
  await verifyReloadedEditor(hr);
  const [narrowDownload] = await Promise.all([hr.page.waitForEvent('download'), hr.page.getByRole('button', { name: 'Скачать логи в JSON', exact: true }).click()]);
  await narrowDownload.saveAs(`${out}/hr-narrow-activity.json`);
  equalIds(JSON.parse(await readFile(`${out}/hr-narrow-activity.json`, 'utf8')).map(row => row.sourceEventId), sourceIds, 'narrow guest interviewer complete export');
  await loadAll(hr); await layout(hr, 'hr-narrow-complete');
  await hasIds(hr, sourceIds); await screenshot(candidates[0], 'candidate-no-private-logs');
  phase('verification: activity, exports, privacy and both layouts completed');
  await withProtocolDeadline(() => Promise.all(pendingInspections), 'response-inspection-drain');
  report.performance = await Promise.all(views.map(async view => ({ participant: view.label, ...await view.page.evaluate(() => ({ longTasks: window.__multi.longTasks.length, longestTaskMs: Math.max(0, ...window.__multi.longTasks) })) })));
  const unexpected = report.runtime.filter(item => !item.expected);
  report.unexpectedRuntimeCount = unexpected.length;
  if (unexpected.length) report.failures.push(`Unexpected runtime errors: ${unexpected.length}; inspect report.runtime`);
  assert.deepEqual(report.failures, [], 'Product verification failures');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.error = error.stack || String(error); console.error(error); process.exitCode = 1;
  for (const view of views.filter(v => !v.candidate)) await screenshot(view, `failure-${view.label}`).catch(() => {});
} finally {
  report.observedTabEvents = await Promise.all(views.map(async view => ({ participant: view.label, ...await view.page.evaluate(() => ({ events: window.__multi?.tabEvents, parseErrors: window.__multi?.errors, privateLeaks: window.__multi?.privateLeaks })).catch(() => ({ unavailable: true })) })));
  report.forcedHistoryBodyLookupLoss = { enabled: forceHistoryBodyLookupLoss, count: forcedHistoryInspections };
  closing = true;
  await Promise.all(views.map(view => view.closeDiagnostics?.().catch(error => {
    report.failures.push(`Diagnostic cleanup failed: ${view.label}: ${error.message}`);
    report.result = 'FAIL'; process.exitCode = 1;
  })));
  await withProtocolDeadline(() => Promise.all(pendingInspections), 'final-response-inspection-drain').catch(error => {
    report.failures.push(`Final response inspection drain failed (${error.name})`);
    report.result = 'FAIL'; process.exitCode = 1;
  });
  // Cleanup can settle response observers after the flow assertions. Keep this
  // final decision synchronous with serialization so late failures cannot pass.
  const finalUnexpected = report.runtime.filter(item => !item.expected).length;
  if (finalUnexpected > 0) {
    if (finalUnexpected !== report.unexpectedRuntimeCount)
      report.failures.push(`Unexpected runtime errors at report finalization: ${finalUnexpected}; inspect report.runtime`);
    report.result = 'FAIL'; process.exitCode = 1;
  }
  report.unexpectedRuntimeCount = finalUnexpected;
  report.finishedAt = new Date().toISOString();
  if (report.result === 'PASS') phase('MULTI_PARTICIPANT_ACTIVITY_OK');
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(`ARTIFACTS ${out}`);
  await Promise.all([...new Set([browser, tabBrowser])].map(instance => instance.close()));
}
