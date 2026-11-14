type PresenceStatus = "active" | "away";

/** A status can supersede an in-flight POST. The server ignores older sequence numbers. */
export function createPresencePublisher(post: (status: PresenceStatus, sequence: number, signal: AbortSignal) => Promise<boolean>) {
  let lastSequence = 0;
  let current: PresenceStatus | null = null;
  let request: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function reset() {
    current = null;
    clearTimeout(retry);
    request?.abort();
    request = undefined;
  }

  function publish(status: PresenceStatus) {
    if (current === status) return;
    reset();
    current = status;
    const sequence = ++lastSequence;

    async function deliver() {
      const controller = new AbortController();
      request = controller;
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        if (await post(status, sequence, controller.signal)) return;
      } catch {
        // A transient failure leaves the latest presence eligible for retry.
      } finally {
        clearTimeout(timeout);
      }
      if (request === controller) retry = setTimeout(deliver, 1000);
    }
    void deliver();
  }
  return { publish, reset };
}
