import React, { startTransition, useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Flex, Form, Input, Modal, Popover, Spin } from "antd";
import { CheckOutlined, DownOutlined, AppstoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../app/hooks";
import { TEAM_WORKSPACES_ENABLED } from "../../config/runtime";
import { useCreateTeamMutation, useLazyGetWorkspacesQuery } from "../../services/api";
import type { WorkspaceCacheScope, WorkspaceSummary } from "../../types";
import { rememberCreatedTeam } from "./transientWorkspaceIdentity";
import { useEscapeLayer } from "../../components/useEscapeLayer";
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
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuId = React.useId();
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
    setWorkspaceOpened(false);
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

  const closeWorkspaceMenu = useCallback(() => {
    setWorkspaceOpened(false);
    window.requestAnimationFrame(() => workspaceTriggerRef.current?.focus());
  }, []);

  useEscapeLayer(workspaceOpened, closeWorkspaceMenu);

  React.useEffect(() => {
    if (!workspaceOpened) return;
    const frame = window.requestAnimationFrame(() => {
      workspaceMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceOpened]);

  if (!TEAM_WORKSPACES_ENABLED) return null;

  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(workspaceMenuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"], [role="menuitemradio"]',
    ) ?? []);
    if (event.key === "Tab") {
      setWorkspaceOpened(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const selectPersonal = () => {
    setWorkspaceOpened(false);
    clearCreateState(true);
    startTransition(() => { void navigate("/workspace/personal/interviews"); });
  };

  const selectTeam = (workspace: WorkspaceSummary) => {
    setWorkspaceOpened(false);
    clearCreateState(true);
    startTransition(() => { void navigate(`/workspace/teams/${workspace.id}/interviews`); });
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
      startTransition(() => { void navigate(`/workspace/teams/${response.team.id}/interviews`); });
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
      ? "Команда"
      : visibleCurrentName ?? "Команда"
    : "Личное";
  const listIsCurrent = workspaceList.contextKey === contextKey;
  const listStatus = listIsCurrent ? workspaceList.status : "loading";
  const workspaces = listIsCurrent ? workspaceList.teams : [];

  return (
    <>
      <Popover
        open={workspaceOpened}
        onOpenChange={setWorkspaceOpened}
        trigger="click"
        placement="bottomLeft"
        arrow={false}
        destroyOnHidden
        classNames={{ container: styles.dropdownSurface }}
        content={
          <div
            id={workspaceMenuId}
            ref={workspaceMenuRef}
            role="menu"
            aria-label="Выбор команды"
            className={styles.workspaceMenu}
            onKeyDown={navigateMenu}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
                setWorkspaceOpened(false);
              }
            }}
          >
            <button type="button" role="menuitem" className={styles.createButton} onClick={openCreate}>
              <PlusOutlined aria-hidden="true" />
              <span>Создать команду</span>
            </button>
            <div className={styles.workspaceList}>
              {listStatus === "loading" ? <div className={styles.listFeedback}><Spin size="small" aria-label="Загружаем команды" /></div> : null}
              {listStatus === "error" ? (
                <Alert className={styles.listFeedback} type="error" showIcon title="Не удалось загрузить команды" action={
                  <Button size="small" onClick={() => void revalidateWorkspaces(true, "retry")}>Повторить</Button>
                } role="alert" />
              ) : null}
              <button
                type="button"
                role="menuitemradio"
                className={`${styles.choiceButton} ${workspaceId === "personal" ? styles.choiceSelected : ""}`}
                aria-checked={workspaceId === "personal"}
                aria-current={workspaceId === "personal" ? "true" : undefined}
                onClick={selectPersonal}
              >
                <span className={styles.workspaceName}>Личное</span>
                {workspaceId === "personal" ? <CheckOutlined aria-hidden="true" /> : null}
              </button>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitemradio"
                  className={`${styles.choiceButton} ${workspace.id === workspaceId ? styles.choiceSelected : ""}`}
                  aria-checked={workspace.id === workspaceId}
                  aria-current={workspace.id === workspaceId ? "true" : undefined}
                  onClick={() => selectTeam(workspace)}
                >
                  <span className={styles.workspaceName} title={workspace.name}>{workspace.name}</span>
                  {workspace.id === workspaceId ? <CheckOutlined aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        }
      >
      <Button
        ref={workspaceTriggerRef}
        htmlType="button"
        className={`${styles.trigger} app-header-control`}
        aria-label={`Команды: ${currentLabel}. Сменить команду`}
        aria-expanded={workspaceOpened}
        aria-controls={workspaceOpened ? workspaceMenuId : undefined}
        aria-haspopup="menu"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setWorkspaceOpened(true);
          }
        }}
      >
        <span className={styles.triggerContent}>
          <AppstoreOutlined className={styles.triggerIcon} aria-hidden="true" />
          <span className={styles.triggerPrefix}>Команды:</span>
          <span className={styles.triggerLabel} data-workspace-switcher-label title={currentLabel}>
            {currentLabel}
          </span>
          <DownOutlined className={styles.triggerChevron} aria-hidden="true" />
        </span>
      </Button>
      </Popover>
      <Modal open={createOpened} onCancel={closeCreate} title="Создать команду" centered footer={null} destroyOnHidden>
        <form onSubmit={submit}>
          <Flex vertical gap={16}>
            <Form.Item required style={{ marginBottom: 0 }}>
              <Input aria-label="Название команды" placeholder="Введите название команды" value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={isCreating} autoFocus />
            </Form.Item>
            {error ? <Alert type="error" showIcon role="alert" message={error} /> : null}
            <Flex justify="flex-end" gap={8}>
              <Button htmlType="button" disabled={isCreating} onClick={closeCreate}>Отмена</Button>
              <Button htmlType="submit" type="primary" loading={isCreating} aria-label={error ? "Повторить" : "Создать команду"} aria-busy={isCreating}>
                {error ? "Повторить" : "Создать команду"}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Modal>
    </>
  );
}
