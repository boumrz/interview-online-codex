export type CanvasPoint = { x: number; y: number };
export type CanvasViewport = { left: number; top: number; scale: number; offsetX: number; offsetY: number };

export function viewportPointToCanvas(point: CanvasPoint, view: CanvasViewport): CanvasPoint {
  return { x: (point.x - view.left - view.offsetX) / view.scale, y: (point.y - view.top - view.offsetY) / view.scale };
}

export function canvasPointToViewport(point: CanvasPoint, view: CanvasViewport): CanvasPoint {
  return { x: point.x * view.scale + view.offsetX + view.left, y: point.y * view.scale + view.offsetY + view.top };
}

export function placeCanvasCursor(point: CanvasPoint, width: number, height: number) {
  const offscreen = point.x < 0 || point.y < 0 || point.x > width || point.y > height;
  if (!offscreen) return { ...point, offscreen: false, angle: 0 };
  const inset = Math.min(14, width / 2, height / 2);
  const dx = point.x - width / 2;
  const dy = point.y - height / 2;
  const ratio = Math.min((width / 2 - inset) / Math.max(Math.abs(dx), 1), (height / 2 - inset) / Math.max(Math.abs(dy), 1));
  return { x: width / 2 + dx * ratio, y: height / 2 + dy * ratio, offscreen: true, angle: Math.atan2(dy, dx) * 180 / Math.PI };
}
