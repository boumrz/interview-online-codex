import type { WhiteboardElement, WhiteboardSnapshot } from "./whiteboardProtocol";

export type WhiteboardExportFormat = "excalidraw" | "png" | "svg";
export type WhiteboardCanvasHandle = {
  applyScene(snapshot: WhiteboardSnapshot, replaceLocal: boolean): void;
  clear(): void;
  exportSnapshot(snapshot: WhiteboardSnapshot, format: WhiteboardExportFormat): Promise<Blob>;
};
export type WhiteboardCanvasProps = {
  active: boolean;
  readOnly: boolean;
  drawingColor: string;
  onReady(handle: WhiteboardCanvasHandle | null): void;
  onChange(elements: readonly WhiteboardElement[]): void;
};
