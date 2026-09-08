import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Pagination,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { CopyHrId } from "../../features/hr/CopyHrId";
import { formatMoscowDateTime } from "../../features/hr/hrDate";
import { useGetHrInterviewsQuery, useLazyGetHrInterviewQuery } from "../../services/api";
import { downloadHrWorkbook, HrExportError } from "../../services/hrExport";
import type { HrInterview, User } from "../../types";
import styles from "./HrCabinetSection.module.css";

const PAGE_SIZE = 20;

function dateSourceLabel(source: HrInterview["dateSource"]): string {
  if (source === "scheduled") return "Запланированная дата";
  if (source === "finished") return "Дата первого завершения";
  return "Дата создания комнаты";
}

function interviewBadge(interview: HrInterview) {
  if (interview.archivedAt) return { label: "Архив", color: "gray" };
  if (interview.status === "finished" || interview.interviewState === "finished") {
    return { label: "Завершено", color: "teal" };
  }
  if (interview.scheduledAt) {
    const scheduled = new Date(interview.scheduledAt).getTime();
    if (Number.isFinite(scheduled) && scheduled > Date.now()) {
      return { label: "Предстоящее", color: "blue" };
    }
    return { label: "Просрочено", color: "orange" };
  }
  return { label: "Активно", color: "green" };
}

function fallback(value: string | null): string {
  return value?.trim() || "Не указано";
}

function DetailModal({
  roomId,
  onClose,
}: {
  roomId: string | null;
  onClose: () => void;
}) {
  const [load, { data, isFetching, error }] = useLazyGetHrInterviewQuery();
  const [waitingForCurrentRoom, setWaitingForCurrentRoom] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    setWaitingForCurrentRoom(true);
    void load({ roomId }, false).finally(() => {
      if (active) setWaitingForCurrentRoom(false);
    });
    return () => {
      active = false;
    };
  }, [load, roomId]);

  const retry = () => {
    if (!roomId) return;
    setWaitingForCurrentRoom(true);
    void load({ roomId }, false).finally(() => setWaitingForCurrentRoom(false));
  };

  return (
    <Modal
      opened={roomId !== null}
      onClose={onClose}
      title="Результаты интервью"
      size="lg"
      centered
      classNames={{ body: styles.detailModalBody, close: styles.modalClose }}
    >
      {waitingForCurrentRoom || (isFetching && !data) ? (
        <Stack aria-busy="true">
          <Skeleton height={26} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </Stack>
      ) : error || !data ? (
        <Alert color="red" title="Не удалось загрузить результаты" role="alert">
          <Group mt="sm">
            <Button type="button" size="xs" variant="light" onClick={retry}>Повторить</Button>
            <Button type="button" size="xs" variant="subtle" onClick={onClose}>Закрыть</Button>
          </Group>
        </Alert>
      ) : (
        <Stack gap="md">
          <div>
            <Group gap="xs" wrap="wrap">
              <Title order={3}>{data.candidateName?.trim() || "Кандидат не указан"}</Title>
              <Badge color={data.status === "finished" ? "teal" : data.interviewState === "scheduled" ? "blue" : "green"}>
                {data.status === "finished" ? "Завершено" : data.interviewState === "scheduled" ? "Запланировано" : "Активно"}
              </Badge>
              {data.archivedAt ? <Badge color="gray">Архив</Badge> : null}
            </Group>
            <Text c="gray.5" size="sm">{data.title}</Text>
          </div>
          {data.archivedAt ? (
            <Alert color="gray">Архивная запись — открыть комнату нельзя</Alert>
          ) : null}
          <div className={styles.detailGrid}>
            <DetailItem label="Позиция" value={fallback(data.position)} />
            <DetailItem label="Запланировано" value={formatMoscowDateTime(data.scheduledAt)} />
            <DetailItem label="Первое завершение" value={formatMoscowDateTime(data.finishedAt)} />
            <DetailItem label="Вердикт" value={fallback(data.verdict)} />
          </div>
          <div>
            <Text size="xs" c="gray.5" fw={700}>Комментарий к вердикту</Text>
            <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {fallback(data.verdictComment)}
            </Text>
          </div>
          <div>
            <Title order={4}>Оценки по задачам</Title>
            {data.taskScores.length === 0 ? (
              <Text c="gray.5" size="sm" mt="xs">Оценок нет</Text>
            ) : (
              <Stack gap="xs" mt="xs">
                {data.taskScores.map((task) => (
                  <Group key={task.taskId} justify="space-between" align="flex-start" wrap="nowrap">
                    <Text style={{ overflowWrap: "anywhere" }}>{`${task.stepIndex + 1}. ${task.title}`}</Text>
                    <Badge color={task.score == null ? "gray" : "blue"}>
                      {task.score == null ? "Не указано" : task.score}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            )}
          </div>
          <Group justify="flex-end" className={styles.modalActions}>
            <Button type="button" onClick={onClose}>Закрыть</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="gray.5" fw={700}>{label}</Text>
      <Text style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </div>
  );
}

function RowActions({ interview, onResults }: { interview: HrInterview; onResults: () => void }) {
  const navigate = useNavigate();
  return (
    <Stack gap="xs" className={styles.rowActions}>
      <Button type="button" size="xs" variant="light" onClick={onResults}>Результаты</Button>
      {!interview.archivedAt ? (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => navigate(`/room/${interview.inviteCode}`)}
        >
          Открыть комнату
        </Button>
      ) : null}
    </Stack>
  );
}

export function HrCabinetSection({ user, token }: { user: User; token: string }) {
  const [page, setPage] = useState(0);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string } | null>(null);
  const [filterError, setFilterError] = useState("");
  const [detailRoomId, setDetailRoomId] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [exportFeedback, setExportFeedback] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportControllerRef = useRef<AbortController | null>(null);
  const exportGenerationRef = useRef(0);
  const args = useMemo(
    () => ({
      page,
      size: PAGE_SIZE,
      ...(appliedRange ?? {}),
    }),
    [appliedRange, page],
  );
  const { data, error, isFetching, refetch } = useGetHrInterviewsQuery(args, {
    refetchOnMountOrArgChange: true,
  });

  useEffect(() => {
    if (data && data.totalPages > 0 && page >= data.totalPages) {
      setPage(data.totalPages - 1);
    }
  }, [data, page]);

  useEffect(() => {
    exportGenerationRef.current += 1;
    exportControllerRef.current?.abort();
    exportControllerRef.current = null;
    return () => {
      exportGenerationRef.current += 1;
      exportControllerRef.current?.abort();
      exportControllerRef.current = null;
    };
  }, [token]);

  const applyPeriod = (event?: FormEvent) => {
    event?.preventDefault();
    if (!fromDraft && !toDraft) {
      setFilterError("");
      setPage(0);
      setAppliedRange(null);
      return;
    }
    if (!fromDraft || !toDraft) {
      setFilterError("Укажите обе даты периода");
      return;
    }
    if (fromDraft > toDraft) {
      setFilterError("Дата начала не может быть позже даты окончания");
      return;
    }
    setFilterError("");
    setPage(0);
    setAppliedRange({ from: fromDraft, to: toDraft });
  };

  const clearPeriod = () => {
    setFromDraft("");
    setToDraft("");
    setFilterError("");
    setPage(0);
    setAppliedRange(null);
  };

  const exportWorkbook = async () => {
    exportControllerRef.current?.abort();
    const controller = new AbortController();
    exportControllerRef.current = controller;
    const generation = exportGenerationRef.current + 1;
    exportGenerationRef.current = generation;
    setExporting(true);
    setExportError("");
    setExportFeedback("");
    try {
      const count = await downloadHrWorkbook({
        token,
        ...(appliedRange ?? {}),
        signal: controller.signal,
        isSessionCurrent: () => localStorage.getItem("auth_token") === token,
      });
      if (controller.signal.aborted || exportGenerationRef.current !== generation) return;
      setExportFeedback(count === 0 ? "Excel скачан: интервью нет" : `Excel скачан: ${count} интервью`);
    } catch (caught) {
      if (controller.signal.aborted || exportGenerationRef.current !== generation) return;
      if (caught instanceof HrExportError && caught.status === 413) {
        setExportError("Слишком много данных. Выберите более короткий период.");
      } else if (caught instanceof HrExportError && caught.status === 429) {
        setExportError("Экспорт занят. Повторите попытку позже.");
      } else {
        setExportError(caught instanceof Error ? caught.message : "Не удалось скачать Excel");
      }
    } finally {
      if (exportGenerationRef.current === generation) {
        exportControllerRef.current = null;
        setExporting(false);
      }
    }
  };

  const hasData = data !== undefined;
  const items = data?.items ?? [];
  const stale = Boolean(error && hasData);
  const firstVisible = data && data.totalElements > 0 ? data.page * data.size + 1 : 0;
  const lastVisible = data ? Math.min((data.page + 1) * data.size, data.totalElements) : 0;

  return (
    <Card withBorder radius="lg" padding="lg" bg="#11151c" c="gray.1" className={styles.cabinet}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" gap="xl" wrap="wrap">
          <div>
            <Title order={2}>Кандидаты и интервью</Title>
            <Text c="gray.5" size="sm" mt={4}>
              Только закреплённые за вами интервью. Даты показаны по времени Москвы.
            </Text>
          </div>
          <CopyHrId id={user.id} compact />
        </Group>

        <form onSubmit={applyPeriod}>
          <Group align="flex-end" wrap="wrap" className={styles.toolbar}>
            <TextInput
              type="date"
              label="Период с"
              value={fromDraft}
              onChange={(event) => setFromDraft(event.currentTarget.value)}
              error={filterError || undefined}
            />
            <TextInput
              type="date"
              label="Период по"
              value={toDraft}
              onChange={(event) => setToDraft(event.currentTarget.value)}
            />
            <Button type="submit" variant="light">Применить период</Button>
            <Button
              type="button"
              variant="subtle"
              onClick={clearPeriod}
              disabled={!appliedRange && !fromDraft && !toDraft}
            >
              За всё время
            </Button>
            <Button
              type="button"
              variant="outline"
              leftSection={<IconRefresh size={15} />}
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching && hasData ? "Обновляем…" : "Обновить список"}
            </Button>
            <Button
              type="button"
              leftSection={<IconDownload size={15} />}
              onClick={() => void exportWorkbook()}
              disabled={exporting}
            >
              {exporting ? "Готовим Excel…" : "Скачать Excel"}
            </Button>
          </Group>
          <Text size="xs" c="gray.5" mt="xs">
            Границы периода включительны, время — московское (МСК). Для отбора используется
            запланированная дата, а если её нет — дата первого завершения или создания комнаты.
          </Text>
        </form>

        {error ? (
          <Alert color={stale ? "yellow" : "red"} role="alert" title="Не удалось загрузить интервью">
            <Text size="sm">{stale ? "Данные не обновлены. Показаны последние успешно загруженные сведения." : "Проверьте соединение и повторите попытку."}</Text>
            <Button type="button" size="xs" variant="light" mt="xs" onClick={() => void refetch()}>Повторить</Button>
          </Alert>
        ) : null}
        {exportError ? (
          <Alert color="red" role="alert" title="Не удалось скачать Excel">
            <Text size="sm">{exportError}</Text>
            <Button type="button" size="xs" variant="light" mt="xs" onClick={() => void exportWorkbook()}>
              Повторить скачивание
            </Button>
          </Alert>
        ) : null}
        <Text size="sm" c="teal.4" aria-live="polite" style={{ minHeight: 20 }}>{exportFeedback}</Text>

        <Box aria-busy={isFetching} aria-label="Список интервью">
          {!hasData && isFetching ? (
            <Stack>
              <Skeleton height={42} />
              <Skeleton height={68} />
              <Skeleton height={68} />
            </Stack>
          ) : !hasData ? null : items.length === 0 ? (
            <Text ta="center" py="xl" c="gray.4">
              {appliedRange ? "За выбранный период интервью нет" : "Пока нет интервью"}
            </Text>
          ) : (
            <>
              <div className={styles.desktopTable}>
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Кандидат</Table.Th>
                      <Table.Th>Позиция</Table.Th>
                      <Table.Th>Комната</Table.Th>
                      <Table.Th>Дата интервью</Table.Th>
                      <Table.Th>Статус</Table.Th>
                      <Table.Th>Действия</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {items.map((interview) => {
                      const badge = interviewBadge(interview);
                      return (
                        <Table.Tr key={interview.roomId}>
                          <Table.Td>{fallback(interview.candidateName)}</Table.Td>
                          <Table.Td>{fallback(interview.position)}</Table.Td>
                          <Table.Td>{interview.title}</Table.Td>
                          <Table.Td>
                            <Text size="sm">{formatMoscowDateTime(interview.scheduledAt)}</Text>
                            {!interview.scheduledAt ? (
                              <Text size="xs" c="gray.5">
                                {dateSourceLabel(interview.dateSource)}: {formatMoscowDateTime(interview.effectiveAt)}
                              </Text>
                            ) : null}
                          </Table.Td>
                          <Table.Td><Badge color={badge.color}>{badge.label}</Badge></Table.Td>
                          <Table.Td><RowActions interview={interview} onResults={() => setDetailRoomId(interview.roomId)} /></Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
              <Stack className={styles.mobileCards}>
                {items.map((interview) => {
                  const badge = interviewBadge(interview);
                  return (
                    <Card key={interview.roomId} withBorder bg="#121720">
                      <DetailItem label="Кандидат" value={fallback(interview.candidateName)} />
                      <DetailItem label="Позиция" value={fallback(interview.position)} />
                      <DetailItem label="Комната" value={interview.title} />
                      <DetailItem label="Дата интервью" value={formatMoscowDateTime(interview.scheduledAt)} />
                      {!interview.scheduledAt ? (
                        <Text size="xs" c="gray.5">
                          {dateSourceLabel(interview.dateSource)}: {formatMoscowDateTime(interview.effectiveAt)}
                        </Text>
                      ) : null}
                      <Group my="sm"><Badge color={badge.color}>{badge.label}</Badge></Group>
                      <RowActions interview={interview} onResults={() => setDetailRoomId(interview.roomId)} />
                    </Card>
                  );
                })}
              </Stack>
            </>
          )}
        </Box>

        {data && data.totalPages > 1 ? (
          <Group justify="space-between" wrap="wrap">
            <Text size="sm" aria-live="polite">Показаны {firstVisible}–{lastVisible} из {data.totalElements}</Text>
            <Pagination total={data.totalPages} value={data.page + 1} onChange={(value) => setPage(value - 1)} />
          </Group>
        ) : null}
      </Stack>
      <DetailModal roomId={detailRoomId} onClose={() => setDetailRoomId(null)} />
    </Card>
  );
}
