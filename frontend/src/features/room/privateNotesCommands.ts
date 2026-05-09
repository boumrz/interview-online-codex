/**
 * Слэш-команды поля приватных заметок.
 *
 * Сейчас поддерживается только `/block <имя>` — выбор активного блока.
 * Закрытие блока делается крестиком на бейдже, отдельной команды нет.
 *
 * Также живёт `parseStepBlockName` — распознавание имён вида «Шаг 1»/«step 2»
 * для перехода активного блока обратно к шаговому при ручном вводе имени.
 */

export type PersonalNotesCommand =
  | { kind: "none" }
  | { kind: "menu" }
  | { kind: "block_prompt" }
  | { kind: "block_apply"; blockName: string }
  | { kind: "unknown"; raw: string };

/**
 * Recognises step block names: `Шаг 1`, `step 2`, `шаг 03` etc. Returns the
 * 0-based step index or `null` if the input is a regular custom name.
 */
export function parseStepBlockName(rawName: string): number | null {
  const normalized = rawName.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return null;
  const match = normalized.match(/^(?:шаг|step)\s+0*(\d{1,3})$/);
  if (!match) return null;
  const oneBased = Number.parseInt(match[1], 10);
  if (!Number.isFinite(oneBased) || oneBased < 1) return null;
  return oneBased - 1;
}

/**
 * Парсер слэш-команд в поле личных заметок.
 *
 * Возвращает discriminated union, где `kind`:
 * - `none` — пользователь печатает обычный текст (или ввод многострочный).
 * - `menu` — введён только `/`, нужно показать подсказки команд.
 * - `block_prompt` — есть префикс `/block` без имени, нужно подсказать выбор.
 * - `block_apply` — `/block <имя>` готов к применению.
 * - `unknown` — слэш-команда, которую мы пока не понимаем.
 *
 * Имя блока ограничено 80 символами — с запасом покрывает реальные «Шаг N»
 * и кастомные названия, но защищает от случайного вставления огромного
 * текста после `/block`.
 */
export function parsePersonalNotesCommand(value: string): PersonalNotesCommand {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (!normalized.startsWith("/")) return { kind: "none" };
  if (normalized.includes("\n")) return { kind: "none" };
  const normalizedLower = normalized.toLowerCase();
  if (normalizedLower === "/") return { kind: "menu" };
  if ("/block".startsWith(normalizedLower)) {
    return { kind: "block_prompt" };
  }
  if (normalizedLower.startsWith("/block ")) {
    const blockName = normalized.slice("/block ".length).trim().slice(0, 80);
    if (!blockName) {
      return { kind: "block_prompt" };
    }
    return { kind: "block_apply", blockName };
  }
  return { kind: "unknown", raw: normalized };
}
