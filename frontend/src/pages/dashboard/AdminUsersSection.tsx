import React, { useEffect, useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Loader, Pagination, Select, Text, TextInput, Title } from "components/antd-compat";
import { IconRefresh, IconTrash } from "components/antd-icons";
import type { AdminUser } from "../../types";
import { formatCreatedAt } from "./dashboardHelpers";
import styles from "./AdminUsersSection.module.css";

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
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}

const USERS_PER_PAGE = 25;

export function AdminUsersSection({ users, currentUserId, roleDrafts, onRoleDraftChange, onSaveRole, onDeleteUser, onRefresh, isUpdatingRole, isDeleting, isLoading, isFetching, isError }: AdminUsersSectionProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? users.filter((user) => user.nickname.toLocaleLowerCase().includes(query)) : users;
  }, [users, search]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((currentPage - 1) * USERS_PER_PAGE, currentPage * USERS_PER_PAGE);
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <Title order={1}>Админка пользователей</Title>
        <Text c="var(--app-muted)">Управляйте доступом к приложению и ролями пользователей.</Text>
      </div>
      <div className={styles.toolbar}>
        <TextInput
          className={styles.search}
          label="Поиск пользователей" placeholder="Никнейм пользователя" value={search}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setSearch(event.currentTarget.value); setPage(1); }}
        />
        <Button variant="light" leftSection={<IconRefresh size={16} aria-hidden="true" />} onClick={onRefresh} loading={isFetching}>Обновить</Button>
      </div>
      {isLoading ? <Group role="status" aria-label="Загружаем пользователей"><Loader size="sm" /><Text>Загружаем пользователей…</Text></Group> : null}
      {isFetching && !isLoading ? <Text role="status" c="var(--app-muted)">Обновляем пользователей…</Text> : null}
      {isError ? (
        <Alert color="red" role="alert" title="Не удалось загрузить пользователей">
          <Button variant="light" size="xs" disabled={isFetching} onClick={onRefresh}>Повторить</Button>
        </Alert>
      ) : null}
      <div className={styles.directory}>
        <div className={styles.columnHeadings} aria-hidden="true"><span>Пользователь</span><span>Создан</span><span>Роль и действия</span></div>
        {visibleUsers.map((user) => {
          const draftRole = roleDrafts[user.id] ?? user.role;
          const isCurrentUser = user.id === currentUserId;
          const isProtected = user.isSystemAdmin;
          return (
            <div key={user.id} role="region" aria-label={`Пользователь @${user.nickname}`} className={styles.row}>
              <div className={styles.identity}>
                <Text fw={700} className={styles.nickname}>@{user.nickname}</Text>
                <Group gap="xs" wrap="wrap">
                  <Badge color={user.role === "admin" ? "orange" : "gray"} variant="light">{user.role === "admin" ? "Администратор" : "Пользователь"}</Badge>
                  {isCurrentUser ? <Badge color="teal" variant="outline">Это вы</Badge> : null}
                  {isProtected ? <Text size="xs" c="var(--app-muted)">Системный администратор</Text> : null}
                </Group>
              </div>
              <Text size="sm" c="var(--app-muted)" className={styles.created}><span className={styles.mobileLabel}>Создан: </span>{formatCreatedAt(user.createdAt)}</Text>
              <div className={styles.actions}>
                <Select
                  placeholder="Выберите роль участника" label="Роль" value={draftRole}
                  labelProps={{ className: styles.srOnly }}
                  onChange={(value) => { if (value) onRoleDraftChange(user.id, value); }}
                  data={[{ value: "user", label: "Пользователь" }, { value: "admin", label: "Администратор" }]}
                  disabled={isProtected}
                />
                <Button variant="light" loading={isUpdatingRole} disabled={isProtected || draftRole === user.role} onClick={() => onSaveRole(user)}>Сохранить роль</Button>
                <ActionIcon color="red" variant="light" aria-label={`Удалить пользователя @${user.nickname}`} title="Удалить пользователя" loading={isDeleting} disabled={isCurrentUser || isProtected} onClick={() => onDeleteUser(user)}><IconTrash size={16} aria-hidden="true" /></ActionIcon>
              </div>
            </div>
          );
        })}
        {!isLoading && !isFetching && !isError && filteredUsers.length === 0 ? <div className={styles.empty}><Text c="var(--app-muted)">{search.trim() ? "По этому никнейму пользователи не найдены" : "Пользователи пока не найдены"}</Text></div> : null}
      </div>
      {!isLoading && users.length > 0 ? (
        <Group component="nav" aria-label="Пагинация пользователей" justify="space-between" wrap="wrap" className={styles.pagination}>
          <Text size="sm" c="var(--app-muted)">Страница {currentPage} из {pageCount}. Найдено {filteredUsers.length} из {users.length} пользователей</Text>
          {pageCount > 1 ? <Pagination total={pageCount} value={currentPage} onChange={setPage} aria-label="Страницы пользователей" /> : null}
        </Group>
      ) : null}
    </section>
  );
}
