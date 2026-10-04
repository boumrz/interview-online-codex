import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { App, Table as AntTable, type TableColumnsType } from "antd";
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
  Text,
  TextInput,
  Title,
  Tooltip,
} from "components/antd-compat";
import { IconDownload, IconRefresh, IconHelpCircle } from "components/antd-icons";
import { useNavigate } from "react-router-dom";
import { CopyHrId } from "../../features/hr/CopyHrId";
import { TeamProcessFilters, type TeamProcessFilterValue } from "../../features/workspace/TeamProcessFilters";
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
            {data.trackName ? <DetailItem label="Трек" value={data.trackName} /> : null}
            {data.vacancyTitle ? <DetailItem label="Вакансия" value={data.vacancyTitle} /> : null}
          </div>
          <Stack gap={4}>
            <Text size="xs" c="gray.5" fw={700}>Комментарий к вердикту</Text>
            <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {fallback(data.verdictComment)}
            </Text>
          </Stack>
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
    <Stack gap={4}>
      <Text size="xs" c="gray.5" fw={700}>{label}</Text>
      <Text style={{ overflowWrap: "anywhere" }}>{value}</Text>
    </Stack>
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

export function HrCabinetSection({ user, token, teamId }: { user: User; token: string; teamId?: string }) {
  const { notification } = App.useApp();
  const [page, setPage] = useState(0);
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string } | null>(null);
  const [processFilter, setProcessFilter] = useState<TeamProcessFilterValue>({ trackId: "", vacancyId: "" });
  const [filterError, setFilterError] = useState("");
  const [detailRoomId, setDetailRoomId] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportControllerRef = useRef<AbortController | null>(null);
  const exportGenerationRef = useRef(0);
  const args = useMemo(
    () => ({
      page,
      size: PAGE_SIZE,
      ...(teamId ? { teamId } : {}),
      ...(processFilter.trackId ? { trackId: processFilter.trackId } : {}),
      ...(processFilter.vacancyId ? { vacancyId: processFilter.vacancyId } : {}),
      ...(appliedRange ?? {}),
    }),
    [appliedRange, page, teamId, processFilter],
  );
  const { currentData: data, error, isFetching, refetch } = useGetHrInterviewsQuery(args, {
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
    setExporting(false);
    setExportError("");
    return () => {
      exportGenerationRef.current += 1;
      exportControllerRef.current?.abort();
      exportControllerRef.current = null;
    };
  }, [token, teamId, processFilter, appliedRange]);

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
    try {
      const count = await downloadHrWorkbook({
        token,
        teamId,
        trackId: processFilter.trackId || undefined,
        vacancyId: processFilter.vacancyId || undefined,
        ...(appliedRange ?? {}),
        signal: controller.signal,
        isSessionCurrent: () => localStorage.getItem("auth_token") === token,
      });
      if (controller.signal.aborted || exportGenerationRef.current !== generation) return;
      notification.success({
        title: count === 0 ? "Excel скачан: интервью нет" : `Excel скачан: ${count} интервью`,
        placement: "top",
        role: "status",
      });
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
  const interviewColumns: TableColumnsType<HrInterview> = [
    { title: "Кандидат", dataIndex: "candidateName", key: "candidate", className: styles.wrappingCell, render: (value) => fallback(value) },
    { title: "Позиция", dataIndex: "position", key: "position", className: styles.wrappingCell, render: (value) => fallback(value) },
    ...(teamId ? [{ title: "Трек / вакансия", key: "process", className: styles.wrappingCell, render: (_: unknown, interview: HrInterview) => <Stack gap={4}>
      <Text size="sm">{interview.trackName || "Без трека"}</Text>
      <Text size="xs" c="gray.5">{interview.vacancyTitle || "Без вакансии"}</Text>
    </Stack> }] : []),
    { title: "Комната", dataIndex: "title", key: "room", className: styles.wrappingCell },
    {
      title: "Дата интервью",
      key: "date",
      render: (_, interview) => (
        <Stack gap={4}>
          <Text size="sm">{formatMoscowDateTime(interview.scheduledAt)}</Text>
          {!interview.scheduledAt ? (
            <Text size="xs" c="gray.5">
              {dateSourceLabel(interview.dateSource)}: {formatMoscowDateTime(interview.effectiveAt)}
            </Text>
          ) : null}
        </Stack>
      ),
    },
    {
      title: "Статус",
      key: "status",
      render: (_, interview) => {
        const badge = interviewBadge(interview);
        return <Badge color={badge.color}>{badge.label}</Badge>;
      },
    },
    { title: "Действия", key: "actions", width: 160, render: (_, interview) => <RowActions interview={interview} onResults={() => setDetailRoomId(interview.roomId)} /> },
  ];

  return (
    <Card withBorder radius="lg" padding="lg" bg="var(--app-surface)" c="gray.1" className={styles.cabinet}>
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" gap="xl" wrap="wrap">
          <div>
            <Title order={2}>Кандидаты и интервью</Title>
            <Text c="gray.5" size="sm" mt={4}>
              {teamId ? "Кандидаты и интервью этой команды доступны всем её участникам." : "Ваши интервью и назначения нанимающим."}
            </Text>
          </div>
          {!teamId ? <CopyHrId id={user.id} compact /> : null}
        </Group>

        {teamId ? <TeamProcessFilters accountId={user.id} teamId={teamId} value={processFilter} onChange={value => { setProcessFilter(value); setPage(0); setDetailRoomId(null); }} /> : null}

        <form onSubmit={applyPeriod}>
          <Group gap={4} align="center" mb="xs">
            <Text size="sm" fw={500}>Период</Text>
            <Tooltip position="top" w={320} trigger={["hover", "focus"]} label="Даты по Москве, обе границы включены. Если дата интервью не назначена, используется дата завершения или создания.">
              <Button type="button" size="xs" variant="subtle" className={styles.periodHint} aria-label="Как выбирается период"><IconHelpCircle size={16} aria-hidden="true" /></Button>
            </Tooltip>
          </Group>
          <Group align="flex-end" wrap="wrap" className={styles.toolbar}>
            <TextInput className={styles.periodDate}
              type="date"
              label="С"
              value={fromDraft}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFromDraft(event.currentTarget.value)}
            />
            <TextInput className={styles.periodDate}
              type="date"
              label="По"
              value={toDraft}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setToDraft(event.currentTarget.value)}
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
          {filterError ? <Text role="alert" size="sm" c="red.4" mt="xs" style={{ display: "block" }}>{filterError}</Text> : null}
        </form>

        {error ? (
          <Alert className={styles.refreshAlert} color={stale ? "yellow" : "red"} role="alert" title="Не удалось загрузить интервью">
            <Text size="sm">{stale ? "Данные не обновлены. Показаны последние успешно загруженные сведения." : "Проверьте соединение и повторите попытку."}</Text>
            <Button className={styles.retryButton} type="button" size="xs" variant="light" mt="xs" onClick={() => void refetch()}>Повторить</Button>
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

        <Box aria-busy={isFetching} aria-label="Список интервью">
          {!hasData && isFetching ? (
            <Stack>
              <Skeleton height={42} />
              <Skeleton height={68} />
              <Skeleton height={68} />
            </Stack>
          ) : !hasData ? null : items.length === 0 ? (
            <Text ta="center" py="xl" c="gray.4">
              {processFilter.trackId || processFilter.vacancyId ? "По выбранным фильтрам кандидатов нет" : appliedRange ? "За выбранный период интервью нет" : "Пока нет интервью"}
            </Text>
          ) : (
            <>
              <AntTable<HrInterview>
                className={styles.desktopTable}
                rowKey="roomId"
                size="middle"
                columns={interviewColumns}
                dataSource={items}
                pagination={false}
                tableLayout="fixed"
                scroll={{ x: teamId ? 1100 : 900 }}
              />
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
