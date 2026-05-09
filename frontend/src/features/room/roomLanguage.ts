/**
 * Нормализация языка комнаты на фронтенде.
 *
 * Зеркалит `LanguageNormalizer` из бэкенда: приводит человекочитаемые
 * имена языков (включая JS-семейство) к каноническому ключу, который
 * ходит между API/хранилищем/UI.
 *
 * `toEditorLanguage` дополнительно мапит `nodejs` → `javascript` для
 * монако/CodeMirror-плагинов синтаксиса.
 */

const NODEJS_LANGUAGE_ALIASES = new Set([
  "javascript",
  "typescript",
  "nodejs",
]);

export function normalizeRoomLanguage(
  language: string | null | undefined,
): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized) return "nodejs";
  if (NODEJS_LANGUAGE_ALIASES.has(normalized)) {
    return "nodejs";
  }
  return normalized;
}

export function toEditorLanguage(language: string | null | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized || NODEJS_LANGUAGE_ALIASES.has(normalized)) {
    return "javascript";
  }
  return normalizeRoomLanguage(normalized);
}
