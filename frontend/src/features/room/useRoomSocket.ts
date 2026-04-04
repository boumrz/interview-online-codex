import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../../config/runtime";

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
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
  isAuthenticated?: boolean;
  canBeGrantedInterviewerAccess?: boolean;
};

type CursorPayload = {
  sessionId: string;
  displayName: string;
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
};

type NoteMessagePayload = {
  id: string;
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  text: string;
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
  briefingMarkdown?: string;
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
  onAwarenessUpdate?: (payload: { sessionId: string; awarenessUpdate: string }) => void;
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
    }
  | { type: "request_state_sync" };

const MAX_PENDING_MESSAGES = 300;
const KEY_PRESS_CLIENT_THROTTLE_MS = 120;

function sessionIdKey(inviteCode: string) {
  return `room_ws_session_id_${inviteCode}`;
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

function getOrCreateSessionId(inviteCode: string) {
  const key = sessionIdKey(inviteCode);
  const existing = sessionStorage.getItem(key)?.trim();
  if (existing) return existing;
  const next = `s-${crypto.randomUUID()}`;
  sessionStorage.setItem(key, next);
  return next;
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
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const cursorSequenceRef = useRef(0);
  const codeSequenceRef = useRef(0);
  const yjsSequenceRef = useRef(0);
  const eventTokenRef = useRef<string | null>(null);
  const lastPresenceRef = useRef<"active" | "away" | null>(null);
  const lastKeyPressSentAtRef = useRef(0);
  const sendRef = useRef<(payload: ClientMessage) => void>((payload: ClientMessage) => {
    pendingMessagesRef.current.push(payload);
    if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
      pendingMessagesRef.current.shift();
    }
  });
  const [connected, setConnected] = useState(false);
  const sessionId = useMemo(() => getOrCreateSessionId(inviteCode), [inviteCode]);

  useEffect(() => {
    cursorSequenceRef.current = getInitialCursorSequence(inviteCode);
    codeSequenceRef.current = getInitialCodeSequence(inviteCode);
    yjsSequenceRef.current = getInitialYjsSequence(inviteCode);
  }, [inviteCode]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }

    let hasWindowFocus = typeof document !== "undefined" ? document.hasFocus() : true;
    let disposed = false;
    let sseErrorNotified = false;
    let lastStateSyncRequestAt = 0;
    let expectRecoveryStateSync = false;
    let reconnectTimerId: number | null = null;
    let reconnectScheduled = false;
    lastPresenceRef.current = null;

    const shouldQueuePayload = (payload: ClientMessage) => {
      return (
        payload.type !== "cursor_update" &&
        payload.type !== "presence_update" &&
        payload.type !== "request_state_sync"
      );
    };

    const requiresEventToken = (payload: ClientMessage) => {
      return payload.type !== "request_state_sync" && payload.type !== "presence_update";
    };

    const enqueuePayload = (payload: ClientMessage) => {
      if (!shouldQueuePayload(payload)) return;
      pendingMessagesRef.current.push(payload);
      if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
        pendingMessagesRef.current.shift();
      }
    };

    const buildParams = () => {
      const params = new URLSearchParams({ sessionId });
      params.set("displayNameEncoded", displayName);
      if (authToken) params.set("authToken", authToken);
      if (ownerToken) params.set("ownerToken", ownerToken);
      return params;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectScheduled) return;
      reconnectScheduled = true;
      setConnected(false);
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

    const postEvent = (payload: ClientMessage, queueOnFailure = true) => {
      void fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          eventToken: eventTokenRef.current,
          ...payload
        })
      })
        .then(async (response) => {
          if (response.ok) return;
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          if (queueOnFailure && shouldQueuePayload(payload)) {
            enqueuePayload(payload);
          }
          if (response.status === 403) {
            scheduleReconnect();
          }
          onError(data.error || "Не удалось отправить действие в комнату");
        })
        .catch(() => {
          if (queueOnFailure && shouldQueuePayload(payload)) {
            enqueuePayload(payload);
          }
          scheduleReconnect();
          onError("Не удалось отправить действие в комнату");
        });
    };

    // Do not gate POST on EventSource.OPEN: during CONNECTING/reconnect the socket is not OPEN yet
    // outbound events were only queued — no fetch ran, so DevTools showed no POSTs after a few keystrokes.
    // Server validates sessionId; failed POSTs are queued when queueOnFailure allows it.
    const sendViaPost = (payload: ClientMessage, queueOnFailure = true) => {
      if (requiresEventToken(payload) && !eventTokenRef.current) {
        if (queueOnFailure && shouldQueuePayload(payload)) {
          enqueuePayload(payload);
        }
        return;
      }
      postEvent(payload, queueOnFailure);
    };

    const flushPendingMessages = () => {
      if (pendingMessagesRef.current.length === 0) return;
      const pending = [...pendingMessagesRef.current];
      pendingMessagesRef.current = [];
      pending.forEach((payload) => sendViaPost(payload, true));
    };

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
      sendViaPost({ type: "request_state_sync" }, false);
    };

    const sendPresence = (status: "active" | "away", options: { force?: boolean } = {}) => {
      if (!options.force && lastPresenceRef.current === status) return;
      lastPresenceRef.current = status;
      sendViaPost({ type: "presence_update", presenceStatus: status }, false);
    };

    const publishCurrentPresence = (options: { force?: boolean } = {}) => {
      sendPresence(currentPresenceStatus(hasWindowFocus), options);
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
        onError("");
        flushPendingMessages();
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
          onState(payload);
          if (eventTokenRef.current) {
            flushPendingMessages();
          }
          if (shouldHydrateFromState) {
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
          const payload = message.payload as { sessionId?: string; awarenessUpdate?: string };
          if (payload?.sessionId && payload?.awarenessUpdate) {
            onAwarenessUpdate?.({
              sessionId: payload.sessionId,
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
        if (message.type === "error") {
          onError((message.payload as { message: string }).message);
        }
      } catch {
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

    const handlePageHide = () => {
      sendPresence("away");
    };

    sendRef.current = (payload: ClientMessage) => {
      sendViaPost(payload, true);
    };
    connectSse();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);

      disposed = true;

      const sse = sseRef.current;
      sseRef.current = null;
      sse?.close();
      if (reconnectTimerId != null) {
        window.clearTimeout(reconnectTimerId);
      }
      reconnectTimerId = null;
      reconnectScheduled = false;
      eventTokenRef.current = null;

      sendRef.current = (payload: ClientMessage) => {
        enqueuePayload(payload);
      };
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
    sessionId
  ]);

  const send = (payload: ClientMessage) => {
    sendRef.current(payload);
  };

  const sendCodeUpdate = (code: string, syncKey?: string | null) => {
    const codeSequence = codeSequenceRef.current + 1;
    codeSequenceRef.current = codeSequence;
    persistCodeSequence(inviteCode, codeSequence);
    send({ type: "code_update", code, codeSequence, syncKey: syncKey ?? null });
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
    yjsDocumentBase64?: string | null
  ) => {
    const yjsClientSequence = yjsSequenceRef.current + 1;
    yjsSequenceRef.current = yjsClientSequence;
    persistYjsSequence(inviteCode, yjsClientSequence);
    send({
      type: "yjs_update",
      yjsUpdate,
      syncKey: syncKey ?? null,
      code: codeSnapshot ?? null,
      yjsClientSequence,
      yjsDocumentBase64: yjsDocumentBase64?.trim() || null
    });
  };

  const sendKeyPress = (payload: {
    key: string;
    keyCode: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }) => {
    const now = Date.now();
    if (now - lastKeyPressSentAtRef.current < KEY_PRESS_CLIENT_THROTTLE_MS) {
      return;
    }
    lastKeyPressSentAtRef.current = now;
    send({
      type: "key_press",
      key: payload.key,
      keyCode: payload.keyCode,
      ctrlKey: payload.ctrlKey,
      altKey: payload.altKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey
    });
  };

  return {
    connected,
    sessionId,
    sendCodeUpdate,
    sendLanguageUpdate,
    sendSetStep,
    sendTaskRatingUpdate,
    sendNotesUpdate,
    sendNoteMessage,
    sendBriefingUpdate,
    sendGrantInterviewerAccess,
    sendRevokeInterviewerAccess,
    sendCursorUpdate,
    sendAwarenessUpdate,
    sendYjsUpdate,
    sendKeyPress
  };
}
