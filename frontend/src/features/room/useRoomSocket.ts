import { useEffect, useMemo, useRef, useState } from "react";
import { WS_BASE_URL } from "../../config/runtime";

type Participant = {
  sessionId: string;
  displayName: string;
  presenceStatus: "active" | "away";
};

type RealtimeState = {
  inviteCode: string;
  language: string;
  code: string;
  currentStep: number;
  notes: string;
  participants: Participant[];
  isOwner: boolean;
  role: "owner" | "interviewer" | "candidate";
  canManageRoom: boolean;
  notesLockedBySessionId: string | null;
  notesLockedByDisplayName: string | null;
  notesLockedUntilEpochMs: number | null;
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
};

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;

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
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
}

export function useRoomSocket({
  enabled = true,
  inviteCode,
  displayName,
  authToken,
  ownerToken,
  interviewerToken,
  onState,
  onError
}: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const sessionId = useMemo(() => getOrCreateSessionId(inviteCode), [inviteCode]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let hasWindowFocus = true;
    let disposed = false;
    let closedInCleanup = false;

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const sendPresence = (status: "active" | "away") => {
      const socket = wsRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "presence_update", presenceStatus: status }));
      }
    };

    const publishCurrentPresence = () => {
      sendPresence(currentPresenceStatus(hasWindowFocus));
    };

    const scheduleReconnect = (closeCode: number) => {
      if (disposed) return;
      const delay = reconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      onError(`Соединение потеряно (код ${closeCode}). Идет переподключение...`);
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;

      const params = new URLSearchParams({
        sessionId
      });
      params.set("displayNameEncoded", displayName);
      if (authToken) params.set("authToken", authToken);
      if (ownerToken) params.set("ownerToken", ownerToken);
      if (interviewerToken) params.set("interviewerToken", interviewerToken);

      const socket = new WebSocket(`${WS_BASE_URL}/rooms/${inviteCode}?${params.toString()}`);
      wsRef.current = socket;
      closedInCleanup = false;

      socket.onopen = () => {
        if (disposed) {
          closedInCleanup = true;
          socket.close(1000, "component_disposed");
          return;
        }
        setConnected(true);
        reconnectAttempt = 0;
        onError("");
        publishCurrentPresence();
      };

      socket.onclose = (event) => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        setConnected(false);
        if (disposed || closedInCleanup || event.code === 1000) return;
        scheduleReconnect(event.code);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage;
          if (message.type === "state_sync") onState(message.payload as RealtimeState);
          if (message.type === "error") onError((message.payload as { message: string }).message);
        } catch {
          onError("Ошибка чтения сообщения комнаты");
        }
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
      const socket = wsRef.current;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        closedInCleanup = true;
        socket.close(1000, "page_unload");
      }
    };

    connect();

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
      clearReconnectTimer();

      const socket = wsRef.current;
      wsRef.current = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        closedInCleanup = true;
        socket.close(1000, "component_unmount");
      }
    };
  }, [authToken, displayName, enabled, inviteCode, interviewerToken, onError, onState, ownerToken, sessionId]);

  const send = (payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
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

  return {
    connected,
    sessionId,
    sendCodeUpdate,
    sendLanguageUpdate,
    sendSetStep,
    sendNotesUpdate
  };
}
