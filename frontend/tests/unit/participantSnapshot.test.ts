import assert from "node:assert/strict";
import { test } from "node:test";
import { currentParticipantSnapshot } from "../../src/features/room/participantSnapshot.ts";

const snapshot = {
  inviteCode: "one", eventToken: "lease", role: "owner", canManageRoom: true,
  participantSnapshotRevision: 12, participants: [{ sessionId: "second", presenceStatus: "away" }],
};
const stale = {
  ...snapshot, participantSnapshotRevision: 11,
  participants: [{ sessionId: "first", presenceStatus: "active" }],
};

test("late snapshots cannot revert per-candidate focus, remove a join or resurrect a departure", () => {
  assert.equal(currentParticipantSnapshot(snapshot, stale), snapshot);
  assert.equal(currentParticipantSnapshot(stale, snapshot), snapshot);
  assert.equal(currentParticipantSnapshot(null, snapshot), snapshot);
  const legacy = { ...stale, participantSnapshotRevision: undefined };
  assert.equal(currentParticipantSnapshot(snapshot, legacy), snapshot);
  assert.equal(currentParticipantSnapshot(legacy, legacy), legacy);
});

test("new room, admission or role takes its own roster even when its revision is lower", () => {
  for (const scope of [
    { inviteCode: "two" },
    { eventToken: "replacement" },
    { role: "candidate", canManageRoom: false },
    { canManageRoom: false },
  ]) {
    const incoming = { ...stale, ...scope };
    assert.equal(currentParticipantSnapshot(snapshot, incoming), incoming);
  }
});
