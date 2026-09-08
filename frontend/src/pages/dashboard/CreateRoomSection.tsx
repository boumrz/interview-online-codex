import React, { useRef, useState, type FormEvent } from "react";
import {
  Button,
  Group,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Card,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import {
  useListPresetsQuery,
  useLazyGetPresetQuery,
} from "../../services/api";
import {
  darkFieldStyles,
  darkSelectStyles,
} from "./dashboardFieldStyles";
import { markdownToHtml } from "../../components/markdown";
import styles from "../DashboardPage.module.css";

export interface RoomTaskOption {
  value: string;
  label: string;
}

export interface RoomTaskPreview {
  id: string;
  title: string;
  description: string;
  language: string;
}

export type HiringManagerSelection = {
  normalizedId: string;
  displayName: string;
};

export type HiringManagerPickerFeedback = {
  kind: "idle" | "checking" | "success" | "error";
  message: string;
};

interface CreateRoomSectionProps {
  title: string;
  onTitleChange: (value: string) => void;
  taskOptions: RoomTaskOption[];
  selectedTasks: RoomTaskPreview[];
  selectedTaskIds: string[];
  onSelectedTaskIdsChange: (ids: string[]) => void;
  hiringManagerDraftId: string;
  onHiringManagerDraftIdChange: (value: string) => void;
  onAddHiringManager: () => void;
  hiringManagerSelections: HiringManagerSelection[];
  hiringManagerPickerFeedback: HiringManagerPickerFeedback;
  onRemoveHiringManager: (normalizedId: string) => void;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent) => void;
  onError?: (message: string) => void;
}

/**
 * Form card for creating a brand-new room. Owns no logic of its own — all
 * inputs are controlled by the dashboard page so RTK mutations and event
 * tracking continue to live next to the rest of the room workflow.
 *
 * Preset loading is encapsulated here: the component subscribes to
 * useListPresetsQuery (shared RTK cache — no extra network call when
 * PresetsSection is also mounted) and fetches details lazily on selection.
 */
export function CreateRoomSection({
  title,
  onTitleChange,
  taskOptions,
  selectedTasks,
  selectedTaskIds,
  onSelectedTaskIdsChange,
  hiringManagerDraftId,
  onHiringManagerDraftIdChange,
  onAddHiringManager,
  hiringManagerSelections,
  hiringManagerPickerFeedback,
  onRemoveHiringManager,
  isSubmitting,
  onSubmit,
  onError,
}: CreateRoomSectionProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const hiringManagerInputRef = useRef<HTMLInputElement>(null);

  // RTK Query deduplicates this subscription against PresetsSection when both
  // are mounted — only one /me/presets request is issued.
  const { data: presets = [] } = useListPresetsQuery(undefined);
  const [triggerGetPreset, { isFetching: isLoadingPreset }] =
    useLazyGetPresetQuery();

  const presetOptions = presets.map((p) => ({ value: p.id, label: p.name }));

  const handlePresetChange = async (value: string | null) => {
    setSelectedPresetId(value);

    if (!value) {
      // Preset cleared — reset the task selection so the form state is consistent
      // with "no preset selected".
      onSelectedTaskIdsChange([]);
      return;
    }

    try {
      const detail = await triggerGetPreset({ presetId: value }).unwrap();
      onSelectedTaskIdsChange(detail.items.map((item) => item.taskTemplateId));
    } catch {
      onError?.("Не удалось загрузить пресет. Попробуйте ещё раз.");
    }
  };

  return (
    <SimpleGrid cols={{ base: 1, lg: 1 }} spacing="md">
      <Card
        withBorder
        radius="lg"
        padding="lg"
        bg="#11151c"
        c="gray.1"
        style={{ borderColor: "#272b34" }}
        data-testid="create-room-card"
      >
        <form onSubmit={onSubmit}>
          <Stack>
            <Group>
              <ThemeIcon color="gray" variant="light">
                <IconPlus size={15} />
              </ThemeIcon>
              <Title order={4}>Создать комнату</Title>
            </Group>
            <Text size="sm" c="gray.4">
              Выберите нужные шаги. Язык комнаты будет автоматически
              определяться по активной задаче. Если шаги не выбраны, комната
              создастся пустой — задачи можно добавить уже внутри.
            </Text>
            <TextInput
              label="Название комнаты"
              value={title}
              onChange={(e) => onTitleChange(e.currentTarget.value)}
              styles={darkFieldStyles}
              required
            />
            {presetOptions.length > 0 && (
              <Stack gap={4}>
                <Select
                  label="Загрузить пресет задач"
                  placeholder="Не выбрано (выбрать задачи вручную)"
                  data={presetOptions}
                  value={selectedPresetId}
                  clearable
                  disabled={isLoadingPreset}
                  onChange={(value) => void handlePresetChange(value)}
                  styles={darkSelectStyles}
                  labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
                />
              </Stack>
            )}
            <MultiSelect
              data-testid="room-task-select"
              label="Задачи для комнаты"
              description="Можно выбрать задачи на любых языках"
              data={taskOptions}
              value={selectedTaskIds}
              onChange={onSelectedTaskIdsChange}
              searchable
              styles={darkSelectStyles}
              labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
            />
            <Stack gap={6}>
              <Group align="flex-end" gap="sm" wrap="nowrap">
                <TextInput
                  ref={hiringManagerInputRef}
                  label="ID нанимающего"
                  description="Введите ID нанимающего и нажмите «Добавить»."
                  placeholder="UUID нанимающего"
                  value={hiringManagerDraftId}
                  onChange={(event) => onHiringManagerDraftIdChange(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    onAddHiringManager();
                  }}
                  disabled={isSubmitting || hiringManagerPickerFeedback.kind === "checking"}
                  styles={darkFieldStyles}
                  style={{ flex: 1 }}
                />
                <Button
                  type="button"
                  onClick={onAddHiringManager}
                  loading={hiringManagerPickerFeedback.kind === "checking"}
                  disabled={isSubmitting || hiringManagerPickerFeedback.kind === "checking"}
                >
                  Добавить
                </Button>
              </Group>
              {hiringManagerPickerFeedback.kind !== "idle" ? (
                <Text
                  size="sm"
                  c={hiringManagerPickerFeedback.kind === "error" ? "red.4" : "gray.3"}
                  role={hiringManagerPickerFeedback.kind === "error" ? "alert" : "status"}
                  aria-live={hiringManagerPickerFeedback.kind === "error" ? "assertive" : "polite"}
                >
                  {hiringManagerPickerFeedback.message}
                </Text>
              ) : null}
              {hiringManagerSelections.length > 0 ? (
                <Stack gap={6} data-testid="hiring-manager-selection-list">
                  <Title order={5}>Добавленные нанимающие</Title>
                  <Stack gap={4} role="list">
                    {hiringManagerSelections.map((selection) => (
                      <Group key={selection.normalizedId} justify="space-between" wrap="nowrap" role="listitem">
                        <Text size="sm">{selection.displayName}</Text>
                        <Button
                          type="button"
                          variant="subtle"
                          color="red"
                          size="xs"
                          aria-label={`Удалить нанимающего ${selection.displayName}`}
                          disabled={isSubmitting}
                          onClick={() => {
                            onRemoveHiringManager(selection.normalizedId);
                            requestAnimationFrame(() => hiringManagerInputRef.current?.focus());
                          }}
                        >
                          Удалить
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </Stack>
              ) : null}
            </Stack>
            {selectedTasks.length > 0 && (
              <Stack
                gap={8}
                className={styles.selectedTaskPreviewList}
                data-testid="selected-task-preview"
              >
                {selectedTasks.map((task) => {
                  const descriptionHtml = markdownToHtml(task.description);
                  return (
                    <div className={styles.selectedTaskPreviewItem} key={task.id}>
                      <Group justify="space-between" gap="xs" wrap="nowrap">
                        <Text fw={700} size="sm" c="gray.1">
                          {task.title}
                        </Text>
                        <Text size="xs" c="gray.5">
                          {task.language}
                        </Text>
                      </Group>
                      {descriptionHtml ? (
                        <div
                          className={styles.taskDescriptionMarkdown}
                          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
                        />
                      ) : (
                        <Text size="xs" c="gray.5">
                          No description
                        </Text>
                      )}
                    </div>
                  );
                })}
              </Stack>
            )}
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
              Создать и открыть
            </Button>
          </Stack>
        </form>
      </Card>
    </SimpleGrid>
  );
}
