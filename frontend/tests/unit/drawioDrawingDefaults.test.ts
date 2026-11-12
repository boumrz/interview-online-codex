import assert from "node:assert/strict";
import test from "node:test";
import { installDrawioDrawingDefaults } from "../../src/features/room/diagram/drawioDrawingDefaults.ts";

test("freehand receives its assigned color before native initialization without changing native arguments or return", () => {
  const events: string[] = [];
  class NativeUi {
    editor = { graph: { freehand: { setStrokeColor: (color: string) => events.push(color) } } };
    initializeEmbedMode(value: string) { events.push(`native:${value}`); return this; }
  }
  installDrawioDrawingDefaults({ EditorUi: NativeUi } as unknown as Window, "#2563EB");
  const ui = new NativeUi();
  assert.equal(ui.initializeEmbedMode("ready"), ui);
  assert.deepEqual(events, ["#2563EB", "native:ready"]);
});

test("a manual freehand choice survives repeated initialization of the same graph while a new graph gets its own default", () => {
  let currentColor = "default";
  const colors: string[] = [];
  class NativeUi {
    editor = { graph: { freehand: { setStrokeColor: (color: string) => { currentColor = color; colors.push(color); } } } };
    initializeEmbedMode() {}
  }
  installDrawioDrawingDefaults({ EditorUi: NativeUi } as unknown as Window, "#DC2626");
  const ui = new NativeUi();
  ui.initializeEmbedMode();
  ui.editor.graph.freehand.setStrokeColor("#C036D8");
  ui.initializeEmbedMode();
  assert.equal(currentColor, "#C036D8");
  assert.deepEqual(colors, ["#DC2626", "#C036D8"]);
  new NativeUi().initializeEmbedMode();
  assert.equal(currentColor, "#DC2626");
});

test("an incompatible native startup fails explicitly instead of silently using a shared black default", () => {
  assert.throws(() => installDrawioDrawingDefaults({} as Window, "#2563EB"), /Не удалось настроить цвет/);
});
