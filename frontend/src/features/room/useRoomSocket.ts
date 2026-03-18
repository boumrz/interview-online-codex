import { useEffect, useMemo, useRef, useState } from "react";

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
  ownerToken?: string | null;
  interviewerToken?: string | null;
  onState: (state: RealtimeState) => void;
  onError: (message: string) => void;
};

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

export function useRoomSocket({ enabled = true, inviteCode, displayName, ownerToken, interviewerToken, onState, onError }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const sessionId = useMemo(() => getOrCreateSessionId(inviteCode), [inviteCode]);

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams({
      sessionId
    });
    params.set("displayNameEncoded", displayName);
    if (ownerToken) params.set("ownerToken", ownerToken);
    if (interviewerToken) params.set("interviewerToken", interviewerToken);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://localhost:8080/ws/rooms/${inviteCode}?${params.toString()}`);
    wsRef.current = ws;

    let hasWindowFocus = true;

    const sendPresence = (status: "active" | "away") => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "presence_update", presenceStatus: status }));
      }
    };

    const publishCurrentPresence = () => {
      sendPresence(currentPresenceStatus(hasWindowFocus));
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
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "page_unload");
      }
    };

    ws.onopen = () => {
      setConnected(true);
      publishCurrentPresence();
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WsMessage;
        if (message.type === "state_sync") onState(message.payload as RealtimeState);
        if (message.type === "error") onError((message.payload as { message: string }).message);
      } catch {
        onError("Ошибка чтения сообщения комнаты");
      }
    };

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
      ws.close();
    };
  }, [displayName, enabled, inviteCode, interviewerToken, ownerToken, onError, onState, sessionId]);

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
