import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import {
  createTeamInvitation,
  listTeamInvitations,
  reissueTeamInvitation,
  revealTeamInvitationLink,
  revokeTeamInvitation,
  type TeamInvitation,
  TeamInvitationRequestError,
} from "./teamInvitationApi";
import {
  classifyTeamInvitationMutationFailure,
  type TeamInvitationMutationFailure,
  type TeamInvitationMutationOperation,
} from "./teamInvitationMutationPolicy";
import styles from "./TeamInvitationManagement.module.css";

type Props = {
  readonly accountId: string;
  readonly authToken: string;
  readonly teamId: string;
};

type RetryAction =
  | { readonly kind: "create" }
  | { readonly kind: TeamInvitationMutationOperation; readonly invitation: TeamInvitation };

type RequestIdentity = {
  readonly accountId: string;
  readonly authToken: string;
  readonly teamId: string;
  readonly generation: number;
};

type PendingInvitationRecovery = Pick<TeamInvitation, "id" | "state" | "role" | "expiresAt">;

const pendingInvitationRecovery = new Map<string, PendingInvitationRecovery>();

function recoverablePending(invitation: TeamInvitation): PendingInvitationRecovery | null {
  if (invitation.state !== "PENDING") return null;
  return {
    id: invitation.id,
    state: invitation.state,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
  };
}

function recoveredInvitation(metadata: PendingInvitationRecovery): TeamInvitation {
  return {
    ...metadata,
    revision: -1,
    canReveal: false,
    linkRecoverability: "RECOVERABLE",
  };
}

function recoveredInvitations(contextKey: string): ReadonlyArray<TeamInvitation> {
  const metadata = pendingInvitationRecovery.get(contextKey);
  return metadata ? [recoveredInvitation(metadata)] : [];
}

function publishPendingRecovery(contextKey: string, invitation: TeamInvitation) {
  const metadata = recoverablePending(invitation);
  if (metadata) pendingInvitationRecovery.set(contextKey, metadata);
  else pendingInvitationRecovery.delete(contextKey);
}

function publishPageRecovery(contextKey: string, invitations: ReadonlyArray<TeamInvitation>) {
  const pending = invitations.find((invitation) => invitation.state === "PENDING");
  if (pending) publishPendingRecovery(contextKey, pending);
  else pendingInvitationRecovery.delete(contextKey);
}

function requestFailure(error: unknown): TeamInvitationMutationFailure {
  if (error instanceof TeamInvitationRequestError) {
    return {
      kind: "http",
      status: error.status,
      ...(error.code ? { code: error.code } : {}),
    };
  }
  return { kind: "network" };
}

function invitationStateLabel(state: TeamInvitation["state"]): string {
  switch (state) {
    case "PENDING":
      return "Ожидает принятия";
    case "ACCEPTED":
      return "Принято";
    case "REVOKED":
      return "Отозвано";
    case "EXPIRED":
      return "Истекло";
  }
}

function recoverabilityLabel(invitation: TeamInvitation): string | null {
  if (invitation.linkRecoverability === "UNRECOVERABLE_LEGACY") {
    return "Эту ранее выпущенную ссылку нельзя показать повторно. Перевыпустите её вручную.";
  }
  if (invitation.linkRecoverability === "NOT_APPLICABLE" && invitation.state !== "PENDING") {
    return "Ссылка больше недоступна.";
  }
  return null;
}

function updateInvitation(
  current: ReadonlyArray<TeamInvitation>,
  invitation: TeamInvitation,
): ReadonlyArray<TeamInvitation> {
  const withoutUpdated = current.filter((candidate) => candidate.id !== invitation.id);
  return [invitation, ...withoutUpdated];
}

export function TeamInvitationManagement({ accountId, authToken, teamId }: Props) {
  const contextKey = `${accountId}:${teamId}`;
  const [invitations, setInvitations] = useState<ReadonlyArray<TeamInvitation>>(() => recoveredInvitations(contextKey));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [retryAction, setRetryAction] = useState<RetryAction | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [revealedUrls, setRevealedUrls] = useState<Readonly<Record<string, string>>>({});
  const [revealFailures, setRevealFailures] = useState<Readonly<Record<string, boolean>>>({});
  const [copyFailures, setCopyFailures] = useState<Readonly<Record<string, boolean>>>({});

  const generationRef = useRef(0);
  const identityRef = useRef<RequestIdentity>({ accountId, authToken, teamId, generation: 0 });
  identityRef.current = { accountId, authToken, teamId, generation: generationRef.current };
  const createIntentRef = useRef<string | null>(null);
  const mutationIntentRef = useRef(new Map<string, string>());
  const listRequestRef = useRef(0);
  const revealAttemptRef = useRef(new Set<string>());

  const captureIdentity = (): RequestIdentity => ({ ...identityRef.current });
  const isCurrent = (identity: RequestIdentity) => (
    identity.accountId === identityRef.current.accountId
    && identity.authToken === identityRef.current.authToken
    && identity.teamId === identityRef.current.teamId
    && identity.generation === identityRef.current.generation
  );
  const isSameContext = (identity: RequestIdentity) => (
    identity.accountId === identityRef.current.accountId
    && identity.authToken === identityRef.current.authToken
    && identity.teamId === identityRef.current.teamId
  );

  const clearRevealedUrl = useCallback((invitationId: string) => {
    setRevealedUrls((current) => {
      if (!(invitationId in current)) return current;
      const { [invitationId]: _removed, ...remaining } = current;
      return remaining;
    });
    setCopyFailures((current) => {
      if (!(invitationId in current)) return current;
      const { [invitationId]: _removed, ...remaining } = current;
      return remaining;
    });
  }, []);

  const loadInvitations = useCallback(async () => {
    const identity = captureIdentity();
    const requestNumber = listRequestRef.current + 1;
    listRequestRef.current = requestNumber;
    setLoading(true);
    setLoadError(false);
    try {
      const page = await listTeamInvitations(identity.teamId, identity.authToken);
      if (!isCurrent(identity) || listRequestRef.current !== requestNumber) return;
      publishPageRecovery(contextKey, page.items);
      setInvitations(page.items);
    } catch {
      if (!isCurrent(identity) || listRequestRef.current !== requestNumber) return;
      setLoadError(true);
    } finally {
      if (isCurrent(identity) && listRequestRef.current === requestNumber) setLoading(false);
    }
  // `isCurrent` intentionally reads refs only; its identity is stable for this request lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, authToken, contextKey, teamId]);

  useEffect(() => {
    generationRef.current += 1;
    identityRef.current = { accountId, authToken, teamId, generation: generationRef.current };
    setInvitations(recoveredInvitations(contextKey));
    setLoading(true);
    setLoadError(false);
    setActionError("");
    setStatus("");
    setRetryAction(null);
    setBusyKey(null);
    setRevealedUrls({});
    setRevealFailures({});
    revealAttemptRef.current.clear();
    setCopyFailures({});
    createIntentRef.current = null;
    mutationIntentRef.current.clear();
    listRequestRef.current += 1;
    void loadInvitations();
    return () => {
      generationRef.current += 1;
      identityRef.current = { ...identityRef.current, generation: generationRef.current };
    };
  }, [accountId, authToken, contextKey, loadInvitations, teamId]);

  const runCreate = async () => {
    if (busyKey) return;
    const idempotencyKey = createIntentRef.current ?? crypto.randomUUID();
    createIntentRef.current = idempotencyKey;
    const identity = captureIdentity();
    setBusyKey("create");
    setActionError("");
    setStatus("");
    setRetryAction(null);
    setRevealedUrls({});
    revealAttemptRef.current.clear();
    try {
      const created = await createTeamInvitation(identity.teamId, identity.authToken, idempotencyKey);
      if (!isCurrent(identity)) return;
      createIntentRef.current = null;
      listRequestRef.current += 1;
      publishPendingRecovery(contextKey, created);
      setInvitations([created]);
      setRevealedUrls({});
      setStatus("Ссылка выпущена");
    } catch (error) {
      if (!isCurrent(identity)) return;
      const failure = requestFailure(error);
      if (failure.kind === "http" && failure.status < 500 && failure.status !== 429) {
        createIntentRef.current = null;
        setRetryAction(null);
      } else {
        setRetryAction({ kind: "create" });
      }
      setActionError("Не удалось создать приглашение");
      void loadInvitations();
    } finally {
      if (isCurrent(identity)) setBusyKey(null);
    }
  };

  const reveal = async (invitation: TeamInvitation) => {
    if (busyKey || !invitation.canReveal) return;
    const identity = captureIdentity();
    setRevealFailures((current) => ({ ...current, [invitation.id]: false }));
    setBusyKey(`reveal:${invitation.id}`);
    setActionError("");
    setStatus("");
    setRetryAction(null);
    try {
      const url = await revealTeamInvitationLink(identity.teamId, invitation.id, identity.authToken);
      // The list request generation may advance while this card remains in the
      // same authenticated team context. A revealed bearer URL is local to the
      // card, so retain it in that case; discard it only after a real context
      // switch (account, token, or team).
      if (!isSameContext(identity)) return;
      setRevealedUrls((current) => ({ ...current, [invitation.id]: new URL(url, window.location.origin).href }));
    } catch {
      if (!isCurrent(identity)) return;
      setRevealFailures((current) => ({ ...current, [invitation.id]: true }));
    } finally {
      if (isCurrent(identity)) setBusyKey(null);
    }
  };

  useEffect(() => {
    if (busyKey || loading || loadError) return;
    const pending = invitations.find((item) => item.state === "PENDING" && item.canReveal && !revealedUrls[item.id]);
    if (!pending) return;
    const attemptKey = `${pending.id}:${pending.revision}`;
    if (revealAttemptRef.current.has(attemptKey)) return;
    revealAttemptRef.current.add(attemptKey);
    void reveal(pending);
  // The effect reacts to invitation metadata, not the identity of the reveal callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitations, revealedUrls, busyKey, loading, loadError]);

  const resolveMutationInvitation = async (
    identity: RequestIdentity,
    invitation: TeamInvitation,
  ): Promise<TeamInvitation> => {
    if (invitation.revision >= 0) return invitation;
    const page = await listTeamInvitations(identity.teamId, identity.authToken);
    if (!isCurrent(identity)) return invitation;
    publishPageRecovery(contextKey, page.items);
    setInvitations(page.items);
    const fresh = page.items.find((candidate) => candidate.id === invitation.id && candidate.state === "PENDING");
    if (fresh) return fresh;
    throw new TeamInvitationRequestError(409, "Приглашение больше недоступно", "INVITATION_NOT_RECOVERED");
  };

  const runMutation = async (operation: TeamInvitationMutationOperation, invitation: TeamInvitation) => {
    if (busyKey) return;
    const identity = captureIdentity();
    setBusyKey(`${operation}:${invitation.id}`);
    setActionError("");
    setStatus("");
    setRetryAction(null);
    clearRevealedUrl(invitation.id);
    let targetInvitation = invitation;
    try {
      targetInvitation = await resolveMutationInvitation(identity, invitation);
      if (!isCurrent(identity)) return;
      const intentKey = `${operation}:${targetInvitation.id}:${targetInvitation.revision}`;
      const idempotencyKey = mutationIntentRef.current.get(intentKey) ?? crypto.randomUUID();
      mutationIntentRef.current.set(intentKey, idempotencyKey);
      const result = operation === "reissue"
        ? await reissueTeamInvitation(identity.teamId, targetInvitation.id, targetInvitation.revision, identity.authToken, idempotencyKey)
        : await revokeTeamInvitation(identity.teamId, targetInvitation.id, targetInvitation.revision, identity.authToken, idempotencyKey);
      if (!isCurrent(identity)) return;
      mutationIntentRef.current.delete(intentKey);
      listRequestRef.current += 1;
      publishPendingRecovery(contextKey, result);
      setInvitations((current) => updateInvitation(current, result));
      setStatus(operation === "reissue" ? "Ссылка перевыпущена" : "Приглашение отозвано");
      void loadInvitations();
    } catch (error) {
      if (!isCurrent(identity)) return;
      const policy = classifyTeamInvitationMutationFailure(operation, requestFailure(error));
      const intentKey = targetInvitation.revision >= 0
        ? `${operation}:${targetInvitation.id}:${targetInvitation.revision}`
        : null;
      if (!policy.preserveIntent && intentKey) mutationIntentRef.current.delete(intentKey);
      setRetryAction(policy.disposition === "retry" ? { kind: operation, invitation: targetInvitation } : null);
      setActionError(operation === "reissue" ? "Не удалось перевыпустить ссылку" : "Не удалось отозвать приглашение");
      revealAttemptRef.current.delete(`${targetInvitation.id}:${targetInvitation.revision}`);
      void loadInvitations();
    } finally {
      if (isCurrent(identity)) setBusyKey(null);
    }
  };

  const revoke = (invitation: TeamInvitation) => runMutation("revoke", invitation);

  const copy = async (invitation: TeamInvitation, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      publishPendingRecovery(contextKey, invitation);
      setCopyFailures((current) => ({ ...current, [invitation.id]: false }));
      setActionError("");
      setRetryAction(null);
      setStatus("Ссылка скопирована");
    } catch {
      setCopyFailures((current) => ({ ...current, [invitation.id]: true }));
      setActionError("Не удалось скопировать ссылку");
    }
  };

  const retry = () => {
    if (!retryAction) return;
    if (retryAction.kind === "create") {
      void runCreate();
      return;
    }
    void runMutation(retryAction.kind, retryAction.invitation);
  };

  return (
    <Stack className={styles.management} gap="lg">
      <Group className={styles.headingWithCreate} justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          <Title order={2}>Приглашения</Title>
          <Text c="gray.5" mt={6}>Одна ссылка для всей команды. Её можно отправить нескольким людям.</Text>
        </div>
        <Button className={styles.primaryAction} loading={busyKey === "create"} onClick={() => void runCreate()}>
          {invitations.some((item) => item.state === "PENDING") ? "Перевыпустить ссылку" : "Выпустить ссылку"}
        </Button>
      </Group>

      {actionError ? (
        <Alert color="red" role="alert" title="Действие не выполнено">
          <Stack gap="sm">
            <Text>{actionError}</Text>
            {retryAction ? (
              <Button className={styles.secondaryAction} variant="light" disabled={Boolean(busyKey)} onClick={retry}>
                {retryAction.kind === "create" ? "Повторить создание" : "Повторить"}
              </Button>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {status ? <Text className={styles.status} role="status">{status}</Text> : null}

      {loading ? (
        <Stack gap="xs" role="status" aria-label="Загружаем приглашения">
          <Text c="gray.5">Загружаем приглашения…</Text>
        </Stack>
      ) : null}

      {loadError ? (
        <Alert color="red" role="alert" title="Не удалось загрузить приглашения">
          <Button className={styles.secondaryAction} variant="light" onClick={() => void loadInvitations()}>
            Повторить
          </Button>
        </Alert>
      ) : null}

      {!loading && !loadError && invitations.length === 0 ? (
        <Card className={styles.panel} withBorder>
          <Text fw={700}>Ссылка ещё не выпущена</Text>
          <Text size="sm" c="gray.5">Ожидающая ссылка не добавляет сотрудника до явного принятия.</Text>
        </Card>
      ) : null}

      {!loadError ? invitations.map((invitation) => {
        const rawUrl = revealedUrls[invitation.id];
        const recoverability = recoverabilityLabel(invitation);
        const isPending = invitation.state === "PENDING";
        const isBusy = Boolean(busyKey);
        return (
          <Card
            key={invitation.id}
            component="article"
            className={styles.panel}
            withBorder
            aria-label={`Приглашение ${invitation.id}`}
          >
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Text fw={700}>Ссылка для вступления в команду</Text>
                  <Text size="sm" c="gray.5">{invitationStateLabel(invitation.state)}</Text>
                </div>
                {isPending ? (
                  <Group className={styles.actions} gap="sm">
                    <Button
                      className={styles.secondaryAction}
                      color="red"
                      variant="light"
                      disabled={isBusy}
                      onClick={() => void revoke(invitation)}
                    >
                      Отозвать приглашение
                    </Button>
                  </Group>
                ) : null}
              </Group>

              {recoverability ? <Text size="sm" c="gray.5">{recoverability}</Text> : null}

              {isPending && invitation.canReveal && !rawUrl && !revealFailures[invitation.id] ? (
                <Text size="sm" c="gray.5" role="status">Загружаем ссылку…</Text>
              ) : null}
              {isPending && revealFailures[invitation.id] ? (
                <Button className={styles.secondaryAction} variant="light" onClick={() => void reveal(invitation)}>
                  Повторить загрузку ссылки
                </Button>
              ) : null}

              {rawUrl ? (
                <Stack gap="sm">
                  <TextInput className={styles.linkInput} label="Ссылка для приглашения" value={rawUrl} readOnly />
                  <Group className={styles.actions} gap="sm">
                    <Button className={styles.primaryAction} onClick={() => void copy(invitation, rawUrl)}>
                      {copyFailures[invitation.id] ? "Повторить копирование" : "Копировать ссылку"}
                    </Button>
                  </Group>
                </Stack>
              ) : null}
            </Stack>
          </Card>
        );
      }) : null}
    </Stack>
  );
}
