import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityPostOutcome, activityRetryDelay } from '../../src/features/room/activityRetry.ts';

test('transient activity failures retry with capped backoff without an attempt cutoff', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 100000].map(activityRetryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
test('invalid attempt counters retain a safe finite retry cadence', () => {
  for (const value of [0, -1, NaN, Infinity]) assert.equal(activityRetryDelay(value), 1000);
});

test('only the activity relay 204 acknowledges the head, ambiguous success and transient HTTP failures retry', () => {
  for (const status of [200, 201, 202, 205, 408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(activityPostOutcome(status), 'retry', String(status));
  }
  assert.equal(activityPostOutcome(204), 'accepted');
  for (const status of [400, 401, 403, 409, 410, 422]) {
    assert.equal(activityPostOutcome(status), 'rejected', String(status));
  }
});
