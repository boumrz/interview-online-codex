import React, { useMemo, useRef, useState, type FormEvent } from "react";
import { IconMenu2, IconPlus, IconRefresh, IconUserCircle } from "@tabler/icons-react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Menu,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { Navigate, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { clearAuth, updateProfile as updateAuthProfile } from "../../features/auth/authSlice";
import { WorkspaceSwitcher } from "../../features/workspace/WorkspaceSwitcher";
import { parseLibraryTransfer, serializeTask } from "../../features/workspace/libraryTransfer";
import {
  api,
  useCreateRoomMutation,
  useCreateTaskTemplateMutation,
  useDeleteRoomMutation,
  useGetHrInterviewsQuery,
  useLazyGetInterviewMetadataQuery,
  useMyRoomsQuery,
  useTasksGroupedQuery,
  useListPresetsQuery,
  usePreviewHiringManagerMutation,
  useUpdateInterviewMetadataMutation,
  useUpdateProfileMutation,
  useUpdateRoomMutation,
} from "../../services/api";
import type { HiringManagerPreviewResponse, Room, RoomSummary, TaskTemplate } from "../../types";
import { PresetsSection } from "../dashboard/PresetsSection";
import { HrCabinetSection } from "../dashboard/HrCabinetSection";
import { HrProfileSection } from "../dashboard/HrProfileSection";
import { LANGUAGE_OPTIONS } from "../dashboard/dashboardConstants";
import { darkSelectStyles } from "../dashboard/dashboardFieldStyles";
import { labelForLanguage, normalizeLanguageKey } from "../dashboard/dashboardHelpers";
import styles from "./PersonalWorkspacePage.module.css";

type WorkspaceSection = "interviews" | "create" | "library" | "candidates" | "profile";
type CreateIntent = "list" | "room";
type PendingMetadata = {
  room: Room;
  intent: CreateIntent;
  metadata: {
    candidateName: string | null;
    position: string | null;
    scheduledAt: string | null;
    revision: number;
  };
};

type RequestIdentity = { token: string; userId: string; generation: number };
type HiringManagerSelection = HiringManagerPreviewResponse;
type PickerFeedback = { kind: "idle" | "checking" | "success" | "error"; message: string };

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data = error.data;
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  return typeof data.error === "string" ? data.error : null;
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 404);
}

function resolveSection(pathname: string): WorkspaceSection | null {
  if (pathname === "/profile") return "profile";
  if (pathname === "/workspace/personal/interviews") return "interviews";
  if (pathname === "/workspace/personal/interviews/new") return "create";
  if (pathname === "/workspace/personal/library") return "library";
  if (pathname === "/workspace/personal/candidates") return "candidates";
  return null;
}

function roomAccessLabel(room: RoomSummary) {
  if (room.accessRole === "owner") return "Владелец";
  if (room.accessRole === "interviewer") return "Интервьюер";
  return "Кандидат";
}

function WorkspaceNavigation({ isHr }: { isHr: boolean }) {
  const location = useLocation();
  const items = useMemo(() => [
    { label: "Интервью", to: "/workspace/personal/interviews" },
    { label: "Библиотека", to: "/workspace/personal/library" },
    ...(isHr ? [{ label: "Кандидаты", to: "/workspace/personal/candidates" }] : []),
  ], [isHr]);
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef(new Map<string, HTMLSpanElement>());
  const [visibleCount, setVisibleCount] = useState(0);
  const [overflowOpened, setOverflowOpened] = useState(false);

  React.useLayoutEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      if (!nav) return;
      const widths = items.map((item) => {
        return linkRefs.current.get(item.to)?.getBoundingClientRect().width ?? 0;
      });
      if (widths.some((width) => width <= 0)) return;

      const gap = 4;
      const overflowWidth = 48;
      let nextVisibleCount = 0;
      let occupied = 0;
      widths.forEach((width, index) => {
        const nextOccupied = occupied + (nextVisibleCount > 0 ? gap : 0) + width;
        const reserveOverflow = index < widths.length - 1 ? gap + overflowWidth : 0;
        if (nextOccupied + reserveOverflow <= nav.clientWidth) {
          nextVisibleCount += 1;
          occupied = nextOccupied;
        }
      });
      setVisibleCount((current) => current === nextVisibleCount ? current : nextVisibleCount);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (navRef.current) observer?.observe(navRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items]);

  const directItems = items.slice(0, visibleCount);
  const overflowItems = items.slice(visibleCount);
  return (
    <nav ref={navRef} className={styles.nav} aria-label="Разделы личного пространства">
      <span className={styles.navMeasure} aria-hidden="true">
        {items.map((item) => (
          <span key={item.to} className={styles.navMeasureItem} ref={(node) => {
            if (node) linkRefs.current.set(item.to, node);
            else linkRefs.current.delete(item.to);
          }}>{item.label}</span>
        ))}
      </span>
      {directItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => isActive ? styles.navActive : styles.navLink}
        >
          {item.label}
        </NavLink>
      ))}
      {overflowItems.length > 0 ? (
        <Menu position="bottom-end" shadow="md" withinPortal opened={overflowOpened} onChange={setOverflowOpened}>
          <Menu.Target>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Меню разделов"
              aria-haspopup="menu"
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOverflowOpened(true);
                }
              }}
            >
              <IconMenu2 size={20} stroke={2} aria-hidden="true" />
            </button>
          </Menu.Target>
          <Menu.Dropdown aria-label="Дополнительные разделы">
            {overflowItems.map((item) => (
              <Menu.Item
                key={item.to}
                component={NavLink}
                to={item.to}
                className={location.pathname === item.to ? styles.overflowMenuItemActive : styles.overflowMenuItem}
                aria-current={location.pathname === item.to ? "page" : undefined}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : null}
    </nav>
  );
}

function InterviewRow({ room, initialMetadata }: { room: RoomSummary; initialMetadata?: PendingMetadata["metadata"] }) {
  const navigate = useNavigate();
  const originalTitle = useRef(room.title);
  const [loadMetadata, metadataState] = useLazyGetInterviewMetadataQuery();
  const [updateRoom, updateState] = useUpdateRoomMutation();
  const [deleteRoom, deleteState] = useDeleteRoomMutation();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(room.title);
  const [displayTitle, setDisplayTitle] = useState(room.title);
  const [actionError, setActionError] = useState("");
  const [deleteOpened, setDeleteOpened] = useState(false);

  React.useEffect(() => {
    void loadMetadata({
      inviteCode: room.inviteCode,
      ownerToken: room.ownerToken ?? undefined,
      interviewerToken: room.interviewerToken ?? undefined,
    }, true);
  }, [loadMetadata, room.interviewerToken, room.inviteCode, room.ownerToken]);

  const saveTitle = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || updateState.isLoading) return;
    setActionError("");
    const previousTitle = displayTitle;
    setDisplayTitle(nextTitle);
    setEditing(false);
    try {
      await updateRoom({ roomId: room.id, title: nextTitle }).unwrap();
    } catch {
      setDisplayTitle(previousTitle);
      setActionError("Не удалось переименовать интервью");
    }
  };

  const remove = async () => {
    if (deleteState.isLoading) return;
    setActionError("");
    try {
      await deleteRoom({ roomId: room.id }).unwrap();
      setDeleteOpened(false);
    } catch {
      setActionError("Не удалось удалить интервью");
    }
  };

  const candidate = metadataState.data?.candidateName?.trim() || initialMetadata?.candidateName?.trim() || "Не указан";
  const scheduledAt = metadataState.data?.scheduledAt ?? initialMetadata?.scheduledAt;
  const dateLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleDateString("ru-RU")
    : "Без даты";
  const statusLabel = room.status === "finished" ? "Завершено" : "Активно";

  return (
    <>
    <Table.Tr aria-label={originalTitle.current}>
      <Table.Td>
        {editing ? (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              label="Название интервью"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.currentTarget.value)}
            />
            <Button type="button" size="compact-sm" loading={updateState.isLoading} onClick={() => void saveTitle()}>
              Сохранить название
            </Button>
          </Group>
        ) : <Text fw={700}>{displayTitle}</Text>}
        {actionError ? <Text role="alert" size="xs" c="red.4">{actionError}</Text> : null}
      </Table.Td>
      <Table.Td>{candidate}</Table.Td>
      <Table.Td>Без трека и вакансии</Table.Td>
      <Table.Td>{dateLabel}</Table.Td>
      <Table.Td>{statusLabel}</Table.Td>
      <Table.Td>
        <Badge tt="none" color={room.accessRole === "owner" ? "teal" : room.accessRole === "interviewer" ? "cyan" : "blue"} variant="light">
          {roomAccessLabel(room)}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {room.accessRole === "owner" ? (
            <>
              <Button type="button" size="compact-sm" variant="subtle" aria-label={`Переименовать ${room.title}`} onClick={() => setEditing(true)}>
                Переименовать
              </Button>
              <Button type="button" size="compact-sm" variant="subtle" color="red" loading={deleteState.isLoading} aria-label={`Удалить ${room.title}`} onClick={() => setDeleteOpened(true)}>
                Удалить
              </Button>
            </>
          ) : null}
          <Button type="button" size="compact-sm" variant="light" onClick={() => navigate(`/room/${room.inviteCode}`)}>
            Открыть интервью
          </Button>
        </Group>
      </Table.Td>
    </Table.Tr>
    <Modal opened={deleteOpened} onClose={() => setDeleteOpened(false)} title="Удалить интервью" centered>
      <Stack>
        <Text>Интервью «{displayTitle}» будет удалено без возможности восстановления.</Text>
        <Group justify="flex-end">
          <Button type="button" variant="subtle" disabled={deleteState.isLoading} onClick={() => setDeleteOpened(false)}>Отмена</Button>
          <Button type="button" color="red" loading={deleteState.isLoading} onClick={() => void remove()}>Удалить</Button>
        </Group>
      </Stack>
    </Modal>
    </>
  );
}

function InterviewList({
  rooms,
  isLoading,
  isFetching,
  error,
  onRefresh,
}: {
  rooms: RoomSummary[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const filteredRooms = rooms.filter((room) => room.title.toLocaleLowerCase("ru-RU").includes(search.trim().toLocaleLowerCase("ru-RU")));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          <Text className={styles.eyebrow}>Рабочая лента</Text>
          <Title order={1}>Интервью</Title>
          <Text c="gray.5" mt={6}>Ваши комнаты и интервью, куда вас пригласили.</Text>
        </div>
        <Button className={styles.primaryAction} color="blue" onClick={() => navigate("/workspace/personal/interviews/new")}>
          Создать интервью
        </Button>
      </Group>

      {isLoading ? <Text aria-live="polite">Загружаем интервью</Text> : null}
      {!isLoading && error && rooms.length === 0 ? (
        <Alert color="red" role="alert" title="Не удалось загрузить интервью">
          <Button type="button" size="xs" variant="light" mt="sm" onClick={onRefresh}>Повторить загрузку</Button>
        </Alert>
      ) : null}
      {!isLoading && error && rooms.length > 0 ? (
        <Alert color="orange" role="alert" title="Данные не обновлены">
          Показана последняя доступная версия списка.
          <Button type="button" size="xs" variant="light" mt="sm" onClick={onRefresh}>Повторить обновление</Button>
        </Alert>
      ) : null}
      {!isLoading && rooms.length > 0 ? (
        <Group justify="space-between" align="flex-end">
          <TextInput className={styles.interviewSearch} label="Поиск интервью" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
          <Button type="button" variant="light" leftSection={<IconRefresh size={16} />} onClick={onRefresh} loading={isFetching && !error}>Обновить интервью</Button>
        </Group>
      ) : null}
      {!isLoading && !error && rooms.length === 0 ? (
        <Card className={styles.emptyState} withBorder>
          <Text fw={700}>У вас пока нет интервью</Text>
          <Text c="gray.5" size="sm">Создайте первое интервью — оно появится в этом списке.</Text>
        </Card>
      ) : null}
      {!isLoading && rooms.length > 0 && filteredRooms.length === 0 ? (
        <Card className={styles.emptyState} withBorder>
          <Text fw={700}>По вашему запросу интервью не найдены</Text>
          <Button type="button" variant="subtle" onClick={() => setSearch("")}>Сбросить поиск</Button>
        </Card>
      ) : null}
      {!isLoading && filteredRooms.length > 0 ? (
        <Card className={styles.panel} withBorder padding={0}>
          <div className={styles.tableScroll}>
            <Table verticalSpacing="md" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Интервью</Table.Th>
                  <Table.Th>Кандидат</Table.Th>
                  <Table.Th>Контекст</Table.Th>
                  <Table.Th>Дата</Table.Th>
                  <Table.Th>Статус</Table.Th>
                  <Table.Th>Роль</Table.Th>
                  <Table.Th><span className="visually-hidden">Действие</span></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredRooms.map((room) => (
                  <InterviewRow
                    key={room.id}
                    room={room}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </Card>
      ) : null}
    </Stack>
  );
}

function persistOwnerRoom(room: Room, displayName: string) {
  localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken ?? "");
  localStorage.setItem("display_name", displayName);
  localStorage.setItem(`guest_display_name_${room.inviteCode}`, displayName);
}

function CreateInterview({ tasks }: { tasks: TaskTemplate[] }) {
  const navigate = useNavigate();
  const auth = useAppSelector((state) => state.auth);
  const [createRoom, createState] = useCreateRoomMutation();
  const [updateMetadata] = useUpdateInterviewMetadataMutation();
  const [previewHiringManager] = usePreviewHiringManagerMutation();
  const [title, setTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [hiringManagerDraftId, setHiringManagerDraftId] = useState("");
  const [hiringManagerSelections, setHiringManagerSelections] = useState<HiringManagerSelection[]>([]);
  const [pickerFeedback, setPickerFeedback] = useState<PickerFeedback>({ kind: "idle", message: "" });
  const [error, setError] = useState("");
  const [pendingMetadata, setPendingMetadata] = useState<PendingMetadata | null>(null);
  const [retryingMetadata, setRetryingMetadata] = useState(false);
  const intentRef = useRef<CreateIntent>("list");
  const generationRef = useRef(0);
  const pickerGenerationRef = useRef(0);
  const pendingOwnerInviteRef = useRef<string | null>(null);
  const identityKey = `${auth.token ?? ""}:${auth.user?.id ?? ""}`;
  const previousIdentityKeyRef = useRef(identityKey);
  const identityRef = useRef<RequestIdentity>({
    token: auth.token ?? "",
    userId: auth.user?.id ?? "",
    generation: generationRef.current,
  });
  identityRef.current = {
    token: auth.token ?? "",
    userId: auth.user?.id ?? "",
    generation: generationRef.current,
  };

  const captureIdentity = (): RequestIdentity => ({ ...identityRef.current });
  const isCurrentIdentity = (identity: RequestIdentity) => (
    identity.token.length > 0
    && localStorage.getItem("auth_token") === identity.token
    && identityRef.current.token === identity.token
    && identityRef.current.userId === identity.userId
    && identityRef.current.generation === identity.generation
  );

  React.useEffect(() => {
    if (previousIdentityKeyRef.current === identityKey) return;
    previousIdentityKeyRef.current = identityKey;
    generationRef.current += 1;
    identityRef.current = {
      token: auth.token ?? "",
      userId: auth.user?.id ?? "",
      generation: generationRef.current,
    };
    pickerGenerationRef.current += 1;
    if (pendingOwnerInviteRef.current) {
      localStorage.removeItem(`owner_token_${pendingOwnerInviteRef.current}`);
      localStorage.removeItem(`guest_display_name_${pendingOwnerInviteRef.current}`);
      pendingOwnerInviteRef.current = null;
    }
    setTitle("");
    setCandidateName("");
    setPosition("");
    setTaskIds([]);
    setHiringManagerDraftId("");
    setHiringManagerSelections([]);
    setPickerFeedback({ kind: "idle", message: "" });
    setPendingMetadata(null);
    setRetryingMetadata(false);
    setError("");
  }, [auth.token, auth.user?.id, identityKey]);

  React.useEffect(() => () => {
    generationRef.current += 1;
    pickerGenerationRef.current += 1;
    if (pendingOwnerInviteRef.current) {
      localStorage.removeItem(`owner_token_${pendingOwnerInviteRef.current}`);
      localStorage.removeItem(`guest_display_name_${pendingOwnerInviteRef.current}`);
    }
  }, []);

  const taskOptions = tasks.map((task) => ({
    value: task.id,
    label: `${task.title} · ${labelForLanguage(task.language)}`,
  }));
  const selectedTasks = useMemo(() => {
    const selectedIds = new Set(taskIds);
    return tasks.filter((task) => selectedIds.has(task.id));
  }, [taskIds, tasks]);

  const completeCreation = (room: Room, intent: CreateIntent, identity: RequestIdentity) => {
    if (!isCurrentIdentity(identity)) return;
    pendingOwnerInviteRef.current = null;
    if (intent === "room") {
      navigate(`/room/${room.inviteCode}`);
      return;
    }
    navigate("/workspace/personal/interviews");
  };

  const saveMetadata = async (pending: PendingMetadata) => {
    await updateMetadata({
      inviteCode: pending.room.inviteCode,
      ownerToken: pending.room.ownerToken ?? undefined,
      metadata: pending.metadata,
    }).unwrap();
  };

  const retryMetadata = async () => {
    if (!pendingMetadata || retryingMetadata) return;
    const identity = captureIdentity();
    const completed = pendingMetadata;
    setRetryingMetadata(true);
    setError("");
    try {
      await saveMetadata(completed);
      if (!isCurrentIdentity(identity)) return;
      setPendingMetadata(null);
      completeCreation(completed.room, completed.intent, identity);
    } catch {
      if (!isCurrentIdentity(identity)) return;
      setError("Интервью создано, но данные кандидата не сохранены");
    } finally {
      if (isCurrentIdentity(identity)) setRetryingMetadata(false);
    }
  };

  const addHiringManager = async () => {
    if (createState.isLoading || pickerFeedback.kind === "checking") return;
    const normalizedId = hiringManagerDraftId.trim().toLowerCase();
    if (!normalizedId) {
      setPickerFeedback({ kind: "error", message: "Введите ID нанимающего" });
      return;
    }
    if (!CANONICAL_UUID_PATTERN.test(normalizedId)) {
      setPickerFeedback({ kind: "error", message: "Введите полный UUID нанимающего" });
      return;
    }
    if (hiringManagerSelections.some((selection) => selection.normalizedId.toLowerCase() === normalizedId)) {
      setPickerFeedback({ kind: "error", message: "Этот нанимающий уже добавлен" });
      return;
    }

    const identity = captureIdentity();
    const pickerGeneration = pickerGenerationRef.current + 1;
    pickerGenerationRef.current = pickerGeneration;
    setPickerFeedback({ kind: "checking", message: "Проверяем нанимающего…" });
    const isCurrent = () => isCurrentIdentity(identity) && pickerGenerationRef.current === pickerGeneration;
    try {
      const response = await previewHiringManager({ invitationId: normalizedId }).unwrap();
      if (!isCurrent()) return;
      const responseId = response.normalizedId.toLowerCase();
      if (responseId !== normalizedId) {
        setPickerFeedback({ kind: "error", message: "Не удалось проверить нанимающего. Повторите попытку." });
        return;
      }
      setHiringManagerSelections((previous) => previous.some((selection) => selection.normalizedId.toLowerCase() === responseId)
        ? previous
        : [...previous, { normalizedId: responseId, displayName: response.displayName }]);
      setHiringManagerDraftId("");
      setPickerFeedback({ kind: "success", message: `Нанимающий добавлен: ${response.displayName}` });
    } catch (previewError) {
      if (!isCurrent()) return;
      setPickerFeedback({
        kind: "error",
        message: isNotFound(previewError)
          ? "Нанимающий не найден или недоступен"
          : "Не удалось проверить нанимающего. Повторите попытку.",
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Название интервью обязательно");
      return;
    }
    if (createState.isLoading || pendingMetadata) return;
    const identity = captureIdentity();
    const intent = intentRef.current;
    const metadataDraft: PendingMetadata["metadata"] = {
      candidateName: candidateName.trim() || null,
      position: position.trim() || null,
      scheduledAt: null,
      revision: 0,
    };
    const hiringManagerIds = hiringManagerSelections.map((selection) => selection.normalizedId);
    setError("");
    try {
      const room = await createRoom({
        title: normalizedTitle,
        taskIds,
        ...(hiringManagerIds.length > 0 ? { hiringManagerIds } : {}),
      }).unwrap();
      if (!isCurrentIdentity(identity)) return;
      persistOwnerRoom(room, auth.user?.displayName?.trim() || "Интервьюер");
      pendingOwnerInviteRef.current = room.inviteCode;
      if (metadataDraft.candidateName || metadataDraft.position) {
        const pending: PendingMetadata = {
          room,
          intent,
          metadata: metadataDraft,
        };
        try {
          await saveMetadata(pending);
          if (!isCurrentIdentity(identity)) {
            localStorage.removeItem(`owner_token_${room.inviteCode}`);
            localStorage.removeItem(`guest_display_name_${room.inviteCode}`);
            return;
          }
        } catch {
          if (!isCurrentIdentity(identity)) {
            localStorage.removeItem(`owner_token_${room.inviteCode}`);
            localStorage.removeItem(`guest_display_name_${room.inviteCode}`);
            return;
          }
          setPendingMetadata(pending);
          setError("Интервью создано, но данные кандидата не сохранены");
          return;
        }
      }
      completeCreation(room, intent, identity);
    } catch (createError) {
      if (!isCurrentIdentity(identity)) return;
      setError(apiErrorMessage(createError) ?? "Не удалось создать интервью. Повторите попытку.");
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Text className={styles.eyebrow}>Новая встреча</Text>
        <Title order={1}>Создать интервью</Title>
        <Text c="gray.5" mt={6}>Сначала зафиксируйте контекст, затем добавьте задачи из личной библиотеки.</Text>
      </div>
      <Card className={styles.panel} withBorder data-testid="create-room-card">
        <form onSubmit={submit} noValidate>
          <Stack gap="lg">
            <MultiSelect
              data-testid="room-task-select"
              label="Задачи для интервью"
              description="Можно выбрать задачи на разных языках"
              data={taskOptions}
              value={taskIds}
              onChange={setTaskIds}
              searchable
              styles={darkSelectStyles}
            />
            <div className={styles.formGrid}>
              <TextInput
                label="Название интервью"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
              <TextInput
                label="Имя кандидата"
                value={candidateName}
                onChange={(event) => setCandidateName(event.currentTarget.value)}
              />
              <TextInput
                label="Позиция"
                value={position}
                onChange={(event) => setPosition(event.currentTarget.value)}
              />
            </div>
            <Stack gap={6}>
              <Group align="flex-end" gap="sm" wrap="nowrap">
                <TextInput
                  label="ID нанимающего"
                  description="Введите ID нанимающего и нажмите «Добавить»."
                  placeholder="UUID нанимающего"
                  value={hiringManagerDraftId}
                  onChange={(event) => {
                    setHiringManagerDraftId(event.currentTarget.value);
                    if (pickerFeedback.kind !== "checking") setPickerFeedback({ kind: "idle", message: "" });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void addHiringManager();
                  }}
                  disabled={createState.isLoading || pickerFeedback.kind === "checking"}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  loading={pickerFeedback.kind === "checking"}
                  disabled={createState.isLoading || pickerFeedback.kind === "checking"}
                  onClick={() => void addHiringManager()}
                >
                  Добавить
                </Button>
              </Group>
              {pickerFeedback.kind !== "idle" ? (
                <Text
                  size="sm"
                  c={pickerFeedback.kind === "error" ? "red.4" : "gray.3"}
                  role={pickerFeedback.kind === "error" ? "alert" : "status"}
                >
                  {pickerFeedback.message}
                </Text>
              ) : null}
              {hiringManagerSelections.length > 0 ? (
                <Stack gap={6} data-testid="hiring-manager-selection-list">
                  <Title order={5}>Добавленные нанимающие</Title>
                  <Stack gap={4} role="list">
                    {hiringManagerSelections.map((selection) => (
                      <Group key={selection.normalizedId} justify="space-between" wrap="nowrap" role="listitem">
                        <Text size="sm">{selection.displayName}</Text>
                        <Button
                          type="button"
                          variant="subtle"
                          color="red"
                          size="xs"
                          aria-label={`Удалить нанимающего ${selection.displayName}`}
                          disabled={createState.isLoading}
                          onClick={() => setHiringManagerSelections((previous) => previous.filter((item) => item.normalizedId !== selection.normalizedId))}
                        >
                          Удалить
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
            </Stack>
            {selectedTasks.length > 0 ? (
              <Stack gap="xs" data-testid="selected-task-preview">
                {selectedTasks.map((task) => (
                  <Card key={task.id} className={styles.taskPreview} withBorder>
                    <Group justify="space-between" gap="sm">
                      <Text fw={700}>{task.title}</Text>
                      <Badge variant="light">{labelForLanguage(task.language)}</Badge>
                    </Group>
                    <Text size="sm" c="gray.5">{task.description}</Text>
                  </Card>
                ))}
              </Stack>
            ) : null}
            {error ? <Text role="alert" c="red.4">{error}</Text> : null}
            {createState.isLoading && !error ? (
              <Text role="alert" c="gray.4">Создаём интервью. Повторная отправка временно недоступна.</Text>
            ) : null}
            {pendingMetadata ? (
              <Card withBorder className={styles.partialCreate}>
                <Stack gap="xs">
                  <Text fw={700}>Созданная комната</Text>
                  <Text className={styles.identityValue}>{pendingMetadata.room.inviteCode}</Text>
                  <Text size="sm">
                    {pendingMetadata.intent === "list"
                      ? "После сохранения откроется список интервью"
                      : "После сохранения откроется созданное интервью"}
                  </Text>
                  <Group gap="sm">
                    <Button
                      component="a"
                      href={`/room/${pendingMetadata.room.inviteCode}`}
                      variant="subtle"
                    >
                      Открыть созданное интервью
                    </Button>
                    <Button type="button" loading={retryingMetadata} onClick={() => void retryMetadata()}>
                      Повторить сохранение
                    </Button>
                  </Group>
                </Stack>
              </Card>
            ) : null}
            <Group className={styles.formActions} justify="flex-end" wrap="wrap">
              <Button type="button" variant="subtle" onClick={() => navigate("/workspace/personal/interviews")}>Отмена</Button>
              <Button
                type="submit"
                variant="light"
                color="blue"
                disabled={createState.isLoading || Boolean(pendingMetadata)}
                onClick={() => { intentRef.current = "room"; }}
              >
                Создать и открыть комнату
              </Button>
              <Button
                type="submit"
                className={styles.primaryAction}
                color="blue"
                loading={createState.isLoading && intentRef.current === "list"}
                disabled={createState.isLoading || Boolean(pendingMetadata)}
                onClick={() => { intentRef.current = "list"; }}
              >
                Создать интервью
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}

function TaskLibrary({
  tasks,
  isLoading,
  error,
  onRetry,
}: {
  tasks: TaskTemplate[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  useListPresetsQuery(undefined);
  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [createOpened, setCreateOpened] = useState(false);
  const [importOpened, setImportOpened] = useState(false);
  const [importData, setImportData] = useState("");
  const [importError, setImportError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskCode, setTaskCode] = useState("");
  const [taskLanguage, setTaskLanguage] = useState("nodejs");
  const activeTab = searchParams.get("tab") === "sets" ? "sets" : "tasks";
  const rawSelectedLanguage = searchParams.get("language") ?? searchParams.get("lang");
  const selectedLanguage = rawSelectedLanguage ? normalizeLanguageKey(rawSelectedLanguage) : "";
  const filteredTasks = selectedLanguage
    ? tasks.filter((task) => normalizeLanguageKey(task.language) === selectedLanguage)
    : tasks;
  const taskOptions = tasks.map((task) => ({
    value: task.id,
    label: task.title,
    language: normalizeLanguageKey(task.language),
  }));

  const selectTab = (tab: "tasks" | "sets") => {
    const next = new URLSearchParams(searchParams);
    if (tab === "sets") next.set("tab", "sets");
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  };

  const submitTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    try {
      await createTask({
        title: taskTitle.trim(),
        description: taskDescription,
        starterCode: taskCode,
        language: taskLanguage,
      }).unwrap();
      setTaskTitle("");
      setTaskDescription("");
      setTaskCode("");
      setCreateOpened(false);
    } catch {
      // Mutation state keeps the modal open and exposes the retryable submit.
    }
  };

  const importTask = async (event: FormEvent) => {
    event.preventDefault();
    setImportError("");
    let transfer;
    try {
      transfer = parseLibraryTransfer(importData.trim(), "task");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Неверные данные задачи.");
      return;
    }
    if (transfer.kind !== "task") return;
    try {
      await createTask(transfer.task).unwrap();
      setImportOpened(false);
      setImportData("");
    } catch {
      setImportError("Не удалось импортировать задачу. Проверьте данные и доступ к библиотеке.");
    }
  };

  const copyTask = async (task: TaskTemplate) => {
    try {
      await navigator.clipboard.writeText(serializeTask(task));
      setCopyNotice(`Задача «${task.title}» готова к передаче. Вставьте данные через «Импортировать».`);
    } catch {
      setCopyNotice("Не удалось скопировать задачу.");
    }
  };

  return (
    <Stack gap="lg">
      <Modal opened={createOpened} onClose={() => setCreateOpened(false)} title="Создать задачу" centered>
        <form onSubmit={submitTask}>
          <Stack>
            <TextInput id="create-task-title" data-testid="create-task-title-input" label="Название" value={taskTitle} onChange={(event) => setTaskTitle(event.currentTarget.value)} required />
            <Textarea id="create-task-description" data-testid="create-task-description-input" label="Описание (Markdown, необязательно)" value={taskDescription} onChange={(event) => setTaskDescription(event.currentTarget.value)} />
            <Textarea id="create-task-code" data-testid="create-task-code-input" label="Стартовый код (необязательно)" value={taskCode} onChange={(event) => setTaskCode(event.currentTarget.value)} />
            <Select label="Язык" value={taskLanguage} onChange={(value) => setTaskLanguage(value ?? "nodejs")} data={LANGUAGE_OPTIONS} />
            <Button data-testid="create-task-submit-button" type="submit" color="blue" loading={createTaskState.isLoading}>Сохранить задачу</Button>
          </Stack>
        </form>
      </Modal>
      <Modal opened={importOpened} onClose={() => setImportOpened(false)} title="Импортировать задачу" centered size="lg">
        <form onSubmit={(event) => void importTask(event)}>
          <Stack>
            <Text size="sm" c="gray.5">Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке.</Text>
            <Textarea label="Данные задачи" value={importData} onChange={(event) => setImportData(event.currentTarget.value)} minRows={6} error={importError || undefined} />
            <Button type="submit" loading={createTaskState.isLoading} disabled={!importData.trim()}>Импортировать задачу</Button>
          </Stack>
        </form>
      </Modal>
      <div>
        <Text className={styles.eyebrow}>Переиспользуемые материалы</Text>
        <Title order={1}>Библиотека</Title>
        <Text c="gray.5" mt={6}>Задачи и готовые наборы для ваших интервью.</Text>
      </div>
      <div className={styles.libraryToolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Разделы библиотеки">
          <button type="button" role="tab" aria-selected={activeTab === "tasks"} className={activeTab === "tasks" ? styles.tabActive : styles.tab} onClick={() => selectTab("tasks")}>Задачи</button>
          <button type="button" role="tab" aria-selected={activeTab === "sets"} className={activeTab === "sets" ? styles.tabActive : styles.tab} onClick={() => selectTab("sets")}>Наборы задач</button>
        </div>
        {activeTab === "tasks" ? (
          <Group gap="xs">
            <Button data-testid="open-create-task-modal" type="button" color="blue" leftSection={<IconPlus size={17} />} onClick={() => { setTaskLanguage(selectedLanguage || "nodejs"); setCreateOpened(true); }}>
              Создать задачу
            </Button>
            <Button type="button" variant="light" onClick={() => setImportOpened(true)}>Импортировать</Button>
          </Group>
        ) : null}
      </div>
      {copyNotice ? <Text role="status" c="blue.3" size="sm">{copyNotice}</Text> : null}
      {activeTab === "tasks" ? (
        <Card className={styles.libraryListSurface} data-testid="task-bank-panel">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end">
              <label className={styles.languageControl}>
                <span>Язык задач</span>
                <select
                  aria-label="Язык задач"
                  value={selectedLanguage}
                  onChange={(event) => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("lang");
                    if (event.currentTarget.value) next.set("language", event.currentTarget.value);
                    else next.delete("language");
                    setSearchParams(next, { replace: true });
                  }}
                >
                  <option value="">Все языки</option>
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>{language.label}</option>
                  ))}
                </select>
              </label>
            </Group>
            {isLoading ? <Text>Загружаем библиотеку</Text> : null}
            {!isLoading && error ? (
              <Alert color="red" role="alert" title="Не удалось загрузить библиотеку">
                <Button type="button" size="xs" variant="light" mt="sm" onClick={onRetry}>Повторить загрузку</Button>
              </Alert>
            ) : null}
            {!isLoading && !error && tasks.length === 0 ? <Text c="gray.5">В библиотеке пока нет задач</Text> : null}
            {!isLoading && !error && tasks.length > 0 && filteredTasks.length === 0 ? (
              <Card className={styles.emptyState} withBorder>
                <Text fw={700}>Для выбранного языка задач нет</Text>
                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("language");
                    next.delete("lang");
                    setSearchParams(next, { replace: true });
                  }}
                >
                  Сбросить фильтр
                </Button>
              </Card>
            ) : null}
            {filteredTasks.map((task) => (
              <Card key={task.id} className={styles.taskPreview} withBorder>
                <Group justify="space-between" align="flex-start" gap="md">
                  <div>
                    <Text fw={700}>{task.title}</Text>
                    <Text c="gray.5" size="sm" mt={4}>{task.description}</Text>
                  </div>
                  <Group gap="xs">
                    <Badge variant="light">{labelForLanguage(task.language)}</Badge>
                    <Button type="button" size="xs" variant="light" onClick={() => void copyTask(task)}>Копировать</Button>
                  </Group>
                </Group>
              </Card>
            ))}
          </Stack>
        </Card>
      ) : <PresetsSection taskOptions={taskOptions} />}
    </Stack>
  );
}

export function ProfilePage() {
  const dispatch = useAppDispatch();
  const auth = useAppSelector((state) => state.auth);
  const [updateProfile, updateState] = useUpdateProfileMutation();
  const [displayName, setDisplayName] = useState(auth.user?.displayName ?? "");
  const [nameError, setNameError] = useState("");
  const [nameSuccess, setNameSuccess] = useState("");
  const generationRef = useRef(0);
  const identityKey = `${auth.token ?? ""}:${auth.user?.id ?? ""}`;
  const previousIdentityKeyRef = useRef(identityKey);
  const identityRef = useRef<RequestIdentity>({ token: auth.token ?? "", userId: auth.user?.id ?? "", generation: 0 });
  identityRef.current = { token: auth.token ?? "", userId: auth.user?.id ?? "", generation: generationRef.current };

  const captureIdentity = (): RequestIdentity => ({ ...identityRef.current });
  const isCurrentIdentity = (identity: RequestIdentity) => (
    identity.token.length > 0
    && localStorage.getItem("auth_token") === identity.token
    && identityRef.current.token === identity.token
    && identityRef.current.userId === identity.userId
    && identityRef.current.generation === identity.generation
  );

  React.useEffect(() => {
    if (previousIdentityKeyRef.current !== identityKey) {
      previousIdentityKeyRef.current = identityKey;
      generationRef.current += 1;
      identityRef.current = { token: auth.token ?? "", userId: auth.user?.id ?? "", generation: generationRef.current };
      setNameError("");
      setNameSuccess("");
    }
    if (auth.user) setDisplayName(auth.user.displayName);
  }, [auth.token, auth.user?.id, auth.user?.displayName, identityKey]);

  React.useEffect(() => () => { generationRef.current += 1; }, []);

  const saveDisplayName = async () => {
    if (!auth.user || !displayName.trim()) return;
    const identity = captureIdentity();
    setNameError("");
    setNameSuccess("");
    try {
      const updated = await updateProfile({ displayName: displayName.trim(), isHr: auth.user.isHr }).unwrap();
      if (!isCurrentIdentity(identity)) return;
      dispatch(updateAuthProfile({ displayName: updated.displayName, isHr: updated.isHr }));
      localStorage.setItem("display_name", updated.displayName);
      setNameSuccess("Имя сохранено");
    } catch {
      if (!isCurrentIdentity(identity)) return;
      setNameError("Не удалось сохранить имя. Повторите попытку.");
    }
  };

  const saveHiringCapability = async (isHr: boolean) => {
    if (!auth.user || !auth.token) return false;
    const identity = captureIdentity();
    const updated = await updateProfile({ displayName: auth.user.displayName, isHr }).unwrap();
    if (!isCurrentIdentity(identity)) return false;
    dispatch(updateAuthProfile({ displayName: updated.displayName, isHr: updated.isHr }));
    if (!updated.isHr) dispatch(api.util.invalidateTags(["HrInterviews", "HrManagers"]));
    return true;
  };

  return (
    <Stack gap="lg">
      <div>
        <Text className={styles.eyebrow}>Настройки аккаунта</Text>
        <Title order={1}>Профиль</Title>
        <Text c="gray.5" mt={6}>Управляйте личными возможностями отдельно от рабочих списков.</Text>
      </div>
      <Card className={styles.panel} withBorder>
        {auth.user ? (
          <Stack gap="md">
            <TextInput label="Имя для отображения" value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
            <Group justify="space-between" align="center" wrap="wrap">
              <div>
                <Text size="xs" c="gray.5">Личный ID</Text>
                <Text className={styles.identityValue}>{auth.user.id}</Text>
              </div>
              <Button type="button" variant="subtle" onClick={() => void navigator.clipboard.writeText(auth.user!.id)}>
                Скопировать личный ID
              </Button>
            </Group>
            <Group>
              <Button type="button" loading={updateState.isLoading} onClick={() => void saveDisplayName()}>Сохранить имя</Button>
              {nameError ? <Button type="button" variant="light" onClick={() => void saveDisplayName()}>Повторить сохранение</Button> : null}
            </Group>
            {nameError ? <Text role="alert" c="red.4">{nameError}</Text> : null}
            <Text aria-live="polite" c="teal.4">{nameSuccess}</Text>
            <HrProfileSection user={auth.user} isLoading={updateState.isLoading} onSave={saveHiringCapability} showIdentity={false} />
          </Stack>
        ) : <Loader />}
      </Card>
    </Stack>
  );
}

export function PersonalWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const auth = useAppSelector((state) => state.auth);
  const section = resolveSection(location.pathname);
  const roomsQuery = useMyRoomsQuery(undefined, { skip: !auth.token });
  const rooms = roomsQuery.data ?? [];
  const taskQuery = useTasksGroupedQuery(undefined, { skip: !auth.token });
  useGetHrInterviewsQuery(
    { page: 0, size: 20 },
    { skip: !auth.token || !auth.user?.isHr || section !== "candidates" },
  );
  const taskGroups = taskQuery.data ?? [];
  const tasks = useMemo(
    () => taskGroups.flatMap((group) => group.tasks.map((task) => ({ ...task, language: normalizeLanguageKey(task.language) }))),
    [taskGroups],
  );

  if (!auth.token) return <Navigate to="/login" replace />;
  if (!section) return <Navigate to="/workspace/personal/interviews" replace />;
  if (section === "candidates" && auth.user && !auth.user.isHr) {
    return <Navigate to="/workspace/personal/interviews" replace />;
  }
  const sectionTitle = section === "create"
    ? "Создать интервью"
    : section === "library"
      ? "Библиотека"
      : section === "candidates"
        ? "Кандидаты"
        : section === "profile"
          ? "Профиль"
          : "Интервью";

  return (
    <Box className={styles.page}>
      <header className={styles.header}>
        <Container size="xl" className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">IO</span>
            <div className={styles.brandText}>
              <Text className={styles.brandLabel} fw={800}>Личное пространство</Text>
              <Text size="xs" c="gray.5">Interview workspace</Text>
            </div>
          </div>
          <div className={styles.workspaceChoice}>
            <WorkspaceSwitcher />
          </div>
          <WorkspaceNavigation isHr={auth.user?.isHr === true} />
          <Group className={styles.userControls} gap="sm" wrap="nowrap">
            <NavLink to="/profile" className={styles.userName} aria-label={`Открыть профиль @${auth.user?.nickname}`}>
              <IconUserCircle size={16} aria-hidden="true" />
              @{auth.user?.nickname}
            </NavLink>
            <Button
              variant="subtle"
              onClick={() => {
                dispatch(clearAuth());
                dispatch(api.util.resetApiState());
                navigate("/");
              }}
            >
              Выйти
            </Button>
          </Group>
        </Container>
      </header>
      <main aria-label={`Личное пространство: ${sectionTitle}`}>
        <Container size="xl" className={styles.content}>
          {section === "interviews" ? (
            <InterviewList
              rooms={rooms}
              isLoading={roomsQuery.isLoading}
              isFetching={roomsQuery.isFetching}
              error={roomsQuery.error}
              onRefresh={() => { void roomsQuery.refetch(); }}
            />
          ) : null}
          {section === "create" ? <CreateInterview tasks={tasks} /> : null}
          {section === "library" ? (
            <TaskLibrary
              tasks={tasks}
              isLoading={taskQuery.isLoading}
              error={taskQuery.error}
              onRetry={() => { void taskQuery.refetch(); }}
            />
          ) : null}
          {section === "candidates" && auth.user?.isHr && auth.token ? (
            <Stack gap="lg">
              <div>
                <Text className={styles.eyebrow}>Личный подбор</Text>
                <Title order={1}>Кандидаты</Title>
                <Text c="gray.5" mt={6}>Кандидаты по вашим интервью. Один кандидат может встречаться несколько раз</Text>
              </div>
              <HrCabinetSection user={auth.user} token={auth.token} />
            </Stack>
          ) : null}
          {section === "profile" ? <ProfilePage /> : null}
        </Container>
      </main>
    </Box>
  );
}
