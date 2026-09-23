import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { IconMenu2, IconPencil, IconPlus, IconRefresh, IconUserCircle } from "@tabler/icons-react";
import { Switch } from "antd";
import { ActionIcon, Alert, Badge, Box, Button, Card, Container, Group, Loader, Menu, Modal, MultiSelect, Select, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { Navigate, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { WorkspaceSwitcher } from "../../features/workspace/WorkspaceSwitcher";
import { parseLibraryTransfer, serializeTask, serializeTaskSet } from "../../features/workspace/libraryTransfer";
import { ProfilePage } from "./PersonalWorkspacePage";
import { TeamInvitationManagement } from "../../features/workspace/TeamInvitationManagement";
import { TeamMemberDirectory } from "../../features/workspace/TeamMemberDirectory";
import { TeamManagementSettings } from "../../features/workspace/TeamManagementSettings";
import { VerdictBadge } from "../../features/room/VerdictBadge";
import { forgetCreatedTeamName, getCreatedTeamName } from "../../features/workspace/transientWorkspaceIdentity";
import { clearAuth } from "../../features/auth/authSlice";
import {
  api,
  useArchiveTeamTaskMutation,
  useArchiveTeamTaskSetMutation,
  useArchiveTeamTrackMutation,
  useArchiveTeamVacancyMutation,
  useCreateTeamInterviewMutation,
  useCreateTeamInterviewOwnerOfferMutation,
  useCreateTeamTaskSetMutation,
  useCreateTeamTaskMutation,
  useCreateTeamTrackMutation,
  useCreateTeamVacancyMutation,
  useAcceptTeamInterviewOwnerOfferMutation,
  useDeclineTeamInterviewOwnerOfferMutation,
  useArchiveTeamInterviewMutation,
  useDeleteTeamInterviewMutation,
  useRenameTeamInterviewMutation,
  useFreezeTeamInterviewMutation,
  useResumeTeamInterviewMutation,
  useGetTeamInterviewOwnerOffersQuery,
  useGetTeamTaskSetsQuery,
  useGetTeamTaskLibraryQuery,
  useGetTeamTracksQuery,
  useImportPersonalPresetToTeamMutation,
  useImportPersonalTaskToTeamMutation,
  useGetTeamInterviewsQuery,
  useGetTeamMembersQuery,
  useLazyGetTeamDetailQuery,
  useLazyGetTeamMergeRedirectQuery,
  useRestoreTeamTaskMutation,
  useDeleteTeamTaskMutation,
  useRestoreTeamTaskSetMutation,
  useDeleteTeamTaskSetMutation,
  useRestoreTeamTrackMutation,
  useDeleteTeamTrackMutation,
  useRestoreTeamVacancyMutation,
  useDeleteTeamVacancyMutation,
  useArchiveTeamTrackProgrammeMutation,
  useArchiveTeamVacancyProgrammeMutation,
  usePublishTeamTrackProgrammeMutation,
  usePublishTeamVacancyProgrammeMutation,
  useRestoreTeamTrackProgrammeMutation,
  useRestoreTeamVacancyProgrammeMutation,
  useSaveTeamTrackProgrammeDraftMutation,
  useSaveTeamVacancyProgrammeDraftMutation,
  useUpdateTeamTaskSetMutation,
  useUpdateTeamTaskMutation,
  useUpdateTeamTrackMutation,
  useUpdateTeamVacancyMutation,
} from "../../services/api";
import { LANGUAGE_OPTIONS } from "../dashboard/dashboardConstants";
import { labelForLanguage } from "../dashboard/dashboardHelpers";
import type { TeamDetail, TeamInterview, TeamInterviewAssignee, TeamInterviewListItem, TeamInterviewOwnerOfferListItem, TeamInterviewProgramme, TeamMemberDirectoryItem, TeamTaskSet, TeamTaskTemplate, TeamTrack, TeamVacancy, WorkspaceCacheScope } from "../../types";
import styles from "./TeamWorkspacePage.module.css";

type TeamSection = "interviews" | "create" | "library" | "tracks" | "members" | "settings" | "profile";
type DetailStatus = "loading" | "ready" | "unavailable";
type DetailRequest = {
  abort: () => void;
  unwrap: () => Promise<TeamDetail>;
};
type ActiveDetail = {
  contextKey: string;
  generation: number;
  reason: AuthorizationState["reason"];
  request: DetailRequest;
};
type AuthorizationState = {
  contextKey: string;
  reason: "focus" | "navigation" | "retry";
  status: DetailStatus;
  team: TeamDetail | null;
};

const EMPTY_TEAM_MEMBERS: readonly TeamMemberDirectoryItem[] = [];
const EMPTY_TEAM_TASKS: readonly TeamTaskTemplate[] = [];

function resolveSection(pathname: string, teamId: string): TeamSection | null {
  const root = `/workspace/teams/${teamId}`;
  if (pathname === `${root}/interviews`) return "interviews";
  if (pathname === `${root}/interviews/new`) return "create";
  if (pathname === `${root}/library`) return "library";
  if (pathname === `${root}/tracks`) return "tracks";
  if (pathname === `${root}/members`) return "members";
  if (pathname === `${root}/settings`) return "settings";
  if (pathname === `${root}/profile`) return "profile";
  return null;
}

function taskCountLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} задачи`;
  return `${count} задач`;
}

function DeleteEntityButton({ label, onDelete }: { readonly label: string; readonly onDelete: () => Promise<void> }) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onDelete();
      setOpened(false);
    } catch {
      setError("Не удалось удалить. Возможно, объект используется в интервью или другом материале.");
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Button type="button" size="xs" variant="subtle" color="red" aria-label={`Удалить ${label}`} onClick={() => setOpened(true)}>Удалить</Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false); }} title={`Удалить ${label}?`} centered>
      <Stack gap="md">
        <Text size="sm">Это действие нельзя отменить. Используемые в интервью или других материалах объекты удалить нельзя.</Text>
        {error ? <Alert color="red" role="alert">{error}</Alert> : null}
        <Group justify="flex-end">
          <Button type="button" variant="subtle" disabled={busy} onClick={() => setOpened(false)}>Отмена</Button>
          <Button type="button" color="red" loading={busy} onClick={() => void remove()}>Удалить</Button>
        </Group>
      </Stack>
    </Modal>
  </>;
}

function programmeOriginLabel(programme: TeamInterviewProgramme) {
  return programme.origin === "VACANCY" ? "Задачи вакансии" : "Задачи трека";
}

function programmeStatusLabel(status: TeamInterviewProgramme["status"]) {
  if (status === "DRAFT") return "Черновик";
  if (status === "ARCHIVED") return "В архиве";
  return "Применены";
}

function programmeStatusColor(status: TeamInterviewProgramme["status"]) {
  if (status === "DRAFT") return "yellow";
  if (status === "ARCHIVED") return "gray";
  return "teal";
}

function ProgrammeSummary({
  inheritedFromTrack = false,
  programme,
}: {
  readonly inheritedFromTrack?: boolean;
  readonly programme: TeamInterviewProgramme | null;
}) {
  if (!programme) return null;
  const tasks = [...programme.tasks].sort((left, right) => left.position - right.position);
  const mandatoryLabel = programme.mandatory ? "обязательные" : "дополнительные";

  return (
    <Box className={styles.programmeSummary}>
      <Group gap="xs" wrap="wrap">
        <Text size="sm" fw={700}>{programmeOriginLabel(programme)} · версия {programme.version} · {mandatoryLabel}</Text>
        <Badge variant="light" color={programmeStatusColor(programme.status)}>{programmeStatusLabel(programme.status)}</Badge>
        {inheritedFromTrack ? <Badge variant="light" color="cyan">из трека</Badge> : null}
      </Group>
      {tasks.length > 0 ? (
        <Stack gap={4} mt={8} aria-label="Задачи для интервью">
          {tasks.map((task) => (
            <Group key={`${task.position}:${task.taskId}`} className={styles.programmeTaskRow} gap="xs" wrap="wrap">
              <Text component="span" size="sm" fw={650}>{task.title}</Text>
              <Text component="span" size="xs" c="gray.5">{labelForLanguage(task.language)}</Text>
              {task.mandatory ? <Badge size="xs" variant="light" color="blue">обязательная</Badge> : null}
            </Group>
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function idempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (character) =>
    (Number(character) ^ Math.floor(Math.random() * 16) >> Number(character) / 4).toString(16));
}

function TeamNavigation({ teamId }: { teamId: string }) {
  const location = useLocation();
  const items = useMemo(() => [
    { label: "Интервью", to: `/workspace/teams/${teamId}/interviews` },
    { label: "Библиотека", to: `/workspace/teams/${teamId}/library` },
    { label: "Треки и вакансии", to: `/workspace/teams/${teamId}/tracks` },
    { label: "Участники", to: `/workspace/teams/${teamId}/members` },
    { label: "Настройки команды", to: `/workspace/teams/${teamId}/settings` },
  ], [teamId]);
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef(new Map<string, HTMLSpanElement>());
  const [visibleCount, setVisibleCount] = useState(0);
  const [overflowOpened, setOverflowOpened] = useState(false);

  useLayoutEffect(() => {
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
    <nav ref={navRef} className={styles.nav} aria-label="Разделы командного пространства">
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

function ownershipStateLabel(state: TeamInterviewListItem["ownershipState"]) {
  switch (state) {
    case "OWNER_SUSPENDED":
      return "Владелец приостановлен";
    case "OWNER_LEFT":
      return "Владелец вышел из команды";
    case "OWNER_REMOVED":
      return "Владелец удалён из команды";
    case "OWNER_MISSING":
      return "Владелец не найден";
    case "ACTIVE":
    default:
      return "Владелец активен";
  }
}

function TeamInterviewList({
  accountId,
  teamId,
  teamRole,
}: {
  readonly accountId: string;
  readonly teamId: string;
  readonly teamRole: TeamDetail["role"];
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [mineOnly, setMineOnly] = useState(false);
  const trimmedSearch = search.trim();
  const canManageOrphanedQueue = teamRole === "OWNER" || teamRole === "ADMIN";
  const {
    data,
    error,
    isFetching,
    isLoading,
    refetch: refetchInterviews,
  } = useGetTeamInterviewsQuery(
    {
      accountId,
      kind: "TEAM",
      teamId,
      query: `interviews:${trimmedSearch}`,
      q: trimmedSearch || undefined,
    },
    { skip: !accountId },
  );
  const {
    data: orphanedData,
    error: orphanedError,
    isFetching: isFetchingOrphaned,
    isLoading: isLoadingOrphaned,
    refetch: refetchOrphanedInterviews,
  } = useGetTeamInterviewsQuery(
    {
      accountId,
      kind: "TEAM",
      teamId,
      query: "interviews:orphaned",
      ownership: "orphaned",
    },
    { skip: !accountId || !canManageOrphanedQueue },
  );
  const interviews = (data?.items ?? []).filter((interview) => !mineOnly || interview.createdByUserId === accountId);
  const orphanedInterviews = orphanedData?.items ?? [];
  const {
    data: ownerOfferData,
    error: ownerOfferError,
    isFetching: isFetchingOwnerOffers,
    isLoading: isLoadingOwnerOffers,
    refetch: refetchOwnerOffers,
  } = useGetTeamInterviewOwnerOffersQuery(
    {
      accountId,
      kind: "TEAM",
      teamId,
      query: "interview-owner-offers:pending",
      status: "pending",
    },
    { skip: !accountId },
  );
  const {
    data: activeMembersData,
    error: activeMembersError,
    isFetching: isFetchingActiveMembers,
    isLoading: isLoadingActiveMembers,
  } = useGetTeamMembersQuery(
    {
      accountId,
      teamId,
      page: 0,
      size: 100,
      state: "ACTIVE",
    },
    { skip: !accountId || !canManageOrphanedQueue || orphanedInterviews.length === 0 },
  );
  const [createOwnerOffer, createOwnerOfferState] = useCreateTeamInterviewOwnerOfferMutation();
  const [acceptOwnerOffer, acceptOwnerOfferState] = useAcceptTeamInterviewOwnerOfferMutation();
  const [declineOwnerOffer, declineOwnerOfferState] = useDeclineTeamInterviewOwnerOfferMutation();
  const [archiveTeamInterview, archiveTeamInterviewState] = useArchiveTeamInterviewMutation();
  const [deleteTeamInterview] = useDeleteTeamInterviewMutation();
  const [freezeTeamInterview, freezeTeamInterviewState] = useFreezeTeamInterviewMutation();
  const [resumeTeamInterview, resumeTeamInterviewState] = useResumeTeamInterviewMutation();
  const [ownerOfferTargets, setOwnerOfferTargets] = useState<Record<string, string>>({});
  const [ownerOfferMessage, setOwnerOfferMessage] = useState("");
  const pendingOwnerOffers = ownerOfferData?.items ?? [];
  const activeMembers = activeMembersData?.items ?? [];
  const refreshInterviewOwnership = () => {
    void refetchInterviews();
    if (canManageOrphanedQueue) void refetchOrphanedInterviews();
    void refetchOwnerOffers();
  };
  const submitOwnerOffer = async (interview: TeamInterviewListItem) => {
    const targetUserId = ownerOfferTargets[interview.id];
    if (!targetUserId || createOwnerOfferState.isLoading) {
      setOwnerOfferMessage("Выберите нового владельца для предложения.");
      return;
    }
    setOwnerOfferMessage("");
    try {
      await createOwnerOffer({
        accountId,
        kind: "TEAM",
        teamId,
        query: "interview-owner-offer:create",
        interviewId: interview.id,
        targetUserId,
        idempotencyKey: idempotencyKey(),
      }).unwrap();
      setOwnerOfferMessage("Предложение отправлено выбранному участнику.");
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось отправить предложение. Проверьте, что интервью ещё без активного владельца.");
    }
  };
  const acceptIncomingOwnerOffer = async (offer: TeamInterviewOwnerOfferListItem) => {
    if (acceptOwnerOfferState.isLoading) return;
    setOwnerOfferMessage("");
    try {
      await acceptOwnerOffer({
        accountId,
        kind: "TEAM",
        teamId,
        query: "interview-owner-offer:accept",
        interviewId: offer.interviewId,
        offerId: offer.id,
      }).unwrap();
      setOwnerOfferMessage("Вы приняли владение интервью.");
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось принять предложение. Возможно, оно уже истекло или было обработано.");
    }
  };
  const declineIncomingOwnerOffer = async (offer: TeamInterviewOwnerOfferListItem) => {
    if (declineOwnerOfferState.isLoading) return;
    setOwnerOfferMessage("");
    try {
      await declineOwnerOffer({
        accountId,
        kind: "TEAM",
        teamId,
        query: "interview-owner-offer:decline",
        interviewId: offer.interviewId,
        offerId: offer.id,
      }).unwrap();
      setOwnerOfferMessage("Вы отклонили предложение владения.");
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось отклонить предложение. Возможно, оно уже истекло или было обработано.");
    }
  };
  const archiveOrphanedInterview = async (interview: TeamInterviewListItem) => {
    if (archiveTeamInterviewState.isLoading) return;
    setOwnerOfferMessage("");
    try {
      await archiveTeamInterview({
        accountId,
        kind: "TEAM",
        teamId,
        query: "team-interview:archive-orphaned",
        interviewId: interview.id,
      }).unwrap();
      setOwnerOfferMessage("Интервью архивировано без преемника.");
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось архивировать интервью. Проверьте, что оно всё ещё без активного владельца.");
    }
  };
  const freezeOrphanedInterview = async (interview: TeamInterviewListItem) => {
    if (freezeTeamInterviewState.isLoading) return;
    setOwnerOfferMessage("");
    try {
      await freezeTeamInterview({
        accountId,
        kind: "TEAM",
        teamId,
        query: "team-interview:freeze-orphaned",
        interviewId: interview.id,
      }).unwrap();
      setOwnerOfferMessage("Интервью заморожено для кандидата.");
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось заморозить интервью. Проверьте, что оно всё ещё без активного владельца.");
    }
  };
  const resumeFrozenInterview = async (interview: TeamInterviewListItem) => {
    if (resumeTeamInterviewState.isLoading) return;
    setOwnerOfferMessage("");
    try {
      await resumeTeamInterview({
        accountId,
        kind: "TEAM",
        teamId,
        query: "team-interview:resume-frozen",
        interviewId: interview.id,
      }).unwrap();
      setOwnerOfferMessage("Интервью возобновлено.");
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось возобновить интервью. Проверьте, что вы владелец или администратор команды.");
    }
  };
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          <Text className={styles.eyebrow}>Командная лента</Text>
          <Title order={1}>Интервью</Title>
          <Text c="gray.5" mt={6}>Здесь появятся только интервью, доступные вам в этой команде.</Text>
        </div>
        <Button className={styles.primaryAction} color="blue" onClick={() => navigate(`/workspace/teams/${teamId}/interviews/new`)}>
          Создать интервью
        </Button>
      </Group>
      <TeamInterviewOwnerOfferInbox
        error={ownerOfferError}
        offers={pendingOwnerOffers}
        isAccepting={acceptOwnerOfferState.isLoading}
        isDeclining={declineOwnerOfferState.isLoading}
        isLoading={isLoadingOwnerOffers || (isFetchingOwnerOffers && !ownerOfferData)}
        onAccept={acceptIncomingOwnerOffer}
        onDecline={declineIncomingOwnerOffer}
      />
      {canManageOrphanedQueue ? (
        <TeamInterviewOwnerlessQueue
          activeMembers={activeMembers}
          activeMembersError={activeMembersError}
          isActionLoading={createOwnerOfferState.isLoading || archiveTeamInterviewState.isLoading || freezeTeamInterviewState.isLoading}
          isLoadingMembers={isLoadingActiveMembers || (isFetchingActiveMembers && !activeMembersData)}
          error={orphanedError}
          interviews={orphanedInterviews}
          isLoading={isLoadingOrphaned || (isFetchingOrphaned && !orphanedData)}
          offerTargets={ownerOfferTargets}
          onArchive={archiveOrphanedInterview}
          onCreateOffer={submitOwnerOffer}
          onFreeze={freezeOrphanedInterview}
          onTargetChange={(interviewId, userId) => {
            setOwnerOfferMessage("");
            setOwnerOfferTargets((current) => ({ ...current, [interviewId]: userId }));
          }}
        />
      ) : null}
      {ownerOfferMessage ? (
        <Alert color={ownerOfferMessage.includes("Не удалось") ? "red" : "green"} role="status">
          {ownerOfferMessage}
        </Alert>
      ) : null}
      <Group align="end" gap="lg" wrap="wrap">
        <TextInput
          className={styles.interviewSearch}
          label="Поиск интервью"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Group className={styles.mineToggle} gap="sm" wrap="nowrap">
          <label htmlFor="my-team-interviews">Мои интервью</label>
          <Switch
            id="my-team-interviews"
            aria-label="Мои интервью"
            checked={mineOnly}
            onChange={setMineOnly}
          />
        </Group>
      </Group>
      {isLoading || (isFetching && !data) ? (
        <Card className={styles.emptyState} withBorder>
          <Group gap="sm">
            <Loader size="sm" />
            <Text fw={700}>Загружаем командные интервью</Text>
          </Group>
        </Card>
      ) : null}
      {error ? (
        <Alert color="red" role="alert" title="Интервью не загрузились">
          Не удалось получить список командных интервью. Обновите страницу или проверьте доступ к команде.
        </Alert>
      ) : null}
      {!isLoading && !error && interviews.length === 0 ? (
        <Card className={styles.emptyState} withBorder>
          <Text fw={700}>{trimmedSearch ? "Интервью по этому поиску не найдены" : mineOnly ? "Вы пока не создали интервью" : "Доступных командных интервью пока нет"}</Text>
          <Text c="gray.5" size="sm">
            {trimmedSearch
              ? "Попробуйте изменить запрос или очистить поиск."
              : mineOnly ? "Выключите фильтр, чтобы увидеть остальные интервью команды." : "Создайте первое интервью."}
          </Text>
        </Card>
      ) : null}
      {!error && interviews.length > 0 ? (
        <Stack gap="md" role="list" aria-label="Командные интервью">
          {interviews.map((interview) => (
            <TeamInterviewCard
              key={interview.id}
              interview={interview}
              accountId={accountId}
              teamId={teamId}
              canRename={canManageOrphanedQueue || interview.ownerUserId === accountId}
              isResuming={resumeTeamInterviewState.isLoading}
              onResume={resumeFrozenInterview}
              onDelete={canManageOrphanedQueue ? async () => {
                await deleteTeamInterview({ accountId, kind: "TEAM", teamId, query: "interviews", interviewId: interview.id }).unwrap();
                refreshInterviewOwnership();
              } : undefined}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}

function formatShortDateTime(value: string) {
  if (Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function TeamInterviewOwnerOfferInbox({
  error,
  offers,
  isAccepting,
  isDeclining,
  isLoading,
  onAccept,
  onDecline,
}: {
  readonly error: unknown;
  readonly offers: readonly TeamInterviewOwnerOfferListItem[];
  readonly isAccepting: boolean;
  readonly isDeclining: boolean;
  readonly isLoading: boolean;
  readonly onAccept: (offer: TeamInterviewOwnerOfferListItem) => void;
  readonly onDecline: (offer: TeamInterviewOwnerOfferListItem) => void;
}) {
  if (isLoading) {
    return (
      <Card className={styles.panel} withBorder role="status" aria-label="Проверяем предложения владения">
        <Group gap="sm">
          <Loader size="sm" />
          <Text fw={700}>Проверяем предложения владения интервью…</Text>
        </Group>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert color="red" role="alert" title="Предложения владения не загрузились">
        Не удалось проверить входящие предложения. Обновите страницу или проверьте доступ к команде.
      </Alert>
    );
  }

  if (offers.length === 0) return null;

  return (
    <Card className={styles.ownerOfferInbox} withBorder role="region" aria-label="Предложения владения интервью">
      <Stack gap="md">
        <Group justify="space-between" gap="sm" wrap="wrap">
          <div>
            <Text className={styles.eyebrow}>Ожидает вашего решения</Text>
            <Title order={2}>Предложения владения интервью</Title>
            <Text c="gray.5" mt={6} size="sm">
              Примите предложение, если готовы стать новым владельцем зависшего интервью.
            </Text>
          </div>
          <Badge color="cyan" variant="light">{offers.length}</Badge>
        </Group>
        <Stack gap="sm" role="list" aria-label="Список предложений владения">
          {offers.map((offer) => (
            <Box key={offer.id} className={styles.ownerOfferItem} role="listitem">
              <Group justify="space-between" gap="sm" wrap="wrap">
                <div>
                  <Text fw={800}>{offer.interviewTitle}</Text>
                  <Text c="gray.5" size="sm">Предложил: {offer.fromDisplayName}</Text>
                  {formatShortDateTime(offer.expiresAt) ? (
                    <Text c="gray.6" size="xs">Истекает: {formatShortDateTime(offer.expiresAt)}</Text>
                  ) : null}
                </div>
                <Group gap="xs" wrap="wrap">
                  <Button
                    type="button"
                    variant="light"
                    color="gray"
                    loading={isDeclining}
                    disabled={isAccepting}
                    onClick={() => onDecline(offer)}
                    aria-label={`Отклонить владение интервью ${offer.interviewTitle}`}
                  >
                    Отклонить
                  </Button>
                  <Button
                    type="button"
                    variant="light"
                    loading={isAccepting}
                    disabled={isDeclining}
                    onClick={() => onAccept(offer)}
                    aria-label={`Принять владение интервью ${offer.interviewTitle}`}
                  >
                    Принять владение
                  </Button>
                </Group>
              </Group>
            </Box>
          ))}
        </Stack>
      </Stack>
    </Card>
  );
}

function TeamInterviewOwnerlessQueue({
  activeMembers,
  activeMembersError,
  error,
  interviews,
  isActionLoading,
  isLoading,
  isLoadingMembers,
  offerTargets,
  onArchive,
  onCreateOffer,
  onFreeze,
  onTargetChange,
}: {
  readonly activeMembers: readonly TeamMemberDirectoryItem[];
  readonly activeMembersError: unknown;
  readonly error: unknown;
  readonly interviews: readonly TeamInterviewListItem[];
  readonly isActionLoading: boolean;
  readonly isLoading: boolean;
  readonly isLoadingMembers: boolean;
  readonly offerTargets: Readonly<Record<string, string>>;
  readonly onArchive: (interview: TeamInterviewListItem) => void;
  readonly onCreateOffer: (interview: TeamInterviewListItem) => void;
  readonly onFreeze: (interview: TeamInterviewListItem) => void;
  readonly onTargetChange: (interviewId: string, userId: string) => void;
}) {
  if (isLoading) {
    return (
      <Card className={styles.panel} withBorder role="status" aria-label="Проверяем интервью без владельца">
        <Group gap="sm">
          <Loader size="sm" />
          <Text fw={700}>Проверяем интервью без владельца…</Text>
        </Group>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert color="red" role="alert" title="Очередь без владельца не загрузилась">
        Не удалось проверить интервью, где владелец больше не активен. Обновите страницу или проверьте доступ к команде.
      </Alert>
    );
  }

  if (interviews.length === 0) return null;

  return (
    <Card className={styles.orphanedQueue} withBorder role="region" aria-label="Интервью без владельца">
      <Stack gap="md">
        <Group justify="space-between" gap="sm" wrap="wrap">
          <div>
            <Text className={styles.eyebrow}>Требует назначения</Text>
            <Title order={2}>Интервью без владельца</Title>
            <Text c="gray.5" mt={6} size="sm">
              Эти интервью созданы участником, который больше не активен в команде. Можно предложить нового владельца или архивировать интервью без преемника.
            </Text>
          </div>
          <Badge color="yellow" variant="light">{interviews.length}</Badge>
        </Group>
        <Stack gap="sm" role="list" aria-label="Список интервью без владельца">
          {interviews.map((interview) => {
            const ownerName = interview.ownerDisplayName ?? interview.ownerUserId ?? "неизвестен";
            const isFrozen = interview.status === "frozen";
            const options = activeMembers
              .filter((member) => member.userId !== interview.ownerUserId)
              .map((member) => ({
                value: member.userId,
                label: `${member.displayName} · ${member.role}`,
              }));
            return (
              <Box key={interview.id} className={styles.orphanedQueueItem} role="listitem">
                <Stack gap="sm">
                  <Group justify="space-between" gap="sm" wrap="wrap">
                    <div>
                      <Text fw={800}>{interview.title}</Text>
                      <Text c="gray.5" size="sm">Владелец: {ownerName}</Text>
                    </div>
                    <Group gap="xs" wrap="wrap">
                      <Badge color="yellow" variant="light">{ownershipStateLabel(interview.ownershipState)}</Badge>
                      {isFrozen ? <Badge color="orange" variant="filled">Заморожено для кандидата</Badge> : null}
                      <Badge color="gray" variant="outline">Новый владелец принимает сам</Badge>
                    </Group>
                  </Group>
                  <Group align="flex-end" gap="sm" wrap="wrap">
                    <Select
                      label="Кому предложить владение"
                      placeholder={isLoadingMembers ? "Загружаем участников…" : "Выберите участника"}
                      data={options}
                      disabled={isLoadingMembers || Boolean(activeMembersError) || options.length === 0}
                      value={offerTargets[interview.id] ?? null}
                      onChange={(value) => onTargetChange(interview.id, value ?? "")}
                      searchable
                      clearable
                    />
                    <Button
                      type="button"
                      variant="light"
                      loading={isActionLoading}
                      disabled={isLoadingMembers || Boolean(activeMembersError) || options.length === 0 || !offerTargets[interview.id]}
                      onClick={() => onCreateOffer(interview)}
                      aria-label={`Предложить владение интервью ${interview.title}`}
                    >
                      Отправить предложение
                    </Button>
                    {!isFrozen ? (
                      <Button
                        type="button"
                        variant="light"
                        color="orange"
                        loading={isActionLoading}
                        onClick={() => onFreeze(interview)}
                        aria-label={`Заморозить интервью ${interview.title}`}
                      >
                        Заморозить
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="subtle"
                      color="red"
                      loading={isActionLoading}
                      onClick={() => onArchive(interview)}
                      aria-label={`Архивировать интервью без преемника ${interview.title}`}
                    >
                      Архивировать без преемника
                    </Button>
                  </Group>
                  {activeMembersError ? (
                    <Text c="red.4" size="sm">Не удалось загрузить активных участников для выбора нового владельца.</Text>
                  ) : null}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}

function formatInterviewAssignees(
  assignees: readonly TeamInterviewAssignee[] | undefined,
  role: TeamInterviewAssignee["role"],
) {
  const names = (assignees ?? [])
    .filter((assignee) => assignee.role === role || (role === "interviewer" && assignee.role === "owner"))
    .map((assignee) => assignee.displayName);
  return names.length > 0 ? names.join(", ") : "не выбраны";
}

function TeamInterviewCard({
  interview,
  accountId,
  teamId,
  canRename,
  isResuming,
  onResume,
  onDelete,
}: {
  readonly interview: TeamInterviewListItem;
  readonly accountId: string;
  readonly teamId: string;
  readonly canRename: boolean;
  readonly isResuming: boolean;
  readonly onResume: (interview: TeamInterviewListItem) => void;
  readonly onDelete?: () => Promise<void>;
}) {
  const [linkNotice, setLinkNotice] = useState("");
  const [renameTeamInterview, renameState] = useRenameTeamInterviewMutation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(interview.title);
  const [renameError, setRenameError] = useState("");
  const saveTitle = async () => {
    const title = titleDraft.trim();
    if (!title || renameState.isLoading) {
      if (!title) setRenameError("Введите название интервью");
      return;
    }
    setRenameError("");
    try {
      await renameTeamInterview({ accountId, kind: "TEAM", teamId, query: "interviews", interviewId: interview.id, title }).unwrap();
      setEditingTitle(false);
    } catch {
      setRenameError("Не удалось переименовать интервью");
    }
  };
  const tasksLine = interview.tasks.map((task) => task.title).join(" → ");
  const currentAssignee = interview.assignees.find((assignee) => assignee.userId === accountId);
  const isFrozen = interview.status === "frozen";
  const isFinished = interview.status === "finished";
  const canOpenRoom = Boolean(currentAssignee) && (!isFrozen || currentAssignee?.role !== "candidate");
  const canResume = isFrozen && interview.ownerUserId === accountId;
  const createdAt = formatDateTime(interview.createdAt);
  const finishedAt = formatDateTime(interview.finishedAt);
  const statusLabel = isFinished ? "Завершено" : isFrozen ? "Заморожено" : "Активно";
  const statusColor = isFinished ? "gray" : isFrozen ? "orange" : "green";
  return (
    <Card
      className={styles.panel}
      withBorder
      role="region"
      aria-label={`Командное интервью ${interview.title}`}
    >
      <Stack gap="sm" role="listitem">
        <Group justify="space-between" gap="sm" wrap="wrap">
          <div>
            {editingTitle ? (
              <form onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
                <Group gap="xs" align="end" wrap="wrap">
                  <TextInput
                    label="Новое название интервью"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.currentTarget.value)}
                    autoFocus
                  />
                  <Button type="submit" size="compact-sm" loading={renameState.isLoading}>Сохранить название</Button>
                  <Button type="button" size="compact-sm" variant="subtle" color="gray" onClick={() => { setEditingTitle(false); setRenameError(""); }}>
                    Отмена
                  </Button>
                </Group>
              </form>
            ) : (
              <Group gap={6} wrap="nowrap">
                <Text fw={800}>{interview.title}</Text>
                {canRename ? (
                  <ActionIcon
                    type="button"
                    size="sm"
                    variant="subtle"
                    color="blue"
                    aria-label={`Переименовать интервью ${interview.title}`}
                    title="Переименовать интервью"
                    onClick={() => { setTitleDraft(interview.title); setRenameError(""); setEditingTitle(true); }}
                  >
                    <IconPencil size={16} aria-hidden="true" />
                  </ActionIcon>
                ) : null}
              </Group>
            )}
            {renameError ? <Text role="alert" size="xs" c="red.4">{renameError}</Text> : null}
            <Text c="gray.5" size="sm">{createdAt ? `Создано ${createdAt}` : "Командное интервью"}</Text>
          </div>
          <Group gap="xs" wrap="wrap">
            <Badge variant="light">{taskCountLabel(interview.taskCount)}</Badge>
            <Badge color={statusColor} variant={isFrozen ? "filled" : "light"}>
              {statusLabel}
            </Badge>
            {finishedAt ? <Badge variant="outline">Завершено: {finishedAt}</Badge> : null}
          </Group>
        </Group>
        <Group gap="xs" wrap="wrap">
          <Badge color={interview.trackName ? "blue" : "gray"} variant="light">
            {interview.trackName ? `Трек: ${interview.trackName}` : "Без трека"}
          </Badge>
          <Badge color={interview.vacancyTitle ? "indigo" : "gray"} variant="light">
            {interview.vacancyTitle ? `Вакансия: ${interview.vacancyTitle}` : "Без вакансии"}
          </Badge>
          {interview.taskSetRevision != null ? (
            <Badge color="gray" variant="outline">Набор rev. {interview.taskSetRevision}</Badge>
          ) : null}
          {interview.programmeVersion != null ? (
            <Badge color="blue" variant="light">Задачи по шаблону · версия {interview.programmeVersion}</Badge>
          ) : null}
        </Group>
        {tasksLine ? (
          <Text c="gray.4" size="sm">{tasksLine}</Text>
        ) : (
          <Text c="gray.5" size="sm">Задачи не добавлены</Text>
        )}
        {interview.tasks.some((task) => task.mandatory) ? (
          <Text c="blue.3" size="sm">
            Обязательная основа: {interview.tasks.filter((task) => task.mandatory).map((task) => task.title).join(" → ")}
          </Text>
        ) : null}
        <Text c="gray.5" size="sm">
          Интервьюеры: {formatInterviewAssignees(interview.assignees, "interviewer")}
        </Text>
        {isFinished ? (
          <Stack gap={6}>
            <Group gap="xs" wrap="wrap">
              {interview.verdict ? (
                <VerdictBadge verdict={interview.verdict} size="xs" />
              ) : (
                <Badge color="gray" variant="outline">Без вердикта</Badge>
              )}
              {interview.verdictComment ? <Text c="gray.4" size="sm">{interview.verdictComment}</Text> : null}
            </Group>
            {interview.taskScores.length > 0 ? (
              <Group gap="xs" wrap="wrap">
                {interview.taskScores.map((taskScore) => (
                  <Badge key={`${interview.id}-${taskScore.stepIndex}`} color={taskScore.score == null ? "gray" : "blue"} variant="light">
                    {taskScore.title}: {taskScore.score == null ? "без оценки" : taskScore.score}
                  </Badge>
                ))}
              </Group>
            ) : null}
          </Stack>
        ) : null}
        {canOpenRoom ? (
          <Group justify="flex-end">
            {currentAssignee?.role !== "candidate" && !isFrozen ? (
              <Button type="button" variant="light" size="compact-sm" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/room/${interview.inviteCode}`);
                  setLinkNotice("Ссылка для кандидата скопирована");
                } catch {
                  setLinkNotice("Не удалось скопировать ссылку");
                }
              }}>Копировать ссылку для кандидата</Button>
            ) : null}
            {canResume ? (
              <Button
                type="button"
                variant="filled"
                color="green"
                size="compact-sm"
                loading={isResuming}
                onClick={() => onResume(interview)}
                aria-label={`Возобновить интервью ${interview.title}`}
              >
                Возобновить интервью
              </Button>
            ) : null}
            <Button
              component={NavLink}
              to={`/room/${interview.inviteCode}`}
              variant="filled"
              color="blue"
              size="compact-sm"
              aria-label={`Открыть комнату ${interview.title}`}
            >
              Войти в комнату
            </Button>
            {onDelete ? <DeleteEntityButton label={`интервью ${interview.title}`} onDelete={onDelete} /> : null}
          </Group>
        ) : (
          <Group justify="space-between">
            <Text c="gray.6" size="xs">
              {isFrozen && currentAssignee?.role === "candidate"
                ? "Комната заморожена: кандидат сможет вернуться после возобновления интервью."
                : "Для управления комнатой требуется назначение интервьюером."}
            </Text>
            {onDelete ? <DeleteEntityButton label={`интервью ${interview.title}`} onDelete={onDelete} /> : null}
          </Group>
        )}
        {linkNotice ? <Text role="status" size="xs" c="blue.3">{linkNotice}</Text> : null}
      </Stack>
    </Card>
  );
}

function TeamInterviewRolePicker({
  title,
  emptyText,
  members,
  selectedIds,
  onToggle,
}: {
  readonly title: string;
  readonly emptyText: string;
  readonly members: readonly TeamMemberDirectoryItem[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (userId: string, checked: boolean) => void;
}) {
  return (
    <fieldset className={styles.assignmentGroup}>
      <legend>{title}</legend>
      <Stack gap={6}>
        {members.length === 0 ? (
          <Text size="sm" c="gray.5">{emptyText}</Text>
        ) : (
          members.map((member) => {
            const checked = selectedIds.includes(member.userId);
            return (
              <label
                key={member.userId}
                className={styles.checkboxRow}
              >
                <input
                  type="checkbox"
                  aria-label={member.displayName}
                  checked={checked}
                  onChange={(event) => onToggle(member.userId, event.currentTarget.checked)}
                />
                <span>{member.displayName}</span>
                <Badge size="xs" variant="light">{member.role}</Badge>
              </label>
            );
          })
        )}
      </Stack>
    </fieldset>
  );
}

function TeamCreateInterview({
  accountId,
  teamId,
}: {
  readonly accountId: string;
  readonly teamId: string;
}) {
  const [title, setTitle] = useState("");
  const [selectedTaskSetId, setSelectedTaskSetId] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [selectedVacancyId, setSelectedVacancyId] = useState("");
  const [selectedInterviewerIds, setSelectedInterviewerIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState("");
  const [programmeConflict, setProgrammeConflict] = useState(false);
  const [createdInterview, setCreatedInterview] = useState<TeamInterview | null>(null);
  const [createdLinkNotice, setCreatedLinkNotice] = useState("");
  const taskSetScope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: "interview-create-task-sets",
  }), [accountId, teamId]);
  const trackScope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: "interview-create-tracks",
  }), [accountId, teamId]);
  const taskScope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: "interview-create-tasks",
  }), [accountId, teamId]);
  const {
    data: taskSetData,
    error: taskSetError,
    isLoading: isTaskSetLoading,
  } = useGetTeamTaskSetsQuery(
    {
      ...taskSetScope,
      status: "active",
    },
    { skip: !accountId },
  );
  const {
    data: trackData,
    error: trackError,
    isLoading: isTrackLoading,
    refetch: refetchTracks,
  } = useGetTeamTracksQuery(
    {
      ...trackScope,
      status: "active",
    },
    { skip: !accountId },
  );
  const {
    data: taskData,
    error: taskError,
    isLoading: isTaskLoading,
  } = useGetTeamTaskLibraryQuery({ ...taskScope, status: "active" }, { skip: !accountId });
  const {
    data: memberData,
    error: memberError,
    isLoading: isMemberLoading,
  } = useGetTeamMembersQuery(
    {
      accountId,
      teamId,
      page: 0,
      size: 100,
    },
    { skip: !accountId },
  );
  const taskSets = taskSetData?.items ?? [];
  const tasks = taskData?.items ?? EMPTY_TEAM_TASKS;
  const tracks = trackData?.items ?? [];
  const members = memberData?.items ?? EMPTY_TEAM_MEMBERS;
  const otherMembers = useMemo(() => members.filter((member) => member.userId !== accountId), [accountId, members]);
  const activeMemberIds = useMemo(() => otherMembers.map((member) => member.userId), [otherMembers]);
  const selectedTaskSet = taskSets.find((taskSet) => taskSet.id === selectedTaskSetId) ?? null;
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const availableVacancies = selectedTrack?.vacancies ?? [];
  const selectedVacancy = availableVacancies.find((vacancy) => vacancy.id === selectedVacancyId) ?? null;
  const selectedProgramme = selectedVacancy?.programme ?? selectedTrack?.programme ?? null;
  const [createTeamInterview, { isLoading: isCreatingInterview }] = useCreateTeamInterviewMutation();
  const canCreateInterview = title.trim().length > 0 &&
    !isCreatingInterview && !programmeConflict && (!selectedProgramme || selectedProgramme.status === "PUBLISHED");
  const createdTrack = createdInterview?.trackId
    ? tracks.find((track) => track.id === createdInterview.trackId) ?? null
    : null;
  const createdVacancy = createdInterview?.vacancyId && createdTrack
    ? createdTrack.vacancies.find((vacancy) => vacancy.id === createdInterview.vacancyId) ?? null
    : null;

  useEffect(() => {
    if (selectedTaskSetId && !taskSets.some((taskSet) => taskSet.id === selectedTaskSetId)) {
      setSelectedTaskSetId("");
    }
  }, [selectedTaskSetId, taskSets]);

  useEffect(() => {
    if (selectedTrackId && !tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId("");
      setSelectedVacancyId("");
    }
  }, [selectedTrackId, tracks]);

  useEffect(() => {
    if (selectedVacancyId && !availableVacancies.some((vacancy) => vacancy.id === selectedVacancyId)) {
      setSelectedVacancyId("");
    }
  }, [availableVacancies, selectedVacancyId]);

  useEffect(() => {
    const allowed = new Set(activeMemberIds);
    setSelectedInterviewerIds((current) => current.filter((userId) => allowed.has(userId)));
  }, [activeMemberIds]);

  useEffect(() => {
    if (isTaskLoading) return;
    const allowed = new Set(tasks.map((task) => task.id));
    setSelectedTaskIds((current) => {
      const retained = current.filter((taskId) => allowed.has(taskId));
      return retained.length === current.length ? current : retained;
    });
  }, [isTaskLoading, tasks]);

  const toggleInterviewer = (userId: string, checked: boolean) => {
    setSelectedInterviewerIds((current) => {
      if (checked) return current.includes(userId) ? current : [...current, userId];
      return current.filter((candidate) => candidate !== userId);
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setCreateError("Укажите название интервью.");
      return;
    }
    try {
      const result = await createTeamInterview({
        accountId,
        kind: "TEAM",
        teamId,
        query: "interview-create-submit",
        title: normalizedTitle,
        taskSetId: selectedTaskSet?.id,
        taskIds: selectedTaskIds,
        trackId: selectedTrack?.id,
        vacancyId: selectedVacancy?.id,
        programmeId: selectedProgramme?.id,
        programmeVersion: selectedProgramme?.version,
        interviewerIds: selectedInterviewerIds,
        idempotencyKey: idempotencyKey(),
      }).unwrap();
      setCreateError("");
      setProgrammeConflict(false);
      setCreatedInterview(result.interview);
    } catch (error) {
      const data = typeof error === "object" && error !== null && "data" in error ? error.data : null;
      const code = typeof data === "object" && data !== null && "code" in data ? data.code : null;
      if (code === "TEAM_PROGRAMME_VERSION_CONFLICT") {
        setProgrammeConflict(true);
        setCreateError("Задачи трека или вакансии изменились. Проверьте новую версию перед созданием интервью.");
      } else {
        setCreateError("Не удалось создать интервью. Проверьте выбранные задачи, трек и доступ к команде.");
      }
    }
  };
  return (
    <Stack gap="lg">
      <div>
        <Text className={styles.eyebrow}>Командная подготовка</Text>
        <Title order={1}>Создать интервью</Title>
        <Text c="gray.5" mt={6}>Укажите контекст и, если нужно, добавьте задачи и интервьюеров.</Text>
      </div>
      <Box>
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput label="Название интервью" value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
            <Group gap="md" align="flex-start" wrap="wrap">
              <label className={styles.languageControl}>
                <span>Трек интервью</span>
                <select
                  aria-label="Трек интервью"
                  value={selectedTrackId}
                  onChange={(event) => {
                    setSelectedTrackId(event.currentTarget.value);
                    setSelectedVacancyId("");
                    setProgrammeConflict(false);
                  }}
                >
                  <option value="">Без трека</option>
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.languageControl}>
                <span>Вакансия</span>
                <select
                  aria-label="Вакансия"
                  value={selectedVacancyId}
                  onChange={(event) => {
                    setSelectedVacancyId(event.currentTarget.value);
                    setProgrammeConflict(false);
                  }}
                  disabled={!selectedTrack}
                >
                  <option value="">Без вакансии</option>
                  {availableVacancies.map((vacancy) => (
                    <option key={vacancy.id} value={vacancy.id}>
                      {vacancy.title}
                    </option>
                  ))}
                </select>
              </label>
            </Group>
            {isTrackLoading ? <Text aria-live="polite">Загружаем треки и вакансии</Text> : null}
            {!isTrackLoading && trackError ? (
              <Alert color="red" role="alert" title="Не удалось загрузить треки">
                Обновите страницу или проверьте доступ к команде.
              </Alert>
            ) : null}
            {selectedTrack ? (
              <Card
                className={styles.taskPreview}
                withBorder
                role="region"
                aria-label={`Выбранный трек ${selectedTrack.name}`}
              >
                <Stack gap="xs">
                  <Text fw={700}>{selectedTrack.name}</Text>
                  <Text c="gray.5" size="sm">
                    {selectedVacancy ? `Вакансия: ${selectedVacancy.title}` : "Вакансия: без вакансии"}
                  </Text>
                </Stack>
              </Card>
            ) : null}
            {selectedProgramme ? (
              <Card className={styles.taskPreview} withBorder role="region" aria-label="Задачи по умолчанию для интервью">
                <Stack gap="xs">
                  <Text fw={700}>
                    {selectedProgramme.origin === "VACANCY" ? "Задачи вакансии" : "Задачи трека"} · версия {selectedProgramme.version}
                  </Text>
                  <Text size="sm" c="gray.5">
                    {selectedProgramme.tasks.map((task) => task.title).join(" → ")}
                  </Text>
                  {selectedProgramme.status !== "PUBLISHED" ? (
                    <Text size="sm" c="orange">Чтобы использовать эти задачи, сначала нажмите «Применить задачи» в справочнике.</Text>
                  ) : null}
                </Stack>
              </Card>
            ) : null}
            <label className={styles.languageControl}>
              <span>Набор задач (необязательно)</span>
              <select
                aria-label="Командный набор задач"
                value={selectedTaskSetId}
                onChange={(event) => setSelectedTaskSetId(event.currentTarget.value)}
              >
                <option value="">Без набора</option>
                {taskSets.map((taskSet) => (
                  <option key={taskSet.id} value={taskSet.id}>
                    {taskSet.name}
                  </option>
                ))}
              </select>
            </label>
            {isTaskSetLoading ? <Text aria-live="polite">Загружаем командные наборы</Text> : null}
            {!isTaskSetLoading && taskSetError ? (
              <Alert color="red" role="alert" title="Не удалось загрузить наборы задач">
                Обновите страницу или проверьте доступ к команде.
              </Alert>
            ) : null}
            {!isTaskSetLoading && !taskSetError && taskSets.length === 0 ? (
              <Text size="sm" c="gray.5">
                Наборов пока нет. Выберите отдельные задачи или создайте интервью без задач.
              </Text>
            ) : null}
            {selectedTaskSet ? (
              <Card
                className={styles.taskPreview}
                withBorder
                role="region"
                aria-label={`Выбранный командный набор ${selectedTaskSet.name}`}
              >
                <Stack gap="xs">
                  <Group justify="space-between" gap="xs" wrap="wrap">
                    <Text fw={700}>{selectedTaskSet.name}</Text>
                    <Group gap="xs">
                      <Badge variant="light">{selectedTaskSet.items.length} задач</Badge>
                      <Badge variant="light">v{selectedTaskSet.revision}</Badge>
                    </Group>
                  </Group>
                  <Text c="gray.5" size="sm">
                    {selectedTaskSet.items.length > 0
                      ? selectedTaskSet.items.map((item) => item.title).join(" → ")
                      : "В наборе пока нет задач"}
                  </Text>
                </Stack>
              </Card>
            ) : null}
            <MultiSelect
              label="Отдельные задачи (необязательно)"
              description="Можно выбрать задачи без набора или добавить их к набору."
              placeholder="Выберите задачи"
              data={tasks.map((task) => ({ value: task.id, label: `${task.title} · ${labelForLanguage(task.language)}` }))}
              value={selectedTaskIds}
              onChange={setSelectedTaskIds}
              searchable
              clearable
              disabled={isTaskLoading || Boolean(taskError)}
            />
            {taskError ? <Text c="red.4" size="sm">Не удалось загрузить задачи. Интервью можно создать без них.</Text> : null}
            <Stack gap="xs">
              <Text fw={700}>Интервьюеры</Text>
              <Text c="gray.5" size="sm">Вы уже назначены владельцем интервью. Кандидат присоединится по ссылке.</Text>
              {isMemberLoading ? <Text aria-live="polite">Загружаем участников команды</Text> : null}
              {!isMemberLoading && memberError ? (
                <Alert color="orange" role="alert" title="Участники не загрузились">
                  Интервью можно создать сейчас, а коллег пригласить позже.
                </Alert>
              ) : null}
              {!memberError ? (
                <TeamInterviewRolePicker
                  title="Другие интервьюеры (необязательно)"
                  emptyText="Других участников команды пока нет."
                  members={otherMembers}
                  selectedIds={selectedInterviewerIds}
                  onToggle={toggleInterviewer}
                />
              ) : null}
            </Stack>
            {createError ? (
              <Alert color="red" role="alert" title="Интервью не создано">
                {createError}
                {programmeConflict ? (
                  <Button type="button" size="xs" variant="light" mt="sm" onClick={async () => {
                    await refetchTracks();
                    setProgrammeConflict(false);
                    setCreateError("");
                  }}>
                    Проверить обновлённые задачи
                  </Button>
                ) : null}
              </Alert>
            ) : null}
            {createdInterview ? (
              <Card
                className={styles.taskPreview}
                withBorder
                role="region"
                aria-label={`Созданное командное интервью ${createdInterview.title}`}
              >
                <Stack gap="xs">
                  <Group justify="space-between" gap="xs" wrap="wrap">
                    <Text fw={700}>{createdInterview.title}</Text>
                    <Badge variant="light">ID: {createdInterview.id}</Badge>
                  </Group>
                  <Text c="gray.5" size="sm">
                    {createdInterview.tasks.length > 0
                      ? createdInterview.tasks.map((task) => task.title).join(" → ")
                      : "Задачи пока не добавлены"}
                  </Text>
                  {createdInterview.tasks.some((task) => task.mandatory) ? (
                    <Text c="blue.3" size="sm">
                      Обязательная основа: {createdInterview.tasks.filter((task) => task.mandatory).map((task) => task.title).join(" → ")}
                    </Text>
                  ) : null}
                  <Text c="gray.5" size="sm">
                    {createdTrack ? `Трек: ${createdTrack.name}` : "Трек: без трека"}
                  </Text>
                  <Text c="gray.5" size="sm">
                    {createdVacancy ? `Вакансия: ${createdVacancy.title}` : "Вакансия: без вакансии"}
                  </Text>
                  <Text c="gray.5" size="sm">
                    Интервьюеры: {formatInterviewAssignees(createdInterview.assignees, "interviewer")}
                  </Text>
                  <Button type="button" variant="light" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${window.location.origin}/room/${createdInterview.inviteCode}`);
                      setCreatedLinkNotice("Ссылка для кандидата скопирована");
                    } catch {
                      setCreatedLinkNotice("Не удалось скопировать ссылку");
                    }
                  }}>
                    Копировать ссылку для кандидата
                  </Button>
                  {createdLinkNotice ? <Text role="status" size="xs" c="blue.3">{createdLinkNotice}</Text> : null}
                </Stack>
              </Card>
            ) : null}
            <Button type="submit" color="blue" disabled={!canCreateInterview} loading={isCreatingInterview}>
              Создать интервью
            </Button>
          </Stack>
        </form>
      </Box>
    </Stack>
  );
}

function TeamMembersSection({
  accountId,
  authToken,
  teamId,
  canManageInvitations,
}: {
  readonly accountId: string;
  readonly authToken: string;
  readonly teamId: string;
  readonly canManageInvitations: boolean;
}) {
  return (
    <Stack gap="lg">
      <div>
        <Title order={1}>Участники</Title>
        <Text c="gray.5" mt={6}>Состав команды доступен всем её активным участникам.</Text>
      </div>
      <TeamMemberDirectory accountId={accountId} teamId={teamId} />
      {canManageInvitations ? (
        <TeamInvitationManagement accountId={accountId} authToken={authToken} teamId={teamId} />
      ) : null}
    </Stack>
  );
}

function TeamTaskLibrarySection({
  accountId,
  teamId,
  team,
}: {
  readonly accountId: string;
  readonly teamId: string;
  readonly team: TeamDetail;
}) {
  const dispatch = useAppDispatch();
  type TaskEditDraft = {
    title: string;
    description: string;
    starterCode: string;
    language: string;
  };
  type TaskSetEditDraft = {
    name: string;
    taskIds: string[];
  };
  const [mode, setMode] = useState<"active" | "archived">("active");
  const [libraryTab, setLibraryTab] = useState<"tasks" | "sets">("tasks");
  const [createTaskOpened, setCreateTaskOpened] = useState(false);
  const [importTaskOpened, setImportTaskOpened] = useState(false);
  const [importPresetOpened, setImportPresetOpened] = useState(false);
  const [createSetOpened, setCreateSetOpened] = useState(false);
  const [search, setSearch] = useState("");
  const [languageFilter, setLanguageFilter] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskCode, setTaskCode] = useState("");
  const [taskLanguage, setTaskLanguage] = useState("nodejs");
  const [createError, setCreateError] = useState("");
  const [personalSourceTaskId, setPersonalSourceTaskId] = useState("");
  const [importError, setImportError] = useState("");
  const [personalSourcePresetId, setPersonalSourcePresetId] = useState("");
  const [presetImportError, setPresetImportError] = useState("");
  const [taskSetName, setTaskSetName] = useState("");
  const [taskSetTaskIds, setTaskSetTaskIds] = useState<string[]>([]);
  const [taskSetError, setTaskSetError] = useState("");
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEditDraft>>({});
  const [taskEditErrors, setTaskEditErrors] = useState<Record<string, string>>({});
  const [taskSetEdits, setTaskSetEdits] = useState<Record<string, TaskSetEditDraft>>({});
  const [taskSetEditErrors, setTaskSetEditErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const [taskSetActionError, setTaskSetActionError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const searchQuery = search.trim();
  const scope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: `library:${mode}:${languageFilter}:${searchQuery}`,
  }), [accountId, languageFilter, mode, searchQuery, teamId]);
  const { data, error, isFetching, isLoading, refetch } = useGetTeamTaskLibraryQuery(
    {
      ...scope,
      status: mode,
      language: languageFilter || undefined,
      q: searchQuery || undefined,
    },
    { skip: !accountId },
  );
  const taskSetScope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: `task-sets:${mode}`,
  }), [accountId, mode, teamId]);
  const {
    data: taskSetData,
    error: taskSetLoadError,
    isFetching: isTaskSetFetching,
    isLoading: isTaskSetLoading,
    refetch: refetchTaskSets,
  } = useGetTeamTaskSetsQuery(
    {
      ...taskSetScope,
      status: mode,
    },
    { skip: !accountId },
  );
  const [createTask, createTaskState] = useCreateTeamTaskMutation();
  const [importPersonalTask, importPersonalTaskState] = useImportPersonalTaskToTeamMutation();
  const [updateTask, updateTaskState] = useUpdateTeamTaskMutation();
  const [archiveTask, archiveTaskState] = useArchiveTeamTaskMutation();
  const [restoreTask, restoreTaskState] = useRestoreTeamTaskMutation();
  const [deleteTask] = useDeleteTeamTaskMutation();
  const [createTaskSet, createTaskSetState] = useCreateTeamTaskSetMutation();
  const [updateTeamTaskSet, updateTeamTaskSetState] = useUpdateTeamTaskSetMutation();
  const [importPersonalPresetToTeam, importPersonalPresetToTeamState] = useImportPersonalPresetToTeamMutation();
  const [archiveTeamTaskSet, archiveTeamTaskSetState] = useArchiveTeamTaskSetMutation();
  const [restoreTeamTaskSet, restoreTeamTaskSetState] = useRestoreTeamTaskSetMutation();
  const [deleteTaskSet] = useDeleteTeamTaskSetMutation();
  const tasks = data?.items ?? [];
  const counts = data?.counts;
  const taskSets = taskSetData?.items ?? [];
  const taskSetCounts = taskSetData?.counts;
  const archiveActionLoading = archiveTaskState.isLoading || restoreTaskState.isLoading;
  const taskSetActionLoading =
    updateTeamTaskSetState.isLoading ||
    importPersonalPresetToTeamState.isLoading ||
    archiveTeamTaskSetState.isLoading ||
    restoreTeamTaskSetState.isLoading;

  const submitTask = async (event: FormEvent) => {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || createTaskState.isLoading) return;
    setCreateError("");
    try {
      await createTask({
        ...scope,
        title,
        description: taskDescription,
        starterCode: taskCode,
        language: taskLanguage,
      }).unwrap();
      setTaskTitle("");
      setTaskDescription("");
      setTaskCode("");
      setTaskLanguage("nodejs");
      setCreateTaskOpened(false);
      void refetch();
    } catch {
      setCreateError("Не удалось создать командную задачу. Проверьте поля или доступ к команде.");
    }
  };

  const submitPersonalImport = async (event: FormEvent) => {
    event.preventDefault();
    const source = personalSourceTaskId.trim();
    if (!source || importPersonalTaskState.isLoading || createTaskState.isLoading) return;
    setImportError("");
    setActionError("");
    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source)) {
        await importPersonalTask({ ...scope, sourceTaskId: source }).unwrap();
      } else {
        const transfer = parseLibraryTransfer(source, "task");
        if (transfer.kind !== "task") return;
        await createTask({ ...scope, ...transfer.task }).unwrap();
      }
      setPersonalSourceTaskId("");
      setImportTaskOpened(false);
      void refetch();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Не удалось импортировать задачу. Проверьте данные и доступ к библиотеке.");
    }
  };

  const submitPersonalPresetImport = async (event: FormEvent) => {
    event.preventDefault();
    const source = personalSourcePresetId.trim();
    if (!source || importPersonalPresetToTeamState.isLoading || createTaskSetState.isLoading) return;
    setPresetImportError("");
    setTaskSetActionError("");
    try {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source)) {
        await importPersonalPresetToTeam({ ...taskSetScope, sourcePresetId: source }).unwrap();
      } else {
        const transfer = parseLibraryTransfer(source, "task-set");
        if (transfer.kind !== "task-set") return;
        const taskIds: string[] = [];
        for (const task of transfer.tasks) {
          const created = await createTask({ ...scope, ...task }).unwrap();
          taskIds.push(created.task.id);
        }
        await createTaskSet({ ...taskSetScope, name: transfer.name, taskIds }).unwrap();
      }
      setPersonalSourcePresetId("");
      setImportPresetOpened(false);
      setLibraryTab("sets");
      void refetch();
      void refetchTaskSets();
    } catch (error) {
      setPresetImportError(error instanceof Error ? error.message : "Не удалось импортировать набор. Проверьте данные и доступ к библиотеке.");
    }
  };

  const submitTaskSet = async (event: FormEvent) => {
    event.preventDefault();
    const name = taskSetName.trim();
    if (!name || taskSetTaskIds.length === 0 || createTaskSetState.isLoading) return;
    setTaskSetError("");
    setTaskSetActionError("");
    try {
      await createTaskSet({
        ...taskSetScope,
        name,
        taskIds: taskSetTaskIds,
      }).unwrap();
      setTaskSetName("");
      setTaskSetTaskIds([]);
      setCreateSetOpened(false);
      setLibraryTab("sets");
      void refetchTaskSets();
    } catch {
      setTaskSetError("Не удалось создать набор. Проверьте название, задачи или доступ к команде.");
    }
  };

  const toggleTaskSetTask = (taskId: string, checked: boolean) => {
    setTaskSetTaskIds((current) => {
      if (checked) return current.includes(taskId) ? current : [...current, taskId];
      return current.filter((candidate) => candidate !== taskId);
    });
    if (taskSetError) setTaskSetError("");
  };

  const startTaskEdit = (task: TeamTaskTemplate) => {
    setTaskEdits((current) => ({
      ...current,
      [task.id]: {
        title: task.title,
        description: task.description,
        starterCode: task.starterCode,
        language: task.language,
      },
    }));
  };

  const cancelTaskEdit = (taskId: string) => {
    setTaskEdits((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    setTaskEditErrors((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  };

  const submitTaskEdit = async (event: FormEvent, task: TeamTaskTemplate) => {
    event.preventDefault();
    const draft = taskEdits[task.id];
    const title = draft?.title.trim() ?? "";
    if (!draft || !title || updateTaskState.isLoading) return;
    setTaskEditErrors((current) => ({ ...current, [task.id]: "" }));
    setActionError("");
    try {
      await updateTask({
        ...scope,
        taskId: task.id,
        title,
        description: draft.description,
        starterCode: draft.starterCode,
        language: draft.language,
        revision: task.revision,
      }).unwrap();
      cancelTaskEdit(task.id);
      void refetch();
    } catch {
      setTaskEditErrors((current) => ({
        ...current,
        [task.id]: "Не удалось сохранить задачу. Обновите список и попробуйте ещё раз.",
      }));
    }
  };

  const toggleTaskArchive = async (task: TeamTaskTemplate) => {
    if (archiveActionLoading) return;
    setActionError("");
    try {
      if (mode === "active") {
        await archiveTask({ ...scope, taskId: task.id }).unwrap();
      } else {
        await restoreTask({ ...scope, taskId: task.id }).unwrap();
      }
      void refetch();
    } catch {
      setActionError(mode === "active" ? "Не удалось архивировать задачу." : "Не удалось восстановить задачу.");
    }
  };

  const copyExistingTask = async (task: TeamTaskTemplate) => {
    if (task.status !== "ACTIVE") return;
    setActionError("");
    setCopyNotice("");
    try {
      await navigator.clipboard.writeText(serializeTask(task));
      setCopyNotice(`Задача «${task.title}» готова к передаче. Вставьте данные через «Импортировать».`);
    } catch {
      setActionError("Не удалось скопировать задачу.");
    }
  };

  const copyExistingTaskSet = async (taskSet: TeamTaskSet) => {
    if (taskSet.status !== "ACTIVE") return;
    setTaskSetActionError("");
    setCopyNotice("");
    try {
      const library = await dispatch(api.endpoints.getTeamTaskLibrary.initiate({
        ...scope,
        query: "copy-active-set",
        status: "active",
      }, { subscribe: false, forceRefetch: true })).unwrap();
      const byId = new Map(library.items.map((task) => [task.id, task]));
      const ordered = taskSet.items.map((item) => byId.get(item.taskId));
      if (ordered.some((task) => !task)) {
        setTaskSetActionError("Не удалось скопировать набор: одна из задач архивирована или недоступна.");
        return;
      }
      await navigator.clipboard.writeText(serializeTaskSet(taskSet.name, ordered as TeamTaskTemplate[]));
      setCopyNotice(`Набор «${taskSet.name}» готов к передаче. Вставьте данные через «Импортировать».`);
    } catch {
      setTaskSetActionError("Не удалось скопировать набор.");
    }
  };

  const startTaskSetEdit = (taskSet: TeamTaskSet) => {
    setTaskSetEdits((current) => ({
      ...current,
      [taskSet.id]: {
        name: taskSet.name,
        taskIds: taskSet.items.map((item) => item.taskId),
      },
    }));
    setTaskSetEditErrors((current) => {
      const next = { ...current };
      delete next[taskSet.id];
      return next;
    });
  };

  const cancelTaskSetEdit = (taskSetId: string) => {
    setTaskSetEdits((current) => {
      const next = { ...current };
      delete next[taskSetId];
      return next;
    });
    setTaskSetEditErrors((current) => {
      const next = { ...current };
      delete next[taskSetId];
      return next;
    });
  };

  const updateTaskSetDraft = (taskSetId: string, updater: (draft: TaskSetEditDraft) => TaskSetEditDraft) => {
    setTaskSetEdits((current) => {
      const draft = current[taskSetId];
      if (!draft) return current;
      return { ...current, [taskSetId]: updater(draft) };
    });
    if (taskSetEditErrors[taskSetId]) {
      setTaskSetEditErrors((current) => ({ ...current, [taskSetId]: "" }));
    }
  };

  const toggleTaskSetEditTask = (taskSetId: string, taskId: string, checked: boolean) => {
    updateTaskSetDraft(taskSetId, (draft) => {
      if (checked) {
        return draft.taskIds.includes(taskId) ? draft : { ...draft, taskIds: [...draft.taskIds, taskId] };
      }
      return { ...draft, taskIds: draft.taskIds.filter((candidate) => candidate !== taskId) };
    });
  };

  const moveTaskSetEditTask = (taskSetId: string, taskId: string, direction: -1 | 1) => {
    updateTaskSetDraft(taskSetId, (draft) => {
      const index = draft.taskIds.indexOf(taskId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= draft.taskIds.length) return draft;
      const nextTaskIds = [...draft.taskIds];
      [nextTaskIds[index], nextTaskIds[targetIndex]] = [nextTaskIds[targetIndex], nextTaskIds[index]];
      return { ...draft, taskIds: nextTaskIds };
    });
  };

  const submitTaskSetEdit = async (event: FormEvent, taskSet: TeamTaskSet) => {
    event.preventDefault();
    const draft = taskSetEdits[taskSet.id];
    const name = draft?.name.trim() ?? "";
    if (!draft || !name || draft.taskIds.length === 0 || updateTeamTaskSetState.isLoading) return;
    setTaskSetEditErrors((current) => ({ ...current, [taskSet.id]: "" }));
    setTaskSetActionError("");
    try {
      await updateTeamTaskSet({
        ...taskSetScope,
        setId: taskSet.id,
        name,
        taskIds: draft.taskIds,
        revision: taskSet.revision,
      }).unwrap();
      cancelTaskSetEdit(taskSet.id);
      void refetchTaskSets();
    } catch {
      setTaskSetEditErrors((current) => ({
        ...current,
        [taskSet.id]: "Не удалось сохранить набор. Обновите список и попробуйте ещё раз.",
      }));
    }
  };

  const toggleTaskSetArchive = async (taskSet: TeamTaskSet) => {
    if (taskSetActionLoading) return;
    setTaskSetActionError("");
    try {
      if (mode === "active") {
        await archiveTeamTaskSet({ ...taskSetScope, setId: taskSet.id }).unwrap();
      } else {
        await restoreTeamTaskSet({ ...taskSetScope, setId: taskSet.id }).unwrap();
      }
      void refetchTaskSets();
    } catch {
      setTaskSetActionError(mode === "active" ? "Не удалось архивировать набор." : "Не удалось восстановить набор.");
    }
  };

  const emptyTitle = searchQuery || languageFilter ? "Ничего не найдено" : "В библиотеке команды пока нет задач";
  const renderTask = (task: TeamTaskTemplate) => (
    <Card
      key={task.id}
      className={styles.taskPreview}
      withBorder
      role="region"
      aria-label={`Командная задача ${task.title}`}
    >
      {task.id in taskEdits ? (
        <Box component="form" onSubmit={(event) => void submitTaskEdit(event, task)}>
          <Stack gap="sm">
            <TextInput
              label="Новое название задачи"
              value={taskEdits[task.id]?.title ?? ""}
              onChange={(event) => {
                setTaskEdits((current) => ({
                  ...current,
                  [task.id]: { ...current[task.id], title: event.currentTarget.value },
                }));
                if (taskEditErrors[task.id]) setTaskEditErrors((current) => ({ ...current, [task.id]: "" }));
              }}
              error={taskEditErrors[task.id] || undefined}
            />
            <Textarea
              label="Новое описание задачи"
              value={taskEdits[task.id]?.description ?? ""}
              onChange={(event) => setTaskEdits((current) => ({
                ...current,
                [task.id]: { ...current[task.id], description: event.currentTarget.value },
              }))}
              minRows={3}
            />
            <Textarea
              label="Новый стартовый код"
              value={taskEdits[task.id]?.starterCode ?? ""}
              onChange={(event) => setTaskEdits((current) => ({
                ...current,
                [task.id]: { ...current[task.id], starterCode: event.currentTarget.value },
              }))}
              minRows={3}
            />
            <Select
              label="Новый язык задачи"
              value={taskEdits[task.id]?.language ?? "nodejs"}
              onChange={(value) => setTaskEdits((current) => ({
                ...current,
                [task.id]: { ...current[task.id], language: value ?? "nodejs" },
              }))}
              data={LANGUAGE_OPTIONS}
            />
            <Group justify="flex-end">
              <Button type="button" variant="subtle" onClick={() => cancelTaskEdit(task.id)}>Отмена</Button>
              <Button type="submit" loading={updateTaskState.isLoading} disabled={!(taskEdits[task.id]?.title ?? "").trim()}>
                Сохранить задачу
              </Button>
            </Group>
          </Stack>
        </Box>
      ) : (
        <Group justify="space-between" align="flex-start" gap="md">
          <div>
            <Text fw={700}>{task.title}</Text>
            {task.description ? <Text c="gray.5" size="sm" mt={4}>{task.description}</Text> : null}
            <Text size="xs" c="gray.5" mt={6}>Автор: {task.createdByUserId.slice(0, 8)}</Text>
          </div>
          <Group gap="xs" justify="flex-end">
            <Badge variant="light">{labelForLanguage(task.language)}</Badge>
            <Badge variant="light" color={task.status === "ACTIVE" ? "teal" : "gray"}>{task.status}</Badge>
            {mode === "active" ? (
              <Button
                type="button"
                size="xs"
                variant="light"
                aria-label={`Скопировать задачу ${task.title}`}
                onClick={() => void copyExistingTask(task)}
              >
                Копировать
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="light"
              aria-label={`Переименовать задачу ${task.title}`}
              onClick={() => startTaskEdit(task)}
            >
              Редактировать
            </Button>
            <Button
              type="button"
              size="xs"
              variant="subtle"
              color={mode === "active" ? "orange" : "green"}
              aria-label={`${mode === "active" ? "Архивировать" : "Восстановить"} задачу ${task.title}`}
              loading={archiveActionLoading}
              onClick={() => void toggleTaskArchive(task)}
            >
              {mode === "active" ? "В архив" : "Восстановить"}
            </Button>
            {(team.role === "OWNER" || team.role === "ADMIN" || task.createdByUserId === accountId) ? (
              <DeleteEntityButton label={`задачу ${task.title}`} onDelete={async () => {
                await deleteTask({ ...scope, taskId: task.id }).unwrap();
                void refetch();
              }} />
            ) : null}
          </Group>
        </Group>
      )}
    </Card>
  );

  const taskTitleInSet = (taskSet: TeamTaskSet, taskId: string) =>
    taskSet.items.find((item) => item.taskId === taskId)?.title ??
    tasks.find((task) => task.id === taskId)?.title ??
    "Задача";

  const renderTaskSet = (taskSet: TeamTaskSet) => (
    <Card
      key={taskSet.id}
      className={styles.taskPreview}
      withBorder
      role="region"
      aria-label={`Командный набор ${taskSet.name}`}
    >
      {taskSet.id in taskSetEdits ? (
        <Box component="form" onSubmit={(event) => void submitTaskSetEdit(event, taskSet)}>
          <Stack gap="sm">
            <TextInput
              label="Новое название набора"
              value={taskSetEdits[taskSet.id]?.name ?? ""}
              onChange={(event) => updateTaskSetDraft(taskSet.id, (draft) => ({
                ...draft,
                name: event.currentTarget.value,
              }))}
              error={taskSetEditErrors[taskSet.id] || undefined}
            />
            <Stack gap="xs" role="list" aria-label={`Порядок задач набора ${taskSet.name}`}>
              <Text fw={700} size="sm">Порядок задач</Text>
              {(taskSetEdits[taskSet.id]?.taskIds ?? []).length === 0 ? (
                <Text size="sm" c="orange.3">Выберите хотя бы одну задачу.</Text>
              ) : null}
              {(taskSetEdits[taskSet.id]?.taskIds ?? []).map((taskId, index, orderedIds) => {
                const title = taskTitleInSet(taskSet, taskId);
                return (
                  <Group key={taskId} className={styles.taskSetOrderRow} role="listitem" justify="space-between" gap="xs" wrap="wrap">
                    <Text size="sm">{index + 1}. {title}</Text>
                    <Group gap="xs">
                      <Button
                        type="button"
                        size="xs"
                        variant="light"
                        aria-label={`Поднять задачу ${title} в наборе ${taskSet.name}`}
                        disabled={index === 0}
                        onClick={() => moveTaskSetEditTask(taskSet.id, taskId, -1)}
                      >
                        Выше
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="light"
                        aria-label={`Опустить задачу ${title} в наборе ${taskSet.name}`}
                        disabled={index === orderedIds.length - 1}
                        onClick={() => moveTaskSetEditTask(taskSet.id, taskId, 1)}
                      >
                        Ниже
                      </Button>
                    </Group>
                  </Group>
                );
              })}
            </Stack>
            <Stack gap="xs">
              <Text fw={700} size="sm">Состав набора</Text>
              {tasks.map((task) => (
                <label key={task.id} className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    aria-label={`Задача набора: ${task.title}`}
                    checked={(taskSetEdits[taskSet.id]?.taskIds ?? []).includes(task.id)}
                    onChange={(event) => toggleTaskSetEditTask(taskSet.id, task.id, event.currentTarget.checked)}
                  />
                  <span>{task.title}</span>
                </label>
              ))}
            </Stack>
            <Group justify="flex-end">
              <Button type="button" variant="subtle" onClick={() => cancelTaskSetEdit(taskSet.id)}>Отмена</Button>
              <Button
                type="submit"
                loading={updateTeamTaskSetState.isLoading}
                disabled={
                  !(taskSetEdits[taskSet.id]?.name ?? "").trim() ||
                  (taskSetEdits[taskSet.id]?.taskIds ?? []).length === 0
                }
              >
                Сохранить набор
              </Button>
            </Group>
          </Stack>
        </Box>
      ) : (
        <Group justify="space-between" align="flex-start" gap="md">
          <div>
            <Text fw={700}>{taskSet.name}</Text>
            <Text c="gray.5" size="sm" mt={4}>
              {taskSet.items.length > 0
                ? taskSet.items.map((item) => item.title).join(" → ")
                : "В наборе пока нет задач"}
            </Text>
            <Text size="xs" c="gray.5" mt={6}>
              Автор: {taskSet.createdByUserId.slice(0, 8)} · v{taskSet.revision}
            </Text>
          </div>
          <Group gap="xs" justify="flex-end">
            <Badge variant="light">{taskSet.items.length} задач</Badge>
            <Badge variant="light" color={taskSet.status === "ACTIVE" ? "teal" : "gray"}>
              {taskSet.status}
            </Badge>
            {mode === "active" ? (
              <Button
                type="button"
                size="xs"
                variant="light"
                aria-label={`Скопировать набор ${taskSet.name}`}
                disabled={taskSetActionLoading}
                onClick={() => void copyExistingTaskSet(taskSet)}
              >
                Копировать
              </Button>
            ) : null}
            {mode === "active" ? (
              <Button
                type="button"
                size="xs"
                variant="light"
                aria-label={`Редактировать набор ${taskSet.name}`}
                disabled={taskSetActionLoading}
                onClick={() => startTaskSetEdit(taskSet)}
              >
                Редактировать
              </Button>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="subtle"
              color={mode === "active" ? "orange" : "green"}
              aria-label={`${mode === "active" ? "Архивировать" : "Восстановить"} набор ${taskSet.name}`}
              loading={archiveTeamTaskSetState.isLoading || restoreTeamTaskSetState.isLoading}
              disabled={taskSetActionLoading}
              onClick={() => void toggleTaskSetArchive(taskSet)}
            >
              {mode === "active" ? "В архив" : "Восстановить"}
            </Button>
            {(team.role === "OWNER" || team.role === "ADMIN" || taskSet.createdByUserId === accountId) ? (
              <DeleteEntityButton label={`набор ${taskSet.name}`} onDelete={async () => {
                await deleteTaskSet({ ...scope, setId: taskSet.id }).unwrap();
                void refetchTaskSets();
              }} />
            ) : null}
          </Group>
        </Group>
      )}
    </Card>
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          <Text className={styles.eyebrow}>Командные материалы</Text>
          <Title order={1}>Библиотека</Title>
          <Text c="gray.5" mt={6}>Задачи команды хранятся отдельно от личной библиотеки и доступны активным участникам.</Text>
        </div>
        <Button type="button" variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void refetch()} loading={isFetching && !isLoading}>
          Обновить
        </Button>
      </Group>

      <div className={styles.libraryToolbar}>
        <Group className={styles.libraryTabGroup} role="tablist" aria-label="Содержимое библиотеки" gap="xs" wrap="nowrap">
          <Button className={libraryTab === "tasks" ? styles.libraryTabSelected : styles.libraryTab} type="button" role="tab" aria-selected={libraryTab === "tasks"} variant="default" onClick={() => setLibraryTab("tasks")}>Задачи</Button>
          <Button className={libraryTab === "sets" ? styles.libraryTabSelected : styles.libraryTab} type="button" role="tab" aria-selected={libraryTab === "sets"} variant="default" onClick={() => setLibraryTab("sets")}>Наборы задач</Button>
        </Group>

        <Group className={styles.libraryTabGroup} role="tablist" aria-label="Фильтр задач" gap="xs" wrap="nowrap">
          <Button
            className={mode === "active" ? styles.libraryTabSelected : styles.libraryTab}
            type="button"
            role="tab"
            aria-selected={mode === "active"}
            variant="default"
            onClick={() => {
              setMode("active");
              setActionError("");
            }}
          >
            Активные
          </Button>
          <Button
            className={mode === "archived" ? styles.libraryTabSelected : styles.libraryTab}
            type="button"
            role="tab"
            aria-selected={mode === "archived"}
            variant="default"
            onClick={() => {
              setMode("archived");
              setActionError("");
            }}
          >
            Архив
          </Button>
        </Group>

        {libraryTab === "tasks" ? (
          <TextInput
            aria-label="Поиск задач"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Поиск задач"
            className={styles.librarySearch}
          />
        ) : null}

        {mode === "active" ? (
          <Group className={styles.libraryActions} gap="xs" wrap="nowrap">
            {libraryTab === "tasks" ? (
              <>
                <Button type="button" color="blue" leftSection={<IconPlus size={17} />} onClick={() => setCreateTaskOpened(true)}>Создать задачу</Button>
                <Button type="button" variant="light" onClick={() => setImportTaskOpened(true)}>Импортировать</Button>
              </>
            ) : (
              <>
                <Button type="button" color="blue" leftSection={<IconPlus size={17} />} onClick={() => setCreateSetOpened(true)}>Создать набор</Button>
                <Button type="button" variant="light" onClick={() => setImportPresetOpened(true)}>Импортировать</Button>
              </>
            )}
          </Group>
        ) : null}
      </div>

      {copyNotice ? <Text role="status" c="blue.3" size="sm">{copyNotice}</Text> : null}

          <Modal opened={createTaskOpened} onClose={() => setCreateTaskOpened(false)} title="Новая командная задача" centered size="lg">
            <form onSubmit={submitTask}>
              <Stack gap="sm">
                <Text fw={700}>Новая командная задача</Text>
                <TextInput
                  label="Название задачи"
                  value={taskTitle}
                  onChange={(event) => {
                    setTaskTitle(event.currentTarget.value);
                    if (createError) setCreateError("");
                  }}
                  placeholder="Например, Binary tree traversal"
                  error={createError || undefined}
                />
                <Textarea
                  label="Описание задачи"
                  value={taskDescription}
                  onChange={(event) => setTaskDescription(event.currentTarget.value)}
                  minRows={3}
                />
                <Textarea
                  label="Стартовый код"
                  value={taskCode}
                  onChange={(event) => setTaskCode(event.currentTarget.value)}
                  minRows={3}
                />
                <Select
                  label="Язык задачи"
                  value={taskLanguage}
                  onChange={(value) => setTaskLanguage(value ?? "nodejs")}
                  data={LANGUAGE_OPTIONS}
                />
                <Group justify="flex-end">
                  <Button type="submit" color="blue" loading={createTaskState.isLoading} disabled={!taskTitle.trim()}>
                    Создать задачу
                  </Button>
                </Group>
              </Stack>
            </form>
          </Modal>
          <Modal opened={importTaskOpened} onClose={() => setImportTaskOpened(false)} title="Импортировать задачу" centered size="lg">
            <form onSubmit={submitPersonalImport}>
              <Stack gap="sm">
                <Text c="gray.5" size="sm">
                  Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке. Можно также указать ID своей личной задачи.
                </Text>
                <Textarea
                  label="Данные задачи или ID личной задачи"
                  value={personalSourceTaskId}
                  onChange={(event) => {
                    setPersonalSourceTaskId(event.currentTarget.value);
                    if (importError) setImportError("");
                  }}
                  minRows={5}
                  error={importError || undefined}
                />
                <Group justify="flex-end">
                  <Button type="submit" loading={importPersonalTaskState.isLoading || createTaskState.isLoading} disabled={!personalSourceTaskId.trim()}>
                    Импортировать задачу
                  </Button>
                </Group>
              </Stack>
            </form>
          </Modal>
          <Modal opened={importPresetOpened} onClose={() => setImportPresetOpened(false)} title="Импортировать набор" centered size="lg">
            <form onSubmit={submitPersonalPresetImport}>
              <Stack gap="sm">
                <Text c="gray.5" size="sm">
                  Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке. Можно также указать ID своего личного набора.
                </Text>
                <Textarea
                  label="Данные набора или ID личного набора"
                  value={personalSourcePresetId}
                  onChange={(event) => {
                    setPersonalSourcePresetId(event.currentTarget.value);
                    if (presetImportError) setPresetImportError("");
                  }}
                  minRows={6}
                  error={presetImportError || undefined}
                />
                <Group justify="flex-end">
                  <Button
                    type="submit"
                    loading={importPersonalPresetToTeamState.isLoading || createTaskSetState.isLoading}
                    disabled={!personalSourcePresetId.trim()}
                  >
                    Импортировать набор
                  </Button>
                </Group>
              </Stack>
            </form>
          </Modal>
          <Modal opened={createSetOpened} onClose={() => setCreateSetOpened(false)} title="Новый командный набор" centered size="lg">
            <form onSubmit={submitTaskSet}>
              <Stack gap="sm">
                <Text fw={700}>Новый командный набор</Text>
                <Text c="gray.5" size="sm">
                  Соберите несколько командных задач в порядок, который потом можно будет быстро выбрать при подготовке интервью.
                </Text>
                <TextInput
                  label="Название набора"
                  value={taskSetName}
                  onChange={(event) => {
                    setTaskSetName(event.currentTarget.value);
                    if (taskSetError) setTaskSetError("");
                  }}
                  placeholder="Например, Backend screening"
                  error={taskSetError || undefined}
                />
                <Stack gap={6}>
                  <Text size="sm" fw={600}>Задачи набора</Text>
                  {tasks.length === 0 ? (
                    <Text size="sm" c="gray.5">Сначала создайте или скопируйте командные задачи.</Text>
                  ) : (
                    tasks.map((task) => (
                      <label key={task.id} className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={taskSetTaskIds.includes(task.id)}
                          onChange={(event) => toggleTaskSetTask(task.id, event.currentTarget.checked)}
                        />
                        <span>{task.title}</span>
                      </label>
                    ))
                  )}
                </Stack>
                <Group justify="flex-end">
                  <Button
                    type="submit"
                    color="blue"
                    loading={createTaskSetState.isLoading}
                    disabled={!taskSetName.trim() || taskSetTaskIds.length === 0}
                  >
                    Создать набор
                  </Button>
                </Group>
              </Stack>
            </form>
          </Modal>

      {libraryTab === "tasks" && actionError ? (
        <Alert color="red" role="alert" title="Действие не выполнено">
          {actionError}
        </Alert>
      ) : null}

      {libraryTab === "tasks" ? <Card className={styles.libraryListSurface}>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
            <label className={styles.languageControl}>
              <span>Язык задач</span>
              <select
                aria-label="Фильтр языка задач"
                value={languageFilter}
                onChange={(event) => setLanguageFilter(event.currentTarget.value)}
              >
                <option value="">Все языки</option>
                {LANGUAGE_OPTIONS.map((language) => (
                  <option key={language.value} value={language.value}>{language.label}</option>
                ))}
              </select>
            </label>
          </Group>
          {counts ? (
            <Text size="sm" c="gray.5">
              Активные задачи: {counts.activeTasks} · Архив: {counts.archivedTasks}
            </Text>
          ) : null}
          {isLoading ? <Text aria-live="polite">Загружаем библиотеку</Text> : null}
          {!isLoading && error ? (
            <Alert color="red" role="alert" title="Не удалось загрузить библиотеку">
              <Button type="button" size="xs" variant="light" mt="sm" onClick={() => void refetch()}>Повторить</Button>
            </Alert>
          ) : null}
          {!isLoading && !error && tasks.length === 0 ? (
            <Card className={styles.emptyState} withBorder>
              <Text fw={700}>{emptyTitle}</Text>
              <Text c="gray.5" size="sm">
                {searchQuery || languageFilter
                  ? "Попробуйте изменить поиск или фильтр языка."
                  : "Создайте первую задачу команды — она не появится в личной библиотеке участников."}
              </Text>
            </Card>
          ) : null}
          {!isLoading && !error && tasks.length > 0 ? (
            <Stack gap="sm">{tasks.map(renderTask)}</Stack>
          ) : null}
        </Stack>
      </Card> : null}

      {libraryTab === "sets" && taskSetActionError ? (
        <Alert color="red" role="alert" title="Действие с набором не выполнено">
          {taskSetActionError}
        </Alert>
      ) : null}

      {libraryTab === "sets" ? <Card className={styles.libraryListSurface}>
        <Stack gap="sm">
          <Group justify="space-between" align="center" gap="md" wrap="wrap">
            <div>
              <Text fw={700}>Наборы задач</Text>
              <Text c="gray.5" size="sm">Переиспользуемые подборки командных задач для будущих интервью.</Text>
            </div>
            <Button type="button" variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void refetchTaskSets()} loading={isTaskSetFetching && !isTaskSetLoading}>
              Обновить наборы
            </Button>
          </Group>
          {taskSetCounts ? (
            <Text size="sm" c="gray.5">
              Активные наборы: {taskSetCounts.activeSets} · Архив: {taskSetCounts.archivedSets}
            </Text>
          ) : null}
          {isTaskSetLoading ? <Text aria-live="polite">Загружаем наборы</Text> : null}
          {!isTaskSetLoading && taskSetLoadError ? (
            <Alert color="red" role="alert" title="Не удалось загрузить наборы">
              <Button type="button" size="xs" variant="light" mt="sm" onClick={() => void refetchTaskSets()}>Повторить</Button>
            </Alert>
          ) : null}
          {!isTaskSetLoading && !taskSetLoadError && taskSets.length === 0 ? (
            <Card className={styles.emptyState} withBorder>
              <Text fw={700}>{mode === "active" ? "Наборов пока нет" : "Архив наборов пуст"}</Text>
              <Text c="gray.5" size="sm">
                {mode === "active"
                  ? "Выберите задачи выше и создайте первый командный набор."
                  : "Здесь появятся архивированные наборы, которые можно восстановить вручную."}
              </Text>
            </Card>
          ) : null}
          {!isTaskSetLoading && !taskSetLoadError && taskSets.length > 0 ? (
            <Stack gap="sm">{taskSets.map(renderTaskSet)}</Stack>
          ) : null}
        </Stack>
      </Card> : null}
    </Stack>
  );
}

function TeamTracksSection({
  accountId,
  team,
  teamId,
}: {
  readonly accountId: string;
  readonly team: TeamDetail;
  readonly teamId: string;
}) {
  type ProgrammeTargetKind = "track" | "vacancy";
  const [mode, setMode] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const searchQuery = search.trim();
  const scope = useMemo(
    () => ({ accountId, kind: "TEAM" as const, teamId, query: `tracks:${mode}:${searchQuery}` }),
    [accountId, mode, searchQuery, teamId],
  );
  const canManage = team.role === "OWNER" || team.role === "ADMIN";
  const { data, error, isFetching, isLoading, refetch } = useGetTeamTracksQuery(
    { ...scope, status: mode, q: searchQuery || undefined },
    { skip: !accountId },
  );
  const programmeLibraryScope = useMemo(
    () => ({ accountId, kind: "TEAM" as const, teamId, query: "tracks:programme-tasks" }),
    [accountId, teamId],
  );
  const {
    data: programmeTaskData,
    error: programmeTaskError,
    isLoading: isProgrammeTaskLoading,
    refetch: refetchProgrammeTasks,
  } = useGetTeamTaskLibraryQuery(
    { ...programmeLibraryScope, status: "active" },
    { skip: !accountId || !canManage },
  );
  const [createTrack, createTrackState] = useCreateTeamTrackMutation();
  const [createVacancy, createVacancyState] = useCreateTeamVacancyMutation();
  const [updateTrack, updateTrackState] = useUpdateTeamTrackMutation();
  const [archiveTrack, archiveTrackState] = useArchiveTeamTrackMutation();
  const [restoreTrack, restoreTrackState] = useRestoreTeamTrackMutation();
  const [deleteTrack] = useDeleteTeamTrackMutation();
  const [updateVacancy, updateVacancyState] = useUpdateTeamVacancyMutation();
  const [archiveVacancy, archiveVacancyState] = useArchiveTeamVacancyMutation();
  const [restoreVacancy, restoreVacancyState] = useRestoreTeamVacancyMutation();
  const [deleteVacancy] = useDeleteTeamVacancyMutation();
  const [saveTrackProgrammeDraft, saveTrackProgrammeDraftState] = useSaveTeamTrackProgrammeDraftMutation();
  const [publishTrackProgramme, publishTrackProgrammeState] = usePublishTeamTrackProgrammeMutation();
  const [archiveTrackProgramme, archiveTrackProgrammeState] = useArchiveTeamTrackProgrammeMutation();
  const [restoreTrackProgramme, restoreTrackProgrammeState] = useRestoreTeamTrackProgrammeMutation();
  const [saveVacancyProgrammeDraft, saveVacancyProgrammeDraftState] = useSaveTeamVacancyProgrammeDraftMutation();
  const [publishVacancyProgramme, publishVacancyProgrammeState] = usePublishTeamVacancyProgrammeMutation();
  const [archiveVacancyProgramme, archiveVacancyProgrammeState] = useArchiveTeamVacancyProgrammeMutation();
  const [restoreVacancyProgramme, restoreVacancyProgrammeState] = useRestoreTeamVacancyProgrammeMutation();
  const [trackName, setTrackName] = useState("");
  const [trackError, setTrackError] = useState("");
  const [trackCreateOpened, setTrackCreateOpened] = useState(false);
  const [vacancyCreateOpened, setVacancyCreateOpened] = useState(false);
  const [vacancyCreateTrackId, setVacancyCreateTrackId] = useState<string | null>(null);
  const [trackEdits, setTrackEdits] = useState<Record<string, string>>({});
  const [trackEditErrors, setTrackEditErrors] = useState<Record<string, string>>({});
  const [vacancyDrafts, setVacancyDrafts] = useState<Record<string, string>>({});
  const [vacancyErrors, setVacancyErrors] = useState<Record<string, string>>({});
  const [vacancyEdits, setVacancyEdits] = useState<Record<string, string>>({});
  const [vacancyEditErrors, setVacancyEditErrors] = useState<Record<string, string>>({});
  const [programmeEdits, setProgrammeEdits] = useState<Record<string, string[]>>({});
  const [programmeErrors, setProgrammeErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState("");
  const tracks = data?.items ?? [];
  const archivedTracks = tracks.filter((track) => track.status === "ARCHIVED");
  const archivedVacancies = tracks
    .filter((track) => track.status === "ACTIVE")
    .flatMap((track) => track.vacancies
      .filter((vacancy) => vacancy.status === "ARCHIVED")
      .map((vacancy) => ({ track, vacancy })));
  const vacancyCreateTrack = tracks.find((track) => track.id === vacancyCreateTrackId);
  const counts = data?.counts;
  const programmeTasks = programmeTaskData?.items ?? [];
  const archiveActionLoading =
    archiveTrackState.isLoading ||
    restoreTrackState.isLoading ||
    archiveVacancyState.isLoading ||
    restoreVacancyState.isLoading;
  const programmeActionLoading =
    saveTrackProgrammeDraftState.isLoading ||
    publishTrackProgrammeState.isLoading ||
    archiveTrackProgrammeState.isLoading ||
    restoreTrackProgrammeState.isLoading ||
    saveVacancyProgrammeDraftState.isLoading ||
    publishVacancyProgrammeState.isLoading ||
    archiveVacancyProgrammeState.isLoading ||
    restoreVacancyProgrammeState.isLoading;

  const submitTrack = async (event: FormEvent) => {
    event.preventDefault();
    const name = trackName.trim();
    if (!name || createTrackState.isLoading) return;
    setTrackError("");
    try {
      await createTrack({ ...scope, name }).unwrap();
      setTrackName("");
      setTrackCreateOpened(false);
      void refetch();
    } catch {
      setTrackError("Не удалось создать трек. Проверьте название или права доступа.");
    }
  };

  const submitTrackEdit = async (event: FormEvent, track: TeamTrack) => {
    event.preventDefault();
    const name = (trackEdits[track.id] ?? "").trim();
    if (!name || updateTrackState.isLoading) return;
    setTrackEditErrors((current) => ({ ...current, [track.id]: "" }));
    setActionError("");
    try {
      await updateTrack({ ...scope, trackId: track.id, name, revision: track.revision, status: mode }).unwrap();
      setTrackEdits((current) => {
        const next = { ...current };
        delete next[track.id];
        return next;
      });
      void refetch();
    } catch {
      setTrackEditErrors((current) => ({
        ...current,
        [track.id]: "Не удалось сохранить трек. Проверьте название или обновите страницу.",
      }));
    }
  };

  const submitVacancy = async (event: FormEvent, track: TeamTrack) => {
    event.preventDefault();
    const title = (vacancyDrafts[track.id] ?? "").trim();
    if (!title || createVacancyState.isLoading) return;
    setVacancyErrors((current) => ({ ...current, [track.id]: "" }));
    try {
      await createVacancy({ ...scope, trackId: track.id, title }).unwrap();
      setVacancyDrafts((current) => ({ ...current, [track.id]: "" }));
      setVacancyCreateTrackId(null);
      setVacancyCreateOpened(false);
      void refetch();
    } catch {
      setVacancyErrors((current) => ({
        ...current,
        [track.id]: "Не удалось добавить вакансию. Проверьте название или права доступа.",
      }));
    }
  };

  const submitVacancyEdit = async (event: FormEvent, track: TeamTrack, vacancy: TeamVacancy) => {
    event.preventDefault();
    const title = (vacancyEdits[vacancy.id] ?? "").trim();
    if (!title || updateVacancyState.isLoading) return;
    setVacancyEditErrors((current) => ({ ...current, [vacancy.id]: "" }));
    setActionError("");
    try {
      await updateVacancy({
        ...scope,
        trackId: track.id,
        vacancyId: vacancy.id,
        title,
        revision: vacancy.revision,
        status: mode,
      }).unwrap();
      setVacancyEdits((current) => {
        const next = { ...current };
        delete next[vacancy.id];
        return next;
      });
      void refetch();
    } catch {
      setVacancyEditErrors((current) => ({
        ...current,
        [vacancy.id]: "Не удалось сохранить вакансию. Проверьте название или обновите страницу.",
      }));
    }
  };

  const toggleTrackArchive = async (track: TeamTrack) => {
    if (archiveActionLoading) return;
    setActionError("");
    try {
      if (mode === "active") {
        await archiveTrack({ ...scope, trackId: track.id }).unwrap();
      } else {
        await restoreTrack({ ...scope, trackId: track.id }).unwrap();
      }
      void refetch();
    } catch {
      setActionError(mode === "active" ? "Не удалось архивировать трек." : "Не удалось восстановить трек.");
    }
  };

  const toggleVacancyArchive = async (track: TeamTrack, vacancy: TeamVacancy) => {
    if (archiveActionLoading) return;
    setActionError("");
    try {
      if (mode === "active") {
        await archiveVacancy({ ...scope, trackId: track.id, vacancyId: vacancy.id }).unwrap();
      } else {
        await restoreVacancy({ ...scope, trackId: track.id, vacancyId: vacancy.id }).unwrap();
      }
      void refetch();
    } catch {
      setActionError(mode === "active" ? "Не удалось архивировать вакансию." : "Не удалось восстановить вакансию.");
    }
  };

  const programmeKey = (kind: ProgrammeTargetKind, trackId: string, vacancyId?: string) =>
    kind === "track" ? `track:${trackId}` : `vacancy:${trackId}:${vacancyId ?? ""}`;

  const programmeTaskIds = (programme: TeamInterviewProgramme | null, inherited = false) => {
    if (!programme || inherited) return [];
    return [...programme.tasks]
      .sort((left, right) => left.position - right.position)
      .map((task) => task.taskId);
  };

  const startProgrammeEdit = (key: string, programme: TeamInterviewProgramme | null, inherited = false) => {
    setProgrammeEdits((current) => ({
      ...current,
      [key]: programmeTaskIds(programme, inherited),
    }));
    setProgrammeErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    void refetchProgrammeTasks();
  };

  const cancelProgrammeEdit = (key: string) => {
    setProgrammeEdits((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setProgrammeErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const updateProgrammeDraft = (key: string, updater: (taskIds: string[]) => string[]) => {
    setProgrammeEdits((current) => ({
      ...current,
      [key]: updater(current[key] ?? []),
    }));
    if (programmeErrors[key]) {
      setProgrammeErrors((current) => ({ ...current, [key]: "" }));
    }
  };

  const toggleProgrammeTask = (key: string, taskId: string, checked: boolean) => {
    updateProgrammeDraft(key, (taskIds) => {
      if (checked) return taskIds.includes(taskId) ? taskIds : [...taskIds, taskId];
      return taskIds.filter((candidate) => candidate !== taskId);
    });
  };

  const moveProgrammeTask = (key: string, taskId: string, direction: -1 | 1) => {
    updateProgrammeDraft(key, (taskIds) => {
      const index = taskIds.indexOf(taskId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= taskIds.length) return taskIds;
      const next = [...taskIds];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const programmeTaskTitle = (taskId: string) =>
    programmeTasks.find((task) => task.id === taskId)?.title ??
    tracks.flatMap((track) => [
      ...(track.programme?.tasks ?? []),
      ...track.vacancies.flatMap((vacancy) => vacancy.programme?.tasks ?? []),
    ]).find((task) => task.taskId === taskId)?.title ??
    "Задача";

  const submitTrackProgrammeDraft = async (event: FormEvent, track: TeamTrack) => {
    event.preventDefault();
    const key = programmeKey("track", track.id);
    const taskIds = programmeEdits[key] ?? [];
    if (taskIds.length === 0 || programmeActionLoading) return;
    setProgrammeErrors((current) => ({ ...current, [key]: "" }));
    setActionError("");
    try {
      await saveTrackProgrammeDraft({
        ...scope,
        trackId: track.id,
        taskIds,
        revision: track.programme?.revision ?? null,
      }).unwrap();
      cancelProgrammeEdit(key);
      void refetch();
    } catch {
      setProgrammeErrors((current) => ({
        ...current,
        [key]: "Не удалось сохранить задачи трека. Обновите данные и попробуйте ещё раз.",
      }));
    }
  };

  const submitVacancyProgrammeDraft = async (event: FormEvent, track: TeamTrack, vacancy: TeamVacancy) => {
    event.preventDefault();
    const key = programmeKey("vacancy", track.id, vacancy.id);
    const taskIds = programmeEdits[key] ?? [];
    if (taskIds.length === 0 || programmeActionLoading) return;
    const ownProgramme = vacancy.programme?.origin === "VACANCY" ? vacancy.programme : null;
    setProgrammeErrors((current) => ({ ...current, [key]: "" }));
    setActionError("");
    try {
      await saveVacancyProgrammeDraft({
        ...scope,
        trackId: track.id,
        vacancyId: vacancy.id,
        taskIds,
        revision: ownProgramme?.revision ?? null,
      }).unwrap();
      cancelProgrammeEdit(key);
      void refetch();
    } catch {
      setProgrammeErrors((current) => ({
        ...current,
        [key]: "Не удалось сохранить задачи вакансии. Обновите данные и попробуйте ещё раз.",
      }));
    }
  };

  const runTrackProgrammeLifecycle = async (track: TeamTrack) => {
    if (!track.programme || programmeActionLoading) return;
    setActionError("");
    try {
      if (track.programme.status === "DRAFT") {
        await publishTrackProgramme({ ...scope, trackId: track.id, revision: track.programme.revision }).unwrap();
      } else if (track.programme.status === "ARCHIVED") {
        await restoreTrackProgramme({ ...scope, trackId: track.id, revision: track.programme.revision }).unwrap();
      } else {
        await archiveTrackProgramme({ ...scope, trackId: track.id, revision: track.programme.revision }).unwrap();
      }
      void refetch();
    } catch {
      setActionError("Не удалось изменить статус задач трека. Обновите данные и попробуйте ещё раз.");
    }
  };

  const runVacancyProgrammeLifecycle = async (track: TeamTrack, vacancy: TeamVacancy) => {
    const ownProgramme = vacancy.programme?.origin === "VACANCY" ? vacancy.programme : null;
    if (!ownProgramme || programmeActionLoading) return;
    setActionError("");
    try {
      if (ownProgramme.status === "DRAFT") {
        await publishVacancyProgramme({
          ...scope,
          trackId: track.id,
          vacancyId: vacancy.id,
          revision: ownProgramme.revision,
        }).unwrap();
      } else if (ownProgramme.status === "ARCHIVED") {
        await restoreVacancyProgramme({
          ...scope,
          trackId: track.id,
          vacancyId: vacancy.id,
          revision: ownProgramme.revision,
        }).unwrap();
      } else {
        await archiveVacancyProgramme({
          ...scope,
          trackId: track.id,
          vacancyId: vacancy.id,
          revision: ownProgramme.revision,
        }).unwrap();
      }
      void refetch();
    } catch {
      setActionError("Не удалось изменить статус задач вакансии. Обновите данные и попробуйте ещё раз.");
    }
  };

  const lifecycleActionLabel = (kind: ProgrammeTargetKind, name: string, programme: TeamInterviewProgramme) => {
    const target = kind === "track" ? `задачи трека ${name}` : `задачи вакансии ${name}`;
    if (programme.status === "DRAFT") return `Применить ${target}`;
    if (programme.status === "ARCHIVED") return `Восстановить ${target}`;
    return `Архивировать ${target}`;
  };

  const renderProgrammeEditor = (
    key: string,
    title: string,
    onSubmit: (event: FormEvent) => void,
  ) => {
    const selectedTaskIds = programmeEdits[key] ?? [];
    return (
      <Box component="form" className={styles.programmeEditor} onSubmit={onSubmit}>
        <Stack gap="sm">
          <Group justify="space-between" align="center" gap="sm" wrap="wrap">
            <Text fw={700} size="sm">{title}</Text>
            <Button type="button" size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void refetchProgrammeTasks()}>
              Обновить задачи
            </Button>
          </Group>
          {isProgrammeTaskLoading ? <Text size="sm" c="gray.5" aria-live="polite">Загружаем задачи</Text> : null}
          {!isProgrammeTaskLoading && programmeTaskError ? (
            <Alert color="red" role="alert" title="Не удалось загрузить задачи">
              <Button type="button" size="xs" variant="light" mt="sm" onClick={() => void refetchProgrammeTasks()}>Повторить</Button>
            </Alert>
          ) : null}
          {!isProgrammeTaskLoading && !programmeTaskError && programmeTasks.length === 0 ? (
            <Text size="sm" c="gray.5">Сначала создайте активные командные задачи в библиотеке.</Text>
          ) : null}
          {programmeTasks.length > 0 ? (
            <React.Fragment>
              <Stack gap="xs" role="list" aria-label={`Порядок задач: ${title}`}>
                <Text fw={700} size="sm">Порядок задач</Text>
                {selectedTaskIds.length === 0 ? <Text size="sm" c="orange.3">Выберите хотя бы одну задачу.</Text> : null}
                {selectedTaskIds.map((taskId, index, orderedIds) => {
                  const taskTitle = programmeTaskTitle(taskId);
                  return (
                    <Group key={taskId} className={styles.taskSetOrderRow} role="listitem" justify="space-between" gap="xs" wrap="wrap">
                      <Text size="sm">{index + 1}. {taskTitle}</Text>
                      <Group gap="xs">
                        <Button
                          type="button"
                          size="xs"
                          variant="light"
                          aria-label={`Поднять задачу ${taskTitle} в списке`}
                          disabled={index === 0}
                          onClick={() => moveProgrammeTask(key, taskId, -1)}
                        >
                          Выше
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="light"
                          aria-label={`Опустить задачу ${taskTitle} в списке`}
                          disabled={index === orderedIds.length - 1}
                          onClick={() => moveProgrammeTask(key, taskId, 1)}
                        >
                          Ниже
                        </Button>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
              <Stack gap="xs">
                <Text fw={700} size="sm">Задачи для интервью</Text>
                {programmeTasks.map((task) => (
                  <label key={task.id} className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      aria-label={`Задача для интервью: ${task.title}`}
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={(checkboxEvent) => toggleProgrammeTask(key, task.id, checkboxEvent.currentTarget.checked)}
                    />
                    <span>{task.title}</span>
                  </label>
                ))}
              </Stack>
            </React.Fragment>
          ) : null}
          {programmeErrors[key] ? <Text role="alert" c="red.4" size="sm">{programmeErrors[key]}</Text> : null}
          <Group justify="flex-end">
            <Button type="button" variant="subtle" onClick={() => cancelProgrammeEdit(key)}>Отмена</Button>
            <Button
              type="submit"
              loading={saveTrackProgrammeDraftState.isLoading || saveVacancyProgrammeDraftState.isLoading}
              disabled={selectedTaskIds.length === 0 || programmeActionLoading}
            >
              Сохранить задачи
            </Button>
          </Group>
        </Stack>
      </Box>
    );
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          <Text className={styles.eyebrow}>Командный справочник</Text>
          <Title order={1}>Треки и вакансии</Title>
          <Text c="gray.5" mt={6}>Трек объединяет вакансии. Задачи трека добавляются в интервью по умолчанию; задачи вакансии заменяют их, если настроены.</Text>
        </div>
      </Group>

      <div className={styles.trackToolbar}>
      <Group role="tablist" aria-label="Фильтр треков" gap="xs" wrap="nowrap">
        <Button
          type="button"
          role="tab"
          aria-selected={mode === "active"}
          variant={mode === "active" ? "filled" : "light"}
          onClick={() => {
            setMode("active");
            setActionError("");
          }}
        >
          Активные
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={mode === "archived"}
          variant={mode === "archived" ? "filled" : "light"}
          onClick={() => {
            setMode("archived");
            setActionError("");
          }}
        >
          Архив
        </Button>
      </Group>

      <TextInput
        aria-label="Поиск треков и вакансий"
        className={styles.trackSearch}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        placeholder="Название трека или вакансии"
      />
      {canManage && mode === "active" ? (
        <>
          <Button type="button" color="blue" leftSection={<IconPlus size={17} />} onClick={() => setTrackCreateOpened(true)}>Создать трек</Button>
          <Button type="button" color="blue" leftSection={<IconPlus size={17} />} disabled={(counts?.activeTracks ?? 0) === 0} onClick={() => { setSearch(""); setVacancyCreateTrackId(null); setVacancyCreateOpened(true); }}>Создать вакансию</Button>
        </>
      ) : null}
      <Button type="button" variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void refetch()} loading={isFetching && !isLoading}>
        Обновить
      </Button>
      </div>

      {counts ? (
        <Text size="sm" c="gray.5">
          Активные: {counts.activeTracks} треков / {counts.activeVacancies} вакансий · Архив:
          {" "}{counts.archivedTracks} треков / {counts.archivedVacancies} вакансий
        </Text>
      ) : null}

      <Modal opened={trackCreateOpened} onClose={() => setTrackCreateOpened(false)} title="Новый трек" centered>
          <form onSubmit={submitTrack}>
            <Stack gap="sm">
              <Text fw={700}>Новый трек</Text>
              <TextInput
                label="Название трека"
                value={trackName}
                onChange={(event) => {
                  setTrackName(event.currentTarget.value);
                  if (trackError) setTrackError("");
                }}
                placeholder="Например, Backend"
                error={trackError || undefined}
              />
              <Group justify="flex-end">
                <Button type="submit" color="blue" loading={createTrackState.isLoading} disabled={!trackName.trim()}>
                  Создать трек
                </Button>
              </Group>
            </Stack>
          </form>
      </Modal>

      {actionError ? (
        <Alert color="red" role="alert" title="Действие не выполнено">
          {actionError}
        </Alert>
      ) : null}
      {isLoading ? <Text aria-live="polite">Загружаем треки</Text> : null}
      {!isLoading && error ? (
        <Alert color="red" role="alert" title="Не удалось загрузить треки">
          <Button type="button" size="xs" variant="light" mt="sm" onClick={() => void refetch()}>Повторить</Button>
        </Alert>
      ) : null}
      {!isLoading && !error && tracks.length === 0 ? (
        <Card className={styles.emptyState} withBorder>
          <Text fw={700}>{searchQuery ? "Ничего не найдено" : mode === "active" ? "Треков пока нет" : "Архив пуст"}</Text>
          <Text c="gray.5" size="sm">
            {searchQuery
              ? "Попробуйте изменить запрос или переключить активный/архивный фильтр."
              : mode === "active"
              ? "Создайте первый трек — затем добавьте вакансии, которые будут использоваться при подготовке командных интервью."
              : "Здесь появятся архивированные треки и вакансии, которые можно восстановить вручную."}
          </Text>
        </Card>
      ) : null}

      {!isLoading && !error && mode === "archived" && tracks.length > 0 ? (
        <Stack gap="sm">
          {archivedTracks.map((track) => (
            <Card key={track.id} className={styles.panel} role="region" aria-label={`Архивный трек ${track.name}`}>
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Text fw={700}>{track.name}</Text>
                  <Text size="sm" c="gray.5">Архивный трек · {track.vacancies.length} вакансий</Text>
                </div>
                {canManage ? <Group gap="xs"><Button type="button" variant="light" color="green" aria-label={`Восстановить трек ${track.name}`} loading={archiveActionLoading} onClick={() => void toggleTrackArchive(track)}>Восстановить трек</Button><DeleteEntityButton label={`трек ${track.name}`} onDelete={async () => { await deleteTrack({ ...scope, trackId: track.id }).unwrap(); void refetch(); }} /></Group> : null}
              </Group>
            </Card>
          ))}
          {archivedVacancies.map(({ track, vacancy }) => (
            <Card key={vacancy.id} className={styles.panel} role="region" aria-label={`Архивная вакансия ${vacancy.title}`}>
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Text fw={700}>{vacancy.title}</Text>
                  <Text size="sm" c="gray.5">Трек: {track.name}</Text>
                </div>
                {canManage ? <Group gap="xs"><Button type="button" variant="light" color="green" aria-label={`Восстановить вакансию ${vacancy.title}`} loading={archiveActionLoading} onClick={() => void toggleVacancyArchive(track, vacancy)}>Восстановить</Button><DeleteEntityButton label={`вакансию ${vacancy.title}`} onDelete={async () => { await deleteVacancy({ ...scope, trackId: track.id, vacancyId: vacancy.id }).unwrap(); void refetch(); }} /></Group> : null}
              </Group>
            </Card>
          ))}
        </Stack>
      ) : null}

      {!isLoading && !error && mode === "active" && tracks.length > 0 ? (
        <Stack gap="md">
          {tracks.map((track) => (
            <Card
              key={track.id}
              className={styles.panel}
              withBorder
              role="region"
              aria-label={`Трек ${track.name}`}
            >
              <Stack gap="md">
                <Group justify="space-between" align="center" gap="sm">
                  {track.id in trackEdits ? (
                    <Box component="form" className={styles.trackEditForm} onSubmit={(event) => void submitTrackEdit(event, track)}>
                      <TextInput
                        label="Новое название трека"
                        value={trackEdits[track.id] ?? ""}
                        onChange={(event) => {
                          setTrackEdits((current) => ({ ...current, [track.id]: event.currentTarget.value }));
                          if (trackEditErrors[track.id]) {
                            setTrackEditErrors((current) => ({ ...current, [track.id]: "" }));
                          }
                        }}
                        error={trackEditErrors[track.id] || undefined}
                      />
                      <Group justify="flex-end" mt="xs">
                        <Button
                          type="button"
                          variant="subtle"
                          onClick={() => {
                            setTrackEdits((current) => {
                              const next = { ...current };
                              delete next[track.id];
                              return next;
                            });
                          }}
                        >
                          Отмена
                        </Button>
                        <Button type="submit" loading={updateTrackState.isLoading} disabled={!(trackEdits[track.id] ?? "").trim()}>
                          Сохранить трек
                        </Button>
                      </Group>
                    </Box>
                  ) : (
                    <div>
                      <Title order={2} size="h3">{track.name}</Title>
                    </div>
                  )}
                  <Group gap="xs" justify="flex-end">
                    <Badge variant="light" color={track.status === "ACTIVE" ? "teal" : "gray"}>Трек · {track.status === "ACTIVE" ? "активен" : "архив"}</Badge>
                    {canManage && !(track.id in trackEdits) ? (
                      <React.Fragment>
                        <Button
                          type="button"
                          size="xs"
                          variant="light"
                          aria-label={`Переименовать трек ${track.name}`}
                          onClick={() => setTrackEdits((current) => ({ ...current, [track.id]: track.name }))}
                        >
                          Переименовать
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="subtle"
                          color={mode === "active" ? "orange" : "green"}
                          aria-label={`${mode === "active" ? "Архивировать" : "Восстановить"} трек ${track.name}`}
                          loading={archiveActionLoading}
                          onClick={() => void toggleTrackArchive(track)}
                        >
                          {mode === "active" ? "В архив" : "Восстановить"}
                        </Button>
                        <DeleteEntityButton label={`трек ${track.name}`} onDelete={async () => { await deleteTrack({ ...scope, trackId: track.id }).unwrap(); void refetch(); }} />
                      </React.Fragment>
                    ) : null}
                  </Group>
                </Group>

                <ProgrammeSummary programme={track.programme} />
                {canManage && mode === "active" && track.status === "ACTIVE" ? (
                  <Group gap="xs" justify="flex-start">
                    <Button
                      type="button"
                      size="xs"
                      variant="light"
                      aria-label={`Настроить задачи трека ${track.name}`}
                      disabled={programmeActionLoading}
                      onClick={() => startProgrammeEdit(programmeKey("track", track.id), track.programme)}
                    >
                      Настроить задачи
                    </Button>
                    {track.programme ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="subtle"
                        color={track.programme.status === "ARCHIVED" ? "green" : track.programme.status === "DRAFT" ? "blue" : "orange"}
                        aria-label={lifecycleActionLabel("track", track.name, track.programme)}
                        loading={programmeActionLoading}
                        onClick={() => void runTrackProgrammeLifecycle(track)}
                      >
                        {track.programme.status === "DRAFT"
                          ? "Применить задачи"
                          : track.programme.status === "ARCHIVED"
                          ? "Восстановить задачи"
                          : "В архив задачи"}
                      </Button>
                    ) : null}
                  </Group>
                ) : null}
                {programmeKey("track", track.id) in programmeEdits
                  ? renderProgrammeEditor(
                      programmeKey("track", track.id),
                      `Задачи трека ${track.name}`,
                      (event) => void submitTrackProgrammeDraft(event, track),
                    )
                  : null}

                {track.vacancies.length === 0 ? (
                  <Text c="gray.5" size="sm">В этом треке пока нет вакансий</Text>
                ) : (
                  <Stack gap="xs" aria-label={`Вакансии трека ${track.name}`}>
                    <Text fw={700} size="sm" c="blue.2">Вакансии трека</Text>
                    {track.vacancies.map((vacancy) => (
                      <Box key={vacancy.id} className={styles.trackVacancyRow}>
                        {vacancy.id in vacancyEdits ? (
                          <Box component="form" onSubmit={(event) => void submitVacancyEdit(event, track, vacancy)}>
                            <TextInput
                              label="Новое название вакансии"
                              value={vacancyEdits[vacancy.id] ?? ""}
                              onChange={(event) => {
                                setVacancyEdits((current) => ({ ...current, [vacancy.id]: event.currentTarget.value }));
                                if (vacancyEditErrors[vacancy.id]) {
                                  setVacancyEditErrors((current) => ({ ...current, [vacancy.id]: "" }));
                                }
                              }}
                              error={vacancyEditErrors[vacancy.id] || undefined}
                            />
                            <Group justify="flex-end" mt="xs">
                              <Button
                                type="button"
                                variant="subtle"
                                onClick={() => {
                                  setVacancyEdits((current) => {
                                    const next = { ...current };
                                    delete next[vacancy.id];
                                    return next;
                                  });
                                }}
                              >
                                Отмена
                              </Button>
                              <Button type="submit" loading={updateVacancyState.isLoading} disabled={!(vacancyEdits[vacancy.id] ?? "").trim()}>
                                Сохранить вакансию
                              </Button>
                            </Group>
                          </Box>
                        ) : (
                          <Stack gap="xs">
                            <Group justify="space-between" gap="sm">
                              <Text fw={650}>{vacancy.title}</Text>
                              <Group gap="xs" justify="flex-end">
                                <Badge variant="light" color={vacancy.status === "ACTIVE" ? "blue" : "gray"}>Вакансия · {vacancy.status === "ACTIVE" ? "активна" : "архив"}</Badge>
                                {canManage ? (
                                  <React.Fragment>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="light"
                                      aria-label={`Переименовать вакансию ${vacancy.title}`}
                                      onClick={() => setVacancyEdits((current) => ({ ...current, [vacancy.id]: vacancy.title }))}
                                    >
                                      Переименовать
                                    </Button>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="subtle"
                                      color={mode === "active" ? "orange" : "green"}
                                      aria-label={`${mode === "active" ? "Архивировать" : "Восстановить"} вакансию ${vacancy.title}`}
                                      loading={archiveActionLoading}
                                      onClick={() => void toggleVacancyArchive(track, vacancy)}
                                    >
                                      {mode === "active" ? "В архив" : "Восстановить"}
                                    </Button>
                                    <DeleteEntityButton label={`вакансию ${vacancy.title}`} onDelete={async () => { await deleteVacancy({ ...scope, trackId: track.id, vacancyId: vacancy.id }).unwrap(); void refetch(); }} />
                                  </React.Fragment>
                                ) : null}
                              </Group>
                            </Group>
                            <ProgrammeSummary
                              programme={vacancy.programme}
                              inheritedFromTrack={vacancy.programme?.origin === "TRACK"}
                            />
                            {canManage && mode === "active" && track.status === "ACTIVE" && vacancy.status === "ACTIVE" ? (
                              <Group gap="xs" justify="flex-start">
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="light"
                                  aria-label={`Настроить задачи вакансии ${vacancy.title}`}
                                  disabled={programmeActionLoading}
                                  onClick={() => startProgrammeEdit(
                                    programmeKey("vacancy", track.id, vacancy.id),
                                    vacancy.programme,
                                    vacancy.programme?.origin === "TRACK",
                                  )}
                                >
                                  Настроить задачи
                                </Button>
                                {vacancy.programme?.origin === "VACANCY" ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="subtle"
                                    color={vacancy.programme.status === "ARCHIVED" ? "green" : vacancy.programme.status === "DRAFT" ? "blue" : "orange"}
                                    aria-label={lifecycleActionLabel("vacancy", vacancy.title, vacancy.programme)}
                                    loading={programmeActionLoading}
                                    onClick={() => void runVacancyProgrammeLifecycle(track, vacancy)}
                                  >
                                    {vacancy.programme.status === "DRAFT"
                                      ? "Применить задачи"
                                      : vacancy.programme.status === "ARCHIVED"
                                      ? "Восстановить задачи"
                                      : "В архив задачи"}
                                  </Button>
                                ) : null}
                              </Group>
                            ) : null}
                            {programmeKey("vacancy", track.id, vacancy.id) in programmeEdits
                              ? renderProgrammeEditor(
                                  programmeKey("vacancy", track.id, vacancy.id),
                                  `Задачи вакансии ${vacancy.title}`,
                                  (event) => void submitVacancyProgrammeDraft(event, track, vacancy),
                                )
                              : null}
                          </Stack>
                        )}
                      </Box>
                    ))}
                  </Stack>
                )}

              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}
      <Modal
        opened={vacancyCreateOpened}
        onClose={() => { setVacancyCreateOpened(false); setVacancyCreateTrackId(null); }}
        title="Новая вакансия"
        centered
      >
        <Select
          label="Трек вакансии"
          placeholder="Выберите трек"
          data={tracks.filter((track) => track.status === "ACTIVE").map((track) => ({ value: track.id, label: track.name }))}
          value={vacancyCreateTrackId}
          onChange={setVacancyCreateTrackId}
          mb="sm"
        />
        {vacancyCreateTrack ? (
          <form onSubmit={(event) => void submitVacancy(event, vacancyCreateTrack)}>
            <Stack gap="sm">
              <TextInput
                label="Название вакансии"
                value={vacancyDrafts[vacancyCreateTrack.id] ?? ""}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setVacancyDrafts((current) => ({ ...current, [vacancyCreateTrack.id]: value }));
                  if (vacancyErrors[vacancyCreateTrack.id]) {
                    setVacancyErrors((current) => ({ ...current, [vacancyCreateTrack.id]: "" }));
                  }
                }}
                placeholder="Например, Kotlin разработчик"
                error={vacancyErrors[vacancyCreateTrack.id] || undefined}
              />
              <Group justify="flex-end">
                <Button type="submit" color="blue" loading={createVacancyState.isLoading} disabled={!(vacancyDrafts[vacancyCreateTrack.id] ?? "").trim()}>
                  Создать вакансию
                </Button>
              </Group>
            </Stack>
          </form>
        ) : null}
      </Modal>
    </Stack>
  );
}

function StagedSection({ section }: { section: "library" }) {
  const title = "Библиотека";
  return (
    <Stack gap="lg">
      <Title order={1}>{title}</Title>
      <Card className={styles.emptyState} withBorder>
        <Text fw={700}>Раздел готовится</Text>
        <Text c="gray.5" size="sm">Сейчас здесь нет подстановки данных из личного пространства.</Text>
      </Card>
    </Stack>
  );
}

export function TeamWorkspacePage() {
  const { teamId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const auth = useAppSelector((state) => state.auth);
  const section = resolveSection(location.pathname, teamId);
  const contextKey = `${auth.user?.id ?? "anonymous"}:TEAM:${teamId}`;
  const locationRef = useRef(location);
  locationRef.current = location;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const identityRef = useRef(contextKey);
  identityRef.current = contextKey;
  const generationRef = useRef(0);
  const activeDetailRef = useRef<ActiveDetail | null>(null);
  const backgroundedSinceLastRevalidationRef = useRef(document.visibilityState !== "visible");
  const [authorization, setAuthorization] = useState<AuthorizationState>({
    contextKey: "",
    reason: "navigation",
    status: "loading",
    team: null,
  });
  const [loadTeamDetail] = useLazyGetTeamDetailQuery();
  const [loadMergedRedirect] = useLazyGetTeamMergeRedirectQuery();
  const scopeBase = useMemo<Omit<WorkspaceCacheScope, "generation">>(() => ({
    accountId: auth.user?.id ?? "",
    kind: "TEAM",
    teamId,
    query: "",
  }), [auth.user?.id, teamId]);

  const revalidateDetail = useCallback((reason: AuthorizationState["reason"] = "navigation") => {
    if (!auth.token || !auth.user?.id || !teamId) return null;
    const previous = activeDetailRef.current;
    if (reason === "focus" && previous?.reason === "focus" && previous.contextKey === contextKey) {
      return previous;
    }
    previous?.request.abort();
    if (activeDetailRef.current === previous) activeDetailRef.current = null;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const requestContext = contextKey;
    setAuthorization({ contextKey: requestContext, reason, status: "loading", team: null });
    const request = loadTeamDetail({ ...scopeBase, generation }, false) as DetailRequest;
    const active: ActiveDetail = { contextKey: requestContext, generation, reason, request };
    activeDetailRef.current = active;

    void request.unwrap()
      .then((team) => {
        if (activeDetailRef.current !== active || identityRef.current !== requestContext || team.id !== teamId) return;
        forgetCreatedTeamName(scopeBase.accountId, teamId);
        setAuthorization({ contextKey: requestContext, reason, status: "ready", team });
      })
      .catch(async (failure) => {
        if (activeDetailRef.current !== active || identityRef.current !== requestContext) return;
        forgetCreatedTeamName(scopeBase.accountId, teamId);
        if (failure && typeof failure === "object" && "status" in failure && failure.status === 404) {
          try {
            const redirect = await loadMergedRedirect({ accountId: scopeBase.accountId, teamId }, false).unwrap();
            if (activeDetailRef.current !== active || identityRef.current !== requestContext) return;
            const currentLocation = locationRef.current;
            const nextPath = currentLocation.pathname.replace(`/teams/${teamId}`, `/teams/${redirect.teamId}`);
            navigateRef.current(`${nextPath}${currentLocation.search}`, { replace: true });
            return;
          } catch {
            // The same unavailable screen covers unknown teams and unauthorized redirects.
          }
        }
        setAuthorization({ contextKey: requestContext, reason, status: "unavailable", team: null });
      })
      .finally(() => {
        if (activeDetailRef.current === active) activeDetailRef.current = null;
      });
    return active;
  }, [auth.token, auth.user?.id, contextKey, loadTeamDetail, loadMergedRedirect, scopeBase, teamId]);

  useEffect(() => {
    const active = revalidateDetail("navigation");
    return () => {
      forgetCreatedTeamName(scopeBase.accountId, teamId);
      if (!active || activeDetailRef.current !== active) return;
      active.request.abort();
      activeDetailRef.current = null;
    };
  }, [revalidateDetail, scopeBase.accountId, teamId]);

  useEffect(() => {
    const markBackgrounded = () => {
      backgroundedSinceLastRevalidationRef.current = true;
    };
    const revalidateAfterReturn = () => {
      if (document.visibilityState !== "visible" || !backgroundedSinceLastRevalidationRef.current) return;
      backgroundedSinceLastRevalidationRef.current = false;
      revalidateDetail("focus");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidateAfterReturn();
      else markBackgrounded();
    };
    window.addEventListener("blur", markBackgrounded);
    window.addEventListener("focus", revalidateAfterReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", markBackgrounded);
      window.removeEventListener("focus", revalidateAfterReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [revalidateDetail]);

  if (!auth.token) return <Navigate to="/login" replace />;
  if (!teamId || !section) return <Navigate to={`/workspace/teams/${teamId}/interviews`} replace />;

  const stateForContext = authorization.contextKey === contextKey ? authorization : null;
  const team = stateForContext?.status === "ready" ? stateForContext.team : null;
  const detailStatus: DetailStatus = stateForContext?.status ?? "loading";
  const detailReason = stateForContext?.reason ?? "navigation";
  const transientTeamName = auth.user?.id ? getCreatedTeamName(auth.user.id, teamId) : undefined;
  const sectionTitle = section === "create"
    ? "Создать интервью"
    : section === "library"
      ? "Библиотека"
      : section === "tracks"
        ? "Треки и вакансии"
        : section === "members"
          ? "Участники"
          : section === "settings"
          ? "Настройки команды"
          : section === "profile"
            ? "Профиль"
            : "Интервью";
  const sectionContextKey = contextKey;

  return (
    <Box className={styles.page}>
      <header className={styles.header}>
        <Container size="xl" className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">IO</span>
            <div className={styles.brandText}>
              <Text className={styles.brandLabel} fw={800} title={team?.name ?? "Командное пространство"}>
                {team?.name ?? "Командное пространство"}
              </Text>
              {team ? (
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c="gray.5">{teamId.slice(0, 8)}</Text>
                  <Badge variant="light" color={team.role === "OWNER" ? "teal" : "blue"}>
                    {team.role}
                  </Badge>
                </Group>
              ) : null}
            </div>
          </div>
          <div className={styles.workspaceChoice}>
            <WorkspaceSwitcher
              currentTeamId={teamId}
              currentTeamName={team?.name ?? (
                detailStatus === "loading" && detailReason === "navigation"
                  ? (transientTeamName ?? null)
                  : null
              )}
            />
          </div>
          {team ? <TeamNavigation teamId={teamId} /> : <div className={styles.nav} data-testid="team-navigation-placeholder" aria-hidden="true" />}
          <Group className={styles.userControls} gap="sm" wrap="nowrap">
            <NavLink to={`/workspace/teams/${teamId}/profile`} className={styles.userName} aria-label={`Открыть профиль @${auth.user?.nickname}`}>
              <IconUserCircle size={16} aria-hidden="true" />
              @{auth.user?.nickname}
            </NavLink>
            <Button
              type="button"
              variant="subtle"
              onClick={() => {
                activeDetailRef.current?.request.abort();
                activeDetailRef.current = null;
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
      <main aria-label={team ? `Команда ${team.name}: ${sectionTitle}` : "Проверка доступа к командному пространству"}>
        <Container size="xl" className={styles.content}>
          {detailStatus === "loading" ? (
            <Stack align="center" gap="sm" role="status" aria-label="Проверяем доступ к команде">
              <Loader aria-label="Загружаем команду" />
              <Text c="gray.5">Проверяем доступ к командному пространству…</Text>
            </Stack>
          ) : null}
          {detailStatus === "unavailable" ? (
            <Alert color="red" role="alert" title="Команда недоступна">
              <Text size="sm" mb="sm">Доступ не подтверждён. Данные команды скрыты.</Text>
              <Button type="button" variant="light" onClick={() => void revalidateDetail("retry")}>Повторить</Button>
            </Alert>
          ) : null}
          {detailStatus === "ready" && team ? (
            <React.Fragment key={sectionContextKey}>
              {section === "interviews" ? (
                <TeamInterviewList accountId={auth.user?.id ?? ""} teamId={teamId} teamRole={team.role} />
              ) : null}
              {section === "create" ? (
                <TeamCreateInterview accountId={auth.user?.id ?? ""} teamId={teamId} />
              ) : null}
              {section === "members" ? (
                <TeamMembersSection
                  key={`${auth.user?.id ?? "anonymous"}:${teamId}`}
                  accountId={auth.user?.id ?? ""}
                  authToken={auth.token ?? ""}
                  teamId={teamId}
                  canManageInvitations={team.role === "OWNER" || team.role === "ADMIN"}
                />
              ) : null}
              {section === "settings" ? (
                <TeamManagementSettings
                  accountId={auth.user?.id ?? ""}
                  team={team}
                  onTeamRefresh={() => {
                    const active = revalidateDetail("navigation");
                    return active
                      ? active.request.unwrap().catch(() => null)
                      : Promise.resolve(null);
                  }}
                />
              ) : null}
              {section === "library" ? (
                <TeamTaskLibrarySection
                  accountId={auth.user?.id ?? ""}
                  teamId={teamId}
                  team={team}
                />
              ) : null}
              {section === "tracks" ? (
                <TeamTracksSection
                  accountId={auth.user?.id ?? ""}
                  team={team}
                  teamId={teamId}
                />
              ) : null}
              {section === "profile" ? <ProfilePage /> : null}
            </React.Fragment>
          ) : null}
        </Container>
      </main>
    </Box>
  );
}
