import React, { useEffect, useState, type RefObject } from 'react';
import { CanvasCursors } from '../CanvasCursors';
import type { CanvasCursor } from '../canvasPresenceEvents';
import type { CanvasPoint } from '../canvasCursorGeometry';
import type { DiagramCursorGraph } from './diagramCursorSurface';

type View = { left: number; top: number; width: number; height: number; scale: number; x: number; y: number };
const emptyView: View = { left: 0, top: 0, width: 0, height: 0, scale: 1, x: 0, y: 0 };

export function DiagramCursors({ graph, frame, preview, previewOrigin, readonly, active, cursors, onCursor }: {
  graph: DiagramCursorGraph | null; frame: RefObject<HTMLIFrameElement>; preview: RefObject<HTMLImageElement>;
  previewOrigin?: CanvasPoint; readonly: boolean; active: boolean; cursors: readonly CanvasCursor[];
  onCursor(point: CanvasPoint | null): void;
}) {
  const [view, setView] = useState(emptyView);
  useEffect(() => {
    const surface = readonly ? preview.current : graph?.container;
    if (!active || !surface) return;
    let current = emptyView;
    let animation = 0;
    const refresh = () => {
      const rect = surface.getBoundingClientRect();
      if (readonly) {
        const image = preview.current;
        if (image && image.naturalWidth && image.naturalHeight && previewOrigin) {
          const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
          current = { left: image.offsetLeft, top: image.offsetTop, width: rect.width, height: rect.height, scale,
            x: (rect.width - image.naturalWidth * scale) / 2 + previewOrigin.x * scale,
            y: (rect.height - image.naturalHeight * scale) / 2 + previewOrigin.y * scale };
        }
      } else if (graph && frame.current) {
        current = { left: frame.current.offsetLeft + rect.left, top: frame.current.offsetTop + rect.top,
          width: surface.clientWidth, height: surface.clientHeight, scale: graph.view.scale,
          x: graph.view.translate.x * graph.view.scale - surface.scrollLeft,
          y: graph.view.translate.y * graph.view.scale - surface.scrollTop };
      }
      setView(previous => Object.keys(current).every(key => previous[key as keyof View] === current[key as keyof View]) ? previous : current);
      animation = requestAnimationFrame(refresh);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && event.buttons === 0) return;
      const rect = surface.getBoundingClientRect();
      onCursor({ x: (event.clientX - rect.left - current.x) / current.scale,
        y: (event.clientY - rect.top - current.y) / current.scale });
    };
    const hide = () => onCursor(null);
    const up = (event: PointerEvent) => { if (event.pointerType === 'touch') hide(); };
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerdown', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', hide);
    surface.addEventListener('pointerleave', hide);
    surface.ownerDocument.defaultView?.addEventListener('blur', hide);
    refresh();
    return () => {
      cancelAnimationFrame(animation);
      surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerdown', move);
      surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', hide);
      surface.removeEventListener('pointerleave', hide); surface.ownerDocument.defaultView?.removeEventListener('blur', hide);
      hide();
    };
  }, [active, graph, frame, preview, previewOrigin, readonly, onCursor]);
  if (!active || !view.width) return null;
  return <div style={{ position: 'absolute', pointerEvents: 'none', left: view.left, top: view.top, width: view.width, height: view.height, zIndex: 8 }}>
    <CanvasCursors cursors={cursors} width={view.width} height={view.height} project={point => ({ x: point.x * view.scale + view.x, y: point.y * view.scale + view.y })} />
  </div>;
}
