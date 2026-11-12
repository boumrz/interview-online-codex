import "./excalidrawAssets";
import React, { useCallback, useEffect, useRef } from "react";
import { CaptureUpdateAction, Excalidraw, MainMenu, exportToBlob, exportToSvg, isInvisiblySmallElement, reconcileElements, restoreElements, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useThemeMode } from "../../theme/ThemeProvider";
import type { WhiteboardElement } from "./whiteboardProtocol";
import type { WhiteboardCanvasHandle, WhiteboardCanvasProps } from "./whiteboardCanvasTypes";
import { usePenHover } from "./usePenHover";
import penHoverStyles from "./PenHover.module.css";

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
  const getAppState = useCallback(() => sdkRef.current?.getAppState(), []);
  const { hostRef, previewRef, onAppStateChange } = usePenHover({ active, readOnly, getAppState });
  const observe = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
    onAppStateChange(appState);
    // Match native collaboration: an unfinished new shape is local. In
    // particular, restoreElements normalizes an empty text placeholder into a
    // tombstone; sending it would let a peer delete text still being entered.
    // Explicit deletions always travel, including zero-sized tombstones.
    callback.current(elements.filter(element => element.isDeleted || (!isInvisiblySmallElement(element) && !(element.type === "text" && element.text === ""))));
  }, [onAppStateChange]);

  const attach = useCallback((sdk: ExcalidrawImperativeAPI) => {
    if (sdkRef.current === sdk) return;
    sdkRef.current = sdk;
    let firstScene = true;
    const handle: WhiteboardCanvasHandle = {
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
  }, []);

  useEffect(() => () => { sdkRef.current = null; readyCallback.current(null); }, []);
  return <div ref={hostRef} className={penHoverStyles.host}><Excalidraw
    excalidrawAPI={attach}
    onChange={observe}
    initialData={{ elements: [], appState: { currentItemStrokeColor: drawingColor, activeTool: { type: "freedraw", customType: null, locked: true, lastActiveTool: null }, penMode: false, viewBackgroundColor: "#ffffff" } }}
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
    onPaste={(data) => !data.files?.length && !data.elements?.some(element => element.type === "image" || element.type === "embeddable" || Boolean(element.link))}
    UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, changeViewBackgroundColor: false, toggleTheme: false, clearCanvas: !readOnly } }}
  >
    <MainMenu><MainMenu.DefaultItems.ClearCanvas /></MainMenu>
  </Excalidraw><span ref={previewRef} className={penHoverStyles.preview} data-testid="whiteboard-pen-hover" aria-hidden="true" hidden /></div>;
});
