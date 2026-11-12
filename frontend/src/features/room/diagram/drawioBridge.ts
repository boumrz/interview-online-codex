export type DrawioEvent = { readonly event: string; readonly [key: string]: unknown };
type Options = { readonly source: unknown; readonly origin: string; readonly post: (message: string, origin: string) => void; readonly onEvent: (event: DrawioEvent) => void; readonly timeoutMs?: number };
export function createDrawioBridge(options: Options) {
  let closed = false;
  let nextId = 0;
  const pending = new Map<string, { action: string; resolve: (event: DrawioEvent) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  const isRecord = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input);
  return {
    request(action: string, parameters: Record<string, unknown> = {}): Promise<DrawioEvent> {
      if (closed) return Promise.reject(new Error("Редактор закрыт"));
      if (action === "load" && Array.from(pending.values()).some((waiting) => waiting.action === "load")) return Promise.reject(new Error("Схема ещё загружается"));
      const requestId = `diagram-${++nextId}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error("Редактор не ответил. Повторите действие.")); }, options.timeoutMs ?? 15_000);
        pending.set(requestId, { action, resolve, reject, timeout });
        options.post(JSON.stringify({ ...parameters, action, requestId }), options.origin);
      });
    },
    receive(event: { source: unknown; origin: string; data: unknown }): void {
      if (closed || event.source !== options.source || event.origin !== options.origin) return;
      let data: unknown;
      try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!isRecord(data) || typeof data.event !== "string") return;
      // The runtime boundary above establishes the string discriminant; other
      // editor fields deliberately remain unknown until their caller validates.
      const parsed: DrawioEvent = { ...data, event: data.event };
      let requestId = isRecord(data.message) ? data.message.requestId : undefined;
      // Native successful load replies omit `message`; only one load is allowed
      // in flight per frame, so this response has an unambiguous owner.
      if (requestId === undefined && data.event === "load") requestId = Array.from(pending.entries()).find(([, waiting]) => waiting.action === "load")?.[0];
      if (typeof requestId === "string") {
        const waiting = pending.get(requestId);
        if (waiting && waiting.action === data.event) {
          clearTimeout(waiting.timeout); pending.delete(requestId);
          if (data.checksumMismatch === true) waiting.reject(new Error("Не удалось согласовать схему. Восстановите сохранённую версию."));
          else if (data.error !== undefined && data.error !== null) waiting.reject(new Error("Редактор не смог обработать изменение. Повторите действие."));
          else waiting.resolve(parsed);
        }
      }
      options.onEvent(parsed);
    },
    send(action: string, parameters: Record<string, unknown> = {}): void {
      if (!closed) options.post(JSON.stringify({ ...parameters, action }), options.origin);
    },
    destroy(): void {
      closed = true;
      for (const waiting of pending.values()) { clearTimeout(waiting.timeout); waiting.reject(new Error("Редактор закрыт")); }
      pending.clear();
    },
  };
}
