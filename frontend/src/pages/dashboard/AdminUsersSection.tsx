import React from "react";
import {
  Badge,
  ActionIcon,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "components/antd-compat";
import { IconTrash, IconUsers } from "components/antd-icons";
import type { AdminUser } from "../../types";
import { darkSelectStyles } from "./dashboardFieldStyles";
import { formatCreatedAt } from "./dashboardHelpers";

interface AdminUsersSectionProps {
  users: AdminUser[];
  currentUserId: string | undefined;
  roleDrafts: Record<string, string>;
  onRoleDraftChange: (userId: string, role: string) => void;
  onSaveRole: (user: AdminUser) => void;
  onDeleteUser: (user: AdminUser) => void;
  onRefresh: () => void;
  isUpdatingRole: boolean;
  isDeleting: boolean;
}

/**
 * Self-contained card for the dashboard "Админка" tab. Renders the list of
 * users, handles per-row role draft selection, and exposes
 * save/delete/refresh callbacks. Domain logic (mutations, error reporting)
 * stays in the parent so this component remains a presentational view.
 */
export function AdminUsersSection({
  users,
  currentUserId,
  roleDrafts,
  onRoleDraftChange,
  onSaveRole,
  onDeleteUser,
  onRefresh,
  isUpdatingRole,
  isDeleting,
}: AdminUsersSectionProps) {
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
        <Group justify="space-between" align="center">
          <Group>
            <ThemeIcon color="gray" variant="light">
              <IconUsers size={15} />
            </ThemeIcon>
            <Title order={4}>Админка пользователей</Title>
          </Group>
          <Button variant="light" size="xs" onClick={onRefresh}>
            Обновить
          </Button>
        </Group>

        <Text size="sm" c="gray.4">
          Управляйте ролями и удаляйте пользователей. Системный администратор
          защищен от изменения роли и удаления.
        </Text>

        <Stack gap="sm">
          {users.map((user) => {
            const draftRole = roleDrafts[user.id] ?? user.role;
            const isCurrentUser = user.id === currentUserId;
            const isProtected = user.isSystemAdmin;
            return (
              <Card
                key={user.id}
                withBorder
                radius="md"
                padding="sm"
                bg="var(--app-surface-soft)"
                style={{ borderColor: "var(--app-border)" }}
              >
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Group gap="xs">
                      <Text fw={700}>@{user.nickname}</Text>
                      <Badge
                        color={user.role === "admin" ? "orange" : "gray"}
                        variant="light"
                      >
                        {user.role === "admin"
                          ? "Администратор"
                          : "Пользователь"}
                      </Badge>
                      {isCurrentUser && (
                        <Badge color="teal" variant="outline">
                          Это вы
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="gray.4">
                      Создан: {formatCreatedAt(user.createdAt)}
                    </Text>
                  </Group>

                  <Group align="end" wrap="wrap">
                    <Select placeholder="Выберите роль участника"
                      label="Роль"
                      value={draftRole}
                      onChange={(value) => {
                        if (!value) return;
                        onRoleDraftChange(user.id, value);
                      }}
                      data={[
                        { value: "user", label: "Пользователь" },
                        { value: "admin", label: "Администратор" },
                      ]}
                      styles={darkSelectStyles}
                      w={220}
                      disabled={isProtected}
                      labelProps={{ onClick: (e: React.MouseEvent) => e.preventDefault() }}
                    />
                    <Button
                      variant="light"
                      loading={isUpdatingRole}
                      disabled={draftRole === user.role}
                      onClick={() => onSaveRole(user)}
                    >
                      Сохранить роль
                    </Button>
                    <ActionIcon
                      color="red"
                      variant="light"
                      aria-label={`Удалить пользователя @${user.nickname}`}
                      title="Удалить пользователя"
                      loading={isDeleting}
                      disabled={isCurrentUser || isProtected}
                      onClick={() => onDeleteUser(user)}
                    >
                      <IconTrash size={16} aria-hidden="true" />
                    </ActionIcon>
                  </Group>
                </Stack>
              </Card>
            );
          })}
          {users.length === 0 && (
            <Text size="sm" c="gray.4">
              Пользователи пока не найдены
            </Text>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
