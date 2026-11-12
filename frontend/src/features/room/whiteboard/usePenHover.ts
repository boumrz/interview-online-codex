import { useCallback, useEffect, useRef } from "react";

type HoverAppState = {
  activeTool: { type: string };
  currentItemStrokeColor: string;
};

type PenHoverOptions = {
  active: boolean;
  readOnly: boolean;
  getAppState(): HoverAppState | undefined;
};

/** Local proximity feedback. It never changes native input, scene or history. */
export function usePenHover(options: PenHoverOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);
  const current = useRef(options); current.current = options;
  const pendingFrame = useRef<number | null>(null);
  const location = useRef<{ x: number; y: number } | null>(null);
  const observedHover = useRef(new Set<number>());

  const hide = useCallback(() => {
    location.current = null;
    if (pendingFrame.current !== null) {
      window.cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
    }
    if (previewRef.current) previewRef.current.hidden = true;
  }, []);

  const onAppStateChange = useCallback((state: HoverAppState) => {
    if (!current.current.active || current.current.readOnly || state.activeTool.type !== "freedraw") hide();
    if (previewRef.current) previewRef.current.style.borderColor = state.currentItemStrokeColor;
  }, [hide]);

  const reset = useCallback(() => {
    observedHover.current.clear();
    hide();
  }, [hide]);

  useEffect(() => {
    if (!options.active || options.readOnly) hide();
  }, [options.active, options.readOnly, hide]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const move = (event: PointerEvent) => {
      const state = current.current.getAppState();
      const canvas = event.target;
      if (!current.current.active || current.current.readOnly ||
          state?.activeTool.type !== "freedraw" || event.pointerType !== "pen" ||
          event.buttons !== 0 || event.pressure !== 0 ||
          !(canvas instanceof HTMLCanvasElement) || !canvas.classList.contains("interactive")) {
        hide();
        return;
      }
      if (event.type === "pointerup" && !observedHover.current.has(event.pointerId)) {
        hide();
        return;
      }
      const canvasBounds = canvas.getBoundingClientRect();
      if (event.clientX < canvasBounds.left || event.clientX > canvasBounds.right ||
          event.clientY < canvasBounds.top || event.clientY > canvasBounds.bottom) {
        hide();
        return;
      }
      if (event.type === "pointermove") observedHover.current.add(event.pointerId);
      location.current = { x: event.clientX, y: event.clientY };
      if (pendingFrame.current !== null) return;
      pendingFrame.current = window.requestAnimationFrame(() => {
        pendingFrame.current = null;
        const point = location.current;
        const preview = previewRef.current;
        if (!point || !preview || !host.clientWidth || !host.clientHeight) return;
        const bounds = host.getBoundingClientRect();
        // CSS zoom and ancestor scaling affect client coordinates, whereas the
        // absolute child is positioned in the host's unscaled layout units.
        const scaleX = bounds.width / host.clientWidth;
        const scaleY = bounds.height / host.clientHeight;
        preview.style.left = `${(point.x - bounds.left) / scaleX}px`;
        preview.style.top = `${(point.y - bounds.top) / scaleY}px`;
        preview.style.borderColor = current.current.getAppState()?.currentItemStrokeColor ?? "#2563eb";
        preview.hidden = false;
      });
    };
    const leaveCanvas = (event: PointerEvent) => {
      if (event.target instanceof HTMLCanvasElement && event.target.classList.contains("interactive")) reset();
    };
    host.addEventListener("pointermove", move, { capture: true, passive: true });
    host.addEventListener("pointerup", move, { capture: true, passive: true });
    host.addEventListener("pointercancel", reset, { capture: true, passive: true });
    host.addEventListener("pointerout", leaveCanvas, { capture: true, passive: true });
    host.addEventListener("pointerleave", reset);
    host.addEventListener("wheel", hide, { capture: true, passive: true });
    document.addEventListener("pointerdown", hide, { capture: true, passive: true });
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    const resize = new ResizeObserver(hide);
    resize.observe(host);
    return () => {
      reset();
      resize.disconnect();
      host.removeEventListener("pointermove", move, true);
      host.removeEventListener("pointerup", move, true);
      host.removeEventListener("pointercancel", reset, true);
      host.removeEventListener("pointerout", leaveCanvas, true);
      host.removeEventListener("pointerleave", reset);
      host.removeEventListener("wheel", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [hide, reset]);

  return { hostRef, previewRef, onAppStateChange };
}
