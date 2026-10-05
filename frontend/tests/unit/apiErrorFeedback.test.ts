import assert from "node:assert/strict";
import { test } from "node:test";
import { getApiErrorMessage, normalizeApiError } from "../../src/services/apiErrors.ts";

test("network failures show a Russian connection error without browser internals", () => {
  for (const error of [
    { status: "FETCH_ERROR", error: "TypeError: Failed to fetch" },
    new TypeError("Failed to fetch"),
    new Error("NetworkError when attempting to fetch resource."),
    { error: "Load failed" },
  ]) {
    assert.equal(getApiErrorMessage(error), "Ошибка сети. Проверьте подключение и повторите попытку.");
  }
});

test("timeouts, malformed responses and server failures offer meaningful recovery", () => {
  assert.equal(getApiErrorMessage({ status: "TIMEOUT_ERROR", error: "TimeoutError" }), "Сервер не ответил вовремя. Повторите попытку.");
  assert.equal(getApiErrorMessage({ status: "PARSING_ERROR", error: "SyntaxError", originalStatus: 200 }), "Не удалось прочитать ответ сервера. Повторите попытку.");
  assert.equal(getApiErrorMessage({ status: 503, data: { error: "Database connection failed" } }), "Ошибка сервера. Повторите попытку позже.");
});

test("safe server validation messages and caller-specific fallbacks are preserved", () => {
  assert.equal(getApiErrorMessage({ status: 400, data: { error: "Ник уже занят" } }), "Ник уже занят");
  assert.equal(getApiErrorMessage(new Error("Неверные данные задачи.")), "Неверные данные задачи.");
  assert.equal(getApiErrorMessage({ status: 404, data: { error: "Not found" } }, "Нанимающий не найден"), "Нанимающий не найден");
  assert.equal(getApiErrorMessage(null, "Не удалось сохранить имя"), "Не удалось сохранить имя");
});

test("API normalization keeps statuses and business codes for permission and retry handling", () => {
  const normalized = normalizeApiError({ status: "FETCH_ERROR", error: "TypeError: Failed to fetch" });
  assert.equal(normalized.status, "FETCH_ERROR");
  assert.equal("error" in normalized ? normalized.error : null, "Ошибка сети. Проверьте подключение и повторите попытку.");
  assert.equal(normalized.data, undefined);
  assert.deepEqual(normalizeApiError({ status: 409, data: { error: "Сведения изменились", code: "REVISION_CONFLICT", revision: 7 } }), {
    status: 409, data: { error: "Сведения изменились", code: "REVISION_CONFLICT", revision: 7 },
  });
});
