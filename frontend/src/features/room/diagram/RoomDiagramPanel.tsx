import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "antd";
import { API_BASE_URL } from "../../../config/runtime";
import { roomRealtimeFetch } from "../roomRealtimeTransport";
import { useThemeMode } from "../../theme/ThemeProvider";
import { createDrawioBridge, type DrawioEvent } from "./drawioBridge";
import { createDiagramQueue, diagramOrderPatchFromXml, isDiagramRecord, parseDiagramDocument, parseDiagramOperation, readDrawioChecksum, type DiagramDocument, type PendingDiagramChange } from "./diagramProtocol";
import { classifyDiagramResponse } from "./diagramRequestPolicy";
import { useDiagramExpansion } from "./useDiagramExpansion";
import { normalizeDrawingColor } from "../drawingColor";
import { DrawingColorIndicator, type DrawingParticipant } from "../DrawingColorIndicator";
import { installDrawioDrawingDefaults } from "./drawioDrawingDefaults";
import styles from "./RoomDiagramPanel.module.css";

export type RoomDiagramPanelProps = {
  inviteCode: string;
  sessionId: string;
  authToken?: string | null;
  ownerToken?: string | null;
  interviewerToken?: string | null;
  eventToken?: string | null;
  connected: boolean;
  readOnly: boolean;
  active: boolean;
  refreshSignal: number;
  drawingColor?: string | null;
  drawingParticipants?: readonly DrawingParticipant[];
};

type PanelState = { loaded: boolean; editable: boolean; message: string; error: boolean; busy: boolean; preview?: string; presentationOnly: boolean; accessDenied: boolean; canDiscard: boolean };
type Bridge = ReturnType<typeof createDrawioBridge>;
type ExportFormat = "drawio" | "png" | "svg";
type Controller = { refresh(): void; permissionsChanged(): void; editorEvent(event: DrawioEvent, canonical: boolean): void; export(format: ExportFormat): void; destroy(): void };
const initialState: PanelState = { loaded: false, editable: false, message: "Подготавливаем схему…", error: false, busy: false, presentationOnly: false, accessDenied: false, canDiscard: false };

const editorUrl = "/drawio/?embed=1&proto=json&spin=1&configure=1&pages=0&offline=1&local=1&stealth=1&gapi=0&od=0&gh=0&gl=0&saveAndExit=0&noSaveBtn=1&noExitBtn=1&ui=kennedy&lang=ru";

function editorXml(event: DrawioEvent): string {
  if (typeof event.xml !== "string" || !event.xml.trim()) throw new Error("Редактор не вернул документ схемы");
  return event.xml;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function imageBlob(data: string, format: "png" | "svg"): Blob {
  const expected = format === "png" ? "image/png" : "image/svg+xml";
  const comma = data.indexOf(",");
  if (comma < 0 || !data.startsWith(`data:${expected}`)) throw new Error("Редактор не вернул файл изображения");
  const header = data.slice(0, comma);
  const content = data.slice(comma + 1);
  if (header.includes(";base64")) {
    const binary = atob(content);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: expected });
  }
  return new Blob([decodeURIComponent(content)], { type: expected });
}

function createController(options: {
  visible: Bridge;
  canonical: Bridge;
  current: () => RoomDiagramPanelProps;
  notify: (state: PanelState) => void;
  drawingColor: string;
  initializeDrawingDefaults(canonical: boolean): void;
}): Controller {
  const { visible, canonical } = options;
  const lifetime = new AbortController();
  let closed = false;
  let readyVisible = false;
  let readyCanonical = false;
  let visibleLoaded = false;
  let accepted: DiagramDocument | undefined;
  let queue = createDiagramQueue();
  let state = { ...initialState };
  let serial = Promise.resolve();
  let refreshQueued = false;
  let drainQueued = false;
  let permissionEpoch = 0;
  let verifiedSequence = -1;
  let validationBlocked = false;
  const configuredFrames = new Set<boolean>();
  const attempts = new Map<string, { diagramId: string; operationId: string; baseSequence: number; xml: string; patch: PendingDiagramChange["patch"]; checksum?: string }>();
  const update = (next: Partial<PanelState>) => {
    if (!closed) { state = { ...state, ...next }; options.notify(state); }
  };
  const editable = () => accepted?.canEdit === true && !options.current().readOnly;
  const savedStatus = () => { if (!validationBlocked) update({ message: !accepted ? options.current().connected ? "Подготавливаем схему…" : "Ожидаем подключение к комнате…" : !options.current().connected ? "Восстанавливаем связь · Новые изменения ещё не сохранены" : queue.size ? "Сохранение…" : editable() ? "Сохранено" : "Только просмотр · Сохранённая схема", error: false, editable: editable() }); };

  function fail(error: unknown): void {
    if (closed || lifetime.signal.aborted) return;
    if (error instanceof Error && error.name === "DiagramAuthorityPending") { update({ error: false, message: "Восстанавливаем подключение · Изменения ещё не сохранены" }); return; }
    update({ error: true, busy: false, message: error instanceof Error ? error.message : "Не удалось сохранить схему. Повторите действие." });
  }

  function schedule(job: () => Promise<void>): void {
    serial = serial.then(async () => { if (!closed) await job(); }).catch(fail);
  }

  async function request(method: "GET" | "POST", afterSequence?: number, body?: unknown): Promise<Response> {
    const props = options.current();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (props.authToken) headers.Authorization = `Bearer ${props.authToken}`;
    if (props.ownerToken) headers["X-Room-Owner-Token"] = props.ownerToken;
    if (props.interviewerToken) headers["X-Room-Interviewer-Token"] = props.interviewerToken;
    if (props.eventToken) headers["X-Room-Event-Token"] = props.eventToken;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const query = new URLSearchParams({ sessionId: props.sessionId });
    if (afterSequence !== undefined) query.set("afterSequence", String(afterSequence));
    const response = await roomRealtimeFetch(`${API_BASE_URL}/rooms/${encodeURIComponent(props.inviteCode)}/diagram${method === "POST" ? "/changes" : ""}?${query}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(12_000)]),
    });
    const action = classifyDiagramResponse(response.status, method, props.eventToken ?? null, options.current().eventToken ?? null, options.current().connected);
    if (action === "recover-proof") {
      const error = new Error("Ожидаем подтверждение нового подключения"); error.name = "DiagramAuthorityPending";
      controller.refresh(); throw error;
    }
    if (action === "reset-document") {
      validationBlocked = true;
      update({ canDiscard: true, error: true, message: "Изменение схемы отклонено. Несохранённые изменения остаются в этой вкладке." });
      throw new Error("Изменение схемы отклонено. Вернитесь к сохранённой схеме, чтобы продолжить.");
    }
    if (action === "deny-write") {
      queue.revoke(); attempts.clear(); permissionEpoch++;
      validationBlocked = false;
      if (accepted) accepted = { ...accepted, canEdit: false };
      update({ editable: false, preview: undefined, canDiscard: false, error: true, message: "Редактирование схемы больше недоступно" });
      controller.refresh();
      throw new Error("Редактирование схемы больше недоступно");
    }
    if (action === "deny-read") {
      queue.revoke(); attempts.clear(); permissionEpoch++;
      accepted = undefined; visibleLoaded = false;
      update({ loaded: false, editable: false, preview: undefined, error: true, accessDenied: true, message: "Схема недоступна. Доступ к комнате изменился." });
      throw new Error("Схема недоступна. Доступ к комнате изменился.");
    }
    return response;
  }

  async function canonicalLoad(xml: string): Promise<void> {
    await canonical.request("load", { xml, autosave: 0, diffSync: true });
  }

  async function preview(): Promise<void> {
    if (!accepted) return;
    await canonicalLoad(accepted.xml);
    const result = await canonical.request("export", { format: "svg", background: "#ffffff" });
    if (typeof result.data !== "string" || !result.data.startsWith("data:image/svg+xml")) throw new Error("Не удалось подготовить просмотр схемы");
    update({ preview: result.data });
  }

  async function restoreVisible(document: DiagramDocument): Promise<void> {
    update({ busy: visibleLoaded });
    await visible.request("load", { xml: document.xml, autosave: 1, diffSync: true });
    visibleLoaded = true;
    for (const pending of queue.changes) await visible.request("patch", { patch: pending.patch });
    await visible.request("patch", { patch: diagramOrderPatchFromXml(document.xml) });
    update({ busy: false, loaded: true });
  }

  async function verifyVisible(): Promise<void> {
    if (!accepted || queue.size || verifiedSequence === accepted.sequence) return;
    const document = accepted;
    await canonicalLoad(document.xml);
    const expected = await canonical.request("getDiff");
    const actual = await visible.request("getDiff");
    if (queue.size || accepted.sequence !== document.sequence) return;
    const expectedChecksum = readDrawioChecksum(expected.checksum);
    if (expectedChecksum !== readDrawioChecksum(actual.checksum)) {
      update({ busy: true, message: "Восстанавливаем сохранённую схему…" });
      await restoreVisible(document);
      const restored = await visible.request("getDiff");
      if (queue.size) return;
      if (readDrawioChecksum(restored.checksum) !== expectedChecksum) throw new Error("Не удалось согласовать схему. Повторите восстановление.");
    }
    verifiedSequence = document.sequence;
  }

  async function pull(): Promise<void> {
    if (!readyCanonical || !readyVisible || !options.current().connected) { savedStatus(); return; }
    const epoch = permissionEpoch;
    const previous = accepted;
    const response = await request("GET", previous?.sequence);
    if (!response.ok) throw new Error("Не удалось загрузить схему. Повторите действие.");
    const document = parseDiagramDocument(await response.json());
    if (closed || epoch !== permissionEpoch) return;
    if (previous && document.diagramId === previous.diagramId && document.sequence < previous.sequence) return;
    if (previous && document.diagramId !== previous.diagramId) { queue.revoke(); queue = createDiagramQueue(); attempts.clear(); visibleLoaded = false; }
    if (!document.canEdit || options.current().readOnly) { queue.revoke(); attempts.clear(); validationBlocked = false; update({ canDiscard: false }); }
    accepted = document;
    if (!visibleLoaded) await restoreVisible(document);
    else if (previous && document.sequence > previous.sequence) {
      const operations = document.operations.filter((operation) => operation.sequence > previous.sequence);
      const contiguous = !document.requiresSnapshot && operations.length === document.sequence - previous.sequence && operations.every((operation, index) => operation.sequence === previous.sequence + index + 1);
      if (!contiguous || operations.some((operation) => !operation.patch)) {
        for (const operation of operations) if (queue.acknowledge(operation.operationId)) attempts.delete(operation.operationId);
        await restoreVisible(document);
      } else {
        for (const operation of operations) {
          if (queue.acknowledge(operation.operationId)) attempts.delete(operation.operationId);
          else await visible.request("patch", { patch: operation.patch });
        }
        for (const pending of queue.changes) await visible.request("patch", { patch: pending.patch });
        await visible.request("patch", { patch: diagramOrderPatchFromXml(document.xml) });
      }
    }
    await verifyVisible();
    if (!editable()) await preview();
    savedStatus();
    drain();
  }

  async function sendHead(): Promise<void> {
    const head = queue.peek();
    if (!head || !accepted || !editable() || !options.current().connected || validationBlocked) return;
    const epoch = permissionEpoch;
    let attempt = attempts.get(head.operationId);
    if (!attempt) {
      await canonicalLoad(accepted.xml);
      await canonical.request("patch", { patch: head.patch });
      const result = await canonical.request("export", { format: "xml" });
      const check = await canonical.request("getDiff");
      attempt = { diagramId: accepted.diagramId, operationId: head.operationId, baseSequence: accepted.sequence, xml: editorXml(result), patch: head.patch };
      attempt.checksum = readDrawioChecksum(check.checksum);
      attempts.set(head.operationId, attempt);
    }
    if (closed || epoch !== permissionEpoch || !editable()) return;
    update({ message: "Сохранение…", error: false });
    const response = await request("POST", undefined, attempt);
    if (closed || epoch !== permissionEpoch || !editable()) return;
    if (response.status === 409) {
      attempts.delete(head.operationId);
      await pull();
      return;
    }
    if (!response.ok) throw new Error("Не удалось сохранить схему. Изменения остаются в открытой комнате.");
    const operation = parseDiagramOperation(await response.json());
    if (operation.operationId !== head.operationId) throw new Error("Не удалось подтвердить сохранение схемы");
    queue.acknowledge(head.operationId); attempts.delete(head.operationId);
    if (operation.xml === null) {
      await pull();
    } else if (operation.sequence > accepted.sequence) {
      accepted = { ...accepted, sequence: operation.sequence, xml: operation.xml, operations: [], requiresSnapshot: false };
      await visible.request("patch", { patch: head.patch });
      for (const pending of queue.changes) await visible.request("patch", { patch: pending.patch });
      await visible.request("patch", { patch: diagramOrderPatchFromXml(operation.xml) });
    }
    await verifyVisible();
    savedStatus();
    if (queue.size === 0) visible.send("status", { modified: false, message: "Сохранено" });
    drain();
  }

  function drain(): void {
    if (drainQueued || !queue.size || !editable() || !options.current().connected || validationBlocked) return;
    drainQueued = true;
    schedule(async () => { drainQueued = false; await sendHead(); });
  }

  const controller: Controller = {
    refresh() {
      if (refreshQueued) return;
      refreshQueued = true;
      schedule(async () => { refreshQueued = false; await pull(); });
    },
    permissionsChanged() {
      if (options.current().readOnly) { permissionEpoch++; queue.revoke(); attempts.clear(); validationBlocked = false; update({ editable: false, preview: undefined, canDiscard: false }); }
      else if (queue.size === 0) queue = createDiagramQueue();
      controller.refresh();
    },
    editorEvent(event, isCanonical) {
      const frame = isCanonical ? canonical : visible;
      if (event.event === "configure") {
        if (!configuredFrames.has(isCanonical)) {
          try { options.initializeDrawingDefaults(isCanonical); configuredFrames.add(isCanonical); }
          catch (error) { fail(error); return; }
        }
        // The embed adapts its own panels after a resize. Parent styles do not
        // cross the iframe, so suppress that motion through native config.
        // Configure only new objects; restoring shared XML never changes its
        // colors. Native manual choices remain local for the editor lifetime.
        // draw.io replaces its edge defaults instead of merging this object.
        frame.send("configure", { config: { defaultVertexStyle: { strokeColor: options.drawingColor, fontColor: options.drawingColor }, defaultEdgeStyle: { edgeStyle: "orthogonalEdgeStyle", rounded: "0", jettySize: "auto", orthogonalLoop: "1", defaultLabelBackgroundColor: "page", strokeColor: options.drawingColor, fontColor: options.drawingColor }, defaultLibraries: "general;flowchart;er;uml", noAutoFocus: true, defaultPageVisible: false, defaultGridEnabled: false, suppressNewWindows: true, enableCustomLibraries: false, customCss: ".geTabContainer{display:none!important}*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}", hideMenuItems: ["new", "open", "import", "importFrom", "export", "exportAs", "save", "saveAs", "pageSetup", "background", "backgroundImage", "plugins", "embed", "publish", "insertImage", "insertPage", "duplicatePage", "removePage", "renamePage", "pages"] } });
      }
      if (event.event === "init") {
        if (isCanonical) readyCanonical = true; else readyVisible = true;
        controller.refresh();
      }
      if (event.event === "autosave" && !isCanonical && visibleLoaded && editable()) {
        if (!isDiagramRecord(event.patch) || Object.keys(event.patch).length === 0) {
          update({ presentationOnly: true });
          return;
        }
        queue.enqueue({ operationId: crypto.randomUUID(), patch: event.patch });
        if (validationBlocked) return;
        update({ message: options.current().connected ? "Сохранение…" : "Нет связи · Изменения ещё не сохранены", error: false });
        drain();
      }
    },
    export(format) {
      schedule(async () => {
        await pull();
        if (closed || !accepted) return;
        update({ busy: true, message: "Подготавливаем файл…", error: false });
        if (format === "drawio") download(new Blob([accepted.xml], { type: "application/xml;charset=utf-8" }), "interview-diagram.drawio");
        else {
          await canonicalLoad(accepted.xml);
          const result = await canonical.request("export", { format });
          if (closed || !accepted) return;
          if (typeof result.data !== "string") throw new Error("Не удалось подготовить файл схемы");
          download(imageBlob(result.data, format), `interview-diagram.${format}`);
        }
        update({ busy: false }); savedStatus();
      });
    },
    destroy() { closed = true; permissionEpoch++; queue.revoke(); attempts.clear(); accepted = undefined; state = { ...initialState }; lifetime.abort(); visible.destroy(); canonical.destroy(); },
  };
  return controller;
}

function MountedRoomDiagramPanel(props: RoomDiagramPanelProps) {
  const assignedColor = useRef<string | null>(null);
  assignedColor.current ??= normalizeDrawingColor(props.drawingColor);
  const drawingColor = assignedColor.current;
  const { panelRef, expanded, toggleExpanded } = useDiagramExpansion(props.active);
  const current = useRef(props); current.current = props;
  const visible = useRef<HTMLIFrameElement>(null);
  const canonical = useRef<HTMLIFrameElement>(null);
  const controller = useRef<Controller | null>(null);
  const [state, setState] = useState<PanelState>(initialState);
  const [retry, setRetry] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { mode } = useThemeMode();
  // A theme update changes surrounding controls without reloading the editor or
  // dropping its local undo history. The initial embedded theme is fixed once.
  const initialTheme = useRef(mode);

  useEffect(() => {
    if (!drawingColor) return;
    const visibleWindow = visible.current?.contentWindow;
    const canonicalWindow = canonical.current?.contentWindow;
    if (!visibleWindow || !canonicalWindow) return;
    canonical.current?.setAttribute("inert", "");
    setState(initialState);
    const bridge = (source: Window, isCanonical: boolean) => createDrawioBridge({ source, origin: window.location.origin, post: (message, origin) => source.postMessage(message, origin), onEvent: (event) => controller.current?.editorEvent(event, isCanonical) });
    const visibleBridge = bridge(visibleWindow, false);
    const canonicalBridge = bridge(canonicalWindow, true);
    const session = createController({ visible: visibleBridge, canonical: canonicalBridge, current: () => current.current, notify: setState, drawingColor, initializeDrawingDefaults: isCanonical => installDrawioDrawingDefaults(isCanonical ? canonicalWindow : visibleWindow, drawingColor) });
    controller.current = session;
    const receive = (event: MessageEvent) => { visibleBridge.receive(event); canonicalBridge.receive(event); };
    window.addEventListener("message", receive);
    const loadingTimeout = setTimeout(() => setState((previous) => previous.loaded ? previous : { ...previous, error: true, message: "Не удалось загрузить редактор схемы. Повторите действие." }), 25_000);
    return () => { clearTimeout(loadingTimeout); window.removeEventListener("message", receive); session.destroy(); if (controller.current === session) controller.current = null; };
  }, [props.inviteCode, props.sessionId, retry, state.accessDenied, drawingColor]);

  useEffect(() => { controller.current?.refresh(); }, [props.refreshSignal, props.connected, props.eventToken]);
  useEffect(() => { controller.current?.permissionsChanged(); }, [props.readOnly]);

  const url = `${editorUrl}&dark=${initialTheme.current === "dark" ? "1" : "0"}`;
  const readonly = props.readOnly || (state.loaded && !state.editable);
  return <section ref={panelRef} className={`${styles.panel} ${expanded ? styles.expanded : ""}`} aria-label="Схема интервью" aria-hidden={!props.active} data-diagram-expanded={expanded ? "true" : "false"}>
    <div className={styles.toolbar}>
      <span role="status" className={`${styles.status} ${state.error ? styles.error : ""}`}>{state.message}</span>
      <DrawingColorIndicator color={drawingColor} participants={props.drawingParticipants} />
      <div className={styles.exports}>
        <button type="button" className={`${styles.button} ${styles.expandButton}`} aria-expanded={expanded} onClick={toggleExpanded}>{expanded ? "Вернуться в комнату" : "На весь экран"}</button>
        {state.error && !state.canDiscard && <button type="button" className={styles.button} onClick={() => { if (state.loaded) controller.current?.refresh(); else { setState(initialState); setRetry((value) => value + 1); } }}>Повторить</button>}
        {state.canDiscard && <button type="button" className={styles.button} onClick={() => setConfirmDiscard(true)}>Вернуться к сохранённой схеме</button>}
        {(["drawio", "png", "svg"] as const).map((format) => <button key={format} type="button" className={styles.button} disabled={!state.loaded || state.busy || !props.connected} onClick={() => controller.current?.export(format)}>{format === "drawio" ? ".drawio" : format.toUpperCase()}</button>)}
      </div>
    </div>
    {state.presentationOnly && <p className={styles.notice}>Настройки вида холста действуют в этой вкладке. Фигуры и наброски сохраняются для всех.</p>}
    <div className={styles.body}>
      {drawingColor && !state.accessDenied && <iframe key={`visible-${retry}`} ref={visible} title="Редактор схемы" src={url} className={`${styles.frame} ${readonly ? styles.hidden : ""} ${!state.loaded ? styles.loadingFrame : ""}`} tabIndex={readonly || !props.active || !state.loaded ? -1 : 0} sandbox="allow-scripts allow-same-origin allow-downloads" />}
      {readonly && state.preview && <img className={styles.preview} src={state.preview} alt="Сохранённая схема интервью" />}
      {(!state.loaded || (readonly && !state.preview)) && <div className={styles.placeholder}>{state.error ? state.message : readonly ? "Подготавливаем просмотр схемы…" : "Подготавливаем схему…"}</div>}
      {state.busy && <div className={styles.busy} aria-live="polite">Подготавливаем схему…</div>}
    </div>
    {drawingColor && !state.accessDenied && <iframe key={`canonical-${retry}`} ref={canonical} title="Подготовка сохранённой схемы" src={url} className={styles.canonical} tabIndex={-1} aria-hidden="true" sandbox="allow-scripts allow-same-origin" />}
    <Modal getContainer={() => panelRef.current ?? document.body} open={confirmDiscard} title="Удалить несохранённые изменения?" okText="Загрузить сохранённую" cancelText="Оставить изменения" okButtonProps={{ danger: true }} onCancel={() => setConfirmDiscard(false)} onOk={() => { setConfirmDiscard(false); setState(initialState); setRetry((value) => value + 1); }}>
      <p>Все несохранённые изменения схемы в этой вкладке будут удалены. Сохранённая версия останется.</p>
    </Modal>
  </section>;
}

export function RoomDiagramPanel(props: RoomDiagramPanelProps) {
  // Context keys are random nonces, so credentials never enter a DOM identity.
  // Event-token renewal is not a context change and preserves history/queues.
  const context = useMemo(() => crypto.randomUUID(), [props.inviteCode, props.sessionId, props.authToken, props.ownerToken, props.interviewerToken]);
  const [activatedContext, setActivatedContext] = useState<string | null>(props.active ? context : null);
  useEffect(() => { if (props.active) setActivatedContext(context); }, [props.active, context]);
  return props.active || activatedContext === context ? <MountedRoomDiagramPanel key={context} {...props} /> : null;
}
