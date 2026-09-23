import React, { useEffect, useMemo, useRef, useState } from "react";
import { IconPencil } from "@tabler/icons-react";
import {
  Alert,
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
} from "@mantine/core";
import {
  useGetTeamMembersQuery,
  useLeaveTeamMutation,
  useRenameTeamMutation,
  useRemoveTeamMemberMutation,
  useTransferTeamOwnershipMutation,
  useUpdateTeamMemberRoleMutation,
} from "../../services/api";
import type {
  TeamDetail,
  TeamMemberRole,
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

const MEMBER_PAGE_SIZE = 100;

function roleLabel(role: TeamManagementTeam["role"]): string {
  if (role === "OWNER") return "Владелец";
  if (role === "ADMIN") return "Администратор";
  return "Участник";
}

export function TeamManagementSettings({ accountId, team, onTeamRefresh }: Props) {
  const [visibleTeam, setVisibleTeam] = useState<TeamManagementTeam>(team);
  const [nameDraft, setNameDraft] = useState(team.name);
  const [renameOpened, setRenameOpened] = useState(false);
  const [problem, setProblem] = useState<CommandProblem | null>(null);
  const [terminalStatus, setTerminalStatus] = useState("");
  const [roleOpened, setRoleOpened] = useState(false);
  const [transferOpened, setTransferOpened] = useState(false);
  const [leaveOpened, setLeaveOpened] = useState(false);
  const [removeOpened, setRemoveOpened] = useState(false);
  const [roleTargetId, setRoleTargetId] = useState("");
  const [roleDraft, setRoleDraft] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [transferTargetId, setTransferTargetId] = useState("");
  const [removeTargetId, setRemoveTargetId] = useState("");
  const [authorityRefreshPending, setAuthorityRefreshPending] = useState(false);
  const [authorityRefreshFailed, setAuthorityRefreshFailed] = useState(false);
  const transferButtonRef = useRef<HTMLButtonElement | null>(null);
  const terminalStatusRef = useRef<HTMLDivElement | null>(null);
  const restoreTransferFocusRef = useRef(false);

  useEffect(() => {
    setVisibleTeam(team);
    setNameDraft(team.name);
    setAuthorityRefreshPending(false);
    setAuthorityRefreshFailed(false);
  }, [team]);

  const isOwner = visibleTeam.role === "OWNER";
  const isManager = isOwner || visibleTeam.role === "ADMIN";
  const scope = useMemo(() => ({ accountId, kind: "TEAM" as const, teamId: visibleTeam.id, query: "" }), [accountId, visibleTeam.id]);
  const memberQuery = useMemo(() => ({ accountId, teamId: visibleTeam.id, page: 0, size: MEMBER_PAGE_SIZE }), [accountId, visibleTeam.id]);
  const members = useGetTeamMembersQuery(memberQuery, { skip: !isManager, refetchOnMountOrArgChange: true });
  const [renameTeam] = useRenameTeamMutation();
  const [updateRole] = useUpdateTeamMemberRoleMutation();
  const [transferOwnership] = useTransferTeamOwnershipMutation();
  const [leaveTeam] = useLeaveTeamMutation();
  const [removeTeamMember] = useRemoveTeamMemberMutation();

  const roleTargets = useMemo(() => (
    (members.data?.items ?? [])
      .filter((member) => member.userId !== accountId && member.role !== "OWNER")
      .sort((left, right) => {
        const priority = (role: TeamMemberRole) => role === "ADMIN" ? 0 : 1;
        return priority(left.role) - priority(right.role) || left.displayName.localeCompare(right.displayName, "ru");
      })
  ), [accountId, members.data?.items]);
  const removeTargets = useMemo(() => (
    (members.data?.items ?? [])
      .filter((member) => member.userId !== accountId && member.role !== "OWNER")
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ru"))
  ), [accountId, members.data?.items]);
  const preferredRoleTarget = roleTargets.find((member) => member.role === "MEMBER") ?? roleTargets[0] ?? null;
  const selectedRoleTarget = roleTargets.find((member) => member.userId === roleTargetId) ?? preferredRoleTarget;
  const selectedTransferTarget = roleTargets.find((member) => member.userId === transferTargetId) ?? roleTargets[0] ?? null;
  const selectedRemoveTarget = removeTargets.find((member) => member.userId === removeTargetId) ?? removeTargets[0] ?? null;

  const focusTerminalStatus = () => {
    window.setTimeout(() => terminalStatusRef.current?.focus(), 0);
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
    setNameDraft(refreshedTeam.name);
    if (isManager) {
      void members.refetch();
    }
    if (withholdRevisionBoundActions) setAuthorityRefreshPending(false);
    return refreshedTeam;
  };

  const refreshAuthority = () => {
    void reconcileAuthority();
  };

  const executeRename = async (intent: ManagementIntent<RenameBody>) => {
    setProblem(null);
    try {
      const result = await renameTeam({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      setVisibleTeam(result.team);
      setNameDraft(result.team.name);
      setRenameOpened(false);
      setTerminalStatus(result.outcome === "UNCHANGED" ? "Название команды уже актуально" : "Название команды сохранено");
      void reconcileAuthority(true);
      focusTerminalStatus();
    } catch (error) {
      showCommandProblem(error, { kind: "rename", intent });
    }
  };

  const submitRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authorityRefreshPending) return;
    void executeRename(createManagementIntent({ name: nameDraft, revision: visibleTeam.revision }));
  };

  const openRoleDialog = () => {
    if (authorityRefreshPending) return;
    setProblem(null);
    setRoleTargetId(preferredRoleTarget?.userId ?? "");
    setRoleDraft(preferredRoleTarget?.role === "ADMIN" ? "ADMIN" : "MEMBER");
    setRoleOpened(true);
  };

  const executeRole = async (intent: ManagementIntent<RoleBody>) => {
    setProblem(null);
    try {
      const result = await updateRole({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      setRoleOpened(false);
      setTerminalStatus(result.outcome === "UNCHANGED" ? "Роль участника уже актуальна" : "Роль участника изменена");
      void reconcileAuthority(true);
      focusTerminalStatus();
    } catch (error) {
      showCommandProblem(error, { kind: "role", intent });
    }
  };

  const submitRole = () => {
    if (authorityRefreshPending || !selectedRoleTarget) return;
    void executeRole(createManagementIntent({
      userId: selectedRoleTarget.userId,
      role: roleDraft,
      revision: selectedRoleTarget.revision,
    }));
  };

  const closeTransfer = () => {
    restoreTransferFocusRef.current = true;
    transferButtonRef.current?.focus();
    setTransferOpened(false);
    window.queueMicrotask(() => transferButtonRef.current?.focus());
    window.setTimeout(() => transferButtonRef.current?.focus(), 0);
  };

  const openTransferDialog = () => {
    if (authorityRefreshPending) return;
    if (roleTargets[0]) setTransferTargetId(roleTargets[0].userId);
    setProblem(null);
    setTransferOpened(true);
  };

  const executeTransfer = async (intent: ManagementIntent<TransferBody>) => {
    setProblem(null);
    try {
      const result = await transferOwnership({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      setVisibleTeam(result.team);
      setTransferOpened(false);
      setTerminalStatus("Владение командой передано. Вы остаетесь администратором.");
      void reconcileAuthority(true);
      focusTerminalStatus();
    } catch (error) {
      showCommandProblem(error, { kind: "transfer", intent });
    }
  };

  const submitTransfer = () => {
    if (authorityRefreshPending || !selectedTransferTarget) return;
    void executeTransfer(createManagementIntent({ targetUserId: selectedTransferTarget.userId, revision: visibleTeam.revision }));
  };

  const openRemoveDialog = () => {
    if (authorityRefreshPending) return;
    if (removeTargets[0]) setRemoveTargetId(removeTargets[0].userId);
    setProblem(null);
    setRemoveOpened(true);
  };

  const executeRemove = async (intent: ManagementIntent<RemoveBody>) => {
    setProblem(null);
    try {
      const result = await removeTeamMember({ ...scope, ...intent.body, idempotencyKey: intent.idempotencyKey }).unwrap();
      setRemoveOpened(false);
      setTerminalStatus(result.recovered ? "Удаление участника уже применено" : "Участник удалён из команды");
      void reconcileAuthority(true);
      focusTerminalStatus();
    } catch (error) {
      showCommandProblem(error, { kind: "remove", intent });
    }
  };

  const submitRemove = () => {
    if (authorityRefreshPending || !selectedRemoveTarget) return;
    void executeRemove(createManagementIntent({ userId: selectedRemoveTarget.userId }));
  };

  const executeLeave = async (intent: ManagementIntent<LeaveBody>) => {
    setProblem(null);
    try {
      const result = await leaveTeam({ ...scope, idempotencyKey: intent.idempotencyKey }).unwrap();
      setLeaveOpened(false);
      setTerminalStatus(result.recovered ? "Выход из команды уже применён" : "Вы вышли из команды");
      void reconcileAuthority(true);
      focusTerminalStatus();
    } catch (error) {
      showCommandProblem(error, { kind: "leave", intent });
    }
  };

  const submitLeave = () => {
    if (authorityRefreshPending || isOwner) return;
    void executeLeave(createManagementIntent({}));
  };

  const retryCommand = () => {
    const retry = problem?.retry;
    if (!retry) return;
    if (retry.kind === "rename") void executeRename(retry.intent);
    if (retry.kind === "role") void executeRole(retry.intent);
    if (retry.kind === "transfer") void executeTransfer(retry.intent);
    if (retry.kind === "leave") void executeLeave(retry.intent);
    if (retry.kind === "remove") void executeRemove(retry.intent);
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

  const selectRoleTarget = (userId: string) => {
    const target = roleTargets.find((member) => member.userId === userId);
    setRoleTargetId(userId);
    setRoleDraft(target?.role === "ADMIN" ? "ADMIN" : "MEMBER");
  };

  const moveRoleTarget = (event: React.KeyboardEvent<HTMLSelectElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const selectedIndex = roleTargets.findIndex((member) => member.userId === roleTargetId);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.min(Math.max(selectedIndex + offset, 0), roleTargets.length - 1);
    const nextTarget = roleTargets[nextIndex];
    if (!nextTarget) return;
    event.preventDefault();
    selectRoleTarget(nextTarget.userId);
  };

  useEffect(() => {
    if (transferOpened && !transferTargetId && roleTargets[0]) {
      setTransferTargetId(roleTargets[0].userId);
    }
  }, [roleTargets, transferOpened, transferTargetId]);

  useEffect(() => {
    if (removeOpened && !removeTargetId && removeTargets[0]) {
      setRemoveTargetId(removeTargets[0].userId);
    }
  }, [removeOpened, removeTargetId, removeTargets]);

  useEffect(() => {
    if (!transferOpened && restoreTransferFocusRef.current) {
      restoreTransferFocusRef.current = false;
      transferButtonRef.current?.focus();
    }
  }, [transferOpened]);

  return (
    <Stack className={styles.settings} gap="lg">
      <header className={styles.intro}>
        <Text className={styles.kicker}>Управление пространством</Text>
        <Title order={1}>Настройки команды</Title>
        <Text c="gray.5" mt={6}>Права и изменения подтверждаются сервером при каждом действии.</Text>
      </header>

      <Card className={styles.identityCard} withBorder>
        <Group justify="space-between" align="center" gap="md" wrap="wrap">
          <div>
            <Text className={styles.identityLabel}>Команда</Text>
            <Group gap="xs" wrap="nowrap">
              <Text fw={800} size="lg">{visibleTeam.name}</Text>
              {isManager ? (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  aria-label="Переименовать команду"
                  title="Переименовать команду"
                  onClick={() => {
                    setNameDraft(visibleTeam.name);
                    setProblem(null);
                    setRenameOpened(true);
                  }}
                  disabled={authorityRefreshPending}
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
        <Text className={styles.identityHint} size="sm">Ваша роль: {roleLabel(visibleTeam.role)}</Text>
        {isOwner ? <Text size="xs" c="gray.5">ID команды: {visibleTeam.id}</Text> : null}
      </Card>

      {terminalStatus ? (
        <div ref={terminalStatusRef} className={styles.terminalStatus} role="status" tabIndex={-1}>
          {terminalStatus}
        </div>
      ) : null}

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
                <Button className={styles.action} variant="light" onClick={retryCommand} onKeyDown={retryCommandFromKeyboard}>
                  Повторить
                </Button>
              ) : null}
            </Group>
          </Stack>
        </Alert>
      ) : null}

      <Card className={styles.commandCard} withBorder>
        <Stack gap="md">
          <div>
            <Text className={styles.sectionNumber}>УПРАВЛЕНИЕ ДОСТУПОМ</Text>
            <Text fw={800} size="lg">Роли, владение и доступ</Text>
            <Text c="gray.5" size="sm">
              {isOwner
                ? "Выберите активного участника, чтобы изменить роль, передать владение или удалить доступ."
                : isManager
                  ? "Администратор может удалить доступ участника, а также выйти из команды сам."
                  : "Вы можете выйти из команды. Повторное вступление потребует нового приглашения."}
            </Text>
          </div>
          <Group gap="sm" wrap="wrap">
            {isOwner ? (
              <>
                <Button className={styles.action} onClick={openRoleDialog} disabled={authorityRefreshPending}>
                  Изменить роль участника
                </Button>
                <Button ref={transferButtonRef} className={styles.action} color="blue" variant="light" onClick={openTransferDialog} disabled={authorityRefreshPending}>
                  Передать владение командой
                </Button>
              </>
            ) : null}
            {isManager ? (
              <>
                <Button className={styles.action} color="red" variant="light" onClick={openRemoveDialog} disabled={authorityRefreshPending || removeTargets.length === 0}>
                  Удалить участника
                </Button>
              </>
            ) : null}
            {!isOwner ? (
              <Button className={styles.action} color="red" variant="outline" onClick={() => setLeaveOpened(true)} disabled={authorityRefreshPending}>
                Выйти из команды
              </Button>
            ) : null}
          </Group>
          {members.isFetching && isManager ? <Text size="sm" c="gray.5" role="status">Загружаем активных участников…</Text> : null}
        </Stack>
      </Card>

      <Modal opened={renameOpened} onClose={() => setRenameOpened(false)} title="Название команды" centered>
        <form onSubmit={submitRename}>
          <Stack gap="md">
            <TextInput
              className={styles.field}
              label="Название команды"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.currentTarget.value)}
              autoFocus
              disabled={authorityRefreshPending}
            />
            {problem ? <Text role="alert" c="red.4">{managementErrorMessage(problem.kind)}</Text> : null}
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setRenameOpened(false)}>Отмена</Button>
              <Button type="submit" disabled={authorityRefreshPending || !nameDraft.trim()}>Сохранить название</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={roleOpened} onClose={() => setRoleOpened(false)} title="Изменить роль участника" centered>
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
                    <Button className={styles.action} variant="light" onClick={retryCommand} onKeyDown={retryCommandFromKeyboard}>
                      Повторить
                    </Button>
                  ) : null}
                </Group>
              </Stack>
            </Alert>
          ) : null}
          <NativeSelect
            className={styles.field}
            label="Участник"
            data={roleTargets.map((member) => ({ value: member.userId, label: member.displayName }))}
            value={roleTargetId}
            onChange={(event) => selectRoleTarget(event.currentTarget.value)}
            onKeyDown={moveRoleTarget}
            disabled={authorityRefreshPending || roleTargets.length === 0}
          />
          {selectedRoleTarget ? <Text>Выбранный участник: <strong>{selectedRoleTarget.displayName}</strong></Text> : null}
          {!selectedRoleTarget ? <Text c="gray.5">Загружаем доступных участников…</Text> : null}
          <NativeSelect
            className={styles.field}
            label="Роль"
            data={roleOptions}
            value={roleDraft}
            onChange={(event) => setRoleDraft(event.currentTarget.value as "ADMIN" | "MEMBER")}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setRoleDraft("ADMIN");
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setRoleDraft("MEMBER");
              }
            }}
            disabled={authorityRefreshPending || !selectedRoleTarget}
          />
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={() => setRoleOpened(false)}>Отмена</Button>
            <Button className={styles.action} onClick={submitRole} disabled={authorityRefreshPending || !selectedRoleTarget}>Сохранить роль</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={transferOpened} onClose={closeTransfer} title="Передать владение командой" centered returnFocus={false}>
        <Stack gap="md">
          <Text>После подтверждения прежний владелец станет ADMIN, а выбранный участник получит роль владельца.</Text>
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Действие не выполнено">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                {problem.retry ? <Button className={styles.action} variant="light" onClick={retryCommand}>Повторить</Button> : null}
              </Stack>
            </Alert>
          ) : null}
          <NativeSelect
            className={styles.field}
            label="Новый владелец"
            data={roleTargets.map((member) => ({ value: member.userId, label: member.displayName }))}
            value={transferTargetId}
            onChange={(event) => setTransferTargetId(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              const selectedIndex = roleTargets.findIndex((member) => member.userId === transferTargetId);
              const offset = event.key === "ArrowDown" ? 1 : -1;
              const nextIndex = Math.min(Math.max(selectedIndex + offset, 0), roleTargets.length - 1);
              const nextTarget = roleTargets[nextIndex];
              if (!nextTarget) return;
              event.preventDefault();
              setTransferTargetId(nextTarget.userId);
            }}
            disabled={authorityRefreshPending}
          />
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={closeTransfer}>Отмена</Button>
            <Button className={styles.action} color="blue" onClick={submitTransfer} disabled={authorityRefreshPending || !selectedTransferTarget}>Подтвердить передачу</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={removeOpened} onClose={() => setRemoveOpened(false)} title="Удалить участника из команды" centered>
        <Stack gap="md">
          <Text>Участник потеряет доступ к командному пространству и командным интервью. Повторное вступление потребует нового приглашения.</Text>
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Удаление не выполнено">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                {problem.retry ? <Button className={styles.action} variant="light" onClick={retryCommand}>Повторить</Button> : null}
              </Stack>
            </Alert>
          ) : null}
          <NativeSelect
            className={styles.field}
            label="Участник"
            data={removeTargets.map((member) => ({ value: member.userId, label: member.displayName }))}
            value={selectedRemoveTarget?.userId ?? ""}
            onChange={(event) => setRemoveTargetId(event.currentTarget.value)}
            disabled={authorityRefreshPending || removeTargets.length === 0}
          />
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={() => setRemoveOpened(false)}>Отмена</Button>
            <Button className={styles.action} color="red" onClick={submitRemove} disabled={authorityRefreshPending || !selectedRemoveTarget}>Удалить участника</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={leaveOpened} onClose={() => setLeaveOpened(false)} title="Выйти из команды" centered>
        <Stack gap="md">
          <Text>После выхода командное пространство пропадёт из списка. Старые ссылки и назначения не восстановят доступ автоматически.</Text>
          {problem ? (
            <Alert className={styles.alert} color={problem.kind === "conflict" ? "yellow" : "red"} role="alert" title="Выход не выполнен">
              <Stack gap="sm">
                <Text size="sm">{managementErrorMessage(problem.kind)}</Text>
                {problem.retry ? <Button className={styles.action} variant="light" onClick={retryCommand}>Повторить</Button> : null}
              </Stack>
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button className={styles.action} variant="subtle" onClick={() => setLeaveOpened(false)}>Отмена</Button>
            <Button className={styles.action} color="red" onClick={submitLeave} disabled={authorityRefreshPending || isOwner}>Выйти из команды</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
