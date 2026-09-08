import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../../config/runtime";
import type { CandidateKeyInfo } from "./candidateKeys";
import { reconcileActivityEvents } from "./activityTimelineProjection";
import {
  advanceHistoryCursor, createHistoryCursor, historyPageQuery, parseActivityHistoryPage,
  type HistoryCursor, type HistoryReadKind,
} from "./candidateActivityHistory";

type HistoryOptions = {
  inviteCode: string;
  authToken?: string | null;
  ownerToken?: string | null;
  eventToken?: string | null;
  canManageRoom: boolean;
  active?: boolean;
  keyHistory: CandidateKeyInfo[];
};

type HistoryState = {
  events: CandidateKeyInfo[];
  cursor: HistoryCursor;
  loading: HistoryReadKind | null;
  failedRead: HistoryReadKind | null;
  error: string | null;
  terminal: number | null;
};

const emptyHistory = (): HistoryState => ({
  events: [], cursor: createHistoryCursor(), loading: null, failedRead: null, error: null, terminal: null,
});

class HistoryHttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}

export function useCandidateActivityHistory({
  inviteCode, authToken, ownerToken, eventToken, canManageRoom, keyHistory, active = true,
}: HistoryOptions) {
  // A realtime token refresh changes transport authority, not the room's loaded history.
  const context = useMemo(() => ({ state: emptyHistory(), authorityToken: eventToken }), [inviteCode, authToken, ownerToken, canManageRoom]);
  const current = useRef({ context, eventToken, active });
  current.current = { context, eventToken, active };
  const [rendered, setRendered] = useState({ context, state: context.state });
  const controls = useRef<{
    context: typeof context;
    run: (kind: HistoryReadKind) => void;
    download: (format: "json" | "csv") => void;
  } | null>(null);

  const hasCurrentIdentity = () =>
    canManageRoom && current.current.context === context &&
    localStorage.getItem("auth_token") === (authToken ?? null) &&
    localStorage.getItem(`owner_token_${inviteCode}`) === (ownerToken ?? null);

  useEffect(() => () => {
    context.state = emptyHistory();
  }, [context]);

  useEffect(() => {
    if (!canManageRoom) return;
    if (!active) {
      context.state = { ...context.state, loading: null };
      setRendered({ context, state: context.state });
      return;
    }
    let alive = true;
    let running = false;
    let pending: HistoryReadKind | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const requests = new Set<AbortController>();
    const isCurrent = () => alive && current.current.active && hasCurrentIdentity() && current.current.eventToken === eventToken;
    const publish = (patch: Partial<HistoryState>) => {
      if (!isCurrent()) return;
      context.state = { ...context.state, ...patch };
      setRendered({ context, state: context.state });
    };
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (ownerToken) headers["X-Room-Owner-Token"] = ownerToken;
    if (eventToken) headers["X-Room-Event-Token"] = eventToken;

    const stop = (status: number) => {
      clearTimeout(pollTimer);
      pending = null;
      requests.forEach((request) => request.abort());
      publish({
        ...emptyHistory(), terminal: status,
        error: status === 404 ? "Комната недоступна" : status === 410
          ? "Комната находится в архиве" : "Доступ к истории недоступен",
      });
    };

    const readPage = async (kind: HistoryReadKind) => {
      const controller = new AbortController();
      requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const query = new URLSearchParams(historyPageQuery(context.state.cursor, kind));
        const response = await fetch(`${API_BASE_URL}/rooms/${encodeURIComponent(inviteCode)}/activity-history?${query}`, {
          headers, signal: controller.signal, cache: "no-store",
        });
        if (!isCurrent() || controller.signal.aborted) throw new DOMException("History cancelled", "AbortError");
        if (!response.ok) throw new HistoryHttpError(response.status);
        const body: unknown = await response.json();
        if (!isCurrent() || controller.signal.aborted) throw new DOMException("History cancelled", "AbortError");
        return parseActivityHistoryPage(body);
      } finally {
        clearTimeout(timeout);
        requests.delete(controller);
      }
    };

    const run = async (kind: HistoryReadKind): Promise<void> => {
      if (!isCurrent() || context.state.terminal != null) return;
      if (kind === "older" && context.state.cursor.olderBefore == null) return;
      if (running) {
        pending = kind;
        return;
      }
      // Loading an older page must not postpone an already due catch-up cycle.
      if (kind !== "older") {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      running = true;
      publish({ loading: kind, ...(context.state.failedRead === kind ? { error: null, failedRead: null } : {}) });
      try {
        do {
          const page = await readPage(kind);
          if (!isCurrent()) return;
          const cursor = advanceHistoryCursor(context.state.cursor, kind, page);
          publish({ cursor, events: reconcileActivityEvents([...context.state.events, ...page.events]) });
        } while (kind === "catchup" && context.state.cursor.catchupAfter != null && isCurrent());
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof HistoryHttpError && [401, 403, 404, 410].includes(error.status)) {
          stop(error.status);
        } else {
          publish({ error: "Не удалось загрузить историю. Попробуйте ещё раз.", failedRead: kind });
        }
      } finally {
        running = false;
        if (isCurrent()) {
          publish({ loading: null });
          if (context.state.terminal == null) {
            const next = pending;
            pending = null;
            if (next) void run(next);
            else if (pollTimer === undefined) pollTimer = setTimeout(() => {
              pollTimer = undefined;
              void run(context.state.cursor.confirmedThrough == null ? "latest" : "catchup");
            }, 5_000);
          }
        }
      }
    };

    const download = async (format: "json" | "csv") => {
      if (!isCurrent() || context.state.terminal != null) return;
      const controller = new AbortController();
      requests.add(controller);
      try {
        const response = await fetch(`${API_BASE_URL}/rooms/${encodeURIComponent(inviteCode)}/keystroke-events?format=${format}`, {
          headers, signal: controller.signal, cache: "no-store",
        });
        if (!isCurrent() || controller.signal.aborted) return;
        if (!response.ok) throw new HistoryHttpError(response.status);
        const blob = await response.blob();
        if (!isCurrent() || controller.signal.aborted || context.state.terminal != null) return;
        const objectUrl = URL.createObjectURL(blob);
        try {
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = `keystrokes-${inviteCode}.${format}`;
          link.click();
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        if (!isCurrent() || controller.signal.aborted) return;
        if (error instanceof HistoryHttpError && [401, 403, 404, 410].includes(error.status)) stop(error.status);
        else console.error("[ActivityTimeline] Export failed");
      } finally {
        requests.delete(controller);
      }
    };

    // A new credential can restore manager access after a denied read. Missing
    // and archived rooms stay terminal for the life of this mounted context.
    if (context.authorityToken !== eventToken && (context.state.terminal === 401 || context.state.terminal === 403)) {
      publish(emptyHistory());
    }
    context.authorityToken = eventToken;
    controls.current = { context, run: (kind) => { void run(kind); }, download: (format) => { void download(format); } };
    void run(context.state.cursor.confirmedThrough == null ? "latest" : "catchup");

    return () => {
      alive = false;
      clearTimeout(pollTimer);
      requests.forEach((request) => request.abort());
      if (controls.current?.context === context) controls.current = null;
    };
  }, [context, inviteCode, authToken, ownerToken, eventToken, canManageRoom, active]);

  useEffect(() => {
    if (!hasCurrentIdentity() || context.state.terminal != null) return;
    context.state = { ...context.state, events: reconcileActivityEvents([...context.state.events, ...keyHistory]) };
    setRendered({ context, state: context.state });
  }, [context, keyHistory]);

  const state = hasCurrentIdentity() ? (rendered.context === context ? rendered.state : context.state) : emptyHistory();
  return {
    ...state,
    initialized: state.cursor.confirmedThrough != null,
    hasMore: state.cursor.olderBefore != null,
    canExport: active && hasCurrentIdentity() && state.terminal == null,
    loadOlder: () => { if (controls.current?.context === context) controls.current.run("older"); },
    retry: () => {
      if (controls.current?.context === context) {
        controls.current.run(state.failedRead ?? (state.cursor.confirmedThrough == null ? "latest" : "catchup"));
      }
    },
    download: (format: "json" | "csv") => { if (controls.current?.context === context) controls.current.download(format); },
  };
}

export type CandidateActivityHistory = ReturnType<typeof useCandidateActivityHistory>;
