import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasPointToViewport, viewportPointToCanvas, placeCanvasCursor } from '../../src/features/room/canvasCursorGeometry.ts';

test('pan, zoom, and viewport origin round-trip the same document point', () => {
  const view = { left: 160, top: 95, scale: 2, offsetX: -120, offsetY: 80 };
  const point = { x: 222, y: -18 };
  assert.deepEqual(viewportPointToCanvas(canvasPointToViewport(point, view), view), point);
  assert.deepEqual(canvasPointToViewport(point, view), { x: 484, y: 139 });
});

test('offscreen markers stay inside the viewport and identify the direction', () => {
  const placed = placeCanvasCursor({ x: 900, y: -100 }, 400, 300);
  assert.equal(placed.offscreen, true);
  assert.ok(placed.x >= 12 && placed.x <= 388);
  assert.ok(placed.y >= 12 && placed.y <= 288);
  assert.ok(placed.angle < 0);
  assert.deepEqual(placeCanvasCursor({ x: 100, y: 80 }, 400, 300), { x: 100, y: 80, offscreen: false, angle: 0 });
});

test('visible cursors keep their document position near every viewport edge', () => {
  for (const point of [{ x: 3, y: 150 }, { x: 398, y: 150 }, { x: 200, y: 2 }, { x: 200, y: 297 }]) {
    assert.deepEqual(placeCanvasCursor(point, 400, 300), { ...point, offscreen: false, angle: 0 });
  }
});

test('readonly SVG origin matches the cropped document including negative bounds', async () => {
  const { diagramPreviewOrigin } = await import('../../src/features/room/diagram/diagramCursorSurface.ts');
  const graph = { view: { scale: 2, translate: { x: 30, y: 40 } }, getGraphBounds: () => ({ x: -21, y: 80, width: 100, height: 100 }) };
  assert.deepEqual(diagramPreviewOrigin(graph as never), { x: 40, y: 0 });
});
