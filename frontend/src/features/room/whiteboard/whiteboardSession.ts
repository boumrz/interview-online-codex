import { API_BASE_URL } from "../../../config/runtime";
import { trackClientError, type ClientErrorCode } from "../../../services/analytics";
import { classifyDiagramResponse } from "../diagram/diagramRequestPolicy";
import { matchesCanvasTask, canvasTaskMismatch } from "../canvasTaskScope";
import { roomRealtimeFetch, withRoomRequestDeadline } from "../roomRealtimeTransport";
import { compareElementVersions, elementFingerprint, parseAck, parseElement, parseFiles, parseSnapshot, type WhiteboardChange, type WhiteboardElement, type WhiteboardFile, type WhiteboardFiles, type WhiteboardSnapshot } from "./whiteboardProtocol";

export type WhiteboardConnection = {
  taskId: string | null;
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
  observe(elements: ReadonlyArray<WhiteboardElement>, files?: WhiteboardFiles): void;
  permissionsChanged(): void;
  reset(): void;
  retry(): void;
  destroy(): void;
  hasUnsavedChanges(): boolean;
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
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
class SessionError extends Error {}

function authorityPending(): SessionError {
  const error = new SessionError("Ожидаем подтверждение нового подключения");
  error.name = "WhiteboardAuthorityPending";
  return error;
}

function report(method: "GET" | "POST", code: ClientErrorCode, status?: number): void {
  trackClientError(method === "GET" ? "whiteboard_load" : "whiteboard_save", code, status);
}

function requestFailure(method: "GET" | "POST", code: ClientErrorCode, detail: string, status?: number): SessionError {
  report(method, code, status);
  return new SessionError(`${method === "GET" ? "Не удалось загрузить доску" : "Не удалось сохранить доску"}. ${detail}`);
}

export function createWhiteboardSession(options: WhiteboardSessionOptions): WhiteboardSession {
  const lifetime = new AbortController();
  const { taskId } = options.current();
  const fetcher = options.fetch ?? fetch;
  const throttle = Math.max(0, options.throttleMs ?? 200);
  const pending = new Map<string, WhiteboardElement>();
  const pendingFiles = new Map<string, WhiteboardFile>();
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
  let forceNextScene = true;
  let scopeMismatch = false;
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
  function editable(): boolean { return !scopeMismatch && !resetting && authorizedToEdit(); }
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
    if (state.accessDenied || validationBlocked || scopeMismatch) { publish(); return; }
    publish({ error: false, message: !canonical ? ready() ? "Подготавливаем доску…" : "Ожидаем подключение к комнате…"
      : !editable() ? "Только просмотр · Сохранённая доска"
        : !ready() ? pending.size ? "Восстанавливаем связь · Новые изменения ещё не сохранены" : "Восстанавливаем связь…"
          : pending.size || attempt ? "Сохранение…" : "Сохранено" });
  }
  function block(): void {
    validationBlocked = true;
    publish({ error: true, message: "Изменение доски отклонено. Несохранённые изменения остаются в этой вкладке." });
  }
  function rejectDraft(status?: number): void {
    report("POST", "draft_rejected", status);
    block();
  }
  function verifyScope(body: unknown, method: "GET" | "POST", status: number): boolean {
    scopeMismatch = !matchesCanvasTask(body, taskId);
    if (scopeMismatch) {
      report(method, "invalid_scope", status);
      publish({ error: true, message: canvasTaskMismatch });
    }
    return !scopeMismatch;
  }
  function clearPending(): void { pending.clear(); pendingFiles.clear(); acknowledged.clear(); attempt = undefined; }
  function forceCanonical(): void { if (canonical) options.onScene(canonical, true); }
  function denyRead(): void {
    permissionEpoch++; clearPending(); validationBlocked = false; resetting = false; writeDenied = true;
    if (canonical) options.onScene({ ...canonical, elements: [], files: {}, canEdit: false }, true);
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
    const query = new URLSearchParams({ sessionId: connection.sessionId, taskId: taskId ?? "" });
    if (method === "GET" && canonical) {
      const known: string[] = [];
      let size = 0;
      for (const id of Object.keys(canonical.files)) {
        if (size + id.length + 1 > 5500) break;
        known.push(id); size += id.length + 1;
      }
      if (known.length) query.set("knownFileIds", known.join(","));
    }
    const url = `${API_BASE_URL}/rooms/${encodeURIComponent(connection.inviteCode)}/whiteboard${method === "POST" ? "/changes" : ""}?${query}`;
    const obsolete = () => closed || epoch !== permissionEpoch;
    const currentProof = () => {
      const current = options.current();
      return current.connected && current.eventToken === connection.eventToken;
    };
    // Keep the deadline through the response body: a board may carry 20 MiB
    // of raster files before base64 encoding.
    return withRoomRequestDeadline(120_000, async (signal, timedOut) => {
      let response: Response;
      try {
        response = await roomRealtimeFetch(url, { method, headers, body, signal }, fetcher);
      } catch {
        if (obsolete()) return undefined;
        if (!currentProof()) throw authorityPending();
        if (timedOut()) throw requestFailure(method, "request_timeout", "Время ожидания истекло. Повторите действие.");
        throw requestFailure(method, "network_failure", "Проверьте соединение и повторите действие.");
      }
      if (obsolete()) return undefined;
      const status = response.status;
      if (!response.ok && !currentProof()) throw authorityPending();
      let data: unknown;
      if (status === 403) {
        data = await response.json().catch(() => undefined);
        if (obsolete()) return undefined;
        if (!currentProof()) throw authorityPending();
        if (typeof data === "object" && data !== null && "code" in data && data.code === "ROOM_EVENT_CAPABILITY_STALE") {
          // An expired connection proof can be detected before the browser reconnects.
          rejectedProof = connection.eventToken ?? null;
          throw authorityPending();
        }
      }
      const current = options.current();
      const action = classifyDiagramResponse(status, method, connection.eventToken ?? null, current.eventToken ?? null, current.connected);
      if (action === "deny-read") { report(method, "access_denied", status); denyRead(); return undefined; }
      if (action === "deny-write") { report(method, "access_denied", status); denyWrite(); refreshRequested = true; return undefined; }
      if (action === "reset-document") { rejectDraft(status); return undefined; }
      if (action === "recover-proof") throw authorityPending();
      if (action === "conflict" && method === "POST") return { action, status, data, epoch, proof: connection.eventToken };
      if (action !== "accepted") {
        throw requestFailure(method, "http_failure", `Ошибка HTTP ${status}. Повторите действие.`, status);
      }
      try { data = await response.json(); }
      catch (error) {
        if (obsolete()) return undefined;
        if (!currentProof()) throw authorityPending();
        if (timedOut()) throw requestFailure(method, "request_timeout", "Время ожидания истекло. Повторите действие.", status);
        const code = error instanceof SyntaxError ? "invalid_json" : "body_failure";
        throw requestFailure(method, code, "Не удалось прочитать ответ сервера. Повторите действие.", status);
      }
      return obsolete() ? undefined : { action, status, data, epoch, proof: connection.eventToken };
    }, lifetime.signal);
  }

  async function pull(): Promise<boolean> {
    const result = await request("GET");
    if (!result || closed || result.epoch !== permissionEpoch) return false;
    const { data: body, status: httpStatus } = result;
    if (!ready() || result.proof !== options.current().eventToken) {
      // A valid 200 may project canEdit=false for a superseded capability. Only
      // current authority can revoke a draft or switch the canvas to readonly.
      if (ready()) { refreshRequested = true; schedule(); }
      return false;
    }
    if (!verifyScope(body, "GET", httpStatus)) return false;
    // Never attach cached private bytes to a response for another board/task.
    if (canonical && typeof body === "object" && body !== null && "boardId" in body && body.boardId !== canonical.boardId) {
      report("GET", "invalid_scope", httpStatus); block(); return false;
    }
    let incoming: WhiteboardSnapshot;
    try { incoming = parseSnapshot(body, canonical?.files); }
    catch { throw requestFailure("GET", "invalid_snapshot", "Сервер вернул некорректный снимок доски. Повторите действие.", httpStatus); }
    if (incoming.sequence < Math.max(minimumSequence, canonical?.sequence ?? 0)) throw requestFailure("GET", "stale_snapshot", "Сервер вернул устаревшую версию. Повторите действие.", httpStatus);
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
      for (const id of pendingFiles.keys()) if (Object.hasOwn(incoming.files, id)) pendingFiles.delete(id);
    }
    try { options.onScene(incoming, force); }
    catch { throw requestFailure("GET", "scene_failure", "Редактор не смог отобразить сохранённую доску. Повторите действие.", httpStatus); }
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
    const files: Record<string, WhiteboardFile> = {};
    let bytes = new TextEncoder().encode(JSON.stringify({ ...base, elements: [] })).byteLength;
    let fileBytes = 0;
    for (const element of pending.values()) {
      const size = new TextEncoder().encode(JSON.stringify(element)).byteLength;
      const fileId = element.type === "image" ? String(element.fileId) : undefined;
      const file = fileId && !Object.hasOwn(canonical.files, fileId) && !Object.hasOwn(files, fileId) ? pendingFiles.get(fileId) : undefined;
      const extraBytes = file ? new TextEncoder().encode(JSON.stringify({ [file.id]: file })).byteLength : 0;
      if (bytes + size + (elements.length ? 1 : 0) > MAX_BATCH_BYTES || bytes + size + fileBytes + extraBytes + 32 > MAX_REQUEST_BYTES) {
        if (!elements.length) rejectDraft();
        break;
      }
      bytes += size + (elements.length ? 1 : 0);
      if (file) { files[file.id] = file; fileBytes += extraBytes; }
      elements.push(element);
    }
    if (!elements.length) return undefined;
    const change: WhiteboardChange = Object.freeze({ ...base, elements: Object.freeze(elements), ...(Object.keys(files).length ? { files: Object.freeze(files) } : {}) });
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
    if (!result || closed || result.epoch !== permissionEpoch || attempt !== sent) return "stopped";
    if (result.action === "conflict") return "conflict";
    if (!verifyScope(result.data, "POST", result.status)) return "stopped";
    const invalidAck = () => requestFailure("POST", "invalid_ack", "Сервер вернул некорректное подтверждение. Повторите действие.", result.status);
    let ack: ReturnType<typeof parseAck>;
    try { ack = parseAck(result.data); }
    catch { throw invalidAck(); }
    if (ack.boardId !== sent.change.boardId || ack.operationId !== sent.change.operationId || ack.sequence < sent.change.baseSequence) throw invalidAck();
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
    let method: "GET" | "POST" = "GET";
    try {
      while (!closed && ready()) {
        if (refreshRequested || !canonical) {
          method = "GET";
          refreshRequested = false;
          if (!await pull()) break;
        }
        if (closed || !ready() || validationBlocked || !editable()) break;
        if (!attempt && pending.size === 0) { status(); break; }
        const wait = nextWriteAt - Date.now();
        if (wait > 0) { schedule(wait); break; }
        method = "POST";
        const outcome = await push();
        if (outcome === "stopped") {
          if (refreshRequested && !state.accessDenied) continue;
          break;
        }
        if (outcome === "conflict" && ++conflicts > 1) throw requestFailure("POST", "conflict", "Версия доски изменилась. Повторите действие.", 409);
        refreshRequested = true;
      }
      if (!closed && !ready()) status();
    } catch (error) {
      if (!closed && !lifetime.signal.aborted) {
        if (error instanceof Error && error.name === "WhiteboardAuthorityPending") {
          publish({ error: false, message: "Восстанавливаем подключение · Изменения ещё не сохранены" });
          if (ready()) { refreshRequested = true; schedule(); }
        } else {
          if (!(error instanceof SessionError)) report(method, "session_failure");
          publish({ error: true, message: error instanceof SessionError ? error.message : "Не удалось обновить доску. Повторите действие." });
        }
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
    observe(elements, files = {}) {
      if (closed || !canonical || !editable()) return;
      try {
        const accepted = new Map(canonical.elements.map(element => [element.id, element]));
        const changes: WhiteboardElement[] = [];
        const incomingFiles: Record<string, WhiteboardFile> = {};
        for (const element of elements) {
          const fingerprint = elementFingerprint(element);
          if (acknowledged.get(element.id)?.fingerprint === fingerprint) continue;
          const remote = accepted.get(element.id);
          if (remote && compareElementVersions(element, remote) <= 0) continue;
          const previous = pending.get(element.id);
          if (previous && compareElementVersions(element, previous) <= 0) continue;
          const parsed = parseElement(element);
          if (parsed.type === "image") {
            const id = String(parsed.fileId);
            const known = canonical.files[id] ?? pendingFiles.get(id);
            const supplied = files[id];
            if (!known && !supplied) throw new Error("Missing image");
            if (known && supplied && (known.dataURL !== supplied.dataURL || known.mimeType !== supplied.mimeType)) throw new Error("Image identifier reused");
            if (!known && supplied) incomingFiles[id] = supplied;
          }
          changes.push(parsed);
        }
        // Validate the complete retained asset budget before mutating the draft.
        if (Object.keys(incomingFiles).length) {
          const validated = parseFiles({ ...canonical.files, ...Object.fromEntries(pendingFiles), ...incomingFiles });
          for (const file of Object.values(validated)) if (!Object.hasOwn(canonical.files, file.id)) pendingFiles.set(file.id, file);
        }
        for (const element of changes) pending.set(element.id, element);
        if (pending.size > 5000) rejectDraft();
        else status();
        if (!validationBlocked && (pending.size || attempt)) schedule(Math.max(0, nextWriteAt - Date.now()));
      } catch { rejectDraft(); }
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
    hasUnsavedChanges() { return pending.size > 0 || attempt !== undefined || validationBlocked; },
  };
  publish();
  return session;
}
