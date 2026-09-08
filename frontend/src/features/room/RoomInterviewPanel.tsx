import React, { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
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
} from "@mantine/core";
import { CopyHrId } from "../hr/CopyHrId";
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
  inviteCode: string;
  identityKey: string;
  canManageRoom: boolean;
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
  inviteCode,
  identityKey,
  canManageRoom,
  authorityGeneration,
  isCurrentAuthority,
  pendingHrActions,
  onRemoveHr,
  removalError,
  ownerToken,
  interviewerToken,
  eventToken,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [archived, setArchived] = useState(false);
  const [metadata, setMetadata] = useState<InterviewMetadata | null>(null);
  const [managers, setManagers] = useState<HrManager[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [hrId, setHrId] = useState("");
  const [panelError, setPanelError] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
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
    setHrId("");
    setPanelError("");
    setInviteError("");
    setSaveMessage("");
    setInviteMessage("");
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
      }, false));
      const [nextMetadata, nextManagers] = await Promise.all([
        metadataRequest.unwrap(),
        managersRequest.unwrap(),
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
        setPanelError(messageOf(error, "Не удалось загрузить сведения кандидата и нанимающих"));
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
    setSaveMessage("");
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
      setSaveMessage("Сведения сохранены");
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

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    if (!hrId.trim() || archived) return;
    setInviteError("");
    setInviteMessage("");
    const generation = beginRequestGeneration();
    try {
      const request = trackRequest(addManager({
        ...requestCredentials(),
        userId: hrId,
      }));
      const nextManagers = await request.unwrap();
      if (!isCurrentGeneration(generation)) return;
      setManagers(nextManagers);
      setHrId("");
      setInviteMessage("Нанимающий добавлен");
    } catch (error) {
      if (!isCurrentGeneration(generation) || isAbortError(error)) return;
      if (statusOf(error) === 410) {
        setArchived(true);
        setInviteError("Комната в архиве. Изменения недоступны.");
      } else if (statusOf(error) === 400 || statusOf(error) === 404) {
        setInviteError("Нанимающий с таким ID не найден");
      } else {
        setInviteError(messageOf(error, "Не удалось добавить нанимающего"));
      }
    }
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
        <Button type="button" size="xs" variant="light" onClick={open}>
          Кандидат и нанимающие
        </Button>
      ) : null}
      <Text size="xs" c="yellow.4" aria-live="polite" className={styles.accessMessage}>
        {accessMessage}
      </Text>
      <Modal
        opened={opened && canManageRoom}
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
          <Text size="sm" c="gray.5">
            Эти сведения доступны только менеджерам комнаты и назначенным нанимающим.
          </Text>
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
                  <TextInput
                    label="Имя кандидата"
                    description={candidateName.length > 180 ? `Осталось ${200 - candidateName.length} символов` : undefined}
                    value={candidateName}
                    onChange={(event) => setCandidateName(event.currentTarget.value)}
                    maxLength={200}
                    disabled={pending || archived || metadata === null}
                  />
                  <TextInput
                    label="Позиция"
                    description={position.length > 180 ? `Осталось ${200 - position.length} символов` : undefined}
                    value={position}
                    onChange={(event) => setPosition(event.currentTarget.value)}
                    maxLength={200}
                    disabled={pending || archived || metadata === null}
                  />
                  <TextInput
                    type="datetime-local"
                    label="Дата и время интервью (МСК)"
                    description="Время сохраняется и показывается в часовом поясе Москвы (МСК)."
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.currentTarget.value)}
                    disabled={pending || archived || metadata === null}
                  />
                  <Group align="center">
                    <Button type="submit" loading={updateState.isLoading} disabled={pending || archived || metadata === null || !metadataChanged}>
                      {updateState.isLoading ? "Сохраняем…" : "Сохранить сведения"}
                    </Button>
                    <Text size="sm" c="teal.4" aria-live="polite">{saveMessage}</Text>
                  </Group>
                </Stack>
              </form>

              <Divider color="#272b34" />
              <Stack gap="sm">
                <Title order={4}>Нанимающие</Title>
                {removalError ? <Alert color="red" role="alert">{removalError}</Alert> : null}
                {managers.length === 0 ? <Text size="sm" c="gray.5">Нанимающие пока не добавлены</Text> : null}
                {managers.map((manager) => (
                  <div key={manager.userId} className={styles.managerRow}>
                    <Group gap="xs">
                      <Text fw={600}>{manager.displayName}</Text>
                      {manager.isOwner ? <Badge color="gray">Владелец</Badge> : null}
                    </Group>
                    <CopyHrId id={manager.userId} compact />
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
                <form onSubmit={invite}>
                  <Stack gap="xs">
                    <TextInput
                      label="ID нанимающего"
                      value={hrId}
                      onChange={(event) => setHrId(event.currentTarget.value)}
                      error={inviteError || undefined}
                      disabled={pending || archived}
                    />
                    <Group>
                      <Button type="submit" loading={addState.isLoading} disabled={pending || archived || !hrId.trim()}>
                        {addState.isLoading ? "Добавляем…" : "Добавить нанимающего"}
                      </Button>
                      <Text size="sm" c="teal.4" aria-live="polite">{inviteMessage}</Text>
                    </Group>
                  </Stack>
                </form>
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
