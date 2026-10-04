import React, { useMemo, useRef, useState, type FormEvent } from "react";
import { App, Button as AntButton, Table as AntTable, Tabs, type TableColumnsType } from "antd";
import { IconPencil, IconPlus, IconRefresh, IconTrash, IconCopy } from "components/antd-icons";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "components/antd-compat";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { useClipboardNotification } from "../../components/useClipboardNotification";
import { updateProfile as updateAuthProfile } from "../../features/auth/authSlice";
import { PersonalWorkspaceHeader } from "./PersonalWorkspaceHeader";
import { parseLibraryTransfer, serializeTask } from "../../features/workspace/libraryTransfer";
import {
  api,
  useCreateRoomMutation,
  useCreateTaskTemplateMutation,
  useUpdateTaskTemplateMutation,
  useDeleteTaskTemplateMutation,
  useDeleteRoomMutation,
  useGetHrInterviewsQuery,
  useGetInterviewMetadataQuery,
  useLazyGetInterviewMetadataQuery,
  useMyRoomsQuery,
  useTasksGroupedQuery,
  useListPresetsQuery,
  useUpdateInterviewMetadataMutation,
  useUpdateProfileMutation,
  useUpdateRoomMutation,
} from "../../services/api";
import type { HiringManagerPreviewResponse, InterviewMetadata, Room, RoomSummary, TaskTemplate } from "../../types";
import { PresetsSection } from "../dashboard/PresetsSection";
import { HrCabinetSection } from "../dashboard/HrCabinetSection";
import { HiringManagerPicker } from "../../features/hr/HiringManagerPicker";
import { HrProfileSection } from "../dashboard/HrProfileSection";
import { InterviewListDetailsAction } from "../../features/room/InterviewListDetailsAction";
import { LANGUAGE_OPTIONS } from "../dashboard/dashboardConstants";
import { darkSelectStyles } from "../dashboard/dashboardFieldStyles";
import { labelForLanguage, normalizeLanguageKey } from "../dashboard/dashboardHelpers";
import styles from "./PersonalWorkspacePage.module.css";

type WorkspaceSection = "interviews" | "create" | "library" | "candidates" | "profile";
type PendingMetadata = {
  room: Room;
  metadata: {
    candidateName: string | null;
    position: string | null;
    scheduledAt: string | null;
    revision: number;
  };
};

type RequestIdentity = { token: string; userId: string; generation: number };
type HiringManagerSelection = HiringManagerPreviewResponse;


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

type InterviewRowContextValue = {
  room: RoomSummary;
  originalTitle: string;
  candidate: string;
  dateLabel: string;
  statusLabel: string;
  displayTitle: string;
  editing: boolean;
  titleDraft: string;
  setTitleDraft: (value: string) => void;
  setEditing: (value: boolean) => void;
  saveTitle: () => Promise<void>;
  updatePending: boolean;
  actionError: string;
  deletePending: boolean;
  setDeleteOpened: (value: boolean) => void;
  deleteOpened: boolean;
  remove: () => Promise<void>;
  navigate: ReturnType<typeof useNavigate>;
};

const InterviewRowContext = React.createContext<InterviewRowContextValue | null>(null);
const InterviewTableContext = React.createContext<ReadonlyMap<string, RoomSummary>>(new Map());
const InterviewMetadataContext = React.createContext<Record<string, InterviewMetadata>>({});

function InterviewMetadataLoader({ room, onResult }: { room: RoomSummary; onResult: (id: string, data: InterviewMetadata | undefined, failed: boolean) => void }) {
  const query = useGetInterviewMetadataQuery({ inviteCode: room.inviteCode,
    ownerToken: room.ownerToken ?? undefined, interviewerToken: room.interviewerToken ?? undefined }, { skip: room.accessRole === "candidate" });
  React.useEffect(() => {
    if (query.data || query.isError) onResult(room.id, query.data, query.isError);
  }, [onResult, room.id, query.data, query.isError]);
  return null;
}

function InterviewTableRow(rowProps: Record<string, any>) {
  const rooms = React.useContext(InterviewTableContext);
  const room = rooms.get(String(rowProps["data-row-key"] ?? ""));
  return room ? <InterviewRow room={room} rowProps={rowProps} /> : <tr {...rowProps}>{rowProps.children}</tr>;
}

function useInterviewRowContext() {
  const value = React.useContext(InterviewRowContext);
  if (!value) throw new Error("Interview row content must render inside its Ant Table row");
  return value;
}

function InterviewRow({ room, rowProps }: { room: RoomSummary; rowProps: Record<string, any> }) {
  const navigate = useNavigate();
  const originalTitle = useRef(room.title);
  const metadata = React.useContext(InterviewMetadataContext)[room.id];
  const [updateRoom, updateState] = useUpdateRoomMutation();
  const [deleteRoom, deleteState] = useDeleteRoomMutation();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(room.title);
  const [displayTitle, setDisplayTitle] = useState(room.title);
  const [actionError, setActionError] = useState("");
  const [deleteOpened, setDeleteOpened] = useState(false);

  const saveTitle = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || updateState.isLoading) return;
    setActionError("");
    try {
      await updateRoom({ roomId: room.id, title: nextTitle }).unwrap();
      setDisplayTitle(nextTitle);
      setEditing(false);
    } catch {
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

  const candidate = (room.accessRole !== "candidate" ? metadata?.candidateName?.trim() : null) || "Не указан";
  const scheduledAt = room.accessRole !== "candidate" ? metadata?.scheduledAt : null;
  const dateLabel = scheduledAt
    ? new Date(scheduledAt).toLocaleDateString("ru-RU")
    : "Без даты";
  const statusLabel = room.status === "finished" ? "Завершено" : "Активно";

  const contextValue: InterviewRowContextValue = {
    room,
    originalTitle: originalTitle.current,
    candidate,
    dateLabel,
    statusLabel,
    displayTitle,
    editing,
    titleDraft,
    setTitleDraft,
    setEditing,
    saveTitle,
    updatePending: updateState.isLoading,
    actionError,
    deletePending: deleteState.isLoading,
    setDeleteOpened,
    deleteOpened,
    remove,
    navigate,
  };
  const { children, ...domRowProps } = rowProps;

  return (
    <>
      <tr {...domRowProps} aria-label={originalTitle.current}>
        <InterviewRowContext.Provider value={contextValue}>{children}</InterviewRowContext.Provider>
      </tr>
      <Modal opened={editing} onClose={() => { if (!updateState.isLoading) { setEditing(false); setActionError(""); } }} title="Переименовать интервью" centered closeOnClickOutside={!updateState.isLoading} closeOnEscape={!updateState.isLoading}>
        <form onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
          <Stack gap="md">
            <TextInput aria-label="Название интервью" placeholder="Введите название" value={titleDraft} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitleDraft(event.currentTarget.value)} disabled={updateState.isLoading} autoFocus required />
            {actionError ? <Text role="alert" c="red.4">{actionError}</Text> : null}
            <Group justify="flex-end">
              <Button type="button" variant="subtle" disabled={updateState.isLoading} onClick={() => { setEditing(false); setActionError(""); }}>Отмена</Button>
              <Button type="submit" loading={updateState.isLoading} disabled={!titleDraft.trim()}>Сохранить</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <Modal opened={deleteOpened} onClose={() => setDeleteOpened(false)} title="Удалить интервью" centered>
        <Stack>
          <Text>Интервью «{displayTitle}» будет удалено без возможности восстановления.</Text>
          <Group justify="flex-end">
            <Button type="button" variant="subtle" disabled={deleteState.isLoading} onClick={() => setDeleteOpened(false)}>Отмена</Button>
            <Button type="button" variant="light" color="red" loading={deleteState.isLoading} onClick={() => void remove()}>Удалить</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function InterviewTitleCell() {
  const row = useInterviewRowContext();
  return (
    <>
        <div className={styles.interviewTitle}>
          <Text className={styles.interviewTitleText} fw={700}>{row.displayTitle}</Text>
          {row.room.accessRole === "owner" ? (
            <AntButton
              type="text"
              className={styles.titleEditButton}
              icon={<IconPencil size={16} aria-hidden="true" />}
              aria-label={`Переименовать интервью ${row.room.title}`}
              title="Переименовать интервью"
              onClick={() => { row.setTitleDraft(row.displayTitle); row.setEditing(true); }}
            />
          ) : null}
        </div>
      {!row.editing && row.actionError ? <Text role="alert" size="xs" c="red.4">{row.actionError}</Text> : null}
    </>
  );
}

function InterviewCandidateCell() { return <>{useInterviewRowContext().candidate}</>; }
function InterviewContextCell() { return <>Без трека и вакансии</>; }
function InterviewDateCell() { return <>{useInterviewRowContext().dateLabel}</>; }
function InterviewStatusCell() { return <>{useInterviewRowContext().statusLabel}</>; }

function InterviewAccessCell() {
  const { room } = useInterviewRowContext();
  return <Badge tt="none" color={room.accessRole === "owner" ? "teal" : room.accessRole === "interviewer" ? "cyan" : "blue"} variant="light">{roomAccessLabel(room)}</Badge>;
}

function InterviewActionsCell() {
  const row = useInterviewRowContext();
  return (
    <Group className={styles.actionButtons} gap="xs" justify="flex-end" wrap="nowrap">
      {row.room.accessRole !== "candidate" ? <InterviewListDetailsAction inviteCode={row.room.inviteCode} title={row.room.title} canManage ownerToken={row.room.ownerToken ?? undefined} interviewerToken={row.room.interviewerToken ?? undefined} /> : null}
      <Button type="button" size="compact-sm" variant="light" onClick={() => row.navigate(`/room/${row.room.inviteCode}`)}>Открыть интервью</Button>
      {row.room.accessRole === "owner" ? <Button type="button" size="compact-sm" variant="light" color="red" loading={row.deletePending} aria-label={`Удалить ${row.room.title}`} title="Удалить интервью" onClick={() => row.setDeleteOpened(true)}><IconTrash size={16} aria-hidden="true" /></Button> : null}
    </Group>
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
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [metadata, setMetadata] = useState<Record<string, InterviewMetadata>>({});
  const [metadataErrors, setMetadataErrors] = useState<Record<string, boolean>>({});
  const onMetadata = React.useCallback((id: string, data: InterviewMetadata | undefined, failed: boolean) => {
    if (data) setMetadata(current => current[id] === data ? current : { ...current, [id]: data });
    setMetadataErrors(current => current[id] === failed ? current : { ...current, [id]: failed });
  }, []);
  const candidateLoading = rooms.some(room => room.accessRole !== "candidate" && !metadata[room.id] && !metadataErrors[room.id]);
  const candidateFailed = rooms.some(room => room.accessRole !== "candidate" && metadataErrors[room.id]);
  const query = search.trim().toLocaleLowerCase("ru-RU");
  const filteredRooms = rooms.filter(room => [room.title, room.accessRole !== "candidate" ? metadata[room.id]?.candidateName ?? "" : ""].some(value => value.toLocaleLowerCase("ru-RU").includes(query)));
  const roomById = useMemo(() => new Map(filteredRooms.map((room) => [room.id, room])), [filteredRooms]);
  const interviewColumns: TableColumnsType<RoomSummary> = [
    { title: "Интервью", key: "title", render: () => <InterviewTitleCell /> },
    { title: "Кандидат", key: "candidate", render: () => <InterviewCandidateCell /> },
    { title: "Контекст", key: "context", render: () => <InterviewContextCell /> },
    { title: "Дата", key: "date", render: () => <InterviewDateCell /> },
    { title: "Статус", key: "status", render: () => <InterviewStatusCell /> },
    { title: "Роль", key: "role", render: () => <InterviewAccessCell /> },
    {
      title: <span className="visually-hidden">Действие</span>,
      key: "actions",
      width: 400,
      align: "right",
      className: styles.actionCell,
      render: () => <InterviewActionsCell />,
    },
  ];

  return (
    <Stack gap="lg">
      {rooms.map(room => <InterviewMetadataLoader key={room.id} room={room} onResult={onMetadata} />)}
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
          <TextInput placeholder="Найдите интервью по названию или кандидату" className={styles.interviewSearch} label="Поиск интервью" value={search} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.currentTarget.value)} />
          <Button type="button" variant="light" leftSection={<IconRefresh size={16} />} onClick={() => { onRefresh(); dispatch(api.util.invalidateTags(["InterviewMetadata"])); }} loading={isFetching && !error}>Обновить интервью</Button>
        </Group>
      ) : null}
      {!isLoading && !error && rooms.length === 0 ? (
        <Card className={styles.emptyState} withBorder>
          <Text fw={700}>У вас пока нет интервью</Text>
          <Text c="gray.5" size="sm">Создайте первое интервью — оно появится в этом списке.</Text>
        </Card>
      ) : null}
      {search && candidateLoading ? <Text role="status" size="sm">Загружаем данные кандидатов…</Text> : null}
      {search && candidateFailed ? <Text role="alert" size="sm" c="red.4">Не все данные кандидатов загрузились. Повторите обновление списка.</Text> : null}
      {!isLoading && !candidateLoading && !candidateFailed && rooms.length > 0 && filteredRooms.length === 0 ? (
        <Card className={styles.emptyState} withBorder>
          <Text fw={700}>По вашему запросу интервью не найдены</Text>
          <Button type="button" variant="subtle" onClick={() => setSearch("")}>Сбросить поиск</Button>
        </Card>
      ) : null}
      {!isLoading && filteredRooms.length > 0 ? (
        <Card className={styles.panel} withBorder padding={0}>
          <div className={styles.tableScroll}>
            <InterviewTableContext.Provider value={roomById}>
            <InterviewMetadataContext.Provider value={metadata}>
            <AntTable<RoomSummary>
              rowKey="id"
              size="middle"
              columns={interviewColumns}
              dataSource={filteredRooms}
              pagination={false}
              components={{ body: { row: InterviewTableRow } }}
              tableLayout="fixed"
              scroll={{ x: "max-content" }}
            />
            </InterviewMetadataContext.Provider>
            </InterviewTableContext.Provider>
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
  const [title, setTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [hiringManagerSelections, setHiringManagerSelections] = useState<HiringManagerSelection[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingMetadata, setPendingMetadata] = useState<PendingMetadata | null>(null);
  const [retryingMetadata, setRetryingMetadata] = useState(false);
  const generationRef = useRef(0);
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
    if (pendingOwnerInviteRef.current) {
      localStorage.removeItem(`owner_token_${pendingOwnerInviteRef.current}`);
      localStorage.removeItem(`guest_display_name_${pendingOwnerInviteRef.current}`);
      pendingOwnerInviteRef.current = null;
    }
    setTitle("");
    setCandidateName("");
    setPosition("");
    setTaskIds([]);
    setHiringManagerSelections([]);
    setPendingMetadata(null);
    setRetryingMetadata(false);
    setError("");
  }, [auth.token, auth.user?.id, identityKey]);

  React.useEffect(() => () => {
    generationRef.current += 1;
    if (pendingOwnerInviteRef.current) {
      localStorage.removeItem(`owner_token_${pendingOwnerInviteRef.current}`);
      localStorage.removeItem(`guest_display_name_${pendingOwnerInviteRef.current}`);
    }
  }, []);

  const taskOptions = tasks.map((task) => ({
    value: task.id,
    label: `${task.title} · ${labelForLanguage(task.language)}`,
  }));
  const completeCreation = (room: Room, identity: RequestIdentity) => {
    if (!isCurrentIdentity(identity)) return;
    pendingOwnerInviteRef.current = null;
    navigate(`/room/${room.inviteCode}`);
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
      completeCreation(completed.room, identity);
    } catch {
      if (!isCurrentIdentity(identity)) return;
      setError("Интервью создано, но данные кандидата не сохранены");
    } finally {
      if (isCurrentIdentity(identity)) setRetryingMetadata(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pickerBusy || createState.isLoading) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Название интервью обязательно");
      return;
    }
    if (createState.isLoading || pendingMetadata) return;
    const identity = captureIdentity();
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
      completeCreation(room, identity);
    } catch (createError) {
      if (!isCurrentIdentity(identity)) return;
      setError(apiErrorMessage(createError) ?? "Не удалось создать интервью. Повторите попытку.");
    }
  };

  return (
    <Modal
      opened
      onClose={() => { if (!createState.isLoading && !pendingMetadata) navigate("/workspace/personal/interviews"); }}
      title={<Title order={3} style={{ margin: 0 }}>Создать интервью</Title>}
      centered
      size="xl"
      authoring
      closeOnClickOutside={!createState.isLoading && !pendingMetadata}
      closeOnEscape={!createState.isLoading && !pendingMetadata}
      withCloseButton={!createState.isLoading && !pendingMetadata}
    >
        <form onSubmit={submit} noValidate className="app-authoring-form" data-testid="create-room-card">
          <div className="app-authoring-fields">
            <section className="app-authoring-section" aria-label="Информация об интервью">
              <TextInput placeholder="Введите название интервью"
                label="Название интервью"
                value={title}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.currentTarget.value)}
              />
              <div className="app-authoring-grid">
              <TextInput placeholder="Введите имя кандидата"
                label="Имя кандидата"
                value={candidateName}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCandidateName(event.currentTarget.value)}
              />
              <TextInput placeholder="Введите название должности"
                label="Позиция"
                value={position}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPosition(event.currentTarget.value)}
              />
              </div>
            </section>
            <section className="app-authoring-section" aria-label="Задачи интервью">
              <MultiSelect placeholder="Выберите задачи в порядке интервью"
                data-testid="room-task-select"
                label="Задачи для интервью"
                data={taskOptions}
                value={taskIds}
                onChange={setTaskIds}
                searchable
                styles={darkSelectStyles}
              />
            </section>
            <section className="app-authoring-section" aria-label="Нанимающие">
              <HiringManagerPicker showSuccess={false} selectedIds={hiringManagerSelections.map(person => person.normalizedId)} disabled={createState.isLoading} onPendingChange={setPickerBusy}
                onSelect={person => setHiringManagerSelections(current => current.some(item => item.normalizedId === person.normalizedId) ? current : [...current, person])} />
              {hiringManagerSelections.length > 0 ? (
                <Stack gap={6} data-testid="hiring-manager-selection-list">
                  <Title order={5}>Добавленные нанимающие</Title>
                  <Stack gap={4} role="list">
                    {hiringManagerSelections.map((selection) => (
                      <Group key={selection.normalizedId} justify="space-between" wrap="nowrap" role="listitem">
                        <Text size="sm">{selection.displayName}</Text>
                        <Button
                          type="button"
                          variant="light"
                          color="red"
                          size="xs"
                          aria-label={`Удалить нанимающего ${selection.displayName}`}
                          disabled={createState.isLoading}
                          onClick={() => setHiringManagerSelections((previous) => previous.filter((item) => item.normalizedId !== selection.normalizedId))}
                        >
                          <IconTrash size={16} aria-hidden="true" />
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
            </section>
            {error ? <Text role="alert" c="red.4">{error}</Text> : null}
            {createState.isLoading && !error ? (
              <Text role="alert" c="gray.4">Создаём интервью. Повторная отправка временно недоступна.</Text>
            ) : null}
            {pendingMetadata ? (
              <Card withBorder className={styles.partialCreate}>
                <Stack gap="xs">
                  <Text fw={700}>Созданная комната</Text>
                  <Text className={styles.identityValue}>{pendingMetadata.room.inviteCode}</Text>
                  <Text size="sm">После сохранения данных откроется созданная комната.</Text>
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
          </div>
            <Group className="app-form-actions" justify="flex-end" wrap="wrap">
              <Button type="button" variant="subtle" disabled={createState.isLoading || Boolean(pendingMetadata)} onClick={() => navigate("/workspace/personal/interviews")}>Отмена</Button>
              <Button
                type="submit"
                className={styles.primaryAction}
                style={{ minHeight: 44 }}
                color="blue"
                loading={createState.isLoading}
                disabled={createState.isLoading || pickerBusy || Boolean(pendingMetadata)}
              >
                Создать интервью
              </Button>
            </Group>
        </form>
    </Modal>
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
  const { notification } = App.useApp();
  const auth = useAppSelector((state) => state.auth);
  const identityRef = useRef({ token: auth.token, userId: auth.user?.id });
  identityRef.current = { token: auth.token, userId: auth.user?.id };
  const mountedRef = useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [searchParams, setSearchParams] = useSearchParams();
  useListPresetsQuery(undefined);
  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [createOpened, setCreateOpened] = useState(false);
  const [importOpened, setImportOpened] = useState(false);
  const [importData, setImportData] = useState("");
  const [importError, setImportError] = useState("");
  const copyToClipboard = useClipboardNotification();
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
    const identity = { ...identityRef.current };
    try {
      await createTask(transfer.task).unwrap();
      if (!mountedRef.current || identityRef.current.token !== identity.token
        || identityRef.current.userId !== identity.userId || localStorage.getItem("auth_token") !== identity.token) return;
      setImportOpened(false);
      setImportData("");
      notification.success({ title: "Задача импортирована", placement: "top", role: "status" });
    } catch {
      setImportError("Не удалось импортировать задачу. Проверьте данные и доступ к библиотеке.");
    }
  };

  const copyTask = async (task: TaskTemplate) => {
    await copyToClipboard(serializeTask(task), {
      success: `Задача «${task.title}» готова к передаче.`,
      failure: "Разрешите доступ к буферу обмена и повторите попытку.",
    });
  };

  return (
    <Stack gap="lg">
      <Modal opened={createOpened} onClose={() => { if (!createTaskState.isLoading) setCreateOpened(false); }} title="Создать задачу" centered size="xl" authoring closeOnClickOutside={!createTaskState.isLoading} closeOnEscape={!createTaskState.isLoading}>
        <form onSubmit={submitTask} className="app-authoring-form app-task-authoring">
          <div className="app-authoring-fields">
            <section className="app-task-metadata-grid">
            <TextInput placeholder="Введите название" id="create-task-title" data-testid="create-task-title-input" label="Название" value={taskTitle} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTaskTitle(event.currentTarget.value)} required />
            <Select placeholder="Выберите язык решения" label="Язык" value={taskLanguage} onChange={(value) => setTaskLanguage(value ?? "nodejs")} data={LANGUAGE_OPTIONS} />
            </section>
            <section className="app-task-content-grid">
            <Textarea placeholder="Опишите условие, примеры и ожидаемый результат" id="create-task-description" data-testid="create-task-description-input" label="Описание (Markdown, необязательно)" minRows={6} value={taskDescription} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setTaskDescription(event.currentTarget.value)} />
            <Textarea placeholder="Добавьте заготовку решения или оставьте поле пустым" id="create-task-code" data-testid="create-task-code-input" label="Стартовый код (необязательно)" minRows={6} value={taskCode} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setTaskCode(event.currentTarget.value)} />
            </section>
            {createTaskState.error ? <Text role="alert" c="var(--app-error)">Не удалось сохранить задачу. Проверьте подключение и повторите попытку.</Text> : null}
          </div>
            <Group className="app-form-actions" justify="flex-end"><Button type="button" variant="subtle" color="gray" disabled={createTaskState.isLoading} onClick={() => setCreateOpened(false)}>Отмена</Button><Button data-testid="create-task-submit-button" type="submit" color="blue" loading={createTaskState.isLoading}>Сохранить задачу</Button></Group>
        </form>
      </Modal>
      <Modal opened={importOpened} onClose={() => { if (!createTaskState.isLoading) setImportOpened(false); }} title="Импортировать задачу" centered size="lg" closeOnClickOutside={!createTaskState.isLoading} closeOnEscape={!createTaskState.isLoading}>
        <form onSubmit={(event) => void importTask(event)}>
          <Stack>
            <Text size="sm" c="gray.5">Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке.</Text>
            <Textarea placeholder="Вставьте данные из кнопки «Копировать» у задачи" label="Данные задачи" value={importData} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setImportData(event.currentTarget.value)} minRows={6} error={importError || undefined} />
            <Group justify="flex-end"><Button type="button" variant="subtle" color="gray" disabled={createTaskState.isLoading} onClick={() => setImportOpened(false)}>Отмена</Button><Button type="submit" loading={createTaskState.isLoading} disabled={!importData.trim()}>Импортировать задачу</Button></Group>
          </Stack>
        </form>
      </Modal>
      <div>
        <Text className={styles.eyebrow}>Переиспользуемые материалы</Text>
        <Title order={1}>Библиотека</Title>
        <Text c="gray.5" mt={6}>Задачи и готовые наборы для ваших интервью.</Text>
      </div>
      <div className={styles.libraryToolbar}>
        <Tabs
          className={styles.libraryTabs}
          activeKey={activeTab}
          onChange={(key) => selectTab(key === "sets" ? "sets" : "tasks")}
          items={[
            { key: "tasks", label: "Задачи" },
            { key: "sets", label: "Наборы задач" },
          ]}
          aria-label="Разделы библиотеки"
        />
        {activeTab === "tasks" ? (
          <Group gap="xs">
            <Button data-testid="open-create-task-modal" type="button" color="blue" leftSection={<IconPlus size={17} />} onClick={() => { createTaskState.reset(); setTaskLanguage(selectedLanguage || "nodejs"); setCreateOpened(true); }}>
              Создать задачу
            </Button>
            <Button type="button" variant="light" onClick={() => setImportOpened(true)}>Импортировать</Button>
          </Group>
        ) : null}
      </div>
      {activeTab === "tasks" ? (
        <Card className={styles.libraryListSurface} withBorder={false} data-testid="task-bank-panel">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end">
              <label className={styles.languageControl}>
                <span>Язык задач</span>
                <Select
                  aria-label="Язык задач"
                  value={selectedLanguage || undefined}
                  placeholder="Все языки"
                  options={LANGUAGE_OPTIONS}
                  onChange={(value) => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("lang");
                    if (value) next.set("language", value);
                    else next.delete("language");
                    setSearchParams(next, { replace: true });
                  }}
                />
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
            {filteredTasks.map((task) => <PersonalTaskCard key={task.id} task={task} onCopy={() => void copyTask(task)} />)}
          </Stack>
        </Card>
      ) : <PresetsSection taskOptions={taskOptions} />}
    </Stack>
  );
}

function PersonalTaskCard({ task, onCopy }: { readonly task: TaskTemplate; readonly onCopy: () => void }) {
  const [updateTask, updateState] = useUpdateTaskTemplateMutation();
  const [deleteTask, deleteState] = useDeleteTaskTemplateMutation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState({ title: task.title, description: task.description ?? "", starterCode: task.starterCode ?? "", language: task.language });
  const [error, setError] = useState("");
  const beginEdit = () => {
    setDraft({ title: task.title, description: task.description ?? "", starterCode: task.starterCode ?? "", language: task.language });
    setError("");
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || updateState.isLoading) return;
    setError("");
    try {
      await updateTask({ taskId: task.id, ...draft, title: draft.title.trim() }).unwrap();
      setEditing(false);
    } catch { setError("Не удалось сохранить задачу. Повторите попытку."); }
  };
  return (
    <Card className={styles.taskPreview} withBorder role="region" aria-label={`Личная задача ${task.title}`}>
      <Group className={styles.taskRow} justify="space-between" align="center" gap="md" wrap="wrap">
        <div className={styles.taskDetails}>
          <Group gap="xs" align="center">
            <Text fw={700}>{task.title}</Text>
          </Group>
          {task.description ? <Text c="gray.5" size="sm">{task.description}</Text> : null}
          <Group gap="xs" align="center" wrap="wrap">
            <Badge variant="light">{labelForLanguage(task.language)}</Badge>
          </Group>
        </div>
        <Group className={styles.taskActions} gap="xs" align="center" wrap="wrap">
          <Button type="button" size="xs" variant="light" aria-label="Копировать" title="Копировать задачу" leftSection={<IconCopy size={16} aria-hidden="true" />} onClick={onCopy}><span className={styles.taskActionText}>Копировать</span></Button>
          <Button type="button" size="xs" variant="light" aria-label={`Редактировать задачу ${task.title}`} title="Редактировать задачу" leftSection={<IconPencil size={16} aria-hidden="true" />} onClick={beginEdit}><span className={styles.taskActionText}>Редактировать</span></Button>
          <Button type="button" size="xs" color="red" variant="light" aria-label={`Удалить задачу ${task.title}`} title="Удалить задачу" onClick={() => { setError(""); setDeleting(true); }}><IconTrash size={16} aria-hidden="true" /></Button>
        </Group>
      </Group>
      <Modal opened={editing} title="Редактировать задачу" centered size="xl" authoring onClose={() => { if (!updateState.isLoading) setEditing(false); }} closeOnEscape={!updateState.isLoading} closeOnClickOutside={!updateState.isLoading}>
        <form onSubmit={(event) => void save(event)} className="app-authoring-form app-task-authoring">
          <div className="app-authoring-fields">
            <section className="app-task-metadata-grid">
            <TextInput autoFocus label="Название задачи" placeholder="Введите название задачи" required value={draft.title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, title: event.currentTarget.value })} />
            <Select label="Язык задачи" placeholder="Выберите язык стартового кода" data={LANGUAGE_OPTIONS} value={draft.language} onChange={(language) => setDraft({ ...draft, language: language ?? "nodejs" })} />
            </section>
            <section className="app-task-content-grid">
            <Textarea label="Описание задачи" placeholder="Опишите условие, входные данные и ожидаемый результат" minRows={6} value={draft.description} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, description: event.currentTarget.value })} />
            <Textarea label="Стартовый код" placeholder="Введите стартовый код для кандидата" minRows={6} value={draft.starterCode} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, starterCode: event.currentTarget.value })} />
            </section>
            {error ? <Text c="red.4" role="alert">{error}</Text> : null}
          </div>
            <Group className="app-form-actions" justify="flex-end"><Button variant="subtle" disabled={updateState.isLoading} onClick={() => setEditing(false)}>Отмена</Button><Button type="submit" loading={updateState.isLoading} disabled={!draft.title.trim()}>Сохранить задачу</Button></Group>
        </form>
      </Modal>
      <Modal opened={deleting} title="Удалить задачу?" centered onClose={() => { if (!deleteState.isLoading) setDeleting(false); }} closeOnEscape={!deleteState.isLoading} closeOnClickOutside={!deleteState.isLoading}>
        <Stack gap="md">
          <Text>Задача исчезнет из библиотеки. В уже созданных интервью она сохранится.</Text>
          {error ? <Text c="red.4" role="alert">{error}</Text> : null}
          <Group justify="flex-end"><Button variant="subtle" disabled={deleteState.isLoading} onClick={() => setDeleting(false)}>Отмена</Button><Button color="red" variant="light" leftSection={<IconTrash size={16} aria-hidden="true" />} loading={deleteState.isLoading} onClick={async () => {
            setError("");
            try { await deleteTask({ taskId: task.id }).unwrap(); setDeleting(false); }
            catch { setError("Не удалось удалить задачу. Повторите попытку."); }
          }}>Удалить</Button></Group>
        </Stack>
      </Modal>
    </Card>
  );
}

export function ProfilePage() {
  const { notification } = App.useApp();
  const copyToClipboard = useClipboardNotification();
  const dispatch = useAppDispatch();
  const auth = useAppSelector((state) => state.auth);
  const [updateProfile, updateState] = useUpdateProfileMutation();
  const [displayName, setDisplayName] = useState(auth.user?.displayName ?? "");
  const [nameError, setNameError] = useState("");
  const [nameEditOpened, setNameEditOpened] = useState(false);
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
    && generationRef.current === identity.generation
  );

  React.useEffect(() => {
    if (previousIdentityKeyRef.current !== identityKey) {
      previousIdentityKeyRef.current = identityKey;
      generationRef.current += 1;
      identityRef.current = { token: auth.token ?? "", userId: auth.user?.id ?? "", generation: generationRef.current };
      setNameError("");
    }
    if (auth.user) setDisplayName(auth.user.displayName);
  }, [auth.token, auth.user?.id, auth.user?.displayName, identityKey]);

  React.useEffect(() => () => { generationRef.current += 1; }, []);

  const saveDisplayName = async () => {
    if (!auth.user || !displayName.trim()) return;
    const identity = captureIdentity();
    setNameError("");
    try {
      const updated = await updateProfile({ displayName: displayName.trim(), isHr: auth.user.isHr }).unwrap();
      if (!isCurrentIdentity(identity)) return;
      dispatch(updateAuthProfile({ displayName: updated.displayName, isHr: updated.isHr }));
      localStorage.setItem("display_name", updated.displayName);
      setNameEditOpened(false);
      notification.success({ title: "Имя сохранено", placement: "top", role: "status" });
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
    notification.success({ title: "Сохранено", placement: "top", role: "status" });
    return true;
  };

  return (
    <Stack gap="lg">
      <div>
        <Text className={styles.eyebrow}>Настройки аккаунта</Text>
        <Title order={1}>Профиль</Title>
        <Text c="gray.5" mt={6}>Имя, личный ID и доступ к кандидатам.</Text>
      </div>
      <Card className={`${styles.panel} ${styles.profilePanel}`} withBorder>
        {auth.user ? (
          <Stack gap="md">
            <Stack gap={4}><Text size="xs" c="gray.5">Имя для отображения</Text><Group gap="xs" align="center"><Text fw={600}>{auth.user.displayName}</Text><AntButton type="text" htmlType="button" disabled={updateState.isLoading} icon={<IconPencil size={16} aria-hidden="true" />} aria-label="Изменить имя" title="Изменить имя" onClick={() => { setDisplayName(auth.user!.displayName); setNameError(""); setNameEditOpened(true); }} /></Group></Stack>
            <Modal opened={nameEditOpened} onClose={() => { if (!updateState.isLoading) setNameEditOpened(false); }} title="Изменить имя" centered>
              <form onSubmit={(event) => { event.preventDefault(); void saveDisplayName(); }}>
                <Stack gap="md">
                  <TextInput placeholder="Введите имя для отображения" label="Имя для отображения" value={displayName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.currentTarget.value)} autoFocus disabled={updateState.isLoading} required />
                  {nameError ? <Text role="alert" c="red.4">{nameError}</Text> : null}
                  <Group justify="flex-end">
                    <Button type="button" variant="subtle" disabled={updateState.isLoading} onClick={() => setNameEditOpened(false)}>Отмена</Button>
                    <Button type="submit" loading={updateState.isLoading} disabled={!displayName.trim()}>Сохранить имя</Button>
                  </Group>
                </Stack>
              </form>
            </Modal>
            <Stack gap={4}>
              <Text size="xs" c="gray.5">Личный ID</Text>
              <Group gap="xs" align="center" wrap="wrap">
                <Text className={styles.identityValue}>{auth.user.id}</Text>
              <Button type="button" variant="subtle" aria-label="Скопировать личный ID" title="Скопировать личный ID" disabled={updateState.isLoading} onClick={() => void copyToClipboard(auth.user!.id, {
                success: "Личный ID скопирован.",
                failure: "Разрешите доступ к буферу обмена и повторите попытку.",
              })}>
                <IconCopy size={16} aria-hidden="true" />
              </Button>
              </Group>
            </Stack>
            <HrProfileSection user={auth.user} isLoading={updateState.isLoading || nameEditOpened} onSave={saveHiringCapability} showIdentity={false} />
          </Stack>
        ) : <Loader />}
      </Card>
    </Stack>
  );
}

export function PersonalWorkspacePage() {
  const location = useLocation();
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
      <PersonalWorkspaceHeader />
      <main aria-label={`Личный раздел: ${sectionTitle}`}>
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
          {section === "create" ? (
            <React.Fragment>
              <InterviewList
                rooms={rooms}
                isLoading={roomsQuery.isLoading}
                isFetching={roomsQuery.isFetching}
                error={roomsQuery.error}
                onRefresh={() => { void roomsQuery.refetch(); }}
              />
              <CreateInterview tasks={tasks} />
            </React.Fragment>
          ) : null}
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
