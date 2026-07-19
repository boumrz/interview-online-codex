#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const API_BASE_URL = "https://api-metrika.yandex.net";
const DEFAULT_COUNTER_ID = 109032539;
const REQUEST_TIMEOUT_MS = 15_000;

export const PRODUCT_GOAL_DEFINITIONS = Object.freeze([
  { key: "candidateJoined", target: "int_candidate_joined_v1", name: "P01 · Candidate joined room (v1)" },
  { key: "meaningfulCandidateActivity", target: "int_meaningful_candidate_activity_v1", name: "P02 · Meaningful candidate activity (v1)" },
  { key: "verdictSaved", target: "int_verdict_saved_v1", name: "P03 · Verdict saved (v1)" },
]);

function safeError(status) {
  if (status === 401 || status === 403) return "Metrika rejected access to the counter.";
  if (status === 420 || status === 429) return "Metrika temporarily limited requests.";
  return "Metrika goal request failed.";
}

async function request(path, { token, method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `OAuth ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(safeError(response.status));
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Metrika goal request timed out.");
    if (error instanceof Error) throw error;
    throw new Error("Metrika goal request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function goalTarget(goal) {
  return goal?.type === "action" ? goal.conditions?.find((condition) => condition?.type === "exact")?.url ?? null : null;
}

function verifyGoal(goal, definition) {
  return goal?.type === "action"
    && goal?.name === definition.name
    && goalTarget(goal) === definition.target
    && goal?.status === "Active";
}

export async function syncProductMetrikaGoals({ token, counterId = DEFAULT_COUNTER_ID, apply = false } = {}) {
  if (!token?.trim()) throw new Error("METRIKA_OAUTH_TOKEN is required.");
  if (!Number.isSafeInteger(counterId) || counterId <= 0) throw new Error("METRIKA_COUNTER_ID must be a positive integer.");
  const goalsPayload = await request(`/management/v1/counter/${counterId}/goals?useDeleted=true`, { token });
  const goals = Array.isArray(goalsPayload?.goals) ? goalsPayload.goals : [];
  const existingByTarget = new Map();
  for (const goal of goals) {
    const target = goalTarget(goal);
    if (!target) continue;
    const matching = PRODUCT_GOAL_DEFINITIONS.find((definition) => definition.target === target);
    if (!matching) continue;
    if (existingByTarget.has(target)) throw new Error("Metrika has duplicate product goal targets; no changes were made.");
    existingByTarget.set(target, goal);
  }

  const missing = PRODUCT_GOAL_DEFINITIONS.filter((definition) => !existingByTarget.has(definition.target));
  for (const definition of PRODUCT_GOAL_DEFINITIONS) {
    const existing = existingByTarget.get(definition.target);
    if (existing && !verifyGoal(existing, definition)) {
      throw new Error("An existing product goal does not match the approved v1 definition; no changes were made.");
    }
  }
  if (!apply) return { created: [], missing: missing.map((definition) => definition.key), verified: [] };

  for (const definition of missing) {
    const created = await request(`/management/v1/counter/${counterId}/goals`, {
      token,
      method: "POST",
      body: {
        goal: {
          name: definition.name,
          type: "action",
          conditions: [{ type: "exact", url: definition.target }],
        },
      },
    });
    const goal = created?.goal;
    if (!goal?.id) throw new Error("Metrika returned an incomplete goal response.");
    existingByTarget.set(definition.target, goal);
  }

  const verified = [];
  for (const definition of PRODUCT_GOAL_DEFINITIONS) {
    const expected = existingByTarget.get(definition.target);
    const payload = await request(`/management/v1/counter/${counterId}/goal/${expected?.id}`, { token });
    if (!verifyGoal(payload?.goal, definition)) throw new Error("A product goal failed post-create verification.");
    verified.push({ key: definition.key, id: payload.goal.id });
  }
  return { created: missing.map((definition) => definition.key), missing: [], verified };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await syncProductMetrikaGoals({
    token: process.env.METRIKA_OAUTH_TOKEN,
    counterId: Number(process.env.METRIKA_COUNTER_ID || DEFAULT_COUNTER_ID),
    apply,
  });
  if (!apply) {
    console.log(`Metrika product-goal dry run: ${result.missing.length} missing goals.`);
    return;
  }
  console.log(`Metrika product goals verified: ${result.verified.length}; created: ${result.created.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Metrika product-goal sync failed.");
    process.exitCode = 1;
  });
}
