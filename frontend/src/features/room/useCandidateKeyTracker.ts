import { useEffect } from "react";
import { observeDiagramWindow, observeRoomWindowFocus } from "./roomWindowFocus";
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
  interactiveDiagramFrame: HTMLIFrameElement | null;
  /**
   * Колбэк, который шлёт payload на сервер. Хук НЕ принимает на себя
   * решения по троттлингу/доставке — это ответственность подписчика.
   */
  onKeyEvent: (payload: KeyPressPayload) => void;
};

/** Capture room events once, including keys consumed by the embedded diagram editor. */
export function useCandidateKeyTracker({
  active,
  interactiveDiagramFrame,
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
      emitFocusEvent("window_focus");
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        emitFocusEvent("tab_hidden");
      } else if (document.visibilityState === "visible") {
        emitFocusEvent("tab_visible");
      }
    };

    const listenForKeys = (target: Window) => {
      target.addEventListener("keydown", onWindowKeyDown, true);
      target.addEventListener("keyup", onWindowKeyUp, true);
      return () => {
        target.removeEventListener("keydown", onWindowKeyDown, true);
        target.removeEventListener("keyup", onWindowKeyUp, true);
      };
    };
    const detachHost = listenForKeys(window);
    const detachDiagram = observeDiagramWindow(interactiveDiagramFrame, listenForKeys);
    const detachFocus = observeRoomWindowFocus(interactiveDiagramFrame, focused => focused ? onWindowFocus() : onWindowBlur());
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      detachHost();
      detachDiagram();
      detachFocus();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active, interactiveDiagramFrame, onKeyEvent]);
}
