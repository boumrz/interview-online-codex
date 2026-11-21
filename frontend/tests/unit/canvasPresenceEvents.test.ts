import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasPresenceConnection, canvasPresenceRequest, receiveCanvasPresence, subscribeCanvasPresence } from '../../src/features/room/canvasPresenceEvents.ts';

test('snapshots are scoped to a room session and reordered delivery is discarded', () => {
  const received: unknown[] = [];
  canvasPresenceConnection('a', 'session', 'proof1', 2);
  const unsubscribe = subscribeCanvasPresence('a', 'session', value => received.push(value));
  const snapshot = { canvasType: 'whiteboard', taskId: 'task', sequence: 5, cursors: [{ id: 'peer', displayName: 'Peer', color: '#123456', x: 0, y: 20 }] };
  receiveCanvasPresence('b', 'session', snapshot);
  receiveCanvasPresence('a', 'other', snapshot);
  assert.equal(received.length, 0);
  receiveCanvasPresence('a', 'session', snapshot);
  receiveCanvasPresence('a', 'session', { ...snapshot, sequence: 4 });
  assert.equal(received.length, 1);
  assert.deepEqual(canvasPresenceRequest('a', 'session'), { canvasSequence: 1, expectedRoomEditorModeRevision: 2 });
  canvasPresenceConnection('a', 'session', 'proof2', 3);
  assert.equal(received.at(-1), null);
  receiveCanvasPresence('a', 'session', { ...snapshot, sequence: 1 });
  assert.equal(received.length, 3);
  unsubscribe();
});
