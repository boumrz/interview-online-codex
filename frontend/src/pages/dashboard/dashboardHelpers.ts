import type { DashboardSection } from "./dashboardConstants";

export type RoomSaveStatus = "idle" | "saving" | "saved" | "error";

const NODEJS_LANGUAGE_ALIASES = new Set(["nodejs", "javascript", "typescript"]);
/**
 * Алиасы, которые должны сворачиваться в канонический `plaintext`.
 * Нужно держать список синхронным с `roomLanguage.PLAINTEXT_LANGUAGE_ALIASES`.
 */
const PLAINTEXT_LANGUAGE_ALIASES = new Set([
  "plaintext",
  "plain-text",
  "plain_text",
  "plain",
  "text",
  "txt",
  "none",
]);

/**
 * Lower-cases the language slug and folds JS/TS variants onto the
 * canonical `nodejs` runtime label used by the room/task model.
 */
export function normalizeLanguageKey(language: string | null | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized || NODEJS_LANGUAGE_ALIASES.has(normalized)) return "nodejs";
  if (PLAINTEXT_LANGUAGE_ALIASES.has(normalized)) return "plaintext";
  return normalized;
}

/**
 * Type-guard used when reading `?section=` query parameter. Adds runtime
 * checks for feature-flagged (`agents`) and admin-only (`admin`) sections.
 */
export function isDashboardSection(
  value: string | undefined,
  agentOpsEnabled: boolean,
  isAdmin: boolean,
): value is DashboardSection {
  if (value === "rooms" || value === "tasks" || value === "presets" || value === "manage") return true;
  if (isAdmin && value === "admin") return true;
  return agentOpsEnabled && value === "agents";
}

export function statusColor(status: RoomSaveStatus | undefined) {
  if (status === "saving") return "yellow";
  if (status === "saved") return "teal";
  if (status === "error") return "red";
  return "gray";
}

export function statusLabel(status: RoomSaveStatus | undefined) {
  if (status === "saving") return "Сохранение...";
  if (status === "saved") return "Сохранено";
  if (status === "error") return "Ошибка";
  return "Без изменений";
}

/** Pretty label for known languages; unknown values map to Node JS. */
export function labelForLanguage(language: string) {
  switch (normalizeLanguageKey(language)) {
    case "nodejs":
      return "Node JS";
    case "python":
      return "Python";
    case "kotlin":
      return "Kotlin";
    case "java":
      return "Java";
    case "sql":
      return "SQL";
    case "plaintext":
      return "Plain text";
    default:
      return "Node JS";
  }
}

/** Renders an ISO timestamp in Russian locale; passes through invalid input. */
export function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
