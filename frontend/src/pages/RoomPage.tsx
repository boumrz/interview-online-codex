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
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
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

const MIN_LEFT_WIDTH = 220;
const MAX_LEFT_WIDTH = 440;
const MIN_RIGHT_WIDTH = 250;
const MAX_RIGHT_WIDTH = 520;
const LOG_HISTORY_LIMIT = 50;

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
  const yjsPendingUpdatesRef = useRef<string[]>([]);
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
      language: room.language,
      code: room.code,
      lastCodeUpdatedBySessionId: null,
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
    if (!merged) return `${inviteCode}:0:javascript`;
    return `${merged.inviteCode}:${merged.currentStep}:${merged.language}`;
  }, [inviteCode, merged]);
  const syncKeyRef = useRef(currentSyncKey);
  const previousParticipantsCountRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>("");
  const recentLocalYjsUpdatesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    syncKeyRef.current = currentSyncKey;
  }, [currentSyncKey]);

  useEffect(() => {
    const participantsCount = merged?.participants.length ?? 0;
    const previous = previousParticipantsCountRef.current;
    if (previous !== null && participantsCount > previous) {
      setResyncSignal((value) => value + 1);
    }
    previousParticipantsCountRef.current = participantsCount;
  }, [merged?.participants.length]);

  useEffect(() => {
    if (!notesDirty) {
      setNotesDraft(mergedNotes);
    }
  }, [mergedNotes, notesDirty]);

  const onState = useCallback((incoming: RealtimeState) => {
    const participants = (incoming.participants ?? []).map((participant) => ({
      ...participant,
      role: participant.role ?? "candidate"
    }));
    const taskScores = normalizeTaskScores(incoming.taskScores);
    setState({
      ...incoming,
      participants,
      taskScores,
      lastCodeUpdatedBySessionId: incoming.lastCodeUpdatedBySessionId ?? null,
      lastCandidateKey: incoming.lastCandidateKey ?? null,
      candidateKeyHistory: Array.isArray(incoming.candidateKeyHistory)
        ? incoming.candidateKeyHistory
        : incoming.lastCandidateKey
          ? [incoming.lastCandidateKey]
          : []
    });
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  const onYjsUpdate = useCallback((payload: { sessionId: string; yjsUpdate: string; syncKey?: string | null }) => {
    const update = payload.yjsUpdate?.trim();
    if (!update) return;
    const incomingSyncKey = payload.syncKey?.trim();
    if (incomingSyncKey && incomingSyncKey !== syncKeyRef.current) {
      return;
    }

    const dedupeKey = `${incomingSyncKey ?? ""}::${update}`;
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
    yjsPendingUpdatesRef.current.push(update);
  }, []);

  const onYjsBridgeReady = useCallback((applyUpdate: ((yjsUpdate: string) => void) | null) => {
    yjsApplyUpdateRef.current = applyUpdate;
    if (!applyUpdate) return;
    const pending = yjsPendingUpdatesRef.current.splice(0, yjsPendingUpdatesRef.current.length);
    pending.forEach((update) => applyUpdate(update));
  }, []);

  const fallbackDisplayName = authUser?.nickname?.trim() || (interviewerToken ? "Интервьюер" : "Участник");
  const effectiveDisplayName = displayName.trim() || fallbackDisplayName;
  const canConnect = Boolean(inviteCode);
  const { connected, sessionId, sendCodeUpdate, sendLanguageUpdate, sendSetStep, sendTaskRatingUpdate, sendNotesUpdate, sendCursorUpdate, sendYjsUpdate, sendKeyPress } = useRoomSocket({
    enabled: canConnect,
    inviteCode,
    authToken,
    displayName: effectiveDisplayName,
    ownerToken,
    interviewerToken,
    onState,
    onError,
    onYjsUpdate
  });
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const sendYjsUpdateTracked = useCallback((yjsUpdate: string, syncKey?: string | null) => {
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
    sendYjsUpdate(update, normalizedSyncKey || null);
  }, [sendYjsUpdate]);

  const hasRealtimeState = Boolean(state);
  const participantsCount = state?.participants.length ?? 0;

  useEffect(() => {
    if (!hasRealtimeState) {
      setEditorHydrated(false);
      return;
    }
    if (participantsCount <= 1) {
      setEditorHydrated(true);
      return;
    }
    setEditorHydrated(false);
    const timer = window.setTimeout(() => {
      setEditorHydrated(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [currentSyncKey, hasRealtimeState, participantsCount]);

  const editorReady = !hasRealtimeState || editorHydrated;

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
  const notesStatus = notesLockedByOther ? `Пишет ${notesLockName}. Поле временно заблокировано.` : notesDirty ? "Сохраняем..." : "Сохранено";

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
            placeholder="Например, Иван"
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
            onCodeChange={(value) => sendCodeUpdate(value ?? "")}
            onLanguageChange={(value) => value && sendLanguageUpdate(value)}
            onSelectStep={(stepIndex) => sendSetStep(stepIndex)}
            onCursorChange={(payload) => sendCursorUpdate(payload)}
            onYjsUpdate={(yjsUpdate, syncKey) => sendYjsUpdateTracked(yjsUpdate, syncKey)}
            onYjsBridgeReady={onYjsBridgeReady}
            onKeyPress={(payload) => sendKeyPress(payload)}
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
            sessionId={sessionId}
            cursors={merged.cursors}
            syncKey={currentSyncKey}
            resyncSignal={resyncSignal}
            editorReady={editorReady}
            onCodeChange={(value) => sendCodeUpdate(value ?? "")}
            onCursorChange={(payload) => sendCursorUpdate(payload)}
            onYjsUpdate={(yjsUpdate, syncKey) => sendYjsUpdateTracked(yjsUpdate, syncKey)}
            onYjsBridgeReady={onYjsBridgeReady}
            onKeyPress={(payload) => sendKeyPress(payload)}
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
  onCodeChange,
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
  onCodeChange: (value: string | undefined) => void;
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
  onYjsUpdate: (yjsUpdate: string, syncKey: string) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
  onTaskRatingChange: (rating: number | null) => void;
  onNotesChange: (value: string) => void;
}) {
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"notes" | "logs">("notes");
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(320);
  const ownerBodyRef = useRef<HTMLDivElement | null>(null);
  const [ownerBodyWidth, setOwnerBodyWidth] = useState(0);

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

  const baseInset = 10;
  const toggleHandleWidth = 20;
  const maxOffset = Math.max(baseInset, ownerBodyWidth - toggleHandleWidth - 4);
  const leftToggleOffset = clamp(leftSidebarVisible ? leftWidth + 10 : baseInset, baseInset, maxOffset);
  const rightToggleOffset = clamp(rightSidebarVisible ? rightWidth + 10 : baseInset, baseInset, maxOffset);
  const candidateParticipants = merged.participants.filter((participant) => participant.role === "candidate");
  const candidateOutOfFocus = candidateParticipants.some((participant) => participant.presenceStatus === "away");
  const candidateFocusHint = candidateParticipants.length === 0
    ? "Кандидат пока не подключен"
    : candidateOutOfFocus
      ? "Кандидат вне окна/вкладки (возможен Alt+Tab)"
      : "Кандидат в фокусе";
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
        data-open={leftSidebarVisible}
        onClick={() => setLeftSidebarVisible((current) => !current)}
        aria-label={leftSidebarVisible ? "Скрыть левый сайдбар" : "Показать левый сайдбар"}
      >
        {leftSidebarVisible ? <IconChevronLeft size={14} className={styles.edgeToggleIcon} /> : <IconChevronRight size={14} className={styles.edgeToggleIcon} />}
      </button>

      <button
        type="button"
        className={`${styles.edgeToggle} ${styles.rightEdgeToggle}`}
        style={{ right: rightToggleOffset }}
        data-open={rightSidebarVisible}
        onClick={() => setRightSidebarVisible((current) => !current)}
        aria-label={rightSidebarVisible ? "Скрыть правый сайдбар" : "Показать правый сайдбар"}
      >
        {rightSidebarVisible ? <IconChevronRight size={14} className={styles.edgeToggleIcon} /> : <IconChevronLeft size={14} className={styles.edgeToggleIcon} />}
      </button>

      {leftSidebarVisible && (
        <>
          <Box className={styles.sidebar} style={{ width: leftWidth }}>
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
              value={merged.language}
              onChange={onLanguageChange}
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
                language={merged.language}
                value={merged.code}
                syncKey={syncKey}
                resyncSignal={resyncSignal}
                readOnly={!editorReady}
                sessionId={sessionId}
                cursors={cursors}
                onChange={onCodeChange}
                onCursorChange={onCursorChange}
                onYjsUpdate={onYjsUpdate}
                onYjsBridgeReady={onYjsBridgeReady}
                onKeyPress={onKeyPress}
              />
            </div>
          </Box>
        </Box>

        {rightSidebarVisible && (
          <>
            <div
              className={styles.resizeHandle}
              role="separator"
              aria-label="Изменить ширину правой панели"
              onMouseDown={startDrag("right")}
            >
              <IconGripVertical size={14} />
            </div>

            <Box className={styles.outputPanel} style={{ width: rightWidth }}>
              <div className={styles.panelTabs}>
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
                  <Text className={styles.panelSectionTitle}>Заметки по шагу</Text>
                  <div className={styles.notesTopRow}>
                    <div
                      className={styles.notesStatusBanner}
                      data-state={notesLockedByOther ? "locked" : notesStatus === "Сохраняем..." ? "saving" : "saved"}
                    >
                      <Text className={styles.notesStatusLabel}>Статус сохранения</Text>
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

                  <Text size="xs" c={candidateOutOfFocus ? "#f5c26b" : "#8b919b"} className={styles.logsHint}>
                    {candidateFocusHint}
                  </Text>

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
  sessionId,
  cursors,
  syncKey,
  resyncSignal,
  editorReady,
  onCodeChange,
  onCursorChange,
  onYjsUpdate,
  onYjsBridgeReady,
  onKeyPress,
  error
}: {
  merged: RealtimeState;
  stepTitle: string;
  sessionId: string;
  cursors: CursorInfo[];
  syncKey: string;
  resyncSignal: number;
  editorReady: boolean;
  onCodeChange: (value: string | undefined) => void;
  onCursorChange: (payload: {
    lineNumber: number;
    column: number;
    selectionStartLineNumber?: number | null;
    selectionStartColumn?: number | null;
    selectionEndLineNumber?: number | null;
    selectionEndColumn?: number | null;
  }) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string) => void;
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
      </Box>

      <Box className={styles.candidatePanel}>
        <div className={styles.editorWrap}>
          <RoomCodeEditor
            key={syncKey}
            height="calc(100vh - 170px)"
            language={merged.language}
            value={merged.code}
            syncKey={syncKey}
            resyncSignal={resyncSignal}
            readOnly={!editorReady}
            sessionId={sessionId}
            cursors={cursors}
            onChange={onCodeChange}
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
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");

  const key = event.key || event.keyCode || "Unknown";
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
    selectionBorder: `hsl(${hue} 88% 60% / 0.45)`,
    labelBackground: `hsl(${hue} 70% 42%)`,
    labelText: "#f7f9fc"
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
  onChange,
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
  onChange: (value: string | undefined) => void;
  onCursorChange: (payload: {
    lineNumber: number;
    column: number;
    selectionStartLineNumber?: number | null;
    selectionStartColumn?: number | null;
    selectionEndLineNumber?: number | null;
    selectionEndColumn?: number | null;
  }) => void;
  onYjsUpdate: (yjsUpdate: string, syncKey: string) => void;
  onYjsBridgeReady: (applyUpdate: ((yjsUpdate: string) => void) | null) => void;
  onKeyPress: (payload: { key: string; keyCode: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => void;
}) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleElementRef = useRef<HTMLStyleElement | null>(null);
  const suppressEditorChangesRef = useRef(false);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const decorationsRef = useRef<string[]>([]);
  const cursorWidgetsRef = useRef<Map<string, {
    widget: any;
    node: HTMLDivElement;
    setPosition: (lineNumber: number, column: number) => void;
  }>>(new Map());
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
  const lastLocalEditAtRef = useRef(0);

  const schedulePersistCode = useCallback((nextCode: string) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      onChange(nextCode);
    }, 450);
  }, [onChange]);

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

      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      const editor = editorRef.current;
      if (editor) {
        cursorWidgetsRef.current.forEach((state) => {
          editor.removeContentWidget(state.widget);
        });
      }
      cursorWidgetsRef.current.clear();
      decorationsRef.current = [];

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

    const createCursorWidget = (widgetId: string, lineNumber: number, column: number) => {
      const node = document.createElement("div");
      let position = new monaco.Position(lineNumber, column);
      const widget = {
        getId: () => widgetId,
        getDomNode: () => node,
        getPosition: () => ({
          position,
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW
          ]
        })
      };

      return {
        widget,
        node,
        setPosition: (nextLine: number, nextColumn: number) => {
          position = new monaco.Position(nextLine, nextColumn);
        }
      };
    };

    const remoteCursors = cursors.filter((cursor) => cursor.sessionId !== sessionId);
    const caretCssRules: string[] = [];
    const selectionCssRules: string[] = [];
    const decorations: any[] = [];
    remoteCursors.forEach((cursor) => {
      const { lineNumber, column } = clampCursor(cursor.lineNumber, cursor.column);
      const label = cursor.displayName.trim().slice(0, 18) || "Участник";
      const theme = colorThemeForSession(cursor.sessionId);
      const widgetId = `remote-cursor-${cursor.sessionId}`;
      const widgetState = cursorWidgetsRef.current.get(widgetId) ?? createCursorWidget(widgetId, lineNumber, column);
      const caretClassName = cursorClassBySession(cursor.sessionId);
      const selectionClassName = selectionClassBySession(cursor.sessionId);

      widgetState.node.textContent = label;
      widgetState.node.className = styles.remoteCursorLabel;
      widgetState.node.style.backgroundColor = theme.labelBackground;
      widgetState.node.style.color = theme.labelText;
      widgetState.setPosition(lineNumber, column);

      caretCssRules.push(`.${caretClassName} { border-left-color: ${theme.caret} !important; }`);
      selectionCssRules.push(
        `.${selectionClassName} { background-color: ${theme.selection} !important; box-shadow: inset 0 0 0 1px ${theme.selectionBorder}; border-radius: 2px; }`
      );

      if (!cursorWidgetsRef.current.has(widgetId)) {
        cursorWidgetsRef.current.set(widgetId, widgetState);
        editor.addContentWidget(widgetState.widget);
      } else {
        editor.layoutContentWidget(widgetState.widget);
      }

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

    const activeWidgetIds = new Set(remoteCursors.map((cursor) => `remote-cursor-${cursor.sessionId}`));
    cursorWidgetsRef.current.forEach((state, widgetId) => {
      if (activeWidgetIds.has(widgetId)) return;
      editor.removeContentWidget(state.widget);
      cursorWidgetsRef.current.delete(widgetId);
    });

    if (styleElementRef.current) {
      styleElementRef.current.textContent = [...caretCssRules, ...selectionCssRules].join("\n");
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
    if (!syncKeyChanged) return;
    if (current === next) {
      syncKeyRef.current = syncKey;
      return;
    }

    syncKeyRef.current = syncKey;
    yDoc.transact(() => {
      yText.delete(0, yText.length);
      if (next) {
        yText.insert(0, next);
      }
    }, "remote");
  }, [syncKey, value]);

  useEffect(() => {
    if (resyncSignal <= 0) return;
    const yDoc = yDocRef.current;
    if (!yDoc) return;
    const encodedUpdate = bytesToBase64(Y.encodeStateAsUpdate(yDoc));
    onYjsUpdate(encodedUpdate, syncKeyRef.current);
  }, [onYjsUpdate, resyncSignal]);

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

        const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
          if (origin === "remote" || origin === "bootstrap") return;
          const encodedUpdate = bytesToBase64(Y.encodeStateAsUpdate(yDoc));
          onYjsUpdate(encodedUpdate, syncKeyRef.current);
          schedulePersistCode(yText.toString());
        };
        yDoc.on("update", handleDocUpdate);

        const handleYTextChange = (event: Y.YTextEvent, transaction: Y.Transaction) => {
          if (transaction.origin === "editor") return;
          const activeEditor = editorRef.current;
          const activeMonaco = monacoRef.current;
          const activeModel = activeEditor?.getModel();
          if (!activeEditor || !activeMonaco || !activeModel) return;

          const draftEdits: Array<{ offset: number; deleteLength: number; text: string }> = [];
          let sourceOffset = 0;
          let pendingDeleteOffset: number | null = null;
          let pendingDeleteLength = 0;

          const pushDraftEdit = (offset: number, deleteLength: number, text: string) => {
            if (deleteLength <= 0 && text.length === 0) return;
            const lastEdit = draftEdits[draftEdits.length - 1];
            if (lastEdit && lastEdit.offset === offset) {
              if (lastEdit.deleteLength === 0 && deleteLength === 0) {
                lastEdit.text += text;
                return;
              }
              // merge "delete + insert" and chained inserts at same anchor into a single replacement
              if (deleteLength === 0 && lastEdit.deleteLength >= 0) {
                lastEdit.text += text;
                return;
              }
            }
            draftEdits.push({ offset, deleteLength, text });
          };

          const flushPendingDelete = () => {
            if (pendingDeleteOffset === null || pendingDeleteLength <= 0) return;
            pushDraftEdit(pendingDeleteOffset, pendingDeleteLength, "");
            pendingDeleteOffset = null;
            pendingDeleteLength = 0;
          };

          event.delta.forEach((part) => {
            if (typeof part.retain === "number") {
              flushPendingDelete();
              sourceOffset += part.retain;
              return;
            }

            if (typeof part.delete === "number" && part.delete > 0) {
              if (pendingDeleteOffset === null) {
                pendingDeleteOffset = sourceOffset;
                pendingDeleteLength = part.delete;
              } else if (pendingDeleteOffset + pendingDeleteLength === sourceOffset) {
                pendingDeleteLength += part.delete;
              } else {
                flushPendingDelete();
                pendingDeleteOffset = sourceOffset;
                pendingDeleteLength = part.delete;
              }
              sourceOffset += part.delete;
              return;
            }

            if (typeof part.insert === "string" && part.insert.length > 0) {
              if (pendingDeleteOffset !== null) {
                pushDraftEdit(pendingDeleteOffset, pendingDeleteLength, part.insert);
                pendingDeleteOffset = null;
                pendingDeleteLength = 0;
              } else {
                flushPendingDelete();
                pushDraftEdit(sourceOffset, 0, part.insert);
              }
              return;
            }
          });
          flushPendingDelete();

          const edits = draftEdits.map((edit) => {
            const start = activeModel.getPositionAt(edit.offset);
            const end = activeModel.getPositionAt(edit.offset + edit.deleteLength);
            return {
              range: new activeMonaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
              text: edit.text,
              forceMoveMarkers: true
            };
          });

          if (edits.length === 0) return;

          suppressEditorChangesRef.current = true;
          try {
            const expectedValue = yText.toString();
            const selection = activeEditor.getSelection();
            const scrollTop = activeEditor.getScrollTop();
            const scrollLeft = activeEditor.getScrollLeft();
            try {
              activeEditor.executeEdits("yjs-remote", edits);
            } catch {
              activeEditor.executeEdits("yjs-remote-fallback", [
                {
                  range: activeModel.getFullModelRange(),
                  text: yText.toString(),
                  forceMoveMarkers: true
                }
              ]);
            }
            if (activeModel.getValue() !== expectedValue) {
              activeEditor.executeEdits("yjs-remote-repair", [
                {
                  range: activeModel.getFullModelRange(),
                  text: expectedValue,
                  forceMoveMarkers: true
                }
              ]);
            }
            if (selection) {
              activeEditor.setSelection(selection);
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
          const activeText = yTextRef.current;
          if (!activeDoc || !activeText) return;
          const updateBytes = base64ToBytes(encodedYjsUpdate);
          if (updateBytes.length === 0) return;
          try {
            // Guard against stale full-state echoes after refresh:
            // if incoming snapshot text already equals current text, skip update.
            const previewDoc = new Y.Doc();
            Y.applyUpdate(previewDoc, updateBytes, "preview");
            const incomingText = previewDoc.getText("room-code").toString();
            previewDoc.destroy();
            if (incomingText === activeText.toString()) {
              return;
            }
          } catch {
            // fall through and try applying directly
          }
          Y.applyUpdate(activeDoc, updateBytes, "remote");
        });

        const emitCursorSync = (position: any, selectionLike: any) => {
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
            now - prev.ts < 40
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
            emitCursorSync(event.position, event.selection);
          })
        );

        disposablesRef.current.push(
          editor.onDidChangeCursorPosition((event: any) => {
            const selection = editor.getSelection();
            emitCursorSync(event.position, selection);
          })
        );

        disposablesRef.current.push(
          editor.onDidChangeModelContent((event: any) => {
            if (suppressEditorChangesRef.current) return;
            const activeText = yTextRef.current;
            const activeDoc = yDocRef.current;
            if (!activeText || !activeDoc) return;
            lastLocalEditAtRef.current = Date.now();

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
        readOnly
      }}
    />
  );
}

