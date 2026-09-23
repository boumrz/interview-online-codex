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
