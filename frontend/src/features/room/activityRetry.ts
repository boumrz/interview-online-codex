/** Delay after a transient failure; attempts never disable activity capture. */
export function activityRetryDelay(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 1000;
  return Math.min(30000, 1000 * 2 ** Math.min(Math.floor(attempt) - 1, 5));
}

export const ACTIVITY_REQUEST_TIMEOUT_MS = 10000;

/** Only 204 confirms persistence at the activity relay. */
export function activityPostOutcome(status: number): "accepted" | "retry" | "rejected" {
  if (status === 204) return "accepted";
  if ((status >= 200 && status < 300) || [408, 425, 429].includes(status) || status >= 500) return "retry";
  return "rejected";
}
