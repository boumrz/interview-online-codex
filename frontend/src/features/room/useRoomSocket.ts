import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../../config/runtime";
import type { RoomTask } from "../../types";
import { trackEvent } from "../../services/analytics";

/** Same opt-out as RoomPage: localStorage room_sync_log = "0" or ?syncLog=0 */
function isRoomSyncTransportLogEnabled(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("syncLog") === "0") return false;
    if (params.get("syncLog") === "1") return true;
    return window.localStorage.getItem("room_sync_log") !== "0";
  } catch {
    return true;
  }
}

function roomSyncTransportLog(event: string, detail?: Record<string, unknown>) {
  if (!isRoomSyncTransportLogEnabled()) return;
  const ts = new Date().toISOString();
  if (detail && Object.keys(detail).length > 0) {
    console.info(`[room-sync][${ts}] transport:${event}`, detail);
  } else {
    console.info(`[room-sync][${ts}] transport:${event}`);
  }
}

type Participant = {
  sessionId: string;
  displayName: string;
  userId?: string | null;
  participantId?: string | null;
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
  isAuthenticated?: boolean;
  canBeGrantedInterviewerAccess?: boolean;
};

type CursorPayload = {
  sessionId: string;
  displayName: string;
  userId?: string | null;
  participantId?: string | null;
  role: "owner" | "interviewer" | "candidate";
  cursorSequence?: number | null;
  lineNumber: number;
  column: number;
  selectionStartLineNumber?: number | null;
  selectionStartColumn?: number | null;
  selectionEndLineNumber?: number | null;
  selectionEndColumn?: number | null;
};

type CandidateKeyPayload = {
  sessionId: string;
  displayName: string;
  key: string;
  keyCode: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  timestampEpochMs: number;
  /** Must match CandidateKeyEventKind in candidateKeys.ts. Present for all events from the server. */
  eventKind?: string;
  pasteLength?: number;
  pastePreview?: string;
};

type NoteMessagePayload = {
  id: string;
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  text: string;
  timestampEpochMs: number;
};

type PersonalNoteEntryPayload = {
  id: string;
  text: string;
  blockName?: string | null;
  /**
   * If the note was authored under a step block, this points back to that
   * step's index. Used by the UI to render `Шаг N` and by export to expand
   * to `Шаг N - <task title>`.
   */
  blockStepIndex?: number | null;
  timestampEpochMs: number;
};

type RealtimeState = {
  inviteCode: string;
  language: string;
  code: string;
  lastCodeUpdatedBySessionId: string | null;
  /** Full Yjs document (Y.encodeStateAsUpdate) as base64 for CRDT-consistent reconnects. */
  yjsDocumentBase64?: string | null;
  lastYjsSequence?: number;
  currentStep: number;
  notes: string;
  notesMessages?: NoteMessagePayload[];
  /**
   * Room-wide private notes for the current viewer (interviewer/owner only).
   * Replaces the legacy per-step `personalNotesByStep` payload.
   */
  personalNotes?: PersonalNoteEntryPayload[];
  briefingMarkdown?: string;
  tasks?: RoomTask[];
  taskScores: Record<string, number | null>;
  participants: Participant[];
  isOwner: boolean;
  role: "owner" | "interviewer" | "candidate";
  canManageRoom: boolean;
  canGrantAccess?: boolean;
  eventToken?: string | null;
  notesLockedBySessionId: string | null;
  notesLockedByDisplayName: string | null;
  notesLockedUntilEpochMs: number | null;
  cursors: CursorPayload[];
  lastCandidateKey: CandidateKeyPayload | null;
  candidateKeyHistory: CandidateKeyPayload[];
  verdict?: string | null;
  verdictComment?: string | null;
  status?: string;
  finishedAt?: number | null;
};

type WsMessage = {
  type: string;
  payload: unknown;
};

type Options = {
  enabled?: boolean;
  inviteCode: string;
  displayName: string;
  authToken?: string | null;
  ownerToken?: string | null;
  onState: (state: RealtimeState) => void;
  onError: (message: string) => void;
  onYjsUpdate?: (payload: { sessionId: string; yjsUpdate: string; syncKey?: string | null; yjsSequence?: number | null }) => void;
  onAwarenessUpdate?: (payload: { sessionId: string; userId?: string | null; participantId?: string | null; awarenessUpdate: string }) => void;
  onCursorUpdate?: (payload: CursorPayload) => void;
  onCandidateKey?: (payload: CandidateKeyPayload) => void;
  onRecoveryStateSync?: (lastYjsSequence: number) => void;
  onRequireRecoverySync?: () => void;
};

type ClientMessage =
  | { type: "code_update"; code: string; codeSequence: number; syncKey?: string | null }
  | { type: "language_update"; language: string }
  | { type: "set_step"; stepIndex: number }
  | { type: "task_rating_update"; stepIndex: number; rating: number | null }
  | { type: "notes_update"; notes: string }
  | { type: "note_message"; noteId: string; noteText: string; noteTimestampEpochMs: number }
  | {
      type: "private_note_entry";
      privateNoteId: string;
      privateNoteText: string;
      privateNoteBlockName?: string | null;
      privateNoteBlockStepIndex?: number | null;
      privateNoteTimestampEpochMs: number;
    }
  | { type: "briefing_markdown_update"; briefingMarkdown: string }
  | { type: "grant_interviewer_access"; targetSessionId?: string; targetUserId?: string }
  | { type: "revoke_interviewer_access"; targetSessionId?: string; targetUserId?: string }
  | { type: "presence_update"; presenceStatus: "active" | "away" }
  | {
      type: "cursor_update";
      lineNumber: number;
      column: number;
      cursorSequence: number;
      selectionStartLineNumber?: number | null;
      selectionStartColumn?: number | null;
      selectionEndLineNumber?: number | null;
      selectionEndColumn?: number | null;
    }
  | {
      type: "yjs_update";
      yjsUpdate: string;
      syncKey?: string | null;
      code?: string | null;
      yjsClientSequence: number;
      baseServerYjsSequence?: number | null;
      operationId: string;
      yjsDocumentBase64?: string | null;
    }
  | { type: "awareness_update"; awarenessUpdate: string }
  | {
      type: "key_press";
      key: string;
      keyCode: string;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      metaKey: boolean;
      /**
       * Категория события: `keydown` (по умолчанию), либо синтетические
       * `window_blur`/`window_focus`/`tab_hidden`/`tab_visible`. Нужны для
       * фиксации Alt+Tab/Cmd+Tab и переключения вкладок в логе кандидата —
       * сам Tab ОС перехватывает раньше браузера.
       */
      eventKind?: string;
      pasteLength?: number;
      pastePreview?: string;
    }
  | { type: "request_state_sync" };

type QueuedClientMessage = {
  payload: ClientMessage;
  queuedAtEpochMs: number;
  clientEventSequence: number | null;
};

const MAX_PENDING_MESSAGES = 300;
const KEY_PRESS_CLIENT_THROTTLE_MS = 120;

function sessionIdKey(inviteCode: string) {
  return `room_ws_session_id_${inviteCode}`;
}

function participantIdKey() {
  return "room_participant_id";
}

function cursorSequenceKey(inviteCode: string) {
  return `room_cursor_sequence_${inviteCode}`;
}

function codeSequenceKey(inviteCode: string) {
  return `room_code_sequence_${inviteCode}`;
}

function yjsSequenceKey(inviteCode: string) {
  return `room_yjs_sequence_${inviteCode}`;
}

function eventSequenceKey(inviteCode: string) {
  return `room_event_sequence_${inviteCode}`;
}

function getOrCreateSessionId(inviteCode: string) {
  const key = sessionIdKey(inviteCode);
  const existing = sessionStorage.getItem(key)?.trim();
  if (existing) return existing;
  const next = `s-${crypto.randomUUID()}`;
  sessionStorage.setItem(key, next);
  return next;
}

function getOrCreateParticipantId() {
  try {
    const key = participantIdKey();
    const existing = localStorage.getItem(key)?.trim();
    if (existing) return existing;
    const next = `p-${crypto.randomUUID()}`;
    localStorage.setItem(key, next);
    return next;
  } catch {
    return `p-${crypto.randomUUID()}`;
  }
}

function getInitialCursorSequence(inviteCode: string) {
  const key = cursorSequenceKey(inviteCode);
  const parsed = Number(sessionStorage.getItem(key) ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function persistCursorSequence(inviteCode: string, sequence: number) {
  sessionStorage.setItem(cursorSequenceKey(inviteCode), String(sequence));
}

function getInitialCodeSequence(inviteCode: string) {
  const key = codeSequenceKey(inviteCode);
  const parsed = Number(sessionStorage.getItem(key) ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function persistCodeSequence(inviteCode: string, sequence: number) {
  sessionStorage.setItem(codeSequenceKey(inviteCode), String(sequence));
}

function getInitialYjsSequence(inviteCode: string) {
  const key = yjsSequenceKey(inviteCode);
  const parsed = Number(sessionStorage.getItem(key) ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function persistYjsSequence(inviteCode: string, sequence: number) {
  sessionStorage.setItem(yjsSequenceKey(inviteCode), String(sequence));
}

function getInitialEventSequence(inviteCode: string) {
  const key = eventSequenceKey(inviteCode);
  const parsed = Number(sessionStorage.getItem(key) ?? "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function persistEventSequence(inviteCode: string, sequence: number) {
  sessionStorage.setItem(eventSequenceKey(inviteCode), String(sequence));
}

function currentPresenceStatus(hasWindowFocusFallback: boolean): "active" | "away" {
  const hasFocus =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? document.hasFocus()
      : hasWindowFocusFallback;
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  return visible && hasFocus ? "active" : "away";
}

export function useRoomSocket({
  enabled = true,
  inviteCode,
  displayName,
  authToken,
  ownerToken,
  onState,
  onError,
  onYjsUpdate,
  onAwarenessUpdate,
  onCursorUpdate,
  onCandidateKey,
  onRecoveryStateSync,
  onRequireRecoverySync
}: Options) {
  const sseRef = useRef<EventSource | null>(null);
  const pendingMessagesRef = useRef<QueuedClientMessage[]>([]);
  const cursorSequenceRef = useRef(0);
  const codeSequenceRef = useRef(0);
  const yjsSequenceRef = useRef(0);
  const eventSequenceRef = useRef(0);
  const eventTokenRef = useRef<string | null>(null);
  const lastPresenceRef = useRef<"active" | "away" | null>(null);
  const lastKeyPressSentAtRef = useRef(0);
  const queueDrainInProgressRef = useRef(false);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const tryDrainQueueRef = useRef<(() => void) | null>(null);
  const requiresEventSequence = (payload: ClientMessage) => payload.type !== "request_state_sync" && payload.type !== "presence_update";
  const nextClientEventSequence = () => {
    const next = eventSequenceRef.current + 1;
    eventSequenceRef.current = next;
    persistEventSequence(inviteCode, next);
    return next;
  };
  const queuePayload = (payload: ClientMessage, options: { dedupeSameType?: boolean } = {}) => {
    let abortAndReplaceInFlight = false;
    if (options.dedupeSameType) {
      const currentHead = pendingMessagesRef.current[0];
      const hasInFlight = inFlightControllerRef.current != null;
      const canReplaceInFlight =
        (payload.type === "code_update" || payload.type === "yjs_update") &&
        hasInFlight &&
        currentHead?.payload.type === payload.type;
      abortAndReplaceInFlight = canReplaceInFlight;
      const preserveHead = (queueDrainInProgressRef.current || hasInFlight) && !abortAndReplaceInFlight;
      const head = preserveHead ? pendingMessagesRef.current.slice(0, 1) : [];
      const tail = preserveHead ? pendingMessagesRef.current.slice(1) : pendingMessagesRef.current;
      const filteredTail = tail.filter((queued) => queued.payload.type !== payload.type);
      pendingMessagesRef.current = [...head, ...filteredTail];
    }
    pendingMessagesRef.current.push({
      payload,
      queuedAtEpochMs: Date.now(),
      clientEventSequence: requiresEventSequence(payload) ? nextClientEventSequence() : null
    });
    if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
      pendingMessagesRef.current.shift();
    }
    if (abortAndReplaceInFlight) {
      inFlightControllerRef.current?.abort();
    }
  };
  const sendRef = useRef<(payload: ClientMessage) => void>((payload: ClientMessage) => {
    queuePayload(payload);
  });
  const [connected, setConnected] = useState(false);
  const participantId = useMemo(() => getOrCreateParticipantId(), []);
  const sessionId = useMemo(() => getOrCreateSessionId(inviteCode), [inviteCode]);

  useEffect(() => {
    cursorSequenceRef.current = getInitialCursorSequence(inviteCode);
    codeSequenceRef.current = getInitialCodeSequence(inviteCode);
    yjsSequenceRef.current = getInitialYjsSequence(inviteCode);
    eventSequenceRef.current = getInitialEventSequence(inviteCode);
  }, [inviteCode]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      sseRef.current?.close();
      sseRef.current = null;
      pendingMessagesRef.current = [];
      eventTokenRef.current = null;
      queueDrainInProgressRef.current = false;
      inFlightControllerRef.current = null;
      tryDrainQueueRef.current = null;
      sendRef.current = () => {};
      return;
    }

    let hasWindowFocus = typeof document !== "undefined" ? document.hasFocus() : true;
    let disposed = false;
    let sseErrorNotified = false;
    let lastStateSyncRequestAt = 0;
    let expectRecoveryStateSync = false;
    let reconnectTimerId: number | null = null;
    let reconnectScheduled = false;
    let leaveNotified = false;
    lastPresenceRef.current = null;
    const metricLastSentAt = new Map<string, number>();
    const emitMetric = (
      eventName: string,
      payload: Record<string, string | number | boolean | null> = {},
      options: { minIntervalMs?: number; dedupeKey?: string } = {}
    ) => {
      const dedupeKey = options.dedupeKey ?? eventName;
      const now = Date.now();
      const minIntervalMs = options.minIntervalMs ?? 0;
      const previous = metricLastSentAt.get(dedupeKey) ?? 0;
      if (minIntervalMs > 0 && now - previous < minIntervalMs) return;
      metricLastSentAt.set(dedupeKey, now);
      trackEvent(eventName, {
        invite_code_len: inviteCode.length,
        ...payload
      });
    };

    const requiresEventToken = (payload: ClientMessage) => {
      return payload.type !== "request_state_sync" && payload.type !== "presence_update";
    };

    const buildParams = () => {
      const params = new URLSearchParams({ sessionId });
      params.set("participantId", participantId);
      params.set("displayNameEncoded", displayName);
      if (authToken) params.set("authToken", authToken);
      if (ownerToken) params.set("ownerToken", ownerToken);
      return params;
    };

    const abortInFlightRequest = () => {
      if (inFlightControllerRef.current != null) {
        inFlightControllerRef.current.abort();
        inFlightControllerRef.current = null;
      }
    };

    const dropPendingQueue = () => {
      pendingMessagesRef.current = [];
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectScheduled) return;
      reconnectScheduled = true;
      emitMetric(
        "prod_realtime_reconnect_scheduled",
        { pending_messages: pendingMessagesRef.current.length },
        { minIntervalMs: 3000 }
      );
      setConnected(false);
      abortInFlightRequest();
      const activeSource = sseRef.current;
      sseRef.current = null;
      activeSource?.close();
      if (reconnectTimerId != null) {
        window.clearTimeout(reconnectTimerId);
      }
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        reconnectScheduled = false;
        connectSse();
      }, 180);
    };
    const findNextProcessableQueueIndex = () => {
      if (pendingMessagesRef.current.length === 0) return -1;
      if (eventTokenRef.current) return 0;
      return pendingMessagesRef.current.findIndex(({ payload }) => !requiresEventToken(payload));
    };

    const dropQueuedRecoveryMutations = () => {
      if (pendingMessagesRef.current.length === 0) return;
      const before = pendingMessagesRef.current.length;
      pendingMessagesRef.current = pendingMessagesRef.current.filter(({ payload }) => {
        return payload.type !== "yjs_update" && payload.type !== "code_update";
      });
      const dropped = before - pendingMessagesRef.current.length;
      if (dropped > 0) {
        roomSyncTransportLog("drop_stale_pending_mutations_after_recovery", { dropped });
      }
    };

    const tryDrainQueue = () => {
      if (queueDrainInProgressRef.current || disposed) return;
      queueDrainInProgressRef.current = true;

      void (async () => {
        try {
          while (!disposed) {
            const nextIndex = findNextProcessableQueueIndex();
            if (nextIndex < 0) break;
            const head = pendingMessagesRef.current[nextIndex];

            const controller = new AbortController();
            inFlightControllerRef.current = controller;

            let response: Response;
            try {
              response = await fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
                method: "POST",
                signal: controller.signal,
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  sessionId,
                  eventToken: eventTokenRef.current,
                  clientEventSequence: head.clientEventSequence,
                  ...head.payload
                })
              });
            } catch {
              inFlightControllerRef.current = null;
              if (disposed || controller.signal.aborted) break;
              emitMetric(
                "prod_realtime_post_failed",
                { reason: "network_error" },
                { minIntervalMs: 2000 }
              );
              scheduleReconnect();
              onError("Не удалось отправить действие в комнату");
              break;
            }
            inFlightControllerRef.current = null;

            if (response.ok) {
              if (nextIndex === 0) {
                pendingMessagesRef.current.shift();
              } else {
                pendingMessagesRef.current.splice(nextIndex, 1);
              }
              continue;
            }

            const data = (await response.json().catch(() => ({}))) as { error?: string };
            if (response.status === 403) {
              // Stale event token/session after reconnect. Keep head for retry with a fresh token.
              emitMetric(
                "prod_realtime_post_rejected",
                { status_code: 403, payload_type: head.payload.type },
                { minIntervalMs: 2000, dedupeKey: `post_rejected_403_${head.payload.type}` }
              );
              scheduleReconnect();
              break;
            }
            if (response.status === 409) {
              // Out-of-order or stale client sequence; safe to drop.
              emitMetric(
                "prod_realtime_post_rejected",
                { status_code: 409, payload_type: head.payload.type },
                { minIntervalMs: 2000, dedupeKey: `post_rejected_409_${head.payload.type}` }
              );
              if (nextIndex === 0) {
                pendingMessagesRef.current.shift();
              } else {
                pendingMessagesRef.current.splice(nextIndex, 1);
              }
              continue;
            }
            if (response.status >= 400 && response.status < 500) {
              // Invalid payload should not block the whole queue forever.
              emitMetric(
                "prod_realtime_post_rejected",
                { status_code: response.status, payload_type: head.payload.type },
                { minIntervalMs: 2000, dedupeKey: `post_rejected_${response.status}_${head.payload.type}` }
              );
              if (nextIndex === 0) {
                pendingMessagesRef.current.shift();
              } else {
                pendingMessagesRef.current.splice(nextIndex, 1);
              }
            } else {
              emitMetric(
                "prod_realtime_post_failed",
                { reason: "server_error", status_code: response.status },
                { minIntervalMs: 2000 }
              );
              scheduleReconnect();
            }
            onError(data.error || "Не удалось отправить действие в комнату");
            break;
          }
        } finally {
          queueDrainInProgressRef.current = false;
          const next = pendingMessagesRef.current[0];
          if (next && !(requiresEventToken(next.payload) && !eventTokenRef.current)) {
            queueMicrotask(() => {
              tryDrainQueueRef.current?.();
            });
          }
        }
      })();
    };
    tryDrainQueueRef.current = tryDrainQueue;

    const requestStateSync = (options: { expectHydration?: boolean } = {}) => {
      if (options.expectHydration) {
        expectRecoveryStateSync = true;
        onRequireRecoverySync?.();
      }
      const now = Date.now();
      // Recovery hydration should never be skipped: missing this request can leave one tab stale
      // until someone else forces a full state broadcast.
      if (!options.expectHydration && now - lastStateSyncRequestAt < 300) return;
      lastStateSyncRequestAt = now;
      emitMetric(
        "prod_state_sync_requested",
        { expect_hydration: Boolean(options.expectHydration) },
        {
          minIntervalMs: options.expectHydration ? 1000 : 4000,
          dedupeKey: options.expectHydration ? "state_sync_hydration" : "state_sync_regular"
        }
      );
      queuePayload({ type: "request_state_sync" }, { dedupeSameType: true });
      tryDrainQueueRef.current?.();
    };

    const sendPresence = (status: "active" | "away", options: { force?: boolean } = {}) => {
      if (!options.force && lastPresenceRef.current === status) return;
      lastPresenceRef.current = status;
      queuePayload({ type: "presence_update", presenceStatus: status }, { dedupeSameType: true });
      tryDrainQueueRef.current?.();
    };

    const publishCurrentPresence = (options: { force?: boolean } = {}) => {
      sendPresence(currentPresenceStatus(hasWindowFocus), options);
    };

    const notifyLeaveRoom = () => {
      if (leaveNotified) return;
      leaveNotified = true;
      const payload = JSON.stringify({
        sessionId,
        eventToken: eventTokenRef.current,
        type: "leave_room"
      });
      const url = `${API_BASE_URL}/realtime/rooms/${inviteCode}/events`;
      const beaconQueued =
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      if (beaconQueued) return;
      void fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: payload,
        keepalive: true
      }).catch(() => {});
    };

    function connectSse() {
      if (disposed) return;

      eventTokenRef.current = null;
      const params = buildParams();
      const source = new EventSource(`${API_BASE_URL}/realtime/rooms/${inviteCode}/stream?${params.toString()}`);
      sseRef.current = source;

      source.onopen = () => {
        if (disposed) {
          source.close();
          return;
        }
        reconnectScheduled = false;
        if (reconnectTimerId != null) {
          window.clearTimeout(reconnectTimerId);
          reconnectTimerId = null;
        }
        sseErrorNotified = false;
        setConnected(true);
        roomSyncTransportLog("sse_open", { inviteCode });
        emitMetric("prod_realtime_connected", {}, { minIntervalMs: 1000 });
        onError("");
        publishCurrentPresence({ force: true });
        requestStateSync({ expectHydration: true });
      };

      source.onmessage = (event) => {
        handleIncomingMessage(event.data);
      };

      source.onerror = () => {
        if (disposed) return;
        setConnected(false);
        if (source.readyState === EventSource.CLOSED) {
          scheduleReconnect();
        }
        if (!sseErrorNotified) {
          sseErrorNotified = true;
          emitMetric(
            "prod_realtime_connection_lost",
            { ready_state: source.readyState },
            { minIntervalMs: 2000 }
          );
          onError("Соединение с realtime временно потеряно. Пытаемся восстановить связь...");
        }
      };
    }

    const handleIncomingMessage = (raw: string) => {
      try {
        const message = JSON.parse(raw) as WsMessage;
        if (message.type === "state_sync") {
          const payload = message.payload as RealtimeState;
          eventTokenRef.current = payload.eventToken?.trim() || null;
          const shouldHydrateFromState = expectRecoveryStateSync;
          expectRecoveryStateSync = false;
          emitMetric(
            "prod_state_sync_received",
            {
              participants: payload.participants?.length ?? 0,
              has_yjs_snapshot: Boolean(payload.yjsDocumentBase64),
              yjs_sequence: typeof payload.lastYjsSequence === "number" ? payload.lastYjsSequence : 0
            },
            { minIntervalMs: 1000 }
          );
          onState(payload);
          if (shouldHydrateFromState) {
            // After a recovery sync, discard stale queued code/yjs writes so we do not replay
            // a partial local snapshot over the fresh server state.
            dropQueuedRecoveryMutations();
          }
          if (eventTokenRef.current) {
            tryDrainQueueRef.current?.();
          }
          if (shouldHydrateFromState) {
            emitMetric(
              "prod_recovery_state_sync_applied",
              {
                yjs_sequence: typeof payload.lastYjsSequence === "number" ? payload.lastYjsSequence : 0
              },
              { minIntervalMs: 1000 }
            );
            onRecoveryStateSync?.(typeof payload.lastYjsSequence === "number" ? payload.lastYjsSequence : 0);
          }
          return;
        }
        if (message.type === "yjs_update") {
          const payload = message.payload as { sessionId?: string; yjsUpdate?: string; syncKey?: string | null; yjsSequence?: number | null };
          if (payload?.sessionId && payload?.yjsUpdate) {
            onYjsUpdate?.({
              sessionId: payload.sessionId,
              yjsUpdate: payload.yjsUpdate,
              syncKey: payload.syncKey ?? null,
              yjsSequence: typeof payload.yjsSequence === "number" ? payload.yjsSequence : null
            });
          }
          return;
        }
        if (message.type === "awareness_update") {
          const payload = message.payload as {
            sessionId?: string;
            userId?: string | null;
            participantId?: string | null;
            awarenessUpdate?: string;
          };
          if (payload?.sessionId && payload?.awarenessUpdate) {
            onAwarenessUpdate?.({
              sessionId: payload.sessionId,
              userId: payload.userId ?? null,
              participantId: payload.participantId ?? null,
              awarenessUpdate: payload.awarenessUpdate
            });
          }
          return;
        }
        if (message.type === "cursor_update") {
          const payload = message.payload as unknown as CursorPayload;
          if (payload?.sessionId) {
            onCursorUpdate?.(payload);
          }
          return;
        }
        if (message.type === "candidate_key") {
          const payload = message.payload as unknown as CandidateKeyPayload;
          if (payload?.sessionId) {
            onCandidateKey?.(payload);
          }
          return;
        }
        if (message.type === "verdict_set") {
          // Fetch the updated room state immediately so the verdict/status UI
          // reflects the committed DB row before the user sees the screen.
          // expectHydration:true forces a full re-hydration of the room state.
          requestStateSync({ expectHydration: true });
          return;
        }
        if (message.type === "error") {
          emitMetric("prod_realtime_server_error_message", {}, { minIntervalMs: 2000 });
          onError((message.payload as { message: string }).message);
        }
      } catch {
        emitMetric("prod_realtime_message_parse_failed", {}, { minIntervalMs: 2000 });
        onError("Ошибка чтения сообщения комнаты");
      }
    };

    const handleFocus = () => {
      hasWindowFocus = true;
      publishCurrentPresence();
      roomSyncTransportLog("window_focus_request_state_sync");
      requestStateSync({ expectHydration: true });
    };

    const handleBlur = () => {
      hasWindowFocus = false;
      sendPresence("away");
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        hasWindowFocus = typeof document.hasFocus === "function" ? document.hasFocus() : hasWindowFocus;
        publishCurrentPresence();
        roomSyncTransportLog("visibility_visible_request_state_sync");
        requestStateSync({ expectHydration: true });
        return;
      }
      publishCurrentPresence();
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      if (event?.persisted) return;
      notifyLeaveRoom();
    };

    const handleBeforeUnload = () => {
      notifyLeaveRoom();
    };

    sendRef.current = (payload: ClientMessage) => {
      queuePayload(payload);
      tryDrainQueueRef.current?.();
    };
    connectSse();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);

      disposed = true;

      const sse = sseRef.current;
      sseRef.current = null;
      sse?.close();
      if (reconnectTimerId != null) {
        window.clearTimeout(reconnectTimerId);
      }
      reconnectTimerId = null;
      reconnectScheduled = false;
      abortInFlightRequest();
      dropPendingQueue();
      queueDrainInProgressRef.current = false;
      inFlightControllerRef.current = null;
      eventTokenRef.current = null;
      lastPresenceRef.current = null;
      tryDrainQueueRef.current = null;

      sendRef.current = () => {};
    };
  }, [
    authToken,
    displayName,
    enabled,
    inviteCode,
    onAwarenessUpdate,
    onCandidateKey,
    onCursorUpdate,
    onError,
    onRecoveryStateSync,
    onRequireRecoverySync,
    onState,
    onYjsUpdate,
    ownerToken,
    participantId,
    sessionId
  ]);

  const send = (payload: ClientMessage) => {
    sendRef.current(payload);
  };

  const sendCodeUpdate = (code: string, syncKey?: string | null) => {
    const codeSequence = codeSequenceRef.current + 1;
    codeSequenceRef.current = codeSequence;
    persistCodeSequence(inviteCode, codeSequence);
    queuePayload({ type: "code_update", code, codeSequence, syncKey: syncKey ?? null }, { dedupeSameType: true });
    tryDrainQueueRef.current?.();
  };

  const sendLanguageUpdate = (language: string) => {
    send({ type: "language_update", language });
  };

  const sendSetStep = (stepIndex: number) => {
    send({ type: "set_step", stepIndex });
  };

  const sendTaskRatingUpdate = (stepIndex: number, rating: number | null) => {
    send({ type: "task_rating_update", stepIndex, rating });
  };

  const sendNotesUpdate = (notes: string) => {
    send({ type: "notes_update", notes });
  };

  const sendNoteMessage = (noteId: string, noteText: string, noteTimestampEpochMs: number) => {
    send({
      type: "note_message",
      noteId,
      noteText,
      noteTimestampEpochMs
    });
  };

  const sendPrivateNoteEntry = (
    privateNoteId: string,
    privateNoteText: string,
    privateNoteTimestampEpochMs: number,
    privateNoteBlockName?: string | null,
    privateNoteBlockStepIndex?: number | null
  ) => {
    send({
      type: "private_note_entry",
      privateNoteId,
      privateNoteText,
      privateNoteTimestampEpochMs,
      privateNoteBlockName: privateNoteBlockName ?? null,
      privateNoteBlockStepIndex: privateNoteBlockStepIndex ?? null
    });
  };

  const sendBriefingUpdate = (briefingMarkdown: string) => {
    send({
      type: "briefing_markdown_update",
      briefingMarkdown
    });
  };

  const sendGrantInterviewerAccess = (targetSessionId?: string, targetUserId?: string) => {
    send({
      type: "grant_interviewer_access",
      targetSessionId,
      targetUserId
    });
  };

  const sendRevokeInterviewerAccess = (targetSessionId?: string, targetUserId?: string) => {
    send({
      type: "revoke_interviewer_access",
      targetSessionId,
      targetUserId
    });
  };

  const sendCursorUpdate = (payload: {
    lineNumber: number;
    column: number;
    selectionStartLineNumber?: number | null;
    selectionStartColumn?: number | null;
    selectionEndLineNumber?: number | null;
    selectionEndColumn?: number | null;
  }) => {
    const cursorSequence = cursorSequenceRef.current + 1;
    cursorSequenceRef.current = cursorSequence;
    persistCursorSequence(inviteCode, cursorSequence);
    send({
      type: "cursor_update",
      lineNumber: payload.lineNumber,
      column: payload.column,
      cursorSequence,
      selectionStartLineNumber: payload.selectionStartLineNumber,
      selectionStartColumn: payload.selectionStartColumn,
      selectionEndLineNumber: payload.selectionEndLineNumber,
      selectionEndColumn: payload.selectionEndColumn
    });
  };

  const sendAwarenessUpdate = (awarenessUpdate: string) => {
    const trimmed = awarenessUpdate.trim();
    if (!trimmed) return;
    send({ type: "awareness_update", awarenessUpdate: trimmed });
  };

  const sendYjsUpdate = (
    yjsUpdate: string,
    syncKey?: string | null,
    codeSnapshot?: string | null,
    yjsDocumentBase64?: string | null,
    baseServerYjsSequence?: number | null
  ) => {
    const normalizedYjsUpdate = yjsUpdate.trim();
    const yjsClientSequence = yjsSequenceRef.current + 1;
    yjsSequenceRef.current = yjsClientSequence;
    persistYjsSequence(inviteCode, yjsClientSequence);
    const normalizedBaseServerYjsSequence =
      typeof baseServerYjsSequence === "number" && Number.isFinite(baseServerYjsSequence)
        ? Math.max(0, Math.floor(baseServerYjsSequence))
        : null;
    queuePayload({
      type: "yjs_update",
      yjsUpdate: normalizedYjsUpdate,
      syncKey: syncKey ?? null,
      code: codeSnapshot ?? null,
      yjsClientSequence,
      baseServerYjsSequence: normalizedBaseServerYjsSequence,
      operationId: `yjs-op-${crypto.randomUUID()}`,
      yjsDocumentBase64: yjsDocumentBase64?.trim() || null
    }, { dedupeSameType: normalizedYjsUpdate.length === 0 });
    tryDrainQueueRef.current?.();
  };

  const sendKeyPress = (payload: {
    key: string;
    keyCode: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    /**
     * Категория события: `keydown` (по умолчанию), либо синтетические
     * `window_blur`/`window_focus`/`tab_hidden`/`tab_visible`. Они нужны,
     * чтобы фиксировать в логе переключение окон/вкладок (Alt+Tab, Cmd+Tab),
     * которые ОС перехватывает до браузера и обычным `keydown` не приходят.
     */
    eventKind?: string;
    pasteLength?: number;
    pastePreview?: string;
  }) => {
    const now = Date.now();
    const eventKind = payload.eventKind ?? "keydown";
    // Синтетические события (blur/visibility) не должны теряться из-за
    // троттлинга: они срабатывают редко, а пропустить «переключился на другое
    // окно» — это потерять самый важный сигнал в логах.
    if (
      eventKind === "keydown" &&
      now - lastKeyPressSentAtRef.current < KEY_PRESS_CLIENT_THROTTLE_MS
    ) {
      return;
    }
    if (eventKind === "keydown") {
      lastKeyPressSentAtRef.current = now;
    }
    send({
      type: "key_press",
      key: payload.key,
      keyCode: payload.keyCode,
      ctrlKey: payload.ctrlKey,
      altKey: payload.altKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
      eventKind,
      ...(payload.pasteLength != null ? { pasteLength: payload.pasteLength } : {}),
      ...(payload.pastePreview != null ? { pastePreview: payload.pastePreview } : {}),
    });
  };

  return {
    connected,
    participantId,
    sessionId,
    sendCodeUpdate,
    sendLanguageUpdate,
    sendSetStep,
    sendTaskRatingUpdate,
    sendNotesUpdate,
    sendNoteMessage,
    sendPrivateNoteEntry,
    sendBriefingUpdate,
    sendGrantInterviewerAccess,
    sendRevokeInterviewerAccess,
    sendCursorUpdate,
    sendAwarenessUpdate,
    sendYjsUpdate,
    sendKeyPress
  };
}
