import React, { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Modal,
  Card,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from "components/antd-compat";
import { IconChevronRight, IconTrash, IconPencil } from "components/antd-icons";
import type { RoomSummary } from "../../types";
import { VerdictBadge } from "../../features/room/VerdictBadge";
import styles from "../DashboardPage.module.css";
import { darkFieldStyles } from "./dashboardFieldStyles";
import {
  labelForLanguage,
  type RoomSaveStatus,
  statusColor,
  statusLabel,
} from "./dashboardHelpers";

const KNOWN_VERDICTS = new Set(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]);

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
  onFlushTitleChange: (roomId: string, originalTitle: string, draft?: string, notifySuccess?: boolean) => void;
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
  const [editingRoom, setEditingRoom] = useState<RoomSummary | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const saveStatus = editingRoom ? roomSaveStatus[editingRoom.id] : undefined;
  useEffect(() => {
    if (submitted && saveStatus === "saved") { setEditingRoom(null); setSubmitted(false); }
  }, [saveStatus, submitted]);
  return (
    <Card
      withBorder
      radius="lg"
      padding="lg"
      bg="var(--app-surface)"
      c="gray.1"
      style={{ borderColor: "var(--app-border)" }}
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
              bg="var(--app-surface-soft)"
              style={{ borderColor: "var(--app-border)", cursor: "pointer" }}
              role="button"
              tabIndex={0}
              aria-label={`Открыть комнату ${room.title}`}
              className={styles.manageRoomCardInteractive}
              onClick={() => onOpenRoom(room)}
              onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
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
                    {room.status === "finished" ? (
                      <>
                        <Badge color="gray" variant="outline">Завершено</Badge>
                        {room.verdict && KNOWN_VERDICTS.has(room.verdict) && (
                          <VerdictBadge verdict={room.verdict} size="xs" />
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" color={statusColor(roomSaveStatus[room.id])}>
                        {statusLabel(roomSaveStatus[room.id])}
                      </Badge>
                    )}
                  </Group>
                  <Group gap={6}>
                    <ActionIcon
                      variant="light"
                      color="red"
                      disabled={!isOwner}
                      aria-label={`Удалить комнату ${room.title}`}
                      title="Удалить комнату"
                      onClick={(event: React.MouseEvent<HTMLElement>) => {
                        event.stopPropagation();
                        if (!isOwner) return;
                        onDeleteRoom(room.id);
                      }}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Group>

                <Group gap="xs" align="center" wrap="wrap">
                  <Text fw={600}>{room.title}</Text>
                  {isOwner ? <ActionIcon aria-label={`Переименовать интервью ${room.title}`} title="Переименовать интервью" variant="subtle" onClick={(event: React.MouseEvent<HTMLElement>) => { event.stopPropagation(); setEditingRoom(room); setTitleDraft(room.title); setSubmitted(false); }}><IconPencil size={16} aria-hidden="true" /></ActionIcon> : null}
                </Group>

                <Group justify="flex-end">
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
      <Modal opened={Boolean(editingRoom)} onClose={() => { if (saveStatus !== "saving") setEditingRoom(null); }} title="Переименовать интервью" centered>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!editingRoom || !titleDraft.trim() || saveStatus === "saving") return;
          setSubmitted(true);
          onScheduleTitleChange(editingRoom.id, editingRoom.title, titleDraft.trim());
          onFlushTitleChange(editingRoom.id, editingRoom.title, titleDraft.trim(), true);
        }}>
          <Stack>
            <TextInput aria-label="Название интервью" placeholder="Введите название" value={titleDraft} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitleDraft(event.currentTarget.value)} autoFocus disabled={saveStatus === "saving"} required />
            {submitted && saveStatus === "error" ? <Text role="alert" c="red.4">Не удалось сохранить название. Повторите попытку.</Text> : null}
            <Group justify="flex-end">
              <Button type="button" variant="subtle" disabled={saveStatus === "saving"} onClick={() => setEditingRoom(null)}>Отмена</Button>
              <Button type="submit" loading={saveStatus === "saving"} disabled={titleDraft.trim() === editingRoom?.title.trim()}>Сохранить</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Card>
  );
}
