import React, { useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArchive, IconArchiveOff, IconBookmark, IconCopy, IconEdit, IconPlus } from "@tabler/icons-react";
import { useAppSelector } from "../../app/hooks";
import {
  useListPresetsQuery,
  useCreatePresetMutation,
  useUpdatePresetMutation,
  useArchivePresetMutation,
  useRestorePresetMutation,
  useDeletePresetMutation,
  useLazyGetPresetQuery,
  useTasksGroupedQuery,
  useCreateTaskTemplateMutation,
} from "../../services/api";
import { parseLibraryTransfer, serializeTaskSet } from "../../features/workspace/libraryTransfer";
import { darkFieldStyles, darkSelectStyles } from "./dashboardFieldStyles";
import { LANGUAGE_OPTIONS } from "./dashboardConstants";
import { normalizeLanguageKey } from "./dashboardHelpers";

interface PresetsSectionProps {
  taskOptions: Array<{ value: string; label: string; language: string }>;
  onError?: (message: string) => void;
}

const languageOrder = new Map(LANGUAGE_OPTIONS.map((language, index) => [language.value, index]));

function languageLabel(language: string) {
  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? (language.trim() || "Не указан");
}

function taskCountLabel(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} задач`;
  if (mod10 === 1) return `${count} задача`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} задачи`;
  return `${count} задач`;
}

function languageSummary(counts: Record<string, number>) {
  const normalizedCounts = Object.entries(counts).reduce<Record<string, number>>((result, [language, count]) => {
    const normalized = normalizeLanguageKey(language);
    result[normalized] = (result[normalized] ?? 0) + count;
    return result;
  }, {});

  return Object.entries(normalizedCounts)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => {
      const leftOrder = languageOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = languageOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.localeCompare(right, "ru");
    })
    .map(([language, count]) => `${languageLabel(language)} · ${count}`)
    .join(", ");
}

/**
 * Self-contained CRUD component for task presets.
 * Allows creating, editing, and deleting presets of task templates.
 * All error reporting is delegated to the `onError` callback so the
 * parent controls the notification presentation.
 */
export function PresetsSection({ taskOptions, onError }: PresetsSectionProps) {
  const { token } = useAppSelector((state) => state.auth);
  const [mode, setMode] = useState<"active" | "archived">("active");

  const { data: presets = [], isLoading, isError } = useListPresetsQuery({ status: mode }, {
    skip: !token,
  });
  const { data: taskGroups = [] } = useTasksGroupedQuery(undefined, { skip: !token });

  const [createPreset, createPresetState] = useCreatePresetMutation();
  const [updatePreset, updatePresetState] = useUpdatePresetMutation();
  const [archivePreset, archivePresetState] = useArchivePresetMutation();
  const [restorePreset, restorePresetState] = useRestorePresetMutation();
  const [deletePreset, deletePresetState] = useDeletePresetMutation();
  const [presetToDelete, setPresetToDelete] = useState<{ id: string; name: string } | null>(null);
  const [triggerGetPreset] = useLazyGetPresetQuery();
  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);
  const [importData, setImportData] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");

  // Create modal state
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [createName, setCreateName] = useState("");
  const [createTaskIds, setCreateTaskIds] = useState<string[]>([]);

  // Edit modal state
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [editPresetId, setEditPresetId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTaskIds, setEditTaskIds] = useState<string[]>([]);
  const [editRevision, setEditRevision] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const pickerOptions = useMemo(
    () => taskOptions.map((task) => ({
      value: task.value,
      label: `${task.label} — ${languageLabel(task.language)}`,
    })),
    [taskOptions],
  );

  const handleOpenCreate = () => {
    setCreateName("");
    setCreateTaskIds([]);
    openCreate();
  };

  const handleCloseCreate = () => {
    setCreateName("");
    setCreateTaskIds([]);
    closeCreate();
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      onError?.("Введите название набора");
      return;
    }
    if (createTaskIds.length === 0) {
      onError?.("Выберите хотя бы одну задачу");
      return;
    }
    try {
      await createPreset({ name: createName.trim(), taskTemplateIds: createTaskIds }).unwrap();
      handleCloseCreate();
    } catch {
      onError?.("Не удалось создать набор");
    }
  };

  const handleOpenEdit = async (presetId: string) => {
    setEditPresetId(presetId);
    setEditName("");
    setEditTaskIds([]);
    setEditLoading(true);
    openEdit();
    try {
      const detail = await triggerGetPreset({ presetId }).unwrap();
      setEditName(detail.name);
      setEditTaskIds(detail.items.map((item) => item.taskTemplateId));
      setEditRevision(detail.revision);
    } catch {
      onError?.("Не удалось загрузить набор");
    } finally {
      setEditLoading(false);
    }
  };

  const handleCloseEdit = () => {
    setEditPresetId(null);
    setEditName("");
    setEditTaskIds([]);
    setEditRevision(null);
    setEditLoading(false);
    closeEdit();
  };

  const handleEdit = async () => {
    if (!editPresetId) return;
    if (!editName.trim()) {
      onError?.("Введите название набора");
      return;
    }
    if (editTaskIds.length === 0) {
      onError?.("Выберите хотя бы одну задачу");
      return;
    }
    try {
      await updatePreset({
        presetId: editPresetId,
        name: editName.trim(),
        taskTemplateIds: editTaskIds,
        revision: editRevision ?? undefined,
      }).unwrap();
      handleCloseEdit();
    } catch {
      onError?.("Не удалось сохранить набор");
    }
  };

  const handleCopy = async (presetId: string) => {
    try {
      const preset = await triggerGetPreset({ presetId }).unwrap();
      if (preset.status !== "ACTIVE") return;
      const catalog = new Map(taskGroups.flatMap((group) => group.tasks).map((task) => [task.id, task]));
      const tasks = preset.items.map((item) => catalog.get(item.taskTemplateId));
      if (tasks.some((task) => !task)) {
        onError?.("Не удалось найти задачи набора. Обновите библиотеку и повторите попытку.");
        return;
      }
      await navigator.clipboard.writeText(serializeTaskSet(preset.name, tasks as NonNullable<typeof tasks[number]>[]));
      setCopyNotice(`Набор «${preset.name}» готов к передаче. Вставьте данные через «Импортировать набор».`);
    } catch {
      onError?.("Не удалось скопировать набор. Попробуйте ещё раз.");
    }
  };

  const handleImport = async () => {
    setImportError("");
    let transfer;
    try {
      transfer = parseLibraryTransfer(importData.trim(), "task-set");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Неверные данные набора.");
      return;
    }
    if (transfer.kind !== "task-set") return;
    setImporting(true);
    try {
      const taskTemplateIds: string[] = [];
      for (const task of transfer.tasks) {
        const created = await createTask(task).unwrap();
        taskTemplateIds.push(created.id);
      }
      await createPreset({ name: transfer.name, taskTemplateIds }).unwrap();
      setImportData("");
      closeImport();
    } catch {
      setImportError("Не удалось импортировать набор. Проверьте данные и доступ к библиотеке.");
    } finally {
      setImporting(false);
    }
  };

  const handleArchive = async (presetId: string) => {
    try {
      await archivePreset({ presetId }).unwrap();
    } catch {
      onError?.("Не удалось архивировать набор. Попробуйте ещё раз.");
    }
  };

  const handleRestore = async (presetId: string) => {
    try {
      await restorePreset({ presetId }).unwrap();
    } catch {
      onError?.("Не удалось восстановить набор. Попробуйте ещё раз.");
    }
  };

  const actionLoading = archivePresetState.isLoading || restorePresetState.isLoading;

  return (
    <>
      <Modal opened={presetToDelete !== null} onClose={() => setPresetToDelete(null)} title="Удалить набор?" centered>
        <Stack gap="md">
          <Text size="sm">Набор «{presetToDelete?.name}» будет удалён без возможности восстановления.</Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setPresetToDelete(null)}>Отмена</Button>
            <Button color="red" loading={deletePresetState.isLoading} onClick={async () => {
              if (!presetToDelete) return;
              try {
                await deletePreset({ presetId: presetToDelete.id }).unwrap();
                setPresetToDelete(null);
              } catch {
                onError?.("Не удалось удалить набор. Попробуйте ещё раз.");
              }
            }}>Удалить</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={createOpened}
        onClose={handleCloseCreate}
        title="Создать набор"
        centered
      >
        <Stack>
          <TextInput
            label="Название набора"
            value={createName}
            onChange={(e) => setCreateName(e.currentTarget.value)}
            styles={darkFieldStyles}
            required
          />
          <MultiSelect
            label="Задачи"
            data={pickerOptions}
            value={createTaskIds}
            onChange={setCreateTaskIds}
            searchable
            placeholder="Выберите задачи"
            styles={darkSelectStyles}
            required
            labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
          />
          <Button
            onClick={handleCreate}
            loading={createPresetState.isLoading}
            disabled={createPresetState.isLoading}
          >
            Создать
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={editOpened}
        onClose={handleCloseEdit}
        title="Редактировать набор"
        centered
      >
        <Stack>
          {editLoading ? (
            <Center>
              <Loader size="sm" />
            </Center>
          ) : (
            <>
              <TextInput
                label="Название набора"
                value={editName}
                onChange={(e) => setEditName(e.currentTarget.value)}
                styles={darkFieldStyles}
                required
              />
              <MultiSelect
                label="Задачи"
                data={pickerOptions}
                value={editTaskIds}
                onChange={setEditTaskIds}
                searchable
                placeholder="Выберите задачи"
                styles={darkSelectStyles}
                required
                labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
              />
            </>
          )}
          <Button
            onClick={handleEdit}
            loading={updatePresetState.isLoading}
            disabled={updatePresetState.isLoading || editLoading}
          >
            Сохранить
          </Button>
        </Stack>
      </Modal>

      <Modal opened={importOpened} onClose={closeImport} title="Импортировать набор" centered size="lg">
        <Stack>
          <Text size="sm" c="gray.5">Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке.</Text>
          <Textarea label="Данные набора" value={importData} onChange={(event) => setImportData(event.currentTarget.value)} minRows={6} error={importError || undefined} />
          <Button onClick={() => void handleImport()} loading={importing || createTaskState.isLoading} disabled={!importData.trim()}>Импортировать набор</Button>
        </Stack>
      </Modal>

      <Box c="gray.1">
        <Stack>
          <Group>
            <ThemeIcon color="gray" variant="light">
              <IconBookmark size={15} />
            </ThemeIcon>
            <Title order={4}>Наборы задач</Title>
          </Group>

          <Group justify="space-between" align="center" gap="xs" wrap="wrap">
            <Group role="tablist" aria-label="Фильтр наборов" gap="xs">
              <Button
                type="button"
                role="tab"
                aria-selected={mode === "active"}
                size="xs"
                variant={mode === "active" ? "filled" : "light"}
                onClick={() => setMode("active")}
              >
                Активные
              </Button>
              <Button
                type="button"
                role="tab"
                aria-selected={mode === "archived"}
                size="xs"
                variant={mode === "archived" ? "filled" : "light"}
                onClick={() => setMode("archived")}
              >
                Архив
              </Button>
            </Group>
            {mode === "active" ? (
              <Group gap="xs">
                <Button color="blue" leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>Создать набор</Button>
                <Button variant="light" onClick={openImport}>Импортировать</Button>
              </Group>
            ) : null}
          </Group>

          {copyNotice ? <Text role="status" c="blue.3" size="sm">{copyNotice}</Text> : null}

          {isLoading && (
            <Center>
              <Loader />
            </Center>
          )}

          {isError && (
            <Text c="red.4" size="sm">
              Ошибка загрузки наборов
            </Text>
          )}

          {!isLoading && !isError && (
            <Stack gap="sm">
              {presets.length === 0 ? (
                <Text size="sm" c="gray.4">
                  {mode === "active"
                    ? "Наборов пока нет. Создайте первый набор для быстрой загрузки задач в комнату."
                    : "Архив наборов пуст."}
                </Text>
              ) : (
                presets.map((preset) => (
                  <Card
                    key={preset.id}
                    data-testid={`preset-card-${preset.id}`}
                    radius="md"
                    padding="sm"
                    bg="#121720"
                  >
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <Text fw={700}>{preset.name}</Text>
                        {preset.itemCount === 0 ? (
                          <Badge color="orange" variant="light">
                            Пустой
                          </Badge>
                        ) : (
                          <Badge color="gray" variant="light">
                            {taskCountLabel(preset.itemCount)}
                          </Badge>
                        )}
                        <Badge color={preset.status === "ACTIVE" ? "teal" : "gray"} variant="light">
                          {preset.status === "ACTIVE" ? "Активный" : "Архив"}
                        </Badge>
                        <Badge color="dark" variant="light">
                          v{preset.revision}
                        </Badge>
                      </Group>
                      <Group gap="xs">
                        {mode === "active" ? (
                          <Button
                            size="xs"
                            variant="subtle"
                            leftSection={<IconEdit size={14} />}
                            onClick={() => handleOpenEdit(preset.id)}
                          >
                            Изменить
                          </Button>
                        ) : null}
                        {mode === "active" ? (
                          <Button
                            size="xs"
                            variant="subtle"
                            leftSection={<IconCopy size={14} />}
                            disabled={actionLoading}
                            onClick={() => handleCopy(preset.id)}
                          >
                            Копировать
                          </Button>
                        ) : null}
                        {mode === "active" ? (
                          <Button
                            size="xs"
                            variant="subtle"
                            color="orange"
                            leftSection={<IconArchive size={14} />}
                            loading={archivePresetState.isLoading}
                            disabled={actionLoading}
                            onClick={() => handleArchive(preset.id)}
                          >
                            В архив
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="subtle"
                            color="green"
                            leftSection={<IconArchiveOff size={14} />}
                            loading={restorePresetState.isLoading}
                            disabled={actionLoading}
                            onClick={() => handleRestore(preset.id)}
                          >
                            Восстановить
                          </Button>
                        )}
                        <Button size="xs" variant="subtle" color="red" aria-label={`Удалить набор ${preset.name}`} disabled={actionLoading} onClick={() => setPresetToDelete({ id: preset.id, name: preset.name })}>Удалить</Button>
                      </Group>
                    </Group>
                    {preset.itemCount > 0 ? (
                      <Text size="sm" c="gray.4" mt="xs">
                        {languageSummary(preset.languageCounts ?? {})}
                      </Text>
                    ) : null}
                  </Card>
                ))
              )}
            </Stack>
          )}
        </Stack>
      </Box>
    </>
  );
}
