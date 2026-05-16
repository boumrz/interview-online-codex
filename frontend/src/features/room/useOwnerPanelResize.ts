import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

/**
 * Минимальная ширина левой панели интервьюера. Жёсткая константа — даже при
 * очень узком окне сайдбар не должен схлопываться в ноль, иначе теряется
 * управление комнатой.
 */
export const MIN_OWNER_PANEL_WIDTH = 330;

/**
 * Дефолтная ширина при первом открытии. Совпадает с историческим значением
 * до выноса хука — поведение должно остаться прежним.
 */
const DEFAULT_OWNER_PANEL_WIDTH = 288;

/**
 * Жёсткий потолок для левой панели — половина рабочей области (ширина окна).
 * Реальный максимум считается через {@link computeMaxOwnerPanelWidth}, эта
 * константа страхует SSR/первый рендер и узкие окна
 * (никогда не уходим ниже {@link MIN_OWNER_PANEL_WIDTH}).
 */
const MAX_OWNER_PANEL_WIDTH_FALLBACK = 1200;

/**
 * Шаг изменения ширины при стрелках на ручке ресайза. Подобрано так, чтобы
 * клавиатурное управление было ощутимым, но не «прыгало» через всю задачу.
 */
const KEYBOARD_STEP = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Возвращает текущий допустимый максимум ширины сайдбара исходя из ширины
 * окна. На SSR и до первого рендера используем fallback, при сжатом окне
 * не уходим ниже минимума.
 */
function computeMaxOwnerPanelWidth(viewportWidth: number): number {
  const half = Math.floor(viewportWidth / 2);
  return Math.max(MIN_OWNER_PANEL_WIDTH, half);
}

export type OwnerPanelResize = {
  /** Текущая ширина в пикселях. */
  width: number;
  /** Текущий максимум (динамический, обновляется при resize окна). */
  maxWidth: number;
  /** Минимум — публикуется ради ARIA-атрибутов. */
  minWidth: number;
  /** Активен ли drag (mousedown по ручке) — для UI подсветки. */
  isDragging: boolean;
  /** Обработчик `mousedown` на ручке ресайза. */
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  /** Обработчик клавиатурных стрелок/Home/End на ручке ресайза. */
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

/**
 * Управляет шириной левой панели интервьюера: drag мышью, клавиатурные
 * стрелки/Home/End, динамический потолок (половина окна) с пересчётом при
 * resize.
 *
 * Хук намеренно не принимает props — поведение полностью определяется
 * локальным состоянием. Если в будущем понадобится синхронизация ширины
 * между вкладками или сохранение в localStorage, расширим API.
 */
export function useOwnerPanelResize(): OwnerPanelResize {
  const [width, setWidth] = useState<number>(DEFAULT_OWNER_PANEL_WIDTH);
  const [maxWidth, setMaxWidth] = useState<number>(() => {
    if (typeof window === "undefined") return MAX_OWNER_PANEL_WIDTH_FALLBACK;
    return computeMaxOwnerPanelWidth(window.innerWidth);
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  // Обновляем динамический максимум при ресайзе окна. Делаем сразу `recompute()`
  // на mount — на случай, если SSR-fallback разошёлся с реальной шириной.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const recompute = () =>
      setMaxWidth(computeMaxOwnerPanelWidth(window.innerWidth));
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        startX: event.clientX,
        startWidth: width,
      };
      setIsDragging(true);
    },
    [width],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setWidth((current) =>
          clamp(current - KEYBOARD_STEP, MIN_OWNER_PANEL_WIDTH, maxWidth),
        );
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setWidth((current) =>
          clamp(current + KEYBOARD_STEP, MIN_OWNER_PANEL_WIDTH, maxWidth),
        );
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setWidth(MIN_OWNER_PANEL_WIDTH);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setWidth(maxWidth);
      }
    },
    [maxWidth],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;
      // Берём актуальный потолок прямо из window — на случай если окно
      // ресайзнули в момент перетаскивания.
      const dynamicMax = computeMaxOwnerPanelWidth(
        typeof window === "undefined"
          ? MAX_OWNER_PANEL_WIDTH_FALLBACK
          : window.innerWidth,
      );
      setWidth(
        clamp(dragState.startWidth + delta, MIN_OWNER_PANEL_WIDTH, dynamicMax),
      );
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging]);

  // Дополнительный clamp на рендере: state может временно отставать от
  // только что изменившегося `maxWidth` (например, окно ужали и сразу же
  // считаем width в render-фазе до следующего useEffect tick).
  const clampedWidth = clamp(width, MIN_OWNER_PANEL_WIDTH, maxWidth);

  return {
    width: clampedWidth,
    maxWidth,
    minWidth: MIN_OWNER_PANEL_WIDTH,
    isDragging,
    onMouseDown,
    onKeyDown,
  };
}
