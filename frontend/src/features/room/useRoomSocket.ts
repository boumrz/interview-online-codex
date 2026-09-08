import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeUpdates } from "yjs";
import { API_BASE_URL } from "../../config/runtime";
import { activityRetryDelay, ACTIVITY_REQUEST_TIMEOUT_MS } from "./activityRetry";
import { base64ToBytes, bytesToBase64 } from "./yjsCodec";
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
  isHr?: boolean;
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
  /** Stable source UUID used for idempotent activity delivery. */
  sourceEventId?: string;
  /** Server-assigned canonical order tie breaker. */
  acceptedSequence?: number;
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

export type ManagerWorkspaceRealtimeState = {
  stepIndex: number;
  title: string;
  language: string;
  code: string;
  briefingMarkdown: string;
  revision: number;
  yjsDocumentBase64?: string | null;
  yjsSequence?: number | null;
  /** The server rejected a manager snapshot and the active editor must rebase it. */
  recovery?: boolean;
  focusMode?: boolean;
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
  /** Manager-only inactive-task workspace; never delivered to candidate connections. */
  onManagerWorkspaceSync?: (payload: ManagerWorkspaceRealtimeState) => void;
  onManagerWorkspaceYjsUpdate?: (payload: {
    stepIndex: number;
    sessionId: string;
    yjsUpdate: string;
    yjsSequence?: number | null;
  }) => void;
  onManagerWorkspaceAwarenessUpdate?: (payload: {
    stepIndex: number;
    sessionId: string;
    userId?: string | null;
    participantId?: string | null;
    awarenessUpdate: string;
  }) => void;
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
  | { type: "manager_workspace_open"; stepIndex: number }
  | { type: "manager_workspace_close"; stepIndex: number }
  | {
      type: "manager_workspace_yjs_update";
      stepIndex: number;
      yjsUpdate: string;
      code?: string | null;
      yjsDocumentBase64?: string | null;
      baseServerYjsSequence?: number | null;
      operationId: string;
    }
  | {
      type: "manager_workspace_briefing_update";
      stepIndex: number;
      briefingMarkdown: string;
      revision: number;
    }
  | {
      type: "manager_workspace_language_update";
      stepIndex: number;
      language: string;
      revision: number;
    }
  | {
      type: "manager_workspace_focus_mode_update";
      stepIndex: number;
      focusMode: boolean;
      revision: number;
    }
  | {
      type: "manager_workspace_awareness_update";
      stepIndex: number;
      awarenessUpdate: string;
    }
  | {
      type: "key_press";
      sourceEventId: string;
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
  /** Once attempted, the entire delivery envelope is immutable for retries. */
  attempted?: boolean;
};

type ActivityClientMessage = Extract<ClientMessage, { type: "key_press" }> & {
  sourceEventId: string;
};

type QueuedActivityMessage = {
  payload: ActivityClientMessage;
  /** Consecutive transient failures for this exact FIFO head only. */
  failedAttempts: number;
  /** A retry timer, rather than SSE/state-sync callbacks, owns the next attempt. */
  retryPending: boolean;
  retryDueAt: number | null;
};

const MAX_YJS_BATCH_INPUT_CHARS = 64 * 1024;
const STREAM_STATUS_PROBE_TIMEOUT_MS = 1_500;
const ACTIVITY_RECORDING_DELAYED_ERROR =
  "Запись активности задерживается. Повторяем отправку автоматически.";

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
  onRequireRecoverySync,
  onManagerWorkspaceSync,
  onManagerWorkspaceYjsUpdate,
  onManagerWorkspaceAwarenessUpdate,
}: Options) {
  const sseRef = useRef<EventSource | null>(null);
  const pendingMessagesRef = useRef<QueuedClientMessage[]>([]);
  const cursorSequenceRef = useRef(0);
  const codeSequenceRef = useRef(0);
  const yjsSequenceRef = useRef(0);
  const eventSequenceRef = useRef(0);
  const eventTokenRef = useRef<string | null>(null);
  const lastPresenceRef = useRef<"active" | "away" | null>(null);
  const queueDrainInProgressRef = useRef(false);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const inFlightMessageRef = useRef<QueuedClientMessage | null>(null);
  const tryDrainQueueRef = useRef<(() => void) | null>(null);
  // Activity telemetry deliberately has its own delivery lane: a slow raw-log
  // request must never sit ahead of a Yjs/document mutation in the main queue.
  const pendingActivityRef = useRef<QueuedActivityMessage[]>([]);
  const activityDrainInProgressRef = useRef<symbol | null>(null);
  const activityInFlightControllerRef = useRef<AbortController | null>(null);
  const activityRetryTimerRef = useRef<number | null>(null);
  const tryDrainActivityRef = useRef<(() => void) | null>(null);
  const queueActivityRef = useRef<((payload: ActivityClientMessage) => void) | null>(null);
  const activityCaptureConfirmedRef = useRef(false);
  // Delivery delay is feedback only; it never disables capture or room collaboration.
  const activityDeliveryDelayedRef = useRef(false);
  const activityDeliverySessionKeyRef = useRef<string | null>(null);
  const terminalAccessFailureRef = useRef(false);
  /** A missing room is distinct from an authorization failure and is terminal for this page-room session. */
  const terminalRoomUnavailableRef = useRef(false);
  const terminateRoomUnavailableRef = useRef<() => void>(() => {});
  const terminateRoomUnavailable = useCallback(() => {
    terminateRoomUnavailableRef.current();
  }, []);
  const roomUnavailableSessionKeyRef = useRef<string | null>(null);
  const requiresEventSequence = (payload: ClientMessage) => payload.type !== "request_state_sync" && payload.type !== "presence_update";
  const nextClientEventSequence = () => {
    const next = eventSequenceRef.current + 1;
    eventSequenceRef.current = next;
    persistEventSequence(inviteCode, next);
    return next;
  };
  const queuePayload = (payload: ClientMessage, options: { dedupeSameType?: boolean } = {}) => {
    if (terminalAccessFailureRef.current || terminalRoomUnavailableRef.current) return;
    if (options.dedupeSameType) {
      pendingMessagesRef.current = pendingMessagesRef.current.filter((queued) => {
        // A token-free recovery request can be in flight away from index zero.
        // Keep the actual request until it settles; never cancel it to coalesce.
        if (queued === inFlightMessageRef.current) return true;
        if (queued.payload.type !== payload.type) return true;
        if (payload.type === "yjs_update" && queued.payload.type === "yjs_update") {
          // Only empty-delta heartbeats are replaceable. Later Yjs deltas can
          // depend on every earlier delta, even when a full snapshot is attached.
          return payload.yjsUpdate !== "" || queued.payload.yjsUpdate !== "" ||
            queued.payload.syncKey !== payload.syncKey;
        }
        if (payload.type === "code_update" && queued.payload.type === "code_update") {
          return queued.payload.syncKey !== payload.syncKey;
        }
        return false;
      });
    }
    pendingMessagesRef.current.push({
      payload,
      queuedAtEpochMs: Date.now(),
      clientEventSequence: requiresEventSequence(payload) ? nextClientEventSequence() : null,
    });
    // Keep valid mutations until acknowledged or an explicit context/access
    // boundary. A count cap must not silently evict causal document updates.
  };
  const sendRef = useRef<(payload: ClientMessage) => void>((payload: ClientMessage) => {
    queuePayload(payload);
  });
  const [connected, setConnected] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [roomUnavailable, setRoomUnavailable] = useState(false);
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
      setAccessDenied(false);
      if (!inviteCode) {
        terminalRoomUnavailableRef.current = false;
        roomUnavailableSessionKeyRef.current = null;
        setRoomUnavailable(false);
      }
      sseRef.current?.close();
      sseRef.current = null;
      pendingMessagesRef.current = [];
      pendingActivityRef.current = [];
      if (activityRetryTimerRef.current != null) {
        window.clearTimeout(activityRetryTimerRef.current);
        activityRetryTimerRef.current = null;
      }
      eventTokenRef.current = null;
      queueDrainInProgressRef.current = false;
      inFlightControllerRef.current = null;
      tryDrainQueueRef.current = null;
      activityDrainInProgressRef.current = null;
      activityInFlightControllerRef.current = null;
      tryDrainActivityRef.current = null;
      queueActivityRef.current = null;
      activityCaptureConfirmedRef.current = false;
      activityDeliveryDelayedRef.current = false;
      activityDeliverySessionKeyRef.current = null;
      sendRef.current = () => {};
      return;
    }

    const roomUnavailableSessionKey = `${inviteCode}:${sessionId}`;
    if (roomUnavailableSessionKeyRef.current !== roomUnavailableSessionKey) {
      roomUnavailableSessionKeyRef.current = roomUnavailableSessionKey;
      terminalRoomUnavailableRef.current = false;
      setRoomUnavailable(false);
    }

    const activityDeliverySessionKey = `${inviteCode}:${sessionId}`;
    if (activityDeliverySessionKeyRef.current !== activityDeliverySessionKey) {
      if (activityRetryTimerRef.current != null) {
        window.clearTimeout(activityRetryTimerRef.current);
        activityRetryTimerRef.current = null;
      }
      activityDeliverySessionKeyRef.current = activityDeliverySessionKey;
      activityDeliveryDelayedRef.current = false;
    }

    let hasWindowFocus = typeof document !== "undefined" ? document.hasFocus() : true;
    let disposed = false;
    let sseErrorNotified = false;
    let lastStateSyncRequestAt = 0;
    let expectRecoveryStateSync = false;
    let reconnectTimerId: number | null = null;
    let reconnectScheduled = false;
    let terminalAccessFailure = false;
    let terminalRoomUnavailable = false;
    let streamLease = 0;
    let statusProbeInFlight = false;
    let statusProbeController: AbortController | null = null;
    let statusProbeTimeoutId: number | null = null;
    let authorizationRecoveryAttempted = false;
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
      inFlightMessageRef.current = null;
    };

    const abortActivityInFlightRequest = () => {
      if (activityInFlightControllerRef.current != null) {
        activityInFlightControllerRef.current.abort();
        activityInFlightControllerRef.current = null;
      }
    };

    const dropPendingQueue = () => {
      pendingMessagesRef.current = [];
    };

    const dropPendingActivity = () => {
      pendingActivityRef.current = [];
    };

    const clearActivityRetryTimer = () => {
      if (activityRetryTimerRef.current != null) {
        window.clearTimeout(activityRetryTimerRef.current);
        activityRetryTimerRef.current = null;
      }
    };

    const isTerminal = () =>
      disposed ||
      terminalAccessFailure ||
      terminalRoomUnavailable ||
      terminalAccessFailureRef.current ||
      terminalRoomUnavailableRef.current;

    const abortStatusProbe = () => {
      statusProbeController?.abort();
      statusProbeController = null;
      if (statusProbeTimeoutId != null) {
        window.clearTimeout(statusProbeTimeoutId);
        statusProbeTimeoutId = null;
      }
      statusProbeInFlight = false;
    };

    const invalidateTransportLease = () => {
      streamLease += 1;
      eventTokenRef.current = null;
      activityCaptureConfirmedRef.current = false;
      abortInFlightRequest();
      abortActivityInFlightRequest();
    };

    const presentActivityRecordingDelayed = () => {
      activityDeliveryDelayedRef.current = true;
      // Re-apply the same message after an unrelated reconnect in case another
      // transport callback replaced the shared room error presenter. React still
      // renders one notice because the value is identical.
      onError(ACTIVITY_RECORDING_DELAYED_ERROR);
    };

    const terminateForAccessFailure = () => {
      if (isTerminal()) return;
      terminalAccessFailure = true;
      terminalAccessFailureRef.current = true;
      invalidateTransportLease();
      abortStatusProbe();
      if (reconnectTimerId != null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
      reconnectScheduled = false;
      abortInFlightRequest();
      abortActivityInFlightRequest();
      clearActivityRetryTimer();
      const activeSource = sseRef.current;
      sseRef.current = null;
      activeSource?.close();
      dropPendingQueue();
      dropPendingActivity();
      eventTokenRef.current = null;
      activityCaptureConfirmedRef.current = false;
      tryDrainActivityRef.current = null;
      queueActivityRef.current = null;
      lastPresenceRef.current = null;
      sendRef.current = () => {};
      setConnected(false);
      setAccessDenied(true);
      onError("Не удалось подтвердить доступ к комнате. Откройте актуальную ссылку-приглашение или войдите в аккаунт.");
    };

    const terminateForRoomUnavailable = () => {
      if (isTerminal()) return;
      terminalRoomUnavailable = true;
      terminalRoomUnavailableRef.current = true;
      invalidateTransportLease();
      abortStatusProbe();
      if (reconnectTimerId != null) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
      reconnectScheduled = false;
      clearActivityRetryTimer();
      const activeSource = sseRef.current;
      sseRef.current = null;
      activeSource?.close();
      dropPendingQueue();
      dropPendingActivity();
      tryDrainQueueRef.current = null;
      tryDrainActivityRef.current = null;
      queueActivityRef.current = null;
      lastPresenceRef.current = null;
      sendRef.current = () => {};
      setConnected(false);
      setAccessDenied(false);
      setRoomUnavailable(true);
      onError("");
    };
    terminateRoomUnavailableRef.current = terminateForRoomUnavailable;

    const scheduleReconnect = () => {
      if (isTerminal() || reconnectScheduled || statusProbeInFlight) return;
      reconnectScheduled = true;
      emitMetric(
        "prod_realtime_reconnect_scheduled",
        { pending_messages: pendingMessagesRef.current.length },
        { minIntervalMs: 3000 }
      );
      setConnected(false);
      invalidateTransportLease();
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

    const scheduleActivityRetry = (head: QueuedActivityMessage, retryDelayMs: number) => {
      if (head.retryPending || activityRetryTimerRef.current != null) return;
      const retryDueAt = Date.now() + retryDelayMs;
      const sourceEventId = head.payload.sourceEventId;
      head.retryPending = true;
      head.retryDueAt = retryDueAt;
      activityRetryTimerRef.current = window.setTimeout(() => {
        activityRetryTimerRef.current = null;
        if (isTerminal()) return;
        const currentHead = pendingActivityRef.current[0];
        // State sync and SSE reconnect callbacks may wake the drain, but only
        // this timer may release the same failed head for another POST.
        if (
          !currentHead ||
          currentHead.payload.sourceEventId !== sourceEventId ||
          !currentHead.retryPending ||
          currentHead.retryDueAt !== retryDueAt
        ) {
          return;
        }
        currentHead.retryPending = false;
        currentHead.retryDueAt = null;
        tryDrainActivityRef.current?.();
      }, retryDelayMs);
    };

    const findNextProcessableQueueIndex = () => {
      if (pendingMessagesRef.current.length === 0) return -1;
      if (eventTokenRef.current) return 0;
      return pendingMessagesRef.current.findIndex(({ payload }) => !requiresEventToken(payload));
    };

    const discardObsoleteRecoveryMutations = (state: RealtimeState) => {
      if (pendingMessagesRef.current.length === 0) return;
      const activeSyncKey = `${state.inviteCode}:${state.currentStep}:${state.language}`;
      const before = pendingMessagesRef.current.length;
      pendingMessagesRef.current = pendingMessagesRef.current.filter(({ payload }) => {
        if (payload.type === "code_update") return false;
        if (payload.type !== "yjs_update") return true;
        // Merge the recovery snapshot locally and retry original deltas only
        // within their original task. Never rebind old edits to the new task.
        return payload.yjsUpdate !== "" && payload.syncKey === activeSyncKey;
      });
      const dropped = before - pendingMessagesRef.current.length;
      if (dropped > 0) {
        roomSyncTransportLog("drop_stale_pending_mutations_after_recovery", { dropped });
      }
    };

    const prepareQueuedMessage = (index: number): QueuedClientMessage => {
      const head = pendingMessagesRef.current[index];
      if (head.attempted || head.payload.type !== "yjs_update" ||
        !head.payload.yjsUpdate || !head.payload.syncKey) return head;

      // Merge only a contiguous unsent run. Crossing another action could move
      // its client sequence behind this batch and make the server reject it.
      try {
        const updates = [base64ToBytes(head.payload.yjsUpdate)];
        let inputChars = head.payload.yjsUpdate.length;
        let latest = head;
        let latestPayload = head.payload;
        for (let next = index + 1; next < pendingMessagesRef.current.length; next++) {
          const queued = pendingMessagesRef.current[next];
          const payload = queued.payload;
          if (queued.attempted || payload.type !== "yjs_update" || !payload.yjsUpdate ||
            payload.syncKey !== head.payload.syncKey ||
            inputChars + payload.yjsUpdate.length > MAX_YJS_BATCH_INPUT_CHARS) break;
          updates.push(base64ToBytes(payload.yjsUpdate));
          inputChars += payload.yjsUpdate.length;
          latest = queued;
          latestPayload = payload;
        }
        if (updates.length === 1) return head;
        const batch: QueuedClientMessage = {
          ...latest,
          queuedAtEpochMs: head.queuedAtEpochMs,
          // Keep the latest snapshot and its original freshness metadata together.
          payload: { ...latestPayload, yjsUpdate: bytesToBase64(mergeUpdates(updates)) },
        };
        pendingMessagesRef.current.splice(index, updates.length, batch);
        return batch;
      } catch {
        // Invalid local data must not remove other queued edits during batching.
        return head;
      }
    };

    const tryDrainQueue = () => {
      if (
        queueDrainInProgressRef.current ||
        isTerminal() ||
        statusProbeInFlight ||
        sseRef.current?.readyState !== EventSource.OPEN
      ) return;
      queueDrainInProgressRef.current = true;

      void (async () => {
        try {
          while (!isTerminal()) {
            const nextIndex = findNextProcessableQueueIndex();
            if (nextIndex < 0) break;
            const head = prepareQueuedMessage(nextIndex);
            head.attempted = true;
            const lease = streamLease;
            const token = eventTokenRef.current;

            const controller = new AbortController();
            inFlightControllerRef.current = controller;
            inFlightMessageRef.current = head;
            const removeSettledMessage = () => {
              const index = pendingMessagesRef.current.indexOf(head);
              if (index >= 0) pendingMessagesRef.current.splice(index, 1);
            };

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
                  eventToken: token,
                  clientEventSequence: head.clientEventSequence,
                  ...head.payload
                })
              });
            } catch {
              inFlightControllerRef.current = null;
              if (inFlightMessageRef.current === head) inFlightMessageRef.current = null;
              if (isTerminal() || controller.signal.aborted || lease !== streamLease) break;
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
            if (inFlightMessageRef.current === head) inFlightMessageRef.current = null;

            if (isTerminal() || lease !== streamLease) break;

            if (response.ok) {
              removeSettledMessage();
              continue;
            }

            if (response.status === 410) {
              terminateForRoomUnavailable();
              break;
            }

            const data = (await response.json().catch(() => ({}))) as { error?: string };
            if (response.status === 403) {
              emitMetric(
                "prod_realtime_post_rejected",
                { status_code: 403, payload_type: head.payload.type },
                { minIntervalMs: 2000, dedupeKey: `post_rejected_403_${head.payload.type}` }
              );
              if (authorizationRecoveryAttempted) {
                terminateForAccessFailure();
                break;
              }
              authorizationRecoveryAttempted = true;
              eventTokenRef.current = null;
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
              removeSettledMessage();
              continue;
            }
            if (response.status >= 400 && response.status < 500) {
              // Invalid payload should not block the whole queue forever.
              emitMetric(
                "prod_realtime_post_rejected",
                { status_code: response.status, payload_type: head.payload.type },
                { minIntervalMs: 2000, dedupeKey: `post_rejected_${response.status}_${head.payload.type}` }
              );
              removeSettledMessage();
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
          if (!isTerminal() && next && !(requiresEventToken(next.payload) && !eventTokenRef.current)) {
            queueMicrotask(() => {
              tryDrainQueueRef.current?.();
            });
          }
        }
      })();
    };
    tryDrainQueueRef.current = tryDrainQueue;

    /**
     * A lossless, one-in-flight delivery lane for candidate activity. Unlike the
     * main mutation queue, this lane is never deduplicated or capped: every
     * captured source action remains an individual request with its UUID until
     * the relay acknowledges it. A reconnect retries the same head UUID.
     */
    const tryDrainActivityQueue = () => {
      if (
        activityDrainInProgressRef.current ||
        isTerminal() ||
        reconnectScheduled
      ) {
        return;
      }
      const queuedHead = pendingActivityRef.current[0];
      if (!eventTokenRef.current || !queuedHead || queuedHead.retryPending) return;
      const drainToken = Symbol("activity-drain");
      activityDrainInProgressRef.current = drainToken;

      void (async () => {
        try {
          while (!isTerminal()) {
            const head = pendingActivityRef.current[0];
            const token = eventTokenRef.current;
            const lease = streamLease;
            if (!head || !token || head.retryPending) break;

            const controller = new AbortController();
            activityInFlightControllerRef.current = controller;
            let timedOut = false;
            const deadline = window.setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, ACTIVITY_REQUEST_TIMEOUT_MS);
            let response: Response;
            try {
              response = await fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  eventToken: token,
                  clientEventSequence: null,
                  ...head.payload,
                }),
              });
            } catch {
              if (activityInFlightControllerRef.current === controller) activityInFlightControllerRef.current = null;
              if (isTerminal() || (controller.signal.aborted && !timedOut) || lease !== streamLease) break;
              emitMetric(
                "prod_realtime_activity_post_failed",
                { reason: timedOut ? "timeout" : "network_error" },
                { minIntervalMs: 2_000 },
              );
              head.failedAttempts += 1;
              scheduleActivityRetry(head, activityRetryDelay(head.failedAttempts));
              presentActivityRecordingDelayed();
              break;
            } finally {
              window.clearTimeout(deadline);
            }
            if (activityInFlightControllerRef.current === controller) activityInFlightControllerRef.current = null;

            if (isTerminal() || lease !== streamLease) break;

            if (response.ok) {
              // The source ID, rather than a payload comparison, protects the
              // queue from a late duplicate response after a reconnect.
              if (pendingActivityRef.current[0]?.payload.sourceEventId === head.payload.sourceEventId) {
                head.failedAttempts = 0;
                head.retryPending = false;
                head.retryDueAt = null;
                pendingActivityRef.current.shift();
                if (pendingActivityRef.current.length === 0 && activityDeliveryDelayedRef.current) {
                  activityDeliveryDelayedRef.current = false;
                  onError("");
                }
              }
              continue;
            }

            if (response.status === 410) {
              terminateForRoomUnavailable();
              break;
            }

            if (response.status === 401 || response.status === 403) {
              emitMetric(
                "prod_realtime_activity_post_rejected",
                { status_code: response.status },
                { minIntervalMs: 2_000, dedupeKey: `activity_post_rejected_${response.status}` },
              );
              if (authorizationRecoveryAttempted) {
                terminateForAccessFailure();
                break;
              }
              authorizationRecoveryAttempted = true;
              eventTokenRef.current = null;
              scheduleReconnect();
              break;
            }

            if (response.status >= 500 || response.status === 429) {
              head.failedAttempts += 1;
              emitMetric(
                "prod_realtime_activity_post_failed",
                {
                  reason: "server_error",
                  status_code: response.status,
                  attempt: head.failedAttempts,
                },
                { minIntervalMs: 2_000 },
              );
              scheduleActivityRetry(head, activityRetryDelay(head.failedAttempts));
              presentActivityRecordingDelayed();
              break;
            }

            // Client-side validation is the only expected 4xx path here. Do not
            // let one malformed legacy action block later source actions forever.
            // Error bodies are not part of the acknowledgement contract and may
            // never finish streaming. Release them without blocking the FIFO.
            void response.body?.cancel().catch(() => {});
            if (pendingActivityRef.current[0]?.payload.sourceEventId === head.payload.sourceEventId) {
              pendingActivityRef.current.shift();
            }
            emitMetric(
              "prod_realtime_activity_post_rejected",
              { status_code: response.status },
              { minIntervalMs: 2_000, dedupeKey: `activity_post_rejected_${response.status}` },
            );
            onError("Не удалось отправить действие в комнату");
          }
        } finally {
          if (activityDrainInProgressRef.current !== drainToken) return;
          activityDrainInProgressRef.current = null;
          if (
            !isTerminal() &&
            !reconnectScheduled &&
            eventTokenRef.current &&
            pendingActivityRef.current.length > 0 &&
            !pendingActivityRef.current[0]?.retryPending
          ) {
            queueMicrotask(() => tryDrainActivityRef.current?.());
          }
        }
      })();
    };
    tryDrainActivityRef.current = tryDrainActivityQueue;
    queueActivityRef.current = (payload) => {
      if (
        terminalAccessFailureRef.current ||
        terminalRoomUnavailableRef.current
      ) {
        return;
      }
      pendingActivityRef.current.push({
        payload,
        failedAttempts: 0,
        retryPending: false,
        retryDueAt: null,
      });
      tryDrainActivityRef.current?.();
    };

    const requestStateSync = (options: { expectHydration?: boolean } = {}) => {
      if (isTerminal()) return;
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
      if (isTerminal()) return;
      if (!options.force && lastPresenceRef.current === status) return;
      lastPresenceRef.current = status;
      queuePayload({ type: "presence_update", presenceStatus: status }, { dedupeSameType: true });
      tryDrainQueueRef.current?.();
    };

    const publishCurrentPresence = (options: { force?: boolean } = {}) => {
      sendPresence(currentPresenceStatus(hasWindowFocus), options);
    };

    const notifyLeaveRoom = () => {
      if (isTerminal() || leaveNotified) return;
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

    const probeStreamStatus = (failedLease: number) => {
      if (isTerminal() || statusProbeInFlight || failedLease !== streamLease) return;
      statusProbeInFlight = true;
      const controller = new AbortController();
      statusProbeController = controller;
      statusProbeTimeoutId = window.setTimeout(() => controller.abort(), STREAM_STATUS_PROBE_TIMEOUT_MS);
      const params = buildParams();

      void (async () => {
        let response: Response | null = null;
        try {
          response = await fetch(
            `${API_BASE_URL}/realtime/rooms/${inviteCode}/stream-status?${params.toString()}`,
            { signal: controller.signal, cache: "no-store" },
          );
        } catch {
          // A failed probe is not proof that the room is absent. Keep the
          // established transient reconnect path in that case.
        } finally {
          if (statusProbeTimeoutId != null) {
            window.clearTimeout(statusProbeTimeoutId);
            statusProbeTimeoutId = null;
          }
        }

        const probeIsCurrent =
          !isTerminal() &&
          failedLease === streamLease &&
          statusProbeController === controller;
        if (!probeIsCurrent) return;

        statusProbeController = null;
        statusProbeInFlight = false;
        if (response?.status === 404 || response?.status === 410) {
          terminateForRoomUnavailable();
          return;
        }
        if (!activityDeliveryDelayedRef.current) {
          onError("Соединение с realtime временно потеряно. Пытаемся восстановить связь...");
        }
        scheduleReconnect();
      })();
    };

    function connectSse() {
      if (isTerminal() || statusProbeInFlight) return;

      eventTokenRef.current = null;
      const params = buildParams();
      const source = new EventSource(`${API_BASE_URL}/realtime/rooms/${inviteCode}/stream?${params.toString()}`);
      const lease = ++streamLease;
      sseRef.current = source;

      source.onopen = () => {
        if (isTerminal() || lease !== streamLease || sseRef.current !== source) {
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
        if (activityDeliveryDelayedRef.current) {
          presentActivityRecordingDelayed();
        } else {
          onError("");
        }
        publishCurrentPresence({ force: true });
        requestStateSync({ expectHydration: true });
      };

      source.onmessage = (event) => {
        if (isTerminal() || lease !== streamLease || sseRef.current !== source) return;
        handleIncomingMessage(event.data, lease);
      };

      source.onerror = () => {
        if (isTerminal() || lease !== streamLease || sseRef.current !== source) {
          source.close();
          return;
        }
        setConnected(false);
        const readyState = source.readyState;
        sseRef.current = null;
        source.close();
        invalidateTransportLease();
        const failedLease = streamLease;
        if (!sseErrorNotified) {
          sseErrorNotified = true;
          emitMetric(
            "prod_realtime_connection_lost",
            { ready_state: readyState },
            { minIntervalMs: 2000 }
          );
          if (!activityDeliveryDelayedRef.current) {
            onError("Соединение с realtime временно потеряно. Пытаемся восстановить связь...");
          }
        }
        probeStreamStatus(failedLease);
      };
    }

    const handleIncomingMessage = (raw: string, lease: number) => {
      if (isTerminal() || lease !== streamLease) return;
      try {
        const message = JSON.parse(raw) as WsMessage;
        if (message.type === "state_sync") {
          const payload = message.payload as RealtimeState;
          eventTokenRef.current = payload.eventToken?.trim() || null;
          activityCaptureConfirmedRef.current =
            Boolean(eventTokenRef.current);
          setAccessDenied(false);
          if (activityDeliveryDelayedRef.current) {
            presentActivityRecordingDelayed();
          }
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
            discardObsoleteRecoveryMutations(payload);
          }
          if (eventTokenRef.current) {
            tryDrainQueueRef.current?.();
            tryDrainActivityRef.current?.();
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
        if (message.type === "manager_workspace_sync") {
          const payload = message.payload as Partial<ManagerWorkspaceRealtimeState>;
          if (
            typeof payload?.stepIndex === "number" &&
            typeof payload.language === "string" &&
            typeof payload.code === "string" &&
            typeof payload.briefingMarkdown === "string"
          ) {
            onManagerWorkspaceSync?.({
              stepIndex: payload.stepIndex,
              title: typeof payload.title === "string" ? payload.title : "",
              language: payload.language,
              code: payload.code,
              briefingMarkdown: payload.briefingMarkdown,
              revision:
                typeof payload.revision === "number" && Number.isFinite(payload.revision)
                  ? Math.max(0, Math.floor(payload.revision))
                  : 0,
              yjsDocumentBase64:
                typeof payload.yjsDocumentBase64 === "string"
                  ? payload.yjsDocumentBase64
                  : null,
              yjsSequence:
                typeof payload.yjsSequence === "number" && Number.isFinite(payload.yjsSequence)
                  ? Math.max(0, Math.floor(payload.yjsSequence))
                  : 0,
              recovery: payload.recovery === true,
              focusMode: payload.focusMode === true,
            });
          }
          return;
        }
        if (message.type === "manager_workspace_yjs_update") {
          const payload = message.payload as {
            stepIndex?: number;
            sessionId?: string;
            yjsUpdate?: string;
            yjsSequence?: number | null;
          };
          if (
            typeof payload?.stepIndex === "number" &&
            typeof payload.sessionId === "string" &&
            typeof payload.yjsUpdate === "string"
          ) {
            onManagerWorkspaceYjsUpdate?.({
              stepIndex: payload.stepIndex,
              sessionId: payload.sessionId,
              yjsUpdate: payload.yjsUpdate,
              yjsSequence: typeof payload.yjsSequence === "number" ? payload.yjsSequence : null,
            });
          }
          return;
        }
        if (message.type === "manager_workspace_awareness_update") {
          const payload = message.payload as {
            stepIndex?: number;
            sessionId?: string;
            userId?: string | null;
            participantId?: string | null;
            awarenessUpdate?: string;
          };
          if (
            typeof payload?.stepIndex === "number" &&
            typeof payload.sessionId === "string" &&
            typeof payload.awarenessUpdate === "string"
          ) {
            onManagerWorkspaceAwarenessUpdate?.({
              stepIndex: payload.stepIndex,
              sessionId: payload.sessionId,
              userId: payload.userId ?? null,
              participantId: payload.participantId ?? null,
              awarenessUpdate: payload.awarenessUpdate,
            });
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
      abortStatusProbe();

      const sse = sseRef.current;
      sseRef.current = null;
      sse?.close();
      if (reconnectTimerId != null) {
        window.clearTimeout(reconnectTimerId);
      }
      reconnectTimerId = null;
      reconnectScheduled = false;
      abortInFlightRequest();
      abortActivityInFlightRequest();
      clearActivityRetryTimer();
      dropPendingQueue();
      dropPendingActivity();
      queueDrainInProgressRef.current = false;
      inFlightControllerRef.current = null;
      inFlightMessageRef.current = null;
      activityDrainInProgressRef.current = null;
      activityInFlightControllerRef.current = null;
      eventTokenRef.current = null;
      activityCaptureConfirmedRef.current = false;
      lastPresenceRef.current = null;
      terminalAccessFailureRef.current = false;
      terminateRoomUnavailableRef.current = () => {};
      tryDrainQueueRef.current = null;
      tryDrainActivityRef.current = null;
      queueActivityRef.current = null;

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
    onManagerWorkspaceAwarenessUpdate,
    onManagerWorkspaceSync,
    onManagerWorkspaceYjsUpdate,
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
    if (terminalAccessFailureRef.current || terminalRoomUnavailableRef.current) return;
    const cursorSequence = cursorSequenceRef.current + 1;
    cursorSequenceRef.current = cursorSequence;
    persistCursorSequence(inviteCode, cursorSequence);
    // Cursor position is presence data, not code-sync critical.
    // Fire-and-forget so cursor events never block Yjs updates in the main queue.
    const token = eventTokenRef.current;
    if (!token) return;
    void fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        eventToken: token,
        clientEventSequence: null,
        type: "cursor_update",
        lineNumber: payload.lineNumber,
        column: payload.column,
        cursorSequence,
        selectionStartLineNumber: payload.selectionStartLineNumber,
        selectionStartColumn: payload.selectionStartColumn,
        selectionEndLineNumber: payload.selectionEndLineNumber,
        selectionEndColumn: payload.selectionEndColumn,
      }),
    }).then((response) => {
      if (response.status === 410) terminateRoomUnavailableRef.current();
    }).catch(() => {});
  };

  const sendAwarenessUpdate = (awarenessUpdate: string) => {
    if (terminalAccessFailureRef.current || terminalRoomUnavailableRef.current) return;
    const trimmed = awarenessUpdate.trim();
    if (!trimmed) return;
    // Yjs awareness (presence/selection) is not code-sync critical.
    // Fire-and-forget so awareness floods never block Yjs updates in the main queue.
    const token = eventTokenRef.current;
    if (!token) return;
    void fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        eventToken: token,
        clientEventSequence: null,
        type: "awareness_update",
        awarenessUpdate: trimmed,
      }),
    }).then((response) => {
      if (response.status === 410) terminateRoomUnavailableRef.current();
    }).catch(() => {});
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

  const openManagerWorkspace = (stepIndex: number) => {
    send({ type: "manager_workspace_open", stepIndex });
  };

  const closeManagerWorkspace = (stepIndex: number) => {
    send({ type: "manager_workspace_close", stepIndex });
  };

  const sendManagerWorkspaceYjsUpdate = (
    stepIndex: number,
    yjsUpdate: string,
    code?: string | null,
    yjsDocumentBase64?: string | null,
    baseServerYjsSequence?: number | null,
  ) => {
    send({
      type: "manager_workspace_yjs_update",
      stepIndex,
      yjsUpdate: yjsUpdate.trim(),
      code: code ?? null,
      yjsDocumentBase64: yjsDocumentBase64?.trim() || null,
      baseServerYjsSequence:
        typeof baseServerYjsSequence === "number" && Number.isFinite(baseServerYjsSequence)
          ? Math.max(0, Math.floor(baseServerYjsSequence))
          : null,
      operationId: `manager-yjs-op-${crypto.randomUUID()}`,
    });
  };

  const sendManagerWorkspaceBriefingUpdate = (
    stepIndex: number,
    briefingMarkdown: string,
    revision: number,
  ) => {
    send({ type: "manager_workspace_briefing_update", stepIndex, briefingMarkdown, revision });
  };

  const sendManagerWorkspaceLanguageUpdate = (
    stepIndex: number,
    language: string,
    revision: number,
  ) => {
    send({ type: "manager_workspace_language_update", stepIndex, language, revision });
  };

  const sendManagerWorkspaceFocusModeUpdate = (
    stepIndex: number,
    focusMode: boolean,
    revision: number,
  ) => {
    send({ type: "manager_workspace_focus_mode_update", stepIndex, focusMode, revision });
  };

  const sendManagerWorkspaceAwarenessUpdate = (stepIndex: number, awarenessUpdate: string) => {
    if (terminalAccessFailureRef.current || terminalRoomUnavailableRef.current) return;
    const trimmed = awarenessUpdate.trim();
    if (!trimmed) return;
    const token = eventTokenRef.current;
    if (!token) return;
    void fetch(`${API_BASE_URL}/realtime/rooms/${inviteCode}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        eventToken: token,
        clientEventSequence: null,
        type: "manager_workspace_awareness_update",
        stepIndex,
        awarenessUpdate: trimmed,
      }),
    }).then((response) => {
      if (response.status === 410) terminateRoomUnavailableRef.current();
    }).catch(() => {});
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
    if (
      terminalAccessFailureRef.current ||
      terminalRoomUnavailableRef.current
    ) {
      return;
    }
    const eventKind = payload.eventKind ?? "keydown";
    // Every observed key, paste, focus, or visibility source action enters the
    // lossless activity FIFO without a source-event throttle or coalescing.
    // Activity has a separate one-in-flight FIFO, so it cannot delay Yjs while
    // still retaining every captured source action until acknowledgement.
    queueActivityRef.current?.({
      type: "key_press",
      sourceEventId: crypto.randomUUID(),
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
    accessDenied,
    roomUnavailable,
    terminateRoomUnavailable,
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
    openManagerWorkspace,
    closeManagerWorkspace,
    sendManagerWorkspaceYjsUpdate,
    sendManagerWorkspaceBriefingUpdate,
    sendManagerWorkspaceLanguageUpdate,
    sendManagerWorkspaceFocusModeUpdate,
    sendManagerWorkspaceAwarenessUpdate,
    sendKeyPress
  };
}
