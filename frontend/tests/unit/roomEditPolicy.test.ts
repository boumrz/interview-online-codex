import assert from 'node:assert/strict';
import { test } from 'node:test';

const cases = [
  ['active', false, false], ['active', true, false],
  ['finished', false, true], ['finished', true, false],
  ['frozen', false, true], ['frozen', true, true],
  [undefined, false, false], [undefined, true, false],
] as const;
for (const [status, canManageRoom, expected] of cases) {
  test(`${status ?? 'not yet hydrated'} room: ${canManageRoom ? 'manager' : 'viewer'} editing policy`, async () => {
    const { isRoomReadOnly } = await import('../../src/features/room/roomEditPolicy.ts');
    assert.equal(isRoomReadOnly({ status, canManageRoom }), expected);
  });
}
test('completed legacy payload without manager permission remains read-only', async () => {
  const { isRoomReadOnly } = await import('../../src/features/room/roomEditPolicy.ts');
  assert.equal(isRoomReadOnly({ status: 'finished' }), true);
  assert.equal(isRoomReadOnly(null), false);
});
