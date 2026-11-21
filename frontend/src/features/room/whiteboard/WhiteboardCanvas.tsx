import "./excalidrawAssets";
import { CanvasCursors } from "../CanvasCursors";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, convertToExcalidrawElements, exportToBlob, exportToSvg, isInvisiblySmallElement, newElementWith, reconcileElements, restoreElements, serializeAsJSON, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useThemeMode } from "../../theme/ThemeProvider";
import { MAX_WHITEBOARD_FILES, MAX_WHITEBOARD_FILES_BYTES, parseElement, parseFiles, whiteboardFileBytes, type WhiteboardElement, type WhiteboardFiles } from "./whiteboardProtocol";
import type { WhiteboardCanvasHandle, WhiteboardCanvasProps } from "./whiteboardCanvasTypes";
import { usePenHover } from "./usePenHover";
import penHoverStyles from "./PenHover.module.css";
import { imageDimensions, prepareWhiteboardImage } from "./whiteboardImages";
import { WhiteboardTools } from "./WhiteboardTools";
import { DEFAULT_STROKE_WIDTH_PX, MAX_STROKE_WIDTH_PX, MIN_STROKE_WIDTH_PX, nativeStrokeWidth } from "./whiteboardStrokeWidth";
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
    if (!event.shiftKey && ["p", "v", "l", "r", "o", "t", "e"].includes(key)) return;
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

// Protocol validation establishes the native SDK's nominal file ID/data URL
// brands. Give the SDK its own objects; canonical file records remain immutable.
function nativeFiles(files: WhiteboardFiles): BinaryFiles {
  return Object.fromEntries(Object.entries(files).map(([id, file]) => [id, { ...file }])) as BinaryFiles;
}

function filesForElements(elements: readonly ExcalidrawElement[], files: BinaryFiles): WhiteboardFiles {
  const ids = new Set(elements.flatMap(element => element.type === "image" && element.fileId ? [element.fileId] : []));
  return Object.fromEntries([...ids].filter(id => Object.hasOwn(files, id)).map(id => [id, files[id]]));
}

function checkBoardFiles(files: WhiteboardFiles): void {
  if (Object.keys(files).length > MAX_WHITEBOARD_FILES || Object.values(files).reduce((total, file) => total + whiteboardFileBytes(file), 0) > MAX_WHITEBOARD_FILES_BYTES) {
    throw new Error("На доске можно хранить до 100 изображений общим размером 20 МБ, включая удалённые для отмены действий.");
  }
}

const initialWidths = { freedraw: DEFAULT_STROKE_WIDTH_PX, line: DEFAULT_STROKE_WIDTH_PX, rectangle: DEFAULT_STROKE_WIDTH_PX, ellipse: DEFAULT_STROKE_WIDTH_PX };
function supportsStrokeWidth(tool: string): tool is keyof typeof initialWidths {
  return Object.hasOwn(initialWidths, tool);
}

export default React.memo(function WhiteboardCanvas({ active, readOnly, drawingColor, cursors = [], onCursor, onReady, onChange }: WhiteboardCanvasProps) {
  const { mode } = useThemeMode();
  // Dark paper is a local view preference. Colors and raster bytes themselves
  // stay unchanged, matching the palette and the light-background exports.
  const backgroundColor = mode === "dark" ? "#121212" : "#ffffff";
  const background = useRef(backgroundColor); background.current = backgroundColor;
  const callback = useRef(onChange); callback.current = onChange;
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const sdkRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const importGate = useRef({ active, readOnly, generation: 0 });
  if (importGate.current.active !== active || importGate.current.readOnly !== readOnly) {
    importGate.current = { active, readOnly, generation: importGate.current.generation + 1 };
  }
  const fileInput = useRef<HTMLInputElement | null>(null);
  const fileChoiceGeneration = useRef(0);
  const pasteGenerations = useRef(new WeakMap<ClipboardEvent, number>());
  const importingOperation = useRef<symbol | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const cancelImports = useCallback(() => {
    importGate.current.generation++;
    importingOperation.current = null; setImporting(false); setImportError(null);
  }, []);
  const pointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const widths = useRef({ ...initialWidths });
  const [strokeWidth, setStrokeWidth] = useState<number | undefined>(DEFAULT_STROKE_WIDTH_PX);
  const [activeTool, setActiveTool] = useState<AppState["activeTool"]["type"]>("freedraw");
  const [color, setColor] = useState(drawingColor);
  const [canClear, setCanClear] = useState(false);
  const [cursorView, setCursorView] = useState({ width: 0, height: 0, scale: 1, x: 0, y: 0 });
  const cursorCallback = useRef(onCursor); cursorCallback.current = onCursor;
  const getAppState = useCallback(() => sdkRef.current?.getAppState(), []);
  const { hostRef, previewRef, onAppStateChange } = usePenHover({ active, readOnly, getAppState });
  const focusCanvas = useCallback(() => {
    hostRef.current?.querySelector<HTMLElement>(".excalidraw")?.focus({ preventScroll: true });
  }, [hostRef]);
  const observeElements = useCallback((elements: readonly OrderedExcalidrawElement[], files: BinaryFiles = sdkRef.current?.getFiles() ?? {}) => {
    // Match native collaboration: an unfinished new shape is local. In
    // particular, restoreElements normalizes an empty text placeholder into a
    // tombstone; sending it would let a peer delete text still being entered.
    // Explicit deletions always travel, including zero-sized tombstones.
    const complete = elements.filter(element =>
      (element.type !== "image" || (element.fileId && Object.hasOwn(files, element.fileId))) &&
      (element.isDeleted || (!isInvisiblySmallElement(element) && !(element.type === "text" && element.text === ""))));
    callback.current(complete, filesForElements(complete, files));
  }, []);
  const observe = useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (appState.contextMenu) {
      // The SDK opens its menu directly on a touch hold, without dispatching
      // a DOM contextmenu event.
      sdkRef.current?.updateScene({ appState: { contextMenu: null }, captureUpdate: CaptureUpdateAction.NEVER });
      if (hostRef.current?.contains(document.activeElement)) focusCanvas();
    }
    onAppStateChange(appState);
    const host = hostRef.current?.getBoundingClientRect();
    const view = { width: host?.width ?? appState.width, height: host?.height ?? appState.height,
      scale: appState.zoom.value, x: appState.scrollX * appState.zoom.value + appState.offsetLeft - (host?.left ?? appState.offsetLeft),
      y: appState.scrollY * appState.zoom.value + appState.offsetTop - (host?.top ?? appState.offsetTop) };
    if (pointer.current && active && !document.hidden && document.hasFocus()) {
      cursorCallback.current?.(viewportCoordsToSceneCoords(pointer.current, appState));
    }
    setCursorView(previous => previous.width === view.width && previous.height === view.height && previous.scale === view.scale && previous.x === view.x && previous.y === view.y ? previous : view);
    const tool = appState.activeTool.type;
    const width = supportsStrokeWidth(tool) ? widths.current[tool] : undefined;
    // Native keyboard shortcuts can switch the tool without touching our toolbar.
    if (width !== undefined && appState.currentItemStrokeWidth !== nativeStrokeWidth(tool, width)) {
      sdkRef.current?.updateScene({ appState: { currentItemStrokeWidth: nativeStrokeWidth(tool, width) }, captureUpdate: CaptureUpdateAction.NEVER });
    }
    setStrokeWidth(width);
    setActiveTool(tool);
    setColor(appState.currentItemStrokeColor);
    setCanClear(elements.some(element => !element.isDeleted));
    observeElements(elements, files);
  }, [observeElements, onAppStateChange, focusCanvas, hostRef, active]);

  async function importImages(inputs: readonly File[], position?: { clientX: number; clientY: number }, expectedGeneration = importGate.current.generation) {
    const sdk = sdkRef.current;
    const valid = () => sdkRef.current === sdk && importGate.current.generation === expectedGeneration && importGate.current.active && !importGate.current.readOnly;
    if (!sdk || !inputs.length || !valid() || importingOperation.current) return;
    const operation = Symbol();
    importingOperation.current = operation;
    setImporting(true); setImportError(null);
    try {
      const currentFiles = filesForElements(sdk.getSceneElementsIncludingDeleted(), sdk.getFiles());
      if (Object.keys(currentFiles).length + inputs.length > MAX_WHITEBOARD_FILES ||
        Object.values(currentFiles).reduce((total, file) => total + whiteboardFileBytes(file), 0) + inputs.reduce((total, file) => total + file.size, 0) > MAX_WHITEBOARD_FILES_BYTES) {
        throw new Error("На доске можно хранить до 100 изображений общим размером 20 МБ, включая удалённые для отмены действий.");
      }
      const prepared: Awaited<ReturnType<typeof prepareWhiteboardImage>>[] = [];
      for (const input of inputs) {
        prepared.push(await prepareWhiteboardImage(input));
        if (!valid()) return;
      }
      const files = nativeFiles(Object.fromEntries(prepared.map(image => [image.file.id, image.file])));
      checkBoardFiles({ ...filesForElements(sdk.getSceneElementsIncludingDeleted(), sdk.getFiles()), ...files });
      const state = sdk.getAppState();
      const point = viewportCoordsToSceneCoords(position ?? { clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 }, state);
      const elements = prepared.flatMap((image, index) => {
        const scale = Math.min(1, Math.max(1, state.width * .7) / image.width / state.zoom.value, Math.max(1, state.height * .7) / image.height / state.zoom.value);
        const width = image.width * scale, height = image.height * scale;
        return convertToExcalidrawElements([{
          type: "image", fileId: files[image.file.id].id, status: "saved", scale: [1, 1],
          x: point.x - width / 2 + index * 24, y: point.y - height / 2 + index * 24, width, height,
        }]);
      });
      if (!valid()) return;
      sdk.addFiles(Object.values(files));
      sdk.updateScene({
        elements: [...sdk.getSceneElementsIncludingDeleted(), ...elements],
        appState: { selectedElementIds: Object.fromEntries(elements.map(element => [element.id, true])), selectedGroupIds: {}, editingGroupId: null },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      sdk.setActiveTool({ type: "selection" });
      focusCanvas();
    } catch (error) {
      if (valid()) setImportError(error instanceof Error ? error.message : "Не удалось добавить изображение. Повторите попытку.");
    } finally {
      if (importingOperation.current === operation) { importingOperation.current = null; setImporting(false); }
    }
  }

  function pasteOnCanvas(event: React.ClipboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || event.target.closest("textarea, input, [contenteditable=true]")) return;
    const sdk = sdkRef.current;
    const text = event.clipboardData.getData("text/plain");
    const hasFiles = event.clipboardData.files.length > 0;
    if (active && !readOnly && sdk && !hasFiles && isCopiedScene(text)) {
      pasteGenerations.current.set(event.nativeEvent, importGate.current.generation);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!active || readOnly || !sdk) return;
    if (hasFiles) { void importImages(Array.from(event.clipboardData.files), pointer.current ?? undefined); return; }
    if (!text.trim()) return;
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

  function clearDrawing() {
    const sdk = sdkRef.current;
    if (!active || readOnly || !sdk || !sdk.getSceneElements().length) return;
    cancelImports();
    const elements = sdk.getSceneElementsIncludingDeleted().map(element =>
      element.isDeleted ? element : newElementWith(element, { isDeleted: true }));
    sdk.updateScene({
      elements,
      appState: {
        selectedElementIds: {}, selectedGroupIds: {}, editingGroupId: null, editingTextElement: null,
        editingLinearElement: null, selectedLinearElement: null, newElement: null, multiElement: null, selectionElement: null,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    focusCanvas();
  }

  const attach = useCallback((sdk: ExcalidrawImperativeAPI) => {
    if (sdkRef.current === sdk) return;
    sdkRef.current = sdk;
    sdk.updateScene({ appState: { viewBackgroundColor: background.current }, captureUpdate: CaptureUpdateAction.NEVER });
    let firstScene = true;
    const handle: WhiteboardCanvasHandle = {
      flushLocalChanges() { observeElements(sdk.getSceneElementsIncludingDeleted()); },
      setDrawingColor,
      applyScene(snapshot, replaceLocal) {
        if (replaceLocal) cancelImports();
        sdk.addFiles(Object.values(nativeFiles(snapshot.files)));
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
        cancelImports();
        sdk.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
        sdk.history.clear();
      },
      async exportSnapshot(snapshot, format) {
        const elements = restoreScene(snapshot.elements);
        const files = nativeFiles(snapshot.files);
        const appState = { ...sdk.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" };
        if (format === "excalidraw") {
          return new Blob([serializeAsJSON(elements, appState, files, "local")], { type: "application/json" });
        }
        if (format === "svg") {
          const svg = await exportToSvg({ elements, appState, files });
          return new Blob([svg.outerHTML], { type: "image/svg+xml" });
        }
        return exportToBlob({ elements, appState, files, mimeType: "image/png" });
      },
    };
    readyCallback.current(handle);
  }, [setDrawingColor, observeElements, cancelImports]);

  useEffect(() => {
    importingOperation.current = null; setImporting(false); setImportError(null);
  }, [active, readOnly]);
  useEffect(() => () => { importGate.current.generation++; importingOperation.current = null; sdkRef.current = null; readyCallback.current(null); }, []);
  useEffect(() => {
    sdkRef.current?.updateScene({ appState: { viewBackgroundColor: backgroundColor }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [backgroundColor]);
  return <div className={styles.board}>
    {active && !readOnly && <WhiteboardTools
      canClear={canClear}
      importing={importing}
      onImage={() => { fileChoiceGeneration.current = importGate.current.generation; fileInput.current?.click(); }}
      onClear={clearDrawing}
      activeTool={activeTool}
      color={color}
      strokeWidth={strokeWidth}
      onWidth={width => {
        if (Number.isInteger(width) && width >= MIN_STROKE_WIDTH_PX && width <= MAX_STROKE_WIDTH_PX && supportsStrokeWidth(activeTool)) {
          widths.current[activeTool] = width;
          sdkRef.current?.updateScene({ appState: { currentItemStrokeWidth: nativeStrokeWidth(activeTool, width) }, captureUpdate: CaptureUpdateAction.NEVER });
        }
      }}
      onSelect={tool => sdkRef.current?.setActiveTool({ type: tool, locked: true })}
      onPointerSelect={focusCanvas}
      onColor={setDrawingColor}
    />}
    <input ref={fileInput} className={styles.fileInput} type="file" aria-label="Файл изображения" accept="image/png,image/jpeg,image/webp" multiple
      onChange={event => {
        const inputs = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        void importImages(inputs, undefined, fileChoiceGeneration.current);
      }} />
    {importing && active && !readOnly && <div className={styles.importMessage} role="status">Добавляем изображение…</div>}
    {importError && active && !readOnly && <div className={`${styles.importMessage} ${styles.importError}`} role="alert">{importError}</div>}
    <div ref={hostRef} className={styles.surface} onKeyDownCapture={limitCanvasShortcuts} onPasteCapture={pasteOnCanvas}
      onDragOverCapture={event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = active && !readOnly ? "copy" : "none"; }}
      onDropCapture={event => {
        event.preventDefault(); event.stopPropagation();
        if (active && !readOnly) void importImages(Array.from(event.dataTransfer.files), { clientX: event.clientX, clientY: event.clientY });
      }}
      onPointerMoveCapture={event => {
        if (event.target instanceof HTMLCanvasElement) {
          pointer.current = { clientX: event.clientX, clientY: event.clientY };
          const state = sdkRef.current?.getAppState();
          if (active && state && (event.pointerType !== "touch" || event.buttons > 0)) cursorCallback.current?.(viewportCoordsToSceneCoords(pointer.current, state));
        } else { pointer.current = null; cursorCallback.current?.(null); }
      }}
      onPointerDownCapture={event => {
        const state = sdkRef.current?.getAppState();
        if (active && state && event.target instanceof HTMLCanvasElement) cursorCallback.current?.(viewportCoordsToSceneCoords({ clientX: event.clientX, clientY: event.clientY }, state));
      }}
      onPointerUpCapture={event => { if (event.pointerType === "touch") { pointer.current = null; cursorCallback.current?.(null); } }}
      onPointerCancel={() => cursorCallback.current?.(null)}
      onPointerLeave={() => { pointer.current = null; cursorCallback.current?.(null); }}
      onContextMenuCapture={event => {
        if (event.target instanceof HTMLCanvasElement) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <Excalidraw
        excalidrawAPI={attach}
        onChange={observe}
        initialData={{ elements: [], appState: {
          activeTool: { type: "freedraw", customType: null, locked: true, lastActiveTool: null },
          currentItemStrokeColor: drawingColor,
          currentItemStrokeWidth: nativeStrokeWidth("freedraw", DEFAULT_STROKE_WIDTH_PX),
          currentItemRoughness: 0,
          currentItemRoundness: "sharp",
          currentItemFontFamily: FONT_FAMILY.Nunito,
          viewBackgroundColor: backgroundColor,
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
        onPaste={async (data, event) => {
          const sdk = sdkRef.current;
          const generation = event ? pasteGenerations.current.get(event) : undefined;
          if (generation === undefined || generation !== importGate.current.generation || !importGate.current.active || importGate.current.readOnly || !sdk || !data.elements) return false;
          try {
            data.elements.forEach(parseElement);
            const files = parseFiles(data.files);
            const existing = sdk.getFiles();
            const combined = { ...filesForElements(sdk.getSceneElementsIncludingDeleted(), existing), ...files };
            checkBoardFiles(combined);
            for (const element of data.elements) {
              if (element.type === "image" && (!element.fileId || !Object.hasOwn(combined, element.fileId))) throw new Error("В скопированном изображении отсутствует файл.");
            }
            for (const file of Object.values(files)) {
              if (Object.hasOwn(existing, file.id) && (existing[file.id].dataURL !== file.dataURL || existing[file.id].mimeType !== file.mimeType)) throw new Error("Не удалось вставить изображение с конфликтующим файлом.");
              await imageDimensions(file.dataURL);
            }
            if (sdkRef.current !== sdk || importGate.current.generation !== generation || !importGate.current.active || importGate.current.readOnly) return false;
            checkBoardFiles({ ...filesForElements(sdk.getSceneElementsIncludingDeleted(), sdk.getFiles()), ...files });
            data.files = nativeFiles(files);
            return true;
          } catch {
            if (importGate.current.generation === generation) setImportError("Не удалось вставить объекты доски. Проверьте изображения и их размер.");
            return false;
          }
        }}
        UIOptions={{ tools: { image: false }, canvasActions: { clearCanvas: false, loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, changeViewBackgroundColor: false, toggleTheme: false } }}
      />
      <CanvasCursors cursors={cursors} width={cursorView.width} height={cursorView.height} project={point => ({ x: point.x * cursorView.scale + cursorView.x, y: point.y * cursorView.scale + cursorView.y })} />
      <span ref={previewRef} className={penHoverStyles.preview} data-testid="whiteboard-pen-hover" aria-hidden="true" hidden />
    </div>
  </div>;
});
