import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { IconTrash, IconMenu2, IconPencil, IconPlus, IconRefresh, IconUserCircle } from "components/antd-icons";
import { App, Button as AntButton, Switch, Tabs, Tooltip } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import { ActionIcon, Alert, Badge, Box, Button, Card, Container, Group, Loader, Menu, Modal, MultiSelect, Select, Stack, Text, Textarea, TextInput, Title } from "components/antd-compat";
import { Navigate, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { useClipboardNotification } from "../../components/useClipboardNotification";
import { WorkspaceSwitcher } from "../../features/workspace/WorkspaceSwitcher";
import { ThemeToggleButton } from "../../features/theme/ThemeToggleButton";
import { parseLibraryTransfer, serializeTask, serializeTaskSet } from "../../features/workspace/libraryTransfer";
import { HiringManagerPicker } from "../../features/hr/HiringManagerPicker";
import { moscowInputToInstant } from "../../features/hr/hrDate";
import type { HiringManagerPreviewResponse } from "../../types";
import { ProfilePage } from "./PersonalWorkspacePage";
import { TeamManagementSettings } from "../../features/workspace/TeamManagementSettings";
import { TeamProcessFilters, type TeamProcessFilterValue } from "../../features/workspace/TeamProcessFilters";
import { VerdictBadge } from "../../features/room/VerdictBadge";
import { forgetCreatedTeamName, getCreatedTeamName } from "../../features/workspace/transientWorkspaceIdentity";
import { clearAuth } from "../../features/auth/authSlice";
import {
  api,
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
  useDeleteTeamTaskMutation,
  useDeleteTeamTaskSetMutation,
  useRestoreTeamTrackMutation,
  useDeleteTeamTrackMutation,
  useRestoreTeamVacancyMutation,
  useDeleteTeamVacancyMutation,
  usePublishTeamTrackProgrammeMutation,
  usePublishTeamVacancyProgrammeMutation,
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
import { HrCabinetSection } from "../dashboard/HrCabinetSection";
import { TeamInterviewEditAction } from "../../features/workspace/TeamInterviewEditAction";

type TeamSection = "interviews" | "create" | "library" | "tracks" | "members" | "settings" | "profile" | "candidates";
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
  reason: "focus" | "navigation" | "mutation" | "retry";
  status: DetailStatus;
  team: TeamDetail | null;
  refreshFailed?: boolean;
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
  if (pathname === `${root}/candidates`) return "candidates";
  return null;
}

function taskCountLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} задачи`;
  return `${count} задач`;
}

function DeleteEntityButton({ label, description, onDelete }: { readonly label: string; readonly description?: string; readonly onDelete: () => Promise<void> }) {
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
      setError(description ? "Не удалось удалить. Проверьте доступ и повторите попытку." : "Не удалось удалить. Возможно, объект используется в интервью или другом материале.");
    } finally {
      setBusy(false);
    }
  };
  return <>
    <Button type="button" size="xs" variant="light" color="red" aria-label={`Удалить ${label}`} title={`Удалить ${label}`} onClick={() => setOpened(true)}><IconTrash size={16} aria-hidden="true" /></Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false); }} title={`Удалить ${label}?`} centered>
      <Stack gap="md">
        <Text size="sm">{description ?? "Это действие нельзя отменить. Используемые в интервью или других материалах объекты удалить нельзя."}</Text>
        {error ? <Alert color="red" role="alert">{error}</Alert> : null}
        <Group justify="flex-end" align="center" wrap="wrap">
          <Button type="button" variant="subtle" disabled={busy} onClick={() => setOpened(false)}>Отмена</Button>
          <Button type="button" color="red" variant="light" leftSection={<IconTrash size={16} aria-hidden="true" />} loading={busy} onClick={() => void remove()}>Удалить</Button>
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
  return "Активны";
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
        <Text size="sm" fw={700}>{programmeOriginLabel(programme)} · {mandatoryLabel}</Text>
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

function TeamNavigation({ teamId, authorized, isAdmin }: { teamId: string; authorized: boolean; isAdmin: boolean }) {
  const location = useLocation();
  const items = useMemo(() => [
    { label: "Интервью", to: `/workspace/teams/${teamId}/interviews` },
    { label: "Библиотека", to: `/workspace/teams/${teamId}/library` },
    { label: "Кандидаты", to: `/workspace/teams/${teamId}/candidates` },
    { label: "Треки и вакансии", to: `/workspace/teams/${teamId}/tracks` },
    ...(isAdmin ? [{ label: "Админка", to: "/dashboard/admin" }] : []),
  ], [teamId, isAdmin]);
  const navRef = useRef<HTMLElement | null>(null);
  const linkRefs = useRef(new Map<string, HTMLSpanElement>());
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [overflowOpened, setOverflowOpened] = useState(false);

  useEffect(() => { setOverflowOpened(false); }, [teamId, authorized, isAdmin]);

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

  const directItems = items.slice(0, visibleCount ?? 0);
  const overflowItems = items.slice(visibleCount ?? 0);
  const activeOverflow = !authorized || visibleCount === null ? undefined : overflowItems.find(item => location.pathname === item.to);
  const overflowTrigger = (
    <AntButton
      type="text"
      htmlType="button"
      className={`${styles.navButton} app-header-control`}
      disabled={!authorized}
      tabIndex={authorized ? undefined : -1}
      aria-label={activeOverflow ? `Меню разделов: ${activeOverflow.label}` : "Меню разделов"}
      data-active-section={activeOverflow ? "true" : undefined}
      aria-expanded={authorized && overflowOpened}
      aria-haspopup={authorized ? "menu" : undefined}
      onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (authorized && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          setOverflowOpened(true);
        }
      }}
    >
      <IconMenu2 size={20} stroke={2} aria-hidden="true" />
    </AntButton>
  );
  return (
    <nav ref={navRef} className={styles.nav} aria-label="Разделы команды" aria-hidden={authorized ? undefined : true} data-testid={authorized ? undefined : "team-navigation-placeholder"}>
      <span className={styles.navMeasure} aria-hidden="true">
        {items.map((item) => (
          <span key={item.to} className={styles.navMeasureItem} ref={(node) => {
            if (node) linkRefs.current.set(item.to, node);
            else linkRefs.current.delete(item.to);
          }}>{item.label}</span>
        ))}
      </span>
      {directItems.map((item) => authorized ? (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `${isActive ? styles.navActive : styles.navLink} app-header-control`}
        >
          {item.label}
        </NavLink>
      ) : (
        <span key={item.to} className={location.pathname === item.to ? styles.navActive : styles.navLink}>{item.label}</span>
      ))}
      {overflowItems.length > 0 ? authorized ? (
        <Menu position="bottom-end" shadow="md" withinPortal opened={overflowOpened} onChange={setOverflowOpened}>
          <Menu.Target>
            {overflowTrigger}
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
      ) : overflowTrigger : null}
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
}: {
  readonly accountId: string;
  readonly teamId: string;
}) {
  const { notification } = App.useApp();
  const authToken = useAppSelector((state) => state.auth.token);
  const actionContext = `${accountId}:${authToken}:${teamId}`;
  const actionContextRef = useRef<string | null>(actionContext);
  actionContextRef.current = actionContext;
  useEffect(() => {
    actionContextRef.current = actionContext;
    return () => { actionContextRef.current = null; };
  }, [actionContext]);
  const isCurrentAction = (requestContext: string | null) => (
    actionContextRef.current === requestContext && localStorage.getItem("auth_token") === authToken
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [mineOnly, setMineOnly] = useState(false);
  const [processFilter, setProcessFilter] = useState<TeamProcessFilterValue>({ trackId: "", vacancyId: "" });
  const trimmedSearch = search.trim();
  const {
    currentData: data,
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
      trackId: processFilter.trackId || undefined,
      vacancyId: processFilter.vacancyId || undefined,
    },
    { skip: !accountId },
  );
  const {
    currentData: orphanedData,
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
      trackId: processFilter.trackId || undefined,
      vacancyId: processFilter.vacancyId || undefined,
    },
    { skip: !accountId },
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
    { skip: !accountId || orphanedInterviews.length === 0 },
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
    void refetchOrphanedInterviews();
    void refetchOwnerOffers();
  };
  const submitOwnerOffer = async (interview: TeamInterviewListItem) => {
    const requestContext = actionContextRef.current;
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
      if (!isCurrentAction(requestContext)) return;
      notification.success({ title: "Предложение отправлено выбранному участнику.", placement: "top", role: "status" });
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось отправить предложение. Проверьте, что интервью ещё без активного владельца.");
    }
  };
  const acceptIncomingOwnerOffer = async (offer: TeamInterviewOwnerOfferListItem) => {
    const requestContext = actionContextRef.current;
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
      if (!isCurrentAction(requestContext)) return;
      notification.success({ title: "Вы приняли владение интервью.", placement: "top", role: "status" });
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось принять предложение. Возможно, оно уже истекло или было обработано.");
    }
  };
  const declineIncomingOwnerOffer = async (offer: TeamInterviewOwnerOfferListItem) => {
    const requestContext = actionContextRef.current;
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
      if (!isCurrentAction(requestContext)) return;
      notification.success({ title: "Вы отклонили предложение владения.", placement: "top", role: "status" });
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось отклонить предложение. Возможно, оно уже истекло или было обработано.");
    }
  };
  const archiveOrphanedInterview = async (interview: TeamInterviewListItem) => {
    const requestContext = actionContextRef.current;
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
      if (!isCurrentAction(requestContext)) return;
      notification.success({ title: "Интервью архивировано без преемника.", placement: "top", role: "status" });
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось архивировать интервью. Проверьте, что оно всё ещё без активного владельца.");
    }
  };
  const freezeOrphanedInterview = async (interview: TeamInterviewListItem) => {
    const requestContext = actionContextRef.current;
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
      if (!isCurrentAction(requestContext)) return;
      notification.success({ title: "Интервью заморожено для кандидата.", placement: "top", role: "status" });
      refreshInterviewOwnership();
    } catch {
      setOwnerOfferMessage("Не удалось заморозить интервью. Проверьте, что оно всё ещё без активного владельца.");
    }
  };
  const resumeFrozenInterview = async (interview: TeamInterviewListItem) => {
    const requestContext = actionContextRef.current;
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
      if (!isCurrentAction(requestContext)) return;
      notification.success({ title: "Интервью возобновлено.", placement: "top", role: "status" });
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
      {ownerOfferMessage ? (
        <Alert color={ownerOfferMessage.includes("Не удалось") ? "red" : "green"} role="status">
          {ownerOfferMessage}
        </Alert>
      ) : null}
      <Group align="end" gap="lg" wrap="wrap">
        <TextInput
          className={styles.interviewSearch}
          label="Поиск интервью" placeholder="Название интервью или имя участника"
          value={search}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.currentTarget.value)}
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
      <TeamProcessFilters accountId={accountId} teamId={teamId} value={processFilter} onChange={setProcessFilter} />
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
          <Text component="div" fw={700}>{processFilter.trackId || processFilter.vacancyId ? "Интервью по выбранным фильтрам не найдены" : trimmedSearch ? "Интервью по этому поиску не найдены" : mineOnly ? "Вы пока не создали интервью" : "Доступных командных интервью пока нет"}</Text>
          <Text c="gray.5" size="sm">
            {processFilter.trackId || processFilter.vacancyId ? "Выберите другой трек или вакансию либо снимите фильтры." : trimmedSearch
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
              canRename
              isResuming={resumeTeamInterviewState.isLoading}
              onResume={resumeFrozenInterview}
              onDelete={async () => {
                await deleteTeamInterview({ accountId, kind: "TEAM", teamId, query: "interviews", interviewId: interview.id }).unwrap();
                refreshInterviewOwnership();
              }}
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
                <Stack gap="xs">
                  <Text fw={800}>{offer.interviewTitle}</Text>
                  <Text c="gray.5" size="sm">Предложил: {offer.fromDisplayName}</Text>
                  {formatShortDateTime(offer.expiresAt) ? (
                    <Text c="gray.6" size="xs">Истекает: {formatShortDateTime(offer.expiresAt)}</Text>
                  ) : null}
                </Stack>
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
                    <Stack gap="xs">
                      <Text fw={800}>{interview.title}</Text>
                      <Text c="gray.5" size="sm">Владелец: {ownerName}</Text>
                    </Stack>
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
  const copyToClipboard = useClipboardNotification();
  const tasksLine = interview.tasks.map((task) => task.title).join(" → ");
  const isFrozen = interview.status === "frozen";
  const isFinished = interview.status === "finished";
  const canResume = isFrozen;
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
          <div className={styles.interviewHeading}>
            <Text fw={800}>{interview.title}</Text>
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
          {interview.programmeVersion != null ? (
            <Badge color="blue" variant="light">Задачи по шаблону</Badge>
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
        <Group justify="flex-end" align="center" wrap="wrap">
            {canRename ? <TeamInterviewEditAction accountId={accountId} teamId={teamId} interview={interview} /> : null}
            {!isFrozen ? (
              <Button type="button" variant="light" size="compact-sm" onClick={async () => {
                await copyToClipboard(`${window.location.origin}/room/${interview.inviteCode}`, {
                  success: "Ссылка для кандидата готова к отправке.",
                  failure: "Разрешите доступ к буферу обмена и повторите попытку.",
                });
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
  return <MultiSelect
    label={title}
    aria-label={title}
    placeholder={members.length ? "Выберите участников команды" : emptyText}
    value={selectedIds.filter(id => members.some(member => member.userId === id))}
    data={members.map(member => ({ value: member.userId, label: member.displayName }))}
    searchable clearable maxTagCount={2}
    onChange={ids => {
      for (const member of members) {
        if (ids.includes(member.userId) !== selectedIds.includes(member.userId)) onToggle(member.userId, ids.includes(member.userId));
      }
    }}
  />;
}

function TeamCreateInterview({
  accountId,
  teamId,
}: {
  readonly accountId: string;
  readonly teamId: string;
}) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [title, setTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const authToken = useAppSelector(state => state.auth.token);
  const createContext = `${accountId}:${authToken}:${teamId}`;
  const contextRef = useRef<string | null>(createContext);
  contextRef.current = createContext;
  const createRequestRef = useRef<{ abort: () => void } | null>(null);
  const createAttempt = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    contextRef.current = createContext;
    return () => { contextRef.current = null; createRequestRef.current?.abort(); createAttempt.current = null; };
  }, [createContext]);
  const [selectedTaskSetId, setSelectedTaskSetId] = useState("");
  const [taskSelectionOverrides, setTaskSelectionOverrides] = useState<Record<string, boolean>>({});
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [selectedVacancyId, setSelectedVacancyId] = useState("");
  const [selectedInterviewerIds, setSelectedInterviewerIds] = useState<string[]>([]);
  const [hiringManagers, setHiringManagers] = useState<HiringManagerPreviewResponse[]>([]);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [programmeConflict, setProgrammeConflict] = useState(false);
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
  } = useGetTeamTaskLibraryQuery(taskScope, { skip: !accountId });
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
  const activeTaskIdSet = new Set(tasks.map((task) => task.id));
  const programmeTaskIds = selectedProgramme?.status === "PUBLISHED"
    ? [...selectedProgramme.tasks].sort((left, right) => left.position - right.position).map((task) => task.taskId).filter((taskId) => activeTaskIdSet.has(taskId))
    : [];
  const taskSetTaskIds = selectedTaskSet
    ? [...selectedTaskSet.items].sort((left, right) => left.position - right.position).map((item) => item.taskId).filter((taskId) => activeTaskIdSet.has(taskId))
    : [];
  const defaultTaskIds = [...new Set([...programmeTaskIds, ...taskSetTaskIds])];
  const defaultTaskIdSet = new Set(defaultTaskIds);
  const selectedTaskIds = [
    ...defaultTaskIds.filter((taskId) => taskSelectionOverrides[taskId] !== false),
    ...tasks.filter((task) => taskSelectionOverrides[task.id] === true && !defaultTaskIdSet.has(task.id)).map((task) => task.id),
  ];
  const programmeTaskIdSet = new Set(programmeTaskIds);
  const taskSetTaskIdSet = new Set(taskSetTaskIds);
  const taskSelectionOptions = tasks.map((task) => ({
    value: task.id,
    label: task.title,
    language: labelForLanguage(task.language),
    programmeSource: programmeTaskIdSet.has(task.id)
      ? selectedProgramme?.origin === "VACANCY" ? "Вакансия" : "Трек"
      : null,
    taskSetSource: taskSetTaskIdSet.has(task.id) ? "Набор" : null,
  }));
  const [createTeamInterview, { isLoading: isCreatingInterview }] = useCreateTeamInterviewMutation();
  const taskContextUnavailable = Boolean((selectedTaskSet || selectedProgramme) && taskError);
  const canCreateInterview = title.trim().length > 0 &&
    !isCreatingInterview && !pickerBusy && !isTaskLoading && !taskContextUnavailable && !programmeConflict && (!selectedProgramme || selectedProgramme.status === "PUBLISHED");

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

  const toggleInterviewer = (userId: string, checked: boolean) => {
    setSelectedInterviewerIds((current) => {
      if (checked) return current.includes(userId) ? current : [...current, userId];
      return current.filter((candidate) => candidate !== userId);
    });
  };

  const updateSelectedTasks = (nextTaskIds: string[]) => {
    const nextSelected = new Set(nextTaskIds);
    setTaskSelectionOverrides((current) => {
      const next = { ...current };
      tasks.forEach((task) => {
        const isSelected = nextSelected.has(task.id);
        if (defaultTaskIdSet.has(task.id) === isSelected) delete next[task.id];
        else next[task.id] = isSelected;
      });
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isCreatingInterview || pickerBusy) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setCreateError("Укажите название интервью.");
      return;
    }
    const normalizedInstant = scheduledAt ? moscowInputToInstant(scheduledAt) : null;
    if (scheduledAt && !normalizedInstant) { setCreateError("Проверьте дату и время интервью."); return; }
    const body = {
        title: normalizedTitle,
        candidateName: candidateName.trim() || undefined,
        position: position.trim() || undefined,
        scheduledAt: normalizedInstant || undefined,
        taskSetId: selectedTaskSet?.id,
        selectedTaskIds,
        trackId: selectedTrack?.id,
        vacancyId: selectedVacancy?.id,
        programmeId: selectedProgramme?.id,
        programmeVersion: selectedProgramme?.version,
        interviewerIds: selectedInterviewerIds,
        hiringManagerIds: hiringManagers.map(person => person.normalizedId),
    };
    const signature = JSON.stringify(body);
    if (createAttempt.current?.signature !== signature) createAttempt.current = { signature, key: idempotencyKey() };
    const capturedContext = createContext;
    try {
      const request = createTeamInterview({ ...body, accountId, kind: "TEAM", teamId, query: "interview-create-submit", idempotencyKey: createAttempt.current.key });
      createRequestRef.current = request;
      const result = await request.unwrap();
      if (contextRef.current !== capturedContext || localStorage.getItem("auth_token") !== authToken) return;
      setCreateError("");
      setProgrammeConflict(false);
      navigate(`/room/${result.interview.inviteCode}`);
    } catch (error) {
      if (contextRef.current !== capturedContext || localStorage.getItem("auth_token") !== authToken) return;
      if (typeof error === "object" && error !== null && "status" in error && error.status === 401) {
        createAttempt.current = null;
        setCandidateName(""); setPosition(""); setScheduledAt("");
        dispatch(clearAuth());
        return;
      }
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
    <Modal opened authoring
      onClose={() => { if (!isCreatingInterview) navigate(`/workspace/teams/${teamId}/interviews`); }}
      title="Создать интервью" centered size="lg"
      closeOnClickOutside={!isCreatingInterview} closeOnEscape={!isCreatingInterview} withCloseButton={!isCreatingInterview}
    >
      <form className="app-authoring-form" onSubmit={submit}>
        <div className="app-authoring-fields">
          <section className="app-authoring-section" aria-label="Основное">
            <h4>Основное</h4>
            <TextInput label="Название интервью" placeholder="Введите название интервью" value={title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.currentTarget.value)} disabled={isCreatingInterview} />
            <div className="app-authoring-grid">
              <TextInput label="Имя кандидата" placeholder="Введите имя кандидата" value={candidateName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCandidateName(event.currentTarget.value)} maxLength={200} disabled={isCreatingInterview} />
              <TextInput label="Позиция" placeholder="Введите название должности" value={position} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPosition(event.currentTarget.value)} maxLength={200} disabled={isCreatingInterview} />
            </div>
            <TextInput type="datetime-local" label="Дата и время интервью (МСК)" value={scheduledAt} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setScheduledAt(event.currentTarget.value)} disabled={isCreatingInterview} />
            <div className="app-authoring-grid">
              <Select label="Трек интервью" aria-label="Трек интервью" value={selectedTrackId} searchable
                data={[{ value: "", label: "Без трека" }, ...tracks.map(track => ({ value: track.id, label: track.name }))]}
                onChange={value => { setSelectedTrackId(value ?? ""); setSelectedVacancyId(""); setProgrammeConflict(false); }} />
              <Select label="Вакансия" aria-label="Вакансия" value={selectedVacancyId} searchable
                data={[{ value: "", label: "Без вакансии" }, ...availableVacancies.map(vacancy => ({ value: vacancy.id, label: vacancy.title }))]}
                onChange={value => { setSelectedVacancyId(value ?? ""); setProgrammeConflict(false); }} disabled={!selectedTrack} />
            </div>
            {isTrackLoading ? <Text role="status">Загружаем треки и вакансии…</Text> : null}
            {trackError ? <Alert color="red" role="alert" title="Не удалось загрузить треки"><Button variant="light" onClick={() => void refetchTracks()}>Повторить</Button></Alert> : null}
            {selectedProgramme && selectedProgramme.status !== "PUBLISHED" ? <Alert color="orange" role="alert" title="Задачи трека или вакансии пока недоступны">Сохраните задачи выбранного контекста перед созданием интервью.</Alert> : null}
          </section>
          <section className="app-authoring-section" aria-label="Задачи">
            <h4>Задачи</h4>
            <Select label="Набор задач (необязательно)" aria-label="Командный набор задач" value={selectedTaskSetId} searchable
              data={[{ value: "", label: "Без набора" }, ...taskSets.map(taskSet => ({ value: taskSet.id, label: taskSet.name }))]}
              onChange={value => setSelectedTaskSetId(value ?? "")} />
            {isTaskSetLoading ? <Text role="status">Загружаем наборы…</Text> : null}
            {taskSetError ? <Alert color="red" role="alert" title="Не удалось загрузить наборы задач" /> : null}
            <MultiSelect label="Задачи интервью" aria-label="Задачи интервью" value={selectedTaskIds} data={taskSelectionOptions}
              onChange={updateSelectedTasks} searchable clearable maxTagCount={2} placeholder="Выберите задачи для интервью"
              disabled={isTaskLoading} error={taskError ? "Не удалось загрузить библиотеку задач" : undefined}
              optionRender={(option: { label?: React.ReactNode; data?: { label?: React.ReactNode; language?: string; programmeSource?: string | null; taskSetSource?: string | null } }) => <div className={styles.interviewTaskOption}><span className={styles.interviewTaskOptionTitle}>{option.data?.label ?? option.label}</span><span className={styles.interviewTaskOptionLanguage}>{option.data?.language}</span><Group gap={6}>{option.data?.programmeSource ? <Badge>{option.data.programmeSource}</Badge> : null}{option.data?.taskSetSource ? <Badge>{option.data.taskSetSource}</Badge> : null}</Group></div>} />
          </section>
          <section className="app-authoring-section" aria-label="Участники">
            <h4>Участники</h4>
            <TeamInterviewRolePicker title="Другие интервьюеры (необязательно)" emptyText="Других участников пока нет" members={otherMembers} selectedIds={selectedInterviewerIds} onToggle={toggleInterviewer} />
            {isMemberLoading ? <Text role="status">Загружаем участников…</Text> : null}
            {memberError ? <Alert color="orange" role="alert" title="Не удалось загрузить участников" /> : null}
            <HiringManagerPicker label="Внешний нанимающий (необязательно)" teamId={teamId} selectedIds={hiringManagers.map(person => person.normalizedId)} disabled={isCreatingInterview} showSuccess={false} onPendingChange={setPickerBusy}
              onSelect={person => setHiringManagers(current => current.some(item => item.normalizedId === person.normalizedId) ? current : [...current, person])} />
            {hiringManagers.length ? <Group gap="xs" wrap="wrap">{hiringManagers.map(person => <Group key={person.normalizedId} gap="xs"><Text>{person.displayName}</Text><ActionIcon aria-label={`Удалить нанимающего ${person.displayName}`} disabled={isCreatingInterview} onClick={() => setHiringManagers(current => current.filter(item => item.normalizedId !== person.normalizedId))}><IconTrash size={16} /></ActionIcon></Group>)}</Group> : null}
          </section>
          {createError ? <Alert color="red" role="alert" title="Интервью не создано">{createError}{programmeConflict ? <Button variant="light" onClick={async () => { await refetchTracks(); setProgrammeConflict(false); setCreateError(""); }}>Проверить обновлённые задачи</Button> : null}</Alert> : null}
        </div>
        <div className="app-form-actions">
          <Button type="button" variant="subtle" disabled={isCreatingInterview} onClick={() => navigate(`/workspace/teams/${teamId}/interviews`)}>Отмена</Button>
          <Button type="submit" disabled={!canCreateInterview} loading={isCreatingInterview}>Создать интервью</Button>
        </div>
      </form>
    </Modal>
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
  const copyToClipboard = useClipboardNotification();
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
  const searchQuery = search.trim();
  const scope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: `library:${languageFilter}:${searchQuery}`,
  }), [accountId, languageFilter, searchQuery, teamId]);
  const { data, error, isFetching, isLoading, refetch } = useGetTeamTaskLibraryQuery(
    {
      ...scope,
      language: languageFilter || undefined,
      q: searchQuery || undefined,
    },
    { skip: !accountId },
  );
  const setTaskCatalog = useGetTeamTaskLibraryQuery(
    { accountId, kind: "TEAM", teamId, query: "task-set-full-catalog" },
    { skip: !accountId || !(libraryTab === "sets" || createSetOpened || Object.keys(taskSetEdits).length > 0) },
  );
  const taskSetScope = useMemo(() => ({
    accountId,
    kind: "TEAM" as const,
    teamId,
    query: "task-sets",
  }), [accountId, teamId]);
  const {
    data: taskSetData,
    error: taskSetLoadError,
    isFetching: isTaskSetFetching,
    isLoading: isTaskSetLoading,
    refetch: refetchTaskSets,
  } = useGetTeamTaskSetsQuery(
    {
      ...taskSetScope,
    },
    { skip: !accountId },
  );
  const [createTask, createTaskState] = useCreateTeamTaskMutation();
  const [importPersonalTask, importPersonalTaskState] = useImportPersonalTaskToTeamMutation();
  const [updateTask, updateTaskState] = useUpdateTeamTaskMutation();
  const [deleteTask] = useDeleteTeamTaskMutation();
  const [createTaskSet, createTaskSetState] = useCreateTeamTaskSetMutation();
  const [updateTeamTaskSet, updateTeamTaskSetState] = useUpdateTeamTaskSetMutation();
  const [importPersonalPresetToTeam, importPersonalPresetToTeamState] = useImportPersonalPresetToTeamMutation();
  const [deleteTaskSet] = useDeleteTeamTaskSetMutation();
  const tasks = data?.items ?? [];
  const setTasks = setTaskCatalog.currentData?.items ?? [];
  const taskSets = taskSetData?.items ?? [];
  const taskSetActionLoading =
    updateTeamTaskSetState.isLoading ||
    importPersonalPresetToTeamState.isLoading;

  // Mutation tags schedule the library refresh; duplicate refetches can consume a pending invalidation.
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
    } catch {
      setTaskSetError("Не удалось создать набор. Проверьте название, задачи или доступ к команде.");
    }
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
    } catch {
      setTaskEditErrors((current) => ({
        ...current,
        [task.id]: "Не удалось сохранить задачу. Обновите список и попробуйте ещё раз.",
      }));
    }
  };

  const copyExistingTask = async (task: TeamTaskTemplate) => {
    setActionError("");
    await copyToClipboard(serializeTask(task), {
      success: `Задача «${task.title}» готова к передаче.`,
      failure: "Разрешите доступ к буферу обмена и повторите попытку.",
    });
  };

  const copyExistingTaskSet = async (taskSet: TeamTaskSet) => {
    setTaskSetActionError("");
    try {
      const library = await dispatch(api.endpoints.getTeamTaskLibrary.initiate({
        ...scope,
        query: "copy-set",
      }, { subscribe: false, forceRefetch: true })).unwrap();
      const byId = new Map(library.items.map((task) => [task.id, task]));
      const ordered = taskSet.items.map((item) => byId.get(item.taskId));
      if (ordered.some((task) => !task)) {
        setTaskSetActionError("Не удалось скопировать набор: одна из задач недоступна.");
        return;
      }
      await copyToClipboard(serializeTaskSet(taskSet.name, ordered as TeamTaskTemplate[]), {
        success: `Набор «${taskSet.name}» готов к передаче.`,
        failure: "Разрешите доступ к буферу обмена и повторите попытку.",
      });
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
    } catch {
      setTaskSetEditErrors((current) => ({
        ...current,
        [taskSet.id]: "Не удалось сохранить набор. Обновите список и попробуйте ещё раз.",
      }));
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
        <Modal authoring opened title="Редактировать задачу" centered size="xl" onClose={() => { if (!updateTaskState.isLoading) cancelTaskEdit(task.id); }}>
        <Box component="form" className="app-authoring-form app-task-authoring" onSubmit={(event) => void submitTaskEdit(event, task)}>
          <div className="app-authoring-fields">
            <section className="app-task-metadata-grid">
              <TextInput
                autoFocus label="Новое название задачи" placeholder="Введите новое название задачи"
                value={taskEdits[task.id]?.title ?? ""}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setTaskEdits((current) => ({
                    ...current,
                    [task.id]: { ...current[task.id], title: event.currentTarget.value },
                  }));
                  if (taskEditErrors[task.id]) setTaskEditErrors((current) => ({ ...current, [task.id]: "" }));
                }}
                error={taskEditErrors[task.id] || undefined}
              />
              <Select
                label="Новый язык задачи" placeholder="Выберите язык стартового кода"
                value={taskEdits[task.id]?.language ?? "nodejs"}
                onChange={(value) => setTaskEdits((current) => ({
                  ...current,
                  [task.id]: { ...current[task.id], language: value ?? "nodejs" },
                }))}
                data={LANGUAGE_OPTIONS}
              />
            </section>
            <section className="app-task-content-grid">
              <Textarea
                label="Новое описание задачи" placeholder="Опишите условие, входные данные и ожидаемый результат. Поддерживается Markdown"
                value={taskEdits[task.id]?.description ?? ""}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTaskEdits((current) => ({
                  ...current,
                  [task.id]: { ...current[task.id], description: event.currentTarget.value },
                }))}
                minRows={6}
              />
              <Textarea
                label="Новый стартовый код" placeholder="Введите стартовый код для кандидата"
                value={taskEdits[task.id]?.starterCode ?? ""}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTaskEdits((current) => ({
                  ...current,
                  [task.id]: { ...current[task.id], starterCode: event.currentTarget.value },
                }))}
                minRows={6}
              />
            </section>
          </div>
            <Group className="app-form-actions" justify="flex-end" align="center" wrap="wrap">
              <Button type="button" variant="subtle" disabled={updateTaskState.isLoading} onClick={() => cancelTaskEdit(task.id)}>Отмена</Button>
              <Button type="submit" loading={updateTaskState.isLoading} disabled={!(taskEdits[task.id]?.title ?? "").trim()}>
                Сохранить задачу
              </Button>
            </Group>

        </Box>

        </Modal>
      ) : null}

        <Group className={styles.libraryRow} gap="md" wrap="wrap">
          <div className={styles.libraryRowInfo} data-testid="team-library-row-details">
            <div className={styles.entityTitle}>
              <Text fw={700}>{task.title}</Text>

            </div>
            {task.description ? <Text c="gray.5" size="sm">{task.description}</Text> : null}
            <Group className={styles.libraryRowMetadata} gap="xs" align="center" wrap="wrap">
              <Badge variant="light">{labelForLanguage(task.language)}</Badge>
              <Text size="xs" c="gray.5">Автор: {task.createdByUserId.slice(0, 8)}</Text>
            </Group>
          </div>
          <div className={styles.libraryRowControls} data-testid="team-library-row-controls">
            <Group className={styles.libraryRowActions} role="group" aria-label={`Действия с задачей ${task.title}`} gap="xs" justify="flex-end" wrap="wrap">
                          <Button
                type="button"
                size="xs"
                variant="light"
                aria-label={`Скопировать задачу ${task.title}`}
                onClick={() => void copyExistingTask(task)}
              >
                Копировать
              </Button>
            <Button
              type="button"
              size="xs"
              variant="light"
              aria-label={`Редактировать задачу ${task.title}`}
              onClick={() => startTaskEdit(task)}
            >
              Редактировать
            </Button>
            {(team.role === "OWNER" || team.role === "ADMIN" || task.createdByUserId === accountId) ? (
              <DeleteEntityButton description="Задача исчезнет из библиотеки. В уже созданных интервью она сохранится." label={`задачу ${task.title}`} onDelete={async () => {
                await deleteTask({ ...scope, taskId: task.id }).unwrap();
              }} />
            ) : null}
            </Group>
          </div>
        </Group>

    </Card>
  );

  const taskTitleInSet = (taskSet: TeamTaskSet, taskId: string) =>
    taskSet.items.find((item) => item.taskId === taskId)?.title ??
    setTasks.find((task) => task.id === taskId)?.title ??
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
        <Modal authoring opened title="Редактировать набор" centered size="lg" onClose={() => { if (!updateTeamTaskSetState.isLoading) cancelTaskSetEdit(taskSet.id); }}>
        <Box component="form" className="app-authoring-form" onSubmit={(event) => void submitTaskSetEdit(event, taskSet)}>
          <div className="app-authoring-fields">
            <TextInput
              autoFocus label="Новое название набора" placeholder="Введите новое название набора"
              value={taskSetEdits[taskSet.id]?.name ?? ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => updateTaskSetDraft(taskSet.id, (draft) => ({
                ...draft,
                name: event.currentTarget.value,
              }))}
              error={taskSetEditErrors[taskSet.id] || undefined}
            />
            <MultiSelect label="Состав набора" aria-label="Состав набора" placeholder="Выберите задачи" searchable clearable
              value={taskSetEdits[taskSet.id]?.taskIds ?? []}
              data={[...new Map([
                ...taskSet.items.filter(item => (taskSetEdits[taskSet.id]?.taskIds ?? []).includes(item.taskId)).map(item => [item.taskId, { value: item.taskId, label: item.title }] as const),
                ...setTasks.map(task => [task.id, { value: task.id, label: task.title }] as const),
              ]).values()]}
              loading={setTaskCatalog.isFetching}
              error={setTaskCatalog.isError ? "Не удалось загрузить задачи" : undefined}
              onChange={taskIds => updateTaskSetDraft(taskSet.id, draft => ({ ...draft, taskIds }))} />
            {setTaskCatalog.isError ? <Button variant="light" onClick={() => void setTaskCatalog.refetch()}>Повторить загрузку задач</Button> : null}
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

            </div>
            <Group className="app-form-actions" justify="flex-end" align="center" wrap="wrap">
              <Button type="button" variant="subtle" disabled={updateTeamTaskSetState.isLoading} onClick={() => cancelTaskSetEdit(taskSet.id)}>Отмена</Button>
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

        </Box>

        </Modal>
      ) : null}

        <Group className={styles.libraryRow} gap="md" wrap="wrap">
          <div className={styles.libraryRowInfo} data-testid="team-library-row-details">
            <div className={styles.entityTitle}>
              <Text fw={700}>{taskSet.name}</Text>

            </div>
            <Text c="gray.5" size="sm">
              {taskSet.items.length > 0
                ? taskSet.items.map((item) => item.title).join(" → ")
                : "В наборе пока нет задач"}
            </Text>
            <Group className={styles.libraryRowMetadata} gap="xs" align="center" wrap="wrap">
              <Badge variant="light">{taskCountLabel(taskSet.items.length)}</Badge>
              <Text size="xs" c="gray.5">Автор: {taskSet.createdByUserId.slice(0, 8)}</Text>
            </Group>
          </div>
          <div className={styles.libraryRowControls} data-testid="team-library-row-controls">
            <Group className={styles.libraryRowActions} role="group" aria-label={`Действия с набором ${taskSet.name}`} gap="xs" justify="flex-end" wrap="wrap">
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
            {(team.role === "OWNER" || team.role === "ADMIN" || taskSet.createdByUserId === accountId) ? (
              <DeleteEntityButton description="Набор исчезнет из библиотеки. Задачи в уже созданных интервью сохранятся." label={`набор ${taskSet.name}`} onDelete={async () => {
                await deleteTaskSet({ ...scope, setId: taskSet.id }).unwrap();
              }} />
            ) : null}
            </Group>
          </div>
        </Group>

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
        <Tabs
          className={styles.libraryTabs}
          activeKey={libraryTab}
          onChange={(key) => setLibraryTab(key === "sets" ? "sets" : "tasks")}
          items={[
            { key: "tasks", label: "Задачи" },
            { key: "sets", label: "Наборы задач" },
          ]}
          aria-label="Содержимое библиотеки"
        />


        {libraryTab === "tasks" ? (
          <TextInput
            aria-label="Поиск задач"
            value={search}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.currentTarget.value)}
            placeholder="Поиск задач"
            className={styles.librarySearch}
          />
        ) : null}

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
      </div>


          <Modal authoring opened={createTaskOpened} onClose={() => { if (!(createTaskState.isLoading)) setCreateTaskOpened(false); }} title="Новая командная задача" centered size="xl">
            <form className="app-authoring-form app-task-authoring" onSubmit={submitTask}>
              <div className="app-authoring-fields">
                <section className="app-task-metadata-grid">
                  <TextInput
                    autoFocus label="Название задачи"
                    value={taskTitle}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setTaskTitle(event.currentTarget.value);
                      if (createError) setCreateError("");
                    }}
                    placeholder="Введите название задачи"
                    error={createError || undefined}
                  />
                  <Select
                    label="Язык задачи" placeholder="Выберите язык стартового кода"
                    value={taskLanguage}
                    onChange={(value) => setTaskLanguage(value ?? "nodejs")}
                    data={LANGUAGE_OPTIONS}
                  />
                </section>
                <section className="app-task-content-grid">
                  <Textarea
                    label="Описание задачи" placeholder="Опишите условие, входные данные и ожидаемый результат. Поддерживается Markdown"
                    value={taskDescription}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTaskDescription(event.currentTarget.value)}
                    minRows={6}
                  />
                  <Textarea
                    label="Стартовый код" placeholder="Введите стартовый код для кандидата"
                    value={taskCode}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTaskCode(event.currentTarget.value)}
                    minRows={6}
                  />
                </section>
              </div>
            <Group className="app-form-actions" justify="flex-end" align="center" wrap="wrap">
                  <Button type="button" variant="subtle" disabled={createTaskState.isLoading} onClick={() => setCreateTaskOpened(false)}>Отмена</Button>
                  <Button type="submit" color="blue" loading={createTaskState.isLoading} disabled={!taskTitle.trim()}>
                    Создать задачу
                  </Button>
                </Group>

            </form>
          </Modal>
          <Modal opened={importTaskOpened} onClose={() => { if (!(importPersonalTaskState.isLoading || createTaskState.isLoading)) setImportTaskOpened(false); }} title="Импортировать задачу" centered size="lg">
            <form onSubmit={submitPersonalImport}>
              <Stack gap="sm">
                <Text c="gray.5" size="sm">
                  Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке. Можно также указать ID своей личной задачи.
                </Text>
                <Textarea
                  label="Данные задачи или ID личной задачи" placeholder="Вставьте скопированные данные задачи или её ID вида 123e4567-e89b-12d3-a456-426614174000"
                  value={personalSourceTaskId}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setPersonalSourceTaskId(event.currentTarget.value);
                    if (importError) setImportError("");
                  }}
                  minRows={5}
                  error={importError || undefined}
                />
                <Group justify="flex-end" align="center" wrap="wrap">
                  <Button type="button" variant="subtle" disabled={importPersonalTaskState.isLoading || createTaskState.isLoading} onClick={() => setImportTaskOpened(false)}>Отмена</Button>
                  <Button type="submit" loading={importPersonalTaskState.isLoading || createTaskState.isLoading} disabled={!personalSourceTaskId.trim()}>
                    Импортировать задачу
                  </Button>
                </Group>
              </Stack>
            </form>
          </Modal>
          <Modal opened={importPresetOpened} onClose={() => { if (!(importPersonalPresetToTeamState.isLoading || createTaskSetState.isLoading)) setImportPresetOpened(false); }} title="Импортировать набор" centered size="lg">
            <form onSubmit={submitPersonalPresetImport}>
              <Stack gap="sm">
                <Text c="gray.5" size="sm">
                  Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке. Можно также указать ID своего личного набора.
                </Text>
                <Textarea
                  label="Данные набора или ID личного набора" placeholder="Вставьте скопированные данные набора или его ID вида 123e4567-e89b-12d3-a456-426614174000"
                  value={personalSourcePresetId}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setPersonalSourcePresetId(event.currentTarget.value);
                    if (presetImportError) setPresetImportError("");
                  }}
                  minRows={6}
                  error={presetImportError || undefined}
                />
                <Group justify="flex-end" align="center" wrap="wrap">
                  <Button type="button" variant="subtle" disabled={importPersonalPresetToTeamState.isLoading || createTaskSetState.isLoading} onClick={() => setImportPresetOpened(false)}>Отмена</Button>
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
          <Modal authoring opened={createSetOpened} onClose={() => { if (!(createTaskSetState.isLoading)) setCreateSetOpened(false); }} title="Новый командный набор" centered size="lg">
            <form className="app-authoring-form" onSubmit={submitTaskSet}>
              <div className="app-authoring-fields">

                <TextInput
                  autoFocus label="Название набора"
                  value={taskSetName}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setTaskSetName(event.currentTarget.value);
                    if (taskSetError) setTaskSetError("");
                  }}
                  placeholder="Введите название набора"
                  error={taskSetError || undefined}
                />
                <MultiSelect label="Задачи набора" aria-label="Задачи набора" placeholder="Выберите задачи" searchable clearable
                  value={taskSetTaskIds} data={setTasks.map(task => ({ value: task.id, label: task.title }))}
                  onChange={ids => { setTaskSetTaskIds(ids); setTaskSetError(""); }} disabled={setTaskCatalog.isLoading || setTasks.length === 0} loading={setTaskCatalog.isFetching} error={setTaskCatalog.isError ? "Не удалось загрузить задачи" : undefined} />
                {setTaskCatalog.isError ? <Button variant="light" onClick={() => void setTaskCatalog.refetch()}>Повторить загрузку задач</Button> : null}
                </div>
            <Group className="app-form-actions" justify="flex-end" align="center" wrap="wrap">
                  <Button type="button" variant="subtle" disabled={createTaskSetState.isLoading} onClick={() => setCreateSetOpened(false)}>Отмена</Button>
                  <Button
                    type="submit"
                    color="blue"
                    loading={createTaskSetState.isLoading}
                    disabled={!taskSetName.trim() || taskSetTaskIds.length === 0}
                  >
                    Создать набор
                  </Button>
                </Group>

            </form>
          </Modal>

      {libraryTab === "tasks" && actionError ? (
        <Alert color="red" role="alert" title="Действие не выполнено">
          {actionError}
        </Alert>
      ) : null}

      {libraryTab === "tasks" ? <Card className={styles.libraryListSurface} withBorder={false}>
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
            <div className={styles.languageControl}>
              <span>Язык задач</span>
              <Select
                aria-label="Фильтр языка задач"
                value={languageFilter}
                data={[{ value: "", label: "Все языки" }, ...LANGUAGE_OPTIONS]}
                onChange={(value) => setLanguageFilter(value ?? "")}
              />
            </div>
          </Group>
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

      {libraryTab === "sets" ? <Card className={styles.libraryListSurface} withBorder={false}>
        <Stack gap="sm">
          <Group justify="space-between" align="center" gap="md" wrap="wrap">
            <Stack gap={4}>
              <Text fw={700}>Наборы задач</Text>
              <Text c="gray.5" size="sm">Переиспользуемые подборки командных задач для будущих интервью.</Text>
            </Stack>
            <Button type="button" variant="light" leftSection={<IconRefresh size={16} />} onClick={() => void refetchTaskSets()} loading={isTaskSetFetching && !isTaskSetLoading}>
              Обновить наборы
            </Button>
          </Group>
          {isTaskSetLoading ? <Text aria-live="polite">Загружаем наборы</Text> : null}
          {!isTaskSetLoading && taskSetLoadError ? (
            <Alert color="red" role="alert" title="Не удалось загрузить наборы">
              <Button type="button" size="xs" variant="light" mt="sm" onClick={() => void refetchTaskSets()}>Повторить</Button>
            </Alert>
          ) : null}
          {!isTaskSetLoading && !taskSetLoadError && taskSets.length === 0 ? (
            <Card className={styles.emptyState} withBorder>
              <Text component="div" fw={700}>Наборов пока нет</Text>
              <Text c="gray.5" size="sm">
                Нажмите «Создать набор» и выберите задачи для первого командного набора.
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
    programmeLibraryScope,
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
  const [saveVacancyProgrammeDraft, saveVacancyProgrammeDraftState] = useSaveTeamVacancyProgrammeDraftMutation();
  const [publishVacancyProgramme, publishVacancyProgrammeState] = usePublishTeamVacancyProgrammeMutation();
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
    saveVacancyProgrammeDraftState.isLoading ||
    publishVacancyProgrammeState.isLoading;

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
      const saved = await saveTrackProgrammeDraft({
        ...scope,
        trackId: track.id,
        taskIds,
        revision: track.programme?.revision ?? null,
      }).unwrap();
      const savedProgramme = saved.programme;
      if (!savedProgramme) throw new Error("Programme draft was not returned");
      await publishTrackProgramme({ ...scope, trackId: track.id, revision: savedProgramme.revision }).unwrap();
      cancelProgrammeEdit(key);
      void refetch();
    } catch {
      setProgrammeErrors((current) => ({
        ...current,
        [key]: "Не удалось сохранить задачи трека. Обновите данные и попробуйте ещё раз.",
      }));
      void refetch();
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
      const saved = await saveVacancyProgrammeDraft({
        ...scope,
        trackId: track.id,
        vacancyId: vacancy.id,
        taskIds,
        revision: ownProgramme?.revision ?? null,
      }).unwrap();
      const savedProgramme = saved.programme;
      if (!savedProgramme) throw new Error("Programme draft was not returned");
      await publishVacancyProgramme({
        ...scope,
        trackId: track.id,
        vacancyId: vacancy.id,
        revision: savedProgramme.revision,
      }).unwrap();
      cancelProgrammeEdit(key);
      void refetch();
    } catch {
      setProgrammeErrors((current) => ({
        ...current,
        [key]: "Не удалось сохранить задачи вакансии. Обновите данные и попробуйте ещё раз.",
      }));
      void refetch();
    }
  };

  const renderProgrammeEditor = (
    key: string,
    title: string,
    onSubmit: (event: FormEvent) => void,
  ) => {
    const selectedTaskIds = programmeEdits[key] ?? [];
    return (
      <Modal authoring opened title={title} centered size="lg" onClose={() => { if (!programmeActionLoading) cancelProgrammeEdit(key); }}>
      <Box component="form" className={`app-authoring-form ${styles.programmeEditor}`} onSubmit={onSubmit}>
        <div className="app-authoring-fields">
          <Group justify="space-between" align="center" gap="sm" wrap="wrap">
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
              <MultiSelect label="Задачи для интервью" aria-label="Задачи для интервью" placeholder="Выберите задачи" searchable clearable
                value={selectedTaskIds} data={programmeTasks.map(task => ({ value: task.id, label: task.title }))}
                onChange={taskIds => updateProgrammeDraft(key, () => taskIds)} />
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

            </React.Fragment>
          ) : null}
          {programmeErrors[key] ? <Text role="alert" c="red.4" size="sm">{programmeErrors[key]}</Text> : null}
          </div>
            <Group className="app-form-actions" justify="flex-end" align="center" wrap="wrap">
            <Button type="button" variant="subtle" disabled={programmeActionLoading} onClick={() => cancelProgrammeEdit(key)}>Отмена</Button>
            <Button
              type="submit"
              loading={saveTrackProgrammeDraftState.isLoading || saveVacancyProgrammeDraftState.isLoading}
              disabled={selectedTaskIds.length === 0 || programmeActionLoading}
            >
              Сохранить задачи
            </Button>
          </Group>

      </Box>
      </Modal>
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
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearch(event.currentTarget.value)}
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
        <Text size="sm" c="blue.3">
          Активные: {counts.activeTracks} треков / {counts.activeVacancies} вакансий · Архив:
          {" "}{counts.archivedTracks} треков / {counts.archivedVacancies} вакансий
        </Text>
      ) : null}

      <Modal opened={trackCreateOpened} onClose={() => { if (!(createTrackState.isLoading)) setTrackCreateOpened(false); }} title="Новый трек" centered size="sm">
          <form onSubmit={submitTrack}>
            <Stack gap="sm">
              <TextInput
                autoFocus label="Название трека"
                value={trackName}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setTrackName(event.currentTarget.value);
                  if (trackError) setTrackError("");
                }}
                placeholder="Введите название трека"
                error={trackError || undefined}
              />
              <Group justify="flex-end" align="center" wrap="wrap">
                  <Button type="button" variant="subtle" disabled={createTrackState.isLoading} onClick={() => setTrackCreateOpened(false)}>Отмена</Button>
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
            <Card key={track.id} className={`${styles.panel} ${styles.trackPanel}`} withBorder={false} role="region" aria-label={`Архивный трек ${track.name}`}>
              <Group justify="space-between" align="center" wrap="wrap">
                <Stack gap="xs">
                  <Text fw={700}>{track.name}</Text>
                  <Text size="sm" c="gray.5">Архивный трек · {track.vacancies.length} вакансий</Text>
                </Stack>
                {canManage ? <Group gap="xs"><Button type="button" variant="light" color="green" aria-label={`Восстановить трек ${track.name}`} loading={archiveActionLoading} onClick={() => void toggleTrackArchive(track)}>Восстановить трек</Button><DeleteEntityButton label={`трек ${track.name}`} onDelete={async () => { await deleteTrack({ ...scope, trackId: track.id }).unwrap(); void refetch(); }} /></Group> : null}
              </Group>
            </Card>
          ))}
          {archivedVacancies.map(({ track, vacancy }) => (
            <Card key={vacancy.id} className={`${styles.panel} ${styles.trackPanel}`} withBorder={false} role="region" aria-label={`Архивная вакансия ${vacancy.title}`}>
              <Group justify="space-between" align="center" wrap="wrap">
                <Stack gap="xs">
                  <Text fw={700}>{vacancy.title}</Text>
                  <Text size="sm" c="gray.5">Трек: {track.name}</Text>
                </Stack>
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
              className={`${styles.panel} ${styles.trackHierarchyPanel}`}
              withBorder
              role="region"
              aria-label={`Трек ${track.name}`}
            >
              <Stack gap="md">
                <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                  {track.id in trackEdits ? (
                    <Modal opened title="Переименовать трек" centered size="sm" onClose={() => { if (!updateTrackState.isLoading) { setTrackEdits((current) => { const next = { ...current }; delete next[track.id]; return next; }); setTrackEditErrors((current) => ({ ...current, [track.id]: "" })); } }}>

                    <Box component="form" className={styles.trackEditForm} onSubmit={(event) => void submitTrackEdit(event, track)}>
                      <TextInput
                        autoFocus label="Новое название трека" placeholder="Введите новое название трека"
                        value={trackEdits[track.id] ?? ""}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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
                          disabled={updateTrackState.isLoading}
                          onClick={() => {
                            setTrackEdits((current) => {
                              const next = { ...current };
                              delete next[track.id];
                              return next;
                            });
                            setTrackEditErrors((current) => ({ ...current, [track.id]: "" }));
                          }}
                        >
                          Отмена
                        </Button>
                        <Button type="submit" loading={updateTrackState.isLoading} disabled={!(trackEdits[track.id] ?? "").trim()}>
                          Сохранить трек
                        </Button>
                      </Group>
                    </Box>

                    </Modal>
                  ) : null}

                    <div className={styles.entityTitle}>
                      <Title order={2} style={{ fontSize: 18, margin: 0 }}>{track.name}</Title>
                      {canManage ? (
                        <ActionIcon variant="subtle" aria-label={`Переименовать трек ${track.name}`} onClick={() => setTrackEdits((current) => ({ ...current, [track.id]: track.name }))}>
                          <IconPencil size={16} aria-hidden="true" />
                        </ActionIcon>
                      ) : null}
                    </div>

                  <Group gap="xs" align="center" justify="flex-end" wrap="wrap">
                    <Badge variant="light" color={track.status === "ACTIVE" ? "teal" : "gray"}>Трек · {track.status === "ACTIVE" ? "активен" : "архив"}</Badge>
                    {canManage ? (
                      <React.Fragment>
                        <Button
                          type="button"
                          size="xs"
                          variant="subtle"
                          color={mode === "active" ? "orange" : "green"}
                          className={mode === "active" ? styles.archiveAction : styles.restoreAction}
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

                <Stack gap="sm" className={styles.trackTasksBlock}>
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
                  </Group>
                ) : null}
                {programmeKey("track", track.id) in programmeEdits
                  ? renderProgrammeEditor(
                      programmeKey("track", track.id),
                      `Задачи трека ${track.name}`,
                      (event) => void submitTrackProgrammeDraft(event, track),
                    )
                  : null}

                </Stack>

                {track.vacancies.length === 0 ? (
                  <Text c="gray.5" size="sm">В этом треке пока нет вакансий</Text>
                ) : (
                  <Stack gap="sm" className={styles.trackVacancyList} aria-label={`Вакансии трека ${track.name}`}>
                    <Text fw={700} size="sm" c="blue.2">Вакансии трека</Text>
                    {track.vacancies.map((vacancy) => (
                      <Box key={vacancy.id} className={styles.trackVacancyCard} role="region" aria-label={`Вакансия ${vacancy.title}`} data-testid="team-track-vacancy-row">
                        {vacancy.id in vacancyEdits ? (
                          <Modal opened title="Переименовать вакансию" centered size="sm" onClose={() => { if (!updateVacancyState.isLoading) { setVacancyEdits((current) => { const next = { ...current }; delete next[vacancy.id]; return next; }); setVacancyEditErrors((current) => ({ ...current, [vacancy.id]: "" })); } }}>

                          <Box component="form" onSubmit={(event) => void submitVacancyEdit(event, track, vacancy)}>
                            <TextInput
                              autoFocus label="Новое название вакансии" placeholder="Введите новое название вакансии"
                              value={vacancyEdits[vacancy.id] ?? ""}
                              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
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
                                disabled={updateVacancyState.isLoading}
                                onClick={() => {
                                  setVacancyEdits((current) => {
                                    const next = { ...current };
                                    delete next[vacancy.id];
                                    return next;
                                  });
                                  setVacancyEditErrors((current) => ({ ...current, [vacancy.id]: "" }));
                                }}
                              >
                                Отмена
                              </Button>
                              <Button type="submit" loading={updateVacancyState.isLoading} disabled={!(vacancyEdits[vacancy.id] ?? "").trim()}>
                                Сохранить вакансию
                              </Button>
                            </Group>
                          </Box>

                          </Modal>
                        ) : null}

                          <Stack gap="sm">
                            <Group justify="space-between" align="center" gap="sm" wrap="wrap">
                              <div className={styles.entityTitle}>
                                <Text fw={650}>{vacancy.title}</Text>
                                {canManage ? (
                                  <ActionIcon variant="subtle" aria-label={`Переименовать вакансию ${vacancy.title}`} onClick={() => setVacancyEdits((current) => ({ ...current, [vacancy.id]: vacancy.title }))}>
                                    <IconPencil size={16} aria-hidden="true" />
                                  </ActionIcon>
                                ) : null}
                              </div>
                              <Group gap="xs" align="center" justify="flex-end" wrap="wrap">
                                <Badge variant="light" color={vacancy.status === "ACTIVE" ? "blue" : "gray"}>Вакансия · {vacancy.status === "ACTIVE" ? "активна" : "архив"}</Badge>
                                {canManage ? (
                                  <React.Fragment>
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="subtle"
                                      color={mode === "active" ? "orange" : "green"}
                                      className={mode === "active" ? styles.archiveAction : styles.restoreAction}
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
        onClose={() => { if (!createVacancyState.isLoading) { setVacancyCreateOpened(false); setVacancyCreateTrackId(null); } }}
        title="Новая вакансия"
        centered
        size="sm"
      >
        <Stack gap="sm">
        <Select
          label="Трек вакансии"
          placeholder="Выберите трек"
          data={tracks.filter((track) => track.status === "ACTIVE").map((track) => ({ value: track.id, label: track.name }))}
          value={vacancyCreateTrackId}
          onChange={setVacancyCreateTrackId}
          style={{ width: "100%" }}
        />
        {vacancyCreateTrack ? (
          <form onSubmit={(event) => void submitVacancy(event, vacancyCreateTrack)}>
            <Stack gap="sm">
              <TextInput
                autoFocus label="Название вакансии"
                value={vacancyDrafts[vacancyCreateTrack.id] ?? ""}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  const value = event.currentTarget.value;
                  setVacancyDrafts((current) => ({ ...current, [vacancyCreateTrack.id]: value }));
                  if (vacancyErrors[vacancyCreateTrack.id]) {
                    setVacancyErrors((current) => ({ ...current, [vacancyCreateTrack.id]: "" }));
                  }
                }}
                placeholder="Введите название вакансии"
                error={vacancyErrors[vacancyCreateTrack.id] || undefined}
              />
              <Group justify="flex-end" align="center" wrap="wrap">
                  <Button type="button" variant="subtle" disabled={createVacancyState.isLoading} onClick={() => setVacancyCreateOpened(false)}>Отмена</Button>
                <Button type="submit" color="blue" loading={createVacancyState.isLoading} disabled={!(vacancyDrafts[vacancyCreateTrack.id] ?? "").trim()}>
                  Создать вакансию
                </Button>
              </Group>
            </Stack>
          </form>
        ) : <Text size="sm" c="gray.5">Сначала выберите трек, к которому относится вакансия.</Text>}
        </Stack>
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
        <Text c="gray.5" size="sm">Сейчас здесь нет подстановки данных из личного раздела.</Text>
      </Card>
    </Stack>
  );
}

function TeamWorkspaceLoading({ section }: { section: TeamSection }) {
  const intro = section === "library"
    ? { eyebrow: "Командные материалы", title: "Библиотека", description: "Задачи команды хранятся отдельно от личной библиотеки и доступны активным участникам." }
    : section === "tracks"
      ? { eyebrow: "Командный справочник", title: "Треки и вакансии", description: "Трек объединяет вакансии. Задачи трека добавляются в интервью по умолчанию; задачи вакансии заменяют их, если настроены." }
      : section === "settings" || section === "members"
        ? { eyebrow: "Команда", title: "Настройки команды", description: "Права и изменения подтверждаются сервером при каждом действии." }
        : section === "profile"
          ? { eyebrow: "Настройки аккаунта", title: "Профиль", description: "" }
          : section === "candidates"
            ? { eyebrow: "", title: "Кандидаты и интервью", description: "" }
            : { eyebrow: "Командная лента", title: "Интервью", description: "Здесь появятся только интервью, доступные вам в этой команде." };

  return (
    <Stack gap="lg" role="status" aria-label="Проверяем доступ к команде" aria-busy="true">
      <span className="visually-hidden">Проверяем доступ к команде…</span>
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          {intro.eyebrow ? <Text className={styles.eyebrow}>{intro.eyebrow}</Text> : null}
          <Title order={section === "candidates" ? 2 : 1}>{intro.title}</Title>
          {intro.description ? <Text c="gray.5" mt={6}>{intro.description}</Text> : null}
        </div>
      </Group>
      <div className={styles.loadingFields} aria-hidden="true">
        <div className={styles.loadingField} />
        <div className={styles.loadingField} />
      </div>
      <div className={styles.loadingCard} aria-hidden="true">
        <div className={styles.loadingLine} />
        <div className={styles.loadingLine} />
        <div className={styles.loadingField} />
      </div>
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
  const [settingsTooltipOpen, setSettingsTooltipOpen] = useState(false);
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
    if (reason === "mutation" && identityRef.current !== contextKey) return null;
    const previous = activeDetailRef.current;
    if (reason === "focus" && (previous?.reason === "focus" || previous?.reason === "mutation") && previous.contextKey === contextKey) {
      return previous;
    }
    previous?.request.abort();
    if (activeDetailRef.current === previous) activeDetailRef.current = null;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const requestContext = contextKey;
    setAuthorization((current) => (reason === "focus" || reason === "mutation") && current.contextKey === requestContext && current.status === "ready"
      ? { ...current, refreshFailed: false }
      : { contextKey: requestContext, reason, status: "loading", team: null });
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
        const status = failure && typeof failure === "object" && "status" in failure ? failure.status : null;
        const denied = status === 401 || status === 403 || status === 404;
        setAuthorization((current) => reason === "focus" && !denied && current.contextKey === requestContext && current.status === "ready"
          ? { ...current, refreshFailed: true }
          : { contextKey: requestContext, reason, status: "unavailable", team: null });
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

  useEffect(() => {
    const closeSettingsTooltip = () => setSettingsTooltipOpen(false);
    closeSettingsTooltip();
    window.addEventListener("resize", closeSettingsTooltip);
    window.visualViewport?.addEventListener("resize", closeSettingsTooltip);
    return () => {
      window.removeEventListener("resize", closeSettingsTooltip);
      window.visualViewport?.removeEventListener("resize", closeSettingsTooltip);
    };
  }, [auth.token, contextKey, location.pathname]);

  if (!auth.token) return <Navigate to="/login" replace />;
  if (!teamId || !section) return <Navigate to={`/workspace/teams/${teamId}/interviews`} replace />;
  if (section === "members") return <Navigate to={`/workspace/teams/${teamId}/settings${location.search}`} replace />;

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
        : section === "settings"
          ? "Настройки команды"
          : section === "profile"
            ? "Профиль"
            : section === "candidates"
              ? "Кандидаты"
            : "Интервью";
  const sectionContextKey = contextKey;

  return (
    <Box className={styles.page}>
      <header className={styles.header}>
        <Container size="xl" className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">IH</span>
            <div className={styles.brandText}>
              <Text className={styles.brandLabel} fw={800}>InterHub</Text>
              {team ? (
                <Text size="xs" c="gray.5">{team.role === "OWNER" ? "Владелец команды" : team.role === "ADMIN" ? "Администратор" : "Участник команды"}</Text>
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
            <Tooltip title="Настройки команды" trigger={["hover", "focus"]} motion={{ motionName: "" }} open={settingsTooltipOpen} onOpenChange={setSettingsTooltipOpen}>
              {team ? (
                <NavLink to={`/workspace/teams/${teamId}/settings`} className={`${styles.settingsGear} app-header-control`} aria-label="Настройки команды">
                  <SettingOutlined aria-hidden="true" />
                </NavLink>
              ) : (
                <AntButton type="text" className={`${styles.settingsGear} app-header-control`} disabled tabIndex={-1} aria-label="Настройки команды"><SettingOutlined aria-hidden="true" /></AntButton>
              )}
            </Tooltip>
          </div>
          <TeamNavigation teamId={teamId} authorized={Boolean(team)} isAdmin={auth.user?.role === "admin"} />
          <Group className={styles.userControls} gap="sm" align="center" wrap="nowrap">
            <NavLink to={`/workspace/teams/${teamId}/profile`} className={`${styles.userName} app-header-control`} aria-label={`Открыть профиль @${auth.user?.nickname}`}>
              <IconUserCircle size={16} aria-hidden="true" />
              <span className={styles.userNameText}>@{auth.user?.nickname}</span>
            </NavLink>
            <Button
              type="button"
              variant="subtle"
              className="app-header-control"
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
            <ThemeToggleButton />
          </Group>
        </Container>
      </header>
      <main aria-label={team ? `Команда ${team.name}: ${sectionTitle}` : "Проверка доступа к команде"}>
        <Container size="xl" className={styles.content}>
          {stateForContext?.refreshFailed ? <Alert color="orange" role="alert" title="Не удалось обновить доступ к команде"><Text size="sm">Черновик сохранён. Повторите проверку подключения.</Text><Button type="button" variant="light" onClick={() => void revalidateDetail("focus")}>Повторить проверку</Button></Alert> : null}
          {detailStatus === "loading" ? (
            <TeamWorkspaceLoading section={section} />
          ) : null}
          {detailStatus === "unavailable" ? (
            <Alert color="red" role="alert" title="Команда недоступна">
              <Text size="sm" mb="sm">Доступ не подтверждён. Данные команды скрыты.</Text>
              <Button type="button" variant="light" onClick={() => void revalidateDetail("retry")}>Повторить</Button>
            </Alert>
          ) : null}
          {detailStatus === "ready" && team ? (
            <React.Fragment key={sectionContextKey}>
              {section === "candidates" && auth.user && auth.token ? <HrCabinetSection key={`${auth.user.id}:${teamId}`} user={auth.user} token={auth.token} teamId={teamId} /> : null}
              {section === "interviews" ? (
                <TeamInterviewList accountId={auth.user?.id ?? ""} teamId={teamId} />
              ) : null}
              {section === "create" ? (
                <React.Fragment>
                  <TeamInterviewList accountId={auth.user?.id ?? ""} teamId={teamId} />
                  <TeamCreateInterview accountId={auth.user?.id ?? ""} teamId={teamId} />
                </React.Fragment>
              ) : null}
              {section === "settings" ? (
                <Stack gap="xl">
                <TeamManagementSettings
                  accountId={auth.user?.id ?? ""}
                  team={team}
                  onTeamRefresh={() => {
                    const active = revalidateDetail("mutation");
                    return active
                      ? active.request.unwrap().catch(() => null)
                      : Promise.resolve(null);
                  }}
                />
                </Stack>
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
