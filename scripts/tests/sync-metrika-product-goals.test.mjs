import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_GOAL_DEFINITIONS,
  syncProductMetrikaGoals,
} from "../sync-metrika-product-goals.mjs";

function actionGoal(definition, id, overrides = {}) {
  return {
    id,
    name: definition.name,
    type: "action",
    status: "Active",
    conditions: [{ type: "exact", url: definition.target }],
    ...overrides,
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

async function withFetchStub(stub, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("goal sync rejects invalid counter IDs before making a network request", async () => {
  let requested = false;
  await withFetchStub(async () => {
    requested = true;
    return response({});
  }, async () => {
    await assert.rejects(
      syncProductMetrikaGoals({ token: "test-token", counterId: 0, apply: true }),
      /positive integer/,
    );
  });
  assert.equal(requested, false);
});

test("goal sync validates every existing matching goal before issuing a POST", async () => {
  const requests = [];
  const goals = [
    actionGoal(PRODUCT_GOAL_DEFINITIONS[0], 1),
    actionGoal(PRODUCT_GOAL_DEFINITIONS[1], 2, { status: "Inactive" }),
  ];
  await withFetchStub(async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method ?? "GET" });
    return response({ goals });
  }, async () => {
    await assert.rejects(
      syncProductMetrikaGoals({ token: "test-token", counterId: 101, apply: true }),
      /does not match the approved v1 definition/,
    );
  });
  assert.deepEqual(requests.map((request) => request.method), ["GET"]);
});

test("goal sync creates only missing versioned goals and read-back verifies them", async () => {
  const requests = [];
  const createdById = new Map();
  let nextId = 100;
  await withFetchStub(async (url, options = {}) => {
    const method = options.method ?? "GET";
    const requestUrl = String(url);
    requests.push({ url: requestUrl, method });
    if (method === "GET" && requestUrl.endsWith("/goals?useDeleted=true")) {
      return response({ goals: [] });
    }
    if (method === "POST") {
      const definition = PRODUCT_GOAL_DEFINITIONS.find((item) => item.target === JSON.parse(options.body).goal.conditions[0].url);
      const goal = actionGoal(definition, nextId++);
      createdById.set(goal.id, goal);
      return response({ goal });
    }
    const id = Number(requestUrl.match(/\/goal\/(\d+)$/)?.[1]);
    return response({ goal: createdById.get(id) });
  }, async () => {
    const result = await syncProductMetrikaGoals({ token: "test-token", counterId: 101, apply: true });
    assert.deepEqual(result.created, PRODUCT_GOAL_DEFINITIONS.map((definition) => definition.key));
    assert.deepEqual(result.verified.map((goal) => goal.key), PRODUCT_GOAL_DEFINITIONS.map((definition) => definition.key));
  });
  assert.equal(requests.filter((request) => request.method === "POST").length, PRODUCT_GOAL_DEFINITIONS.length);
  assert.equal(requests.filter((request) => request.method === "GET").length, PRODUCT_GOAL_DEFINITIONS.length + 1);
});
