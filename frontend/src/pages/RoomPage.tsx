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
  IconCode,
  IconDownload,
  IconFileDescription,
  IconGripVertical,
  IconHome2,
  IconLayoutDashboard,
  IconNote,
  IconPlus,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { yCollab } from "y-codemirror.next";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  indentOnInput,
  bracketMatching,
  foldGutter,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { useAppSelector } from "../app/hooks";
import { markdownToHtml } from "../components/markdown";
import { useEscapeLayer } from "../components/useEscapeLayer";
import {
  useAddRoomTasksMutation,
  useGetRoomQuery,
  useTasksGroupedQuery,
} from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";
import { useRoomSocket } from "../features/room/useRoomSocket";
import type { RoomTask, TaskTemplate } from "../types";

import styles from "./RoomPage.module.css";

const LANGUAGES = [
  { value: "nodejs", label: "Node JS" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" },
];

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
 * Возможные категории событий лога активности кандидата:
 * - `keydown` — обычное нажатие клавиши.
 * - `window_blur` — окно браузера потеряло фокус (Alt+Tab/Cmd+Tab,
 *   переключение на другое приложение).
 * - `window_focus` — окно браузера снова получило фокус.
 * - `tab_hidden` — вкладка стала скрытой (переключение на другую вкладку
 *   внутри браузера, сворачивание окна).
 * - `tab_visible` — вкладка снова видна.
 */
type CandidateKeyEventKind =
  | "keydown"
  | "window_blur"
  | "window_focus"
  | "tab_hidden"
  | "tab_visible";

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
  /**
   * Опциональное поле — старые сообщения с бэкенда могут не содержать его,
   * тогда трактуем как обычный `keydown`.
   */
  eventKind?: CandidateKeyEventKind | string;
};

type KeyPressPayload = {
  key: string;
  keyCode: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  eventKind?: CandidateKeyEventKind;
};

type YjsUpdateHandler = (
  yjsUpdate: string,
  syncKey: string,
  codeSnapshot?: string | null,
  yjsDocumentBase64?: string | null,
  baseServerYjsSequence?: number | null,
) => void;

type AwarenessUser = {
  sessionId?: string;
  participantId?: string;
  userId?: string;
  name?: string;
  color?: string;
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

type MarkdownToolId =
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "h1"
  | "h2"
  | "ul"
  | "ol"
  | "quote"
  | "table";
type MobileRoomTab = "editor" | "collaboration" | "tasks";

const MIN_OWNER_PANEL_WIDTH = 330;
/**
 * Жёсткий потолок для левой панели — половина рабочей области (ширина окна).
 * Реальный максимум вычисляется в рантайме через {@link computeMaxOwnerPanelWidth},
 * эта константа просто страхует от деградации на серверном рендере и при
 * очень узких окнах (никогда не уходим ниже MIN_OWNER_PANEL_WIDTH).
 */
const MAX_OWNER_PANEL_WIDTH_FALLBACK = 1200;

function computeMaxOwnerPanelWidth(viewportWidth: number): number {
  const half = Math.floor(viewportWidth / 2);
  // Половина окна, но не меньше минимума, иначе clamp ломается на узких экранах.
  return Math.max(MIN_OWNER_PANEL_WIDTH, half);
}
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

function normalizeKeyCodeLabel(code: string): string {
  const normalizedCode = code.trim();
  if (!normalizedCode) return "";
  if (normalizedCode === "Unidentified") return "";
  if (normalizedCode.startsWith("Key")) {
    return normalizedCode.slice(3);
  }
  if (normalizedCode.startsWith("Digit")) {
    return normalizedCode.slice(5);
  }
  if (normalizedCode === "Space" || normalizedCode === "Spacebar") {
    return "Space";
  }
  if (
    normalizedCode === "Tab" ||
    normalizedCode === "Enter" ||
    normalizedCode === "Escape" ||
    normalizedCode === "Backspace" ||
    normalizedCode === "Delete"
  ) {
    return normalizedCode;
  }
  if (normalizedCode.startsWith("Numpad")) {
    return normalizedCode.replace("Numpad", "Num");
  }
  return normalizedCode.replace(/(Left|Right)$/g, "");
}

function normalizeKeyLabel(key: string, keyCode: string): string {
  if (key === " " || key === "\u00A0") {
    return "Space";
  }
  if (key === "\t") {
    return "Tab";
  }
  if (key === "\n" || key === "\r" || key === "\r\n") {
    return "Enter";
  }
  const normalized = key.trim();
  if (!normalized) {
    return normalizeKeyCodeLabel(keyCode) || "Unknown";
  }
  if (normalized === "Unidentified") {
    return normalizeKeyCodeLabel(keyCode) || "Unknown";
  }
  if (
    normalized === "Tab" ||
    normalized === "Enter" ||
    normalized === "Backspace" ||
    normalized === "Delete"
  ) {
    return normalized;
  }

  const aliases: Record<string, string> = {
    Control: "Ctrl",
    Meta: "Cmd",
    Command: "Cmd",
    OS: "Cmd",
    Escape: "Esc",
    Spacebar: "Space",
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

/** UI label for a step block: `Шаг 1`, `Шаг 2`, etc. */
function formatStepBlockLabel(stepIndex: number): string {
  return `Шаг ${stepIndex + 1}`;
}

/**
 * Recognises step block names: `Шаг 1`, `step 2`, `шаг 03` etc. Returns the
 * 0-based step index or `null` if the input is a regular custom name.
 */
function parseStepBlockName(rawName: string): number | null {
  const normalized = rawName.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return null;
  const match = normalized.match(/^(?:шаг|step)\s+0*(\d{1,3})$/);
  if (!match) return null;
  const oneBased = Number.parseInt(match[1], 10);
  if (!Number.isFinite(oneBased) || oneBased < 1) return null;
  return oneBased - 1;
}

/** Find the task that backs a given step block (used for export labels). */
function findStepBlockTask<T extends { stepIndex: number; title: string }>(
  tasks: T[],
  stepIndex: number,
): T | null {
  return tasks.find((task) => task.stepIndex === stepIndex) ?? null;
}

function formatNoteTimestamp(timestampEpochMs: number): string {
  if (!timestampEpochMs) return "—";
  return new Date(timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExportTimestamp(timestampEpochMs: number): string {
  if (!timestampEpochMs) return "—";
  return new Date(timestampEpochMs).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type PersonalNotesCommand =
  | { kind: "none" }
  | { kind: "menu" }
  | { kind: "block_prompt" }
  | { kind: "block_apply"; blockName: string }
  | { kind: "unknown"; raw: string };

/**
 * Парсер слэш-команд в поле личных заметок.
 * Поддерживается только `/block <имя>` — закрытие блока теперь делается
 * крестиком на бейдже активного блока, отдельной команды нет.
 */
function parsePersonalNotesCommand(value: string): PersonalNotesCommand {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (!normalized.startsWith("/")) return { kind: "none" };
  if (normalized.includes("\n")) return { kind: "none" };
  const normalizedLower = normalized.toLowerCase();
  if (normalizedLower === "/") return { kind: "menu" };
  if ("/block".startsWith(normalizedLower)) {
    return { kind: "block_prompt" };
  }
  if (normalizedLower.startsWith("/block ")) {
    const blockName = normalized.slice("/block ".length).trim().slice(0, 80);
    if (!blockName) {
      return { kind: "block_prompt" };
    }
    return { kind: "block_apply", blockName };
  }
  return { kind: "unknown", raw: normalized };
}

type PersonalNotesExportOptions = {
  includeTimestamps: boolean;
  includeFreeNotes: boolean;
};

/**
 * Форматирует оценку шага из 5-балльной шкалы в кусочек текста для заголовка
 * блока (например, " — Оценка 4/5"). Если оценка не выставлена — возвращает
 * пустую строку, чтобы заголовок не разрастался.
 */
function formatStepRatingSuffix(rating: number | null | undefined): string {
  if (typeof rating !== "number" || rating < 1 || rating > 5) return "";
  return ` — Оценка ${rating}/5`;
}

/** Один текстовый ряд под `# ...` в выгрузке заметок: без переводов строк. */
function normalizeExportRoomHeadingLine(
  roomTitle: string | null | undefined,
): string {
  const normalized = (roomTitle ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return normalized || "Комната";
}

/**
 * Markdown выгрузки личных заметок: первая строка — `# название комнаты`.
 * Заметки — один поток по комнате, группы по блокам; шаг — «Шаг N - задача»
 * (+ оценка при наличии).
 */
function buildPersonalNotesMarkdownDocument(
  tasks: Array<{
    stepIndex: number;
    title: string;
  }>,
  entries: PersonalNoteEntry[],
  options: PersonalNotesExportOptions,
  /**
   * Карта оценок шагов вида `{ "0": 4, "1": null, ... }`. Ключ — индекс шага
   * как строка, значение — балл 1..5 либо null/отсутствует, если оценки нет.
   */
  taskScores: Record<string, number | null> = {},
  roomTitle?: string | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${normalizeExportRoomHeadingLine(roomTitle)}`);
  lines.push("");
  lines.push(`_Сформировано: ${formatExportTimestamp(Date.now())}_`);
  lines.push("");

  const sorted = entries
    .slice()
    .sort(
      (left, right) =>
        left.timestampEpochMs - right.timestampEpochMs ||
        left.id.localeCompare(right.id),
    );

  type ExportBlock = {
    key: string;
    displayName: string;
    entries: PersonalNoteEntry[];
    /**
     * Индекс шага для блока, привязанного к шагу. У кастомных блоков — `null`,
     * чтобы при сортировке экспорта сначала шли шаги по возрастанию `stepIndex`,
     * а уже после них — кастомные блоки в порядке появления.
     */
    stepIndex: number | null;
    /**
     * Порядковый номер вставки. Используется как стабильный вторичный ключ
     * сортировки для кастомных блоков (сохраняем порядок появления).
     */
    insertionOrder: number;
  };
  const freeEntries: PersonalNoteEntry[] = [];
  const blocks = new Map<string, ExportBlock>();
  let nextInsertionOrder = 0;

  sorted.forEach((entry) => {
    const stepIndex = entry.blockStepIndex;
    if (typeof stepIndex === "number") {
      const stepKey = `step:${stepIndex}`;
      const taskTitle =
        findStepBlockTask(tasks, stepIndex)?.title.trim() ?? "";
      const baseLabel = taskTitle
        ? `${formatStepBlockLabel(stepIndex)} - ${taskTitle}`
        : formatStepBlockLabel(stepIndex);
      const ratingSuffix = formatStepRatingSuffix(
        taskScores[String(stepIndex)],
      );
      const displayName = `${baseLabel}${ratingSuffix}`;
      const existing = blocks.get(stepKey);
      if (existing) {
        existing.entries.push(entry);
        existing.displayName = displayName;
      } else {
        blocks.set(stepKey, {
          key: stepKey,
          displayName,
          entries: [entry],
          stepIndex,
          insertionOrder: nextInsertionOrder++,
        });
      }
      return;
    }
    const customName = entry.blockName?.trim() ?? "";
    if (!customName) {
      freeEntries.push(entry);
      return;
    }
    const customKey = `custom:${customName.toLocaleLowerCase("ru-RU")}`;
    const existing = blocks.get(customKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      blocks.set(customKey, {
        key: customKey,
        displayName: customName,
        entries: [entry],
        stepIndex: null,
        insertionOrder: nextInsertionOrder++,
      });
    }
  });

  const formatEntry = (entry: PersonalNoteEntry) => {
    const prefix = options.includeTimestamps
      ? `[${formatExportTimestamp(entry.timestampEpochMs)}] `
      : "";
    return `- ${prefix}${entry.text}`;
  };

  /**
   * Если у шага есть оценка, но нет ни одной заметки — всё равно выводим
   * блок (без записей), чтобы экспорт показывал оценку каждого шага.
   * Шаги без заметок и без оценки опускаем.
   */
  tasks
    .slice()
    .sort((left, right) => left.stepIndex - right.stepIndex)
    .forEach((task) => {
      const stepKey = `step:${task.stepIndex}`;
      if (blocks.has(stepKey)) return;
      const rating = taskScores[String(task.stepIndex)];
      if (typeof rating !== "number" || rating < 1 || rating > 5) return;
      const baseLabel = task.title.trim()
        ? `${formatStepBlockLabel(task.stepIndex)} - ${task.title.trim()}`
        : formatStepBlockLabel(task.stepIndex);
      blocks.set(stepKey, {
        key: stepKey,
        displayName: `${baseLabel}${formatStepRatingSuffix(rating)}`,
        entries: [],
        stepIndex: task.stepIndex,
        insertionOrder: nextInsertionOrder++,
      });
    });

  /**
   * Шаговые блоки выводим строго по `stepIndex` (Шаг 1, 2, 3...), кастомные —
   * в порядке появления. Записи внутри блоков уже отсортированы по времени
   * выше через `sorted`. «В свободной форме» уезжает в самый конец, чтобы
   * шаги шли первыми, как и просит пользователь.
   */
  const orderedBlocks = Array.from(blocks.values()).sort((left, right) => {
    if (left.stepIndex !== null && right.stepIndex !== null) {
      return left.stepIndex - right.stepIndex;
    }
    if (left.stepIndex !== null) return -1;
    if (right.stepIndex !== null) return 1;
    return left.insertionOrder - right.insertionOrder;
  });

  orderedBlocks.forEach((block) => {
    lines.push(`## ${block.displayName}`);
    if (block.entries.length === 0) {
      lines.push("- _Заметок нет_");
    } else {
      block.entries.forEach((entry) => lines.push(formatEntry(entry)));
    }
    lines.push("");
  });

  if (options.includeFreeNotes && freeEntries.length > 0) {
    lines.push("## В свободной форме");
    freeEntries.forEach((entry) => lines.push(formatEntry(entry)));
    lines.push("");
  }

  if (lines.length <= 4) {
    lines.push("Заметок пока нет.");
    lines.push("");
  }

  return lines.join("\n");
}

function buildRoomExportFileName(
  roomTitle: string | null | undefined,
  extension: "md" | "pdf",
): string {
  const normalizedTitle = (roomTitle ?? "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  const baseName = normalizedTitle || "room-notes";
  return `${baseName}.${extension}`;
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  const debugWindow = window as Window & {
    __roomLastDownload?: { fileName: string; mime: string; timestamp: number };
  };
  debugWindow.__roomLastDownload = {
    fileName,
    mime: blob.type,
    timestamp: Date.now(),
  };
  URL.revokeObjectURL(href);
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

  const exportPersonalNotesMarkdown = useCallback(() => {
    if (!merged) return;
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
  }, [
    exportIncludeFreeNotes,
    exportIncludeTimestamps,
    merged,
    room?.title,
    mergedTasks,
    visiblePersonalNotes,
  ]);

  const exportPersonalNotesPdf = useCallback(async () => {
    if (!merged) return;
    try {
      const pdfFileName = buildRoomExportFileName(room?.title, "pdf");
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
      const { jsPDF } = await import("jspdf");
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const marginMm = 12;
      const printableWidthMm = pageWidthMm - marginMm * 2;
      const printableHeightMm = pageHeightMm - marginMm * 2;
      const canvasWidthPx = 1200;
      const pxPerMm = canvasWidthPx / printableWidthMm;
      const pageHeightPx = Math.max(1, Math.floor(printableHeightMm * pxPerMm));
      const pageWidthPx = canvasWidthPx;

      const measureCanvas = document.createElement("canvas");
      const measureCtx = measureCanvas.getContext("2d");
      if (!measureCtx) {
        throw new Error("Unable to create 2D context for PDF export");
      }

      const styledRows = markdown.split("\n").map((line) => {
        if (!line.trim()) {
          return { text: "", fontSize: 18, bold: false, marginTop: 4, marginBottom: 8 };
        }
        if (line.startsWith("# ")) {
          return { text: line.slice(2), fontSize: 40, bold: true, marginTop: 8, marginBottom: 14 };
        }
        if (line.startsWith("## ")) {
          return { text: line.slice(3), fontSize: 32, bold: true, marginTop: 8, marginBottom: 10 };
        }
        if (line.startsWith("### ")) {
          return { text: line.slice(4), fontSize: 27, bold: true, marginTop: 6, marginBottom: 8 };
        }
        if (line.startsWith("- ")) {
          return { text: `• ${line.slice(2)}`, fontSize: 20, bold: false, marginTop: 2, marginBottom: 4 };
        }
        const trimmed = line.trim();
        if (trimmed.startsWith("_") && trimmed.endsWith("_") && trimmed.length > 1) {
          return {
            text: trimmed.slice(1, -1),
            fontSize: 19,
            bold: false,
            marginTop: 2,
            marginBottom: 6,
          };
        }
        return { text: line, fontSize: 20, bold: false, marginTop: 2, marginBottom: 5 };
      });

      const wrapLine = (text: string, maxWidth: number, fontSize: number, bold: boolean) => {
        const normalized = text.replace(/\s+/g, " ").trim();
        if (!normalized) return [""];
        measureCtx.font = `${bold ? 700 : 400} ${fontSize}px "IBM Plex Sans", "Segoe UI", Arial, sans-serif`;
        const words = normalized.split(" ");
        const wrapped: string[] = [];
        let current = "";
        words.forEach((word) => {
          const candidate = current ? `${current} ${word}` : word;
          if (measureCtx.measureText(candidate).width <= maxWidth || !current) {
            current = candidate;
          } else {
            wrapped.push(current);
            current = word;
          }
        });
        if (current) wrapped.push(current);
        return wrapped.length > 0 ? wrapped : [normalized];
      };

      const pages: Array<
        Array<{ text: string; y: number; fontSize: number; bold: boolean }>
      > = [[]];
      let pageIndex = 0;
      let cursorY = 0;
      const ensurePage = () => {
        if (!pages[pageIndex]) {
          pages[pageIndex] = [];
        }
      };
      ensurePage();

      styledRows.forEach((row) => {
        const wrapped = wrapLine(row.text, pageWidthPx - 16, row.fontSize, row.bold);
        cursorY += row.marginTop;
        const lineHeight = Math.ceil(row.fontSize * 1.45);
        wrapped.forEach((line) => {
          if (cursorY + lineHeight > pageHeightPx && pages[pageIndex].length > 0) {
            pageIndex += 1;
            cursorY = 0;
            ensurePage();
          }
          pages[pageIndex].push({
            text: line,
            y: cursorY,
            fontSize: row.fontSize,
            bold: row.bold,
          });
          cursorY += lineHeight;
        });
        cursorY += row.marginBottom;
      });

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      pages.forEach((pageLines, index) => {
        if (index > 0) {
          pdf.addPage("a4", "portrait");
        }
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = pageWidthPx;
        pageCanvas.height = pageHeightPx;
        const pageCtx = pageCanvas.getContext("2d");
        if (!pageCtx) return;
        pageCtx.fillStyle = "#ffffff";
        pageCtx.fillRect(0, 0, pageWidthPx, pageHeightPx);
        pageCtx.fillStyle = "#10151c";
        pageLines.forEach((line) => {
          pageCtx.font = `${line.bold ? 700 : 400} ${line.fontSize}px "IBM Plex Sans", "Segoe UI", Arial, sans-serif`;
          pageCtx.fillText(line.text, 8, line.y + line.fontSize);
        });
        pdf.addImage(
          pageCanvas.toDataURL("image/png"),
          "PNG",
          marginMm,
          marginMm,
          printableWidthMm,
          printableHeightMm,
        );
      });
      const pdfBlob = pdf.output("blob");
      triggerBrowserDownload(pdfBlob, pdfFileName);
    } catch (error) {
      console.error("PRIVATE_NOTES_PDF_EXPORT_FAIL", error);
    }
  }, [
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

  /**
   * Глобальные слушатели клавиатуры и фокуса на стороне кандидата. Они
   * закрывают пробелы, которые не покрывает `keydown`-хэндлер CodeMirror:
   *   1. Клавиши, нажатые когда фокус не в редакторе (модалки, заметки,
   *      адресная строка браузера и т.п.) — глобальный `keydown` в фазе
   *      capture.
   *   2. `Alt+Tab`/`Cmd+Tab`/смена приложения — ОС перехватывает Tab до
   *      браузера, но окно теряет фокус: ловим `window.blur` и пишем в лог
   *      синтетическое событие с накопленным состоянием модификаторов
   *      (например «Alt+Tab — переключение окна»).
   *   3. Смена вкладки внутри браузера — `document.visibilitychange`.
   */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (merged?.role !== "candidate") return undefined;

    /** Запоминаем последнее состояние модификаторов, чтобы при blur'е
     *  понимать, нажат ли был Alt/Cmd, и формировать осмысленный лейбл. */
    const modifierState = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    };

    const updateModifiers = (event: KeyboardEvent) => {
      modifierState.ctrl = event.ctrlKey;
      modifierState.alt = event.altKey;
      modifierState.shift = event.shiftKey;
      modifierState.meta = event.metaKey;
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      updateModifiers(event);
      // Если фокус в CodeMirror — у редактора есть свой keydown-хэндлер,
      // который уже отправит событие. Дублировать не нужно.
      const target = event.target;
      if (target instanceof Element && target.closest(".cm-content")) {
        return;
      }
      handleCandidateKeyPress({
        key: event.key,
        keyCode: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });
    };

    const onWindowKeyUp = (event: KeyboardEvent) => {
      updateModifiers(event);
    };

    /** Эмитим синтетическое «Tab» с реальным состоянием модификаторов: на
     *  бэкенде/UI получится «Alt+Tab — переключение окна», даже если ОС
     *  забрала сам Tab себе. */
    const emitFocusEvent = (eventKind: CandidateKeyEventKind) => {
      handleCandidateKeyPress({
        key: "Tab",
        keyCode: "Tab",
        ctrlKey: modifierState.ctrl,
        altKey: modifierState.alt,
        shiftKey: modifierState.shift,
        metaKey: modifierState.meta,
        eventKind,
      });
    };

    const onWindowBlur = () => {
      emitFocusEvent("window_blur");
    };

    const onWindowFocus = () => {
      // После возврата фокуса состояние модификаторов гарантированно
      // сброшено (ОС забрала keyup), поэтому обнуляем сами.
      modifierState.ctrl = false;
      modifierState.alt = false;
      modifierState.shift = false;
      modifierState.meta = false;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        emitFocusEvent("tab_hidden");
      } else if (document.visibilityState === "visible") {
        emitFocusEvent("tab_visible");
      }
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [merged?.role, handleCandidateKeyPress]);

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
  const ownerBriefingValue = briefingDirty
    ? briefingDraft
    : mergedBriefingMarkdown;
  const candidateBriefingValue = mergedBriefingMarkdown;

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
            briefingMarkdown={ownerBriefingValue}
            onBriefingChange={changeBriefingMarkdown}
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
  onToggleInterviewerRole,
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
            <div
              className={styles.participantsInline}
              aria-label="Участники комнаты"
            >
              {participants.map((participant) => {
                const presenceLabel = getParticipantPresenceLabel(
                  participant.presenceStatus,
                );
                const canOpenMenu =
                  canGrantAccess &&
                  participant.role !== "owner" &&
                  (participant.canBeGrantedInterviewerAccess ?? true);
                const isInterviewer = participant.role === "interviewer";
                const menuActionLabel = isInterviewer
                  ? "Снять роль интервьюера"
                  : "Назначить интервьюером";
                const { color: cursorColor, colorLight: cursorColorLight } =
                  awarenessUserColors(participant.sessionId);
                const participantCard = (
                  <span className={styles.participantNameRow}>
                    <span className={styles.participantName}>
                      {participant.displayName}
                    </span>
                    {isInterviewer ? (
                      <span
                        className={styles.participantInterviewerStar}
                        aria-label="Интервьюер"
                        title="Интервьюер"
                      >
                        *
                      </span>
                    ) : null}
                  </span>
                );
                const participantStyle = {
                  "--participant-role-color": cursorColor,
                  "--participant-cursor-color": cursorColor,
                  "--participant-cursor-color-light": cursorColorLight,
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
                  <Menu
                    key={participant.sessionId}
                    withinPortal
                    position="bottom"
                    shadow="md"
                    offset={8}
                  >
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
                      <Menu.Item
                        onClick={() => onToggleInterviewerRole(participant)}
                      >
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
                onChange={(value) =>
                  onLanguageChange(value ? normalizeRoomLanguage(value) : null)
                }
                className={styles.topLanguageSelect}
                classNames={{
                  input: styles.topLanguageInput,
                  dropdown: styles.topLanguageDropdown,
                  option: styles.topLanguageOption,
                }}
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
            <Button
              component={Link}
              to="/"
              size="xs"
              variant="outline"
              color="gray"
              leftSection={<IconHome2 size={14} />}
            >
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
  briefingMarkdown,
  onBriefingChange,
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
  briefingMarkdown: string;
  onBriefingChange: (value: string) => void;
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
  const [leftPanelWidth, setLeftPanelWidth] = useState(288);
  /**
   * Динамический потолок ширины левой панели — половина окна. Минимум остаётся
   * жёстким (`MIN_OWNER_PANEL_WIDTH`), чтобы при сжатии окна панель не уходила
   * в зеро. На SSR/первом рендере отдаём fallback, на mount подменяем реальным
   * значением из `window.innerWidth`.
   */
  const [maxOwnerPanelWidth, setMaxOwnerPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return MAX_OWNER_PANEL_WIDTH_FALLBACK;
    return computeMaxOwnerPanelWidth(window.innerWidth);
  });
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const recompute = () =>
      setMaxOwnerPanelWidth(computeMaxOwnerPanelWidth(window.innerWidth));
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);
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

  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);

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

  const startDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        startX: event.clientX,
        startWidth: leftPanelWidth,
      };
      setIsDragging(true);
    },
    [leftPanelWidth],
  );

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

  const handleResizeHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setLeftPanelWidth((current) =>
          clamp(current - 16, MIN_OWNER_PANEL_WIDTH, maxOwnerPanelWidth),
        );
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setLeftPanelWidth((current) =>
          clamp(current + 16, MIN_OWNER_PANEL_WIDTH, maxOwnerPanelWidth),
        );
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setLeftPanelWidth(MIN_OWNER_PANEL_WIDTH);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setLeftPanelWidth(maxOwnerPanelWidth);
      }
    },
    [maxOwnerPanelWidth],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;
      // Берём актуальный потолок прямо из window — на случай если окно
      // ресайзнули в момент перетаскивания.
      const dynamicMax = computeMaxOwnerPanelWidth(
        typeof window === "undefined"
          ? MAX_OWNER_PANEL_WIDTH_FALLBACK
          : window.innerWidth,
      );
      setLeftPanelWidth(
        clamp(
          dragState.startWidth + delta,
          MIN_OWNER_PANEL_WIDTH,
          dynamicMax,
        ),
      );
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
  const clampedLeftPanelWidth = clamp(
    leftPanelWidth,
    MIN_OWNER_PANEL_WIDTH,
    maxOwnerPanelWidth,
  );
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
              isCompactLayout ? undefined : { width: clampedLeftPanelWidth }
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
                    return (
                      <button
                        key={task.stepIndex}
                        type="button"
                        className={styles.stepRow}
                        data-active={isActiveStep ? "true" : undefined}
                        aria-current={isActiveStep ? "step" : undefined}
                        onClick={() => handleTaskStepSelect(task.stepIndex)}
                        title={fullLabel}
                      >
                        <span className={styles.stepRowIndex} aria-hidden="true">
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
                    <Group justify="flex-end">
                      <Button
                        variant="light"
                        color="gray"
                        leftSection={<IconDownload size={14} />}
                        onClick={onExportPrivateNotesMarkdown}
                      >
                        Скачать .md
                      </Button>
                      <Button
                        leftSection={<IconDownload size={14} />}
                        onClick={onExportPrivateNotesPdf}
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
              aria-valuemin={MIN_OWNER_PANEL_WIDTH}
              aria-valuemax={maxOwnerPanelWidth}
              aria-valuenow={Math.round(clampedLeftPanelWidth)}
              aria-label="Изменить ширину левой панели"
              onMouseDown={startDrag}
              onKeyDown={handleResizeHandleKeyDown}
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
              />
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
}: {
  merged: RealtimeState;
  stepTitle: string;
  stepStarterCode: string;
  briefingMarkdown: string;
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
      />

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

function BriefingBoard({
  mode,
  value,
  onChange,
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
    [onChange, value],
  );

  const applyLinePrefix = useCallback(
    (prefix: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? 0;
      const selectionEnd = textarea?.selectionEnd ?? 0;
      const blockStart =
        value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
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
    [onChange, value],
  );

  const insertSnippet = useCallback(
    (snippet: string) => {
      if (!onChange) return;
      const textarea = editorRef.current;
      const selectionStart = textarea?.selectionStart ?? value.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const needsLeadingLineBreak =
        selectionStart > 0 && value[selectionStart - 1] !== "\n";
      const needsTrailingLineBreak =
        selectionEnd < value.length && value[selectionEnd] !== "\n";
      const prefix = needsLeadingLineBreak ? "\n" : "";
      const suffix = needsTrailingLineBreak ? "\n" : "";
      const next = `${value.slice(0, selectionStart)}${prefix}${snippet}${suffix}${value.slice(selectionEnd)}`;
      onChange(next);
      const nextSelectionStart = selectionStart + prefix.length;
      const nextSelectionEnd = nextSelectionStart + snippet.length;
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(nextSelectionStart, nextSelectionEnd);
      });
    },
    [onChange, value],
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
      if (tool === "table") {
        return insertSnippet(
          "| Left columns  | Right columns |\n| ------------- |:-------------:|\n| left foo      | right foo     |\n| left bar      | right bar     |\n| left baz      | right baz     |",
        );
      }
    },
    [applyLinePrefix, applyWrap, insertSnippet],
  );

  return (
    <Box className={styles.briefingPanel} data-mode={mode}>
      {mode === "interviewer" ? (
        <>
          <div className={styles.briefingToolbar}>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Жирный текст"
              title="Жирный текст"
              onClick={() => applyMarkdownTool("bold")}
            >
              B
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Курсив"
              title="Курсив"
              onClick={() => applyMarkdownTool("italic")}
            >
              I
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Вставить код"
              title="Вставить код"
              onClick={() => applyMarkdownTool("code")}
            >
              {"</>"}
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Вставить ссылку"
              title="Вставить ссылку"
              onClick={() => applyMarkdownTool("link")}
            >
              Link
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Заголовок H1"
              title="Заголовок H1"
              onClick={() => applyMarkdownTool("h1")}
            >
              H1
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Заголовок H2"
              title="Заголовок H2"
              onClick={() => applyMarkdownTool("h2")}
            >
              H2
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Маркированный список"
              title="Маркированный список"
              onClick={() => applyMarkdownTool("ul")}
            >
              • List
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Нумерованный список"
              title="Нумерованный список"
              onClick={() => applyMarkdownTool("ol")}
            >
              1. List
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Цитата"
              title="Цитата"
              onClick={() => applyMarkdownTool("quote")}
            >
              Quote
            </button>
            <button
              type="button"
              className={styles.briefingToolButton}
              aria-label="Table"
              title="Table"
              onClick={() => applyMarkdownTool("table")}
            >
              Table
            </button>
          </div>
          <div className={styles.briefingSplit}>
            <Textarea
              value={value}
              onChange={(event) => onChange?.(event.currentTarget.value)}
              minRows={6}
              placeholder="Например: # План\n- Что делаем\n- На что смотреть"
              data-testid="room-markdown-editor"
              classNames={{
                root: styles.briefingEditorRoot,
                wrapper: styles.briefingEditorWrapper,
                input: styles.briefingEditorInput,
              }}
              ref={editorRef}
            />
            <div
              className={styles.briefingPreviewPane}
              data-testid="room-markdown-preview"
            >
              {html ? (
                <div
                  className={styles.briefingMarkdown}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <Text className={styles.briefingEmpty}>{emptyText}</Text>
              )}
            </div>
          </div>
        </>
      ) : (
        <div
          className={styles.briefingPreviewPane}
          data-testid="room-markdown-preview"
        >
          {html ? (
            <div
              className={styles.briefingMarkdown}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <Text className={styles.briefingEmpty}>{emptyText}</Text>
          )}
        </div>
      )}
    </Box>
  );
}

/**
 * Собирает префикс из активных модификаторов («Cmd+», «Alt+Shift+» и т.п.)
 * для строки лога. Используется и обычными `keydown`, и синтетическими
 * событиями (blur/visibility), чтобы лейбл «Alt+Tab — переключение окна»
 * корректно отражал, какие клавиши держал кандидат.
 */
function buildModifierPrefix(
  event: Pick<
    CandidateKeyInfo,
    "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  >,
  exclude: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {},
): string {
  const modifiers: string[] = [];
  if (event.ctrlKey && !exclude.ctrl) modifiers.push("Ctrl");
  if (event.altKey && !exclude.alt) modifiers.push("Alt");
  if (event.shiftKey && !exclude.shift) modifiers.push("Shift");
  if (event.metaKey && !exclude.meta) modifiers.push("Cmd");
  return modifiers.length > 0 ? `${modifiers.join("+")}+` : "";
}

function formatCandidateKey(event: CandidateKeyInfo): string {
  /**
   * Синтетические события focus/visibility: ОС забирает себе сам Tab при
   * Alt+Tab/Cmd+Tab, и `keydown` для него до браузера не доходит. Мы знаем
   * только то, что окно/вкладка потеряли фокус и какие модификаторы при
   * этом были нажаты — формируем понятный составной лейбл.
   */
  const eventKind = event.eventKind ?? "keydown";
  if (eventKind !== "keydown") {
    const prefix = buildModifierPrefix(event);
    switch (eventKind) {
      case "window_blur":
        return prefix
          ? `${prefix}Tab — переключение окна`
          : "Переключение окна";
      case "window_focus":
        return "Возврат в окно";
      case "tab_hidden":
        return prefix
          ? `${prefix}Tab — смена вкладки`
          : "Смена вкладки";
      case "tab_visible":
        return "Возврат на вкладку";
      default:
        return prefix ? `${prefix}${eventKind}` : eventKind;
    }
  }

  const keyLabel = normalizeKeyLabel(event.key || "", event.keyCode || "");
  const isCtrlKey = keyLabel === "Ctrl";
  const isAltKey = keyLabel === "Alt";
  const isShiftKey = keyLabel === "Shift";
  const isMetaKey = keyLabel === "Cmd" || keyLabel === "Meta";
  const prefix = buildModifierPrefix(event, {
    ctrl: isCtrlKey,
    alt: isAltKey,
    shift: isShiftKey,
    meta: isMetaKey,
  });

  const key =
    keyLabel || normalizeKeyCodeLabel(event.keyCode || "") || "Unknown";
  return `${prefix}${key}`;
}

function formatCandidateKeyHistoryTimestamp(event: CandidateKeyInfo): string {
  return new Date(event.timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeIdentityValue(value?: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function participantIdentityKey(input: {
  sessionId?: string | null;
  participantId?: string | null;
  userId?: string | null;
}): string | null {
  const userId = normalizeIdentityValue(input.userId);
  if (userId) return `user:${userId}`;
  const participantId = normalizeIdentityValue(input.participantId);
  if (participantId) return `guest:${participantId}`;
  const sessionId = normalizeIdentityValue(input.sessionId);
  if (sessionId) return `session:${sessionId}`;
  return null;
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

function hashSessionId(sessionId: string): number {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function awarenessUserColors(sessionId: string): {
  color: string;
  colorLight: string;
} {
  const hue = hashSessionId(sessionId) % 360;
  return {
    color: `hsl(${hue} 68% 58%)`,
    colorLight: `hsla(${hue} 68% 58% / 0.24)`,
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
  const localUser = (awareness.states.get(localId)?.user ?? undefined) as
    | {
        sessionId?: string;
        participantId?: string;
        userId?: string;
        name?: string;
        color?: string;
      }
    | undefined;

  const clockOf = (clientId: number) =>
    awareness.meta.get(clientId)?.clock ?? 0;
  const lastUpdatedOf = (clientId: number) =>
    awareness.meta.get(clientId)?.lastUpdated ?? 0;

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

  const awarenessIdentityKey = (
    user: AwarenessUser | undefined,
  ): string | null => {
    if (!user) return null;
    return (
      participantIdentityKey({
        userId: user.userId,
        participantId: user.participantId,
        sessionId: user.sessionId,
      }) ?? `legacy:${String(user.name ?? "")}|${String(user.color ?? "")}`
    );
  };
  const localIdentityKey = awarenessIdentityKey(localUser);
  const forEachRemoteAwarenessUser = (
    visitor: (clientId: number, key: string) => void,
  ) => {
    awareness.states.forEach((_state, clientId) => {
      if (clientId === localId) return;
      const st = awareness.states.get(clientId);
      const user = st?.user as AwarenessUser | undefined;
      if (!user) return;
      const key = awarenessIdentityKey(user);
      if (!key) return;
      visitor(clientId, key);
    });
  };

  const winnerByKey = new Map<string, number>();
  forEachRemoteAwarenessUser((clientId, key) => {
    if (localIdentityKey && key === localIdentityKey) return;
    const prev = winnerByKey.get(key);
    if (prev === undefined || remoteWinsOver(clientId, prev)) {
      winnerByKey.set(key, clientId);
    }
  });

  const toRemove = new Set<number>();
  forEachRemoteAwarenessUser((clientId, key) => {
    if (localIdentityKey && key === localIdentityKey) {
      toRemove.add(clientId);
      return;
    }
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
      hasSessionId.add(
        `${String((st?.user as { name?: string }).name ?? "")}|${String((st?.user as { color?: string }).color ?? "")}`,
      );
    }
  });
  awareness.states.forEach((_state, clientId) => {
    if (clientId === localId) return;
    const st = awareness.states.get(clientId);
    const u = st?.user as
      | { sessionId?: string; name?: string; color?: string }
      | undefined;
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
    borderRight: "none",
  },
  ".cm-ySelectionCaret::after": {
    display: "none !important",
    content: "none",
  },
  ".cm-ySelectionCaret::before": {
    display: "none !important",
    content: "none",
  },
  ".cm-ySelectionInfo": {
    display: "none !important",
  },
  ".cm-ySelectionInfo::before": {
    display: "none !important",
  },
  ".cm-ySelectionCaretDot": {
    display: "none !important",
  },
});

function RoomCodeEditor({
  height,
  language,
  value,
  serverYjsBase64 = null,
  serverYjsSequence = 0,
  lastCodeUpdatedBySessionId = null,
  syncKey,
  resyncSignal,
  readOnly,
  sessionId,
  participantId,
  participantLabel,
  sendAwarenessUpdate,
  onAwarenessBridgeReady,
  onYjsUpdate,
  onYjsBridgeReady,
  onEditorValueChange,
  onKeyPress,
}: {
  height: string;
  language: string;
  value: string;
  serverYjsBase64?: string | null;
  serverYjsSequence?: number;
  lastCodeUpdatedBySessionId?: string | null;
  syncKey: string;
  resyncSignal: number;
  readOnly: boolean;
  sessionId: string;
  participantId: string;
  participantLabel: string;
  sendAwarenessUpdate: (awarenessUpdate: string) => void;
  onAwarenessBridgeReady: (applyFn: ((b64: string) => void) | null) => void;
  onYjsUpdate: YjsUpdateHandler;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onEditorValueChange: (value: string) => void;
  onKeyPress: (payload: KeyPressPayload) => void;
}) {
  type CmHostElement = HTMLDivElement & {
    __roomEditorView?: EditorView | null;
  };
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
  const latestServerYjsSequenceRef = useRef(0);
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
          head: Y.createRelativePositionFromTypeIndex(yText, next.head),
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
    latestServerYjsSequenceRef.current =
      typeof serverYjsSequence === "number" &&
      Number.isFinite(serverYjsSequence)
        ? Math.max(0, Math.floor(serverYjsSequence))
        : 0;
  }, [serverYjsSequence]);

  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    const st = awareness.getLocalState();
    if (!st?.user) return;
    const name = participantLabel.trim() || "Участник";
    if (
      st.user.name === name &&
      (st.user as { sessionId?: string }).sessionId === sessionId &&
      (st.user as { participantId?: string }).participantId === participantId
    )
      return;
    awareness.setLocalState({
      ...st,
      user: { ...st.user, name, sessionId, participantId },
    });
  }, [participantId, participantLabel, sessionId]);

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
      const hostElement = hostRef.current as CmHostElement | null;
      if (hostElement) {
        hostElement.__roomEditorView = null;
      }
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
    const normalizedServerYjsSequence =
      typeof serverYjsSequence === "number" &&
      Number.isFinite(serverYjsSequence)
        ? Math.max(0, Math.floor(serverYjsSequence))
        : 0;
    const hasExistingServerYjsState = normalizedServerYjsSequence > 0;
    let yDoc = new Y.Doc();
    let bootstrappedFromSnapshot = false;
    if (snap) {
      try {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(yDoc, raw, "bootstrap");
          bootstrappedFromSnapshot = true;
          trackEvent("prod_editor_bootstrap_server_snapshot", {
            yjs_sequence: normalizedServerYjsSequence,
          });
        }
      } catch {
        /* invalid snapshot */
      }
    }
    if (!bootstrappedFromSnapshot && !hasExistingServerYjsState) {
      trackEvent("prod_editor_bootstrap_code_fallback", {
        reason: "empty_server_state",
        yjs_sequence: normalizedServerYjsSequence,
      });
      Y.applyUpdate(
        yDoc,
        createDeterministicBootstrapUpdate(targetCode),
        "bootstrap",
      );
    }
    let yText = yDoc.getText("room-code");
    // Server CRDT snapshot can disagree with `merged.code` (last writer / ordering); never replace a merged doc with the plain string.
    if (
      yText.toString() !== targetCode &&
      !snap &&
      !hasExistingServerYjsState
    ) {
      trackEvent("prod_editor_bootstrap_code_rebuild", {
        reason: "code_mismatch_after_bootstrap",
        yjs_sequence: normalizedServerYjsSequence,
      });
      yDoc.destroy();
      yDoc = new Y.Doc();
      Y.applyUpdate(
        yDoc,
        createDeterministicBootstrapUpdate(targetCode),
        "bootstrap",
      );
      yText = yDoc.getText("room-code");
    }
    if (!bootstrappedFromSnapshot && hasExistingServerYjsState) {
      trackEvent("prod_editor_bootstrap_missing_snapshot", {
        yjs_sequence: normalizedServerYjsSequence,
      });
    }
    yDocRef.current = yDoc;
    yTextRef.current = yText;

    const awareness = new Awareness(yDoc);
    awarenessRef.current = awareness;
    const colorSeed = participantId.trim() || sessionId;
    const { color, colorLight } = awarenessUserColors(colorSeed);
    awareness.setLocalState({
      user: {
        name: participantLabel.trim() || "Участник",
        color,
        colorLight,
        sessionId,
        participantId,
      },
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
      {
        added,
        updated,
        removed,
      }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
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
          closeBrackets(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle),
          keymap.of([
            indentWithTab,
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
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
                metaKey: event.metaKey,
              });
              if (viewInstance.state.readOnly) {
                event.preventDefault();
                return true;
              }
              return false;
            },
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    const hostElement = hostRef.current as CmHostElement | null;
    if (hostElement) {
      hostElement.__roomEditorView = view;
    }
    onEditorValueChangeRef.current(view.state.doc.toString());

    syncKeyRef.current = syncKey;

    const handleDocUpdate = (updateBytes: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "bootstrap") return;
      const encodedUpdate = bytesToBase64(updateBytes);
      // Always send full Yjs state with each local edit so the server snapshot stays current.
      // After a tab refresh, missed SSE increments cannot be replayed; reconnecting clients rely on state_sync yjsDocumentBase64.
      const fullDoc = bytesToBase64(Y.encodeStateAsUpdate(yDoc));
      onYjsUpdateRef.current(
        encodedUpdate,
        syncKeyRef.current,
        yText.toString(),
        fullDoc,
        latestServerYjsSequenceRef.current,
      );
    };
    yDoc.on("update", handleDocUpdate);

    const emitFullSnapshot = () => {
      const d = yDocRef.current;
      const t = yTextRef.current;
      if (!d || !t) return;
      const full = bytesToBase64(Y.encodeStateAsUpdate(d));
      onYjsUpdateRef.current(
        "",
        syncKeyRef.current,
        t.toString(),
        full,
        latestServerYjsSequenceRef.current,
      );
    };

    // Idle tabs still refresh the server snapshot so a reloaded peer does not bootstrap from stale CRDT state.
    const heartbeatId = window.setInterval(() => {
      emitFullSnapshot();
    }, 2500);

    onYjsBridgeReady((encodedYjsUpdate: string) => {
      const activeDoc = yDocRef.current;
      if (!activeDoc) return;
      const updateBytes = base64ToBytes(encodedYjsUpdate);
      if (updateBytes.length === 0) return;
      Y.applyUpdate(activeDoc, updateBytes, "remote");
    });

    const snapshotTimerId = window.setTimeout(() => {
      emitFullSnapshot();
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
      const nextHost = hostRef.current as CmHostElement | null;
      if (nextHost) {
        nextHost.__roomEditorView = null;
      }
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
    const seq =
      typeof serverYjsSequence === "number" && !Number.isNaN(serverYjsSequence)
        ? serverYjsSequence
        : 0;
    const snap = serverYjsBase64?.trim() ?? "";
    const seqAdvanced = seq > lastAppliedServerYjsSeqRef.current;
    const snapChangedAtSameSeq =
      seq === lastAppliedServerYjsSeqRef.current &&
      snap !== lastAppliedServerYjsSnapRef.current;
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
  }, [
    bumpLocalAwarenessAfterRemoteDocChange,
    serverYjsBase64,
    serverYjsSequence,
    syncKey,
  ]);

  /** Step change or explicit resync (focus/reconnect): merge server Y snapshot or plain code fallback. */
  useEffect(() => {
    const activeDoc = yDocRef.current;
    if (!activeDoc) return;
    const syncKeyChanged = syncKeyRef.current !== syncKey;
    syncKeyRef.current = syncKey;
    const forceHydrateFromState =
      resyncSignal > lastHandledResyncSignalRef.current;
    if (forceHydrateFromState) {
      lastHandledResyncSignalRef.current = resyncSignal;
    }
    if (!syncKeyChanged && !forceHydrateFromState) return;

    const t = activeDoc.getText("room-code");
    const next = value ?? "";
    const snap = serverYjsBase64?.trim() ?? "";
    const normalizedServerYjsSequence =
      typeof serverYjsSequence === "number" &&
      Number.isFinite(serverYjsSequence)
        ? Math.max(0, Math.floor(serverYjsSequence))
        : 0;
    const hasRemoteHistoryWithoutSnapshot =
      !snap && normalizedServerYjsSequence > 0;

    roomSyncLog("hydrate_from_server", {
      syncKeyChanged,
      resync: forceHydrateFromState,
      hasYjsSnap: Boolean(snap),
      codeLen: next.length,
    });
    try {
      if (snap) {
        const raw = base64ToBytes(snap);
        if (raw.length > 0) {
          Y.applyUpdate(activeDoc, raw, "remote");
        }
      }
      if (!snap && t.toString() !== next && !hasRemoteHistoryWithoutSnapshot) {
        activeDoc.transact(() => {
          t.delete(0, t.length);
          if (next) t.insert(0, next);
        }, "remote");
      }
      if (!snap && hasRemoteHistoryWithoutSnapshot) {
        roomSyncLog("skip_plain_hydrate_waiting_for_yjs_snapshot", {
          syncKey,
          codeLen: next.length,
        });
      }
    } catch (e) {
      roomSyncLog("hydrate_from_server_failed", { error: String(e) });
    }
    onEditorValueChangeRef.current(activeDoc.getText("room-code").toString());
    bumpLocalAwarenessAfterRemoteDocChange();
  }, [
    bumpLocalAwarenessAfterRemoteDocChange,
    resyncSignal,
    serverYjsBase64,
    serverYjsSequence,
    syncKey,
    value,
  ]);

  useEffect(() => {
    const activeView = viewRef.current;
    if (!activeView) return;
    activeView.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    });
  }, [readOnly]);

  useEffect(() => {
    const activeView = viewRef.current;
    if (!activeView) return;
    activeView.dispatch({
      effects: languageCompartmentRef.current.reconfigure(languageExtension),
    });
  }, [languageExtension]);

  return (
    <div
      className={styles.codeEditorHost}
      data-testid="room-code-editor-host"
      style={{ height }}
      ref={hostRef}
    />
  );
}
