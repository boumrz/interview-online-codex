import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, WS_BASE_URL } from "../../config/runtime";

type Participant = {
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
};

type CursorPayload = {
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  lineNumber: number;
  column: number;
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

type RealtimeState = {
  inviteCode: string;
  language: string;
  code: string;
  lastCodeUpdatedBySessionId: string | null;
  currentStep: number;
  notes: string;
  participants: Participant[];
  isOwner: boolean;
  role: "owner" | "interviewer" | "candidate";
  canManageRoom: boolean;
  notesLockedBySessionId: string | null;
  notesLockedByDisplayName: string | null;
  notesLockedUntilEpochMs: number | null;
  cursors: CursorPayload[];
  lastCandidateKey: CandidateKeyPayload | null;
};

type WsMessage = {
  type: string;
  payload: RealtimeState | { message: string };
};

type Options = {
  enabled?: boolean;
  inviteCode: string;
  displayName: string;
  authToken?: string | null;
  ownerToken?: string | null;
  interviewerToken?: string | null;
  onState: (state: RealtimeState) => void;
  onError: (message: string) => void;
  onYjsUpdate?: (payload: { sessionId: string; yjsUpdate: string }) => void;
};

type ClientMessage =
  | { type: "code_update"; code: string }
  | { type: "language_update"; language: string }
  | { type: "set_step"; stepIndex: number }
  | { type: "notes_update"; notes: string }
  | { type: "presence_update"; presenceStatus: "active" | "away" }
  | { type: "cursor_update"; lineNumber: number; column: number }
  | { type: "yjs_update"; yjsUpdate: string }
  | {
      type: "key_press";
      key: string;
      keyCode: string;
      ctrlKey: boolean;
      altKey: boolean;
      shiftKey: boolean;
      metaKey: boolean;
    };

const WS_RECONNECT_BASE_DELAY_MS = 500;
const WS_RECONNECT_MAX_DELAY_MS = 5000;
const WS_FAILS_BEFORE_SSE_FALLBACK = 2;
const PRESENCE_HEARTBEAT_MS = 10_000;
const MAX_PENDING_MESSAGES = 300;

function sessionIdKey(inviteCode: string) {
  return `room_ws_session_id_${inviteCode}`;
}

function getOrCreateSessionId(inviteCode: string) {
  const key = sessionIdKey(inviteCode);
  const existing = sessionStorage.getItem(key)?.trim();
  if (existing) return existing;
  const next = `s-${crypto.randomUUID()}`;
  sessionStorage.setItem(key, next);
  return next;
}

function currentPresenceStatus(hasWindowFocus: boolean): "active" | "away" {
  return document.visibilityState === "visible" && hasWindowFocus ? "active" : "away";
}

function reconnectDelay(attempt: number): number {
  return Math.min(WS_RECONNECT_BASE_DELAY_MS * 2 ** attempt, WS_RECONNECT_MAX_DELAY_MS);
}

export function useRoomSocket({
  enabled = true,
  inviteCode,
  displayName,
  authToken,
  ownerToken,
  interviewerToken,
  onState,
  onError,
  onYjsUpdate
}: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const transportRef = useRef<"ws" | "sse">("ws");
  const pendingMessagesRef = useRef<ClientMessage[]>([]);
  const sendRef = useRef<(payload: ClientMessage) => void>((payload: ClientMessage) => {
    pendingMessagesRef.current.push(payload);
    if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
      pendingMessagesRef.current.shift();
    }
  });
  const [connected, setConnected] = useState(false);
  const sessionId = useMemo(() => getOrCreateSessionId(inviteCode), [inviteCode]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      wsRef.current?.close();
      sseRef.current?.close();
      wsRef.current = null;
      sseRef.current = null;
      return;
    }

    let wsFailedAttempts = 0;
    let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let presenceHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let hasWindowFocus = typeof document !== "undefined" ? document.hasFocus() : true;
    let disposed = false;
    let closedInCleanup = false;
    let sseErrorNotified = false;

    const shouldQueuePayload = (payload: ClientMessage) => {
      return payload.type !== "cursor_update" && payload.type !== "presence_update";
    };

    const enqueuePayload = (payload: ClientMessage) => {
      if (!shouldQueuePayload(payload)) return;
      pendingMessagesRef.current.push(payload);
      if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
        pendingMessagesRef.current.shift();
      }
    };

    const clearWsReconnectTimer = () => {
      if (wsReconnectTimer !== null) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    const clearPresenceHeartbeat = () => {
      if (presenceHeartbeatTimer !== null) {
        clearInterval(presenceHeartbeatTimer);
        presenceHeartbeatTimer = null;
      }
    };

    const ensurePresenceHeartbeat = () => {
      if (presenceHeartbeatTimer !== null) return;
      presenceHeartbeatTimer = setInterval(() => {
        sendPresence(currentPresenceStatus(hasWindowFocus));
      }, PRESENCE_HEARTBEAT_MS);
    };

    const buildParams = () => {
      const params = new URLSearchParams({ sessionId });
      params.set("displayNameEncoded", displayName);
      if (authToken) params.set("authToken", authToken);
      if (ownerToken) params.set("ownerToken", ownerToken);
      if (interviewerToken) params.set("interviewerToken", interviewerToken);
      return params;
    };

    const handleIncomingMessage = (raw: string) => {
      try {
        const message = JSON.parse(raw) as WsMessage;
        if (message.type === "state_sync") {
          onState(message.payload as RealtimeState);
          return;
        }
        if (message.type === "yjs_update") {
          const payload = message.payload as { sessionId?: string; yjsUpdate?: string };
          if (payload?.sessionId && payload?.yjsUpdate) {
            onYjsUpdate?.({
              sessionId: payload.sessionId,
              yjsUpdate: payload.yjsUpdate
            });
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

    const postFallbackEvent = (payload: ClientMessage, queueOnFailure = true) => {
      void fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          ...payload
        })
      })
        .then(async (response) => {
          if (response.ok) return;
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          if (queueOnFailure) {
            enqueuePayload(payload);
          }
          onError(data.error || "Не удалось отправить действие в комнату");
        })
        .catch(() => {
          if (queueOnFailure) {
            enqueuePayload(payload);
          }
          onError("Не удалось отправить действие в комнату");
        });
    };

    const sendViaActiveTransport = (payload: ClientMessage, queueOnUnavailable = true) => {
      if (transportRef.current === "ws") {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify(payload));
          return;
        }
        if (queueOnUnavailable) {
          enqueuePayload(payload);
        }
        return;
      }

      const source = sseRef.current;
      if (source?.readyState !== EventSource.OPEN) {
        if (queueOnUnavailable) {
          enqueuePayload(payload);
        }
        return;
      }

      postFallbackEvent(payload, queueOnUnavailable);
    };

    const flushPendingMessages = () => {
      if (pendingMessagesRef.current.length === 0) return;
      const pending = [...pendingMessagesRef.current];
      pendingMessagesRef.current = [];
      pending.forEach((payload) => sendViaActiveTransport(payload, true));
    };

    const sendPresence = (status: "active" | "away") => {
      sendViaActiveTransport({ type: "presence_update", presenceStatus: status }, false);
    };

    const publishCurrentPresence = () => {
      sendPresence(currentPresenceStatus(hasWindowFocus));
    };

    const connectSse = () => {
      if (disposed) return;

      const params = buildParams();
      const source = new EventSource(`${API_BASE_URL}/realtime/rooms/${inviteCode}/stream?${params.toString()}`);
      sseRef.current = source;
      transportRef.current = "sse";

      source.onopen = () => {
        if (disposed) {
          source.close();
          return;
        }
        sseErrorNotified = false;
        setConnected(true);
        onError("");
        flushPendingMessages();
        publishCurrentPresence();
        ensurePresenceHeartbeat();
      };

      source.onmessage = (event) => {
        handleIncomingMessage(event.data);
      };

      source.onerror = () => {
        if (disposed) return;
        setConnected(false);
        if (!sseErrorNotified) {
          sseErrorNotified = true;
          onError("Резервное подключение нестабильно. Пробуем восстановить связь...");
        }
      };
    };

    const switchToSseFallback = () => {
      if (disposed || transportRef.current === "sse") return;

      clearWsReconnectTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        closedInCleanup = true;
        ws.close(1000, "switch_to_sse");
      }

      onError("WebSocket недоступен. Переключились на резервный режим подключения.");
      connectSse();
    };

    const scheduleWsReconnect = (closeCode: number) => {
      if (disposed || transportRef.current === "sse") return;

      wsFailedAttempts += 1;
      if (wsFailedAttempts >= WS_FAILS_BEFORE_SSE_FALLBACK) {
        switchToSseFallback();
        return;
      }

      const delay = reconnectDelay(wsFailedAttempts - 1);
      onError(`Соединение потеряно (код ${closeCode}). Повторная попытка подключения...`);
      clearWsReconnectTimer();
      wsReconnectTimer = setTimeout(() => {
        connectWs();
      }, delay);
    };

    const connectWs = () => {
      if (disposed || transportRef.current === "sse") return;

      const params = buildParams();
      const socket = new WebSocket(`${WS_BASE_URL}/rooms/${inviteCode}?${params.toString()}`);
      wsRef.current = socket;
      closedInCleanup = false;

      socket.onopen = () => {
        if (disposed) {
          closedInCleanup = true;
          socket.close(1000, "component_disposed");
          return;
        }
        wsFailedAttempts = 0;
        setConnected(true);
        onError("");
        flushPendingMessages();
        publishCurrentPresence();
        ensurePresenceHeartbeat();
      };

      socket.onclose = (event) => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        setConnected(false);
        if (disposed || closedInCleanup || event.code === 1000) return;
        scheduleWsReconnect(event.code);
      };

      socket.onmessage = (event) => {
        handleIncomingMessage(event.data);
      };
    };

    const handleFocus = () => {
      hasWindowFocus = true;
      publishCurrentPresence();
    };

    const handleBlur = () => {
      hasWindowFocus = false;
      sendPresence("away");
    };

    const handleVisibilityChange = () => publishCurrentPresence();

    const handlePageHide = () => {
      sendPresence("away");
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        closedInCleanup = true;
        ws.close(1000, "page_unload");
      }
      sseRef.current?.close();
      clearPresenceHeartbeat();
    };

    transportRef.current = "ws";
    sendRef.current = (payload: ClientMessage) => {
      sendViaActiveTransport(payload, true);
    };
    connectWs();

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
      clearWsReconnectTimer();
      clearPresenceHeartbeat();

      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        closedInCleanup = true;
        ws.close(1000, "component_unmount");
      }

      const sse = sseRef.current;
      sseRef.current = null;
      sse?.close();

      sendRef.current = (payload: ClientMessage) => {
        enqueuePayload(payload);
      };
    };
  }, [authToken, displayName, enabled, interviewerToken, inviteCode, onError, onState, onYjsUpdate, ownerToken, sessionId]);

  const send = (payload: ClientMessage) => {
    sendRef.current(payload);
  };

  const sendCodeUpdate = (code: string) => {
    send({ type: "code_update", code });
  };

  const sendLanguageUpdate = (language: string) => {
    send({ type: "language_update", language });
  };

  const sendSetStep = (stepIndex: number) => {
    send({ type: "set_step", stepIndex });
  };

  const sendNotesUpdate = (notes: string) => {
    send({ type: "notes_update", notes });
  };

  const sendCursorUpdate = (lineNumber: number, column: number) => {
    send({ type: "cursor_update", lineNumber, column });
  };

  const sendYjsUpdate = (yjsUpdate: string) => {
    send({ type: "yjs_update", yjsUpdate });
  };

  const sendKeyPress = (payload: {
    key: string;
    keyCode: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }) => {
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
    sendNotesUpdate,
    sendCursorUpdate,
    sendYjsUpdate,
    sendKeyPress
  };
}

