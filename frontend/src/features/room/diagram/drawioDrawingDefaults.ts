type NativeGraph = { freehand?: { setStrokeColor(color: string): void } };
type NativeUi = { editor?: { graph?: NativeGraph } };
type NativeEmbedPrototype = { initializeEmbedMode(this: NativeUi, ...args: unknown[]): unknown };

/**
 * Pinned draw.io 32.6.10 gives freehand its own black/white color, overriding
 * configured vertex defaults. The same-origin configure handshake runs before
 * EditorUi construction, so initialize this one native tool before `init`.
 * No document styles, vendor files or later manual choices are changed.
 */
export function installDrawioDrawingDefaults(target: Window, color: string): void {
  const native = target as Window & { EditorUi?: { prototype?: NativeEmbedPrototype } };
  const prototype = native.EditorUi?.prototype;
  if (!prototype || typeof prototype.initializeEmbedMode !== "function") {
    throw new Error("Не удалось настроить цвет редактора схемы. Повторите загрузку.");
  }
  const initialize = prototype.initializeEmbedMode;
  const initialized = new WeakSet<NativeGraph>();
  prototype.initializeEmbedMode = function (...args) {
    const graph = this.editor?.graph;
    if (graph && !initialized.has(graph)) {
      graph.freehand?.setStrokeColor(color);
      initialized.add(graph);
    }
    return initialize.apply(this, args);
  };
}
