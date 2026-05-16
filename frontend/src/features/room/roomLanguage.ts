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

/**
 * Алиасы для "пустого" языка без подсветки. Любое из этих значений
 * нормализуется в канонический `plaintext`, который понимает
 * `RoomCodeEditor` (там оно превращается в no-op language extension).
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

export function normalizeRoomLanguage(
  language: string | null | undefined,
): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized) return "nodejs";
  if (NODEJS_LANGUAGE_ALIASES.has(normalized)) {
    return "nodejs";
  }
  if (PLAINTEXT_LANGUAGE_ALIASES.has(normalized)) {
    return "plaintext";
  }
  return normalized;
}

export function toEditorLanguage(language: string | null | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized || NODEJS_LANGUAGE_ALIASES.has(normalized)) {
    return "javascript";
  }
  if (PLAINTEXT_LANGUAGE_ALIASES.has(normalized)) {
    return "plaintext";
  }
  return normalizeRoomLanguage(normalized);
}

export function isPlaintextLanguage(
  language: string | null | undefined,
): boolean {
  const normalized = (language ?? "").trim().toLowerCase();
  return PLAINTEXT_LANGUAGE_ALIASES.has(normalized);
}
