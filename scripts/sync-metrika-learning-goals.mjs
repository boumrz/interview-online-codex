#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { syncMetrikaGoals } from "./sync-metrika-product-goals.mjs";

const MODULES = [
  ["personal_interviews", "Личные интервью", 3],
  ["team_interviews", "Командные интервью", 3],
  ["library", "Библиотека", 2],
  ["candidates", "Кандидаты", 2],
  ["tracks", "Треки и вакансии", 2],
  ["team_settings", "Настройки команды", 2],
  ["room", "Комната", 5],
];
const ACTIONS = [
  ["offer_seen", "Предложение показано"],
  ["offer_skip", "Предложение пропущено"],
  ["manual_open", "Помощь открыта вручную"],
  ["manual_start", "Старт из помощи"],
  ["first_start", "Первый старт"],
  ["retry_start", "Старт после отмены"],
  ["resume", "Продолжение"],
  ["cancel", "Прохождение отменено"],
  ["first_done", "Первое завершение"],
  ["replay_start", "Повторный старт"],
  ["replay_done", "Повторное завершение"],
];

export const LEARNING_GOAL_DEFINITIONS = Object.freeze(MODULES.flatMap(([module, label, steps]) => {
  const actions = [...ACTIONS, ...Array.from({ length: steps }, (_, index) => [`step_${index + 1}`, `Шаг ${index + 1}`])];
  return actions.map(([action, actionLabel]) => Object.freeze({
    key: `${module}_${action}`,
    target: `learn_${module}_${action}_v1`,
    name: `Обучение · ${label} · ${actionLabel} (v1)`,
  }));
}));

export function syncLearningMetrikaGoals(options = {}) {
  return syncMetrikaGoals({ ...options, definitions: LEARNING_GOAL_DEFINITIONS });
}

async function main() {
  const result = await syncLearningMetrikaGoals({
    token: process.env.METRIKA_OAUTH_TOKEN,
    counterId: Number(process.env.METRIKA_COUNTER_ID || 109032539),
    apply: process.argv.includes("--apply"),
  });
  console.log(`Learning goals verified: ${result.verified.length}; created: ${result.created.length}; missing: ${result.missing.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Metrika learning-goal sync failed.");
    process.exitCode = 1;
  });
}
