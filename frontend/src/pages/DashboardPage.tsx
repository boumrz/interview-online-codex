import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title
} from "@mantine/core";
import {
  IconBook2,
  IconBolt,
  IconChevronRight,
  IconCode,
  IconEdit,
  IconLayoutDashboard,
  IconLogout2,
  IconPlus,
  IconRobot,
  IconRocket,
  IconShieldCheck,
  IconTrash
} from "@tabler/icons-react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { clearAuth } from "../features/auth/authSlice";
import {
  useCreateRoomMutation,
  useCreateTaskTemplateMutation,
  useClearRealtimeFaultsMutation,
  useConfigureRealtimeFaultsMutation,
  useDeleteRoomMutation,
  useDeleteTaskTemplateMutation,
  useExecuteAllRunReviewersMutation,
  useEvaluateAgentPolicyQuery,
  useGetEnvironmentDoctorReportQuery,
  useListAgentRunsByIssueQuery,
  useMyRoomsQuery,
  useStartAgentRunMutation,
  useTransitionAgentRunMutation,
  useTasksGroupedQuery,
  useUpdateRoomMutation,
  useUpdateTaskTemplateMutation
} from "../services/api";
import type { RoomSummary, TaskTemplate } from "../types";

type DashboardSection = "rooms" | "tasks" | "manage" | "agents";
type RoomSaveStatus = "idle" | "saving" | "saved" | "error";
declare const __FEATURE_AGENT_OPS__: string | undefined;

const BASE_DASHBOARD_SECTIONS: Array<{ value: DashboardSection; label: string }> = [
  { value: "rooms", label: "Комнаты" },
  { value: "tasks", label: "Задачи" },
  { value: "manage", label: "Управление комнатами" },
  { value: "agents", label: "Агент-операции" }
];

const LANGUAGE_OPTIONS = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" }
];

const darkFieldStyles = {
  label: { color: "#cbd5e1" },
  input: { backgroundColor: "#0b1529", borderColor: "#27456f", color: "#e2e8f0" }
};

const darkSelectStyles = {
  ...darkFieldStyles,
  dropdown: { backgroundColor: "#0f1c34", borderColor: "#27456f" },
  option: { color: "#e2e8f0" }
};

function isDashboardSection(value: string | undefined, agentOpsEnabled: boolean): value is DashboardSection {
  if (value === "rooms" || value === "tasks" || value === "manage") return true;
  return agentOpsEnabled && value === "agents";
}

export function DashboardPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { section } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAppSelector((s) => s.auth);
  const [error, setError] = useState("");
  const agentOpsEnabled =
    (typeof __FEATURE_AGENT_OPS__ !== "undefined" ? __FEATURE_AGENT_OPS__ : "false") === "true";

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskStarterCode, setTaskStarterCode] = useState("");
  const [taskLanguage, setTaskLanguage] = useState("javascript");
  const [createTaskModalOpened, setCreateTaskModalOpened] = useState(false);

  const [roomTitle, setRoomTitle] = useState("Техническое интервью");
  const [roomLanguage, setRoomLanguage] = useState("javascript");
  const [roomTaskIds, setRoomTaskIds] = useState<string[]>([]);

  const [roomTitleDrafts, setRoomTitleDrafts] = useState<Record<string, string>>({});
  const [roomSaveStatus, setRoomSaveStatus] = useState<Record<string, RoomSaveStatus>>({});
  const roomSaveTimersRef = useRef<Record<string, number>>({});

  const [editingTask, setEditingTask] = useState<TaskTemplate | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDescription, setEditTaskDescription] = useState("");
  const [editTaskStarterCode, setEditTaskStarterCode] = useState("");
  const [editTaskLanguage, setEditTaskLanguage] = useState("javascript");
  const [agentIssueId, setAgentIssueId] = useState("");
  const [agentProvider, setAgentProvider] = useState<"temporal" | "langgraph">("temporal");
  const [agentRole, setAgentRole] = useState("Тимлид");
  const [agentRequiresApproval, setAgentRequiresApproval] = useState(true);
  const [agentCriteria, setAgentCriteria] = useState(
    "Сформулированы критерии приемки\nЕсть итог ревью решения\nЕсть итог ревью безопасности\nЕсть итог ревью тестов\nЕсть связанные артефакты"
  );
  const [transitionComment, setTransitionComment] = useState("");
  const [selectedPolicyRunId, setSelectedPolicyRunId] = useState<string | null>(null);
  const [faultInviteCode, setFaultInviteCode] = useState("");
  const [faultLatencyMs, setFaultLatencyMs] = useState("250");
  const [faultDropEvery, setFaultDropEvery] = useState("0");
  const dashboardSections = BASE_DASHBOARD_SECTIONS.filter(
    (dashboardSection) => agentOpsEnabled || dashboardSection.value !== "agents"
  );

  const { data: rooms = [] } = useMyRoomsQuery(undefined, { skip: !auth.token, refetchOnMountOrArgChange: true });
  const { data: groupedTasks = [] } = useTasksGroupedQuery(undefined, { skip: !auth.token });

  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [updateTask, updateTaskState] = useUpdateTaskTemplateMutation();
  const [deleteTask, deleteTaskState] = useDeleteTaskTemplateMutation();
  const [createRoom, createRoomState] = useCreateRoomMutation();
  const [updateRoom, updateRoomState] = useUpdateRoomMutation();
  const [deleteRoom, deleteRoomState] = useDeleteRoomMutation();
  const [startAgentRun, startAgentRunState] = useStartAgentRunMutation();
  const [transitionAgentRun, transitionAgentRunState] = useTransitionAgentRunMutation();
  const [executeAllRunReviewers, executeAllRunReviewersState] = useExecuteAllRunReviewersMutation();
  const [configureRealtimeFaults, configureRealtimeFaultsState] = useConfigureRealtimeFaultsMutation();
  const [clearRealtimeFaults, clearRealtimeFaultsState] = useClearRealtimeFaultsMutation();

  const normalizedIssueId = agentIssueId.trim().toUpperCase();
  const issueIdLooksValid = /^[A-Z]+-\d+$/.test(normalizedIssueId);

  const { data: environmentDoctor, refetch: refetchEnvironmentDoctor } = useGetEnvironmentDoctorReportQuery(undefined, {
    skip: !auth.token || !agentOpsEnabled
  });
  const { data: agentRuns = [], refetch: refetchAgentRuns } = useListAgentRunsByIssueQuery(
    { linearIssueId: normalizedIssueId },
    { skip: !auth.token || !agentOpsEnabled || !issueIdLooksValid }
  );
  const { data: selectedPolicyResult } = useEvaluateAgentPolicyQuery(
    { runId: selectedPolicyRunId ?? "" },
    { skip: !auth.token || !agentOpsEnabled || !selectedPolicyRunId }
  );

  useEffect(() => {
    return () => {
      Object.values(roomSaveTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  if (!auth.token) return <Navigate to="/login" replace />;
  if (!isDashboardSection(section, agentOpsEnabled)) return <Navigate to="/dashboard/rooms" replace />;

  const activeSection = section;
  const activeTaskLanguage = searchParams.get("lang") ?? "javascript";

  const normalizedTaskGroups = useMemo(() => {
    const tasksByLanguage = new Map<string, TaskTemplate[]>();
    groupedTasks.forEach((group) => {
      tasksByLanguage.set(group.language, group.tasks);
    });
    LANGUAGE_OPTIONS.forEach((languageOption) => {
      if (!tasksByLanguage.has(languageOption.value)) {
        tasksByLanguage.set(languageOption.value, []);
      }
    });
    return Array.from(tasksByLanguage.entries()).map(([language, tasks]) => ({
      language,
      tasks
    }));
  }, [groupedTasks]);

  const safeTaskLanguage = normalizedTaskGroups.some((group) => group.language === activeTaskLanguage)
    ? activeTaskLanguage
    : "javascript";

  const currentTaskGroup = normalizedTaskGroups.find((group) => group.language === safeTaskLanguage) ?? {
    language: "javascript",
    tasks: []
  };

  const currentLanguageTasks = useMemo(
    () => normalizedTaskGroups.find((group) => group.language === roomLanguage)?.tasks ?? [],
    [normalizedTaskGroups, roomLanguage]
  );

  const taskSelectData = useMemo(() => {
    return currentLanguageTasks.map((task) => ({
      value: task.id,
      label: task.title
    }));
  }, [currentLanguageTasks]);

  const selectedRoomTasks = useMemo(() => {
    const selected = new Set(roomTaskIds);
    return currentLanguageTasks.filter((task) => selected.has(task.id));
  }, [currentLanguageTasks, roomTaskIds]);

  const allowedRoomTaskIds = useMemo(() => {
    return new Set(currentLanguageTasks.map((task) => task.id));
  }, [currentLanguageTasks]);

  const hasUnavailableSelectedRoomTasks = useMemo(() => {
    return roomTaskIds.some((taskId) => !allowedRoomTaskIds.has(taskId));
  }, [allowedRoomTaskIds, roomTaskIds]);

  const totalTasksCount = useMemo(() => {
    return normalizedTaskGroups.reduce((acc, group) => acc + group.tasks.length, 0);
  }, [normalizedTaskGroups]);

  const activeLanguagesCount = useMemo(() => {
    return normalizedTaskGroups.filter((group) => group.tasks.length > 0).length;
  }, [normalizedTaskGroups]);

  useEffect(() => {
    const allowed = new Set(currentLanguageTasks.map((task) => task.id));
    setRoomTaskIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [currentLanguageTasks]);

  useEffect(() => {
    setRoomTitleDrafts((prev) => {
      const next = { ...prev };
      rooms.forEach((room) => {
        if (!next[room.id]) {
          next[room.id] = room.title;
        }
      });
      return next;
    });
  }, [rooms]);

  const onCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      await createTask({
        title: taskTitle,
        description: taskDescription,
        starterCode: taskStarterCode,
        language: taskLanguage
      }).unwrap();
      setTaskTitle("");
      setTaskDescription("");
      setTaskStarterCode("");
      setCreateTaskModalOpened(false);
      const params = new URLSearchParams(searchParams);
      params.set("lang", taskLanguage);
      setSearchParams(params, { replace: true });
    } catch {
      setError("Не удалось создать задачу");
    }
  };

  const onCreateRoom = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      const normalizedTaskIds = Array.from(new Set(roomTaskIds.filter((taskId) => allowedRoomTaskIds.has(taskId))));
      if (normalizedTaskIds.length !== roomTaskIds.length) {
        setRoomTaskIds(normalizedTaskIds);
      }
      const room = await createRoom({
        title: roomTitle,
        language: roomLanguage,
        taskIds: normalizedTaskIds
      }).unwrap();
      const ownerName = auth.user?.nickname ?? "Интервьюер";
      localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken ?? "");
      localStorage.setItem("display_name", ownerName);
      localStorage.setItem(`guest_display_name_${room.inviteCode}`, ownerName);
      navigate(`/room/${room.inviteCode}`);
    } catch {
      setError("Не удалось создать комнату");
    }
  };

  const startEditTask = (task: TaskTemplate) => {
    setEditingTask(task);
    setEditTaskTitle(task.title);
    setEditTaskDescription(task.description);
    setEditTaskStarterCode(task.starterCode);
    setEditTaskLanguage(task.language);
  };

  const submitTaskEdit = async () => {
    if (!editingTask) return;
    try {
      setError("");
      await updateTask({
        taskId: editingTask.id,
        title: editTaskTitle,
        description: editTaskDescription,
        starterCode: editTaskStarterCode,
        language: editTaskLanguage
      }).unwrap();
      setEditingTask(null);
    } catch {
      setError("Не удалось обновить задачу");
    }
  };

  const removeTask = async (taskId: string) => {
    if (!window.confirm("Удалить задачу из банка?")) return;
    try {
      setError("");
      await deleteTask({ taskId }).unwrap();
    } catch {
      setError("Не удалось удалить задачу");
    }
  };

  const persistRoomTitle = async (roomId: string, originalTitle: string, titleDraft: string) => {
    const normalized = titleDraft.trim();
    if (!normalized) {
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "error" }));
      return;
    }
    if (normalized === originalTitle.trim()) {
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "idle" }));
      return;
    }

    try {
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "saving" }));
      setError("");
      await updateRoom({ roomId, title: normalized }).unwrap();
      setRoomTitleDrafts((prev) => ({ ...prev, [roomId]: normalized }));
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "saved" }));
      window.setTimeout(() => {
        setRoomSaveStatus((prev) => {
          if (prev[roomId] !== "saved") return prev;
          return { ...prev, [roomId]: "idle" };
        });
      }, 1200);
    } catch {
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "error" }));
      setError("Не удалось автоматически сохранить комнату");
    }
  };

  const scheduleRoomAutoSave = (roomId: string, originalTitle: string, nextTitle: string) => {
    setRoomTitleDrafts((prev) => ({
      ...prev,
      [roomId]: nextTitle
    }));

    if (roomSaveTimersRef.current[roomId]) {
      window.clearTimeout(roomSaveTimersRef.current[roomId]);
    }

    roomSaveTimersRef.current[roomId] = window.setTimeout(() => {
      const latestOriginal = rooms.find((room) => room.id === roomId)?.title ?? originalTitle;
      void persistRoomTitle(roomId, latestOriginal, nextTitle);
    }, 600);
  };

  const flushRoomAutoSave = (roomId: string, originalTitle: string) => {
    if (roomSaveTimersRef.current[roomId]) {
      window.clearTimeout(roomSaveTimersRef.current[roomId]);
      delete roomSaveTimersRef.current[roomId];
    }
    const draft = roomTitleDrafts[roomId] ?? originalTitle;
    const latestOriginal = rooms.find((room) => room.id === roomId)?.title ?? originalTitle;
    void persistRoomTitle(roomId, latestOriginal, draft);
  };

  const removeRoom = async (roomId: string) => {
    if (!window.confirm("Удалить комнату?")) return;
    try {
      setError("");
      await deleteRoom({ roomId }).unwrap();
    } catch {
      setError("Не удалось удалить комнату");
    }
  };

  const openRoomFromDashboard = (room: RoomSummary) => {
    const ownerStorageKey = `owner_token_${room.inviteCode}`;
    const ownerToken = room.ownerToken?.trim() ?? "";
    const interviewerToken = room.interviewerToken?.trim() ?? "";

    if (ownerToken) {
      localStorage.setItem(ownerStorageKey, ownerToken);
    } else {
      localStorage.removeItem(ownerStorageKey);
    }

    const destination =
      room.accessRole === "participant" && interviewerToken
        ? `/room/${room.inviteCode}?interviewerToken=${encodeURIComponent(interviewerToken)}`
        : `/room/${room.inviteCode}`;
    navigate(destination);
  };

  const onStartAgentRun = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      if (!issueIdLooksValid) {
        setError("Укажите задачу Linear в формате KEY-123");
        return;
      }
      await startAgentRun({
        linearIssueId: normalizedIssueId,
        workflowProvider: agentProvider,
        requiresHumanApproval: agentRequiresApproval,
        assignedRole: agentRole,
        acceptanceCriteria: agentCriteria
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      }).unwrap();
      await refetchAgentRuns();
    } catch {
      setError("Не удалось запустить агентный процесс");
    }
  };

  const onTransitionRun = async (runId: string, targetState: string) => {
    try {
      setError("");
      await transitionAgentRun({
        runId,
        targetState,
        handoffReason: transitionComment || `Transition to ${targetState}`,
        actorRole: agentRole,
        humanApproved: agentRequiresApproval
      }).unwrap();
      await refetchAgentRuns();
      setSelectedPolicyRunId(runId);
    } catch {
      setError("Не удалось выполнить переход процесса");
    }
  };

  const onExecuteReviewers = async (runId: string) => {
    try {
      setError("");
      await executeAllRunReviewers({ runId }).unwrap();
      await refetchAgentRuns();
      setSelectedPolicyRunId(runId);
    } catch {
      setError("Не удалось запустить независимые ревью");
    }
  };

  const onConfigureFaults = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      await configureRealtimeFaults({
        inviteCode: faultInviteCode.trim(),
        latencyMs: Number(faultLatencyMs) || 0,
        dropEveryNthMessage: Number(faultDropEvery) || 0
      }).unwrap();
    } catch {
      setError("Не удалось применить профиль сбоев realtime");
    }
  };

  const onClearFaults = async () => {
    try {
      setError("");
      if (!faultInviteCode.trim()) return;
      await clearRealtimeFaults({ inviteCode: faultInviteCode.trim() }).unwrap();
    } catch {
      setError("Не удалось очистить профиль сбоев realtime");
    }
  };

  const loadingMutation =
    createTaskState.isLoading ||
    updateTaskState.isLoading ||
    deleteTaskState.isLoading ||
    createRoomState.isLoading ||
    updateRoomState.isLoading ||
    deleteRoomState.isLoading ||
    startAgentRunState.isLoading ||
    transitionAgentRunState.isLoading ||
    executeAllRunReviewersState.isLoading ||
    configureRealtimeFaultsState.isLoading ||
    clearRealtimeFaultsState.isLoading;

  const switchSection = (nextSection: DashboardSection) => {
    if (nextSection === "agents" && !agentOpsEnabled) {
      navigate("/dashboard/rooms");
      return;
    }
    if (nextSection === "tasks") {
      const params = new URLSearchParams(searchParams);
      params.set("lang", safeTaskLanguage);
      navigate(`/dashboard/tasks?${params.toString()}`);
      return;
    }
    navigate(`/dashboard/${nextSection}`);
  };

  return (
    <>
      <Modal opened={!!editingTask} onClose={() => setEditingTask(null)} title="Редактирование задачи" size="lg" centered>
        <Stack>
          <TextInput
            label="Название"
            value={editTaskTitle}
            onChange={(e) => setEditTaskTitle(e.currentTarget.value)}
            styles={darkFieldStyles}
          />
          <Textarea
            label="Описание"
            value={editTaskDescription}
            onChange={(e) => setEditTaskDescription(e.currentTarget.value)}
            minRows={3}
            styles={darkFieldStyles}
          />
          <Textarea
            label="Стартовый код"
            value={editTaskStarterCode}
            onChange={(e) => setEditTaskStarterCode(e.currentTarget.value)}
            minRows={8}
            styles={darkFieldStyles}
          />
          <Select
            label="Язык"
            value={editTaskLanguage}
            onChange={(value) => setEditTaskLanguage(value ?? "javascript")}
            data={LANGUAGE_OPTIONS}
            styles={darkSelectStyles}
          />
          <Button loading={updateTaskState.isLoading} onClick={submitTaskEdit}>
            Сохранить изменения
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={createTaskModalOpened}
        onClose={() => setCreateTaskModalOpened(false)}
        title="Создать задачу"
        size="50%"
        centered
      >
        <form onSubmit={onCreateTask}>
          <Stack>
            <TextInput
              id="create-task-title"
              data-testid="create-task-title-input"
              label="Название"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.currentTarget.value)}
              styles={darkFieldStyles}
              required
            />
            <Textarea
              id="create-task-description"
              data-testid="create-task-description-input"
              label="Описание"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.currentTarget.value)}
              minRows={4}
              styles={darkFieldStyles}
              required
            />
            <Textarea
              id="create-task-code"
              data-testid="create-task-code-input"
              label="Стартовый код"
              value={taskStarterCode}
              onChange={(e) => setTaskStarterCode(e.currentTarget.value)}
              minRows={10}
              styles={darkFieldStyles}
              required
            />
            <Select
              data-testid="create-task-language-select"
              label="Язык"
              value={taskLanguage}
              onChange={(value) => setTaskLanguage(value ?? "javascript")}
              data={LANGUAGE_OPTIONS}
              styles={darkSelectStyles}
            />
            <Button data-testid="create-task-submit-button" type="submit" loading={createTaskState.isLoading}>
              Сохранить задачу
            </Button>
          </Stack>
        </form>
      </Modal>

      <AppShell padding={0} header={{ height: 72 }}>
        <AppShell.Header bg="#101318" c="white" style={{ borderBottom: "1px solid #272b34" }}>
          <Container size="xl" h="100%">
            <Group h="100%" justify="space-between" align="center">
              <Group>
                <ThemeIcon size={38} radius="md" color="gray" variant="light">
                  <IconLayoutDashboard size={20} />
                </ThemeIcon>
                <Box>
                  <Title order={4}>Личный кабинет</Title>
                  <Text size="xs" c="gray.4">
                    Управление комнатами и задачами
                  </Text>
                </Box>
              </Group>
              <Group>
                <Badge color="gray" variant="light">
                  @{auth.user?.nickname}
                </Badge>
                <Button
                  leftSection={<IconLogout2 size={16} />}
                  variant="outline"
                  color="gray"
                  onClick={() => {
                    dispatch(clearAuth());
                    navigate("/");
                  }}
                >
                  Выйти
                </Button>
              </Group>
            </Group>
          </Container>
        </AppShell.Header>

        <AppShell.Main>
          <Box
            style={{
              minHeight: "calc(100vh - 72px)",
              background:
                "radial-gradient(1200px 500px at 15% -20%, rgba(255,255,255,0.06), transparent), radial-gradient(900px 420px at 90% -20%, rgba(255,255,255,0.04), transparent), #0f1115"
            }}
          >
            <Container size="xl" py={20}>
              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" mb="md">
                <Card withBorder bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                  <Group justify="space-between">
                    <Text c="gray.4">Комнат создано</Text>
                    <ThemeIcon color="gray" variant="light">
                      <IconRocket size={16} />
                    </ThemeIcon>
                  </Group>
                  <Title order={2} mt={8}>
                    {rooms.length}
                  </Title>
                </Card>
                <Card withBorder bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                  <Group justify="space-between">
                    <Text c="gray.4">Задач</Text>
                    <ThemeIcon color="gray" variant="light">
                      <IconBook2 size={16} />
                    </ThemeIcon>
                  </Group>
                  <Title order={2} mt={8}>
                    {totalTasksCount}
                  </Title>
                </Card>
                <Card withBorder bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                  <Group justify="space-between">
                    <Text c="gray.4">Языков в банке</Text>
                    <ThemeIcon color="gray" variant="light">
                      <IconCode size={16} />
                    </ThemeIcon>
                  </Group>
                  <Title order={2} mt={8}>
                    {activeLanguagesCount}
                  </Title>
                </Card>
              </SimpleGrid>

              <Card withBorder radius="lg" mb="md" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                <Group wrap="wrap" gap="xs">
                  {dashboardSections.map((dashboardSection) => (
                    <Button
                      key={dashboardSection.value}
                      variant={activeSection === dashboardSection.value ? "filled" : "subtle"}
                      color={activeSection === dashboardSection.value ? "gray" : "dark"}
                      onClick={() => switchSection(dashboardSection.value)}
                    >
                      {dashboardSection.label}
                    </Button>
                  ))}
                </Group>
              </Card>

              {activeSection === "rooms" && (
                <SimpleGrid cols={{ base: 1, lg: 1 }} spacing="md">
                  <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }} data-testid="create-room-card">
                    <form onSubmit={onCreateRoom}>
                      <Stack>
                        <Group>
                          <ThemeIcon color="gray" variant="light">
                            <IconPlus size={15} />
                          </ThemeIcon>
                          <Title order={4}>Создать комнату</Title>
                        </Group>
                        <Text size="sm" c="gray.4">
                          Выбери язык и нужные шаги. Если шаги не выбраны, автоматически подставятся дефолтные задачи языка.
                        </Text>
                        <TextInput
                          label="Название комнаты"
                          value={roomTitle}
                          onChange={(e) => setRoomTitle(e.currentTarget.value)}
                          styles={darkFieldStyles}
                          required
                        />
                        <Select
                          label="Язык комнаты"
                          value={roomLanguage}
                          onChange={(value) => setRoomLanguage(value ?? "javascript")}
                          data={LANGUAGE_OPTIONS}
                          styles={darkSelectStyles}
                        />
                        <MultiSelect
                          data-testid="room-task-select"
                          label="Задачи для комнаты"
                          description="Показываются задачи только выбранного языка"
                          data={taskSelectData}
                          value={roomTaskIds}
                          onChange={setRoomTaskIds}
                          searchable
                          styles={darkSelectStyles}
                        />
                        {hasUnavailableSelectedRoomTasks && (
                          <Text size="xs" c="yellow.4">
                            Часть выбранных задач не соответствует текущему языку и будет удалена перед созданием
                            комнаты.
                          </Text>
                        )}
                        <Stack gap="xs" data-testid="selected-task-preview">
                          <Text fw={600}>Выбранные задачи</Text>
                          {selectedRoomTasks.length === 0 ? (
                            <Text size="sm" c="gray.4">
                              Пока ничего не выбрано
                            </Text>
                          ) : (
                            selectedRoomTasks.map((task) => (
                              <Card key={task.id} withBorder radius="md" padding="sm" bg="#121720" style={{ borderColor: "#2a3039" }}>
                                <Stack gap={4}>
                                  <Text fw={700}>{task.title}</Text>
                                  <Text size="sm" c="gray.4">
                                    {task.description}
                                  </Text>
                                </Stack>
                              </Card>
                            ))
                          )}
                        </Stack>
                        <Button
                          type="submit"
                          loading={createRoomState.isLoading}
                          disabled={hasUnavailableSelectedRoomTasks}
                        >
                          Создать и открыть
                        </Button>
                      </Stack>
                    </form>
                  </Card>

                  {false && (<Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                    <Stack>
                      <Title order={4}>Текущие параметры</Title>
                      <Divider color="#272b34" />
                      <Text size="sm">Язык комнаты: {labelForLanguage(roomLanguage)}</Text>
                      <Text size="sm">Выбрано задач: {roomTaskIds.length}</Text>
                      <Text size="sm">Всего задач языка: {currentLanguageTasks.length}</Text>
                      <Text size="sm" c="gray.4">
                        После создания откроется live-coding сессия. Ссылка и код комнаты передаются кандидату.
                      </Text>
                    </Stack>
                  </Card>)}
                </SimpleGrid>
              )}

              {activeSection === "tasks" && (
                <SimpleGrid cols={{ base: 1, lg: 1 }} spacing="md">
                  {false && (<Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                    <form onSubmit={onCreateTask}>
                      <Stack>
                        <Title order={4}>Создать задачу</Title>
                        <TextInput
                          label="Название"
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.currentTarget.value)}
                          styles={darkFieldStyles}
                          required
                        />
                        <Textarea
                          label="Описание"
                          value={taskDescription}
                          onChange={(e) => setTaskDescription(e.currentTarget.value)}
                          minRows={3}
                          styles={darkFieldStyles}
                          required
                        />
                        <Textarea
                          label="Стартовый код"
                          value={taskStarterCode}
                          onChange={(e) => setTaskStarterCode(e.currentTarget.value)}
                          minRows={8}
                          styles={darkFieldStyles}
                          required
                        />
                        <Select
                          label="Язык"
                          value={taskLanguage}
                          onChange={(value) => setTaskLanguage(value ?? "javascript")}
                          data={LANGUAGE_OPTIONS}
                          styles={darkSelectStyles}
                        />
                        <Button type="submit" loading={createTaskState.isLoading}>
                          Сохранить задачу
                        </Button>
                      </Stack>
                    </form>
                  </Card>)}

                  <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }} data-testid="task-bank-panel">
                    <Stack>
                      <Title order={4}>Управление задачами</Title>
                      <Group justify="space-between" align="center">
                        <Button
                          data-testid="open-create-task-modal"
                          leftSection={<IconPlus size={14} />}
                          onClick={() => setCreateTaskModalOpened(true)}
                        >
                          Создать задачу
                        </Button>
                      </Group>
                      <Group wrap="wrap" gap="xs">
                        {normalizedTaskGroups.map((group) => (
                          <Button
                            key={group.language}
                            size="xs"
                            variant={group.language === safeTaskLanguage ? "filled" : "subtle"}
                            color={group.language === safeTaskLanguage ? "blue" : "gray"}
                            onClick={() => {
                              const params = new URLSearchParams(searchParams);
                              params.set("lang", group.language);
                              setSearchParams(params, { replace: true });
                            }}
                          >
                            {labelForLanguage(group.language)}
                          </Button>
                        ))}
                      </Group>
                      <Divider color="#272b34" />
                      <Stack gap="sm">
                        {currentTaskGroup.tasks.map((task) => (
                          <Card key={task.id} withBorder radius="md" padding="sm" bg="#121720" style={{ borderColor: "#2a3039" }}>
                            <Stack gap="xs">
                              <Group justify="space-between">
                                <Text fw={700}>{task.title}</Text>
                                <Badge color="blue" variant="light">
                                  {labelForLanguage(task.language)}
                                </Badge>
                              </Group>
                              <Text size="sm" c="gray.4">
                                {task.description}
                              </Text>
                              <Group justify="flex-end">
                                <Button
                                  size="xs"
                                  leftSection={<IconEdit size={14} />}
                                  variant="light"
                                  onClick={() => startEditTask(task)}
                                >
                                  Редактировать
                                </Button>
                                <Button
                                  size="xs"
                                  color="red"
                                  variant="light"
                                  leftSection={<IconTrash size={14} />}
                                  onClick={() => removeTask(task.id)}
                                >
                                  Удалить
                                </Button>
                              </Group>
                            </Stack>
                          </Card>
                        ))}
                        {currentTaskGroup.tasks.length === 0 && (
                          <Text size="sm" c="gray.4">
                            Пока нет задач для {labelForLanguage(currentTaskGroup.language)}
                          </Text>
                        )}
                      </Stack>
                    </Stack>
                  </Card>
                </SimpleGrid>
              )}

              {activeSection === "manage" && (
                <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                  <Stack>
                    <Title order={4}>Управление комнатами</Title>
                    {rooms.map((room) => (
                      <Card
                        key={room.id}
                        withBorder
                        radius="md"
                        padding="sm"
                        bg="#121720"
                        style={{ borderColor: "#2a3039", cursor: "pointer" }}
                        onClick={() => openRoomFromDashboard(room)}
                      >
                        <Stack gap="sm">
                          <Group justify="space-between">
                            <Group gap="xs">
                              <Badge color="gray" variant="light">
                                {labelForLanguage(room.language)}
                              </Badge>
                              <Badge color={room.accessRole === "owner" ? "teal" : "blue"} variant="light">
                                {room.accessRole === "owner" ? "Владелец" : "Участник"}
                              </Badge>
                              <Badge variant="outline" color={statusColor(roomSaveStatus[room.id])}>
                                {statusLabel(roomSaveStatus[room.id])}
                              </Badge>
                            </Group>
                            <Group gap={6}>
                              <Text size="xs" c="gray.4">
                                Код: {room.inviteCode}
                              </Text>
                              <ActionIcon
                                variant="light"
                                color="red"
                                disabled={room.accessRole !== "owner"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (room.accessRole !== "owner") return;
                                  void removeRoom(room.id);
                                }}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>
                          </Group>

                          <TextInput
                            label="Название комнаты"
                            value={roomTitleDrafts[room.id] ?? room.title}
                            disabled={room.accessRole !== "owner"}
                            onClick={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              if (room.accessRole !== "owner") return;
                              scheduleRoomAutoSave(room.id, room.title, event.currentTarget.value);
                            }}
                            onBlur={() => {
                              if (room.accessRole !== "owner") return;
                              flushRoomAutoSave(room.id, room.title);
                            }}
                            styles={darkFieldStyles}
                          />

                          <Group justify="space-between">
                            <Text size="xs" c="gray.4">
                              Клик по карточке открывает комнату
                            </Text>
                            <Group gap={4} c="gray.4">
                              <Text size="xs">Открыть</Text>
                              <IconChevronRight size={14} />
                            </Group>
                          </Group>
                        </Stack>
                      </Card>
                    ))}
                    {rooms.length === 0 && <Text c="gray.4">Комнат пока нет</Text>}
                  </Stack>
                </Card>
              )}

              {activeSection === "agents" && (
                <Stack>
                  <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
                    <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                      <form onSubmit={onStartAgentRun}>
                        <Stack>
                          <Group>
                            <ThemeIcon color="gray" variant="light">
                              <IconRobot size={15} />
                            </ThemeIcon>
                            <Title order={4}>Запуск агентного процесса</Title>
                          </Group>
                          <Text size="sm" c="gray.4">
                            Запуск процесса оркестрации доступен только внутри задачи Linear.
                          </Text>
                          <TextInput
                            label="Задача Linear"
                            placeholder="LDT-76"
                            value={agentIssueId}
                            onChange={(event) => setAgentIssueId(event.currentTarget.value)}
                            styles={darkFieldStyles}
                            required
                          />
                          <Select
                            label="Провайдер процесса"
                            value={agentProvider}
                            onChange={(value) => setAgentProvider((value as "temporal" | "langgraph") ?? "temporal")}
                            data={[
                              { value: "temporal", label: "Temporal (основной)" },
                              { value: "langgraph", label: "LangGraph (прототип)" }
                            ]}
                            styles={darkSelectStyles}
                          />
                          <TextInput
                            label="Текущая роль"
                            value={agentRole}
                            onChange={(event) => setAgentRole(event.currentTarget.value)}
                            styles={darkFieldStyles}
                          />
                          <Switch
                            label="Ручное подтверждение обязательно для финальных этапов"
                            checked={agentRequiresApproval}
                            onChange={(event) => setAgentRequiresApproval(event.currentTarget.checked)}
                          />
                          <Textarea
                            label="Критерии приемки (по строкам)"
                            minRows={5}
                            value={agentCriteria}
                            onChange={(event) => setAgentCriteria(event.currentTarget.value)}
                            styles={darkFieldStyles}
                          />
                          <Button type="submit" loading={startAgentRunState.isLoading}>
                            Запустить процесс
                          </Button>
                        </Stack>
                      </form>
                    </Card>

                    <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                      <Stack>
                        <Group justify="space-between">
                          <Group>
                            <ThemeIcon color="gray" variant="light">
                              <IconShieldCheck size={15} />
                            </ThemeIcon>
                            <Title order={4}>Проверка окружения</Title>
                          </Group>
                          <Button variant="light" size="xs" onClick={() => refetchEnvironmentDoctor()}>
                            Обновить
                          </Button>
                        </Group>
                        <Badge
                          variant="light"
                          color={
                            environmentDoctor?.status === "PASS"
                              ? "teal"
                              : environmentDoctor?.status === "WARN"
                              ? "yellow"
                              : "red"
                          }
                        >
                          Статус: {environmentDoctor?.status ?? "НЕИЗВЕСТНО"}
                        </Badge>
                        <Stack gap="xs">
                          {(environmentDoctor?.checks ?? []).map((check) => (
                            <Card
                              key={check.key}
                              withBorder
                              radius="md"
                              padding="xs"
                              bg="#121720"
                              style={{ borderColor: "#2a3039" }}
                            >
                              <Group justify="space-between" align="flex-start">
                                <Stack gap={2}>
                                  <Text size="sm" fw={700}>
                                    {check.key}
                                  </Text>
                                  <Text size="xs" c="gray.4">
                                    {check.message}
                                  </Text>
                                </Stack>
                                <Badge
                                  size="xs"
                                  color={check.status === "PASS" ? "teal" : check.status === "WARN" ? "yellow" : "red"}
                                  variant="light"
                                >
                                  {check.status}
                                </Badge>
                              </Group>
                            </Card>
                          ))}
                        </Stack>
                      </Stack>
                    </Card>
                  </SimpleGrid>

                  <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                    <form onSubmit={onConfigureFaults}>
                      <Stack>
                        <Group>
                          <ThemeIcon color="gray" variant="light">
                            <IconBolt size={15} />
                          </ThemeIcon>
                          <Title order={4}>Инъекции сбоев realtime</Title>
                        </Group>
                        <Text size="sm" c="gray.4">
                          Для тестов хаоса: искусственная задержка и периодический пропуск broadcast по комнате.
                        </Text>
                        <Group grow>
                          <TextInput
                            label="Код приглашения"
                            placeholder="r-xxxxxxxx"
                            value={faultInviteCode}
                            onChange={(event) => setFaultInviteCode(event.currentTarget.value)}
                            styles={darkFieldStyles}
                            required
                          />
                          <TextInput
                            label="Задержка (мс)"
                            value={faultLatencyMs}
                            onChange={(event) => setFaultLatencyMs(event.currentTarget.value)}
                            styles={darkFieldStyles}
                          />
                          <TextInput
                            label="Пропускать каждый N-й"
                            value={faultDropEvery}
                            onChange={(event) => setFaultDropEvery(event.currentTarget.value)}
                            styles={darkFieldStyles}
                          />
                        </Group>
                        <Group>
                          <Button type="submit" variant="light" loading={configureRealtimeFaultsState.isLoading}>
                            Применить профиль
                          </Button>
                          <Button
                            type="button"
                            color="red"
                            variant="outline"
                            loading={clearRealtimeFaultsState.isLoading}
                            onClick={onClearFaults}
                          >
                            Очистить профиль
                          </Button>
                        </Group>
                      </Stack>
                    </form>
                  </Card>

                  <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
                    <Stack>
                      <Group justify="space-between">
                        <Title order={4}>Запуски по задаче {issueIdLooksValid ? normalizedIssueId : "—"}</Title>
                        <Button variant="light" size="xs" disabled={!issueIdLooksValid} onClick={() => refetchAgentRuns()}>
                          Обновить список
                        </Button>
                      </Group>
                      <TextInput
                        label="Комментарий для передачи"
                        value={transitionComment}
                        onChange={(event) => setTransitionComment(event.currentTarget.value)}
                        styles={darkFieldStyles}
                      />
                      <Stack gap="sm">
                        {agentRuns.map((run) => (
                          <Card key={run.id} withBorder radius="md" padding="sm" bg="#121720" style={{ borderColor: "#2a3039" }}>
                            <Stack gap="xs">
                              <Group justify="space-between">
                                <Group gap="xs">
                                  <Badge color="gray" variant="light">
                                    {run.workflowProvider}
                                  </Badge>
                                  <Badge variant="outline" color="gray">
                                    {run.currentState}
                                  </Badge>
                                  <Badge variant="outline" color="gray">
                                    повтор {run.retryCount}/{run.maxRetries}
                                  </Badge>
                                </Group>
                                <Text size="xs" c="gray.4">
                                  трасса: {run.traceId}
                                </Text>
                              </Group>
                              <Text size="sm">Роль: {run.assignedRole || "—"}</Text>
                              <Group gap="xs" wrap="wrap">
                                {run.allowedTransitions.map((targetState) => (
                                  <Button
                                    key={targetState}
                                    size="xs"
                                    variant="light"
                                    onClick={() => onTransitionRun(run.id, targetState)}
                                    loading={transitionAgentRunState.isLoading}
                                  >
                                    {targetState}
                                  </Button>
                                ))}
                                <Button
                                  size="xs"
                                  color="gray"
                                  variant="outline"
                                  onClick={() => setSelectedPolicyRunId(run.id)}
                                >
                                  Проверить гейты
                                </Button>
                                <Button
                                  size="xs"
                                  color="gray"
                                  variant="outline"
                                  onClick={() => onExecuteReviewers(run.id)}
                                  loading={executeAllRunReviewersState.isLoading}
                                >
                                  Запустить ревьюеров
                                </Button>
                              </Group>
                            </Stack>
                          </Card>
                        ))}
                        {issueIdLooksValid && agentRuns.length === 0 && (
                          <Text size="sm" c="gray.4">
                            Для задачи пока нет запущенных процессов.
                          </Text>
                        )}
                      </Stack>

                      {selectedPolicyRunId && selectedPolicyResult && (
                        <Card withBorder radius="md" padding="sm" bg="#121720" style={{ borderColor: "#2a3039" }}>
                          <Stack gap="xs">
                            <Group justify="space-between">
                              <Text fw={700}>Результат гейтов для {selectedPolicyRunId}</Text>
                              <Badge color={selectedPolicyResult.passed ? "teal" : "red"} variant="light">
                                {selectedPolicyResult.passed ? "ПРОЙДЕНО" : "НЕ ПРОЙДЕНО"}
                              </Badge>
                            </Group>
                            {selectedPolicyResult.checks.map((check) => (
                              <Text key={check.id} size="sm" c={check.passed ? "teal.2" : "red.4"}>
                                {check.id}: {check.message}
                              </Text>
                            ))}
                          </Stack>
                        </Card>
                      )}
                    </Stack>
                  </Card>
                </Stack>
              )}

              {(error || loadingMutation) && (
                <Text c={error ? "red.4" : "gray.4"} mt="md">
                  {error || "Выполняется операция..."}
                </Text>
              )}
            </Container>
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}

function statusColor(status: RoomSaveStatus | undefined) {
  if (status === "saving") return "yellow";
  if (status === "saved") return "teal";
  if (status === "error") return "red";
  return "gray";
}

function statusLabel(status: RoomSaveStatus | undefined) {
  if (status === "saving") return "Сохранение...";
  if (status === "saved") return "Сохранено";
  if (status === "error") return "Ошибка";
  return "Без изменений";
}

function labelForLanguage(language: string) {
  switch (language) {
    case "typescript":
      return "TypeScript";
    case "python":
      return "Python";
    case "kotlin":
      return "Kotlin";
    case "java":
      return "Java";
    case "sql":
      return "SQL";
    default:
      return "JavaScript";
  }
}
