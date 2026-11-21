export type RoomEventSourceConstructor = new (
  url: string | URL,
  eventSourceInitDict?: EventSourceInit,
) => EventSource;

export function createRoomEventSource(
  url: string | URL,
  init: EventSourceInit = {},
  EventSourceConstructor: RoomEventSourceConstructor = EventSource,
): EventSource {
  return new EventSourceConstructor(url, {
    ...init,
    withCredentials: true,
  });
}

export function roomRealtimeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetchImplementation: typeof fetch = fetch,
): Promise<Response> {
  return fetchImplementation(input, {
    ...init,
    credentials: "include",
  });
}

export async function withRoomRequestDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal, timedOut: () => boolean) => Promise<T>,
  lifetime?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (lifetime?.aborted) abort();
  else lifetime?.addEventListener("abort", abort, { once: true });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; abort(); }, timeoutMs);
  try {
    return await run(controller.signal, () => expired);
  } finally {
    clearTimeout(timeout);
    lifetime?.removeEventListener("abort", abort);
  }
}
