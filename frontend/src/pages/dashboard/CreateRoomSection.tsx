import React, { useState, type FormEvent } from "react";
import {
  Button,
  Group,
  Stack,
  Text,
  MultiSelect,
  Modal,
  Select,
  SimpleGrid,
  TextInput,
  Card,
} from "components/antd-compat";
import { IconPlus } from "components/antd-icons";
import { HiringManagerPicker } from "../../features/hr/HiringManagerPicker";
import type { HiringManagerPreviewResponse } from "../../types";
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

interface CreateRoomSectionProps {
  title: string;
  onTitleChange: (value: string) => void;
  taskOptions: RoomTaskOption[];
  selectedTasks: RoomTaskPreview[];
  selectedTaskIds: string[];
  onSelectedTaskIdsChange: (ids: string[]) => void;
  hiringManagers: HiringManagerPreviewResponse[];
  onHiringManagersChange: (people: HiringManagerPreviewResponse[]) => void;
  onHiringLookupPendingChange: (pending: boolean) => void;
  hiringLookupPending: boolean;
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
  hiringManagers,
  onHiringManagersChange,
  onHiringLookupPendingChange,
  hiringLookupPending,
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

  const [opened, setOpened] = useState(false);

  return (
    <SimpleGrid cols={{ base: 1, lg: 1 }} spacing="md">
      <Card
        withBorder
        radius="lg"
        padding="lg"
        bg="var(--app-surface)"
        c="gray.1"
        style={{ borderColor: "var(--app-border)" }}
        data-testid="create-room-card"
      >
        <Button onClick={() => setOpened(true)} leftSection={<IconPlus size={15} />}>Создать комнату</Button>
        <Modal opened={opened} destroyOnHidden onClose={() => { if (!isSubmitting) setOpened(false); }} title="Создать комнату" centered size="lg" authoring>
        <form onSubmit={onSubmit} className="app-authoring-form">
          <div className="app-authoring-fields">
            <section className="app-authoring-section">
            <TextInput placeholder="Введите название"
              label="Название комнаты"
              value={title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onTitleChange(e.currentTarget.value)}
              styles={darkFieldStyles}
              required
            />
            </section>
            <section className="app-authoring-section" aria-label="Нанимающие">
              <Stack gap="sm">
                <HiringManagerPicker
                  showSuccess={false}
                  selectedIds={hiringManagers.map(person => person.normalizedId)}
                  disabled={isSubmitting}
                  onPendingChange={onHiringLookupPendingChange}
                  onSelect={person => {
                    if (!hiringManagers.some(selected => selected.normalizedId === person.normalizedId)) onHiringManagersChange([...hiringManagers, person]);
                    return true;
                  }}
                />
                {hiringManagers.map(person => <Group key={person.normalizedId} justify="space-between" gap="sm">
                  <Text>{person.displayName}</Text>
                  <Button type="button" variant="subtle" color="red" size="xs" disabled={isSubmitting}
                    aria-label={`Удалить нанимающего ${person.displayName}`}
                    onClick={() => onHiringManagersChange(hiringManagers.filter(selected => selected.normalizedId !== person.normalizedId))}>Убрать</Button>
                </Group>)}
              </Stack>
            </section>
            <section className="app-authoring-section">
            {presetOptions.length > 0 && (
                <Select
                  label="Набор задач"
                  placeholder="Выберите набор или добавьте задачи отдельно"
                  data={presetOptions}
                  value={selectedPresetId}
                  clearable
                  disabled={isLoadingPreset}
                  onChange={(value) => void handlePresetChange(value)}
                  styles={darkSelectStyles}
                  labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
                />
            )}
            <MultiSelect placeholder="Выберите задачи в порядке интервью"
              data-testid="room-task-select"
              label="Задачи для комнаты"
              data={taskOptions}
              value={selectedTaskIds}
              onChange={onSelectedTaskIdsChange}
              searchable
              styles={darkSelectStyles}
              labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
            />
            </section>
          </div>
            <Group className="app-form-actions" justify="flex-end">
            <Button type="button" variant="subtle" disabled={isSubmitting} onClick={() => setOpened(false)}>Отмена</Button>
            <Button type="submit" loading={isSubmitting} disabled={isSubmitting || hiringLookupPending}>
              Создать и открыть
            </Button>
            </Group>
        </form>
        </Modal>
      </Card>
    </SimpleGrid>
  );
}
