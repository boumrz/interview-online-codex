import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runObservedProtocolCommand, withProtocolDeadline } from '../e2e/support/observed-protocol-command.mjs';

const pending = () => new Promise(() => {});
async function boundedOutcome(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve('hung'), 100); })]);
  } finally { clearTimeout(timer); }
}

test('returns the original response without changing its body', async () => {
  const value = { body: '{"original":true}', base64Encoded: false };
  assert.deepEqual(await runObservedProtocolCommand({ command: async () => value, timeoutMs: 20 }),
    { kind: 'response', value });
});

test('exact proven cancellation releases a stalled original-body command', async () => {
  const proof = { proven: true, traceId: 'same-request', path: '/api/rooms/fixture', method: 'GET' };
  assert.deepEqual(await boundedOutcome(runObservedProtocolCommand({ command: pending,
    cancellation: Promise.resolve(proof), timeoutMs: 20 })), { kind: 'cancelled', proof });
});

test('a deadline alone fails a stalled command', async () => {
  const outcome = await boundedOutcome(runObservedProtocolCommand({ command: pending,
    timeoutMs: 10, description: 'original-body' }).catch(error => ({ name: error.name, message: error.message })));
  assert.deepEqual(outcome, { name: 'ProtocolCommandTimeoutError', message: 'Protocol command deadline exceeded: original-body' });
});

test('unproven cancellation cannot turn a command timeout into expected success', async () => {
  const outcome = await boundedOutcome(runObservedProtocolCommand({ command: pending,
    cancellation: Promise.resolve({ proven: false }), timeoutMs: 10,
    description: 'original-body' }).catch(error => error.name));
  assert.equal(outcome, 'ProtocolCommandTimeoutError');
});

test('protocol failures remain failures', async () => {
  const failure = new Error('protocol failed');
  await assert.rejects(runObservedProtocolCommand({ command: async () => { throw failure; }, timeoutMs: 20 }),
    error => error === failure);
});

test('a canceled losing command rejection is handled', async () => {
  let rejectCommand;
  const command = () => new Promise((resolve, reject) => { rejectCommand = reject; });
  const outcome = await boundedOutcome(runObservedProtocolCommand({ command,
    cancellation: Promise.resolve({ proven: true, traceId: 'same-request' }), timeoutMs: 20 }));
  assert.equal(outcome.kind, 'cancelled');
  rejectCommand(new Error('request disposed after cancellation'));
  await new Promise(resolve => setImmediate(resolve));
});

test('observer drain and protocol cleanup remain bounded without a cancellation allowance', async () => {
  for (const phase of ['observer-drain', 'Fetch.continueResponse', 'Fetch.disable', 'detach']) {
    const outcome = await boundedOutcome(withProtocolDeadline(pending, phase, 10).catch(error => ({ name: error.name, message: error.message })));
    assert.deepEqual(outcome, { name: 'ProtocolCommandTimeoutError', message: `Protocol command deadline exceeded: ${phase}` });
  }
});
