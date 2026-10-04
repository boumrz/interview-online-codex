import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useAppSelector } from "../../app/hooks";
import { IconPencil, IconTrash } from "components/antd-icons";
import {
  Alert,
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from "components/antd-compat";
import {
  useLeaveTeamMutation,
  useRenameTeamMutation,
  useRemoveTeamMemberMutation,
  useTransferTeamOwnershipMutation,
  useUpdateTeamMemberRoleMutation,
} from "../../services/api";
import type {
  TeamDetail,
  TeamMemberDirectoryItem,
  TeamManagementTeam,
} from "../../types";
import {
  createManagementIntent,
  managementErrorKind,
  managementErrorMessage,
  type ManagementErrorKind,
  type ManagementIntent,
} from "./teamManagementIntent";
import styles from "./TeamManagementSettings.module.css";
import { TeamMemberDirectory } from "./TeamMemberDirectory";
import { TeamInvitationManagement } from "./TeamInvitationManagement";

type Props = {
  readonly accountId: string;
  readonly team: TeamDetail;
  readonly onTeamRefresh: () => Promise<TeamDetail | null>;
};

type RenameBody = { name: string; revision: number };
type RoleBody = { userId: string; role: "ADMIN" | "MEMBER"; revision: number };
type TransferBody = { targetUserId: string; revision: number };
type LeaveBody = Record<string, never>;
type RemoveBody = { userId: string };
type RetryAction =
  | { kind: "rename"; intent: ManagementIntent<RenameBody> }
  | { kind: "role"; intent: ManagementIntent<RoleBody> }
  | { kind: "transfer"; intent: ManagementIntent<TransferBody> }
  | { kind: "leave"; intent: ManagementIntent<LeaveBody> }
  | { kind: "remove"; intent: ManagementIntent<RemoveBody> };
type CommandProblem = { kind: ManagementErrorKind; retry: RetryAction | null };

function roleLabel(role: TeamManagementTeam["role"]): string {
  if (role === "OWNER") return "Владелец";
  if (role === "ADMIN") return "Администратор";
  return "Участник";
}

export function TeamManagementSettings({ accountId, team, onTeamRefresh }: Props) {
  const { notification } = App.useApp();
  const authToken = useAppSelector((state) => state.auth.token);
  const actionContext = `${accountId}:${authToken}:${team.id}`;
  const actionContextRef = useRef<string | null>(actionContext);
  actionContextRef.current = actionContext;
  useEffect(() => {
    actionContextRef.current = actionContext;
    return () => { actionContextRef.current = null; };
  }, [actionContext]);
  const isCurrentAction = (requestContext: string | null) => (
    actionContextRef.current === requestContext && localStorage.getItem("auth_token") === authToken
  );
  const [visibleTeam, setVisibleTeam] = useState<TeamManagementTeam>(team);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [renameOpened, setRenameOpened] = useState(false);
  const [problem, setProblem] = useState<CommandProblem | null>(null);
  const [roleOpened, setRoleOpened] = useState(false);
  const [transferOpened, setTransferOpened] = useState(false);
  const [leaveOpened, setLeaveOpened] = useState(false);
  const [removeOpened, setRemoveOpened] = useState(false);
  const [selectedRoleTarget, setSelectedRoleTarget] = useState<TeamMemberDirectoryItem | null>(null);
  const [roleDraft, setRoleDraft] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [selectedTransferTarget, setSelectedTransferTarget] = useState<TeamMemberDirectoryItem | null>(null);
  const [selectedRemoveTarget, setSelectedRemoveTarget] = useState<TeamMemberDirectoryItem | null>(null);
  const [authorityRefreshPending, setAuthorityRefreshPending] = useState(false);
  const [authorityRefreshFailed, setAuthorityRefreshFailed] = useState(false);
  const settingsIntroRef = useRef<HTMLElement | null>(null);
  const actionInitiatorRef = useRef<HTMLElement | null>(null);
  const completedActionFocusRef = useRef(false);
  const restoreTransferFocusRef = useRef(false);
  const confirmedRoleRef = useRef(team.role);

  useEffect(() => {
    setVisibleTeam(team);
    if (!renameOpened || team.role === "MEMBER") setNameDraft(team.name);
    setAuthorityRefreshPending(false);
    setAuthorityRefreshFailed(false);
    const previousRole = confirmedRoleRef.current;
    if (team.role !== "OWNER") {
      setRoleOpened(false);
      setTransferOpened(false);
    }
    if (team.role !== "OWNER" && team.role !== "ADMIN") {
      setRenameOpened(false);
      setRemoveOpened(false);
    }
    if (team.role === "OWNER") setLeaveOpened(false);
    if ((previousRole === "OWNER" && team.role !== "OWNER")
      || (previousRole === "ADMIN" && team.role === "MEMBER")) setProblem(null);
    confirmedRoleRef.current = team.role;
  }, [team]);

  const isOwner = visibleTeam.role === "OWNER";
  const isManager = isOwner || visibleTeam.role === "ADMIN";
  const managementActionsWithheld = authorityRefreshPending || authorityRefreshFailed;
  const scope = useMemo(() => ({ accountId, kind: "TEAM" as const, teamId: visibleTeam.id, query: "" }), [accountId, visibleTeam.id]);
  const [renameTeam] = useRenameTeamMutation();
  const [updateRole] = useUpdateTeamMemberRoleMutation();
  const [transferOwnership] = useTransferTeamOwnershipMutation();
  const [leaveTeam] = useLeaveTeamMutation();
  const [removeTeamMember] = useRemoveTeamMemberMutation();

  const reconcileMembers = useCallback((members: readonly TeamMemberDirectoryItem[]) => {
    const reconcile = (current: TeamMemberDirectoryItem | null) => current
      ? members.find(member => member.userId === current.userId) ?? current
      : null;
    setSelectedRoleTarget(reconcile);
    setSelectedTransferTarget(reconcile);
    setSelectedRemoveTarget(reconcile);
  }, []);

  const captureActionInitiator = () => {
    actionInitiatorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    completedActionFocusRef.current = false;
  };

  const restoreCompletedActionFocus = (opened: boolean) => {
    if (opened || !completedActionFocusRef.current) return;
    completedActionFocusRef.current = false;
    const initiator = actionInitiatorRef.current;
    if (initiator?.isConnected && !initiator.matches(":disabled")) {
      initiator.focus({ preventScroll: true });
    } else {
      settingsIntroRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    }
  };

  const showCommandProblem = (error: unknown, retry: RetryAction | null) => {
    const kind = managementErrorKind(error);
    setProblem({ kind, retry: kind === "retryable" ? retry : null });
  };

  const reconcileAuthority = async (withholdRevisionBoundActions = false) => {
    if (withholdRevisionBoundActions) {
      setAuthorityRefreshPending(true);
      setAuthorityRefreshFailed(false);
    }
    const refreshedTeam = await onTeamRefresh();
    if (!refreshedTeam) {
      if (withholdRevisionBoundActions) {
        setAuthorityRefreshFailed(true);
        setAuthorityRefreshPending(false);
      }
      return null;
    }
    setVisibleTeam(refreshedTeam);
    if (!renameOpened || refreshedTeam.role === "MEMBER") setNameDraft(refreshedTeam.name);
    if (withholdRevisionBoundActions) setAuthorityRefreshPending(false);
    return refreshedTeam;
  };

  const refreshAuthority = () => {
    void reconcileAuthority(true);
  };

  const executeRename = async (intent: ManagementIntent<RenameBody>) => {
    const requestContext = actionContextRef.current;
    setProblem(null);
    try {
      const result = await renameTeam({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      if (!isCurrentAction(requestContext)) return;
      setVisibleTeam(result.team);
      setNameDraft(result.team.name);
      setRenameOpened(false);
      notification.success({ title: result.outcome === "UNCHANGED" ? "Название команды уже актуально" : "Название команды сохранено", placement: "top", role: "status" });
      completedActionFocusRef.current = true;
      void reconcileAuthority(true);
    } catch (error) {
      if (!isCurrentAction(requestContext)) return;
      showCommandProblem(error, { kind: "rename", intent });
    }
  };

  const submitRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (managementActionsWithheld || !isManager) return;
    const retry = problem?.retry;
    const intent = retry?.kind === "rename" && retry.intent.body.name === nameDraft
      ? retry.intent
      : createManagementIntent({ name: nameDraft, revision: visibleTeam.revision });
    void executeRename(intent);
  };

  const openRoleDialog = (member: TeamMemberDirectoryItem) => {
    if (managementActionsWithheld || !isOwner || member.userId === accountId || member.role === "OWNER") return;
    captureActionInitiator();
    setProblem(null);
    setSelectedRoleTarget(member);
    setRoleDraft(member.role === "ADMIN" ? "ADMIN" : "MEMBER");
    setRoleOpened(true);
  };

  const executeRole = async (intent: ManagementIntent<RoleBody>) => {
    const requestContext = actionContextRef.current;
    setProblem(null);
    try {
      const result = await updateRole({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      if (!isCurrentAction(requestContext)) return;
      setRoleOpened(false);
      notification.success({ title: result.outcome === "UNCHANGED" ? "Роль участника уже актуальна" : "Роль участника изменена", placement: "top", role: "status" });
      completedActionFocusRef.current = true;
      void reconcileAuthority(true);
    } catch (error) {
      if (!isCurrentAction(requestContext)) return;
      showCommandProblem(error, { kind: "role", intent });
    }
  };

  const submitRole = () => {
    if (managementActionsWithheld || !isOwner || !selectedRoleTarget) return;
    void executeRole(createManagementIntent({
      userId: selectedRoleTarget.userId,
      role: roleDraft,
      revision: selectedRoleTarget.revision,
    }));
  };

  const closeTransfer = () => {
    restoreTransferFocusRef.current = true;
    actionInitiatorRef.current?.focus();
    setTransferOpened(false);
    window.queueMicrotask(() => actionInitiatorRef.current?.focus());
    window.setTimeout(() => actionInitiatorRef.current?.focus(), 0);
  };

  const openTransferDialog = (member: TeamMemberDirectoryItem) => {
    if (managementActionsWithheld || !isOwner || member.userId === accountId || member.role === "OWNER") return;
    captureActionInitiator();
    setSelectedTransferTarget(member);
    setProblem(null);
    setTransferOpened(true);
  };

  const executeTransfer = async (intent: ManagementIntent<TransferBody>) => {
    const requestContext = actionContextRef.current;
    setProblem(null);
    try {
      const result = await transferOwnership({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      if (!isCurrentAction(requestContext)) return;
      setVisibleTeam(result.team);
      setTransferOpened(false);
      notification.success({ title: "Владение командой передано. Вы остаетесь администратором.", placement: "top", role: "status" });
      completedActionFocusRef.current = true;
      void reconcileAuthority(true);
    } catch (error) {
      if (!isCurrentAction(requestContext)) return;
      showCommandProblem(error, { kind: "transfer", intent });
    }
  };

  const submitTransfer = () => {
    if (managementActionsWithheld || !isOwner || !selectedTransferTarget) return;
    void executeTransfer(createManagementIntent({ targetUserId: selectedTransferTarget.userId, revision: visibleTeam.revision }));
  };

  const openRemoveDialog = (member: TeamMemberDirectoryItem) => {
    if (managementActionsWithheld || !isManager || member.userId === accountId || member.role === "OWNER") return;
    captureActionInitiator();
    setSelectedRemoveTarget(member);
    setProblem(null);
    setRemoveOpened(true);
  };

  const executeRemove = async (intent: ManagementIntent<RemoveBody>) => {
    const requestContext = actionContextRef.current;
    setProblem(null);
    try {
      const result = await removeTeamMember({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      if (!isCurrentAction(requestContext)) return;
      setRemoveOpened(false);
      notification.success({ title: result.recovered ? "Удаление участника уже применено" : "Участник удалён из команды", placement: "top", role: "status" });
      completedActionFocusRef.current = true;
      void reconcileAuthority(true);
    } catch (error) {
      if (!isCurrentAction(requestContext)) return;
      showCommandProblem(error, { kind: "remove", intent });
    }
  };

  const submitRemove = () => {
    if (managementActionsWithheld || !isManager || !selectedRemoveTarget) return;
    void executeRemove(createManagementIntent({ userId: selectedRemoveTarget.userId }));
  };

  const executeLeave = async (intent: ManagementIntent<LeaveBody>) => {
    const requestContext = actionContextRef.current;
    setProblem(null);
    try {
      const result = await leaveTeam({ ...scope, idempotencyKey: intent.idempotencyKey }).unwrap();
      if (!isCurrentAction(requestContext)) return;
      setLeaveOpened(false);
      notification.success({ title: result.recovered ? "Выход из команды уже применён" : "Вы вышли из команды", placement: "top", role: "status" });
      completedActionFocusRef.current = true;
      void reconcileAuthority(true);
    } catch (error) {
      if (!isCurrentAction(requestContext)) return;
      showCommandProblem(error, { kind: "leave", intent });
    }
  };

  const submitLeave = () => {
    if (managementActionsWithheld || isOwner) return;
    void executeLeave(createManagementIntent({}));
  };

  const retryCommand = () => {
    if (managementActionsWithheld) return;
    const retry = problem?.retry;
    if (!retry) return;
    if (retry.kind === "rename" && isManager) void executeRename(retry.intent);
    if (retry.kind === "role" && isOwner) void executeRole(retry.intent);
    if (retry.kind === "transfer" && isOwner) void executeTransfer(retry.intent);
    if (retry.kind === "leave" && !isOwner) void executeLeave(retry.intent);
    if (retry.kind === "remove" && isManager) void executeRemove(retry.intent);
  };

  const retryCommandFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    retryCommand();
  };

  const roleOptions = [
    { value: "MEMBER", label: "Участник" },
    { value: "ADMIN", label: "Администратор" },
  ];

  useEffect(() => {
    if (!transferOpened && restoreTransferFocusRef.current) {
      restoreTransferFocusRef.current = false;
      actionInitiatorRef.current?.focus();
    }
  }, [transferOpened]);

  return (
    <Stack className={styles.settings} gap="lg">
      <header ref={settingsIntroRef} className={styles.intro}>
        <Text className={styles.kicker}>Команда</Text>
        <Title order={1} tabIndex={-1}>Настройки команды</Title>
        <Text c="gray.5" mt={6}>Права и изменения подтверждаются сервером при каждом действии.</Text>
      </header>

      <Card className={styles.identityCard} withBorder>
        <Group justify="space-between" align="center" gap="md" wrap="wrap">
          <div>
            <Text className={styles.identityLabel}>Команда</Text>
            <Group gap="xs" wrap="nowrap" align="center">
              <Text fw={800} size="lg">{visibleTeam.name}</Text>
              {isManager ? (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  aria-label="Переименовать команду"
                  title="Переименовать команду"
                  onClick={() => {
                    captureActionInitiator();
                    setNameDraft(visibleTeam.name);
                    setProblem(null);
                    setRenameOpened(true);
                  }}
                  disabled={managementActionsWithheld}
                >
                  <IconPencil size={18} aria-hidden="true" />
                </Button>
              ) : null}
            </Group>
          </div>
          <Badge className={styles.roleBadge} color={isOwner ? "teal" : isManager ? "blue" : "gray"} variant="light">
            {roleLabel(visibleTeam.role)}
          </Badge>
        </Group>
        <Stack className={styles.identityHint} gap={4}>
          <Text size="sm">Ваша роль: {roleLabel(visibleTeam.role)}</Text>
        </Stack>
      </Card>

      {authorityRefreshPending ? (
        <Text role="status" c="gray.5" size="sm">Проверяем актуальные права и данные команды…</Text>
      ) : null}

      {authorityRefreshFailed ? (
        <Alert className={styles.alert} color="red" role="alert" title="Не удалось подтвердить актуальные права">
          <Stack gap="sm">
            <Text size="sm">Действия с настройками временно недоступны, пока команда не подтвердит актуальные данные.</Text>
            <Button className={styles.action} variant="light" onClick={() => void reconcileAuthority(true)}>
              Обновить данные
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {problem && !renameOpened && !roleOpened && !transferOpened && !leaveOpened && !removeOpened ? (
        <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Действие не выполнено">
          <Stack gap="sm">
            <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
            <Group gap="sm">
              {problem.kind === "conflict" ? (
                <Button className={styles.action} variant="light" onClick={refreshAuthority}>Обновить данные</Button>
              ) : null}
              {problem.retry ? (
                <Button className={styles.action} variant="light" disabled={managementActionsWithheld} onClick={retryCommand} onKeyDown={retryCommandFromKeyboard}>
                  Повторить
                </Button>
              ) : null}
            </Group>
          </Stack>
        </Alert>
      ) : null}

      {isManager ? <TeamInvitationManagement accountId={accountId} authToken={authToken ?? ""} teamId={visibleTeam.id} /> : null}
      <TeamMemberDirectory
        accountId={accountId}
        teamId={visibleTeam.id}
        onMembersChange={reconcileMembers}
        renderActions={(member, fetching) => {
          const disabled = managementActionsWithheld || fetching;
          const ownRow = member.userId === accountId;
          const manageable = !ownRow && member.role !== "OWNER";
          return <Group gap="xs" wrap="wrap">
            {isOwner && manageable ? <>
              <Button className={styles.rowAction} variant="light" aria-label="Изменить роль участника" onClick={() => openRoleDialog(member)} disabled={disabled}>Изменить роль</Button>
              <Button className={styles.rowAction} color="blue" variant="light" aria-label="Передать владение командой" onClick={() => openTransferDialog(member)} disabled={disabled}>Передать владение</Button>
            </> : null}
            {isManager && manageable ? <ActionIcon className={styles.rowAction} size="lg" color="red" variant="light" aria-label="Удалить участника" title="Удалить участника" onClick={() => openRemoveDialog(member)} disabled={disabled}><IconTrash size={16} aria-hidden="true" /></ActionIcon> : null}
            {!isOwner && ownRow ? <Button className={styles.rowAction} color="red" variant="light" onClick={() => { if (disabled) return; captureActionInitiator(); setProblem(null); setLeaveOpened(true); }} disabled={disabled}>Выйти из команды</Button> : null}
          </Group>;
        }}
      />

      <Modal opened={renameOpened && isManager} onClose={() => setRenameOpened(false)} afterOpenChange={restoreCompletedActionFocus} title="Переименовать команду" centered>
        <form onSubmit={submitRename}>
          <Stack gap="md">
            <TextInput placeholder="Введите название команды"
              className={styles.field}
              aria-label="Название команды"
              value={nameDraft}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNameDraft(event.currentTarget.value)}
              autoFocus
              disabled={managementActionsWithheld}
            />
            {problem ? (
              <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Действие не выполнено">
                <Stack gap="sm">
                  <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                  <Group gap="sm">
                    {problem.kind === "conflict" ? (
                      <Button className={styles.action} variant="light" onClick={refreshAuthority}>Обновить данные</Button>
                    ) : null}
                    {problem.retry ? (
                      <Button className={styles.action} variant="light" disabled={managementActionsWithheld} onClick={retryCommand} onKeyDown={retryCommandFromKeyboard}>Повторить</Button>
                    ) : null}
                  </Group>
                </Stack>
              </Alert>
            ) : null}
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setRenameOpened(false)}>Отмена</Button>
              <Button type="submit" disabled={managementActionsWithheld || !nameDraft.trim()}>Сохранить название</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={roleOpened && isOwner} onClose={() => setRoleOpened(false)} afterOpenChange={restoreCompletedActionFocus} title="Изменить роль участника" centered>
        <Stack gap="md">
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Действие не выполнено">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                <Group gap="sm">
                  {problem.kind === "conflict" ? (
                    <Button className={styles.action} variant="light" onClick={refreshAuthority}>Обновить данные</Button>
                  ) : null}
                  {problem.retry ? (
                    <Button className={styles.action} variant="light" disabled={managementActionsWithheld} onClick={retryCommand} onKeyDown={retryCommandFromKeyboard}>
                      Повторить
                    </Button>
                  ) : null}
                </Group>
              </Stack>
            </Alert>
          ) : null}
          {selectedRoleTarget ? <Text>Выбранный участник: <strong>{selectedRoleTarget.displayName}</strong></Text> : null}
          <NativeSelect placeholder="Выберите роль участника"
            className={styles.field}
            label="Роль"
            data={roleOptions}
            value={roleDraft}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setRoleDraft(event.currentTarget.value as "ADMIN" | "MEMBER")}
            onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setRoleDraft("ADMIN");
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setRoleDraft("MEMBER");
              }
            }}
            disabled={managementActionsWithheld || !selectedRoleTarget}
          />
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={() => setRoleOpened(false)}>Отмена</Button>
            <Button className={styles.action} onClick={submitRole} disabled={managementActionsWithheld || !selectedRoleTarget}>Сохранить роль</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={transferOpened && isOwner} onClose={closeTransfer} afterOpenChange={restoreCompletedActionFocus} title="Передать владение командой" centered returnFocus={false}>
        <Stack gap="md">
          <Text>После подтверждения прежний владелец станет ADMIN, а выбранный участник получит роль владельца.</Text>
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Действие не выполнено">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                {problem.retry ? <Button className={styles.action} variant="light" disabled={managementActionsWithheld} onClick={retryCommand}>Повторить</Button> : null}
              </Stack>
            </Alert>
          ) : null}
          {selectedTransferTarget ? <Text>Новый владелец: <strong>{selectedTransferTarget.displayName}</strong></Text> : null}
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={closeTransfer}>Отмена</Button>
            <Button className={styles.action} color="blue" onClick={submitTransfer} disabled={managementActionsWithheld || !selectedTransferTarget}>Подтвердить передачу</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={removeOpened && isManager} onClose={() => setRemoveOpened(false)} afterOpenChange={restoreCompletedActionFocus} title="Удалить участника из команды" centered>
        <Stack gap="md">
          <Text>Участник потеряет доступ к команде и её интервью. Повторное вступление потребует нового приглашения.</Text>
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Удаление не выполнено">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                {problem.retry ? <Button className={styles.action} variant="light" disabled={managementActionsWithheld} onClick={retryCommand}>Повторить</Button> : null}
              </Stack>
            </Alert>
          ) : null}
          {selectedRemoveTarget ? <Text>Удаляемый участник: <strong>{selectedRemoveTarget.displayName}</strong></Text> : null}
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={() => setRemoveOpened(false)}>Отмена</Button>
            <Button className={styles.action} variant="light" color="red" leftSection={<IconTrash size={16} aria-hidden="true" />} onClick={submitRemove} disabled={managementActionsWithheld || !selectedRemoveTarget}>Удалить участника</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={leaveOpened && !isOwner} onClose={() => setLeaveOpened(false)} afterOpenChange={restoreCompletedActionFocus} title="Выйти из команды" centered>
        <Stack gap="md">
          <Text>После выхода команда пропадёт из списка. Старые ссылки и назначения не восстановят доступ автоматически.</Text>
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Выход не выполнен">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                {problem.retry ? <Button className={styles.action} variant="light" disabled={managementActionsWithheld} onClick={retryCommand}>Повторить</Button> : null}
              </Stack>
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={() => setLeaveOpened(false)}>Отмена</Button>
            <Button className={styles.action} color="red" onClick={submitLeave} disabled={managementActionsWithheld || isOwner}>Выйти из команды</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
