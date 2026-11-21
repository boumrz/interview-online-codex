export type DiagramCursorGraph = {
  container: HTMLElement;
  view: { scale: number; translate: { x: number; y: number } };
  getGraphBounds(): { x: number; y: number; width: number; height: number };
};
type NativeUi = { editor: { graph: DiagramCursorGraph } };
type NativePrototype = { initializeEmbedMode(this: NativeUi, ...args: unknown[]): unknown };

/** The pinned, same-origin editor exposes model/view transforms after its embed handshake. */
export function installDiagramCursorSurface(target: Window, receive: (graph: DiagramCursorGraph) => void) {
  const prototype = (target as Window & { EditorUi?: { prototype?: NativePrototype } }).EditorUi?.prototype;
  if (!prototype) throw new Error('Не удалось подключить указатели схемы');
  const initialize = prototype.initializeEmbedMode;
  prototype.initializeEmbedMode = function (...args) {
    const result = initialize.apply(this, args);
    receive(this.editor.graph);
    return result;
  };
}

/** Matches draw.io's default SVG export (scale 1, border 0, crop to graph bounds). */
export function diagramPreviewOrigin(graph: DiagramCursorGraph) {
  const bounds = graph.getGraphBounds();
  const scale = graph.view.scale;
  return {
    x: graph.view.translate.x + Math.floor(-Math.round(bounds.x / scale * 1e6) / 1e6),
    y: graph.view.translate.y + Math.floor(-Math.round(bounds.y / scale * 1e6) / 1e6),
  };
}
