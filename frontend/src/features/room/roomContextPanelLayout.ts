export const ROOM_CONTEXT_GAP = 10;
export const ROOM_CONTEXT_KEYBOARD_STEP = 16;

export type SplitBounds = { min: number; max: number };
export type SplitOrientation = "vertical" | "horizontal";

function feasibleBounds(min: number, max: number): SplitBounds | null {
  const roundedMin = Math.round(min);
  const roundedMax = Math.floor(max);
  return roundedMax < roundedMin ? null : { min: roundedMin, max: roundedMax };
}

export function workAuxiliaryBounds(surfaceWidth: number): SplitBounds | null {
  return feasibleBounds(320, surfaceWidth - 500 - ROOM_CONTEXT_GAP);
}

export function overviewRightColumnBounds(surfaceWidth: number): SplitBounds | null {
  return feasibleBounds(320, surfaceWidth - 240 - 480 - ROOM_CONTEXT_GAP * 2);
}

export function overviewChatHeightBounds(surfaceHeight: number): SplitBounds | null {
  return feasibleBounds(320, surfaceHeight - 240 - ROOM_CONTEXT_GAP);
}

export function clampSplitValue(value: number, bounds: SplitBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

export function reduceSplitValue(
  value: number,
  bounds: SplitBounds,
  key: string,
  orientation: SplitOrientation,
): number {
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  const delta = orientation === "vertical"
    ? key === "ArrowRight" ? ROOM_CONTEXT_KEYBOARD_STEP : key === "ArrowLeft" ? -ROOM_CONTEXT_KEYBOARD_STEP : 0
    : key === "ArrowDown" ? ROOM_CONTEXT_KEYBOARD_STEP : key === "ArrowUp" ? -ROOM_CONTEXT_KEYBOARD_STEP : 0;
  return delta === 0 ? clampSplitValue(value, bounds) : clampSplitValue(value + delta, bounds);
}
