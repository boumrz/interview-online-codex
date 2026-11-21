import React from 'react';
import { placeCanvasCursor, type CanvasPoint } from './canvasCursorGeometry';
import type { CanvasCursor } from './canvasPresenceEvents';
import styles from './CanvasCursors.module.css';

export function CanvasCursors({ cursors, width, height, project }: {
  cursors: readonly CanvasCursor[]; width: number; height: number; project(point: CanvasPoint): CanvasPoint;
}) {
  return <div className={styles.layer} aria-hidden="true" data-testid="canvas-cursors">
    {cursors.map(cursor => {
      const placed = placeCanvasCursor(project(cursor), width, height);
      const duplicate = cursors.filter(other => other.displayName === cursor.displayName).length > 1;
      return <div key={cursor.id} className={styles.cursor} data-cursor-id={cursor.id} data-offscreen={placed.offscreen}
        style={{ left: placed.x, top: placed.y, '--cursor-color': cursor.color } as React.CSSProperties}>
        {placed.offscreen
          ? <span className={styles.direction} style={{ transform: `rotate(${placed.angle}deg)` }}>➜</span>
          : <svg className={styles.crosshair} viewBox="0 0 20 20" focusable="false">
            <path d="M10 2V18M2 10H18" fill="none" stroke="white" strokeWidth="4" />
            <path d="M10 2V18M2 10H18" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>}
        <span className={`${styles.name} ${placed.x > width / 2 ? styles.left : ''}`} style={{ top: placed.y > height - 48 ? -25 : placed.offscreen ? -6 : 21 }}>{cursor.displayName}{duplicate ? ` · ${cursor.id.slice(0, 3)}` : ''}</span>
      </div>;
    })}
  </div>;
}
