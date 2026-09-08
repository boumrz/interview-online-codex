import React, { useMemo } from "react";
import { Box, Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import {
  formatActivityTimelineSummary,
  formatActivityTimelineParticipant,
  projectActivityTimeline,
} from "./activityTimelineProjection";
import type { CandidateActivityHistory } from "./useCandidateActivityHistory";

type ActivityTimelineProps = {
  history: CandidateActivityHistory;
  canManageRoom: boolean;
};

export function ActivityTimeline({
  history,
  canManageRoom,
}: ActivityTimelineProps) {
  const groups = useMemo(() => projectActivityTimeline(history.events), [history.events]);
  if (!canManageRoom) return null;

  const formatTime = (timestampEpochMs: number) =>
    new Date(timestampEpochMs).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const formatTimeRange = (start: number, end: number) =>
    start === end ? formatTime(start) : `${formatTime(start)}–${formatTime(end)}`;

  return (
    <Stack gap="xs" style={{ flex: 1, minHeight: 0 }}>
      <Group justify="space-between" align="center" style={{ flexShrink: 0 }}>
        <Text size="xs" c="#8b919b" tt="uppercase" fw={700} lts={1}>
          Логи кандидата
        </Text>
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconDownload size={12} />}
            onClick={() => history.download("json")}
            disabled={!history.canExport}
          >
            JSON
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconDownload size={12} />}
            onClick={() => history.download("csv")}
            disabled={!history.canExport}
          >
            CSV
          </Button>
        </Group>
      </Group>
      {history.error && (
        <Stack gap={4} data-testid="activity-history-error" role="alert">
          <Text size="xs" c="red">{history.error}</Text>
          {history.terminal == null && (
            <Button size="xs" variant="subtle" onClick={history.retry} disabled={history.loading != null}>
              Повторить загрузку
            </Button>
          )}
        </Stack>
      )}
      {history.terminal == null && (
        <Text size="xs" c="#8b919b" data-testid="activity-history-status" role="status">
          {history.loading === "latest" ? "Загрузка истории…"
            : history.loading === "older" ? "Загрузка более ранних событий…"
            : history.error ? `Загружено событий: ${history.events.length} · История загружена не полностью`
            : history.loading === "catchup" ? `Загружено событий: ${history.events.length} · Обновление истории…`
            : history.initialized ? `Загружено событий: ${history.events.length}${history.hasMore ? " · Есть более ранние события" : " · Вся история загружена"}`
            : "Загрузка истории…"}
        </Text>
      )}
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        {groups.length === 0 && history.initialized && !history.error ? (
          <Text size="xs" c="#5a6070" ta="center" py="md">
            Активность не зафиксирована
          </Text>
        ) : (
          <Stack gap="xs">
            {groups.map((group) => (
              <Box
                key={group.sourceEventIds[0] ?? `${group.sessionId}:${group.startTimestampEpochMs}`}
                px="xs"
                py={6}
                data-testid="activity-timeline-entry"
                style={{ borderRadius: 6, background: "rgba(255,255,255,0.02)" }}
              >
                <Group gap="xs" justify="space-between" wrap="nowrap" mb={2}>
                  <Text size="xs" c="#8b919b" fw={600} truncate>
                    {formatActivityTimelineParticipant(group, groups)}
                  </Text>
                  <Text size="xs" c="#5a6070" ff="monospace" style={{ flexShrink: 0 }}>
                    {formatTimeRange(group.startTimestampEpochMs, group.endTimestampEpochMs)}
                  </Text>
                </Group>
                <Text size="xs" c="#c9d0db" data-testid="activity-timeline-summary">
                  {formatActivityTimelineSummary(group)}
                </Text>
                {group.sourceEventIds.map((sourceEventId) => (
                  <span key={sourceEventId} data-testid="activity-timeline-source-id" style={{ display: "none" }}>
                    {sourceEventId}
                  </span>
                ))}
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea>
      {history.hasMore && (
        <Button size="xs" variant="subtle" onClick={history.loadOlder} disabled={history.loading != null}>
          Показать более ранние события
        </Button>
      )}
    </Stack>
  );
}
