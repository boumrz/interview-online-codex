import React from "react";
import { Box, Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import type { CandidateKeyInfo } from "./candidateKeys";
import {
  formatActivityTimelineSummary,
  formatActivityTimelineParticipant,
  projectActivityTimeline,
} from "./activityTimelineProjection";
import { API_BASE_URL } from "../../config/runtime";

type ActivityTimelineProps = {
  inviteCode: string;
  ownerToken?: string | null;
  authToken?: string | null;
  eventToken?: string | null;
  keyHistory: CandidateKeyInfo[];
  canManageRoom: boolean;
};

export function ActivityTimeline({
  inviteCode,
  ownerToken,
  authToken,
  eventToken,
  keyHistory,
  canManageRoom,
}: ActivityTimelineProps) {
  if (!canManageRoom) return null;
  const groups = projectActivityTimeline(keyHistory);

  const formatTime = (timestampEpochMs: number) =>
    new Date(timestampEpochMs).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  const formatTimeRange = (start: number, end: number) =>
    start === end ? formatTime(start) : `${formatTime(start)}–${formatTime(end)}`;

  const buildHeaders = (): HeadersInit => {
    const headers: HeadersInit = {};
    if (ownerToken) headers["X-Room-Owner-Token"] = ownerToken;
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    // Forward realtime event token so guest interviewers (promoted via the
    // realtime channel, no DB record) can also export keystroke logs.
    if (eventToken) headers["X-Room-Event-Token"] = eventToken;
    return headers;
  };

  const handleDownloadJson = () => {
    const url = `${API_BASE_URL}/rooms/${inviteCode}/keystroke-events?format=json`;
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `keystrokes-${inviteCode}.json`);
    fetch(url, { headers: buildHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch((err) => {
        console.error("[ActivityTimeline] JSON export failed", err);
      });
  };

  const handleDownloadCsv = () => {
    const url = `${API_BASE_URL}/rooms/${inviteCode}/keystroke-events?format=csv`;
    fetch(url, { headers: buildHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.setAttribute("download", `keystrokes-${inviteCode}.csv`);
        link.click();
        URL.revokeObjectURL(objectUrl);
      })
      .catch((err) => {
        console.error("[ActivityTimeline] CSV export failed", err);
      });
  };

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
            onClick={handleDownloadJson}
          >
            JSON
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconDownload size={12} />}
            onClick={handleDownloadCsv}
          >
            CSV
          </Button>
        </Group>
      </Group>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
        {groups.length === 0 ? (
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
    </Stack>
  );
}
