import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Group, Menu, Modal, Select, Stack, Text, TextInput, Textarea, ThemeIcon } from "@mantine/core";
import { IconCode, IconGripVertical, IconHome2, IconLayoutDashboard, IconUsers } from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { yCollab } from "y-codemirror.next";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching, foldGutter, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { useAppSelector } from "../app/hooks";
import { markdownToHtml } from "../components/markdown";
import { useGetRoomQuery } from "../services/api";
import { useRoomSocket } from "../features/room/useRoomSocket";
import styles from "./RoomPage.module.css";

const LANGUAGES = [
  { value: "nodejs", label: "Node JS" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" }
];

type Participant = {
  sessionId: string;
  displayName: string;
  userId?: string | null;
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
  isAuthenticated?: boolean;
  canBeGrantedInterviewerAccess?: boolean;
};

type CursorInfo = {
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  cursorSequence?: number | null;
  lastSeenAtEpochMs?: number | null;
  lineNumber: number;
  column: number;
  selectionStartLineNumber?: number | null;
  selectionStartColumn?: number | null;
  selectionEndLineNumber?: number | null;
  selectionEndColumn?: number | null;
};

type CandidateKeyInfo = {
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
  yjsDocumentBase64?: string | null;
  lastYjsSequence?: number;
  currentStep: number;
  notes: string;
  notesMessages?: NoteMessage[];
  briefingMarkdown?: string;
  taskScores: Record<string, number | null>;
  participants: Participant[];
  isOwner: boolean;
  role: "owner" | "interviewer" | "candidate";
  canManageRoom: boolean;
  canGrantAccess?: boolean;
  notesLockedBySessionId: string | null;
  notesLockedByDisplayName: string | null;
  notesLockedUntilEpochMs: number | null;
  cursors: CursorInfo[];
  lastCandidateKey: CandidateKeyInfo | null;
  candidateKeyHistory: CandidateKeyInfo[];
};

type NoteMessage = {
  id: string;
  sessionId: string;
  displayName: string;
  role: "owner" | "interviewer" | "candidate";
  text: string;
  timestampEpochMs: number;
};

type PendingNoteMessage = NoteMessage & {
  pending: true;
};

type MarkdownToolId = "bold" | "italic" | "code" | "link" | "h1" | "h2" | "ul" | "ol" | "quote";

const MIN_OWNER_PANEL_WIDTH = 220;
const MAX_OWNER_PANEL_WIDTH = 420;
const MIN_BRIEFING_HEIGHT = 120;
const MAX_BRIEFING_HEIGHT = 420;
const LOG_HISTORY_LIMIT = 50;
const NODEJS_LANGUAGE_ALIASES = new Set(["javascript", "typescript", "nodejs"]);
const REMOTE_SELECTION_HIGHLIGHT_ENABLED = true;
const REMOTE_CARET_HIGHLIGHT_ENABLED = true;
const REMOTE_CURSOR_RENDER_DEBOUNCE_MS = 80;
const HARD_MODEL_RECONCILE_DEBOUNCE_MS = 1200;
const LOCAL_TYPING_GUARD_MS = 420;
const CURSOR_UPDATE_THROTTLE_MS = 130;
const REMOTE_APPLY_CURSOR_GUARD_MS = 650;
const KEYBOARD_CARET_EMIT_WINDOW_MS = 180;
const REMOTE_CARET_IDLE_SHOW_DELAY_MS = 500;
const REMOTE_CURSOR_RENDER_TICK_MS = 120;
const CURSOR_DEBUG_QUERY_PARAM = "cursorDebug";
const CURSOR_DEBUG_STORAGE_KEY = "room_cursor_debug";
const ROOM_SYNC_LOG_QUERY_PARAM = "syncLog";
const ROOM_SYNC_LOG_STORAGE_KEY = "room_sync_log";

/** Off: ?syncLog=0 or localStorage room_sync_log = "0" */
function isRoomSyncLogEnabled(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get(ROOM_SYNC_LOG_QUERY_PARAM) === "0") return false;
    if (params.get(ROOM_SYNC_LOG_QUERY_PARAM) === "1") return true;
    return window.localStorage.getItem(ROOM_SYNC_LOG_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function roomSyncLog(event: string, payload?: Record<string, unknown>) {
  if (!isRoomSyncLogEnabled()) return;
  const ts = new Date().toISOString();
  if (payload && Object.keys(payload).length > 0) {
    console.info(`[room-sync][${ts}] ${event}`, payload);
  } else {
    console.info(`[room-sync][${ts}] ${event}`);
  }
}

/** Off: ?cursorDebug=0 or localStorage room_cursor_debug = "0" */
function isCursorDebugEnabled(): boolean {
  try {
    if (typeof window === "undefined") return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get(CURSOR_DEBUG_QUERY_PARAM) === "0") return false;
    if (params.get(CURSOR_DEBUG_QUERY_PARAM) === "1") return true;
    return window.localStorage.getItem(CURSOR_DEBUG_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function debugCursorLog(event: string, payload: Record<string, unknown>) {
  if (!isCursorDebugEnabled()) return;
  const ts = new Date().toISOString();
  // Keep logs structured so we can diff event flow between typing tab and observer tab.
  console.debug(`[cursor-debug][${ts}] ${event}`, payload);
}

function normalizeRoomLanguage(language: string | null | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized) return "nodejs";
  if (NODEJS_LANGUAGE_ALIASES.has(normalized)) {
    return "nodejs";
  }
  return normalized;
}

function toEditorLanguage(language: string | null | undefined): string {
  const normalized = (language ?? "").trim().toLowerCase();
  if (!normalized || NODEJS_LANGUAGE_ALIASES.has(normalized)) {
    return "javascript";
  }
  return normalizeRoomLanguage(normalized);
}

function normalizeKeyCodeLabel(code: string): string {
  const normalizedCode = code.trim();
  if (!normalizedCode) return "";
  if (normalizedCode.startsWith("Key")) {
    return normalizedCode.slice(3);
  }
  if (normalizedCode.startsWith("Digit")) {
    return normalizedCode.slice(5);
  }
  if (normalizedCode === "Space") {
    return "Space";
  }
  if (normalizedCode.startsWith("Numpad")) {
    return normalizedCode.replace("Numpad", "Num");
  }
  return normalizedCode.replace(/(Left|Right)$/g, "");
}

function normalizeKeyLabel(key: string, keyCode: string): string {
  const normalized = key.trim();
  if (!normalized) {
    return normalizeKeyCodeLabel(keyCode) || "Unknown";
  }

  const aliases: Record<string, string> = {
    Control: "Ctrl",
    Meta: "Cmd",
    Command: "Cmd",
    OS: "Cmd",
    Escape: "Esc",
    " ": "Space"
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  if (normalized.startsWith("Arrow")) {
    return normalized.slice(5);
  }
  return normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.trim();
  if (!normalized) return new Uint8Array(0);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function normalizeTaskScores(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object") return {};
  const normalized: Record<string, number | null> = {};
  Object.entries(value as Record<string, unknown>).forEach(([stepKey, scoreValue]) => {
    const stepIndex = Number.parseInt(stepKey, 10);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) return;
    if (typeof scoreValue === "number" && scoreValue >= 1 && scoreValue <= 5) {
      normalized[String(stepIndex)] = scoreValue;
      return;
    }
    normalized[String(stepIndex)] = null;
  });
  return normalized;
}

function taskScoresFromTasks(tasks: Array<{ stepIndex: number; score?: number | null }>): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  tasks.forEach((task) => {
    const score = task.score;
    result[String(task.stepIndex)] = typeof score === "number" && score >= 1 && score <= 5 ? score : null;
  });
  return result;
}

function normalizeNoteMessage(value: unknown): NoteMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NoteMessage> & { text?: unknown; timestampEpochMs?: unknown };
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : "";
  const sessionId = typeof candidate.sessionId === "string" && candidate.sessionId.trim() ? candidate.sessionId.trim() : "";
  const displayName = typeof candidate.displayName === "string" && candidate.displayName.trim() ? candidate.displayName.trim() : "";
  const role = candidate.role === "owner" || candidate.role === "interviewer" || candidate.role === "candidate" ? candidate.role : null;
  const text = typeof candidate.text === "string" ? candidate.text : "";
  const timestampEpochMs = typeof candidate.timestampEpochMs === "number" && Number.isFinite(candidate.timestampEpochMs)
    ? Math.max(0, Math.floor(candidate.timestampEpochMs))
    : null;

  if (!id || !sessionId || !displayName || !role || timestampEpochMs == null) {
    return null;
  }

  return {
    id,
    sessionId,
    displayName,
    role,
    text,
    timestampEpochMs
  };
}

function parseNotesThread(rawNotes: string | null | undefined): NoteMessage[] {
  const raw = rawNotes?.trim() ?? "";
  if (!raw) return [];

  const legacyMessage = {
    id: `legacy-${hashString(raw)}`,
    sessionId: "legacy-notes",
    displayName: "Старые заметки",
    role: "interviewer" as const,
    text: raw,
    timestampEpochMs: 0
  };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeNoteMessage).filter((item): item is NoteMessage => Boolean(item));
    }
    if (parsed && typeof parsed === "object") {
      const messages = (parsed as { messages?: unknown }).messages;
      if (Array.isArray(messages)) {
        return messages.map(normalizeNoteMessage).filter((item): item is NoteMessage => Boolean(item));
      }
    }
  } catch {
    return [legacyMessage];
  }

  return [legacyMessage];
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function formatNoteTimestamp(timestampEpochMs: number): string {
  if (!timestampEpochMs) return "—";
  return new Date(timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getParticipantRoleMeta(role: Participant["role"] | NoteMessage["role"]) {
  if (role === "owner") {
    return {
      label: "Владелец",
      color: "#ffaa4d"
    };
  }
  if (role === "interviewer") {
    return {
      label: "Интервьюер",
      color: "#5fc3a0"
    };
  }
  return {
    label: "Кандидат",
    color: "#6c9fff"
  };
}

function getParticipantPresenceLabel(status: Participant["presenceStatus"]) {
  return status === "active" ? "В фокусе" : "Вне фокуса";
}

function createDeterministicBootstrapUpdate(code: string): Uint8Array {
  const bootstrapDoc = new Y.Doc();
  // Use a fixed bootstrap client id so every participant starts from the same CRDT history.
  (bootstrapDoc as { clientID: number }).clientID = 1;
  const bootstrapText = bootstrapDoc.getText("room-code");
  if (code) {
    bootstrapText.insert(0, code);
  }
  return Y.encodeStateAsUpdate(bootstrapDoc);
}

function guestNameKey(inviteCode: string) {
  return `guest_display_name_${inviteCode}`;
}

function readStoredDisplayName(inviteCode: string, options: { includeGlobalFallback?: boolean } = {}) {
  const roomScoped = (localStorage.getItem(guestNameKey(inviteCode)) ?? "").trim();
  if (roomScoped) return roomScoped;
  if (options.includeGlobalFallback === false) return "";
  return (localStorage.getItem("display_name") ?? "").trim();
}

export function RoomPage() {
  const { inviteCode = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAppSelector((store) => store.auth);
  const authToken = auth.token;
  const authUser = auth.user;

  const ownerToken = localStorage.getItem(`owner_token_${inviteCode}`);

  const { data: room, isLoading } = useGetRoomQuery({
    inviteCode,
    ownerToken: ownerToken ?? undefined
  });

  const initialStoredName = readStoredDisplayName(inviteCode, {
    includeGlobalFallback: true
  });

  const [state, setState] = useState<RealtimeState | null>(null);
  const stateRef = useRef<RealtimeState | null>(null);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState(() => initialStoredName);
  const [draftName, setDraftName] = useState(() => initialStoredName);
  const [nameModalOpened, setNameModalOpened] = useState(() => !initialStoredName);
  const [noteComposer, setNoteComposer] = useState("");
  const [pendingNotes, setPendingNotes] = useState<PendingNoteMessage[]>([]);
  const [briefingDraft, setBriefingDraft] = useState("");
  const [briefingDirty, setBriefingDirty] = useState(false);
  const [resyncSignal, setResyncSignal] = useState(0);
  const [awaitingRecoverySync, setAwaitingRecoverySync] = useState(false);
  const awaitingRecoverySyncRef = useRef(false);
  const editorValueRef = useRef("");
  const briefingDebounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = readStoredDisplayName(inviteCode, {
      includeGlobalFallback: true
    });
    const authNickname = authUser?.nickname?.trim() || "";

    const resolved = authToken ? authNickname || stored || "Участник" : stored;
    const shouldAskName = !resolved;

    if (resolved) {
      localStorage.setItem("display_name", resolved);
      localStorage.setItem(guestNameKey(inviteCode), resolved);
    }

    setDisplayName(resolved);
    setDraftName(resolved);
    setNameModalOpened(shouldAskName);
    setNoteComposer("");
    setPendingNotes([]);
  }, [authToken, authUser?.nickname, inviteCode]);

  const merged = useMemo<RealtimeState | null>(() => {
    if (state) return state;
    if (!room) return null;
    return {
      inviteCode: room.inviteCode,
      language: normalizeRoomLanguage(room.language),
      code: room.code,
      lastCodeUpdatedBySessionId: null,
      yjsDocumentBase64: null,
      lastYjsSequence: 0,
      currentStep: room.currentStep,
      notes: room.notes ?? "",
      notesMessages: (room.notesMessages ?? [])
        .map(normalizeNoteMessage)
        .filter((item): item is NoteMessage => Boolean(item)),
      briefingMarkdown: room.briefingMarkdown ?? "",
      taskScores: taskScoresFromTasks(room.tasks ?? []),
      participants: [] as Participant[],
      isOwner: Boolean(room.isOwner),
      role: (room.role === "owner" || room.role === "interviewer" ? room.role : "candidate") as "owner" | "interviewer" | "candidate",
      canManageRoom: Boolean(room.canManageRoom),
      canGrantAccess: Boolean(room.canGrantAccess),
      notesLockedBySessionId: null,
      notesLockedByDisplayName: null,
      notesLockedUntilEpochMs: null,
      cursors: [],
      lastCandidateKey: null,
      candidateKeyHistory: []
    };
  }, [room, state]);

  const mergedNotes = merged?.notes ?? "";
  const mergedBriefingMarkdown = merged?.briefingMarkdown ?? "";
  const canManageRoom = merged?.canManageRoom ?? false;
  const notesMessages = useMemo(() => {
    const direct = merged?.notesMessages;
    if (Array.isArray(direct) && direct.length > 0) {
      return direct.map(normalizeNoteMessage).filter((item): item is NoteMessage => Boolean(item));
    }
    return parseNotesThread(mergedNotes);
  }, [merged?.notesMessages, mergedNotes]);

  useEffect(() => {
    if (!briefingDirty) {
      setBriefingDraft(mergedBriefingMarkdown);
    }
  }, [briefingDirty, mergedBriefingMarkdown]);
  const visibleNotes = useMemo(() => {
    const serverIds = new Set(notesMessages.map((message) => message.id));
    const next = [...notesMessages, ...pendingNotes.filter((message) => !serverIds.has(message.id))];
    return next.sort((a, b) => a.timestampEpochMs - b.timestampEpochMs || a.id.localeCompare(b.id));
  }, [notesMessages, pendingNotes]);
  const currentSyncKey = useMemo(() => {
    if (!merged) return `${inviteCode}:0:nodejs`;
    return `${merged.inviteCode}:${merged.currentStep}:${merged.language}`;
  }, [inviteCode, merged]);
  const syncKeyRef = useRef(currentSyncKey);
  const sessionIdRef = useRef<string>("");
  const yjsPendingUpdatesRef = useRef<Array<{ syncKey: string; update: string }>>([]);
  const yjsApplyUpdateRef = useRef<((yjsUpdate: string) => void) | null>(null);
  const awarenessApplyRef = useRef<((b64: string) => void) | null>(null);
  /** Awareness may arrive over SSE before RoomCodeEditor registers the applier (same race as yjs). */
  const awarenessPendingRef = useRef<string[]>([]);
  const recentLocalYjsUpdatesRef = useRef<Map<string, number>>(new Map());
  const recoverySyncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    syncKeyRef.current = currentSyncKey;
    yjsPendingUpdatesRef.current = [];
    awarenessPendingRef.current = [];
  }, [currentSyncKey]);

  useEffect(() => {
    return () => {
      if (recoverySyncTimeoutRef.current != null) {
        window.clearTimeout(recoverySyncTimeoutRef.current);
      }
      if (briefingDebounceTimerRef.current != null) {
        window.clearTimeout(briefingDebounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    awaitingRecoverySyncRef.current = awaitingRecoverySync;
  }, [awaitingRecoverySync]);

  const markRecoverySyncPending = useCallback(() => {
    setAwaitingRecoverySync(true);
    if (recoverySyncTimeoutRef.current != null) {
      window.clearTimeout(recoverySyncTimeoutRef.current);
    }
    recoverySyncTimeoutRef.current = window.setTimeout(() => {
      setAwaitingRecoverySync(false);
      recoverySyncTimeoutRef.current = null;
    }, 4000);
  }, []);

  const clearRecoverySyncPending = useCallback(() => {
    if (recoverySyncTimeoutRef.current != null) {
      window.clearTimeout(recoverySyncTimeoutRef.current);
      recoverySyncTimeoutRef.current = null;
    }
    setAwaitingRecoverySync(false);
  }, []);

  const onState = useCallback((incoming: RealtimeState) => {
    const previousState = stateRef.current;
    const previousCursorBySessionId = new Map((previousState?.cursors ?? []).map((cursor) => [cursor.sessionId, cursor]));
    const participants = (incoming.participants ?? []).map((participant) => ({
      ...participant,
      role: participant.role ?? "candidate"
    }));
    const cursorsFromSync = (incoming.cursors ?? []).map((cursor) => {
      const normalizedRole = cursor.role ?? "candidate";
      const nextCursorSequence = typeof cursor.cursorSequence === "number" ? cursor.cursorSequence : null;
      const previousCursor = previousCursorBySessionId.get(cursor.sessionId);
      const previousCursorSequence = typeof previousCursor?.cursorSequence === "number" ? previousCursor.cursorSequence : null;
      const shouldKeepPreviousCursor =
        !!previousCursor &&
        ((previousCursorSequence != null && nextCursorSequence != null && nextCursorSequence < previousCursorSequence) ||
          (previousCursorSequence != null && nextCursorSequence == null));
      if (shouldKeepPreviousCursor) {
        return previousCursor;
      }
      // Trailing state_sync after Yjs snapshot often repeats the same cursorSequence as the last
      // cursor_update but can carry stale line/column; prefer the live cursor we already merged.
      const sameSequencePreferLive =
        !!previousCursor &&
        previousCursorSequence != null &&
        nextCursorSequence != null &&
        nextCursorSequence === previousCursorSequence;
      if (sameSequencePreferLive) {
        return {
          ...previousCursor,
          displayName: cursor.displayName ?? previousCursor.displayName,
          role: normalizedRole
        };
      }
      return {
        ...cursor,
        role: normalizedRole,
        cursorSequence: nextCursorSequence,
        lastSeenAtEpochMs: previousCursor?.lastSeenAtEpochMs ?? null
      };
    });
    const mergedCursorIds = new Set(cursorsFromSync.map((c) => c.sessionId));
    const cursorsMissingFromSync = (previousState?.cursors ?? []).filter((c) => !mergedCursorIds.has(c.sessionId));
    const cursors = [...cursorsFromSync, ...cursorsMissingFromSync];
    const taskScores = normalizeTaskScores(incoming.taskScores);
    const nextState: RealtimeState = {
      ...incoming,
      language: normalizeRoomLanguage(incoming.language),
      participants,
      cursors,
      taskScores,
      lastCodeUpdatedBySessionId: incoming.lastCodeUpdatedBySessionId ?? null,
      yjsDocumentBase64: typeof incoming.yjsDocumentBase64 === "string" ? incoming.yjsDocumentBase64 : null,
      lastYjsSequence: typeof incoming.lastYjsSequence === "number" ? incoming.lastYjsSequence : 0,
      notesMessages: Array.isArray(incoming.notesMessages)
        ? incoming.notesMessages.map(normalizeNoteMessage).filter((item): item is NoteMessage => Boolean(item))
        : [],
      briefingMarkdown: typeof incoming.briefingMarkdown === "string" ? incoming.briefingMarkdown : "",
      canGrantAccess: Boolean(incoming.canGrantAccess),
      lastCandidateKey: incoming.lastCandidateKey ?? null,
      candidateKeyHistory: Array.isArray(incoming.candidateKeyHistory)
        ? incoming.candidateKeyHistory
        : incoming.lastCandidateKey
          ? [incoming.lastCandidateKey]
          : []
    };
    const previousSyncKey = previousState ? `${previousState.inviteCode}:${previousState.currentStep}:${previousState.language}` : null;
    const nextSyncKey = `${nextState.inviteCode}:${nextState.currentStep}:${nextState.language}`;
    const syncContextChanged = previousSyncKey !== null && previousSyncKey !== nextSyncKey;
    const shouldForceHydrateFromState = awaitingRecoverySyncRef.current || syncContextChanged;
    if (
      !previousState ||
      previousState.lastYjsSequence !== nextState.lastYjsSequence ||
      previousState.code !== nextState.code ||
      previousState.yjsDocumentBase64 !== nextState.yjsDocumentBase64
    ) {
      roomSyncLog("state_sync", {
        codeLen: nextState.code?.length ?? 0,
        lastYjsSequence: nextState.lastYjsSequence,
        yjsDocLen: nextState.yjsDocumentBase64?.length ?? 0,
        syncKey: nextSyncKey,
        fromSession: nextState.lastCodeUpdatedBySessionId
      });
    }
    // Do not bump resync on mere code drift during live Yjs typing — server string can lag merged CRDT and would clobber peers.
    if (
      previousState &&
      previousState.code !== nextState.code &&
      nextState.lastCodeUpdatedBySessionId !== sessionIdRef.current &&
      shouldForceHydrateFromState
    ) {
      setResyncSignal((value) => value + 1);
    }
    clearRecoverySyncPending();
    stateRef.current = nextState;
    setState(nextState);
  }, [clearRecoverySyncPending]);

  const onEditorValueChange = useCallback((value: string) => {
    editorValueRef.current = value;
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  const onCursorUpdate = useCallback((incomingCursor: CursorInfo) => {
    debugCursorLog("socket:cursor_update:incoming", {
      sessionId: incomingCursor?.sessionId,
      lineNumber: incomingCursor?.lineNumber,
      column: incomingCursor?.column,
      selectionStartLineNumber: incomingCursor?.selectionStartLineNumber ?? null,
      selectionStartColumn: incomingCursor?.selectionStartColumn ?? null,
      selectionEndLineNumber: incomingCursor?.selectionEndLineNumber ?? null,
      selectionEndColumn: incomingCursor?.selectionEndColumn ?? null,
      cursorSequence: incomingCursor?.cursorSequence ?? null
    });
    setState((previous) => {
      if (!previous) return previous;
      if (!incomingCursor?.sessionId || incomingCursor.sessionId === sessionIdRef.current) {
        return previous;
      }

      const normalizedCursor: CursorInfo = {
        ...incomingCursor,
        role: incomingCursor.role ?? "candidate",
        cursorSequence: typeof incomingCursor.cursorSequence === "number" ? incomingCursor.cursorSequence : null,
        lastSeenAtEpochMs: Date.now()
      };
      const currentCursors = previous.cursors ?? [];
      const existingIndex = currentCursors.findIndex((cursor) => cursor.sessionId === normalizedCursor.sessionId);
      if (existingIndex < 0) {
        return { ...previous, cursors: [...currentCursors, normalizedCursor] };
      }

      const existing = currentCursors[existingIndex];
      const nextSequence = typeof normalizedCursor.cursorSequence === "number" ? normalizedCursor.cursorSequence : null;
      const previousSequence = typeof existing.cursorSequence === "number" ? existing.cursorSequence : null;
      const staleBySequence =
        (previousSequence != null && nextSequence != null && nextSequence <= previousSequence) ||
        (previousSequence != null && nextSequence == null);
      if (staleBySequence) {
        debugCursorLog("socket:cursor_update:dropped_stale", {
          sessionId: normalizedCursor.sessionId,
          nextSequence,
          previousSequence
        });
        return previous;
      }

      const unchanged =
        existing.displayName === normalizedCursor.displayName &&
        existing.role === normalizedCursor.role &&
        existing.cursorSequence === normalizedCursor.cursorSequence &&
        existing.lineNumber === normalizedCursor.lineNumber &&
        existing.column === normalizedCursor.column &&
        existing.selectionStartLineNumber === normalizedCursor.selectionStartLineNumber &&
        existing.selectionStartColumn === normalizedCursor.selectionStartColumn &&
        existing.selectionEndLineNumber === normalizedCursor.selectionEndLineNumber &&
        existing.selectionEndColumn === normalizedCursor.selectionEndColumn;
      if (unchanged) {
        debugCursorLog("socket:cursor_update:dropped_unchanged", {
          sessionId: normalizedCursor.sessionId,
          cursorSequence: normalizedCursor.cursorSequence ?? null
        });
        return previous;
      }

      const nextCursors = [...currentCursors];
      nextCursors[existingIndex] = normalizedCursor;
      return { ...previous, cursors: nextCursors };
    });
  }, []);

  const onCandidateKey = useCallback((incomingKey: CandidateKeyInfo) => {
    setState((previous) => {
      if (!previous || !incomingKey?.sessionId) {
        return previous;
      }
      if (!previous.canManageRoom) {
        return previous;
      }

      const timestampEpochMs = typeof incomingKey.timestampEpochMs === "number" ? incomingKey.timestampEpochMs : Date.now();
      const normalizedKey: CandidateKeyInfo = {
        ...incomingKey,
        timestampEpochMs
      };
      const dedupeToken = [
        normalizedKey.sessionId,
        normalizedKey.timestampEpochMs,
        normalizedKey.key,
        normalizedKey.keyCode,
        normalizedKey.ctrlKey ? "1" : "0",
        normalizedKey.altKey ? "1" : "0",
        normalizedKey.shiftKey ? "1" : "0",
        normalizedKey.metaKey ? "1" : "0"
      ].join(":");

      const hasDuplicate = (previous.candidateKeyHistory ?? []).some((entry) => {
        const entryToken = [
          entry.sessionId,
          entry.timestampEpochMs,
          entry.key,
          entry.keyCode,
          entry.ctrlKey ? "1" : "0",
          entry.altKey ? "1" : "0",
          entry.shiftKey ? "1" : "0",
          entry.metaKey ? "1" : "0"
        ].join(":");
        return entryToken === dedupeToken;
      });

      const currentHistory = previous.candidateKeyHistory ?? [];
      const nextHistory = hasDuplicate
        ? currentHistory
        : [normalizedKey, ...currentHistory].slice(0, LOG_HISTORY_LIMIT);
      const previousLastTimestamp = previous.lastCandidateKey?.timestampEpochMs ?? 0;
      const nextLastCandidateKey = timestampEpochMs >= previousLastTimestamp ? normalizedKey : previous.lastCandidateKey;

      if (hasDuplicate && nextLastCandidateKey === previous.lastCandidateKey) {
        return previous;
      }

      return {
        ...previous,
        lastCandidateKey: nextLastCandidateKey,
        candidateKeyHistory: nextHistory
      };
    });
  }, []);

  const onRecoveryStateSync = useCallback((lastYjsSequence: number) => {
    void lastYjsSequence;
    clearRecoverySyncPending();
    setResyncSignal((value) => value + 1);
  }, [clearRecoverySyncPending]);

  /** Peers: incremental Yjs relay. Server still owns DB + state_sync snapshots (recovery / tabs). */
  const onYjsUpdate = useCallback((payload: { sessionId: string; yjsUpdate: string; syncKey?: string | null; yjsSequence?: number | null }) => {
    const update = payload.yjsUpdate?.trim();
    if (!update) return;
    const incomingSyncKey = payload.syncKey?.trim() || syncKeyRef.current;
    if (incomingSyncKey !== syncKeyRef.current) {
      return;
    }
    roomSyncLog("sse:yjs_update_incremental", {
      fromSession: payload.sessionId,
      yjsSequence: payload.yjsSequence ?? null
    });
    if (yjsApplyUpdateRef.current) {
      yjsApplyUpdateRef.current(update);
      return;
    }
    yjsPendingUpdatesRef.current.push({ syncKey: incomingSyncKey, update });
  }, []);

  const onYjsBridgeReady = useCallback((applyUpdate: ((yjsUpdate: string) => void) | null) => {
    yjsApplyUpdateRef.current = applyUpdate;
    if (!applyUpdate) return;
    const targetSyncKey = syncKeyRef.current;
    const pending = yjsPendingUpdatesRef.current.splice(0, yjsPendingUpdatesRef.current.length);
    pending
      .filter((item) => item.syncKey === targetSyncKey)
      .forEach((item) => applyUpdate(item.update));
  }, []);

  const onAwarenessBridgeReady = useCallback((applyFn: ((b64: string) => void) | null) => {
    awarenessApplyRef.current = applyFn;
    if (!applyFn) return;
    const pending = awarenessPendingRef.current.splice(0, awarenessPendingRef.current.length);
    pending.forEach((b64) => applyFn(b64));
  }, []);

  const onAwarenessUpdateSocket = useCallback((payload: { sessionId: string; awarenessUpdate: string }) => {
    if (payload.sessionId === sessionIdRef.current) return;
    const b64 = payload.awarenessUpdate?.trim() ?? "";
    if (!b64) return;
    if (awarenessApplyRef.current) {
      awarenessApplyRef.current(b64);
      return;
    }
    awarenessPendingRef.current.push(b64);
    if (awarenessPendingRef.current.length > 200) {
      awarenessPendingRef.current.splice(0, awarenessPendingRef.current.length - 200);
    }
  }, []);

  const fallbackDisplayName = authUser?.nickname?.trim() || "Участник";
  const effectiveDisplayName = displayName.trim() || fallbackDisplayName;
  const canConnect = Boolean(inviteCode);
  const {
    connected,
    sessionId,
    sendLanguageUpdate,
    sendSetStep,
    sendTaskRatingUpdate,
    sendNoteMessage,
    sendBriefingUpdate,
    sendGrantInterviewerAccess,
    sendRevokeInterviewerAccess,
    sendAwarenessUpdate,
    sendYjsUpdate,
    sendKeyPress
  } = useRoomSocket({
    enabled: canConnect,
    inviteCode,
    authToken,
    displayName: effectiveDisplayName,
    ownerToken,
    onState,
    onError,
    onCursorUpdate,
    onCandidateKey,
    onYjsUpdate,
    onAwarenessUpdate: onAwarenessUpdateSocket,
    onRecoveryStateSync,
    onRequireRecoverySync: markRecoverySyncPending
  });
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (pendingNotes.length === 0) return;
    const serverIds = new Set(notesMessages.map((message) => message.id));
    if (serverIds.size === 0) return;
    setPendingNotes((current) => current.filter((message) => !serverIds.has(message.id)));
  }, [notesMessages, pendingNotes]);

  useEffect(() => {
    if (briefingDirty && briefingDraft === mergedBriefingMarkdown) {
      setBriefingDirty(false);
    }
  }, [briefingDirty, briefingDraft, mergedBriefingMarkdown]);

  const sendYjsUpdateTracked = useCallback(
    (yjsUpdate: string, syncKey?: string | null, codeSnapshot?: string | null, yjsDocumentBase64?: string | null) => {
    const update = yjsUpdate.trim();
    const docSnap = yjsDocumentBase64?.trim() ?? "";
    if (!update && !docSnap) return;
    const normalizedSyncKey = syncKey?.trim() ?? "";
    const now = Date.now();
    const dedupeKey = docSnap ? `${normalizedSyncKey}::snap::${docSnap.length}::${docSnap.slice(0, 120)}` : `${normalizedSyncKey}::${update}`;
    recentLocalYjsUpdatesRef.current.set(dedupeKey, now);
    recentLocalYjsUpdatesRef.current.forEach((timestamp, key) => {
      if (now - timestamp > 15_000) {
        recentLocalYjsUpdatesRef.current.delete(key);
      }
    });
    sendYjsUpdate(update, normalizedSyncKey || null, codeSnapshot ?? null, docSnap || null);
  },
  [sendYjsUpdate]
);

  const hasRealtimeState = Boolean(state);
  const participantsCount = state?.participants.length ?? 0;

  // Editing must not wait for SSE: readOnly blocked y-codemirror + Yjs until first state_sync.
  // `readOnly` blocks user input; merged Yjs updates still apply once the editor is mounted.
  const editorReady = Boolean(merged);

  const submitNoteMessage = useCallback(() => {
    if (!merged || !canManageRoom) return;
    const text = noteComposer.trim();
    if (!text) return;
    const timestampEpochMs = Date.now();
    const noteId = crypto.randomUUID();
    const optimisticMessage: PendingNoteMessage = {
      id: noteId,
      sessionId,
      displayName: effectiveDisplayName,
      role: merged.role,
      text,
      timestampEpochMs,
      pending: true
    };
    setPendingNotes((current) => [...current, optimisticMessage]);
    setNoteComposer("");
    sendNoteMessage(noteId, text, timestampEpochMs);
  }, [canManageRoom, effectiveDisplayName, merged, noteComposer, sendNoteMessage, sessionId]);

  const changeBriefingMarkdown = useCallback((value: string) => {
    setBriefingDraft(value);
    setBriefingDirty(true);
    if (!canManageRoom) return;
    if (briefingDebounceTimerRef.current != null) {
      window.clearTimeout(briefingDebounceTimerRef.current);
    }
    briefingDebounceTimerRef.current = window.setTimeout(() => {
      sendBriefingUpdate(value);
      briefingDebounceTimerRef.current = null;
    }, 160);
  }, [canManageRoom, sendBriefingUpdate]);

  const briefingSeededStepRef = useRef<string>("");

  useEffect(() => {
    if (!merged || !canManageRoom) return;
    if (briefingDirty) return;

    const step = room?.tasks.find((task) => task.stepIndex === merged.currentStep);
    const description = step?.description ?? "";
    if (!description.trim()) return;
    if (mergedBriefingMarkdown.trim()) return;

    const seedKey = `${merged.currentStep}:${normalizeRoomLanguage(merged.language)}`;
    if (briefingSeededStepRef.current === seedKey) return;
    briefingSeededStepRef.current = seedKey;
    changeBriefingMarkdown(description);
  }, [canManageRoom, changeBriefingMarkdown, briefingDirty, merged, mergedBriefingMarkdown, room?.tasks]);

  const toggleParticipantInterviewerRole = useCallback((participant: Participant) => {
    if (!merged?.canGrantAccess || participant.role === "owner") return;
    const targetUserId = participant.userId?.trim() ?? "";
    if (participant.role === "candidate") {
      sendGrantInterviewerAccess(participant.sessionId, targetUserId || undefined);
      return;
    }
    sendRevokeInterviewerAccess(participant.sessionId, targetUserId || undefined);
  }, [merged?.canGrantAccess, sendGrantInterviewerAccess, sendRevokeInterviewerAccess]);

  const submitCandidateName = () => {
    const normalized = draftName.trim();
    if (!normalized) return;
    localStorage.setItem("display_name", normalized);
    localStorage.setItem(guestNameKey(inviteCode), normalized);
    setDisplayName(normalized);
    setNameModalOpened(false);
  };

  const goToLoginAndReturn = () => {
    const next = `${location.pathname}${location.search}`;
    navigate(`/login?next=${encodeURIComponent(next)}`);
  };

  if (isLoading || !merged) {
    return (
      <Box className={styles.shell} p="xl">
        <Text>Загрузка комнаты...</Text>
      </Box>
    );
  }

  const step = room?.tasks.find((task) => task.stepIndex === merged.currentStep);
  const currentTaskRating = merged.taskScores[String(merged.currentStep)] ?? step?.score ?? null;
  const taskDescriptionMarkdown = step?.description ?? "";
  const stepStarterCode = step?.starterCode ?? "";
  const ownerBriefingValue = briefingDirty ? briefingDraft : (briefingDraft || taskDescriptionMarkdown);
  const candidateBriefingValue = mergedBriefingMarkdown || taskDescriptionMarkdown;

  return (
    <>
      <Modal
        opened={nameModalOpened}
        onClose={() => {}}
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
        title="Представьтесь перед входом в комнату"
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Это имя увидит собеседующий в списке участников.
          </Text>
          <TextInput
            label="Ваше имя"
            placeholder="Имя"
            value={draftName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitCandidateName();
            }}
            autoFocus
          />
          <Button onClick={submitCandidateName}>Войти в комнату</Button>
          {!authToken && (
            <Button variant="outline" color="gray" onClick={goToLoginAndReturn}>
              Войти через аккаунт (по желанию)
            </Button>
          )}
        </Stack>
      </Modal>

      <Box className={styles.shell}>
        <TopBar
          roomTitle={room?.title ?? "Комната"}
          authToken={authToken}
          connected={connected}
          participants={merged.participants}
          showParticipants={canManageRoom}
          showLanguageControl={canManageRoom}
          currentLanguage={normalizeRoomLanguage(merged.language)}
          onLanguageChange={(value) => value && sendLanguageUpdate(value)}
          canGrantAccess={Boolean(merged.canGrantAccess)}
          onToggleInterviewerRole={toggleParticipantInterviewerRole}
        />

        {canManageRoom ? (
          <OwnerLayout
            merged={merged}
            tasks={room?.tasks ?? []}
            stepTitle={step?.title ?? "-"}
            stepStarterCode={stepStarterCode}
            error={error}
            taskScores={merged.taskScores}
            currentTaskRating={currentTaskRating}
            notesMessages={visibleNotes}
            noteComposer={noteComposer}
            onNoteComposerChange={setNoteComposer}
            onSendNote={submitNoteMessage}
            briefingMarkdown={ownerBriefingValue}
            onBriefingChange={changeBriefingMarkdown}
            sessionId={sessionId}
            participantLabel={effectiveDisplayName}
            sendAwarenessUpdate={sendAwarenessUpdate}
            onAwarenessBridgeReady={onAwarenessBridgeReady}
            lastCandidateKey={merged.lastCandidateKey}
            candidateKeyHistory={merged.candidateKeyHistory ?? []}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onSelectStep={(stepIndex) => sendSetStep(stepIndex)}
            onYjsUpdate={(yjsUpdate, syncKey, codeSnapshot, yjsDoc) =>
              sendYjsUpdateTracked(yjsUpdate, syncKey, codeSnapshot, yjsDoc)
            }
            onYjsBridgeReady={onYjsBridgeReady}
            onEditorValueChange={onEditorValueChange}
            onKeyPress={(payload) => {
              if (merged.role === "candidate") {
                sendKeyPress(payload);
              }
            }}
            onTaskRatingChange={(rating) => sendTaskRatingUpdate(merged.currentStep, rating)}
          />
        ) : (
          <CandidateLayout
            merged={merged}
            stepTitle={step?.title ?? "-"}
            stepStarterCode={stepStarterCode}
            briefingMarkdown={candidateBriefingValue}
            sessionId={sessionId}
            participantLabel={effectiveDisplayName}
            sendAwarenessUpdate={sendAwarenessUpdate}
            onAwarenessBridgeReady={onAwarenessBridgeReady}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onYjsUpdate={(yjsUpdate, syncKey, codeSnapshot, yjsDoc) =>
              sendYjsUpdateTracked(yjsUpdate, syncKey, codeSnapshot, yjsDoc)
            }
            onYjsBridgeReady={onYjsBridgeReady}
            onEditorValueChange={onEditorValueChange}
            onKeyPress={(payload) => {
              if (merged.role === "candidate") {
                sendKeyPress(payload);
              }
            }}
            error={error}
          />
        )}
      </Box>
    </>
  );
}

function TopBar({
  roomTitle,
  authToken,
  connected,
  participants,
  showParticipants,
  showLanguageControl,
  currentLanguage,
  onLanguageChange,
  canGrantAccess,
  onToggleInterviewerRole
}: {
  roomTitle: string;
  authToken: string | null;
  connected: boolean;
  participants: Participant[];
  showParticipants: boolean;
  showLanguageControl: boolean;
  currentLanguage: string;
  onLanguageChange: (value: string | null) => void;
  canGrantAccess: boolean;
  onToggleInterviewerRole: (participant: Participant) => void;
}) {
  return (
    <Box className={styles.topBar}>
      <Box className={styles.topInner}>
        <Box className={styles.brand}>
          <ThemeIcon size={26} variant="light" color="gray">
            <IconCode size={14} />
          </ThemeIcon>
          <div className={styles.brandTitle}>{roomTitle}</div>
        </Box>

        {showParticipants ? (
          <Box className={styles.participantsHost}>
            <div className={styles.participantsInline} aria-label="Участники комнаты">
              {participants.map((participant) => {
                const roleMeta = getParticipantRoleMeta(participant.role);
                const presenceLabel = getParticipantPresenceLabel(participant.presenceStatus);
                const canOpenMenu = canGrantAccess && participant.role !== "owner" && (participant.canBeGrantedInterviewerAccess ?? true);
                const isInterviewer = participant.role === "interviewer";
                const menuActionLabel = isInterviewer ? "Снять роль интервьюера" : "Назначить интервьюером";
                const participantCard = (
                  <span className={styles.participantNameRow}>
                    <span className={styles.participantName}>{participant.displayName}</span>
                    {isInterviewer ? (
                      <span className={styles.participantInterviewerStar} aria-label="Интервьюер" title="Интервьюер">
                        *
                      </span>
                    ) : null}
                  </span>
                );
                const participantStyle = {
                  "--participant-role-color": roleMeta.color
                } as React.CSSProperties;

                if (!canOpenMenu) {
                  return (
                    <div
                      key={participant.sessionId}
                      className={styles.participantCard}
                      data-presence={participant.presenceStatus}
                      data-testid={`participant-badge-${participant.presenceStatus}`}
                      style={participantStyle}
                      title={presenceLabel}
                    >
                      {participantCard}
                    </div>
                  );
                }

                return (
                  <Menu key={participant.sessionId} withinPortal position="bottom" shadow="md" offset={8}>
                    <Menu.Target>
                      <button
                        type="button"
                        className={`${styles.participantCard} ${styles.participantCardButton}`}
                        data-presence={participant.presenceStatus}
                        data-testid={`participant-badge-${participant.presenceStatus}`}
                        style={participantStyle}
                        aria-label={`${participant.displayName}, ${presenceLabel}`}
                      >
                        {participantCard}
                      </button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => onToggleInterviewerRole(participant)}>
                        {menuActionLabel}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                );
              })}
            </div>
          </Box>
        ) : (
          <Box className={styles.participantsHost} />
        )}

        <div className={styles.topActions}>
          {showLanguageControl ? (
            <div className={styles.topLanguageControl}>
              <Select
                id="room-language-select"
                size="xs"
                data={LANGUAGES}
                value={normalizeRoomLanguage(currentLanguage)}
                onChange={(value) => onLanguageChange(value ? normalizeRoomLanguage(value) : null)}
                className={styles.topLanguageSelect}
                classNames={{ input: styles.topLanguageInput, dropdown: styles.topLanguageDropdown, option: styles.topLanguageOption }}
                aria-label="Язык комнаты"
                allowDeselect={false}
                comboboxProps={{ withinPortal: false }}
              />
            </div>
          ) : null}
          <div className={styles.topActionButtons}>
            <Badge color={connected ? "teal" : "gray"} variant="light">
              {connected ? "Подключено" : "Подключение"}
            </Badge>
            <Button
              component={Link}
              to={authToken ? "/dashboard/rooms" : "/login"}
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconLayoutDashboard size={14} />}
            >
              Кабинет
            </Button>
            <Button component={Link} to="/" size="xs" variant="outline" color="gray" leftSection={<IconHome2 size={14} />}>
              Главная
            </Button>
          </div>
        </div>
      </Box>
    </Box>
  );
}

function OwnerLayout({
  merged,
  tasks,
  stepTitle,
  stepStarterCode,
  error,
  taskScores,
  currentTaskRating,
  notesMessages,
  noteComposer,
  onNoteComposerChange,
  onSendNote,
  briefingMarkdown,
  onBriefingChange,
  sessionId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  lastCandidateKey,
  candidateKeyHistory,
  syncKey,
  resyncSignal,
  editorReady,
  onSelectStep,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress,
  onTaskRatingChange
}: {
  merged: RealtimeState;
  tasks: Array<{ stepIndex: number; title: string; language: string; score: number | null }>;
  stepTitle: string;
  stepStarterCode: string;
  error: string;
  taskScores: Record<string, number | null>;
  currentTaskRating: number | null;
  notesMessages: Array<NoteMessage | PendingNoteMessage>;
  noteComposer: string;
  onNoteComposerChange: (value: string) => void;
  onSendNote: () => void;
  briefingMarkdown: string;
  onBriefingChange: (value: string) => void;
  sessionId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  lastCandidateKey: CandidateKeyInfo | null;
  candidateKeyHistory: CandidateKeyInfo[];
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onSelectStep: (stepIndex: number) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string, codeSnapshot?: string | null, yjsDocumentBase64?: string | null) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
  onTaskRatingChange: (rating: number | null) => void;
}) {
  const [activeRailPanel, setActiveRailPanel] = useState<"tasks" | "roomTools" | null>("tasks");
  const [roomToolsTab, setRoomToolsTab] = useState<"notes" | "logs">("notes");
  const [leftPanelWidth, setLeftPanelWidth] = useState(288);
  const notesFeedRef = useRef<HTMLDivElement | null>(null);

  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startX: event.clientX,
      startWidth: leftPanelWidth
    };
    setIsDragging(true);
  }, [leftPanelWidth]);

  const toggleRailPanel = useCallback((panel: "tasks" | "roomTools") => {
    setActiveRailPanel((current) => (current === panel ? null : panel));
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;
      setLeftPanelWidth(clamp(dragState.startWidth + delta, MIN_OWNER_PANEL_WIDTH, MAX_OWNER_PANEL_WIDTH));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStateRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging]);

  useEffect(() => {
    if (activeRailPanel !== "roomTools" || roomToolsTab !== "notes") return;
    const host = notesFeedRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
  }, [activeRailPanel, notesMessages.length, roomToolsTab]);

  useEffect(() => {
    if (activeRailPanel === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveRailPanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRailPanel]);

  const showLeftPanel = activeRailPanel !== null;
  const candidateParticipants = merged.participants.filter((participant) => participant.role === "candidate");
  const candidateOutOfFocus = candidateParticipants.some((participant) => participant.presenceStatus === "away");
  const candidatePresenceState = candidateParticipants.length === 0 ? "offline" : candidateOutOfFocus ? "away" : "active";
  const candidatePresenceLabel = candidatePresenceState === "offline"
    ? "Не подключен"
    : candidatePresenceState === "away"
      ? "Вне фокуса"
      : "В фокусе";
  const recentCandidateKeyHistory = [...(candidateKeyHistory ?? [])]
    .sort((a, b) => b.timestampEpochMs - a.timestampEpochMs)
    .slice(0, LOG_HISTORY_LIMIT);
  if (recentCandidateKeyHistory.length === 0 && lastCandidateKey) {
    recentCandidateKeyHistory.push(lastCandidateKey);
  }

  return (
    <Box className={styles.ownerBody}>
      <nav className={styles.leftRail} aria-label="Панели владельца комнаты">
        <button
          type="button"
          className={`${styles.railButton} ${activeRailPanel === "tasks" ? styles.railButtonActive : ""}`}
          aria-label="Открыть панель задач"
          aria-pressed={activeRailPanel === "tasks"}
          aria-controls="owner-side-panel"
          onClick={() => toggleRailPanel("tasks")}
          title="Панель задач"
        >
          <IconLayoutDashboard size={16} />
        </button>
        <button
          type="button"
          className={`${styles.railButton} ${activeRailPanel === "roomTools" ? styles.railButtonActive : ""}`}
          aria-label="Открыть панель чата и логов"
          aria-pressed={activeRailPanel === "roomTools"}
          aria-controls="owner-side-panel"
          onClick={() => toggleRailPanel("roomTools")}
          title="Панель чата и статуса"
        >
          <IconUsers size={16} />
        </button>
      </nav>

      {showLeftPanel && (
        <>
          <Box
            id="owner-side-panel"
            className={styles.ownerSidePanel}
            style={{ width: clamp(leftPanelWidth, MIN_OWNER_PANEL_WIDTH, MAX_OWNER_PANEL_WIDTH) }}
            aria-label={activeRailPanel === "tasks" ? "Панель задач" : "Панель чата и логов"}
          >
            {activeRailPanel === "tasks" ? (
              <Box className={styles.sidebar}>
                <Text size="xs" c="#8b919b">
                  шаг {merged.currentStep + 1}/{Math.max(tasks.length, 1)}
                </Text>

                <Box className={styles.stepList}>
                  {tasks.map((task) => {
                    const taskRating = taskScores[String(task.stepIndex)] ?? task.score ?? null;
                    return (
                      <Button
                        key={task.stepIndex}
                        size="xs"
                        variant={task.stepIndex === merged.currentStep ? "filled" : "light"}
                        color={task.stepIndex === merged.currentStep ? "gray" : "dark"}
                        justify="space-between"
                        onClick={() => onSelectStep(task.stepIndex)}
                      >
                        {`${task.stepIndex + 1}. ${task.title}${taskRating ? ` · ★${taskRating}` : ""}`}
                      </Button>
                    );
                  })}
                </Box>

                <Text size="sm" c="#e1e6ef" fw={600}>
                  {stepTitle}
                </Text>

                <Box className={styles.taskRatingCard}>
                  <Select
                    className={styles.taskRating}
                    classNames={{ option: styles.taskRatingOption }}
                    label="Оценка шага"
                    placeholder="Нет оценки"
                    value={currentTaskRating ? String(currentTaskRating) : null}
                    onChange={(value) => onTaskRatingChange(value ? Number.parseInt(value, 10) : null)}
                    withCheckIcon={false}
                    clearable
                    data={[
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                      { value: "3", label: "3" },
                      { value: "4", label: "4" },
                      { value: "5", label: "5" }
                    ]}
                    styles={{
                      label: { color: "#9ba0a8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
                      input: { backgroundColor: "#11161f", borderColor: "#273242", color: "#d6dce6", fontSize: 12 },
                      dropdown: { backgroundColor: "#11161f", borderColor: "#273242" },
                      option: { color: "#d6dce6" }
                    }}
                  />
                </Box>
              </Box>
            ) : (
              <Box className={styles.outputPanel}>
                <div className={styles.panelTabs}>
                  <div className={styles.ownerPresenceBanner} aria-label="Кандидат">
                    <div className={styles.ownerPresenceCopy}>
                      <Text className={styles.ownerPresenceLabel}>Кандидат</Text>
                    </div>
                    <Badge className={styles.ownerPresenceBadge} variant="light" data-state={candidatePresenceState}>
                      {candidatePresenceLabel}
                    </Badge>
                  </div>
                  <div className={styles.panelTabsList} role="tablist" aria-label="Панель комнаты">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={roomToolsTab === "notes"}
                      className={`${styles.panelTab} ${roomToolsTab === "notes" ? styles.panelTabActive : ""}`}
                      onClick={() => setRoomToolsTab("notes")}
                    >
                      Чат
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={roomToolsTab === "logs"}
                      className={`${styles.panelTab} ${roomToolsTab === "logs" ? styles.panelTabActive : ""}`}
                      onClick={() => setRoomToolsTab("logs")}
                    >
                      Логи
                    </button>
                  </div>

                  {roomToolsTab === "notes" ? (
                    <div className={`${styles.panelTabPanel} ${styles.notesTabPanel}`} role="tabpanel" aria-label="Чат заметок">
                      <div className={styles.notesHeader}>
                        <div className={styles.notesHeaderCopy}>
                          <Text className={styles.panelSectionTitle}>Чат</Text>
                        </div>
                      </div>

                      <div className={styles.notesMessagesList} ref={notesFeedRef} role="log" aria-label="Сообщения заметок">
                        {notesMessages.length > 0 ? (
                          notesMessages.map((message) => {
                            const isOwnMessage = message.sessionId === sessionId;
                            return (
                              <article
                                key={message.id}
                                className={`${styles.noteBubble} ${isOwnMessage ? styles.noteBubbleOwn : ""}`}
                                data-pending={Boolean((message as PendingNoteMessage).pending)}
                              >
                                <header className={styles.noteBubbleHeader}>
                                  <div className={styles.noteBubbleAuthorWrap}>
                                    <span className={styles.noteBubbleAuthor}>{message.displayName}</span>
                                  </div>
                                  <time className={styles.noteBubbleTime}>{formatNoteTimestamp(message.timestampEpochMs)}</time>
                                </header>
                                <Text className={styles.noteBubbleText}>{message.text}</Text>
                              </article>
                            );
                          })
                        ) : (
                          <div className={styles.notesEmpty}>
                            <Text className={styles.notesEmptyTitle}>Пока пусто</Text>
                            <Text className={styles.notesEmptyText}>Здесь появятся сообщения интервьюеров.</Text>
                          </div>
                        )}
                      </div>

                      <div className={styles.notesComposer}>
                        <Textarea
                          value={noteComposer}
                          onChange={(event) => onNoteComposerChange(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || event.shiftKey) return;
                            event.preventDefault();
                            onSendNote();
                          }}
                          autosize
                          minRows={3}
                          maxRows={14}
                          data-testid="room-notes-input"
                          placeholder="Напишите сообщение для интервьюеров"
                          classNames={{ input: styles.notesComposerInput }}
                        />
                        <Group justify="flex-end" align="center" className={styles.notesComposerFooter}>
                          <Button
                            type="button"
                            size="xs"
                            onClick={onSendNote}
                            disabled={!noteComposer.trim()}
                            data-testid="room-notes-send"
                          >
                            Отправить
                          </Button>
                        </Group>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.panelTabPanel} role="tabpanel" aria-label="Логи">
                      <header className={styles.logsHeader}>
                        <div className={styles.logsTitleWrap}>
                          <Text component="h3" className={styles.logsTitle}>
                            Логи кандидата
                          </Text>
                          <span className={styles.logsCount}>{recentCandidateKeyHistory.length}</span>
                        </div>
                        <Text className={styles.logsCounter}>Лимит {LOG_HISTORY_LIMIT}</Text>
                      </header>

                      <div className={styles.logsList} role="log" aria-label="Логи кандидата">
                        {recentCandidateKeyHistory.length > 0 ? (
                          recentCandidateKeyHistory.map((event, index) => (
                            <div key={`${event.sessionId}-${event.timestampEpochMs}-${index}`} className={styles.logItem}>
                              <time className={styles.logTime}>{formatCandidateKeyHistoryTimestamp(event)}</time>
                              <p className={styles.logMessage}>
                                {event.displayName}: {formatCandidateKey(event)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className={styles.logsEmpty}>
                            <Text className={styles.logsEmptyTitle}>Пока пусто</Text>
                            <Text className={styles.logsEmptyText}>События клавиатуры появятся здесь.</Text>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Box>
            )}
          </Box>

          <div
            className={styles.resizeHandle}
            role="separator"
            aria-label="Изменить ширину левой панели"
            onMouseDown={startDrag}
          >
            <IconGripVertical size={14} />
          </div>
        </>
      )}

      <Box className={styles.workspace}>
        <Box className={styles.editorColumn}>
          <BriefingBoard
            mode="interviewer"
            value={briefingMarkdown}
            onChange={onBriefingChange}
          />
          <Box className={styles.editorPanel}>
            <div className={styles.editorWrap}>
              <RoomCodeEditor
                key={syncKey}
                height="100%"
                language={toEditorLanguage(merged.language)}
                value={merged.code || (merged.lastCodeUpdatedBySessionId ? "" : stepStarterCode)}
                serverYjsBase64={merged.yjsDocumentBase64 ?? null}
                serverYjsSequence={merged.lastYjsSequence ?? 0}
                resyncSignal={resyncSignal}
                syncKey={syncKey}
                readOnly={!editorReady}
                sessionId={sessionId}
                participantLabel={participantLabel}
                sendAwarenessUpdate={sendAwarenessUpdate}
                onAwarenessBridgeReady={onAwarenessBridgeReady}
                onYjsUpdate={onYjsUpdate}
                onYjsBridgeReady={onYjsBridgeReady}
                onEditorValueChange={onEditorValueChange}
                onKeyPress={onKeyPress}
              />
            </div>
          </Box>
          {error && <Text className={styles.error}>{error}</Text>}
        </Box>
      </Box>
    </Box>
  );
}

function CandidateLayout({
  merged,
  stepTitle,
  stepStarterCode,
  briefingMarkdown,
  sessionId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  syncKey,
  resyncSignal,
  editorReady,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress,
  error
}: {
  merged: RealtimeState;
  stepTitle: string;
  stepStarterCode: string;
  briefingMarkdown: string;
  sessionId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onYjsUpdate: (yjsUpdate: string, syncKey: string, codeSnapshot?: string | null, yjsDocumentBase64?: string | null) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
  error: string;
}) {
  return (
    <Box className={styles.candidateBody}>
      <Box className={styles.candidateMeta}>
        <Group justify="space-between" align="center">
          <Group>
            <ThemeIcon size={24} variant="light" color="gray">
              <IconUsers size={14} />
            </ThemeIcon>
            <Text size="sm" c="#d2d8e1">
              Текущий шаг: {stepTitle}
            </Text>
          </Group>
          <Badge variant="light" color="gray">
            Совместный режим
          </Badge>
        </Group>
      </Box>

      <BriefingBoard mode="candidate" value={briefingMarkdown} />

      <Box className={styles.candidatePanel}>
        <div className={styles.editorWrap}>
          <RoomCodeEditor
            key={syncKey}
            height="calc(100vh - 170px)"
            language={toEditorLanguage(merged.language)}
            value={merged.code || (merged.lastCodeUpdatedBySessionId ? "" : stepStarterCode)}
            serverYjsBase64={merged.yjsDocumentBase64 ?? null}
            serverYjsSequence={merged.lastYjsSequence ?? 0}
            resyncSignal={resyncSignal}
            syncKey={syncKey}
            readOnly={!editorReady}
            sessionId={sessionId}
            participantLabel={participantLabel}
            sendAwarenessUpdate={sendAwarenessUpdate}
            onAwarenessBridgeReady={onAwarenessBridgeReady}
            onYjsUpdate={onYjsUpdate}
            onYjsBridgeReady={onYjsBridgeReady}
            onEditorValueChange={onEditorValueChange}
            onKeyPress={onKeyPress}
          />
        </div>
      </Box>

      {error && <Text className={styles.error}>{error}</Text>}
    </Box>
  );
}

function BriefingBoard({
  mode,
  value,
  onChange
}: {
  mode: "interviewer" | "candidate";
  value: string;
  onChange?: (value: string) => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const html = useMemo(() => markdownToHtml(value), [value]);
  const emptyText =
    mode === "interviewer"
      ? "Напишите объяснение или подсказки для кандидата."
      : "Интервьюер еще не добавил пояснение.";

  const applyWrap = useCallback(
    (prefix: string, suffix: string, placeholder: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? 0;
      const selectionEnd = textarea?.selectionEnd ?? 0;
      const selected = value.slice(selectionStart, selectionEnd);
      const content = selected || placeholder;
      const next = `${value.slice(0, selectionStart)}${prefix}${content}${suffix}${value.slice(selectionEnd)}`;
      onChange(next);
      const rangeStart = selectionStart + prefix.length;
      const rangeEnd = rangeStart + content.length;
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(rangeStart, rangeEnd);
      });
    },
    [onChange, value]
  );

  const applyLinePrefix = useCallback(
    (prefix: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? 0;
      const selectionEnd = textarea?.selectionEnd ?? 0;
      const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
      const blockEndCandidate = value.indexOf("\n", selectionEnd);
      const blockEnd = blockEndCandidate < 0 ? value.length : blockEndCandidate;
      const original = value.slice(blockStart, blockEnd);
      const updated = original
        .split("\n")
        .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
        .join("\n");
      const next = `${value.slice(0, blockStart)}${updated}${value.slice(blockEnd)}`;
      onChange(next);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(blockStart, blockStart + updated.length);
      });
    },
    [onChange, value]
  );

  const applyMarkdownTool = useCallback(
    (tool: MarkdownToolId) => {
      if (tool === "bold") return applyWrap("**", "**", "текст");
      if (tool === "italic") return applyWrap("*", "*", "текст");
      if (tool === "code") return applyWrap("`", "`", "code");
      if (tool === "link") return applyWrap("[", "](https://)", "ссылка");
      if (tool === "h1") return applyLinePrefix("# ");
      if (tool === "h2") return applyLinePrefix("## ");
      if (tool === "ul") return applyLinePrefix("- ");
      if (tool === "ol") return applyLinePrefix("1. ");
      if (tool === "quote") return applyLinePrefix("> ");
    },
    [applyLinePrefix, applyWrap]
  );

  return (
    <Box className={styles.briefingPanel} data-mode={mode}>
      {mode === "interviewer" ? (
        <div className={styles.briefingSplit}>
          <div className={styles.briefingEditorPane}>
            <div className={styles.briefingToolbar}>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("bold")}>
                B
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("italic")}>
                I
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("code")}>
                {"</>"}
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("link")}>
                Link
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("h1")}>
                H1
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("h2")}>
                H2
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("ul")}>
                • List
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("ol")}>
                1. List
              </button>
              <button type="button" className={styles.briefingToolButton} onClick={() => applyMarkdownTool("quote")}>
                Quote
              </button>
            </div>
            <Textarea
              value={value}
              onChange={(event) => onChange?.(event.currentTarget.value)}
              autosize
              minRows={6}
              maxRows={24}
              placeholder="Например: # План\n- Что делаем\n- На что смотреть"
              data-testid="room-markdown-editor"
              classNames={{ input: styles.briefingEditorInput }}
              ref={editorRef}
            />
          </div>
          <div className={styles.briefingPreviewPane} data-testid="room-markdown-preview">
            {html ? (
              <div className={styles.briefingMarkdown} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <Text className={styles.briefingEmpty}>{emptyText}</Text>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.briefingPreviewPane} data-testid="room-markdown-preview">
          {html ? (
            <div className={styles.briefingMarkdown} dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <Text className={styles.briefingEmpty}>{emptyText}</Text>
          )}
        </div>
      )}
    </Box>
  );
}

function formatCandidateKey(event: CandidateKeyInfo): string {
  const keyLabel = normalizeKeyLabel(event.key || "", event.keyCode || "");
  const isCtrlKey = keyLabel === "Ctrl";
  const isAltKey = keyLabel === "Alt";
  const isShiftKey = keyLabel === "Shift";
  const isMetaKey = keyLabel === "Cmd" || keyLabel === "Meta";
  const modifiers: string[] = [];
  if (event.ctrlKey && !isCtrlKey) modifiers.push("Ctrl");
  if (event.altKey && !isAltKey) modifiers.push("Alt");
  if (event.shiftKey && !isShiftKey) modifiers.push("Shift");
  if (event.metaKey && !isMetaKey) modifiers.push("Cmd");

  const key = keyLabel || normalizeKeyCodeLabel(event.keyCode || "") || "Unknown";
  return [...modifiers, key].join("+");
}

function formatCandidateKeyHistoryTimestamp(event: CandidateKeyInfo): string {
  return new Date(event.timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function hashSessionId(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function awarenessUserColors(sessionId: string): { color: string; colorLight: string } {
  const hue = hashSessionId(sessionId) % 360;
  return {
    color: `hsl(${hue} 68% 58%)`,
    colorLight: `hsla(${hue} 68% 58% / 0.24)`
  };
}

/**
 * After a tab refresh, Yjs assigns a new clientID while the realtime sessionId stays the same.
 * Peers briefly keep both awareness entries → duplicate remote carets.
 *
 * Do not pick the winner by `clock` alone: the old tab's client keeps a large frozen clock while the new tab's
 * clock resets — we would keep the dead entry and drop live updates. Prefer `meta.lastUpdated` (refreshed on each
 * inbound awareness message for that clientId); the disconnected client stops receiving bumps.
 */
function dedupeRemoteAwarenessEntries(awareness: Awareness) {
  const localId = awareness.clientID;

  const clockOf = (clientId: number) => awareness.meta.get(clientId)?.clock ?? 0;
  const lastUpdatedOf = (clientId: number) => awareness.meta.get(clientId)?.lastUpdated ?? 0;

  const hasSessionIdInUser = (st: { user?: unknown } | undefined) => {
    const sid = (st?.user as { sessionId?: string } | undefined)?.sessionId;
    return typeof sid === "string" && sid.trim().length > 0;
  };

  const remoteWinsOver = (newId: number, oldId: number) => {
    const luN = lastUpdatedOf(newId);
    const luO = lastUpdatedOf(oldId);
    if (luN !== luO) {
      return luN > luO;
    }
    const stN = awareness.states.get(newId);
    const stO = awareness.states.get(oldId);
    const sidN = hasSessionIdInUser(stN);
    const sidO = hasSessionIdInUser(stO);
    if (sidN !== sidO) {
      return sidN;
    }
    const cN = clockOf(newId);
    const cO = clockOf(oldId);
    if (cN !== cO) {
      return cN > cO;
    }
    return newId > oldId;
  };

  const winnerByKey = new Map<string, number>();
  awareness.states.forEach((_state, clientId) => {
    if (clientId === localId) return;
    const st = awareness.states.get(clientId);
    const u = st?.user as { sessionId?: string; name?: string; color?: string } | undefined;
    if (!u) return;
    const key =
      typeof u.sessionId === "string" && u.sessionId.trim()
        ? `sid:${u.sessionId.trim()}`
        : `legacy:${String(u.name ?? "")}|${String(u.color ?? "")}`;
    const prev = winnerByKey.get(key);
    if (prev === undefined || remoteWinsOver(clientId, prev)) {
      winnerByKey.set(key, clientId);
    }
  });

  const toRemove = new Set<number>();
  awareness.states.forEach((_state, clientId) => {
    if (clientId === localId) return;
    const st = awareness.states.get(clientId);
    const u = st?.user as { sessionId?: string; name?: string; color?: string } | undefined;
    if (!u) return;
    const key =
      typeof u.sessionId === "string" && u.sessionId.trim()
        ? `sid:${u.sessionId.trim()}`
        : `legacy:${String(u.name ?? "")}|${String(u.color ?? "")}`;
    if (winnerByKey.get(key) !== clientId) {
      toRemove.add(clientId);
    }
  });

  // Drop pre-sessionId ghosts when the same participant already has sessionId in awareness.
  const hasSessionId = new Set<string>();
  awareness.states.forEach((st, id) => {
    if (id === localId) return;
    const sid = (st?.user as { sessionId?: string } | undefined)?.sessionId;
    if (typeof sid === "string" && sid.trim()) {
      hasSessionId.add(`${String((st?.user as { name?: string }).name ?? "")}|${String((st?.user as { color?: string }).color ?? "")}`);
    }
  });
  awareness.states.forEach((_state, clientId) => {
    if (clientId === localId) return;
    const st = awareness.states.get(clientId);
    const u = st?.user as { sessionId?: string; name?: string; color?: string } | undefined;
    if (!u || (typeof u.sessionId === "string" && u.sessionId.trim())) return;
    const legacyKey = `${String(u.name ?? "")}|${String(u.color ?? "")}`;
    if (hasSessionId.has(legacyKey) && !toRemove.has(clientId)) {
      toRemove.add(clientId);
    }
  });

  if (toRemove.size > 0) {
    removeAwarenessStates(awareness, Array.from(toRemove), "local");
  }
}

/** Remote carets on one-dark background (y-codemirror defaults assume light theme). */
const remoteCursorDarkTheme = EditorView.baseTheme({
  ".cm-ySelectionCaret": {
    borderLeft: "2px solid rgba(255,255,255,0.88)",
    borderRight: "none"
  },
  ".cm-ySelectionCaret::after": {
    display: "none !important",
    content: "none"
  },
  ".cm-ySelectionCaret::before": {
    display: "none !important",
    content: "none"
  },
  ".cm-ySelectionInfo": {
    display: "none !important"
  },
  ".cm-ySelectionInfo::before": {
    display: "none !important"
  },
  ".cm-ySelectionCaretDot": {
    display: "none !important"
  }
});

function RoomCodeEditor({
  height,
  language,
  value,
  serverYjsBase64 = null,
  serverYjsSequence = 0,
  syncKey,
  resyncSignal,
  readOnly,
  sessionId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress
}: {
  height: string;
  language: string;
  value: string;
  serverYjsBase64?: string | null;
  serverYjsSequence?: number;
  syncKey: string;
  resyncSignal: number;
  readOnly: boolean;
  sessionId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string, codeSnapshot?: string | null, yjsDocumentBase64?: string | null) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const lastHandledResyncSignalRef = useRef(0);
  const syncKeyRef = useRef<string>(syncKey);
  const onYjsUpdateRef = useRef(onYjsUpdate);
  const onEditorValueChangeRef = useRef(onEditorValueChange);
  const onKeyPressRef = useRef(onKeyPress);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());
  const lastAppliedServerYjsSeqRef = useRef(-1);
  const lastAppliedServerYjsSnapRef = useRef<string | null>(null);
  const lastSyncKeyForServerSeqRef = useRef(syncKey);
  const sendAwarenessUpdateRef = useRef(sendAwarenessUpdate);
  const awarenessRef = useRef<Awareness | null>(null);

  /** After remote Yjs merges (reload / resync), re-anchor local cursor in Awareness and refresh remote carets. */
  const bumpLocalAwarenessAfterRemoteDocChange = useCallback(() => {
    requestAnimationFrame(() => {
      const v = viewRef.current;
      const awareness = awarenessRef.current;
      const yText = yTextRef.current;
      if (!v || !awareness || !yText) return;
      try {
        const docLen = yText.length;
        const sel = v.state.selection.main;
        const anchor = Math.min(Math.max(sel.anchor, 0), docLen);
        const head = Math.min(Math.max(sel.head, 0), docLen);
        if (anchor !== sel.anchor || head !== sel.head) {
          v.dispatch({ selection: EditorSelection.single(anchor, head) });
        }
        const next = v.state.selection.main;
        awareness.setLocalStateField("cursor", {
          anchor: Y.createRelativePositionFromTypeIndex(yText, next.anchor),
          head: Y.createRelativePositionFromTypeIndex(yText, next.head)
        });
      } catch {
        /* selection can be adjusting after applyUpdate */
      }
      dedupeRemoteAwarenessEntries(awareness);
      v.dispatch({});
    });
  }, []);

  useEffect(() => {
    sendAwarenessUpdateRef.current = sendAwarenessUpdate;
  }, [sendAwarenessUpdate]);

  useEffect(() => {
    onYjsUpdateRef.current = onYjsUpdate;
    onEditorValueChangeRef.current = onEditorValueChange;
    onKeyPressRef.current = onKeyPress;
  }, [onEditorValueChange, onKeyPress, onYjsUpdate]);

  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    const st = awareness.getLocalState();
    if (!st?.user) return;
    const name = participantLabel.trim() || "Участник";
    if (st.user.name === name && (st.user as { sessionId?: string }).sessionId === sessionId) return;
    awareness.setLocalState({
      ...st,
      user: { ...st.user, name, sessionId }
    });
  }, [participantLabel, sessionId]);

  const languageExtension = useMemo(() => {
    const normalized = normalizeRoomLanguage(language);
    if (normalized === "python") return python();
    if (normalized === "java" || normalized === "kotlin") return java();
    if (normalized === "sql") return sql();
    return javascript();
  }, [language]);

  useEffect(() => {
    return () => {
      onYjsBridgeReady(null);
      onAwarenessBridgeReady(null);
      viewRef.current?.destroy();
      viewRef.current = null;
      yDocRef.current?.destroy();
      yDocRef.current = null;
      yTextRef.current = null;
      awarenessRef.current = null;
    };
  }, [onAwarenessBridgeReady, onYjsBridgeReady]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const readOnlyCompartment = readOnlyCompartmentRef.current;
    const languageCompartment = languageCompartmentRef.current;
    const targetCode = value ?? "";
    const snap = serverYjsBase64?.trim();
    let yDoc = new Y.Doc();
    if (snap) {
      try {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(yDoc, raw, "bootstrap");
        }
      } catch {
        /* invalid snapshot */
      }
    } else {
      Y.applyUpdate(yDoc, createDeterministicBootstrapUpdate(targetCode), "bootstrap");
    }
    let yText = yDoc.getText("room-code");
    // Server CRDT snapshot can disagree with `merged.code` (last writer / ordering); never replace a merged doc with the plain string.
    if (yText.toString() !== targetCode && !snap) {
      yDoc.destroy();
      yDoc = new Y.Doc();
      Y.applyUpdate(yDoc, createDeterministicBootstrapUpdate(targetCode), "bootstrap");
      yText = yDoc.getText("room-code");
    }
    yDocRef.current = yDoc;
    yTextRef.current = yText;

    const awareness = new Awareness(yDoc);
    awarenessRef.current = awareness;
    const { color, colorLight } = awarenessUserColors(sessionId);
    awareness.setLocalState({
      user: {
        name: participantLabel.trim() || "Участник",
        color,
        colorLight,
        sessionId
      }
    });

    let awarenessFlushTimer: number | null = null;
    const flushAwareness = () => {
      awarenessFlushTimer = null;
      try {
        const u = encodeAwarenessUpdate(awareness, [awareness.clientID]);
        sendAwarenessUpdateRef.current(bytesToBase64(u));
      } catch {
        /* ignore */
      }
    };
    const onAwarenessChanged = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin === "remote") return;
      const touched = new Set([...added, ...updated, ...removed]);
      if (!touched.has(awareness.clientID)) return;
      if (awarenessFlushTimer != null) window.clearTimeout(awarenessFlushTimer);
      awarenessFlushTimer = window.setTimeout(flushAwareness, 48);
    };
    awareness.on("update", onAwarenessChanged);

    onAwarenessBridgeReady((b64) => {
      try {
        if (!b64) return;
        applyAwarenessUpdate(awareness, base64ToBytes(b64), "remote");
        dedupeRemoteAwarenessEntries(awareness);
      } catch {
        /* ignore malformed */
      }
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: yText.toString(),
        extensions: [
          oneDark,
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
          languageCompartment.of(languageExtension),
          yCollab(yText, awareness, { undoManager: false }),
          remoteCursorDarkTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onEditorValueChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown: (_event, viewInstance) => {
              const event = _event as KeyboardEvent;
              onKeyPressRef.current({
                key: event.key,
                keyCode: event.code,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey
              });
              if (viewInstance.state.readOnly) {
                event.preventDefault();
                return true;
              }
              return false;
            }
          })
        ]
      }),
      parent: hostRef.current
    });
    viewRef.current = view;
    onEditorValueChangeRef.current(view.state.doc.toString());

    syncKeyRef.current = syncKey;

    const handleDocUpdate = (updateBytes: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "bootstrap") return;
      const encodedUpdate = bytesToBase64(updateBytes);
      // Always send full Yjs state with each local edit so the server snapshot stays current.
      // After a tab refresh, missed SSE increments cannot be replayed; reconnecting clients rely on state_sync yjsDocumentBase64.
      const fullDoc = bytesToBase64(Y.encodeStateAsUpdate(yDoc));
      onYjsUpdateRef.current(encodedUpdate, syncKeyRef.current, yText.toString(), fullDoc);
    };
    yDoc.on("update", handleDocUpdate);

    // Idle tabs still refresh the server snapshot so a reloaded peer does not bootstrap from stale CRDT state.
    const heartbeatId = window.setInterval(() => {
      const d = yDocRef.current;
      const t = yTextRef.current;
      if (!d || !t) return;
      const full = bytesToBase64(Y.encodeStateAsUpdate(d));
      onYjsUpdateRef.current("", syncKeyRef.current, t.toString(), full);
    }, 2500);

    onYjsBridgeReady((encodedYjsUpdate: string) => {
      const activeDoc = yDocRef.current;
      if (!activeDoc) return;
      const updateBytes = base64ToBytes(encodedYjsUpdate);
      if (updateBytes.length === 0) return;
      Y.applyUpdate(activeDoc, updateBytes, "remote");
    });

    const snapshotTimerId = window.setTimeout(() => {
      const d = yDocRef.current;
      const t = yTextRef.current;
      if (!d || !t) return;
      const full = bytesToBase64(Y.encodeStateAsUpdate(d));
      onYjsUpdateRef.current("", syncKeyRef.current, t.toString(), full);
    }, 400);

    return () => {
      window.clearTimeout(snapshotTimerId);
      window.clearInterval(heartbeatId);
      yDoc.off("update", handleDocUpdate);
      awareness.off("update", onAwarenessChanged);
      if (awarenessFlushTimer != null) window.clearTimeout(awarenessFlushTimer);
      onAwarenessBridgeReady(null);
      awareness.destroy();
      awarenessRef.current = null;
    };
    // IMPORTANT: do not depend on `value` or `serverYjsBase64` here. When those change every state_sync,
    // this effect's cleanup ran yDoc.off("update") while viewRef stayed set → early return on next run
    // never re-attached the listener, so outbound Yjs updates stopped after the first remote sync.
  }, [onYjsBridgeReady, syncKey]);

  /** Merge server CRDT when `lastYjsSequence` advances (same step); passive tabs and late snapshots. */
  useEffect(() => {
    const activeDoc = yDocRef.current;
    if (!activeDoc) return;
    if (lastSyncKeyForServerSeqRef.current !== syncKey) {
      lastSyncKeyForServerSeqRef.current = syncKey;
      lastAppliedServerYjsSeqRef.current = -1;
      lastAppliedServerYjsSnapRef.current = null;
    }
    const seq = typeof serverYjsSequence === "number" && !Number.isNaN(serverYjsSequence) ? serverYjsSequence : 0;
    const snap = serverYjsBase64?.trim() ?? "";
    const seqAdvanced = seq > lastAppliedServerYjsSeqRef.current;
    const snapChangedAtSameSeq = seq === lastAppliedServerYjsSeqRef.current && snap !== lastAppliedServerYjsSnapRef.current;
    if (!seqAdvanced && !snapChangedAtSameSeq) return;
    try {
      if (snap) {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(activeDoc, raw, "remote");
        }
      }
    } catch (e) {
      roomSyncLog("merge_server_yjs_seq_failed", { error: String(e) });
    }
    lastAppliedServerYjsSeqRef.current = seq;
    lastAppliedServerYjsSnapRef.current = snap || null;
    onEditorValueChangeRef.current(activeDoc.getText("room-code").toString());
    bumpLocalAwarenessAfterRemoteDocChange();
  }, [bumpLocalAwarenessAfterRemoteDocChange, serverYjsBase64, serverYjsSequence, syncKey]);

  /** Step change or explicit resync (focus/reconnect): merge server Y snapshot or plain code fallback. */
  useEffect(() => {
    const activeDoc = yDocRef.current;
    if (!activeDoc) return;
    const syncKeyChanged = syncKeyRef.current !== syncKey;
    syncKeyRef.current = syncKey;
    const forceHydrateFromState = resyncSignal > lastHandledResyncSignalRef.current;
    if (forceHydrateFromState) {
      lastHandledResyncSignalRef.current = resyncSignal;
    }
    if (!syncKeyChanged && !forceHydrateFromState) return;

    const t = activeDoc.getText("room-code");
    const next = value ?? "";
    const snap = serverYjsBase64?.trim() ?? "";

    roomSyncLog("hydrate_from_server", {
      syncKeyChanged,
      resync: forceHydrateFromState,
      hasYjsSnap: Boolean(snap),
      codeLen: next.length
    });
    try {
      if (snap) {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(activeDoc, raw, "remote");
        }
      }
      if (!snap && t.toString() !== next) {
        activeDoc.transact(() => {
          t.delete(0, t.length);
          if (next) t.insert(0, next);
        }, "remote");
      }
    } catch (e) {
      roomSyncLog("hydrate_from_server_failed", { error: String(e) });
    }
    onEditorValueChangeRef.current(activeDoc.getText("room-code").toString());
    bumpLocalAwarenessAfterRemoteDocChange();
  }, [bumpLocalAwarenessAfterRemoteDocChange, resyncSignal, serverYjsBase64, syncKey, value]);

  useEffect(() => {
    const activeView = viewRef.current;
    if (!activeView) return;
    activeView.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly))
    });
  }, [readOnly]);

  useEffect(() => {
    const activeView = viewRef.current;
    if (!activeView) return;
    activeView.dispatch({
      effects: languageCompartmentRef.current.reconfigure(languageExtension)
    });
  }, [languageExtension]);

  // CodeMirror scroll relies on a constrained-height container. `overflow: auto` ensures
  // vertical scrolling works when content grows (e.g. writing many new lines).
  return <div className="cm-host" style={{ height, overflow: "auto", overflowX: "hidden" }} ref={hostRef} />;
}
