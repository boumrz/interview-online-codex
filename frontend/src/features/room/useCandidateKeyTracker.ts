import { useEffect } from "react";
import type {
  CandidateKeyEventKind,
  KeyPressPayload,
} from "./candidateKeys";

type CandidateKeyTrackerOptions = {
  /**
   * Включаем трекинг только если текущая роль участника — `candidate`.
   * Для интервьюера/owner глобальный лог не нужен.
   */
  active: boolean;
  /**
   * Колбэк, который шлёт payload на сервер. Хук НЕ принимает на себя
   * решения по троттлингу/доставке — это ответственность подписчика.
   */
  onKeyEvent: (payload: KeyPressPayload) => void;
};

/**
 * Глобальные слушатели клавиатуры и фокуса на стороне кандидата. Они
 * закрывают пробелы, которые не покрывает `keydown`-хэндлер CodeMirror:
 *   1. Клавиши, нажатые когда фокус не в редакторе (модалки, заметки,
 *      адресная строка браузера и т.п.) — глобальный `keydown` в фазе
 *      capture.
 *   2. `Alt+Tab`/`Cmd+Tab`/смена приложения — ОС перехватывает Tab до
 *      браузера, но окно теряет фокус: ловим `window.blur` и пишем в лог
 *      синтетическое событие с накопленным состоянием модификаторов
 *      (например «Alt+Tab — переключение окна»).
 *   3. Смена вкладки внутри браузера — `document.visibilitychange`.
 *
 * Хук бережёт ровно одно состояние — последние известные модификаторы,
 * чтобы при `blur`/`visibilitychange` сформировать осмысленный лейбл.
 */
export function useCandidateKeyTracker({
  active,
  onKeyEvent,
}: CandidateKeyTrackerOptions): void {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!active) return undefined;

    /** Запоминаем последнее состояние модификаторов, чтобы при blur'е
     *  понимать, нажат ли был Alt/Cmd, и формировать осмысленный лейбл. */
    const modifierState = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };

    const updateModifiers = (event: KeyboardEvent) => {
      modifierState.ctrl = event.ctrlKey;
      modifierState.alt = event.altKey;
      modifierState.shift = event.shiftKey;
      modifierState.meta = event.metaKey;
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      updateModifiers(event);
      // Если фокус в CodeMirror — у редактора есть свой keydown-хэндлер,
      // который уже отправит событие. Дублировать не нужно.
      const target = event.target;
      if (target instanceof Element && target.closest(".cm-content")) {
        return;
      }
      onKeyEvent({
        key: event.key,
        keyCode: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });
    };

    const onWindowKeyUp = (event: KeyboardEvent) => {
      updateModifiers(event);
    };

    /** Эмитим синтетическое «Tab» с реальным состоянием модификаторов: на
     *  бэкенде/UI получится «Alt+Tab — переключение окна», даже если ОС
     *  забрала сам Tab себе. */
    const emitFocusEvent = (eventKind: CandidateKeyEventKind) => {
      onKeyEvent({
        key: "Tab",
        keyCode: "Tab",
        ctrlKey: modifierState.ctrl,
        altKey: modifierState.alt,
        shiftKey: modifierState.shift,
        metaKey: modifierState.meta,
        eventKind,
      });
    };

    const onWindowBlur = () => {
      emitFocusEvent("window_blur");
    };

    const onWindowFocus = () => {
      // После возврата фокуса состояние модификаторов гарантированно
      // сброшено (ОС забрала keyup), поэтому обнуляем сами.
      modifierState.ctrl = false;
      modifierState.alt = false;
      modifierState.shift = false;
      modifierState.meta = false;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        emitFocusEvent("tab_hidden");
      } else if (document.visibilityState === "visible") {
        emitFocusEvent("tab_visible");
      }
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, onKeyEvent]);
}
