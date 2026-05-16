import { useEffect, useRef } from "react";

/**
 * Реестр активных «слоёв», слушающих Escape. Самый последний (top) обрабатывает
 * Escape первым. Нужен, чтобы открытые поверх друг друга модалки/меню/попаперы
 * закрывались строго по одному за нажатие Escape, а не «всё одним махом».
 *
 * Реализовано через единый window-listener в фазе capture: он стопает дальнейшее
 * распространение события (stopImmediatePropagation), чтобы не отработали ни
 * другие capture-слушатели, ни bubble-слушатели Mantine Menu/Popover/Modal/etc.
 */
type EscapeLayerEntry = { handlerRef: { current: () => void } };

const escapeLayerStack: EscapeLayerEntry[] = [];
let escapeLayerInstalled = false;

function installEscapeLayer(): void {
  if (escapeLayerInstalled || typeof window === "undefined") return;
  escapeLayerInstalled = true;
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      if (event.defaultPrevented) return;
      const top = escapeLayerStack[escapeLayerStack.length - 1];
      if (!top) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      try {
        top.handlerRef.current();
      } catch {
        // обработчик слоя не должен ронять стек; глотаем тихо
      }
    },
    { capture: true },
  );
}

/**
 * Подключает компонент к стеку Escape-слоёв.
 *
 * Пока `active === true`, при нажатии Escape будет вызван `onEscape` —
 * причём только у самого верхнего слоя; остальные обработчики (включая
 * Mantine Menu/Modal/Popover с дефолтным closeOnEscape) не сработают,
 * потому что событие останавливается в фазе capture на window.
 *
 * Совет: для Mantine `Modal` выставьте `closeOnEscape={false}` и используйте
 * этот хук — иначе встроенный Mantine-обработчик Escape всё равно может
 * срабатывать на window и закрывать модалку «через слой».
 */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
  const handlerRef = useRef<() => void>(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    installEscapeLayer();
    const entry: EscapeLayerEntry = { handlerRef };
    escapeLayerStack.push(entry);
    return () => {
      const idx = escapeLayerStack.lastIndexOf(entry);
      if (idx >= 0) escapeLayerStack.splice(idx, 1);
    };
  }, [active]);
}
