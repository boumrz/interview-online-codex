export type CanvasCursor = { id: string; displayName: string; color: string; x: number; y: number };
export type CanvasPresenceSnapshot = { taskId: string | null; canvasType: 'diagram' | 'whiteboard'; sequence: number; cursors: CanvasCursor[] };
type Listener = (snapshot: CanvasPresenceSnapshot | null) => void;
type Channel = { listeners: Set<Listener>; sequence: number; snapshotSequence: number; modeRevision: number; eventToken: string | null };
const channels = new Map<string, Channel>();
function channel(inviteCode: string, sessionId: string): Channel {
  const key = `${inviteCode}:${sessionId}`;
  let value = channels.get(key);
  if (!value) { value = { listeners: new Set(), sequence: 0, snapshotSequence: -1, modeRevision: 0, eventToken: null }; channels.set(key, value); }
  return value;
}
export function canvasPresenceConnection(inviteCode: string, sessionId: string, eventToken: string | null, modeRevision: number) {
  const value = channel(inviteCode, sessionId);
  if (value.eventToken !== eventToken) { value.snapshotSequence = -1; value.listeners.forEach(listener => listener(null)); }
  value.eventToken = eventToken;
  value.modeRevision = modeRevision;
}
export function canvasPresenceRequest(inviteCode: string, sessionId: string) {
  const value = channel(inviteCode, sessionId);
  return { canvasSequence: ++value.sequence, expectedRoomEditorModeRevision: value.modeRevision };
}
export function receiveCanvasPresence(inviteCode: string, sessionId: string, input: unknown) {
  if (!input || typeof input !== 'object') return;
  const snapshot = input as CanvasPresenceSnapshot;
  if (!['diagram', 'whiteboard'].includes(snapshot.canvasType) || (snapshot.taskId !== null && typeof snapshot.taskId !== 'string') ||
    !Number.isSafeInteger(snapshot.sequence) || !Array.isArray(snapshot.cursors)) return;
  const value = channel(inviteCode, sessionId);
  if (snapshot.sequence <= value.snapshotSequence) return;
  value.snapshotSequence = snapshot.sequence;
  const cursors = snapshot.cursors.filter(cursor => cursor && typeof cursor.id === 'string' && typeof cursor.displayName === 'string' &&
    /^#[\da-f]{6}$/i.test(cursor.color) && Number.isFinite(cursor.x) && Number.isFinite(cursor.y));
  value.listeners.forEach(listener => listener({ ...snapshot, cursors }));
}
export function subscribeCanvasPresence(inviteCode: string, sessionId: string, listener: Listener) {
  const value = channel(inviteCode, sessionId);
  value.listeners.add(listener);
  return () => { value.listeners.delete(listener); };
}
