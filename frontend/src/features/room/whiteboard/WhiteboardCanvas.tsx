import "./excalidrawAssets";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, convertToExcalidrawElements, exportToBlob, exportToSvg, isInvisiblySmallElement, reconcileElements, restoreElements, serializeAsJSON, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useThemeMode } from "../../theme/ThemeProvider";
import { parseElement, type WhiteboardElement } from "./whiteboardProtocol";
import type { WhiteboardCanvasHandle, WhiteboardCanvasProps } from "./whiteboardCanvasTypes";
import { usePenHover } from "./usePenHover";
import penHoverStyles from "./PenHover.module.css";
import { WhiteboardTools } from "./WhiteboardTools";
import styles from "./WhiteboardTools.module.css";

// Scope shortcuts to the visible tools. Text entry and normal browser shortcuts
// keep their default behavior; only the SDK's canvas key handler is bypassed.
function limitCanvasShortcuts(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!(event.target instanceof HTMLElement) || event.target.closest("textarea, input, [contenteditable=true]")) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    // Excalidraw recognises physical undo/redo keys on non-Latin layouts.
    const physicalHistoryKey = !/^[a-z]$/.test(key) && (event.code === "KeyZ" || (!event.shiftKey && event.code === "KeyY"));
    if (!event.altKey && (physicalHistoryKey || key === "z" || (!event.shiftKey && ["a", "c", "v", "x", "y", "+", "=", "-", "0"].includes(key)))) return;
  } else if (!event.altKey) {
    if (["shift", "escape", "enter", "tab", " ", "delete", "backspace", "pageup", "pagedown"].includes(key) || key.startsWith("arrow")) return;
    if (!event.shiftKey && ["p", "v", "l", "r", "t", "e"].includes(key)) return;
  }
  event.stopPropagation();
}

// Native object paste regenerates IDs, bindings and ordering for copied
// elements. All other clipboard text is a literal, single board label.
function isCopiedScene(text: string): boolean {
  if (!text.trimStart().startsWith("{")) return false;
  try {
    const payload = JSON.parse(text);
    return payload?.type === "excalidraw/clipboard" && Array.isArray(payload.elements);
  } catch { return false; }
}

function restoreScene(elements: readonly WhiteboardElement[]) {
  // The server validates native element JSON. The SDK boundary restores its
  // defaults, ordering and bindings before anything is rendered or reconciled.
  return restoreElements(elements as readonly ExcalidrawElement[], null, { repairBindings: true });
}

export default React.memo(function WhiteboardCanvas({ active, readOnly, drawingColor, onReady, onChange }: WhiteboardCanvasProps) {
  const { mode } = useThemeMode();
  const callback = useRef(onChange); callback.current = onChange;
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const sdkRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const pointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const [activeTool, setActiveTool] = useState<AppState["activeTool"]["type"]>("freedraw");
  const [color, setColor] = useState(drawingColor);
  const getAppState = useCallback(() => sdkRef.current?.getAppState(), []);
  const { hostRef, previewRef, onAppStateChange } = usePenHover({ active, readOnly, getAppState });
  const focusCanvas = useCallback(() => {
    hostRef.current?.querySelector<HTMLElement>(".excalidraw")?.focus({ preventScroll: true });
  }, [hostRef]);
  const observeElements = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    // Match native collaboration: an unfinished new shape is local. In
    // particular, restoreElements normalizes an empty text placeholder into a
    // tombstone; sending it would let a peer delete text still being entered.
    // Explicit deletions always travel, including zero-sized tombstones.
    callback.current(elements.filter(element => element.isDeleted || (!isInvisiblySmallElement(element) && !(element.type === "text" && element.text === ""))));
  }, []);
  const observe = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
    if (appState.contextMenu) {
      // The SDK opens its menu directly on a touch hold, without dispatching
      // a DOM contextmenu event.
      sdkRef.current?.updateScene({ appState: { contextMenu: null }, captureUpdate: CaptureUpdateAction.NEVER });
      if (hostRef.current?.contains(document.activeElement)) focusCanvas();
    }
    onAppStateChange(appState);
    setActiveTool(appState.activeTool.type);
    setColor(appState.currentItemStrokeColor);
    observeElements(elements);
  }, [observeElements, onAppStateChange, focusCanvas, hostRef]);

  function pasteOnCanvas(event: React.ClipboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || event.target.closest("textarea, input, [contenteditable=true]")) return;
    const sdk = sdkRef.current;
    const text = event.clipboardData.getData("text/plain");
    const hasFiles = event.clipboardData.files.length > 0;
    if (active && !readOnly && sdk && !hasFiles && isCopiedScene(text)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!active || readOnly || !sdk || hasFiles || !text.trim()) return;
    const state = sdk.getAppState();
    const position = pointer.current ?? { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 };
    const point = viewportCoordsToSceneCoords(position, state);
    const originalText = text.replace(/\r\n?/g, "\n");
    const labels = convertToExcalidrawElements([{
      type: "text", ...point, text: originalText, originalText, strokeColor: state.currentItemStrokeColor,
      fontFamily: state.currentItemFontFamily, fontSize: state.currentItemFontSize,
    }]);
    sdk.updateScene({ elements: [...sdk.getSceneElementsIncludingDeleted(), ...labels], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  const setDrawingColor = useCallback((value: string) => {
    sdkRef.current?.updateScene({ appState: { currentItemStrokeColor: value }, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  const attach = useCallback((sdk: ExcalidrawImperativeAPI) => {
    if (sdkRef.current === sdk) return;
    sdkRef.current = sdk;
    let firstScene = true;
    const handle: WhiteboardCanvasHandle = {
      flushLocalChanges() { observeElements(sdk.getSceneElementsIncludingDeleted()); },
      setDrawingColor,
      applyScene(snapshot, replaceLocal) {
        const restored = restoreScene(snapshot.elements);
        // RemoteExcalidrawElement is an SDK provenance brand, not serialized
        // data. This is the sole boundary assigning that brand to server data.
        const current = sdk.getSceneElementsIncludingDeleted();
        const next = replaceLocal ? restored : reconcileElements(current, restored as RemoteExcalidrawElement[], sdk.getAppState());
        const unchanged = current.length === next.length && current.every((element, index) => element.id === next[index].id && element.version === next[index].version && element.versionNonce === next[index].versionNonce);
        // Own ACKs usually leave the visible scene untouched. Avoid a native
        // remote-update cycle while a local stroke or text entry is in flight.
        if (replaceLocal || !unchanged) sdk.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
        if (replaceLocal || firstScene) sdk.history.clear();
        if (firstScene && next.some(element => !element.isDeleted)) {
          sdk.scrollToContent(next, { fitToViewport: true, animate: false });
        }
        firstScene = false;
      },
      clear() {
        sdk.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
        sdk.history.clear();
      },
      async exportSnapshot(snapshot, format) {
        const elements = restoreScene(snapshot.elements);
        const appState = { ...sdk.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" };
        if (format === "excalidraw") {
          return new Blob([serializeAsJSON(elements, appState, {}, "local")], { type: "application/json" });
        }
        if (format === "svg") {
          const svg = await exportToSvg({ elements, appState, files: {} });
          return new Blob([svg.outerHTML], { type: "image/svg+xml" });
        }
        return exportToBlob({ elements, appState, files: {}, mimeType: "image/png" });
      },
    };
    readyCallback.current(handle);
  }, [setDrawingColor, observeElements]);

  useEffect(() => () => { sdkRef.current = null; readyCallback.current(null); }, []);
  return <div className={styles.board}>
    {active && !readOnly && <WhiteboardTools
      activeTool={activeTool}
      color={color}
      onSelect={tool => sdkRef.current?.setActiveTool({ type: tool, locked: true })}
      onPointerSelect={focusCanvas}
      onColor={setDrawingColor}
    />}
    <div ref={hostRef} className={styles.surface} onKeyDownCapture={limitCanvasShortcuts} onPasteCapture={pasteOnCanvas}
      onPointerMoveCapture={event => { if (event.target instanceof HTMLCanvasElement) pointer.current = { clientX: event.clientX, clientY: event.clientY }; }}
      onPointerLeave={() => { pointer.current = null; }}
      onContextMenuCapture={event => {
        if (event.target instanceof HTMLCanvasElement) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <Excalidraw
        excalidrawAPI={attach}
        onChange={observe}
        initialData={{ elements: [], appState: {
          activeTool: { type: "freedraw", customType: null, locked: true, lastActiveTool: null },
          currentItemStrokeColor: drawingColor,
          currentItemStrokeWidth: 1,
          currentItemRoughness: 0,
          currentItemRoundness: "sharp",
          currentItemFontFamily: FONT_FAMILY.Nunito,
          viewBackgroundColor: "#ffffff",
        } }}
        name="Доска интервью"
        langCode="ru-RU"
        theme={mode}
        autoFocus={false}
        handleKeyboardGlobally={false}
        viewModeEnabled={readOnly || !active}
        isCollaborating
        aiEnabled={false}
        validateEmbeddable={false}
        onLinkOpen={(_element, event) => event.preventDefault()}
        onPaste={data => {
          if (!active || readOnly || !data.elements || Object.keys(data.files ?? {}).length) return false;
          try { data.elements.forEach(parseElement); return true; } catch { return false; }
        }}
        UIOptions={{ tools: { image: false }, canvasActions: { clearCanvas: false, loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, changeViewBackgroundColor: false, toggleTheme: false } }}
      />
      <span ref={previewRef} className={penHoverStyles.preview} data-testid="whiteboard-pen-hover" aria-hidden="true" hidden />
    </div>
  </div>;
});
