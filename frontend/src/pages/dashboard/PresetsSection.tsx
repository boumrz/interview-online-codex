import React, { useState } from "react";
import {
  Badge,
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
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBookmark, IconEdit, IconTrash } from "@tabler/icons-react";
import { useAppSelector } from "../../app/hooks";
import {
  useListPresetsQuery,
  useCreatePresetMutation,
  useUpdatePresetMutation,
  useDeletePresetMutation,
  useLazyGetPresetQuery,
} from "../../services/api";
import { darkFieldStyles, darkSelectStyles } from "./dashboardFieldStyles";

interface PresetsSectionProps {
  taskOptions: Array<{ value: string; label: string }>;
}

/**
 * Self-contained CRUD component for task presets.
 * Allows creating, editing, and deleting presets of task templates.
 */
export function PresetsSection({ taskOptions }: PresetsSectionProps) {
  const { token } = useAppSelector((state) => state.auth);

  const { data: presets = [], isLoading, isError } = useListPresetsQuery(undefined, {
    skip: !token,
  });

  const [createPreset, createPresetState] = useCreatePresetMutation();
  const [updatePreset, updatePresetState] = useUpdatePresetMutation();
  const [deletePreset] = useDeletePresetMutation();
  const [triggerGetPreset] = useLazyGetPresetQuery();

  // Create modal state
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [createName, setCreateName] = useState("");
  const [createTaskIds, setCreateTaskIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState("");

  // Edit modal state
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [editPresetId, setEditPresetId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTaskIds, setEditTaskIds] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const handleOpenCreate = () => {
    setCreateName("");
    setCreateTaskIds([]);
    setCreateError("");
    openCreate();
  };

  const handleCloseCreate = () => {
    setCreateName("");
    setCreateTaskIds([]);
    setCreateError("");
    closeCreate();
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      setCreateError("Введите название пресета");
      return;
    }
    if (createTaskIds.length === 0) {
      setCreateError("Выберите хотя бы одну задачу");
      return;
    }
    try {
      setCreateError("");
      await createPreset({ name: createName.trim(), taskTemplateIds: createTaskIds }).unwrap();
      handleCloseCreate();
    } catch {
      setCreateError("Не удалось создать пресет");
    }
  };

  const handleOpenEdit = async (presetId: string) => {
    setEditPresetId(presetId);
    setEditName("");
    setEditTaskIds([]);
    setEditError("");
    setEditLoading(true);
    openEdit();
    try {
      const detail = await triggerGetPreset({ presetId }).unwrap();
      setEditName(detail.name);
      setEditTaskIds(detail.items.map((item) => item.taskTemplateId));
    } catch {
      setEditError("Не удалось загрузить данные пресета");
    } finally {
      setEditLoading(false);
    }
  };

  const handleCloseEdit = () => {
    setEditPresetId(null);
    setEditName("");
    setEditTaskIds([]);
    setEditError("");
    setEditLoading(false);
    closeEdit();
  };

  const handleEdit = async () => {
    if (!editPresetId) return;
    if (!editName.trim()) {
      setEditError("Введите название пресета");
      return;
    }
    if (editTaskIds.length === 0) {
      setEditError("Выберите хотя бы одну задачу");
      return;
    }
    try {
      setEditError("");
      await updatePreset({ presetId: editPresetId, name: editName.trim(), taskTemplateIds: editTaskIds }).unwrap();
      handleCloseEdit();
    } catch {
      setEditError("Не удалось сохранить пресет");
    }
  };

  const handleDelete = async (presetId: string, name: string) => {
    if (!window.confirm(`Удалить пресет «${name}»?`)) return;
    try {
      await deletePreset({ presetId }).unwrap();
    } catch {
      // show inline error via alert since no toast system is available here
      window.alert("Не удалось удалить пресет");
    }
  };

  return (
    <>
      <Modal
        opened={createOpened}
        onClose={handleCloseCreate}
        title="Создать пресет"
        centered
      >
        <Stack>
          <TextInput
            label="Название пресета"
            value={createName}
            onChange={(e) => setCreateName(e.currentTarget.value)}
            styles={darkFieldStyles}
            required
          />
          <MultiSelect
            label="Задачи"
            data={taskOptions}
            value={createTaskIds}
            onChange={setCreateTaskIds}
            searchable
            placeholder="Выберите задачи"
            styles={darkSelectStyles}
            required
          />
          {createError && (
            <Text c="red.4" size="sm">
              {createError}
            </Text>
          )}
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
        title="Редактировать пресет"
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
                label="Название пресета"
                value={editName}
                onChange={(e) => setEditName(e.currentTarget.value)}
                styles={darkFieldStyles}
                required
              />
              <MultiSelect
                label="Задачи"
                data={taskOptions}
                value={editTaskIds}
                onChange={setEditTaskIds}
                searchable
                placeholder="Выберите задачи"
                styles={darkSelectStyles}
                required
              />
            </>
          )}
          {editError && (
            <Text c="red.4" size="sm">
              {editError}
            </Text>
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

      <Card
        withBorder
        radius="lg"
        padding="lg"
        bg="#11151c"
        c="gray.1"
        style={{ borderColor: "#272b34" }}
      >
        <Stack>
          <Group justify="space-between" align="center">
            <Group>
              <ThemeIcon color="gray" variant="light">
                <IconBookmark size={15} />
              </ThemeIcon>
              <Title order={4}>Пресеты задач</Title>
            </Group>
            <Button variant="light" size="xs" onClick={handleOpenCreate}>
              Создать пресет
            </Button>
          </Group>

          {isLoading && (
            <Center>
              <Loader />
            </Center>
          )}

          {isError && (
            <Text c="red.4" size="sm">
              Ошибка загрузки пресетов
            </Text>
          )}

          {!isLoading && !isError && (
            <Stack gap="sm">
              {presets.length === 0 ? (
                <Text size="sm" c="gray.4">
                  Нет пресетов. Создайте первый пресет для быстрой загрузки задач в комнату.
                </Text>
              ) : (
                presets.map((preset) => (
                  <Card
                    key={preset.id}
                    withBorder
                    radius="md"
                    padding="sm"
                    bg="#121720"
                    style={{ borderColor: "#2a3039" }}
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
                            {preset.itemCount} задач
                          </Badge>
                        )}
                      </Group>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconEdit size={14} />}
                          onClick={() => handleOpenEdit(preset.id)}
                        >
                          Изменить
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => handleDelete(preset.id, preset.name)}
                        >
                          Удалить
                        </Button>
                      </Group>
                    </Group>
                  </Card>
                ))
              )}
            </Stack>
          )}
        </Stack>
      </Card>
    </>
  );
}
