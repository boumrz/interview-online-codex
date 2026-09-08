import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityRetryDelay } from '../../src/features/room/activityRetry.ts';

test('transient activity failures retry with capped backoff without an attempt cutoff', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 100000].map(activityRetryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
test('invalid attempt counters retain a safe finite retry cadence', () => {
  for (const value of [0, -1, NaN, Infinity]) assert.equal(activityRetryDelay(value), 1000);
});
