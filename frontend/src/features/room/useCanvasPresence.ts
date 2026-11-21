import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../config/runtime';
import { roomRealtimeFetch } from './roomRealtimeTransport';
import { canvasPresenceRequest, subscribeCanvasPresence, type CanvasCursor } from './canvasPresenceEvents';
import type { CanvasPoint } from './canvasCursorGeometry';

type Connection = { inviteCode: string; sessionId: string; eventToken?: string | null; connected: boolean; taskId: string | null };

/** Positions coalesce outside the document queue. A reconnect starts with an empty pointer. */
export function useCanvasPresence(connection: Connection, active: boolean, canvasType: 'diagram' | 'whiteboard') {
  const [cursors, setCursors] = useState<CanvasCursor[]>([]);
  const update = useRef<(point: CanvasPoint | null) => void>(() => {});
  const point = useCallback((position: CanvasPoint | null) => update.current(position), []);
  useEffect(() => {
    setCursors([]);
    if (!active || !connection.connected || !connection.eventToken) return;
    let closed = false;
    let latest: CanvasPoint | null = null;
    let pending = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeCanvasPresence(connection.inviteCode, connection.sessionId, snapshot => {
      if (!closed) setCursors(snapshot?.canvasType === canvasType && snapshot.taskId === connection.taskId ? snapshot.cursors : []);
    });
    function body(position: CanvasPoint | null, enabled = true) {
      return JSON.stringify({ type: 'canvas_cursor_update', sessionId: connection.sessionId, eventToken: connection.eventToken,
        taskId: connection.taskId ?? '', canvasType, canvasSubscribed: enabled && !document.hidden,
        canvasActive: enabled && !document.hidden && document.hasFocus(), canvasVisible: position !== null,
        canvasX: position?.x, canvasY: position?.y, ...canvasPresenceRequest(connection.inviteCode, connection.sessionId) });
    }
    const url = `${API_BASE_URL}/realtime/rooms/${encodeURIComponent(connection.inviteCode)}/events`;
    async function flush() {
      timer = undefined;
      if (closed || running || !pending) return;
      pending = false; running = true;
      try {
        const response = await roomRealtimeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(latest), signal: AbortSignal.timeout(2500) });
        if (!closed && (response.status === 403 || response.status === 404 || response.status === 410)) { latest = null; setCursors([]); }
      } catch { /* A newer position or presence heartbeat supersedes this attempt. */ }
      finally { running = false; if (!closed && pending) timer = setTimeout(flush, 60); }
    }
    update.current = position => {
      latest = position;
      pending = true;
      if (!running && !timer) timer = setTimeout(flush, position ? 60 : 0);
    };
    const hide = () => update.current(null);
    const focus = () => { pending = true; void flush(); };
    const visibility = () => { if (document.hidden) hide(); else focus(); };
    window.addEventListener('blur', hide);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    const heartbeat = setInterval(() => { if (!document.hidden) { pending = true; void flush(); } }, 5000);
    pending = true;
    void flush();
    return () => {
      closed = true; update.current = () => {}; unsubscribe(); clearTimeout(timer); clearInterval(heartbeat);
      window.removeEventListener('blur', hide); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visibility);
      // No retry queue survives the canvas. A newer scope's sequence wins any race with this leave.
      void roomRealtimeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(null, false), keepalive: true }).catch(() => {});
    };
  }, [connection.inviteCode, connection.sessionId, connection.eventToken, connection.connected, connection.taskId, active, canvasType]);
  return { cursors, point };
}
