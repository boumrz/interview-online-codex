import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  Notification,
  Portal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBook2,
  IconCode,
  IconEdit,
  IconLayoutDashboard,
  IconLogout2,
  IconPlus,
  IconRocket,
  IconTrash,
} from "@tabler/icons-react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  clearAuth,
  updateProfile as updateAuthProfile,
} from "../features/auth/authSlice";
import { markdownToHtml } from "../components/markdown";
import {
  api,
  useCreateRoomMutation,
  useCreateTaskTemplateMutation,
  useAdminDeleteUserMutation,
  useAdminUpdateUserRoleMutation,
  useAdminUsersQuery,
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
  useUpdateProfileMutation,
  useTasksGroupedQuery,
  useUpdateRoomMutation,
  useUpdateTaskTemplateMutation,
} from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";
import type { AdminUser, RoomSummary, TaskTemplate } from "../types";
import styles from "./DashboardPage.module.css";
import {
  ADMIN_DASHBOARD_SECTION,
  BASE_DASHBOARD_SECTIONS,
  type DashboardSection,
  LANGUAGE_OPTIONS,
} from "./dashboard/dashboardConstants";
import {
  codeInputStyles,
  darkFieldStyles,
  darkSelectStyles,
  markdownInputStyles,
} from "./dashboard/dashboardFieldStyles";
import {
  isDashboardSection,
  labelForLanguage,
  normalizeLanguageKey,
  type RoomSaveStatus,
} from "./dashboard/dashboardHelpers";
import { AdminUsersSection } from "./dashboard/AdminUsersSection";
import { AgentOpsSection } from "./dashboard/AgentOpsSection";
import { CreateRoomSection } from "./dashboard/CreateRoomSection";
import { ManageRoomsSection } from "./dashboard/ManageRoomsSection";

declare const __FEATURE_AGENT_OPS__: string | undefined;

export function DashboardPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { section } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAppSelector((s) => s.auth);
  const [error, setError] = useState("");
  const agentOpsEnabled =
    (typeof __FEATURE_AGENT_OPS__ !== "undefined"
      ? __FEATURE_AGENT_OPS__
      : "false") === "true";
  const isAdmin = auth.user?.role === "admin";

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskStarterCode, setTaskStarterCode] = useState("");
  const [taskLanguage, setTaskLanguage] = useState("nodejs");
  const [createTaskModalOpened, setCreateTaskModalOpened] = useState(false);

  const [roomTitle, setRoomTitle] = useState("Техническое интервью");
  const [roomTaskIds, setRoomTaskIds] = useState<string[]>([]);
  const [profileDisplayName, setProfileDisplayName] = useState(
    auth.user?.displayName ?? "",
  );
  const [profileSaveToast, setProfileSaveToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const profileSaveToastTimerRef = useRef<number | null>(null);

  const [roomTitleDrafts, setRoomTitleDrafts] = useState<
    Record<string, string>
  >({});
  const [roomSaveStatus, setRoomSaveStatus] = useState<
    Record<string, RoomSaveStatus>
  >({});
  const roomSaveTimersRef = useRef<Record<string, number>>({});
  const roomStatusTimersRef = useRef<Record<string, number>>({});

  const [editingTask, setEditingTask] = useState<TaskTemplate | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDescription, setEditTaskDescription] = useState("");
  const [editTaskStarterCode, setEditTaskStarterCode] = useState("");
  const [editTaskLanguage, setEditTaskLanguage] = useState("nodejs");
  const [agentIssueId, setAgentIssueId] = useState("");
  const [agentProvider, setAgentProvider] = useState<"temporal" | "langgraph">(
    "temporal",
  );
  const [agentRole, setAgentRole] = useState("Тимлид");
  const [agentRequiresApproval, setAgentRequiresApproval] = useState(true);
  const [agentCriteria, setAgentCriteria] = useState(
    "Сформулированы критерии приемки\nЕсть итог ревью решения\nЕсть итог ревью безопасности\nЕсть итог ревью тестов\nЕсть связанные артефакты",
  );
  const [transitionComment, setTransitionComment] = useState("");
  const [selectedPolicyRunId, setSelectedPolicyRunId] = useState<string | null>(
    null,
  );
  const [faultInviteCode, setFaultInviteCode] = useState("");
  const [faultLatencyMs, setFaultLatencyMs] = useState("250");
  const [faultDropEvery, setFaultDropEvery] = useState("0");
  const [adminRoleDrafts, setAdminRoleDrafts] = useState<
    Record<string, string>
  >({});
  const dashboardSections = BASE_DASHBOARD_SECTIONS.filter(
    (dashboardSection) =>
      agentOpsEnabled || dashboardSection.value !== "agents",
  ).concat(isAdmin ? [ADMIN_DASHBOARD_SECTION] : []);

  const editTaskDescriptionHtml = useMemo(
    () => markdownToHtml(editTaskDescription),
    [editTaskDescription],
  );

  useEffect(() => {
    setProfileDisplayName(auth.user?.displayName ?? "");
  }, [auth.user?.displayName]);

  const { data: rooms = [] } = useMyRoomsQuery(undefined, {
    skip: !auth.token,
    refetchOnMountOrArgChange: true,
  });
  const { data: groupedTasks = [] } = useTasksGroupedQuery(undefined, {
    skip: !auth.token,
  });
  const { data: adminUsers = [], refetch: refetchAdminUsers } =
    useAdminUsersQuery(undefined, {
      skip: !auth.token || !isAdmin,
    });

  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [updateTask, updateTaskState] = useUpdateTaskTemplateMutation();
  const [deleteTask, deleteTaskState] = useDeleteTaskTemplateMutation();
  const [updateAdminUserRole, updateAdminUserRoleState] =
    useAdminUpdateUserRoleMutation();
  const [deleteAdminUser, deleteAdminUserState] = useAdminDeleteUserMutation();
  const [createRoom, createRoomState] = useCreateRoomMutation();
  const [updateRoom, updateRoomState] = useUpdateRoomMutation();
  const [deleteRoom, deleteRoomState] = useDeleteRoomMutation();
  const [startAgentRun, startAgentRunState] = useStartAgentRunMutation();
  const [transitionAgentRun, transitionAgentRunState] =
    useTransitionAgentRunMutation();
  const [executeAllRunReviewers, executeAllRunReviewersState] =
    useExecuteAllRunReviewersMutation();
  const [configureRealtimeFaults, configureRealtimeFaultsState] =
    useConfigureRealtimeFaultsMutation();
  const [clearRealtimeFaults, clearRealtimeFaultsState] =
    useClearRealtimeFaultsMutation();
  const [updateProfile, updateProfileState] = useUpdateProfileMutation();

  const normalizedIssueId = agentIssueId.trim().toUpperCase();
  const issueIdLooksValid = /^[A-Z]+-\d+$/.test(normalizedIssueId);

  const { data: environmentDoctor, refetch: refetchEnvironmentDoctor } =
    useGetEnvironmentDoctorReportQuery(undefined, {
      skip: !auth.token || !agentOpsEnabled,
    });
  const { data: agentRuns = [], refetch: refetchAgentRuns } =
    useListAgentRunsByIssueQuery(
      { linearIssueId: normalizedIssueId },
      { skip: !auth.token || !agentOpsEnabled || !issueIdLooksValid },
    );
  const { data: selectedPolicyResult } = useEvaluateAgentPolicyQuery(
    { runId: selectedPolicyRunId ?? "" },
    { skip: !auth.token || !agentOpsEnabled || !selectedPolicyRunId },
  );

  useEffect(() => {
    return () => {
      Object.values(roomSaveTimersRef.current).forEach((timerId) =>
        window.clearTimeout(timerId),
      );
      Object.values(roomStatusTimersRef.current).forEach((timerId) =>
        window.clearTimeout(timerId),
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      if (profileSaveToastTimerRef.current != null) {
        window.clearTimeout(profileSaveToastTimerRef.current);
      }
    };
  }, []);

  const showProfileSaveToast = (type: "success" | "error", message: string) => {
    setProfileSaveToast({ type, message });
    if (profileSaveToastTimerRef.current != null) {
      window.clearTimeout(profileSaveToastTimerRef.current);
    }
    profileSaveToastTimerRef.current = window.setTimeout(() => {
      setProfileSaveToast(null);
      profileSaveToastTimerRef.current = null;
    }, 3200);
  };

  const hasValidSection = isDashboardSection(section, agentOpsEnabled, isAdmin);
  const activeSection: DashboardSection = hasValidSection ? section : "rooms";
  const activeTaskLanguage = normalizeLanguageKey(searchParams.get("lang"));

  useEffect(() => {
    trackEvent("prod_dashboard_view", {
      section: activeSection,
      is_admin: isAdmin,
      agent_ops_enabled: agentOpsEnabled,
    });
    setVisitParams({
      dashboard_section: activeSection,
    });
  }, [activeSection, agentOpsEnabled, isAdmin]);

  const normalizedTaskGroups = useMemo(() => {
    const tasksByLanguage = new Map<string, TaskTemplate[]>();
    groupedTasks.forEach((group) => {
      const language = normalizeLanguageKey(group.language);
      const current = tasksByLanguage.get(language) ?? [];
      tasksByLanguage.set(language, [
        ...current,
        ...group.tasks.map((task) => ({
          ...task,
          language: normalizeLanguageKey(task.language),
        })),
      ]);
    });
    LANGUAGE_OPTIONS.forEach((languageOption) => {
      if (!tasksByLanguage.has(languageOption.value)) {
        tasksByLanguage.set(languageOption.value, []);
      }
    });
    return Array.from(tasksByLanguage.entries()).map(([language, tasks]) => ({
      language,
      tasks,
    }));
  }, [groupedTasks]);

  const safeTaskLanguage = normalizedTaskGroups.some(
    (group) => group.language === activeTaskLanguage,
  )
    ? activeTaskLanguage
    : "nodejs";

  const currentTaskGroup = normalizedTaskGroups.find(
    (group) => group.language === safeTaskLanguage,
  ) ?? {
    language: "nodejs",
    tasks: [],
  };

  const allSelectableRoomTasks = useMemo(
    () => normalizedTaskGroups.flatMap((group) => group.tasks),
    [normalizedTaskGroups],
  );

  const taskSelectData = useMemo(() => {
    return allSelectableRoomTasks.map((task) => ({
      value: task.id,
      label: `${task.title} (${labelForLanguage(task.language)})`,
    }));
  }, [allSelectableRoomTasks]);

  const selectedRoomTasks = useMemo(() => {
    const selected = new Set(roomTaskIds);
    return allSelectableRoomTasks.filter((task) => selected.has(task.id));
  }, [allSelectableRoomTasks, roomTaskIds]);

  const allowedRoomTaskIds = useMemo(() => {
    return new Set(allSelectableRoomTasks.map((task) => task.id));
  }, [allSelectableRoomTasks]);

  const hasUnavailableSelectedRoomTasks = useMemo(() => {
    return roomTaskIds.some((taskId) => !allowedRoomTaskIds.has(taskId));
  }, [allowedRoomTaskIds, roomTaskIds]);

  const totalTasksCount = useMemo(() => {
    return normalizedTaskGroups.reduce(
      (acc, group) => acc + group.tasks.length,
      0,
    );
  }, [normalizedTaskGroups]);

  const activeLanguagesCount = useMemo(() => {
    return normalizedTaskGroups.filter((group) => group.tasks.length > 0)
      .length;
  }, [normalizedTaskGroups]);

  useEffect(() => {
    const allowed = new Set(allSelectableRoomTasks.map((task) => task.id));
    setRoomTaskIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length &&
        next.every((id, index) => id === prev[index])
        ? prev
        : next;
    });
  }, [allSelectableRoomTasks]);

  useEffect(() => {
    setRoomTitleDrafts((prev) => {
      const allowedRoomIds = new Set(rooms.map((room) => room.id));
      const next = Object.fromEntries(
        Object.entries(prev).filter(([roomId]) => allowedRoomIds.has(roomId)),
      ) as Record<string, string>;
      rooms.forEach((room) => {
        if (!next[room.id]) {
          next[room.id] = room.title;
        }
      });
      return next;
    });
  }, [rooms]);

  useEffect(() => {
    const allowedRoomIds = new Set(rooms.map((room) => room.id));
    setRoomSaveStatus(
      (prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([roomId]) => allowedRoomIds.has(roomId)),
        ) as Record<string, RoomSaveStatus>,
    );
  }, [rooms]);

  useEffect(() => {
    if (!isAdmin) return;
    setAdminRoleDrafts((prev) => {
      const allowedUserIds = new Set(adminUsers.map((user) => user.id));
      const next = Object.fromEntries(
        Object.entries(prev).filter(([userId]) => allowedUserIds.has(userId)),
      ) as Record<string, string>;
      adminUsers.forEach((user) => {
        if (!next[user.id]) {
          next[user.id] = user.role;
        }
      });
      return next;
    });
  }, [adminUsers, isAdmin]);

  const onCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    trackEvent("prod_task_create_submit", {
      language: taskLanguage,
      has_title: taskTitle.trim().length > 0,
    });
    try {
      setError("");
      await createTask({
        title: taskTitle,
        description: taskDescription,
        starterCode: taskStarterCode,
        language: taskLanguage,
      }).unwrap();
      setTaskTitle("");
      setTaskDescription("");
      setTaskStarterCode("");
      setCreateTaskModalOpened(false);
      const params = new URLSearchParams(searchParams);
      params.set("lang", taskLanguage);
      setSearchParams(params, { replace: true });
      trackEvent("prod_task_create_success", {
        language: taskLanguage,
      });
    } catch {
      setError("Не удалось создать задачу");
      trackEvent("prod_task_create_failed", {
        language: taskLanguage,
      });
    }
  };

  const onCreateRoom = async (e: FormEvent) => {
    e.preventDefault();
    const firstSelectedTaskLanguage = selectedRoomTasks[0]?.language ?? null;
    trackEvent("prod_room_create_submit", {
      selected_tasks: roomTaskIds.length,
      first_task_language: firstSelectedTaskLanguage,
    });
    try {
      setError("");
      const normalizedTaskIds = Array.from(
        new Set(roomTaskIds.filter((taskId) => allowedRoomTaskIds.has(taskId))),
      );
      if (normalizedTaskIds.length !== roomTaskIds.length) {
        setRoomTaskIds(normalizedTaskIds);
      }
      const room = await createRoom({
        title: roomTitle,
        taskIds: normalizedTaskIds,
      }).unwrap();
      const ownerName = auth.user?.displayName?.trim() || "Интервьюер";
      localStorage.setItem(
        `owner_token_${room.inviteCode}`,
        room.ownerToken ?? "",
      );
      localStorage.setItem("display_name", ownerName);
      localStorage.setItem(`guest_display_name_${room.inviteCode}`, ownerName);
      trackEvent("prod_room_create_success", {
        selected_tasks: normalizedTaskIds.length,
        first_task_language: firstSelectedTaskLanguage,
        room_invite_len: room.inviteCode.length,
      });
      navigate(`/room/${room.inviteCode}`);
    } catch {
      setError("Не удалось создать комнату");
      trackEvent("prod_room_create_failed", {
        first_task_language: firstSelectedTaskLanguage,
      });
    }
  };

  const startEditTask = (task: TaskTemplate) => {
    setEditingTask(task);
    setEditTaskTitle(task.title);
    setEditTaskDescription(task.description);
    setEditTaskStarterCode(task.starterCode);
    setEditTaskLanguage(normalizeLanguageKey(task.language));
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
        language: editTaskLanguage,
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

  const saveAdminRole = async (user: AdminUser) => {
    const nextRole = (adminRoleDrafts[user.id] ?? user.role)
      .trim()
      .toLowerCase();
    if (!nextRole || nextRole === user.role) return;
    try {
      setError("");
      await updateAdminUserRole({ userId: user.id, role: nextRole }).unwrap();
      setAdminRoleDrafts((prev) => ({ ...prev, [user.id]: nextRole }));
    } catch {
      setError("Не удалось обновить роль пользователя");
    }
  };

  const removeUserByAdmin = async (user: AdminUser) => {
    if (!window.confirm(`Удалить пользователя @${user.nickname}?`)) return;
    try {
      setError("");
      await deleteAdminUser({ userId: user.id }).unwrap();
    } catch {
      setError("Не удалось удалить пользователя");
    }
  };

  const persistRoomTitle = async (
    roomId: string,
    originalTitle: string,
    titleDraft: string,
  ) => {
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
      if (roomStatusTimersRef.current[roomId]) {
        window.clearTimeout(roomStatusTimersRef.current[roomId]);
      }
      roomStatusTimersRef.current[roomId] = window.setTimeout(() => {
        setRoomSaveStatus((prev) => {
          if (prev[roomId] !== "saved") return prev;
          return { ...prev, [roomId]: "idle" };
        });
        delete roomStatusTimersRef.current[roomId];
      }, 1200);
    } catch {
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "error" }));
      setError("Не удалось автоматически сохранить комнату");
    }
  };

  const scheduleRoomAutoSave = (
    roomId: string,
    originalTitle: string,
    nextTitle: string,
  ) => {
    setRoomTitleDrafts((prev) => ({
      ...prev,
      [roomId]: nextTitle,
    }));

    if (roomSaveTimersRef.current[roomId]) {
      window.clearTimeout(roomSaveTimersRef.current[roomId]);
    }

    roomSaveTimersRef.current[roomId] = window.setTimeout(() => {
      delete roomSaveTimersRef.current[roomId];
      const latestOriginal =
        rooms.find((room) => room.id === roomId)?.title ?? originalTitle;
      void persistRoomTitle(roomId, latestOriginal, nextTitle);
    }, 600);
  };

  const flushRoomAutoSave = (roomId: string, originalTitle: string) => {
    if (roomSaveTimersRef.current[roomId]) {
      window.clearTimeout(roomSaveTimersRef.current[roomId]);
      delete roomSaveTimersRef.current[roomId];
    }
    const draft = roomTitleDrafts[roomId] ?? originalTitle;
    const latestOriginal =
      rooms.find((room) => room.id === roomId)?.title ?? originalTitle;
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

  const saveProfileDisplayName = async () => {
    const normalized = profileDisplayName.trim();
    if (!normalized) {
      setError("Имя для комнаты обязательно");
      showProfileSaveToast("error", "Введите имя для отображения");
      return;
    }
    try {
      setError("");
      const updated = await updateProfile({ displayName: normalized }).unwrap();
      dispatch(updateAuthProfile({ displayName: updated.displayName }));
      localStorage.setItem("display_name", updated.displayName);
      setProfileDisplayName(updated.displayName);
      showProfileSaveToast("success", "Имя для комнаты успешно сохранено");
    } catch {
      setError("Не удалось обновить имя профиля");
      showProfileSaveToast("error", "Не удалось сохранить имя для комнаты");
    }
  };

  const openRoomFromDashboard = (room: RoomSummary) => {
    const ownerStorageKey = `owner_token_${room.inviteCode}`;
    const ownerToken = room.ownerToken?.trim() ?? "";

    if (ownerToken) {
      localStorage.setItem(ownerStorageKey, ownerToken);
    } else {
      localStorage.removeItem(ownerStorageKey);
    }

    navigate(`/room/${room.inviteCode}`);
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
          .filter(Boolean),
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
        humanApproved: agentRequiresApproval,
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
        dropEveryNthMessage: Number(faultDropEvery) || 0,
      }).unwrap();
    } catch {
      setError("Не удалось применить профиль сбоев realtime");
    }
  };

  const onClearFaults = async () => {
    try {
      setError("");
      if (!faultInviteCode.trim()) return;
      await clearRealtimeFaults({
        inviteCode: faultInviteCode.trim(),
      }).unwrap();
    } catch {
      setError("Не удалось очистить профиль сбоев realtime");
    }
  };

  const loadingMutation =
    createTaskState.isLoading ||
    updateTaskState.isLoading ||
    deleteTaskState.isLoading ||
    updateAdminUserRoleState.isLoading ||
    deleteAdminUserState.isLoading ||
    createRoomState.isLoading ||
    updateRoomState.isLoading ||
    deleteRoomState.isLoading ||
    startAgentRunState.isLoading ||
    transitionAgentRunState.isLoading ||
    executeAllRunReviewersState.isLoading ||
    configureRealtimeFaultsState.isLoading ||
    clearRealtimeFaultsState.isLoading ||
    updateProfileState.isLoading;

  const switchSection = (nextSection: DashboardSection) => {
    if (nextSection === "agents" && !agentOpsEnabled) {
      navigate("/dashboard/rooms");
      return;
    }
    if (nextSection === "admin" && !isAdmin) {
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

  if (!auth.token) {
    return <Navigate to="/login" replace />;
  }
  if (!hasValidSection) {
    return <Navigate to="/dashboard/rooms" replace />;
  }

  return (
    <>
      <Modal
        opened={!!editingTask}
        onClose={() => setEditingTask(null)}
        title="Редактирование задачи"
        size="lg"
        centered
      >
        <Stack>
          <TextInput
            label="Название"
            value={editTaskTitle}
            onChange={(e) => setEditTaskTitle(e.currentTarget.value)}
            styles={darkFieldStyles}
          />
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Описание (Markdown)
            </Text>
            <div className={styles.markdownEditorGrid}>
              <Textarea
                value={editTaskDescription}
                onChange={(e) => setEditTaskDescription(e.currentTarget.value)}
                minRows={8}
                styles={markdownInputStyles}
              />
              <div className={styles.markdownPreview}>
                {editTaskDescriptionHtml ? (
                  <div
                    className={styles.markdownPreviewContent}
                    dangerouslySetInnerHTML={{
                      __html: editTaskDescriptionHtml,
                    }}
                  />
                ) : (
                  <Text size="sm" c="dimmed">
                    Предпросмотр markdown-описания
                  </Text>
                )}
              </div>
            </div>
          </Stack>
          <Textarea
            label="Стартовый код"
            value={editTaskStarterCode}
            onChange={(e) => setEditTaskStarterCode(e.currentTarget.value)}
            minRows={12}
            styles={codeInputStyles}
          />
          <Select
            label="Язык"
            value={editTaskLanguage}
            onChange={(value) => setEditTaskLanguage(value ?? "nodejs")}
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
              label="Описание (Markdown, необязательно)"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.currentTarget.value)}
              minRows={8}
              styles={markdownInputStyles}
            />
            <Textarea
              id="create-task-code"
              data-testid="create-task-code-input"
              label="Стартовый код (необязательно)"
              value={taskStarterCode}
              onChange={(e) => setTaskStarterCode(e.currentTarget.value)}
              minRows={12}
              styles={codeInputStyles}
            />
            <Select
              data-testid="create-task-language-select"
              label="Язык"
              value={taskLanguage}
              onChange={(value) => setTaskLanguage(value ?? "nodejs")}
              data={LANGUAGE_OPTIONS}
              styles={darkSelectStyles}
            />
            <Button
              data-testid="create-task-submit-button"
              type="submit"
              loading={createTaskState.isLoading}
            >
              Сохранить задачу
            </Button>
          </Stack>
        </form>
      </Modal>

      {profileSaveToast ? (
        <Portal>
          <Box
            style={{
              position: "fixed",
              top: 16,
              left: "50%",
              transform: "translateX(-50%)",
              width: "min(480px, calc(100vw - 24px))",
              zIndex: 5000,
            }}
          >
            <Notification
              color={profileSaveToast.type === "success" ? "teal" : "red"}
              title={
                profileSaveToast.type === "success"
                  ? "Имя сохранено"
                  : "Ошибка сохранения"
              }
              withCloseButton
              onClose={() => setProfileSaveToast(null)}
            >
              {profileSaveToast.message}
            </Notification>
          </Box>
        </Portal>
      ) : null}

      <h1 className="visually-hidden">Личный кабинет — управление комнатами и задачами</h1>
      <AppShell padding={0} header={{ height: 72 }}>
        <AppShell.Header
          bg="#101318"
          c="white"
          style={{ borderBottom: "1px solid #272b34" }}
        >
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
                    dispatch(api.util.resetApiState());
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
                "radial-gradient(1200px 500px at 15% -20%, rgba(255,255,255,0.06), transparent), radial-gradient(900px 420px at 90% -20%, rgba(255,255,255,0.04), transparent), #0f1115",
            }}
          >
            <Container size="xl" py={20}>
              <Card
                withBorder
                bg="#11151c"
                c="gray.1"
                style={{ borderColor: "#272b34" }}
                mb="md"
              >
                <Group
                  justify="space-between"
                  align="flex-start"
                  gap="xl"
                  wrap="wrap"
                >
                  <Box style={{ flex: "1 1 320px", minWidth: 280 }}>
                    <Text c="gray.4" size="sm">
                      Профиль
                    </Text>
                    <Title order={3} mt={4}>
                      Имя для комнаты
                    </Title>
                    <Text c="gray.5" size="sm" mt={4}>
                      Это имя увидят другие участники комнаты. Никнейм остаётся
                      приватным и используется только для входа.
                    </Text>
                  </Box>
                  <Box style={{ flex: "1 1 320px", minWidth: 280 }}>
                    <Stack gap="xs">
                      <TextInput
                        value={profileDisplayName}
                        onChange={(event) =>
                          setProfileDisplayName(event.currentTarget.value)
                        }
                        styles={darkFieldStyles}
                        label="Имя для отображения"
                      />
                      <Group justify="space-between" align="center">
                        <Text size="xs" c="gray.5">
                          Ник для входа: @{auth.user?.nickname}
                        </Text>
                        <Button
                          loading={updateProfileState.isLoading}
                          onClick={saveProfileDisplayName}
                        >
                          Сохранить имя
                        </Button>
                      </Group>
                    </Stack>
                  </Box>
                </Group>
              </Card>

              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" mb="md">
                <Card
                  withBorder
                  bg="#11151c"
                  c="gray.1"
                  style={{ borderColor: "#272b34" }}
                >
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
                <Card
                  withBorder
                  bg="#11151c"
                  c="gray.1"
                  style={{ borderColor: "#272b34" }}
                >
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
                <Card
                  withBorder
                  bg="#11151c"
                  c="gray.1"
                  style={{ borderColor: "#272b34" }}
                >
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

              <Card
                withBorder
                radius="lg"
                mb="md"
                bg="#11151c"
                c="gray.1"
                style={{ borderColor: "#272b34" }}
              >
                <Group wrap="wrap" gap="xs">
                  {dashboardSections.map((dashboardSection) => (
                    <Button
                      key={dashboardSection.value}
                      variant={
                        activeSection === dashboardSection.value
                          ? "filled"
                          : "subtle"
                      }
                      color={
                        activeSection === dashboardSection.value
                          ? "gray"
                          : "dark"
                      }
                      onClick={() => switchSection(dashboardSection.value)}
                    >
                      {dashboardSection.label}
                    </Button>
                  ))}
                </Group>
              </Card>

              {activeSection === "rooms" && (
                <CreateRoomSection
                  title={roomTitle}
                  onTitleChange={setRoomTitle}
                  taskOptions={taskSelectData}
                  selectedTaskIds={roomTaskIds}
                  onSelectedTaskIdsChange={setRoomTaskIds}
                  selectedTasks={selectedRoomTasks}
                  isSubmitting={createRoomState.isLoading}
                  onSubmit={onCreateRoom}
                />
              )}

              {activeSection === "tasks" && (
                <SimpleGrid cols={{ base: 1, lg: 1 }} spacing="md">
                  <Card
                    withBorder
                    radius="lg"
                    padding="lg"
                    bg="#11151c"
                    c="gray.1"
                    style={{ borderColor: "#272b34" }}
                    data-testid="task-bank-panel"
                  >
                    <Stack>
                      <Title order={4}>Управление задачами</Title>
                      <Group justify="space-between" align="center">
                        <Button
                          data-testid="open-create-task-modal"
                          leftSection={<IconPlus size={14} />}
                          onClick={() => {
                            // Прежде окно открывалось со значением `taskLanguage`,
                            // которое жило в state и сбрасывалось в `nodejs` на
                            // первой попытке. В результате, если пользователь
                            // открывал модалку с активным табом `python`/`sql`,
                            // в селекте всё равно стоял Node JS, и при сабмите
                            // задача попадала не в свою группу. Теперь явно
                            // синхронизируем язык с табом, который сейчас
                            // выбран (`safeTaskLanguage`).
                            setTaskLanguage(safeTaskLanguage);
                            setCreateTaskModalOpened(true);
                          }}
                        >
                          Создать задачу
                        </Button>
                      </Group>
                      <Group wrap="wrap" gap="xs">
                        {normalizedTaskGroups.map((group) => (
                          <Button
                            key={group.language}
                            size="xs"
                            variant={
                              group.language === safeTaskLanguage
                                ? "filled"
                                : "subtle"
                            }
                            color={
                              group.language === safeTaskLanguage
                                ? "blue"
                                : "gray"
                            }
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
                          <Card
                            key={task.id}
                            withBorder
                            radius="md"
                            padding="sm"
                            bg="#121720"
                            style={{ borderColor: "#2a3039" }}
                          >
                            <Stack gap="xs">
                              <Group justify="space-between">
                                <Text fw={700}>{task.title}</Text>
                                <Badge color="blue" variant="light">
                                  {labelForLanguage(task.language)}
                                </Badge>
                              </Group>
                              <div
                                className={styles.taskDescriptionMarkdown}
                                dangerouslySetInnerHTML={{
                                  __html: markdownToHtml(task.description),
                                }}
                              />
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
                            Пока нет задач для{" "}
                            {labelForLanguage(currentTaskGroup.language)}
                          </Text>
                        )}
                      </Stack>
                    </Stack>
                  </Card>
                </SimpleGrid>
              )}

              {activeSection === "manage" && (
                <ManageRoomsSection
                  rooms={rooms}
                  roomTitleDrafts={roomTitleDrafts}
                  roomSaveStatus={roomSaveStatus}
                  onOpenRoom={openRoomFromDashboard}
                  onDeleteRoom={(roomId) => {
                    void removeRoom(roomId);
                  }}
                  onScheduleTitleChange={scheduleRoomAutoSave}
                  onFlushTitleChange={flushRoomAutoSave}
                />
              )}

              {activeSection === "admin" && isAdmin && (
                <AdminUsersSection
                  users={adminUsers}
                  currentUserId={auth.user?.id}
                  roleDrafts={adminRoleDrafts}
                  onRoleDraftChange={(userId, role) =>
                    setAdminRoleDrafts((prev) => ({ ...prev, [userId]: role }))
                  }
                  onSaveRole={saveAdminRole}
                  onDeleteUser={removeUserByAdmin}
                  onRefresh={() => refetchAdminUsers()}
                  isUpdatingRole={updateAdminUserRoleState.isLoading}
                  isDeleting={deleteAdminUserState.isLoading}
                />
              )}

              {activeSection === "agents" && (
                <AgentOpsSection
                  runForm={{
                    issueId: agentIssueId,
                    provider: agentProvider,
                    role: agentRole,
                    requiresApproval: agentRequiresApproval,
                    criteria: agentCriteria,
                    onIssueIdChange: setAgentIssueId,
                    onProviderChange: setAgentProvider,
                    onRoleChange: setAgentRole,
                    onRequiresApprovalChange: setAgentRequiresApproval,
                    onCriteriaChange: setAgentCriteria,
                    onSubmit: onStartAgentRun,
                    isSubmitting: startAgentRunState.isLoading,
                  }}
                  environment={{
                    report: environmentDoctor,
                    onRefresh: () => refetchEnvironmentDoctor(),
                  }}
                  faults={{
                    inviteCode: faultInviteCode,
                    latencyMs: faultLatencyMs,
                    dropEvery: faultDropEvery,
                    onInviteCodeChange: setFaultInviteCode,
                    onLatencyMsChange: setFaultLatencyMs,
                    onDropEveryChange: setFaultDropEvery,
                    onConfigure: onConfigureFaults,
                    onClear: onClearFaults,
                    isConfiguring: configureRealtimeFaultsState.isLoading,
                    isClearing: clearRealtimeFaultsState.isLoading,
                  }}
                  agentRuns={{
                    runs: agentRuns,
                    issueLabel: normalizedIssueId,
                    isIssueValid: issueIdLooksValid,
                    transitionComment,
                    selectedPolicyRunId,
                    selectedPolicyResult,
                    isTransitioning: transitionAgentRunState.isLoading,
                    isExecutingReviewers:
                      executeAllRunReviewersState.isLoading,
                    onRefresh: () => refetchAgentRuns(),
                    onTransitionCommentChange: setTransitionComment,
                    onTransitionRun,
                    onExecuteReviewers,
                    onSelectPolicyRun: setSelectedPolicyRunId,
                  }}
                />
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
