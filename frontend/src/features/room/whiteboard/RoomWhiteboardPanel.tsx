import { useCanvasPresence } from "../useCanvasPresence";
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { useDiagramExpansion as useCanvasExpansion } from "../diagram/useDiagramExpansion";
import { createWhiteboardSession, type WhiteboardConnection, type WhiteboardSession, type WhiteboardState } from "./whiteboardSession";
import type { WhiteboardElement, WhiteboardFiles } from "./whiteboardProtocol";
import type { WhiteboardCanvasHandle, WhiteboardExportFormat } from "./whiteboardCanvasTypes";
import styles from "./RoomWhiteboardPanel.module.css";
import { normalizeDrawingColor } from "../drawingColor";
import { RoomCanvasToolbar } from "../RoomCanvasToolbar";
import { TaskCanvasSessions, type TaskCanvasLifecycle } from "../TaskCanvasSessions";

const WhiteboardCanvas = lazy(() => import("./WhiteboardCanvas"));
export type RoomWhiteboardPanelProps = WhiteboardConnection & { active: boolean; refreshSignal: number; drawingColor?: string | null };
const initialState: WhiteboardState = { loaded: false, editable: false, message: "Подготавливаем доску…", error: false, canDiscard: false, accessDenied: false, pending: 0 };

function download(blob: Blob, extension: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `interview-whiteboard.${extension}`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function MountedWhiteboardPanel(props: RoomWhiteboardPanelProps & TaskCanvasLifecycle) {
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
  const presence = useCanvasPresence(props, props.active && state.loaded && !state.accessDenied, "whiteboard");
  const canExport = props.active && props.connected && state.loaded && !state.accessDenied && !exporting;
  const { panelRef, expanded, toggleExpanded } = useCanvasExpansion(props.active);
  const onReady = useCallback((handle: WhiteboardCanvasHandle | null) => setCanvas(handle), []);
  const onChange = useCallback((elements: readonly WhiteboardElement[], files?: WhiteboardFiles) => session.current?.observe(elements, files), []);

  useEffect(() => {
    if (!canvas) return;
    const controller = createWhiteboardSession({ current: () => current.current, onState: setState, onScene: (snapshot, replaceLocal) => canvas.applyScene(snapshot, replaceLocal) });
    session.current = controller;
    controller.refresh();
    return () => { controller.destroy(); if (session.current === controller) session.current = null; };
  }, [canvas]);
  const refreshSignal = props.retiring ? undefined : props.refreshSignal;
  useEffect(() => { session.current?.refresh(); }, [refreshSignal, props.connected, props.eventToken]);
  useEffect(() => { session.current?.permissionsChanged(); }, [props.readOnly]);
  useEffect(() => { if (state.accessDenied) canvas?.clear(); }, [state.accessDenied, canvas]);
  useEffect(() => {
    if (!props.retiring) return;
    // Read the SDK scene once more in case React has not delivered the final
    // native onChange yet. Keep the task session until its own writes settle.
    canvas?.flushLocalChanges();
    if (!session.current?.hasUnsavedChanges()) props.release(props.taskId);
  }, [props.retiring, props.taskId, props.release, canvas, state.pending, state.canDiscard, state.accessDenied]);

  const exportSnapshot = async (format: WhiteboardExportFormat) => {
    const controller = session.current;
    const snapshot = controller?.getSnapshot();
    if (!canExport || !canvas || !snapshot || !controller) return;
    setExporting(true); setExportError(null);
    try {
      const blob = await canvas.exportSnapshot(snapshot, format);
      if (current.current.active && current.current.connected && session.current === controller && controller.getSnapshot()) download(blob, format);
    }
    catch { setExportError("Не удалось подготовить файл доски. Повторите экспорт."); }
    finally { setExporting(false); }
  };

  return <section ref={panelRef} hidden={props.retiring} data-canvas-task-id={props.taskId ?? ""} aria-label="Доска интервью" aria-hidden={!props.active} data-whiteboard-expanded={expanded ? "true" : "false"} data-learning-canvas-expanded={expanded ? "true" : undefined} className={`${styles.panel} ${expanded ? styles.expanded : ""}`}>
    <RoomCanvasToolbar expanded={expanded} onToggleExpanded={toggleExpanded}
      color={drawingColor}
      onApplyColor={props.active && !props.readOnly && state.editable && canvas && drawingColor
        ? () => canvas.setDrawingColor(drawingColor) : undefined}
      nativeFormat="excalidraw" canDownload={canExport} onDownload={exportSnapshot}
      status={exportError ?? state.message} error={state.error || !!exportError}>
      {state.error && !state.canDiscard && !state.accessDenied && <Button onClick={() => session.current?.retry()}>Повторить</Button>}
      {state.canDiscard && <Button onClick={() => setConfirmDiscard(true)}>Вернуться к сохранённой доске</Button>}
    </RoomCanvasToolbar>
    <div className={styles.body} data-learning-anchor="room-whiteboard-view">
      {drawingColor && !state.accessDenied && <div className={styles.canvas} data-testid="room-whiteboard-canvas"><Suspense fallback={<div className={styles.placeholder}>Подготавливаем редактор доски…</div>}><WhiteboardCanvas active={props.active} readOnly={props.readOnly || !state.editable} drawingColor={drawingColor} cursors={presence.cursors} onCursor={presence.point} onReady={onReady} onChange={onChange} /></Suspense></div>}
      {(!state.loaded || state.accessDenied) && <div className={styles.placeholder}>{state.message}</div>}
    </div>
    <Modal getContainer={() => panelRef.current ?? document.body} open={confirmDiscard} title="Удалить несохранённые изменения доски?" okText="Загрузить сохранённую" cancelText="Оставить изменения" okButtonProps={{ danger: true }} onCancel={() => setConfirmDiscard(false)} onOk={() => { setConfirmDiscard(false); session.current?.reset(); }}>
      <p>Несохранённые изменения доски в этой вкладке будут удалены. Сохранённая версия останется.</p>
    </Modal>
  </section>;
}

export function RoomWhiteboardPanel(props: RoomWhiteboardPanelProps) {
  const context = useMemo(() => crypto.randomUUID(), [props.inviteCode, props.sessionId, props.authToken, props.ownerToken, props.interviewerToken]);
  return <TaskCanvasSessions key={context} taskId={props.taskId} active={props.active}>
    {session => <MountedWhiteboardPanel {...props} {...session} active={props.active && !session.retiring} />}
  </TaskCanvasSessions>;
}
