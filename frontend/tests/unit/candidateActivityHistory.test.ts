import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateKeyInfo } from "../../src/features/room/candidateKeys.ts";

const loadHistory = () => import("../../src/features/room/candidateActivityHistory.ts");
const loadProjection = () => import("../../src/features/room/activityTimelineProjection.ts");

function event(sequence: number, timestampEpochMs = sequence): CandidateKeyInfo {
  return {
    sourceEventId: `source-${sequence}`, acceptedSequence: sequence,
    sessionId: "candidate", displayName: "Кандидат", key: "a", keyCode: "KeyA",
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, timestampEpochMs,
  };
}

function page(events: CandidateKeyInfo[], throughSequence: number, options: {
  nextBeforeSequence?: number; nextAfterSequence?: number;
} = {}) {
  return {
    events, throughSequence,
    hasMore: options.nextBeforeSequence != null || options.nextAfterSequence != null,
    nextBeforeSequence: options.nextBeforeSequence ?? null,
    nextAfterSequence: options.nextAfterSequence ?? null,
  };
}

test("older pages keep their initial boundary while catch-up advances independently", async () => {
  const { createHistoryCursor, advanceHistoryCursor, historyPageQuery } = await loadHistory();
  const initial = advanceHistoryCursor(createHistoryCursor(), "latest", page([event(251), event(450)], 450, { nextBeforeSequence: 251 }));
  const caughtUp = advanceHistoryCursor(initial, "catchup", page([event(451)], 451));
  assert.deepEqual(historyPageQuery(caughtUp, "older"), { limit: "200", beforeSequence: "251", throughSequence: "450" });
  const older = advanceHistoryCursor(caughtUp, "older", page([event(51), event(250)], 450, { nextBeforeSequence: 51 }));
  assert.deepEqual(historyPageQuery(older, "catchup"), { limit: "200", afterSequence: "451" });
  const complete = advanceHistoryCursor(older, "older", page([event(1), event(50)], 450));
  assert.equal(complete.olderBefore, null);
  assert.equal(complete.confirmedThrough, 451);
});

test("future SSE events cannot advance the confirmed cursor past a missing multi-page gap", async () => {
  const { createHistoryCursor, advanceHistoryCursor, historyPageQuery } = await loadHistory();
  const { reconcileActivityEvents } = await loadProjection();
  const initial = advanceHistoryCursor(createHistoryCursor(), "latest", page([event(1)], 1));
  const withFutureLive = reconcileActivityEvents([event(1), event(450)]);
  assert.deepEqual(historyPageQuery(initial, "catchup"), { limit: "200", afterSequence: "1" });
  const firstPage = page(Array.from({ length: 200 }, (_, index) => event(index + 2)), 449, { nextAfterSequence: 201 });
  const partial = advanceHistoryCursor(initial, "catchup", firstPage);
  assert.equal(partial.confirmedThrough, 1);
  assert.deepEqual(historyPageQuery(partial, "catchup"), { limit: "200", afterSequence: "201", throughSequence: "449" });
  const secondPage = page(Array.from({ length: 200 }, (_, index) => event(index + 202)), 449, { nextAfterSequence: 401 });
  const second = advanceHistoryCursor(partial, "catchup", secondPage);
  assert.equal(second.confirmedThrough, 1);
  const lastPage = page(Array.from({ length: 48 }, (_, index) => event(index + 402)), 449);
  const complete = advanceHistoryCursor(second, "catchup", lastPage);
  assert.deepEqual(historyPageQuery(complete, "catchup"), { limit: "200", afterSequence: "449" });
  const loaded = reconcileActivityEvents([...withFutureLive, ...firstPage.events, ...secondPage.events, ...lastPage.events]);
  assert.equal(loaded.length, 450);
  assert.equal(new Set(loaded.map((item) => item.sourceEventId)).size, 450);
});

test("overlapping pages and empty or stale snapshots preserve immutable sources in canonical order", async () => {
  const { createHistoryCursor } = await loadHistory();
  const { reconcileActivityEvents } = await loadProjection();
  assert.equal(createHistoryCursor().confirmedThrough, null);
  const batches = [[event(3, 10), event(4, 5)], [event(1, 1), event(2, 10)], [], [event(3, 10)]];
  const permutations = [batches, batches.toReversed(), [batches[1], batches[3], batches[0], batches[2]]];
  for (const permutation of permutations) {
    const loaded = permutation.reduce<CandidateKeyInfo[]>((all, incoming) => reconcileActivityEvents([...all, ...incoming]), []);
    assert.deepEqual(loaded.map((item) => item.acceptedSequence), [1, 4, 2, 3]);
    const duplicate = { ...event(3, 10), key: "changed" };
    assert.equal(reconcileActivityEvents([...loaded, duplicate]).find((item) => item.acceptedSequence === 3)?.key, "a");
  }
});

test("confirmed empty history catches the next event without inventing a completed future boundary", async () => {
  const { createHistoryCursor, advanceHistoryCursor, historyPageQuery } = await loadHistory();
  const empty = advanceHistoryCursor(createHistoryCursor(), "latest", page([], 0));
  assert.equal(empty.confirmedThrough, 0);
  assert.equal(empty.olderBefore, null);
  assert.deepEqual(historyPageQuery(empty, "catchup"), { limit: "200", afterSequence: "0" });
  const next = advanceHistoryCursor(empty, "catchup", page([event(1)], 1));
  assert.equal(next.confirmedThrough, 1);
});

test("non-progressing or changed-boundary continuation is rejected instead of looping or skipping events", async () => {
  const { createHistoryCursor, advanceHistoryCursor } = await loadHistory();
  const initial = advanceHistoryCursor(createHistoryCursor(), "latest", page([event(1)], 1));
  assert.throws(() => advanceHistoryCursor(initial, "catchup", page([event(1)], 10, { nextAfterSequence: 1 })));
  const partial = advanceHistoryCursor(initial, "catchup", page([event(2)], 10, { nextAfterSequence: 2 }));
  assert.throws(() => advanceHistoryCursor(partial, "catchup", page([event(3)], 11)));
});

test("history responses enforce the 200-event boundary and reject malformed pages instead of claiming empty", async () => {
  const { parseActivityHistoryPage } = await loadHistory();
  const bounded = page(Array.from({ length: 200 }, (_, index) => event(index + 1)), 200);
  assert.equal(parseActivityHistoryPage(bounded).events.length, 200);
  assert.deepEqual(parseActivityHistoryPage(page([], 0)), page([], 0));
  for (const invalid of [
    page(Array.from({ length: 201 }, (_, index) => event(index + 1)), 201),
    { ...bounded, events: [event(1), { ...event(2), sourceEventId: null }] },
    { ...bounded, throughSequence: -1 },
    { ...bounded, throughSequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...bounded, hasMore: "false" },
    { ...bounded, nextAfterSequence: undefined },
    { ...bounded, events: null },
  ]) assert.throws(() => parseActivityHistoryPage(invalid));
});

test("older continuation cannot repeat its cursor or change the frozen upper boundary", async () => {
  const { createHistoryCursor, advanceHistoryCursor, historyPageQuery } = await loadHistory();
  assert.throws(() => historyPageQuery(createHistoryCursor(), "older"));
  assert.throws(() => historyPageQuery(createHistoryCursor(), "catchup"));
  const initial = advanceHistoryCursor(createHistoryCursor(), "latest", page([event(10)], 10, { nextBeforeSequence: 10 }));
  assert.throws(() => advanceHistoryCursor(initial, "older", page([event(9)], 11)));
  assert.throws(() => advanceHistoryCursor(initial, "older", page([event(10)], 10, { nextBeforeSequence: 10 })));
  assert.throws(() => advanceHistoryCursor(initial, "older", page([event(1)], 10, { nextBeforeSequence: 0 })));
});
