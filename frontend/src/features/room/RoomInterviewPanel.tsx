import React, { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { App } from "antd";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from "components/antd-compat";
import { HiringManagerPicker } from "../hr/HiringManagerPicker";
import { IconUsers } from "components/antd-icons";
import { instantToMoscowInput, moscowInputToInstant } from "../hr/hrDate";
import {
  useAddHrManagerMutation,
  useLazyGetHrManagersQuery,
  useLazyGetInterviewMetadataQuery,
  useUpdateInterviewMetadataMutation,
} from "../../services/api";
import type { HrManager, InterviewMetadata } from "../../types";
import type { HrAction } from "./TopBar";
import styles from "./RoomInterviewPanel.module.css";

type Props = {
  triggerLabel?: string;
  triggerAriaLabel?: string;
  inviteCode: string;
  identityKey: string;
  canManageRoom: boolean;
  isTeamRoom: boolean;
  teamId?: string;
  authorityGeneration: number;
  isCurrentAuthority: (generation: number) => boolean;
  pendingHrActions: ReadonlyMap<string, HrAction>;
  onRemoveHr: (manager: HrManager) => Promise<boolean>;
  removalError: string;
  ownerToken?: string;
  interviewerToken?: string;
  eventToken?: string;
};

type AbortableRequest = {
  abort: () => void;
};

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  return typeof error.status === "number" ? error.status : null;
}

function messageOf(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object" || !("data" in error)) return fallback;
  const data = error.data;
  if (!data || typeof data !== "object" || !("error" in data)) return fallback;
  return typeof data.error === "string" && data.error.trim() ? data.error : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function RoomInterviewPanel({
  triggerLabel,
  triggerAriaLabel,
  inviteCode,
  identityKey,
  canManageRoom,
  isTeamRoom,
  teamId,
  authorityGeneration,
  isCurrentAuthority,
  pendingHrActions,
  onRemoveHr,
  removalError,
  ownerToken,
  interviewerToken,
  eventToken,
}: Props) {
  const { notification } = App.useApp();
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [archived, setArchived] = useState(false);
  const [metadata, setMetadata] = useState<InterviewMetadata | null>(null);
  const [managers, setManagers] = useState<HrManager[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [panelError, setPanelError] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const hadManagerAccess = useRef(false);
  const [getMetadata] = useLazyGetInterviewMetadataQuery();
  const [getManagers] = useLazyGetHrManagersQuery();
  const [updateMetadata, updateState] = useUpdateInterviewMetadataMutation();
  const [addManager, addState] = useAddHrManagerMutation();
  const requestGenerationRef = useRef(0);
  const requestAuthorityGenerationRef = useRef(authorityGeneration);
  const activeRequestsRef = useRef<Set<AbortableRequest>>(new Set());
  const pending = updateState.isLoading || addState.isLoading || pendingHrActions.size > 0;
  const draftInstant = scheduledAt ? moscowInputToInstant(scheduledAt) : null;
  const metadataChanged = Boolean(
    metadata &&
      ((candidateName.trim() || null) !== metadata.candidateName ||
        (position.trim() || null) !== metadata.position ||
        (scheduledAt && !draftInstant) ||
        (draftInstant ? new Date(draftInstant).getTime() : null) !==
          (metadata.scheduledAt ? new Date(metadata.scheduledAt).getTime() : null)),
  );

  const requestCredentials = () => ({
    inviteCode,
    ...(ownerToken ? { ownerToken } : {}),
    ...(interviewerToken ? { interviewerToken } : {}),
    ...(eventToken ? { eventToken } : {}),
  });

  const invalidateRequests = () => {
    requestGenerationRef.current += 1;
    activeRequestsRef.current.forEach((request) => request.abort());
    activeRequestsRef.current.clear();
  };

  const beginRequestGeneration = () => {
    invalidateRequests();
    requestAuthorityGenerationRef.current = authorityGeneration;
    return requestGenerationRef.current;
  };

  const trackRequest = <T extends AbortableRequest>(request: T): T => {
    activeRequestsRef.current.add(request);
    return request;
  };

  const isCurrentGeneration = (generation: number) =>
    requestGenerationRef.current === generation &&
    isCurrentAuthority(requestAuthorityGenerationRef.current);

  const applyMetadata = (next: InterviewMetadata) => {
    setMetadata(next);
    setCandidateName(next.candidateName ?? "");
    setPosition(next.position ?? "");
    setScheduledAt(instantToMoscowInput(next.scheduledAt));
    setConflict(false);
  };

  const clearPrivateState = () => {
    setLoading(false);
    setMetadata(null);
    setManagers([]);
    setCandidateName("");
    setPosition("");
    setScheduledAt("");
    setPanelError("");
    setInviteError("");
    setConflict(false);
    setArchived(false);
  };

  useLayoutEffect(() => {
    invalidateRequests();
    setOpened(false);
    clearPrivateState();
    return invalidateRequests;
    // Each server authority transition expires private requests, including
    // permission loss/regain that React batches into a single render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, identityKey, authorityGeneration]);

  useEffect(() => {
    if (canManageRoom) {
      hadManagerAccess.current = true;
      setAccessMessage("");
      return;
    }
    if (hadManagerAccess.current) {
      invalidateRequests();
      setOpened(false);
      clearPrivateState();
      setAccessMessage("Доступ к сведениям кандидата изменился");
      hadManagerAccess.current = false;
    }
  }, [canManageRoom]);

  const loadPanel = async (replaceDraft: boolean) => {
    const generation = beginRequestGeneration();
    setLoading(true);
    setPanelError("");
    try {
      const credentials = requestCredentials();
      const metadataRequest = trackRequest(getMetadata({
        ...credentials,
        requestGeneration: generation,
      }, false));
      const managersRequest = trackRequest(getManagers({
        ...credentials,
        requestGeneration: generation,
      }, false)).unwrap();
      const [nextMetadata, nextManagers] = await Promise.all([
        metadataRequest.unwrap(),
        managersRequest,
      ]);
      if (!isCurrentGeneration(generation)) return;
      if (replaceDraft || metadata === null) applyMetadata(nextMetadata);
      setManagers(nextManagers);
      setArchived(false);
    } catch (error) {
      if (!isCurrentGeneration(generation) || isAbortError(error)) return;
      if (statusOf(error) === 410) {
        setArchived(true);
        setPanelError("Комната в архиве. Изменения недоступны.");
      } else {
        setPanelError(messageOf(error, "Не удалось загрузить сведения"));
      }
    } finally {
      if (isCurrentGeneration(generation)) setLoading(false);
    }
  };

  const open = () => {
    setOpened(true);
    clearPrivateState();
    void loadPanel(true);
  };

  const close = () => {
    if (pending) return;
    invalidateRequests();
    setOpened(false);
    clearPrivateState();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!metadata || archived) return;
    setPanelError("");
    setConflict(false);
    const normalizedInstant = scheduledAt ? moscowInputToInstant(scheduledAt) : null;
    if (scheduledAt && !normalizedInstant) {
      setPanelError("Проверьте дату и время интервью");
      return;
    }
    const generation = beginRequestGeneration();
    try {
      const request = trackRequest(updateMetadata({
        ...requestCredentials(),
        metadata: {
          candidateName: candidateName.trim() || null,
          position: position.trim() || null,
          scheduledAt: normalizedInstant,
          revision: metadata.revision,
        },
      }));
      const next = await request.unwrap();
      if (!isCurrentGeneration(generation)) return;
      applyMetadata(next);
      notification.success({ title: "Сведения сохранены", placement: "top", role: "status" });
    } catch (error) {
      if (!isCurrentGeneration(generation) || isAbortError(error)) return;
      if (statusOf(error) === 409) {
        setConflict(true);
        setPanelError("Сведения изменил другой менеджер. Ваши изменения сохранены в форме.");
      } else if (statusOf(error) === 410) {
        setArchived(true);
        setPanelError("Комната в архиве. Изменения недоступны.");
      } else {
        setPanelError(messageOf(error, "Не удалось сохранить сведения"));
      }
    }
  };

  const invite = async (userId: string) => {
    if (!userId.trim() || archived || pending || !isCurrentAuthority(authorityGeneration)) return false;
    setInviteError("");
    const generation = beginRequestGeneration();
    try {
      const request = trackRequest(addManager({
        ...requestCredentials(),
        userId,
      }));
      const nextManagers = await request.unwrap();
      if (!isCurrentGeneration(generation)) return;
      setManagers(nextManagers);
      notification.success({ title: "Нанимающий добавлен", placement: "top", role: "status" });
      return true;
    } catch (error) {
      if (!isCurrentGeneration(generation) || isAbortError(error)) return;
      if (statusOf(error) === 410) {
        setArchived(true);
        setInviteError("Комната в архиве. Изменения недоступны.");
      } else if (statusOf(error) === 400 || statusOf(error) === 404) {
        setInviteError("Нанимающий не найден или недоступен");
      } else {
        setInviteError(messageOf(error, "Не удалось добавить нанимающего"));
      }
    }
    return false;
  };

  const remove = async (manager: HrManager) => {
    if (pending || archived || manager.isOwner || !isCurrentAuthority(authorityGeneration)) return;
    const generation = beginRequestGeneration();
    const confirmed = await onRemoveHr(manager);
    if (!confirmed || !isCurrentGeneration(generation)) return;
    await loadPanel(false);
  };

  return (
    <>
      {canManageRoom ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={styles.candidateAction}
          aria-label={triggerAriaLabel}
          leftSection={<IconUsers size={16} />}
          onClick={open}
        >
          {triggerLabel ?? "Кандидат и нанимающие"}
        </Button>
      ) : null}
      <Text size="xs" c="yellow.4" aria-live="polite" className={styles.accessMessage}>
        {accessMessage}
      </Text>
      <Modal
        opened={opened && canManageRoom}
        destroyOnHidden
        onClose={close}
        title="Кандидат и нанимающие"
        size="lg"
        centered
        closeOnClickOutside={!pending}
        closeOnEscape={!pending}
        withCloseButton={!pending}
        classNames={{ body: styles.modalBody, close: styles.modalClose }}
      >
        <Stack gap="lg">
          {loading ? (
            <Group justify="center" py="xl" aria-busy="true"><Loader size="sm" /><Text>Загружаем сведения…</Text></Group>
          ) : (
            <>
              {archived ? <Alert color="gray">Комната в архиве. Изменения недоступны.</Alert> : null}
              {panelError ? (
                <Alert color={conflict ? "yellow" : "red"} role="alert">
                  <Text size="sm">{panelError}</Text>
                  {conflict ? (
                    <Button type="button" size="xs" variant="light" mt="xs" onClick={() => void loadPanel(true)}>
                      Загрузить актуальные сведения
                    </Button>
                  ) : metadata === null && !archived ? (
                    <Button type="button" size="xs" variant="light" mt="xs" onClick={() => void loadPanel(true)}>Повторить</Button>
                  ) : null}
                </Alert>
              ) : null}

              <form onSubmit={save}>
                <Stack gap="sm">
                  <Title order={4}>Сведения о кандидате</Title>
                  <TextInput placeholder="Введите имя кандидата"
                    label="Имя кандидата"
                    description={candidateName.length > 180 ? `Осталось ${200 - candidateName.length} символов` : undefined}
                    value={candidateName}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCandidateName(event.currentTarget.value)}
                    maxLength={200}
                    disabled={pending || archived || metadata === null}
                  />
                  <TextInput placeholder="Введите название должности"
                    label="Позиция"
                    description={position.length > 180 ? `Осталось ${200 - position.length} символов` : undefined}
                    value={position}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPosition(event.currentTarget.value)}
                    maxLength={200}
                    disabled={pending || archived || metadata === null}
                  />
                  <TextInput
                    type="datetime-local"
                    label="Дата и время интервью (МСК)"
                    value={scheduledAt}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setScheduledAt(event.currentTarget.value)}
                    disabled={pending || archived || metadata === null}
                  />
                  <Group align="center">
                    <Button type="submit" loading={updateState.isLoading} disabled={pending || archived || metadata === null || !metadataChanged}>
                      {updateState.isLoading ? "Сохраняем…" : "Сохранить сведения"}
                    </Button>
                  </Group>
                </Stack>
              </form>

              <Divider color="var(--app-border)" />
              <Stack gap="sm">
                <Title order={4}>Нанимающие</Title>
                {removalError ? <Alert color="red" role="alert">{removalError}</Alert> : null}
                {managers.map((manager) => (
                  <div key={manager.userId} className={styles.managerRow}>
                    <Group gap="xs">
                      <Text fw={600}>{manager.displayName}</Text>
                      {manager.isOwner ? <Badge color="gray">Владелец</Badge> : null}
                    </Group>
                    {!manager.isOwner ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="light"
                        color="red"
                        mt="xs"
                        aria-label={`Снять роль нанимающего у ${manager.displayName}`}
                        disabled={pending || archived}
                        loading={pendingHrActions.get(manager.userId) === "remove"}
                        onClick={() => void remove(manager)}
                      >
                        {pendingHrActions.get(manager.userId) === "remove" ? "Снимаем роль нанимающего…" : "Снять роль нанимающего"}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {opened && canManageRoom ? <HiringManagerPicker room={{ inviteCode, ownerToken, interviewerToken, eventToken }} showSuccess={false} key={`${identityKey}:${authorityGeneration}`} teamId={isTeamRoom ? teamId : undefined} selectedIds={managers.map(manager => manager.userId)} disabled={pending || archived} onSelect={person => invite(person.normalizedId)} /> : null}
                {inviteError ? <Text role="alert" c="red.4" size="sm">{inviteError}</Text> : null}
              </Stack>

              <Group justify="flex-end" className={styles.footer}>
                <Button type="button" variant="outline" onClick={close} disabled={pending}>Закрыть</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </>
  );
}
