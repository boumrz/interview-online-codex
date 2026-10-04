import React, { useMemo, useState } from "react";
import {
  ActionIcon,
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
} from "components/antd-compat";
import { useDisclosure } from "components/antd-hooks";
import { IconBookmark, IconCopy, IconEdit, IconPlus, IconTrash } from "components/antd-icons";
import { useAppSelector } from "../../app/hooks";
import { useClipboardNotification } from "../../components/useClipboardNotification";
import {
  useListPresetsQuery,
  useCreatePresetMutation,
  useUpdatePresetMutation,
  useDeletePresetMutation,
  useLazyGetPresetQuery,
  useTasksGroupedQuery,
  useCreateTaskTemplateMutation,
} from "../../services/api";
import { parseLibraryTransfer, serializeTaskSet } from "../../features/workspace/libraryTransfer";
import { darkFieldStyles, darkSelectStyles } from "./dashboardFieldStyles";
import { LANGUAGE_OPTIONS } from "./dashboardConstants";
import { normalizeLanguageKey } from "./dashboardHelpers";
import workspaceStyles from "../workspace/PersonalWorkspacePage.module.css";

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
  const [formError, setFormError] = useState("");

  const { data: presets = [], isLoading, isError } = useListPresetsQuery(undefined, {
    skip: !token,
  });
  const { data: taskGroups = [] } = useTasksGroupedQuery(undefined, { skip: !token });

  const [createPreset, createPresetState] = useCreatePresetMutation();
  const [updatePreset, updatePresetState] = useUpdatePresetMutation();
  const [deletePreset, deletePresetState] = useDeletePresetMutation();
  const [presetToDelete, setPresetToDelete] = useState<{ id: string; name: string } | null>(null);
  const [triggerGetPreset] = useLazyGetPresetQuery();
  const [createTask, createTaskState] = useCreateTaskTemplateMutation();
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false);
  const [importData, setImportData] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const copyToClipboard = useClipboardNotification();

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
    setFormError("");
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
    setFormError("");
    if (!createName.trim()) {
      setFormError("Введите название набора");
      onError?.("Введите название набора");
      return;
    }
    if (createTaskIds.length === 0) {
      setFormError("Выберите хотя бы одну задачу");
      onError?.("Выберите хотя бы одну задачу");
      return;
    }
    try {
      await createPreset({ name: createName.trim(), taskTemplateIds: createTaskIds }).unwrap();
      handleCloseCreate();
    } catch {
      setFormError("Не удалось создать набор");
      onError?.("Не удалось создать набор");
    }
  };

  const handleOpenEdit = async (presetId: string) => {
    setFormError("");
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
      setFormError("Не удалось загрузить набор");
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
    setFormError("");
    if (!editPresetId) return;
    if (!editName.trim()) {
      setFormError("Введите название набора");
      onError?.("Введите название набора");
      return;
    }
    if (editTaskIds.length === 0) {
      setFormError("Выберите хотя бы одну задачу");
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
      setFormError("Не удалось сохранить набор");
      onError?.("Не удалось сохранить набор");
    }
  };

  const handleCopy = async (presetId: string) => {
    try {
      const preset = await triggerGetPreset({ presetId }).unwrap();
      const catalog = new Map(taskGroups.flatMap((group) => group.tasks).map((task) => [task.id, task]));
      const tasks = preset.items.map((item) => catalog.get(item.taskTemplateId));
      if (tasks.some((task) => !task)) {
        onError?.("Не удалось найти задачи набора. Обновите библиотеку и повторите попытку.");
        return;
      }
      await copyToClipboard(serializeTaskSet(preset.name, tasks as NonNullable<typeof tasks[number]>[]), {
        success: `Набор «${preset.name}» готов к передаче.`,
        failure: "Разрешите доступ к буферу обмена и повторите попытку.",
      });
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

  const actionLoading = updatePresetState.isLoading || deletePresetState.isLoading;

  return (
    <>
      <Modal opened={presetToDelete !== null} onClose={() => { if (!deletePresetState.isLoading) setPresetToDelete(null); }} title="Удалить набор?" centered>
        <Stack gap="md">
          <Text size="sm">Набор «{presetToDelete?.name}» исчезнет из библиотеки. В уже созданных интервью его задачи сохранятся.</Text>
          {formError ? <Text role="alert" c="var(--app-error)">{formError}</Text> : null}
          <Group justify="flex-end">
            <Button variant="subtle" disabled={deletePresetState.isLoading} onClick={() => setPresetToDelete(null)}>Отмена</Button>
            <Button variant="light" color="red" leftSection={<IconTrash size={16} aria-hidden="true" />} loading={deletePresetState.isLoading} disabled={deletePresetState.isLoading} onClick={async () => {
              if (!presetToDelete) return;
              setFormError("");
              try {
                await deletePreset({ presetId: presetToDelete.id }).unwrap();
                setPresetToDelete(null);
              } catch {
                setFormError("Не удалось удалить набор. Попробуйте ещё раз.");
                onError?.("Не удалось удалить набор. Попробуйте ещё раз.");
              }
            }}>Удалить</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={createOpened}
        onClose={() => { if (!createPresetState.isLoading) handleCloseCreate(); }}
        closeOnClickOutside={!createPresetState.isLoading}
        closeOnEscape={!createPresetState.isLoading}
        title="Создать набор"
        centered
        authoring
      >
        <div className="app-authoring-form">
          <div className="app-authoring-fields">
            <section className="app-authoring-section">
          <TextInput placeholder="Введите название"
            label="Название набора"
            value={createName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateName(e.currentTarget.value)}
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
            </section>
          {formError ? <Text role="alert" c="var(--app-error)">{formError}</Text> : null}
          </div>
          <Group className="app-form-actions" justify="flex-end"><Button variant="subtle" color="gray" disabled={createPresetState.isLoading} onClick={handleCloseCreate}>Отмена</Button><Button
            onClick={handleCreate}
            loading={createPresetState.isLoading}
            disabled={createPresetState.isLoading}
          >
            Создать
          </Button></Group>
        </div>
      </Modal>

      <Modal
        opened={editOpened}
        onClose={() => { if (!updatePresetState.isLoading) handleCloseEdit(); }}
        closeOnClickOutside={!updatePresetState.isLoading}
        closeOnEscape={!updatePresetState.isLoading}
        title="Редактировать набор"
        centered
        authoring
      >
        <div className="app-authoring-form">
          <div className="app-authoring-fields">
          {editLoading ? (
            <Center>
              <Loader size="sm" />
            </Center>
          ) : (
            <section className="app-authoring-section">
              <TextInput placeholder="Введите название"
                label="Название набора"
                value={editName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.currentTarget.value)}
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
            </section>
          )}
          {formError ? <Text role="alert" c="var(--app-error)">{formError}</Text> : null}
          </div>
          <Group className="app-form-actions" justify="flex-end"><Button variant="subtle" color="gray" disabled={updatePresetState.isLoading} onClick={handleCloseEdit}>Отмена</Button><Button
            onClick={handleEdit}
            loading={updatePresetState.isLoading}
            disabled={updatePresetState.isLoading || editLoading}
          >
            Сохранить
          </Button></Group>
        </div>
      </Modal>

      <Modal opened={importOpened} onClose={() => { if (!importing && !createTaskState.isLoading) closeImport(); }} title="Импортировать набор" centered size="lg" closeOnClickOutside={!importing && !createTaskState.isLoading} closeOnEscape={!importing && !createTaskState.isLoading}>
        <Stack>
          <Text size="sm" c="gray.5">Вставьте данные, полученные кнопкой «Копировать» в другой библиотеке.</Text>
          <Textarea placeholder="Вставьте данные из кнопки «Копировать» у набора" label="Данные набора" value={importData} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setImportData(event.currentTarget.value)} minRows={6} error={importError || undefined} />
          <Group justify="flex-end"><Button variant="subtle" color="gray" disabled={importing || createTaskState.isLoading} onClick={closeImport}>Отмена</Button><Button onClick={() => void handleImport()} loading={importing || createTaskState.isLoading} disabled={!importData.trim()}>Импортировать набор</Button></Group>
        </Stack>
      </Modal>

      <Box c="gray.1">
        <Stack>
          <Group justify="space-between" align="center" gap="md" wrap="wrap">
            <Group align="center" gap="sm">
              <ThemeIcon color="gray" variant="light">
                <IconBookmark size={15} />
              </ThemeIcon>
              <Title order={4} m={0}>Наборы задач</Title>
            </Group>

            <Group gap="xs" align="center" wrap="wrap">
              <Button color="blue" leftSection={<IconPlus size={16} />} onClick={handleOpenCreate}>Создать набор</Button>
              <Button variant="light" onClick={openImport}>Импортировать</Button>
            </Group>
          </Group>

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
                  Наборов пока нет. Создайте первый набор для быстрой загрузки задач в комнату.
                </Text>
              ) : (
                presets.map((preset) => (
                  <Card
                    key={preset.id}
                    data-testid={`preset-card-${preset.id}`}
                    radius="md"
                    padding="sm"
                    bg="var(--app-surface-soft)"
                  >
                    <Group className={workspaceStyles.taskRow} justify="space-between" align="center" gap="md" wrap="wrap">
                      <div className={workspaceStyles.taskDetails}>
                      <Group gap="xs" align="center" wrap="wrap">
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
                      </Group>
                      {preset.itemCount > 0 ? (
                        <Text size="sm" c="gray.4">
                          {languageSummary(preset.languageCounts ?? {})}
                        </Text>
                      ) : null}
                      </div>
                      <Group className={workspaceStyles.taskActions} gap="xs" align="center" wrap="wrap">
                        <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} disabled={actionLoading} onClick={() => void handleCopy(preset.id)}>Копировать</Button>
                        <Button size="xs" variant="light" leftSection={<IconEdit size={16} aria-hidden="true" />} aria-label={`Редактировать набор ${preset.name}`} title="Редактировать набор" disabled={actionLoading} onClick={() => void handleOpenEdit(preset.id)}>Редактировать</Button>
                        <ActionIcon size="sm" variant="light" color="red" aria-label={`Удалить набор ${preset.name}`} title="Удалить набор" disabled={actionLoading || deletePresetState.isLoading} onClick={() => { setFormError(""); setPresetToDelete({ id: preset.id, name: preset.name }); }}><IconTrash size={16} aria-hidden="true" /></ActionIcon>
                      </Group>
                    </Group>
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
