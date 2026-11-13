type NativeGraph = {
  currentVertexStyle: Record<string, string>;
  currentEdgeStyle: Record<string, string>;
  freehand?: { setStrokeColor(color: string): void };
};
type NativeUi = {
  editor: { graph: NativeGraph };
  fireEvent(event: unknown): void;
  freehandWindow?: { window: { content: HTMLElement | null } };
};
type NativeEmbedPrototype = { initializeEmbedMode(this: NativeUi, ...args: unknown[]): unknown };

/**
 * Pinned draw.io 32.6.10 gives freehand its own black/white color, overriding
 * configured vertex defaults. The same-origin configure handshake runs before
 * EditorUi construction, so initialize this one native tool before `init`.
 * The returned toolbar action changes only local styles for the next insertion.
 */
export function installDrawioDrawingDefaults(target: Window, color: string): () => void {
  const native = target as Window & {
    EditorUi?: { prototype?: NativeEmbedPrototype };
    mxEventObject: new (name: string, ...properties: unknown[]) => unknown;
  };
  const prototype = native.EditorUi?.prototype;
  if (!prototype || typeof prototype.initializeEmbedMode !== "function") {
    throw new Error("Не удалось настроить цвет редактора схемы. Повторите загрузку.");
  }
  const initialize = prototype.initializeEmbedMode;
  const initialized = new WeakSet<NativeGraph>();
  let editorUi: NativeUi | undefined;
  prototype.initializeEmbedMode = function (...args) {
    editorUi = this;
    const graph = this.editor?.graph;
    if (graph && !initialized.has(graph)) {
      graph.freehand?.setStrokeColor(color);
      initialized.add(graph);
    }
    return initialize.apply(this, args);
  };

  return () => {
    if (!editorUi) return;
    const graph = editorUi.editor.graph;
    const style = { strokeColor: color, fontColor: color };
    Object.assign(graph.currentVertexStyle, style);
    Object.assign(graph.currentEdgeStyle, style);
    graph.freehand?.setStrokeColor(color);
    editorUi.fireEvent(new native.mxEventObject("styleChanged", "keys", [], "values", [], "cells", []));

    // The native freehand picker only refreshes its swatch after its own dialog closes.
    const swatch = editorUi.freehandWindow?.window.content?.querySelector<HTMLElement>(".geColorBtn > :first-child");
    if (swatch) { swatch.style.backgroundColor = color; swatch.title = color; }
  };
}
