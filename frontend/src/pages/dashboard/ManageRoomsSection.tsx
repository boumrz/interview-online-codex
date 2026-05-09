import React from "react";
import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconChevronRight, IconTrash } from "@tabler/icons-react";
import type { RoomSummary } from "../../types";
import styles from "../DashboardPage.module.css";
import { darkFieldStyles } from "./dashboardFieldStyles";
import {
  labelForLanguage,
  type RoomSaveStatus,
  statusColor,
  statusLabel,
} from "./dashboardHelpers";

interface ManageRoomsSectionProps {
  rooms: RoomSummary[];
  roomTitleDrafts: Record<string, string>;
  roomSaveStatus: Record<string, RoomSaveStatus | undefined>;
  onOpenRoom: (room: RoomSummary) => void;
  onDeleteRoom: (roomId: string) => void;
  onScheduleTitleChange: (
    roomId: string,
    originalTitle: string,
    nextTitle: string,
  ) => void;
  onFlushTitleChange: (roomId: string, originalTitle: string) => void;
}

/**
 * "Управление комнатами" tab. Lists rooms the current user can interact
 * with and exposes title editing + deletion. Open-room navigation, the
 * autosave scheduler and the delete mutation stay in the parent so this
 * file remains presentational.
 */
export function ManageRoomsSection({
  rooms,
  roomTitleDrafts,
  roomSaveStatus,
  onOpenRoom,
  onDeleteRoom,
  onScheduleTitleChange,
  onFlushTitleChange,
}: ManageRoomsSectionProps) {
  return (
    <Card
      withBorder
      radius="lg"
      padding="lg"
      bg="#11151c"
      c="gray.1"
      style={{ borderColor: "#272b34" }}
    >
      <Stack>
        <Title order={4}>Управление комнатами</Title>
        {rooms.map((room) => {
          const isOwner = room.accessRole === "owner";
          return (
            <Card
              key={room.id}
              withBorder
              radius="md"
              padding="sm"
              bg="#121720"
              style={{ borderColor: "#2a3039", cursor: "pointer" }}
              role="button"
              tabIndex={0}
              aria-label={`Открыть комнату ${room.title}`}
              className={styles.manageRoomCardInteractive}
              onClick={() => onOpenRoom(room)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpenRoom(room);
              }}
            >
              <Stack gap="sm">
                <Group justify="space-between">
                  <Group gap="xs">
                    <Badge color="gray" variant="light">
                      {labelForLanguage(room.language)}
                    </Badge>
                    <Badge color={isOwner ? "teal" : "blue"} variant="light">
                      {isOwner ? "Владелец" : "Участник"}
                    </Badge>
                    <Badge
                      variant="outline"
                      color={statusColor(roomSaveStatus[room.id])}
                    >
                      {statusLabel(roomSaveStatus[room.id])}
                    </Badge>
                  </Group>
                  <Group gap={6}>
                    <Text size="xs" c="gray.4">
                      Код: {room.inviteCode}
                    </Text>
                    <ActionIcon
                      variant="light"
                      color="red"
                      disabled={!isOwner}
                      aria-label={`Удалить комнату ${room.title}`}
                      title="Удалить комнату"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isOwner) return;
                        onDeleteRoom(room.id);
                      }}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Group>

                <TextInput
                  label="Название комнаты"
                  value={roomTitleDrafts[room.id] ?? room.title}
                  disabled={!isOwner}
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    if (!isOwner) return;
                    onScheduleTitleChange(
                      room.id,
                      room.title,
                      event.currentTarget.value,
                    );
                  }}
                  onBlur={() => {
                    if (!isOwner) return;
                    onFlushTitleChange(room.id, room.title);
                  }}
                  styles={darkFieldStyles}
                />

                <Group justify="space-between">
                  <Text size="xs" c="gray.4">
                    Клик по карточке открывает комнату
                  </Text>
                  <Group gap={4} c="gray.4">
                    <Text size="xs">Открыть</Text>
                    <IconChevronRight size={14} />
                  </Group>
                </Group>
              </Stack>
            </Card>
          );
        })}
        {rooms.length === 0 && <Text c="gray.4">Комнат пока нет</Text>}
      </Stack>
    </Card>
  );
}
