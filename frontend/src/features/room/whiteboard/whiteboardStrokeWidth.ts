export const MIN_STROKE_WIDTH_PX = 1;
// Matches the existing server limit for native line and shape stroke widths.
export const MAX_STROKE_WIDTH_PX = 1000;
export const MIN_QUICK_STROKE_WIDTH_PX = 4;
export const MAX_QUICK_STROKE_WIDTH_PX = 32;
export const DEFAULT_STROKE_WIDTH_PX = MIN_QUICK_STROKE_WIDTH_PX;
export const STROKE_WIDTH_PRESETS = [4, 8, 16, 32] as const;

/** Board pixels at 100% zoom. Keep the native renderer and saved strokes intact. */
export function nativeStrokeWidth(tool: string, pixels: number): number {
  // Excalidraw 0.18.1: size = width * 4.25; our fixed .5 pressure gives
  // diameter = size * 2 * sin(pi/4). Other solid contours use width directly.
  return tool === "freedraw" ? pixels / (4.25 * Math.SQRT2) : pixels;
}
