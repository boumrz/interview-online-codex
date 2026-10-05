import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

export function getApiErrorMessage(error: unknown, fallback = "Не удалось выполнить действие. Повторите попытку."): string {
  if (!error || typeof error !== "object") return fallback;
  const record = error as Record<string, unknown>;
  const status = record.status;
  if (status === "TIMEOUT_ERROR") return "Сервер не ответил вовремя. Повторите попытку.";
  if (typeof status === "number" && status >= 500) return "Ошибка сервера. Повторите попытку позже.";
  if (status === "PARSING_ERROR") return "Не удалось прочитать ответ сервера. Повторите попытку.";
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
  const message = data?.error ?? record.error ?? record.message;
  if (status === "FETCH_ERROR" || (typeof message === "string" && /failed to fetch|networkerror|network request failed|load failed|err_(internet_disconnected|network_changed|connection_refused)/i.test(message))) {
    return "Ошибка сети. Проверьте подключение и повторите попытку.";
  }
  // Backend validation messages are Russian; technical exceptions use the caller's recovery text.
  if (typeof message === "string" && /[А-Яа-яЁё]/.test(message)) return message.trim();
  return fallback;
}

export function normalizeApiError(error: FetchBaseQueryError): FetchBaseQueryError {
  const message = getApiErrorMessage(error);
  if (error.status === "FETCH_ERROR" || error.status === "TIMEOUT_ERROR" || error.status === "PARSING_ERROR") return { ...error, error: message };
  const data = error.data && typeof error.data === "object" && !Array.isArray(error.data)
    ? { ...error.data, error: message }
    : { error: message };
  return { ...error, data, ...("error" in error ? { error: message } : {}) };
}
