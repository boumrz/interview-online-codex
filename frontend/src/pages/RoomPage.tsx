import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconChecklist,
  IconCode,
  IconDots,
  IconDownload,
  IconFileDescription,
  IconGripVertical,
  IconHome2,
  IconMessages,
  IconNote,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import { markdownToHtml } from "../components/markdown";
import { useEscapeLayer } from "../components/useEscapeLayer";
import {
  useAddRoomTasksMutation,
  useDeleteRoomTaskMutation,
  useUpdateRoomTaskMutation,
  useGetRoomQuery,
  useTasksGroupedQuery,
} from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";
import { useRoomSocket } from "../features/room/useRoomSocket";
import {
  buildModifierPrefix,
  formatCandidateKey,
  formatCandidateKeyHistoryTimestamp,
  normalizeKeyCodeLabel,
  normalizeKeyLabel,
  type CandidateKeyInfo,
  type KeyPressPayload,
} from "../features/room/candidateKeys";
import { useCandidateKeyTracker } from "../features/room/useCandidateKeyTracker";
import { useOwnerPanelResize } from "../features/room/useOwnerPanelResize";
import {
  buildPersonalNotesMarkdownDocument,
  formatStepBlockLabel,
  formatStepRatingSuffix,
  type PersonalNotesExportOptions,
} from "../features/room/personalNotesExport";
import {
  parsePersonalNotesCommand,
  parseStepBlockName,
  type PersonalNotesCommand,
} from "../features/room/privateNotesCommands";
import {
  buildRoomExportFileName,
  renderPersonalNotesPdf,
  triggerBrowserDownload,
} from "../features/room/personalNotesPdfExport";
import { roomSyncLog } from "../features/room/roomSyncLog";
import {
  normalizeRoomLanguage,
  toEditorLanguage,
} from "../features/room/roomLanguage";
import {
  awarenessUserColors,
  normalizeIdentityValue,
  participantIdentityKey,
} from "../features/room/awarenessIdentity";
import {
  RoomCodeEditor,
  type YjsUpdateHandler,
} from "../features/room/RoomCodeEditor";
import { BriefingBoard } from "../features/room/BriefingBoard";
import {
  extractFocusMode,
  setFocusMode as applyBriefingFocusMode,
  stripFocusMarker,
} from "../features/room/briefingFocusMode";
import {
  TopBar,
  LANGUAGES,
  type Participant,
} from "../features/room/TopBar";
import type { RoomTask, TaskTemplate } from "../types";

import styles from "./RoomPage.module.css";

type CursorInfo = {
  sessionId: string;
  displayName: string;
  userId?: string | null;
  participantId?: string | null;
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

/**
 * Логирование клавиш кандидата вынесено в `frontend/src/features/room/candidateKeys.ts`.
 * Здесь только реэкспорт публичного API для существующих ссылок внутри файла.
 */

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
  /**
   * Room-wide private notes stream for the current viewer (interviewer/owner).
   * Replaces the legacy per-step grouping.
   */
  personalNotes?: PersonalNoteEntry[];
  briefingMarkdown?: string;
  tasks?: RoomTask[];
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

type PersonalNoteEntry = {
  id: string;
  text: string;
  blockName?: string | null;
  /**
   * Step index this entry belongs to when authored under a step block. UI
   * renders such entries as `Шаг N`; export expands to `Шаг N - <task title>`.
   */
  blockStepIndex?: number | null;
  timestampEpochMs: number;
};

type PendingPersonalNoteEntry = PersonalNoteEntry & {
  pending: true;
};

/**
 * Active private notes block. A step block is auto-set on step switch and
 * keeps a stable pointer (`stepIndex`) even if the task title changes; a
 * custom block is whatever the interviewer typed via `/block <name>`.
 */
type ActivePrivateBlock =
  | { kind: "step"; stepIndex: number }
  | { kind: "custom"; name: string };

type RoomCustomTaskDraft = {
  title: string;
  description: string;
  starterCode: string;
  /** Язык новой задачи (по умолчанию совпадает с языком комнаты). */
  language: string;
};

type MobileRoomTab = "editor" | "collaboration" | "tasks";

/**
 * Поведение ресайза левой панели интервьюера живёт в `useOwnerPanelResize` —
 * там же лежат `MIN_OWNER_PANEL_WIDTH` и расчёт динамического потолка.
 */
const MIN_BRIEFING_HEIGHT = 120;
const MAX_BRIEFING_HEIGHT = 420;
const LOG_HISTORY_LIMIT = 50;
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
const PRIVATE_NOTE_BLOCK_COLORS = [
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "grape",
  "pink",
  "red",
  "orange",
  "lime",
  "green",
] as const;

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

function normalizeTaskText(value: string | null | undefined): string {
  return (value ?? "").replaceAll("\r\n", "\n").trim();
}

function taskSignature(
  task: Pick<
    TaskTemplate,
    "title" | "description" | "starterCode" | "language"
  >,
): string {
  return [
    normalizeRoomLanguage(task.language),
    normalizeTaskText(task.title).toLowerCase(),
    normalizeTaskText(task.description),
    normalizeTaskText(task.starterCode),
  ].join("::");
}

function roomTaskSignature(
  task: Pick<RoomTask, "title" | "description" | "starterCode" | "language">,
): string {
  return taskSignature(task);
}

function useIsCompactRoomLayout(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [isCompact, setIsCompact] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompact(event.matches);
    };
    setIsCompact(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [query]);

  return isCompact;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTaskScores(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object") return {};
  const normalized: Record<string, number | null> = {};
  Object.entries(value as Record<string, unknown>).forEach(
    ([stepKey, scoreValue]) => {
      const stepIndex = Number.parseInt(stepKey, 10);
      if (!Number.isInteger(stepIndex) || stepIndex < 0) return;
      if (
        typeof scoreValue === "number" &&
        scoreValue >= 1 &&
        scoreValue <= 5
      ) {
        normalized[String(stepIndex)] = scoreValue;
        return;
      }
      normalized[String(stepIndex)] = null;
    },
  );
  return normalized;
}

function taskScoresFromTasks(
  tasks: Array<{ stepIndex: number; score?: number | null }>,
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  tasks.forEach((task) => {
    const score = task.score;
    result[String(task.stepIndex)] =
      typeof score === "number" && score >= 1 && score <= 5 ? score : null;
  });
  return result;
}

function normalizeRealtimeTask(value: unknown): RoomTask | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RoomTask>;
  const stepIndex =
    typeof candidate.stepIndex === "number"
      ? Math.floor(candidate.stepIndex)
      : -1;
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    return null;
  }
  const title =
    typeof candidate.title === "string" ? candidate.title.trim() : "";
  const description =
    typeof candidate.description === "string" ? candidate.description : "";
  const starterCode =
    typeof candidate.starterCode === "string" ? candidate.starterCode : "";
  const language = normalizeRoomLanguage(
    typeof candidate.language === "string" ? candidate.language : "nodejs",
  );
  const categoryName =
    typeof candidate.categoryName === "string" ? candidate.categoryName : null;
  const score =
    typeof candidate.score === "number" &&
    candidate.score >= 1 &&
    candidate.score <= 5
      ? candidate.score
      : null;
  const sourceTaskTemplateId =
    typeof candidate.sourceTaskTemplateId === "string"
      ? candidate.sourceTaskTemplateId
      : null;
  if (!title) return null;
  return {
    stepIndex,
    title,
    description,
    starterCode,
    language,
    categoryName,
    score,
    sourceTaskTemplateId,
  };
}

function normalizeNoteMessage(value: unknown): NoteMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NoteMessage> & {
    text?: unknown;
    timestampEpochMs?: unknown;
  };
  const id =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : "";
  const sessionId =
    typeof candidate.sessionId === "string" && candidate.sessionId.trim()
      ? candidate.sessionId.trim()
      : "";
  const displayName =
    typeof candidate.displayName === "string" && candidate.displayName.trim()
      ? candidate.displayName.trim()
      : "";
  const role =
    candidate.role === "owner" ||
    candidate.role === "interviewer" ||
    candidate.role === "candidate"
      ? candidate.role
      : null;
  const text = typeof candidate.text === "string" ? candidate.text : "";
  const timestampEpochMs =
    typeof candidate.timestampEpochMs === "number" &&
    Number.isFinite(candidate.timestampEpochMs)
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
    timestampEpochMs,
  };
}

function normalizePersonalNoteEntry(value: unknown): PersonalNoteEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PersonalNoteEntry> & {
    blockName?: unknown;
    blockStepIndex?: unknown;
    timestampEpochMs?: unknown;
  };
  const id =
    typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : "";
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const timestampEpochMs =
    typeof candidate.timestampEpochMs === "number" &&
    Number.isFinite(candidate.timestampEpochMs)
      ? Math.max(0, Math.floor(candidate.timestampEpochMs))
      : null;
  const rawBlockName =
    typeof candidate.blockName === "string" ? candidate.blockName : "";
  const blockName = rawBlockName.trim()
    ? rawBlockName.trim().slice(0, 80)
    : null;
  const blockStepIndex =
    typeof candidate.blockStepIndex === "number" &&
    Number.isInteger(candidate.blockStepIndex) &&
    candidate.blockStepIndex >= 0
      ? candidate.blockStepIndex
      : null;
  if (!id || !text || timestampEpochMs == null) return null;
  return {
    id,
    text,
    blockName,
    blockStepIndex,
    timestampEpochMs,
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
    timestampEpochMs: 0,
  };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map(normalizeNoteMessage)
        .filter((item): item is NoteMessage => Boolean(item));
    }
    if (parsed && typeof parsed === "object") {
      const messages = (parsed as { messages?: unknown }).messages;
      if (Array.isArray(messages)) {
        return messages
          .map(normalizeNoteMessage)
          .filter((item): item is NoteMessage => Boolean(item));
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

function getPrivateNoteBlockColor(blockName: string): (typeof PRIVATE_NOTE_BLOCK_COLORS)[number] {
  const normalized = blockName.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return "blue";
  const idx = hashString(normalized) % PRIVATE_NOTE_BLOCK_COLORS.length;
  return PRIVATE_NOTE_BLOCK_COLORS[idx] ?? "blue";
}

function formatNoteTimestamp(timestampEpochMs: number): string {
  if (!timestampEpochMs) return "—";
  return new Date(timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Билдер markdown-выгрузки приватных заметок и связанные хелперы живут в
 * `frontend/src/features/room/personalNotesExport.ts`. RoomPage импортирует
 * их под уже существующими именами.
 */
function guestNameKey(inviteCode: string) {
  return `guest_display_name_${inviteCode}`;
}

function readStoredDisplayName(inviteCode: string) {
  const roomScoped = (
    localStorage.getItem(guestNameKey(inviteCode)) ?? ""
  ).trim();
  if (roomScoped) return roomScoped;
  return "";
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
    ownerToken: ownerToken ?? undefined,
  });

  const initialStoredName = authToken
    ? authUser?.displayName?.trim() || readStoredDisplayName(inviteCode)
    : readStoredDisplayName(inviteCode);

  const [state, setState] = useState<RealtimeState | null>(null);
  const stateRef = useRef<RealtimeState | null>(null);
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState(() => initialStoredName);
  const [draftName, setDraftName] = useState(() => initialStoredName);
  const [candidateNameError, setCandidateNameError] = useState("");
  const [nameModalOpened, setNameModalOpened] = useState(
    () => !authToken && !initialStoredName,
  );
  const [noteComposer, setNoteComposer] = useState("");
  const [pendingNotes, setPendingNotes] = useState<PendingNoteMessage[]>([]);
  const [privateNoteComposer, setPrivateNoteComposer] = useState("");
  const [pendingPrivateNotes, setPendingPrivateNotes] = useState<
    PendingPersonalNoteEntry[]
  >([]);
  const [activePrivateBlock, setActivePrivateBlock] =
    useState<ActivePrivateBlock | null>(null);
  /**
   * Tracks which step we last auto-applied as the active block. We use this to
   * detect step changes coming from the local viewer's navigation and replace
   * the active block accordingly, even if the user previously closed it.
   *
   * Remote step changes (other interviewers in the same room) are deliberately
   * ignored here — see `localStepIntent` below.
   */
  const lastAutoStepBlockRef = useRef<number | null>(null);
  /**
   * Step that *this* viewer explicitly navigated to (or the step they joined
   * the room at). The personal-notes auto-block follows this, NOT the room's
   * `merged.currentStep`, so that one interviewer's navigation never steals
   * the active block from another interviewer mid-typing.
   *
   * `null` until the first room sync — then seeded once with the current
   * room step so a fresh viewer starts on the relevant block.
   */
  const [localStepIntent, setLocalStepIntent] = useState<number | null>(null);
  const [privateNotesExportModalOpened, setPrivateNotesExportModalOpened] =
    useState(false);
  const closePrivateNotesExportModal = useCallback(
    () => setPrivateNotesExportModalOpened(false),
    [],
  );
  /**
   * Регистрируем модалку экспорта в стеке Escape-слоёв: пока она открыта,
   * Esc сначала закрывает её, не задевая нижележащих слоёв (например,
   * выпадающее Mantine Menu участников).
   */
  useEscapeLayer(privateNotesExportModalOpened, closePrivateNotesExportModal);
  const [exportIncludeTimestamps, setExportIncludeTimestamps] = useState(false);
  const [exportIncludeFreeNotes, setExportIncludeFreeNotes] = useState(true);
  /**
   * Прогресс выгрузки заметок (`md`/`pdf`). `null` = выгрузки нет.
   * Нужен для единообразного UX: одна шкала и блокировка повторных
   * кликов для обоих форматов, без "фейкового" idle-лоадера.
   */
  const [exportProgress, setExportProgress] = useState<
    | null
    | { progress: number; label: string; format: "md" | "pdf" }
  >(null);
  const [briefingDraft, setBriefingDraft] = useState("");
  const [briefingDirty, setBriefingDirty] = useState(false);
  const [resyncSignal, setResyncSignal] = useState(0);
  const [awaitingRecoverySync, setAwaitingRecoverySync] = useState(false);
  const awaitingRecoverySyncRef = useRef(false);
  const roomOpenedTrackedInviteRef = useRef("");
  const previousParticipantsCountRef = useRef<number | null>(null);
  const firstCodeEditTrackedRef = useRef(false);
  const lastErrorMetricRef = useRef<{ message: string; at: number }>({
    message: "",
    at: 0,
  });
  const editorValueRef = useRef("");
  const briefingDebounceTimerRef = useRef<number | null>(null);
  const briefingStepKeyRef = useRef<string>("");

  useEffect(() => {
    trackEvent("prod_room_page_view", {
      invite_code_len: inviteCode.length,
      authenticated: Boolean(authToken),
    });
    setVisitParams({
      entrypoint: "room",
      invite_code_len: inviteCode.length,
    });
  }, [authToken, inviteCode]);

  useEffect(() => {
    firstCodeEditTrackedRef.current = false;
    roomOpenedTrackedInviteRef.current = "";
    previousParticipantsCountRef.current = null;
  }, [inviteCode]);

  useEffect(() => {
    const stored = readStoredDisplayName(inviteCode);
    const authDisplayName = authUser?.displayName?.trim() || "";
    const authNickname = authUser?.nickname?.trim() || "";
    const safeStoredDisplayName =
      stored && stored !== authNickname ? stored : "";

    const resolved = authToken
      ? authDisplayName || safeStoredDisplayName || "Участник"
      : stored;
    const shouldAskName = !authToken && !resolved;

    if (resolved) {
      if (authToken) {
        localStorage.setItem("display_name", resolved);
      } else {
        localStorage.setItem(guestNameKey(inviteCode), resolved);
      }
    }

    setDisplayName(resolved);
    setDraftName(resolved);
    setCandidateNameError("");
    setNameModalOpened(shouldAskName);
    setNoteComposer("");
    setPendingNotes([]);
    setPrivateNoteComposer("");
    setPendingPrivateNotes([]);
    setActivePrivateBlock(null);
    lastAutoStepBlockRef.current = null;
    setLocalStepIntent(null);
  }, [authToken, authUser?.displayName, authUser?.nickname, inviteCode]);

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
      personalNotes: [],
      briefingMarkdown: room.briefingMarkdown ?? "",
      tasks: [...(room.tasks ?? [])].sort(
        (left, right) => left.stepIndex - right.stepIndex,
      ),
      taskScores: taskScoresFromTasks(room.tasks ?? []),
      participants: [] as Participant[],
      isOwner: Boolean(room.isOwner),
      role: (room.role === "owner" || room.role === "interviewer"
        ? room.role
        : "candidate") as "owner" | "interviewer" | "candidate",
      canManageRoom: Boolean(room.canManageRoom),
      canGrantAccess: Boolean(room.canGrantAccess),
      notesLockedBySessionId: null,
      notesLockedByDisplayName: null,
      notesLockedUntilEpochMs: null,
      cursors: [],
      lastCandidateKey: null,
      candidateKeyHistory: [],
    };
  }, [room, state]);

  const mergedTasks = useMemo(() => {
    if (Array.isArray(merged?.tasks) && merged.tasks.length > 0) {
      return [...merged.tasks].sort(
        (left, right) => left.stepIndex - right.stepIndex,
      );
    }
    return [...(room?.tasks ?? [])].sort(
      (left, right) => left.stepIndex - right.stepIndex,
    );
  }, [merged?.tasks, room?.tasks]);

  const mergedNotes = merged?.notes ?? "";
  const mergedBriefingMarkdown = merged?.briefingMarkdown ?? "";
  const canManageRoom = merged?.canManageRoom ?? false;
  const { data: taskCatalogGroups = [] } = useTasksGroupedQuery(undefined, {
    skip: !authToken || !canManageRoom,
  });
  const [addRoomTasks, addRoomTasksState] = useAddRoomTasksMutation();
  const [updateRoomTask] = useUpdateRoomTaskMutation();
  const [deleteRoomTask] = useDeleteRoomTaskMutation();
  const availableCatalogTasks = useMemo(() => {
    if (!merged) return [];
    const roomTasks = mergedTasks;
    const existingTemplateIds = new Set(
      roomTasks
        .map((task) => task.sourceTaskTemplateId?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const existingSignatures = new Set(
      roomTasks.map((task) => roomTaskSignature(task)),
    );
    // По требованию: показываем все задачи пользователя независимо от языка
    // комнаты. Дедуп — только по уже добавленным в комнату задачам (по
    // template id и сигнатуре содержимого).
    return taskCatalogGroups
      .flatMap((group) => group.tasks)
      .filter((task) => !existingTemplateIds.has(task.id))
      .filter((task) => !existingSignatures.has(taskSignature(task)));
  }, [merged, mergedTasks, taskCatalogGroups]);
  const notesMessages = useMemo(() => {
    const direct = merged?.notesMessages;
    if (Array.isArray(direct) && direct.length > 0) {
      return direct
        .map(normalizeNoteMessage)
        .filter((item): item is NoteMessage => Boolean(item));
    }
    return parseNotesThread(mergedNotes);
  }, [merged?.notesMessages, mergedNotes]);

  useEffect(() => {
    if (!merged) return;
    const stepKey = `${merged.inviteCode}:${merged.currentStep}`;
    const stepChanged = briefingStepKeyRef.current !== stepKey;
    if (stepChanged) {
      briefingStepKeyRef.current = stepKey;
      if (briefingDebounceTimerRef.current != null) {
        window.clearTimeout(briefingDebounceTimerRef.current);
        briefingDebounceTimerRef.current = null;
      }
      setBriefingDirty(false);
      setBriefingDraft(mergedBriefingMarkdown);
      return;
    }
    if (!briefingDirty) {
      setBriefingDraft(mergedBriefingMarkdown);
    }
  }, [briefingDirty, merged, mergedBriefingMarkdown]);
  const visibleNotes = useMemo(() => {
    const serverIds = new Set(notesMessages.map((message) => message.id));
    const next = [
      ...notesMessages,
      ...pendingNotes.filter((message) => !serverIds.has(message.id)),
    ];
    return next.sort(
      (a, b) =>
        a.timestampEpochMs - b.timestampEpochMs || a.id.localeCompare(b.id),
    );
  }, [notesMessages, pendingNotes]);
  const personalNotes = useMemo(() => {
    return (merged?.personalNotes ?? [])
      .map(normalizePersonalNoteEntry)
      .filter((item): item is PersonalNoteEntry => Boolean(item))
      .sort(
        (left, right) =>
          left.timestampEpochMs - right.timestampEpochMs ||
          left.id.localeCompare(right.id),
      );
  }, [merged?.personalNotes]);
  /** Server entries plus optimistic pending ones, deduped by id. */
  const visiblePersonalNotes = useMemo(() => {
    const serverIds = new Set(personalNotes.map((entry) => entry.id));
    const merged = [
      ...personalNotes,
      ...pendingPrivateNotes.filter((entry) => !serverIds.has(entry.id)),
    ];
    return merged.sort(
      (left, right) =>
        left.timestampEpochMs - right.timestampEpochMs ||
        left.id.localeCompare(right.id),
    );
  }, [personalNotes, pendingPrivateNotes]);
  /** Per-task counters used by the step list ("заметки N"). */
  const privateNotesCountByStep = useMemo(() => {
    const counts = new Map<number, number>();
    visiblePersonalNotes.forEach((entry) => {
      const stepIndex = entry.blockStepIndex;
      if (typeof stepIndex !== "number") return;
      counts.set(stepIndex, (counts.get(stepIndex) ?? 0) + 1);
    });
    return counts;
  }, [visiblePersonalNotes]);
  /**
   * UI label and step pointer for the active private block. For step blocks
   * the label is `Шаг N` (export augments it with the task title).
   */
  const activePrivateBlockInfo = useMemo(() => {
    if (!activePrivateBlock) return null;
    if (activePrivateBlock.kind === "step") {
      return {
        kind: "step" as const,
        stepIndex: activePrivateBlock.stepIndex,
        label: formatStepBlockLabel(activePrivateBlock.stepIndex),
      };
    }
    return {
      kind: "custom" as const,
      stepIndex: null as number | null,
      label: activePrivateBlock.name,
    };
  }, [activePrivateBlock]);
  const activePrivateBlockName = activePrivateBlockInfo?.label ?? null;

  /**
   * Seed `localStepIntent` once per room from the current room step.
   * Subsequent step changes by *other* interviewers must not move this
   * viewer's intent — only their own navigation does (see
   * `selectStepLocally`). Without this, a remote step switch would move
   * everyone's notes block at the same time, kicking other interviewers
   * out of whatever they were typing.
   */
  useEffect(() => {
    if (!merged) return;
    if (localStepIntent !== null) return;
    setLocalStepIntent(merged.currentStep);
  }, [merged, localStepIntent]);

  /**
   * Keep the active private block in lock-step with the *local* viewer's
   * step intent:
   * - On local step navigation, replace the active block with
   *   `{kind: "step"}` for the new step (overrides any custom or closed
   *   state, per product spec).
   * - Remote step changes from other interviewers do NOT trigger this —
   *   `localStepIntent` is the only step source we react to here.
   * - If the room has no tasks, fall back to no active block.
   * The user can still close the block via the cross icon on the badge or
   * switch to a custom block; the next *local* step change re-arms the
   * step block.
   */
  useEffect(() => {
    if (!merged || !canManageRoom) {
      lastAutoStepBlockRef.current = null;
      return;
    }
    if (mergedTasks.length === 0) {
      if (activePrivateBlock != null) setActivePrivateBlock(null);
      lastAutoStepBlockRef.current = null;
      return;
    }
    if (localStepIntent === null) return;
    const stepHasTask = mergedTasks.some(
      (task) => task.stepIndex === localStepIntent,
    );
    if (!stepHasTask) return;
    if (lastAutoStepBlockRef.current === localStepIntent) return;
    lastAutoStepBlockRef.current = localStepIntent;
    setActivePrivateBlock({ kind: "step", stepIndex: localStepIntent });
  }, [
    activePrivateBlock,
    canManageRoom,
    localStepIntent,
    merged,
    mergedTasks,
  ]);

  const currentSyncKey = useMemo(() => {
    if (!merged) return `${inviteCode}:0:nodejs`;
    return `${merged.inviteCode}:${merged.currentStep}:${merged.language}`;
  }, [inviteCode, merged]);
  const syncKeyRef = useRef(currentSyncKey);
  const sessionIdRef = useRef<string>("");
  const localParticipantIdentityKeyRef = useRef<string | null>(null);
  const yjsPendingUpdatesRef = useRef<
    Array<{ syncKey: string; update: string }>
  >([]);
  const yjsApplyUpdateRef = useRef<((yjsUpdate: string) => void) | null>(null);
  const lastKnownServerYjsSequenceRef = useRef(0);
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
    const nextSequence =
      typeof merged?.lastYjsSequence === "number" &&
      Number.isFinite(merged.lastYjsSequence)
        ? Math.max(0, Math.floor(merged.lastYjsSequence))
        : 0;
    lastKnownServerYjsSequenceRef.current = nextSequence;
  }, [merged?.lastYjsSequence]);

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
    awaitingRecoverySyncRef.current = true;
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
    awaitingRecoverySyncRef.current = false;
    if (recoverySyncTimeoutRef.current != null) {
      window.clearTimeout(recoverySyncTimeoutRef.current);
      recoverySyncTimeoutRef.current = null;
    }
    setAwaitingRecoverySync(false);
  }, []);

  const onState = useCallback(
    (incoming: RealtimeState) => {
      const previousState = stateRef.current;
      const previousCursorByIdentity = new Map(
        (previousState?.cursors ?? []).map((cursor) => [
          participantIdentityKey(cursor) ?? `session:${cursor.sessionId}`,
          cursor,
        ]),
      );
      const participants = (incoming.participants ?? []).map((participant) => ({
        ...participant,
        role: participant.role ?? "candidate",
      }));
      const participantBySessionId = new Map(
        participants.map((participant) => [participant.sessionId, participant]),
      );
      const cursorsFromSync = (incoming.cursors ?? []).map((cursor) => {
        const participantMeta = participantBySessionId.get(cursor.sessionId);
        const normalizedRole =
          cursor.role ?? participantMeta?.role ?? "candidate";
        const nextCursorSequence =
          typeof cursor.cursorSequence === "number"
            ? cursor.cursorSequence
            : null;
        const normalizedCursor: CursorInfo = {
          ...cursor,
          role: normalizedRole,
          userId: normalizeIdentityValue(
            cursor.userId ?? participantMeta?.userId,
          ),
          participantId: normalizeIdentityValue(
            cursor.participantId ?? participantMeta?.participantId,
          ),
          cursorSequence: nextCursorSequence,
          lastSeenAtEpochMs: null,
        };
        const cursorIdentity =
          participantIdentityKey(normalizedCursor) ??
          `session:${normalizedCursor.sessionId}`;
        const previousCursor = previousCursorByIdentity.get(cursorIdentity);
        const previousCursorSequence =
          typeof previousCursor?.cursorSequence === "number"
            ? previousCursor.cursorSequence
            : null;
        const shouldKeepPreviousCursor =
          !!previousCursor &&
          ((previousCursorSequence != null &&
            nextCursorSequence != null &&
            nextCursorSequence < previousCursorSequence) ||
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
            displayName:
              normalizedCursor.displayName ?? previousCursor.displayName,
            userId: normalizedCursor.userId ?? previousCursor.userId ?? null,
            participantId:
              normalizedCursor.participantId ??
              previousCursor.participantId ??
              null,
            role: normalizedRole,
          };
        }
        return {
          ...normalizedCursor,
          lastSeenAtEpochMs: previousCursor?.lastSeenAtEpochMs ?? null,
        };
      });
      const mergedCursorIds = new Set(
        cursorsFromSync.map(
          (c) => participantIdentityKey(c) ?? `session:${c.sessionId}`,
        ),
      );
      const cursorsMissingFromSync = (previousState?.cursors ?? []).filter(
        (c) =>
          !mergedCursorIds.has(
            participantIdentityKey(c) ?? `session:${c.sessionId}`,
          ),
      );
      const cursors = mergeCursorsByIdentity([
        ...cursorsFromSync,
        ...cursorsMissingFromSync,
      ]).filter((cursor) => {
        const identityKey = participantIdentityKey(cursor);
        if (!identityKey) return true;
        return identityKey !== localParticipantIdentityKeyRef.current;
      });
      const taskScores = normalizeTaskScores(incoming.taskScores);
      const nextTasks = Array.isArray(incoming.tasks)
        ? incoming.tasks
            .map(normalizeRealtimeTask)
            .filter((item): item is RoomTask => Boolean(item))
            .sort((left, right) => left.stepIndex - right.stepIndex)
        : (previousState?.tasks ?? []);
      const nextState: RealtimeState = {
        ...incoming,
        language: normalizeRoomLanguage(incoming.language),
        tasks: nextTasks,
        participants,
        cursors,
        taskScores,
        lastCodeUpdatedBySessionId: incoming.lastCodeUpdatedBySessionId ?? null,
        yjsDocumentBase64:
          typeof incoming.yjsDocumentBase64 === "string"
            ? incoming.yjsDocumentBase64
            : null,
        lastYjsSequence:
          typeof incoming.lastYjsSequence === "number"
            ? incoming.lastYjsSequence
            : 0,
        notesMessages: Array.isArray(incoming.notesMessages)
          ? incoming.notesMessages
              .map(normalizeNoteMessage)
              .filter((item): item is NoteMessage => Boolean(item))
          : [],
        personalNotes: Array.isArray(incoming.personalNotes)
          ? incoming.personalNotes
              .map(normalizePersonalNoteEntry)
              .filter((item): item is PersonalNoteEntry => Boolean(item))
              .sort(
                (left, right) =>
                  left.timestampEpochMs - right.timestampEpochMs ||
                  left.id.localeCompare(right.id),
              )
          : [],
        briefingMarkdown:
          typeof incoming.briefingMarkdown === "string"
            ? incoming.briefingMarkdown
            : "",
        canGrantAccess: Boolean(incoming.canGrantAccess),
        lastCandidateKey: incoming.lastCandidateKey ?? null,
        candidateKeyHistory: Array.isArray(incoming.candidateKeyHistory)
          ? incoming.candidateKeyHistory
          : incoming.lastCandidateKey
            ? [incoming.lastCandidateKey]
            : [],
      };
      lastKnownServerYjsSequenceRef.current =
        typeof nextState.lastYjsSequence === "number" &&
        Number.isFinite(nextState.lastYjsSequence)
          ? Math.max(0, Math.floor(nextState.lastYjsSequence))
          : 0;
      const previousSyncKey = previousState
        ? `${previousState.inviteCode}:${previousState.currentStep}:${previousState.language}`
        : null;
      const nextSyncKey = `${nextState.inviteCode}:${nextState.currentStep}:${nextState.language}`;
      const syncContextChanged =
        previousSyncKey !== null && previousSyncKey !== nextSyncKey;
      const shouldForceHydrateFromState =
        awaitingRecoverySyncRef.current || syncContextChanged;
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
          fromSession: nextState.lastCodeUpdatedBySessionId,
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
    },
    [clearRecoverySyncPending],
  );

  const onEditorValueChange = useCallback((value: string) => {
    editorValueRef.current = value;
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
    const normalized = message.trim();
    if (!normalized) return;
    const now = Date.now();
    const previous = lastErrorMetricRef.current;
    if (previous.message === normalized && now - previous.at < 3000) return;
    lastErrorMetricRef.current = { message: normalized, at: now };
    trackEvent("prod_room_error", {
      message: normalized.slice(0, 120),
    });
  }, []);

  const onCursorUpdate = useCallback((incomingCursor: CursorInfo) => {
    debugCursorLog("socket:cursor_update:incoming", {
      sessionId: incomingCursor?.sessionId,
      lineNumber: incomingCursor?.lineNumber,
      column: incomingCursor?.column,
      selectionStartLineNumber:
        incomingCursor?.selectionStartLineNumber ?? null,
      selectionStartColumn: incomingCursor?.selectionStartColumn ?? null,
      selectionEndLineNumber: incomingCursor?.selectionEndLineNumber ?? null,
      selectionEndColumn: incomingCursor?.selectionEndColumn ?? null,
      cursorSequence: incomingCursor?.cursorSequence ?? null,
    });
    setState((previous) => {
      if (!previous) return previous;
      if (
        !incomingCursor?.sessionId ||
        incomingCursor.sessionId === sessionIdRef.current
      ) {
        return previous;
      }

      const normalizedCursor: CursorInfo = {
        ...incomingCursor,
        role: incomingCursor.role ?? "candidate",
        userId: normalizeIdentityValue(incomingCursor.userId),
        participantId: normalizeIdentityValue(incomingCursor.participantId),
        cursorSequence:
          typeof incomingCursor.cursorSequence === "number"
            ? incomingCursor.cursorSequence
            : null,
        lastSeenAtEpochMs: Date.now(),
      };
      const incomingIdentityKey =
        participantIdentityKey(normalizedCursor) ??
        `session:${normalizedCursor.sessionId}`;
      if (incomingIdentityKey === localParticipantIdentityKeyRef.current) {
        return previous;
      }
      const currentCursors = previous.cursors ?? [];
      const existingIndex = currentCursors.findIndex((cursor) => {
        const existingIdentityKey =
          participantIdentityKey(cursor) ?? `session:${cursor.sessionId}`;
        return existingIdentityKey === incomingIdentityKey;
      });
      if (existingIndex < 0) {
        const nextCursors = mergeCursorsByIdentity([
          ...currentCursors,
          normalizedCursor,
        ]);
        return { ...previous, cursors: nextCursors };
      }

      const existing = currentCursors[existingIndex];
      const nextSequence =
        typeof normalizedCursor.cursorSequence === "number"
          ? normalizedCursor.cursorSequence
          : null;
      const previousSequence =
        typeof existing.cursorSequence === "number"
          ? existing.cursorSequence
          : null;
      const staleBySequence =
        (previousSequence != null &&
          nextSequence != null &&
          nextSequence <= previousSequence) ||
        (previousSequence != null && nextSequence == null);
      if (staleBySequence) {
        debugCursorLog("socket:cursor_update:dropped_stale", {
          sessionId: normalizedCursor.sessionId,
          nextSequence,
          previousSequence,
        });
        return previous;
      }

      const unchanged =
        existing.displayName === normalizedCursor.displayName &&
        existing.role === normalizedCursor.role &&
        existing.cursorSequence === normalizedCursor.cursorSequence &&
        existing.lineNumber === normalizedCursor.lineNumber &&
        existing.column === normalizedCursor.column &&
        existing.selectionStartLineNumber ===
          normalizedCursor.selectionStartLineNumber &&
        existing.selectionStartColumn ===
          normalizedCursor.selectionStartColumn &&
        existing.selectionEndLineNumber ===
          normalizedCursor.selectionEndLineNumber &&
        existing.selectionEndColumn === normalizedCursor.selectionEndColumn;
      if (unchanged) {
        debugCursorLog("socket:cursor_update:dropped_unchanged", {
          sessionId: normalizedCursor.sessionId,
          cursorSequence: normalizedCursor.cursorSequence ?? null,
        });
        return previous;
      }

      const nextCursors = [...currentCursors];
      nextCursors[existingIndex] = pickPreferredCursor(
        existing,
        normalizedCursor,
      );
      return { ...previous, cursors: mergeCursorsByIdentity(nextCursors) };
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

      const timestampEpochMs =
        typeof incomingKey.timestampEpochMs === "number"
          ? incomingKey.timestampEpochMs
          : Date.now();
      const normalizedKey: CandidateKeyInfo = {
        ...incomingKey,
        timestampEpochMs,
      };
      const dedupeToken = [
        normalizedKey.sessionId,
        normalizedKey.timestampEpochMs,
        normalizedKey.key,
        normalizedKey.keyCode,
        normalizedKey.ctrlKey ? "1" : "0",
        normalizedKey.altKey ? "1" : "0",
        normalizedKey.shiftKey ? "1" : "0",
        normalizedKey.metaKey ? "1" : "0",
        normalizedKey.eventKind ?? "keydown",
      ].join(":");

      const hasDuplicate = (previous.candidateKeyHistory ?? []).some(
        (entry) => {
          const entryToken = [
            entry.sessionId,
            entry.timestampEpochMs,
            entry.key,
            entry.keyCode,
            entry.ctrlKey ? "1" : "0",
            entry.altKey ? "1" : "0",
            entry.shiftKey ? "1" : "0",
            entry.metaKey ? "1" : "0",
            entry.eventKind ?? "keydown",
          ].join(":");
          return entryToken === dedupeToken;
        },
      );

      const currentHistory = previous.candidateKeyHistory ?? [];
      const nextHistory = hasDuplicate
        ? currentHistory
        : [normalizedKey, ...currentHistory].slice(0, LOG_HISTORY_LIMIT);
      const previousLastTimestamp =
        previous.lastCandidateKey?.timestampEpochMs ?? 0;
      const nextLastCandidateKey =
        timestampEpochMs >= previousLastTimestamp
          ? normalizedKey
          : previous.lastCandidateKey;

      if (hasDuplicate && nextLastCandidateKey === previous.lastCandidateKey) {
        return previous;
      }

      return {
        ...previous,
        lastCandidateKey: nextLastCandidateKey,
        candidateKeyHistory: nextHistory,
      };
    });
  }, []);

  const onRecoveryStateSync = useCallback(
    (lastYjsSequence: number) => {
      trackEvent("prod_recovery_sync_completed", {
        yjs_sequence: lastYjsSequence,
      });
      clearRecoverySyncPending();
      setResyncSignal((value) => value + 1);
    },
    [clearRecoverySyncPending],
  );

  /** Peers: incremental Yjs relay. Server still owns DB + state_sync snapshots (recovery / tabs). */
  const onYjsUpdate = useCallback(
    (payload: {
      sessionId: string;
      yjsUpdate: string;
      syncKey?: string | null;
      yjsSequence?: number | null;
    }) => {
      const update = payload.yjsUpdate?.trim();
      if (!update) return;
      const incomingSyncKey = payload.syncKey?.trim() || syncKeyRef.current;
      if (incomingSyncKey !== syncKeyRef.current) {
        return;
      }
      roomSyncLog("sse:yjs_update_incremental", {
        fromSession: payload.sessionId,
        yjsSequence: payload.yjsSequence ?? null,
      });
      if (yjsApplyUpdateRef.current) {
        yjsApplyUpdateRef.current(update);
        return;
      }
      yjsPendingUpdatesRef.current.push({ syncKey: incomingSyncKey, update });
      if (yjsPendingUpdatesRef.current.length > 200) {
        yjsPendingUpdatesRef.current.splice(
          0,
          yjsPendingUpdatesRef.current.length - 200,
        );
      }
    },
    [],
  );

  const onYjsBridgeReady = useCallback(
    (applyUpdate: ((yjsUpdate: string) => void) | null) => {
      yjsApplyUpdateRef.current = applyUpdate;
      if (!applyUpdate) return;
      const targetSyncKey = syncKeyRef.current;
      const pending = yjsPendingUpdatesRef.current.splice(
        0,
        yjsPendingUpdatesRef.current.length,
      );
      pending
        .filter((item) => item.syncKey === targetSyncKey)
        .forEach((item) => applyUpdate(item.update));
    },
    [],
  );

  const onAwarenessBridgeReady = useCallback(
    (applyFn: ((b64: string) => void) | null) => {
      awarenessApplyRef.current = applyFn;
      if (!applyFn) return;
      const pending = awarenessPendingRef.current.splice(
        0,
        awarenessPendingRef.current.length,
      );
      pending.forEach((b64) => applyFn(b64));
    },
    [],
  );

  const onAwarenessUpdateSocket = useCallback(
    (payload: {
      sessionId: string;
      userId?: string | null;
      participantId?: string | null;
      awarenessUpdate: string;
    }) => {
      if (payload.sessionId === sessionIdRef.current) return;
      const incomingIdentityKey = participantIdentityKey({
        userId: payload.userId ?? null,
        participantId: payload.participantId ?? null,
        sessionId: payload.sessionId,
      });
      if (
        incomingIdentityKey &&
        incomingIdentityKey === localParticipantIdentityKeyRef.current
      ) {
        return;
      }
      const b64 = payload.awarenessUpdate?.trim() ?? "";
      if (!b64) return;
      if (awarenessApplyRef.current) {
        awarenessApplyRef.current(b64);
        return;
      }
      awarenessPendingRef.current.push(b64);
      if (awarenessPendingRef.current.length > 200) {
        awarenessPendingRef.current.splice(
          0,
          awarenessPendingRef.current.length - 200,
        );
      }
    },
    [],
  );

  const fallbackDisplayName = authUser?.displayName?.trim() || "Участник";
  const effectiveDisplayName = displayName.trim() || fallbackDisplayName;
  const canConnect =
    Boolean(inviteCode) && (Boolean(authToken) || Boolean(displayName.trim()));
  const {
    connected,
    participantId,
    sessionId,
    sendLanguageUpdate,
    sendSetStep,
    sendTaskRatingUpdate,
    sendNoteMessage,
    sendPrivateNoteEntry,
    sendBriefingUpdate,
    sendGrantInterviewerAccess,
    sendRevokeInterviewerAccess,
    sendAwarenessUpdate,
    sendYjsUpdate,
    sendKeyPress,
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
    onRequireRecoverySync: markRecoverySyncPending,
  });
  useEffect(() => {
    sessionIdRef.current = sessionId;
    localParticipantIdentityKeyRef.current = participantIdentityKey({
      userId: authUser?.id ?? null,
      participantId,
      sessionId,
    });
  }, [authUser?.id, participantId, sessionId]);

  /**
   * Локальная навигация по шагам интервью. Кроме отправки `set_step` на
   * сервер, обновляет `localStepIntent` — это единственный триггер для
   * автосмены активного блока в личных заметках. Чужая навигация (другой
   * интервьюер кликнул шаг) сюда не доходит, поэтому их клик не сбивает
   * нам активный блок и текущую запись.
   */
  const selectStepLocally = useCallback(
    (stepIndex: number) => {
      setLocalStepIntent(stepIndex);
      sendSetStep(stepIndex);
    },
    [sendSetStep],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (pendingNotes.length === 0) return;
    const serverIds = new Set(notesMessages.map((message) => message.id));
    if (serverIds.size === 0) return;
    setPendingNotes((current) => {
      const next = current.filter((message) => !serverIds.has(message.id));
      return next.length === current.length ? current : next;
    });
  }, [notesMessages, pendingNotes.length]);

  useEffect(() => {
    if (pendingPrivateNotes.length === 0) return;
    const serverIds = new Set(personalNotes.map((entry) => entry.id));
    if (serverIds.size === 0) return;
    setPendingPrivateNotes((current) => {
      const next = current.filter((entry) => !serverIds.has(entry.id));
      return next.length === current.length ? current : next;
    });
  }, [pendingPrivateNotes.length, personalNotes]);

  useEffect(() => {
    if (briefingDirty && briefingDraft === mergedBriefingMarkdown) {
      setBriefingDirty(false);
    }
  }, [briefingDirty, briefingDraft, mergedBriefingMarkdown]);

  const sendYjsUpdateTracked = useCallback(
    (
      yjsUpdate: string,
      syncKey?: string | null,
      codeSnapshot?: string | null,
      yjsDocumentBase64?: string | null,
      baseServerYjsSequenceHint?: number | null,
    ) => {
      const update = yjsUpdate.trim();
      const docSnap = yjsDocumentBase64?.trim() ?? "";
      if (!update && !docSnap) return;
      const normalizedSyncKey = syncKey?.trim() ?? "";
      const now = Date.now();
      const dedupeKey = docSnap
        ? `${normalizedSyncKey}::snap::${docSnap.length}::${docSnap.slice(0, 120)}`
        : `${normalizedSyncKey}::${update}`;
      recentLocalYjsUpdatesRef.current.set(dedupeKey, now);
      recentLocalYjsUpdatesRef.current.forEach((timestamp, key) => {
        if (now - timestamp > 15_000) {
          recentLocalYjsUpdatesRef.current.delete(key);
        }
      });
      const normalizedBaseServerYjsSequenceHint =
        typeof baseServerYjsSequenceHint === "number" &&
        Number.isFinite(baseServerYjsSequenceHint)
          ? Math.max(0, Math.floor(baseServerYjsSequenceHint))
          : null;
      let baseServerYjsSequence = lastKnownServerYjsSequenceRef.current;
      if (
        normalizedBaseServerYjsSequenceHint != null &&
        normalizedBaseServerYjsSequenceHint > baseServerYjsSequence
      ) {
        baseServerYjsSequence = normalizedBaseServerYjsSequenceHint;
      }
      sendYjsUpdate(
        update,
        normalizedSyncKey || null,
        codeSnapshot ?? null,
        docSnap || null,
        baseServerYjsSequence,
      );
      if (update) {
        if (!firstCodeEditTrackedRef.current) {
          firstCodeEditTrackedRef.current = true;
          trackEvent("prod_first_code_edit", {
            invite_code_len: inviteCode.length,
          });
        }
        lastKnownServerYjsSequenceRef.current = baseServerYjsSequence + 1;
      }
    },
    [inviteCode, sendYjsUpdate],
  );

  const hasRealtimeState = Boolean(state);
  const participantsCount = state?.participants.length ?? 0;

  useEffect(() => {
    if (!merged) return;
    if (roomOpenedTrackedInviteRef.current === inviteCode) return;
    roomOpenedTrackedInviteRef.current = inviteCode;
    trackEvent("prod_room_opened", {
      invite_code_len: inviteCode.length,
      role: merged.role,
      can_manage_room: merged.canManageRoom,
      has_realtime_state: hasRealtimeState,
      has_yjs_snapshot: Boolean(merged.yjsDocumentBase64),
      step: merged.currentStep,
    });
  }, [hasRealtimeState, inviteCode, merged]);

  useEffect(() => {
    if (!hasRealtimeState) return;
    const previousCount = previousParticipantsCountRef.current;
    if (previousCount == null) {
      previousParticipantsCountRef.current = participantsCount;
      return;
    }
    if (previousCount === participantsCount) return;
    trackEvent("prod_participants_count_changed", {
      participants: participantsCount,
      delta: participantsCount - previousCount,
    });
    if (previousCount < 2 && participantsCount >= 2) {
      trackEvent("prod_second_participant_joined", {
        participants: participantsCount,
      });
    }
    previousParticipantsCountRef.current = participantsCount;
  }, [hasRealtimeState, participantsCount]);

  // Yjs bootstrap must start from authoritative realtime state to avoid CRDT duplicate inserts
  // when REST `room.code` races with later state_sync snapshot delivery.
  const editorReady = Boolean(state);

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
      pending: true,
    };
    setPendingNotes((current) => [...current, optimisticMessage]);
    setNoteComposer("");
    sendNoteMessage(noteId, text, timestampEpochMs);
    trackEvent("prod_note_sent", {
      role: merged.role,
      text_len: text.length,
    });
  }, [
    canManageRoom,
    effectiveDisplayName,
    merged,
    noteComposer,
    sendNoteMessage,
    sessionId,
  ]);

  /**
   * Maps a raw block name (typed by the user or chosen from suggestions) to
   * either a step block (when the name matches `Шаг N` and N is a real step)
   * or a custom block.
   */
  const resolveBlockFromName = useCallback(
    (rawName: string): ActivePrivateBlock | null => {
      const trimmed = rawName.trim().slice(0, 80);
      if (!trimmed) return null;
      const stepIndex = parseStepBlockName(trimmed);
      if (stepIndex != null && stepIndex < mergedTasks.length) {
        return { kind: "step", stepIndex };
      }
      return { kind: "custom", name: trimmed };
    },
    [mergedTasks.length],
  );

  const submitPrivateNoteEntry = useCallback(() => {
    if (!merged || !canManageRoom) return;
    const parsedCommand = parsePersonalNotesCommand(privateNoteComposer);
    if (parsedCommand.kind === "block_apply") {
      const next = resolveBlockFromName(parsedCommand.blockName);
      if (next) setActivePrivateBlock(next);
      setPrivateNoteComposer("");
      return;
    }
    if (
      parsedCommand.kind === "menu" ||
      parsedCommand.kind === "block_prompt" ||
      parsedCommand.kind === "unknown"
    ) {
      return;
    }
    const text = privateNoteComposer.trim();
    if (!text) return;
    const timestampEpochMs = Date.now();
    const noteId = crypto.randomUUID();
    const blockName = activePrivateBlockInfo?.label ?? null;
    const blockStepIndex = activePrivateBlockInfo?.stepIndex ?? null;
    const optimisticEntry: PendingPersonalNoteEntry = {
      id: noteId,
      text,
      blockName,
      blockStepIndex,
      timestampEpochMs,
      pending: true,
    };
    setPendingPrivateNotes((current) => [...current, optimisticEntry]);
    setPrivateNoteComposer("");
    sendPrivateNoteEntry(
      noteId,
      text,
      timestampEpochMs,
      blockName,
      blockStepIndex,
    );
  }, [
    activePrivateBlock,
    activePrivateBlockInfo,
    canManageRoom,
    merged,
    privateNoteComposer,
    resolveBlockFromName,
    sendPrivateNoteEntry,
  ]);

  const applyPrivateNotesCommandShortcut = useCallback(
    (command: string) => {
      if (!merged) return;
      const normalized = command.trim();
      if (normalized === "/block") {
        setPrivateNoteComposer("/block ");
        return;
      }
      if (normalized.toLowerCase().startsWith("/block ")) {
        const blockName = normalized.slice("/block ".length).trim();
        if (!blockName) return;
        const next = resolveBlockFromName(blockName);
        if (next) setActivePrivateBlock(next);
        setPrivateNoteComposer("");
      }
    },
    [merged, resolveBlockFromName],
  );

  /** Закрытие активного блока теперь делается крестиком на бейдже. */
  const closeActivePrivateBlock = useCallback(() => {
    setActivePrivateBlock(null);
  }, []);

  const exportPersonalNotesMarkdown = useCallback(async () => {
    if (!merged) return;
    if (exportProgress !== null) return;
    setExportProgress({
      progress: 0,
      label: "Готовим markdown",
      format: "md",
    });
    const markdownFileName = buildRoomExportFileName(room?.title, "md");
    const markdown = buildPersonalNotesMarkdownDocument(
      mergedTasks.map((task) => ({
        stepIndex: task.stepIndex,
        title: task.title,
      })),
      visiblePersonalNotes,
      {
        includeTimestamps: exportIncludeTimestamps,
        includeFreeNotes: exportIncludeFreeNotes,
      },
      merged.taskScores,
      room?.title,
    );
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    triggerBrowserDownload(blob, markdownFileName);
    setExportProgress({
      progress: 1,
      label: "Файл готов, начинаем скачивание",
      format: "md",
    });
    await new Promise((resolve) => window.setTimeout(resolve, 280));
    setExportProgress(null);
  }, [
    exportProgress,
    exportIncludeFreeNotes,
    exportIncludeTimestamps,
    merged,
    room?.title,
    mergedTasks,
    visiblePersonalNotes,
  ]);

  const exportPersonalNotesPdf = useCallback(async () => {
    if (!merged) return;
    if (exportProgress !== null) return; // Защита от повторного клика.
    setExportProgress({
      progress: 0,
      label: "Готовим документ",
      format: "pdf",
    });
    try {
      const markdown = buildPersonalNotesMarkdownDocument(
        mergedTasks.map((task) => ({
          stepIndex: task.stepIndex,
          title: task.title,
        })),
        visiblePersonalNotes,
        {
          includeTimestamps: exportIncludeTimestamps,
          includeFreeNotes: exportIncludeFreeNotes,
        },
        merged.taskScores,
        room?.title,
      );
      await renderPersonalNotesPdf({
        markdown,
        fileName: buildRoomExportFileName(room?.title, "pdf"),
        onProgress: (progress, label) => {
          setExportProgress({ progress, label, format: "pdf" });
        },
      });
      setExportProgress({
        progress: 1,
        label: "Файл готов, начинаем скачивание",
        format: "pdf",
      });
      // Keep success state briefly so modal UI doesn't "jump" right after completion.
      await new Promise((resolve) => window.setTimeout(resolve, 380));
    } catch (error) {
      console.error("PRIVATE_NOTES_PDF_EXPORT_FAIL", error);
    } finally {
      setExportProgress(null);
    }
  }, [
    exportProgress,
    exportIncludeFreeNotes,
    exportIncludeTimestamps,
    merged,
    room?.title,
    mergedTasks,
    visiblePersonalNotes,
  ]);

  const changeBriefingMarkdown = useCallback(
    (value: string) => {
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
    },
    [canManageRoom, sendBriefingUpdate],
  );

  const addTasksFromCatalog = useCallback(
    async (taskIds: string[]) => {
      if (!merged) return;
      const normalizedTaskIds = Array.from(
        new Set(
          taskIds
            .map((taskId) => taskId.trim())
            .filter((taskId) => taskId.length > 0),
        ),
      );
      if (normalizedTaskIds.length === 0) return;
      trackEvent("prod_room_tasks_add_submit", {
        tasks_count: normalizedTaskIds.length,
      });
      try {
        setError("");
        await addRoomTasks({
          inviteCode: merged.inviteCode,
          taskIds: normalizedTaskIds,
          customTasks: [],
          ownerToken: ownerToken ?? undefined,
        }).unwrap();
        trackEvent("prod_room_tasks_add_success", {
          tasks_count: normalizedTaskIds.length,
        });
      } catch {
        setError("Не удалось добавить задачи в комнату");
        trackEvent("prod_room_tasks_add_failed", {
          tasks_count: normalizedTaskIds.length,
        });
        throw new Error("room_task_append_failed");
      }
    },
    [addRoomTasks, merged, ownerToken],
  );

  const addCustomTaskToRoom = useCallback(
    async (task: RoomCustomTaskDraft) => {
      if (!merged) return;
      const title = task.title.trim();
      const description = task.description.trim();
      const language = normalizeRoomLanguage(task.language);
      if (!title) {
        trackEvent("prod_room_custom_task_add_failed", {
          reason: "validation_failed",
        });
        throw new Error("room_custom_task_validation_failed");
      }
      trackEvent("prod_room_custom_task_add_submit", {
        title_len: title.length,
        description_len: description.length,
        language,
      });
      try {
        setError("");
        await addRoomTasks({
          inviteCode: merged.inviteCode,
          taskIds: [],
          customTasks: [
            {
              title,
              description,
              starterCode: task.starterCode,
              language,
            },
          ],
          ownerToken: ownerToken ?? undefined,
        }).unwrap();
        trackEvent("prod_room_custom_task_add_success", {
          title_len: title.length,
          language,
        });
      } catch {
        setError("Не удалось добавить задачу в комнату");
        trackEvent("prod_room_custom_task_add_failed", {
          reason: "request_failed",
        });
        throw new Error("room_custom_task_append_failed");
      }
    },
    [addRoomTasks, merged, ownerToken],
  );

  /**
   * Edit only the title of an existing in-room task. Validates non-empty,
   * forwards to the dedicated PATCH endpoint, and surfaces failure via the
   * shared room error banner — same UX path as `addCustomTaskToRoom`.
   */
  const renameRoomTaskTitle = useCallback(
    async (stepIndex: number, nextTitle: string): Promise<void> => {
      if (!merged) return;
      const trimmed = nextTitle.trim();
      if (!trimmed) {
        throw new Error("room_task_rename_validation_failed");
      }
      trackEvent("prod_room_task_rename_submit", {
        step_index: stepIndex,
        title_len: trimmed.length,
      });
      try {
        setError("");
        await updateRoomTask({
          inviteCode: merged.inviteCode,
          stepIndex,
          title: trimmed,
          ownerToken: ownerToken ?? undefined,
        }).unwrap();
        trackEvent("prod_room_task_rename_success", {
          step_index: stepIndex,
        });
      } catch {
        setError("Не удалось переименовать задачу");
        trackEvent("prod_room_task_rename_failed", {
          step_index: stepIndex,
        });
        throw new Error("room_task_rename_failed");
      }
    },
    [merged, ownerToken, updateRoomTask],
  );

  /**
   * Delete a single task from the room. Backend re-packs `stepIndex` and
   * adjusts `currentStep`, so we don't have to maintain client-side
   * compensations beyond surfacing failures.
   */
  const removeRoomTaskFromRoom = useCallback(
    async (stepIndex: number): Promise<void> => {
      if (!merged) return;
      trackEvent("prod_room_task_delete_submit", { step_index: stepIndex });
      try {
        setError("");
        await deleteRoomTask({
          inviteCode: merged.inviteCode,
          stepIndex,
          ownerToken: ownerToken ?? undefined,
        }).unwrap();
        trackEvent("prod_room_task_delete_success", { step_index: stepIndex });
      } catch {
        setError("Не удалось удалить задачу");
        trackEvent("prod_room_task_delete_failed", { step_index: stepIndex });
        throw new Error("room_task_delete_failed");
      }
    },
    [deleteRoomTask, merged, ownerToken],
  );

  const briefingSeededStepRef = useRef<string>("");

  useEffect(() => {
    if (!merged || !canManageRoom) return;
    if (briefingDirty) return;

    const step = mergedTasks.find(
      (task) => task.stepIndex === merged.currentStep,
    );
    const description = step?.description ?? "";
    if (!description.trim()) return;
    if (mergedBriefingMarkdown.trim()) return;

    const seedKey = `${merged.currentStep}:${normalizeRoomLanguage(merged.language)}`;
    if (briefingSeededStepRef.current === seedKey) return;
    briefingSeededStepRef.current = seedKey;
    changeBriefingMarkdown(description);
  }, [
    canManageRoom,
    changeBriefingMarkdown,
    briefingDirty,
    merged,
    mergedBriefingMarkdown,
    mergedTasks,
  ]);

  const toggleParticipantInterviewerRole = useCallback(
    (participant: Participant) => {
      if (!merged?.canGrantAccess || participant.role === "owner") return;
      const targetUserId = participant.userId?.trim() ?? "";
      if (participant.role === "candidate") {
        trackEvent("prod_participant_role_grant_interviewer", {
          target_role: participant.role,
          has_target_user_id: Boolean(targetUserId),
        });
        sendGrantInterviewerAccess(
          participant.sessionId,
          targetUserId || undefined,
        );
        return;
      }
      trackEvent("prod_participant_role_revoke_interviewer", {
        target_role: participant.role,
        has_target_user_id: Boolean(targetUserId),
      });
      sendRevokeInterviewerAccess(
        participant.sessionId,
        targetUserId || undefined,
      );
    },
    [
      merged?.canGrantAccess,
      sendGrantInterviewerAccess,
      sendRevokeInterviewerAccess,
    ],
  );

  const submitCandidateName = () => {
    const normalized = draftName.trim();
    if (!normalized) {
      setCandidateNameError("Введите имя");
      trackEvent("prod_candidate_name_submit_failed", {
        reason: "empty_name",
      });
      return;
    }
    localStorage.setItem(guestNameKey(inviteCode), normalized);
    setCandidateNameError("");
    setDisplayName(normalized);
    setNameModalOpened(false);
    trackEvent("prod_candidate_name_submit_success", {
      name_len: normalized.length,
    });
  };

  const goToLoginAndReturn = () => {
    const next = `${location.pathname}${location.search}`;
    trackEvent("prod_room_go_to_login", {
      next_path: next,
    });
    navigate(`/login?next=${encodeURIComponent(next)}`);
  };

  const forwardLocalYjsUpdate = useCallback<YjsUpdateHandler>(
    (
      yjsUpdate,
      syncKey,
      codeSnapshot,
      yjsDocumentBase64,
      baseServerYjsSequence,
    ) => {
      sendYjsUpdateTracked(
        yjsUpdate,
        syncKey,
        codeSnapshot,
        yjsDocumentBase64,
        baseServerYjsSequence,
      );
    },
    [sendYjsUpdateTracked],
  );

  const handleCandidateKeyPress = useCallback(
    (payload: KeyPressPayload) => {
      if (merged?.role === "candidate") {
        sendKeyPress(payload);
      }
    },
    [merged?.role, sendKeyPress],
  );

  useCandidateKeyTracker({
    active: merged?.role === "candidate",
    onKeyEvent: handleCandidateKeyPress,
  });

  if (isLoading || !merged) {
    return (
      <Box className={styles.shell} p="xl">
        <Text>Загрузка комнаты...</Text>
      </Box>
    );
  }

  const step = mergedTasks.find(
    (task) => task.stepIndex === merged.currentStep,
  );
  const currentTaskRating =
    merged.taskScores[String(merged.currentStep)] ?? step?.score ?? null;
  const stepStarterCode = step?.starterCode ?? "";
  // Состояние «focus mode» (synced) хранится прямо в `briefingMarkdown`
  // через скрытый sentinel-маркер (см. `briefingFocusMode.ts`). Это
  // даёт синхронизацию через уже существующий канал без миграции БД.
  const rawBriefingValue = briefingDirty ? briefingDraft : mergedBriefingMarkdown;
  const briefingFocusMode = extractFocusMode(rawBriefingValue);
  const ownerBriefingValue = stripFocusMarker(rawBriefingValue);
  const candidateBriefingValue = stripFocusMarker(mergedBriefingMarkdown);
  const candidateBriefingFocusMode = extractFocusMode(mergedBriefingMarkdown);

  /**
   * Переключение focus mode со стороны интервьюера. Состояние едет
   * по тому же каналу, что и обычное редактирование (debounced
   * `sendBriefingUpdate`), поэтому мы просто пересобираем строку
   * с учётом маркера и переиспользуем `changeBriefingMarkdown`.
   */
  const handleBriefingFocusToggle = (next: boolean) => {
    const baseValue = stripFocusMarker(rawBriefingValue);
    changeBriefingMarkdown(applyBriefingFocusMode(baseValue, next));
  };

  /**
   * Колбэк для изменения markdown из BriefingBoard: получает «чистый»
   * текст (без маркера), а мы обратно прокидываем его в общий
   * редактор с учётом текущего focus mode.
   */
  const handleBriefingValueChange = (cleanValue: string) => {
    const withFocus = briefingFocusMode
      ? applyBriefingFocusMode(cleanValue, true)
      : cleanValue;
    changeBriefingMarkdown(withFocus);
  };

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
          <Text size="sm" c="#cbd5e1">
            Это имя увидит собеседующий в списке участников.
          </Text>
          <TextInput
            label="Ваше имя"
            value={draftName}
            error={candidateNameError || undefined}
            onChange={(event) => {
              setDraftName(event.currentTarget.value);
              if (candidateNameError) {
                setCandidateNameError("");
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitCandidateName();
            }}
            autoFocus
          />
          <Button onClick={submitCandidateName} disabled={!draftName.trim()}>
            Войти в комнату
          </Button>
          {!authToken && (
            <Button variant="outline" color="gray" onClick={goToLoginAndReturn}>
              Войти через аккаунт (по желанию)
            </Button>
          )}
        </Stack>
      </Modal>

      <Box
        className={
          canManageRoom
            ? styles.shell
            : `${styles.shell} ${styles.shellCandidate}`
        }
      >
        <h1 className="visually-hidden">{`Комната «${room?.title ?? "Live-coding"}»`}</h1>
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
            tasks={mergedTasks}
            availableCatalogTasks={availableCatalogTasks}
            stepTitle={step?.title ?? "-"}
            stepStarterCode={stepStarterCode}
            error={error}
            taskScores={merged.taskScores}
            currentTaskRating={currentTaskRating}
            notesMessages={visibleNotes}
            noteComposer={noteComposer}
            onNoteComposerChange={setNoteComposer}
            onSendNote={submitNoteMessage}
            privateNoteComposer={privateNoteComposer}
            onPrivateNoteComposerChange={setPrivateNoteComposer}
            privateNotes={visiblePersonalNotes}
            privateNotesCountByStep={privateNotesCountByStep}
            activePrivateBlockName={activePrivateBlockName}
            onPrivateNoteSubmit={submitPrivateNoteEntry}
            onPrivateNotesCommandShortcut={applyPrivateNotesCommandShortcut}
            onCloseActivePrivateBlock={closeActivePrivateBlock}
            privateNotesExportModalOpened={privateNotesExportModalOpened}
            onOpenPrivateNotesExportModal={() =>
              setPrivateNotesExportModalOpened(true)
            }
            onClosePrivateNotesExportModal={closePrivateNotesExportModal}
            exportIncludeTimestamps={exportIncludeTimestamps}
            onExportIncludeTimestampsChange={setExportIncludeTimestamps}
            exportIncludeFreeNotes={exportIncludeFreeNotes}
            onExportIncludeFreeNotesChange={setExportIncludeFreeNotes}
            onExportPrivateNotesMarkdown={exportPersonalNotesMarkdown}
            onExportPrivateNotesPdf={exportPersonalNotesPdf}
            pdfExportProgress={exportProgress}
            briefingMarkdown={ownerBriefingValue}
            briefingFocusMode={briefingFocusMode}
            onBriefingChange={handleBriefingValueChange}
            onBriefingFocusModeChange={handleBriefingFocusToggle}
            sessionId={sessionId}
            participantId={participantId}
            participantLabel={effectiveDisplayName}
            sendAwarenessUpdate={sendAwarenessUpdate}
            onAwarenessBridgeReady={onAwarenessBridgeReady}
            lastCandidateKey={merged.lastCandidateKey}
            candidateKeyHistory={merged.candidateKeyHistory ?? []}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onSelectStep={selectStepLocally}
            onAddTasksFromCatalog={addTasksFromCatalog}
            onAddCustomTask={addCustomTaskToRoom}
            onRenameTask={renameRoomTaskTitle}
            onDeleteTask={removeRoomTaskFromRoom}
            isAddingTasksFromCatalog={addRoomTasksState.isLoading}
            onYjsUpdate={forwardLocalYjsUpdate}
            onYjsBridgeReady={onYjsBridgeReady}
            onEditorValueChange={onEditorValueChange}
            onKeyPress={handleCandidateKeyPress}
            onTaskRatingChange={(rating) =>
              sendTaskRatingUpdate(merged.currentStep, rating)
            }
          />
        ) : (
          <CandidateLayout
            merged={merged}
            stepTitle={step?.title ?? "-"}
            stepStarterCode={stepStarterCode}
            briefingMarkdown={candidateBriefingValue}
            briefingFocusMode={candidateBriefingFocusMode}
            sessionId={sessionId}
            participantId={participantId}
            participantLabel={effectiveDisplayName}
            sendAwarenessUpdate={sendAwarenessUpdate}
            onAwarenessBridgeReady={onAwarenessBridgeReady}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onYjsUpdate={forwardLocalYjsUpdate}
            onYjsBridgeReady={onYjsBridgeReady}
            onEditorValueChange={onEditorValueChange}
            onKeyPress={handleCandidateKeyPress}
            error={error}
          />
        )}
      </Box>
    </>
  );
}


function OwnerLayout({
  merged,
  tasks,
  availableCatalogTasks,
  stepTitle,
  stepStarterCode,
  error,
  taskScores,
  currentTaskRating,
  notesMessages,
  noteComposer,
  onNoteComposerChange,
  onSendNote,
  privateNoteComposer,
  onPrivateNoteComposerChange,
  privateNotes,
  privateNotesCountByStep,
  activePrivateBlockName,
  onPrivateNoteSubmit,
  onPrivateNotesCommandShortcut,
  onCloseActivePrivateBlock,
  privateNotesExportModalOpened,
  onOpenPrivateNotesExportModal,
  onClosePrivateNotesExportModal,
  exportIncludeTimestamps,
  onExportIncludeTimestampsChange,
  exportIncludeFreeNotes,
  onExportIncludeFreeNotesChange,
  onExportPrivateNotesMarkdown,
  onExportPrivateNotesPdf,
  pdfExportProgress,
  briefingMarkdown,
  briefingFocusMode,
  onBriefingChange,
  onBriefingFocusModeChange,
  sessionId,
  participantId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  lastCandidateKey,
  candidateKeyHistory,
  syncKey,
  resyncSignal,
  editorReady,
  onSelectStep,
  onAddTasksFromCatalog,
  onAddCustomTask,
  onRenameTask,
  onDeleteTask,
  isAddingTasksFromCatalog,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress,
  onTaskRatingChange,
}: {
  merged: RealtimeState;
  tasks: Array<{
    stepIndex: number;
    title: string;
    language: string;
    score: number | null;
  }>;
  availableCatalogTasks: TaskTemplate[];
  stepTitle: string;
  stepStarterCode: string;
  error: string;
  taskScores: Record<string, number | null>;
  currentTaskRating: number | null;
  notesMessages: Array<NoteMessage | PendingNoteMessage>;
  noteComposer: string;
  onNoteComposerChange: (value: string) => void;
  onSendNote: () => void;
  privateNoteComposer: string;
  onPrivateNoteComposerChange: (value: string) => void;
  /** Room-wide private notes (single stream) for the current viewer. */
  privateNotes: PersonalNoteEntry[];
  /** Counts of step-block notes keyed by stepIndex (used in the step list). */
  privateNotesCountByStep: Map<number, number>;
  activePrivateBlockName: string | null;
  onPrivateNoteSubmit: () => void;
  onPrivateNotesCommandShortcut: (command: string) => void;
  /** Закрывает активный блок (крестик на бейдже). */
  onCloseActivePrivateBlock: () => void;
  privateNotesExportModalOpened: boolean;
  onOpenPrivateNotesExportModal: () => void;
  onClosePrivateNotesExportModal: () => void;
  exportIncludeTimestamps: boolean;
  onExportIncludeTimestampsChange: (next: boolean) => void;
  exportIncludeFreeNotes: boolean;
  onExportIncludeFreeNotesChange: (next: boolean) => void;
  onExportPrivateNotesMarkdown: () => void;
  onExportPrivateNotesPdf: () => void;
  /**
   * Текущий прогресс PDF-экспорта. `null` означает, что выгрузка
   * сейчас не идёт. Используется, чтобы заблокировать кнопку и
   * показать индикатор внутри модалки экспорта.
   */
  pdfExportProgress:
    | {
        progress: number;
        label: string;
        format: "md" | "pdf";
      }
    | null;
  briefingMarkdown: string;
  /**
   * Synced focus mode: когда `true`, у обоих участников вместо
   * редактора кода показывается markdown-панель на всю колонку.
   */
  briefingFocusMode: boolean;
  onBriefingChange: (value: string) => void;
  onBriefingFocusModeChange: (next: boolean) => void;
  sessionId: string;
  participantId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  lastCandidateKey: CandidateKeyInfo | null;
  candidateKeyHistory: CandidateKeyInfo[];
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onSelectStep: (stepIndex: number) => void;
  onAddTasksFromCatalog: (taskIds: string[]) => Promise<void>;
  onAddCustomTask: (task: RoomCustomTaskDraft) => Promise<void>;
  /** Rename an existing in-room task by stepIndex. */
  onRenameTask: (stepIndex: number, title: string) => Promise<void>;
  /** Remove an existing in-room task by stepIndex. */
  onDeleteTask: (stepIndex: number) => Promise<void>;
  isAddingTasksFromCatalog: boolean;
  onYjsUpdate: YjsUpdateHandler;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: KeyPressPayload) => void;
  onTaskRatingChange: (rating: number | null) => void;
}) {
  const isCompactLayout = useIsCompactRoomLayout(760);
  const [activeRailPanel, setActiveRailPanel] = useState<
    "tasks" | "roomTools" | null
  >("tasks");
  const [roomToolsTab, setRoomToolsTab] = useState<"notes" | "logs">("notes");
  const [activeMobileTab, setActiveMobileTab] =
    useState<MobileRoomTab>("editor");
  const [addTaskModalOpened, setAddTaskModalOpened] = useState(false);
  const [addTaskMode, setAddTaskMode] = useState<"catalog" | "custom">(
    "catalog",
  );
  const [selectedCatalogTaskIds, setSelectedCatalogTaskIds] = useState<
    string[]
  >([]);
  const [customTaskTitle, setCustomTaskTitle] = useState("");
  const [customTaskDescription, setCustomTaskDescription] = useState("");
  const [customTaskStarterCode, setCustomTaskStarterCode] = useState("");
  /**
   * In-room rename modal state. Only one task can be renamed at a time;
   * `renameTaskTarget` holds the snapshot we opened the modal with so we
   * keep showing the right title even if `tasks` reorders/refreshes.
   */
  const [renameTaskTarget, setRenameTaskTarget] = useState<
    | { stepIndex: number; originalTitle: string }
    | null
  >(null);
  const [renameTaskDraft, setRenameTaskDraft] = useState("");
  const [renameTaskSubmitting, setRenameTaskSubmitting] = useState(false);
  const [renameTaskError, setRenameTaskError] = useState<string | null>(null);
  /** Confirmation modal for in-room task deletion. */
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<
    | { stepIndex: number; title: string }
    | null
  >(null);
  const [deleteTaskSubmitting, setDeleteTaskSubmitting] = useState(false);
  const closeRenameTaskModal = useCallback(() => {
    setRenameTaskTarget(null);
    setRenameTaskDraft("");
    setRenameTaskSubmitting(false);
    setRenameTaskError(null);
  }, []);
  const closeDeleteTaskModal = useCallback(() => {
    setDeleteTaskTarget(null);
    setDeleteTaskSubmitting(false);
  }, []);
  const submitRenameTask = useCallback(async () => {
    if (!renameTaskTarget) return;
    const trimmed = renameTaskDraft.trim();
    if (!trimmed) {
      setRenameTaskError("Название не может быть пустым");
      return;
    }
    if (trimmed === renameTaskTarget.originalTitle.trim()) {
      closeRenameTaskModal();
      return;
    }
    setRenameTaskError(null);
    setRenameTaskSubmitting(true);
    try {
      await onRenameTask(renameTaskTarget.stepIndex, trimmed);
      closeRenameTaskModal();
    } catch {
      setRenameTaskError("Не удалось переименовать задачу");
    } finally {
      setRenameTaskSubmitting(false);
    }
  }, [
    closeRenameTaskModal,
    onRenameTask,
    renameTaskDraft,
    renameTaskTarget,
  ]);
  const submitDeleteTask = useCallback(async () => {
    if (!deleteTaskTarget) return;
    setDeleteTaskSubmitting(true);
    try {
      await onDeleteTask(deleteTaskTarget.stepIndex);
      closeDeleteTaskModal();
    } catch {
      // Error is surfaced via the room error banner; just leave the modal.
      closeDeleteTaskModal();
    }
  }, [closeDeleteTaskModal, deleteTaskTarget, onDeleteTask]);
  /**
   * Register rename/delete modals as Escape layers — `useEscapeLayer` makes
   * sure Esc closes the topmost modal first instead of collapsing every
   * overlay at once (matches the room-wide Esc handling contract).
   */
  useEscapeLayer(Boolean(renameTaskTarget), closeRenameTaskModal);
  useEscapeLayer(Boolean(deleteTaskTarget), closeDeleteTaskModal);
  const roomLanguage = normalizeRoomLanguage(merged.language);
  /**
   * Язык новой кастомной задачи. По умолчанию совпадает с языком комнаты,
   * но интервьюер может переключить на любой поддерживаемый язык — такая
   * задача попадёт в комнату со своим языком, не меняя язык комнаты.
   */
  const [customTaskLanguage, setCustomTaskLanguage] =
    useState<string>(roomLanguage);
  const closeAddTaskModal = useCallback(() => {
    setAddTaskModalOpened(false);
    setAddTaskMode("catalog");
    setSelectedCatalogTaskIds([]);
    setCustomTaskTitle("");
    setCustomTaskDescription("");
    setCustomTaskStarterCode("");
    setCustomTaskLanguage(roomLanguage);
  }, [roomLanguage]);
  /**
   * Каждый раз, когда модалка открывается, выставляем дефолтный язык
   * на актуальный язык комнаты — он мог поменяться, пока модалка была
   * закрыта.
   */
  useEffect(() => {
    if (addTaskModalOpened) {
      setCustomTaskLanguage(roomLanguage);
    }
  }, [addTaskModalOpened, roomLanguage]);
  /**
   * Регистрируем модалку «Добавить задачу» в стеке Escape-слоёв,
   * чтобы открытое поверх неё Mantine Menu/SelectDropdown не закрывалось
   * вместе с ней одним нажатием Esc.
   */
  useEscapeLayer(addTaskModalOpened, closeAddTaskModal);
  const ownerPanelResize = useOwnerPanelResize();
  const {
    width: leftPanelWidth,
    maxWidth: maxOwnerPanelWidth,
    minWidth: ownerPanelMinWidth,
    onMouseDown: onOwnerPanelResizeMouseDown,
    onKeyDown: onOwnerPanelResizeKeyDown,
  } = ownerPanelResize;
  const roomToolsTabsId = useId();
  const mobileTabsId = useId();
  const notesTabId = `${roomToolsTabsId}-notes-tab`;
  const logsTabId = `${roomToolsTabsId}-logs-tab`;
  const notesPanelId = `${roomToolsTabsId}-notes-panel`;
  const logsPanelId = `${roomToolsTabsId}-logs-panel`;
  const mobileEditorTabId = `${mobileTabsId}-editor-tab`;
  const mobileCollaborationTabId = `${mobileTabsId}-collaboration-tab`;
  const mobileTasksTabId = `${mobileTabsId}-tasks-tab`;
  const mobileEditorPanelId = `${mobileTabsId}-editor-panel`;
  const mobileCollaborationPanelId = `${mobileTabsId}-collaboration-panel`;
  const mobileTasksPanelId = `${mobileTabsId}-tasks-panel`;
  const notesFeedRef = useRef<HTMLDivElement | null>(null);
  const privateNotesFeedRef = useRef<HTMLDivElement | null>(null);
  const parsedPrivateNotesCommand = useMemo(
    () => parsePersonalNotesCommand(privateNoteComposer),
    [privateNoteComposer],
  );
  const showPrivateNotesCommandMenu =
    parsedPrivateNotesCommand.kind === "menu" ||
    parsedPrivateNotesCommand.kind === "block_prompt" ||
    parsedPrivateNotesCommand.kind === "block_apply";
  const privateNotesInputPlaceholder = activePrivateBlockName
    ? "/block <название> — сменить блок"
    : 'Введите заметку или "/" для команд';
  /**
   * Block name suggestions shown after `/block`. Suggestions mirror the room's
   * interview steps: 3 steps → `/block Шаг 1`, `Шаг 2`, `Шаг 3`. Кастомное имя,
   * которое сейчас набирает пользователь, обрабатывается отдельной кнопкой
   * «Создать блок: …» (см. {@link customBlockCandidate}), а не подмешивается
   * к списку шагов — иначе непонятно, что произвольное имя тоже допустимо.
   */
  const privateNotesCommandExamples = useMemo(() => {
    return tasks
      .slice()
      .sort((left, right) => left.stepIndex - right.stepIndex)
      .map((task) => formatStepBlockLabel(task.stepIndex));
  }, [tasks]);
  /**
   * Произвольное имя блока, которое сейчас набирает пользователь после
   * `/block ` и которого ещё нет в подсказках шагов. Пустое — если кандидат
   * совпадает со ступенью или нет ввода.
   */
  const customBlockCandidate = useMemo(() => {
    if (parsedPrivateNotesCommand.kind !== "block_apply") return "";
    const candidate = parsedPrivateNotesCommand.blockName.trim();
    if (!candidate) return "";
    const matchesStep = privateNotesCommandExamples.some(
      (item) =>
        item.toLocaleLowerCase("ru-RU") === candidate.toLocaleLowerCase("ru-RU"),
    );
    return matchesStep ? "" : candidate;
  }, [parsedPrivateNotesCommand, privateNotesCommandExamples]);
  const catalogTaskOptions = useMemo(() => {
    // Дописываем язык в скобках, чтобы при перемешанных языках в банке
    // было понятно, какую задачу добавляешь (язык комнаты теперь не
    // фильтрует список).
    const languageLabelByValue = new Map(
      LANGUAGES.map((item) => [item.value, item.label]),
    );
    return availableCatalogTasks.map((task) => {
      const langValue = normalizeRoomLanguage(task.language);
      const langLabel = languageLabelByValue.get(langValue) ?? langValue;
      return {
        value: task.id,
        label: `${task.title} · ${langLabel}`,
      };
    });
  }, [availableCatalogTasks]);
  const selectedCatalogTasks = useMemo(() => {
    const selected = new Set(selectedCatalogTaskIds);
    return availableCatalogTasks.filter((task) => selected.has(task.id));
  }, [availableCatalogTasks, selectedCatalogTaskIds]);

  const submitAddTasksToRoom = useCallback(async () => {
    if (selectedCatalogTaskIds.length === 0) return;
    try {
      await onAddTasksFromCatalog(selectedCatalogTaskIds);
      setSelectedCatalogTaskIds([]);
      setAddTaskMode("catalog");
      setAddTaskModalOpened(false);
    } catch {
      // Parent sets user-facing error.
    }
  }, [onAddTasksFromCatalog, selectedCatalogTaskIds]);

  const submitAddCustomTaskToRoom = useCallback(async () => {
    const title = customTaskTitle.trim();
    const description = customTaskDescription.trim();
    if (!title) return;
    try {
      await onAddCustomTask({
        title,
        description,
        starterCode: customTaskStarterCode,
        language: customTaskLanguage,
      });
      setCustomTaskTitle("");
      setCustomTaskDescription("");
      setCustomTaskStarterCode("");
      setAddTaskMode("catalog");
      setAddTaskModalOpened(false);
      setCustomTaskLanguage(roomLanguage);
    } catch {
      // Parent sets user-facing error.
    }
  }, [
    customTaskDescription,
    customTaskLanguage,
    customTaskStarterCode,
    customTaskTitle,
    onAddCustomTask,
    roomLanguage,
  ]);

  const toggleRailPanel = useCallback((panel: "tasks" | "roomTools") => {
    setActiveRailPanel((current) => (current === panel ? null : panel));
  }, []);

  const handleRoomToolsTabKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLButtonElement>,
      currentTab: "notes" | "logs",
    ) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setRoomToolsTab(currentTab === "notes" ? "logs" : "notes");
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setRoomToolsTab(currentTab === "notes" ? "logs" : "notes");
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setRoomToolsTab("notes");
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setRoomToolsTab("logs");
      }
    },
    [],
  );

  useEffect(() => {
    const canScrollNotes = isCompactLayout
      ? activeMobileTab === "collaboration" && roomToolsTab === "notes"
      : activeRailPanel === "roomTools" && roomToolsTab === "notes";
    if (!canScrollNotes) return;
    const host = notesFeedRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
  }, [
    activeMobileTab,
    activeRailPanel,
    isCompactLayout,
    notesMessages.length,
    roomToolsTab,
  ]);

  useEffect(() => {
    const canScrollPrivateNotes = isCompactLayout
      ? activeMobileTab === "tasks"
      : activeRailPanel === "tasks";
    if (!canScrollPrivateNotes) return;
    const host = privateNotesFeedRef.current;
    if (!host) return;
    const rafId = window.requestAnimationFrame(() => {
      host.scrollTop = host.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeMobileTab, activeRailPanel, isCompactLayout, privateNotes.length]);

  useEffect(() => {
    const allowedTaskIds = new Set(
      availableCatalogTasks.map((task) => task.id),
    );
    setSelectedCatalogTaskIds((prev) =>
      prev.filter((taskId) => allowedTaskIds.has(taskId)),
    );
  }, [availableCatalogTasks]);

  useEffect(() => {
    if (activeRailPanel === null || isCompactLayout) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveRailPanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRailPanel, isCompactLayout]);

  const currentSidePanel = isCompactLayout
    ? activeMobileTab === "tasks"
      ? "tasks"
      : "roomTools"
    : activeRailPanel;
  const showLeftPanel = isCompactLayout
    ? activeMobileTab !== "editor"
    : currentSidePanel !== null;
  const candidateParticipants = merged.participants.filter(
    (participant) => participant.role === "candidate",
  );
  const candidateOutOfFocus = candidateParticipants.some(
    (participant) => participant.presenceStatus === "away",
  );
  const candidatePresenceState =
    candidateParticipants.length === 0
      ? "offline"
      : candidateOutOfFocus
        ? "away"
        : "active";
  const candidatePresenceLabel =
    candidatePresenceState === "offline"
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
  const canSubmitCustomTask = customTaskTitle.trim().length > 0;

  const handleTaskStepSelect = useCallback(
    (stepIndex: number) => {
      onSelectStep(stepIndex);
      if (isCompactLayout) {
        setActiveMobileTab("editor");
      }
    },
    [isCompactLayout, onSelectStep],
  );

  return (
    <Box className={styles.ownerBody}>
      <Modal
        opened={addTaskModalOpened}
        onClose={closeAddTaskModal}
        title="Добавить задачу в комнату"
        centered
        closeOnEscape={false}
      >
        <Stack>
          <SegmentedControl
            value={addTaskMode}
            onChange={(value) =>
              setAddTaskMode(value === "custom" ? "custom" : "catalog")
            }
            data={[
              { label: "Из банка", value: "catalog" },
              { label: "Новая задача", value: "custom" },
            ]}
            fullWidth
          />

          {addTaskMode === "catalog" ? (
            <>
              <Text size="sm" c="dimmed">
                Выберите задачи из списка, которые ещё не добавлены в комнату.
              </Text>
              <MultiSelect
                value={selectedCatalogTaskIds}
                onChange={setSelectedCatalogTaskIds}
                data={catalogTaskOptions}
                searchable
                nothingFoundMessage="Задачи не найдены"
                placeholder="Выберите задачи"
                disabled={
                  catalogTaskOptions.length === 0 || isAddingTasksFromCatalog
                }
              />
              {catalogTaskOptions.length === 0 ? (
                <Text size="xs" c="dimmed">
                  В банке нет доступных задач для добавления.
                </Text>
              ) : null}
              {selectedCatalogTasks.length > 0 ? (
                <Text size="xs" c="dimmed">
                  {`Выбрано задач: ${selectedCatalogTasks.length}`}
                </Text>
              ) : null}
              <Button
                leftSection={<IconPlus size={14} />}
                onClick={() => void submitAddTasksToRoom()}
                disabled={
                  selectedCatalogTaskIds.length === 0 ||
                  isAddingTasksFromCatalog
                }
                loading={isAddingTasksFromCatalog}
              >
                Добавить в комнату
              </Button>
            </>
          ) : (
            <>
              <TextInput
                label="Название"
                value={customTaskTitle}
                onChange={(event) =>
                  setCustomTaskTitle(event.currentTarget.value)
                }
                placeholder="Например, Реализовать LRU-кэш"
                disabled={isAddingTasksFromCatalog}
                required
              />
              <Select
                label="Язык"
                description="По умолчанию — язык комнаты. Можно выбрать другой."
                data={LANGUAGES}
                value={customTaskLanguage}
                onChange={(value) =>
                  setCustomTaskLanguage(
                    value ? normalizeRoomLanguage(value) : roomLanguage,
                  )
                }
                allowDeselect={false}
                disabled={isAddingTasksFromCatalog}
                comboboxProps={{ withinPortal: false }}
                data-testid="room-add-custom-task-language"
              />
              <Textarea
                label="Описание (Markdown, необязательно)"
                value={customTaskDescription}
                onChange={(event) =>
                  setCustomTaskDescription(event.currentTarget.value)
                }
                minRows={5}
                autosize
                disabled={isAddingTasksFromCatalog}
              />
              <Textarea
                label="Стартовый код (необязательно)"
                value={customTaskStarterCode}
                onChange={(event) =>
                  setCustomTaskStarterCode(event.currentTarget.value)
                }
                minRows={10}
                autosize
                styles={{
                  input: {
                    fontFamily:
                      "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
                  },
                }}
                disabled={isAddingTasksFromCatalog}
              />
              <Button
                leftSection={<IconPlus size={14} />}
                onClick={() => void submitAddCustomTaskToRoom()}
                disabled={!canSubmitCustomTask || isAddingTasksFromCatalog}
                loading={isAddingTasksFromCatalog}
              >
                Добавить в комнату
              </Button>
            </>
          )}
        </Stack>
      </Modal>

      {/*
       * In-room rename modal. Lives next to the add-task modal so the focus
       * trap, dark theme, and Esc layering follow the same rules.
       */}
      <Modal
        opened={Boolean(renameTaskTarget)}
        onClose={closeRenameTaskModal}
        title="Переименовать задачу"
        centered
        closeOnEscape={false}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Изменения увидят все участники комнаты — название обновится в
            списке шагов и в экспорте заметок.
          </Text>
          <TextInput
            label="Название"
            value={renameTaskDraft}
            onChange={(event) => setRenameTaskDraft(event.currentTarget.value)}
            data-testid="room-task-rename-input"
            disabled={renameTaskSubmitting}
            error={renameTaskError ?? undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitRenameTask();
              }
            }}
            autoFocus
          />
          <Group justify="flex-end" gap={8}>
            <Button
              variant="subtle"
              color="gray"
              onClick={closeRenameTaskModal}
              disabled={renameTaskSubmitting}
            >
              Отмена
            </Button>
            <Button
              onClick={() => void submitRenameTask()}
              loading={renameTaskSubmitting}
              disabled={
                renameTaskSubmitting ||
                renameTaskDraft.trim().length === 0
              }
              data-testid="room-task-rename-submit"
            >
              Сохранить
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(deleteTaskTarget)}
        onClose={closeDeleteTaskModal}
        title="Удалить задачу?"
        centered
        closeOnEscape={false}
      >
        <Stack>
          <Text size="sm" c="#cbd5e1">
            {deleteTaskTarget
              ? `Задача «${deleteTaskTarget.title}» будет удалена из комнаты. Заметки и оценка по этому шагу также пропадут.`
              : ""}
          </Text>
          <Group justify="flex-end" gap={8}>
            <Button
              variant="subtle"
              color="gray"
              onClick={closeDeleteTaskModal}
              disabled={deleteTaskSubmitting}
            >
              Отмена
            </Button>
            <Button
              color="red"
              onClick={() => void submitDeleteTask()}
              loading={deleteTaskSubmitting}
              disabled={deleteTaskSubmitting}
              data-testid="room-task-delete-confirm"
            >
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
      <nav className={styles.leftRail} aria-label="Панели владельца комнаты">
        {/*
         * Rail buttons used to be icon-only (16px), which made the chat/logs
         * vs. tasks intent unclear. We add a short label under each icon and
         * a tooltip with the full description — discoverability without
         * eating horizontal space (rail width unchanged at 56px).
         *
         * Note: the tasks icon is `IconChecklist` (a clipboard with a
         * check mark) — it matches the "Шаги" caption better than a plain
         * numbered list and reads as "задачи / чек-лист по шагам" at a
         * glance. It also stays distinct from the "Кабинет" icon up top.
         */}
        <Tooltip
          label="Шаги интервью, оценки и заметки"
          position="right"
          openDelay={250}
          withArrow
        >
          <button
            type="button"
            className={`${styles.railButton} ${activeRailPanel === "tasks" ? styles.railButtonActive : ""}`}
            aria-label="Открыть панель шагов и заметок"
            aria-pressed={activeRailPanel === "tasks"}
            aria-controls="owner-side-panel"
            onClick={() => toggleRailPanel("tasks")}
            data-testid="room-rail-tasks"
          >
            <IconChecklist size={16} stroke={1.8} />
            <span className={styles.railButtonLabel}>Шаги</span>
          </button>
        </Tooltip>
        <Tooltip
          label="Чат с напарниками и логи активности кандидата"
          position="right"
          openDelay={250}
          withArrow
        >
          <button
            type="button"
            className={`${styles.railButton} ${activeRailPanel === "roomTools" ? styles.railButtonActive : ""}`}
            aria-label="Открыть чат и логи активности кандидата"
            aria-pressed={activeRailPanel === "roomTools"}
            aria-controls="owner-side-panel"
            onClick={() => toggleRailPanel("roomTools")}
            data-testid="room-rail-tools"
          >
            <IconMessages size={16} stroke={1.8} />
            <span className={styles.railButtonLabel}>Чат</span>
          </button>
        </Tooltip>
      </nav>

      {isCompactLayout && (
        <nav
          className={styles.mobileRoomTabs}
          role="tablist"
          aria-label="Room panels"
        >
          <button
            id={mobileEditorTabId}
            type="button"
            role="tab"
            aria-selected={activeMobileTab === "editor"}
            aria-controls={mobileEditorPanelId}
            className={`${styles.mobileRoomTab} ${activeMobileTab === "editor" ? styles.mobileRoomTabActive : ""}`}
            onClick={() => setActiveMobileTab("editor")}
          >
            <span className={styles.mobileRoomTabLabel}>Editor</span>
          </button>
          <button
            id={mobileCollaborationTabId}
            type="button"
            role="tab"
            aria-selected={activeMobileTab === "collaboration"}
            aria-controls={mobileCollaborationPanelId}
            className={`${styles.mobileRoomTab} ${activeMobileTab === "collaboration" ? styles.mobileRoomTabActive : ""}`}
            onClick={() => setActiveMobileTab("collaboration")}
          >
            <span className={styles.mobileRoomTabLabel}>Team</span>
          </button>
          <button
            id={mobileTasksTabId}
            type="button"
            role="tab"
            aria-selected={activeMobileTab === "tasks"}
            aria-controls={mobileTasksPanelId}
            className={`${styles.mobileRoomTab} ${activeMobileTab === "tasks" ? styles.mobileRoomTabActive : ""}`}
            onClick={() => setActiveMobileTab("tasks")}
          >
            <span className={styles.mobileRoomTabLabel}>Tasks</span>
          </button>
        </nav>
      )}

      {showLeftPanel && (
        <>
          <Box
            id={
              isCompactLayout
                ? activeMobileTab === "tasks"
                  ? mobileTasksPanelId
                  : mobileCollaborationPanelId
                : "owner-side-panel"
            }
            role={isCompactLayout ? "tabpanel" : undefined}
            aria-labelledby={
              isCompactLayout
                ? activeMobileTab === "tasks"
                  ? mobileTasksTabId
                  : mobileCollaborationTabId
                : undefined
            }
            className={`${styles.ownerSidePanel} ${isCompactLayout ? styles.mobileRoomPanel : ""}`}
            style={
              isCompactLayout ? undefined : { width: leftPanelWidth }
            }
            aria-label={
              currentSidePanel === "tasks"
                ? "Панель задач"
                : "Панель чата и логов"
            }
          >
            {currentSidePanel === "tasks" ? (
              <Box className={styles.sidebar}>
                <Group justify="space-between" align="center" gap={8}>
                  <Text size="xs" c="#8b919b">
                    шаг {merged.currentStep + 1}/{Math.max(tasks.length, 1)}
                  </Text>
                  <Group gap={6}>
                    <Button
                      size="xs"
                      variant="light"
                      color="gray"
                      leftSection={<IconFileDescription size={14} />}
                      onClick={onOpenPrivateNotesExportModal}
                      data-testid="room-private-notes-export"
                    >
                      Экспорт заметок
                    </Button>
                    <Button
                      size="xs"
                      variant="filled"
                      color="blue"
                      leftSection={<IconPlus size={12} />}
                      onClick={() => setAddTaskModalOpened(true)}
                    >
                      Задача
                    </Button>
                  </Group>
                </Group>

                <Box className={styles.stepList}>
                  {tasks.map((task) => {
                    const taskRating =
                      taskScores[String(task.stepIndex)] ?? task.score ?? null;
                    const notesCount =
                      privateNotesCountByStep.get(task.stepIndex) ?? 0;
                    const isActiveStep = task.stepIndex === merged.currentStep;
                    const fullLabel = `${task.stepIndex + 1}. ${task.title}`;
                    const canDeleteThis = tasks.length > 1;
                    return (
                      <div
                        key={task.stepIndex}
                        className={styles.stepRow}
                        data-active={isActiveStep ? "true" : undefined}
                      >
                        <button
                          type="button"
                          className={styles.stepRowMain}
                          aria-current={isActiveStep ? "step" : undefined}
                          aria-label={fullLabel}
                          onClick={() => handleTaskStepSelect(task.stepIndex)}
                          title={fullLabel}
                        >
                          <span
                            className={styles.stepRowIndex}
                            aria-hidden="true"
                          >
                            {task.stepIndex + 1}
                          </span>
                          <span className={styles.stepRowTitle}>
                            {task.title}
                          </span>
                          <span className={styles.stepRowMeta}>
                            {taskRating ? (
                              <Tooltip
                                label={`Оценка шага: ${taskRating} из 5`}
                                position="top"
                              >
                                <span
                                  className={styles.stepRowRating}
                                  aria-label={`Оценка шага: ${taskRating} из 5`}
                                >
                                  {`★${taskRating}`}
                                </span>
                              </Tooltip>
                            ) : null}
                            {notesCount > 0 ? (
                              <Tooltip
                                label={`Заметок по шагу: ${notesCount}`}
                                position="top"
                              >
                                <span
                                  className={styles.stepRowNotes}
                                  aria-label={`Заметок по шагу: ${notesCount}`}
                                >
                                  <IconNote size={11} stroke={2.2} />
                                  <span>{notesCount}</span>
                                </span>
                              </Tooltip>
                            ) : null}
                          </span>
                        </button>
                        {/*
                         * Per-step actions live in a sibling button so we
                         * don't nest <button> in <button> (invalid HTML).
                         * Tooltip explains the menu, and the menu trigger
                         * itself shows up only on hover/focus to keep the
                         * row visually quiet (see `.stepRowActions` CSS).
                         */}
                        <div className={styles.stepRowActions}>
                          <Menu
                            withinPortal
                            position="bottom-end"
                            shadow="md"
                            offset={4}
                          >
                            <Menu.Target>
                              {/*
                               * Action menu trigger. The previous "Действия
                               * с задачей" tooltip was redundant — `aria-label`
                               * already names the control for screen readers,
                               * and the dropdown items are self-explanatory.
                               * Removed per UX feedback (felt noisy on hover).
                               */}
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="gray"
                                className={styles.stepRowActionsTrigger}
                                aria-label={`Действия с задачей: ${task.title}`}
                                data-testid={`room-task-actions-${task.stepIndex}`}
                              >
                                <IconDots size={14} stroke={2} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item
                                leftSection={<IconPencil size={14} />}
                                onClick={() => {
                                  setRenameTaskTarget({
                                    stepIndex: task.stepIndex,
                                    originalTitle: task.title,
                                  });
                                  setRenameTaskDraft(task.title);
                                  setRenameTaskError(null);
                                }}
                                data-testid={`room-task-rename-${task.stepIndex}`}
                              >
                                Переименовать
                              </Menu.Item>
                              <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={14} />}
                                disabled={!canDeleteThis}
                                onClick={() => {
                                  if (!canDeleteThis) return;
                                  setDeleteTaskTarget({
                                    stepIndex: task.stepIndex,
                                    title: task.title,
                                  });
                                }}
                                data-testid={`room-task-delete-${task.stepIndex}`}
                              >
                                Удалить
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </div>
                      </div>
                    );
                  })}
                </Box>

                <Text
                  size="sm"
                  c="#e1e6ef"
                  fw={600}
                  truncate="end"
                  title={stepTitle}
                >
                  {stepTitle}
                </Text>

                <Box className={styles.taskRatingCard}>
                  <Select
                    className={styles.taskRating}
                    classNames={{ option: styles.taskRatingOption }}
                    label="Оценка шага"
                    placeholder="Нет оценки"
                    value={currentTaskRating ? String(currentTaskRating) : null}
                    onChange={(value) =>
                      onTaskRatingChange(
                        value ? Number.parseInt(value, 10) : null,
                      )
                    }
                    withCheckIcon={false}
                    clearable
                    data={[
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                      { value: "3", label: "3" },
                      { value: "4", label: "4" },
                      { value: "5", label: "5" },
                    ]}
                    styles={{
                      label: {
                        color: "#9ba0a8",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                      },
                      input: {
                        backgroundColor: "#11161f",
                        borderColor: "#273242",
                        color: "#d6dce6",
                        fontSize: 12,
                      },
                      dropdown: {
                        backgroundColor: "#11161f",
                        borderColor: "#273242",
                      },
                      option: { color: "#d6dce6" },
                    }}
                  />
                </Box>

                <div className={styles.privateNotesSection}>
                  <header className={styles.privateNotesHeader}>
                    <div className={styles.privateNotesHeaderCopy}>
                      <Text className={styles.panelSectionTitle}>
                        Заметки
                      </Text>
                    </div>
                  </header>

                  {activePrivateBlockName ? (
                    <div className={styles.privateNotesActiveBlock}>
                      <Badge
                        color={getPrivateNoteBlockColor(activePrivateBlockName)}
                        variant="light"
                        rightSection={
                          <Tooltip
                            label="Закрыть блок и писать в свободной форме"
                            withArrow
                            position="top"
                          >
                            <ActionIcon
                              size="xs"
                              radius="xl"
                              variant="transparent"
                              color="gray"
                              aria-label="Закрыть блок и писать в свободной форме"
                              data-testid="room-private-notes-active-block-close"
                              onClick={onCloseActivePrivateBlock}
                              className={styles.privateNotesActiveBlockClose}
                            >
                              <IconX size={12} stroke={2.4} />
                            </ActionIcon>
                          </Tooltip>
                        }
                      >
                        Блок: {activePrivateBlockName}
                      </Badge>
                    </div>
                  ) : (
                    <div className={styles.privateNotesActiveBlock}>
                      <Badge color="gray" variant="light">
                        Без блока
                      </Badge>
                      <Text className={styles.privateNotesHint}>
                        Записи — вне блока. Выберите блок через{" "}
                        <code>/block</code> или смените шаг.
                      </Text>
                    </div>
                  )}

                  <div className={styles.privateNotesList} ref={privateNotesFeedRef}>
                    {privateNotes.length > 0 ? (
                      privateNotes.map((entry) => (
                        <article
                          key={entry.id}
                          className={styles.privateNoteEntry}
                          data-pending={Boolean(
                            (entry as PendingPersonalNoteEntry).pending,
                          )}
                        >
                          <header className={styles.privateNoteEntryMeta}>
                            <time className={styles.privateNoteEntryTime}>
                              {formatNoteTimestamp(entry.timestampEpochMs)}
                            </time>
                            {typeof entry.blockStepIndex === "number" ? (
                              <Badge
                                size="xs"
                                color={getPrivateNoteBlockColor(
                                  formatStepBlockLabel(entry.blockStepIndex),
                                )}
                                variant="light"
                              >
                                {formatStepBlockLabel(entry.blockStepIndex)}
                              </Badge>
                            ) : entry.blockName ? (
                              <Badge
                                size="xs"
                                color={getPrivateNoteBlockColor(entry.blockName)}
                                variant="light"
                              >
                                {entry.blockName}
                              </Badge>
                            ) : (
                              <Badge size="xs" color="gray" variant="light">
                                Вне блока
                              </Badge>
                            )}
                          </header>
                          <Text className={styles.privateNoteEntryText}>
                            {entry.text}
                          </Text>
                        </article>
                      ))
                    ) : (
                      <div className={styles.privateNotesEmpty}>
                        <Text className={styles.notesEmptyTitle}>
                          Пока нет записей
                        </Text>
                        <Text className={styles.notesEmptyText}>
                          Добавьте первую заметку — она автоматически попадёт
                          в блок текущего шага.
                        </Text>
                      </div>
                    )}
                  </div>

                  <div className={styles.privateNotesComposer}>
                    <Textarea
                      value={privateNoteComposer}
                      onChange={(event) =>
                        onPrivateNoteComposerChange(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.shiftKey) return;
                        event.preventDefault();
                        onPrivateNoteSubmit();
                      }}
                      autosize
                      minRows={2}
                      maxRows={10}
                      data-testid="room-private-notes-input"
                      placeholder={privateNotesInputPlaceholder}
                      aria-label="Заметка интервьюера"
                      classNames={{ input: styles.privateNotesComposerInput }}
                    />
                    {showPrivateNotesCommandMenu ? (
                      <div
                        className={styles.privateNotesCommandMenu}
                        data-testid="room-private-notes-command-menu"
                      >
                        <button
                          type="button"
                          className={styles.privateNotesCommandItem}
                          onClick={() => onPrivateNotesCommandShortcut("/block")}
                        >
                          <span className={styles.privateNotesCommandLabel}>
                            /block
                          </span>
                          <span className={styles.privateNotesCommandHint}>
                            Открыть блок заметок
                          </span>
                        </button>

                        <Text className={styles.privateNotesCommandHelper}>
                          Введите своё название после <code>/block</code> —
                          создастся новый блок. Или выберите ниже один из шагов
                          интервью.
                        </Text>

                        {customBlockCandidate ? (
                          <button
                            type="button"
                            className={styles.privateNotesCommandCreate}
                            data-testid="room-private-notes-command-create-custom"
                            onClick={() =>
                              onPrivateNotesCommandShortcut(
                                `/block ${customBlockCandidate}`,
                              )
                            }
                          >
                            <span
                              className={styles.privateNotesCommandCreateLabel}
                            >
                              + Создать блок
                            </span>
                            <span
                              className={styles.privateNotesCommandCreateName}
                            >
                              {customBlockCandidate}
                            </span>
                          </button>
                        ) : null}

                        {privateNotesCommandExamples.length > 0 ? (
                          <div
                            className={styles.privateNotesCommandSection}
                            role="group"
                            aria-label="Шаги интервью"
                          >
                            <Text
                              className={styles.privateNotesCommandSectionTitle}
                            >
                              Шаги интервью
                            </Text>
                            {privateNotesCommandExamples.map((example) => (
                              <button
                                key={example}
                                type="button"
                                className={styles.privateNotesCommandExample}
                                onClick={() =>
                                  onPrivateNotesCommandShortcut(
                                    `/block ${example}`,
                                  )
                                }
                              >
                                {`/block ${example}`}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {parsedPrivateNotesCommand.kind === "unknown" ? (
                      <Text className={styles.privateNotesCommandUnknown}>
                        Команда не найдена. Доступно: <code>/block</code>.
                      </Text>
                    ) : null}

                    <Group
                      justify="space-between"
                      align="center"
                      className={styles.notesComposerFooter}
                    >
                      <Text className={styles.notesComposerHint}>
                        Enter: добавить запись, Shift+Enter: новая строка
                      </Text>
                      <Button
                        type="button"
                        size="xs"
                        onClick={onPrivateNoteSubmit}
                        disabled={
                          !privateNoteComposer.trim() ||
                          parsedPrivateNotesCommand.kind === "menu" ||
                          parsedPrivateNotesCommand.kind === "block_prompt" ||
                          parsedPrivateNotesCommand.kind === "unknown"
                        }
                        data-testid="room-private-notes-send"
                      >
                        {parsedPrivateNotesCommand.kind === "block_apply"
                          ? "Применить блок"
                          : "Добавить"}
                      </Button>
                    </Group>
                  </div>
                </div>

                <Modal
                  opened={privateNotesExportModalOpened}
                  onClose={onClosePrivateNotesExportModal}
                  title="Экспорт личных заметок"
                  centered
                  closeOnEscape={false}
                >
                  <Stack gap="sm">
                    <Text size="sm" c="dimmed">
                      Экспортирует фактуру по всем шагам, объединяя
                      повторяющиеся блоки в каждом шаге.
                    </Text>
                    <Checkbox
                      checked={exportIncludeTimestamps}
                      onChange={(event) =>
                        onExportIncludeTimestampsChange(
                          event.currentTarget.checked,
                        )
                      }
                      label="Включать время записей"
                    />
                    <Checkbox
                      checked={exportIncludeFreeNotes}
                      onChange={(event) =>
                        onExportIncludeFreeNotesChange(
                          event.currentTarget.checked,
                        )
                      }
                      label="Включать заметки вне блока"
                    />
                    <div
                      className={styles.exportStatusSlot}
                      data-testid="private-notes-export-status-slot"
                    >
                      {pdfExportProgress ? (
                        // Keep a stable-height status slot in the modal so
                        // buttons don't jump when export progress appears.
                        <Stack
                          gap={4}
                          data-testid="private-notes-pdf-progress"
                        >
                          <Text size="xs" c="gray.4">
                            {pdfExportProgress.label}…{" "}
                            {Math.round(pdfExportProgress.progress * 100)}%
                          </Text>
                          <div
                            style={{
                              height: 4,
                              background: "#1c2230",
                              borderRadius: 2,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${Math.max(
                                  4,
                                  Math.round(pdfExportProgress.progress * 100),
                                )}%`,
                                background: "#3b82f6",
                                transition: "width 120ms linear",
                              }}
                            />
                          </div>
                        </Stack>
                      ) : (
                        <Text size="xs" c="gray.6">
                          Выберите формат для экспорта заметок
                        </Text>
                      )}
                    </div>
                    <Group justify="flex-end">
                      <Button
                        variant="light"
                        color="gray"
                        leftSection={<IconDownload size={14} />}
                        onClick={onExportPrivateNotesMarkdown}
                        disabled={pdfExportProgress !== null}
                        loading={
                          pdfExportProgress?.format === "md" &&
                          pdfExportProgress.progress < 1
                        }
                      >
                        Скачать .md
                      </Button>
                      <Button
                        leftSection={<IconDownload size={14} />}
                        onClick={onExportPrivateNotesPdf}
                        loading={
                          pdfExportProgress?.format === "pdf" &&
                          pdfExportProgress.progress < 1
                        }
                        disabled={pdfExportProgress !== null}
                        data-testid="private-notes-pdf-export-button"
                      >
                        Скачать .pdf
                      </Button>
                    </Group>
                  </Stack>
                </Modal>
              </Box>
            ) : (
              <Box className={styles.outputPanel}>
                <div className={styles.panelTabs}>
                  <div
                    className={styles.ownerPresenceBanner}
                    aria-label="Кандидат"
                  >
                    <div className={styles.ownerPresenceCopy}>
                      <Text className={styles.ownerPresenceLabel}>
                        Кандидат
                      </Text>
                    </div>
                    <Badge
                      className={styles.ownerPresenceBadge}
                      variant="light"
                      data-state={candidatePresenceState}
                    >
                      {candidatePresenceLabel}
                    </Badge>
                  </div>
                  <div
                    className={styles.panelTabsList}
                    role="tablist"
                    aria-label="Панель комнаты"
                  >
                    <button
                      id={notesTabId}
                      type="button"
                      role="tab"
                      aria-selected={roomToolsTab === "notes"}
                      aria-controls={notesPanelId}
                      className={`${styles.panelTab} ${roomToolsTab === "notes" ? styles.panelTabActive : ""}`}
                      onClick={() => setRoomToolsTab("notes")}
                      onKeyDown={(event) =>
                        handleRoomToolsTabKeyDown(event, "notes")
                      }
                    >
                      Чат
                    </button>
                    <button
                      id={logsTabId}
                      type="button"
                      role="tab"
                      aria-selected={roomToolsTab === "logs"}
                      aria-controls={logsPanelId}
                      className={`${styles.panelTab} ${roomToolsTab === "logs" ? styles.panelTabActive : ""}`}
                      onClick={() => setRoomToolsTab("logs")}
                      onKeyDown={(event) =>
                        handleRoomToolsTabKeyDown(event, "logs")
                      }
                    >
                      Логи
                    </button>
                  </div>

                  {roomToolsTab === "notes" ? (
                    <div
                      id={notesPanelId}
                      className={`${styles.panelTabPanel} ${styles.notesTabPanel}`}
                      role="tabpanel"
                      aria-labelledby={notesTabId}
                    >
                      <div className={styles.notesHeader}>
                        <div className={styles.notesHeaderCopy}>
                          <Text className={styles.panelSectionTitle}>Чат</Text>
                        </div>
                      </div>

                      <div
                        className={styles.notesMessagesList}
                        ref={notesFeedRef}
                        role="log"
                        aria-label="Сообщения заметок"
                      >
                        {notesMessages.length > 0 ? (
                          notesMessages.map((message) => {
                            const isOwnMessage =
                              message.sessionId === sessionId;
                            return (
                              <article
                                key={message.id}
                                className={`${styles.noteBubble} ${isOwnMessage ? styles.noteBubbleOwn : ""}`}
                                data-pending={Boolean(
                                  (message as PendingNoteMessage).pending,
                                )}
                              >
                                <header className={styles.noteBubbleHeader}>
                                  <div className={styles.noteBubbleAuthorWrap}>
                                    <span className={styles.noteBubbleAuthor}>
                                      {message.displayName}
                                    </span>
                                  </div>
                                  <time className={styles.noteBubbleTime}>
                                    {formatNoteTimestamp(
                                      message.timestampEpochMs,
                                    )}
                                  </time>
                                </header>
                                <Text className={styles.noteBubbleText}>
                                  {message.text}
                                </Text>
                              </article>
                            );
                          })
                        ) : (
                          <div className={styles.notesEmpty}>
                            <Text className={styles.notesEmptyTitle}>
                              Пока пусто
                            </Text>
                            <Text className={styles.notesEmptyText}>
                              Здесь появятся сообщения интервьюеров.
                            </Text>
                          </div>
                        )}
                      </div>

                      <div className={styles.notesComposer}>
                        <Textarea
                          value={noteComposer}
                          onChange={(event) =>
                            onNoteComposerChange(event.currentTarget.value)
                          }
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
                          aria-label="Сообщение в чат интервьюеров"
                          classNames={{ input: styles.notesComposerInput }}
                        />
                        <Group
                          justify="flex-end"
                          align="center"
                          className={styles.notesComposerFooter}
                        >
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
                    <div
                      id={logsPanelId}
                      className={styles.panelTabPanel}
                      role="tabpanel"
                      aria-labelledby={logsTabId}
                    >
                      <header className={styles.logsHeader}>
                        <div className={styles.logsTitleWrap}>
                          <Text component="h3" className={styles.logsTitle}>
                            Логи кандидата
                          </Text>
                          <span className={styles.logsCount}>
                            {recentCandidateKeyHistory.length}
                          </span>
                        </div>
                        <Text className={styles.logsCounter}>
                          Лимит {LOG_HISTORY_LIMIT}
                        </Text>
                      </header>

                      <div
                        className={styles.logsList}
                        role="log"
                        aria-label="Логи кандидата"
                      >
                        {recentCandidateKeyHistory.length > 0 ? (
                          recentCandidateKeyHistory.map((event, index) => (
                            <div
                              key={`${event.sessionId}-${event.timestampEpochMs}-${index}`}
                              className={styles.logItem}
                            >
                              <time className={styles.logTime}>
                                {formatCandidateKeyHistoryTimestamp(event)}
                              </time>
                              <p className={styles.logMessage}>
                                {event.displayName}: {formatCandidateKey(event)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className={styles.logsEmpty}>
                            <Text className={styles.logsEmptyTitle}>
                              Пока пусто
                            </Text>
                            <Text className={styles.logsEmptyText}>
                              События клавиатуры появятся здесь.
                            </Text>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Box>
            )}
          </Box>

          {!isCompactLayout && (
            <div
              className={styles.resizeHandle}
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-valuemin={ownerPanelMinWidth}
              aria-valuemax={maxOwnerPanelWidth}
              aria-valuenow={Math.round(leftPanelWidth)}
              aria-label="Изменить ширину левой панели"
              onMouseDown={onOwnerPanelResizeMouseDown}
              onKeyDown={onOwnerPanelResizeKeyDown}
            >
              <IconGripVertical size={14} />
            </div>
          )}
        </>
      )}

      {(!isCompactLayout || activeMobileTab === "editor") && (
        <Box
          id={mobileEditorPanelId}
          role={isCompactLayout ? "tabpanel" : undefined}
          aria-labelledby={isCompactLayout ? mobileEditorTabId : undefined}
          hidden={isCompactLayout && activeMobileTab !== "editor"}
          className={`${styles.editorViewport} ${isCompactLayout ? styles.mobileRoomPanel : ""}`.trim()}
        >
          <Box className={styles.workspace}>
            <Box className={styles.editorColumn}>
              <BriefingBoard
                key={`briefing-${merged.currentStep}`}
                mode="interviewer"
                value={briefingMarkdown}
                onChange={onBriefingChange}
                focusMode={briefingFocusMode}
                onFocusModeChange={onBriefingFocusModeChange}
              />
              {/*
                Synced focus mode: интервьюер скрывает блок с кодом для
                обоих участников. У кандидата выполняется тот же if
                ниже в `CandidateLayout`.
              */}
              {!briefingFocusMode ? (
                <SharedRoomEditorPanel
                  merged={merged}
                  stepStarterCode={stepStarterCode}
                  editorReady={editorReady}
                  syncKey={syncKey}
                  resyncSignal={resyncSignal}
                  sessionId={sessionId}
                  participantId={participantId}
                  participantLabel={participantLabel}
                  sendAwarenessUpdate={sendAwarenessUpdate}
                  onAwarenessBridgeReady={onAwarenessBridgeReady}
                  onYjsUpdate={onYjsUpdate}
                  onYjsBridgeReady={onYjsBridgeReady}
                  onEditorValueChange={onEditorValueChange}
                  onKeyPress={onKeyPress}
                  panelClassName={styles.editorPanel}
                />
              ) : null}
              {error && <Text className={styles.error}>{error}</Text>}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function CandidateLayout({
  merged,
  stepTitle,
  stepStarterCode,
  briefingMarkdown,
  sessionId,
  participantId,
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
  error,
  briefingFocusMode,
}: {
  merged: RealtimeState;
  stepTitle: string;
  stepStarterCode: string;
  briefingMarkdown: string;
  /**
   * Synced focus mode (см. `briefingFocusMode.ts`): когда `true`,
   * у кандидата код-редактор скрыт и markdown показывается на всю
   * рабочую область.
   */
  briefingFocusMode: boolean;
  sessionId: string;
  participantId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onYjsUpdate: YjsUpdateHandler;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: KeyPressPayload) => void;
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

      <BriefingBoard
        key={`briefing-${merged.currentStep}`}
        mode="candidate"
        value={briefingMarkdown}
        focusMode={briefingFocusMode}
      />

      {!briefingFocusMode ? (
        <SharedRoomEditorPanel
          merged={merged}
          stepStarterCode={stepStarterCode}
          editorReady={editorReady}
          syncKey={syncKey}
          resyncSignal={resyncSignal}
          sessionId={sessionId}
          participantId={participantId}
          participantLabel={participantLabel}
          sendAwarenessUpdate={sendAwarenessUpdate}
          onAwarenessBridgeReady={onAwarenessBridgeReady}
          onYjsUpdate={onYjsUpdate}
          onYjsBridgeReady={onYjsBridgeReady}
          onEditorValueChange={onEditorValueChange}
          onKeyPress={onKeyPress}
          panelClassName={styles.candidatePanel}
        />
      ) : null}

      {error && <Text className={styles.error}>{error}</Text>}
    </Box>
  );
}

function SharedRoomEditorPanel({
  merged,
  stepStarterCode,
  editorReady,
  syncKey,
  resyncSignal,
  sessionId,
  participantId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress,
  panelClassName,
}: {
  merged: RealtimeState;
  stepStarterCode: string;
  editorReady: boolean;
  syncKey: string;
  resyncSignal: number;
  sessionId: string;
  participantId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  onYjsUpdate: YjsUpdateHandler;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: KeyPressPayload) => void;
  panelClassName: string;
}) {
  return (
    <Box className={panelClassName}>
      <div className={styles.editorWrap}>
        {editorReady ? (
          <RoomCodeEditor
            key={syncKey}
            height="100%"
            language={toEditorLanguage(merged.language)}
            value={
              merged.code ||
              (merged.lastCodeUpdatedBySessionId ? "" : stepStarterCode)
            }
            serverYjsBase64={merged.yjsDocumentBase64 ?? null}
            serverYjsSequence={merged.lastYjsSequence ?? 0}
            lastCodeUpdatedBySessionId={
              merged.lastCodeUpdatedBySessionId ?? null
            }
            resyncSignal={resyncSignal}
            syncKey={syncKey}
            readOnly={!editorReady}
            sessionId={sessionId}
            participantId={participantId}
            participantLabel={participantLabel}
            sendAwarenessUpdate={sendAwarenessUpdate}
            onAwarenessBridgeReady={onAwarenessBridgeReady}
            onYjsUpdate={onYjsUpdate}
            onYjsBridgeReady={onYjsBridgeReady}
            onEditorValueChange={onEditorValueChange}
            onKeyPress={onKeyPress}
          />
        ) : (
          <Box
            data-testid="room-code-editor-pending"
            style={{
              height: "100%",
              display: "grid",
              placeItems: "center",
              color: "#8b919b",
              fontSize: 13,
            }}
          >
            Синхронизация редактора...
          </Box>
        )}
      </div>
    </Box>
  );
}


function pickPreferredCursor(
  existing: CursorInfo,
  candidate: CursorInfo,
): CursorInfo {
  const existingSequence =
    typeof existing.cursorSequence === "number"
      ? existing.cursorSequence
      : null;
  const candidateSequence =
    typeof candidate.cursorSequence === "number"
      ? candidate.cursorSequence
      : null;
  if (existingSequence != null && candidateSequence != null) {
    if (candidateSequence > existingSequence) return candidate;
    if (candidateSequence < existingSequence) return existing;
  } else if (existingSequence == null && candidateSequence != null) {
    return candidate;
  } else if (existingSequence != null && candidateSequence == null) {
    return existing;
  }

  const existingSeenAt =
    typeof existing.lastSeenAtEpochMs === "number"
      ? existing.lastSeenAtEpochMs
      : 0;
  const candidateSeenAt =
    typeof candidate.lastSeenAtEpochMs === "number"
      ? candidate.lastSeenAtEpochMs
      : 0;
  if (candidateSeenAt !== existingSeenAt) {
    return candidateSeenAt > existingSeenAt ? candidate : existing;
  }

  return candidate.sessionId > existing.sessionId ? candidate : existing;
}

function mergeCursorsByIdentity(cursors: CursorInfo[]): CursorInfo[] {
  const byIdentity = new Map<string, CursorInfo>();
  cursors.forEach((cursor) => {
    const identityKey =
      participantIdentityKey(cursor) ?? `session:${cursor.sessionId}`;
    const existing = byIdentity.get(identityKey);
    if (!existing) {
      byIdentity.set(identityKey, cursor);
      return;
    }
    byIdentity.set(identityKey, pickPreferredCursor(existing, cursor));
  });
  return Array.from(byIdentity.values());
}

