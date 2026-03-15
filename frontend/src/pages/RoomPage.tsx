import React, { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Badge, Box, Button, Group, Modal, Select, Stack, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import {
  IconArrowNarrowRight,
  IconCode,
  IconHome2,
  IconLayoutDashboard,
  IconPlayerPlay,
  IconUsers
} from "@tabler/icons-react";
import { Link, useParams } from "react-router-dom";
import { useGetRoomQuery, useRunCodeMutation } from "../services/api";
import { useRoomSocket } from "../features/room/useRoomSocket";
import styles from "./RoomPage.module.css";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" }
];

type RealtimeState = {
  inviteCode: string;
  language: string;
  code: string;
  currentStep: number;
  participants: Array<{ sessionId: string; displayName: string }>;
  isOwner: boolean;
};

function guestNameKey(inviteCode: string) {
  return `guest_display_name_${inviteCode}`;
}

function readStoredDisplayName(inviteCode: string) {
  return (localStorage.getItem(guestNameKey(inviteCode)) ?? localStorage.getItem("display_name") ?? "").trim();
}

export function RoomPage() {
  const { inviteCode = "" } = useParams();
  const { data: room, isLoading } = useGetRoomQuery({ inviteCode });
  const [state, setState] = useState<RealtimeState | null>(null);
  const [error, setError] = useState("");
  const [execResult, setExecResult] = useState("");
  const [runCode, runState] = useRunCodeMutation();
  const ownerToken = localStorage.getItem(`owner_token_${inviteCode}`);
  const authToken = localStorage.getItem("auth_token");

  const [displayName, setDisplayName] = useState(() => readStoredDisplayName(inviteCode));
  const [draftName, setDraftName] = useState(() => readStoredDisplayName(inviteCode));
  const [nameModalOpened, setNameModalOpened] = useState(() => !ownerToken && !readStoredDisplayName(inviteCode));

  useEffect(() => {
    const stored = readStoredDisplayName(inviteCode);
    setDisplayName(stored);
    setDraftName(stored);
    setNameModalOpened(!ownerToken && !stored);
  }, [inviteCode, ownerToken]);

  const merged = useMemo(() => {
    if (state) return state;
    if (!room) return null;
    return {
      inviteCode: room.inviteCode,
      language: room.language,
      code: room.code,
      currentStep: room.currentStep,
      participants: [],
      isOwner: !!ownerToken
    };
  }, [ownerToken, room, state]);

  const onState = useCallback((incoming: RealtimeState) => {
    setState(incoming);
  }, []);

  const onError = useCallback((message: string) => {
    setError(message);
  }, []);

  const canConnect = !!ownerToken || (!nameModalOpened && !!displayName.trim());
  const { connected, sendCodeUpdate, sendLanguageUpdate, sendNextStep, sendSetStep } = useRoomSocket({
    enabled: canConnect,
    inviteCode,
    displayName: displayName || "Участник",
    ownerToken,
    onState,
    onError
  });

  const run = async () => {
    if (!ownerToken || !merged) return;
    try {
      const result = await runCode({
        inviteCode,
        ownerToken,
        language: merged.language,
        code: merged.code
      }).unwrap();
      setExecResult(
        `exit: ${result.exitCode}\n\nstdout:\n${result.stdout || "(empty)"}\n\nstderr:\n${result.stderr || "(empty)"}`
      );
    } catch {
      setExecResult("Не удалось выполнить код.");
    }
  };

  const submitCandidateName = () => {
    const normalized = draftName.trim();
    if (!normalized) return;
    localStorage.setItem("display_name", normalized);
    localStorage.setItem(guestNameKey(inviteCode), normalized);
    setDisplayName(normalized);
    setNameModalOpened(false);
  };

  if (isLoading || !merged) {
    return (
      <Box className={styles.shell} p="xl">
        <Text>Загрузка комнаты...</Text>
      </Box>
    );
  }

  const step = room?.tasks.find((t) => t.stepIndex === merged.currentStep);
  const isOwner = merged.isOwner;

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
            placeholder="Например, Иван"
            value={draftName}
            onChange={(e) => setDraftName(e.currentTarget.value)}
            autoFocus
          />
          <Button onClick={submitCandidateName}>Войти в комнату</Button>
        </Stack>
      </Modal>

      <Box className={styles.shell}>
        <TopBar inviteCode={inviteCode} roomTitle={room?.title ?? "Комната"} authToken={authToken} connected={connected} />

        {isOwner ? (
          <OwnerLayout
            merged={merged}
            tasks={room?.tasks ?? []}
            stepTitle={step?.title ?? "—"}
            stepDescription={step?.description ?? ""}
            execResult={execResult}
            runStateLoading={runState.isLoading}
            error={error}
            onRun={run}
            onCodeChange={(value) => sendCodeUpdate(value ?? "")}
            onLanguageChange={(value) => value && sendLanguageUpdate(value)}
            onNextStep={sendNextStep}
            onSelectStep={(stepIndex) => sendSetStep(stepIndex)}
          />
        ) : (
          <CandidateLayout
            merged={merged}
            stepTitle={step?.title ?? "—"}
            onCodeChange={(value) => sendCodeUpdate(value ?? "")}
            error={error}
          />
        )}
      </Box>
    </>
  );
}

function TopBar({
  inviteCode,
  roomTitle,
  authToken,
  connected
}: {
  inviteCode: string;
  roomTitle: string;
  authToken: string | null;
  connected: boolean;
}) {
  return (
    <Box className={styles.topBar}>
      <Box className={styles.topInner}>
        <Box className={styles.brand}>
          <ThemeIcon size={26} variant="light" color="gray">
            <IconCode size={14} />
          </ThemeIcon>
          <Box>
            <div className={styles.brandTitle}>{roomTitle}</div>
            <div className={styles.roomCode}>room: {inviteCode}</div>
          </Box>
        </Box>

        <Group className={styles.topActions}>
          <Badge color={connected ? "teal" : "gray"} variant="light">
            {connected ? "Подключено" : "Подключение"}
          </Badge>
          {authToken && (
            <Button component={Link} to="/dashboard/rooms" size="xs" variant="light" color="gray" leftSection={<IconLayoutDashboard size={14} />}>
              Кабинет
            </Button>
          )}
          <Button component={Link} to="/" size="xs" variant="outline" color="gray" leftSection={<IconHome2 size={14} />}>
            Главная
          </Button>
        </Group>
      </Box>
    </Box>
  );
}

function OwnerLayout({
  merged,
  tasks,
  stepTitle,
  stepDescription,
  execResult,
  runStateLoading,
  error,
  onRun,
  onCodeChange,
  onLanguageChange,
  onNextStep,
  onSelectStep
}: {
  merged: RealtimeState;
  tasks: Array<{ stepIndex: number; title: string; language: string }>;
  stepTitle: string;
  stepDescription: string;
  execResult: string;
  runStateLoading: boolean;
  error: string;
  onRun: () => void;
  onCodeChange: (value: string | undefined) => void;
  onLanguageChange: (value: string | null) => void;
  onNextStep: () => void;
  onSelectStep: (stepIndex: number) => void;
}) {
  return (
    <Box className={styles.ownerBody}>
      <Box className={styles.sidebar}>
        <div className={styles.sectionTitle}>Interview Steps</div>
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

        <div className={styles.sectionTitle}>Task</div>
        <Text size="sm" c="#e1e6ef">
          {stepTitle}
        </Text>
        <Text className={styles.stepMeta}>{stepDescription}</Text>

        <Select
          label="Language"
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

        <Button variant="light" color="gray" leftSection={<IconArrowNarrowRight size={14} />} onClick={onNextStep}>
          Следующий шаг
        </Button>
        <Button leftSection={<IconPlayerPlay size={14} />} loading={runStateLoading} onClick={onRun}>
          Запустить код
        </Button>
      </Box>

      <Box className={styles.workspace}>
        <Box className={styles.editorPanel}>
          <div className={styles.panelHeader}>editor</div>
          <div className={styles.editorWrap}>
            <Editor
              height="72vh"
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

        <Box className={styles.outputPanel}>
          <div className={styles.panelHeader}>result</div>
          <div className={styles.taskBlock}>{stepTitle}</div>
          <div className={styles.outputContent}>{execResult || "Здесь появится результат запуска"}</div>
          <div className={styles.panelHeader}>participants</div>
          <div className={styles.participants}>
            {merged.participants.map((participant) => (
              <div className={styles.participantItem} key={participant.sessionId}>
                <span>{participant.displayName}</span>
                <Badge size="xs" variant="light" color="teal">
                  online
                </Badge>
              </div>
            ))}
            {merged.participants.length === 0 && <Text size="xs" c="#8b919b">Пока никого нет</Text>}
            {error && <Text className={styles.error}>{error}</Text>}
          </div>
        </Box>
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
            collaborative mode
          </Badge>
        </Group>
      </Box>

      <Box className={styles.candidatePanel}>
        <div className={styles.panelHeader}>editor</div>
        <div className={styles.candidateEditorWrap}>
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
