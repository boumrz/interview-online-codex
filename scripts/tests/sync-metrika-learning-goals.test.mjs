import assert from "node:assert/strict";
import test from "node:test";
import { LEARNING_GOAL_DEFINITIONS, syncLearningMetrikaGoals } from "../sync-metrika-learning-goals.mjs";

const modules = { personal_interviews: 3, team_interviews: 3, library: 2, candidates: 2, tracks: 2, team_settings: 2, room: 5 };
const actions = ["offer_seen", "offer_skip", "manual_open", "manual_start", "first_start", "retry_start", "resume", "cancel", "first_done", "replay_start", "replay_done"];

test("learning goals cover each module's full lifecycle and actual steps", () => {
  const expected = Object.entries(modules).flatMap(([module, count]) => [
    ...actions.map(action => `learn_${module}_${action}_v1`),
    ...Array.from({ length: count }, (_, index) => `learn_${module}_step_${index + 1}_v1`),
  ]);
  assert.deepEqual(LEARNING_GOAL_DEFINITIONS.map(goal => goal.target).sort(), expected.sort());
  assert.equal(new Set(LEARNING_GOAL_DEFINITIONS.map(goal => goal.key)).size, 96);
  assert.equal(new Set(LEARNING_GOAL_DEFINITIONS.map(goal => goal.name)).size, 96);
});

test("learning sync preserves unrelated goals and safely resumes after partial creation", async () => {
  const originalFetch = globalThis.fetch;
  const existing = LEARNING_GOAL_DEFINITIONS.slice(0, 5).map((definition, index) => ({
    id: index + 1, name: definition.name, type: "action", status: "Active",
    conditions: [{ type: "exact", url: definition.target }],
  }));
  const goals = [...existing, { id: 500, name: "Existing product goal", type: "action", status: "Active", conditions: [{ type: "exact", url: "int_candidate_joined_v1" }] }];
  const writes = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    if (method === "POST") {
      const body = JSON.parse(options.body).goal;
      writes.push(body);
      const goal = { ...body, id: 1000 + writes.length, status: "Active" };
      goals.push(goal);
      return { ok: true, json: async () => ({ goal }) };
    }
    assert.equal(method, "GET");
    if (String(url).endsWith("/goals?useDeleted=true")) return { ok: true, json: async () => ({ goals }) };
    const id = Number(String(url).match(/\/goal\/(\d+)$/)?.[1]);
    return { ok: true, json: async () => ({ goal: goals.find(goal => goal.id === id) }) };
  };
  try {
    const first = await syncLearningMetrikaGoals({ token: "fixture-token", apply: true });
    assert.equal(first.created.length, 91);
    assert.equal(first.verified.length, 96);
    const second = await syncLearningMetrikaGoals({ token: "fixture-token", apply: true });
    assert.equal(second.created.length, 0);
    assert.equal(writes.length, 91);
    assert.ok(writes.every(goal => goal.conditions[0].url.startsWith("learn_")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
