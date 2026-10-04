import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
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
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "components/antd-compat";
import { useClipboardNotification } from "../components/useClipboardNotification";
import { ThemeToggleButton } from "../features/theme/ThemeToggleButton";
import {
  IconBook2,
  IconCode,
  IconCopy,
  IconEdit,
  IconLayoutDashboard,
  IconLogout2,
  IconPlus,
  IconRocket,
  IconTrash,
} from "components/antd-icons";
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
  usePreviewHiringManagerMutation,
} from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";
import type { AdminUser, RoomSummary, TaskLanguageGroup, TaskTemplate } from "../types";
import styles from "./DashboardPage.module.css";
import {
  ADMIN_DASHBOARD_SECTION,
  BASE_DASHBOARD_SECTIONS,
  HR_DASHBOARD_SECTION,
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
import { encodeTaskShareCode } from "../features/tasks/taskShareCode";
import { AdminUsersSection } from "./dashboard/AdminUsersSection";
import { AgentOpsSection } from "./dashboard/AgentOpsSection";
import { CreateRoomSection } from "./dashboard/CreateRoomSection";
import { ManageRoomsSection } from "./dashboard/ManageRoomsSection";
import { PasteTaskCodeField } from "./dashboard/PasteTaskCodeField";
import { PresetsSection } from "./dashboard/PresetsSection";
import { HrCabinetSection } from "./dashboard/HrCabinetSection";
import { HrProfileSection } from "./dashboard/HrProfileSection";
import type {
  HiringManagerPickerFeedback,
  HiringManagerSelection,
} from "./dashboard/CreateRoomSection";

declare const __FEATURE_AGENT_OPS__: string | undefined;

const EMPTY_ROOMS: RoomSummary[] = [];
const EMPTY_TASK_GROUPS: TaskLanguageGroup[] = [];
const EMPTY_ADMIN_USERS: AdminUser[] = [];

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOpaqueUnavailable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function apiErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null;
  const data = error.data;
  if (typeof data !== "object" || data === null || !("error" in data)) return null;
  return typeof data.error === "string" ? data.error : null;
}

export function DashboardPage({
  forcedSection,
}: {
  forcedSection?: DashboardSection;
}) {
  const { notification } = App.useApp();
  const copyToClipboard = useClipboardNotification();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { section: routeSection } = useParams();
  const section = forcedSection ?? routeSection;
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAppSelector((s) => s.auth);
  const authIdentityRef = useRef({ token: auth.token, userId: auth.user?.id ?? null });
  authIdentityRef.current = { token: auth.token, userId: auth.user?.id ?? null };
  const agentOpsEnabled =
    (typeof __FEATURE_AGENT_OPS__ !== "undefined"
      ? __FEATURE_AGENT_OPS__
      : "false") === "true";
  const isAdmin = auth.user?.role === "admin";
  const isHr = auth.user?.isHr === true;

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskStarterCode, setTaskStarterCode] = useState("");
  const [taskLanguage, setTaskLanguage] = useState("nodejs");
  const [createTaskModalOpened, setCreateTaskModalOpened] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "task" | "user" | "room"; id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const [roomTitle, setRoomTitle] = useState("Техническое интервью");
  const [roomTaskIds, setRoomTaskIds] = useState<string[]>([]);
  const [hiringManagerDraftId, setHiringManagerDraftId] = useState("");
  const [hiringManagerSelections, setHiringManagerSelections] = useState<
    HiringManagerSelection[]
  >([]);
  const [hiringManagerPickerFeedback, setHiringManagerPickerFeedback] = useState<
    HiringManagerPickerFeedback
  >({ kind: "idle", message: "" });
  const pickerGenerationRef = useRef(0);
  const pickerIdentityRef = useRef<string | null>(null);
  const pickerRequestRef = useRef<{ abort: () => void } | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState(
    auth.user?.displayName ?? "",
  );
  const [profileEditOpened, setProfileEditOpened] = useState(false);
  const [profileEditError, setProfileEditError] = useState("");
  const notificationOwnerMountedRef = useRef(true);

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
  )
    .concat(isHr ? [HR_DASHBOARD_SECTION] : [])
    .concat(isAdmin ? [ADMIN_DASHBOARD_SECTION] : []);

  const editTaskDescriptionHtml = useMemo(
    () => markdownToHtml(editTaskDescription),
    [editTaskDescription],
  );

  useEffect(() => {
    setProfileDisplayName(auth.user?.displayName ?? "");
  }, [auth.user?.displayName]);

  const { data: rooms = EMPTY_ROOMS } = useMyRoomsQuery(undefined, {
    skip: !auth.token || section === "admin",
    refetchOnMountOrArgChange: true,
  });
  const { data: groupedTasks = EMPTY_TASK_GROUPS } = useTasksGroupedQuery(undefined, {
    skip: !auth.token || section === "admin",
  });
  const { data: adminUsers = EMPTY_ADMIN_USERS, refetch: refetchAdminUsers, isLoading: adminUsersLoading, isFetching: adminUsersFetching, isError: adminUsersError } =
    useAdminUsersQuery(undefined, {
      skip: !auth.token || !isAdmin || section !== "admin",
    });

  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [updateTask, updateTaskState] = useUpdateTaskTemplateMutation();
  const [deleteTask, deleteTaskState] = useDeleteTaskTemplateMutation();
  const [updateAdminUserRole, updateAdminUserRoleState] =
    useAdminUpdateUserRoleMutation();
  const [deleteAdminUser, deleteAdminUserState] = useAdminDeleteUserMutation();
  const [createRoom, createRoomState] = useCreateRoomMutation();
  const [previewHiringManager] = usePreviewHiringManagerMutation();
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
    notificationOwnerMountedRef.current = true;
    return () => {
      notificationOwnerMountedRef.current = false;
    };
  }, []);

  const pushNotif = (type: "success" | "error", title: string, message: string) => {
    if (
      !notificationOwnerMountedRef.current ||
      authIdentityRef.current.token !== auth.token ||
      authIdentityRef.current.userId !== (auth.user?.id ?? null) ||
      localStorage.getItem("auth_token") !== auth.token
    ) return;
    notification[type]({
      title,
      description: message || undefined,
      placement: "top",
      role: type === "success" ? "status" : "alert",
      duration: 5,
    });
  };

  const showError = (message: string) => pushNotif("error", message, "");
  const showSuccess = (title: string, message: string) => pushNotif("success", title, message);

  const profileIsResolving = Boolean(auth.token && !auth.user);
  const hasValidSection =
    ((section === "hr" || section === "admin") && profileIsResolving) ||
    isDashboardSection(section, agentOpsEnabled, isAdmin, isHr);
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

  const presetTaskOptions = useMemo(() => {
    return allSelectableRoomTasks.map((task) => ({
      value: task.id,
      label: task.title,
      language: normalizeLanguageKey(task.language),
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
    const identity = `${auth.token ?? ""}:${auth.user?.id ?? ""}`;
    const identityChanged = pickerIdentityRef.current !== identity;
    pickerIdentityRef.current = identity;
    pickerGenerationRef.current += 1;
    pickerRequestRef.current?.abort();
    pickerRequestRef.current = null;

    if (identityChanged || activeSection !== "rooms" || !auth.token || !auth.user?.id) {
      setHiringManagerDraftId("");
      setHiringManagerSelections([]);
      setHiringManagerPickerFeedback({ kind: "idle", message: "" });
    }

    return () => {
      pickerGenerationRef.current += 1;
      pickerRequestRef.current?.abort();
      pickerRequestRef.current = null;
    };
  }, [activeSection, auth.token, auth.user?.id]);

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
    if (!isAdmin) {
      setAdminRoleDrafts((prev) => Object.keys(prev).length > 0 ? {} : prev);
      return;
    }
    const currentRoles = new Map(adminUsers.map((user) => [user.id, user.role]));
    setAdminRoleDrafts((prev) => {
      const entries = Object.entries(prev);
      const retained = entries.filter(([userId, role]) => currentRoles.has(userId) && currentRoles.get(userId) !== role);
      return retained.length === entries.length ? prev : Object.fromEntries(retained);
    });
  }, [adminUsers, isAdmin]);

  const onCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    trackEvent("prod_task_create_submit", {
      language: taskLanguage,
      has_title: taskTitle.trim().length > 0,
    });
    try {
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
      showError("Не удалось создать задачу");
      trackEvent("prod_task_create_failed", {
        language: taskLanguage,
      });
    }
  };

  const onHiringManagerDraftIdChange = (value: string) => {
    setHiringManagerDraftId(value);
    if (hiringManagerPickerFeedback.kind !== "checking") {
      setHiringManagerPickerFeedback({ kind: "idle", message: "" });
    }
  };

  const onAddHiringManager = async () => {
    if (createRoomState.isLoading || hiringManagerPickerFeedback.kind === "checking") return;

    const normalizedId = hiringManagerDraftId.trim().toLowerCase();
    if (!normalizedId) {
      setHiringManagerPickerFeedback({ kind: "error", message: "Введите ID нанимающего" });
      return;
    }
    if (!CANONICAL_UUID_PATTERN.test(normalizedId)) {
      setHiringManagerPickerFeedback({ kind: "error", message: "Введите полный UUID нанимающего" });
      return;
    }
    if (hiringManagerSelections.some((selection) => selection.normalizedId === normalizedId)) {
      setHiringManagerPickerFeedback({ kind: "error", message: "Этот нанимающий уже добавлен" });
      return;
    }

    const generation = pickerGenerationRef.current + 1;
    pickerGenerationRef.current = generation;
    const requestIdentity = `${auth.token ?? ""}:${auth.user?.id ?? ""}`;
    setHiringManagerPickerFeedback({ kind: "checking", message: "Проверяем нанимающего…" });
    const request = previewHiringManager({ invitationId: normalizedId });
    pickerRequestRef.current = request;

    const isCurrentRequest = () => (
      generation === pickerGenerationRef.current
      && pickerIdentityRef.current === requestIdentity
      && activeSection === "rooms"
      && authIdentityRef.current.token === auth.token
      && authIdentityRef.current.userId === auth.user?.id
    );

    try {
      const response = await request.unwrap();
      if (!isCurrentRequest()) return;
      const responseId = response.normalizedId.toLowerCase();
      if (responseId !== normalizedId) {
        setHiringManagerPickerFeedback({
          kind: "error",
          message: "Не удалось проверить нанимающего. Повторите попытку.",
        });
        return;
      }
      setHiringManagerSelections((previous) => (
        previous.some((selection) => selection.normalizedId === responseId)
          ? previous
          : [...previous, { normalizedId: responseId, displayName: response.displayName }]
      ));
      setHiringManagerDraftId("");
      setHiringManagerPickerFeedback({ kind: "idle", message: "" });
      showSuccess(`Нанимающий добавлен: ${response.displayName}`, "");
    } catch (error) {
      if (!isCurrentRequest()) return;
      setHiringManagerPickerFeedback({
        kind: "error",
        message: isOpaqueUnavailable(error)
          ? "Нанимающий не найден или недоступен"
          : "Не удалось проверить нанимающего. Повторите попытку.",
      });
    } finally {
      if (isCurrentRequest()) pickerRequestRef.current = null;
    }
  };

  const onRemoveHiringManager = (normalizedId: string) => {
    setHiringManagerSelections((previous) => (
      previous.filter((selection) => selection.normalizedId !== normalizedId)
    ));
  };

  const onCreateRoom = async (e: FormEvent) => {
    e.preventDefault();
    if (createRoomState.isLoading) return;
    const firstSelectedTaskLanguage = selectedRoomTasks[0]?.language ?? null;
    const normalizedHiringManagerIds = hiringManagerSelections.map(
      (selection) => selection.normalizedId,
    );
    trackEvent("prod_room_create_submit", {
      selected_tasks: roomTaskIds.length,
      first_task_language: firstSelectedTaskLanguage,
    });
    try {
      const normalizedTaskIds = Array.from(
        new Set(roomTaskIds.filter((taskId) => allowedRoomTaskIds.has(taskId))),
      );
      if (normalizedTaskIds.length !== roomTaskIds.length) {
        setRoomTaskIds(normalizedTaskIds);
      }
      const room = await createRoom({
        title: roomTitle,
        taskIds: normalizedTaskIds,
        ...(normalizedHiringManagerIds.length > 0
          ? { hiringManagerIds: normalizedHiringManagerIds }
          : {}),
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
      pickerGenerationRef.current += 1;
      pickerRequestRef.current?.abort();
      pickerRequestRef.current = null;
      navigate(`/room/${room.inviteCode}`);
    } catch (error) {
      const message = normalizedHiringManagerIds.length > 0
        ? apiErrorMessage(error) ?? "Указанный нанимающий не найден или недоступен"
        : "Не удалось создать комнату";
      if (normalizedHiringManagerIds.length > 0) {
        setHiringManagerPickerFeedback({ kind: "error", message });
      }
      showError(message);
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
      await updateTask({
        taskId: editingTask.id,
        title: editTaskTitle,
        description: editTaskDescription,
        starterCode: editTaskStarterCode,
        language: editTaskLanguage,
      }).unwrap();
      setEditingTask(null);
    } catch {
      showError("Не удалось обновить задачу");
    }
  };

  const removeTask = async (taskId: string) => {
    try {
      await deleteTask({ taskId }).unwrap();
      setDeleteTarget(null);
    } catch (err) {
      const serverMessage = (err as { data?: { error?: string } })?.data?.error;
      const message = serverMessage ?? "Не удалось удалить задачу";
      setDeleteError(message);
      showError(message);
    }
  };

  const handleCopyTaskCode = async (task: TaskTemplate) => {
    try {
      const code = encodeTaskShareCode({
        title: task.title,
        description: task.description,
        starterCode: task.starterCode,
        language: task.language,
      });
      await copyToClipboard(code, {
        success: `Код задачи «${task.title}» готов к вставке.`,
        failure: "Разрешите доступ к буферу обмена и повторите попытку.",
      });
    } catch {
      showError("Не удалось скопировать код задачи");
    }
  };

  const saveAdminRole = async (user: AdminUser) => {
    const nextRole = (adminRoleDrafts[user.id] ?? user.role)
      .trim()
      .toLowerCase();
    if (!nextRole || nextRole === user.role) return;
    try {
      await updateAdminUserRole({ userId: user.id, role: nextRole }).unwrap();
      setAdminRoleDrafts((prev) => ({ ...prev, [user.id]: nextRole }));
    } catch {
      showError("Не удалось обновить роль пользователя");
    }
  };

  const removeUserByAdmin = async (userId: string) => {
    try {
      await deleteAdminUser({ userId }).unwrap();
      setDeleteTarget(null);
    } catch {
      setDeleteError("Не удалось удалить пользователя");
      showError("Не удалось удалить пользователя");
    }
  };

  const persistRoomTitle = async (
    roomId: string,
    originalTitle: string,
    titleDraft: string,
    notifySuccess = false,
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
      await updateRoom({ roomId, title: normalized }).unwrap();
      setRoomTitleDrafts((prev) => ({ ...prev, [roomId]: normalized }));
      setRoomSaveStatus((prev) => ({ ...prev, [roomId]: "saved" }));
      if (notifySuccess) showSuccess("Сохранено", "Название интервью сохранено");
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
      showError("Не удалось автоматически сохранить комнату");
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

  const flushRoomAutoSave = (roomId: string, originalTitle: string, nextDraft?: string, notifySuccess = false) => {
    if (roomSaveTimersRef.current[roomId]) {
      window.clearTimeout(roomSaveTimersRef.current[roomId]);
      delete roomSaveTimersRef.current[roomId];
    }
    const draft = nextDraft ?? roomTitleDrafts[roomId] ?? originalTitle;
    const latestOriginal =
      rooms.find((room) => room.id === roomId)?.title ?? originalTitle;
    void persistRoomTitle(roomId, latestOriginal, draft, notifySuccess);
  };

  const removeRoom = async (roomId: string) => {
    try {
      const result = await deleteRoom({ roomId }).unwrap();
      setDeleteTarget(null);
      showSuccess(
        result.archived ? "Комната перенесена в архив" : "Комната удалена",
        result.archived
          ? "История сохранена в кабинетах назначенных нанимающих"
          : "Комната и связанные данные удалены",
      );
    } catch {
      setDeleteError("Не удалось удалить комнату");
      showError("Не удалось удалить комнату");
    }
  };

  const saveProfileDisplayName = async () => {
    const normalized = profileDisplayName.trim();
    if (!normalized) {
      showError("Введите имя для отображения");
      return;
    }
    const requestIdentity = { token: auth.token, userId: auth.user?.id ?? null };
    try {
      const updated = await updateProfile({ displayName: normalized }).unwrap();
      if (
        authIdentityRef.current.token !== requestIdentity.token ||
        authIdentityRef.current.userId !== requestIdentity.userId ||
        localStorage.getItem("auth_token") !== requestIdentity.token
      ) return;
      dispatch(updateAuthProfile({ displayName: updated.displayName }));
      localStorage.setItem("display_name", updated.displayName);
      setProfileDisplayName(updated.displayName);
      setProfileEditOpened(false);
      setProfileEditError("");
      showSuccess("Имя сохранено", "Имя для комнаты успешно сохранено");
    } catch {
      setProfileEditError("Не удалось сохранить имя для комнаты. Повторите попытку.");
      showError("Не удалось сохранить имя для комнаты");
    }
  };

  const saveHiringManagerCapability = async (isHr: boolean): Promise<boolean> => {
    if (!auth.user) return false;
    const requestIdentity = { token: auth.token, userId: auth.user.id };
    const updated = await updateProfile({
      displayName: auth.user.displayName,
      isHr,
    }).unwrap();
    if (
      authIdentityRef.current.token !== requestIdentity.token ||
      authIdentityRef.current.userId !== requestIdentity.userId ||
      localStorage.getItem("auth_token") !== requestIdentity.token
    ) return false;
    dispatch(updateAuthProfile({
      displayName: updated.displayName,
      isHr: updated.isHr,
    }));
    localStorage.setItem("display_name", updated.displayName);
    if (!updated.isHr) {
      dispatch(api.util.invalidateTags(["HrInterviews", "HrManagers"]));
      if (activeSection === "hr") navigate("/dashboard/rooms", { replace: true });
    }
    showSuccess(
      updated.isHr ? "Функции нанимающего включены" : "Функции нанимающего отключены",
      updated.isHr ? "Теперь доступен личный список интервью" : "Доступ к комнатам и их история не изменились",
    );
    return true;
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
      if (!issueIdLooksValid) {
        showError("Укажите задачу Linear в формате KEY-123");
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
      showError("Не удалось запустить агентный процесс");
    }
  };

  const onTransitionRun = async (runId: string, targetState: string) => {
    try {
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
      showError("Не удалось выполнить переход процесса");
    }
  };

  const onExecuteReviewers = async (runId: string) => {
    try {
      await executeAllRunReviewers({ runId }).unwrap();
      await refetchAgentRuns();
      setSelectedPolicyRunId(runId);
    } catch {
      showError("Не удалось запустить независимые ревью");
    }
  };

  const onConfigureFaults = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await configureRealtimeFaults({
        inviteCode: faultInviteCode.trim(),
        latencyMs: Number(faultLatencyMs) || 0,
        dropEveryNthMessage: Number(faultDropEvery) || 0,
      }).unwrap();
    } catch {
      showError("Не удалось применить профиль сбоев realtime");
    }
  };

  const onClearFaults = async () => {
    try {
      if (!faultInviteCode.trim()) return;
      await clearRealtimeFaults({
        inviteCode: faultInviteCode.trim(),
      }).unwrap();
    } catch {
      showError("Не удалось очистить профиль сбоев realtime");
    }
  };

  const switchSection = (nextSection: DashboardSection) => {
    if (nextSection === "agents" && !agentOpsEnabled) {
      navigate("/dashboard/rooms");
      return;
    }
    if (nextSection === "admin" && !isAdmin) {
      navigate("/dashboard/rooms");
      return;
    }
    if (nextSection === "hr" && !isHr) {
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
  if ((section === "hr" || section === "admin") && profileIsResolving) {
    return <Box p="xl" c="gray.2" bg="var(--app-bg)" mih="100vh">Загрузка профиля...</Box>;
  }

  const deletePending = deleteTaskState.isLoading || deleteAdminUserState.isLoading || deleteRoomState.isLoading;
  return (
    <>
      <Modal opened={deleteTarget !== null} onClose={() => { if (!deletePending) setDeleteTarget(null); }} title={deleteTarget?.kind === "user" ? "Удалить пользователя?" : deleteTarget?.kind === "room" ? "Удалить комнату?" : "Удалить задачу?"} centered>
        <Stack>
          <Text>{deleteTarget?.kind === "room" ? `Комната «${deleteTarget.name}» будет удалена или перенесена в архив, если её история нужна нанимающим.` : deleteTarget?.kind === "user" ? `Пользователь ${deleteTarget.name} будет удалён. Это действие нельзя отменить.` : `Задача «${deleteTarget?.name ?? ""}» будет удалена из банка.`}</Text>
          {deleteError ? <Text role="alert" c="var(--app-error)">{deleteError}</Text> : null}
          <Group justify="flex-end">
            <Button variant="subtle" disabled={deletePending} onClick={() => setDeleteTarget(null)}>Отмена</Button>
            <Button variant="light" color="red" leftSection={<IconTrash size={16} aria-hidden="true" />} loading={deletePending} disabled={deletePending} onClick={() => {
              if (!deleteTarget || deletePending) return;
              setDeleteError("");
              if (deleteTarget.kind === "task") void removeTask(deleteTarget.id);
              else if (deleteTarget.kind === "user") void removeUserByAdmin(deleteTarget.id);
              else void removeRoom(deleteTarget.id);
            }}>Удалить</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={!!editingTask}
        onClose={() => setEditingTask(null)}
        title="Редактирование задачи"
        size="lg"
        centered
      >
        <Stack>
          <TextInput placeholder="Введите название"
            label="Название"
            value={editTaskTitle}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTaskTitle(e.currentTarget.value)}
            styles={darkFieldStyles}
          />
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              Описание (Markdown)
            </Text>
            <div className={styles.markdownEditorGrid}>
              <Textarea placeholder="Опишите условие, примеры и ожидаемый результат"
                value={editTaskDescription}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTaskDescription(e.currentTarget.value)}
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
          <Textarea placeholder="Добавьте заготовку решения для кандидата"
            label="Стартовый код"
            value={editTaskStarterCode}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTaskStarterCode(e.currentTarget.value)}
            minRows={12}
            styles={codeInputStyles}
          />
          <Select placeholder="Выберите язык решения"
            label="Язык"
            value={editTaskLanguage}
            onChange={(value) => setEditTaskLanguage(value ?? "nodejs")}
            data={LANGUAGE_OPTIONS}
            styles={darkSelectStyles}
            labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
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
            <TextInput placeholder="Введите название"
              id="create-task-title"
              data-testid="create-task-title-input"
              label="Название"
              value={taskTitle}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaskTitle(e.currentTarget.value)}
              styles={darkFieldStyles}
              required
            />
            <Textarea placeholder="Опишите условие, примеры и ожидаемый результат"
              id="create-task-description"
              data-testid="create-task-description-input"
              label="Описание (Markdown, необязательно)"
              value={taskDescription}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaskDescription(e.currentTarget.value)}
              minRows={8}
              styles={markdownInputStyles}
            />
            <Textarea placeholder="Добавьте заготовку решения или оставьте поле пустым"
              id="create-task-code"
              data-testid="create-task-code-input"
              label="Стартовый код (необязательно)"
              value={taskStarterCode}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaskStarterCode(e.currentTarget.value)}
              minRows={12}
              styles={codeInputStyles}
            />
            <Select placeholder="Выберите язык решения"
              data-testid="create-task-language-select"
              label="Язык"
              value={taskLanguage}
              onChange={(value) => setTaskLanguage(value ?? "nodejs")}
              data={LANGUAGE_OPTIONS}
              styles={darkSelectStyles}
              labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
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

      <h1 className="visually-hidden">Личный кабинет — управление комнатами и задачами</h1>
      <AppShell padding={0} header={{ height: 72 }}>
        <AppShell.Header className={styles.dashboardHeader}>
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
              <Group className={styles.headerControls} align="center">
                <Badge color="gray" variant="light">
                  @{auth.user?.nickname}
                </Badge>
                <Button
                  leftSection={<IconLogout2 size={16} />}
                  className="app-header-control"
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
                <ThemeToggleButton />
              </Group>
            </Group>
          </Container>
        </AppShell.Header>

        <AppShell.Main>
          <Box
            style={{
              minHeight: "calc(100vh - 72px)",
              background: "var(--app-bg)",
            }}
          >
            <Container size="xl" py={20}>
              {activeSection !== "hr" ? <Card
                withBorder
                bg="var(--app-surface)"
                c="gray.1"
                style={{ borderColor: "var(--app-border)" }}
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
                      <Group gap="xs" align="center" wrap="wrap">
                        <Text fw={600}>{auth.user?.displayName}</Text>
                        <ActionIcon variant="subtle" aria-label="Изменить имя" title="Изменить имя" onClick={() => { setProfileDisplayName(auth.user?.displayName ?? ""); setProfileEditError(""); setProfileEditOpened(true); }}><IconEdit size={16} aria-hidden="true" /></ActionIcon>
                      </Group>
                      <Text size="xs" c="gray.5">Ник для входа: @{auth.user?.nickname}</Text>
                      <Modal opened={profileEditOpened} onClose={() => { if (!updateProfileState.isLoading) setProfileEditOpened(false); }} title="Изменить имя" centered>
                        <form onSubmit={(event) => { event.preventDefault(); void saveProfileDisplayName(); }}>
                          <Stack>
                            <TextInput label="Имя для отображения" placeholder="Введите имя для отображения" value={profileDisplayName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setProfileDisplayName(event.currentTarget.value)} required autoFocus disabled={updateProfileState.isLoading} />
                            {profileEditError ? <Text role="alert" c="red.4">{profileEditError}</Text> : null}
                            <Group justify="flex-end">
                              <Button type="button" variant="subtle" disabled={updateProfileState.isLoading} onClick={() => setProfileEditOpened(false)}>Отмена</Button>
                              <Button type="submit" loading={updateProfileState.isLoading}>Сохранить имя</Button>
                            </Group>
                          </Stack>
                        </form>
                      </Modal>
                    </Stack>
                  </Box>
                </Group>
                {auth.user ? (
                  <HrProfileSection
                    user={auth.user}
                    isLoading={updateProfileState.isLoading}
                    onSave={saveHiringManagerCapability}
                  />
                ) : null}
              </Card> : null}

              {activeSection !== "hr" ? <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" mb="md">
                <Card
                  withBorder
                  bg="var(--app-surface)"
                  c="gray.1"
                  style={{ borderColor: "var(--app-border)" }}
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
                  bg="var(--app-surface)"
                  c="gray.1"
                  style={{ borderColor: "var(--app-border)" }}
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
                  bg="var(--app-surface)"
                  c="gray.1"
                  style={{ borderColor: "var(--app-border)" }}
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
              </SimpleGrid> : null}

              <Card
                withBorder
                radius="lg"
                mb="md"
                bg="var(--app-surface)"
                c="gray.1"
                style={{ borderColor: "var(--app-border)" }}
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
                      color="gray"
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
                  selectedTasks={selectedRoomTasks}
                  selectedTaskIds={roomTaskIds}
                  onSelectedTaskIdsChange={setRoomTaskIds}
                  hiringManagerDraftId={hiringManagerDraftId}
                  onHiringManagerDraftIdChange={onHiringManagerDraftIdChange}
                  onAddHiringManager={onAddHiringManager}
                  hiringManagerSelections={hiringManagerSelections}
                  hiringManagerPickerFeedback={hiringManagerPickerFeedback}
                  onRemoveHiringManager={onRemoveHiringManager}
                  isSubmitting={createRoomState.isLoading}
                  onSubmit={onCreateRoom}
                  onError={showError}
                />
              )}

              {activeSection === "tasks" && (
                <SimpleGrid cols={{ base: 1, lg: 1 }} spacing="md">
                  <Card
                    withBorder
                    radius="lg"
                    padding="lg"
                    bg="var(--app-surface)"
                    c="gray.1"
                    style={{ borderColor: "var(--app-border)" }}
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
                      <Divider color="var(--app-border)" />
                      <PasteTaskCodeField
                        existingTasks={allSelectableRoomTasks}
                        onImportSuccess={(language) => {
                          const params = new URLSearchParams(searchParams);
                          params.set("lang", language);
                          setSearchParams(params, { replace: true });
                        }}
                      />
                      <Stack gap="sm">
                        {currentTaskGroup.tasks.map((task) => (
                          <Card
                            key={task.id}
                            withBorder
                            radius="md"
                            padding="sm"
                            bg="var(--app-surface-soft)"
                            style={{ borderColor: "var(--app-border)" }}
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
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  onClick={() => void handleCopyTaskCode(task)}
                                  title="Скопировать код задачи"
                                  aria-label="Скопировать код задачи"
                                >
                                  <IconCopy size={14} />
                                </ActionIcon>
                                <Button
                                  size="xs"
                                  leftSection={<IconEdit size={14} />}
                                  variant="light"
                                  onClick={() => startEditTask(task)}
                                >
                                  Редактировать
                                </Button>
                                <ActionIcon
                                  size="xs"
                                  color="red"
                                  variant="light"
                                  aria-label={`Удалить задачу ${task.title}`}
                                  title="Удалить задачу"
                                  disabled={deletePending}
                                  onClick={() => { setDeleteError(""); setDeleteTarget({ kind: "task", id: task.id, name: task.title }); }}
                                >
                                  <IconTrash size={16} aria-hidden="true" />
                                </ActionIcon>
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

              {activeSection === "presets" && (
                <PresetsSection taskOptions={presetTaskOptions} onError={showError} />
              )}

              {activeSection === "manage" && (
                <ManageRoomsSection
                  rooms={rooms}
                  roomTitleDrafts={roomTitleDrafts}
                  roomSaveStatus={roomSaveStatus}
                  onOpenRoom={openRoomFromDashboard}
                  onDeleteRoom={(roomId) => {
                    setDeleteError("");
                    setDeleteTarget({ kind: "room", id: roomId, name: rooms.find(room => room.id === roomId)?.title ?? "Комната" });
                  }}
                  onScheduleTitleChange={scheduleRoomAutoSave}
                  onFlushTitleChange={flushRoomAutoSave}
                />
              )}

              {activeSection === "hr" && auth.user?.isHr && auth.token ? (
                <HrCabinetSection user={auth.user} token={auth.token} />
              ) : null}

              {activeSection === "admin" && isAdmin && (
                <AdminUsersSection
                  users={adminUsers}
                  currentUserId={auth.user?.id}
                  roleDrafts={adminRoleDrafts}
                  onRoleDraftChange={(userId, role) =>
                    setAdminRoleDrafts((prev) => ({ ...prev, [userId]: role }))
                  }
                  onSaveRole={saveAdminRole}
                  onDeleteUser={user => { setDeleteError(""); setDeleteTarget({ kind: "user", id: user.id, name: `@${user.nickname}` }); }}
                  onRefresh={() => refetchAdminUsers()}
                  isUpdatingRole={updateAdminUserRoleState.isLoading}
                  isDeleting={deleteAdminUserState.isLoading}
                  isLoading={adminUsersLoading}
                  isFetching={adminUsersFetching}
                  isError={adminUsersError}
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

            </Container>
          </Box>
        </AppShell.Main>
      </AppShell>
    </>
  );
}
