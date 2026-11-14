import assert from "node:assert/strict";
import { test } from "node:test";
import { createPresencePublisher } from "../../src/features/room/roomPresencePublisher.ts";

test("a superseded presence POST never blocks, retries or acknowledges the latest status", async () => {
  const posts: Array<{ status: string; sequence: number; signal: AbortSignal; settle: (ok: boolean) => void }> = [];
  const publisher = createPresencePublisher((status, sequence, signal) => new Promise(resolve => {
    posts.push({ status, sequence, signal, settle: resolve });
  }));
  try {
    publisher.publish("active");
    publisher.publish("away");
    publisher.publish("away");
    assert.deepEqual(posts.map(p => p.status), ["active", "away"]);
    assert.equal(posts[0].signal.aborted, true);
    assert.ok(posts[1].sequence > posts[0].sequence);
    posts[0].settle(false);
    posts[1].settle(true);
    await Promise.resolve();
    publisher.publish("away");
    assert.equal(posts.length, 2);
    publisher.reset();
    publisher.publish("away");
    assert.equal(posts.length, 3, "a new stream republishes the current status");
    posts[2].settle(true);
  } finally { publisher.reset(); }
});

test("a failed presence POST retries the same intent without another focus event", async () => {
  const sequences: number[] = [];
  const publisher = createPresencePublisher(async (_status, sequence) => {
    sequences.push(sequence);
    return sequences.length > 1;
  });
  try {
    publisher.publish("away");
    await new Promise(resolve => setTimeout(resolve, 1150));
    assert.equal(sequences.length, 2);
    assert.equal(sequences[1], sequences[0]);
  } finally { publisher.reset(); }
});
