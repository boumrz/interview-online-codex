/** Delay after a transient failure; attempts never disable activity capture. */
export function activityRetryDelay(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 1000;
  return Math.min(30000, 1000 * 2 ** Math.min(Math.floor(attempt) - 1, 5));
}

export const ACTIVITY_REQUEST_TIMEOUT_MS = 10000;
