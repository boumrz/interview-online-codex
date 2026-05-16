/**
 * Утилиты для «focus mode» брифинг-панели — режима, в котором у обеих
 * сторон (интервьюер + кандидат) код-редактор скрыт, а вместо него
 * на весь рабочий регион показывается markdown.
 *
 * Чтобы не добавлять ещё одно поле в RealtimeState / WS-протокол,
 * пиггибэкаем состояние прямо на уже синхронизируемое поле
 * `briefingMarkdown`: невидимый sentinel-префикс
 *   `<!--briefing:focus=on-->\n`
 * означает «focus mode включён». Сам префикс никогда не показывается
 * пользователю — BriefingBoard вызывает `stripFocusMarker()` перед
 * парсингом markdown, а при сохранении интервьюер вызывает
 * `setFocusMode(value, true|false)`.
 *
 * Так у нас:
 *   - нет миграции backend / DB;
 *   - не сломается старый клиент (он просто покажет HTML-комментарий,
 *     ну а у нового всё работает);
 *   - изменение состояния идёт по тому же дебаунсу/конфликт-резолверу,
 *     что и обычное редактирование markdown.
 */

export const BRIEFING_FOCUS_ON_MARKER = "<!--briefing:focus=on-->";

const FOCUS_ON_REGEX = new RegExp(`^${BRIEFING_FOCUS_ON_MARKER}\\n?`);

/** Парсит сырое значение `briefingMarkdown` → состояние focus mode. */
export function extractFocusMode(briefingMarkdown: string): boolean {
  return FOCUS_ON_REGEX.test(briefingMarkdown ?? "");
}

/** Возвращает markdown без служебного префикса (для рендера/редактирования). */
export function stripFocusMarker(briefingMarkdown: string): string {
  if (!briefingMarkdown) return "";
  return briefingMarkdown.replace(FOCUS_ON_REGEX, "");
}

/**
 * Возвращает новый markdown с указанным состоянием focus mode.
 * `value` ожидается уже «чистый» (без маркера) — но функция всё равно
 * сначала вызывает `stripFocusMarker` для идемпотентности.
 */
export function setFocusMode(value: string, focusOn: boolean): string {
  const clean = stripFocusMarker(value);
  if (!focusOn) return clean;
  if (!clean) return `${BRIEFING_FOCUS_ON_MARKER}\n`;
  return `${BRIEFING_FOCUS_ON_MARKER}\n${clean}`;
}
