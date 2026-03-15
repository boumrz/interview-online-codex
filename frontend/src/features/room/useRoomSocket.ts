import { useEffect, useRef, useState } from "react";

type Participant = {
  sessionId: string;
  displayName: string;
};

type RealtimeState = {
  inviteCode: string;
  language: string;
  code: string;
  currentStep: number;
  participants: Participant[];
  isOwner: boolean;
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
  onState: (state: RealtimeState) => void;
  onError: (message: string) => void;
};

export function useRoomSocket({ enabled = true, inviteCode, displayName, ownerToken, onState, onError }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessionId] = useState(() => `s-${crypto.randomUUID()}`);

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams({
      sessionId
    });
    params.set("displayNameEncoded", displayName);
    if (ownerToken) params.set("ownerToken", ownerToken);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://localhost:8080/ws/rooms/${inviteCode}?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
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

    return () => {
      ws.close();
    };
  }, [displayName, enabled, inviteCode, ownerToken, onError, onState, sessionId]);

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

  const sendNextStep = () => {
    send({ type: "next_step" });
  };

  const sendSetStep = (stepIndex: number) => {
    send({ type: "set_step", stepIndex });
  };

  return {
    connected,
    sendCodeUpdate,
    sendLanguageUpdate,
    sendNextStep,
    sendSetStep
  };
}
