/**
 * Логирование клавиатуры кандидата.
 *
 * Здесь живут типы данных, которыми обмениваются клиент и сервер по событиям
 * клавиш кандидата (`CandidateKeyInfo`, `KeyPressPayload`,
 * `CandidateKeyEventKind`), а также pure-функции форматирования: они нужны и
 * самому компоненту комнаты, и UI логов, и любому коду, который захочет
 * отобразить нажатые клавиши/переключения окна.
 *
 * Никаких React-зависимостей здесь быть не должно — это слой данных и
 * чистых преобразований.
 */

/**
 * Возможные категории событий лога активности кандидата:
 * - `keydown` — обычное нажатие клавиши.
 * - `window_blur` — окно браузера потеряло фокус (Alt+Tab/Cmd+Tab,
 *   переключение на другое приложение).
 * - `window_focus` — окно браузера снова получило фокус.
 * - `tab_hidden` — вкладка стала скрытой (переключение на другую вкладку
 *   внутри браузера, сворачивание окна).
 * - `tab_visible` — вкладка снова видна.
 */
export type CandidateKeyEventKind =
  | "keydown"
  | "window_blur"
  | "window_focus"
  | "tab_hidden"
  | "tab_visible";

export type CandidateKeyInfo = {
  sessionId: string;
  displayName: string;
  key: string;
  keyCode: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  timestampEpochMs: number;
  /**
   * Опциональное поле — старые сообщения с бэкенда могут не содержать его,
   * тогда трактуем как обычный `keydown`.
   */
  eventKind?: CandidateKeyEventKind | string;
};

export type KeyPressPayload = {
  key: string;
  keyCode: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  eventKind?: CandidateKeyEventKind;
};

/**
 * Маппит DOM `KeyboardEvent.code` (например `KeyA`, `Digit3`, `NumpadEnter`)
 * в человекочитаемый ярлык. Возвращает пустую строку, если из `code` ничего
 * полезного выудить не получилось — вызывающий код решает, что показать вместо
 * этого.
 */
export function normalizeKeyCodeLabel(code: string): string {
  const normalizedCode = code.trim();
  if (!normalizedCode) return "";
  if (normalizedCode === "Unidentified") return "";
  if (normalizedCode.startsWith("Key")) {
    return normalizedCode.slice(3);
  }
  if (normalizedCode.startsWith("Digit")) {
    return normalizedCode.slice(5);
  }
  if (normalizedCode === "Space" || normalizedCode === "Spacebar") {
    return "Space";
  }
  if (
    normalizedCode === "Tab" ||
    normalizedCode === "Enter" ||
    normalizedCode === "Escape" ||
    normalizedCode === "Backspace" ||
    normalizedCode === "Delete"
  ) {
    return normalizedCode;
  }
  if (normalizedCode.startsWith("Numpad")) {
    return normalizedCode.replace("Numpad", "Num");
  }
  return normalizedCode.replace(/(Left|Right)$/g, "");
}

/**
 * Маппит DOM `KeyboardEvent.key` к стабильному ярлыку: убирает «голый» Tab/
 * Enter/пробел в их именованную форму, расшифровывает алиасы (Control → Ctrl,
 * Meta → Cmd и т.п.) и стрелки (ArrowLeft → Left). При пустом/«Unidentified»
 * `key` падает обратно на `keyCode`.
 */
export function normalizeKeyLabel(key: string, keyCode: string): string {
  if (key === " " || key === "\u00A0") {
    return "Space";
  }
  if (key === "\t") {
    return "Tab";
  }
  if (key === "\n" || key === "\r" || key === "\r\n") {
    return "Enter";
  }
  const normalized = key.trim();
  if (!normalized) {
    return normalizeKeyCodeLabel(keyCode) || "Unknown";
  }
  if (normalized === "Unidentified") {
    return normalizeKeyCodeLabel(keyCode) || "Unknown";
  }
  if (
    normalized === "Tab" ||
    normalized === "Enter" ||
    normalized === "Backspace" ||
    normalized === "Delete"
  ) {
    return normalized;
  }

  const aliases: Record<string, string> = {
    Control: "Ctrl",
    Meta: "Cmd",
    Command: "Cmd",
    OS: "Cmd",
    Escape: "Esc",
    Spacebar: "Space",
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  if (normalized.startsWith("Arrow")) {
    return normalized.slice(5);
  }
  return normalized;
}

/**
 * Собирает префикс из активных модификаторов («Cmd+», «Alt+Shift+» и т.п.)
 * для строки лога. Используется и обычными `keydown`, и синтетическими
 * событиями (blur/visibility), чтобы лейбл «Alt+Tab — переключение окна»
 * корректно отражал, какие клавиши держал кандидат. Через `exclude` можно
 * исключить модификатор, который и так уже стоит «основной» клавишей —
 * тогда «Ctrl+Ctrl» не получится.
 */
export function buildModifierPrefix(
  event: Pick<
    CandidateKeyInfo,
    "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  >,
  exclude: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): string {
  const modifiers: string[] = [];
  if (event.ctrlKey && !exclude.ctrl) modifiers.push("Ctrl");
  if (event.altKey && !exclude.alt) modifiers.push("Alt");
  if (event.shiftKey && !exclude.shift) modifiers.push("Shift");
  if (event.metaKey && !exclude.meta) modifiers.push("Cmd");
  return modifiers.length > 0 ? `${modifiers.join("+")}+` : "";
}

/**
 * Строит человекочитаемый лейбл события для строки лога. Для синтетических
 * событий (`window_blur`/`tab_hidden`/...) выдаёт фразы вида
 * «Alt+Tab — переключение окна», т.к. сам Tab ОС перехватывает у браузера и
 * обычным `keydown` он не приходит.
 */
export function formatCandidateKey(event: CandidateKeyInfo): string {
  /**
   * Синтетические события focus/visibility: ОС забирает себе сам Tab при
   * Alt+Tab/Cmd+Tab, и `keydown` для него до браузера не доходит. Мы знаем
   * только то, что окно/вкладка потеряли фокус и какие модификаторы при
   * этом были нажаты — формируем понятный составной лейбл.
   */
  const eventKind = event.eventKind ?? "keydown";
  if (eventKind !== "keydown") {
    const prefix = buildModifierPrefix(event);
    switch (eventKind) {
      case "window_blur":
        return prefix
          ? `${prefix}Tab — переключение окна`
          : "Переключение окна";
      case "window_focus":
        return "Возврат в окно";
      case "tab_hidden":
        return prefix
          ? `${prefix}Tab — смена вкладки`
          : "Смена вкладки";
      case "tab_visible":
        return "Возврат на вкладку";
      default:
        return prefix ? `${prefix}${eventKind}` : eventKind;
    }
  }

  const keyLabel = normalizeKeyLabel(event.key || "", event.keyCode || "");
  const isCtrlKey = keyLabel === "Ctrl";
  const isAltKey = keyLabel === "Alt";
  const isShiftKey = keyLabel === "Shift";
  const isMetaKey = keyLabel === "Cmd" || keyLabel === "Meta";
  const prefix = buildModifierPrefix(event, {
    ctrl: isCtrlKey,
    alt: isAltKey,
    shift: isShiftKey,
    meta: isMetaKey,
  });

  const key =
    keyLabel || normalizeKeyCodeLabel(event.keyCode || "") || "Unknown";
  return `${prefix}${key}`;
}

/** `HH:MM:SS` в локали ru-RU для строки лога. */
export function formatCandidateKeyHistoryTimestamp(
  event: CandidateKeyInfo,
): string {
  return new Date(event.timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
