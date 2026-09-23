import React, { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text, TextInput } from "@mantine/core";
import { IconCheck, IconChevronDown, IconLayoutGrid } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../app/hooks";
import { TEAM_WORKSPACES_ENABLED } from "../../config/runtime";
import { useCreateTeamMutation, useLazyGetWorkspacesQuery } from "../../services/api";
import type { WorkspaceCacheScope, WorkspaceSummary } from "../../types";
import { rememberCreatedTeam } from "./transientWorkspaceIdentity";
import styles from "./WorkspaceSwitcher.module.css";

type WorkspaceSwitcherProps = {
  currentTeamId?: string;
  currentTeamName?: string | null;
};

type CreateIntent = {
  canonicalName: string;
  idempotencyKey: string;
  rawName: string;
};

type ActiveCreate = {
  contextIdentity: string;
  request: { abort: () => void };
};

type ActiveWorkspaceList = {
  contextKey: string;
  contextIdentity: string;
  reason: "navigation" | "lifecycle" | "retry";
  request: {
    abort: () => void;
    unwrap: () => Promise<WorkspaceSummary[]>;
  };
};

type WorkspaceListState = {
  contextKey: string;
  status: "loading" | "ready" | "error";
  teams: WorkspaceSummary[];
};

const shortId = (id: string) => id.slice(0, 8);

function canonicalTeamName(value: string) {
  return value.normalize("NFKC").trim();
}

function apiError(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error)) return "Не удалось создать команду. Повторите попытку.";
  const data = error.data;
  if (!data || typeof data !== "object" || !("error" in data) || typeof data.error !== "string") {
    return "Не удалось создать команду. Повторите попытку.";
  }
  return data.error;
}

export function WorkspaceSwitcher({ currentTeamId, currentTeamName }: WorkspaceSwitcherProps) {
  const navigate = useNavigate();
  const accountId = useAppSelector((state) => state.auth.user?.id ?? "");
  const workspaceKind = currentTeamId ? "TEAM" : "PERSONAL";
  const workspaceId = currentTeamId ?? "personal";
  const contextKey = `${accountId}:${workspaceKind}:${workspaceId}`;
  const generationRef = useRef(0);
  const previousContextRef = useRef(contextKey);
  if (previousContextRef.current !== contextKey) {
    previousContextRef.current = contextKey;
    generationRef.current += 1;
  }
  const contextIdentity = `${contextKey}:${generationRef.current}`;
  const identityRef = useRef(contextIdentity);
  identityRef.current = contextIdentity;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const activeCreateRef = useRef<ActiveCreate | null>(null);
  const activeWorkspaceListRef = useRef<ActiveWorkspaceList | null>(null);
  const workspaceListGenerationRef = useRef(0);
  const intentRef = useRef<CreateIntent | null>(null);
  const scope = useMemo<WorkspaceCacheScope>(() => ({
    accountId,
    kind: workspaceKind,
    teamId: workspaceId,
    query: "",
    generation: generationRef.current,
  }), [accountId, workspaceId, workspaceKind]);
  const [loadWorkspaces] = useLazyGetWorkspacesQuery();
  const [createTeam, { isLoading: isCreating, reset: resetMutation }] = useCreateTeamMutation();
  const resetMutationRef = useRef(resetMutation);
  resetMutationRef.current = resetMutation;
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [createOpened, setCreateOpened] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const authorizedNamesRef = useRef(new Map<string, string>());
  const [workspaceList, setWorkspaceList] = useState<WorkspaceListState>({
    contextKey,
    status: "loading",
    teams: [],
  });

  React.useEffect(() => {
    if (currentTeamId && currentTeamName === null) {
      authorizedNamesRef.current.delete(`${accountId}:${currentTeamId}`);
    }
  }, [accountId, currentTeamId, currentTeamName]);

  const abortActiveCreate = useCallback(() => {
    const active = activeCreateRef.current;
    if (!active) return;
    active.request.abort();
    if (activeCreateRef.current === active) activeCreateRef.current = null;
  }, []);

  const clearCreateState = useCallback((close: boolean) => {
    abortActiveCreate();
    intentRef.current = null;
    setName("");
    setError("");
    resetMutationRef.current();
    if (close) setCreateOpened(false);
  }, [abortActiveCreate]);

  const abortActiveWorkspaceList = useCallback(() => {
    const active = activeWorkspaceListRef.current;
    if (!active) return;
    active.request.abort();
    if (activeWorkspaceListRef.current === active) activeWorkspaceListRef.current = null;
  }, []);

  const revalidateWorkspaces = useCallback(async (
    clearAuthorizedNames = false,
    reason: ActiveWorkspaceList["reason"] = "navigation",
  ) => {
    if (!TEAM_WORKSPACES_ENABLED || !accountId) return;

    if (clearAuthorizedNames) authorizedNamesRef.current.clear();
    const currentRequest = activeWorkspaceListRef.current;
    if (
      reason === "lifecycle"
      && currentRequest?.reason === "lifecycle"
      && currentRequest.contextKey === contextKey
    ) {
      return;
    }

    abortActiveWorkspaceList();
    const generation = workspaceListGenerationRef.current + 1;
    workspaceListGenerationRef.current = generation;
    const startedIn = contextKey;
    const contextIdentity = `${startedIn}:workspace-list:${generation}`;
    setWorkspaceList({ contextKey: startedIn, status: "loading", teams: [] });

    const request = loadWorkspaces({ ...scope, generation }, false);
    const active: ActiveWorkspaceList = { contextKey: startedIn, contextIdentity, reason, request };
    activeWorkspaceListRef.current = active;
    try {
      const response = await request.unwrap();
      if (contextKeyRef.current !== startedIn || activeWorkspaceListRef.current !== active) return;
      const teams = response.filter((workspace) => workspace.id !== "personal");
      authorizedNamesRef.current.clear();
      teams.forEach((workspace) => {
        authorizedNamesRef.current.set(`${accountId}:${workspace.id}`, workspace.name);
      });
      setWorkspaceList({ contextKey: startedIn, status: "ready", teams });
    } catch {
      if (contextKeyRef.current !== startedIn || activeWorkspaceListRef.current !== active) return;
      authorizedNamesRef.current.clear();
      setWorkspaceList({ contextKey: startedIn, status: "error", teams: [] });
    } finally {
      if (activeWorkspaceListRef.current === active) activeWorkspaceListRef.current = null;
    }
  }, [abortActiveWorkspaceList, accountId, contextKey, loadWorkspaces, scope]);

  React.useEffect(() => {
    clearCreateState(true);
    return abortActiveCreate;
  }, [abortActiveCreate, clearCreateState, contextKey]);

  React.useEffect(() => {
    void revalidateWorkspaces();
    return abortActiveWorkspaceList;
  }, [abortActiveWorkspaceList, revalidateWorkspaces]);

  React.useEffect(() => {
    let lifecycleFrame: number | null = null;
    const revalidateForLifecycle = () => {
      if (document.visibilityState !== "visible" || lifecycleFrame !== null) return;
      lifecycleFrame = window.requestAnimationFrame(() => {
        lifecycleFrame = null;
      });
      void revalidateWorkspaces(true, "lifecycle");
    };

    window.addEventListener("focus", revalidateForLifecycle);
    document.addEventListener("visibilitychange", revalidateForLifecycle);
    return () => {
      window.removeEventListener("focus", revalidateForLifecycle);
      document.removeEventListener("visibilitychange", revalidateForLifecycle);
      if (lifecycleFrame !== null) window.cancelAnimationFrame(lifecycleFrame);
    };
  }, [revalidateWorkspaces]);

  if (!TEAM_WORKSPACES_ENABLED) return null;

  const closeWorkspaceDialog = () => {
    setWorkspaceOpened(false);
    window.requestAnimationFrame(() => workspaceTriggerRef.current?.focus());
  };

  const selectPersonal = () => {
    setWorkspaceOpened(false);
    clearCreateState(true);
    navigate("/workspace/personal/interviews");
  };

  const selectTeam = (workspace: WorkspaceSummary) => {
    setWorkspaceOpened(false);
    clearCreateState(true);
    navigate(`/workspace/teams/${workspace.id}/interviews`);
  };

  const openCreate = () => {
    setWorkspaceOpened(false);
    clearCreateState(false);
    setCreateOpened(true);
  };

  const closeCreate = () => clearCreateState(true);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isCreating) return;
    const canonicalName = canonicalTeamName(name);
    if (!canonicalName) {
      setError("Название команды обязательно");
      return;
    }
    const previousIntent = intentRef.current;
    const intent = previousIntent?.canonicalName === canonicalName
      ? previousIntent
      : { canonicalName, idempotencyKey: crypto.randomUUID(), rawName: name };
    intentRef.current = intent;
    const startedIn = identityRef.current;
    setError("");
    const request = createTeam({
      ...scope,
      name: intent.rawName,
      idempotencyKey: intent.idempotencyKey,
    });
    const active: ActiveCreate = { contextIdentity: startedIn, request };
    activeCreateRef.current = active;
    try {
      const response = await request.unwrap();
      if (identityRef.current !== startedIn || activeCreateRef.current !== active) return;
      rememberCreatedTeam(accountId, response.team);
      clearCreateState(true);
      navigate(`/workspace/teams/${response.team.id}/interviews`);
    } catch (requestError) {
      if (identityRef.current !== startedIn || activeCreateRef.current !== active) return;
      setError(apiError(requestError));
    } finally {
      if (activeCreateRef.current === active) activeCreateRef.current = null;
    }
  };

  // The current workspace label is an authorization surface. Never derive it
  // from the independently cached list: only exact detail authorization (or
  // the one-shot account+team create identity supplied by the page) may name
  // the selected team while navigation is pending.
  const visibleCurrentName = currentTeamName ?? undefined;
  const currentLabel = currentTeamId
    ? currentTeamName === null
      ? "Командное пространство"
      : `${visibleCurrentName ?? "Команда"} · ${shortId(currentTeamId)}`
    : "Личное пространство";
  const listIsCurrent = workspaceList.contextKey === contextKey;
  const listStatus = listIsCurrent ? workspaceList.status : "loading";
  const workspaces = listIsCurrent ? workspaceList.teams : [];

  return (
    <>
      <Button
        ref={workspaceTriggerRef}
        type="button"
        variant="light"
        className={styles.trigger}
        aria-label={`Рабочее пространство: ${currentLabel}. Сменить рабочее пространство`}
        aria-expanded={workspaceOpened}
        aria-controls="workspace-switcher-dialog"
        onClick={() => setWorkspaceOpened(true)}
      >
        <span className={styles.triggerContent}>
          <IconLayoutGrid size={18} className={styles.triggerIcon} aria-hidden="true" />
          <span className={styles.triggerPrefix}>Пространство:</span>
          <span className={styles.triggerLabel} data-workspace-switcher-label title={currentLabel}>
            {currentLabel}
          </span>
          <span className={styles.triggerCue} data-workspace-switcher-cue aria-hidden="true">
            {workspaceOpened ? "Свернуть" : "Сменить"}
          </span>
          <IconChevronDown size={16} className={styles.triggerChevron} aria-hidden="true" />
        </span>
      </Button>
      <Modal
        id="workspace-switcher-dialog"
        opened={workspaceOpened}
        onClose={closeWorkspaceDialog}
        title="Выбор рабочего пространства"
        centered
      >
        <Stack gap="sm">
          {listStatus === "loading" ? <Loader size="sm" aria-label="Загружаем рабочие пространства" /> : null}
          {listStatus === "error" ? (
            <Alert color="red" role="alert" title="Не удалось загрузить пространства">
              <Button type="button" variant="light" size="xs" onClick={() => void revalidateWorkspaces(true, "retry")}>Повторить</Button>
            </Alert>
          ) : null}
          <Button
            type="button"
            variant="default"
            className={`${styles.choiceButton} ${workspaceId === "personal" ? styles.choiceSelected : ""}`}
            fullWidth
            aria-current={workspaceId === "personal" ? "true" : undefined}
            onClick={selectPersonal}
          >
            <Group justify="space-between" wrap="nowrap" w="100%">
              <Text span>Личное пространство</Text>
              {workspaceId === "personal" ? <IconCheck size={18} aria-hidden="true" /> : null}
            </Group>
          </Button>
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              type="button"
              variant="default"
              className={`${styles.choiceButton} ${workspace.id === workspaceId ? styles.choiceSelected : ""}`}
              fullWidth
              aria-current={workspace.id === workspaceId ? "true" : undefined}
              onClick={() => selectTeam(workspace)}
            >
              <Group justify="space-between" wrap="nowrap" w="100%">
                <Text span>{workspace.name}</Text>
                <Text span size="xs">{shortId(workspace.id)}</Text>
                {workspace.id === workspaceId ? <IconCheck size={18} aria-hidden="true" /> : null}
              </Group>
            </Button>
          ))}
          <Button type="button" color="gray" className={styles.createButton} onClick={openCreate}>Создать команду</Button>
        </Stack>
      </Modal>
      <Modal opened={createOpened} onClose={closeCreate} title="Создать команду" centered>
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput
              label="Название команды"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              disabled={isCreating}
              autoFocus
            />
            {error ? <Alert color="red" role="alert">{error}</Alert> : null}
            <Group justify="flex-end">
              <Button type="button" variant="subtle" disabled={isCreating} onClick={closeCreate}>Отмена</Button>
              <Button type="submit" color="blue" loading={isCreating}>
                {error ? "Повторить" : "Создать команду"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
