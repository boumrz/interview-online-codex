export type ManagementIntent<TBody> = Readonly<{
  idempotencyKey: string;
  body: TBody;
}>;

export type ManagementErrorKind = "conflict" | "retryable" | "terminal";

type ApiErrorLike = {
  status?: number | string;
  data?: { code?: unknown };
};

/**
 * Keeps a failed user intent in component memory only. The caller supplies the
 * key on retries, so commands never silently become a second mutation.
 */
export function createManagementIntent<TBody>(body: TBody, idempotencyKey = crypto.randomUUID()): ManagementIntent<TBody> {
  return { idempotencyKey, body };
}

export function managementErrorKind(error: unknown): ManagementErrorKind {
  if (!error || typeof error !== "object") return "retryable";
  const { status, data } = error as ApiErrorLike;
  if (status === 409 && typeof data?.code === "string" && data.code.endsWith("REVISION_CONFLICT")) {
    return "conflict";
  }
  if (status === "FETCH_ERROR" || status === "TIMEOUT_ERROR" || status === 429 || (typeof status === "number" && status >= 500)) {
    return "retryable";
  }
  return "terminal";
}

export function managementErrorMessage(kind: ManagementErrorKind): string {
  switch (kind) {
    case "conflict":
      return "Данные команды уже изменились. Обновите данные и повторите действие.";
    case "retryable":
      return "Команда временно недоступна. Повторите действие с теми же данными.";
    case "terminal":
      return "Не удалось выполнить действие. Проверьте текущие права доступа.";
  }
}
