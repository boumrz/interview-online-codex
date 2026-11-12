import { API_BASE_URL } from "../../../config/runtime";
import { classifyDiagramResponse } from "../diagram/diagramRequestPolicy";
import { roomRealtimeFetch } from "../roomRealtimeTransport";
import { compareElementVersions, elementFingerprint, parseAck, parseElement, parseSnapshot, type WhiteboardChange, type WhiteboardElement, type WhiteboardSnapshot } from "./whiteboardProtocol";

export type WhiteboardConnection = {
  inviteCode: string;
  sessionId: string;
  authToken?: string | null;
  ownerToken?: string | null;
  interviewerToken?: string | null;
  eventToken?: string | null;
  connected: boolean;
  readOnly: boolean;
};
export type WhiteboardState = { loaded: boolean; editable: boolean; message: string; error: boolean; canDiscard: boolean; accessDenied: boolean; pending: number };
export type WhiteboardSession = {
  refresh(): void;
  observe(elements: ReadonlyArray<WhiteboardElement>): void;
  permissionsChanged(): void;
  reset(): void;
  retry(): void;
  destroy(): void;
  getSnapshot(): WhiteboardSnapshot | undefined;
};
export type WhiteboardSessionOptions = {
  current: () => WhiteboardConnection;
  onState: (state: WhiteboardState) => void;
  onScene: (snapshot: WhiteboardSnapshot, forceReplace: boolean) => void;
  fetch?: typeof fetch;
  throttleMs?: number;
};

type Attempt = { change: WhiteboardChange; body: string };
const MAX_BATCH_BYTES = 480 * 1024;
class SessionError extends Error {}

export function createWhiteboardSession(options: WhiteboardSessionOptions): WhiteboardSession {
  const lifetime = new AbortController();
  const fetcher = options.fetch ?? fetch;
  const throttle = Math.max(0, options.throttleMs ?? 200);
  const pending = new Map<string, WhiteboardElement>();
  // A durable ACK can precede its refreshed scene. Suppress native camera/view
  // echoes of that acknowledged version until the matching canonical read.
  const acknowledged = new Map<string, { fingerprint: string; sequence: number }>();
  let canonical: WhiteboardSnapshot | undefined;
  let attempt: Attempt | undefined;
  let closed = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDue = 0;
  let queuedDelay: number | undefined;
  let refreshRequested = false;
  let forceNextScene = false;
  let resetting = false;
  let validationBlocked = false;
  let writeDenied = false;
  let rejectedProof: string | null = null;
  let permissionEpoch = 0;
  let minimumSequence = 0;
  let nextWriteAt = 0;
  let state: WhiteboardState = { loaded: false, editable: false, message: "Подготавливаем доску…", error: false, canDiscard: false, accessDenied: false, pending: 0 };
  let publishedState: WhiteboardState | undefined;

  function ready(): boolean { const connection = options.current(); return connection.connected && Boolean(connection.eventToken) && connection.eventToken !== rejectedProof; }
  function authorizedToEdit(): boolean { return Boolean(canonical?.canEdit) && !options.current().readOnly && !writeDenied && !state.accessDenied; }
  function editable(): boolean { return !resetting && authorizedToEdit(); }
  function publish(next: Partial<WhiteboardState> = {}): void {
    if (closed) return;
    state = { ...state, ...next, loaded: canonical !== undefined, editable: editable(), pending: pending.size, canDiscard: validationBlocked && !state.accessDenied };
    // Native onChange also fires for camera/app-state and render updates. A
    // status callback must not feed those unchanged values back into React.
    if (publishedState && state.loaded === publishedState.loaded && state.editable === publishedState.editable
      && state.message === publishedState.message && state.error === publishedState.error
      && state.canDiscard === publishedState.canDiscard && state.accessDenied === publishedState.accessDenied
      && state.pending === publishedState.pending) return;
    publishedState = { ...state };
    options.onState({ ...state });
  }
  function status(): void {
    if (state.accessDenied || validationBlocked) { publish(); return; }
    publish({ error: false, message: !canonical ? ready() ? "Подготавливаем доску…" : "Ожидаем подключение к комнате…"
      : !editable() ? "Только просмотр · Сохранённая доска"
        : !ready() ? pending.size ? "Восстанавливаем связь · Новые изменения ещё не сохранены" : "Восстанавливаем связь…"
          : pending.size || attempt ? "Сохранение…" : "Сохранено" });
  }
  function block(): void {
    validationBlocked = true;
    publish({ error: true, message: "Изменение доски отклонено. Несохранённые изменения остаются в этой вкладке." });
  }
  function clearPending(): void { pending.clear(); acknowledged.clear(); attempt = undefined; }
  function forceCanonical(): void { if (canonical) options.onScene(canonical, true); }
  function denyRead(): void {
    permissionEpoch++; clearPending(); validationBlocked = false; resetting = false; writeDenied = true;
    if (canonical) options.onScene({ ...canonical, elements: [], canEdit: false }, true);
    canonical = undefined;
    publish({ accessDenied: true, error: true, message: "Доска недоступна. Доступ к комнате изменился." });
  }
  function denyWrite(): void {
    permissionEpoch++; clearPending(); validationBlocked = false; resetting = false; writeDenied = true;
    if (canonical) canonical = { ...canonical, canEdit: false };
    forceCanonical();
    publish({ error: true, message: "Редактирование доски больше недоступно" });
  }

  function schedule(delay = 0): void {
    if (closed) return;
    if (running) { queuedDelay = Math.min(queuedDelay ?? delay, delay); return; }
    const due = Date.now() + delay;
    if (timer && timerDue <= due) return;
    if (timer) clearTimeout(timer);
    timerDue = due;
    timer = setTimeout(() => { timer = undefined; void pump(); }, delay);
  }

  async function request(method: "GET" | "POST", body?: string) {
    const connection = { ...options.current() };
    if (!ready()) throw new SessionError("Ожидаем подтверждение подключения к комнате");
    const epoch = permissionEpoch;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (connection.authToken) headers.Authorization = `Bearer ${connection.authToken}`;
    if (connection.ownerToken) headers["X-Room-Owner-Token"] = connection.ownerToken;
    if (connection.interviewerToken) headers["X-Room-Interviewer-Token"] = connection.interviewerToken;
    if (connection.eventToken) headers["X-Room-Event-Token"] = connection.eventToken;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const query = new URLSearchParams({ sessionId: connection.sessionId });
    const response = await roomRealtimeFetch(`${API_BASE_URL}/rooms/${encodeURIComponent(connection.inviteCode)}/whiteboard${method === "POST" ? "/changes" : ""}?${query}`, {
      method, headers, ...(body === undefined ? {} : { body }),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)]),
    }, fetcher);
    if (closed || epoch !== permissionEpoch) return undefined;
    if (response.status === 403) {
      const body: unknown = await response.clone().json().catch(() => undefined);
      if (closed || epoch !== permissionEpoch) return undefined;
      if (typeof body === "object" && body !== null && "code" in body && body.code === "ROOM_EVENT_CAPABILITY_STALE") {
        // The server can retire a lease before EventSource reports onerror.
        // Keep its immutable operation and wait for a genuinely different proof.
        rejectedProof = connection.eventToken ?? null;
        const error = new SessionError("Ожидаем подтверждение нового подключения"); error.name = "WhiteboardAuthorityPending"; throw error;
      }
    }
    const current = options.current();
    const action = classifyDiagramResponse(response.status, method, connection.eventToken ?? null, current.eventToken ?? null, current.connected);
    if (action === "deny-read") { denyRead(); return undefined; }
    if (action === "deny-write") { denyWrite(); refreshRequested = true; return undefined; }
    if (action === "reset-document") { block(); return undefined; }
    if (action === "recover-proof") {
      const error = new SessionError("Ожидаем подтверждение нового подключения"); error.name = "WhiteboardAuthorityPending"; throw error;
    }
    if (action === "retry") throw new SessionError(method === "POST" ? "Не удалось сохранить доску. Повторите действие." : "Не удалось загрузить доску. Повторите действие.");
    return { response, action, epoch, proof: connection.eventToken };
  }

  async function pull(): Promise<boolean> {
    const result = await request("GET");
    if (!result) return false;
    if (result.action !== "accepted") throw new SessionError("Не удалось загрузить актуальную доску. Повторите действие.");
    const body: unknown = await result.response.json();
    if (closed || result.epoch !== permissionEpoch) return false;
    if (!ready() || result.proof !== options.current().eventToken) {
      // A valid 200 may project canEdit=false for a superseded capability. Only
      // current authority can revoke a draft or switch the canvas to readonly.
      if (ready()) { refreshRequested = true; schedule(); }
      return false;
    }
    const incoming = parseSnapshot(body);
    if (canonical && incoming.boardId !== canonical.boardId) { block(); return false; }
    if (incoming.sequence < Math.max(minimumSequence, canonical?.sequence ?? 0)) throw new SessionError("Ожидаем актуальную версию доски. Повторите действие.");
    minimumSequence = incoming.sequence;
    canonical = incoming;
    state.accessDenied = false;
    writeDenied = !incoming.canEdit;
    const force = forceNextScene || !authorizedToEdit();
    if (!authorizedToEdit()) clearPending();
    else {
      const elements = new Map(incoming.elements.map(element => [element.id, element]));
      for (const [id, local] of pending) {
        const remote = elements.get(id);
        if (remote && compareElementVersions(remote, local) >= 0) pending.delete(id);
      }
      for (const [id, version] of acknowledged) if (version.sequence <= incoming.sequence) acknowledged.delete(id);
    }
    options.onScene(incoming, force);
    forceNextScene = false;
    resetting = false;
    status();
    return true;
  }

  function createAttempt(): Attempt | undefined {
    if (!canonical) return undefined;
    const operationId = crypto.randomUUID();
    const base = { boardId: canonical.boardId, operationId, baseSequence: canonical.sequence };
    const elements: WhiteboardElement[] = [];
    let bytes = new TextEncoder().encode(JSON.stringify({ ...base, elements: [] })).byteLength;
    for (const element of pending.values()) {
      const size = new TextEncoder().encode(JSON.stringify(element)).byteLength;
      if (bytes + size + (elements.length ? 1 : 0) > MAX_BATCH_BYTES) {
        if (!elements.length) block();
        break;
      }
      bytes += size + (elements.length ? 1 : 0);
      elements.push(element);
    }
    if (!elements.length) return undefined;
    const change: WhiteboardChange = Object.freeze({ ...base, elements: Object.freeze(elements) });
    return { change, body: JSON.stringify(change) };
  }

  async function push(): Promise<"accepted" | "conflict" | "stopped"> {
    attempt ??= createAttempt();
    if (!attempt) return "stopped";
    const sent = attempt;
    // Failed requests consume the relay budget too. A busy pen or repeated
    // Retry clicks must not turn a temporary failure into a tight write loop.
    nextWriteAt = Date.now() + throttle;
    const result = await request("POST", sent.body);
    if (!result) return "stopped";
    if (result.action === "conflict") return "conflict";
    const ack = parseAck(await result.response.json());
    if (closed || attempt !== sent) return "stopped";
    if (ack.boardId !== sent.change.boardId || ack.operationId !== sent.change.operationId || ack.sequence < sent.change.baseSequence) throw new SessionError("Не удалось подтвердить сохранение доски. Повторите действие.");
    minimumSequence = Math.max(minimumSequence, ack.sequence);
    for (const element of sent.change.elements) {
      const fingerprint = elementFingerprint(element);
      if (pending.has(element.id) && elementFingerprint(pending.get(element.id)!) === fingerprint) pending.delete(element.id);
      acknowledged.set(element.id, { fingerprint, sequence: ack.sequence });
    }
    attempt = undefined;
    nextWriteAt = Date.now() + throttle;
    return "accepted";
  }

  async function pump(): Promise<void> {
    if (closed || running) return;
    running = true;
    let conflicts = 0;
    try {
      while (!closed && ready()) {
        if (refreshRequested || !canonical) { refreshRequested = false; if (!await pull()) break; }
        if (closed || !ready() || validationBlocked || !editable()) break;
        if (!attempt && pending.size === 0) { status(); break; }
        const wait = nextWriteAt - Date.now();
        if (wait > 0) { schedule(wait); break; }
        const outcome = await push();
        if (outcome === "stopped") {
          if (refreshRequested && !state.accessDenied) continue;
          break;
        }
        if (outcome === "conflict" && ++conflicts > 1) throw new SessionError("Версия доски изменилась. Повторите действие.");
        refreshRequested = true;
      }
      if (!closed && !ready()) status();
    } catch (error) {
      if (!closed && !lifetime.signal.aborted) {
        if (error instanceof Error && error.name === "WhiteboardAuthorityPending") {
          publish({ error: false, message: "Восстанавливаем подключение · Изменения ещё не сохранены" });
          if (ready()) { refreshRequested = true; schedule(); }
        } else publish({ error: true, message: error instanceof SessionError ? error.message : "Не удалось обновить доску. Повторите действие." });
      }
    } finally {
      running = false;
      const delay = queuedDelay;
      queuedDelay = undefined;
      if (delay !== undefined && !closed) schedule(delay);
    }
  }

  const session: WhiteboardSession = {
    refresh() { if (closed || state.accessDenied) return; refreshRequested = true; status(); schedule(); },
    observe(elements) {
      if (closed || !canonical || !editable()) return;
      try {
        const accepted = new Map(canonical.elements.map(element => [element.id, element]));
        for (const element of elements) {
          const fingerprint = elementFingerprint(element);
          if (acknowledged.get(element.id)?.fingerprint === fingerprint) continue;
          const remote = accepted.get(element.id);
          if (remote && compareElementVersions(element, remote) <= 0) continue;
          const previous = pending.get(element.id);
          if (previous && compareElementVersions(element, previous) <= 0) continue;
          pending.set(element.id, parseElement(element));
        }
        if (pending.size > 5000) block();
        else status();
        if (!validationBlocked && (pending.size || attempt)) schedule(Math.max(0, nextWriteAt - Date.now()));
      } catch { block(); }
    },
    permissionsChanged() {
      if (closed) return;
      if (options.current().readOnly) {
        permissionEpoch++; clearPending(); validationBlocked = false;
        if (canonical) canonical = { ...canonical, canEdit: false };
        forceCanonical(); status();
      }
      session.refresh();
    },
    reset() {
      if (closed || state.accessDenied) return;
      permissionEpoch++; clearPending(); validationBlocked = false; writeDenied = false;
      resetting = true;
      forceNextScene = true; refreshRequested = true;
      publish({ error: false, message: "Загружаем сохранённую доску…" });
      forceCanonical(); schedule();
    },
    retry() { if (closed || state.accessDenied) return; refreshRequested = true; if (!validationBlocked) publish({ error: false }); schedule(); },
    destroy() { if (closed) return; closed = true; permissionEpoch++; lifetime.abort(); if (timer) clearTimeout(timer); clearPending(); canonical = undefined; rejectedProof = null; },
    getSnapshot() { return canonical; },
  };
  publish();
  return session;
}
