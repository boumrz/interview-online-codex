import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { ActionIcon, Badge, Box, Button, Group, Menu, Modal, Select, Stack, Text, TextInput, Textarea, ThemeIcon } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconCode, IconGripVertical, IconHome2, IconLayoutDashboard, IconMenu2, IconUsers } from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import { useAppSelector } from "../app/hooks";
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
  role: "owner" | "interviewer" | "candidate";
  presenceStatus: "active" | "away";
};

type CursorInfo = {
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
  lastYjsSequence?: number;
  currentStep: number;
  notes: string;
  taskScores: Record<string, number | null>;
  participants: Participant[];
  isOwner: boolean;
  role: "owner" | "interviewer" | "candidate";
  canManageRoom: boolean;
  notesLockedBySessionId: string | null;
  notesLockedByDisplayName: string | null;
  notesLockedUntilEpochMs: number | null;
  cursors: CursorInfo[];
  lastCandidateKey: CandidateKeyInfo | null;
  candidateKeyHistory: CandidateKeyInfo[];
};

type ResizeSide = "left" | "right";

const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 360;
const MIN_RIGHT_WIDTH = 240;
const MAX_RIGHT_WIDTH = 420;
const LOG_HISTORY_LIMIT = 50;
const NODEJS_LANGUAGE_ALIASES = new Set(["javascript", "typescript", "nodejs"]);

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

function guestNameKey(inviteCode: string, role: "candidate" | "interviewer-guest" = "candidate") {
  return role === "interviewer-guest" ? `guest_interviewer_display_name_${inviteCode}` : `guest_display_name_${inviteCode}`;
}

function readStoredDisplayName(
  inviteCode: string,
  options: { role?: "candidate" | "interviewer-guest"; includeGlobalFallback?: boolean } = {}
) {
  const role = options.role ?? "candidate";
  const roomScoped = (localStorage.getItem(guestNameKey(inviteCode, role)) ?? "").trim();
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
  const interviewerToken = useMemo(() => {
    const fromUrl = new URLSearchParams(location.search).get("interviewerToken")?.trim() ?? "";
    return fromUrl || null;
  }, [location.search]);

  const { data: room, isLoading } = useGetRoomQuery({
    inviteCode,
    ownerToken: ownerToken ?? undefined,
    interviewerToken: interviewerToken ?? undefined
  });

  const isGuestInterviewer = !!interviewerToken && !authToken;
  const initialStoredName = readStoredDisplayName(inviteCode, {
    role: isGuestInterviewer ? "interviewer-guest" : "candidate",
    includeGlobalFallback: !isGuestInterviewer
  });

  const [state, setState] = useState<RealtimeState | null>(null);
  const stateRef = useRef<RealtimeState | null>(null);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState(() => initialStoredName);
  const [draftName, setDraftName] = useState(() => initialStoredName);
  const [nameModalOpened, setNameModalOpened] = useState(() => {
    if (ownerToken) return false;
    if (interviewerToken) return !authToken && !initialStoredName;
    return !initialStoredName;
  });
  const [notesDraft, setNotesDraft] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [copiedHint, setCopiedHint] = useState("");
  const [notesLockTick, setNotesLockTick] = useState(0);
  const [editorHydrated, setEditorHydrated] = useState(false);
  const [resyncSignal, setResyncSignal] = useState(0);
  const [awaitingRecoverySync, setAwaitingRecoverySync] = useState(false);
  const yjsPendingUpdatesRef = useRef<Array<{ syncKey: string; update: string }>>([]);
  const yjsApplyUpdateRef = useRef<((yjsUpdate: string) => void) | null>(null);

  useEffect(() => {
    const isGuestInterviewerMode = !!interviewerToken && !authToken;
    const stored = readStoredDisplayName(inviteCode, {
      role: isGuestInterviewerMode ? "interviewer-guest" : "candidate",
      includeGlobalFallback: !isGuestInterviewerMode
    });
    const authNickname = authUser?.nickname?.trim() || "";

    let resolved = stored;
    let shouldAskName = false;

    if (ownerToken) {
      resolved = authNickname || stored || "Интервьюер";
      shouldAskName = false;
    } else if (interviewerToken) {
      if (authToken) {
        resolved = authNickname || stored || "Интервьюер";
        shouldAskName = false;
      } else {
        resolved = readStoredDisplayName(inviteCode, {
          role: "interviewer-guest",
          includeGlobalFallback: false
        });
        shouldAskName = !resolved;
      }
    } else {
      if (authToken) {
        resolved = authNickname || stored || "Участник";
        shouldAskName = false;
      } else {
        resolved = stored;
        shouldAskName = !resolved;
      }
    }

    if (resolved) {
      if (!isGuestInterviewerMode) {
        localStorage.setItem("display_name", resolved);
      }
      localStorage.setItem(guestNameKey(inviteCode, isGuestInterviewerMode ? "interviewer-guest" : "candidate"), resolved);
    }

    setDisplayName(resolved);
    setDraftName(resolved);
    setNameModalOpened(shouldAskName);
    setNotesDraft("");
    setNotesDirty(false);
    setCopiedHint("");
  }, [authToken, authUser?.nickname, interviewerToken, inviteCode, ownerToken]);

  const merged = useMemo<RealtimeState | null>(() => {
    if (state) return state;
    if (!room) return null;
    return {
      inviteCode: room.inviteCode,
      language: normalizeRoomLanguage(room.language),
      code: room.code,
      lastCodeUpdatedBySessionId: null,
      lastYjsSequence: 0,
      currentStep: room.currentStep,
      notes: room.notes ?? "",
      taskScores: taskScoresFromTasks(room.tasks ?? []),
      participants: [] as Participant[],
      isOwner: false,
      role: "candidate" as const,
      canManageRoom: false,
      notesLockedBySessionId: null,
      notesLockedByDisplayName: null,
      notesLockedUntilEpochMs: null,
      cursors: [],
      lastCandidateKey: null,
      candidateKeyHistory: []
    };
  }, [room, state]);

  const mergedNotes = merged?.notes ?? "";
  const canManageRoom = merged?.canManageRoom ?? false;
  const currentSyncKey = useMemo(() => {
    if (!merged) return `${inviteCode}:0:nodejs`;
    return `${merged.inviteCode}:${merged.currentStep}:${merged.language}`;
  }, [inviteCode, merged]);
  const syncKeyRef = useRef(currentSyncKey);
  const sessionIdRef = useRef<string>("");
  const recentLocalYjsUpdatesRef = useRef<Map<string, number>>(new Map());
  const recoverySyncTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    syncKeyRef.current = currentSyncKey;
    // Drop buffered updates from previous step/language to avoid stale apply after remount.
    yjsPendingUpdatesRef.current = [];
  }, [currentSyncKey]);

  useEffect(() => {
    return () => {
      if (recoverySyncTimeoutRef.current != null) {
        window.clearTimeout(recoverySyncTimeoutRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (!notesDirty) {
      setNotesDraft(mergedNotes);
    }
  }, [mergedNotes, notesDirty]);

  const onState = useCallback((incoming: RealtimeState) => {
    const previousState = stateRef.current;
    const previousCursorBySessionId = new Map((previousState?.cursors ?? []).map((cursor) => [cursor.sessionId, cursor]));
    const participants = (incoming.participants ?? []).map((participant) => ({
      ...participant,
      role: participant.role ?? "candidate"
    }));
    const cursors = (incoming.cursors ?? []).map((cursor) => {
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
      return {
        ...cursor,
        role: normalizedRole,
        cursorSequence: nextCursorSequence
      };
    });
    const taskScores = normalizeTaskScores(incoming.taskScores);
    const nextState: RealtimeState = {
      ...incoming,
      language: normalizeRoomLanguage(incoming.language),
      participants,
      cursors,
      taskScores,
      lastCodeUpdatedBySessionId: incoming.lastCodeUpdatedBySessionId ?? null,
      lastYjsSequence: typeof incoming.lastYjsSequence === "number" ? incoming.lastYjsSequence : 0,
      lastCandidateKey: incoming.lastCandidateKey ?? null,
      candidateKeyHistory: Array.isArray(incoming.candidateKeyHistory)
        ? incoming.candidateKeyHistory
        : incoming.lastCandidateKey
          ? [incoming.lastCandidateKey]
          : []
    };
    if (
      previousState &&
      previousState.code !== nextState.code &&
      nextState.lastCodeUpdatedBySessionId !== sessionIdRef.current
    ) {
      setResyncSignal((value) => value + 1);
    }
    clearRecoverySyncPending();
    stateRef.current = nextState;
    setState(nextState);
  }, [clearRecoverySyncPending]);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  const onCursorUpdate = useCallback((incomingCursor: CursorInfo) => {
    setState((previous) => {
      if (!previous) return previous;
      if (!incomingCursor?.sessionId || incomingCursor.sessionId === sessionIdRef.current) {
        return previous;
      }

      const normalizedCursor: CursorInfo = {
        ...incomingCursor,
        role: incomingCursor.role ?? "candidate",
        cursorSequence: typeof incomingCursor.cursorSequence === "number" ? incomingCursor.cursorSequence : null
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

  const onYjsUpdate = useCallback((payload: { sessionId: string; yjsUpdate: string; syncKey?: string | null; yjsSequence?: number | null }) => {
    const update = payload.yjsUpdate?.trim();
    if (!update) return;
    const incomingSyncKey = payload.syncKey?.trim() || syncKeyRef.current;
    if (incomingSyncKey !== syncKeyRef.current) {
      return;
    }

    const dedupeKey = `${incomingSyncKey}::${update}`;
    const now = Date.now();
    const recentSentAt = recentLocalYjsUpdatesRef.current.get(dedupeKey);
    if (recentSentAt && now - recentSentAt < 10_000) {
      recentLocalYjsUpdatesRef.current.delete(dedupeKey);
      return;
    }

    setEditorHydrated(true);
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

  const fallbackDisplayName = authUser?.nickname?.trim() || (interviewerToken ? "Интервьюер" : "Участник");
  const effectiveDisplayName = displayName.trim() || fallbackDisplayName;
  const canConnect = Boolean(inviteCode);
  const { connected, sessionId, sendLanguageUpdate, sendSetStep, sendTaskRatingUpdate, sendNotesUpdate, sendCursorUpdate, sendYjsUpdate, sendKeyPress } = useRoomSocket({
    enabled: canConnect,
    inviteCode,
    authToken,
    displayName: effectiveDisplayName,
    ownerToken,
    interviewerToken,
    onState,
    onError,
    onCursorUpdate,
    onCandidateKey,
    onYjsUpdate,
    onRecoveryStateSync,
    onRequireRecoverySync: markRecoverySyncPending
  });
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const sendYjsUpdateTracked = useCallback((yjsUpdate: string, syncKey?: string | null, codeSnapshot?: string | null) => {
    const update = yjsUpdate.trim();
    if (!update) return;
    const normalizedSyncKey = syncKey?.trim() ?? "";
    const now = Date.now();
    const dedupeKey = `${normalizedSyncKey}::${update}`;
    recentLocalYjsUpdatesRef.current.set(dedupeKey, now);
    recentLocalYjsUpdatesRef.current.forEach((timestamp, key) => {
      if (now - timestamp > 15_000) {
        recentLocalYjsUpdatesRef.current.delete(key);
      }
    });
    sendYjsUpdate(update, normalizedSyncKey || null, codeSnapshot ?? null);
  }, [sendYjsUpdate]);

  const hasRealtimeState = Boolean(state);
  const participantsCount = state?.participants.length ?? 0;

  useEffect(() => {
    if (!hasRealtimeState) {
      setEditorHydrated(false);
      return;
    }
    setEditorHydrated(true);
  }, [hasRealtimeState]);

  // Prevent local edits before realtime hydration finishes; otherwise a freshly reloaded
  // tab may produce updates against stale base state and diverge peers.
  const editorReady = hasRealtimeState && editorHydrated && !awaitingRecoverySync;

  const notesLockActive = (merged?.notesLockedUntilEpochMs ?? 0) > Date.now();
  const notesLockedByOther =
    notesLockActive &&
    !!merged?.notesLockedBySessionId &&
    merged.notesLockedBySessionId !== sessionId;

  useEffect(() => {
    const lockUntil = merged?.notesLockedUntilEpochMs ?? 0;
    if (lockUntil <= Date.now()) return;
    const timer = window.setTimeout(() => {
      setNotesLockTick((current) => current + 1);
    }, lockUntil - Date.now() + 40);
    return () => window.clearTimeout(timer);
  }, [merged?.notesLockedUntilEpochMs, notesLockTick]);

  useEffect(() => {
    if (notesDirty && notesDraft === mergedNotes) {
      setNotesDirty(false);
    }
  }, [mergedNotes, notesDirty, notesDraft]);

  useEffect(() => {
    if (!copiedHint) return;
    const timer = window.setTimeout(() => setCopiedHint(""), 2200);
    return () => window.clearTimeout(timer);
  }, [copiedHint]);

  const submitCandidateName = () => {
    const normalized = draftName.trim();
    if (!normalized) return;
    const isGuestInterviewerMode = !!interviewerToken && !authToken;
    if (!isGuestInterviewerMode) {
      localStorage.setItem("display_name", normalized);
    }
    localStorage.setItem(guestNameKey(inviteCode, isGuestInterviewerMode ? "interviewer-guest" : "candidate"), normalized);
    setDisplayName(normalized);
    setNameModalOpened(false);
  };

  const goToLoginAndReturn = () => {
    const next = `${location.pathname}${location.search}`;
    navigate(`/login?next=${encodeURIComponent(next)}`);
  };

  const candidateInviteLink = useMemo(() => {
    if (!inviteCode) return "";
    return `${window.location.origin}/room/${inviteCode}`;
  }, [inviteCode]);

  const effectiveInterviewerToken = room?.interviewerToken ?? interviewerToken ?? "";
  const interviewerInviteLink = useMemo(() => {
    if (!candidateInviteLink || !effectiveInterviewerToken) return "";
    return `${candidateInviteLink}?interviewerToken=${encodeURIComponent(effectiveInterviewerToken)}`;
  }, [candidateInviteLink, effectiveInterviewerToken]);

  const copyInviteLink = useCallback(async (label: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedHint(`${label} скопирована`);
    } catch {
      setCopiedHint(`Не удалось скопировать: ${label.toLowerCase()}`);
    }
  }, []);

  if (isLoading || !merged) {
    return (
      <Box className={styles.shell} p="xl">
        <Text>Загрузка комнаты...</Text>
      </Box>
    );
  }

  const step = room?.tasks.find((task) => task.stepIndex === merged.currentStep);
  const currentTaskRating = merged.taskScores[String(merged.currentStep)] ?? step?.score ?? null;
  const notesLockName = merged.notesLockedByDisplayName?.trim() || "другой интервьюер";
  const notesStatus = notesLockedByOther ? `Редактирует ${notesLockName}` : notesDirty ? "Сохраняем" : "Сохранено";

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
          {interviewerToken && !authToken && (
            <Text size="sm" c="yellow.3">
              По ссылке интервьюера можно войти по имени без аккаунта. Авторизация по желанию.
            </Text>
          )}
          <TextInput
            label="Ваше имя"
            placeholder="Имя"
            value={draftName}
            onChange={(event) => setDraftName(event.currentTarget.value)}
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
        />

        {canManageRoom && (
          <InvitationsMenu
            candidateInviteLink={candidateInviteLink}
            interviewerInviteLink={interviewerInviteLink}
            copiedHint={copiedHint}
            onCopy={copyInviteLink}
          />
        )}

        {canManageRoom ? (
          <OwnerLayout
            merged={merged}
            tasks={room?.tasks ?? []}
            stepTitle={step?.title ?? "-"}
            stepDescription={step?.description ?? ""}
            error={error}
            taskScores={merged.taskScores}
            currentTaskRating={currentTaskRating}
            notesDraft={notesDraft}
            notesStatus={notesStatus}
            notesLockedByOther={notesLockedByOther}
            sessionId={sessionId}
            cursors={merged.cursors}
            lastCandidateKey={merged.lastCandidateKey}
            candidateKeyHistory={merged.candidateKeyHistory ?? []}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onLanguageChange={(value) => value && sendLanguageUpdate(value)}
            onSelectStep={(stepIndex) => sendSetStep(stepIndex)}
            onCursorChange={(payload) => sendCursorUpdate(payload)}
            onYjsUpdate={(yjsUpdate, syncKey, codeSnapshot) => sendYjsUpdateTracked(yjsUpdate, syncKey, codeSnapshot)}
            onYjsBridgeReady={onYjsBridgeReady}
            onKeyPress={(payload) => {
              if (merged.role === "candidate") {
                sendKeyPress(payload);
              }
            }}
            onTaskRatingChange={(rating) => sendTaskRatingUpdate(merged.currentStep, rating)}
            onNotesChange={(value) => {
              setNotesDraft(value);
              setNotesDirty(true);
              if (!notesLockedByOther) {
                sendNotesUpdate(value);
              }
            }}
          />
        ) : (
          <CandidateLayout
            merged={merged}
            stepTitle={step?.title ?? "-"}
            stepDescription={step?.description ?? ""}
            sessionId={sessionId}
            cursors={merged.cursors}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onCursorChange={(payload) => sendCursorUpdate(payload)}
            onYjsUpdate={(yjsUpdate, syncKey, codeSnapshot) => sendYjsUpdateTracked(yjsUpdate, syncKey, codeSnapshot)}
            onYjsBridgeReady={onYjsBridgeReady}
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
  showParticipants
}: {
  roomTitle: string;
  authToken: string | null;
  connected: boolean;
  participants: Participant[];
  showParticipants: boolean;
}) {
  const normalizedParticipants = useMemo(() => {
    const unique = new Map<string, Participant>();
    participants.forEach((participant) => {
      if (!unique.has(participant.sessionId)) {
        unique.set(participant.sessionId, participant);
      }
    });
    return Array.from(unique.values());
  }, [participants]);

  const participantsHostRef = useRef<HTMLDivElement | null>(null);
  const [maxVisibleParticipants, setMaxVisibleParticipants] = useState(normalizedParticipants.length);

  useEffect(() => {
    if (!showParticipants) return;
    const host = participantsHostRef.current;
    if (!host) return;

    const recalc = () => {
      const total = normalizedParticipants.length;
      if (total === 0) {
        setMaxVisibleParticipants(0);
        return;
      }

      const width = host.clientWidth;
      const chipWidth = 112;
      const calculateVisible = (reserveForMenu: boolean) => {
        const reserved = reserveForMenu ? 40 : 0;
        return Math.max(0, Math.floor((width - reserved) / chipWidth));
      };

      let visible = calculateVisible(false);
      if (visible < total) {
        visible = calculateVisible(true);
      }
      setMaxVisibleParticipants(Math.min(total, visible));
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(host);
    window.addEventListener("resize", recalc);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [normalizedParticipants.length, showParticipants]);

  const visibleParticipants = normalizedParticipants.slice(0, maxVisibleParticipants);
  const hiddenParticipants = normalizedParticipants.slice(visibleParticipants.length);

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
          <Box className={styles.participantsHost} ref={participantsHostRef}>
            <Group className={styles.participantsInline} gap={6} wrap="nowrap">
              {visibleParticipants.map((participant) => (
                <Badge
                  key={participant.sessionId}
                  variant="light"
                  color={participant.presenceStatus === "active" ? "teal" : "gray"}
                  className={styles.participantBadge}
                  data-testid={`participant-badge-${participant.presenceStatus}`}
                >
                  {participant.displayName}
                </Badge>
              ))}

              {hiddenParticipants.length > 0 && (
                <Menu withinPortal position="bottom-end" shadow="md">
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Скрытые участники">
                      <IconMenu2 size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {hiddenParticipants.map((participant) => (
                      <Menu.Item key={participant.sessionId} leftSection={<IconUsers size={14} />}>
                        {participant.displayName} {participant.presenceStatus === "active" ? "• в фокусе" : "• вне фокуса"}
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </Box>
        ) : (
          <Box className={styles.participantsHost} />
        )}

        <Group className={styles.topActions}>
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
        </Group>
      </Box>
    </Box>
  );
}

function InvitationsMenu({
  candidateInviteLink,
  interviewerInviteLink,
  copiedHint,
  onCopy
}: {
  candidateInviteLink: string;
  interviewerInviteLink: string;
  copiedHint: string;
  onCopy: (label: string, value: string) => Promise<void>;
}) {
  return (
    <Box className={styles.invitesBar}>
      <Group justify="space-between" align="center">
        <Menu withinPortal position="bottom-start" shadow="md">
          <Menu.Target>
            <Button size="xs" variant="light" color="gray">
              Приглашения
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => onCopy("Ссылка кандидата", candidateInviteLink)}>Скопировать ссылку кандидата</Menu.Item>
            <Menu.Item disabled={!interviewerInviteLink} onClick={() => onCopy("Ссылка интервьюера", interviewerInviteLink)}>
              Скопировать ссылку интервьюера
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Text size="xs" c={copiedHint ? "#8fd6a8" : "#7f8896"}>
          {copiedHint || "Ссылка из адресной строки ведёт кандидата по умолчанию"}
        </Text>
      </Group>
    </Box>
  );
}

function OwnerLayout({
  merged,
  tasks,
  stepTitle,
  stepDescription,
  error,
  taskScores,
  currentTaskRating,
  notesDraft,
  notesStatus,
  notesLockedByOther,
  sessionId,
  cursors,
  lastCandidateKey,
  candidateKeyHistory,
  syncKey,
  resyncSignal,
  editorReady,
  onLanguageChange,
  onSelectStep,
  onCursorChange,
  onYjsUpdate,
  onYjsBridgeReady,
  onKeyPress,
  onTaskRatingChange,
  onNotesChange
}: {
  merged: RealtimeState;
  tasks: Array<{ stepIndex: number; title: string; language: string; score: number | null }>;
  stepTitle: string;
  stepDescription: string;
  error: string;
  taskScores: Record<string, number | null>;
  currentTaskRating: number | null;
  notesDraft: string;
  notesStatus: string;
  notesLockedByOther: boolean;
  sessionId: string;
  cursors: CursorInfo[];
  lastCandidateKey: CandidateKeyInfo | null;
  candidateKeyHistory: CandidateKeyInfo[];
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onLanguageChange: (value: string | null) => void;
  onSelectStep: (stepIndex: number) => void;
  onCursorChange: (payload: {
    lineNumber: number;
    column: number;
    selectionStartLineNumber?: number | null;
    selectionStartColumn?: number | null;
    selectionEndLineNumber?: number | null;
    selectionEndColumn?: number | null;
  }) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string, codeSnapshot?: string | null) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
  onTaskRatingChange: (rating: number | null) => void;
  onNotesChange: (value: string) => void;
}) {
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"notes" | "logs">("notes");
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(288);
  const ownerBodyRef = useRef<HTMLDivElement | null>(null);
  const [ownerBodyWidth, setOwnerBodyWidth] = useState(0);
  const compactAutoCollapsedRef = useRef(false);

  const dragStateRef = useRef<{ side: ResizeSide; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState<ResizeSide | null>(null);

  const startDrag = useCallback(
    (side: ResizeSide) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        side,
        startX: event.clientX,
        startWidth: side === "left" ? leftWidth : rightWidth
      };
      setDragging(side);
    },
    [leftWidth, rightWidth]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;

      if (dragState.side === "left") {
        setLeftWidth(clamp(dragState.startWidth + delta, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH));
      } else {
        setRightWidth(clamp(dragState.startWidth - delta, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH));
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
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
  }, [dragging]);

  useEffect(() => {
    const host = ownerBodyRef.current;
    if (!host) return;

    const recalc = () => setOwnerBodyWidth(host.clientWidth);
    recalc();

    const observer = new ResizeObserver(recalc);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (ownerBodyWidth <= 0) return;
    if (ownerBodyWidth < 1080) {
      if (!compactAutoCollapsedRef.current && leftSidebarVisible) {
        compactAutoCollapsedRef.current = true;
        setLeftSidebarVisible(false);
      }
      return;
    }
    if (ownerBodyWidth >= 1160) {
      compactAutoCollapsedRef.current = false;
    }
  }, [leftSidebarVisible, ownerBodyWidth]);

  const showLeftSidebar = leftSidebarVisible;
  const showRightSidebar = rightSidebarVisible;
  const baseInset = 10;
  const toggleHandleWidth = 20;
  const maxOffset = Math.max(baseInset, ownerBodyWidth - toggleHandleWidth - 4);
  const leftToggleOffset = clamp(showLeftSidebar ? leftWidth + 10 : baseInset, baseInset, maxOffset);
  const rightToggleOffset = clamp(showRightSidebar ? rightWidth + 10 : baseInset, baseInset, maxOffset);
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
    <Box className={styles.ownerBody} ref={ownerBodyRef}>
      <button
        type="button"
        className={`${styles.edgeToggle} ${styles.leftEdgeToggle}`}
        style={{ left: leftToggleOffset }}
        data-open={showLeftSidebar}
        onClick={() => setLeftSidebarVisible((current) => !current)}
        aria-label={showLeftSidebar ? "Скрыть левый сайдбар" : "Показать левый сайдбар"}
      >
        {showLeftSidebar ? <IconChevronLeft size={14} className={styles.edgeToggleIcon} /> : <IconChevronRight size={14} className={styles.edgeToggleIcon} />}
      </button>

      <button
        type="button"
        className={`${styles.edgeToggle} ${styles.rightEdgeToggle}`}
        style={{ right: rightToggleOffset }}
        data-open={showRightSidebar}
        onClick={() => setRightSidebarVisible((current) => !current)}
        aria-label={showRightSidebar ? "Скрыть правый сайдбар" : "Показать правый сайдбар"}
      >
        {showRightSidebar ? <IconChevronRight size={14} className={styles.edgeToggleIcon} /> : <IconChevronLeft size={14} className={styles.edgeToggleIcon} />}
      </button>

      {showLeftSidebar && (
        <>
          <Box className={styles.sidebar} style={{ width: clamp(leftWidth, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH) }}>
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
            <Text className={styles.stepMeta}>{stepDescription}</Text>

            <Select
              label="Язык"
              data={LANGUAGES}
              value={normalizeRoomLanguage(merged.language)}
              onChange={(value) => onLanguageChange(value ? normalizeRoomLanguage(value) : null)}
              styles={{
                label: { color: "#9ba0a8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
                input: { backgroundColor: "#14171d", borderColor: "#262a31", color: "#f3f5f7" },
                dropdown: { backgroundColor: "#14171d", borderColor: "#262a31" },
                option: { color: "#f3f5f7" }
              }}
            />
          </Box>

          <div
            className={styles.resizeHandle}
            role="separator"
            aria-label="Изменить ширину левой панели"
            onMouseDown={startDrag("left")}
          >
            <IconGripVertical size={14} />
          </div>
        </>
      )}

      <Box className={styles.workspace}>
        <Box className={styles.editorColumn}>
          <Box className={styles.editorPanel}>
            <div className={styles.editorWrap}>
              <RoomCodeEditor
                key={syncKey}
                height="100%"
                language={toEditorLanguage(merged.language)}
                value={merged.code}
                syncKey={syncKey}
                resyncSignal={resyncSignal}
                readOnly={!editorReady}
                sessionId={sessionId}
                cursors={cursors}
                onCursorChange={onCursorChange}
                onYjsUpdate={onYjsUpdate}
                onYjsBridgeReady={onYjsBridgeReady}
                onKeyPress={onKeyPress}
              />
            </div>
          </Box>
        </Box>

        {showRightSidebar && (
          <>
            <div
              className={styles.resizeHandle}
              role="separator"
              aria-label="Изменить ширину правой панели"
              onMouseDown={startDrag("right")}
            >
              <IconGripVertical size={14} />
            </div>

            <Box className={styles.outputPanel} style={{ width: clamp(rightWidth, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH) }}>
              <div className={styles.panelTabs}>
                <div className={styles.ownerPresenceBanner} aria-label="Статус кандидата">
                  <div className={styles.ownerPresenceCopy}>
                    <Text className={styles.ownerPresenceLabel}>Статус кандидата</Text>
                  </div>
                  <Badge className={styles.ownerPresenceBadge} variant="light" data-state={candidatePresenceState}>
                    {candidatePresenceLabel}
                  </Badge>
                </div>
                <div className={styles.panelTabsList} role="tablist" aria-label="Правая панель">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rightPanelTab === "notes"}
                    className={`${styles.panelTab} ${rightPanelTab === "notes" ? styles.panelTabActive : ""}`}
                    onClick={() => setRightPanelTab("notes")}
                  >
                    Заметки
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rightPanelTab === "logs"}
                    className={`${styles.panelTab} ${rightPanelTab === "logs" ? styles.panelTabActive : ""}`}
                    onClick={() => setRightPanelTab("logs")}
                  >
                    Логи
                  </button>
                </div>

                {rightPanelTab === "notes" ? (
                  <div className={styles.panelTabPanel} role="tabpanel" aria-label="Заметки">
                  <Text className={styles.panelSectionTitle}>Заметки по комнате</Text>
                  <div className={styles.notesTopRow}>
                    <div
                      className={styles.notesStatusBanner}
                      data-state={notesLockedByOther ? "locked" : notesStatus === "Сохраняем" ? "saving" : "saved"}
                      aria-label={`Статус заметок: ${notesStatus}`}
                    >
                      <Text className={styles.notesStatusValue}>{notesStatus}</Text>
                    </div>
                    <Select
                      className={styles.notesRating}
                      classNames={{ option: styles.notesRatingOption }}
                      label="Оценка"
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
                  </div>
                  <Textarea
                    value={notesDraft}
                    onChange={(event) => onNotesChange(event.currentTarget.value)}
                    minRows={14}
                    disabled={notesLockedByOther}
                    data-testid="room-notes-input"
                    classNames={{ input: styles.notesInput }}
                  />
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

              {error && <Text className={styles.error}>{error}</Text>}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

function CandidateLayout({
  merged,
  stepTitle,
  stepDescription,
  sessionId,
  cursors,
  syncKey,
  resyncSignal,
  editorReady,
  onCursorChange,
  onYjsUpdate,
  onYjsBridgeReady,
  onKeyPress,
  error
}: {
  merged: RealtimeState;
  stepTitle: string;
  stepDescription: string;
  sessionId: string;
  cursors: CursorInfo[];
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onCursorChange: (payload: {
    lineNumber: number;
    column: number;
    selectionStartLineNumber?: number | null;
    selectionStartColumn?: number | null;
    selectionEndLineNumber?: number | null;
    selectionEndColumn?: number | null;
  }) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string, codeSnapshot?: string | null) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
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
        {stepDescription ? <Text className={styles.candidateDescription}>{stepDescription}</Text> : null}
      </Box>

      <Box className={styles.candidatePanel}>
        <div className={styles.editorWrap}>
          <RoomCodeEditor
            key={syncKey}
            height="calc(100vh - 170px)"
            language={toEditorLanguage(merged.language)}
            value={merged.code}
            syncKey={syncKey}
            resyncSignal={resyncSignal}
            readOnly={!editorReady}
            sessionId={sessionId}
            cursors={cursors}
            onCursorChange={onCursorChange}
            onYjsUpdate={onYjsUpdate}
            onYjsBridgeReady={onYjsBridgeReady}
            onKeyPress={onKeyPress}
          />
        </div>
      </Box>

      {error && <Text className={styles.error}>{error}</Text>}
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

function colorThemeForSession(sessionId: string) {
  const hue = hashSessionId(sessionId) % 360;
  return {
    caret: `hsl(${hue} 88% 60%)`,
    selection: `hsl(${hue} 88% 60% / 0.18)`,
    selectionBorder: `hsl(${hue} 88% 60% / 0.45)`
  };
}

function cursorClassBySession(sessionId: string): string {
  return `remote-cursor-caret-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function selectionClassBySession(sessionId: string): string {
  return `remote-selection-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function RoomCodeEditor({
  height,
  language,
  value,
  syncKey,
  resyncSignal,
  readOnly,
  sessionId,
  cursors,
  onCursorChange,
  onYjsUpdate,
  onYjsBridgeReady,
  onKeyPress
}: {
  height: string;
  language: string;
  value: string;
  syncKey: string;
  resyncSignal: number;
  readOnly: boolean;
  sessionId: string;
  cursors: CursorInfo[];
  onCursorChange: (payload: {
    lineNumber: number;
    column: number;
    selectionStartLineNumber?: number | null;
    selectionStartColumn?: number | null;
    selectionEndLineNumber?: number | null;
    selectionEndColumn?: number | null;
  }) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string, codeSnapshot?: string | null) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
}) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const styleElementRef = useRef<HTMLStyleElement | null>(null);
  const suppressEditorChangesRef = useRef(false);
  const lastHandledResyncSignalRef = useRef(0);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const decorationsRef = useRef<string[]>([]);
  const lastRemoteCursorSignatureRef = useRef<string>("");
  const lastRemoteCursorStyleSignatureRef = useRef<string>("");
  const lastCursorSentRef = useRef<{
    lineNumber: number;
    column: number;
    selectionStartLineNumber: number | null;
    selectionStartColumn: number | null;
    selectionEndLineNumber: number | null;
    selectionEndColumn: number | null;
    ts: number;
  }>({
    lineNumber: 0,
    column: 0,
    selectionStartLineNumber: null,
    selectionStartColumn: null,
    selectionEndLineNumber: null,
    selectionEndColumn: null,
    ts: 0
  });
  const syncKeyRef = useRef(syncKey);

  useEffect(() => {
    const styleNode = document.createElement("style");
    styleNode.setAttribute("data-room-cursor-style", sessionId);
    document.head.appendChild(styleNode);
    styleElementRef.current = styleNode;
    return () => {
      styleElementRef.current?.remove();
      styleElementRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    return () => {
      onYjsBridgeReady(null);
      decorationsRef.current = [];
      lastRemoteCursorSignatureRef.current = "";
      lastRemoteCursorStyleSignatureRef.current = "";

      yDocRef.current?.destroy();
      yDocRef.current = null;
      yTextRef.current = null;

      disposablesRef.current.forEach((disposable) => disposable.dispose());
      disposablesRef.current = [];
    };
  }, [onYjsBridgeReady]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const clampCursor = (lineNumber: number, column: number) => {
      const maxLine = model.getLineCount();
      const nextLine = Math.min(Math.max(lineNumber, 1), maxLine);
      const lineMaxColumn = model.getLineMaxColumn(nextLine);
      const nextColumn = Math.min(Math.max(column, 1), lineMaxColumn);
      return { lineNumber: nextLine, column: nextColumn };
    };

    const remoteCursors = cursors.filter((cursor) => cursor.sessionId !== sessionId);
    const remoteCursorSignature = remoteCursors
      .slice()
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      .map((cursor) => [
        cursor.sessionId,
        cursor.lineNumber,
        cursor.column,
        cursor.selectionStartLineNumber ?? "na",
        cursor.selectionStartColumn ?? "na",
        cursor.selectionEndLineNumber ?? "na",
        cursor.selectionEndColumn ?? "na"
      ].join(":"))
      .join("|");
    if (remoteCursorSignature === lastRemoteCursorSignatureRef.current) {
      return;
    }
    lastRemoteCursorSignatureRef.current = remoteCursorSignature;
    const caretCssRules: string[] = [];
    const selectionCssRules: string[] = [];
    const decorations: any[] = [];
    remoteCursors.forEach((cursor) => {
      const { lineNumber, column } = clampCursor(cursor.lineNumber, cursor.column);
      const theme = colorThemeForSession(cursor.sessionId);
      const caretClassName = cursorClassBySession(cursor.sessionId);
      const selectionClassName = selectionClassBySession(cursor.sessionId);

      caretCssRules.push(`.${caretClassName} { border-left-color: ${theme.caret} !important; }`);
      selectionCssRules.push(
        `.${selectionClassName} { background-color: ${theme.selection} !important; box-shadow: inset 0 0 0 1px ${theme.selectionBorder}; border-radius: 2px; }`
      );

      decorations.push({
        range: new monaco.Range(lineNumber, column, lineNumber, column),
        options: {
          afterContentClassName: `${styles.remoteCursorCaret} ${caretClassName}`,
          hoverMessage: { value: `${cursor.displayName} (${cursor.role})` }
        }
      });

      const hasSelection =
        typeof cursor.selectionStartLineNumber === "number" &&
        typeof cursor.selectionStartColumn === "number" &&
        typeof cursor.selectionEndLineNumber === "number" &&
        typeof cursor.selectionEndColumn === "number";
      if (!hasSelection) return;

      const start = clampCursor(cursor.selectionStartLineNumber as number, cursor.selectionStartColumn as number);
      const end = clampCursor(cursor.selectionEndLineNumber as number, cursor.selectionEndColumn as number);
      const isBackward = start.lineNumber > end.lineNumber || (start.lineNumber === end.lineNumber && start.column > end.column);
      const selectionStart = isBackward ? end : start;
      const selectionEnd = isBackward ? start : end;
      const isCollapsed =
        selectionStart.lineNumber === selectionEnd.lineNumber &&
        selectionStart.column === selectionEnd.column;
      if (isCollapsed) return;

      decorations.push({
        range: new monaco.Range(
          selectionStart.lineNumber,
          selectionStart.column,
          selectionEnd.lineNumber,
          selectionEnd.column
        ),
        options: {
          inlineClassName: selectionClassName,
          hoverMessage: { value: `${cursor.displayName} выделяет фрагмент` }
        }
      });
    });

    if (styleElementRef.current) {
      const styleSignature = [...caretCssRules, ...selectionCssRules].join("\n");
      if (styleSignature !== lastRemoteCursorStyleSignatureRef.current) {
        styleElementRef.current.textContent = styleSignature;
        lastRemoteCursorStyleSignatureRef.current = styleSignature;
      }
    }

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [cursors, sessionId]);

  useEffect(() => {
    const yDoc = yDocRef.current;
    const yText = yTextRef.current;
    if (!yDoc || !yText) return;

    const current = yText.toString();
    const next = value ?? "";
    const syncKeyChanged = syncKeyRef.current !== syncKey;
    const forceHydrateFromState = resyncSignal > lastHandledResyncSignalRef.current;
    if (forceHydrateFromState) {
      lastHandledResyncSignalRef.current = resyncSignal;
    }
    if (!syncKeyChanged && !forceHydrateFromState) return;

    syncKeyRef.current = syncKey;
    if (current === next) {
      return;
    }
    yDoc.transact(() => {
      yText.delete(0, yText.length);
      if (next) {
        yText.insert(0, next);
      }
    }, "remote");
  }, [resyncSignal, syncKey, value]);

  return (
    <Editor
      height={height}
      language={language}
      defaultValue={value}
      theme="vs-dark"
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        disposablesRef.current.forEach((disposable) => disposable.dispose());
        disposablesRef.current = [];

        yDocRef.current?.destroy();
        yDocRef.current = null;
        yTextRef.current = null;

        const model = editor.getModel();
        if (!model) return;

        const yDoc = new Y.Doc();
        Y.applyUpdate(yDoc, createDeterministicBootstrapUpdate(value), "bootstrap");
        const yText = yDoc.getText("room-code");

        yDocRef.current = yDoc;
        yTextRef.current = yText;

        const handleDocUpdate = (updateBytes: Uint8Array, origin: unknown) => {
          if (origin === "remote" || origin === "bootstrap") return;
          const encodedUpdate = bytesToBase64(updateBytes);
          onYjsUpdate(encodedUpdate, syncKeyRef.current, yText.toString());
        };
        yDoc.on("update", handleDocUpdate);

        const handleYTextChange = (event: Y.YTextEvent, transaction: Y.Transaction) => {
          if (transaction.origin === "editor") return;
          const activeEditor = editorRef.current;
          const activeMonaco = monacoRef.current;
          const activeModel = activeEditor?.getModel();
          if (!activeEditor || !activeMonaco || !activeModel) return;

          const expectedValue = yText.toString();
          if (activeModel.getValue() === expectedValue) return;

          suppressEditorChangesRef.current = true;
          try {
            const scrollTop = activeEditor.getScrollTop();
            const scrollLeft = activeEditor.getScrollLeft();
            const delta = Array.isArray((event as any)?.delta) ? ((event as any).delta as Array<any>) : [];
            if (delta.length > 0) {
              let offset = 0;
              delta.forEach((op) => {
                if (typeof op?.retain === "number" && op.retain > 0) {
                  offset += op.retain;
                  return;
                }
                if (typeof op?.delete === "number" && op.delete > 0) {
                  const start = activeModel.getPositionAt(offset);
                  const end = activeModel.getPositionAt(offset + op.delete);
                  activeModel.applyEdits([
                    {
                      range: new activeMonaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
                      text: "",
                      forceMoveMarkers: true
                    }
                  ]);
                  return;
                }
                if (op?.insert != null) {
                  const text = typeof op.insert === "string" ? op.insert : String(op.insert);
                  if (!text) return;
                  const start = activeModel.getPositionAt(offset);
                  activeModel.applyEdits([
                    {
                      range: new activeMonaco.Range(start.lineNumber, start.column, start.lineNumber, start.column),
                      text,
                      forceMoveMarkers: true
                    }
                  ]);
                  offset += text.length;
                }
              });
            }
            if (activeModel.getValue() !== expectedValue) {
              activeEditor.executeEdits("yjs-remote-sync-fallback", [
                {
                  range: activeModel.getFullModelRange(),
                  text: expectedValue,
                  forceMoveMarkers: true
                }
              ]);
            }
            activeEditor.setScrollTop(scrollTop);
            activeEditor.setScrollLeft(scrollLeft);
          } finally {
            suppressEditorChangesRef.current = false;
          }
        };
        yText.observe(handleYTextChange);

        onYjsBridgeReady((encodedYjsUpdate: string) => {
          const activeDoc = yDocRef.current;
          if (!activeDoc) return;
          const updateBytes = base64ToBytes(encodedYjsUpdate);
          if (updateBytes.length === 0) return;
          Y.applyUpdate(activeDoc, updateBytes, "remote");
        });

        const emitCursorSync = (position: any, selectionLike: any) => {
          const isVisible = typeof document === "undefined" || document.visibilityState === "visible";
          const hasFocus =
            typeof document === "undefined" || typeof document.hasFocus !== "function"
              ? true
              : document.hasFocus();
          if (!isVisible || !hasFocus) {
            return;
          }

          const lineNumber = position?.lineNumber ?? selectionLike?.endLineNumber ?? 1;
          const column = position?.column ?? selectionLike?.endColumn ?? 1;
          const isSelectionEmpty =
            !selectionLike
              ? true
              : typeof selectionLike.isEmpty === "function"
                ? selectionLike.isEmpty()
                : typeof selectionLike.isEmpty === "boolean"
                  ? selectionLike.isEmpty
                  : selectionLike.startLineNumber === selectionLike.endLineNumber &&
                    selectionLike.startColumn === selectionLike.endColumn;
          const hasSelection = !isSelectionEmpty;
          const selectionStartLineNumber = hasSelection ? selectionLike.startLineNumber : null;
          const selectionStartColumn = hasSelection ? selectionLike.startColumn : null;
          const selectionEndLineNumber = hasSelection ? selectionLike.endLineNumber : null;
          const selectionEndColumn = hasSelection ? selectionLike.endColumn : null;

          const now = Date.now();
          const prev = lastCursorSentRef.current;
          if (
            prev.lineNumber === lineNumber &&
            prev.column === column &&
            prev.selectionStartLineNumber === selectionStartLineNumber &&
            prev.selectionStartColumn === selectionStartColumn &&
            prev.selectionEndLineNumber === selectionEndLineNumber &&
            prev.selectionEndColumn === selectionEndColumn &&
            now - prev.ts < 85
          ) {
            return;
          }

          lastCursorSentRef.current = {
            lineNumber,
            column,
            selectionStartLineNumber,
            selectionStartColumn,
            selectionEndLineNumber,
            selectionEndColumn,
            ts: now
          };
          onCursorChange({
            lineNumber,
            column,
            selectionStartLineNumber,
            selectionStartColumn,
            selectionEndLineNumber,
            selectionEndColumn
          });
        };

        disposablesRef.current.push(
          editor.onDidChangeCursorSelection((event: any) => {
            const source = typeof event?.source === "string" ? event.source.toLowerCase() : "";
            const reason = typeof event?.reason === "number" ? event.reason : null;
            const cursorChangeReason = monacoRef.current?.editor?.CursorChangeReason;
            const isRecoverFromMarkers =
              typeof cursorChangeReason?.RecoverFromMarkers === "number" &&
              reason === cursorChangeReason.RecoverFromMarkers;
            const isContentFlush =
              typeof cursorChangeReason?.ContentFlush === "number" &&
              reason === cursorChangeReason.ContentFlush;
            // Ignore service-driven cursor shifts produced by remote edits to avoid ping-pong and flicker.
            if (source.includes("model") || source === "api" || isRecoverFromMarkers || isContentFlush) {
              return;
            }
            emitCursorSync(event.position, event.selection);
          })
        );

        disposablesRef.current.push(
          editor.onDidChangeModelContent((event: any) => {
            if (suppressEditorChangesRef.current) return;
            const activeText = yTextRef.current;
            const activeDoc = yDocRef.current;
            if (!activeText || !activeDoc) return;
            const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
            activeDoc.transact(() => {
              changes.forEach((change) => {
                if (change.rangeLength > 0) {
                  activeText.delete(change.rangeOffset, change.rangeLength);
                }
                if (change.text && change.text.length > 0) {
                  activeText.insert(change.rangeOffset, change.text);
                }
              });
            }, "editor");
          })
        );

        disposablesRef.current.push(
          editor.onKeyDown((event: any) => {
            const browserEvent = event.browserEvent as KeyboardEvent;
            onKeyPress({
              key: browserEvent.key,
              keyCode: browserEvent.code,
              ctrlKey: browserEvent.ctrlKey,
              altKey: browserEvent.altKey,
              shiftKey: browserEvent.shiftKey,
              metaKey: browserEvent.metaKey
            });
          })
        );

        disposablesRef.current.push({
          dispose: () => {
            yDoc.off("update", handleDocUpdate);
            yText.unobserve(handleYTextChange);
          }
        });
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbersMinChars: 3,
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        renderValidationDecorations: "off",
        readOnly,
        autoClosingBrackets: "never",
        autoClosingQuotes: "never",
        autoClosingDelete: "never",
        autoClosingOvertype: "never",
        autoIndent: "none",
        autoIndentOnPaste: false,
        autoIndentOnPasteWithinString: false,
        formatOnType: false,
        formatOnPaste: false,
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: "off",
        wordBasedSuggestions: "off",
        parameterHints: { enabled: false },
        inlineSuggest: { enabled: false }
      }}
    />
  );
}
