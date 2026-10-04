import React, { useMemo } from "react";
import { Button, Flex, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
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

export function ActivityTimeline({ history, canManageRoom }: ActivityTimelineProps) {
  const groups = useMemo(() => projectActivityTimeline(history.events), [history.events]);
  if (!canManageRoom) return null;

  const formatTime = (timestampEpochMs: number) => new Date(timestampEpochMs).toLocaleTimeString("ru-RU", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const formatTimeRange = (start: number, end: number) =>
    start === end ? formatTime(start) : `${formatTime(start)}–${formatTime(end)}`;

  return (
    <Flex vertical gap={8} style={{ flex: 1, minHeight: 0 }}>
      <Flex justify="space-between" align="center" style={{ flexShrink: 0 }}>
        <Typography.Text style={{ color: "var(--app-muted)", fontSize: 12, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase" }}>
          Логи кандидата
        </Typography.Text>
        <Flex gap={4}>
          <Button aria-label="Скачать логи в JSON" htmlType="button" icon={<DownloadOutlined />} onClick={() => history.download("json")} disabled={!history.canExport} size="small" type="text">JSON</Button>
          <Button aria-label="Скачать логи в CSV" htmlType="button" icon={<DownloadOutlined />} onClick={() => history.download("csv")} disabled={!history.canExport} size="small" type="text">CSV</Button>
        </Flex>
      </Flex>
      {history.error && (
        <Flex vertical gap={4} data-testid="activity-history-error" role="alert">
          <Typography.Text type="danger" style={{ fontSize: 12 }}>{history.error}</Typography.Text>
          {history.terminal == null && (
            <Button htmlType="button" size="small" type="text" onClick={history.retry} disabled={history.loading != null}>
              Повторить загрузку
            </Button>
          )}
        </Flex>
      )}
      {history.terminal == null && (
        <Typography.Text style={{ color: "var(--app-muted)", fontSize: 12 }} data-testid="activity-history-status" role="status">
          {history.loading === "latest" ? "Загрузка истории…"
            : history.loading === "older" ? "Загрузка более ранних событий…"
            : history.error ? `Загружено событий: ${history.events.length} · История загружена не полностью`
            : history.loading === "catchup" ? `Загружено событий: ${history.events.length} · Обновление истории…`
            : history.initialized ? `Загружено событий: ${history.events.length}${history.hasMore ? " · Есть более ранние события" : " · Вся история загружена"}`
            : "Загрузка истории…"}
        </Typography.Text>
      )}
      <div className="activityTimelineScroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {groups.length === 0 && history.initialized && !history.error ? (
          <Typography.Text style={{ display: "block", padding: 16, color: "var(--app-muted)", fontSize: 12, textAlign: "center" }}>
            Активность не зафиксирована
          </Typography.Text>
        ) : (
          <Flex vertical gap={8}>
            {groups.map((group) => (
              <div
                key={group.sourceEventIds[0] ?? `${group.sessionId}:${group.startTimestampEpochMs}`}
                data-testid="activity-timeline-entry"
                style={{ padding: "8px 10px", borderRadius: 8, background: "var(--app-surface-soft)" }}
              >
                <Flex gap={8} justify="space-between" wrap="nowrap" style={{ marginBottom: 2 }}>
                  <Typography.Text ellipsis style={{ color: "var(--app-muted)", fontSize: 12, fontWeight: 600 }}>
                    {formatActivityTimelineParticipant(group, groups)}
                  </Typography.Text>
                  <Typography.Text style={{ flexShrink: 0, color: "var(--app-tertiary)", fontFamily: "var(--font-code)", fontSize: 12 }}>
                    {formatTimeRange(group.startTimestampEpochMs, group.endTimestampEpochMs)}
                  </Typography.Text>
                </Flex>
                <Typography.Text data-testid="activity-timeline-summary" style={{ color: "var(--app-text)", fontSize: 12 }}>
                  {formatActivityTimelineSummary(group)}
                </Typography.Text>
                {group.sourceEventIds.map((sourceEventId) => (
                  <span key={sourceEventId} data-testid="activity-timeline-source-id" style={{ display: "none" }}>
                    {sourceEventId}
                  </span>
                ))}
              </div>
            ))}
          </Flex>
        )}
      </div>
      {history.hasMore && (
        <Button htmlType="button" size="small" type="text" onClick={history.loadOlder} disabled={history.loading != null}>
          Показать более ранние события
        </Button>
      )}
    </Flex>
  );
}
