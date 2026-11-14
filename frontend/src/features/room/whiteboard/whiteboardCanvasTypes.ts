import type { WhiteboardElement, WhiteboardFiles, WhiteboardSnapshot } from "./whiteboardProtocol";

export type WhiteboardExportFormat = "excalidraw" | "png" | "svg";
export type WhiteboardCanvasHandle = {
  flushLocalChanges(): void;
  applyScene(snapshot: WhiteboardSnapshot, replaceLocal: boolean): void;
  setDrawingColor(color: string): void;
  clear(): void;
  exportSnapshot(snapshot: WhiteboardSnapshot, format: WhiteboardExportFormat): Promise<Blob>;
};
export type WhiteboardCanvasProps = {
  active: boolean;
  readOnly: boolean;
  drawingColor: string;
  onReady(handle: WhiteboardCanvasHandle | null): void;
  onChange(elements: readonly WhiteboardElement[], files?: WhiteboardFiles): void;
};
