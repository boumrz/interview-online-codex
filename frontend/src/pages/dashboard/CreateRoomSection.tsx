import React, { useState, type FormEvent } from "react";
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

export interface RoomTaskOption {
  value: string;
  label: string;
}

interface CreateRoomSectionProps {
  title: string;
  onTitleChange: (value: string) => void;
  taskOptions: RoomTaskOption[];
  selectedTaskIds: string[];
  onSelectedTaskIdsChange: (ids: string[]) => void;
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
  selectedTaskIds,
  onSelectedTaskIdsChange,
  isSubmitting,
  onSubmit,
  onError,
}: CreateRoomSectionProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

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
            <Button type="submit" loading={isSubmitting}>
              Создать и открыть
            </Button>
          </Stack>
        </form>
      </Card>
    </SimpleGrid>
  );
}
