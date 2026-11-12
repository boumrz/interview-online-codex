import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { useDiagramExpansion as useCanvasExpansion } from "../diagram/useDiagramExpansion";
import { createWhiteboardSession, type WhiteboardConnection, type WhiteboardSession, type WhiteboardState } from "./whiteboardSession";
import type { WhiteboardElement } from "./whiteboardProtocol";
import type { WhiteboardCanvasHandle, WhiteboardExportFormat } from "./whiteboardCanvasTypes";
import styles from "./RoomWhiteboardPanel.module.css";
import { normalizeDrawingColor } from "../drawingColor";
import { DrawingColorIndicator, type DrawingParticipant } from "../DrawingColorIndicator";

const WhiteboardCanvas = lazy(() => import("./WhiteboardCanvas"));
export type RoomWhiteboardPanelProps = WhiteboardConnection & { active: boolean; refreshSignal: number; drawingColor?: string | null; drawingParticipants?: readonly DrawingParticipant[] };
const initialState: WhiteboardState = { loaded: false, editable: false, message: "Подготавливаем доску…", error: false, canDiscard: false, accessDenied: false, pending: 0 };

function download(blob: Blob, extension: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `interview-whiteboard.${extension}`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function MountedWhiteboardPanel(props: RoomWhiteboardPanelProps) {
  // An SSE reconnect can briefly have no assignment. Keep the native editor
  // and its manual color choice once the first server assignment arrived.
  const assignedColor = useRef<string | null>(null);
  assignedColor.current ??= normalizeDrawingColor(props.drawingColor);
  const drawingColor = assignedColor.current;
  const current = useRef(props); current.current = props;
  const session = useRef<WhiteboardSession | null>(null);
  const [canvas, setCanvas] = useState<WhiteboardCanvasHandle | null>(null);
  const [state, setState] = useState(initialState);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { panelRef, expanded, toggleExpanded } = useCanvasExpansion(props.active);
  const onReady = useCallback((handle: WhiteboardCanvasHandle | null) => setCanvas(handle), []);
  const onChange = useCallback((elements: readonly WhiteboardElement[]) => session.current?.observe(elements), []);

  useEffect(() => {
    if (!canvas) return;
    const controller = createWhiteboardSession({ current: () => current.current, onState: setState, onScene: (snapshot, replaceLocal) => canvas.applyScene(snapshot, replaceLocal) });
    session.current = controller;
    controller.refresh();
    return () => { controller.destroy(); if (session.current === controller) session.current = null; };
  }, [canvas]);
  useEffect(() => { session.current?.refresh(); }, [props.refreshSignal, props.connected, props.eventToken]);
  useEffect(() => { session.current?.permissionsChanged(); }, [props.readOnly]);
  useEffect(() => { if (state.accessDenied) canvas?.clear(); }, [state.accessDenied, canvas]);

  const exportSnapshot = async (format: WhiteboardExportFormat) => {
    const controller = session.current;
    const snapshot = controller?.getSnapshot();
    if (!canvas || !snapshot || !controller) return;
    setExporting(true); setExportError(null);
    try {
      const blob = await canvas.exportSnapshot(snapshot, format);
      if (session.current === controller && controller.getSnapshot()) download(blob, format);
    }
    catch { setExportError("Не удалось подготовить файл доски. Повторите экспорт."); }
    finally { setExporting(false); }
  };

  return <section ref={panelRef} aria-label="Доска интервью" aria-hidden={!props.active} data-whiteboard-expanded={expanded ? "true" : "false"} className={`${styles.panel} ${expanded ? styles.expanded : ""}`}>
    <div className={styles.toolbar}>
      <span role="status" className={`${styles.status} ${state.error || exportError ? styles.error : ""}`}>{exportError ?? state.message}</span>
      <DrawingColorIndicator color={drawingColor} participants={props.drawingParticipants} />
      <div className={styles.actions}>
        <Button aria-expanded={expanded} type="primary" ghost onClick={toggleExpanded}>{expanded ? "Вернуться в комнату" : "На весь экран"}</Button>
        {state.error && !state.canDiscard && !state.accessDenied && <Button onClick={() => session.current?.retry()}>Повторить</Button>}
        {state.canDiscard && <Button onClick={() => setConfirmDiscard(true)}>Вернуться к сохранённой доске</Button>}
        {(["excalidraw", "png", "svg"] as const).map(format => <Button key={format} disabled={!state.loaded || state.accessDenied || exporting || !props.connected} onClick={() => void exportSnapshot(format)}>{format === "excalidraw" ? ".excalidraw" : format.toUpperCase()}</Button>)}
      </div>
    </div>
    <div className={styles.body}>
      {drawingColor && !state.accessDenied && <div className={styles.canvas} data-testid="room-whiteboard-canvas" onDropCapture={event => {
        if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); }
      }}><Suspense fallback={<div className={styles.placeholder}>Подготавливаем редактор доски…</div>}><WhiteboardCanvas active={props.active} readOnly={props.readOnly || !state.editable} drawingColor={drawingColor} onReady={onReady} onChange={onChange} /></Suspense></div>}
      {(!state.loaded || state.accessDenied) && <div className={styles.placeholder}>{state.message}</div>}
    </div>
    <Modal getContainer={() => panelRef.current ?? document.body} open={confirmDiscard} title="Удалить несохранённые изменения доски?" okText="Загрузить сохранённую" cancelText="Оставить изменения" okButtonProps={{ danger: true }} onCancel={() => setConfirmDiscard(false)} onOk={() => { setConfirmDiscard(false); session.current?.reset(); }}>
      <p>Несохранённые изменения доски в этой вкладке будут удалены. Сохранённая версия останется.</p>
    </Modal>
  </section>;
}

export function RoomWhiteboardPanel(props: RoomWhiteboardPanelProps) {
  const context = useMemo(() => crypto.randomUUID(), [props.inviteCode, props.sessionId, props.authToken, props.ownerToken, props.interviewerToken]);
  const [activated, setActivated] = useState<string | null>(props.active ? context : null);
  useEffect(() => { if (props.active) setActivated(context); }, [props.active, context]);
  return props.active || activated === context ? <MountedWhiteboardPanel key={context} {...props} /> : null;
}
