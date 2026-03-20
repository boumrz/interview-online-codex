import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { ActionIcon, Badge, Box, Button, Group, Menu, Modal, Select, Stack, Text, TextInput, Textarea, ThemeIcon } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconCode, IconGripVertical, IconHome2, IconLayoutDashboard, IconMenu2, IconUsers } from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import { useGetRoomQuery } from "../services/api";
import { useRoomSocket } from "../features/room/useRoomSocket";
import styles from "./RoomPage.module.css";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" }
];

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

type ResizeSide = "left" | "right";

const MIN_LEFT_WIDTH = 220;
const MAX_LEFT_WIDTH = 440;
const MIN_RIGHT_WIDTH = 250;
const MAX_RIGHT_WIDTH = 520;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
      if (authToken && authNickname) {
        resolved = authNickname;
        shouldAskName = false;
      } else {
        resolved = readStoredDisplayName(inviteCode, {
          role: "interviewer-guest",
          includeGlobalFallback: false
        });
        shouldAskName = !resolved;
      }
    } else {
      resolved = stored;
      shouldAskName = !resolved;
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
      currentStep: room.currentStep,
      notes: room.notes ?? "",
      participants: [] as Participant[],
      isOwner: false,
      role: "candidate" as const,
      canManageRoom: false,
      notesLockedBySessionId: null,
      notesLockedByDisplayName: null,
      notesLockedUntilEpochMs: null
    };
  }, [room, state]);

  const mergedNotes = merged?.notes ?? "";
  const canManageRoom = merged?.canManageRoom ?? false;

  useEffect(() => {
    if (!notesDirty) {
      setNotesDraft(mergedNotes);
    }
  }, [mergedNotes, notesDirty]);

  const onState = useCallback((incoming: RealtimeState) => {
    setState(incoming);
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  const requiresNamePrompt = !authToken && !ownerToken;
  const canConnect = !requiresNamePrompt || (!nameModalOpened && !!displayName.trim());
  const { connected, sessionId, sendCodeUpdate, sendLanguageUpdate, sendSetStep, sendNotesUpdate } = useRoomSocket({
    enabled: canConnect,
    inviteCode,
    authToken,
    displayName: displayName || "Участник",
    ownerToken,
    interviewerToken,
    onState,
    onError
  });

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
    if (!canManageRoom || !merged || notesLockedByOther) return;
    if (notesDraft === mergedNotes) {
      if (notesDirty) setNotesDirty(false);
      return;
    }
    const timer = window.setTimeout(() => {
      sendNotesUpdate(notesDraft);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [canManageRoom, merged, mergedNotes, notesDirty, notesDraft, notesLockedByOther, sendNotesUpdate]);

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
  const notesLockName = merged.notesLockedByDisplayName?.trim() || "другой интервьюер";
  const notesStatus = notesLockedByOther ? `Пишет ${notesLockName}. Поле временно заблокировано.` : notesDirty ? "Сохраняем..." : "Синхронизировано";

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
        <TopBar roomTitle={room?.title ?? "Комната"} authToken={authToken} connected={connected} participants={merged.participants} />

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
            notesDraft={notesDraft}
            notesStatus={notesStatus}
            notesLockedByOther={notesLockedByOther}
            onCodeChange={(value) => sendCodeUpdate(value ?? "")}
            onLanguageChange={(value) => value && sendLanguageUpdate(value)}
            onSelectStep={(stepIndex) => sendSetStep(stepIndex)}
            onNotesChange={(value) => {
              setNotesDraft(value);
              setNotesDirty(true);
            }}
          />
        ) : (
          <CandidateLayout
            merged={merged}
            stepTitle={step?.title ?? "-"}
            onCodeChange={(value) => sendCodeUpdate(value ?? "")}
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
  participants
}: {
  roomTitle: string;
  authToken: string | null;
  connected: boolean;
  participants: Participant[];
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
  }, [normalizedParticipants.length]);

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
  notesDraft,
  notesStatus,
  notesLockedByOther,
  onCodeChange,
  onLanguageChange,
  onSelectStep,
  onNotesChange
}: {
  merged: RealtimeState;
  tasks: Array<{ stepIndex: number; title: string; language: string }>;
  stepTitle: string;
  stepDescription: string;
  error: string;
  notesDraft: string;
  notesStatus: string;
  notesLockedByOther: boolean;
  onCodeChange: (value: string | undefined) => void;
  onLanguageChange: (value: string | null) => void;
  onSelectStep: (stepIndex: number) => void;
  onNotesChange: (value: string) => void;
}) {
  const [leftSidebarVisible, setLeftSidebarVisible] = useState(true);
  const [rightSidebarVisible, setRightSidebarVisible] = useState(true);
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

  const baseInset = 12;
  const iconSize = 30;
  const maxOffset = Math.max(baseInset, ownerBodyWidth - iconSize - 4);
  const leftToggleOffset = clamp(leftSidebarVisible ? leftWidth + 12 : baseInset, baseInset, maxOffset);
  const rightToggleOffset = clamp(rightSidebarVisible ? rightWidth + 12 : baseInset, baseInset, maxOffset);

  return (
    <Box className={styles.ownerBody} ref={ownerBodyRef}>
      <ActionIcon
        className={`${styles.edgeToggle} ${styles.leftEdgeToggle}`}
        style={{ left: leftToggleOffset }}
        variant="filled"
        color="dark"
        onClick={() => setLeftSidebarVisible((current) => !current)}
        aria-label={leftSidebarVisible ? "Скрыть левый сайдбар" : "Показать левый сайдбар"}
      >
        {leftSidebarVisible ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />}
      </ActionIcon>

      <ActionIcon
        className={`${styles.edgeToggle} ${styles.rightEdgeToggle}`}
        style={{ right: rightToggleOffset }}
        variant="filled"
        color="dark"
        onClick={() => setRightSidebarVisible((current) => !current)}
        aria-label={rightSidebarVisible ? "Скрыть правый сайдбар" : "Показать правый сайдбар"}
      >
        {rightSidebarVisible ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
      </ActionIcon>

      {leftSidebarVisible && (
        <>
          <Box className={styles.sidebar} style={{ width: leftWidth }}>
            <Text size="xs" c="#8b919b">
              шаг {merged.currentStep + 1}/{Math.max(tasks.length, 1)}
            </Text>

            <Box className={styles.stepList}>
              {tasks.map((task) => (
                <Button
                  key={task.stepIndex}
                  size="xs"
                  variant={task.stepIndex === merged.currentStep ? "filled" : "light"}
                  color={task.stepIndex === merged.currentStep ? "gray" : "dark"}
                  justify="space-between"
                  onClick={() => onSelectStep(task.stepIndex)}
                >
                  {task.stepIndex + 1}. {task.title}
                </Button>
              ))}
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
              <Editor
                height="100%"
                language={merged.language}
                value={merged.code}
                theme="vs-dark"
                onChange={onCodeChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbersMinChars: 3,
                  smoothScrolling: true
                }}
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
              <Box className={styles.notesHeader}>Заметки</Box>
              <Stack gap="xs" className={styles.notesStack}>
                <Text size="xs" c={notesLockedByOther ? "#f78989" : notesStatus === "Сохраняем..." ? "#f5c26b" : "#8b919b"}>
                  {notesStatus}
                </Text>
                <Textarea
                  value={notesDraft}
                  onChange={(event) => onNotesChange(event.currentTarget.value)}
                  minRows={4}
                  maxRows={16}
                  autosize
                  disabled={notesLockedByOther}
                  data-testid="room-notes-input"
                  styles={{
                    input: {
                      backgroundColor: "#11161f",
                      borderColor: "#273242",
                      color: "#d6dce6",
                      fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
                      lineHeight: 1.4,
                      fontSize: 12
                    }
                  }}
                />
              </Stack>

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
  onCodeChange,
  error
}: {
  merged: RealtimeState;
  stepTitle: string;
  onCodeChange: (value: string | undefined) => void;
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
          <Editor
            height="calc(100vh - 170px)"
            language={merged.language}
            value={merged.code}
            theme="vs-dark"
            onChange={onCodeChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbersMinChars: 3,
              smoothScrolling: true
            }}
          />
        </div>
      </Box>

      {error && <Text className={styles.error}>{error}</Text>}
    </Box>
  );
}
